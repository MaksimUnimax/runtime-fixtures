import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NoSessionObservationResultSchema } from "@product/health";
import {
  createDatabaseRuntime,
  createHealthRetentionRepository,
  NO_SESSION_RETENTION_MIN_AGE_MS,
  noSessionRetentionScopeSha256,
  normalizedNoSessionResultSha256,
  type DatabaseQuery,
  type DatabaseRuntime,
} from "./index.js";
import { migrationsFolder, runMigrations } from "./migrations.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const IDS = {
  adapter: "d4000000-0000-4000-8000-000000000001",
  surface: "d4000000-0000-4000-8000-000000000002",
  profile: "d4000000-0000-4000-8000-000000000003",
  revision: "d4000000-0000-4000-8000-000000000004",
  schedule: "d4000000-0000-4000-8000-000000000005",
  scheduledRun: "d4000000-0000-4000-8000-000000000006",
  healthRun: "d4000000-0000-4000-8000-000000000007",
} as const;
const startedAt = new Date("2026-09-27T00:00:00.000Z");
const observedAt = new Date("2026-09-27T00:00:01.000Z");
const completedAt = new Date("2026-09-27T00:00:02.000Z");
const dueSlotAt = new Date("2026-09-27T00:00:00.000Z");
const scopeSha256 = "b".repeat(64);
const callbackSha256 = "c".repeat(64);

let runtime: DatabaseRuntime;
let prefixDirectory = "";

