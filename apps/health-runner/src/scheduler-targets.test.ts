import { describe, expect, it } from "vitest";
import { NO_SESSION_TARGETS } from "./no-session-target-authority.js";
import { createNoSessionHealthSchedules } from "./scheduler-targets.js";

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
});
