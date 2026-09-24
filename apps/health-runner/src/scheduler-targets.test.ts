import { describe, expect, it } from "vitest";
import type { HealthSchedule, HealthScheduleInput } from "@product/health";
import { NO_SESSION_TARGETS } from "./no-session-target-authority.js";
import {
  createNoSessionHealthSchedules,
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
      schedules.every((item) => item.cadence.intervalSeconds >= 3_600),
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
  });
});
