import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_NO_SESSION_CADENCE,
  NoSessionObservationResultSchema,
  type NoSessionObservationResult,
} from "../../../packages/server/health/src/index.js";
import {
  createDatabaseRuntime,
  createHealthNoSessionCompletionAdapter,
  createHealthSchedulerRepository,
} from "@product/db";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";
import { executeScheduledNoSessionHealthRun } from "../../../apps/telegram-operator/src/health-runtime.js";
import {
  initializeMonitorPilotAuthorityForTest,
  preflightMonitorPilotAuthorityForTest,
} from "../../../tooling/server/monitor-pilot-authority.js";
import { runMonitorPilotRetentionMaintenance } from "../../../tooling/server/monitor-pilot-retention.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const runtime = createDatabaseRuntime(connectionString);
const scheduler = createHealthSchedulerRepository(runtime);
const completion = createHealthNoSessionCompletionAdapter(runtime);
const baseTime = new Date("2026-09-10T12:00:00.000Z");
const earlyMaintenance = new Date("2026-09-18T13:00:00.000Z");
const lateMaintenance = new Date("2026-09-28T13:00:00.000Z");
let probeCalls = 0;

const target = {
  targetKey: "nosession_chatgpt_standard",
  providerId: "chatgpt",
  surfaceId: "CHATGPT_STANDARD",
  strategyId: "chatgpt-standard-public-v1",
};

