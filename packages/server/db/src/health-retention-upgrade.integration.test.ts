import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NoSessionObservationResultSchema } from "@product/health";
import {
  createDatabaseRuntime,
  createHealthRetentionRepository,
  noSessionRetentionScopeSha256,
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

function legacyObservation() {
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
});
