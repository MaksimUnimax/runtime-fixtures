import type { DatabaseRuntime } from "@product/db";
import { describe, expect, it, vi } from "vitest";
import { startWorker } from "./lifecycle.js";
import { CompositeJobRunner } from "./composite-runner.js";
import { OtpEmailRunner } from "./otp-runner.js";
import { DeviceAuthorizationExpiryRunner } from "./device-authorization-expiry-runner.js";
import { SubscriptionLifecycleRunner } from "./subscription-lifecycle-runner.js";
import { deriveAuthKeys, encryptOtpDelivery } from "@product/auth";

type DrainOperation = (...args: unknown[]) => Promise<unknown>;
type DrainRunner = {
  start(): Promise<void>;
  stop(): Promise<void>;
  tick(...args: never[]): Promise<unknown>;
};
const testAuthKeys = deriveAuthKeys(Buffer.alloc(32, 7));

const cases = [
  {
    name: "OTP (5s interval, SQL before provider)",
    interval: 5000,
    initialQueries: 2,
    reply: { rows: [] },
    create: (action: DrainOperation): DrainRunner =>
      new OtpEmailRunner(
        {
          query: async <T extends Record<string, unknown>>(
            ...args: [string, unknown[]?]
          ) => (await action(...args)) as { rows: T[] },
        },
        testAuthKeys,
        { sendLoginOtp: async () => ({}) },
      ),
  },
  {
    name: "device-authorization expiry (15ms interval)",
    interval: 15,
    initialQueries: 1,
    reply: 0,
    create: (action: DrainOperation): DrainRunner =>
      new DeviceAuthorizationExpiryRunner(
        {
          expireDue: async (batch: number, correlationId: string) =>
            (await action(batch, correlationId)) as number,
        },
        15,
        100,
      ),
  },
  {
    name: "subscription lifecycle (15ms interval)",
    interval: 15,
    initialQueries: 1,
    reply: { scanned: 0, transitioned: 0, corrupted: 0 },
    create: (action: DrainOperation): DrainRunner =>
      new SubscriptionLifecycleRunner(
        {
          processDue: async (input) =>
            (await action(input)) as {
              scanned: number;
              transitioned: number;
              corrupted: number;
            },
        },
        15,
      ),
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
      const runner = create(operation);
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

  it("keeps OTP SMTP and final SQL inside the admitted tick drain", async () => {
    vi.useFakeTimers();
    const challengeId = "11111111-1111-4111-8111-111111111111";
    const jobId = "22222222-2222-4222-8222-222222222222";
    const identity = "worker@example.test";
    const keys = deriveAuthKeys(Buffer.alloc(32, 7));
    const envelope = encryptOtpDelivery(keys, challengeId, identity, "012345");
    let releaseSend!: () => void;
    const sending = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    const job = {
      id: jobId,
      challenge_id: challengeId,
      ciphertext: envelope.ciphertext,
      nonce: envelope.nonce,
      auth_tag: envelope.authTag,
      attempt_count: 1,
      max_attempts: 3,
    };
    const database: Pick<DatabaseRuntime, "query"> = {
      async query<T extends Record<string, unknown>>(): Promise<{ rows: T[] }> {
        return { rows: [] };
      },
    };
    const query = vi
      .spyOn(database, "query")
      .mockResolvedValue({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [job] })
      .mockResolvedValueOnce({
        rows: [
          {
            normalized_identity_target: identity,
            expires_at: new Date(Date.now() + 60_000),
            consumed_at: null,
            invalidated_at: null,
          },
        ],
      });
    const provider = {
      sendLoginOtp: vi.fn(async () => {
        await sending;
        return { providerMessageId: "synthetic" };
      }),
    };
    const runner = new OtpEmailRunner(database, keys, provider);
    try {
      await runner.start();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(provider.sendLoginOtp).toHaveBeenCalledOnce();
      let stopped = false;
      const stopping = runner.stop().then(() => {
        stopped = true;
      });
      await Promise.resolve();
      expect(stopped).toBe(false);
      releaseSend();
      await stopping;
      expect(query).toHaveBeenCalledTimes(6);
      expect(query.mock.calls[5]?.[0]).toContain("SET status='SENT'");
    } finally {
      releaseSend();
      vi.useRealTimers();
    }
  });

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
    const runner = new DeviceAuthorizationExpiryRunner({ expireDue }, 15, 100);
    const database = {
      ready: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    try {
      const runtime = await startWorker(
        database,
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
