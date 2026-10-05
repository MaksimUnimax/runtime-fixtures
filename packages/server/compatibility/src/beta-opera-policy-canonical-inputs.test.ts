import { describe, expect, it } from "vitest";
import {
  BETA_OPERA_POLICY_CANONICAL_INPUTS_V1,
  BetaOperaPolicyCanonicalInputsV1Schema,
  PublishCompatibilityPolicyRevisionCommandSchema,
} from "./index.js";

describe("beta Opera 0.2.12 policy canonical input", () => {
  it("binds exactly the accepted early Opera 0.2.12 policy semantics", () => {
    const canonical = BetaOperaPolicyCanonicalInputsV1Schema.parse(
      BETA_OPERA_POLICY_CANONICAL_INPUTS_V1,
    );

    expect(canonical.scope).toEqual({
      productVersion: "0.2.12",
      rollout: "EARLY_STORE_OPERA",
      fullMultibrowserPolicyAuthority: false,
    });
    expect(canonical.policy).toEqual({
      policyKey: "store1.opera.v2",
      contractVersion: "control_plane_v2",
      browserFamily: "opera",
      minimumExtensionVersion: "0.2.12",
      recommendedExtensionVersion: "0.2.12",
      minimumBrowserVersion: "136",
      maintenanceMode: false,
      maintenanceCode: null,
      blockedVersions: [],
    });

    const publishableShape =
      PublishCompatibilityPolicyRevisionCommandSchema.parse({
        ...canonical.policy,
        blockedVersions: [...canonical.policy.blockedVersions],
        publishedAt: new Date("2026-10-05T00:00:00.000Z"),
      });
    expect(publishableShape.browserFamily).toBe("opera");
    expect(publishableShape.minimumExtensionVersion).toBe("0.2.12");
    expect(publishableShape.recommendedExtensionVersion).toBe("0.2.12");
    expect(publishableShape.minimumBrowserVersion).toBe("136");
  });

  it("does not manufacture browser minimum authority for other beta browsers", () => {
    expect(
      BETA_OPERA_POLICY_CANONICAL_INPUTS_V1.browserMinimumAuthority,
    ).toEqual({
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
    });
    expect(
      BETA_OPERA_POLICY_CANONICAL_INPUTS_V1.scope
        .fullMultibrowserPolicyAuthority,
    ).toBe(false);
  });

  it("rejects version, family, maintenance, blocked-version, and extra-field drift", () => {
    const canonical = BETA_OPERA_POLICY_CANONICAL_INPUTS_V1;
    const invalid = [
      {
        ...canonical,
        policy: { ...canonical.policy, minimumExtensionVersion: "0.2.11" },
      },
      {
        ...canonical,
        policy: { ...canonical.policy, recommendedExtensionVersion: "0.2.13" },
      },
      {
        ...canonical,
        policy: { ...canonical.policy, browserFamily: "chrome" },
      },
      {
        ...canonical,
        browserMinimumAuthority: {
          ...canonical.browserMinimumAuthority,
          opera: {
            ...canonical.browserMinimumAuthority.opera,
            authority: "NOT_SELECTED_BY_THIS_CONTRACT",
          },
        },
      },
      {
        ...canonical,
        policy: { ...canonical.policy, maintenanceMode: true },
      },
      {
        ...canonical,
        policy: { ...canonical.policy, blockedVersions: ["0.2.11"] },
      },
      {
        ...canonical,
        writerAuthority: true,
      },
    ];

    for (const value of invalid) {
      expect(
        BetaOperaPolicyCanonicalInputsV1Schema.safeParse(value).success,
      ).toBe(false);
    }
  });

  it("contains no live writer authority and is deeply frozen", () => {
    const canonical = BETA_OPERA_POLICY_CANONICAL_INPUTS_V1;

    expect(canonical.authority).toEqual({
      evidenceLevel: "SOURCE_CANONICAL_INPUT",
      persistedPolicyIdentity: "DYNAMIC_REVISION_AUTHORITY",
      catalogMutationAuthorized: false,
      livePublicationAuthorized: false,
    });
    expect(canonical.exclusions).toContain(
      "NO_CHROME_YANDEX_FIREFOX_BROWSER_MINIMUM_SELECTION",
    );

    const visit = (value: unknown): void => {
      if (value === null || typeof value !== "object") return;
      expect(Object.isFrozen(value)).toBe(true);
      for (const child of Object.values(value as Record<string, unknown>)) {
        visit(child);
      }
    };
    visit(canonical);
  });
});
