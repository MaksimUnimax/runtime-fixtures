import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { STORE1_PROFILE_SHA256 } from "./store1-opera-admin-activation.js";
import {
  analyzeStoreReleaseTransition,
  collectStoreReleaseTransitionCatalog,
  readStoreReleaseTransitionTarget,
  type StoreReleaseTransitionCatalog,
  type StoreReleaseTransitionTarget,
} from "./store-release-transition-preflight.js";

const temporary: string[] = [];
afterEach(() => {
  while (temporary.length)
    rmSync(temporary.pop()!, { recursive: true, force: true });
});

function target(
  version = "0.2.8",
  content = Buffer.from("package-" + version),
) {
  const directory = mkdtempSync(join(tmpdir(), "release-transition-"));
  temporary.push(directory);
  const filename = "OCTOPORT_v" + version + "_CHROMIUM_STORE.zip";
  const zip = join(directory, filename);
  const manifest = join(directory, "B1_RC_MANIFEST.json");
  writeFileSync(zip, content);
  const sha256 = createHash("sha256").update(content).digest("hex");
  writeFileSync(
    manifest,
    JSON.stringify({
      schemaVersion: "b1_release_candidate_v2",
      authoritySha256: "a".repeat(64),
      source: {
        head: "1".repeat(40),
        tree: "2".repeat(40),
      },
      productVersion: version,
      contractVersion: "control_plane_v2",
      migrationLevel: 54,
      packages: {
        chromium: {
          filename,
          sha256,
          bytes: content.length,
          inventoryCount: 44,
          version,
          browser: "chromium",
        },
      },
    }),
  );
  return {
    value: readStoreReleaseTransitionTarget(manifest, zip),
    manifest,
    zip,
  };
}

function exactCatalog(
  t: StoreReleaseTransitionTarget,
): StoreReleaseTransitionCatalog {
  return {
    release: {
      version: t.productVersion,
      releaseChannel: "stable",
      artifactSha256: t.artifactSha256,
      supportedContracts: [t.contractVersion],
      supportedBrowsers: [t.browserFamily],
      browserArtifacts: [
        {
          browserFamily: t.browserFamily,
          artifactSha256: null,
        },
      ],
    },
    policies: [
      {
        id: "policy-target",
        policyKey: t.policyKey,
        revision: 3,
        contractVersion: t.contractVersion,
        browserFamily: t.browserFamily,
        minimumExtensionVersion: t.productVersion,
        recommendedExtensionVersion: t.productVersion,
        minimumBrowserVersion: t.minimumBrowserVersion,
        maintenanceMode: false,
        maintenanceCode: null,
        blockedVersions: [],
        linkedConfigVersions: [9],
      },
    ],
    config: {
      configVersion: 9,
      contractVersion: t.contractVersion,
      snapshotVersion: "bootstrap_snapshot_v2",
      envelopeVersion: "bootstrap_envelope_v2",
      signingKeyId: "store-signing",
      signingKeyState: "ACTIVE",
      compatibilityPolicyRevisionIds: ["policy-target"],
    },
    adapters: [{ id: "adapter", machineKey: t.adapterKey, status: "ACTIVE" }],
    surfaces: [
      {
        id: "surface",
        adapterId: "adapter",
        machineKey: t.surfaceKey,
        status: "ACTIVE",
      },
    ],
    profiles: [
      {
        id: "profile",
        adapterId: "adapter",
        surfaceId: "surface",
        variantId: null,
        machineKey: t.profileKey,
        status: "ACTIVE",
      },
    ],
    profileRevisions: [
      {
        id: "revision",
        revision: 2,
        state: "PUBLISHED",
        contentSha256: t.profileContentSha256,
      },
    ],
    assignments: [
      {
        id: "assignment",
        adapterId: "adapter",
        surfaceId: "surface",
        variantId: null,
        browserFamily: t.browserFamily,
        subjectKind: "ACCOUNT",
        latest: {
          revision: 4,
          mode: "DIRECT",
          baselineProfileRevisionId: "revision",
          candidateProfileRevisionId: null,
          percentageBps: 0,
        },
      },
    ],
    errors: [],
  };
}

