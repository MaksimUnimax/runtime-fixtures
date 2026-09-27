import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_NO_SESSION_CADENCE,
  NoSessionObservationResultSchema,
  type NoSessionObservationResult,
} from "../../../packages/server/health/src/index.js";
import {
  createDatabaseRuntime,
  createHealthNoSessionCompletionAdapter,
  createHealthSchedulerRepository,
  createP7AdminAiCommandRepository,
  createProfileLifecycleRepository,
} from "@product/db";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";
import { executeScheduledNoSessionHealthRun } from "../../../apps/telegram-operator/src/health-runtime.js";
import {
  assertMonitorPilotSourceFingerprint,
  initializeMonitorPilotAuthorityForTest,
  MONITOR_PILOT_MANIFEST_SHA256,
  preflightMonitorPilotAuthority,
  preflightMonitorPilotAuthorityForTest,
} from "../../../tooling/server/monitor-pilot-authority.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const runtime = createDatabaseRuntime(connectionString);
const scheduler = createHealthSchedulerRepository(runtime);
const completion = createHealthNoSessionCompletionAdapter(runtime);
const baseTime = new Date("2026-09-27T12:00:00.000Z");
const target = {
  targetKey: "nosession_chatgpt_standard",
  providerId: "chatgpt",
  surfaceId: "CHATGPT_STANDARD",
  strategyId: "chatgpt-standard-public-v1",
};

function observation(): NoSessionObservationResult {
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
        blocker: "BROWSER_UNAVAILABLE",
        classification: "BROKEN",
        surfaceOutcome: "BROWSER_FAILURE",
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
    blocker: "BROWSER_UNAVAILABLE",
    classification: "BROKEN",
    classificationBasis: "BROWSER_FAILURE",
    surfaceOutcome: "BROWSER_FAILURE",
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
    observedAt: new Date(baseTime.valueOf() + 20_000).toISOString(),
    evidence: [
      {
        evidenceId: "c8000000-0000-4000-8000-000000000001",
        ruleId: "SAFE_ELEMENT_METADATA",
        classification: "METADATA",
        sha256: "b".repeat(64),
        sizeBytes: 64,
      },
    ],
  });
}

async function counts() {
  const result = await runtime.query<Record<string, string>>(`SELECT
    (SELECT count(*)::text FROM ai_adapters) AS adapters,
    (SELECT count(*)::text FROM ai_surfaces) AS surfaces,
    (SELECT count(*)::text FROM ai_variants) AS variants,
    (SELECT count(*)::text FROM adapter_profiles) AS profiles,
    (SELECT count(*)::text FROM adapter_profile_revisions) AS revisions,
    (SELECT count(*)::text FROM audit_events) AS audits,
    (SELECT count(*)::text FROM health_runs) AS health_runs,
    (SELECT count(*)::text FROM health_scheduled_runs) AS scheduled_runs`);
  return result.rows[0]!;
}

async function temporaryOpsPrincipal() {
  const userId = randomUUID();
  const principalId = randomUUID();
  await runtime.query("INSERT INTO users(id) VALUES($1)", [userId]);
  await runtime.query(
    "INSERT INTO admin_principals(id,user_id,status,revision) VALUES($1,$2,'ACTIVE',1)",
    [principalId, userId],
  );
  await runtime.query(
    "INSERT INTO admin_role_grants(admin_principal_id,role,granted_by_admin_principal_id) VALUES($1,'ADMIN_OPS',NULL)",
    [principalId],
  );
  return {
    principalId,
    userId,
    async close() {
      await runtime.query(
        `UPDATE admin_role_grants
            SET revoked_at=CURRENT_TIMESTAMP,revoked_by_admin_principal_id=$1
          WHERE admin_principal_id=$1 AND role='ADMIN_OPS' AND revoked_at IS NULL`,
        [principalId],
      );
      await runtime.query(
        "UPDATE admin_principals SET status='SUSPENDED',revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1",
        [principalId],
      );
      await runtime.query(
        "UPDATE users SET status='SUSPENDED',updated_at=CURRENT_TIMESTAMP WHERE id=$1",
        [userId],
      );
    },
  };
}

