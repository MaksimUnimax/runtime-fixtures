import { describe, expect, it } from "vitest";
import { STORE1_PROFILE_SHA256 } from "./store1-opera-admin-activation.js";
import {
  analyzeChrome0213Transition,
  readChrome0213TransitionTarget,
} from "./store-chrome0213-transition-preflight.js";
import type { StoreReleaseTransitionCatalog } from "./store-release-transition-preflight.js";

function exactCatalog(): StoreReleaseTransitionCatalog {
  const target = readChrome0213TransitionTarget();
  return {
    release: {
      version: target.productVersion,
      releaseChannel: "stable",
      artifactSha256: null,
      supportedContracts: [target.contractVersion],
      supportedBrowsers: ["chrome", "opera", "yandex_chromium", "firefox"],
      browserArtifacts: [
        { browserFamily: "chrome", artifactSha256: target.artifactSha256 },
        {
          browserFamily: "opera",
          artifactSha256:
            "8d0664dda71e5b1f12e4bd69e42b53325ee8d213eb6d4869d7291799fce5b463",
        },
        {
          browserFamily: "yandex_chromium",
          artifactSha256:
            "8d0664dda71e5b1f12e4bd69e42b53325ee8d213eb6d4869d7291799fce5b463",
        },
        {
          browserFamily: "firefox",
          artifactSha256:
            "b987ce3a24258d3922f61b2d650c17ef029d895a25aab0ec6d27cccacec3c037",
        },
      ],
    },
    policies: [
      {
        id: "chrome-policy-r1",
        policyKey: target.policyKey,
        revision: 1,
        contractVersion: target.contractVersion,
        browserFamily: target.browserFamily,
        minimumExtensionVersion: target.productVersion,
        recommendedExtensionVersion: target.productVersion,
        minimumBrowserVersion: target.minimumBrowserVersion,
        maintenanceMode: false,
        maintenanceCode: null,
        blockedVersions: [],
        linkedConfigVersions: [12],
      },
    ],
    config: {
      configVersion: 12,
      contractVersion: target.contractVersion,
      snapshotVersion: "bootstrap_snapshot_v2",
      envelopeVersion: "bootstrap_envelope_v2",
      signingKeyId: "owner-test-active",
      signingKeyState: "ACTIVE",
      compatibilityPolicyRevisionIds: ["chrome-policy-r1"],
    },
    adapters: [
      { id: "adapter", machineKey: target.adapterKey, status: "ACTIVE" },
    ],
    surfaces: [
      {
        id: "surface",
        machineKey: target.surfaceKey,
        status: "ACTIVE",
        adapterId: "adapter",
      },
    ],
    profiles: [
      {
        id: "profile",
        machineKey: target.profileKey,
        status: "ACTIVE",
        adapterId: "adapter",
        surfaceId: "surface",
        variantId: null,
      },
    ],
    profileRevisions: [
      {
        id: "profile-revision",
        revision: 1,
        state: "PUBLISHED",
        contentSha256: target.profileContentSha256,
      },
    ],
    assignments: [
      {
        id: "assignment",
        adapterId: "adapter",
        surfaceId: "surface",
        variantId: null,
        browserFamily: "chrome",
        subjectKind: "ACCOUNT",
        latest: {
          revision: 1,
          mode: "DIRECT",
          baselineProfileRevisionId: "profile-revision",
          candidateProfileRevisionId: null,
          percentageBps: 0,
        },
      },
    ],
    errors: [],
  };
}

function codes(
  report: ReturnType<typeof analyzeChrome0213Transition>,
): string[] {
  return report.mismatches.map((item) => item.code);
}

describe("Chrome 0.2.13 live transition preflight", () => {
  it("binds exact repaired Chrome release, policy and distinct profile authority", () => {
    const target = readChrome0213TransitionTarget();
    expect(target).toMatchObject({
      source: {
        head: "087eab3394aac5164e8b3d16459eabf0697895d9",
        tree: "7c72525e6e91c2ddda65e5d8ca0226846c04ae66",
      },
      productVersion: "0.2.13",
      contractVersion: "control_plane_v2",
      migrationLevel: 58,
      artifactSha256:
        "7d12ddcbd82e18e26885c94f6a02e512dbade2c57b7e89ac9444dcbe0cac8cf4",
      packageFilename: "Octoport-Chrome-0.2.13-test-7d12ddcb.zip",
      packageBytes: 2300829,
      browserFamily: "chrome",
      minimumBrowserVersion: "147",
      policyKey: "store1.chrome.v2",
      adapterKey: "chatgpt",
      surfaceKey: "web",
      profileKey: "chatgpt-web-chrome-v1",
    });
    expect(target.profileContentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(target.profileContentSha256).not.toBe(STORE1_PROFILE_SHA256);
  });

  it("returns READY for exact browser-specific release, policy, config, profile and assignment", () => {
    const report = analyzeChrome0213Transition(exactCatalog());
    expect(report.status).toBe("READY");
    expect(report.mismatches).toEqual([]);
    expect(report).toMatchObject({
      readOnly: true,
      catalogMutationExecuted: false,
    });
  });

  it("rejects historical Chrome artifact cross-binding", () => {
    const catalog = exactCatalog();
    catalog.release!.browserArtifacts![0]!.artifactSha256 =
      "8d0664dda71e5b1f12e4bd69e42b53325ee8d213eb6d4869d7291799fce5b463";
    expect(codes(analyzeChrome0213Transition(catalog))).toContain(
      "RELEASE_CONFLICT",
    );
  });

  it("rejects Opera browser minimum and missing signed-config policy linkage", () => {
    const wrongMinimum = exactCatalog();
    wrongMinimum.policies![0]!.minimumBrowserVersion = "136";
    expect(codes(analyzeChrome0213Transition(wrongMinimum))).toContain(
      "POLICY_TARGET_MISMATCH",
    );

    const missingLink = exactCatalog();
    missingLink.config!.compatibilityPolicyRevisionIds = [];
    expect(codes(analyzeChrome0213Transition(missingLink))).toContain(
      "CONFIG_POLICY_LINK_MISSING",
    );
  });

  it("rejects the Opera profile fingerprint and a non-Chrome assignment", () => {
    const wrongProfile = exactCatalog();
    wrongProfile.profileRevisions![0]!.contentSha256 = STORE1_PROFILE_SHA256;
    expect(codes(analyzeChrome0213Transition(wrongProfile))).toContain(
      "PROFILE_TARGET_REVISION_MISSING",
    );

    const wrongAssignment = exactCatalog();
    wrongAssignment.assignments![0]!.browserFamily = "opera";
    expect(codes(analyzeChrome0213Transition(wrongAssignment))).toContain(
      "ASSIGNMENT_MISSING",
    );
  });

  it("preserves UNKNOWN for unavailable readback without inventing readiness", () => {
    const catalog = exactCatalog();
    catalog.errors.push({ scope: "policies", code: "POLICIES_HTTP_503" });
    const report = analyzeChrome0213Transition(catalog);
    expect(report.status).toBe("UNKNOWN");
    expect(codes(report)).toContain("POLICIES_HTTP_503");
  });
});
