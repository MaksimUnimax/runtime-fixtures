import { pathToFileURL } from "node:url";
import {
  createDatabaseRuntime,
  createHealthRetentionRepository,
  NO_SESSION_RAW_PAYLOAD_GRACE_MS,
  NO_SESSION_REPLAY_RECEIPT_MIN_AGE_MS,
  type DatabaseRuntime,
  type RoutineNoSessionGcCursor,
} from "@product/db";
import { loadConfig } from "@product/shared";
import {
  preflightMonitorPilotAuthority,
  type MonitorPilotAuthorityIssue,
} from "./monitor-pilot-authority.js";

export const MONITOR_PILOT_RETENTION_APPLY_CONFIRM =
  "ISOLATED_MONITOR_PILOT_RETENTION" as const;
export const MONITOR_PILOT_RETENTION_DEADLINE_SEMANTICS =
  "COOPERATIVE_BETWEEN_AWAITS" as const;

export type MonitorPilotRetentionMode = "inspect" | "apply";

export type MonitorPilotRetentionLimits = Readonly<{
  maxBackfill: number;
  maxReconcile: number;
  maxInventory: number;
  maxPrune: number;
  maxReceiptRetire: number;
  maxTerminalRetire: number;
  deadlineMs: number;
}>;

type MutableMonitorPilotRetentionLimits = {
  -readonly [Key in keyof MonitorPilotRetentionLimits]: MonitorPilotRetentionLimits[Key];
};

export const DEFAULT_MONITOR_PILOT_RETENTION_LIMITS: MonitorPilotRetentionLimits =
  {
    maxBackfill: 500,
    maxReconcile: 500,
    maxInventory: 5_000,
    maxPrune: 250,
    maxReceiptRetire: 250,
    maxTerminalRetire: 250,
    deadlineMs: 30_000,
  };

type PendingCounts = Readonly<{
  projection: number;
  incident: number;
  prunedReceipts: number;
  terminal: number;
}>;

type TerminalCandidate = Readonly<{
  scheduledRunId: string;
  finishedAt: Date;
}>;

export type MonitorPilotRetentionResult = Readonly<{
  schemaVersion: "monitor_pilot_retention_maintenance_v1";
  mode: MonitorPilotRetentionMode;
  kind: "INSPECTED" | "APPLIED" | "PARTIAL" | "MISSING_AUTHORITY";
  startedAt: string;
  finishedAt: string;
  cutoffs: {
    rawPayloadBefore: string;
    replayReceiptBefore: string;
  };
  pendingBefore: PendingCounts | null;
  pendingAfter: PendingCounts | null;
  actions: {
    projected: number;
    reconciled: number;
    pruned: number;
    receiptRetired: number;
    terminalRetired: number;
  };
  inventory: {
    scanned: number;
    reasons: Readonly<Record<string, number>>;
    nextCursor: { completedAt: string; runId: string } | null;
  };
  blocked: Readonly<Record<string, number>>;
  deadlineReached: boolean;
  deadlineSemantics: typeof MONITOR_PILOT_RETENTION_DEADLINE_SEMANTICS;
  supervisorHardTimeoutRequired: true;
  authorityIssues: readonly MonitorPilotAuthorityIssue[];
}>;

type Preflight = (database: DatabaseRuntime) => Promise<
  Readonly<{
    kind: "READY" | "MISSING_AUTHORITY";
    issues: readonly MonitorPilotAuthorityIssue[];
  }>
>;

type MaintenanceDependencies = Readonly<{
  preflight: Preflight;
  clock?: () => Date;
  nowMs?: () => number;
}>;

export type MonitorPilotRetentionInput = Readonly<{
  mode: MonitorPilotRetentionMode;
  limits?: Partial<MonitorPilotRetentionLimits>;
  inventoryCursor?: RoutineNoSessionGcCursor;
}>;

const INTEGER_LIMITS: Readonly<
  Record<Exclude<keyof MonitorPilotRetentionLimits, "deadlineMs">, number>
> = {
  maxBackfill: 5_000,
  maxReconcile: 5_000,
  maxInventory: 5_000,
  maxPrune: 5_000,
  maxReceiptRetire: 5_000,
  maxTerminalRetire: 5_000,
};

