import {
  AdapterProfileContentV1Schema,
  PersistedProfileRevisionSchema,
  validateProfileContent,
} from "@product/adapter-registry";
import {
  BASELINE_HEALTH_SUITE,
  HealthContourResultSchema,
  evaluateH4Candidate,
  makeEvaluationIdentity,
} from "@product/health";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseRuntime } from "./index.js";
import { createHealthEvaluationRepository } from "./health-evaluation-repository.js";
import { runMigrations } from "./migrations.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const ids = {
  adapter: "d7000000-0000-4000-8000-000000000001",
  surface: "d7000000-0000-4000-8000-000000000002",
  profile: "d7000000-0000-4000-8000-000000000003",
  baseline: "d7000000-0000-4000-8000-000000000004",
  candidate: "d7000000-0000-4000-8000-000000000005",
};
const runtime = createDatabaseRuntime(connectionString);
const repository = createHealthEvaluationRepository(runtime);

function candidateProfile() {
  const plan = (
    strategy:
      | "conversation_root"
      | "composer_root"
      | "send_control"
      | "assistant_response",
    reference:
      | "conversation-root"
      | "composer-root"
      | "send-control"
      | "assistant-response",
  ) => ({
    strategy,
    primary: { kind: "packaged_selector_reference" as const, reference },
    fallbacks: [],
    timeoutMs: 1_000,
    observationMode: "polling" as const,
  });
  const content = AdapterProfileContentV1Schema.parse({
    schemaVersion: "adapter_profile_v1",
    page: {
      identityStrategy: "page_identity",
      conversationStrategy: "conversation_root",
      composerStrategy: "composer_root",
    },
    selectors: {
      conversation: plan("conversation_root", "conversation-root"),
      composer: plan("composer_root", "composer-root"),
      send: plan("send_control", "send-control"),
      assistantResponse: plan("assistant_response", "assistant-response"),
    },
    observation: { mode: "polling", intervalMs: 500 },
    contours: [
      {
        key: "page_identity",
        required: true,
        expectedState: "PRESENT",
        strategy: "page_identity",
      },
      {
        key: "conversation_root",
        required: true,
        expectedState: "PRESENT",
        strategy: "conversation_root",
      },
      {
        key: "composer_root",
        required: true,
        expectedState: "PRESENT",
        strategy: "composer_root",
      },
      {
        key: "send_control",
        required: true,
        expectedState: "INTERACTIVE",
        strategy: "send_control",
      },
    ],
  });
  const compatibility = {
    schemaVersion: "profile_compatibility_v1",
    contractVersion: "control_plane_v1",
    browserFamilies: ["chrome"],
    minimumBrowserVersions: [
      { browserFamily: "chrome", minimumVersion: "120.0.0.0" },
    ],
    minimumExtensionVersion: "1.0.0",
  } as const;
  return PersistedProfileRevisionSchema.parse({
    id: ids.candidate,
    profileId: ids.profile,
    adapterId: ids.adapter,
    surfaceId: ids.surface,
    variantId: null,
    revision: 2,
    schemaVersion: "adapter_profile_v1",
    state: "CANDIDATE",
    content,
    compatibility,
    contentSha256: validateProfileContent({ content, compatibility })
      .contentSha256,
    createdAt: new Date("2026-09-18T00:00:00.000Z"),
    publishedAt: null,
    createdByAdminPrincipalId: null,
    publishedByAdminPrincipalId: null,
  });
}

