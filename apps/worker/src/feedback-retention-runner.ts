import type { JobRunner } from "./lifecycle.js";

export interface FeedbackRetentionRepository {
  purgeExpired(input: {
    now: Date;
    closedRetentionDays: number;
    signalRetentionDays: number;
    batchSize?: number;
    statementTimeoutMs?: number;
  }): Promise<{ cases: number; signals: number }>;
}

export interface FeedbackRetentionConfig {
  closedDays: number;
  signalDays: number;
}

export interface FeedbackRetentionRunnerOptions {
  intervalMs?: number;
  batchSize?: number;
  maxBatchesPerTick?: number;
  tickBudgetMs?: number;
  statementTimeoutMs?: number;
  now?: () => Date;
  monotonicNow?: () => number;
  onScheduledFailure?: () => void;
}

export const DEFAULT_FEEDBACK_RETENTION_INTERVAL_MS = 6 * 60 * 60_000;
export const DEFAULT_FEEDBACK_RETENTION_BATCH_SIZE = 100;
export const DEFAULT_FEEDBACK_RETENTION_MAX_BATCHES_PER_TICK = 4;
export const DEFAULT_FEEDBACK_RETENTION_TICK_BUDGET_MS = 5_000;
export const DEFAULT_FEEDBACK_RETENTION_STATEMENT_TIMEOUT_MS = 2_000;

export class FeedbackRetentionRunner implements JobRunner {
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<{ cases: number; signals: number }> | undefined;
  private stopping = false;
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly maxBatchesPerTick: number;
  private readonly tickBudgetMs: number;
  private readonly statementTimeoutMs: number;
  private readonly now: () => Date;
  private readonly monotonicNow: () => number;
  private readonly onScheduledFailure: () => void;

  public constructor(
    private readonly repository: FeedbackRetentionRepository,
    private readonly config: FeedbackRetentionConfig,
    options: FeedbackRetentionRunnerOptions = {},
  ) {
    this.intervalMs =
      options.intervalMs ?? DEFAULT_FEEDBACK_RETENTION_INTERVAL_MS;
    this.batchSize = options.batchSize ?? DEFAULT_FEEDBACK_RETENTION_BATCH_SIZE;
    this.maxBatchesPerTick =
      options.maxBatchesPerTick ??
      DEFAULT_FEEDBACK_RETENTION_MAX_BATCHES_PER_TICK;
    this.tickBudgetMs =
      options.tickBudgetMs ?? DEFAULT_FEEDBACK_RETENTION_TICK_BUDGET_MS;
    this.statementTimeoutMs =
      options.statementTimeoutMs ??
      DEFAULT_FEEDBACK_RETENTION_STATEMENT_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date());
    this.monotonicNow = options.monotonicNow ?? (() => Date.now());
    this.onScheduledFailure = options.onScheduledFailure ?? (() => undefined);
  }

  async start(): Promise<void> {
    this.stopping = false;
    await this.tick();
    if (this.stopping) return;
    this.timer = setInterval(() => this.scheduleTick(), this.intervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    const active = this.inFlight;
    if (active) {
      try {
        await active;
      } catch {
        // Scheduled failure is already reported; startup failure is preserved by start().
      }
    }
  }

  tick(): Promise<{ cases: number; signals: number }> {
    if (this.inFlight) return this.inFlight;
    const operation = this.runTick();
    this.inFlight = operation;
    const clear = () => {
      if (this.inFlight === operation) this.inFlight = undefined;
    };
    void operation.then(clear, clear);
    return operation;
  }

  private scheduleTick(): void {
    if (this.stopping || this.inFlight) return;
    void this.tick().catch(() => {
      try {
        this.onScheduledFailure();
      } catch {
        // A reporting failure must not turn handled retention failure into a crash.
      }
    });
  }

  private async runTick(): Promise<{ cases: number; signals: number }> {
    const startedAt = this.monotonicNow();
    let cases = 0;
    let signals = 0;
    for (let batch = 0; batch < this.maxBatchesPerTick; batch += 1) {
      const result = await this.repository.purgeExpired({
        now: new Date(this.now().getTime()),
        closedRetentionDays: this.config.closedDays,
        signalRetentionDays: this.config.signalDays,
        batchSize: this.batchSize,
        statementTimeoutMs: this.statementTimeoutMs,
      });
      cases += result.cases;
      signals += result.signals;
      const mayHaveMore =
        result.cases >= this.batchSize || result.signals >= this.batchSize;
      if (!mayHaveMore) break;
      if (this.monotonicNow() - startedAt >= this.tickBudgetMs) break;
    }
    return { cases, signals };
  }
}