function resolveLimits(
  raw: Partial<MonitorPilotRetentionLimits> | undefined,
): MonitorPilotRetentionLimits {
  const value = { ...DEFAULT_MONITOR_PILOT_RETENTION_LIMITS, ...raw };
  for (const [key, maximum] of Object.entries(INTEGER_LIMITS)) {
    const observed = value[key as keyof typeof INTEGER_LIMITS];
    const minimum = key === "maxInventory" ? 1 : 0;
    if (!Number.isInteger(observed) || observed < minimum || observed > maximum)
      throw new Error("MONITOR_PILOT_RETENTION_LIMIT_INVALID");
  }
  if (
    !Number.isInteger(value.deadlineMs) ||
    value.deadlineMs < 1_000 ||
    value.deadlineMs > 300_000
  ) {
    throw new Error("MONITOR_PILOT_RETENTION_DEADLINE_INVALID");
  }
  return value;
}

async function assertRetentionSchema(database: DatabaseRuntime): Promise<void> {
  const result = await database.query<{
    receipts: string | null;
    states: string | null;
    recent: string | null;
    watermarks: string | null;
  }>(
    `SELECT
       to_regclass('public.health_no_session_run_receipts')::text AS receipts,
       to_regclass('public.health_no_session_scope_states')::text AS states,
       to_regclass('public.health_no_session_recent_states')::text AS recent,
       to_regclass('public.health_schedule_retention_watermarks')::text AS watermarks`,
  );
  const row = result.rows[0];
  if (!row || Object.values(row).some((value) => value === null))
    throw new Error("MONITOR_PILOT_RETENTION_SCHEMA_REQUIRED");
}

async function pendingCounts(
  database: DatabaseRuntime,
): Promise<PendingCounts> {
  const result = await database.query<Record<string, string>>(`SELECT
    (SELECT count(*)::text FROM health_no_session_run_receipts
      WHERE projection_applied_at IS NULL) AS projection,
    (SELECT count(*)::text FROM health_no_session_run_receipts
      WHERE projection_applied_at IS NOT NULL
        AND incident_processed_at IS NULL
        AND payload_pruned_at IS NULL) AS incident,
    (SELECT count(*)::text FROM health_no_session_run_receipts
      WHERE payload_pruned_at IS NOT NULL) AS "prunedReceipts",
    (SELECT count(*)::text FROM health_scheduled_runs
      WHERE state IN ('FAILED_TERMINAL','CANCELLED')
        AND next_attempt_at IS NULL
        AND health_run_id IS NULL) AS terminal`);
  const row = result.rows[0];
  if (!row) throw new Error("MONITOR_PILOT_RETENTION_INSPECTION_FAILED");
  return {
    projection: Number(row.projection),
    incident: Number(row.incident),
    prunedReceipts: Number(row.prunedReceipts),
    terminal: Number(row.terminal),
  };
}

async function terminalCandidates(
  database: DatabaseRuntime,
  before: Date,
  limit: number,
): Promise<{ items: readonly TerminalCandidate[]; hasMore: boolean }> {
  const result = await database.query<TerminalCandidate>(
    `SELECT scheduled.id AS "scheduledRunId",scheduled.finished_at AS "finishedAt"
       FROM health_scheduled_runs scheduled
      WHERE scheduled.state IN ('FAILED_TERMINAL','CANCELLED')
        AND scheduled.finished_at <= $1
        AND scheduled.next_attempt_at IS NULL
        AND scheduled.health_run_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM health_runs run WHERE run.scheduled_run_id=scheduled.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM health_no_session_run_receipts receipt
          WHERE receipt.scheduled_run_id=scheduled.id
        )
      ORDER BY scheduled.finished_at,scheduled.id
      LIMIT $2`,
    [before, limit + 1],
  );
  return {
    items: result.rows.slice(0, limit),
    hasMore: result.rows.length > limit,
  };
}

const increment = (target: Record<string, number>, key: string) => {
  target[key] = (target[key] ?? 0) + 1;
};

