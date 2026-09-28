import { describe, expect, it } from "vitest";
import {
  MAX_PROFILE_REPAIR_APPROVAL_AGE_MS,
  MonitorProfileRepairApprovalV1Schema,
  MonitorProfileRepairDecisionRequestV1Schema,
} from "./index.js";

const uuid = "00000000-0000-4000-8000-000000000001";
const hash = "a".repeat(64);
const request = {
  idempotencyKey: uuid,
  repairCaseId: uuid,
  expectedCaseRevision: 1,
  expectedBindingSha256: hash,
  decision: "APPROVED",
  manualCheck: {
    checkedBindingSha256: hash,
    checklistSha256: "b".repeat(64),
    result: "PASS",
  },
};
const approval = {
  schemaVersion: "monitor_profile_repair_approval_v1",
  idempotencyKey: uuid,
  id: uuid,
  repairCaseId: uuid,
  caseRevision: 1,
  bindingSha256: hash,
  decision: "APPROVED",
  operatorPrincipalId: uuid,
  manualChecklistSha256: "b".repeat(64),
  issuedAt: "2026-09-28T06:00:00Z",
  expiresAt: "2026-09-29T06:00:00Z",
  revokedAt: null,
};

describe("operator profile repair decision boundary", () => {
  it("accepts the exact manual decision while retaining the retry identity", () => {
    expect(MonitorProfileRepairDecisionRequestV1Schema.parse(request)).toEqual(
      request,
    );
    expect(MonitorProfileRepairApprovalV1Schema.parse(approval)).toEqual(
      approval,
    );
  });
  it.each([
    "operatorPrincipalId",
    "actorId",
    "issuedAt",
    "expiresAt",
    "system",
    "human",
    "authorized",
  ])("rejects caller-controlled authority field %s", (field) =>
    expect(
      MonitorProfileRepairDecisionRequestV1Schema.safeParse({
        ...request,
        [field]: "spoofed",
      }).success,
    ).toBe(false),
  );
  it("rejects a manual check of other bytes or a failed check used to approve", () => {
    for (const change of [
      { checkedBindingSha256: "c".repeat(64) },
      { result: "FAIL" },
    ]) {
      expect(
        MonitorProfileRepairDecisionRequestV1Schema.safeParse({
          ...request,
          manualCheck: { ...request.manualCheck, ...change },
        }).success,
      ).toBe(false);
    }
    expect(
      MonitorProfileRepairDecisionRequestV1Schema.safeParse({
        ...request,
        decision: "REJECTED",
        manualCheck: { ...request.manualCheck, result: "FAIL" },
      }).success,
    ).toBe(true);
  });
  it("bounds approval lifetime and requires a valid time order", () => {
    expect(MAX_PROFILE_REPAIR_APPROVAL_AGE_MS).toBe(86_400_000);
    for (const expiresAt of [
      "2026-09-28T06:00:00Z",
      "2026-09-28T05:59:59Z",
      "2026-09-29T06:00:00.001Z",
    ]) {
      expect(
        MonitorProfileRepairApprovalV1Schema.safeParse({
          ...approval,
          expiresAt,
        }).success,
      ).toBe(false);
    }
    expect(
      MonitorProfileRepairApprovalV1Schema.safeParse({
        ...approval,
        revokedAt: "2026-09-28T05:59:59Z",
      }).success,
    ).toBe(false);
  });
  it("rejects missing idempotency and mutable extra receipt material", () => {
    expect(
      MonitorProfileRepairDecisionRequestV1Schema.safeParse({
        ...request,
        idempotencyKey: undefined,
      }).success,
    ).toBe(false);
    expect(
      MonitorProfileRepairApprovalV1Schema.safeParse({
        ...approval,
        rawDom: "private content",
      }).success,
    ).toBe(false);
  });
});
