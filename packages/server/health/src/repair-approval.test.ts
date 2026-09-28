import { describe, expect, it } from "vitest";
import type {
  MonitorProfileRepairApprovalV1,
  MonitorProfileRepairBindingV1,
} from "@product/contracts";
import {
  checkProfileRepairApprovalBinding,
  monitorProfileRepairBindingSha256,
} from "./repair-approval.js";

const id = (n: number) =>
  "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const hash = (value: string) => value.repeat(64);
const binding: MonitorProfileRepairBindingV1 = {
  schemaVersion: "monitor_profile_repair_binding_v1",
  repairCaseId: id(1),
  caseRevision: 1,
  incidentId: id(2),
  scopeSha256: hash("a"),
  deploymentEnvironment: "MONITOR_PILOT",
  observation: { runId: id(3), normalizedStateSha256: hash("b") },
  acceptedBaseline: {
    acceptedRunId: id(4),
    profile: {
      profileId: id(5),
      profileRevisionId: id(6),
      revision: 1,
      contentSha256: hash("c"),
    },
  },
  candidate: {
    profileId: id(5),
    profileRevisionId: id(7),
    revision: 2,
    contentSha256: hash("d"),
  },
  testedExtension: {
    version: "0.2.6",
    browserFamily: "chrome",
    browserVersion: "153.0.0.0",
    sourceCommitSha: "a".repeat(40),
    sourceTreeSha: "b".repeat(40),
    packageSha256: hash("e"),
  },
  suite: {
    machineKey: "chatgpt-standard",
    revision: 1,
    definitionSha256: hash("f"),
  },
  validation: {
    h4EvaluationKey: hash("1"),
    installedBehaviorEvidenceSha256: hash("2"),
    matrixSha256: hash("3"),
    resultsSha256: hash("4"),
  },
  assignment: { id: id(8), expectedRevision: 3, initialPercentageBps: 1_000 },
  rollback: {
    acceptedRunId: id(9),
    profile: {
      profileId: id(5),
      profileRevisionId: id(6),
      revision: 1,
      contentSha256: hash("c"),
    },
  },
};
const approval: MonitorProfileRepairApprovalV1 = {
  schemaVersion: "monitor_profile_repair_approval_v1",
  id: id(10),
  idempotencyKey: id(12),
  repairCaseId: binding.repairCaseId,
  caseRevision: binding.caseRevision,
  bindingSha256: monitorProfileRepairBindingSha256(binding),
  decision: "APPROVED",
  operatorPrincipalId: id(11),
  manualChecklistSha256: hash("5"),
  issuedAt: "2026-09-28T06:00:00Z",
  expiresAt: "2026-09-29T06:00:00Z",
  revokedAt: null,
};
const now = new Date("2026-09-28T12:00:00Z");
function changed(path: string, value: unknown) {
  const candidate = structuredClone(binding) as unknown as Record<
    string,
    unknown
  >;
  const keys = path.split(".");
  let target = candidate;
  for (const key of keys.slice(0, -1))
    target = target[key] as Record<string, unknown>;
  target[keys[keys.length - 1]!] = value;
  return candidate;
}
function check(
  currentBinding: unknown = binding,
  receipt: unknown = approval,
  at = now,
) {
  return checkProfileRepairApprovalBinding({
    currentBinding,
    approval: receipt,
    now: at,
  });
}

