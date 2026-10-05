import { z } from "zod";

export const BetaOperaPolicyCanonicalInputsV1Schema = z
  .object({
    schemaVersion: z.literal("beta_opera_policy_canonical_inputs_v1"),
    scope: z
      .object({
        productVersion: z.literal("0.2.12"),
        rollout: z.literal("EARLY_STORE_OPERA"),
        fullMultibrowserPolicyAuthority: z.literal(false),
      })
      .strict(),
    policy: z
      .object({
        policyKey: z.literal("store1.opera.v2"),
        contractVersion: z.literal("control_plane_v2"),
        browserFamily: z.literal("opera"),
        minimumExtensionVersion: z.literal("0.2.12"),
        recommendedExtensionVersion: z.literal("0.2.12"),
        minimumBrowserVersion: z.literal("136"),
        maintenanceMode: z.literal(false),
        maintenanceCode: z.null(),
        blockedVersions: z.tuple([]),
      })
      .strict(),
    browserMinimumAuthority: z
      .object({
        opera: z
          .object({
            value: z.literal("136"),
            authority: z.literal("APPROVED"),
            scope: z.literal("OPERA_ONLY"),
            sourceTask: z.literal(
              "A03-BROWSER-VERSION-SEMANTICS-CURRENT-MAIN-SUCCESSOR-20261003",
            ),
          })
          .strict(),
        chrome: z.literal("NOT_SELECTED_BY_THIS_CONTRACT"),
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
      z.literal("NO_CHROME_YANDEX_FIREFOX_BROWSER_MINIMUM_SELECTION"),
      z.literal("NO_FULL_MULTIBROWSER_POLICY_CLAIM"),
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

export const BETA_OPERA_POLICY_CANONICAL_INPUTS_V1 = deepFreeze(
  BetaOperaPolicyCanonicalInputsV1Schema.parse({
    schemaVersion: "beta_opera_policy_canonical_inputs_v1",
    scope: {
      productVersion: "0.2.12",
      rollout: "EARLY_STORE_OPERA",
      fullMultibrowserPolicyAuthority: false,
    },
    policy: {
      policyKey: "store1.opera.v2",
      contractVersion: "control_plane_v2",
      browserFamily: "opera",
      minimumExtensionVersion: "0.2.12",
      recommendedExtensionVersion: "0.2.12",
      minimumBrowserVersion: "136",
      maintenanceMode: false,
      maintenanceCode: null,
      blockedVersions: [],
    },
    browserMinimumAuthority: {
      opera: {
        value: "136",
        authority: "APPROVED",
        scope: "OPERA_ONLY",
        sourceTask:
          "A03-BROWSER-VERSION-SEMANTICS-CURRENT-MAIN-SUCCESSOR-20261003",
      },
      chrome: "NOT_SELECTED_BY_THIS_CONTRACT",
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
      "NO_CHROME_YANDEX_FIREFOX_BROWSER_MINIMUM_SELECTION",
      "NO_FULL_MULTIBROWSER_POLICY_CLAIM",
    ],
  }),
);

export type BetaOperaPolicyCanonicalInputsV1 = z.infer<
  typeof BetaOperaPolicyCanonicalInputsV1Schema
>;
