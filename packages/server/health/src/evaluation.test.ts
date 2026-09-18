import {
  AdapterProfileContentV1Schema,
  PersistedProfileRevisionSchema,
  validateProfileContent,
} from "@product/adapter-registry";
import { describe, expect, it } from "vitest";
import {
  BASELINE_HEALTH_SUITE,
  DEFAULT_H4_EVALUATION_POLICY,
  H4_COMPARISON_MATRIX,
  HealthContourResultSchema,
  aggregateH4Executions,
  assertSignalAppliesTo,
  createAvailabilityRestrictionSignal,
  evaluateH4Candidate,
  evaluateH5,
  makeEvaluationIdentity,
} from "./index.js";
import type { HealthContourResult, HealthState } from "./index.js";

const IDS = {
  adapter: "00000000-0000-4000-8000-000000000101",
  surface: "00000000-0000-4000-8000-000000000102",
  baseline: "00000000-0000-4000-8000-000000000103",
  candidate: "00000000-0000-4000-8000-000000000104",
};

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
  const fingerprint = validateProfileContent({
    content,
    compatibility,
  }).contentSha256;
  return PersistedProfileRevisionSchema.parse({
    id: IDS.candidate,
    profileId: "00000000-0000-4000-8000-000000000105",
    adapterId: IDS.adapter,
    surfaceId: IDS.surface,
    variantId: null,
    revision: 2,
    schemaVersion: "adapter_profile_v1",
    state: "CANDIDATE",
    content,
    compatibility,
    contentSha256: fingerprint,
    createdAt: new Date("2026-09-18T00:00:00.000Z"),
    publishedAt: null,
    createdByAdminPrincipalId: null,
    publishedByAdminPrincipalId: null,
  });
}

function contours(
  overrides: Partial<HealthContourResult> = {},
): HealthContourResult[] {
  return BASELINE_HEALTH_SUITE.contours.map((definition) =>
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
      ...(definition.key === overrides.contourKey ? overrides : {}),
    }),
  );
}

function identity(
  phase: "H4_CANDIDATE" | "H5_CANARY" | "H5_POST_ROLLOUT" = "H4_CANDIDATE",
) {
  return makeEvaluationIdentity({
    provider: "chatgpt",
    surface: "CHATGPT_STANDARD",
    target: "chatgpt-standard",
    variant: null,
    monitoringLayer: "NO_SESSION",
    baselineProfileRevisionId: IDS.baseline,
    candidateProfileRevisionId: IDS.candidate,
    healthSuiteMachineKey: "h4-fixture-suite",
    healthSuiteRevision: 1,
    phase,
    browserFamily: "chrome",
    browserVersion: "120.0.0.0",
    environmentClass: "DISPOSABLE_NO_SESSION",
  });
}

function snapshot(
  profileRevisionId: string,
  executionId: string,
  state: HealthState = "HEALTHY",
  contourResults = contours(),
) {
  return {
    executionId,
    scope: {
      provider: "chatgpt",
      surface: "CHATGPT_STANDARD",
      target: "chatgpt-standard",
      variant: null,
      monitoringLayer: "NO_SESSION" as const,
      browserFamily: "chrome" as const,
      browserVersion: "120.0.0.0",
      environmentClass: "DISPOSABLE_NO_SESSION",
      healthSuiteMachineKey: "h4-fixture-suite",
      healthSuiteRevision: 1,
      profileRevisionId,
    },
    state,
    operatorMaintenance: false,
    contours: contourResults,
    evidence: [],
    evaluatedAt: new Date("2026-09-18T01:00:00.000Z"),
  };
}

function h4(
  baseline: HealthState,
  candidate: HealthState,
  changes: Partial<HealthContourResult> = {},
) {
  return evaluateH4Candidate({
    identity: identity(),
    candidateProfile: candidateProfile(),
    baseline: snapshot(
      IDS.baseline,
      "00000000-0000-4000-8000-000000000201",
      baseline,
    ),
    candidate: snapshot(
      IDS.candidate,
      "00000000-0000-4000-8000-000000000202",
      candidate,
      contours(changes),
    ),
  });
}

