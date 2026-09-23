import {
  ADMIN_AUDIT_RETENTION_CATEGORY,
  type AuditRetentionRepository,
} from "@product/db";
import type { JobRunner } from "./lifecycle.js";

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
  private stopped = true;

  public constructor(
    private readonly repository: AuditRetentionRepository,
    private readonly intervalMs = DEFAULT_ADMIN_AUDIT_RETENTION_INTERVAL_MS,
    private readonly now: () => Date = () => new Date(),
    private readonly onError: (error: unknown) => void = (error) =>
      console.error("Administrative audit retention failed", error),
  ) {
    if (!Number.isInteger(intervalMs) || intervalMs < 1)
      throw new Error("audit retention intervalMs must be a positive integer");
  }

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

  tick(): Promise<number> {
    if (this.inFlight) return this.inFlight;
    const cutoff = new Date(
      this.now().getTime() -
        DEFAULT_ADMIN_AUDIT_RETENTION_DAYS * 24 * 60 * 60_000,
    );
    const purge = this.repository.purgeExpired({
      category: ADMIN_AUDIT_RETENTION_CATEGORY,
      cutoff,
      retentionDays: DEFAULT_ADMIN_AUDIT_RETENTION_DAYS,
      batchSize: DEFAULT_ADMIN_AUDIT_RETENTION_BATCH_SIZE,
      statementTimeoutMs: DEFAULT_ADMIN_AUDIT_RETENTION_STATEMENT_TIMEOUT_MS,
    });
    this.inFlight = purge;
    return purge.finally(() => {
      if (this.inFlight === purge) this.inFlight = undefined;
    });
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
            "Administrative audit retention error reporting failed",
            reportingError,
          );
        } catch {
          // A reporting failure must not create an unhandled rejection.
        }
      }
    } finally {
      if (!this.stopped) this.scheduleNext();
    }
  }
}