export async function runMonitorPilotRetentionMaintenance(
  database: DatabaseRuntime,
  input: MonitorPilotRetentionInput,
  dependencies: MaintenanceDependencies,
): Promise<MonitorPilotRetentionResult> {
  const limits = resolveLimits(input.limits);
  const clock = dependencies.clock ?? (() => new Date());
  const nowMs = dependencies.nowMs ?? Date.now;
  const started = clock();
  const deadlineAt = nowMs() + limits.deadlineMs;
  const rawBefore = new Date(
    started.valueOf() - NO_SESSION_RAW_PAYLOAD_GRACE_MS,
  );
  const replayBefore = new Date(
    started.valueOf() - NO_SESSION_REPLAY_RECEIPT_MIN_AGE_MS,
  );
  const emptyActions = {
    projected: 0,
    reconciled: 0,
    pruned: 0,
    receiptRetired: 0,
    terminalRetired: 0,
  };
  const preflight = await dependencies.preflight(database);
  if (preflight.kind !== "READY") {
    const finished = clock();
    return {
      schemaVersion: "monitor_pilot_retention_maintenance_v1",
      mode: input.mode,
      kind: "MISSING_AUTHORITY",
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      cutoffs: {
        rawPayloadBefore: rawBefore.toISOString(),
        replayReceiptBefore: replayBefore.toISOString(),
      },
      pendingBefore: null,
      pendingAfter: null,
      actions: emptyActions,
      inventory: { scanned: 0, reasons: {}, nextCursor: null },
      blocked: {},
      deadlineReached: false,
      deadlineSemantics: MONITOR_PILOT_RETENTION_DEADLINE_SEMANTICS,
      supervisorHardTimeoutRequired: true,
      authorityIssues: preflight.issues,
    };
  }

  await assertRetentionSchema(database);
  const beforeCounts = await pendingCounts(database);
  const repository = createHealthRetentionRepository(database, { clock });
  const actions = { ...emptyActions };
  const blocked: Record<string, number> = {};
  const reasons: Record<string, number> = {};
  let deadlineReached = false;

  const expired = () => {
    if (nowMs() < deadlineAt) return false;
    deadlineReached = true;
    return true;
  };

  if (input.mode === "apply") {
    while (actions.projected < limits.maxBackfill && !expired()) {
      const limit = Math.min(100, limits.maxBackfill - actions.projected);
      const applied = await repository.backfillNoSessionCompactProjection({
        limit,
        projectedAt: clock(),
      });
      actions.projected += applied;
      if (applied < limit) break;
    }

    let reconcileCursor: RoutineNoSessionGcCursor | undefined;
    while (actions.reconciled < limits.maxReconcile && !expired()) {
      const limit = Math.min(100, limits.maxReconcile - actions.reconciled);
      const result =
        await repository.reconcileLegacyNoSessionIncidentProcessing({
          limit,
          cursor: reconcileCursor,
          processedAt: clock(),
        });
      actions.reconciled += result.processed;
      reconcileCursor = result.cursor ?? undefined;
      if (result.processed < limit) break;
    }
  }

  let cursor = input.inventoryCursor;
  let scanned = 0;
  let inventoryHasMore = false;
  let pruneCandidates = 0;
  let receiptRetireCandidates = 0;
  while (scanned < limits.maxInventory && !expired()) {
    const remaining = limits.maxInventory - scanned;
    const pageLimit = Math.min(500, remaining);
    const page = await repository.listRoutineNoSessionGcInventory({
      before: rawBefore,
      cursor,
      limit: pageLimit,
    });
    if (page.length === 0) {
      cursor = undefined;
      break;
    }

    for (const item of page) {
      scanned += 1;
      increment(reasons, item.reason);
      if (input.mode !== "apply" || expired()) continue;

      if (item.reason === "ELIGIBLE") {
        pruneCandidates += 1;
      }
      const receiptRetireEligible =
        item.reason === "ALREADY_PRUNED" &&
        item.payloadPrunedAt !== null &&
        item.completedAt <= replayBefore &&
        item.payloadPrunedAt <= replayBefore;
      if (receiptRetireEligible) receiptRetireCandidates += 1;
      if (item.reason === "ELIGIBLE" && actions.pruned < limits.maxPrune) {
        const result = await repository.pruneRoutineNoSessionPayload({
          runId: item.runId,
          before: rawBefore,
        });
        if (result.status === "PRUNED") actions.pruned += 1;
        else increment(blocked, `prune:${result.reason}`);
      } else if (
        receiptRetireEligible &&
        actions.receiptRetired < limits.maxReceiptRetire
      ) {
        const result = await repository.retireRoutineNoSessionReceipt({
          runId: item.runId,
          before: replayBefore,
        });
        if (result.status === "RETIRED") actions.receiptRetired += 1;
        else increment(blocked, `receipt:${result.reason}`);
      }
    }

    const last = page.at(-1)!;
    cursor = { completedAt: last.completedAt, runId: last.runId };
    if (page.length < pageLimit) {
      cursor = undefined;
      break;
    }
    if (scanned >= limits.maxInventory) inventoryHasMore = true;
  }

  let terminalHasMore = false;
  if (input.mode === "apply" && !expired()) {
    const terminal = await terminalCandidates(
      database,
      replayBefore,
      limits.maxTerminalRetire,
    );
    terminalHasMore = terminal.hasMore;
    for (const item of terminal.items) {
      if (expired()) break;
      const result = await repository.retireTerminalScheduledRun({
        scheduledRunId: item.scheduledRunId,
        before: replayBefore,
      });
      if (result.status === "RETIRED") actions.terminalRetired += 1;
      else increment(blocked, `terminal:${result.reason}`);
    }
  }

  const afterCounts =
    input.mode === "apply" ? await pendingCounts(database) : beforeCounts;
  const cappedBacklog =
    input.mode === "apply" &&
    ((actions.projected >= limits.maxBackfill && afterCounts.projection > 0) ||
      (actions.reconciled >= limits.maxReconcile && afterCounts.incident > 0) ||
      pruneCandidates > actions.pruned ||
      receiptRetireCandidates > actions.receiptRetired ||
      Object.keys(blocked).length > 0 ||
      inventoryHasMore ||
      terminalHasMore);
  const kind =
    input.mode === "inspect"
      ? "INSPECTED"
      : deadlineReached || cappedBacklog
        ? "PARTIAL"
        : "APPLIED";
  const finished = clock();
  return {
    schemaVersion: "monitor_pilot_retention_maintenance_v1",
    mode: input.mode,
    kind,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    cutoffs: {
      rawPayloadBefore: rawBefore.toISOString(),
      replayReceiptBefore: replayBefore.toISOString(),
    },
    pendingBefore: beforeCounts,
    pendingAfter: afterCounts,
    actions,
    inventory: {
      scanned,
      reasons,
      nextCursor: cursor
        ? {
            completedAt: cursor.completedAt.toISOString(),
            runId: cursor.runId,
          }
        : null,
    },
    blocked,
    deadlineReached,
    deadlineSemantics: MONITOR_PILOT_RETENTION_DEADLINE_SEMANTICS,
    supervisorHardTimeoutRequired: true,
    authorityIssues: [],
  };
}

