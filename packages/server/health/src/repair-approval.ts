import { createHash } from "node:crypto";
import { canonicalizeJson } from "@product/remote-config";
import {
  MonitorProfileRepairApprovalV1Schema,
  MonitorProfileRepairBindingV1Schema,
} from "@product/contracts";

export function monitorProfileRepairBindingSha256(binding: unknown): string {
  const validated = MonitorProfileRepairBindingV1Schema.parse(binding);
  return createHash("sha256").update(canonicalizeJson(validated)).digest("hex");
}

export type ProfileRepairApprovalBindingCheck =
  | { status: "CURRENT"; bindingSha256: string; approvalId: string }
  | {
      status: "BLOCKED";
      reason:
        | "INVALID_CURRENT_BINDING"
        | "INVALID_APPROVAL"
        | "INVALID_CLOCK"
        | "CASE_MISMATCH"
        | "APPROVAL_REJECTED"
        | "APPROVAL_REVOKED"
        | "APPROVAL_NOT_YET_VALID"
        | "APPROVAL_EXPIRED"
        | "BINDING_CHANGED";
    };

/**
 * Checks identity and time only; CURRENT is NOT execution authority.
 * The repository must rebuild currentBinding from locked trusted records, verify
 * evidence/actor/scope/rollback authority and atomically compare-and-swap P7.
 * Never feed caller-supplied "current" fields or use this as an approval endpoint.
 */
export function checkProfileRepairApprovalBinding(input: {
  currentBinding: unknown;
  approval: unknown;
  now: Date;
}): ProfileRepairApprovalBindingCheck {
  const current = MonitorProfileRepairBindingV1Schema.safeParse(
    input.currentBinding,
  );
  if (!current.success)
    return { status: "BLOCKED", reason: "INVALID_CURRENT_BINDING" };
  const parsedApproval = MonitorProfileRepairApprovalV1Schema.safeParse(
    input.approval,
  );
  if (!parsedApproval.success)
    return { status: "BLOCKED", reason: "INVALID_APPROVAL" };
  if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) {
    return { status: "BLOCKED", reason: "INVALID_CLOCK" };
  }
  const approval = parsedApproval.data;
  if (
    approval.repairCaseId !== current.data.repairCaseId ||
    approval.caseRevision !== current.data.caseRevision
  ) {
    return { status: "BLOCKED", reason: "CASE_MISMATCH" };
  }
  if (approval.decision !== "APPROVED")
    return { status: "BLOCKED", reason: "APPROVAL_REJECTED" };
  if (approval.revokedAt !== null)
    return { status: "BLOCKED", reason: "APPROVAL_REVOKED" };
  const now = input.now.getTime();
  if (now < Date.parse(approval.issuedAt))
    return { status: "BLOCKED", reason: "APPROVAL_NOT_YET_VALID" };
  if (now >= Date.parse(approval.expiresAt))
    return { status: "BLOCKED", reason: "APPROVAL_EXPIRED" };
  const bindingSha256 = monitorProfileRepairBindingSha256(current.data);
  if (bindingSha256 !== approval.bindingSha256)
    return { status: "BLOCKED", reason: "BINDING_CHANGED" };
  return { status: "CURRENT", bindingSha256, approvalId: approval.id };
}