function uuid(sequence: number): string {
  return `c9000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function observation(sequence: number): NoSessionObservationResult {
  const observedAt = new Date(baseTime.valueOf() + sequence * 60_000 + 20_000);
  return NoSessionObservationResultSchema.parse({
    providerId: target.providerId,
    surfaceId: target.surfaceId,
    targetKey: target.targetKey,
    strategyId: target.strategyId,
    strategyRevision: 1,
    browserRuntime: {
      family: "chrome",
      browserName: "Chrome",
      browserVersion: "153.0.0.0",
      headless: true,
      sessionKind: "EPHEMERAL_CONTROLLED",
    },
    browserMode: {
      canonicalMode: "HEADLESS_DIAGNOSTIC",
      authoritativeMode: "HEADLESS_DIAGNOSTIC",
      diagnosticMode: null,
      fallbackAttempted: false,
      fallbackReason: "NOT_REQUIRED",
      headedInfrastructure: "NOT_CHECKED",
      environmentLimited: false,
      canonicalObservation: {
        mode: "HEADLESS_DIAGNOSTIC",
        identity: "PROVEN",
        blocker: "NONE",
        classification: "HEALTHY",
        surfaceOutcome: "PUBLIC_INTERACTIVE",
      },
      diagnosticObservation: null,
    },
    navigation: "LOADED",
    navigationEvidence: {
      requestedStartUrl: "https://chatgpt.com",
      finalUrl: "https://chatgpt.com",
      finalOrigin: "https://chatgpt.com",
      mainDocumentHttpStatus: 200,
      redirectCount: 0,
      outcome: "LOADED",
    },
    finalOrigin: "https://chatgpt.com",
    expectedOriginValid: true,
    identity: "PROVEN",
    publicSurface: "REACHABLE",
    composer: "OBSERVED",
    editableInput: "OBSERVED",
    sendControl: "OBSERVED",
    authentication: "NOT_REQUIRED",
    blocker: "NONE",
    classification: "HEALTHY",
    classificationBasis: "PUBLIC_SURFACE_PRIMARY",
    surfaceOutcome: "PUBLIC_INTERACTIVE",
    readiness: "APP_HYDRATED",
    elementMetadata: {
      composer: {
        elementCount: 1,
        visible: true,
        editable: true,
        actionable: true,
      },
      editableInput: {
        elementCount: 1,
        visible: true,
        editable: true,
        actionable: true,
      },
      sendControl: {
        elementCount: 1,
        visible: true,
        editable: false,
        actionable: true,
      },
    },
    noInteraction: true,
    observedAt: observedAt.toISOString(),
    evidence: [
      {
        evidenceId: uuid(500 + sequence),
        ruleId: "SAFE_ELEMENT_METADATA",
        classification: "METADATA",
        sha256: "a".repeat(64),
        sizeBytes: 96,
      },
    ],
  });
}

async function runHealthyObservation(sequence: number): Promise<string> {
  const scheduleId = uuid(100 + sequence);
  const dueAt = new Date(baseTime.valueOf() + sequence * 60_000);
  await scheduler.createSchedule({
    scheduleId,
    monitorTarget: target.targetKey,
    provider: target.providerId,
    surface: target.surfaceId,
    probeLayer: "NO_SESSION",
    enabled: true,
    cadence: DEFAULT_NO_SESSION_CADENCE,
    nextDueAt: dueAt,
    revision: sequence,
  });
  const due = await scheduler.materializeDueSlot(scheduleId, dueAt);
  expect(due).toBeDefined();
  const claimed = await scheduler.claimNext({
    ownerId: "monitor-retention-test",
    now: new Date(dueAt.valueOf() + 1),
    leaseMs: 300_000,
  });
  expect(claimed?.id).toBe(due?.id);
  const started = await scheduler.startRun({
    runId: due!.id,
    ownerId: claimed!.ownerId!,
    leaseId: claimed!.leaseId!,
    now: new Date(dueAt.valueOf() + 2),
  });
  const result = await executeScheduledNoSessionHealthRun(started, {
    completion,
    clock: { now: () => new Date(dueAt.valueOf() + 20_000) },
    classifierVersion: "monitor-retention-integration-v1",
    probe: async () => {
      probeCalls += 1;
      return observation(sequence);
    },
  });
  expect(result.outcome).toBe("SUCCEEDED");
  if (result.outcome !== "SUCCEEDED")
    throw new Error("MONITOR_RETENTION_TEST_EXECUTION_FAILED");
  await scheduler.finishSuccess({
    runId: started.id,
    ownerId: claimed!.ownerId!,
    leaseId: claimed!.leaseId!,
    now: new Date(dueAt.valueOf() + 20_001),
    healthRunId: result.healthRunId,
    healthState: result.healthState,
  });
  return result.healthRunId;
}

async function snapshot() {
  const result = await runtime.query<Record<string, string>>(`SELECT
    (SELECT count(*)::text FROM health_runs) AS runs,
    (SELECT count(*)::text FROM health_no_session_observations) AS observations,
    (SELECT count(*)::text FROM health_no_session_run_receipts) AS receipts,
    (SELECT count(*)::text FROM health_no_session_scope_states) AS scopes,
    (SELECT count(*)::text FROM health_no_session_recent_states) AS recent,
    (SELECT count(*)::text FROM health_incidents) AS incidents,
    (SELECT count(*)::text FROM health_notification_intents) AS notifications,
    (SELECT count(*)::text FROM health_scheduled_runs) AS scheduled,
    (SELECT count(*)::text FROM health_schedule_retention_watermarks) AS watermarks`);
  return result.rows[0]!;
}

describe.sequential("monitor pilot retention maintenance command", () => {
  let identity: { expectedDatabaseName: string; expectedDatabaseRole: string };
  let oldestRunId: string;
  const preflight = () =>
    preflightMonitorPilotAuthorityForTest(runtime, identity);

  beforeAll(async () => {
    await runtime.ready();
    const current = await runtime.query<{
      databaseName: string;
      databaseRole: string;
    }>(
      'SELECT current_database() AS "databaseName",current_user AS "databaseRole"',
    );
    identity = {
      expectedDatabaseName: current.rows[0]!.databaseName,
      expectedDatabaseRole: current.rows[0]!.databaseRole,
    };
    await runtime.query("DROP SCHEMA IF EXISTS public CASCADE");
    await runtime.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await runtime.query("CREATE SCHEMA public");
    await runMigrations({ connectionString });
    await initializeMonitorPilotAuthorityForTest(runtime, identity);
    for (let sequence = 1; sequence <= 5; sequence += 1) {
      const runId = await runHealthyObservation(sequence);
      if (sequence === 1) oldestRunId = runId;
    }
    const oldest = await runtime.query<{
      normalizedSha256: string;
    }>(
      `SELECT normalized_result_sha256 AS "normalizedSha256"
         FROM health_no_session_run_receipts
        WHERE run_id=$1`,
      [oldestRunId!],
    );
    const baseline = await runtime.query<{ scopeSha256: string }>(
      `UPDATE health_no_session_scope_states
          SET accepted_baseline_run_id=$1,
              accepted_baseline_result_sha256=$2,
              accepted_baseline_health_state='HEALTHY',
              accepted_baseline_at=$3
        RETURNING scope_sha256 AS "scopeSha256"`,
      [
        oldestRunId!,
        oldest.rows[0]!.normalizedSha256,
        new Date(baseTime.valueOf() + 90_000),
      ],
    );
    expect(baseline.rows).toHaveLength(1);
  });

  afterAll(async () => runtime.close());

  it("keeps inspect read-only and lets a cursor pass a pinned oldest row", async () => {
    const before = await snapshot();
    const firstPage = await runMonitorPilotRetentionMaintenance(
      runtime,
      {
        mode: "inspect",
        limits: { maxInventory: 1 },
      },
      {
        preflight,
        clock: () => earlyMaintenance,
        nowMs: () => 0,
      },
    );
    expect(firstPage.kind).toBe("INSPECTED");
    expect(firstPage.actions).toEqual({
      projected: 0,
      reconciled: 0,
      pruned: 0,
      receiptRetired: 0,
      terminalRetired: 0,
    });
    expect(firstPage.inventory.reasons).toEqual({
      ACCEPTED_BASELINE_PINNED: 1,
    });
    expect(firstPage.inventory.nextCursor).not.toBeNull();
    expect(await snapshot()).toEqual(before);

    const cursor = firstPage.inventory.nextCursor!;
    const secondPage = await runMonitorPilotRetentionMaintenance(
      runtime,
      {
        mode: "inspect",
        limits: { maxInventory: 1 },
        inventoryCursor: {
          completedAt: new Date(cursor.completedAt),
          runId: cursor.runId,
        },
      },
      {
        preflight,
        clock: () => earlyMaintenance,
        nowMs: () => 0,
      },
    );
    expect(secondPage.inventory.reasons).toEqual({ ELIGIBLE: 1 });
    expect(await snapshot()).toEqual(before);

    const compact = await runtime.query<{
      recent: string;
      repeats: string;
    }>(
      `SELECT count(*)::text AS recent,
              COALESCE(sum(repeat_count),0)::text AS repeats
         FROM health_no_session_recent_states`,
    );
    expect(compact.rows[0]).toEqual({ recent: "1", repeats: "5" });
    expect(probeCalls).toBe(5);
  });

  it("applies finite prune batches and reports remaining work as partial", async () => {
    const partial = await runMonitorPilotRetentionMaintenance(
      runtime,
      {
        mode: "apply",
        limits: {
          maxBackfill: 0,
          maxReconcile: 0,
          maxPrune: 2,
          maxReceiptRetire: 0,
          maxTerminalRetire: 0,
        },
      },
      {
        preflight,
        clock: () => earlyMaintenance,
        nowMs: () => 0,
      },
    );
    expect(partial.kind).toBe("PARTIAL");
    expect(partial.actions.pruned).toBe(2);
    expect(partial.inventory.reasons).toMatchObject({
      ACCEPTED_BASELINE_PINNED: 1,
      ELIGIBLE: 3,
      RECENT_STATE_PINNED: 1,
    });
    expect(probeCalls).toBe(5);

    const finish = await runMonitorPilotRetentionMaintenance(
      runtime,
      {
        mode: "apply",
        limits: {
          maxBackfill: 0,
          maxReconcile: 0,
          maxPrune: 10,
          maxReceiptRetire: 0,
          maxTerminalRetire: 0,
        },
      },
      {
        preflight,
        clock: () => earlyMaintenance,
        nowMs: () => 0,
      },
    );
    expect(finish.kind).toBe("APPLIED");
    expect(finish.actions.pruned).toBe(1);
    expect(probeCalls).toBe(5);
    const after = await snapshot();
    expect(after).toMatchObject({
      runs: "2",
      observations: "2",
      receipts: "5",
      recent: "1",
      incidents: "0",
      notifications: "0",
      scheduled: "5",
      watermarks: "0",
    });
  });

  it("retires old compact replay authority and terminal metadata through watermarks", async () => {
    const scheduleId = uuid(900);
    const dueAt = new Date("2026-09-19T12:00:00.000Z");
    await scheduler.createSchedule({
      scheduleId,
      monitorTarget: target.targetKey,
      provider: target.providerId,
      surface: target.surfaceId,
      probeLayer: "NO_SESSION",
      enabled: true,
      cadence: DEFAULT_NO_SESSION_CADENCE,
      nextDueAt: dueAt,
      revision: 900,
    });
    const terminal = await scheduler.materializeDueSlot(scheduleId, dueAt);
    expect(terminal).toBeDefined();
    await runtime.query(
      `UPDATE health_scheduled_runs
          SET state='FAILED_TERMINAL',
              finished_at=$2,
              updated_at=$2
        WHERE id=$1`,
      [terminal!.id, new Date("2026-09-19T12:10:00.000Z")],
    );

    const zeroTerminalCap = await runMonitorPilotRetentionMaintenance(
      runtime,
      {
        mode: "apply",
        limits: {
          maxBackfill: 0,
          maxReconcile: 0,
          maxPrune: 0,
          maxReceiptRetire: 10,
          maxTerminalRetire: 0,
        },
      },
      {
        preflight,
        clock: () => lateMaintenance,
        nowMs: () => 0,
      },
    );
    expect(zeroTerminalCap.kind).toBe("PARTIAL");
    expect(zeroTerminalCap.actions).toMatchObject({
      pruned: 0,
      receiptRetired: 3,
      terminalRetired: 0,
    });
    expect(zeroTerminalCap.pendingAfter?.terminal).toBe(1);
    expect(probeCalls).toBe(5);
    expect(await snapshot()).toMatchObject({
      runs: "2",
      observations: "2",
      receipts: "2",
      incidents: "0",
      notifications: "0",
      scheduled: "3",
      watermarks: "3",
    });

    const late = await runMonitorPilotRetentionMaintenance(
      runtime,
      {
        mode: "apply",
        limits: {
          maxBackfill: 0,
          maxReconcile: 0,
          maxPrune: 0,
          maxReceiptRetire: 10,
          maxTerminalRetire: 10,
        },
      },
      {
        preflight,
        clock: () => lateMaintenance,
        nowMs: () => 0,
      },
    );
    expect(late.kind).toBe("APPLIED");
    expect(late.actions).toMatchObject({
      pruned: 0,
      receiptRetired: 0,
      terminalRetired: 1,
    });
    expect(probeCalls).toBe(5);
    const after = await snapshot();
    expect(after).toMatchObject({
      runs: "2",
      observations: "2",
      receipts: "2",
      incidents: "0",
      notifications: "0",
      scheduled: "2",
      watermarks: "4",
    });

    const retry = await runMonitorPilotRetentionMaintenance(
      runtime,
      {
        mode: "apply",
        limits: {
          maxBackfill: 0,
          maxReconcile: 0,
          maxPrune: 0,
          maxReceiptRetire: 10,
          maxTerminalRetire: 10,
        },
      },
      {
        preflight,
        clock: () => lateMaintenance,
        nowMs: () => 0,
      },
    );
    expect(retry.kind).toBe("APPLIED");
    expect(retry.actions).toEqual({
      projected: 0,
      reconciled: 0,
      pruned: 0,
      receiptRetired: 0,
      terminalRetired: 0,
    });
    expect(await snapshot()).toEqual(after);
    expect(probeCalls).toBe(5);
  });
});
