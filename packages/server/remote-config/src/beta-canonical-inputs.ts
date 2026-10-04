import { z } from "zod";

export const BetaSignedConfigAuthorityClassV1Schema = z.enum([
  "DYNAMIC_SECURITY_AUTHORITY",
  "DYNAMIC_REVISION_AUTHORITY",
  "CONDITIONAL_NOT_SELECTED",
  "PUBLICATION_OUTPUT",
  "DERIVED_AT_PUBLICATION",
]);
export type BetaSignedConfigAuthorityClassV1 = z.infer<
  typeof BetaSignedConfigAuthorityClassV1Schema
>;

const EmptyCanonicalRevisionIdsSchema = z.tuple([]);

export const BetaSignedConfigCanonicalInputsV1Schema = z
  .object({
    schemaVersion: z.literal("beta_signed_config_canonical_inputs_v1"),
    protocol: z
      .object({
        contractVersion: z.literal("control_plane_v2"),
        snapshotVersion: z.literal("bootstrap_snapshot_v2"),
        envelopeVersion: z.literal("bootstrap_envelope_v2"),
      })
      .strict(),
    externalAuthority: z
      .object({
        signingKeyId: z.literal("DYNAMIC_SECURITY_AUTHORITY"),
        compatibilityPolicyRevisionIds: z.literal("DYNAMIC_REVISION_AUTHORITY"),
      })
      .strict(),
    conditionalLinks: z
      .object({
        featureRuleRevisionIds: z
          .object({
            authority: z.literal("CONDITIONAL_NOT_SELECTED"),
            canonicalValue: EmptyCanonicalRevisionIdsSchema,
            tableWideSafeEmptyProven: z.literal(false),
          })
          .strict(),
        featureRolloutRevisionIds: z
          .object({
            authority: z.literal("CONDITIONAL_NOT_SELECTED"),
            canonicalValue: EmptyCanonicalRevisionIdsSchema,
            tableWideSafeEmptyProven: z.literal(false),
          })
          .strict(),
      })
      .strict(),
    publicationOutputs: z
      .object({
        configVersion: z.literal("PUBLICATION_OUTPUT"),
        publishedAt: z.literal("PUBLICATION_OUTPUT"),
        sourceFingerprintSha256: z.literal("DERIVED_AT_PUBLICATION"),
        contentHashSha256: z.literal("DERIVED_AT_PUBLICATION"),
      })
      .strict(),
    exclusions: z.tuple([
      z.literal("NO_SIGNING_KEY_ID_OR_KEY_MATERIAL"),
      z.literal("NO_PERSISTED_POLICY_UUIDS_OR_REVISIONS"),
      z.literal("NO_PUBLICATION_TIMESTAMPS"),
      z.literal("NO_PRECOMPUTED_CONTENT_OR_SOURCE_HASHES"),
      z.literal("NO_DB_IDENTIFIERS"),
      z.literal("NO_WRITER_OR_LIVE_AUTHORITY"),
    ]),
  })
  .strict();

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>))
      deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const BETA_SIGNED_CONFIG_CANONICAL_INPUTS_V1 = deepFreeze(
  BetaSignedConfigCanonicalInputsV1Schema.parse({
    schemaVersion: "beta_signed_config_canonical_inputs_v1",
    protocol: {
      contractVersion: "control_plane_v2",
      snapshotVersion: "bootstrap_snapshot_v2",
      envelopeVersion: "bootstrap_envelope_v2",
    },
    externalAuthority: {
      signingKeyId: "DYNAMIC_SECURITY_AUTHORITY",
      compatibilityPolicyRevisionIds: "DYNAMIC_REVISION_AUTHORITY",
    },
    conditionalLinks: {
      featureRuleRevisionIds: {
        authority: "CONDITIONAL_NOT_SELECTED",
        canonicalValue: [],
        tableWideSafeEmptyProven: false,
      },
      featureRolloutRevisionIds: {
        authority: "CONDITIONAL_NOT_SELECTED",
        canonicalValue: [],
        tableWideSafeEmptyProven: false,
      },
    },
    publicationOutputs: {
      configVersion: "PUBLICATION_OUTPUT",
      publishedAt: "PUBLICATION_OUTPUT",
      sourceFingerprintSha256: "DERIVED_AT_PUBLICATION",
      contentHashSha256: "DERIVED_AT_PUBLICATION",
    },
    exclusions: [
      "NO_SIGNING_KEY_ID_OR_KEY_MATERIAL",
      "NO_PERSISTED_POLICY_UUIDS_OR_REVISIONS",
      "NO_PUBLICATION_TIMESTAMPS",
      "NO_PRECOMPUTED_CONTENT_OR_SOURCE_HASHES",
      "NO_DB_IDENTIFIERS",
      "NO_WRITER_OR_LIVE_AUTHORITY",
    ],
  }),
);

export type BetaSignedConfigCanonicalInputsV1 = z.infer<
  typeof BetaSignedConfigCanonicalInputsV1Schema
>;
