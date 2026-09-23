import { describe, expect, it, vi } from "vitest";
import { FeedbackRetentionRunner } from "./feedback-retention-runner.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("FeedbackRetentionRunner", () => {
  it("passes retention boundaries and bounded work settings to the repository", async () => {
    const purgeExpired = vi.fn(async () => ({ cases: 1, signals: 1 }));
    const runner = new FeedbackRetentionRunner(
      { purgeExpired },
      { closedDays: 7, signalDays: 14 },
      {
        batchSize: 10,
        maxBatchesPerTick: 1,
        statementTimeoutMs: 1_500,
        now: () => new Date("2026-09-23T08:00:00.000Z"),
      },
    );

    await expect(runner.tick()).resolves.toEqual({ cases: 1, signals: 1 });
    expect(purgeExpired).toHaveBeenCalledWith({
      now: new Date("2026-09-23T08:00:00.000Z"),
      closedRetentionDays: 7,
      signalRetentionDays: 14,
      batchSize: 10,
      statementTimeoutMs: 1_500,
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
        { intervalMs: 60_000 },
      );

      await expect(runner.start()).rejects.toThrow("RETENTION_PURGE_FAILED");
      await vi.advanceTimersByTimeAsync(120_000);
      expect(purgeExpired).toHaveBeenCalledOnce();
      await runner.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("handles and reports a post-start rejection without stopping future schedules", async () => {
    vi.useFakeTimers();
    try {
      const onScheduledFailure = vi.fn();
      const purgeExpired = vi
        .fn()
        .mockResolvedValueOnce({ cases: 0, signals: 0 })
        .mockRejectedValueOnce(new Error("RETENTION_PURGE_FAILED"))
        .mockResolvedValue({ cases: 0, signals: 0 });
      const runner = new FeedbackRetentionRunner(
        { purgeExpired },
        { closedDays: 90, signalDays: 180 },
        { intervalMs: 1_000, onScheduledFailure },
      );

      await runner.start();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(onScheduledFailure).toHaveBeenCalledOnce();
      expect(purgeExpired).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(purgeExpired).toHaveBeenCalledTimes(3);
      await runner.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not overlap a slow purge across interval callbacks", async () => {
    vi.useFakeTimers();
    try {
      const slow = deferred<{ cases: number; signals: number }>();
      const purgeExpired = vi
        .fn()
        .mockResolvedValueOnce({ cases: 0, signals: 0 })
        .mockImplementationOnce(() => slow.promise)
        .mockResolvedValue({ cases: 0, signals: 0 });
      const runner = new FeedbackRetentionRunner(
        { purgeExpired },
        { closedDays: 90, signalDays: 180 },
        { intervalMs: 1_000 },
      );

      await runner.start();
      await vi.advanceTimersByTimeAsync(3_000);
      expect(purgeExpired).toHaveBeenCalledTimes(2);

      slow.resolve({ cases: 0, signals: 0 });
      await slow.promise;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(purgeExpired).toHaveBeenCalledTimes(3);
      await runner.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for in-flight purge during stop and prevents later schedules", async () => {
    vi.useFakeTimers();
    try {
      const slow = deferred<{ cases: number; signals: number }>();
      const purgeExpired = vi
        .fn()
        .mockResolvedValueOnce({ cases: 0, signals: 0 })
        .mockImplementationOnce(() => slow.promise);
      const runner = new FeedbackRetentionRunner(
        { purgeExpired },
        { closedDays: 90, signalDays: 180 },
        { intervalMs: 1_000 },
      );

      await runner.start();
      await vi.advanceTimersByTimeAsync(1_000);
      let stopped = false;
      const stopping = runner.stop().then(() => {
        stopped = true;
      });
      await Promise.resolve();
      expect(stopped).toBe(false);

      slow.resolve({ cases: 0, signals: 0 });
      await stopping;
      expect(stopped).toBe(true);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(purgeExpired).toHaveBeenCalledTimes(2);
      await runner.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds one tick by both batch count and elapsed budget", async () => {
    let elapsed = 0;
    const purgeExpired = vi.fn(async () => {
      elapsed += 3;
      return { cases: 2, signals: 0 };
    });
    const runner = new FeedbackRetentionRunner(
      { purgeExpired },
      { closedDays: 90, signalDays: 180 },
      {
        batchSize: 2,
        maxBatchesPerTick: 10,
        tickBudgetMs: 5,
        monotonicNow: () => elapsed,
      },
    );

    await expect(runner.tick()).resolves.toEqual({ cases: 4, signals: 0 });
    expect(purgeExpired).toHaveBeenCalledTimes(2);
  });
});
