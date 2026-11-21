import {
  ADMIN_ROLES,
  type AdminPermission,
  type AdminRole,
} from "@product/admin-auth";
import {
  SubscriptionStateSchema,
  type SubscriptionState,
} from "@product/subscriptions";
import { z } from "zod";

// Internal B14 preparation, not a public HTTP or write contract. A future
// category writer and API integration require their separately agreed scope.
export const B14_AUDIT_REASON_CATEGORIES = [
  "ACCESS_SETUP",
  "ACCESS_REVIEW",
  "SECURITY_RESPONSE",
  "SUPPORT_REQUEST",
  "TEST_VALIDATION",
] as const;
export type B14AuditReasonCategory =
  (typeof B14_AUDIT_REASON_CATEGORIES)[number];

/**
 * A caller projects only these fields from a private audit row. Do not pass the
 * row, raw reason, or metadata to a serializer. Missing legacy fields remain
 * absent; null and other malformed values are not substitutes for absence.
 */
export type B14AuditSummaryProjection = Readonly<{
  action: unknown;
  targetType: unknown;
  initialRole?: unknown;
  role?: unknown;
  oldRevision?: unknown;
  newRevision?: unknown;
  revokedSessionCount?: unknown;
  reasonCategory?: unknown;
  // Selected subscription metadata; grant records do not contain a period.
  planRevisionId?: unknown;
  fromState?: unknown;
  toState?: unknown;
  stateRevision?: unknown;
  transitionRevision?: unknown;
  oldStateRevision?: unknown;
  newStateRevision?: unknown;
  oldPeriodEnd?: unknown;
  newPeriodEnd?: unknown;
  // Override metadata contains the value type, but never value/before/after.
  entitlementKey?: unknown;
  overrideRevision?: unknown;
  operation?: unknown;
  valueType?: unknown;
  effectiveFrom?: unknown;
  expiresAt?: unknown;
  // Project metadata.action and individual metadata.old/new members. No raw
  // object or request/payload hash belongs in the input or output contract.
  betaAction?: unknown;
  oldMode?: unknown;
  newMode?: unknown;
  oldCapacity?: unknown;
  newCapacity?: unknown;
  oldAdmitted?: unknown;
  newAdmitted?: unknown;
  // Beta old.revision/new.revision use oldRevision/newRevision above.
}>;

type RevisionChange = { from: number; to: number };
type RestorableSubscriptionState = Exclude<
  SubscriptionState,
  "EXPIRED" | "SUSPENDED"
>;
type BetaMode = "CLOSED" | "OPEN" | "PAUSED";
type BetaAction = "OPEN" | "PAUSE" | "CLOSE" | "ADD_CAPACITY" | "SET_CAPACITY";
type BetaAdmissionSnapshot = {
  mode: BetaMode;
  capacity: number;
  admitted: number;
  revision: number;
};
export type B14AuditWhat =
  | { kind: "ADMIN_PRINCIPAL_CREATED"; initialRole: AdminRole }
  | {
      kind: "ADMIN_ROLE_GRANTED";
      role: AdminRole;
      revision?: RevisionChange;
    }
  | {
      kind: "ADMIN_ROLE_REVOKED";
      role: AdminRole;
      revision: RevisionChange;
    }
  | {
      kind: "ADMIN_PRINCIPAL_SUSPENDED";
      revision: RevisionChange;
      revokedSessionCount: number;
    }
  | { kind: "ADMIN_PRINCIPAL_RESTORED"; revision: RevisionChange }
  | { kind: "ADMIN_DEVICE_REVOKED" }
  | {
      kind: "SUBSCRIPTION_GRANTED";
      planRevisionId: string;
      fromState: null;
      toState: "ACTIVE";
      stateRevision: 1;
      transitionRevision: 1;
    }
  | {
      kind: "SUBSCRIPTION_EXTENDED";
      revision: RevisionChange;
      periodEnd: { from: string; to: string };
    }
  | {
      kind: "SUBSCRIPTION_SUSPENDED";
      fromState: RestorableSubscriptionState;
      toState: "SUSPENDED";
      revision: RevisionChange;
      transitionRevision: number;
    }
  | {
      kind: "SUBSCRIPTION_RESTORED";
      fromState: "SUSPENDED";
      toState: RestorableSubscriptionState;
      revision: RevisionChange;
      transitionRevision: number;
    }
  | {
      kind:
        | "ACCOUNT_ENTITLEMENT_OVERRIDE_SET"
        | "ACCOUNT_ENTITLEMENT_OVERRIDE_CLEARED";
      entitlementKey: string;
      overrideRevision: number;
      operation: "SET" | "CLEAR";
      valueType: "BOOLEAN" | "INTEGER";
      effectiveFrom: string;
      expiresAt: string | null;
    }
  | {
      kind: "BETA_ADMISSION_CHANGED";
      action: BetaAction;
      old: BetaAdmissionSnapshot;
      new: BetaAdmissionSnapshot;
    }
  | { kind: "BETA_IDENTITY_INVITED"; expiresAt: string }
  | { kind: "BETA_IDENTITY_INVITATION_REVOKED" };