function parseIntegerFlag(
  flags: Map<string, string>,
  name: string,
): number | undefined {
  const raw = flags.get(name);
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw))
    throw new Error("MONITOR_PILOT_RETENTION_FLAG_INVALID");
  return Number(raw);
}

export function parseMonitorPilotRetentionArgs(argv: readonly string[]): {
  mode: MonitorPilotRetentionMode;
  confirm: boolean;
  input: MonitorPilotRetentionInput;
} {
  const operation = argv[0];
  if (operation !== "inspect" && operation !== "apply")
    throw new Error("MONITOR_PILOT_RETENTION_COMMAND_REQUIRED");
  const flags = new Map<string, string>();
  for (const arg of argv.slice(1)) {
    const match = /^--([a-z0-9-]+)=(.*)$/.exec(arg);
    if (!match) throw new Error("MONITOR_PILOT_RETENTION_FLAG_INVALID");
    if (flags.has(match[1]!))
      throw new Error("MONITOR_PILOT_RETENTION_FLAG_DUPLICATE");
    flags.set(match[1]!, match[2]!);
  }
  const known = new Set([
    "confirm",
    "max-backfill",
    "max-reconcile",
    "max-inventory",
    "max-prune",
    "max-receipt-retire",
    "max-terminal-retire",
    "deadline-ms",
    "cursor-completed-at",
    "cursor-run-id",
  ]);
  if ([...flags.keys()].some((key) => !known.has(key)))
    throw new Error("MONITOR_PILOT_RETENTION_FLAG_INVALID");

  const cursorAt = flags.get("cursor-completed-at");
  const cursorRunId = flags.get("cursor-run-id");
  if ((cursorAt === undefined) !== (cursorRunId === undefined))
    throw new Error("MONITOR_PILOT_RETENTION_CURSOR_INVALID");
  let inventoryCursor: RoutineNoSessionGcCursor | undefined;
  if (cursorAt && cursorRunId) {
    const completedAt = new Date(cursorAt);
    if (
      !Number.isFinite(completedAt.valueOf()) ||
      !/^[0-9a-f-]{36}$/i.test(cursorRunId)
    )
      throw new Error("MONITOR_PILOT_RETENTION_CURSOR_INVALID");
    inventoryCursor = { completedAt, runId: cursorRunId };
  }

  const limits: Partial<MutableMonitorPilotRetentionLimits> = {};
  const limitFlags: readonly [string, keyof MonitorPilotRetentionLimits][] = [
    ["max-backfill", "maxBackfill"],
    ["max-reconcile", "maxReconcile"],
    ["max-inventory", "maxInventory"],
    ["max-prune", "maxPrune"],
    ["max-receipt-retire", "maxReceiptRetire"],
    ["max-terminal-retire", "maxTerminalRetire"],
    ["deadline-ms", "deadlineMs"],
  ];
  for (const [flag, key] of limitFlags) {
    const value = parseIntegerFlag(flags, flag);
    if (value !== undefined) limits[key] = value;
  }
  resolveLimits(limits);

  return {
    mode: operation,
    confirm:
      operation === "inspect" ||
      flags.get("confirm") === MONITOR_PILOT_RETENTION_APPLY_CONFIRM,
    input: { mode: operation, limits, inventoryCursor },
  };
}

