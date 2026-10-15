import { randomUUID } from "node:crypto";
import type {
  BillingReconciliationRepository,
  BillingPaymentStatusPort,
} from "@product/billing";
import { createBillingReconciliationService as makeService } from "@product/billing";
import type { JobRunner } from "./lifecycle.js";
import { RunnerControl, type JobFailureEvent } from "./job-failure.js";

export type BillingReconciliationRunnerOptions = {
  repository: BillingReconciliationRepository;
  statusPort: BillingPaymentStatusPort;
  intervalMs?: number;
  batchSize?: number;
  leaseMs?: number;
  retryDelayMs?: number;
  now?: () => Date;
};
export class BillingReconciliationRunner implements JobRunner {
  private timer: NodeJS.Timeout | undefined;
  private readonly service: ReturnType<typeof makeService>;
  private readonly control = new RunnerControl("billing-reconciliation");
  constructor(private readonly options: BillingReconciliationRunnerOptions) {
    this.service = makeService({
      repository: options.repository,
      statusPort: options.statusPort,
      now: options.now,
      retryDelayMs: options.retryDelayMs,
    });
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
    }, this.options.intervalMs ?? 30_000);
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
    correlationId: string = randomUUID(),
  ): Promise<{ claimed: number; completed: number }> {
    return this.control.admit(async () => {
      const claims = await this.options.repository.claimDue({
        now: new Date((this.options.now ?? (() => new Date()))().getTime()),
        leaseMs: this.options.leaseMs ?? 30_000,
        batchSize: this.options.batchSize ?? 100,
      });
      const settled = await Promise.allSettled(
        claims.map((claim) => this.service.processClaim(claim, correlationId)),
      );
      const failed = settled.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      return { claimed: claims.length, completed: settled.length };
    });
  }
}
