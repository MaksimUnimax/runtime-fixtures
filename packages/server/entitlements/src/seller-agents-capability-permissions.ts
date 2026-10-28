import { EntitlementKeySchema } from "@product/plans";

export const SELLER_AGENTS_CAPABILITY_PERMISSION_KEYS = Object.freeze([
  "source.ozon",
  "source.wildberries",
  "ai.chatgpt",
  "ai.alice",
  "ai.qwen",
  "ai.deepseek",
  "ai.grok",
  "ai.claude",
  "ai.gemini",
  "ai.kimi",
] as const);

export type SellerAgentsCapabilityPermissionKey =
  (typeof SELLER_AGENTS_CAPABILITY_PERMISSION_KEYS)[number];

export type SellerAgentsCapabilityPermissionDefinition = Readonly<{
  entitlementKey: SellerAgentsCapabilityPermissionKey;
  valueType: "BOOLEAN";
  securityClassification: "CAPABILITY";
  executionAuthority: false;
  description: string;
}>;

const definitions: SellerAgentsCapabilityPermissionDefinition[] = [
  {
    entitlementKey: "source.ozon",
    valueType: "BOOLEAN",
    securityClassification: "CAPABILITY",
    executionAuthority: false,
    description:
      "Account permission for the packaged Ozon marketplace source; not execution authority by itself.",
  },
  {
    entitlementKey: "source.wildberries",
    valueType: "BOOLEAN",
    securityClassification: "CAPABILITY",
    executionAuthority: false,
    description:
      "Account permission for the packaged Wildberries marketplace source; not execution authority by itself.",
  },
  {
    entitlementKey: "ai.chatgpt",
    valueType: "BOOLEAN",
    securityClassification: "CAPABILITY",
    executionAuthority: false,
    description:
      "Account permission for the packaged ChatGPT AI family; profile and health policy remain separate gates.",
  },
  {
    entitlementKey: "ai.alice",
    valueType: "BOOLEAN",
    securityClassification: "CAPABILITY",
    executionAuthority: false,
    description:
      "Account permission for the packaged Alice AI family; profile and health policy remain separate gates.",
  },
  {
    entitlementKey: "ai.qwen",
    valueType: "BOOLEAN",
    securityClassification: "CAPABILITY",
    executionAuthority: false,
    description:
      "Account permission for the packaged Qwen AI family; profile and health policy remain separate gates.",
  },
  {
    entitlementKey: "ai.deepseek",
    valueType: "BOOLEAN",
    securityClassification: "CAPABILITY",
    executionAuthority: false,
    description:
      "Account permission for the packaged deepseek AI family; profile and health policy remain separate gates.",
  },
  {
    entitlementKey: "ai.grok",
    valueType: "BOOLEAN",
    securityClassification: "CAPABILITY",
    executionAuthority: false,
    description:
      "Account permission for the packaged grok AI family; profile and health policy remain separate gates.",
  },
  {
    entitlementKey: "ai.claude",
    valueType: "BOOLEAN",
    securityClassification: "CAPABILITY",
    executionAuthority: false,
    description:
      "Account permission for the packaged claude AI family; profile and health policy remain separate gates.",
  },
  {
    entitlementKey: "ai.gemini",
    valueType: "BOOLEAN",
    securityClassification: "CAPABILITY",
    executionAuthority: false,
    description:
      "Account permission for the packaged gemini AI family; profile and health policy remain separate gates.",
  },
  {
    entitlementKey: "ai.kimi",
    valueType: "BOOLEAN",
    securityClassification: "CAPABILITY",
    executionAuthority: false,
    description:
      "Account permission for the packaged kimi AI family; profile and health policy remain separate gates.",
  },
];

for (const definition of definitions) {
  EntitlementKeySchema.parse(definition.entitlementKey);
  Object.freeze(definition);
}

export const SELLER_AGENTS_CAPABILITY_PERMISSION_DEFINITIONS = Object.freeze(
  definitions,
) as readonly SellerAgentsCapabilityPermissionDefinition[];

const permissionKeys = new Set<string>(
  SELLER_AGENTS_CAPABILITY_PERMISSION_KEYS,
);

export function isSellerAgentsCapabilityPermissionKey(
  value: unknown,
): value is SellerAgentsCapabilityPermissionKey {
  return typeof value === "string" && permissionKeys.has(value);
}
