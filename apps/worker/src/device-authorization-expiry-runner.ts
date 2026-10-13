import { randomUUID } from "node:crypto";
import type { DeviceAuthorizationRepository } from "@product/device-auth";
import type { JobRunner } from "./lifecycle.js";

/** Durable PostgreSQL expiry; SKIP LOCKED in the repository makes concurrent workers safe. */
export class DeviceAuthorizationExpiryRunner implements JobRunner {
  private timer: NodeJS.Timeout | undefined;
  private readonly inFlightTicks = new Set<Promise<number>>();
  private stopping = false;
  public constructor(
    private readonly repository: DeviceAuthorizationRepository,
    private readonly intervalMs = 30_000,
    private readonly batchSize = 100,
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
  async tick(): Promise<number> {
    if (this.stopping) throw new Error("WORKER_STOPPING");
    const pending = this.repository.expireDue(this.batchSize, randomUUID());
    this.inFlightTicks.add(pending);
    try {
      return await pending;
    } finally {
      this.inFlightTicks.delete(pending);
    }
  }
}
