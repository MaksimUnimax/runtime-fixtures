import { describe, expect, it } from "vitest";
import {
  BETA_CHROME_POLICY_CANONICAL_INPUTS_V1,
  BetaChromePolicyCanonicalInputsV1Schema,
  PublishCompatibilityPolicyRevisionCommandSchema,
} from "./index.js";

describe("beta Chrome 0.2.13 policy canonical input", () => {
  it("binds the accepted exact Chrome 0.2.13 policy semantics", () => {
    const canonical = BetaChromePolicyCanonicalInputsV1Schema.parse(
      BETA_CHROME_POLICY_CANONICAL_INPUTS_V1,
    );

    expect(canonical.scope).toEqual({
      productVersion: "0.2.13",
      rollout: "EARLY_STORE_CHROME",
      exactChromeArtifactSha256:
        "7d12ddcbd82e18e26885c94f6a02e512dbade2c57b7e89ac9444dcbe0cac8cf4",
      fullMultibrowserPolicyAuthority: false,
    });
    expect(canonical.policy).toEqual({
      policyKey: "store1.chrome.v2",
      contractVersion: "control_plane_v2",
      browserFamily: "chrome",
      minimumExtensionVersion: "0.2.13",
      recommendedExtensionVersion: "0.2.13",
      minimumBrowserVersion: "147",
      maintenanceMode: false,
      maintenanceCode: null,
      blockedVersions: [],
    });

    const publishableShape =
      PublishCompatibilityPolicyRevisionCommandSchema.parse({
        ...canonical.policy,
        blockedVersions: [...canonical.policy.blockedVersions],
        publishedAt: new Date("2026-10-06T00:00:00.000Z"),
      });
    expect(publishableShape.browserFamily).toBe("chrome");
    expect(publishableShape.minimumBrowserVersion).toBe("147");
  });

  it("keeps Chrome minimum authority exact and browser-local", () => {
    expect(
      BETA_CHROME_POLICY_CANONICAL_INPUTS_V1.browserMinimumAuthority,
    ).toEqual({
      chrome: {
        value: "147",
        authority: "APPROVED",
        scope: "CHROME_ONLY_EXACT_0_2_13_7D12",
        sourceTask: "C07-CHROME0213-POLICY-MINIMUM-DECISION-R1-20261006",
      },
      opera: "NOT_SELECTED_BY_THIS_CONTRACT",
      yandexChromium: "NOT_SELECTED_BY_THIS_CONTRACT",
      firefox: "NOT_SELECTED_BY_THIS_CONTRACT",
    });
  });

  it("rejects family, extension, browser-minimum, maintenance and authority drift", () => {
    const canonical = BETA_CHROME_POLICY_CANONICAL_INPUTS_V1;
    const invalid = [
      ...[null, "120", "123", "136", "146", "148", "147.0.7727.116"].map(
        (minimumBrowserVersion) => ({
          ...canonical,
          policy: { ...canonical.policy, minimumBrowserVersion },
        }),
      ),
      {
        ...canonical,
        policy: { ...canonical.policy, browserFamily: "opera" },
      },
      {
        ...canonical,
        policy: { ...canonical.policy, minimumExtensionVersion: "0.2.12" },
      },
      {
        ...canonical,
        policy: { ...canonical.policy, recommendedExtensionVersion: "0.2.14" },
      },
      {
        ...canonical,
        policy: { ...canonical.policy, maintenanceMode: true },
      },
      {
        ...canonical,
        policy: { ...canonical.policy, blockedVersions: ["0.2.12"] },
      },
      {
        ...canonical,
        authority: { ...canonical.authority, livePublicationAuthorized: true },
      },
      { ...canonical, writerAuthority: true },
    ];

    for (const value of invalid) {
      expect(
        BetaChromePolicyCanonicalInputsV1Schema.safeParse(value).success,
      ).toBe(false);
    }
  });

  it("contains no live writer authority and is deeply frozen", () => {
    const canonical = BETA_CHROME_POLICY_CANONICAL_INPUTS_V1;
    expect(canonical.authority).toEqual({
      evidenceLevel: "SOURCE_CANONICAL_INPUT",
      persistedPolicyIdentity: "DYNAMIC_REVISION_AUTHORITY",
      catalogMutationAuthorized: false,
      livePublicationAuthorized: false,
    });
    expect(canonical.exclusions).toContain(
      "NO_FUTURE_CHROME_EMPIRICAL_SUPPORT_CLAIM",
    );

    const visit = (value: unknown): void => {
      if (value === null || typeof value !== "object") return;
      expect(Object.isFrozen(value)).toBe(true);
      for (const child of Object.values(value as Record<string, unknown>))
        visit(child);
    };
    visit(canonical);
  });
});
