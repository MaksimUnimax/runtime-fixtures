import { AsyncLocalStorage } from "node:async_hooks";
import type { MonitoringLane } from "./contracts.js";
import type { MonitoringSqlQuery, MonitoringSqlRuntime } from "./store.js";

export type MonitoringRunAuthority = {
  lane: MonitoringLane;
  runId: string;
  signal: AbortSignal;
  revoke(): void;
  assertCurrent(): Promise<void>;
  /** Synchronous admission immediately before an in-memory mutation. */
  assertCurrentSync(): void;
  /** Admission for an external effect; an already started effect cannot be undone. */
  withCurrent<T>(operation: () => Promise<T>): Promise<T>;
};

/** Capture the authority with the event, then admit EACH physical effect.
 * The callback must initiate its transport synchronously, before its first await.
 * Admission releases the database lock before awaiting that transport.
 */
export type MonitoringEffectAdmission = {
  signal: AbortSignal;
  dispatch<T>(operation: () => Promise<T>): Promise<T>;
};

const unknownEffectBrand = Symbol.for("octoport.monitoring.effect-unknown.v1");
export class MonitoringEffectOutcomeUnknownError extends Error {
  readonly [unknownEffectBrand] = true;
  constructor(options?: ErrorOptions) {
    super("MONITORING_EFFECT_OUTCOME_UNKNOWN", options);
  }
}
export function isMonitoringEffectOutcomeUnknown(error: unknown): boolean {
  return (
    error instanceof Error &&
    ((error as Error & { [unknownEffectBrand]?: boolean })[
      unknownEffectBrand
    ] === true ||
      error.message === "MONITORING_EFFECT_OUTCOME_UNKNOWN" ||
      error.message === "TELEGRAM_NOTIFICATION_OUTCOME_UNKNOWN_NO_RETRY")
  );
}

export function currentMonitoringEffectAdmission():
  | MonitoringEffectAdmission
  | undefined {
  const authority = execution.getStore();
  return (
    authority && {
      signal: authority.signal,
      dispatch: (operation) => authority.withCurrent(operation),
    }
  );
}

export async function admitMonitoringEffect<T>(
  admission: MonitoringEffectAdmission | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  if (!admission) return operation();
  if (admission.signal.aborted) throw new Error("MONITORING_RUN_CANCELLED");
  let initiated = false;
  try {
    return await admission.dispatch(() => {
      if (admission.signal.aborted) throw new Error("MONITORING_RUN_CANCELLED");
      initiated = true;
      return operation();
    });
  } catch (error) {
    // Once transport initiation begins, rejection does not prove non-delivery.
    // Keep pre-dispatch failures original; never automatically resend unknowns.
    if (initiated && !isMonitoringEffectOutcomeUnknown(error))
      throw new MonitoringEffectOutcomeUnknownError({ cause: error });
    throw error;
  }
}

// API-watch bundles this private workspace package. Use one process-local
// async context across those module copies, without any daemon or global run
// list. Each async execution still has its own isolated authority value.
const contextKey = Symbol.for("octoport.monitoring.run-authority.v1");
const shared = globalThis as typeof globalThis & { [key: symbol]: unknown };
const prior = shared[contextKey];
if (prior !== undefined && !(prior instanceof AsyncLocalStorage))
  throw new Error("MONITORING_RUN_CONTEXT_INVALID");
const execution = (prior ??
  new AsyncLocalStorage<MonitoringRunAuthority>()) as AsyncLocalStorage<MonitoringRunAuthority>;
if (prior === undefined)
  Object.defineProperty(shared, contextKey, { value: execution });

export function currentMonitoringRun(): MonitoringRunAuthority | undefined {
  return execution.getStore();
}

export function withMonitoringRun<T>(
  authority: MonitoringRunAuthority,
  operation: () => T,
): T {
  return execution.run(authority, operation);
}

export function assertMonitoringMemoryWrite(): void {
  execution.getStore()?.assertCurrentSync();
}

export async function assertMonitoringRunCurrent(): Promise<void> {
  await execution.getStore()?.assertCurrent();
}

export function withMonitoringEffect<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const authority = execution.getStore();
  return authority ? authority.withCurrent(operation) : operation();
}

function assertNotCancelled(authority: MonitoringRunAuthority): void {
  if (authority.signal.aborted) throw new Error("MONITORING_RUN_CANCELLED");
}

/** The lane lock and the write use the SAME connection and transaction. */
export async function withMonitoringSqlLease<T>(
  runtime: MonitoringSqlRuntime,
  authority: MonitoringRunAuthority,
  operation: (query: MonitoringSqlQuery) => Promise<T>,
): Promise<T> {
  assertNotCancelled(authority);
  return runtime.transaction(async (query) => {
    const validate = async () => {
      assertNotCancelled(authority);
      const result = await query.query<{
        runId: string | null;
        leaseExpiresAt: Date | null;
      }>(
        `SELECT active_run_id AS "runId",active_run_lease_expires_at AS "leaseExpiresAt"
           FROM monitoring_lane_schedules WHERE lane=$1 FOR UPDATE`,
        [authority.lane],
      );
      // Sample time only AFTER obtaining the row lock. Time sampled before
      // a lock wait can incorrectly authorize an already expired execution.
      const clock = await query.query<{ now: Date }>(
        'SELECT clock_timestamp() AS "now"',
      );
      const now = clock.rows[0]?.now;
      if (!(now instanceof Date) || !Number.isFinite(now.valueOf())) {
        authority.revoke();
        throw new Error("MONITORING_DATABASE_CLOCK_INVALID");
      }
      const row = result.rows[0];
      if (
        row?.runId !== authority.runId ||
        !(row.leaseExpiresAt instanceof Date) ||
        row.leaseExpiresAt <= now
      ) {
        authority.revoke();
        throw new Error("MONITORING_RUN_STALE_OWNER");
      }
      assertNotCancelled(authority);
    };
    await validate();
    const result = await operation(query);
    // A pending write may resume after its deadline. Roll it back in this
    // transaction, rather than accepting it after a successful earlier check.
    await validate();
    return result;
  });
}

/** Factories retain ordinary standalone behaviour; scheduled writes are fenced. */
export function fenceMonitoringSqlRuntime<T extends MonitoringSqlRuntime>(
  runtime: T,
): T {
  const scopedTransaction = <R>(
    operation: (query: MonitoringSqlQuery) => Promise<R>,
  ): Promise<R> => {
    const authority = execution.getStore();
    return authority
      ? withMonitoringSqlLease(runtime, authority, operation)
      : runtime.transaction(operation);
  };
  return {
    ...runtime,
    query: <R extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ) => {
      const authority = execution.getStore();
      return authority
        ? withMonitoringSqlLease(runtime, authority, (query) =>
            query.query<R>(text, values),
          )
        : runtime.query<R>(text, values);
    },
    transaction: scopedTransaction,
  };
}
