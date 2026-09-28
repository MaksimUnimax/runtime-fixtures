import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_NO_SESSION_CADENCE,
  NoSessionObservationResultSchema,
  type NoSessionObservationResult,
} from "@product/health";
import {
  createDatabaseRuntime,
  createHealthAdminReadRepository,
  createHealthIncidentRepository,
  createHealthNoSessionCompletionAdapter,
  createHealthNoSessionPersistenceRepository,
  createHealthRetentionRepository,
  createHealthSchedulerRepository,
  NO_SESSION_RAW_PAYLOAD_GRACE_MS,
  NO_SESSION_REPLAY_RECEIPT_MIN_AGE_MS,
  noSessionRetentionScopeSha256,
  normalizedNoSessionResultSha256,
  type DatabaseQuery,
  type DatabaseRuntime,
} from "./index.js";
import { runMigrations } from "./migrations.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const IDS = {
  adapter: "c4000000-0000-4000-8000-000000000001",
  surface: "c4000000-0000-4000-8000-000000000002",
  profile: "c4000000-0000-4000-8000-000000000003",
  revision: "c4000000-0000-4000-8000-000000000004",
  recoveryProfile: "c4000000-0000-4000-8000-000000000005",
  recoveryRevision: "c4000000-0000-4000-8000-000000000006",
  retentionProfile: "c4000000-0000-4000-8000-000000000007",
  retentionRevision: "c4000000-0000-4000-8000-000000000008",
  crashProfile: "c4000000-0000-4000-8000-000000000009",
  crashRevision: "c4000000-0000-4000-8000-000000000010",
};
const runtime = createDatabaseRuntime(connectionString);
const scheduler = createHealthSchedulerRepository(runtime);
const persistence = createHealthNoSessionPersistenceRepository(runtime);
const completion = createHealthNoSessionCompletionAdapter(runtime);
const incidents = createHealthIncidentRepository(runtime);
const admin = createHealthAdminReadRepository(runtime);

type Deferred<T> = Readonly<{
  promise: Promise<T>;
  resolve(value: T): void;
}>;

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function hookRuntimeTransactions(
  base: DatabaseRuntime,
  afterQuery: (text: string) => Promise<void>,
): DatabaseRuntime {
  return {
    db: base.db,
    ready: () => base.ready(),
    close: async () => undefined,
    query: <T extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ) => base.query<T>(text, values),
    transaction: <T>(operation: (transaction: DatabaseQuery) => Promise<T>) =>
      base.transaction((q) =>
        operation({
          query: async <
            Row extends Record<string, unknown> = Record<string, unknown>,
          >(
            text: string,
            values?: unknown[],
          ) => {
            const result = await q.query<Row>(text, values);
            await afterQuery(text);
            return result;
          },
        }),
      ),
  };
}

function pauseAfterScheduledRunLock(base: DatabaseRuntime) {
  const locked = deferred<void>();
  const release = deferred<void>();
  let paused = false;
  const runtime = hookRuntimeTransactions(base, async (text) => {
    if (
      !paused &&
      text.includes("FROM health_scheduled_runs WHERE id=$1 FOR UPDATE")
    ) {
      paused = true;
      locked.resolve(undefined);
      await release.promise;
    }
  });
  return {
    runtime,
    locked: locked.promise,
    release: () => release.resolve(undefined),
  };
}

const settleTick = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 50));

const baseTime = new Date("2026-09-23T12:00:00.000Z");
const RETENTION_TEST_NOW = new Date(
  baseTime.valueOf() + NO_SESSION_RAW_PAYLOAD_GRACE_MS + 24 * 60 * 60 * 1_000,
);
const RETENTION_METADATA_BEFORE = new Date(
  RETENTION_TEST_NOW.valueOf() + 1_000,
);
const RETENTION_METADATA_NOW = new Date(
  RETENTION_METADATA_BEFORE.valueOf() +
    NO_SESSION_REPLAY_RECEIPT_MIN_AGE_MS +
    1_000,
);
const retention = createHealthRetentionRepository(runtime, {
  clock: () => RETENTION_TEST_NOW,
});
const metadataRetention = createHealthRetentionRepository(runtime, {
  clock: () => RETENTION_METADATA_NOW,
});

type PersistedRunRow = {
  id: string;
  runKind: string;
  healthLevel: string;
  healthState: string;
  suiteRevisionId: string | null;
  extensionVersion: string | null;
  adapterEngineVersion: string | null;
  scheduledRunId: string | null;
  adapterId: string;
  surfaceId: string;
  profileId: string;
  profileRevisionId: string;
  scope: Record<string, unknown>;
  scopeSha256: string;
} & Record<string, unknown>;

