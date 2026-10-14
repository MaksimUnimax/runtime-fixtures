import { randomUUID } from "node:crypto";
import type { DeviceAuthorizationRepository } from "@product/device-auth";
import type { JobRunner } from "./lifecycle.js";
import { RunnerControl, type JobFailureEvent } from "./job-failure.js";

/** Durable PostgreSQL expiry; SKIP LOCKED in the repository makes concurrent workers safe. */
export class DeviceAuthorizationExpiryRunner implements JobRunner {
  private timer: NodeJS.Timeout | undefined;
  private readonly control = new RunnerControl("device-authorization-expiry");
  public constructor(
    private readonly repository: Pick<
      DeviceAuthorizationRepository,
      "expireDue"
    >,
    private readonly intervalMs = 30_000,
    private readonly batchSize = 100,
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
  async tick(): Promise<number> {
    return this.control.admit(() =>
      this.repository.expireDue(this.batchSize, randomUUID()),
    );
  }
}