describe.sequential("isolated monitor pilot authority provisioning", () => {
  let identity: { expectedDatabaseName: string; expectedDatabaseRole: string };

  beforeAll(async () => {
    await runtime.ready();
    const actual = await runtime.query<{
      databaseName: string;
      databaseRole: string;
    }>(
      'SELECT current_database() AS "databaseName",current_user AS "databaseRole"',
    );
    identity = {
      expectedDatabaseName: actual.rows[0]!.databaseName,
      expectedDatabaseRole: actual.rows[0]!.databaseRole,
    };
    await runtime.query("DROP SCHEMA IF EXISTS public CASCADE");
    await runtime.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await runtime.query("CREATE SCHEMA public");
    await runMigrations({ connectionString });
  });

  afterAll(async () => runtime.close());

  it("rolls back catalog and temporary authority atomically on a mid-provision failure", async () => {
    await runtime.query(
      "CREATE FUNCTION b12_fail_work_surface() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.machine_key='work' THEN RAISE EXCEPTION 'B12_FORCED_MID_PROVISION_FAILURE'; END IF; RETURN NEW; END; $$",
    );
    await runtime.query(
      "CREATE TRIGGER b12_fail_work_surface_trigger BEFORE INSERT ON ai_surfaces FOR EACH ROW EXECUTE FUNCTION b12_fail_work_surface()",
    );
    try {
      await expect(
        initializeMonitorPilotAuthorityForTest(runtime, identity),
      ).rejects.toThrow("B12_FORCED_MID_PROVISION_FAILURE");
      expect(await counts()).toMatchObject({
        adapters: "0",
        surfaces: "0",
        variants: "0",
        profiles: "0",
        revisions: "0",
        audits: "0",
        health_runs: "0",
        scheduled_runs: "0",
      });
      const authority = await runtime.query<{
        users: string;
        principals: string;
        grants: string;
      }>(
        "SELECT (SELECT count(*)::text FROM users) AS users,(SELECT count(*)::text FROM admin_principals) AS principals,(SELECT count(*)::text FROM admin_role_grants) AS grants",
      );
      expect(authority.rows[0]).toEqual({
        users: "0",
        principals: "0",
        grants: "0",
      });
    } finally {
      await runtime.query(
        "DROP TRIGGER IF EXISTS b12_fail_work_surface_trigger ON ai_surfaces",
      );
      await runtime.query(
        "DROP FUNCTION IF EXISTS b12_fail_work_surface() CASCADE",
      );
    }
  });

  it("fails precise preflight before probe, provisions all nine, reruns idempotently, and persists a synthetic observation through the real completion path", async () => {
    await expect(
      preflightMonitorPilotAuthority(runtime, {
        expectedDatabaseRole: identity.expectedDatabaseRole,
      }),
    ).rejects.toThrow("MONITOR_PILOT_DATABASE_IDENTITY_MISMATCH");

    const empty = await preflightMonitorPilotAuthorityForTest(
      runtime,
      identity,
    );
    expect(empty.kind).toBe("MISSING_AUTHORITY");
    expect(empty.issues).toContainEqual({
      targetKey: target.targetKey,
      code: "NO_SESSION_PROVIDER_AUTHORITY_NOT_FOUND",
    });
    const probe = vi.fn();
    if (empty.kind === "READY") await probe();
    expect(probe).not.toHaveBeenCalled();

    const beforeWrongRole = await counts();
    await expect(
      preflightMonitorPilotAuthorityForTest(runtime, {
        ...identity,
        expectedDatabaseRole: `${identity.expectedDatabaseRole}_wrong`,
      }),
    ).rejects.toThrow("MONITOR_PILOT_DATABASE_ROLE_MISMATCH");
    expect(await counts()).toEqual(beforeWrongRole);

    const beforeDrift = await counts();
    expect(() => assertMonitorPilotSourceFingerprint("0".repeat(64))).toThrow(
      "MONITOR_PILOT_SOURCE_MANIFEST_DRIFT",
    );
    expect(await counts()).toEqual(beforeDrift);

    expect(
      await initializeMonitorPilotAuthorityForTest(runtime, identity),
    ).toEqual({ kind: "INITIALIZED", targets: 9 });
    expect(
      (await preflightMonitorPilotAuthorityForTest(runtime, identity)).kind,
    ).toBe("READY");

    const afterInit = await counts();
    expect(afterInit).toMatchObject({
      adapters: "8",
      surfaces: "9",
      variants: "0",
      profiles: "9",
      revisions: "9",
    });
    const bootstrapAuthority = await runtime.query<{
      activeGrants: string;
      activePrincipals: string;
      activeUsers: string;
      grantEvents: string;
      revokeEvents: string;
    }>(`SELECT
      (SELECT count(*)::text FROM admin_role_grants WHERE revoked_at IS NULL) AS "activeGrants",
      (SELECT count(*)::text FROM admin_principals WHERE status='ACTIVE') AS "activePrincipals",
      (SELECT count(*)::text FROM users WHERE status='ACTIVE') AS "activeUsers",
      (SELECT count(*)::text FROM audit_events WHERE action='MONITOR_PILOT_TECHNICAL_AUTHORITY_GRANTED') AS "grantEvents",
      (SELECT count(*)::text FROM audit_events WHERE action='MONITOR_PILOT_TECHNICAL_AUTHORITY_REVOKED') AS "revokeEvents"`);
    expect(bootstrapAuthority.rows[0]).toEqual({
      activeGrants: "0",
      activePrincipals: "0",
      activeUsers: "0",
      grantEvents: "1",
      revokeEvents: "1",
    });

    expect(
      await initializeMonitorPilotAuthorityForTest(runtime, identity),
    ).toEqual({ kind: "ALREADY_EXACT", targets: 9 });
    expect(await counts()).toEqual(afterInit);

    const scheduleId = "c8000000-0000-4000-8000-000000000010";
    const dueAt = new Date(baseTime.valueOf() + 10_000);
    await scheduler.createSchedule({
      scheduleId,
      monitorTarget: target.targetKey,
      provider: target.providerId,
      surface: target.surfaceId,
      probeLayer: "NO_SESSION",
      enabled: true,
      cadence: DEFAULT_NO_SESSION_CADENCE,
      nextDueAt: dueAt,
      revision: 1,
    });
    const due = await scheduler.materializeDueSlot(scheduleId, dueAt);
    expect(due).toBeDefined();
    const claimed = await scheduler.claimNext({
      ownerId: "monitor-pilot-integration",
      now: new Date(dueAt.valueOf() + 1),
      leaseMs: 300_000,
    });
    expect(claimed?.id).toBe(due?.id);
    const startedAt = new Date(dueAt.valueOf() + 2);
    const started = await scheduler.startRun({
      runId: due!.id,
      ownerId: claimed!.ownerId!,
      leaseId: claimed!.leaseId!,
      now: startedAt,
    });
    expect(started.state).toBe("RUNNING");

    let syntheticProbeCalls = 0;
    const result = await executeScheduledNoSessionHealthRun(started, {
      completion,
      clock: { now: () => new Date(baseTime.valueOf() + 20_000) },
      classifierVersion: "monitor-pilot-synthetic-v1",
      probe: async (candidate) => {
        syntheticProbeCalls += 1;
        expect(candidate.targetKey).toBe(target.targetKey);
        return observation();
      },
    });
    expect(syntheticProbeCalls).toBe(1);
    expect(result).toMatchObject({
      outcome: "SUCCEEDED",
      healthState: "BROKEN",
    });

    const binding = await runtime.query<{
      provider: string;
      surface: string;
      surfaceMachineKey: string;
      targetKey: string;
      strategyId: string;
      profileKey: string;
    }>(
      `SELECT h.scope->>'provider' AS provider,
              h.scope->>'surface' AS surface,
              h.scope->>'surfaceMachineKey' AS "surfaceMachineKey",
              h.scope->>'targetKey' AS "targetKey",
              h.scope->>'strategyId' AS "strategyId",
              p.machine_key AS "profileKey"
         FROM health_runs h
         JOIN adapter_profiles p ON p.id=h.profile_id
        WHERE h.scheduled_run_id=$1`,
      [due!.id],
    );
    expect(binding.rows).toEqual([
      {
        provider: target.providerId,
        surface: target.surfaceId,
        surfaceMachineKey: "standard",
        targetKey: target.targetKey,
        strategyId: target.strategyId,
        profileKey: target.strategyId,
      },
    ]);
    const sideEffects = await runtime.query<{
      runs: string;
      incidents: string;
      intents: string;
    }>(
      `SELECT
        (SELECT count(*)::text FROM health_runs WHERE scheduled_run_id=$1) AS runs,
        (SELECT count(*)::text FROM health_incidents WHERE first_seen_run_id=(SELECT id FROM health_runs WHERE scheduled_run_id=$1)) AS incidents,
        (SELECT count(*)::text FROM health_notification_intents WHERE health_run_id=(SELECT id FROM health_runs WHERE scheduled_run_id=$1)) AS intents`,
      [due!.id],
    );
    expect(sideEffects.rows[0]).toEqual({
      runs: "1",
      incidents: "1",
      intents: "1",
    });
    expect(MONITOR_PILOT_MANIFEST_SHA256).toHaveLength(64);
  });

  it("rejects disabled, ambiguous, and wrong-content authority without initializer writes", async () => {
    const admin = await temporaryOpsPrincipal();
    const registry = createP7AdminAiCommandRepository(runtime);
    const adapterRow = await runtime.query<{
      id: string;
      updatedAt: Date;
    }>(
      `SELECT id,updated_at AS "updatedAt"
         FROM ai_adapters WHERE machine_key='chatgpt'`,
    );
    const disabled = await registry.updateAdapter({
      id: adapterRow.rows[0]!.id,
      expectedUpdatedAt: adapterRow.rows[0]!.updatedAt,
      targetStatus: "DISABLED",
      actorId: admin.principalId,
      correlationId: randomUUID(),
      reason: "B12 disabled-authority negative fixture",
    });
    const beforeDisabledInit = await counts();
    await expect(
      initializeMonitorPilotAuthorityForTest(runtime, identity),
    ).rejects.toThrow("MONITOR_PILOT_CATALOG_CONFLICT");
    expect(await counts()).toEqual(beforeDisabledInit);
    await registry.updateAdapter({
      id: disabled.id,
      expectedUpdatedAt: disabled.updatedAt,
      targetStatus: "ACTIVE",
      actorId: admin.principalId,
      correlationId: randomUUID(),
      reason: "B12 restore disabled-authority fixture",
    });
    await admin.close();

    const profile = await runtime.query<{
      id: string;
      content: unknown;
      compatibility: unknown;
      revision: number;
    }>(
      `SELECT p.id,r.content,r.compatibility_constraints AS compatibility,r.revision
         FROM adapter_profiles p
         JOIN adapter_profile_revisions r ON r.profile_id=p.id
        WHERE p.machine_key=$1 AND r.state='PUBLISHED'
        ORDER BY r.revision LIMIT 1`,
      [target.strategyId],
    );
    const lifecycle = createProfileLifecycleRepository(runtime);
    const systemContext = (reason: string) => ({
      actorType: "SYSTEM" as const,
      correlationId: randomUUID(),
      reason,
    });

    const duplicate = await lifecycle.createDraftProfileRevision({
      profileId: profile.rows[0]!.id,
      content: profile.rows[0]!.content,
      compatibility: profile.rows[0]!.compatibility,
      context: systemContext("B12 ambiguous revision fixture"),
    });
    await lifecycle.markProfileRevisionCandidate({
      profileId: profile.rows[0]!.id,
      revision: duplicate.revision,
      context: systemContext("B12 ambiguous revision fixture"),
    });
    await lifecycle.publishProfileRevision({
      profileId: profile.rows[0]!.id,
      revision: duplicate.revision,
      context: systemContext("B12 ambiguous revision fixture"),
    });
    expect(
      (await preflightMonitorPilotAuthorityForTest(runtime, identity)).issues,
    ).toContainEqual({
      targetKey: target.targetKey,
      code: "NO_SESSION_PROFILE_REVISION_AUTHORITY_AMBIGUOUS",
    });
    const beforeAmbiguousInit = await counts();
    await expect(
      initializeMonitorPilotAuthorityForTest(runtime, identity),
    ).rejects.toThrow("MONITOR_PILOT_CATALOG_CONFLICT");
    expect(await counts()).toEqual(beforeAmbiguousInit);

    await lifecycle.retireProfileRevision({
      profileId: profile.rows[0]!.id,
      revision: duplicate.revision,
      context: systemContext("B12 retire ambiguous fixture"),
    });
    await lifecycle.retireProfileRevision({
      profileId: profile.rows[0]!.id,
      revision: profile.rows[0]!.revision,
      context: systemContext("B12 retire canonical fixture for mismatch test"),
    });
    const wrongContent = structuredClone(profile.rows[0]!.content) as {
      observation: { intervalMs: number };
    };
    wrongContent.observation.intervalMs = 1_100;
    const wrong = await lifecycle.createDraftProfileRevision({
      profileId: profile.rows[0]!.id,
      content: wrongContent,
      compatibility: profile.rows[0]!.compatibility,
      context: systemContext("B12 wrong content fixture"),
    });
    await lifecycle.markProfileRevisionCandidate({
      profileId: profile.rows[0]!.id,
      revision: wrong.revision,
      context: systemContext("B12 wrong content fixture"),
    });
    await lifecycle.publishProfileRevision({
      profileId: profile.rows[0]!.id,
      revision: wrong.revision,
      context: systemContext("B12 wrong content fixture"),
    });
    expect(
      (await preflightMonitorPilotAuthorityForTest(runtime, identity)).issues,
    ).toContainEqual({
      targetKey: target.targetKey,
      code: "MONITOR_PILOT_PROFILE_REVISION_CONTENT_MISMATCH",
    });
    const beforeWrongContentInit = await counts();
    await expect(
      initializeMonitorPilotAuthorityForTest(runtime, identity),
    ).rejects.toThrow("MONITOR_PILOT_CATALOG_CONFLICT");
    expect(await counts()).toEqual(beforeWrongContentInit);
  });
});
