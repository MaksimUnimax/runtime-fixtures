import { describe, expect, it } from "vitest";
import {
  BETA_SIGNED_CONFIG_CANONICAL_INPUTS_V1,
  BetaSignedConfigCanonicalInputsV1Schema,
  PublishConfigReleaseCommandSchema,
} from "./index.js";

describe("beta signed-config canonical input contract", () => {
  it("binds only the stable control-plane v2 protocol values", () => {
    const parsed = BetaSignedConfigCanonicalInputsV1Schema.parse(
      BETA_SIGNED_CONFIG_CANONICAL_INPUTS_V1,
    );
    expect(parsed.schemaVersion).toBe("beta_signed_config_canonical_inputs_v1");
    expect(parsed.protocol).toEqual({
      contractVersion: "control_plane_v2",
      snapshotVersion: "bootstrap_snapshot_v2",
      envelopeVersion: "bootstrap_envelope_v2",
    });
  });

  it("keeps security and persisted revision identities outside canonical source", () => {
    const contract = BETA_SIGNED_CONFIG_CANONICAL_INPUTS_V1;
    expect(contract.externalAuthority).toEqual({
      signingKeyId: "DYNAMIC_SECURITY_AUTHORITY",
      compatibilityPolicyRevisionIds: "DYNAMIC_REVISION_AUTHORITY",
    });
    expect(contract.exclusions).toEqual([
      "NO_SIGNING_KEY_ID_OR_KEY_MATERIAL",
      "NO_PERSISTED_POLICY_UUIDS_OR_REVISIONS",
      "NO_PUBLICATION_TIMESTAMPS",
      "NO_PRECOMPUTED_CONTENT_OR_SOURCE_HASHES",
      "NO_DB_IDENTIFIERS",
      "NO_WRITER_OR_LIVE_AUTHORITY",
    ]);

    const serialized = JSON.stringify(contract);
    expect(serialized).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
    );
    expect(serialized).not.toMatch(/[0-9a-f]{64}/i);
    expect(serialized).not.toContain("config-key");
  });

  it("selects no concrete feature or rollout links without claiming table-wide emptiness", () => {
    const links = BETA_SIGNED_CONFIG_CANONICAL_INPUTS_V1.conditionalLinks;
    expect(links.featureRuleRevisionIds).toEqual({
      authority: "CONDITIONAL_NOT_SELECTED",
      canonicalValue: [],
      tableWideSafeEmptyProven: false,
    });
    expect(links.featureRolloutRevisionIds).toEqual({
      authority: "CONDITIONAL_NOT_SELECTED",
      canonicalValue: [],
      tableWideSafeEmptyProven: false,
    });
  });

  it("classifies generated versions, timestamps and hashes as publication outputs", () => {
    expect(BETA_SIGNED_CONFIG_CANONICAL_INPUTS_V1.publicationOutputs).toEqual({
      configVersion: "PUBLICATION_OUTPUT",
      publishedAt: "PUBLICATION_OUTPUT",
      sourceFingerprintSha256: "DERIVED_AT_PUBLICATION",
      contentHashSha256: "DERIVED_AT_PUBLICATION",
    });
  });

  it("remains compatible with the existing v2 publish-command shape once external authority is supplied", () => {
    const canonical = BETA_SIGNED_CONFIG_CANONICAL_INPUTS_V1;
    const parsed = PublishConfigReleaseCommandSchema.parse({
      ...canonical.protocol,
      signingKeyId: "config-current",
      compatibilityPolicyRevisionIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
      featureRuleRevisionIds:
        canonical.conditionalLinks.featureRuleRevisionIds.canonicalValue,
      featureRolloutRevisionIds:
        canonical.conditionalLinks.featureRolloutRevisionIds.canonicalValue,
      publishedAt: new Date("2026-10-04T00:00:00.000Z"),
    });
    expect(parsed.contractVersion).toBe("control_plane_v2");
    expect(parsed.featureRuleRevisionIds).toEqual([]);
    expect(parsed.featureRolloutRevisionIds).toEqual([]);
  });

  it("is strict and deeply frozen", () => {
    expect(
      BetaSignedConfigCanonicalInputsV1Schema.safeParse({
        ...BETA_SIGNED_CONFIG_CANONICAL_INPUTS_V1,
        writerAuthority: true,
      }).success,
    ).toBe(false);

    const visit = (value: unknown): void => {
      if (value === null || typeof value !== "object") return;
      expect(Object.isFrozen(value)).toBe(true);
      for (const child of Object.values(value as Record<string, unknown>))
        visit(child);
    };
    visit(BETA_SIGNED_CONFIG_CANONICAL_INPUTS_V1);
  });
});
