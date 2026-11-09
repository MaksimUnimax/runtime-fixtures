import { describe, expect, it, vi } from "vitest";
import {
  createHealthAdminReadService,
  evaluateH5,
  EvaluationIdentitySchema,
  EvaluationOutcomeSchema,
  HealthAdminEvaluationDetailSchema,
  HealthProfileEvaluationSummarySchema,
} from "@product/health";
import type { DatabaseRuntime } from "./index.js";
import { createHealthAdminReadRepository } from "./health-admin-read-repository.js";

const id = "00000000-0000-4000-8000-000000000001";
const baselineId = "00000000-0000-4000-8000-000000000101";
const candidateId = "00000000-0000-4000-8000-000000000102";
const targetId = "a".repeat(64);
const at = "2030-01-01T00:00:00.000Z";
const h4Outcomes = [
  "PASS", "FAIL", "INCONCLUSIVE", "ENVIRONMENT_BLOCKED",
  "INVALID_CANDIDATE", "NOT_APPLICABLE",
] as const;
const h5Cases = [
  ["H5_CANARY", "HEALTHY", "HEALTHY", false, "CANARY_ASSESSMENT", "CONTINUE"],
  ["H5_CANARY", "HEALTHY", "DRIFT", false, "CANARY_ASSESSMENT", "HOLD"],
  ["H5_CANARY", "HEALTHY", "DEGRADED", false, "CANARY_ASSESSMENT", "RESTRICT"],
  ["H5_CANARY", "HEALTHY", "BROKEN", false, "CANARY_ASSESSMENT", "ROLLBACK_RECOMMENDED"],
  ["H5_CANARY", "HEALTHY", "UNKNOWN", false, "CANARY_ASSESSMENT", "INCONCLUSIVE"],
  ["H5_CANARY", "HEALTHY", "HEALTHY", true, "INCONCLUSIVE", "INCONCLUSIVE"],
  ["H5_POST_ROLLOUT", "HEALTHY", "HEALTHY", false, "STABLE", "CONTINUE"],
  ["H5_POST_ROLLOUT", "HEALTHY", "BROKEN", false, "REGRESSION", "RESTRICT"],
  ["H5_POST_ROLLOUT", "DEGRADED", "HEALTHY", false, "RECOVERED", "CONTINUE"],
  ["H5_POST_ROLLOUT", "UNKNOWN", "HEALTHY", false, "INCONCLUSIVE", "INCONCLUSIVE"],
] as const;
type H5Case = readonly [
  "H5_CANARY" | "H5_POST_ROLLOUT", string, string, boolean, string, string,
];

function identity(phase: "H5_CANARY" | "H5_POST_ROLLOUT") {
  return {
    provider: "chatgpt", surface: "CHATGPT_WORK", target: "work", variant: "work",
    monitoringLayer: "NO_SESSION", baselineProfileRevisionId: baselineId,
    candidateProfileRevisionId: candidateId, healthSuiteMachineKey: "baseline-contract",
    healthSuiteRevision: 1, phase, browserFamily: "chrome",
    browserVersion: "120.0.0.0", environmentClass: "ci",
  };
}

function h5Row(input: H5Case, browserVersion = "120.0.0.0") {
  const [phase, before, after, maintenance] = input;
  const scope = { ...identity(phase), browserVersion };
  function snapshot(profileRevisionId: string, state: string, operatorMaintenance: boolean) {
    return {
      executionId: profileRevisionId,
      scope: {
        provider: scope.provider, surface: scope.surface, target: scope.target,
        variant: scope.variant, monitoringLayer: scope.monitoringLayer,
        browserFamily: scope.browserFamily, browserVersion: scope.browserVersion,
        environmentClass: scope.environmentClass,
        healthSuiteMachineKey: scope.healthSuiteMachineKey,
        healthSuiteRevision: scope.healthSuiteRevision, profileRevisionId,
      },
      state, operatorMaintenance, contours: [], evidence: [], evaluatedAt: new Date(at),
    };
  }
  // Actual producer over explicit synthetic snapshots, not persisted rows or live health.
  const result = evaluateH5({
    identity: scope, candidateProfileState: "PUBLISHED",
    baseline: snapshot(baselineId, before, false),
    candidate: snapshot(candidateId, after, maintenance),
  });
  return {
    id, evaluationKey: result.evaluationKey, phase: result.phase,
    provider: scope.provider, surface: scope.surface, target: scope.target,
    variant: scope.variant, probeLayer: scope.monitoringLayer,
    browserFamily: scope.browserFamily, browserVersion: scope.browserVersion,
    environmentClass: scope.environmentClass,
    baselineProfileRevisionId: baselineId, candidateProfileRevisionId: candidateId,
    suiteMachineKey: scope.healthSuiteMachineKey, suiteRevision: scope.healthSuiteRevision,
    outcome: result.outcome, recommendation: result.recommendation,
    result: JSON.parse(JSON.stringify(result)),
    firstEvaluatedAt: at, latestEvaluatedAt: at, createdAt: at, updatedAt: at,
  };
}

