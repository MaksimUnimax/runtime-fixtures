import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  repairApplyUnavailableReason,
  repairCaseStateLabel,
  repairChangeSummary,
  repairDecisionLabel,
  repairEvidenceGaps,
  repairOperationLabel,
  repairScopeValid,
  repairStaleReasonLabel,
  type RepairCase,
  type RepairCaseState,
  type RepairStaleReason,
} from "./repair-ui";

const uuid = (n: number) =>
  "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const sha = (value: string) => value.repeat(64);

function fixture(): RepairCase {
  return {
    repairCaseId: uuid(1),
    caseRevision: 1,
    bindingSha256: sha("a"),
    scopeSha256: sha("b"),
    createdAt: "2026-10-01T00:00:00.000Z",
    caseState: "PENDING_APPROVAL",
    staleReasons: [],
    executionAuthority: false,
    incident: {
      id: uuid(2),
      status: "OPEN",
      scopeSha256: sha("b"),
      firstSeenRunId: uuid(3),
      latestSeenRunId: uuid(3),
      lastObservedRunId: uuid(3),
      resolvedByRunId: null,
      resolvedAt: null,
    },
    observation: {
      runId: uuid(3),
      normalizedStateSha256: sha("c"),
      currentNormalizedStateSha256: sha("c"),
      currentHealthState: "BROKEN",
      currentRunId: uuid(3),
    },
    candidate: {
      profileId: uuid(4),
      profileRevisionId: uuid(5),
      revision: 2,
      contentSha256: sha("d"),
      state: "CANDIDATE",
    },
    acceptedBaselineProfileRevisionId: uuid(6),
    rollbackProfileRevisionId: uuid(7),
    testedExtension: {
      version: "0.2.11",
      browserFamily: "chrome",
      browserVersion: "154.0.0.0",
      sourceCommitSha: "e".repeat(40),
      sourceTreeSha: "f".repeat(40),
      packageSha256: sha("1"),
    },
    testEvidence: {
      suiteRevisionId: uuid(8),
      suiteMachineKey: "repair-suite",
      suiteRevision: 1,
      suiteDefinitionSha256: sha("2"),
      h4EvaluationId: uuid(9),
      h4EvaluationKey: sha("3"),
      h4Status: "COMPLETED",
      h4Outcome: "PASS",
      installedBehaviorEvidenceSha256: sha("4"),
      matrixSha256: sha("5"),
      resultsSha256: sha("6"),
    },
    assignment: {
      id: uuid(10),
      expectedRevision: 1,
      initialPercentageBps: 1000,
      currentRevision: 1,
      currentRevisionId: uuid(11),
      currentMode: "DIRECT",
      currentBaselineProfileRevisionId: uuid(6),
      currentCandidateProfileRevisionId: null,
      currentPercentageBps: 0,
    },
    decision: null,
    operation: null,
  };
}

