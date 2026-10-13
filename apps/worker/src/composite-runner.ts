import type { JobRunner } from "./lifecycle.js";
import {
  JobFailureSignal,
  TerminalAdmissionDenied,
  jobFailureCause,
  type JobFailureEvent,
} from "./job-failure.js";

type Attempt = { child: JobRunner; startBarrier: Promise<void> };

export class CompositeJobRunner implements JobRunner {
  private readonly attempts: Attempt[] = [];
  private readonly failure = new JobFailureSignal("composite");
  private terminal = false;
  private stopPromise: Promise<void> | undefined;
  private firstChildCause: unknown;
  private hasChildFailure = false;
  private firstStopCause: unknown;
  private hasStopFailure = false;
  private firstQuiesceCause: unknown;
  private hasQuiesceFailure = false;

  public constructor(private readonly children: readonly JobRunner[]) {}

  public onFailure(
    listener: (event: JobFailureEvent) => void | Promise<void>,
  ): () => void {
    return this.failure.subscribe(listener);
  }

  public quiesce(): void {
    if (this.terminal) return;
    this.terminal = true;
    for (const { child } of this.attempts) {
      try {
        child.quiesce();
      } catch (cause) {
        if (!this.hasQuiesceFailure) {
          this.hasQuiesceFailure = true;
          this.firstQuiesceCause = cause;
        }
      }
    }
  }

  public async start(): Promise<void> {
    if (this.terminal) throw new TerminalAdmissionDenied();
    try {
      for (const child of this.children) {
        if (this.terminal || this.failure.failed) break;
        const attempt: Attempt = {
          child,
          startBarrier: Promise.resolve().then(() => {
            if (this.terminal || this.failure.failed) return;
            return child.start();
          }),
        };
        this.attempts.push(attempt);
        child.onFailure((event) => {
          const cause = jobFailureCause(event);
          if (!this.hasChildFailure) {
            this.hasChildFailure = true;
            this.firstChildCause = cause;
          }
          this.failure.forward(event);
          this.quiesce();
        });
        await attempt.startBarrier;
        if (this.terminal || this.failure.failed) break;
      }
      if (this.failure.failed)
        throw this.hasChildFailure ? this.firstChildCause : undefined;
    } catch (cause) {
      // Latch startup failure before cleanup can report a different failure.
      this.failure.emit("STARTUP_FAILED", cause);
      this.quiesce();
      try {
        await this.stop();
      } catch {
        /* preserve raw startup cause */
      }
      throw cause;
    }
  }

  public stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    let resolveStop!: () => void;
    let rejectStop!: (cause: unknown) => void;
    this.stopPromise = new Promise<void>((resolve, reject) => {
      resolveStop = resolve;
      rejectStop = reject;
    });
    this.quiesce();
    void (async () => {
      await Promise.allSettled(
        this.attempts.map((attempt) => attempt.startBarrier),
      );
      let failed = false;
      for (const { child } of [...this.attempts].reverse()) {
        try {
          await child.stop();
        } catch (cause) {
          if (!this.hasStopFailure) {
            this.hasStopFailure = true;
            this.firstStopCause = this.hasQuiesceFailure
              ? this.firstQuiesceCause
              : cause;
          }
          failed = true;
        }
      }
      if (failed) {
        this.failure.emit("SHUTDOWN_FAILED", this.firstStopCause);
        throw new Error("WORKER_DRAIN_UNPROVEN", {
          cause: this.firstStopCause,
        });
      }
    })().then(resolveStop, rejectStop);
    return this.stopPromise;
  }
}