function h4Row(outcome: (typeof h4Outcomes)[number]) {
  // Compatibility projection fixture only; this does not execute the H4 producer.
  return {
    ...h5Row(h5Cases[0]), phase: "H4_CANDIDATE", outcome, recommendation: null,
    result: { comparison: null, evidenceReferences: [] },
  };
}

type ProjectionRow = Omit<ReturnType<typeof h5Row>, "phase" | "outcome" | "recommendation"> & {
  phase: string;
  outcome: string;
  recommendation: string | null;
};

function fixture(rows: ProjectionRow[]) {
  const current = {
    target_id: targetId, run_id: id, provider: "chatgpt", surface: "CHATGPT_WORK",
    variant: "work", monitoring_layer: "NO_SESSION", browser_family: "chrome",
    browser_version: "120.0.0.0", profile_revision_id: baselineId,
    baseline_profile_revision_id: baselineId, candidate_profile_revision_id: candidateId,
    health_state: "UNKNOWN", scheduler_state: "FAILED_RETRYABLE", completed_at: at,
    latest_successful_run_at: null,
    h5_result: rows.find((row) => row.phase !== "H4_CANDIDATE")?.result ?? null,
    h5_recommendation: rows.find((row) => row.phase !== "H4_CANDIDATE")?.recommendation ?? null,
  };
  // Readonly query-result port: no SQL execution or DatabaseRuntime instance.
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith("\nWITH latest AS")) return { rows: [current] };
    if (sql.includes("FROM health_profile_evaluations")) return { rows };
    return { rows: [] };
  });
  const repository = createHealthAdminReadRepository({ query } as unknown as DatabaseRuntime);
  return { repository, service: createHealthAdminReadService(repository), query };
}

async function checkReadPaths(row: ProjectionRow, expectedOutcome: string) {
  const before = JSON.stringify(row);
  const { service, query } = fixture([row]);
  const list = await service.listEvaluations({ limit: 2 });
  const detail = await service.getEvaluation(id);
  const target = await service.getTarget(targetId);
  expect(list.items).toHaveLength(1);
  expect(list.items[0]?.outcome).toBe(expectedOutcome);
  expect(detail?.outcome).toBe(expectedOutcome);
  expect(target?.evaluations).toHaveLength(1);
  expect(target?.evaluations[0]?.outcome).toBe(expectedOutcome);
  expect(target?.evaluations[0]?.postRolloutOutcome).toBe(
    row.phase === "H5_POST_ROLLOUT" ? expectedOutcome : null,
  );
  expect(target?.evaluations[0]?.phase).toBe(row.phase);
  expect(target?.evaluations[0]?.currentAuthority).toBe(true);
  expect(target?.evaluations[0]).not.toHaveProperty("recommendationView");
  expect(target?.evaluations[0]).not.toHaveProperty("provider");
  expect(target?.recommendation).toBe(target?.healthRecommendation?.recommendation ?? null);
  expect(target?.latestHealthState).toBe("UNKNOWN");
  expect(target?.latestSchedulerState).toBe("FAILED_RETRYABLE");
  expect(query).toHaveBeenCalledTimes(6);
  expect(JSON.stringify(row)).toBe(before);
  return { detail, summary: target!.evaluations[0]! };
}

