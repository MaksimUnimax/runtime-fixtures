import { describe, expect, it } from "vitest";
import type { HealthSchedule, HealthScheduleInput } from "@product/health";
import { NO_SESSION_TARGETS } from "./no-session-target-authority.js";
import {
  AUTHENTICATED_DEEP_INTERVAL_SECONDS,
  createAuthenticatedDeepHealthSchedules,
  createNoSessionHealthSchedules,
  ensureAuthenticatedDeepHealthSchedules,
  ensureNoSessionHealthSchedules,
} from "./scheduler-targets.js";

describe("no-session durable schedule definitions", () => {
  it("creates one enabled NO_SESSION schedule per accepted surface without auth", () => {
    const schedules = createNoSessionHealthSchedules(
      new Date("2026-09-18T00:00:00Z"),
    );
    expect(schedules).toHaveLength(NO_SESSION_TARGETS.length);
    expect(new Set(schedules.map((item) => item.surface))).toEqual(
      new Set(NO_SESSION_TARGETS.map((item) => item.surfaceId)),
    );
    expect(
      schedules.every(
        (item) => item.enabled && item.probeLayer === "NO_SESSION",
      ),
    ).toBe(true);
    expect(
      schedules.every((item) => item.cadence.intervalSeconds === 21_600),
    ).toBe(true);
    expect(schedules.some((item) => item.surface === "CHATGPT_WORK")).toBe(
      true,
    );
  });

  it("does not create authenticated schedules when no technical sessions exist", () => {
    expect(
      createNoSessionHealthSchedules(new Date()).some(
        (item) => item.probeLayer === "AUTHENTICATED_DEEP",
      ),
    ).toBe(false);
  });

  it("creates only explicitly configured, distinct deep schedules at 90 minutes", () => {
    const schedules = createAuthenticatedDeepHealthSchedules(new Date(0), [
      "chatgpt_standard_health",
      "chatgpt_work_health",
      "personal_chatgpt",
    ]);
    expect(schedules.map((item) => item.monitorTarget)).toEqual([
      "authdeep_chatgpt_standard",
      "authdeep_chatgpt_work",
    ]);
    expect(new Set(schedules.map((item) => item.scheduleId)).size).toBe(2);
    expect(
      schedules.every((item) => item.probeLayer === "AUTHENTICATED_DEEP"),
    ).toBe(true);
    expect(
      schedules.every(
        (item) =>
          item.cadence.intervalSeconds === AUTHENTICATED_DEEP_INTERVAL_SECONDS,
      ),
    ).toBe(true);
    expect(AUTHENTICATED_DEEP_INTERVAL_SECONDS).toBe(5_400);
    expect(createAuthenticatedDeepHealthSchedules(new Date(0), [])).toEqual([]);
    expect(
      createNoSessionHealthSchedules(new Date(0)).every(
        (item) => item.cadence.intervalSeconds === 21_600,
      ),
    ).toBe(true);
  });

  it("reconciles deep schedules to trusted session targets and disables stale ones", async () => {
    const rows = new Map<string, HealthSchedule>();
    const repository = {
      getSchedule: async (id: string) => rows.get(id),
      createSchedule: async (input: unknown) => {
        const schedule = input as HealthScheduleInput;
        const row: HealthSchedule = {
          ...schedule,
          lastAttemptAt: null,
          lastSuccessAt: null,
          createdAt: new Date(0),
          updatedAt: new Date(0),
        };
        rows.set(schedule.scheduleId, row);
        return row;
      },
      updateSchedule: async (input: {
        scheduleId: string;
        enabled: boolean;
        cadence: HealthSchedule["cadence"];
        nextDueAt: Date;
      }) => {
        const existing = rows.get(input.scheduleId);
        if (!existing) throw new Error("missing");
        const row: HealthSchedule = {
          ...existing,
          enabled: input.enabled,
          cadence: input.cadence,
          nextDueAt: input.nextDueAt,
          revision: existing.revision + 1,
          updatedAt: new Date(input.nextDueAt),
        };
        rows.set(input.scheduleId, row);
        return row;
      },
    };
    const at = new Date("2026-09-27T17:00:00Z");

    expect(
      await ensureAuthenticatedDeepHealthSchedules(repository, at, [
        "chatgpt_standard_health",
      ]),
    ).toEqual({ created: 1, enabled: 0, disabled: 0 });
    expect([...rows.values()].map((row) => row.monitorTarget)).toEqual([
      "authdeep_chatgpt_standard",
    ]);

    expect(
      await ensureAuthenticatedDeepHealthSchedules(repository, at, [
        "chatgpt_standard_health",
        "chatgpt_work_health",
      ]),
    ).toEqual({ created: 1, enabled: 0, disabled: 0 });
    expect([...rows.values()].filter((row) => row.enabled)).toHaveLength(2);

    expect(
      await ensureAuthenticatedDeepHealthSchedules(repository, at, []),
    ).toEqual({ created: 0, enabled: 0, disabled: 2 });
    expect([...rows.values()].every((row) => row.enabled === false)).toBe(true);

    const later = new Date("2026-09-27T17:01:00Z");
    expect(
      await ensureAuthenticatedDeepHealthSchedules(repository, later, [
        "chatgpt_work_health",
      ]),
    ).toEqual({ created: 0, enabled: 1, disabled: 0 });
    const enabled = [...rows.values()].filter((row) => row.enabled);
    expect(enabled).toHaveLength(1);
    expect(enabled[0]?.monitorTarget).toBe("authdeep_chatgpt_work");
    expect(enabled[0]?.nextDueAt.valueOf()).toBe(later.valueOf());

    const standard = [...rows.values()].find(
      (row) => row.monitorTarget === "authdeep_chatgpt_standard",
    );
    if (!standard) throw new Error("missing standard");
    rows.set(standard.scheduleId, {
      ...standard,
      provider: "forged",
      enabled: true,
    });
    await expect(
      ensureAuthenticatedDeepHealthSchedules(repository, later, []),
    ).rejects.toThrow("AUTHENTICATED_DEEP_SCHEDULE_IDENTITY_CONFLICT");
  });

  it("bootstraps idempotently and preserves independent provider/surface rows", async () => {
    const rows = new Map<string, HealthSchedule>();
    let createCalls = 0;
    const repository = {
      getSchedule: async (id: string) => rows.get(id),
      createSchedule: async (input: unknown) => {
        const schedule = input as HealthScheduleInput;
        createCalls += 1;
        const row: HealthSchedule = {
          ...schedule,
          lastAttemptAt: null,
          lastSuccessAt: null,
          createdAt: new Date(0),
          updatedAt: new Date(0),
        };
        rows.set(schedule.scheduleId, row);
        return row;
      },
      updateSchedule: async (input: {
        scheduleId: string;
        enabled: boolean;
        cadence: HealthSchedule["cadence"];
        nextDueAt: Date;
      }) => {
        const existing = rows.get(input.scheduleId);
        if (!existing) throw new Error("missing");
        const row: HealthSchedule = {
          ...existing,
          enabled: input.enabled,
          cadence: input.cadence,
          nextDueAt: input.nextDueAt,
          revision: existing.revision + 1,
          updatedAt: new Date(input.nextDueAt),
        };
        rows.set(input.scheduleId, row);
        return row;
      },
    };
    const at = new Date("2026-09-23T00:00:00Z");
    expect(await ensureNoSessionHealthSchedules(repository, at)).toBe(
      NO_SESSION_TARGETS.length,
    );
    expect(await ensureNoSessionHealthSchedules(repository, at)).toBe(0);
    expect(createCalls).toBe(NO_SESSION_TARGETS.length);
    expect(rows.size).toBe(NO_SESSION_TARGETS.length);
    expect(new Set([...rows.values()].map((row) => row.surface)).size).toBe(
      NO_SESSION_TARGETS.length,
    );

    const changedAt = new Date("2026-09-23T01:00:00Z");
    expect(
      await ensureNoSessionHealthSchedules(repository, changedAt, 3_600),
    ).toBe(0);
    expect(
      [...rows.values()].every(
        (row) =>
          row.cadence.intervalSeconds === 3_600 &&
          row.nextDueAt.valueOf() === changedAt.valueOf() &&
          row.revision === 2,
      ),
    ).toBe(true);
    await expect(
      ensureNoSessionHealthSchedules(repository, changedAt, 300),
    ).rejects.toThrow("NO_SESSION_SCHEDULE_CADENCE_INVALID");
  });
});