function uuid(sequence: number): string {
  return `c4000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function observation(
  sequence: number,
  changes: Partial<NoSessionObservationResult> = {},
): NoSessionObservationResult {
  const value = {
    providerId: "chatgpt",
    surfaceId: "CHATGPT_STANDARD",
    targetKey: "nosession_chatgpt_standard",
    strategyId: "chatgpt-standard-public-v1",
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
    observedAt: new Date(
      baseTime.valueOf() + sequence * 1_000 + 50,
    ).toISOString(),
    evidence: [
      {
        evidenceId: uuid(500 + sequence),
        ruleId: "SAFE_ELEMENT_METADATA",
        classification: "METADATA",
        sha256: "a".repeat(64),
        sizeBytes: 96,
      },
    ],
    ...changes,
  };
  return NoSessionObservationResultSchema.parse(value);
}

async function seedProfile(
  profileId: string,
  profileKey: string,
  revisionIds: readonly string[],
  browserFamilies: readonly string[] = ["chrome"],
) {
  await runtime.query(
    `INSERT INTO adapter_profiles(id,adapter_id,surface_id,machine_key,display_name) VALUES($1,$2,$3,$4,$5)`,
    [profileId, IDS.adapter, IDS.surface, profileKey, profileKey],
  );
  for (const [index, revisionId] of revisionIds.entries()) {
    await runtime.query(
      `INSERT INTO adapter_profile_revisions(id,profile_id,adapter_id,surface_id,revision,schema_version,state,content,compatibility_constraints,content_sha256) VALUES($1,$2,$3,$4,$5,'adapter_profile_v1','DRAFT','{}'::jsonb,$6::jsonb,$7)`,
      [
        revisionId,
        profileId,
        IDS.adapter,
        IDS.surface,
        index + 1,
        JSON.stringify({ browserFamilies }),
        String(index + 1).padStart(64, "0"),
      ],
    );
    await runtime.query(
      "UPDATE adapter_profile_revisions SET state='CANDIDATE' WHERE id=$1",
      [revisionId],
    );
    await runtime.query(
      "UPDATE adapter_profile_revisions SET state='PUBLISHED',published_at=$2 WHERE id=$1",
      [revisionId, baseTime],
    );
  }
}

let scheduleSequence = 100;
async function makeScheduledRun(
  options: {
    started?: boolean;
    monitorTarget?: string;
  } = {},
) {
  const sequence = scheduleSequence++;
  const scheduleId = uuid(sequence);
  const dueAt = new Date(baseTime.valueOf() + sequence * 1_000);
  await scheduler.createSchedule({
    scheduleId,
    monitorTarget: options.monitorTarget ?? "nosession_chatgpt_standard",
    provider: "chatgpt",
    surface: "CHATGPT_STANDARD",
    probeLayer: "NO_SESSION",
    enabled: true,
    cadence: DEFAULT_NO_SESSION_CADENCE,
    nextDueAt: dueAt,
    revision: sequence,
  });
  const scheduled = await scheduler.materializeDueSlot(scheduleId, dueAt);
  if (!scheduled) throw new Error("NO_SESSION_TEST_SCHEDULE_NOT_MATERIALIZED");
  if (!options.started) return scheduled;
  const claimTime = new Date(dueAt.valueOf() + 1);
  const claimed = await scheduler.claimNext({
    ownerId: `no-session-integration-${sequence}`,
    now: claimTime,
    leaseMs: 300_000,
  });
  if (!claimed || claimed.id !== scheduled.id || !claimed.leaseId) {
    throw new Error("NO_SESSION_TEST_SCHEDULE_NOT_CLAIMED");
  }
  await scheduler.startRun({
    runId: claimed.id,
    ownerId: claimed.ownerId!,
    leaseId: claimed.leaseId,
    now: new Date(claimTime.valueOf() + 1),
  });
  return scheduled;
}

function persistenceInput(
  scheduledRunId: string,
  result: NoSessionObservationResult,
) {
  const observedAt = Date.parse(result.observedAt);
  const startedAt = new Date(observedAt - 1_000);
  return {
    scheduledRunId,
    observation: result,
    classifierVersion: "no-session-integration-v1",
    startedAt,
    completedAt: new Date(observedAt + 1_000),
  };
}

async function healthRunCount(): Promise<number> {
  const result = await runtime.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM health_runs",
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function expectRejectedWithoutRun(
  scheduledRunId: string,
  result: NoSessionObservationResult,
  code: string,
) {
  const before = await healthRunCount();
  await expect(
    persistence.persistCompletedNoSessionHealthRun(
      persistenceInput(scheduledRunId, result),
    ),
  ).rejects.toThrow(code);
  expect(await healthRunCount()).toBe(before);
}

describe.sequential("C04 no-session persistence PostgreSQL acceptance", () => {
  beforeAll(async () => {
    await runtime.ready();
    await runtime.query("DROP SCHEMA IF EXISTS public CASCADE");
    await runtime.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await runtime.query("CREATE SCHEMA public");
    await runMigrations({ connectionString });
    await runtime.query(
      `INSERT INTO ai_adapters(id,machine_key,display_name) VALUES($1,'chatgpt','ChatGPT')`,
      [IDS.adapter],
    );
    await runtime.query(
      `INSERT INTO ai_surfaces(id,adapter_id,machine_key,display_name) VALUES($1,$2,'standard','Standard')`,
      [IDS.surface, IDS.adapter],
    );
    await seedProfile(IDS.profile, "chatgpt-standard-public-v1", [
      IDS.revision,
    ]);
    await seedProfile(IDS.recoveryProfile, "chatgpt-standard-recovery-v1", [
      IDS.recoveryRevision,
    ]);
    await seedProfile(IDS.retentionProfile, "chatgpt-standard-retention-v1", [
      IDS.retentionRevision,
    ]);
    await seedProfile(IDS.crashProfile, "chatgpt-standard-crash-v1", [
      IDS.crashRevision,
    ]);
    await seedProfile(
      uuid(30),
      "chatgpt-standard-no-revision",
      [],
      ["firefox"],
    );
  });

  afterAll(async () => {
    await runtime.close();
  });

  it("persists, reconciles, rejects unauthorized input, and feeds incidents/admin", async () => {
    const successfulSchedule = await makeScheduledRun({ started: true });
    const healthy = observation(1);
    const persisted = await persistence.persistCompletedNoSessionHealthRun(
      persistenceInput(successfulSchedule.id, healthy),
    );

    const runRows = await runtime.query<PersistedRunRow>(
      `SELECT id,run_kind AS "runKind",health_level AS "healthLevel",health_state AS "healthState",suite_revision_id AS "suiteRevisionId",extension_version AS "extensionVersion",adapter_engine_version AS "adapterEngineVersion",scheduled_run_id AS "scheduledRunId",adapter_id AS "adapterId",surface_id AS "surfaceId",profile_id AS "profileId",profile_revision_id AS "profileRevisionId",scope,scope_sha256 AS "scopeSha256" FROM health_runs WHERE id=$1`,
      [persisted.healthRunId],
    );
    const run = runRows.rows[0];
    if (!run) throw new Error("NO_SESSION_TEST_RUN_MISSING");
    expect(run).toMatchObject({
      id: persisted.healthRunId,
      runKind: "NO_SESSION_OBSERVATION",
      healthLevel: "H2",
      healthState: healthy.classification,
      suiteRevisionId: null,
      extensionVersion: null,
      adapterEngineVersion: null,
      scheduledRunId: successfulSchedule.id,
      adapterId: IDS.adapter,
      surfaceId: IDS.surface,
      profileId: IDS.profile,
      profileRevisionId: IDS.revision,
    });
    expect(Object.keys(run.scope).sort()).toEqual(
      [
        "schemaVersion",
        "monitoringLayer",
        "provider",
        "adapterMachineKey",
        "surface",
        "surfaceMachineKey",
        "variant",
        "adapterId",
        "surfaceId",
        "variantId",
        "profileId",
        "profileMachineKey",
        "profileRevisionId",
        "profileRevision",
        "browserFamily",
        "browserVersion",
        "targetKey",
        "strategyId",
        "strategyRevision",
      ].sort(),
    );
    expect(run.scope).toMatchObject({
      monitoringLayer: "NO_SESSION",
      profileMachineKey: "chatgpt-standard-public-v1",
      profileRevisionId: IDS.revision,
      profileRevision: 1,
      targetKey: "nosession_chatgpt_standard",
    });
    const detail = await runtime.query<{ observation: unknown }>(
      "SELECT observation FROM health_no_session_observations WHERE run_id=$1",
      [persisted.healthRunId],
    );
    expect(detail.rows[0]?.observation).toEqual(healthy);
    const evidence = await runtime.query<Record<string, unknown>>(
      `SELECT evidence_id AS "evidenceId",rule_id AS "ruleId",classification,sha256,size_bytes AS "sizeBytes" FROM health_no_session_evidence_references WHERE run_id=$1`,
      [persisted.healthRunId],
    );
    expect(evidence.rows).toEqual(healthy.evidence);
    const contours = await runtime.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM health_contour_results WHERE run_id=$1",
      [persisted.healthRunId],
    );
    expect(contours.rows[0]?.count).toBe("0");

    const replay = await persistence.persistCompletedNoSessionHealthRun(
      persistenceInput(successfulSchedule.id, healthy),
    );
    expect(replay.healthRunId).toBe(persisted.healthRunId);
    await expect(
      persistence.persistCompletedNoSessionHealthRun(
        persistenceInput(
          successfulSchedule.id,
          observation(1, { classification: "BROKEN" }),
        ),
      ),
    ).rejects.toThrow("NO_SESSION_SCHEDULED_RUN_CONFLICT");

    const schedulerState = await scheduler.getScheduledRun(
      successfulSchedule.id,
    );
    expect(schedulerState?.state).toBe("RUNNING");
    expect(
      await scheduler.reconcilePersistedResults(
        new Date(baseTime.valueOf() + 500_000),
      ),
    ).toBe(1);
    const recovered = await scheduler.getScheduledRun(successfulSchedule.id);
    expect(recovered).toMatchObject({
      state: "SUCCEEDED",
      healthRunId: persisted.healthRunId,
      healthState: healthy.classification,
    });

    const adminDetail = await admin.getTarget(run.scopeSha256);
    expect(adminDetail?.contourStatuses).toEqual([]);
    expect(adminDetail?.evidenceReferences).toEqual(healthy.evidence);

    const brokenSchedule = await makeScheduledRun({ started: true });
    const broken = observation(2, {
      classification: "BROKEN",
      classificationBasis: "BROWSER_FAILURE",
      surfaceOutcome: "BROWSER_FAILURE",
      blocker: "BROWSER_UNAVAILABLE",
      browserMode: {
        ...healthy.browserMode,
        canonicalObservation: {
          ...healthy.browserMode.canonicalObservation,
          classification: "BROKEN",
          blocker: "BROWSER_UNAVAILABLE",
          surfaceOutcome: "BROWSER_FAILURE",
        },
      },
    });
    const brokenRun = await persistence.persistCompletedNoSessionHealthRun(
      persistenceInput(brokenSchedule.id, broken),
    );
    const opened = await incidents.processCompletedHealthRun(
      brokenRun.healthRunId,
    );
    expect(opened.action).toBe("OPENED");
    const incident = await incidents.getIncident(opened.incidentIds[0]!);
    expect(incident?.rootContourKey).toBeNull();
    const openedIntent = await runtime.query<Record<string, unknown>>(
      `SELECT source_domain AS "sourceDomain",event_kind AS "eventKind",health_run_id AS "healthRunId" FROM health_notification_intents WHERE incident_id=$1`,
      [opened.incidentIds[0]],
    );
    expect(openedIntent.rows).toEqual([
      {
        sourceDomain: "LLM_HEALTH",
        eventKind: "INCIDENT_OPENED",
        healthRunId: brokenRun.healthRunId,
      },
    ]);

    const unknownSchedule = await makeScheduledRun({ started: true });
    const unknownObservation = observation(3, {
      classification: "UNKNOWN",
    });
    const unknownRun = await persistence.persistCompletedNoSessionHealthRun(
      persistenceInput(unknownSchedule.id, unknownObservation),
    );
    expect(
      (await incidents.processCompletedHealthRun(unknownRun.healthRunId))
        .action,
    ).toBe("NOOP");
    expect((await incidents.getIncident(opened.incidentIds[0]!))?.status).toBe(
      "OPEN",
    );

    const recoverySchedule = await makeScheduledRun({ started: true });
    const recoveryObservation = observation(4);
    const recoveryRun = await persistence.persistCompletedNoSessionHealthRun(
      persistenceInput(recoverySchedule.id, recoveryObservation),
    );
    const resolved = await incidents.processCompletedHealthRun(
      recoveryRun.healthRunId,
    );
    expect(resolved.action).toBe("RESOLVED");
    const recoveredIntents = await runtime.query<{ eventKind: string }>(
      `SELECT event_kind AS "eventKind" FROM health_notification_intents WHERE incident_id=$1 ORDER BY event_kind`,
      [opened.incidentIds[0]],
    );
    expect(recoveredIntents.rows.map((row) => row.eventKind).sort()).toEqual([
      "INCIDENT_OPENED",
      "INCIDENT_RECOVERED",
    ]);

    const scopeMismatch = await makeScheduledRun({
      started: true,
      monitorTarget: "nosession_wrong_target",
    });
    await expectRejectedWithoutRun(
      scopeMismatch.id,
      observation(5),
      "NO_SESSION_SCHEDULE_SCOPE_MISMATCH",
    );

    const notRunning = await makeScheduledRun();
    await expectRejectedWithoutRun(
      notRunning.id,
      observation(6),
      "NO_SESSION_SCHEDULE_NOT_RUNNING",
    );
    const claimedNotRunning = await scheduler.claimNext({
      ownerId: "no-session-integration-not-running",
      now: new Date(notRunning.dueSlotAt.valueOf() + 1),
      leaseMs: 300_000,
    });
    expect(claimedNotRunning?.id).toBe(notRunning.id);

    const missingProfile = await makeScheduledRun({ started: true });
    await expectRejectedWithoutRun(
      missingProfile.id,
      observation(7, { strategyId: "chatgpt-standard-missing-profile" }),
      "NO_SESSION_PROFILE_AUTHORITY_NOT_FOUND",
    );
    const mismatchedProviderSurface = await makeScheduledRun({ started: true });
    await expectRejectedWithoutRun(
      mismatchedProviderSurface.id,
      observation(8, { providerId: "alice" }),
      "NO_SESSION_PROVIDER_SURFACE_MISMATCH",
    );

    const inactiveAdapter = await makeScheduledRun({ started: true });
    await runtime.query(
      "UPDATE ai_adapters SET status='DISABLED' WHERE id=$1",
      [IDS.adapter],
    );
    await expectRejectedWithoutRun(
      inactiveAdapter.id,
      observation(9),
      "NO_SESSION_PROVIDER_AUTHORITY_INACTIVE",
    );
    await runtime.query("UPDATE ai_adapters SET status='ACTIVE' WHERE id=$1", [
      IDS.adapter,
    ]);

    const inactiveProfile = await makeScheduledRun({ started: true });
    await runtime.query(
      "UPDATE adapter_profiles SET status='DISABLED' WHERE id=$1",
      [IDS.profile],
    );
    await expectRejectedWithoutRun(
      inactiveProfile.id,
      observation(10),
      "NO_SESSION_PROFILE_AUTHORITY_INACTIVE",
    );
    await runtime.query(
      "UPDATE adapter_profiles SET status='ACTIVE' WHERE id=$1",
      [IDS.profile],
    );

    const zeroRevision = await makeScheduledRun({ started: true });
    await expectRejectedWithoutRun(
      zeroRevision.id,
      observation(11, { strategyId: "chatgpt-standard-no-revision" }),
      "NO_SESSION_PROFILE_REVISION_AUTHORITY_NOT_FOUND",
    );

    await seedProfile(uuid(31), "chatgpt-standard-ambiguous-v1", [
      uuid(32),
      uuid(33),
    ]);
    const ambiguous = await makeScheduledRun({ started: true });
    await expectRejectedWithoutRun(
      ambiguous.id,
      observation(12, { strategyId: "chatgpt-standard-ambiguous-v1" }),
      "NO_SESSION_PROFILE_REVISION_AUTHORITY_AMBIGUOUS",
    );
  });

  it("reconciles persisted no-session side effects before scheduler success", async () => {
    await scheduler.reconcilePersistedResults(
      new Date(baseTime.valueOf() + 600_000),
    );

    const brokenSchedule = await makeScheduledRun({ started: true });
    const broken = observation(17, {
      strategyId: "chatgpt-standard-recovery-v1",
      classification: "BROKEN",
      classificationBasis: "BROWSER_FAILURE",
      surfaceOutcome: "BROWSER_FAILURE",
      blocker: "BROWSER_UNAVAILABLE",
    });
    const persistedBroken =
      await persistence.persistCompletedNoSessionHealthRun(
        persistenceInput(brokenSchedule.id, broken),
      );

    const beforeBroken = await runtime.query<{
      incidents: string;
      intents: string;
    }>(
      'SELECT (SELECT count(*)::text FROM health_incidents WHERE first_seen_run_id=$1 OR latest_seen_run_id=$1) AS "incidents",(SELECT count(*)::text FROM health_notification_intents WHERE health_run_id=$1) AS "intents"',
      [persistedBroken.healthRunId],
    );
    expect(beforeBroken.rows[0]).toEqual({ incidents: "0", intents: "0" });
    expect((await scheduler.getScheduledRun(brokenSchedule.id))?.state).toBe(
      "RUNNING",
    );

    expect(
      await scheduler.reconcilePersistedResults(
        new Date(baseTime.valueOf() + 610_000),
      ),
    ).toBe(1);
    expect(await scheduler.getScheduledRun(brokenSchedule.id)).toMatchObject({
      state: "SUCCEEDED",
      healthRunId: persistedBroken.healthRunId,
      healthState: "BROKEN",
    });

    const brokenCounts = await runtime.query<{
      runs: string;
      incidents: string;
      intents: string;
    }>(
      'SELECT (SELECT count(*)::text FROM health_runs WHERE scheduled_run_id=$1) AS "runs",(SELECT count(*)::text FROM health_incidents WHERE first_seen_run_id=$2 OR latest_seen_run_id=$2) AS "incidents",(SELECT count(*)::text FROM health_notification_intents WHERE health_run_id=$2) AS "intents"',
      [brokenSchedule.id, persistedBroken.healthRunId],
    );
    expect(brokenCounts.rows[0]).toEqual({
      runs: "1",
      incidents: "1",
      intents: "1",
    });
    expect(
      await scheduler.reconcilePersistedResults(
        new Date(baseTime.valueOf() + 620_000),
      ),
    ).toBe(0);
    expect(
      (
        await runtime.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM health_notification_intents WHERE health_run_id=$1",
          [persistedBroken.healthRunId],
        )
      ).rows[0]?.count,
    ).toBe("1");

    const healthySchedule = await makeScheduledRun({ started: true });
    const healthy = observation(18, {
      strategyId: "chatgpt-standard-recovery-v1",
    });
    const persistedHealthy =
      await persistence.persistCompletedNoSessionHealthRun(
        persistenceInput(healthySchedule.id, healthy),
      );
    expect(
      await scheduler.reconcilePersistedResults(
        new Date(baseTime.valueOf() + 630_000),
      ),
    ).toBe(1);
    const incident = await runtime.query<{
      count: string;
      status: string;
    }>(
      "SELECT count(*)::text AS count,min(status::text) AS status FROM health_incidents WHERE first_seen_run_id=$1 OR resolved_by_run_id=$2",
      [persistedBroken.healthRunId, persistedHealthy.healthRunId],
    );
    expect(incident.rows[0]).toEqual({ count: "1", status: "RESOLVED" });
    const recoveryIntent = await runtime.query<{ eventKind: string }>(
      'SELECT event_kind AS "eventKind" FROM health_notification_intents WHERE health_run_id=$1 ORDER BY event_kind',
      [persistedHealthy.healthRunId],
    );
    expect(recoveryIntent.rows).toEqual([{ eventKind: "INCIDENT_RECOVERED" }]);

    const unknownSchedule = await makeScheduledRun({ started: true });
    const unknown = observation(19, {
      strategyId: "chatgpt-standard-recovery-v1",
      classification: "UNKNOWN",
    });
    const persistedUnknown =
      await persistence.persistCompletedNoSessionHealthRun(
        persistenceInput(unknownSchedule.id, unknown),
      );
    expect(
      await scheduler.reconcilePersistedResults(
        new Date(baseTime.valueOf() + 640_000),
      ),
    ).toBe(1);
    expect(await scheduler.getScheduledRun(unknownSchedule.id)).toMatchObject({
      state: "SUCCEEDED",
      healthRunId: persistedUnknown.healthRunId,
      healthState: "UNKNOWN",
    });
    const unknownEffects = await runtime.query<{
      incidents: string;
      intents: string;
    }>(
      'SELECT (SELECT count(*)::text FROM health_incidents WHERE first_seen_run_id=$1 OR latest_seen_run_id=$1 OR resolved_by_run_id=$1) AS "incidents",(SELECT count(*)::text FROM health_notification_intents WHERE health_run_id=$1) AS "intents"',
      [persistedUnknown.healthRunId],
    );
    expect(unknownEffects.rows[0]).toEqual({ incidents: "0", intents: "0" });

    const failingSchedule = await makeScheduledRun({ started: true });
    const failing = observation(20, {
      strategyId: "chatgpt-standard-recovery-v1",
      classification: "BROKEN",
      classificationBasis: "BROWSER_FAILURE",
      surfaceOutcome: "BROWSER_FAILURE",
      blocker: "BROWSER_UNAVAILABLE",
    });
    const persistedFailing =
      await persistence.persistCompletedNoSessionHealthRun(
        persistenceInput(failingSchedule.id, failing),
      );
    const failingScheduler = createHealthSchedulerRepository(runtime, {
      incidentProcessor: {
        async processCompletedHealthRun(runId) {
          if (runId === persistedFailing.healthRunId) {
            throw new Error("TEST_INCIDENT_PROCESSOR_FAILURE");
          }
          return incidents.processCompletedHealthRun(runId);
        },
      },
    });
    await expect(
      failingScheduler.reconcilePersistedResults(
        new Date(baseTime.valueOf() + 650_000),
      ),
    ).rejects.toThrow("TEST_INCIDENT_PROCESSOR_FAILURE");
    expect(await scheduler.getScheduledRun(failingSchedule.id)).toMatchObject({
      state: "RUNNING",
      healthRunId: null,
    });
    expect(
      await scheduler.reconcilePersistedResults(
        new Date(baseTime.valueOf() + 660_000),
      ),
    ).toBe(1);
    const failingCounts = await runtime.query<{
      runs: string;
      incidents: string;
      intents: string;
    }>(
      'SELECT (SELECT count(*)::text FROM health_runs WHERE scheduled_run_id=$1) AS "runs",(SELECT count(*)::text FROM health_incidents WHERE first_seen_run_id=$2 OR latest_seen_run_id=$2) AS "incidents",(SELECT count(*)::text FROM health_notification_intents WHERE health_run_id=$2) AS "intents"',
      [failingSchedule.id, persistedFailing.healthRunId],
    );
    expect(failingCounts.rows[0]).toEqual({
      runs: "1",
      incidents: "1",
      intents: "1",
    });
  });

  it("completes scheduled no-session persistence and incident processing idempotently", async () => {
    const scheduled = await makeScheduledRun({ started: true });
    const broken = observation(16, {
      classification: "BROKEN",
      classificationBasis: "BROWSER_FAILURE",
      surfaceOutcome: "BROWSER_FAILURE",
      blocker: "BROWSER_UNAVAILABLE",
    });

    const first = await completion.completeScheduledNoSessionHealthRun(
      persistenceInput(scheduled.id, broken),
    );
    expect(first).toMatchObject({
      scheduledRunId: scheduled.id,
      healthState: "BROKEN",
      incident: { action: "OPENED" },
    });
    expect(first.incident.incidentIds).toHaveLength(1);

    const replay = await completion.completeScheduledNoSessionHealthRun(
      persistenceInput(scheduled.id, broken),
    );
    expect(replay.healthRunId).toBe(first.healthRunId);
    expect(replay.healthState).toBe(first.healthState);
    expect(replay.incident).toMatchObject({
      action: "NOOP",
      incidentIds: [],
    });

    const counts = await runtime.query<{
      runCount: string;
      incidentCount: string;
      intentCount: string;
    }>(
      'SELECT (SELECT count(*)::text FROM health_runs WHERE scheduled_run_id=$1) AS "runCount",(SELECT count(*)::text FROM health_incidents WHERE first_seen_run_id=$2 OR latest_seen_run_id=$2) AS "incidentCount",(SELECT count(*)::text FROM health_notification_intents WHERE health_run_id=$2) AS "intentCount"',
      [scheduled.id, first.healthRunId],
    );
    expect(counts.rows[0]).toEqual({
      runCount: "1",
      incidentCount: "1",
      intentCount: "1",
    });

    const running = await scheduler.getScheduledRun(scheduled.id);
    if (!running?.ownerId || !running.leaseId) {
      throw new Error("NO_SESSION_BRIDGE_TEST_RUN_NOT_OWNED");
    }
    const finished = await scheduler.finishSuccess({
      runId: scheduled.id,
      ownerId: running.ownerId,
      leaseId: running.leaseId,
      now: new Date(Date.parse(broken.observedAt) + 2_000),
      healthRunId: first.healthRunId,
      healthState: first.healthState,
    });
    expect(finished).toMatchObject({
      state: "SUCCEEDED",
      healthRunId: first.healthRunId,
      healthState: "BROKEN",
    });

    const replayAfterFinish =
      await completion.completeScheduledNoSessionHealthRun(
        persistenceInput(scheduled.id, broken),
      );
    expect(replayAfterFinish.healthRunId).toBe(first.healthRunId);
    const finalCounts = await runtime.query<{
      runCount: string;
      incidentCount: string;
      intentCount: string;
    }>(
      'SELECT (SELECT count(*)::text FROM health_runs WHERE scheduled_run_id=$1) AS "runCount",(SELECT count(*)::text FROM health_incidents WHERE first_seen_run_id=$2 OR latest_seen_run_id=$2) AS "incidentCount",(SELECT count(*)::text FROM health_notification_intents WHERE health_run_id=$2) AS "intentCount"',
      [scheduled.id, first.healthRunId],
    );
    expect(finalCounts.rows[0]).toEqual(counts.rows[0]);
  });

  it("persists only sanitized URL origins and replays equivalent safe observations", async () => {
    const privacySchedule = await makeScheduledRun({ started: true });
    const privacyObservation = observation(13, {
      navigationEvidence: {
        requestedStartUrl:
          "https://privacy-user-13:privacy-pass-13@chatgpt.com/private-path-13?token=secret-query-13#secret-fragment-13",
        finalUrl:
          "https://chatgpt.com/session-path-13?session=secret-session-13#secret-final-fragment-13",
        finalOrigin:
          "https://chatgpt.com/final-origin-path-13?token=secret-origin-13#secret-origin-fragment-13",
        mainDocumentHttpStatus: 200,
        redirectCount: 1,
        outcome: "LOADED",
      },
      finalOrigin:
        "https://chatgpt.com/top-final-path-13?token=secret-top-13#secret-top-fragment-13",
    });
    const persisted = await persistence.persistCompletedNoSessionHealthRun(
      persistenceInput(privacySchedule.id, privacyObservation),
    );
    const persistedDetail = await runtime.query<{
      observation: unknown;
      resultSha256: string;
    }>(
      'SELECT observation,result_sha256 AS "resultSha256" FROM health_no_session_observations WHERE run_id=$1',
      [persisted.healthRunId],
    );
    const persistedObservation = persistedDetail.rows[0]?.observation;
    expect(persistedObservation).toMatchObject({
      navigationEvidence: {
        requestedStartUrl: "https://chatgpt.com",
        finalUrl: "https://chatgpt.com",
        finalOrigin: "https://chatgpt.com",
      },
      finalOrigin: "https://chatgpt.com",
    });
    const storedJson = JSON.stringify(persistedObservation);
    for (const secret of [
      "privacy-user-13",
      "privacy-pass-13",
      "private-path-13",
      "secret-query-13",
      "secret-fragment-13",
      "session-path-13",
      "secret-session-13",
      "secret-final-fragment-13",
      "final-origin-path-13",
      "secret-origin-13",
      "secret-origin-fragment-13",
      "top-final-path-13",
      "secret-top-13",
      "secret-top-fragment-13",
    ]) {
      expect(storedJson).not.toContain(secret);
    }
    const evidence = await runtime.query<{
      evidenceId: string;
      ruleId: string;
      classification: string;
      sha256: string;
      sizeBytes: number;
    }>(
      'SELECT evidence_id AS "evidenceId",rule_id AS "ruleId",classification,sha256,size_bytes AS "sizeBytes" FROM health_no_session_evidence_references WHERE run_id=$1',
      [persisted.healthRunId],
    );
    expect(evidence.rows).toEqual(privacyObservation.evidence);

    const equivalentObservation = observation(13, {
      navigationEvidence: {
        requestedStartUrl:
          "https://another-user:another-pass@CHATGPT.COM:443/another-private-path?token=another-secret#another-fragment",
        finalUrl:
          "https://CHATGPT.COM:443/another-session?session=another-secret#another-final-fragment",
        finalOrigin:
          "https://CHATGPT.COM:443/another-origin-path?token=another-origin-secret#another-origin-fragment",
        mainDocumentHttpStatus: 200,
        redirectCount: 1,
        outcome: "LOADED",
      },
      finalOrigin:
        "https://CHATGPT.COM:443/another-top-final?token=another-top-secret#another-top-fragment",
    });
    const replay = await persistence.persistCompletedNoSessionHealthRun(
      persistenceInput(privacySchedule.id, equivalentObservation),
    );
    expect(replay.healthRunId).toBe(persisted.healthRunId);
    const replayDetail = await runtime.query<{ resultSha256: string }>(
      'SELECT result_sha256 AS "resultSha256" FROM health_no_session_observations WHERE run_id=$1',
      [persisted.healthRunId],
    );
    expect(replayDetail.rows[0]?.resultSha256).toBe(
      persistedDetail.rows[0]?.resultSha256,
    );

    const mismatchedSchedule = await makeScheduledRun({ started: true });
    await expectRejectedWithoutRun(
      mismatchedSchedule.id,
      observation(14, {
        navigationEvidence: {
          requestedStartUrl: "https://chatgpt.com/private",
          finalUrl: "https://chatgpt.com/session",
          finalOrigin: "https://example.com/other",
          mainDocumentHttpStatus: 200,
          redirectCount: 0,
          outcome: "LOADED",
        },
        finalOrigin: "https://chatgpt.com",
      }),
      "NO_SESSION_FINAL_ORIGIN_MISMATCH",
    );

    const nonHttpSchedule = await makeScheduledRun({ started: true });
    await expectRejectedWithoutRun(
      nonHttpSchedule.id,
      observation(15, {
        navigationEvidence: {
          requestedStartUrl: "ftp://chatgpt.com/private?token=secret",
          finalUrl: "https://chatgpt.com",
          finalOrigin: "https://chatgpt.com",
          mainDocumentHttpStatus: 200,
          redirectCount: 0,
          outcome: "LOADED",
        },
      }),
      "NO_SESSION_URL_ORIGIN_INVALID",
    );
  });

  it("bounds routine state, preserves baseline, prunes only unpinned payload, and replays from receipt", async () => {
    const variant = (
      sequence: number,
      composerCount: number,
      changes: Partial<NoSessionObservationResult> = {},
    ) => {
      const seed = observation(sequence);
      return observation(sequence, {
        strategyId: "chatgpt-standard-retention-v1",
        elementMetadata: {
          ...seed.elementMetadata,
          composer: {
            ...seed.elementMetadata.composer,
            elementCount: composerCount,
          },
        },
        ...changes,
      });
    };

    const repeatedA = variant(70, 2);
    const repeatedB = variant(71, 2);
    const repeatedHash = normalizedNoSessionResultSha256(repeatedA);
    expect(normalizedNoSessionResultSha256(repeatedB)).toBe(repeatedHash);

    const repeatedSchedules = await Promise.all([
      makeScheduledRun({ started: true }),
      makeScheduledRun({ started: true }),
    ]);
    const [firstRepeated, secondRepeated] = await Promise.all([
      persistence.persistCompletedNoSessionHealthRun(
        persistenceInput(repeatedSchedules[0]!.id, repeatedA),
      ),
      persistence.persistCompletedNoSessionHealthRun(
        persistenceInput(repeatedSchedules[1]!.id, repeatedB),
      ),
    ]);
    expect(firstRepeated.scopeSha256).toBe(secondRepeated.scopeSha256);
    const receiptAuthority = await runtime.query<{
      browserFamily: string;
      profileRevisionId: string;
      profileRevision: number;
    }>(
      `SELECT browser_family AS "browserFamily",profile_revision_id AS "profileRevisionId",
        profile_revision AS "profileRevision"
       FROM health_no_session_run_receipts WHERE run_id=$1`,
      [firstRepeated.healthRunId],
    );
    const receipt = receiptAuthority.rows[0];
    if (!receipt) throw new Error("RETENTION_TEST_RECEIPT_MISSING");
    const retentionScopeSha256 = noSessionRetentionScopeSha256(
      receipt,
      repeatedA,
    );

    const coalescedRows = await runtime.query<{
      scopeSha256: string;
      repeatCount: number;
    }>(
      `SELECT scope_sha256 AS "scopeSha256",repeat_count AS "repeatCount"
       FROM health_no_session_recent_states
       WHERE normalized_result_sha256=$1`,
      [repeatedHash],
    );
    expect(coalescedRows.rows).toHaveLength(1);
    expect(coalescedRows.rows[0]).toEqual({
      scopeSha256: retentionScopeSha256,
      repeatCount: 2,
    });

    await runtime.query(
      `UPDATE health_no_session_scope_states SET
        accepted_baseline_run_id=$2,accepted_baseline_result_sha256=$3,
        accepted_baseline_health_state='HEALTHY',accepted_baseline_at=$4
       WHERE scope_sha256=$1`,
      [
        retentionScopeSha256,
        firstRepeated.healthRunId,
        repeatedHash,
        new Date(repeatedA.observedAt),
      ],
    );

    const distinct = [
      variant(72, 3),
      variant(73, 4),
      variant(74, 5),
      variant(75, 6, { classification: "UNKNOWN" }),
    ];
    const distinctSchedules: Array<
      Awaited<ReturnType<typeof makeScheduledRun>>
    > = [];
    for (let index = 0; index < distinct.length; index += 1) {
      distinctSchedules.push(await makeScheduledRun({ started: true }));
    }
    const distinctRuns = await Promise.all(
      distinct.map((item, index) =>
        persistence.persistCompletedNoSessionHealthRun(
          persistenceInput(distinctSchedules[index]!.id, item),
        ),
      ),
    );

    await scheduler.reconcilePersistedResults(
      new Date(baseTime.valueOf() + 2_000_000),
    );

    const scopeState = await runtime.query<{
      latestHealthState: string;
      lastVerifiedAt: Date | null;
      acceptedBaselineRunId: string | null;
      acceptedBaselineHealthState: string | null;
      acceptedBaselineResultSha256: string | null;
    }>(
      `SELECT latest_health_state AS "latestHealthState",
        last_verified_at AS "lastVerifiedAt",
        accepted_baseline_run_id AS "acceptedBaselineRunId",
        accepted_baseline_health_state AS "acceptedBaselineHealthState",
        accepted_baseline_result_sha256 AS "acceptedBaselineResultSha256"
       FROM health_no_session_scope_states WHERE scope_sha256=$1`,
      [retentionScopeSha256],
    );
    expect(scopeState.rows[0]).toMatchObject({
      latestHealthState: "UNKNOWN",
      acceptedBaselineRunId: firstRepeated.healthRunId,
      acceptedBaselineHealthState: "HEALTHY",
      acceptedBaselineResultSha256: repeatedHash,
    });
    expect(scopeState.rows[0]?.lastVerifiedAt?.toISOString()).toBe(
      distinct[2]!.observedAt,
    );

    const recent = await runtime.query<{
      count: string;
      maxRepeat: number;
    }>(
      `SELECT count(*)::text AS count,max(repeat_count)::int AS "maxRepeat"
       FROM health_no_session_recent_states WHERE scope_sha256=$1`,
      [retentionScopeSha256],
    );
    expect(recent.rows[0]?.count).toBe("3");

    const cutoff = new Date(baseTime.valueOf() + 3_000_000);
    const inventory = await retention.listRoutineNoSessionGcInventory({
      before: cutoff,
      limit: 5_000,
    });
    const byRun = new Map(inventory.map((item) => [item.runId, item.reason]));
    expect(byRun.get(firstRepeated.healthRunId)).toBe(
      "ACCEPTED_BASELINE_PINNED",
    );
    expect(byRun.get(secondRepeated.healthRunId)).toBe("ELIGIBLE");
    expect(byRun.get(distinctRuns[3]!.healthRunId)).toBe("RECENT_STATE_PINNED");

    await expect(
      runtime.query(
        "UPDATE health_no_session_run_receipts SET payload_pruned_at=$2 WHERE run_id=$1",
        [firstRepeated.healthRunId, new Date(baseTime.valueOf() + 2_500_000)],
      ),
    ).rejects.toBeInstanceOf(Error);
    await expect(
      runtime.query(
        `INSERT INTO health_schedule_retention_watermarks(
          schedule_id,retired_through_revision,retired_through_due_slot_at,retired_at
        ) VALUES($1,$2,$3,$4)`,
        [
          repeatedSchedules[0]!.scheduleId,
          repeatedSchedules[0]!.scheduleRevision,
          repeatedSchedules[0]!.dueSlotAt,
          new Date(baseTime.valueOf() + 2_500_001),
        ],
      ),
    ).rejects.toBeInstanceOf(Error);

    await expect(
      runtime.query("DELETE FROM health_runs WHERE id=$1", [
        secondRepeated.healthRunId,
      ]),
    ).rejects.toBeInstanceOf(Error);

    const prunePause = pauseAfterScheduledRunLock(runtime);
    const racingCompletion = createHealthNoSessionCompletionAdapter(
      prunePause.runtime,
    );
    const duplicateDuringPrune =
      racingCompletion.completeScheduledNoSessionHealthRun(
        persistenceInput(repeatedSchedules[1]!.id, repeatedB),
      );
    await prunePause.locked;
    let pruneSettled = false;
    const prunePromise = retention
      .pruneRoutineNoSessionPayload({
        runId: secondRepeated.healthRunId,
        before: cutoff,
      })
      .finally(() => {
        pruneSettled = true;
      });
    await settleTick();
    expect(pruneSettled).toBe(false);
    prunePause.release();
    const [duplicatePruneResult, pruned] = await Promise.all([
      duplicateDuringPrune,
      prunePromise,
    ]);
    expect(duplicatePruneResult).toMatchObject({
      healthRunId: secondRepeated.healthRunId,
      incident: { action: "NOOP", incidentIds: [] },
    });
    expect(pruned).toEqual({ status: "PRUNED", reason: "ELIGIBLE" });

    const removed = await runtime.query<{
      runs: string;
      observations: string;
      evidence: string;
      receiptPrunedAt: Date | null;
      scheduledState: string;
      scheduledHealthRunId: string | null;
    }>(
      `SELECT
        (SELECT count(*)::text FROM health_runs WHERE id=$1) AS runs,
        (SELECT count(*)::text FROM health_no_session_observations WHERE run_id=$1) AS observations,
        (SELECT count(*)::text FROM health_no_session_evidence_references WHERE run_id=$1) AS evidence,
        (SELECT payload_pruned_at FROM health_no_session_run_receipts WHERE run_id=$1) AS "receiptPrunedAt",
        (SELECT state::text FROM health_scheduled_runs WHERE id=$2) AS "scheduledState",
        (SELECT health_run_id FROM health_scheduled_runs WHERE id=$2) AS "scheduledHealthRunId"`,
      [secondRepeated.healthRunId, repeatedSchedules[1]!.id],
    );
    expect(removed.rows[0]).toMatchObject({
      runs: "0",
      observations: "0",
      evidence: "0",
      scheduledState: "SUCCEEDED",
      scheduledHealthRunId: null,
    });
    expect(removed.rows[0]?.receiptPrunedAt).toBeInstanceOf(Date);
    await expect(
      runtime.query("DELETE FROM health_scheduled_runs WHERE id=$1", [
        repeatedSchedules[1]!.id,
      ]),
    ).rejects.toBeInstanceOf(Error);
    await expect(
      runtime.query(
        "UPDATE health_scheduled_runs SET due_slot_at=due_slot_at + interval '1 second' WHERE id=$1",
        [repeatedSchedules[1]!.id],
      ),
    ).rejects.toBeInstanceOf(Error);
    await expect(
      runtime.query(
        "DELETE FROM health_no_session_run_receipts WHERE run_id=$1",
        [secondRepeated.healthRunId],
      ),
    ).rejects.toBeInstanceOf(Error);

    const restartedRetention = createHealthRetentionRepository(runtime, {
      clock: () => RETENTION_TEST_NOW,
    });
    const afterRestart =
      await restartedRetention.listRoutineNoSessionGcInventory({
        before: cutoff,
        limit: 5_000,
      });
    expect(
      afterRestart.find((item) => item.runId === secondRepeated.healthRunId)
        ?.reason,
    ).toBe("ALREADY_PRUNED");

    const lateReplay = await completion.completeScheduledNoSessionHealthRun(
      persistenceInput(repeatedSchedules[1]!.id, repeatedB),
    );
    expect(lateReplay).toMatchObject({
      healthRunId: secondRepeated.healthRunId,
      healthState: "HEALTHY",
      incident: { action: "NOOP", incidentIds: [] },
    });
    expect(
      await runtime.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM health_runs WHERE id=$1",
        [secondRepeated.healthRunId],
      ),
    ).toMatchObject({ rows: [{ count: "0" }] });

    await expect(
      completion.completeScheduledNoSessionHealthRun(
        persistenceInput(
          repeatedSchedules[1]!.id,
          variant(71, 2, { classification: "BROKEN" }),
        ),
      ),
    ).rejects.toThrow("NO_SESSION_SCHEDULED_RUN_CONFLICT");

    const tooYoungReceiptRetention = createHealthRetentionRepository(runtime, {
      clock: () =>
        new Date(
          RETENTION_METADATA_BEFORE.valueOf() +
            NO_SESSION_REPLAY_RECEIPT_MIN_AGE_MS -
            1,
        ),
    });
    await expect(
      tooYoungReceiptRetention.retireRoutineNoSessionReceipt({
        runId: secondRepeated.healthRunId,
        before: RETENTION_METADATA_BEFORE,
      }),
    ).rejects.toThrow("HEALTH_RETENTION_REPLAY_RECEIPT_CUTOFF_TOO_RECENT");
    expect(
      (
        await runtime.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM health_no_session_run_receipts WHERE run_id=$1",
          [secondRepeated.healthRunId],
        )
      ).rows[0]?.count,
    ).toBe("1");

    await runtime.query(
      "UPDATE health_schedules SET next_due_at=$2 WHERE id=$1",
      [repeatedSchedules[1]!.scheduleId, repeatedSchedules[1]!.dueSlotAt],
    );
    const retirePause = pauseAfterScheduledRunLock(runtime);
    const completionDuringRetire = createHealthNoSessionCompletionAdapter(
      retirePause.runtime,
    );
    const duplicateDuringRetire =
      completionDuringRetire.completeScheduledNoSessionHealthRun(
        persistenceInput(repeatedSchedules[1]!.id, repeatedB),
      );
    await retirePause.locked;
    let retireSettled = false;
    const retirePromise = metadataRetention
      .retireRoutineNoSessionReceipt({
        runId: secondRepeated.healthRunId,
        before: RETENTION_METADATA_BEFORE,
      })
      .finally(() => {
        retireSettled = true;
      });
    const materializeDuringRetire = scheduler.materializeDueSlot(
      repeatedSchedules[1]!.scheduleId,
      new Date(repeatedSchedules[1]!.dueSlotAt.valueOf() + 1),
    );
    await settleTick();
    expect(retireSettled).toBe(false);
    retirePause.release();
    const [duplicateRetireResult, retired, racedMaterialization] =
      await Promise.all([
        duplicateDuringRetire,
        retirePromise,
        materializeDuringRetire,
      ]);
    expect(duplicateRetireResult).toMatchObject({
      healthRunId: secondRepeated.healthRunId,
      incident: { action: "NOOP", incidentIds: [] },
    });
    expect(retired).toEqual({ status: "RETIRED", reason: "RETIRED" });
    expect(racedMaterialization).toBeNull();
    expect(
      await scheduler.getScheduledRun(repeatedSchedules[1]!.id),
    ).toBeUndefined();
    const retiredReceipt = await runtime.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM health_no_session_run_receipts
       WHERE run_id=$1`,
      [secondRepeated.healthRunId],
    );
    expect(retiredReceipt.rows[0]?.count).toBe("0");
    const watermark = await runtime.query<{
      revision: number;
      dueSlotAt: Date;
    }>(
      `SELECT retired_through_revision AS revision,
        retired_through_due_slot_at AS "dueSlotAt"
       FROM health_schedule_retention_watermarks WHERE schedule_id=$1`,
      [repeatedSchedules[1]!.scheduleId],
    );
    expect(watermark.rows[0]).toEqual({
      revision: repeatedSchedules[1]!.scheduleRevision,
      dueSlotAt: repeatedSchedules[1]!.dueSlotAt,
    });

    await runtime.query(
      "UPDATE health_schedules SET next_due_at=$2 WHERE id=$1",
      [repeatedSchedules[1]!.scheduleId, repeatedSchedules[1]!.dueSlotAt],
    );
    expect(
      await scheduler.materializeDueSlot(
        repeatedSchedules[1]!.scheduleId,
        new Date(repeatedSchedules[1]!.dueSlotAt.valueOf() + 1),
      ),
    ).toBeNull();
    const replayedSlot = await runtime.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM health_scheduled_runs
       WHERE schedule_id=$1 AND schedule_revision=$2 AND due_slot_at=$3`,
      [
        repeatedSchedules[1]!.scheduleId,
        repeatedSchedules[1]!.scheduleRevision,
        repeatedSchedules[1]!.dueSlotAt,
      ],
    );
    expect(replayedSlot.rows[0]?.count).toBe("0");
    await expect(
      persistence.persistCompletedNoSessionHealthRun(
        persistenceInput(repeatedSchedules[1]!.id, repeatedB),
      ),
    ).rejects.toThrow("NO_SESSION_SCHEDULED_RUN_NOT_FOUND");
    await expect(
      runtime.query(
        "DELETE FROM health_schedule_retention_watermarks WHERE schedule_id=$1",
        [repeatedSchedules[1]!.scheduleId],
      ),
    ).rejects.toBeInstanceOf(Error);

    const nextRevision = repeatedSchedules[1]!.scheduleRevision + 10_000;
    await runtime.query(
      `UPDATE health_schedules SET revision=$2,next_due_at=$3,updated_at=$4
       WHERE id=$1`,
      [
        repeatedSchedules[1]!.scheduleId,
        nextRevision,
        repeatedSchedules[1]!.dueSlotAt,
        new Date(repeatedSchedules[1]!.dueSlotAt.valueOf() + 1),
      ],
    );
    const revisedSlot = await scheduler.materializeDueSlot(
      repeatedSchedules[1]!.scheduleId,
      new Date(repeatedSchedules[1]!.dueSlotAt.valueOf() + 1),
    );
    expect(revisedSlot).toMatchObject({
      scheduleRevision: nextRevision,
      dueSlotAt: repeatedSchedules[1]!.dueSlotAt,
    });
    if (!revisedSlot)
      throw new Error("RETENTION_TEST_REVISED_SLOT_NOT_MATERIALIZED");
    const revisedCancelledAt = new Date(baseTime.valueOf() + 4_100_000);
    await runtime.query(
      `UPDATE health_scheduled_runs
       SET state='CANCELLED',finished_at=$2,next_attempt_at=NULL,updated_at=$2
       WHERE id=$1`,
      [revisedSlot.id, revisedCancelledAt],
    );
    const terminalBefore = new Date(revisedCancelledAt.valueOf() + 1);
    const tooYoungTerminalRetention = createHealthRetentionRepository(runtime, {
      clock: () =>
        new Date(
          terminalBefore.valueOf() + NO_SESSION_REPLAY_RECEIPT_MIN_AGE_MS - 1,
        ),
    });
    await expect(
      tooYoungTerminalRetention.retireTerminalScheduledRun({
        scheduledRunId: revisedSlot.id,
        before: terminalBefore,
      }),
    ).rejects.toThrow("HEALTH_RETENTION_REPLAY_RECEIPT_CUTOFF_TOO_RECENT");
    expect(
      await metadataRetention.retireTerminalScheduledRun({
        scheduledRunId: revisedSlot.id,
        before: terminalBefore,
      }),
    ).toEqual({ status: "RETIRED", reason: "RETIRED" });
  });

  it("blocks GC across persist-to-incident crash until duplicate completion processes the run", async () => {
    const failedSchedule = await makeScheduledRun({ started: true });
    const failedObservation = observation(79, {
      strategyId: "chatgpt-standard-crash-v1",
      classification: "BROKEN",
      classificationBasis: "BROWSER_FAILURE",
      surfaceOutcome: "BROWSER_FAILURE",
      blocker: "BROWSER_UNAVAILABLE",
    });
    const failedRun = await persistence.persistCompletedNoSessionHealthRun(
      persistenceInput(failedSchedule.id, failedObservation),
    );
    const failingScheduler = createHealthSchedulerRepository(runtime, {
      incidentProcessor: {
        async processCompletedHealthRun(runId) {
          if (runId === failedRun.healthRunId)
            throw new Error("TEST_RETENTION_INCIDENT_CRASH");
          return incidents.processCompletedHealthRun(runId);
        },
      },
    });
    await expect(
      failingScheduler.reconcilePersistedResults(
        new Date(baseTime.valueOf() + 4_100_000),
      ),
    ).rejects.toThrow("TEST_RETENTION_INCIDENT_CRASH");

    const unprocessedReceipt = await runtime.query<{
      incidentProcessedAt: Date | null;
    }>(
      `SELECT incident_processed_at AS "incidentProcessedAt"
       FROM health_no_session_run_receipts WHERE run_id=$1`,
      [failedRun.healthRunId],
    );
    expect(unprocessedReceipt.rows[0]?.incidentProcessedAt).toBeNull();

    const stillRunning = await scheduler.getScheduledRun(failedSchedule.id);
    if (!stillRunning?.ownerId || !stillRunning.leaseId)
      throw new Error("RETENTION_CRASH_TEST_RUN_NOT_OWNED");
    await scheduler.finishSuccess({
      runId: failedSchedule.id,
      ownerId: stillRunning.ownerId,
      leaseId: stillRunning.leaseId,
      now: new Date(Date.parse(failedObservation.observedAt) + 2_000),
      healthRunId: failedRun.healthRunId,
      healthState: failedRun.healthState,
    });

    const newer = async (sequence: number, composerCount: number) => {
      const seed = observation(sequence);
      const value = observation(sequence, {
        elementMetadata: {
          ...seed.elementMetadata,
          composer: {
            ...seed.elementMetadata.composer,
            elementCount: composerCount,
          },
        },
      });
      const scheduled = await makeScheduledRun({ started: true });
      const completed = await completion.completeScheduledNoSessionHealthRun(
        persistenceInput(scheduled.id, value),
      );
      const running = await scheduler.getScheduledRun(scheduled.id);
      if (!running?.ownerId || !running.leaseId)
        throw new Error("RETENTION_CRASH_NEWER_RUN_NOT_OWNED");
      await scheduler.finishSuccess({
        runId: scheduled.id,
        ownerId: running.ownerId,
        leaseId: running.leaseId,
        now: new Date(Date.parse(value.observedAt) + 2_000),
        healthRunId: completed.healthRunId,
        healthState: completed.healthState,
      });
    };
    await newer(80, 10);
    await newer(81, 11);
    await newer(82, 12);
    await newer(83, 13);

    const beforeRecovery = await retention.listRoutineNoSessionGcInventory({
      before: new Date(baseTime.valueOf() + 5_000_000),
      limit: 5_000,
    });
    expect(
      beforeRecovery.find((item) => item.runId === failedRun.healthRunId)
        ?.reason,
    ).toBe("INCIDENT_PROCESSING_PENDING");
    expect(
      await retention.pruneRoutineNoSessionPayload({
        runId: failedRun.healthRunId,
        before: new Date(baseTime.valueOf() + 5_000_000),
      }),
    ).toEqual({
      status: "BLOCKED",
      reason: "INCIDENT_PROCESSING_PENDING",
    });

    const duplicate = await completion.completeScheduledNoSessionHealthRun(
      persistenceInput(failedSchedule.id, failedObservation),
    );
    expect(duplicate.healthRunId).toBe(failedRun.healthRunId);
    expect(duplicate.incident.action).toBe("OPENED");

    const processedReceipt = await runtime.query<{
      incidentProcessedAt: Date | null;
    }>(
      `SELECT incident_processed_at AS "incidentProcessedAt"
       FROM health_no_session_run_receipts WHERE run_id=$1`,
      [failedRun.healthRunId],
    );
    expect(processedReceipt.rows[0]?.incidentProcessedAt).toBeInstanceOf(Date);

    const afterRecovery = await retention.listRoutineNoSessionGcInventory({
      before: new Date(baseTime.valueOf() + 5_000_000),
      limit: 5_000,
    });
    expect(
      afterRecovery.find((item) => item.runId === failedRun.healthRunId)
        ?.reason,
    ).toBe("INCIDENT_PINNED");
  });

  it("keeps incident/notification evidence and terminal no-replay state outside routine GC", async () => {
    const brokenSchedule = await makeScheduledRun({ started: true });
    const broken = observation(76, {
      strategyId: "chatgpt-standard-retention-v1",
      classification: "BROKEN",
      classificationBasis: "BROWSER_FAILURE",
      surfaceOutcome: "BROWSER_FAILURE",
      blocker: "BROWSER_UNAVAILABLE",
    });
    const completed = await completion.completeScheduledNoSessionHealthRun(
      persistenceInput(brokenSchedule.id, broken),
    );
    expect(completed.incident.action).toBe("OPENED");
    await scheduler.reconcilePersistedResults(
      new Date(baseTime.valueOf() + 3_100_000),
    );

    const notification = await runtime.query<{
      count: string;
      state: string;
    }>(
      `SELECT count(*)::text AS count,min(state::text) AS state
       FROM health_notification_intents WHERE health_run_id=$1`,
      [completed.healthRunId],
    );
    expect(notification.rows[0]).toEqual({ count: "1", state: "PENDING" });

    const inventory = await retention.listRoutineNoSessionGcInventory({
      before: new Date(baseTime.valueOf() + 4_000_000),
      limit: 5_000,
    });
    expect(
      inventory.find((item) => item.runId === completed.healthRunId)?.reason,
    ).toBe("INCIDENT_PINNED");
    expect(
      await retention.pruneRoutineNoSessionPayload({
        runId: completed.healthRunId,
        before: new Date(baseTime.valueOf() + 4_000_000),
      }),
    ).toEqual({ status: "BLOCKED", reason: "INCIDENT_PINNED" });

    const notificationSchedule = await makeScheduledRun({ started: true });
    const notificationObservation = observation(77, {
      classification: "UNKNOWN",
    });
    const notificationRun =
      await completion.completeScheduledNoSessionHealthRun(
        persistenceInput(notificationSchedule.id, notificationObservation),
      );
    expect(notificationRun.incident.action).toBe("IGNORED");
    const notificationRunning = await scheduler.getScheduledRun(
      notificationSchedule.id,
    );
    if (!notificationRunning?.ownerId || !notificationRunning.leaseId)
      throw new Error("RETENTION_NOTIFICATION_TEST_RUN_NOT_OWNED");
    await scheduler.finishSuccess({
      runId: notificationSchedule.id,
      ownerId: notificationRunning.ownerId,
      leaseId: notificationRunning.leaseId,
      now: new Date(Date.parse(notificationObservation.observedAt) + 2_000),
      healthRunId: notificationRun.healthRunId,
      healthState: notificationRun.healthState,
    });
    await runtime.query(
      `INSERT INTO health_notification_intents(
        dedup_key,source_domain,incident_id,health_run_id,event_kind,severity,route_key,state,
        group_count,first_observed_at,latest_observed_at,cooldown_until,next_attempt_at,payload
      ) VALUES($1,'LLM_HEALTH',$2,$3,'INCIDENT_ESCALATED','WARNING','TELEGRAM','PENDING',
        1,$4,$4,$4,$4,'{}'::jsonb)`,
      [
        `retention-notification-${notificationRun.healthRunId}`,
        completed.incident.incidentIds[0]!,
        notificationRun.healthRunId,
        new Date(notificationObservation.observedAt),
      ],
    );
    const notificationInventory =
      await retention.listRoutineNoSessionGcInventory({
        before: new Date(baseTime.valueOf() + 4_000_000),
        limit: 5_000,
      });
    expect(
      notificationInventory.find(
        (item) => item.runId === notificationRun.healthRunId,
      )?.reason,
    ).toBe("NOTIFICATION_PINNED");

    const persistedTerminalSchedule = await makeScheduledRun({ started: true });
    const persistedTerminalObservation = observation(78);
    const persistedTerminalRun =
      await persistence.persistCompletedNoSessionHealthRun(
        persistenceInput(
          persistedTerminalSchedule.id,
          persistedTerminalObservation,
        ),
      );
    await runtime.query(
      `UPDATE health_scheduled_runs SET
        state='FAILED_TERMINAL',finished_at=$2,owner_id=NULL,lease_id=NULL,
        lease_expires_at=NULL,next_attempt_at=NULL,health_run_id=NULL,
        failure_class='TRANSIENT_ENVIRONMENT',
        failure_code='AUTHENTICATED_DEEP_PERSISTENCE_REJECTED'
       WHERE id=$1`,
      [
        persistedTerminalSchedule.id,
        new Date(Date.parse(persistedTerminalObservation.observedAt) + 2_000),
      ],
    );
    expect(
      await metadataRetention.retireTerminalScheduledRun({
        scheduledRunId: persistedTerminalSchedule.id,
        before: new Date(
          Date.parse(persistedTerminalObservation.observedAt) + 10_000,
        ),
      }),
    ).toEqual({
      status: "BLOCKED",
      reason: "PERSISTED_RESULT_PRESENT",
    });
    expect(
      await runtime.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM health_runs WHERE id=$1",
        [persistedTerminalRun.healthRunId],
      ),
    ).toMatchObject({ rows: [{ count: "1" }] });

    const uncertainSchedule = await makeScheduledRun({ started: true });
    const running = await scheduler.getScheduledRun(uncertainSchedule.id);
    if (!running?.ownerId || !running.leaseId)
      throw new Error("RETENTION_SEND_UNCERTAIN_TEST_RUN_NOT_OWNED");
    const uncertain = await scheduler.finishFailure({
      runId: uncertainSchedule.id,
      ownerId: running.ownerId,
      leaseId: running.leaseId,
      now: new Date(uncertainSchedule.dueSlotAt.valueOf() + 60_000),
      failureClass: "TRANSIENT_ENVIRONMENT",
      failureCode: "SEND_UNCERTAIN",
    });
    expect(uncertain).toMatchObject({
      state: "FAILED_TERMINAL",
      failureCode: "SEND_UNCERTAIN",
      healthRunId: null,
    });
    const uncertainReceipt = await runtime.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM health_no_session_run_receipts
       WHERE scheduled_run_id=$1`,
      [uncertainSchedule.id],
    );
    expect(uncertainReceipt.rows[0]?.count).toBe("0");
    expect((await scheduler.getScheduledRun(uncertainSchedule.id))?.state).toBe(
      "FAILED_TERMINAL",
    );
    await expect(
      runtime.query("DELETE FROM health_scheduled_runs WHERE id=$1", [
        uncertainSchedule.id,
      ]),
    ).rejects.toBeInstanceOf(Error);
    await expect(
      runtime.query(
        "UPDATE health_scheduled_runs SET schedule_revision=schedule_revision+1 WHERE id=$1",
        [uncertainSchedule.id],
      ),
    ).rejects.toBeInstanceOf(Error);

    const terminalRetired = await metadataRetention.retireTerminalScheduledRun({
      scheduledRunId: uncertainSchedule.id,
      before: new Date(uncertain.finishedAt!.valueOf() + 1),
    });
    expect(terminalRetired).toEqual({
      status: "RETIRED",
      reason: "RETIRED",
    });
    expect(
      await scheduler.getScheduledRun(uncertainSchedule.id),
    ).toBeUndefined();

    await runtime.query(
      "UPDATE health_schedules SET next_due_at=$2 WHERE id=$1",
      [uncertainSchedule.scheduleId, uncertainSchedule.dueSlotAt],
    );
    expect(
      await scheduler.materializeDueSlot(
        uncertainSchedule.scheduleId,
        new Date(uncertainSchedule.dueSlotAt.valueOf() + 1),
      ),
    ).toBeNull();
    const uncertainReplay = await runtime.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM health_scheduled_runs
       WHERE schedule_id=$1 AND schedule_revision=$2 AND due_slot_at=$3`,
      [
        uncertainSchedule.scheduleId,
        uncertainSchedule.scheduleRevision,
        uncertainSchedule.dueSlotAt,
      ],
    );
    expect(uncertainReplay.rows[0]?.count).toBe("0");
  });
});
