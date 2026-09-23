import { describe, expect, it, vi } from "vitest";
import {
  HealthAdminTargetQuerySchema,
  HealthAdminTargetDetailSchema,
  createHealthAdminReadService,
  deriveHealthAvailabilityRecommendation,
} from "./admin.js";

const id = "00000000-0000-4000-8000-000000000001";
const revision = "00000000-0000-4000-8000-000000000002";
const key = "a".repeat(64);
const baseEvaluation = (recommendation: string) => ({
  evaluationKey: key,
  identity: {
    provider: "chatgpt",
    surface: "CHATGPT_WORK",
    target: "work",
    variant: "work",
    monitoringLayer: "NO_SESSION",
    baselineProfileRevisionId: revision,
    candidateProfileRevisionId: revision,
    healthSuiteMachineKey: "baseline-contract",
    healthSuiteRevision: 1,
    phase: "H5_CANARY",
    browserFamily: "chrome",
    browserVersion: "120.0.0.0",
    environmentClass: "ci",
  },
  outcome: "CANARY_ASSESSMENT",
  recommendation,
  h4Comparison: null,
  evidenceReferences: [],
  executionIds: [id],
  executionAuthority: false,
  evaluatedAt: new Date("2030-01-01T00:00:00Z"),
});

describe("S2-L7 Health admin read and handoff boundary", () => {
  it("enforces bounded pagination and rejects an oversized limit", () => {
    expect(HealthAdminTargetQuerySchema.parse({}).limit).toBe(25);
    expect(() => HealthAdminTargetQuerySchema.parse({ limit: 51 })).toThrow();
  });

  it("maps a scoped restriction without widening Chrome or Work scope", () => {
    const result = deriveHealthAvailabilityRecommendation({
      provider: "chatgpt",
      surface: "CHATGPT_WORK",
      variant: "work",
      profileRevisionId: revision,
      browserFamily: "chrome",
      browserVersion: "120.0.0.0",
      monitoringLayer: "NO_SESSION",
      evaluation: baseEvaluation("RESTRICT") as never,
      evaluationId: id,
    });
    expect(result.recommendation).toBe("SCOPED_RESTRICTION_RECOMMENDED");
    expect(result.surface).toBe("CHATGPT_WORK");
    expect(result.browserFamily).toBe("chrome");
    expect(result.executionAuthority).toBe(false);
  });

  it("marks a revision, browser, or surface mismatch stale", () => {
    const result = deriveHealthAvailabilityRecommendation({
      provider: "chatgpt",
      surface: "CHATGPT_STANDARD",
      variant: "standard",
      profileRevisionId: "00000000-0000-4000-8000-000000000099",
      browserFamily: "yandex_chromium",
      browserVersion: "121.0.0.0",
      monitoringLayer: "NO_SESSION",
      evaluation: baseEvaluation("RESTRICT") as never,
      evaluationId: id,
    });
    expect(result.recommendation).toBe("STALE");
    expect(result.reasonCode).toBe("STALE_EVALUATION_SCOPE");
  });

  it("keeps current/candidate/detail projection bounded and private", () => {
    const parsed = HealthAdminTargetDetailSchema.parse({
      targetId: key,
      provider: "chatgpt",
      surface: "CHATGPT_WORK",
      variant: "work",
      monitoringLayer: "NO_SESSION",
      browserFamily: "chrome",
      browserVersion: "120.0.0.0",
      latestHealthState: "HEALTHY",
      latestObservationAt: "2030-01-01T00:00:00.000Z",
      latestSuccessfulRunAt: "2030-01-01T00:00:00.000Z",
      latestSchedulerState: "SUCCEEDED",
      activeIncidentId: null,
      baselineProfileRevisionId: revision,
      candidateProfileRevisionId: null,
      candidateState: "NO_CANDIDATE",
      latestH4Result: null,
      latestH5Result: null,
      recommendation: null,
      healthSuiteMachineKey: "baseline-contract",
      healthSuiteRevision: 1,
      extensionVersion: "1.0.0",
      adapterEngineVersion: "1.0.0",
      baselineProfile: {
        id: revision,
        revision: 1,
        state: "PUBLISHED",
        contentSha256: key,
        role: "CURRENT_BASELINE",
      },
      candidateProfile: null,
      contourStatuses: [],
      evidenceReferences: [],
      activeIncident: null,
      evaluations: [],
      healthRecommendation: null,
    });
    expect(parsed).not.toHaveProperty("content");
    expect(parsed).not.toHaveProperty("storageState");
    expect(parsed).not.toHaveProperty("authHeaders");
  });

  it("does not expose or call a product mutation repository", async () => {
    const repository = {
      listTargets: vi.fn(async () => ({ items: [], nextCursor: null })),
      getTarget: vi.fn(async () => null),
      listIncidents: vi.fn(async () => ({ items: [], nextCursor: null })),
      getIncident: vi.fn(async () => null),
      listEvaluations: vi.fn(async () => ({ items: [], nextCursor: null })),
      getEvaluation: vi.fn(async () => null),
      listRecommendations: vi.fn(async () => ({ items: [], nextCursor: null })),
    };
    const service = createHealthAdminReadService(repository);
    await service.listTargets({ limit: 1, activeOnly: false });
    expect(Object.keys(repository)).not.toContain("publishProfileRevision");
    expect(Object.keys(repository)).not.toContain("rollbackProfileAssignment");
  });
});
