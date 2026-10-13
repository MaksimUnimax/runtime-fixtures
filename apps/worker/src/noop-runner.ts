import type { JobRunner } from "./lifecycle.js";
import { RunnerControl, type JobFailureListener } from "./job-failure.js";

export class NoopJobRunner implements JobRunner {
  private readonly control = new RunnerControl("worker");
  quiesce(): void {
    this.control.quiesce();
  }
  async start(): Promise<void> {
    this.control.ensureOpen();
  }
  async stop(): Promise<void> {
    this.quiesce();
  }
  onFailure(listener: JobFailureListener): () => void {
    return this.control.failure.subscribe(listener);
  }
}