function legacyObservation(
  input: {
    observedAt?: Date;
    classification?: "HEALTHY" | "BROKEN";
    composerCount?: number;
  } = {},
) {
  const classification = input.classification ?? "HEALTHY";
  const currentObservedAt = input.observedAt ?? observedAt;
  return NoSessionObservationResultSchema.parse({
    providerId: "chatgpt",
    surfaceId: "CHATGPT_STANDARD",
    targetKey: "nosession_chatgpt_standard",
    strategyId: "chatgpt-standard-upgrade-v1",
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
        blocker: classification === "BROKEN" ? "BROWSER_UNAVAILABLE" : "NONE",
        classification,
        surfaceOutcome:
          classification === "BROKEN"
            ? "BROWSER_FAILURE"
            : "PUBLIC_INTERACTIVE",
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
    blocker: classification === "BROKEN" ? "BROWSER_UNAVAILABLE" : "NONE",
    classification,
    classificationBasis:
      classification === "BROKEN"
        ? "BROWSER_FAILURE"
        : "PUBLIC_SURFACE_PRIMARY",
    surfaceOutcome:
      classification === "BROKEN" ? "BROWSER_FAILURE" : "PUBLIC_INTERACTIVE",
    readiness: "APP_HYDRATED",
    elementMetadata: {
      composer: {
        elementCount: input.composerCount ?? 1,
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
    observedAt: currentObservedAt.toISOString(),
    evidence: [],
  });
}

async function makePrefixDirectory() {
  prefixDirectory = await mkdtemp(join(tmpdir(), "health-retention-0051-"));
  await cp(migrationsFolder, prefixDirectory, { recursive: true });
  await rm(join(prefixDirectory, "0052_monitoring_bounded_retention.sql"), {
    force: true,
  });
  const journalPath = join(prefixDirectory, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
    entries: unknown[];
  };
  journal.entries = journal.entries.slice(0, 40);
  await writeFile(journalPath, JSON.stringify(journal, null, 2) + "\n");
}

async function seedLegacyNoSessionRun() {
  const observation = legacyObservation();
  await runtime.query(
    `INSERT INTO ai_adapters(id,machine_key,display_name) VALUES($1,'chatgpt','ChatGPT')`,
    [IDS.adapter],
  );
  await runtime.query(
    `INSERT INTO ai_surfaces(id,adapter_id,machine_key,display_name) VALUES($1,$2,'standard','Standard')`,
    [IDS.surface, IDS.adapter],
  );
  await runtime.query(
    `INSERT INTO adapter_profiles(id,adapter_id,surface_id,machine_key,display_name)
     VALUES($1,$2,$3,'chatgpt-standard-upgrade-v1','Upgrade profile')`,
    [IDS.profile, IDS.adapter, IDS.surface],
  );
  await runtime.query(
    `INSERT INTO adapter_profile_revisions(
      id,profile_id,adapter_id,surface_id,revision,schema_version,state,content,
      compatibility_constraints,content_sha256
    ) VALUES($1,$2,$3,$4,1,'adapter_profile_v1','DRAFT','{}'::jsonb,$5::jsonb,$6)`,
    [
      IDS.revision,
      IDS.profile,
      IDS.adapter,
      IDS.surface,
      JSON.stringify({ browserFamilies: ["chrome"] }),
      "1".repeat(64),
    ],
  );
  await runtime.query(
    "UPDATE adapter_profile_revisions SET state='CANDIDATE' WHERE id=$1",
    [IDS.revision],
  );
  await runtime.query(
    "UPDATE adapter_profile_revisions SET state='PUBLISHED',published_at=$2 WHERE id=$1",
    [IDS.revision, startedAt],
  );
  await runtime.query(
    `INSERT INTO health_schedules(
      id,monitor_target,provider,surface,probe_layer,enabled,cadence,next_due_at,revision
    ) VALUES($1,'nosession_chatgpt_standard','chatgpt','CHATGPT_STANDARD','NO_SESSION',true,$2::jsonb,$3,1)`,
    [
      IDS.schedule,
      JSON.stringify({
        intervalSeconds: 21600,
        timeoutSeconds: 180,
        maxAttempts: 3,
        retryPolicyVersion: "health-retry-v1",
      }),
      new Date(dueSlotAt.valueOf() + 21_600_000),
    ],
  );
  await runtime.query(
    `INSERT INTO health_scheduled_runs(
      id,schedule_id,monitor_target,provider,surface,probe_layer,schedule_revision,due_slot_at,
      idempotency_key,state,attempt,started_at,finished_at,health_state
    ) VALUES($1,$2,'nosession_chatgpt_standard','chatgpt','CHATGPT_STANDARD','NO_SESSION',1,$3,$4,'SUCCEEDED',1,$5,$6,'HEALTHY')`,
    [
      IDS.scheduledRun,
      IDS.schedule,
      dueSlotAt,
      "d".repeat(64),
      startedAt,
      completedAt,
    ],
  );
  const scope = {
    schemaVersion: "health_no_session_scope_v1",
    monitoringLayer: "NO_SESSION",
    provider: "chatgpt",
    adapterMachineKey: "chatgpt",
    surface: "CHATGPT_STANDARD",
    surfaceMachineKey: "standard",
    variant: "default",
    adapterId: IDS.adapter,
    surfaceId: IDS.surface,
    variantId: null,
    profileId: IDS.profile,
    profileMachineKey: "chatgpt-standard-upgrade-v1",
    profileRevisionId: IDS.revision,
    profileRevision: 1,
    browserFamily: "chrome",
    browserVersion: "153.0.0.0",
    targetKey: "nosession_chatgpt_standard",
    strategyId: "chatgpt-standard-upgrade-v1",
    strategyRevision: 1,
  };
  await runtime.query(
    `INSERT INTO health_runs(
      id,run_kind,suite_revision_id,adapter_id,surface_id,variant_id,profile_id,profile_revision_id,
      profile_revision,browser_family,browser_version,extension_version,adapter_engine_version,
      scheduled_run_id,health_level,health_state,classifier_version,scope,scope_sha256,
      operator_maintenance,started_at,completed_at
    ) VALUES($1,'NO_SESSION_OBSERVATION',NULL,$2,$3,NULL,$4,$5,1,'chrome','153.0.0.0',
      NULL,NULL,$6,'H2','HEALTHY','upgrade-fixture-v1',$7::jsonb,$8,false,$9,$10)`,
    [
      IDS.healthRun,
      IDS.adapter,
      IDS.surface,
      IDS.profile,
      IDS.revision,
      IDS.scheduledRun,
      JSON.stringify(scope),
      scopeSha256,
      startedAt,
      completedAt,
    ],
  );
  await runtime.query(
    `INSERT INTO health_no_session_observations(
      run_id,provider_id,observation_surface_id,target_key,strategy_id,strategy_revision,
      classification,classification_basis,surface_outcome,blocker,observed_at,result_sha256,observation
    ) VALUES($1,'chatgpt','CHATGPT_STANDARD','nosession_chatgpt_standard',
      'chatgpt-standard-upgrade-v1',1,'HEALTHY','PUBLIC_SURFACE_PRIMARY',
      'PUBLIC_INTERACTIVE','NONE',$2,$3,$4::jsonb)`,
    [IDS.healthRun, observedAt, callbackSha256, JSON.stringify(observation)],
  );
  await runtime.query(
    "UPDATE health_scheduled_runs SET health_run_id=$2 WHERE id=$1",
    [IDS.scheduledRun, IDS.healthRun],
  );
}

async function seedAdditionalLegacyRun(input: {
  scheduledRunId: string;
  healthRunId: string;
  dueSlotAt: Date;
  observation: ReturnType<typeof legacyObservation>;
  idempotencyHex: string;
  callbackHex: string;
}) {
  const runStartedAt = new Date(input.dueSlotAt.valueOf() + 500);
  const runCompletedAt = new Date(
    Date.parse(input.observation.observedAt) + 1_000,
  );
  await runtime.query(
    `INSERT INTO health_scheduled_runs(
      id,schedule_id,monitor_target,provider,surface,probe_layer,schedule_revision,due_slot_at,
      idempotency_key,state,attempt,started_at,finished_at,health_state
    ) VALUES($1,$2,'nosession_chatgpt_standard','chatgpt','CHATGPT_STANDARD','NO_SESSION',1,$3,$4,'SUCCEEDED',1,$5,$6,$7)`,
    [
      input.scheduledRunId,
      IDS.schedule,
      input.dueSlotAt,
      input.idempotencyHex.repeat(64),
      runStartedAt,
      runCompletedAt,
      input.observation.classification,
    ],
  );
  const scope = (
    await runtime.query<{ scope: unknown }>(
      "SELECT scope FROM health_runs WHERE id=$1",
      [IDS.healthRun],
    )
  ).rows[0]?.scope;
  if (!scope) throw new Error("RETENTION_UPGRADE_SCOPE_MISSING");
  await runtime.query(
    `INSERT INTO health_runs(
      id,run_kind,suite_revision_id,adapter_id,surface_id,variant_id,profile_id,profile_revision_id,
      profile_revision,browser_family,browser_version,extension_version,adapter_engine_version,
      scheduled_run_id,health_level,health_state,classifier_version,scope,scope_sha256,
      operator_maintenance,started_at,completed_at
    ) VALUES($1,'NO_SESSION_OBSERVATION',NULL,$2,$3,NULL,$4,$5,1,'chrome','153.0.0.0',
      NULL,NULL,$6,'H2',$7,'upgrade-fixture-v1',$8::jsonb,$9,false,$10,$11)`,
    [
      input.healthRunId,
      IDS.adapter,
      IDS.surface,
      IDS.profile,
      IDS.revision,
      input.scheduledRunId,
      input.observation.classification,
      JSON.stringify(scope),
      scopeSha256,
      runStartedAt,
      runCompletedAt,
    ],
  );
  await runtime.query(
    `INSERT INTO health_no_session_observations(
      run_id,provider_id,observation_surface_id,target_key,strategy_id,strategy_revision,
      classification,classification_basis,surface_outcome,blocker,observed_at,result_sha256,observation
    ) VALUES($1,'chatgpt','CHATGPT_STANDARD','nosession_chatgpt_standard',
      'chatgpt-standard-upgrade-v1',1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [
      input.healthRunId,
      input.observation.classification,
      input.observation.classificationBasis,
      input.observation.surfaceOutcome,
      input.observation.blocker,
      new Date(input.observation.observedAt),
      input.callbackHex.repeat(64),
      JSON.stringify(input.observation),
    ],
  );
  await runtime.query(
    "UPDATE health_scheduled_runs SET health_run_id=$2 WHERE id=$1",
    [input.scheduledRunId, input.healthRunId],
  );
  return { runStartedAt, runCompletedAt };
}

describe.sequential("monitoring retention 0051 -> 0052 upgrade", () => {
  beforeAll(async () => {
    runtime = createDatabaseRuntime(connectionString);
    await runtime.ready();
    await makePrefixDirectory();
  });

  afterAll(async () => {
    await runtime.close();
    if (prefixDirectory)
      await rm(prefixDirectory, { recursive: true, force: true });
  });

  it("backfills durable receipts and compact projection from a real 0051 legacy row", async () => {
    await runtime.query("DROP SCHEMA IF EXISTS public CASCADE");
    await runtime.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await runtime.query("CREATE SCHEMA public");

    await runMigrations({
      connectionString,
      migrationsDirectory: prefixDirectory,
    });
    const prefixCount = await runtime.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM drizzle."__drizzle_migrations"',
    );
    expect(prefixCount.rows[0]?.count).toBe("40");
    expect(
      (
        await runtime.query<{ relation: string | null }>(
          "SELECT to_regclass('health_no_session_run_receipts')::text AS relation",
        )
      ).rows[0]?.relation,
    ).toBeNull();

    await seedLegacyNoSessionRun();
    await runMigrations({ connectionString });
    await runMigrations({ connectionString });

    const receipt = await runtime.query<{
      runId: string;
      scheduledRunId: string;
      callbackResultSha256: string;
      projectionAppliedAt: Date | null;
    }>(
      `SELECT run_id AS "runId",scheduled_run_id AS "scheduledRunId",
        callback_result_sha256 AS "callbackResultSha256",
        projection_applied_at AS "projectionAppliedAt"
       FROM health_no_session_run_receipts WHERE run_id=$1`,
      [IDS.healthRun],
    );
    expect(receipt.rows[0]).toMatchObject({
      runId: IDS.healthRun,
      scheduledRunId: IDS.scheduledRun,
      callbackResultSha256: callbackSha256,
      projectionAppliedAt: null,
    });

    const retention = createHealthRetentionRepository(runtime);
    expect(
      await retention.backfillNoSessionCompactProjection({
        limit: 10,
        projectedAt: new Date("2026-09-28T00:00:00.000Z"),
      }),
    ).toBe(1);
    expect(
      await retention.backfillNoSessionCompactProjection({
        limit: 10,
        projectedAt: new Date("2026-09-28T00:00:01.000Z"),
      }),
    ).toBe(0);

    const retentionScopeSha256 = noSessionRetentionScopeSha256(
      {
        browserFamily: "chrome",
        profileRevisionId: IDS.revision,
        profileRevision: 1,
      },
      legacyObservation(),
    );

    const state = await runtime.query<{
      latestRunId: string;
      latestHealthState: string;
      acceptedBaselineRunId: string | null;
    }>(
      `SELECT latest_run_id AS "latestRunId",latest_health_state AS "latestHealthState",
        accepted_baseline_run_id AS "acceptedBaselineRunId"
       FROM health_no_session_scope_states WHERE scope_sha256=$1`,
      [retentionScopeSha256],
    );
    expect(state.rows[0]).toEqual({
      latestRunId: IDS.healthRun,
      latestHealthState: "HEALTHY",
      acceptedBaselineRunId: null,
    });
    const recent = await runtime.query<{ count: string; repeatCount: number }>(
      `SELECT count(*)::text AS count,max(repeat_count)::int AS "repeatCount"
       FROM health_no_session_recent_states WHERE scope_sha256=$1`,
      [retentionScopeSha256],
    );
    expect(recent.rows[0]).toEqual({ count: "1", repeatCount: 1 });

    const migrationCount = await runtime.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM drizzle."__drizzle_migrations"',
    );
    expect(migrationCount.rows[0]?.count).toBe("41");
  });

  it("reconciles legacy incidents silently, pages past pins, and prunes eligible old payload", async () => {
    await runtime.query("DROP SCHEMA IF EXISTS public CASCADE");
    await runtime.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await runtime.query("CREATE SCHEMA public");
    await runMigrations({
      connectionString,
      migrationsDirectory: prefixDirectory,
    });

    await seedLegacyNoSessionRun();
    const healthy2Run = "d4000000-0000-4000-8000-000000000017";
    const brokenRun = "d4000000-0000-4000-8000-000000000027";
    const healthy3Run = "d4000000-0000-4000-8000-000000000037";
    const healthy2Scheduled = "d4000000-0000-4000-8000-000000000016";
    const brokenScheduled = "d4000000-0000-4000-8000-000000000026";
    const healthy3Scheduled = "d4000000-0000-4000-8000-000000000036";

    const healthy2Observation = legacyObservation({
      observedAt: new Date("2026-09-27T06:00:01.000Z"),
    });
    const brokenObservation = legacyObservation({
      observedAt: new Date("2026-09-27T12:00:01.000Z"),
      classification: "BROKEN",
    });
    const healthy3Observation = legacyObservation({
      observedAt: new Date("2026-09-27T18:00:01.000Z"),
    });

    await seedAdditionalLegacyRun({
      scheduledRunId: healthy2Scheduled,
      healthRunId: healthy2Run,
      dueSlotAt: new Date("2026-09-27T06:00:00.000Z"),
      observation: healthy2Observation,
      idempotencyHex: "e",
      callbackHex: "2",
    });
    await seedAdditionalLegacyRun({
      scheduledRunId: brokenScheduled,
      healthRunId: brokenRun,
      dueSlotAt: new Date("2026-09-27T12:00:00.000Z"),
      observation: brokenObservation,
      idempotencyHex: "f",
      callbackHex: "3",
    });
    await seedAdditionalLegacyRun({
      scheduledRunId: healthy3Scheduled,
      healthRunId: healthy3Run,
      dueSlotAt: new Date("2026-09-27T18:00:00.000Z"),
      observation: healthy3Observation,
      idempotencyHex: "a",
      callbackHex: "4",
    });

    await runMigrations({ connectionString });
    const receipts = await runtime.query<{
      count: string;
      incidentProcessed: string;
    }>(
      `SELECT count(*)::text AS count,
        count(incident_processed_at)::text AS "incidentProcessed"
       FROM health_no_session_run_receipts`,
    );
    expect(receipts.rows[0]).toEqual({
      count: "4",
      incidentProcessed: "0",
    });

    const firstRetention = createHealthRetentionRepository(runtime);
    expect(
      await firstRetention.backfillNoSessionCompactProjection({
        limit: 2,
        projectedAt: new Date("2026-09-28T00:00:00.000Z"),
      }),
    ).toBe(2);
    const restartedProjection = createHealthRetentionRepository(runtime);
    expect(
      await restartedProjection.backfillNoSessionCompactProjection({
        limit: 10,
        projectedAt: new Date("2026-09-28T00:00:01.000Z"),
      }),
    ).toBe(2);
    expect(
      await restartedProjection.backfillNoSessionCompactProjection({
        limit: 10,
        projectedAt: new Date("2026-09-28T00:00:02.000Z"),
      }),
    ).toBe(0);

    const retentionScopeSha256 = noSessionRetentionScopeSha256(
      {
        browserFamily: "chrome",
        profileRevisionId: IDS.revision,
        profileRevision: 1,
      },
      legacyObservation(),
    );
    const healthyFingerprint =
      normalizedNoSessionResultSha256(legacyObservation());
    await runtime.query(
      `UPDATE health_no_session_scope_states SET
        accepted_baseline_run_id=$2,
        accepted_baseline_result_sha256=$3,
        accepted_baseline_health_state='HEALTHY',
        accepted_baseline_at=$4
       WHERE scope_sha256=$1`,
      [retentionScopeSha256, IDS.healthRun, healthyFingerprint, observedAt],
    );

    let injectedCrash = false;
    const crashingRuntime: DatabaseRuntime = {
      db: runtime.db,
      ready: () => runtime.ready(),
      close: async () => undefined,
      query: async <
        Row extends Record<string, unknown> = Record<string, unknown>,
      >(
        text: string,
        values?: unknown[],
      ) => {
        if (
          !injectedCrash &&
          text.includes("SET incident_processed_at=COALESCE") &&
          values?.[0] === brokenRun
        ) {
          injectedCrash = true;
          throw new Error("TEST_LEGACY_INCIDENT_MARKER_CRASH");
        }
        return runtime.query<Row>(text, values);
      },
      transaction: <T>(operation: (transaction: DatabaseQuery) => Promise<T>) =>
        runtime.transaction(operation),
    };
    const crashingRetention = createHealthRetentionRepository(crashingRuntime);
    await expect(
      crashingRetention.reconcileLegacyNoSessionIncidentProcessing({
        limit: 10,
        processedAt: new Date("2026-09-28T01:00:00.000Z"),
      }),
    ).rejects.toThrow("TEST_LEGACY_INCIDENT_MARKER_CRASH");

    const crashBoundary = await runtime.query<{
      incidentProcessedAt: Date | null;
      incidentCount: string;
      notificationCount: string;
    }>(
      `SELECT
        (SELECT incident_processed_at FROM health_no_session_run_receipts WHERE run_id=$1)
          AS "incidentProcessedAt",
        (SELECT count(*)::text FROM health_incidents) AS "incidentCount",
        (SELECT count(*)::text FROM health_notification_intents) AS "notificationCount"`,
      [brokenRun],
    );
    expect(crashBoundary.rows[0]).toEqual({
      incidentProcessedAt: null,
      incidentCount: "1",
      notificationCount: "0",
    });

    const restartedRetention = createHealthRetentionRepository(runtime);
    expect(
      (
        await restartedRetention.reconcileLegacyNoSessionIncidentProcessing({
          limit: 10,
          processedAt: new Date("2026-09-28T01:00:01.000Z"),
        })
      ).processed,
    ).toBe(2);
    expect(
      (
        await restartedRetention.reconcileLegacyNoSessionIncidentProcessing({
          limit: 10,
          processedAt: new Date("2026-09-28T01:00:02.000Z"),
        })
      ).processed,
    ).toBe(0);

    const historicalOutcome = await runtime.query<{
      incidentCount: string;
      status: string;
      resolvedByRunId: string | null;
      notificationCount: string;
      markedCount: string;
    }>(
      `SELECT
        (SELECT count(*)::text FROM health_incidents) AS "incidentCount",
        (SELECT status::text FROM health_incidents LIMIT 1) AS status,
        (SELECT resolved_by_run_id FROM health_incidents LIMIT 1) AS "resolvedByRunId",
        (SELECT count(*)::text FROM health_notification_intents) AS "notificationCount",
        (SELECT count(incident_processed_at)::text FROM health_no_session_run_receipts)
          AS "markedCount"`,
    );
    expect(historicalOutcome.rows[0]).toEqual({
      incidentCount: "1",
      status: "RESOLVED",
      resolvedByRunId: healthy3Run,
      notificationCount: "0",
      markedCount: "4",
    });

    const before = new Date("2026-09-28T00:00:00.000Z");
    const safeNow = new Date(
      before.valueOf() + NO_SESSION_RETENTION_MIN_AGE_MS + 1_000,
    );
    const tooRecentRetention = createHealthRetentionRepository(runtime, {
      clock: () =>
        new Date(before.valueOf() + NO_SESSION_RETENTION_MIN_AGE_MS - 1),
    });
    const cleanupRetention = createHealthRetentionRepository(runtime, {
      clock: () => safeNow,
    });
    await expect(
      tooRecentRetention.listRoutineNoSessionGcInventory({
        before,
        limit: 1,
      }),
    ).rejects.toThrow("HEALTH_RETENTION_CUTOFF_TOO_RECENT");

    const firstPage = await cleanupRetention.listRoutineNoSessionGcInventory({
      before,
      limit: 1,
    });
    expect(firstPage).toHaveLength(1);
    expect(firstPage[0]).toMatchObject({
      runId: IDS.healthRun,
      reason: "ACCEPTED_BASELINE_PINNED",
    });
    const secondPage = await cleanupRetention.listRoutineNoSessionGcInventory({
      before,
      cursor: {
        completedAt: firstPage[0]!.completedAt,
        runId: firstPage[0]!.runId,
      },
      limit: 1,
    });
    expect(secondPage).toHaveLength(1);
    expect(secondPage[0]).toMatchObject({
      runId: healthy2Run,
      reason: "ELIGIBLE",
    });

    expect(
      await cleanupRetention.pruneRoutineNoSessionPayload({
        runId: healthy2Run,
        before,
      }),
    ).toEqual({ status: "PRUNED", reason: "ELIGIBLE" });
    const pruned = await runtime.query<{
      runCount: string;
      observationCount: string;
      receiptCount: string;
    }>(
      `SELECT
        (SELECT count(*)::text FROM health_runs WHERE id=$1) AS "runCount",
        (SELECT count(*)::text FROM health_no_session_observations WHERE run_id=$1)
          AS "observationCount",
        (SELECT count(*)::text FROM health_no_session_run_receipts WHERE run_id=$1)
          AS "receiptCount"`,
      [healthy2Run],
    );
    expect(pruned.rows[0]).toEqual({
      runCount: "0",
      observationCount: "0",
      receiptCount: "1",
    });
  });
});
