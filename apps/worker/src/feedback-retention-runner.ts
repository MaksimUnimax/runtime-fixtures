import type { JobRunner } from "./lifecycle.js";
import {
  JobFailureSignal,
  TerminalAdmissionDenied,
  type JobFailureEvent,
} from "./job-failure.js";

export interface FeedbackRetentionRepository {
  purgeExpired(input: {
    now: Date;
    closedRetentionDays: number;
    signalRetentionDays: number;
    batchSize: number;
    statementTimeoutMs: number;
  }): Promise<{ cases: number; signals: number }>;
}

export interface FeedbackRetentionConfig {
  closedDays: number;
  signalDays: number;
}

export const DEFAULT_FEEDBACK_RETENTION_INTERVAL_MS = 6 * 60 * 60_000;
export const DEFAULT_FEEDBACK_RETENTION_BATCH_SIZE = 500;
export const DEFAULT_FEEDBACK_RETENTION_STATEMENT_TIMEOUT_MS = 5_000;

export class FeedbackRetentionRunner implements JobRunner {
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<{ cases: number; signals: number }> | undefined;
  private terminal = false;
  private running = false;
  private readonly failure = new JobFailureSignal("feedback-retention");

  public constructor(
    private readonly repository: FeedbackRetentionRepository,
    private readonly config: FeedbackRetentionConfig,
    private readonly intervalMs = DEFAULT_FEEDBACK_RETENTION_INTERVAL_MS,
    private readonly now: () => Date = () => new Date(),
    private readonly onError: (error: unknown) => void | Promise<void> = () =>
      console.error("Feedback retention purge failed"),
  ) {}

  onFailure(listener: (event: JobFailureEvent) => void | Promise<void>) {
    return this.failure.subscribe(listener);
  }

  async start(): Promise<void> {
    if (this.terminal) throw new TerminalAdmissionDenied();
    if (this.running) return;
    this.running = true;
    try {
      await this.tick();
    } catch (error) {
      this.running = false;
      throw error;
    }
    if (!this.terminal) this.scheduleNext();
  }

  quiesce(): void {
    if (this.terminal) return;
    this.terminal = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  async stop(): Promise<void> {
    this.quiesce();
    await this.inFlight?.then(
      () => undefined,
      () => undefined,
    );
  }

  tick(): Promise<{ cases: number; signals: number }> {
    if (this.terminal) return Promise.reject(new TerminalAdmissionDenied());
    if (this.inFlight) return this.inFlight;
    let resolve!: (value: { cases: number; signals: number }) => void;
    let reject!: (cause: unknown) => void;
    const purge = new Promise<{ cases: number; signals: number }>(
      (res, rej) => {
        resolve = res;
        reject = rej;
      },
    );
    this.inFlight = purge;
    void purge
      .finally(() => {
        if (this.inFlight === purge) this.inFlight = undefined;
      })
      .catch(() => undefined);
    try {
      Promise.resolve(
        this.repository.purgeExpired({
          now: new Date(this.now().getTime()),
          closedRetentionDays: this.config.closedDays,
          signalRetentionDays: this.config.signalDays,
          batchSize: DEFAULT_FEEDBACK_RETENTION_BATCH_SIZE,
          statementTimeoutMs: DEFAULT_FEEDBACK_RETENTION_STATEMENT_TIMEOUT_MS,
        }),
      ).then(resolve, reject);
    } catch (cause) {
      reject(cause);
    }
    return purge;
  }

  private scheduleNext(): void {
    if (this.terminal) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.terminal) return;
      void this.runScheduledTick();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  private async runScheduledTick(): Promise<void> {
    try {
      await this.tick();
    } catch (error) {
      safelyReport(this.onError, error);
    } finally {
      if (!this.terminal) this.scheduleNext();
    }
  }
}

function safelyReport(
  sink: (error: unknown) => void | Promise<void>,
  error: unknown,
): void {
  try {
    const result = sink(error);
    if (result && typeof (result as Promise<unknown>).then === "function")
      void Promise.resolve(result).catch(() => undefined);
  } catch {
    // Error reporting is best-effort and never emits raw reporting failures.
  }
}
