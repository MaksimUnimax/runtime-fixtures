import { randomUUID } from "node:crypto";
import type { SubscriptionLifecycleJobRepository } from "@product/db";
import type { SubscriptionLifecycleProcessSummary } from "@product/db";
import type { JobRunner } from "./lifecycle.js";
import { RunnerControl, type JobFailureEvent } from "./job-failure.js";
export class SubscriptionLifecycleRunner implements JobRunner {
  private timer: NodeJS.Timeout | undefined;
  private readonly control = new RunnerControl("subscription-lifecycle");
  constructor(
    private readonly repository: Pick<
      SubscriptionLifecycleJobRepository,
      "processDue"
    >,
    private readonly intervalMs = 30_000,
    private readonly batchSize = 100,
    private readonly now: () => Date = () => new Date(),
  ) {}
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
    correlationId: string = randomUUID(),
  ): Promise<SubscriptionLifecycleProcessSummary> {
    return this.control.admit(() =>
      this.repository.processDue({
        now: new Date(this.now().getTime()),
        batchSize: this.batchSize,
        correlationId,
      }),
    );
  }
}
