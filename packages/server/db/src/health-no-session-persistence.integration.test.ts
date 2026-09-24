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
  createHealthNoSessionPersistenceRepository,
  createHealthSchedulerRepository,
} from "./index.js";
import { runMigrations } from "./migrations.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const IDS = {
  adapter: "c4000000-0000-4000-8000-000000000001",
  surface: "c4000000-0000-4000-8000-000000000002",
  profile: "c4000000-0000-4000-8000-000000000003",
  revision: "c4000000-0000-4000-8000-000000000004",
};
const runtime = createDatabaseRuntime(connectionString);
const scheduler = createHealthSchedulerRepository(runtime);
const persistence = createHealthNoSessionPersistenceRepository(runtime);
const incidents = createHealthIncidentRepository(runtime);
const admin = createHealthAdminReadRepository(runtime);
const baseTime = new Date("2026-09-23T12:00:00.000Z");

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
      requestedStartUrl: "https://chatgpt.com/",
      finalUrl: "https://chatgpt.com/",
      finalOrigin: "https://chatgpt.com/",
      mainDocumentHttpStatus: 200,
      redirectCount: 0,
      outcome: "LOADED",
    },
    finalOrigin: "https://chatgpt.com/",
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
});
