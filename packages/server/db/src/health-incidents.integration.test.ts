import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BASELINE_HEALTH_SUITE,
  HealthContourResultSchema,
  validateHealthSuiteDefinition,
  type HealthContourResult,
  type HealthSuiteDefinition,
} from "@product/health";
import {
  createDatabaseRuntime,
  createHealthIncidentRepository,
  createHealthPersistenceRepository,
} from "./index.js";
import { runMigrations } from "./migrations.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const IDS = {
  adapter: "b7000000-0000-4000-8000-000000000001",
  surface: "b7000000-0000-4000-8000-000000000002",
  profile: "b7000000-0000-4000-8000-000000000003",
  profileRevision: "b7000000-0000-4000-8000-000000000004",
};

const runtime = createDatabaseRuntime(connectionString);
const workerA = createDatabaseRuntime(connectionString);
const workerB = createDatabaseRuntime(connectionString);
const persistence = createHealthPersistenceRepository(runtime);
const incidentsA = createHealthIncidentRepository(workerA);
const incidentsB = createHealthIncidentRepository(workerB);

function suiteFor(name: string): HealthSuiteDefinition {
  return validateHealthSuiteDefinition({
    ...BASELINE_HEALTH_SUITE,
    machineKey: name,
    scope: {
      ...BASELINE_HEALTH_SUITE.scope,
      adapterFamilyId: IDS.adapter,
      surfaceId: IDS.surface,
      profile: { id: IDS.profile, revision: 1 },
      healthSuite: { machineKey: name, revision: 1 },
    },
  });
}

function passedResults(suite: HealthSuiteDefinition): HealthContourResult[] {
  return suite.contours.map((definition) =>
    HealthContourResultSchema.parse({
      contourKey: definition.key,
      required: definition.required,
      failureSeverity: definition.failureSeverity,
      observationStatus: "PRESENT",
      primaryStrategyId: definition.primaryStrategyId,
      primaryStrategyOutcome: "PASS",
      fallbackStrategyOutcomes: [],
      selectedStrategyId: definition.primaryStrategyId,
      structuralOutcome: "PASS",
      behavioralOutcome: "PASS",
      fallbackQuality: "NOT_APPLICABLE",
      environmentStatus: "VALID",
      uncertaintyReason: null,
      evidence: [],
    }),
  );
}

function failureResults(
  suite: HealthSuiteDefinition,
  kind: "DRIFT" | "BROKEN",
): HealthContourResult[] {
  const base = passedResults(suite);
  const definition = suite.contours.find(
    (item) => item.key === "C05_SEND_CONTROL",
  );
  if (!definition) throw new Error("missing C05 fixture");
  const failure =
    kind === "DRIFT"
      ? HealthContourResultSchema.parse({
          ...base.find((item) => item.contourKey === definition.key),
          primaryStrategyOutcome: "FAIL",
          fallbackStrategyOutcomes: [
            { strategyId: definition.fallbackStrategyIds[0], outcome: "PASS" },
          ],
          selectedStrategyId: definition.fallbackStrategyIds[0],
          fallbackQuality: "APPROVED_EQUIVALENT",
        })
      : HealthContourResultSchema.parse({
          ...base.find((item) => item.contourKey === definition.key),
          primaryStrategyOutcome: "FAIL",
          fallbackStrategyOutcomes: [],
          selectedStrategyId: definition.primaryStrategyId,
          structuralOutcome: "FAIL",
          behavioralOutcome: "FAIL",
        });
  return [
    ...base.filter((item) => item.contourKey !== definition.key),
    failure,
  ];
}

function unknownResults(suite: HealthSuiteDefinition): HealthContourResult[] {
  const base = passedResults(suite);
  const result = base.find((item) => item.contourKey === "C13_BLOCKING_STATE");
  if (!result) throw new Error("missing C13 fixture");
  return [
    ...base.filter((item) => item.contourKey !== result.contourKey),
    HealthContourResultSchema.parse({
      ...result,
      primaryStrategyOutcome: "UNCERTAIN",
      fallbackStrategyOutcomes: [],
      selectedStrategyId: null,
      structuralOutcome: "UNCERTAIN",
      behavioralOutcome: "UNCERTAIN",
      fallbackQuality: "NOT_APPLICABLE",
      environmentStatus: "UNCERTAIN",
      uncertaintyReason: "LOGIN_EXPIRED",
    }),
  ];
}