describe("profile repair approval binding check", () => {
  it("matches exact current bytes and returns identity, never execution authority", () => {
    expect(check()).toEqual({
      status: "CURRENT",
      bindingSha256: approval.bindingSha256,
      approvalId: approval.id,
    });
    expect(check()).not.toHaveProperty("executionAuthority");
  });
  it("fingerprints semantic content independently of object-key order", () => {
    const reordered = Object.fromEntries(Object.entries(binding).reverse());
    expect(monitorProfileRepairBindingSha256(reordered)).toBe(
      approval.bindingSha256,
    );
  });
  it.each([
    ["incidentId", id(22)],
    ["scopeSha256", hash("0")],
    ["deploymentEnvironment", "PRODUCTION"],
    ["observation.runId", id(23)],
    ["observation.normalizedStateSha256", hash("0")],
    ["acceptedBaseline.acceptedRunId", id(24)],
    ["acceptedBaseline.profile.contentSha256", hash("0")],
    ["candidate.profileRevisionId", id(25)],
    ["candidate.revision", 3],
    ["candidate.contentSha256", hash("0")],
    ["testedExtension.version", "0.2.7"],
    ["testedExtension.browserFamily", "firefox"],
    ["testedExtension.browserVersion", "154.0.0.0"],
    ["testedExtension.sourceCommitSha", "c".repeat(40)],
    ["testedExtension.sourceTreeSha", "c".repeat(40)],
    ["testedExtension.packageSha256", hash("0")],
    ["suite.machineKey", "another-suite"],
    ["suite.revision", 2],
    ["suite.definitionSha256", hash("0")],
    ["validation.h4EvaluationKey", hash("0")],
    ["validation.installedBehaviorEvidenceSha256", hash("0")],
    ["validation.matrixSha256", hash("0")],
    ["validation.resultsSha256", hash("0")],
    ["assignment.id", id(26)],
    ["assignment.expectedRevision", 4],
    ["assignment.initialPercentageBps", 10_000],
    ["rollback.acceptedRunId", id(27)],
    ["rollback.profile.contentSha256", hash("0")],
  ])("invalidates approval after current %s changes", (path, value) => {
    expect(check(changed(path as string, value))).toEqual({
      status: "BLOCKED",
      reason: "BINDING_CHANGED",
    });
  });
  it("rejects a different case or case revision before the fingerprint check", () => {
    for (const change of [{ repairCaseId: id(20) }, { caseRevision: 2 }]) {
      expect(check({ ...binding, ...change })).toEqual({
        status: "BLOCKED",
        reason: "CASE_MISMATCH",
      });
    }
  });
  it.each([
    ["2026-09-28T05:59:59.999Z", "APPROVAL_NOT_YET_VALID"],
    ["2026-09-29T06:00:00Z", "APPROVAL_EXPIRED"],
    ["2026-09-29T06:00:00.001Z", "APPROVAL_EXPIRED"],
  ])("rejects outside the exact approval interval at %s", (at, reason) => {
    expect(check(binding, approval, new Date(at))).toEqual({
      status: "BLOCKED",
      reason,
    });
  });
  it("accepts the inclusive issue and exclusive expiry boundary", () => {
    for (const at of ["2026-09-28T06:00:00Z", "2026-09-29T05:59:59.999Z"]) {
      expect(check(binding, approval, new Date(at)).status).toBe("CURRENT");
    }
  });
  it("cannot turn rejected, revoked or malformed receipts into current approval", () => {
    expect(check(binding, { ...approval, decision: "REJECTED" })).toEqual({
      status: "BLOCKED",
      reason: "APPROVAL_REJECTED",
    });
    expect(
      check(binding, { ...approval, revokedAt: "2026-09-28T11:00:00Z" }),
    ).toEqual({ status: "BLOCKED", reason: "APPROVAL_REVOKED" });
    expect(check(binding, null)).toEqual({
      status: "BLOCKED",
      reason: "INVALID_APPROVAL",
    });
    expect(check(binding, { ...approval, bindingSha256: hash("0") })).toEqual({
      status: "BLOCKED",
      reason: "BINDING_CHANGED",
    });
    expect(check(binding, approval, new Date(NaN))).toEqual({
      status: "BLOCKED",
      reason: "INVALID_CLOCK",
    });
  });
  it.each([
    ["rawDom", "private data"],
    ["candidate.profileId", id(30)],
    ["rollback.profile.profileRevisionId", binding.candidate.profileRevisionId],
    [
      "acceptedBaseline.profile.profileRevisionId",
      binding.candidate.profileRevisionId,
    ],
    ["assignment.expectedRevision", 0],
    ["assignment.initialPercentageBps", 0],
    ["assignment.initialPercentageBps", 10_001],
    ["testedExtension.sourceCommitSha", "mutable-branch-name"],
    ["validation.installedBehaviorEvidenceSha256", null],
  ])("fails closed for malformed or incomplete current %s", (path, value) => {
    expect(check(changed(path as string, value))).toEqual({
      status: "BLOCKED",
      reason: "INVALID_CURRENT_BINDING",
    });
  });
});
