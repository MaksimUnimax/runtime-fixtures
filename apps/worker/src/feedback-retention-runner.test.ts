import { describe, expect, it, vi } from "vitest";
import { FeedbackRetentionRunner } from "./feedback-retention-runner.js";

describe("FeedbackRetentionRunner", () => {
  it("passes the configured periods and clock to a bounded purge tick", async () => {
    const purgeExpired = vi.fn(async () => ({ cases: 2, signals: 3 }));
    const runner = new FeedbackRetentionRunner(
      { purgeExpired },
      { closedDays: 7, signalDays: 14 },
      60_000,
      () => new Date("2026-09-23T08:00:00.000Z"),
    );

    await expect(runner.tick()).resolves.toEqual({ cases: 2, signals: 3 });
    expect(purgeExpired).toHaveBeenCalledWith({
      now: new Date("2026-09-23T08:00:00.000Z"),
      closedRetentionDays: 7,
      signalRetentionDays: 14,
    });
  });

  it("does not arm the interval when the initial purge fails", async () => {
    vi.useFakeTimers();
    try {
      const purgeExpired = vi.fn(async () => {
        throw new Error("RETENTION_PURGE_FAILED");
      });
      const runner = new FeedbackRetentionRunner(
        { purgeExpired },
        { closedDays: 90, signalDays: 180 },
        60_000,
      );

      await expect(runner.start()).rejects.toThrow("RETENTION_PURGE_FAILED");
      await vi.advanceTimersByTimeAsync(120_000);
      expect(purgeExpired).toHaveBeenCalledOnce();
      await runner.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs once on start and stops repeatably", async () => {
    const purgeExpired = vi.fn(async () => ({ cases: 0, signals: 0 }));
    const runner = new FeedbackRetentionRunner(
      { purgeExpired },
      { closedDays: 90, signalDays: 180 },
      60_000,
    );

    await runner.start();
    expect(purgeExpired).toHaveBeenCalledOnce();
    await runner.stop();
    await runner.stop();
  });
});
