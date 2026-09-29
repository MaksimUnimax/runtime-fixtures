import { createDatabaseRuntime } from "../../../packages/server/db/src/index.ts";
import { preflightMonitorPilotAuthorityForTest } from "../monitor-pilot-authority.ts";
import { runMonitorPilotRetentionMaintenance } from "../monitor-pilot-retention.ts";

type Phase = "inspect" | "partial" | "continue" | "retire" | "retry";

function maintenanceTime(phase: Phase) {
  return phase === "retire" || phase === "retry"
    ? new Date("2026-10-07T18:00:00.000Z")
    : new Date("2026-09-28T18:00:00.000Z");
}

function limits(phase: Phase) {
  if (phase === "partial") {
    return {
      maxBackfill: 2,
      maxReconcile: 2,
      maxInventory: 100,
      maxPrune: 2,
      maxReceiptRetire: 0,
      maxTerminalRetire: 0,
    };
  }
  return {
    maxBackfill: 10,
    maxReconcile: 10,
    maxInventory: 100,
    maxPrune: 10,
    maxReceiptRetire: phase === "retire" || phase === "retry" ? 10 : 0,
    maxTerminalRetire: phase === "retire" || phase === "retry" ? 10 : 0,
  };
}
async function snapshot(runtime: ReturnType<typeof createDatabaseRuntime>) {
  const result = await runtime.query<Record<string, string | null>>(
    "SELECT " +
      "(SELECT count(*)::text FROM health_runs) AS runs," +
      "(SELECT count(*)::text FROM health_no_session_observations) AS observations," +
      "(SELECT count(*)::text FROM health_no_session_run_receipts) AS receipts," +
      "(SELECT count(*)::text FROM health_runs run LEFT JOIN health_no_session_run_receipts receipt ON receipt.run_id=run.id WHERE run.run_kind='NO_SESSION_OBSERVATION' AND receipt.run_id IS NULL) AS \"missingReceipts\"," +
      "(SELECT count(projection_applied_at)::text FROM health_no_session_run_receipts) AS projected," +
      '(SELECT count(incident_processed_at)::text FROM health_no_session_run_receipts) AS "incidentProcessed",' +
      "(SELECT count(*)::text FROM health_no_session_scope_states) AS scopes," +
      "(SELECT count(*)::text FROM health_no_session_recent_states) AS recent," +
      '(SELECT COALESCE(max(c),0)::text FROM (SELECT count(*) c FROM health_no_session_recent_states GROUP BY scope_sha256) grouped) AS "maxRecentPerScope",' +
      "(SELECT COALESCE(sum(repeat_count),0)::text FROM health_no_session_recent_states) AS repeats," +
      '(SELECT max(latest_observed_at)::text FROM health_no_session_scope_states) AS "latestObservedAt",' +
      "(SELECT count(*)::text FROM health_notification_intents) AS notifications," +
      "(SELECT count(*)::text FROM health_schedule_retention_watermarks) AS watermarks," +
      "(SELECT count(*)::text FROM health_scheduled_runs) AS scheduled," +
      "to_regclass('monitor_profile_repair_bindings')::text AS repair," +
      "to_regclass('api_watch_product_baselines')::text AS \"apiBaseline\"",
  );
  return result.rows[0]!;
}
async function main() {
  const phase = process.argv[2] as Phase;
  if (!["inspect", "partial", "continue", "retire", "retry"].includes(phase))
    throw new Error("MAINTENANCE_PHASE_REQUIRED");
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL_REQUIRED");
  process.env.VITEST = "true";
  const runtime = createDatabaseRuntime(connectionString);
  await runtime.ready();
  try {
    const identity = await runtime.query<{
      databaseName: string;
      databaseRole: string;
    }>(
      'SELECT current_database() AS "databaseName",current_user AS "databaseRole"',
    );
    const preflight = () =>
      preflightMonitorPilotAuthorityForTest(runtime, {
        expectedDatabaseName: identity.rows[0]!.databaseName,
        expectedDatabaseRole: identity.rows[0]!.databaseRole,
      });
    const before = await snapshot(runtime);
    const maintenanceNow = maintenanceTime(phase);
    const result = await runMonitorPilotRetentionMaintenance(
      runtime,
      {
        mode: phase === "inspect" ? "inspect" : "apply",
        limits: limits(phase),
      },
      { preflight, clock: () => maintenanceNow, nowMs: () => 0 },
    );
    const after = await snapshot(runtime);
    console.log(
      "MAINTENANCE_RESULT=" +
        JSON.stringify({
          phase,
          kind: result.kind,
          actions: result.actions,
          pendingBefore: result.pendingBefore,
          pendingAfter: result.pendingAfter,
          deadlineReached: result.deadlineReached,
          deadlineSemantics: result.deadlineSemantics,
          supervisorHardTimeoutRequired: result.supervisorHardTimeoutRequired,
          before,
          after,
        }),
    );
  } finally {
    await runtime.close();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
