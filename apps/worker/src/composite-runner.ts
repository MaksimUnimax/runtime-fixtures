import type { JobRunner } from "./lifecycle.js";
export class CompositeJobRunner implements JobRunner {
  private started: JobRunner[] = [];
  public constructor(private readonly children: readonly JobRunner[]) {}
  async start(): Promise<void> {
    try {
      for (const child of this.children) {
        // A runner may arm a timer before its asynchronous start rejects.
        // Track it before invoking start so failure unwinding also stops it.
        this.started.push(child);
        await child.start();
      }
    } catch (error) {
      try {
        await this.stop();
      } catch {
        // Report the original startup failure after attempting every cleanup.
      }
      throw error;
    }
  }
  async stop(): Promise<void> {
    const running = this.started.splice(0).reverse();
    let firstError: unknown;
    let failed = false;
    for (const child of running) {
      try {
        await child.stop();
      } catch (error) {
        if (!failed) {
          firstError = error;
          failed = true;
        }
        // Do not strand other running jobs when one cleanup fails.
      }
    }
    if (failed) throw firstError;
  }
}
