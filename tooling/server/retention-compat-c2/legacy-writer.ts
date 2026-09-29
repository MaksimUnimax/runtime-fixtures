import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const LEGACY_WRITER_SOURCE_SHA =
  "c2e715501161d421b1641bb697c7ee7786d84960";

type HealthModule =
  typeof import("../../../packages/server/health/src/index.ts");
type DbModule = typeof import("../../../packages/server/db/src/index.ts");

let DEFAULT_NO_SESSION_CADENCE: HealthModule["DEFAULT_NO_SESSION_CADENCE"];
let NoSessionObservationResultSchema: HealthModule["NoSessionObservationResultSchema"];
let createDatabaseRuntime: DbModule["createDatabaseRuntime"];
let createHealthNoSessionCompletionAdapter: DbModule["createHealthNoSessionCompletionAdapter"];
let createHealthSchedulerRepository: DbModule["createHealthSchedulerRepository"];

async function loadLegacyModules() {
  const sourceRoot = process.env.OCTOPORT_LEGACY_SOURCE_ROOT;
  if (!sourceRoot) throw new Error("OCTOPORT_LEGACY_SOURCE_ROOT_REQUIRED");
  const actualSha = execFileSync(
    "git",
    ["-C", sourceRoot, "rev-parse", "HEAD"],
    { encoding: "utf8" },
  ).trim();
  if (actualSha !== LEGACY_WRITER_SOURCE_SHA) {
    throw new Error(
      `LEGACY_WRITER_SHA_MISMATCH expected=${LEGACY_WRITER_SOURCE_SHA} actual=${actualSha}`,
    );
  }
  const health = await import(
    pathToFileURL(resolve(sourceRoot, "packages/server/health/src/index.ts"))
      .href
  );
  const db = await import(
    pathToFileURL(resolve(sourceRoot, "packages/server/db/src/index.ts")).href
  );
  DEFAULT_NO_SESSION_CADENCE = health.DEFAULT_NO_SESSION_CADENCE;
  NoSessionObservationResultSchema = health.NoSessionObservationResultSchema;
  createDatabaseRuntime = db.createDatabaseRuntime;
  createHealthNoSessionCompletionAdapter =
    db.createHealthNoSessionCompletionAdapter;
  createHealthSchedulerRepository = db.createHealthSchedulerRepository;
}

const baseTime = new Date("2026-09-10T12:00:00.000Z");
const target = {
  targetKey: "nosession_chatgpt_standard",
  providerId: "chatgpt",
  surfaceId: "CHATGPT_STANDARD",
};
const uuid = (prefix: string, sequence: number) =>
  prefix + "000000-0000-4000-8000-" + String(sequence).padStart(12, "0");
function timestamps(sequence: number) {
  const dueAt = new Date(baseTime.valueOf() + sequence * 600_000);
  return {
    dueAt,
    startedAt: new Date(dueAt.valueOf() + 2),
    observedAt: new Date(dueAt.valueOf() + 20_000),
    completedAt: new Date(dueAt.valueOf() + 21_000),
  };
}
function observation(sequence: number, strategyId: string, observedAt: Date) {
  const composerCount = sequence <= 3 ? sequence : 1;
  return NoSessionObservationResultSchema.parse({
    providerId: target.providerId,
    surfaceId: target.surfaceId,
    targetKey: target.targetKey,
    strategyId,
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
        elementCount: composerCount,
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
    evidence: [],
  });
}

