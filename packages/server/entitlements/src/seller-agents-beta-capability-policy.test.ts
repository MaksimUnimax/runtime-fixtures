import { describe, expect, it } from "vitest";
import {
  SELLER_AGENTS_CAPABILITY_PERMISSION_DEFINITIONS,
  SELLER_AGENTS_CAPABILITY_PERMISSION_KEYS,
} from "./seller-agents-capability-permissions.js";
import {
  SELLER_AGENTS_BETA_CAPABILITY_POLICY_VERSION,
  SELLER_AGENTS_FREE_BETA_CAPABILITY_POLICY,
  getSellerAgentsFreeBetaCapabilityPermissions,
} from "./seller-agents-beta-capability-policy.js";

const EXPECTED = [
  "ai.alice",
  "ai.chatgpt",
  "ai.qwen",
  "source.ozon",
  "source.wildberries",
];

function sorted(values: readonly string[]) {
  return [...values].sort();
}

describe("Seller Agents free-beta capability permission policy", () => {
  it("covers exactly the five reviewed D1 permission keys", () => {
    expect(
      sorted(
        SELLER_AGENTS_FREE_BETA_CAPABILITY_POLICY.permissions.map(
          (row) => row.entitlementKey,
        ),
      ),
    ).toEqual(EXPECTED);
    expect(sorted(SELLER_AGENTS_CAPABILITY_PERMISSION_KEYS)).toEqual(EXPECTED);
    expect(
      sorted(Object.keys(getSellerAgentsFreeBetaCapabilityPermissions())),
    ).toEqual(EXPECTED);
  });

  it("grants every reviewed launch capability for an admitted free beta without execution authority", () => {
    expect(SELLER_AGENTS_FREE_BETA_CAPABILITY_POLICY).toMatchObject({
      schemaVersion: SELLER_AGENTS_BETA_CAPABILITY_POLICY_VERSION,
      accessBasis: "BETA",
      authority: "SERVER_PRODUCT_POLICY_ONLY",
      executionAuthority: false,
    });
    for (const row of SELLER_AGENTS_FREE_BETA_CAPABILITY_POLICY.permissions) {
      expect(row.allowed).toBe(true);
      expect(row.executionAuthority).toBe(false);
    }
    expect(
      Object.values(getSellerAgentsFreeBetaCapabilityPermissions()),
    ).toEqual([true, true, true, true, true]);
  });

  it("is anchored only to BOOLEAN/CAPABILITY D1 definitions", () => {
    const definitions = new Map(
      SELLER_AGENTS_CAPABILITY_PERMISSION_DEFINITIONS.map((definition) => [
        definition.entitlementKey,
        definition,
      ]),
    );
    for (const row of SELLER_AGENTS_FREE_BETA_CAPABILITY_POLICY.permissions) {
      expect(definitions.get(row.entitlementKey)).toMatchObject({
        valueType: "BOOLEAN",
        securityClassification: "CAPABILITY",
        executionAuthority: false,
      });
    }
  });

  it("does not contain local capability ids, legacy feature keys or provider-operation entitlements", () => {
    const keys = new Set<string>(
      SELLER_AGENTS_FREE_BETA_CAPABILITY_POLICY.permissions.map(
        (row) => row.entitlementKey,
      ),
    );
    for (const value of [
      "marketplace.ozon.adapter",
      "marketplace.wildberries.adapter",
      "ai.chatgpt.web.adapter",
      "ai.alice.web.adapter",
      "ai.qwen.web.adapter",
      "ai.claude",
      "ai.grok",
      "ai.gemini",
      "ai.deepseek",
      "ai.kimi",
      "feature.guided_commands",
      "ozon.analytics",
      "ozon.performance",
      "device.max_active",
    ])
      expect(keys.has(value), value).toBe(false);
  });

  it("keeps the policy, rows and materialized permission map immutable", () => {
    const policy = SELLER_AGENTS_FREE_BETA_CAPABILITY_POLICY;
    const map = getSellerAgentsFreeBetaCapabilityPermissions();
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.permissions)).toBe(true);
    expect(policy.permissions.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(map)).toBe(true);
  });
});
