import { describe, expect, it } from "vitest";
import {
  BETA_AI_PROFILE_CANONICAL_INPUTS_V1,
  BETA_CHATGPT_STANDARD_OPERA_INPUT_V1,
  BetaAiProfileCanonicalInputsSchema,
  validateProfileContent,
} from "./index.js";

describe("beta AI/profile canonical input contract", () => {
  it("binds the exact product-required beta surfaces without claiming a beta-wide catalog", () => {
    const parsed = BetaAiProfileCanonicalInputsSchema.parse(
      BETA_AI_PROFILE_CANONICAL_INPUTS_V1,
    );
    expect(parsed.schemaVersion).toBe("beta_ai_profile_canonical_inputs_v1");
    expect(parsed.betaWideCatalogProven).toBe(false);
    expect(parsed.requiredProductSurfaces).toEqual([
      "CHATGPT_STANDARD",
      "CHATGPT_WORK",
      "ALICE",
    ]);
    expect(parsed.canonicalInputs.CHATGPT_STANDARD.canonicalInputState).toBe(
      "COMMITTED_BOUNDED_PREDECESSOR",
    );
    expect(parsed.canonicalInputs.CHATGPT_WORK).toEqual({
      canonicalInputState: "MISSING_CANONICAL_INPUT",
      productSurface: "CHATGPT_WORK",
      reasonCode: "PRODUCT_REQUIRED_SOURCE_INPUT_NOT_ACCEPTED",
    });
    expect(parsed.canonicalInputs.ALICE).toEqual({
      canonicalInputState: "MISSING_CANONICAL_INPUT",
      productSurface: "ALICE",
      reasonCode: "PRODUCT_REQUIRED_SOURCE_INPUT_NOT_ACCEPTED",
    });
  });

  it("keeps the only committed slice explicitly historical and Opera-only", () => {
    const input = BETA_CHATGPT_STANDARD_OPERA_INPUT_V1;
    expect(input.evidence).toEqual({
      scope: "STORE1_OPERA_REVIEWER_SLICE",
      productVersion: "0.2.11",
      browserFamily: "opera",
      minimumBrowserVersion: "136",
      minimumExtensionVersion: "0.2.7",
      contractVersion: "control_plane_v2",
    });
    expect(input.adapter).toEqual({
      machineKey: "chatgpt",
      displayName: "ChatGPT",
      description: "STORE-1 Standard reviewer slice",
    });
    expect(input.surface).toEqual({ machineKey: "web", displayName: "Web" });
    expect(input.variantId).toBeNull();
    expect(input.profile.machineKey).toBe("chatgpt-web-opera-v1");
  });

  it("reuses the canonical profile validator and exact fingerprint", () => {
    const validated = validateProfileContent({
      content: BETA_CHATGPT_STANDARD_OPERA_INPUT_V1.profile.content,
      compatibility: BETA_CHATGPT_STANDARD_OPERA_INPUT_V1.profile.compatibility,
    });
    expect(validated.contentSha256).toBe(
      BETA_CHATGPT_STANDARD_OPERA_INPUT_V1.profile.contentSha256,
    );
    expect(validated.contentSha256).toBe(
      "cab55851bd2d571c19de5d44f3f8b3c40ff0ba3eb44e346307a2578894b1b2c1",
    );
  });

  it("rejects schema-valid drift from the exact committed profile pair", () => {
    const contentDrift = JSON.parse(
      JSON.stringify(BETA_AI_PROFILE_CANONICAL_INPUTS_V1),
    );
    contentDrift.canonicalInputs.CHATGPT_STANDARD.profile.content.observation.intervalMs = 101;
    expect(() =>
      BetaAiProfileCanonicalInputsSchema.parse(contentDrift),
    ).toThrow(/canonical profile content differs from accepted source/);

    const compatibilityDrift = JSON.parse(
      JSON.stringify(BETA_AI_PROFILE_CANONICAL_INPUTS_V1),
    );
    compatibilityDrift.canonicalInputs.CHATGPT_STANDARD.profile.compatibility.browserFamilies =
      ["chrome"];
    compatibilityDrift.canonicalInputs.CHATGPT_STANDARD.profile.compatibility.minimumBrowserVersions =
      [{ browserFamily: "chrome", minimumVersion: "136" }];
    expect(() =>
      BetaAiProfileCanonicalInputsSchema.parse(compatibilityDrift),
    ).toThrow(/canonical profile compatibility differs from accepted source/);
  });

  it("exports both canonical input graphs deeply frozen at runtime", () => {
    const expectDeepFrozen = (value: unknown): void => {
      if (value === null || typeof value !== "object") return;
      expect(Object.isFrozen(value)).toBe(true);
      for (const child of Object.values(value as Record<string, unknown>))
        expectDeepFrozen(child);
    };

    expectDeepFrozen(BETA_CHATGPT_STANDARD_OPERA_INPUT_V1);
    expectDeepFrozen(BETA_AI_PROFILE_CANONICAL_INPUTS_V1);
  });

  it("contains no runtime DB identity or assignment authority", () => {
    const contract = BETA_AI_PROFILE_CANONICAL_INPUTS_V1;
    expect(contract.dynamicAuthorityExclusions).toEqual([
      "DB_IDENTIFIERS_AND_TIMESTAMPS",
      "REGISTRY_STATUS_LIFECYCLE",
      "PROFILE_REVISION_ID_NUMBER_STATE_AND_PUBLICATION_PRINCIPALS",
      "ACCOUNT_ASSIGNMENT_AND_COHORT_AUTHORITY",
    ]);

    const forbiddenKeys = new Set([
      "id",
      "adapterId",
      "surfaceId",
      "profileId",
      "assignmentId",
      "accountId",
      "cohortSeed",
      "revision",
      "state",
      "status",
      "createdAt",
      "updatedAt",
      "publishedAt",
      "createdByAdminPrincipalId",
      "publishedByAdminPrincipalId",
    ]);
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        expect(forbiddenKeys.has(key), `forbidden canonical key: ${key}`).toBe(
          false,
        );
        visit(child);
      }
    };
    visit(contract.canonicalInputs);
  });

  it("does not turn variantId=null into an ai_variants row", () => {
    expect(BETA_CHATGPT_STANDARD_OPERA_INPUT_V1.variantId).toBeNull();
    expect(
      "variant" in
        (BETA_CHATGPT_STANDARD_OPERA_INPUT_V1 as unknown as Record<
          string,
          unknown
        >),
    ).toBe(false);
    expect(
      BETA_AI_PROFILE_CANONICAL_INPUTS_V1.canonicalInputs.CHATGPT_WORK
        .canonicalInputState,
    ).toBe("MISSING_CANONICAL_INPUT");
    expect(
      BETA_AI_PROFILE_CANONICAL_INPUTS_V1.canonicalInputs.ALICE
        .canonicalInputState,
    ).toBe("MISSING_CANONICAL_INPUT");
  });
});
