import {
  ADMIN_AUDIT_RETENTION_CATEGORY,
  type AuditRetentionRepository,
} from "@product/db";
import type { JobRunner } from "./lifecycle.js";
import {
  JobFailureSignal,
  TerminalAdmissionDenied,
  type JobFailureEvent,
} from "./job-failure.js";

export const ADMIN_AUDIT_RETENTION_ENABLE_ENV =
  "OCTOPORT_ADMIN_AUDIT_RETENTION_ENABLED";
export const DEFAULT_ADMIN_AUDIT_RETENTION_DAYS = 90;
export const DEFAULT_ADMIN_AUDIT_RETENTION_INTERVAL_MS = 6 * 60 * 60_000;

export function adminAuditRetentionEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[ADMIN_AUDIT_RETENTION_ENABLE_ENV] === "true";
}
export const DEFAULT_ADMIN_AUDIT_RETENTION_BATCH_SIZE = 500;
export const DEFAULT_ADMIN_AUDIT_RETENTION_STATEMENT_TIMEOUT_MS = 5_000;

export class AuditRetentionRunner implements JobRunner {
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<number> | undefined;
  private terminal = false;
  private running = false;
  private readonly failure = new JobFailureSignal("audit-retention");

  public constructor(
    private readonly repository: Pick<AuditRetentionRepository, "purgeExpired">,
    private readonly intervalMs = DEFAULT_ADMIN_AUDIT_RETENTION_INTERVAL_MS,
    private readonly now: () => Date = () => new Date(),
    private readonly onError: (error: unknown) => void | Promise<void> = () =>
      console.error("Administrative audit retention failed"),
  ) {
    if (!Number.isInteger(intervalMs) || intervalMs < 1)
      throw new Error("audit retention intervalMs must be a positive integer");
  }

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

  tick(): Promise<number> {
    if (this.terminal) return Promise.reject(new TerminalAdmissionDenied());
    if (this.inFlight) return this.inFlight;
    let resolve!: (value: number) => void;
    let reject!: (cause: unknown) => void;
    const purge = new Promise<number>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.inFlight = purge;
    void purge
      .finally(() => {
        if (this.inFlight === purge) this.inFlight = undefined;
      })
      .catch(() => undefined);
    const cutoff = new Date(
      this.now().getTime() -
        DEFAULT_ADMIN_AUDIT_RETENTION_DAYS * 24 * 60 * 60_000,
    );
    try {
      Promise.resolve(
        this.repository.purgeExpired({
          category: ADMIN_AUDIT_RETENTION_CATEGORY,
          cutoff,
          retentionDays: DEFAULT_ADMIN_AUDIT_RETENTION_DAYS,
          batchSize: DEFAULT_ADMIN_AUDIT_RETENTION_BATCH_SIZE,
          statementTimeoutMs:
            DEFAULT_ADMIN_AUDIT_RETENTION_STATEMENT_TIMEOUT_MS,
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
    // Reporting failure is deliberately isolated from retention scheduling.
  }
}
