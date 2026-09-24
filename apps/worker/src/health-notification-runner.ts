import {
  createHealthNotificationRepository,
  type DatabaseRuntime,
} from "@product/db";
import {
  NotificationDeliveryError,
  type NotificationDeliveryPort,
} from "@product/health";
import type { JobRunner } from "./lifecycle.js";

/** Independent monitoring job; product Work execution does not depend on it. */
export class HealthNotificationRunner implements JobRunner {
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<boolean> | undefined;
  private readonly repository: ReturnType<
    typeof createHealthNotificationRepository
  >;

  public constructor(
    database: DatabaseRuntime,
    private readonly provider: NotificationDeliveryPort,
    private readonly intervalMs = 5_000,
    repository?: ReturnType<typeof createHealthNotificationRepository>,
  ) {
    this.repository =
      repository ?? createHealthNotificationRepository(database);
  }

  async start(): Promise<void> {
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    await this.tick();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.inFlight) await this.inFlight;
  }

  async tick(
    ownerId = `health-notification-worker:${process.pid}`,
  ): Promise<boolean> {
    if (this.inFlight) return false;
    const work = this.tickOnce(ownerId);
    this.inFlight = work;
    try {
      return await work;
    } finally {
      if (this.inFlight === work) this.inFlight = undefined;
    }
  }

  private async tickOnce(ownerId: string): Promise<boolean> {
    const intent = await this.repository.claimDue({ ownerId });
    if (!intent) return false;
    if (!intent.claimToken) throw new Error("NOTIFICATION_CLAIM_TOKEN_MISSING");
    try {
      const receipt = await this.provider.deliver({
        intentId: intent.id,
        idempotencyKey: intent.dedupKey,
        routeKey: intent.routeKey,
        payload: intent.payload,
      });
      await this.repository.markDelivered({
        id: intent.id,
        claimToken: intent.claimToken,
        providerAdapterKey: receipt.providerAdapterKey,
        providerDeliveryId: receipt.providerDeliveryId,
      });
    } catch (error) {
      const deliveryError =
        error instanceof NotificationDeliveryError ? error : undefined;
      await this.repository.failClaim({
        id: intent.id,
        claimToken: intent.claimToken,
        code: deliveryError?.code ?? "TRANSIENT_PROVIDER_FAILURE",
        retryAfterMs: deliveryError?.retryAfterMs,
      });
    }
    return true;
  }
}