export type B14AuditSummary = {
  what: B14AuditWhat;
  reasonCategory?: B14AuditReasonCategory;
};

const roleSet = new Set<string>(ADMIN_ROLES);
const categorySet = new Set<string>(B14_AUDIT_REASON_CATEGORIES);
const MAX_PG_INTEGER = 2_147_483_647;
const uuidSchema = z.uuid();
const timestampSchema = z.string().max(40).datetime({ offset: true });
// Same closed machine-key grammar as plans' EntitlementKeySchema. This module
// does not add a package dependency, read a definition, or expose its value.
const entitlementKeyPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;

function knownRole(value: unknown): AdminRole | undefined {
  return typeof value === "string" && roleSet.has(value)
    ? (value as AdminRole)
    : undefined;
}

function knownCategory(value: unknown): B14AuditReasonCategory | undefined {
  return typeof value === "string" && categorySet.has(value)
    ? (value as B14AuditReasonCategory)
    : undefined;
}

function revisionChange(
  input: B14AuditSummaryProjection,
): RevisionChange | undefined {
  return sequentialRevision(input.oldRevision, input.newRevision);
}

function pgInteger(value: unknown, minimum: 0 | 1): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= MAX_PG_INTEGER
  );
}

function sequentialRevision(
  oldRevision: unknown,
  newRevision: unknown,
): RevisionChange | undefined {
  if (
    !pgInteger(oldRevision, 1) ||
    !pgInteger(newRevision, 1) ||
    newRevision !== oldRevision + 1
  )
    return undefined;
  return { from: oldRevision, to: newRevision };
}

function auditTimestamp(value: unknown): string | undefined {
  // Audit JSON stores timestamp strings, not Date objects. Do not coerce
  // arbitrary objects or invoke their methods. Historical times stay valid;
  // reading an event never re-evaluates its period or expiry against now.
  const parsed = timestampSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const epoch = Date.parse(parsed.data);
  if (!Number.isFinite(epoch)) return undefined;
  const normalized = new Date(epoch).toISOString();
  // Keep the DTO's timestamp in the validated four-digit UTC year range.
  return normalized.length === 24 ? normalized : undefined;
}

function restorableState(
  value: unknown,
): RestorableSubscriptionState | undefined {
  const parsed = SubscriptionStateSchema.safeParse(value);
  return parsed.success &&
    parsed.data !== "EXPIRED" &&
    parsed.data !== "SUSPENDED"
    ? parsed.data
    : undefined;
}

function subscriptionWhat(
  input: B14AuditSummaryProjection,
): B14AuditWhat | undefined {
  if (input.action === "SUBSCRIPTION_GRANTED") {
    const plan = uuidSchema.safeParse(input.planRevisionId);
    if (
      !plan.success ||
      input.fromState !== null ||
      input.toState !== "ACTIVE" ||
      input.stateRevision !== 1 ||
      input.transitionRevision !== 1
    )
      return undefined;
    // p5-subscription-repository records no grant period. Do not synthesize
    // dates, commercial price data, or old subscription state here.
    return {
      kind: "SUBSCRIPTION_GRANTED",
      planRevisionId: plan.data,
      fromState: null,
      toState: "ACTIVE",
      stateRevision: 1,
      transitionRevision: 1,
    };
  }
  const revision = sequentialRevision(
    input.oldStateRevision,
    input.newStateRevision,
  );
  if (!revision) return undefined;
  if (input.action === "SUBSCRIPTION_EXTENDED") {
    const from = auditTimestamp(input.oldPeriodEnd);
    const to = auditTimestamp(input.newPeriodEnd);
    if (!from || !to || !(Date.parse(to) > Date.parse(from))) return undefined;
    return {
      kind: "SUBSCRIPTION_EXTENDED",
      revision,
      periodEnd: { from, to },
    };
  }
  // Revision 1 is the origin transition with fromState=null. Both status
  // changes below have a previous state and must follow that origin row.
  if (!pgInteger(input.transitionRevision, 1) || input.transitionRevision < 2)
    return undefined;
  if (input.action === "SUBSCRIPTION_SUSPENDED") {
    const fromState = restorableState(input.fromState);
    if (!fromState || input.toState !== "SUSPENDED") return undefined;
    return {
      kind: "SUBSCRIPTION_SUSPENDED",
      fromState,
      toState: "SUSPENDED",
      revision,
      transitionRevision: input.transitionRevision,
    };
  }
  if (input.action === "SUBSCRIPTION_RESTORED") {
    const toState = restorableState(input.toState);
    if (input.fromState !== "SUSPENDED" || !toState) return undefined;
    return {
      kind: "SUBSCRIPTION_RESTORED",
      fromState: "SUSPENDED",
      toState,
      revision,
      transitionRevision: input.transitionRevision,
    };
  }
  return undefined;
}

