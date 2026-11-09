import { describe, expect, it, vi } from "vitest";
import {
  createHealthAdminReadService,
  H5EvaluationResultSchema,
} from "@product/health";
import type { DatabaseRuntime } from "./index.js";
import { createHealthAdminReadRepository } from "./health-admin-read-repository.js";

const id = "00000000-0000-4000-8000-000000000001";
const nextId = "00000000-0000-4000-8000-000000000002";
const revision = "00000000-0000-4000-8000-000000000101";
const key = "a".repeat(64);
const at = "2030-01-01T00:00:00.000Z";

function row(overrides: Record<string, unknown> = {}) {
  const value = {
    id,
    evaluationKey: key,
    phase: "H5_CANARY",
    provider: "chatgpt",
    surface: "CHATGPT_WORK",
    target: "work",
    variant: "work",
    probeLayer: "NO_SESSION",
    baselineProfileRevisionId: revision,
    candidateProfileRevisionId: revision,
    suiteMachineKey: "baseline-contract",
    suiteRevision: 1,
    browserFamily: "chrome",
    browserVersion: "120.0.0.0",
    environmentClass: "ci",
    outcome: "CANARY_ASSESSMENT",
    recommendation: "CONTINUE",
    firstEvaluatedAt: at,
    latestEvaluatedAt: at,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
  // Same H5 contract/JSON shape used by the persistence producer; no DB.
  const result = H5EvaluationResultSchema.parse({
    evaluationKey: value.evaluationKey,
    identity: {
      provider: value.provider,
      surface: value.surface,
      target: value.target,
      variant: value.variant,
      monitoringLayer: value.probeLayer,
      baselineProfileRevisionId: value.baselineProfileRevisionId,
      candidateProfileRevisionId: value.candidateProfileRevisionId,
      healthSuiteMachineKey: value.suiteMachineKey,
      healthSuiteRevision: value.suiteRevision,
      phase: value.phase,
      browserFamily: value.browserFamily,
      browserVersion: value.browserVersion,
      environmentClass: value.environmentClass,
    },
    phase: value.phase,
    outcome: value.outcome,
    recommendation: value.recommendation,
    h4Comparison: null,
    evidenceReferences: [],
    executionIds: [id],
    executionAuthority: false,
    evaluatedAt: new Date(at),
  });
  return { ...value, result: JSON.parse(JSON.stringify(result)) };
}

function fixture(rows: ReturnType<typeof row>[]) {
  // Readonly query-port stub: no SQL dispatch or DatabaseRuntime instance.
  const query = vi.fn(
    async (_text: string, _parameters?: readonly unknown[]) => ({ rows }),
  );
  const repository = createHealthAdminReadRepository({
    query,
  } as unknown as DatabaseRuntime);
  return { service: createHealthAdminReadService(repository), query };
}

function expected(source: string, view: string) {
  return {
    recommendation: view,
    sourceRecommendation: source,
    reasonCode: `H5_${source}`,
    severity: null,
    evaluationId: id,
    evaluationKey: key,
    incidentId: null,
    profileRevisionId: revision,
    provider: "chatgpt",
    surface: "CHATGPT_WORK",
    variant: "work",
    browserFamily: "chrome",
    browserVersionScope: "120.0.0.0",
    monitoringLayer: "NO_SESSION",
    evidenceReferences: [],
    issuedAt: at,
    evaluationRevision: 1,
    freshnessAuthority: `${key}:1`,
    executionAuthority: false,
  };
}

describe("Health historical recommendation list", () => {
  it.each([
    ["CONTINUE", "NO_RESTRICTION_SIGNAL"],
    ["HOLD", "ADVISORY_HOLD"],
    ["RESTRICT", "SCOPED_RESTRICTION_RECOMMENDED"],
    ["ROLLBACK_RECOMMENDED", "ROLLBACK_RECOMMENDED"],
    ["INCONCLUSIVE", "INCONCLUSIVE"],
  ])(
    "projects valid H5 canary %s directly into its DTO",
    async (source, view) => {
      const { service, query } = fixture([row({ recommendation: source })]);
      const value = await service.listRecommendations({ limit: 2 });
      expect(value).toEqual({ items: [expected(source, view)], nextCursor: null });
      expect(query).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["STABLE", "CONTINUE", "NO_RESTRICTION_SIGNAL"],
    ["REGRESSION", "RESTRICT", "SCOPED_RESTRICTION_RECOMMENDED"],
    ["RECOVERED", "CONTINUE", "NO_RESTRICTION_SIGNAL"],
    ["INCONCLUSIVE", "INCONCLUSIVE", "INCONCLUSIVE"],
  ])(
    "projects post-rollout %s without fabricating a generic outcome",
    async (outcome, source, view) => {
      const { service } = fixture([
        row({ phase: "H5_POST_ROLLOUT", outcome, recommendation: source }),
      ]);
      const value = await service.listRecommendations({ limit: 2 });
      expect(value.items).toEqual([expected(source, view)]);
      expect(value.items[0]).not.toHaveProperty("outcome");
    },
  );

  it("retains each historical profile/browser/layer scope", async () => {
    const historicalRevision = "00000000-0000-4000-8000-000000000099";
    const { service, query } = fixture([
      row(),
      row({
        id: nextId,
        candidateProfileRevisionId: historicalRevision,
        browserFamily: "yandex_chromium",
        browserVersion: "119.0.0.0",
        probeLayer: "AUTHENTICATED_DEEP",
      }),
    ]);
    const value = await service.listRecommendations({ limit: 3 });
    expect(value.items).toHaveLength(2);
    expect(value.items[1]).toMatchObject({
      profileRevisionId: historicalRevision,
      browserFamily: "yandex_chromium",
      browserVersionScope: "119.0.0.0",
      monitoringLayer: "AUTHENTICATED_DEEP",
      recommendation: "NO_RESTRICTION_SIGNAL",
      executionAuthority: false,
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("uses the last scanned row id for a full page cursor", async () => {
    const { service, query } = fixture([
      row({ outcome: "INCONCLUSIVE", recommendation: "INCONCLUSIVE" }),
      row({
        id: nextId,
        outcome: "INCONCLUSIVE",
        recommendation: "INCONCLUSIVE",
      }),
    ]);
    const value = await service.listRecommendations({ limit: 2 });
    expect(value.nextCursor).toBe(nextId);
    expect(value.nextCursor).not.toBe("undefined");
    expect(query.mock.calls[0]?.[1]).toEqual([
      null, null, null, null, null, null, null, 2,
    ]);
  });

  it("keeps empty pages empty", async () => {
    const { service } = fixture([]);
    await expect(service.listRecommendations({ limit: 2 })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it("does not fabricate a recommendation for an empty source field", async () => {
    const { service } = fixture([{ ...row(), recommendation: null } as never]);
    await expect(service.listRecommendations({ limit: 2 })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it("advances across a full scanned page containing an omitted recommendation", async () => {
    const { service } = fixture([
      row({ outcome: "INCONCLUSIVE", recommendation: "INCONCLUSIVE" }),
      { ...row({ id: nextId }), recommendation: null } as never,
    ]);
    const value = await service.listRecommendations({ limit: 2 });
    expect(value.items).toHaveLength(1);
    expect(value.nextCursor).toBe(nextId);
  });

  it("preserves strict recommendation validation", async () => {
    const { service } = fixture([
      { ...row(), recommendation: "UNSUPPORTED" } as never,
    ]);
    await expect(service.listRecommendations({ limit: 2 })).rejects.toThrow();
  });

  it("bounds evidence and excludes private fixture fields", async () => {
    const input = row();
    input.result.evidenceReferences = Array.from({ length: 40 }, () => ({
      evidenceId: id,
      ruleId: "SAFE_ELEMENT_METADATA",
      classification: "METADATA",
      sha256: null,
      sizeBytes: 0,
    }));
    input.result.privateFixture = "SYNTHETIC_ONLY";
    const before = JSON.stringify(input);
    const { service } = fixture([input]);
    const value = await service.listRecommendations({ limit: 2 });
    expect(value.items[0]?.evidenceReferences).toHaveLength(32);
    expect(value.items[0]).not.toHaveProperty("privateFixture");
    expect(JSON.stringify(input)).toBe(before);
  });

  it("propagates the original repository read error", async () => {
    const { service, query } = fixture([]);
    query.mockRejectedValueOnce(new Error("READ_INPUT_FAILED"));
    await expect(service.listRecommendations({ limit: 2 })).rejects.toThrow(
      "READ_INPUT_FAILED",
    );
  });
});