describe("H4 candidate comparison matrix", () => {
  it.each([
    ["HEALTHY", "HEALTHY", "PASS"],
    ["HEALTHY", "DRIFT", "FAIL"],
    ["HEALTHY", "DEGRADED", "FAIL"],
    ["HEALTHY", "BROKEN", "FAIL"],
    ["HEALTHY", "UNKNOWN", "INCONCLUSIVE"],
    ["HEALTHY", "MAINTENANCE", "INCONCLUSIVE"],
    ["DRIFT", "HEALTHY", "PASS"],
    ["DRIFT", "DRIFT", "INCONCLUSIVE"],
    ["DRIFT", "DEGRADED", "FAIL"],
    ["DRIFT", "BROKEN", "FAIL"],
    ["DRIFT", "UNKNOWN", "INCONCLUSIVE"],
    ["DRIFT", "MAINTENANCE", "INCONCLUSIVE"],
    ["DEGRADED", "HEALTHY", "PASS"],
    ["DEGRADED", "DRIFT", "INCONCLUSIVE"],
    ["DEGRADED", "DEGRADED", "INCONCLUSIVE"],
    ["DEGRADED", "BROKEN", "INCONCLUSIVE"],
    ["DEGRADED", "UNKNOWN", "INCONCLUSIVE"],
    ["DEGRADED", "MAINTENANCE", "INCONCLUSIVE"],
    ["BROKEN", "HEALTHY", "PASS"],
    ["BROKEN", "DRIFT", "INCONCLUSIVE"],
    ["BROKEN", "DEGRADED", "INCONCLUSIVE"],
    ["BROKEN", "BROKEN", "INCONCLUSIVE"],
    ["BROKEN", "UNKNOWN", "INCONCLUSIVE"],
    ["BROKEN", "MAINTENANCE", "INCONCLUSIVE"],
    ["UNKNOWN", "HEALTHY", "INCONCLUSIVE"],
    ["UNKNOWN", "DRIFT", "INCONCLUSIVE"],
    ["UNKNOWN", "DEGRADED", "INCONCLUSIVE"],
    ["UNKNOWN", "BROKEN", "INCONCLUSIVE"],
    ["UNKNOWN", "UNKNOWN", "INCONCLUSIVE"],
    ["UNKNOWN", "MAINTENANCE", "INCONCLUSIVE"],
    ["MAINTENANCE", "HEALTHY", "INCONCLUSIVE"],
    ["MAINTENANCE", "DRIFT", "INCONCLUSIVE"],
    ["MAINTENANCE", "DEGRADED", "INCONCLUSIVE"],
    ["MAINTENANCE", "BROKEN", "INCONCLUSIVE"],
    ["MAINTENANCE", "UNKNOWN", "INCONCLUSIVE"],
    ["MAINTENANCE", "MAINTENANCE", "INCONCLUSIVE"],
  ] as const)(
    "classifies %s to %s deterministically",
    (baseline, candidate, expected) => {
      expect(H4_COMPARISON_MATRIX[baseline][candidate]).toBe(expected);
      expect(h4(baseline, candidate).outcome).toBe(expected);
    },
  );

  it("rejects an invalid candidate through the existing H0 boundary", () => {
    expect(h4("HEALTHY", "HEALTHY").outcome).toBe("PASS");
    const invalid = evaluateH4Candidate({
      identity: identity(),
      candidateProfile: { state: "DRAFT" },
      baseline: snapshot(IDS.baseline, "00000000-0000-4000-8000-000000000203"),
      candidate: snapshot(
        IDS.candidate,
        "00000000-0000-4000-8000-000000000204",
      ),
    });
    expect(invalid.outcome).toBe("INVALID_CANDIDATE");
    const fingerprintMismatch = evaluateH4Candidate({
      identity: identity(),
      candidateProfile: {
        ...candidateProfile(),
        contentSha256: "0".repeat(64),
      },
      baseline: snapshot(IDS.baseline, "00000000-0000-4000-8000-000000000207"),
      candidate: snapshot(
        IDS.candidate,
        "00000000-0000-4000-8000-000000000208",
      ),
    });
    expect(fingerprintMismatch.outcome).toBe("INVALID_CANDIDATE");
  });

  it("does not turn environment uncertainty into a candidate failure", () => {
    const uncertain = contours({
      contourKey: "C13_BLOCKING_STATE",
      primaryStrategyOutcome: "UNCERTAIN",
      selectedStrategyId: null,
      structuralOutcome: "UNCERTAIN",
      behavioralOutcome: "UNCERTAIN",
      fallbackQuality: "NOT_APPLICABLE",
      environmentStatus: "UNCERTAIN",
      uncertaintyReason: "CONTROLLED_BROWSER_UNAVAILABLE",
    });
    const result = evaluateH4Candidate({
      identity: identity(),
      candidateProfile: candidateProfile(),
      baseline: snapshot(
        IDS.baseline,
        "00000000-0000-4000-8000-000000000209",
        "UNKNOWN",
        uncertain,
      ),
      candidate: snapshot(
        IDS.candidate,
        "00000000-0000-4000-8000-000000000210",
      ),
    });
    expect(result.outcome).toBe("ENVIRONMENT_BLOCKED");
  });

  it("marks targets without a product candidate as not applicable", () => {
    const result = evaluateH4Candidate({
      identity: identity(),
      candidateProfile: {},
      readiness: "CANDIDATE_NOT_PRESENT",
      baseline: snapshot(IDS.baseline, "00000000-0000-4000-8000-000000000211"),
      candidate: snapshot(
        IDS.candidate,
        "00000000-0000-4000-8000-000000000212",
      ),
    });
    expect(result.outcome).toBe("NOT_APPLICABLE");
  });

  it("freezes revision identity and separates H4 authority for a new candidate", () => {
    const next = makeEvaluationIdentity({
      ...identity(),
      candidateProfileRevisionId: "00000000-0000-4000-8000-000000000999",
      phase: "H4_CANDIDATE",
    });
    expect(next.evaluationKey).not.toBe(identity().evaluationKey);
  });

  it("does not hide a critical contour regression behind aggregate improvement", () => {
    const result = h4("BROKEN", "HEALTHY", {
      contourKey: "C01_PAGE_IDENTITY",
      observationStatus: "ABSENT",
      primaryStrategyOutcome: "NOT_ATTEMPTED",
      selectedStrategyId: null,
      structuralOutcome: "NOT_RUN",
      behavioralOutcome: "NOT_RUN",
      fallbackQuality: "NOT_APPLICABLE",
    });
    expect(result.outcome).toBe("FAIL");
    expect(result.comparison?.decisiveContours).toContain("C01_PAGE_IDENTITY");
  });

  it.each([
    ["browser-family mismatch", { browserFamily: "yandex_chromium" as const }],
    ["suite revision mismatch", { healthSuiteRevision: 2 }],
  ])("fails closed on %s", (_label, change) => {
    const candidate = snapshot(
      IDS.candidate,
      "00000000-0000-4000-8000-000000000205",
    );
    Object.assign(candidate.scope, change);
    expect(
      evaluateH4Candidate({
        identity: identity(),
        candidateProfile: candidateProfile(),
        baseline: snapshot(
          IDS.baseline,
          "00000000-0000-4000-8000-000000000206",
        ),
        candidate,
      }).outcome,
    ).toBe("INCONCLUSIVE");
  });

  it("supports bounded repeatability without unbounded retries", () => {
    expect(
      aggregateH4Executions(
        [{ outcome: "PASS", evaluatedAt: new Date() }],
        DEFAULT_H4_EVALUATION_POLICY,
      ),
    ).toBe("PASS");
    expect(
      aggregateH4Executions(
        [
          { outcome: "PASS", evaluatedAt: new Date() },
          { outcome: "INCONCLUSIVE", evaluatedAt: new Date() },
        ],
        {
          ...DEFAULT_H4_EVALUATION_POLICY,
          maximumEnvironmentInconclusiveExecutions: 0,
        },
      ),
    ).toBe("INCONCLUSIVE");
    expect(
      aggregateH4Executions(
        [{ outcome: "FAIL", evaluatedAt: new Date() }],
        DEFAULT_H4_EVALUATION_POLICY,
      ),
    ).toBe("FAIL");
  });
});