describe("Health evaluation read outcome vocabulary", () => {
  it.each(h5Cases)("retains producer %s %s -> %s (maintenance=%s): %s/%s",
    async (...input) => {
      const row = h5Row(input);
      expect(row.outcome).toBe(input[4]);
      expect(row.recommendation).toBe(input[5]);
      await checkReadPaths(row, input[4]);
    },
  );

  it.each(h4Outcomes)("keeps H4 %s in all read paths", async (outcome) => {
    await checkReadPaths(h4Row(outcome), outcome);
  });

  it.each(["CANARY_ASSESSMENT", "STABLE", "REGRESSION", "RECOVERED"])(
    "does not widen the H4 producer enum with %s", (outcome) => {
      expect(EvaluationOutcomeSchema.safeParse(outcome).success).toBe(false);
    },
  );

  it.each(["UNSUPPORTED", "HEALTHY", "", null])(
    "rejects unknown read outcome %s instead of dropping or relabelling it", async (outcome) => {
      const row = { ...h5Row(h5Cases[0]), outcome } as never;
      const { service } = fixture([row]);
      await expect(service.listEvaluations({ limit: 2 })).rejects.toThrow();
      await expect(service.getEvaluation(id)).rejects.toThrow();
      await expect(service.getTarget(targetId)).rejects.toThrow();
    },
  );

  it("preserves strict summary and detail boundaries", async () => {
    const { detail, summary } = await checkReadPaths(h5Row(h5Cases[6]), "STABLE");
    expect(() => HealthProfileEvaluationSummarySchema.parse({ ...summary, privateFixture: true })).toThrow();
    expect(() => HealthProfileEvaluationSummarySchema.parse({ ...summary, provider: "chatgpt" })).toThrow();
    const { outcome: _outcome, ...missingOutcome } = summary;
    expect(() => HealthProfileEvaluationSummarySchema.parse(missingOutcome)).toThrow();
    expect(() => HealthAdminEvaluationDetailSchema.parse({ ...detail, privateFixture: true })).toThrow();
    expect(() => HealthAdminEvaluationDetailSchema.parse({ ...detail, provider: undefined })).toThrow();
    expect(() => HealthAdminEvaluationDetailSchema.parse({ ...detail, phase: "H6" })).toThrow();
  });

  it("retains foreign browser history without granting it current recommendation authority", async () => {
    const row = h5Row(h5Cases[6], "121.0.0.0");
    const { service } = fixture([row]);
    const detail = await service.getTarget(targetId);
    expect(detail?.evaluations[0]).toMatchObject({ outcome: "STABLE", currentAuthority: false });
    expect(detail?.healthRecommendation).toBeNull();
    expect(detail?.recommendation).toBeNull();
  });

  it.each([
    { candidateProfileRevisionId: "invalid" },
    { browserVersion: "" },
    { privateFixture: true },
  ])("rejects invalid producer identity %j", (override) => {
    expect(EvaluationIdentitySchema.safeParse({ ...identity("H5_CANARY"), ...override }).success).toBe(false);
  });

  it("keeps empty lists, missing detail, and original read failures", async () => {
    const { service, query } = fixture([]);
    await expect(service.listEvaluations({ limit: 2 })).resolves.toEqual({ items: [], nextCursor: null });
    await expect(service.getEvaluation(id)).resolves.toBeNull();
    const failure = new Error("READ_INPUT_FAILED");
    query.mockRejectedValueOnce(failure);
    await expect(service.listEvaluations({ limit: 2 })).rejects.toBe(failure);
  });

  it("retains mixed H4/H5 page order and its last-row cursor", async () => {
    const lastId = "00000000-0000-4000-8000-000000000002";
    const rows = [h4Row("PASS"), { ...h5Row(h5Cases[7]), id: lastId }];
    const { service } = fixture(rows);
    const page = await service.listEvaluations({ limit: 2 });
    expect(page.items.map((row) => row.outcome)).toEqual(["PASS", "REGRESSION"]);
    expect(page.nextCursor).toBe(lastId);
  });
});
