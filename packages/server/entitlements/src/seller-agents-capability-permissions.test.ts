import { EntitlementKeySchema } from "@product/plans";
import { describe, expect, it } from "vitest";
import {
  SELLER_AGENTS_CAPABILITY_PERMISSION_DEFINITIONS,
  SELLER_AGENTS_CAPABILITY_PERMISSION_KEYS,
  isSellerAgentsCapabilityPermissionKey,
} from "./seller-agents-capability-permissions.js";

const EXPECTED = [
  "ai.alice",
  "ai.chatgpt",
  "ai.qwen",
  "source.ozon",
  "source.wildberries",
];

describe("Seller Agents capability permission vocabulary", () => {
  it("defines exactly the five reviewed account permission keys", () => {
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
      "ai.claude",
      "ai.grok",
      "ai.gemini",
      "ai.deepseek",
      "ai.kimi",
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
});