describe("repair operator UI presentation", () => {
  it("labels every server case state in Russian", () => {
    const states: RepairCaseState[] = [
      "PENDING_APPROVAL",
      "REJECTED",
      "APPROVAL_REVOKED",
      "APPROVAL_NOT_YET_VALID",
      "APPROVAL_EXPIRED",
      "APPROVAL_STALE",
      "APPROVAL_CURRENT",
      "APPLY_IN_PROGRESS",
      "APPLIED",
    ];
    for (const state of states)
      expect(repairCaseStateLabel(state)).toMatch(/[А-Яа-яЁё]/);
  });

  it("explains every stale reason without turning it into authority", () => {
    const reasons: RepairStaleReason[] = [
      "BINDING_INVALID",
      "BINDING_HASH_INVALID",
      "PROFILE_IDENTITY_CHANGED",
      "OBSERVATION_PROOF_INVALID",
      "OBSERVATION_BINDING_CHANGED",
      "CURRENT_OBSERVATION_MISSING",
      "CURRENT_OBSERVATION_CHANGED",
      "INCIDENT_SCOPE_CHANGED",
      "INCIDENT_NOT_ACTIVE",
      "CANDIDATE_STATE_CHANGED",
      "BASELINE_OR_ROLLBACK_NOT_PUBLISHED",
      "SUITE_CHANGED",
      "H4_CHANGED",
      "ASSIGNMENT_CHANGED",
      "APPROVAL_BINDING_CHANGED",
    ];
    for (const reason of reasons)
      expect(repairStaleReasonLabel(reason)).toMatch(/[А-Яа-яЁё]/);
  });

  it("surfaces missing evidence and changed observations explicitly", () => {
    const item = fixture();
    item.observation.currentRunId = null;
    item.observation.currentNormalizedStateSha256 = null;
    item.observation.currentHealthState = null;
    item.testEvidence.h4Status = null;
    item.testEvidence.h4Outcome = null;
    item.assignment.currentRevision = null;
    item.assignment.currentMode = null;
    item.staleReasons = ["CURRENT_OBSERVATION_MISSING"];
    const gaps = repairEvidenceGaps(item);
    expect(gaps.join(" ")).toContain("контрольного запуска");
    expect(gaps.join(" ")).toContain("H4");
    expect(gaps.join(" ")).toContain("решения оператора");
    expect(repairChangeSummary(item)).toContain("сравнение");
  });

  it("never interprets an approval as UI execution authority", () => {
    const item = fixture();
    item.caseState = "APPROVAL_CURRENT";
    item.decision = {
      id: uuid(12),
      operatorPrincipalId: uuid(13),
      decision: "APPROVED",
      bindingSha256: item.bindingSha256,
      requestSha256: sha("7"),
      manualChecklistSha256: sha("8"),
      issuedAt: "2026-10-01T00:00:00Z",
      expiresAt: "2026-10-02T00:00:00Z",
      revokedAt: null,
      state: "CURRENT_APPROVED",
    };
    expect(repairDecisionLabel(item)).toContain("актуально");
    expect(repairApplyUnavailableReason(item)).toContain(
      "executionAuthority=false",
    );
    expect(repairApplyUnavailableReason(item)).toContain("недоступно");
    expect(repairOperationLabel(item)).toContain("не запускалось");
  });

  it("distinguishes unchanged from changed current observations", () => {
    const item = fixture();
    expect(repairChangeSummary(item)).toContain("совпадает");
    item.observation.currentNormalizedStateSha256 = sha("9");
    expect(repairChangeSummary(item)).toContain("изменилось");
  });

  it("accepts only an exact lowercase 64-hex scope", () => {
    expect(repairScopeValid("a".repeat(64))).toBe(true);
    expect(repairScopeValid("A".repeat(64))).toBe(false);
    expect(repairScopeValid("a".repeat(63))).toBe(false);
    expect(repairScopeValid("g".repeat(64))).toBe(false);
  });
});

describe("repair operator page source boundary", () => {
  const page = readFileSync(
    new URL("../app/health/repairs/page.tsx", import.meta.url),
    "utf8",
  );
  const health = readFileSync(
    new URL("../app/health/page.tsx", import.meta.url),
    "utf8",
  );

  it("uses only the accepted scoped list/detail read routes", () => {
    expect(page).toContain("/v1/admin/health/repair-cases?scopeSha256=");
    expect(page).toContain("/v1/admin/health/repair-cases/");
    expect(page).toContain("health.read");
    expect(page).toContain("ai.profile.read");
    expect(page).toContain("ai.assignment.read");
    expect(page).not.toMatch(/method:\s*["']POST["']/);
    expect(page).not.toContain("Mutation");
  });

  it("states the no-authority boundary and is reachable from Health", () => {
    expect(page).toContain("repairApplyUnavailableReason");
    expect(page).toContain("не применяет исправление");
    expect(health).toContain('href="/health/repairs"');
  });
});
