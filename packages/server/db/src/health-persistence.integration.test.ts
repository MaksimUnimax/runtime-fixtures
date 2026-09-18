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
  createHealthPersistenceRepository,
} from "./index.js";
import { runMigrations } from "./migrations.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const IDS = {
  adapter: "b5000000-0000-4000-8000-000000000001",
  surface: "b5000000-0000-4000-8000-000000000002",
  profile: "b5000000-0000-4000-8000-000000000003",
  profileRevision: "b5000000-0000-4000-8000-000000000004",
  variant: "b5000000-0000-4000-8000-000000000005",
};

const runtime = createDatabaseRuntime(connectionString);
const repository = createHealthPersistenceRepository(runtime);

const COLLISION_EVIDENCE_ID = "00000000-0000-4000-8000-000000000010";
const DUPLICATE_EVIDENCE_ID = "00000000-0000-4000-8000-000000000011";

function suiteWithScope(
  changes: Partial<HealthSuiteDefinition["scope"]> = {},
): HealthSuiteDefinition {
  const fixtureScope = {
    ...BASELINE_HEALTH_SUITE.scope,
    adapterFamilyId: IDS.adapter,
    surfaceId: IDS.surface,
    profile: { id: IDS.profile, revision: 1 },
    healthSuite: { machineKey: "b5-health-fixture", revision: 1 },
  };
  return validateHealthSuiteDefinition({
    ...BASELINE_HEALTH_SUITE,
    machineKey: "b5-health-fixture",
    scope: { ...fixtureScope, ...changes },
  });
}

function suiteRevision(revision: number): HealthSuiteDefinition {
  const fixture = suiteWithScope();
  return validateHealthSuiteDefinition({
    ...fixture,
    revision,
    scope: {
      ...fixture.scope,
      healthSuite: {
        machineKey: fixture.machineKey,
        revision,
      },
    },
  });
}