function evaluation() {
  const identity = makeEvaluationIdentity({
    provider: "chatgpt",
    surface: "CHATGPT_STANDARD",
    target: "chatgpt-standard",
    variant: null,
    monitoringLayer: "NO_SESSION",
    baselineProfileRevisionId: ids.baseline,
    candidateProfileRevisionId: ids.candidate,
    healthSuiteMachineKey: "db-h4-suite",
    healthSuiteRevision: 1,
    phase: "H4_CANDIDATE",
    browserFamily: "chrome",
    browserVersion: "120.0.0.0",
    environmentClass: "DISPOSABLE_NO_SESSION",
  });
  const contourResults = BASELINE_HEALTH_SUITE.contours.map((definition) =>
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
  const scope = (profileRevisionId: string) => ({
    provider: "chatgpt",
    surface: "CHATGPT_STANDARD",
    target: "chatgpt-standard",
    variant: null,
    monitoringLayer: "NO_SESSION" as const,
    browserFamily: "chrome" as const,
    browserVersion: "120.0.0.0",
    environmentClass: "DISPOSABLE_NO_SESSION",
    healthSuiteMachineKey: "db-h4-suite",
    healthSuiteRevision: 1,
    profileRevisionId,
  });
  return evaluateH4Candidate({
    identity,
    candidateProfile: candidateProfile(),
    baseline: {
      executionId: "d7000000-0000-4000-8000-000000000101",
      scope: scope(ids.baseline),
      state: "HEALTHY",
      operatorMaintenance: false,
      contours: contourResults,
      evidence: [],
      evaluatedAt: new Date("2026-09-18T01:00:00.000Z"),
    },
    candidate: {
      executionId: "d7000000-0000-4000-8000-000000000102",
      scope: scope(ids.candidate),
      state: "HEALTHY",
      operatorMaintenance: false,
      contours: contourResults,
      evidence: [],
      evaluatedAt: new Date("2026-09-18T01:00:00.000Z"),
    },
  });
}

describe.sequential("S2-L7 Health evaluation PostgreSQL authority", () => {
  beforeAll(async () => {
    await runtime.ready();
    await runtime.query("DROP SCHEMA IF EXISTS public CASCADE");
    await runtime.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await runtime.query("CREATE SCHEMA public");
    await runMigrations({ connectionString });
    await runtime.query(
      "INSERT INTO ai_adapters(id,machine_key,display_name) VALUES($1,'eval-fixture','Evaluation fixture')",
      [ids.adapter],
    );
    await runtime.query(
      "INSERT INTO ai_surfaces(id,adapter_id,machine_key,display_name) VALUES($1,$2,'eval-surface','Evaluation surface')",
      [ids.surface, ids.adapter],
    );
    await runtime.query(
      "INSERT INTO adapter_profiles(id,adapter_id,surface_id,machine_key,display_name) VALUES($1,$2,$3,'eval-profile','Evaluation profile')",
      [ids.profile, ids.adapter, ids.surface],
    );
    await runtime.query(
      "INSERT INTO adapter_profile_revisions(id,profile_id,adapter_id,surface_id,revision,schema_version,state,content,compatibility_constraints,content_sha256) VALUES($1,$2,$3,$4,1,'adapter_profile_v1','DRAFT','{}'::jsonb,'{}'::jsonb,$5),($6,$2,$3,$4,2,'adapter_profile_v1','DRAFT','{}'::jsonb,'{}'::jsonb,$5)",
      [
        ids.baseline,
        ids.profile,
        ids.adapter,
        ids.surface,
        "0".repeat(64),
        ids.candidate,
      ],
    );
    await runtime.query(
      "INSERT INTO health_schedules(id,monitor_target,provider,surface,probe_layer,enabled,cadence,next_due_at,revision) VALUES($1,'eval_target','chatgpt','CHATGPT_STANDARD','NO_SESSION',true,'{}'::jsonb,now(),1)",
      ["d7000000-0000-4000-8000-000000000201"],
    );
  });

  afterAll(async () => runtime.close());

  it("adds evaluation storage without losing existing scheduler/profile authority", async () => {
    const result = await runtime.query<{
      scheduler: string;
      profile: string;
      evaluation: string;
    }>(
      "SELECT (SELECT count(*)::text FROM health_schedules) AS scheduler,(SELECT count(*)::text FROM adapter_profile_revisions) AS profile,(SELECT count(*)::text FROM health_profile_evaluations) AS evaluation",
    );
    expect(result.rows[0]).toEqual({
      scheduler: "1",
      profile: "2",
      evaluation: "0",
    });
  });

  it("is idempotent for duplicate logical evaluation creation", async () => {
    const first = await repository.upsertEvaluationResult(evaluation());
    const second = await repository.upsertEvaluationResult(evaluation());
    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(second.record.id).toBe(first.record.id);
  });

  it("protects newest evaluation observation from stale replay", async () => {
    const original = evaluation();
    const newer = {
      ...original,
      candidate: {
        ...original.candidate,
        executionId: "d7000000-0000-4000-8000-000000000103",
        evaluatedAt: new Date("2026-09-18T02:00:00.000Z"),
      },
      evaluatedAt: new Date("2026-09-18T02:00:00.000Z"),
      executionIds: [
        original.executionIds[0]!,
        "d7000000-0000-4000-8000-000000000103",
      ],
    };
    const applied = await repository.upsertEvaluationResult(newer);
    const stale = await repository.upsertEvaluationResult(original);
    expect(applied.applied).toBe(true);
    expect(stale.applied).toBe(false);
    expect(stale.record.latestExecutionId).toBe(
      "d7000000-0000-4000-8000-000000000103",
    );
  });

  it("serializes concurrent creators through PostgreSQL uniqueness", async () => {
    await runtime.query("DELETE FROM health_profile_evaluations");
    const runtime2 = createDatabaseRuntime(connectionString!);
    try {
      const repository2 = createHealthEvaluationRepository(runtime2);
      const concurrent = await Promise.all([
        repository.upsertEvaluationResult(evaluation()),
        repository2.upsertEvaluationResult(evaluation()),
      ]);
      expect(concurrent.filter((item) => item.applied)).toHaveLength(1);
      expect(new Set(concurrent.map((item) => item.record.id)).size).toBe(1);
    } finally {
      await runtime2.close();
    }
  });
});