async function persistRun(
  suite: HealthSuiteDefinition,
  completedAt: string,
  results: readonly unknown[],
  changes: Record<string, unknown> = {},
) {
  return persistence.persistCompletedHealthRun({
    suite,
    results,
    operatorMaintenance: false,
    operatorMaintenanceAuthority: null,
    healthLevel: "H3",
    classifierVersion: "incident-fixture-v1",
    startedAt: new Date(new Date(completedAt).valueOf() - 1_000),
    completedAt: new Date(completedAt),
    ...changes,
  });
}

describe.sequential(
  "S2-L6 Health incident lifecycle PostgreSQL authority",
  () => {
    beforeAll(async () => {
      await runtime.ready();
      await workerA.ready();
      await workerB.ready();
      await runtime.query("DROP SCHEMA IF EXISTS public CASCADE");
      await runtime.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
      await runtime.query("CREATE SCHEMA public");
      await runMigrations({ connectionString });
      await runtime.query(
        `INSERT INTO ai_adapters(id,machine_key,display_name) VALUES($1,'fixture-ai','Fixture AI')`,
        [IDS.adapter],
      );
      await runtime.query(
        `INSERT INTO ai_surfaces(id,adapter_id,machine_key,display_name) VALUES($1,$2,'contract','Contract')`,
        [IDS.surface, IDS.adapter],
      );
      await runtime.query(
        `INSERT INTO adapter_profiles(id,adapter_id,surface_id,machine_key,display_name) VALUES($1,$2,$3,'incident-fixture-profile','Incident fixture')`,
        [IDS.profile, IDS.adapter, IDS.surface],
      );
      await runtime.query(
        `INSERT INTO adapter_profile_revisions(id,profile_id,adapter_id,surface_id,revision,schema_version,state,content,compatibility_constraints,content_sha256) VALUES($1,$2,$3,$4,1,'adapter_profile_v1','DRAFT','{}'::jsonb,'{}'::jsonb,$5)`,
        [
          IDS.profileRevision,
          IDS.profile,
          IDS.adapter,
          IDS.surface,
          "0".repeat(64),
        ],
      );
    });

    afterAll(async () => {
      await Promise.all([runtime.close(), workerA.close(), workerB.close()]);
    });

    it("opens exactly one episode under independent PostgreSQL consumers", async () => {
      const suite = suiteFor("incident_concurrent_open");
      const first = await persistRun(
        suite,
        "2026-09-18T01:00:01.000Z",
        failureResults(suite, "BROKEN"),
      );
      const second = await persistRun(
        suite,
        "2026-09-18T01:00:02.000Z",
        failureResults(suite, "BROKEN"),
      );
      const [left, right] = await Promise.all([
        incidentsA.processCompletedHealthRun(first.id),
        incidentsB.processCompletedHealthRun(second.id),
      ]);
      expect(left.incidentIds[0]).toBe(right.incidentIds[0]);
      const rows = await incidentsA.listIncidents();
      const current = rows.filter(
        (row) =>
          row.incidentKeySha256 ===
          rows.find((item) => item.id === left.incidentIds[0])
            ?.incidentKeySha256,
      );
      expect(current).toHaveLength(1);
      expect([first.id, second.id]).toContain(current[0]?.firstSeenRunId);
      expect(current[0]?.latestSeenRunId).toBe(second.id);
      await expect(
        runtime.query(
          `INSERT INTO health_incidents(id,incident_scope_sha256,incident_key_sha256,scope_sha256,status,first_seen_run_id,latest_seen_run_id,root_contour_key,first_seen_at,last_seen_at,last_observed_run_id,last_observed_at) VALUES(gen_random_uuid(),$1,$2,$3,'OPEN',$4,$4,NULL,$5,$5,$4,$5)`,
          [
            current[0]!.incidentScopeSha256,
            current[0]!.incidentKeySha256,
            current[0]!.incidentScopeSha256,
            first.id,
            first.completedAt,
          ],
        ),
      ).rejects.toThrow();
    });

    it("replays runs, preserves first_seen, and ignores older failures", async () => {
      const suite = suiteFor("incident_replay_order");
      const first = await persistRun(
        suite,
        "2026-09-18T02:00:01.000Z",
        failureResults(suite, "DRIFT"),
      );
      const newer = await persistRun(
        suite,
        "2026-09-18T02:00:03.000Z",
        failureResults(suite, "DRIFT"),
      );
      const opened = await incidentsA.processCompletedHealthRun(first.id);
      const updated = await incidentsB.processCompletedHealthRun(newer.id);
      const replay = await incidentsA.processCompletedHealthRun(first.id);
      const incident = await incidentsA.getIncident(opened.incidentIds[0]!);
      expect(updated.action).toBe("UPDATED");
      expect(replay.action).toBe("IGNORED");
      expect(incident?.firstSeenRunId).toBe(first.id);
      expect(incident?.latestSeenRunId).toBe(newer.id);
      expect(incident?.lastSeenAt.toISOString()).toBe(
        "2026-09-18T02:00:03.000Z",
      );
    });

    it("persists recovery, rejects late old failure, and opens a new episode after recovery", async () => {
      const suite = suiteFor("incident_recovery");
      const failure = await persistRun(
        suite,
        "2026-09-18T03:00:01.000Z",
        failureResults(suite, "BROKEN"),
      );
      const healthy = await persistRun(
        suite,
        "2026-09-18T03:00:03.000Z",
        passedResults(suite),
      );
      const late = await persistRun(
        suite,
        "2026-09-18T03:00:02.000Z",
        failureResults(suite, "BROKEN"),
      );
      const fresh = await persistRun(
        suite,
        "2026-09-18T03:00:04.000Z",
        failureResults(suite, "BROKEN"),
      );
      const first = await incidentsA.processCompletedHealthRun(failure.id);
      expect(
        (await incidentsA.processCompletedHealthRun(healthy.id)).action,
      ).toBe("RESOLVED");
      expect(
        (await incidentsB.processCompletedHealthRun(healthy.id)).action,
      ).toBe("NOOP");
      expect((await incidentsA.processCompletedHealthRun(late.id)).action).toBe(
        "IGNORED",
      );
      const second = await incidentsB.processCompletedHealthRun(fresh.id);
      expect(second.action).toBe("OPENED");
      expect(second.incidentIds[0]).not.toBe(first.incidentIds[0]);
      const old = await incidentsA.getIncident(first.incidentIds[0]!);
      expect(old?.status).toBe("RESOLVED");
      expect(old?.resolvedByRunId).toBe(healthy.id);
    });

    it("does not let UNKNOWN resolve and does not create a maintenance incident", async () => {
      const unknownSuite = suiteFor("incident_unknown");
      const unknown = await persistRun(
        unknownSuite,
        "2026-09-18T04:00:01.000Z",
        unknownResults(unknownSuite),
      );
      expect(
        (await incidentsA.processCompletedHealthRun(unknown.id)).action,
      ).toBe("NOOP");
      expect(
        (await incidentsA.listIncidents()).some(
          (row) => row.firstSeenRunId === unknown.id,
        ),
      ).toBe(false);

      const maintenanceSuite = suiteFor("incident_maintenance");
      const maintenance = await persistRun(
        maintenanceSuite,
        "2026-09-18T04:00:02.000Z",
        passedResults(maintenanceSuite),
        { operatorMaintenance: true, operatorMaintenanceAuthority: "fixture" },
      );
      expect(
        (await incidentsB.processCompletedHealthRun(maintenance.id)).action,
      ).toBe("NOOP");
    });

    it("moves an existing automatic episode through maintenance and recovery", async () => {
      const suite = suiteFor("incident_maintenance_lifecycle");
      const failure = await persistRun(
        suite,
        "2026-09-18T04:30:01.000Z",
        failureResults(suite, "BROKEN"),
      );
      const maintenance = await persistRun(
        suite,
        "2026-09-18T04:30:02.000Z",
        passedResults(suite),
        { operatorMaintenance: true, operatorMaintenanceAuthority: "fixture" },
      );
      const healthy = await persistRun(
        suite,
        "2026-09-18T04:30:04.000Z",
        passedResults(suite),
      );
      const opened = await incidentsA.processCompletedHealthRun(failure.id);
      expect(
        (await incidentsB.processCompletedHealthRun(maintenance.id)).action,
      ).toBe("MAINTENANCE");
      expect(
        (await incidentsA.getIncident(opened.incidentIds[0]!))?.status,
      ).toBe("MAINTENANCE");
      expect(
        (await incidentsA.processCompletedHealthRun(healthy.id)).action,
      ).toBe("RESOLVED");
      expect(
        (await incidentsB.getIncident(opened.incidentIds[0]!))?.resolvedByRunId,
      ).toBe(healthy.id);
    });

    it("preserves manual workflow status and false-positive history", async () => {
      const suite = suiteFor("incident_manual");
      const first = await persistRun(
        suite,
        "2026-09-18T05:00:01.000Z",
        failureResults(suite, "BROKEN"),
      );
      const opened = await incidentsA.processCompletedHealthRun(first.id);
      await runtime.query(
        `UPDATE health_incidents SET status='INVESTIGATING' WHERE id=$1`,
        [opened.incidentIds[0]],
      );
      const repeated = await persistRun(
        suite,
        "2026-09-18T05:00:02.000Z",
        failureResults(suite, "BROKEN"),
      );
      await incidentsB.processCompletedHealthRun(repeated.id);
      expect(
        (await incidentsA.getIncident(opened.incidentIds[0]!))?.status,
      ).toBe("INVESTIGATING");
      await runtime.query(
        `UPDATE health_incidents SET status='FALSE_POSITIVE' WHERE id=$1`,
        [opened.incidentIds[0]],
      );
      const later = await persistRun(
        suite,
        "2026-09-18T05:00:03.000Z",
        failureResults(suite, "BROKEN"),
      );
      const fresh = await incidentsA.processCompletedHealthRun(later.id);
      expect(fresh.action).toBe("OPENED");
      expect(fresh.incidentIds[0]).not.toBe(opened.incidentIds[0]);
      expect(
        (await incidentsB.getIncident(opened.incidentIds[0]!))?.status,
      ).toBe("FALSE_POSITIVE");
    });

    it("links lifecycle only through immutable Health runs and leaves evidence unchanged", async () => {
      const suite = suiteFor("incident_evidence");
      const evidenceId = "b7000000-0000-4000-8000-000000000099";
      const results = failureResults(suite, "BROKEN");
      const c05 = results.find(
        (item) => item.contourKey === "C05_SEND_CONTROL",
      );
      if (!c05) throw new Error("missing C05 fixture");
      const withEvidence = results.map((item) =>
        item === c05
          ? {
              ...item,
              evidence: [
                {
                  evidenceId,
                  ruleId: "SAFE_ELEMENT_METADATA",
                  classification: "METADATA",
                  sha256: null,
                  sizeBytes: null,
                },
              ],
            }
          : item,
      );
      const run = await persistRun(
        suite,
        "2026-09-18T06:00:01.000Z",
        withEvidence,
      );
      const before = await persistence.listEvidenceReferences(run.id);
      const processed = await incidentsA.processCompletedHealthRun(run.id);
      const after = await persistence.listEvidenceReferences(run.id);
      const incident = await incidentsA.getIncident(processed.incidentIds[0]!);
      expect(after).toEqual(before);
      expect(incident?.firstSeenRunId).toBe(run.id);
      expect(incident?.latestSeenRunId).toBe(run.id);
    });
  },
);
