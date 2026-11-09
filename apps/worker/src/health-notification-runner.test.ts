import { describe, expect, it, vi } from "vitest";
import type { DatabaseRuntime } from "@product/db";
import {
  NotificationDeliveryError,
  type NotificationDeliveryPort,
  type NotificationDeliveryReceipt,
} from "@product/health";
import { HealthNotificationRunner } from "./health-notification-runner.js";

const intent = (claimToken = "claim-1") => ({
  id: "intent-1",
  claimToken,
  dedupKey: "dedup-1",
  routeKey: "OWNER_MONITORING",
  payload: { eventKind: "INCIDENT_ESCALATED" },
});
const receipt: NotificationDeliveryReceipt = {
  providerAdapterKey: "fixture",
  providerDeliveryId: "delivery-1",
};

function deliveryFixture() {
  const repository = {
    claimDue: vi.fn().mockResolvedValue(intent()),
    markDelivered: vi.fn().mockResolvedValue(undefined),
    failClaim: vi.fn().mockResolvedValue(undefined),
  };
  const provider = { deliver: vi.fn().mockResolvedValue(receipt) };
  const runner = new HealthNotificationRunner(
    {} as DatabaseRuntime,
    provider,
    60_000,
    repository,
  );
  return { repository, provider, runner };
}

