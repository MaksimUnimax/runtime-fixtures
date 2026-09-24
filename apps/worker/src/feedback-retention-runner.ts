import type { JobRunner } from "./lifecycle.js";

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
  private stopped = true;

  public constructor(
    private readonly repository: FeedbackRetentionRepository,
    private readonly config: FeedbackRetentionConfig,
    private readonly intervalMs = DEFAULT_FEEDBACK_RETENTION_INTERVAL_MS,
    private readonly now: () => Date = () => new Date(),
    private readonly onError: (error: unknown) => void = (error) =>
      console.error("Feedback retention purge failed", error),
  ) {}

  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    try {
      await this.tick();
    } catch (error) {
      this.stopped = true;
      throw error;
    }
    if (!this.stopped) this.scheduleNext();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.inFlight?.then(
      () => undefined,
      () => undefined,
    );
  }

  async tick(): Promise<{ cases: number; signals: number }> {
    if (this.inFlight) return this.inFlight;
    const purge = this.repository.purgeExpired({
      now: new Date(this.now().getTime()),
      closedRetentionDays: this.config.closedDays,
      signalRetentionDays: this.config.signalDays,
      batchSize: DEFAULT_FEEDBACK_RETENTION_BATCH_SIZE,
      statementTimeoutMs: DEFAULT_FEEDBACK_RETENTION_STATEMENT_TIMEOUT_MS,
    });
    this.inFlight = purge;
    try {
      return await purge;
    } finally {
      if (this.inFlight === purge) this.inFlight = undefined;
    }
  }

  private scheduleNext(): void {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.stopped) return;
      void this.runScheduledTick();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  private async runScheduledTick(): Promise<void> {
    try {
      await this.tick();
    } catch (error) {
      try {
        this.onError(error);
      } catch (reportingError) {
        try {
          console.error(
            "Feedback retention error reporting failed",
            reportingError,
          );
        } catch {
          // Keep the periodic task rejection handled even if reporting itself fails.
        }
      }
    } finally {
      if (!this.stopped) this.scheduleNext();
    }
  }
}
