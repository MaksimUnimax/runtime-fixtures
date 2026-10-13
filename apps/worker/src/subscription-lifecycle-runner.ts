import { randomUUID } from "node:crypto";
import type { SubscriptionLifecycleJobRepository } from "@product/db";
import type { SubscriptionLifecycleProcessSummary } from "@product/db";
import type { JobRunner } from "./lifecycle.js";
export class SubscriptionLifecycleRunner implements JobRunner {
  private timer: NodeJS.Timeout | undefined;
  private readonly inFlightTicks = new Set<
    Promise<SubscriptionLifecycleProcessSummary>
  >();
  private stopping = false;
  constructor(
    private readonly repository: SubscriptionLifecycleJobRepository,
    private readonly intervalMs = 30_000,
    private readonly batchSize = 100,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async start(): Promise<void> {
    if (this.stopping) throw new Error("WORKER_STOPPING");
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    await this.tick();
  }
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await Promise.allSettled([...this.inFlightTicks]);
  }
  async tick(
    correlationId: string = randomUUID(),
  ): Promise<SubscriptionLifecycleProcessSummary> {
    if (this.stopping) throw new Error("WORKER_STOPPING");
    const pending = this.repository.processDue({
      now: new Date(this.now().getTime()),
      batchSize: this.batchSize,
      correlationId,
    });
    this.inFlightTicks.add(pending);
    try {
      return await pending;
    } finally {
      this.inFlightTicks.delete(pending);
    }
  }
}