function passedResults(suite = BASELINE_HEALTH_SUITE): HealthContourResult[] {
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

function resultWith(
  key: HealthContourResult["contourKey"],
  changes: Partial<HealthContourResult>,
): HealthContourResult {
  const result = passedResults().find((item) => item.contourKey === key);
  if (!result) throw new Error(`missing fixture contour ${key}`);
  return HealthContourResultSchema.parse({ ...result, ...changes });
}

function input(
  suite: unknown = suiteWithScope(),
  results: readonly unknown[] = passedResults(),
  changes: Record<string, unknown> = {},
) {
  return {
    suite,
    results,
    operatorMaintenance: false,
    operatorMaintenanceAuthority: null,
    healthLevel: "H3",
    classifierVersion: "p8.1-classifier-v1",
    startedAt: new Date("2026-09-12T10:00:00.000Z"),
    completedAt: new Date("2026-09-12T10:00:01.000Z"),
    ...changes,
  };
}

async function countPersistedRowsForSuite(suite: HealthSuiteDefinition) {
  const result = await runtime.query<{
    suiteRows: string;
    runRows: string;
    contourRows: string;
    evidenceRows: string;
  }>(
    `WITH target_suite AS (
       SELECT id FROM health_suite_revisions WHERE machine_key=$1 AND revision=$2
     ), target_runs AS (
       SELECT r.id FROM health_runs r JOIN target_suite s ON s.id=r.suite_revision_id
     )
     SELECT
       (SELECT count(*)::text FROM target_suite) AS "suiteRows",
       (SELECT count(*)::text FROM target_runs) AS "runRows",
       (SELECT count(*)::text FROM health_contour_results c JOIN target_runs r ON r.id=c.run_id) AS "contourRows",
       (SELECT count(*)::text FROM health_evidence_references e JOIN target_runs r ON r.id=e.run_id) AS "evidenceRows"`,
    [suite.machineKey, suite.revision],
  );
  const row = result.rows[0];
  if (!row) throw new Error("MISSING_PERSISTENCE_COUNT_FIXTURE");
  return row;
}

describe("P8.2 health persistence", () => {
  beforeAll(async () => {
    await runtime.ready();
    await runtime.query("DROP SCHEMA IF EXISTS public CASCADE");
    await runtime.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await runtime.query("CREATE SCHEMA public");
    await runMigrations({ connectionString: connectionString! });
    await runtime.query(
      `INSERT INTO ai_adapters(id,machine_key,display_name) VALUES($1,'fixture-ai','Fixture AI')`,
      [IDS.adapter],
    );
    await runtime.query(
      `INSERT INTO ai_surfaces(id,adapter_id,machine_key,display_name) VALUES($1,$2,'contract','Contract')`,
      [IDS.surface, IDS.adapter],
    );
    await runtime.query(
      `INSERT INTO adapter_profiles(id,adapter_id,surface_id,machine_key,display_name) VALUES($1,$2,$3,'fixture-profile','Fixture profile')`,
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

  afterAll(async () => runtime.close());

  it("persists and exactly reuses a validated suite revision", async () => {
    const first = await repository.persistHealthSuiteRevision(
      BASELINE_HEALTH_SUITE,
    );
    const second = await repository.persistHealthSuiteRevision(
      BASELINE_HEALTH_SUITE,
    );
    expect(second).toEqual(first);
    expect(first.definitionSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(
      await repository.getSuiteRevision(
        BASELINE_HEALTH_SUITE.machineKey,
        BASELINE_HEALTH_SUITE.revision,
      ),
    ).toEqual(first);
  });

  it("rejects an invalid suite and a conflicting immutable revision", async () => {
    await expect(
      repository.persistHealthSuiteRevision({
        ...BASELINE_HEALTH_SUITE,
        revision: 0,
      }),
    ).rejects.toThrow();
    await expect(
      repository.persistHealthSuiteRevision({
        ...BASELINE_HEALTH_SUITE,
        description: "different definition",
      }),
    ).rejects.toThrow("HEALTH_SUITE_REVISION_CONFLICT");
  });

  it("enforces a positive suite revision in PostgreSQL", async () => {
    await expect(
      runtime.query(
        `INSERT INTO health_suite_revisions(machine_key,revision,suite_kind,definition,definition_sha256) VALUES('invalid-suite',0,'BASELINE_CONTRACT_FIXTURE','{}'::jsonb,$1)`,
        ["0".repeat(64)],
      ),
    ).rejects.toThrow();
  });

  it.each([
    ["HEALTHY", passedResults(), false],
    [
      "DRIFT",
      (() => {
        const result = resultWith("C05_SEND_CONTROL", {
          primaryStrategyOutcome: "FAIL",
          fallbackStrategyOutcomes: [
            { strategyId: "COMPOSER_ACTION_CONTROL", outcome: "PASS" },
          ],
          selectedStrategyId: "COMPOSER_ACTION_CONTROL",
          fallbackQuality: "APPROVED_EQUIVALENT",
        });
        return [
          ...passedResults().filter(
            (item) => item.contourKey !== result.contourKey,
          ),
          result,
        ];
      })(),
      false,
    ],
    [
      "BROKEN",
      (() => {
        const result = resultWith("C09_COMMAND_CODE_BLOCK_SURFACE", {
          primaryStrategyOutcome: "FAIL",
          fallbackStrategyOutcomes: [
            { strategyId: "CODE_BLOCK_DISCOVERY", outcome: "FAIL" },
          ],
          selectedStrategyId: null,
          structuralOutcome: "FAIL",
          behavioralOutcome: "FAIL",
        });
        return [
          ...passedResults().filter(
            (item) => item.contourKey !== result.contourKey,
          ),
          result,
        ];
      })(),
      false,
    ],
    [
      "UNKNOWN",
      (() => {
        const result = resultWith("C13_BLOCKING_STATE", {
          environmentStatus: "UNCERTAIN",
          uncertaintyReason: "LOGIN_EXPIRED",
        });
        return [
          ...passedResults().filter(
            (item) => item.contourKey !== result.contourKey,
          ),
          result,
        ];
      })(),
      false,
    ],
    ["MAINTENANCE", passedResults(), true],
  ] as const)(
    "persists classifier-derived %s state",
    async (expected, results, maintenance) => {
      const run = await repository.persistCompletedHealthRun(
        input(suiteWithScope(), results, {
          operatorMaintenance: maintenance,
          operatorMaintenanceAuthority: maintenance ? "health-operator" : null,
        }),
      );
      expect(run.healthState).toBe(expected);
      expect((await repository.getHealthRun(run.id))?.healthState).toBe(
        expected,
      );
    },
  );

  it("rejects a caller-provided authoritative state", async () => {
    await expect(
      repository.persistCompletedHealthRun({
        ...input(),
        healthState: "BROKEN",
      } as never),
    ).rejects.toThrow("UNSUPPORTED_HEALTH_RUN_FIELD:healthState");
  });

  it.each([
    "DUPLICATE_CONTOUR_RESULT",
    "UNKNOWN_CONTOUR_RESULT",
    "MISSING_REQUIRED_CONTOUR_RESULT",
    "SELECTED_FALLBACK_NOT_DECLARED",
  ])("rejects %s before persistence", async (errorCode) => {
    let results: HealthContourResult[] = passedResults();
    if (errorCode === "DUPLICATE_CONTOUR_RESULT")
      results = [...results, results[0]!];
    if (errorCode === "UNKNOWN_CONTOUR_RESULT") {
      results = [
        ...results.filter(
          (result) => result.contourKey !== "C13_BLOCKING_STATE",
        ),
        {
          ...results[0]!,
          contourKey: "C13_BLOCKING_STATE",
        } as HealthContourResult,
      ];
    }
    if (errorCode === "MISSING_REQUIRED_CONTOUR_RESULT")
      results = results.filter(
        (result) => result.contourKey !== "C05_SEND_CONTROL",
      );
    if (errorCode === "SELECTED_FALLBACK_NOT_DECLARED") {
      results = results.map((result) =>
        result.contourKey === "C05_SEND_CONTROL"
          ? {
              ...result,
              primaryStrategyOutcome: "FAIL",
              fallbackStrategyOutcomes: [
                { strategyId: "CODE_BLOCK_DISCOVERY", outcome: "PASS" },
              ],
              selectedStrategyId: "CODE_BLOCK_DISCOVERY",
              fallbackQuality: "APPROVED_EQUIVALENT",
            }
          : result,
      );
    }
    if (errorCode === "UNKNOWN_CONTOUR_RESULT") {
      await expect(
        repository.persistCompletedHealthRun(input(suiteWithScope(), results)),
      ).rejects.toThrow();
    } else {
      await expect(
        repository.persistCompletedHealthRun(input(suiteWithScope(), results)),
      ).rejects.toThrow(errorCode);
    }
  });

  it("rejects P7 adapter/surface/variant/profile identity mismatches", async () => {
    await expect(
      repository.persistCompletedHealthRun(
        input(suiteWithScope({ adapterFamilyId: IDS.surface })),
      ),
    ).rejects.toThrow("P7_PROFILE_HIERARCHY_MISMATCH");
    await expect(
      repository.persistCompletedHealthRun(
        input(suiteWithScope({ surfaceId: IDS.adapter })),
      ),
    ).rejects.toThrow("P7_PROFILE_HIERARCHY_MISMATCH");
    await expect(
      repository.persistCompletedHealthRun(
        input(
          suiteWithScope({ variant: { id: IDS.variant, machineKey: "work" } }),
        ),
      ),
    ).rejects.toThrow("P7_PROFILE_HIERARCHY_MISMATCH");
    await expect(
      repository.persistCompletedHealthRun(
        input(suiteWithScope({ profile: { id: IDS.profile, revision: 99 } })),
      ),
    ).rejects.toThrow("P7_PROFILE_HIERARCHY_MISMATCH");
  });

  it("rejects a suite/scope identity mismatch and leaves no partial rows", async () => {
    const before = await runtime.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM health_runs`,
    );
    await expect(
      repository.persistCompletedHealthRun(
        input({
          ...suiteWithScope(),
          scope: {
            ...suiteWithScope().scope,
            healthSuite: {
              machineKey: suiteWithScope().machineKey,
              revision: 2,
            },
          },
        }),
      ),
    ).rejects.toThrow();
    const after = await runtime.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM health_runs`,
    );
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });

  it("rolls back suite, run, contours and evidence when a late evidence insert fails", async () => {
    const firstEvidence = {
      evidenceId: COLLISION_EVIDENCE_ID,
      ruleId: "SAFE_ELEMENT_METADATA" as const,
      classification: "METADATA" as const,
      sha256: null,
      sizeBytes: null,
    };
    const firstResult = resultWith("C05_SEND_CONTROL", {
      evidence: [firstEvidence],
    });
    const firstRun = await repository.persistCompletedHealthRun(
      input(suiteWithScope(), [
        ...passedResults().filter(
          (item) => item.contourKey !== firstResult.contourKey,
        ),
        firstResult,
      ]),
    );
    expect(await repository.getHealthRun(firstRun.id)).toEqual(firstRun);
    expect(await repository.listEvidenceReferences(firstRun.id)).toMatchObject([
      { evidenceId: COLLISION_EVIDENCE_ID },
    ]);

    const secondSuite = suiteRevision(2);
    const secondResult = resultWith("C05_SEND_CONTROL", {
      evidence: [firstEvidence],
    });
    await expect(
      repository.persistCompletedHealthRun(
        input(secondSuite, [
          ...passedResults(secondSuite).filter(
            (item) => item.contourKey !== secondResult.contourKey,
          ),
          secondResult,
        ]),
      ),
    ).rejects.toThrow(/duplicate key|unique/i);

    expect(await repository.getHealthRun(firstRun.id)).toEqual(firstRun);
    expect(await repository.listEvidenceReferences(firstRun.id)).toMatchObject([
      { evidenceId: COLLISION_EVIDENCE_ID },
    ]);
    expect(await countPersistedRowsForSuite(secondSuite)).toEqual({
      suiteRows: "0",
      runRows: "0",
      contourRows: "0",
      evidenceRows: "0",
    });
  });

  it("rejects duplicate evidence UUIDs in one completed-run result set and rolls back the transaction", async () => {
    const suite = suiteRevision(3);
    const duplicateEvidence = {
      evidenceId: DUPLICATE_EVIDENCE_ID,
      ruleId: "SAFE_ELEMENT_METADATA" as const,
      classification: "METADATA" as const,
      sha256: null,
      sizeBytes: null,
    };
    const firstResult = resultWith("C05_SEND_CONTROL", {
      evidence: [duplicateEvidence],
    });
    const secondResult = resultWith("C06_BUSY_STOP_STATE", {
      evidence: [duplicateEvidence],
    });
    const results = [
      ...passedResults(suite).filter(
        (item) =>
          item.contourKey !== firstResult.contourKey &&
          item.contourKey !== secondResult.contourKey,
      ),
      firstResult,
      secondResult,
    ];

    await expect(
      repository.persistCompletedHealthRun(input(suite, results)),
    ).rejects.toThrow("DUPLICATE_EVIDENCE_REFERENCE");
    expect(await countPersistedRowsForSuite(suite)).toEqual({
      suiteRows: "0",
      runRows: "0",
      contourRows: "0",
      evidenceRows: "0",
    });
  });

  it("persists safe evidence exactly and prevents arbitrary post-classification evidence", async () => {
    const evidenceId = "00000000-0000-4000-8000-000000000006";
    const result = resultWith("C05_SEND_CONTROL", {
      evidence: [
        {
          evidenceId,
          ruleId: "SAFE_ELEMENT_METADATA",
          classification: "METADATA",
          sha256: null,
          sizeBytes: null,
        },
      ],
    });
    const run = await repository.persistCompletedHealthRun(
      input(suiteWithScope(), [
        ...passedResults().filter(
          (item) => item.contourKey !== result.contourKey,
        ),
        result,
      ]),
    );
    const references = await repository.listEvidenceReferences(run.id);
    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({
      evidenceId,
      contourKey: "C05_SEND_CONTROL",
      ruleId: "SAFE_ELEMENT_METADATA",
      classification: "METADATA",
      sha256: null,
      sizeBytes: null,
    });
    await expect(
      runtime.query(
        `INSERT INTO health_evidence_references(evidence_id,run_id,contour_key,rule_id,classification) VALUES($1,$2,'C05_SEND_CONTROL','SAFE_ELEMENT_METADATA','METADATA')`,
        ["00000000-0000-4000-8000-000000000007", run.id],
      ),
    ).rejects.toThrow();
    await expect(
      runtime.query(
        `INSERT INTO health_evidence_references(evidence_id,run_id,contour_key,rule_id,classification) VALUES($1,$2,'C05_SEND_CONTROL','SAFE_ELEMENT_METADATA','METADATA')`,
        [evidenceId, run.id],
      ),
    ).rejects.toThrow();
    const columns = await runtime.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name='health_evidence_references'`,
    );
    expect(columns.rows.map((row) => row.column_name).sort()).toEqual([
      "classification",
      "contour_key",
      "created_at",
      "evidence_id",
      "rule_id",
      "run_id",
      "sha256",
      "size_bytes",
    ]);
  });

  it("has no rewrite path for suite revisions or completed runs", async () => {
    const suite = await repository.getSuiteRevision(
      BASELINE_HEALTH_SUITE.machineKey,
      1,
    );
    const run = await repository.persistCompletedHealthRun(input());
    await expect(
      runtime.query(
        `UPDATE health_suite_revisions SET definition_sha256=$1 WHERE id=$2`,
        ["1".repeat(64), suite!.id],
      ),
    ).rejects.toThrow();
    await expect(
      runtime.query(
        `UPDATE health_runs SET health_state='BROKEN' WHERE id=$1`,
        [run.id],
      ),
    ).rejects.toThrow();
  });

  it("enforces incident physical constraints without exposing lifecycle behavior", async () => {
    const run = await repository.persistCompletedHealthRun(input());
    await expect(
      runtime.query(
        `INSERT INTO health_incidents(scope_sha256,status,first_seen_run_id,latest_seen_run_id,first_seen_at,last_seen_at) VALUES($1,'OPEN',$2,$2,$3,$4)`,
        [
          "2".repeat(64),
          run.id,
          new Date("2026-09-12T10:00:02Z"),
          new Date("2026-09-12T10:00:01Z"),
        ],
      ),
    ).rejects.toThrow();
    await runtime.query(
      `INSERT INTO health_incidents(scope_sha256,status,first_seen_run_id,latest_seen_run_id,first_seen_at,last_seen_at) VALUES($1,'OPEN',$2,$2,$3,$4)`,
      [
        "3".repeat(64),
        run.id,
        new Date("2026-09-12T10:00:01Z"),
        new Date("2026-09-12T10:00:02Z"),
      ],
    );
  });

  it("creates a new random completed run for each caller retry", async () => {
    const first = await repository.persistCompletedHealthRun(input());
    const second = await repository.persistCompletedHealthRun(input());
    expect(first.id).not.toBe(second.id);
    expect(first.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(second.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
