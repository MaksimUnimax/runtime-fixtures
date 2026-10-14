import {
  createHealthNotificationRepository,
  type DatabaseRuntime,
} from "@product/db";
import {
  NotificationDeliveryError,
  type NotificationDeliveryPort,
} from "@product/health";
import type { JobRunner } from "./lifecycle.js";
import { RunnerControl, type JobFailureEvent } from "./job-failure.js";

/** Independent monitoring job; product Work execution does not depend on it. */
export class HealthNotificationRunner implements JobRunner {
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<boolean> | undefined;
  private readonly control = new RunnerControl("health-notification");
  private readonly repository: Pick<
    ReturnType<typeof createHealthNotificationRepository>,
    "claimDue" | "markDelivered" | "failClaim"
  >;

  public constructor(
    database: DatabaseRuntime,
    private readonly provider: NotificationDeliveryPort,
    private readonly intervalMs = 5_000,
    repository?: Pick<
      ReturnType<typeof createHealthNotificationRepository>,
      "claimDue" | "markDelivered" | "failClaim"
    >,
  ) {
    this.repository =
      repository ?? createHealthNotificationRepository(database);
  }

  onFailure(listener: (event: JobFailureEvent) => void | Promise<void>) {
    return this.control.failure.subscribe(listener);
  }

  async start(): Promise<void> {
    this.control.ensureOpen();
    this.timer = setInterval(() => {
      if (this.control.quiesced) return;
      void this.tick().catch((error) => {
        this.quiesce();
        this.control.scheduledFailure(error);
      });
    }, this.intervalMs);
    await this.tick();
  }

  quiesce(): void {
    this.control.quiesce(() => {
      if (this.timer) clearInterval(this.timer);
      this.timer = undefined;
    });
  }

  async stop(): Promise<void> {
    this.quiesce();
    await this.control.drain();
  }

  async tick(
    ownerId = `health-notification-worker:${process.pid}`,
  ): Promise<boolean> {
    this.control.ensureOpen();
    if (this.inFlight) return false;
    const work = this.control.admit(() => this.tickOnce(ownerId));
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