describe("HealthNotificationRunner", () => {
  it.each([
    new Error("NOTIFICATION_CLAIM_STALE"),
    new Error("ACK_PORT_FAILED"),
    new NotificationDeliveryError("RATE_LIMIT", 17_000),
  ])("propagates ACK rejection without classifying it as provider failure: %s", async (error) => {
    const { repository, provider, runner } = deliveryFixture();
    repository.markDelivered.mockRejectedValue(error);
    await expect(runner.tick("worker-a")).rejects.toBe(error);
    expect(provider.deliver).toHaveBeenCalledOnce();
    expect(repository.markDelivered).toHaveBeenCalledWith({
      id: "intent-1",
      claimToken: "claim-1",
      ...receipt,
    });
    expect(repository.failClaim).not.toHaveBeenCalled();
  });

  it.each([
    "TRANSIENT_PROVIDER_FAILURE",
    "RATE_LIMIT",
    "CONFIGURATION_ERROR",
    "PERMANENT_PROVIDER_REJECTION",
    "DISABLED_ROUTE",
  ] as const)("retains the delivery failure code %s for repository policy", async (code) => {
    const { repository, provider, runner } = deliveryFixture();
    provider.deliver.mockRejectedValue(new NotificationDeliveryError(code, 23_000));
    await expect(runner.tick("worker-a")).resolves.toBe(true);
    expect(repository.failClaim).toHaveBeenCalledExactlyOnceWith({
      id: "intent-1",
      claimToken: "claim-1",
      code,
      retryAfterMs: 23_000,
    });
    expect(repository.markDelivered).not.toHaveBeenCalled();
  });

  it("retains the untyped provider failure fallback", async () => {
    const { repository, provider, runner } = deliveryFixture();
    provider.deliver.mockRejectedValue(new Error("PROVIDER_PORT_FAILED"));
    await expect(runner.tick()).resolves.toBe(true);
    expect(repository.failClaim).toHaveBeenCalledExactlyOnceWith({
      id: "intent-1",
      claimToken: "claim-1",
      code: "TRANSIENT_PROVIDER_FAILURE",
      retryAfterMs: undefined,
    });
    expect(repository.markDelivered).not.toHaveBeenCalled();
  });

  it.each([new Error("NOTIFICATION_CLAIM_STALE"), new Error("FAIL_PORT_FAILED")])(
    "preserves failure-finalization rejection: %s",
    async (error) => {
      const { repository, provider, runner } = deliveryFixture();
      provider.deliver.mockRejectedValue(new NotificationDeliveryError("RATE_LIMIT"));
      repository.failClaim.mockRejectedValue(error);
      await expect(runner.tick()).rejects.toBe(error);
      expect(repository.failClaim).toHaveBeenCalledOnce();
      expect(repository.markDelivered).not.toHaveBeenCalled();
    },
  );

  it("passes stable intent and dedup identity with the new token on a subsequent claim", async () => {
    const { repository, provider, runner } = deliveryFixture();
    repository.claimDue
      .mockResolvedValueOnce(intent("claim-1"))
      .mockResolvedValueOnce(intent("claim-2"));
    provider.deliver.mockRejectedValueOnce(
      new NotificationDeliveryError("TRANSIENT_PROVIDER_FAILURE"),
    );
    await expect(runner.tick("worker-a")).resolves.toBe(true);
    await expect(runner.tick("worker-b")).resolves.toBe(true);
    expect(provider.deliver.mock.calls.map(([request]) => request)).toEqual([
      {
        intentId: "intent-1",
        idempotencyKey: "dedup-1",
        routeKey: "OWNER_MONITORING",
        payload: intent().payload,
      },
      {
        intentId: "intent-1",
        idempotencyKey: "dedup-1",
        routeKey: "OWNER_MONITORING",
        payload: intent().payload,
      },
    ]);
    expect(repository.failClaim).toHaveBeenCalledOnce();
    expect(repository.markDelivered).toHaveBeenCalledExactlyOnceWith({
      id: "intent-1",
      claimToken: "claim-2",
      ...receipt,
    });
  });

  it("does not fail a newer claim after a late successful delivery loses its ACK token", async () => {
    const stale = new Error("NOTIFICATION_CLAIM_STALE");
    let release!: (value: NotificationDeliveryReceipt) => void;
    const delayed = new Promise<NotificationDeliveryReceipt>((resolve) => {
      release = resolve;
    });
    let currentToken = "claim-1";
    let delivered = false;
    const repository = {
      claimDue: vi.fn().mockResolvedValueOnce(intent("claim-1")).mockImplementationOnce(async () => {
        currentToken = "claim-2";
        return intent("claim-2");
      }),
      markDelivered: vi.fn(async ({ claimToken }: { claimToken: string }) => {
        if (claimToken !== currentToken) throw stale;
        delivered = true;
      }),
      failClaim: vi.fn().mockResolvedValue(undefined),
    };
    const first = new HealthNotificationRunner(
      {} as DatabaseRuntime,
      { deliver: vi.fn(() => delayed) },
      60_000,
      repository,
    );
    const second = new HealthNotificationRunner(
      {} as DatabaseRuntime,
      { deliver: vi.fn().mockResolvedValue(receipt) },
      60_000,
      repository,
    );
    const late = first.tick("worker-a");
    const rejection = expect(late).rejects.toBe(stale);
    await expect(second.tick("worker-b")).resolves.toBe(true);
    release(receipt);
    await rejection;
    expect(delivered).toBe(true);
    expect(currentToken).toBe("claim-2");
    expect(repository.markDelivered).toHaveBeenCalledTimes(2);
    expect(repository.failClaim).not.toHaveBeenCalled();
  });

  it("propagates claim failure before any delivery", async () => {
    const { repository, provider, runner } = deliveryFixture();
    const error = new Error("CLAIM_PORT_FAILED");
    repository.claimDue.mockRejectedValue(error);
    await expect(runner.tick()).rejects.toBe(error);
    expect(provider.deliver).not.toHaveBeenCalled();
    expect(repository.markDelivered).not.toHaveBeenCalled();
    expect(repository.failClaim).not.toHaveBeenCalled();
  });

  it.each([undefined, { ...intent(), claimToken: undefined }])("does not deliver an empty or invalid claim: %s", async (claim) => {
    const { repository, provider, runner } = deliveryFixture();
    repository.claimDue.mockResolvedValue(claim);
    if (claim) await expect(runner.tick()).rejects.toThrow("NOTIFICATION_CLAIM_TOKEN_MISSING");
    else await expect(runner.tick()).resolves.toBe(false);
    expect(provider.deliver).not.toHaveBeenCalled();
    expect(repository.markDelivered).not.toHaveBeenCalled();
    expect(repository.failClaim).not.toHaveBeenCalled();
  });

  it("drains an admitted ACK while stop rejects new ticks", async () => {
    const { repository, runner } = deliveryFixture();
    let release!: () => void;
    let entered!: () => void;
    const ackEntered = new Promise<void>((resolve) => { entered = resolve; });
    repository.markDelivered.mockImplementation(() => {
      entered();
      return new Promise<void>((resolve) => { release = resolve; });
    });
    const work = runner.tick();
    await ackEntered;
    expect(repository.markDelivered).toHaveBeenCalledOnce();
    let stopped = false;
    const stop = runner.stop().then(() => { stopped = true; });
    await expect(runner.tick()).rejects.toThrow("WORKER_STOPPING");
    expect(stopped).toBe(false);
    release();
    await expect(work).resolves.toBe(true);
    await stop;
    expect(stopped).toBe(true);
    expect(repository.claimDue).toHaveBeenCalledOnce();
  });

  it("keeps at most one delivery cycle in flight per worker process", async () => {
    let release: ((receipt: NotificationDeliveryReceipt) => void) | undefined;
    const delivery = new Promise<NotificationDeliveryReceipt>((resolve) => {
      release = resolve;
    });
    const provider: NotificationDeliveryPort = {
      deliver: vi.fn(() => delivery),
    };
    const repository = {
      claimDue: vi.fn().mockResolvedValue({
        id: "intent-1",
        claimToken: "claim-1",
        dedupKey: "dedup-1",
        routeKey: "OWNER_MONITORING",
        payload: { eventKind: "INCIDENT_OPENED" },
      }),
      markDelivered: vi.fn().mockResolvedValue(undefined),
      failClaim: vi.fn().mockResolvedValue(undefined),
    };

    const runner = new HealthNotificationRunner(
      {} as DatabaseRuntime,
      provider,
      60_000,
      repository,
    );
    const first = runner.tick("worker-a");
    expect(await runner.tick("worker-b")).toBe(false);
    expect(repository.claimDue).toHaveBeenCalledTimes(1);

    release?.({
      providerAdapterKey: "fixture",
      providerDeliveryId: "delivery-1",
    });
    await expect(first).resolves.toBe(true);
    expect(repository.markDelivered).toHaveBeenCalledOnce();
    expect(repository.failClaim).not.toHaveBeenCalled();
  });

  it("quiesces terminally and rejects direct ticks without another repository call", async () => {
    const repository = {
      claimDue: vi.fn().mockResolvedValue(undefined),
      markDelivered: vi.fn().mockResolvedValue(undefined),
      failClaim: vi.fn().mockResolvedValue(undefined),
    };
    const runner = new HealthNotificationRunner(
      {} as DatabaseRuntime,
      { deliver: vi.fn() },
      60_000,
      repository,
    );
    await runner.start();
    await runner.stop();
    await expect(runner.tick()).rejects.toThrow("WORKER_STOPPING");
    expect(repository.claimDue).toHaveBeenCalledOnce();
  });
});