export function reportMonitorPilotRetentionResult(
  result: MonitorPilotRetentionResult,
  writeLine: (line: string) => void = console.log,
): number {
  writeLine(`MONITOR_PILOT_RETENTION_RESULT=${JSON.stringify(result)}`);
  if (result.kind === "MISSING_AUTHORITY") return 2;
  if (result.kind === "PARTIAL") return 3;
  return 0;
}

export async function main(): Promise<void> {
  const parsed = parseMonitorPilotRetentionArgs(process.argv.slice(2));
  if (!parsed.confirm)
    throw new Error("MONITOR_PILOT_RETENTION_APPLY_CONFIRM_REQUIRED");
  const expectedDatabaseRole = process.env.MONITOR_PILOT_EXPECTED_ROLE;
  if (!expectedDatabaseRole)
    throw new Error("MONITOR_PILOT_EXPECTED_DATABASE_ROLE_REQUIRED");
  const config = loadConfig(process.env);
  const database = createDatabaseRuntime(config.databaseUrl);
  try {
    await database.ready();
    const result = await runMonitorPilotRetentionMaintenance(
      database,
      parsed.input,
      {
        preflight: (candidate) =>
          preflightMonitorPilotAuthority(candidate, { expectedDatabaseRole }),
      },
    );
    process.exitCode = reportMonitorPilotRetentionResult(result);
  } finally {
    await database.close();
  }
}

export function isMonitorPilotRetentionCliEntry(
  argv1: string | undefined,
  moduleUrl: string,
): boolean {
  if (!argv1) return false;
  const normalized = argv1.replaceAll("\\", "/");
  if (!/(?:^|\/)monitor-pilot-retention\.(?:[cm]?[jt]s)$/.test(normalized))
    return false;
  return moduleUrl === pathToFileURL(argv1).href;
}

if (isMonitorPilotRetentionCliEntry(process.argv[1], import.meta.url))
  void main().catch((error: unknown) => {
    const code =
      error instanceof Error &&
      /^(?:MONITOR_PILOT|HEALTH_RETENTION)_[A-Z_]+$/.test(error.message)
        ? error.message
        : "MONITOR_PILOT_RETENTION_OPERATION_FAILED";
    console.error(code);
    process.exitCode = 1;
  });