function entitlementWhat(
  input: B14AuditSummaryProjection,
): B14AuditWhat | undefined {
  if (
    !(
      (input.action === "ACCOUNT_ENTITLEMENT_OVERRIDE_SET" &&
        input.operation === "SET") ||
      (input.action === "ACCOUNT_ENTITLEMENT_OVERRIDE_CLEARED" &&
        input.operation === "CLEAR")
    ) ||
    typeof input.entitlementKey !== "string" ||
    input.entitlementKey.length > 128 ||
    input.entitlementKey !== input.entitlementKey.trim() ||
    !entitlementKeyPattern.test(input.entitlementKey) ||
    !pgInteger(input.overrideRevision, 1) ||
    (input.valueType !== "BOOLEAN" && input.valueType !== "INTEGER")
  )
    return undefined;
  const effectiveFrom = auditTimestamp(input.effectiveFrom);
  const expiresAt =
    input.expiresAt === null ? null : auditTimestamp(input.expiresAt);
  if (
    !effectiveFrom ||
    expiresAt === undefined ||
    (expiresAt !== null && !(Date.parse(expiresAt) > Date.parse(effectiveFrom)))
  )
    return undefined;
  // The writer records type and scheduling, not value/before/after. A CLEAR
  // event likewise does not prove a particular resulting effective value.
  return {
    kind: input.action as
      | "ACCOUNT_ENTITLEMENT_OVERRIDE_SET"
      | "ACCOUNT_ENTITLEMENT_OVERRIDE_CLEARED",
    entitlementKey: input.entitlementKey,
    overrideRevision: input.overrideRevision,
    operation: input.operation as "SET" | "CLEAR",
    valueType: input.valueType,
    effectiveFrom,
    expiresAt,
  };
}

function betaSnapshot(
  mode: unknown,
  capacity: unknown,
  admitted: unknown,
  revision: unknown,
): BetaAdmissionSnapshot | undefined {
  if (
    (mode !== "CLOSED" && mode !== "OPEN" && mode !== "PAUSED") ||
    !pgInteger(capacity, 0) ||
    !pgInteger(admitted, 0) ||
    admitted > capacity ||
    !pgInteger(revision, 1)
  )
    return undefined;
  return { mode, capacity, admitted, revision };
}

function betaWhat(input: B14AuditSummaryProjection): B14AuditWhat | undefined {
  if (
    input.action !== "BETA_ADMISSION_CHANGED" ||
    (input.betaAction !== "OPEN" &&
      input.betaAction !== "PAUSE" &&
      input.betaAction !== "CLOSE" &&
      input.betaAction !== "ADD_CAPACITY" &&
      input.betaAction !== "SET_CAPACITY")
  )
    return undefined;
  const oldState = betaSnapshot(
    input.oldMode,
    input.oldCapacity,
    input.oldAdmitted,
    input.oldRevision,
  );
  const newState = betaSnapshot(
    input.newMode,
    input.newCapacity,
    input.newAdmitted,
    input.newRevision,
  );
  if (
    !oldState ||
    !newState ||
    newState.revision !== oldState.revision + 1 ||
    newState.admitted !== oldState.admitted
  )
    return undefined;
  switch (input.betaAction) {
    case "OPEN":
    case "PAUSE":
    case "CLOSE": {
      const mode =
        input.betaAction === "OPEN"
          ? "OPEN"
          : input.betaAction === "PAUSE"
            ? "PAUSED"
            : "CLOSED";
      if (newState.mode !== mode || newState.capacity !== oldState.capacity)
        return undefined;
      break;
    }
    case "ADD_CAPACITY":
      if (
        newState.mode !== oldState.mode ||
        newState.capacity <= oldState.capacity
      )
        return undefined;
      break;
    case "SET_CAPACITY":
      if (newState.mode !== oldState.mode) return undefined;
      break;
  }
  // Pending invitations, remaining capacity and request hashes are not in
  // these snapshots. Do not invent them or use them to infer an admission.
  return {
    kind: "BETA_ADMISSION_CHANGED",
    action: input.betaAction,
    old: oldState,
    new: newState,
  };
}

