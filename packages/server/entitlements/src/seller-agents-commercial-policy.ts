import {
  SELLER_AGENTS_CAPABILITY_PERMISSION_KEYS,
  type SellerAgentsCapabilityPermissionKey,
} from "./seller-agents-capability-permissions.js";
import type { SellerAgentsDeviceLimit } from "./seller-agents-device-admission.js";

export const SELLER_AGENTS_COMMERCIAL_MODE_ENV =
  "SELLER_AGENTS_COMMERCIAL_MODE" as const;
export const SELLER_AGENTS_COMMERCIAL_MODE_DEFAULT = "DISABLED" as const;

export type SellerAgentsCommercialMode = "DISABLED" | "ENABLED";
export type SellerAgentsCommercialLifecycle =
  | "ACTIVE"
  | "GRACE"
  | "ENDED"
  | "SUSPENDED";

export type SellerAgentsCommercialEntitlement = Readonly<{
  accountId: string;
  planCode: string;
  lifecycle: SellerAgentsCommercialLifecycle;
  entitlementRevision: number;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  source: "BILLING_PROVIDER" | "SYSTEM_RECONCILIATION" | "ADMIN";
  externalReference: string | null;
  lastVerifiedProviderEventVersion: number;
  permissions: Readonly<Record<string, boolean | number>>;
  /** Future plan projection; absent for current beta/commercial records. */
  deviceLimit?: SellerAgentsDeviceLimit;
}>;

export type SellerAgentsEffectiveAccess = Readonly<{
  accessBasis: "BETA" | "COMMERCIAL" | "NONE";
  commercialEntitlementRevision: number | null;
  permissions: Readonly<Record<string, boolean | number>>;
}>;

function copyPermissions(
  permissions: Readonly<Record<string, boolean | number>>,
): Record<string, boolean | number> {
  const copy: Record<string, boolean | number> = {};
  for (const [key, value] of Object.entries(permissions)) {
    if (typeof value !== "boolean" && !Number.isSafeInteger(value)) continue;
    copy[key] = value;
  }
  return copy;
}

function validAt(
  entitlement: SellerAgentsCommercialEntitlement,
  at: Date,
): boolean {
  return (
    (entitlement.lifecycle === "ACTIVE" || entitlement.lifecycle === "GRACE") &&
    entitlement.effectiveFrom <= at &&
    (entitlement.effectiveUntil === null || at < entitlement.effectiveUntil)
  );
}

/**
 * Resolves one server-owned access basis into the existing signed permission
 * vocabulary. FREE_BETA is never represented as a commercial entitlement.
 * Beta precedence and the narrow beta overlay preserve the accepted current
 * Bootstrap behavior when both bases are present.
 */
export function resolveSellerAgentsEffectiveAccess(input: {
  mode?: SellerAgentsCommercialMode;
  betaEligible: boolean;
  commercial: SellerAgentsCommercialEntitlement | null;
  at: Date;
}): SellerAgentsEffectiveAccess {
  const mode = input.mode ?? SELLER_AGENTS_COMMERCIAL_MODE_DEFAULT;
  const commercialEligible =
    mode === "ENABLED" &&
    input.commercial !== null &&
    Number.isSafeInteger(input.commercial.entitlementRevision) &&
    input.commercial.entitlementRevision > 0 &&
    validAt(input.commercial, input.at);

  const commercialPermissions = commercialEligible
    ? copyPermissions(input.commercial!.permissions)
    : {};

  if (input.betaEligible) {
    const permissions = commercialPermissions;
    for (const key of SELLER_AGENTS_CAPABILITY_PERMISSION_KEYS)
      permissions[key] = true;
    return Object.freeze({
      accessBasis: "BETA",
      commercialEntitlementRevision: commercialEligible
        ? input.commercial!.entitlementRevision
        : null,
      permissions: Object.freeze(permissions),
    });
  }

  if (commercialEligible) {
    return Object.freeze({
      accessBasis: "COMMERCIAL",
      commercialEntitlementRevision: input.commercial!.entitlementRevision,
      permissions: Object.freeze(commercialPermissions),
    });
  }

  return Object.freeze({
    accessBasis: "NONE",
    commercialEntitlementRevision: null,
    permissions: Object.freeze({}),
  });
}

/**
 * Projects only reviewed Seller Agents capability keys from a commercial plan.
 * Limits and unknown product keys remain server-only and cannot manufacture a
 * browser capability.
 */
export function sellerAgentsCommercialCapabilityPermissions(
  permissions: Readonly<Record<string, boolean | number>>,
): Readonly<Record<SellerAgentsCapabilityPermissionKey, true>> {
  const result = {} as Record<SellerAgentsCapabilityPermissionKey, true>;
  for (const key of SELLER_AGENTS_CAPABILITY_PERMISSION_KEYS) {
    if (permissions[key] === true) result[key] = true;
  }
  return Object.freeze(result);
}

export function sellerAgentsCommercialModeFromEnvironment(
  environment: NodeJS.ProcessEnv,
): SellerAgentsCommercialMode {
  return environment[SELLER_AGENTS_COMMERCIAL_MODE_ENV] === "ENABLED"
    ? "ENABLED"
    : SELLER_AGENTS_COMMERCIAL_MODE_DEFAULT;
}
