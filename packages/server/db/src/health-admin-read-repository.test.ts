import { describe, expect, it, vi } from "vitest";
import type { DatabaseRuntime } from "./index.js";
import { createHealthAdminReadRepository } from "./health-admin-read-repository.js";

const id = "00000000-0000-4000-8000-000000000001";
const revision = "00000000-0000-4000-8000-000000000002";
const targetId = "a".repeat(64);
const at = "2030-01-01T00:00:00.000Z";

function target(overrides: Record<string, unknown> = {}) {
  return {
    target_id: targetId,
    run_id: id,
    provider: "chatgpt",
    surface: "CHATGPT_WORK",
    variant: "work",
    monitoring_layer: "NO_SESSION",
    browser_family: "chrome",
    browser_version: "120.0.0.0",
    health_state: "UNKNOWN",
    completed_at: at,
    latest_successful_run_at: null,
    scheduler_state: "FAILED_RETRYABLE",
    profile_revision_id: revision,
    baseline_profile_revision_id: revision,
    candidate_profile_revision_id: null,
    ...overrides,
  };
}

function evaluation(overrides: Record<string, unknown> = {}) {
  return {
    id,
    evaluationKey: "b".repeat(64),
    phase: "H5_CANARY",
    provider: "chatgpt",
    surface: "CHATGPT_WORK",
    target: "work",
    variant: "work",
    probeLayer: "NO_SESSION",
    browserFamily: "chrome",
    browserVersion: "120.0.0.0",
    environmentClass: "ci",
    baselineProfileRevisionId: revision,
    candidateProfileRevisionId: revision,
    outcome: "PASS",
    recommendation: "CONTINUE",
    result: { evidenceReferences: [] },
    suiteRevision: 1,
    firstEvaluatedAt: at,
    latestEvaluatedAt: at,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

function fixture(rows: ReturnType<typeof evaluation>[], current = target()) {
  // Readonly query-port stub: no DatabaseRuntime instance or SQL execution.
  const query = vi.fn(async (text: string) => {
    if (text.startsWith("\nWITH latest AS")) return { rows: [current] };
    if (text.includes("FROM health_profile_evaluations")) return { rows };
    return { rows: [] };
  });
  const repository = createHealthAdminReadRepository({
    query,
  } as unknown as DatabaseRuntime);
  return { repository, query };
}

describe("Health target evaluation scope authority", () => {
  it.each([
    ["CONTINUE", "NO_RESTRICTION_SIGNAL"],
    ["HOLD", "ADVISORY_HOLD"],
    ["RESTRICT", "SCOPED_RESTRICTION_RECOMMENDED"],
    ["ROLLBACK_RECOMMENDED", "ROLLBACK_RECOMMENDED"],
    ["INCONCLUSIVE", "INCONCLUSIVE"],
  ])(
    "preserves same-scope H5 %s without promoting UNKNOWN",
    async (source, view) => {
      const { repository } = fixture([evaluation({ recommendation: source })]);
      const value = await repository.getTarget(targetId);
      expect(value?.latestHealthState).toBe("UNKNOWN");
      expect(value?.latestSchedulerState).toBe("FAILED_RETRYABLE");
      expect(value?.evaluations[0]?.currentAuthority).toBe(true);
      expect(value?.healthRecommendation).toMatchObject({
        recommendation: view,
        reasonCode: `H5_${source}`,
        executionAuthority: false,
      });
    },
  );

  it.each([
    ["provider", "alice"],
    ["surface", "ALICE"],
    ["candidateProfileRevisionId", "00000000-0000-4000-8000-000000000099"],
    ["browserFamily", "yandex_chromium"],
    ["browserVersion", "121.0.0.0"],
    ["probeLayer", "AUTHENTICATED_DEEP"],
  ])(
    "retains mismatched %s as historical with a stale reason",
    async (field, value) => {
      const { repository } = fixture([evaluation({ [field]: value })]);
      const detail = await repository.getTarget(targetId);
      expect(detail?.evaluations).toHaveLength(1);
      expect(detail?.evaluations[0]?.currentAuthority).toBe(false);
      expect(detail?.evaluations[0]).not.toHaveProperty("recommendationView");
      expect(detail?.evaluations[0]).not.toHaveProperty("provider");
      expect(detail?.healthRecommendation).toBeNull();
    },
  );

  it("keeps a different variant outside the target detail", async () => {
    const { repository } = fixture([evaluation({ variant: "standard" })]);
    const value = await repository.getTarget(targetId);
    expect(value?.evaluations).toEqual([]);
    expect(value?.healthRecommendation).toBeNull();
  });

  it(
    "uses the current assignment baseline rather than an old run profile",
    async () => {
      const { repository } = fixture(
        [evaluation()],
        target({ profile_revision_id: "00000000-0000-4000-8000-000000000098" }),
      );
      const value = await repository.getTarget(targetId);
      expect(value?.evaluations[0]?.currentAuthority).toBe(true);
      expect(value?.healthRecommendation?.profileRevisionId).toBe(revision);
    },
  );

  it(
    "does not select a newer stale evaluation over a current scoped one",
    async () => {
      const { repository } = fixture([
        evaluation({
          browserVersion: "121.0.0.0",
          latestEvaluatedAt: "2030-01-02T00:00:00.000Z",
        }),
        evaluation(),
      ]);
      const value = await repository.getTarget(targetId);
      expect(value?.evaluations[0]?.currentAuthority).toBe(false);
      expect(value?.healthRecommendation?.issuedAt).toBe(at);
    },
  );

  it(
    "keeps missing evaluations empty and never fabricates a healthy result",
    async () => {
      const { repository } = fixture([]);
      const value = await repository.getTarget(targetId);
      expect(value?.evaluations).toEqual([]);
      expect(value?.healthRecommendation).toBeNull();
      expect(value?.latestHealthState).toBe("UNKNOWN");
    },
  );

  it(
    "propagates a failed input read instead of returning fixture data",
    async () => {
      const { repository, query } = fixture([]);
      query.mockRejectedValueOnce(new Error("READ_INPUT_FAILED"));
      await expect(repository.getTarget(targetId)).rejects.toThrow("READ_INPUT_FAILED");
    },
  );

  it("preserves a missing target as missing", async () => {
    const { repository, query } = fixture([]);
    query.mockResolvedValueOnce({ rows: [] });
    await expect(repository.getTarget(targetId)).resolves.toBeNull();
  });
});
