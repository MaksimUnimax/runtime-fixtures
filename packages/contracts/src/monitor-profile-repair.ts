import { z } from "zod";
import {
  BrowserFamilies,
  SemVerV1Schema,
  StableMachineIdentifierV1Schema,
} from "@product/shared";

// Internal persistence contract. Shape validation is not release authorization.
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const GitSha = z.string().regex(/^[0-9a-f]{40}$/);
const Positive = z.number().int().positive();
const Timestamp = z.string().datetime({ offset: true });
export const MAX_PROFILE_REPAIR_APPROVAL_AGE_MS = 24 * 60 * 60 * 1_000;

export const MonitorProfileRepairRevisionV1Schema = z
  .object({
    profileId: z.uuid(),
    profileRevisionId: z.uuid(),
    revision: Positive,
    contentSha256: Sha256,
  })
  .strict();

const AcceptedProfile = z
  .object({
    acceptedRunId: z.uuid(),
    profile: MonitorProfileRepairRevisionV1Schema,
  })
  .strict();

export const MonitorProfileRepairBindingV1Schema = z
  .object({
    schemaVersion: z.literal("monitor_profile_repair_binding_v1"),
    repairCaseId: z.uuid(),
    caseRevision: Positive,
    incidentId: z.uuid(),
    scopeSha256: Sha256,
    deploymentEnvironment: z.enum([
      "MONITOR_PILOT",
      "OWNER_TEST",
      "PRODUCTION",
    ]),
    observation: z
      .object({ runId: z.uuid(), normalizedStateSha256: Sha256 })
      .strict(),
    acceptedBaseline: AcceptedProfile,
    candidate: MonitorProfileRepairRevisionV1Schema,
    testedExtension: z
      .object({
        version: SemVerV1Schema,
        browserFamily: z.enum(BrowserFamilies),
        browserVersion: z
          .string()
          .min(1)
          .max(64)
          .regex(/^(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)){0,3}$/),
        sourceCommitSha: GitSha,
        sourceTreeSha: GitSha,
        packageSha256: Sha256,
      })
      .strict(),
    suite: z
      .object({
        machineKey: StableMachineIdentifierV1Schema,
        revision: Positive,
        definitionSha256: Sha256,
      })
      .strict(),
    validation: z
      .object({
        h4EvaluationKey: Sha256,
        installedBehaviorEvidenceSha256: Sha256,
        matrixSha256: Sha256,
        resultsSha256: Sha256,
      })
      .strict(),
    assignment: z
      .object({
        id: z.uuid(),
        expectedRevision: Positive,
        // One exact initial P7 rollout; later exposure changes need a new binding.
        initialPercentageBps: z.number().int().min(1).max(10_000),
      })
      .strict(),
    rollback: AcceptedProfile,
  })
  .strict()
  .superRefine((binding, context) => {
    for (const key of ["acceptedBaseline", "rollback"] as const) {
      if (binding[key].profile.profileId !== binding.candidate.profileId) {
        context.addIssue({
          code: "custom",
          path: [key, "profile", "profileId"],
          message:
            "initial repair boundary requires revisions of the same profile",
        });
      }
      if (
        binding[key].profile.profileRevisionId ===
        binding.candidate.profileRevisionId
      ) {
        context.addIssue({
          code: "custom",
          path: [key, "profile", "profileRevisionId"],
          message: "candidate cannot be its own accepted baseline or rollback",
        });
      }
    }
  });

// Only this body is accepted from the protected operator action.
// Principal, clock, expiry and authoritative binding come from the server.
export const MonitorProfileRepairDecisionRequestV1Schema = z
  .object({
    idempotencyKey: z.uuid(),
    repairCaseId: z.uuid(),
    expectedCaseRevision: Positive,
    expectedBindingSha256: Sha256,
    decision: z.enum(["APPROVED", "REJECTED"]),
    manualCheck: z
      .object({
        checkedBindingSha256: Sha256,
        checklistSha256: Sha256,
        result: z.enum(["PASS", "FAIL"]),
      })
      .strict(),
  })
  .strict()
  .superRefine((request, context) => {
    if (
      request.manualCheck.checkedBindingSha256 !== request.expectedBindingSha256
    ) {
      context.addIssue({
        code: "custom",
        path: ["manualCheck", "checkedBindingSha256"],
        message: "manual check must identify the exact reviewed binding",
      });
    }
    if (
      request.decision === "APPROVED" &&
      request.manualCheck.result !== "PASS"
    ) {
      context.addIssue({
        code: "custom",
        path: ["manualCheck", "result"],
        message: "a failed manual check cannot approve release",
      });
    }
  });

export const MonitorProfileRepairApprovalV1Schema = z
  .object({
    schemaVersion: z.literal("monitor_profile_repair_approval_v1"),
    idempotencyKey: z.uuid(),
    id: z.uuid(),
    repairCaseId: z.uuid(),
    caseRevision: Positive,
    bindingSha256: Sha256,
    decision: z.enum(["APPROVED", "REJECTED"]),
    operatorPrincipalId: z.uuid(),
    manualChecklistSha256: Sha256,
    issuedAt: Timestamp,
    expiresAt: Timestamp,
    revokedAt: Timestamp.nullable(),
  })
  .strict()
  .superRefine((approval, context) => {
    const duration =
      Date.parse(approval.expiresAt) - Date.parse(approval.issuedAt);
    if (duration <= 0 || duration > MAX_PROFILE_REPAIR_APPROVAL_AGE_MS) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "approval lifetime must be positive and at most 24 hours",
      });
    }
    if (
      approval.revokedAt !== null &&
      Date.parse(approval.revokedAt) < Date.parse(approval.issuedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["revokedAt"],
        message: "revocation predates approval",
      });
    }
  });

export type MonitorProfileRepairBindingV1 = z.infer<
  typeof MonitorProfileRepairBindingV1Schema
>;
export type MonitorProfileRepairDecisionRequestV1 = z.infer<
  typeof MonitorProfileRepairDecisionRequestV1Schema
>;
export type MonitorProfileRepairApprovalV1 = z.infer<
  typeof MonitorProfileRepairApprovalV1Schema
>;
