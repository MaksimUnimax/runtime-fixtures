import { describe, expect, it, vi } from "vitest";
import {
  ADMIN_AUDIT_RETENTION_ENABLE_ENV,
  AuditRetentionRunner,
  adminAuditRetentionEnabled,
} from "./audit-retention-runner.js";

describe("AuditRetentionRunner", () => {
  it("keeps live audit cleanup disabled unless explicitly enabled", () => {
    expect(adminAuditRetentionEnabled({})).toBe(false);
    expect(
      adminAuditRetentionEnabled({
        [ADMIN_AUDIT_RETENTION_ENABLE_ENV]: "false",
      }),
    ).toBe(false);
    expect(
      adminAuditRetentionEnabled({
        [ADMIN_AUDIT_RETENTION_ENABLE_ENV]: "TRUE",
      }),
    ).toBe(false);
    expect(
      adminAuditRetentionEnabled({
        [ADMIN_AUDIT_RETENTION_ENABLE_ENV]: "true",
      }),
    ).toBe(true);
  });

  it("uses the fixed 90-day window and one bounded batch per tick", async () => {
    const purgeExpired = vi.fn(async () => 500);
    const runner = new AuditRetentionRunner(
      { purgeExpired } as never,
      60_000,
      () => new Date("2026-09-23T08:00:00.000Z"),
    );
    await expect(runner.tick()).resolves.toBe(500);
    expect(purgeExpired).toHaveBeenCalledWith({
      category: "ADMIN_AI_REGISTRY",
      cutoff: new Date("2026-06-25T08:00:00.000Z"),
      retentionDays: 90,
      batchSize: 500,
      statementTimeoutMs: 5_000,
    });
  });

  it("rejects startup on the initial purge failure without scheduling", async () => {
    vi.useFakeTimers();
    try {
      const purgeExpired = vi.fn(async () => {
        throw new Error("initial retention failure");
      });
      const runner = new AuditRetentionRunner({ purgeExpired } as never, 100);
      await expect(runner.start()).rejects.toThrow("initial retention failure");
      await vi.advanceTimersByTimeAsync(1_000);
      expect(purgeExpired).toHaveBeenCalledOnce();
      await runner.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("handles periodic rejection and waits the full interval before retry", async () => {
    vi.useFakeTimers();
    try {
      const onError = vi.fn();
      const purgeExpired = vi
        .fn<() => Promise<number>>()
        .mockResolvedValueOnce(0)
        .mockRejectedValueOnce(new Error("periodic failure"))
        .mockResolvedValueOnce(0);
      const runner = new AuditRetentionRunner(
        { purgeExpired } as never,
        1_000,
        undefined,
        onError,
      );
      await runner.start();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(purgeExpired).toHaveBeenCalledTimes(2);
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "periodic failure" }),
      );
      await vi.advanceTimersByTimeAsync(999);
      expect(purgeExpired).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(purgeExpired).toHaveBeenCalledTimes(3);
      await runner.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("coalesces concurrent ticks and stop waits for in-flight work", async () => {
    let resolveSlow!: (value: number) => void;
    let active = 0;
    let maxActive = 0;
    const purgeExpired = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(active, maxActive);
      try {
        return await new Promise<number>((resolve) => {
          resolveSlow = resolve;
        });
      } finally {
        active -= 1;
      }
    });
    const runner = new AuditRetentionRunner({ purgeExpired } as never);
    const first = runner.tick();
    const second = runner.tick();
    expect(purgeExpired).toHaveBeenCalledOnce();
    expect(maxActive).toBe(1);

    let stopped = false;
    const stopping = runner.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    resolveSlow(7);
    await expect(first).resolves.toBe(7);
    await expect(second).resolves.toBe(7);
    await stopping;
    expect(stopped).toBe(true);
    expect(active).toBe(0);
  });

  it("runs one batch per scheduled pass and leaves excess for a later pass", async () => {
    vi.useFakeTimers();
    try {
      const purgeExpired = vi.fn(async () => 500);
      const runner = new AuditRetentionRunner({ purgeExpired } as never, 1_000);
      await runner.start();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(purgeExpired).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(purgeExpired).toHaveBeenCalledTimes(3);
      await runner.stop();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(purgeExpired).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
