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
      batchSize: 500,
      statementTimeoutMs: 5_000,
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

  it("reports a later rejection, keeps it handled, and waits before retrying", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => unhandled.push(error);
    process.on("unhandledRejection", onUnhandled);
    try {
      const purgeExpired = vi
        .fn<() => Promise<{ cases: number; signals: number }>>()
        .mockResolvedValueOnce({ cases: 0, signals: 0 })
        .mockRejectedValueOnce(new Error("PERIODIC_PURGE_FAILED"));
      const runner = new FeedbackRetentionRunner(
        { purgeExpired },
        { closedDays: 90, signalDays: 180 },
        60_000,
        undefined,
        onError,
      );

      await runner.start();
      await vi.advanceTimersByTimeAsync(60_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(purgeExpired).toHaveBeenCalledTimes(2);
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "PERIODIC_PURGE_FAILED" }),
      );
      expect(unhandled).toEqual([]);
      await vi.advanceTimersByTimeAsync(59_999);
      expect(purgeExpired).toHaveBeenCalledTimes(2);
      await runner.stop();
    } finally {
      process.off("unhandledRejection", onUnhandled);
      vi.useRealTimers();
    }
  });

  it("does not overlap a slow periodic purge", async () => {
    vi.useFakeTimers();
    let resolveSlow!: (value: { cases: number; signals: number }) => void;
    let active = 0;
    let maxActive = 0;
    try {
      const purgeExpired = vi.fn(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        try {
          if (purgeExpired.mock.calls.length === 1) {
            return { cases: 0, signals: 0 };
          }
          return await new Promise<{ cases: number; signals: number }>(
            (resolve) => {
              resolveSlow = resolve;
            },
          );
        } finally {
          active -= 1;
        }
      });
      const runner = new FeedbackRetentionRunner(
        { purgeExpired },
        { closedDays: 90, signalDays: 180 },
        1_000,
      );

      await runner.start();
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(purgeExpired).toHaveBeenCalledTimes(2);
      expect(maxActive).toBe(1);
      resolveSlow({ cases: 0, signals: 0 });
      await Promise.resolve();
      await runner.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for an in-flight purge on stop and does not start a later purge", async () => {
    vi.useFakeTimers();
    let resolveSlow!: (value: { cases: number; signals: number }) => void;
    try {
      const purgeExpired = vi
        .fn<() => Promise<{ cases: number; signals: number }>>()
        .mockResolvedValueOnce({ cases: 0, signals: 0 })
        .mockImplementationOnce(
          () =>
            new Promise<{ cases: number; signals: number }>((resolve) => {
              resolveSlow = resolve;
            }),
        );
      const runner = new FeedbackRetentionRunner(
        { purgeExpired },
        { closedDays: 90, signalDays: 180 },
        1_000,
      );

      await runner.start();
      await vi.advanceTimersByTimeAsync(1_000);
      let stopSettled = false;
      const stopped = runner.stop().then(() => {
        stopSettled = true;
      });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(purgeExpired).toHaveBeenCalledTimes(2);
      expect(stopSettled).toBe(false);
      resolveSlow({ cases: 0, signals: 0 });
      await stopped;
      expect(stopSettled).toBe(true);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(purgeExpired).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