describe("H5 non-executing signals", () => {
  it("continues healthy canary and never mutates P7", () => {
    const result = evaluateH5({
      identity: identity("H5_CANARY"),
      candidateProfileState: "PUBLISHED",
      baseline: snapshot(IDS.baseline, "00000000-0000-4000-8000-000000000301"),
      candidate: snapshot(
        IDS.candidate,
        "00000000-0000-4000-8000-000000000302",
      ),
    });
    expect(result.recommendation).toBe("CONTINUE");
    expect(result.executionAuthority).toBe(false);
  });

  it("recommends rollback for a strong core regression but does not execute it", () => {
    const result = evaluateH5({
      identity: identity("H5_CANARY"),
      candidateProfileState: "PUBLISHED",
      baseline: snapshot(IDS.baseline, "00000000-0000-4000-8000-000000000303"),
      candidate: snapshot(
        IDS.candidate,
        "00000000-0000-4000-8000-000000000304",
        "BROKEN",
        contours({
          contourKey: "C01_PAGE_IDENTITY",
          observationStatus: "ABSENT",
          primaryStrategyOutcome: "NOT_ATTEMPTED",
          selectedStrategyId: null,
          structuralOutcome: "NOT_RUN",
          behavioralOutcome: "NOT_RUN",
          fallbackQuality: "NOT_APPLICABLE",
        }),
      ),
    });
    expect(result.recommendation).toBe("ROLLBACK_RECOMMENDED");
    expect(result.executionAuthority).toBe(false);
  });

  it("emits only bounded browser/provider/surface restriction scope", () => {
    const result = evaluateH5({
      identity: identity("H5_CANARY"),
      candidateProfileState: "PUBLISHED",
      baseline: snapshot(IDS.baseline, "00000000-0000-4000-8000-000000000305"),
      candidate: snapshot(
        IDS.candidate,
        "00000000-0000-4000-8000-000000000306",
        "DEGRADED",
        contours({
          contourKey: "C10_NATIVE_COPY_CONTROL",
          observationStatus: "ABSENT",
          primaryStrategyOutcome: "NOT_ATTEMPTED",
          selectedStrategyId: null,
          structuralOutcome: "NOT_RUN",
          behavioralOutcome: "NOT_RUN",
          fallbackQuality: "NOT_APPLICABLE",
        }),
      ),
    });
    const signal = createAvailabilityRestrictionSignal({
      evaluation: result,
      target: "chatgpt-standard",
      browserVersionRange: "120.0.0.0",
    });
    expect(signal).not.toBeNull();
    expect(signal).toMatchObject({
      provider: "chatgpt",
      surface: "CHATGPT_STANDARD",
      profileRevisionId: IDS.candidate,
      browserFamily: "chrome",
      target: "chatgpt-standard",
      executionAuthority: false,
    });
    assertSignalAppliesTo({
      signal: signal!,
      provider: "chatgpt",
      surface: "CHATGPT_STANDARD",
      profileRevisionId: IDS.candidate,
      browserFamily: "chrome",
    });
    expect(() =>
      assertSignalAppliesTo({
        signal: signal!,
        provider: "chatgpt",
        surface: "CHATGPT_WORK",
        profileRevisionId: IDS.candidate,
        browserFamily: "chrome",
      }),
    ).toThrow("STALE_OR_MISSCOPED_HEALTH_SIGNAL");
    expect(() =>
      createAvailabilityRestrictionSignal({
        evaluation: result,
        target: "chatgpt-standard",
        browserVersionRange: "120.x",
      }),
    ).toThrow("HEALTH_SIGNAL_SCOPE_WIDENING");
  });

  it("keeps post-rollout semantics truthful and maintenance inconclusive", () => {
    const result = evaluateH5({
      identity: identity("H5_POST_ROLLOUT"),
      candidateProfileState: "PUBLISHED",
      baseline: snapshot(
        IDS.baseline,
        "00000000-0000-4000-8000-000000000307",
        "BROKEN",
      ),
      candidate: snapshot(
        IDS.candidate,
        "00000000-0000-4000-8000-000000000308",
      ),
    });
    expect(result.outcome).toBe("RECOVERED");
    const maintenance = snapshot(
      IDS.candidate,
      "00000000-0000-4000-8000-000000000309",
    );
    maintenance.operatorMaintenance = true;
    expect(
      evaluateH5({
        identity: identity("H5_CANARY"),
        candidateProfileState: "PUBLISHED",
        baseline: snapshot(
          IDS.baseline,
          "00000000-0000-4000-8000-000000000310",
        ),
        candidate: maintenance,
      }).recommendation,
    ).toBe("INCONCLUSIVE");
  });
});