async function profileKey(runtime: ReturnType<typeof createDatabaseRuntime>) {
  const result = await runtime.query<{ machineKey: string }>(
    "SELECT profile.machine_key AS \"machineKey\" FROM adapter_profiles profile JOIN ai_adapters adapter ON adapter.id=profile.adapter_id JOIN ai_surfaces surface ON surface.id=profile.surface_id WHERE adapter.machine_key='chatgpt' AND surface.machine_key='standard' AND profile.status='ACTIVE'",
  );
  const key = result.rows[0]?.machineKey;
  if (!key) throw new Error("LEGACY_PROFILE_AUTHORITY_MISSING");
  return key;
}
async function writeSequence(
  runtime: ReturnType<typeof createDatabaseRuntime>,
  sequence: number,
) {
  const scheduler = createHealthSchedulerRepository(runtime);
  const completion = createHealthNoSessionCompletionAdapter(runtime);
  const strategyId = await profileKey(runtime);
  const time = timestamps(sequence);
  const scheduleId = uuid("b1", sequence);
  await scheduler.createSchedule({
    scheduleId,
    monitorTarget: target.targetKey,
    provider: target.providerId,
    surface: target.surfaceId,
    probeLayer: "NO_SESSION",
    enabled: true,
    cadence: DEFAULT_NO_SESSION_CADENCE,
    nextDueAt: time.dueAt,
    revision: sequence,
  });
  const due = await scheduler.materializeDueSlot(scheduleId, time.dueAt);
  if (!due) throw new Error("LEGACY_DUE_SLOT_MISSING");
  const claimed = await scheduler.claimNext({
    ownerId: "legacy-c2-writer",
    now: new Date(time.dueAt.valueOf() + 1),
    leaseMs: 300_000,
  });
  if (!claimed || claimed.id !== due.id)
    throw new Error("LEGACY_CLAIM_MISMATCH");
  const started = await scheduler.startRun({
    runId: due.id,
    ownerId: claimed.ownerId!,
    leaseId: claimed.leaseId!,
    now: time.startedAt,
  });
  const result = await completion.completeScheduledNoSessionHealthRun({
    scheduledRunId: started.id,
    observation: observation(sequence, strategyId, time.observedAt),
    classifierVersion: "legacy-c2-compat-v1",
    startedAt: time.startedAt,
    completedAt: time.completedAt,
  });
  await scheduler.finishSuccess({
    runId: started.id,
    ownerId: claimed.ownerId!,
    leaseId: claimed.leaseId!,
    now: new Date(time.completedAt.valueOf() + 1),
    healthRunId: result.healthRunId,
    healthState: result.healthState,
  });
  return {
    sequence,
    scheduleId,
    scheduledRunId: started.id,
    healthRunId: result.healthRunId,
  };
}
async function duplicate(
  runtime: ReturnType<typeof createDatabaseRuntime>,
  sequence: number,
) {
  const completion = createHealthNoSessionCompletionAdapter(runtime);
  const strategyId = await profileKey(runtime);
  const time = timestamps(sequence);
  const scheduleId = uuid("b1", sequence);
  const scheduled = await runtime.query<{ id: string }>(
    "SELECT id FROM health_scheduled_runs WHERE schedule_id=$1 ORDER BY due_slot_at LIMIT 1",
    [scheduleId],
  );
  const scheduledRunId = scheduled.rows[0]?.id ?? uuid("bd", sequence);
  try {
    const result = await completion.completeScheduledNoSessionHealthRun({
      scheduledRunId,
      observation: observation(sequence, strategyId, time.observedAt),
      classifierVersion: "legacy-c2-compat-v1",
      startedAt: time.startedAt,
      completedAt: time.completedAt,
    });
    return { kind: "UNEXPECTED_SUCCESS", scheduledRunId, result };
  } catch (error) {
    return {
      kind: "REJECTED",
      scheduledRunId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
async function main() {
  await loadLegacyModules();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL_REQUIRED");
  const runtime = createDatabaseRuntime(connectionString);
  await runtime.ready();
  try {
    const operation = process.argv[2];
    const sequence = Number(process.argv[3]);
    if (!Number.isInteger(sequence) || sequence < 1)
      throw new Error("LEGACY_SEQUENCE_REQUIRED");
    const before = await runtime.query<{ notifications: string }>(
      "SELECT count(*)::text AS notifications FROM health_notification_intents",
    );
    const result =
      operation === "write"
        ? await writeSequence(runtime, sequence)
        : operation === "duplicate"
          ? await duplicate(runtime, sequence)
          : (() => {
              throw new Error("LEGACY_OPERATION_REQUIRED");
            })();
    const after = await runtime.query<Record<string, string>>(
      "SELECT (SELECT count(*)::text FROM health_runs) AS runs,(SELECT count(*)::text FROM health_no_session_observations) AS observations,(SELECT count(*)::text FROM health_no_session_run_receipts) AS receipts,(SELECT count(*)::text FROM health_notification_intents) AS notifications",
    );
    console.log(
      "LEGACY_WRITER_RESULT=" +
        JSON.stringify({
          sourceSha: "c2e715501161d421b1641bb697c7ee7786d84960",
          operation,
          sequence,
          result,
          notificationsBefore: before.rows[0]!.notifications,
          ...after.rows[0],
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