/**
 * Permissions must come from the authenticated subject. This mapper provides
 * no DB access and does not replace route authorization. Unknown action/target
 * pairs, invalid relevant fields, or missing read authority yield no summary.
 * Output is constructed field by field: private extras can never become a
 * fallback description. The existing envelope supplies actor/time/reference.
 */
export function mapB14AuditSummary(
  input: B14AuditSummaryProjection,
  permissions: readonly AdminPermission[],
): B14AuditSummary | undefined {
  if (!permissions.includes("admin.audit.read")) return undefined;
  const reasonCategory = knownCategory(input.reasonCategory);
  if (input.reasonCategory !== undefined && reasonCategory === undefined)
    return undefined;

  let what: B14AuditWhat;
  if (input.targetType === "ADMIN_PRINCIPAL") {
    if (!permissions.includes("admin.principal.read")) return undefined;
    switch (input.action) {
      case "ADMIN_PRINCIPAL_CREATED": {
        const initialRole = knownRole(input.initialRole);
        if (!initialRole) return undefined;
        what = { kind: "ADMIN_PRINCIPAL_CREATED", initialRole };
        break;
      }
      case "ADMIN_ROLE_GRANTED": {
        const role = knownRole(input.role);
        if (!role) return undefined;
        // The initial grant written during principal creation has no revisions.
        if (
          input.oldRevision === undefined &&
          input.newRevision === undefined
        ) {
          what = { kind: "ADMIN_ROLE_GRANTED", role };
        } else {
          const revision = revisionChange(input);
          if (!revision) return undefined;
          what = { kind: "ADMIN_ROLE_GRANTED", role, revision };
        }
        break;
      }
      case "ADMIN_ROLE_REVOKED": {
        const role = knownRole(input.role);
        const revision = revisionChange(input);
        if (!role || !revision) return undefined;
        what = { kind: "ADMIN_ROLE_REVOKED", role, revision };
        break;
      }
      case "ADMIN_PRINCIPAL_SUSPENDED": {
        const revision = revisionChange(input);
        const { revokedSessionCount } = input;
        if (
          !revision ||
          typeof revokedSessionCount !== "number" ||
          !Number.isSafeInteger(revokedSessionCount) ||
          revokedSessionCount < 0
        )
          return undefined;
        what = {
          kind: "ADMIN_PRINCIPAL_SUSPENDED",
          revision,
          revokedSessionCount,
        };
        break;
      }
      case "ADMIN_PRINCIPAL_RESTORED": {
        const revision = revisionChange(input);
        if (!revision) return undefined;
        what = { kind: "ADMIN_PRINCIPAL_RESTORED", revision };
        break;
      }
      default:
        return undefined;
    }
  } else if (
    input.targetType === "DEVICE" &&
    input.action === "ADMIN_DEVICE_REVOKED"
  ) {
    if (!permissions.includes("device.read")) return undefined;
    // Account and session identifiers, session counts, and raw device metadata
    // are not part of this event's projection. Never infer them from the action.
    what = { kind: "ADMIN_DEVICE_REVOKED" };
  } else if (input.targetType === "SUBSCRIPTION") {
    if (!permissions.includes("subscription.read")) return undefined;
    const projected = subscriptionWhat(input);
    if (!projected) return undefined;
    what = projected;
  } else if (input.targetType === "ACCOUNT") {
    if (!permissions.includes("entitlement.read")) return undefined;
    const projected = entitlementWhat(input);
    if (!projected) return undefined;
    what = projected;
  } else if (input.targetType === "BETA_ADMISSION_STATE") {
    if (!permissions.includes("beta.admission.read")) return undefined;
    const projected = betaWhat(input);
    if (!projected) return undefined;
    what = projected;
  } else if (input.targetType === "BETA_IDENTITY_INVITATION") {
    if (!permissions.includes("beta.admission.read")) return undefined;
    if (input.action === "BETA_IDENTITY_INVITED") {
      const expiresAt = auditTimestamp(input.expiresAt);
      if (!expiresAt) return undefined;
      what = { kind: "BETA_IDENTITY_INVITED", expiresAt };
    } else if (input.action === "BETA_IDENTITY_INVITATION_REVOKED") {
      // The revocation event has no expiry or identity, only a private hash.
      what = { kind: "BETA_IDENTITY_INVITATION_REVOKED" };
    } else {
      return undefined;
    }
  } else {
    return undefined;
  }

  return reasonCategory === undefined ? { what } : { what, reasonCategory };
}
