import {
  SELLER_AGENTS_CAPABILITY_PERMISSION_DEFINITIONS,
  SELLER_AGENTS_CAPABILITY_PERMISSION_KEYS,
  type SellerAgentsCapabilityPermissionKey,
} from "./seller-agents-capability-permissions.js";
import { isAiPermissionEnabledInReleaseV1 } from "@product/contracts";

export const SELLER_AGENTS_BETA_CAPABILITY_POLICY_VERSION =
  "seller_agents_beta_capability_policy_v2" as const;

export type SellerAgentsBetaCapabilityPolicyRow = Readonly<{
  entitlementKey: SellerAgentsCapabilityPermissionKey;
  allowed: boolean;
  executionAuthority: false;
}>;

export type SellerAgentsBetaCapabilityPolicy = Readonly<{
  schemaVersion: typeof SELLER_AGENTS_BETA_CAPABILITY_POLICY_VERSION;
  accessBasis: "BETA";
  authority: "SERVER_PRODUCT_POLICY_ONLY";
  executionAuthority: false;
  permissions: readonly SellerAgentsBetaCapabilityPolicyRow[];
}>;

const definitionByKey = new Map(
  SELLER_AGENTS_CAPABILITY_PERMISSION_DEFINITIONS.map((definition) => [
    definition.entitlementKey,
    definition,
  ]),
);

const permissions = SELLER_AGENTS_CAPABILITY_PERMISSION_KEYS.map(
  (entitlementKey): SellerAgentsBetaCapabilityPolicyRow => {
    const definition = definitionByKey.get(entitlementKey);
    if (
      !definition ||
      definition.valueType !== "BOOLEAN" ||
      definition.securityClassification !== "CAPABILITY" ||
      definition.executionAuthority !== false
    )
      throw new Error("SELLER_AGENTS_BETA_CAPABILITY_POLICY_INVALID");
    return Object.freeze({
      entitlementKey,
      allowed:
        entitlementKey.startsWith("source.") ||
        isAiPermissionEnabledInReleaseV1(entitlementKey),
      executionAuthority: false as const,
    });
  },
);

Object.freeze(permissions);

export const SELLER_AGENTS_FREE_BETA_CAPABILITY_POLICY: SellerAgentsBetaCapabilityPolicy =
  Object.freeze({
    schemaVersion: SELLER_AGENTS_BETA_CAPABILITY_POLICY_VERSION,
    accessBasis: "BETA" as const,
    authority: "SERVER_PRODUCT_POLICY_ONLY" as const,
    executionAuthority: false as const,
    permissions,
  });

const permissionMap = Object.freeze(
  Object.fromEntries(
    permissions.map((row) => [row.entitlementKey, row.allowed] as const),
  ) as Readonly<Record<SellerAgentsCapabilityPermissionKey, boolean>>,
);

export function getSellerAgentsFreeBetaCapabilityPermissions(): Readonly<
  Record<SellerAgentsCapabilityPermissionKey, boolean>
> {
  return permissionMap;
}
