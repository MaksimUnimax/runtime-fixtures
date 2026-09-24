import { describe, expect, it, vi } from "vitest";
import {
  createHealthNotificationRepository,
  type DatabaseRuntime,
} from "@product/db";
import type {
  NotificationDeliveryPort,
  NotificationDeliveryReceipt,
} from "@product/health";
import { HealthNotificationRunner } from "./health-notification-runner.js";

describe("HealthNotificationRunner", () => {
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
    } as unknown as ReturnType<typeof createHealthNotificationRepository>;

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
});