function codes(report: ReturnType<typeof analyzeStoreReleaseTransition>) {
  return report.mismatches.map((item) => item.code);
}

describe("STORE release transition preflight", () => {
  it("derives the 0.2.10 successor target without changing migration or profile authority", () => {
    const accepted = target("0.2.9");
    const successor = target("0.2.10");
    expect(accepted.value).toMatchObject({
      productVersion: "0.2.9",
      contractVersion: "control_plane_v2",
      migrationLevel: 54,
      source: { head: "1".repeat(40), tree: "2".repeat(40) },
    });
    expect(successor.value).toMatchObject({
      productVersion: "0.2.10",
      contractVersion: "control_plane_v2",
      migrationLevel: 54,
      source: { head: "1".repeat(40), tree: "2".repeat(40) },
    });
    expect(accepted.value.profileContentSha256).toBe(STORE1_PROFILE_SHA256);
    expect(successor.value.profileContentSha256).toBe(STORE1_PROFILE_SHA256);
    expect(successor.value.profileContentSha256).toBe(
      "cab55851bd2d571c19de5d44f3f8b3c40ff0ba3eb44e346307a2578894b1b2c1",
    );
  });

  it("rejects package bytes that do not match the candidate manifest", () => {
    const fixture = target();
    writeFileSync(fixture.zip, "different-bytes");
    expect(() =>
      readStoreReleaseTransitionTarget(fixture.manifest, fixture.zip),
    ).toThrow("RELEASE_TRANSITION_PACKAGE_MISMATCH");
  });

  it("reports all missing boundaries for an empty catalog", () => {
    const t = target().value;
    const report = analyzeStoreReleaseTransition(t, {
      release: null,
      policies: [],
      config: null,
      adapters: [],
      errors: [],
    });
    expect(report.status).toBe("MISMATCH");
    expect(codes(report)).toEqual(
      expect.arrayContaining([
        "RELEASE_MISSING",
        "POLICY_MISSING",
        "CONFIG_MISSING",
        "ADAPTER_MISSING",
        "SURFACE_DEPENDENCY_UNAVAILABLE",
        "PROFILE_DEPENDENCY_UNAVAILABLE",
        "PROFILE_REVISION_DEPENDENCY_UNAVAILABLE",
        "ASSIGNMENT_DEPENDENCY_UNAVAILABLE",
      ]),
    );
    expect(report.mismatches.every((item) => item.status === "MISMATCH")).toBe(
      true,
    );
  });

  it("shows the whole transition gap from the known previous release", () => {
    const t = target().value;
    const catalog = exactCatalog(t);
    catalog.release = null;
    catalog.policies = [
      {
        ...catalog.policies![0]!,
        id: "policy-previous",
        revision: 2,
        minimumExtensionVersion: "0.2.7",
        recommendedExtensionVersion: "0.2.7",
      },
    ];
    catalog.config = {
      ...catalog.config!,
      compatibilityPolicyRevisionIds: ["policy-previous"],
    };
    const report = analyzeStoreReleaseTransition(t, catalog);
    expect(report.status).toBe("MISMATCH");
    expect(codes(report)).toEqual(
      expect.arrayContaining([
        "RELEASE_MISSING",
        "POLICY_TARGET_MISMATCH",
        "CONFIG_TARGET_POLICY_UNAVAILABLE",
      ]),
    );
    expect(
      report.checks.find((item) => item.component === "profileRevision"),
    ).toMatchObject({ status: "READY", code: "PROFILE_REVISION_READY" });
    expect(
      report.checks.find((item) => item.component === "assignment"),
    ).toMatchObject({ status: "READY", code: "ASSIGNMENT_READY" });
  });

  it("returns READY when 0.2.8 release/policy/config use the canonical published 0.2.7-floor profile and DIRECT assignment", () => {
    const t = target("0.2.8").value;
    const report = analyzeStoreReleaseTransition(t, exactCatalog(t));
    expect(t.profileContentSha256).toBe(
      "cab55851bd2d571c19de5d44f3f8b3c40ff0ba3eb44e346307a2578894b1b2c1",
    );
    expect(report.status).toBe("READY");
    expect(report.mismatches).toEqual([]);
    expect(report.checks).toHaveLength(8);
    expect(report.checks.every((item) => item.status === "READY")).toBe(true);
    expect(report).toMatchObject({
      readOnly: true,
      catalogMutationExecuted: false,
    });
  });

  it("accepts exact browser binding and rejects unbound, partial, mixed, and wrong digests", () => {
    const t = target("0.2.8").value;
    const exact = exactCatalog(t);
    exact.release = {
      ...exact.release!,
      artifactSha256: null,
      browserArtifacts: [
        {
          browserFamily: t.browserFamily,
          artifactSha256: t.artifactSha256,
        },
      ],
    };
    expect(codes(analyzeStoreReleaseTransition(t, exact))).not.toContain(
      "RELEASE_CONFLICT",
    );

    const wrong = analyzeStoreReleaseTransition(t, {
      ...exact,
      release: {
        ...exact.release!,
        browserArtifacts: [
          {
            browserFamily: t.browserFamily,
            artifactSha256: "0".repeat(64),
          },
        ],
      },
    });
    expect(codes(wrong)).toContain("RELEASE_CONFLICT");

    const expandedRelease = {
      ...exact.release!,
      supportedBrowsers: [t.browserFamily, "chrome"],
    };
    const unbound = analyzeStoreReleaseTransition(t, {
      ...exact,
      release: {
        ...expandedRelease,
        artifactSha256: null,
        browserArtifacts: [
          { browserFamily: t.browserFamily, artifactSha256: null },
          { browserFamily: "chrome", artifactSha256: null },
        ],
      },
    });
    expect(codes(unbound)).toContain("RELEASE_ARTIFACT_UNBOUND");
    const partial = analyzeStoreReleaseTransition(t, {
      ...exact,
      release: {
        ...expandedRelease,
        artifactSha256: null,
        browserArtifacts: [
          { browserFamily: t.browserFamily, artifactSha256: t.artifactSha256 },
          { browserFamily: "chrome", artifactSha256: null },
        ],
      },
    });
    expect(codes(partial)).toContain("RELEASE_ARTIFACT_BROWSER_SET_PARTIAL");

    const mixed = analyzeStoreReleaseTransition(t, {
      ...exact,
      release: {
        ...exact.release!,
        artifactSha256: t.artifactSha256,
        browserArtifacts: [
          {
            browserFamily: t.browserFamily,
            artifactSha256: t.artifactSha256,
          },
        ],
      },
    });
    expect(codes(mixed)).toContain("RELEASE_ARTIFACT_MODE_MIXED");
  });

  it("rejects duplicate supported browser identities before classifying artifact mode", () => {
    const t = target("0.2.8").value;
    const catalog = exactCatalog(t);
    catalog.release = {
      ...catalog.release!,
      artifactSha256: null,
      supportedBrowsers: [t.browserFamily, t.browserFamily],
      browserArtifacts: [
        {
          browserFamily: t.browserFamily,
          artifactSha256: t.artifactSha256,
        },
        {
          browserFamily: "chrome",
          artifactSha256: "1".repeat(64),
        },
      ],
    };
    const report = analyzeStoreReleaseTransition(t, catalog);
    expect(codes(report)).toContain("RELEASE_ARTIFACT_BROWSER_SET_INVALID");
  });

  it("fails closed if browser-row classification data is unavailable", () => {
    const t = target("0.2.8").value;
    const catalog = exactCatalog(t);
    delete catalog.release!.browserArtifacts;
    const report = analyzeStoreReleaseTransition(t, catalog);
    expect(codes(report)).toContain("RELEASE_ARTIFACT_MODE_UNAVAILABLE");
  });

  it("fails closed when the published profile SHA does not match canonical STORE profile authority", () => {
    const t = target("0.2.8").value;
    const catalog = exactCatalog(t);
    catalog.profileRevisions = [
      {
        ...catalog.profileRevisions![0]!,
        contentSha256: "0".repeat(64),
      },
    ];
    const report = analyzeStoreReleaseTransition(t, catalog);
    expect(report.status).toBe("MISMATCH");
    expect(codes(report)).toContain("PROFILE_TARGET_REVISION_MISSING");
  });

  it("keeps UNKNOWN terminal while preserving independent incompatibilities", () => {
    const t = target().value;
    const catalog = exactCatalog(t);
    catalog.release = {
      ...catalog.release!,
      artifactSha256: "0".repeat(64),
    };
    catalog.errors.push({
      scope: "policies",
      code: "POLICIES_HTTP_503",
    });
    catalog.config = {
      ...catalog.config!,
      signingKeyState: "RETIRED",
    };
    catalog.adapters = [
      ...catalog.adapters!,
      { id: "adapter-duplicate", machineKey: t.adapterKey, status: "ACTIVE" },
    ];

    const report = analyzeStoreReleaseTransition(t, catalog);
    expect(report.status).toBe("UNKNOWN");
    expect(codes(report)).toEqual(
      expect.arrayContaining([
        "RELEASE_CONFLICT",
        "POLICIES_HTTP_503",
        "CONFIG_CONFLICT",
        "ADAPTER_CONFLICT",
      ]),
    );
  });

  it("collects paginated readback through GET-only paths before analysis", async () => {
    const t = target().value;
    const exact = exactCatalog(t);
    const paths: string[] = [];
    const responses = new Map<string, { status: number; body: unknown }>([
      [
        "/v1/admin/compatibility/releases/" + t.productVersion,
        { status: 200, body: exact.release },
      ],
      [
        "/v1/admin/compatibility/policies?contractVersion=control_plane_v2&policyKey=store1.opera.v2&scope=opera&limit=100",
        {
          status: 200,
          body: { items: exact.policies, nextCursor: null },
        },
      ],
      [
        "/v1/admin/compatibility/config-releases/latest?contractVersion=control_plane_v2",
        { status: 200, body: exact.config },
      ],
      [
        "/v1/admin/ai/registry/adapters?limit=100",
        { status: 200, body: { items: [], nextCursor: "a2" } },
      ],
      [
        "/v1/admin/ai/registry/adapters?limit=100&cursor=a2",
        { status: 200, body: { items: exact.adapters, nextCursor: null } },
      ],
      [
        "/v1/admin/ai/registry/adapters/adapter/surfaces?limit=100",
        { status: 200, body: { items: exact.surfaces, nextCursor: null } },
      ],
      [
        "/v1/admin/ai/profiles?adapterId=adapter&surfaceId=surface&limit=100",
        { status: 200, body: { items: exact.profiles, nextCursor: null } },
      ],
      [
        "/v1/admin/ai/profiles/profile/revisions?limit=100",
        {
          status: 200,
          body: { items: exact.profileRevisions, nextCursor: null },
        },
      ],
      [
        "/v1/admin/ai/assignments?adapterId=adapter&surfaceId=surface&browserFamily=opera&subjectKind=ACCOUNT&limit=100",
        {
          status: 200,
          body: { items: exact.assignments, nextCursor: null },
        },
      ],
    ]);

    const catalog = await collectStoreReleaseTransitionCatalog(
      t,
      async (path) => {
        paths.push(path);
        return (
          responses.get(path) ?? {
            status: 500,
            body: { error: "unexpected path" },
          }
        );
      },
    );
    const report = analyzeStoreReleaseTransition(t, catalog);
    expect(report.status).toBe("READY");
    expect(paths).toContain(
      "/v1/admin/ai/registry/adapters?limit=100&cursor=a2",
    );
    expect(
      paths.every(
        (path) =>
          !path.includes("/publish") &&
          !path.includes("/direct") &&
          !path.includes("/rollout"),
      ),
    ).toBe(true);
  });
});
