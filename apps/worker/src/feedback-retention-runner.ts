import type { JobRunner } from "./lifecycle.js";

export interface FeedbackRetentionRepository {
  purgeExpired(input: {
    now: Date;
    closedRetentionDays: number;
    signalRetentionDays: number;
  }): Promise<{ cases: number; signals: number }>;
}

export interface FeedbackRetentionConfig {
  closedDays: number;
  signalDays: number;
}

export const DEFAULT_FEEDBACK_RETENTION_INTERVAL_MS = 6 * 60 * 60_000;

export class FeedbackRetentionRunner implements JobRunner {
  private timer: NodeJS.Timeout | undefined;

  public constructor(
    private readonly repository: FeedbackRetentionRepository,
    private readonly config: FeedbackRetentionConfig,
    private readonly intervalMs = DEFAULT_FEEDBACK_RETENTION_INTERVAL_MS,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async start(): Promise<void> {
    await this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<{ cases: number; signals: number }> {
    return this.repository.purgeExpired({
      now: new Date(this.now().getTime()),
      closedRetentionDays: this.config.closedDays,
      signalRetentionDays: this.config.signalDays,
    });
  }
}
