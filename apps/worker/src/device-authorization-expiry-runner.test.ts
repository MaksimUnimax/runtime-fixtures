import { describe, expect, it, vi } from "vitest";
import { DeviceAuthorizationExpiryRunner } from "./device-authorization-expiry-runner.js";

describe("DeviceAuthorizationExpiryRunner", () => {
  it("T1-EXPIRY-01..03 uses the frozen defaults and injectable schedule", async () => {
    vi.useFakeTimers();
    const expireDue = vi.fn().mockResolvedValue(0);
    const runner = new DeviceAuthorizationExpiryRunner({ expireDue });
    await runner.start();
    expect(expireDue).toHaveBeenCalledWith(100, expect.any(String));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(expireDue).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(expireDue).toHaveBeenCalledTimes(2);
    await runner.stop();
    const custom = new DeviceAuthorizationExpiryRunner({ expireDue }, 7, 3);
    await custom.tick();
    expect(expireDue).toHaveBeenLastCalledWith(3, expect.any(String));
    vi.useRealTimers();
  });

  it("T1-EXPIRY-08 stops cleanly and idempotently without waiting", async () => {
    vi.useFakeTimers();
    const expireDue = vi.fn().mockResolvedValue(0);
    const runner = new DeviceAuthorizationExpiryRunner(
      { expireDue },
      30_000,
      100,
    );
    await runner.start();
    await runner.stop();
    await runner.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(expireDue).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("handles one scheduled rejection as fatal and ignores queued post-stop callbacks", async () => {
    vi.useFakeTimers();
    try {
      const failure = new Error("repository detail must remain private");
      const expireDue = vi
        .fn()
        .mockResolvedValueOnce(0)
        .mockRejectedValueOnce(failure);
      const runner = new DeviceAuthorizationExpiryRunner({ expireDue }, 10);
      const events: unknown[] = [];
      runner.onFailure((event) => {
        events.push(event);
      });
      await runner.start();
      await vi.advanceTimersByTimeAsync(10);
      expect(events).toEqual([
        {
          runner: "device-authorization-expiry",
          code: "SCHEDULED_OPERATION_FAILED",
        },
      ]);
      await vi.advanceTimersByTimeAsync(100);
      expect(expireDue).toHaveBeenCalledTimes(2);
      await expect(runner.tick()).rejects.toThrow("WORKER_STOPPING");
      await runner.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
