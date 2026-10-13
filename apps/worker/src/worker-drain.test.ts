import { describe, expect, it, vi } from "vitest";
import { startWorker } from "./lifecycle.js";
import { CompositeJobRunner } from "./composite-runner.js";
import { OtpEmailRunner } from "./otp-runner.js";
import { DeviceAuthorizationExpiryRunner } from "./device-authorization-expiry-runner.js";
import { SubscriptionLifecycleRunner } from "./subscription-lifecycle-runner.js";

const cases = [
  {
    name: "OTP (5s interval, SQL before provider)",
    interval: 5000,
    initialQueries: 2,
    reply: { rows: [] },
    create: (action: (...args: unknown[]) => Promise<unknown>) =>
      new OtpEmailRunner({ query: action } as never, {} as never, {} as never),
  },
  {
    name: "device-authorization expiry (15ms interval)",
    interval: 15,
    initialQueries: 1,
    reply: 0,
    create: (action: (...args: unknown[]) => Promise<unknown>) =>
      new DeviceAuthorizationExpiryRunner(
        { expireDue: action } as never,
        15,
        100,
      ),
  },
  {
    name: "subscription lifecycle (15ms interval)",
    interval: 15,
    initialQueries: 1,
    reply: { scanned: 0, transitioned: 0, corrupted: 0 },
    create: (action: (...args: unknown[]) => Promise<unknown>) =>
      new SubscriptionLifecycleRunner({ processDue: action } as never, 15),
  },
];

describe("B05 exact-main periodic worker DB in-flight stop drain - candidate GREEN", () => {
  it.each(cases)(
    "$name must not report stop complete while a DB tick remains pending",
    async ({ create, reply, interval, initialQueries }) => {
      vi.useFakeTimers();
      let release!: () => void;
      let count = 0;
      let stopSettled = false;
      const pending = new Promise<unknown>((resolve) => {
        release = () => resolve(reply);
      });
      const operation = vi.fn(() => {
        count += 1;
        return count <= initialQueries ? Promise.resolve(reply) : pending;
      });
      const runner = create(operation as never);
      try {
        await runner.start();
        expect(operation).toHaveBeenCalledTimes(initialQueries);
        vi.advanceTimersByTime(interval);
        await Promise.resolve();
        expect(operation).toHaveBeenCalledTimes(initialQueries + 1);
        const stopped = runner.stop().then(() => {
          stopSettled = true;
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(stopSettled).toBe(false); // pending SQL must finish before stop resolves
        const lateManual = runner.tick();
        const manualOutcome = lateManual.then(
          () => "resolved",
          (error: unknown) =>
            error instanceof Error ? error.message : "rejected",
        );
        expect(operation).toHaveBeenCalledTimes(initialQueries + 1);
        expect(await manualOutcome).toBe("WORKER_STOPPING");
        release();
        await stopped;
        expect(stopSettled).toBe(true);
        const completedQueryCount = operation.mock.calls.length;
        await expect(runner.tick()).rejects.toThrow("WORKER_STOPPING");
        expect(operation).toHaveBeenCalledTimes(completedQueryCount);
      } finally {
        release?.();
        await Promise.resolve();
        vi.useRealTimers();
      }
    },
  );
  it("startWorker closes DB after the already-running device expiry tick completes during SIGTERM", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const pending = new Promise<number>((resolve) => {
      release = () => resolve(0);
    });
    let count = 0;
    const expireDue = vi.fn(() => {
      count += 1;
      return count === 1 ? Promise.resolve(0) : pending;
    });
    const runner = new DeviceAuthorizationExpiryRunner(
      { expireDue } as never,
      15,
      100,
    );
    const database = {
      ready: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    try {
      const runtime = await startWorker(
        database as never,
        new CompositeJobRunner([runner]),
        { info: vi.fn() },
      );
      vi.advanceTimersByTime(15);
      await Promise.resolve();
      expect(expireDue).toHaveBeenCalledTimes(2);
      const shutdown = runtime.shutdown("SIGTERM");
      await Promise.resolve();
      await Promise.resolve();
      expect(database.close).not.toHaveBeenCalled();
      const lateManual = runner.tick();
      const manualOutcome = lateManual.then(
        () => "resolved",
        (error: unknown) =>
          error instanceof Error ? error.message : "rejected",
      );
      expect(expireDue).toHaveBeenCalledTimes(2);
      expect(await manualOutcome).toBe("WORKER_STOPPING");
      release();
      await shutdown;
      expect(database.close).toHaveBeenCalledOnce();
      await expect(runner.tick()).rejects.toThrow("WORKER_STOPPING");
      await vi.advanceTimersByTimeAsync(30);
      expect(expireDue).toHaveBeenCalledTimes(2);
    } finally {
      release?.();
      vi.useRealTimers();
    }
  });
});
