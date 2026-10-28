import { EntitlementKeySchema } from "@product/plans";
import { describe, expect, it } from "vitest";
import {
  SELLER_AGENTS_CAPABILITY_PERMISSION_DEFINITIONS,
  SELLER_AGENTS_CAPABILITY_PERMISSION_KEYS,
  isSellerAgentsCapabilityPermissionKey,
} from "./seller-agents-capability-permissions.js";

import {
  resolveSellerAgentsEffectiveAccess,
  sellerAgentsCommercialCapabilityPermissions,
} from "./seller-agents-commercial-policy.js";

const EXPECTED = [
  "ai.alice",
  "ai.chatgpt",
  "ai.claude",
  "ai.deepseek",
  "ai.gemini",
  "ai.grok",
  "ai.kimi",
  "ai.qwen",
  "source.ozon",
  "source.wildberries",
];

describe("Seller Agents capability permission vocabulary", () => {
  it("defines exactly the ten reviewed account permission keys", () => {
    expect([...SELLER_AGENTS_CAPABILITY_PERMISSION_KEYS].sort()).toEqual(
      EXPECTED,
    );
    expect(
      SELLER_AGENTS_CAPABILITY_PERMISSION_DEFINITIONS.map(
        (definition) => definition.entitlementKey,
      ).sort(),
    ).toEqual(EXPECTED);
  });

  it("uses valid BOOLEAN/CAPABILITY entitlement definitions without execution authority", () => {
    for (const definition of SELLER_AGENTS_CAPABILITY_PERMISSION_DEFINITIONS) {
      expect(EntitlementKeySchema.parse(definition.entitlementKey)).toBe(
        definition.entitlementKey,
      );
      expect(definition.valueType).toBe("BOOLEAN");
      expect(definition.securityClassification).toBe("CAPABILITY");
      expect(definition.executionAuthority).toBe(false);
    }
  });

  it("does not reuse packaged-local capability ids or operation-level entitlements", () => {
    for (const value of [
      "marketplace.ozon.adapter",
      "marketplace.wildberries.adapter",
      "ai.chatgpt.web.adapter",
      "ai.alice.web.adapter",
      "ai.qwen.web.adapter",
      "ai.claude.web.adapter",
      "ai.grok.web.adapter",
      "ai.gemini.web.adapter",
      "ai.deepseek.web.adapter",
      "ai.kimi.web.adapter",
      "ozon.analytics",
      "ozon.performance",
      "feature.guided_commands",
      "device.max_active",
    ]) {
      expect(isSellerAgentsCapabilityPermissionKey(value), value).toBe(false);
    }
  });

  it("recognizes only exact reviewed permission keys", () => {
    for (const value of EXPECTED)
      expect(isSellerAgentsCapabilityPermissionKey(value), value).toBe(true);
    for (const value of [
      "source.amazon",
      "source.wb",
      "ai.chatgpt.web",
      "AI.ALICE",
      "",
      null,
      1,
    ])
      expect(isSellerAgentsCapabilityPermissionKey(value), String(value)).toBe(
        false,
      );
  });

  it("keeps the exported authority registries immutable", () => {
    expect(Object.isFrozen(SELLER_AGENTS_CAPABILITY_PERMISSION_KEYS)).toBe(
      true,
    );
    expect(
      Object.isFrozen(SELLER_AGENTS_CAPABILITY_PERMISSION_DEFINITIONS),
    ).toBe(true);
    expect(
      SELLER_AGENTS_CAPABILITY_PERMISSION_DEFINITIONS.every(Object.isFrozen),
    ).toBe(true);
  });

  it.each(["ai.claude", "ai.deepseek", "ai.gemini", "ai.grok", "ai.kimi"])(
    "keeps %s behind its existing access basis and explicit commercial grant",
    (key) => {
      for (const permissions of [{}, { [key]: false }, { [key]: 1 }]) {
        expect(
          sellerAgentsCommercialCapabilityPermissions(permissions),
        ).toEqual({});
      }
      expect(
        sellerAgentsCommercialCapabilityPermissions({
          [key]: true,
          "device.max_active": 2,
          "provider.admin": true,
        }),
      ).toEqual({ [key]: true });

      const at = new Date("2026-01-01T00:00:00.000Z");
      const commercial = {
        accountId: "00000000-0000-4000-8000-000000000001",
        planCode: "synthetic-capability-consumer-test",
        lifecycle: "ACTIVE" as const,
        entitlementRevision: 1,
        effectiveFrom: new Date("2025-12-31T00:00:00.000Z"),
        effectiveUntil: null,
        source: "SYSTEM_RECONCILIATION" as const,
        externalReference: null,
        lastVerifiedProviderEventVersion: 1,
        permissions: { [key]: true, "device.max_active": 2 },
      };
      expect(
        resolveSellerAgentsEffectiveAccess({
          betaEligible: false,
          commercial,
          at,
        }),
      ).toEqual({
        accessBasis: "NONE",
        commercialEntitlementRevision: null,
        permissions: {},
      });
      for (const denied of [
        { ...commercial, lifecycle: "SUSPENDED" as const },
        { ...commercial, effectiveUntil: at },
      ]) {
        expect(
          resolveSellerAgentsEffectiveAccess({
            mode: "ENABLED",
            betaEligible: false,
            commercial: denied,
            at,
          }).accessBasis,
        ).toBe("NONE");
      }
      const active = resolveSellerAgentsEffectiveAccess({
        mode: "ENABLED",
        betaEligible: false,
        commercial,
        at,
      });
      expect(active.accessBasis).toBe("COMMERCIAL");
      expect(
        sellerAgentsCommercialCapabilityPermissions(active.permissions),
      ).toEqual({
        [key]: true,
      });
      const beta = resolveSellerAgentsEffectiveAccess({
        mode: "DISABLED",
        betaEligible: true,
        commercial: { ...commercial, permissions: { [key]: false } },
        at,
      });
      expect(beta).toEqual({
        accessBasis: "BETA",
        commercialEntitlementRevision: null,
        permissions: Object.fromEntries(EXPECTED.map((name) => [name, true])),
      });
    },
  );
});
