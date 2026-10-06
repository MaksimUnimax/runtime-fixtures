import { z } from "zod";

export const BetaChromePolicyCanonicalInputsV1Schema = z
  .object({
    schemaVersion: z.literal("beta_chrome_policy_canonical_inputs_v1"),
    scope: z
      .object({
        productVersion: z.literal("0.2.13"),
        rollout: z.literal("EARLY_STORE_CHROME"),
        exactChromeArtifactSha256: z.literal(
          "7d12ddcbd82e18e26885c94f6a02e512dbade2c57b7e89ac9444dcbe0cac8cf4",
        ),
        fullMultibrowserPolicyAuthority: z.literal(false),
      })
      .strict(),
    policy: z
      .object({
        policyKey: z.literal("store1.chrome.v2"),
        contractVersion: z.literal("control_plane_v2"),
        browserFamily: z.literal("chrome"),
        minimumExtensionVersion: z.literal("0.2.13"),
        recommendedExtensionVersion: z.literal("0.2.13"),
        minimumBrowserVersion: z.literal("147"),
        maintenanceMode: z.literal(false),
        maintenanceCode: z.null(),
        blockedVersions: z.tuple([]),
      })
      .strict(),
    browserMinimumAuthority: z
      .object({
        chrome: z
          .object({
            value: z.literal("147"),
            authority: z.literal("APPROVED"),
            scope: z.literal("CHROME_ONLY_EXACT_0_2_13_7D12"),
            sourceTask: z.literal(
              "C07-CHROME0213-POLICY-MINIMUM-DECISION-R1-20261006",
            ),
          })
          .strict(),
        opera: z.literal("NOT_SELECTED_BY_THIS_CONTRACT"),
        yandexChromium: z.literal("NOT_SELECTED_BY_THIS_CONTRACT"),
        firefox: z.literal("NOT_SELECTED_BY_THIS_CONTRACT"),
      })
      .strict(),
    authority: z
      .object({
        evidenceLevel: z.literal("SOURCE_CANONICAL_INPUT"),
        persistedPolicyIdentity: z.literal("DYNAMIC_REVISION_AUTHORITY"),
        catalogMutationAuthorized: z.literal(false),
        livePublicationAuthorized: z.literal(false),
      })
      .strict(),
    exclusions: z.tuple([
      z.literal("NO_POLICY_ID_OR_REVISION"),
      z.literal("NO_PUBLICATION_TIMESTAMP"),
      z.literal("NO_ADMIN_IDENTITY_OR_AUTHORIZATION"),
      z.literal("NO_SIGNING_KEY_MATERIAL"),
      z.literal("NO_LIVE_OR_CATALOG_MUTATION_AUTHORITY"),
      z.literal("NO_OPERA_YANDEX_FIREFOX_BROWSER_MINIMUM_SELECTION"),
      z.literal("NO_FULL_MULTIBROWSER_POLICY_CLAIM"),
      z.literal("NO_FUTURE_CHROME_EMPIRICAL_SUPPORT_CLAIM"),
    ]),
  })
  .strict();

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

export const BETA_CHROME_POLICY_CANONICAL_INPUTS_V1 = deepFreeze(
  BetaChromePolicyCanonicalInputsV1Schema.parse({
    schemaVersion: "beta_chrome_policy_canonical_inputs_v1",
    scope: {
      productVersion: "0.2.13",
      rollout: "EARLY_STORE_CHROME",
      exactChromeArtifactSha256:
        "7d12ddcbd82e18e26885c94f6a02e512dbade2c57b7e89ac9444dcbe0cac8cf4",
      fullMultibrowserPolicyAuthority: false,
    },
    policy: {
      policyKey: "store1.chrome.v2",
      contractVersion: "control_plane_v2",
      browserFamily: "chrome",
      minimumExtensionVersion: "0.2.13",
      recommendedExtensionVersion: "0.2.13",
      minimumBrowserVersion: "147",
      maintenanceMode: false,
      maintenanceCode: null,
      blockedVersions: [],
    },
    browserMinimumAuthority: {
      chrome: {
        value: "147",
        authority: "APPROVED",
        scope: "CHROME_ONLY_EXACT_0_2_13_7D12",
        sourceTask: "C07-CHROME0213-POLICY-MINIMUM-DECISION-R1-20261006",
      },
      opera: "NOT_SELECTED_BY_THIS_CONTRACT",
      yandexChromium: "NOT_SELECTED_BY_THIS_CONTRACT",
      firefox: "NOT_SELECTED_BY_THIS_CONTRACT",
    },
    authority: {
      evidenceLevel: "SOURCE_CANONICAL_INPUT",
      persistedPolicyIdentity: "DYNAMIC_REVISION_AUTHORITY",
      catalogMutationAuthorized: false,
      livePublicationAuthorized: false,
    },
    exclusions: [
      "NO_POLICY_ID_OR_REVISION",
      "NO_PUBLICATION_TIMESTAMP",
      "NO_ADMIN_IDENTITY_OR_AUTHORIZATION",
      "NO_SIGNING_KEY_MATERIAL",
      "NO_LIVE_OR_CATALOG_MUTATION_AUTHORITY",
      "NO_OPERA_YANDEX_FIREFOX_BROWSER_MINIMUM_SELECTION",
      "NO_FULL_MULTIBROWSER_POLICY_CLAIM",
      "NO_FUTURE_CHROME_EMPIRICAL_SUPPORT_CLAIM",
    ],
  }),
);

export type BetaChromePolicyCanonicalInputsV1 = z.infer<
  typeof BetaChromePolicyCanonicalInputsV1Schema
>;
