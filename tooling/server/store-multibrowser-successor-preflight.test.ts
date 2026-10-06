import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  STORE1_PROFILE_KEY,
  STORE1_PROFILE_SHA256,
} from "./store1-opera-admin-activation.js";
import {
  MULTIBROWSER_CURRENT_VERSION,
  MULTIBROWSER_SUCCESSOR_VERSION,
  assertMultibrowserProfileTargets,
  readMultibrowserSuccessorTarget,
  readStore0213RepairedChromeCanonicalTarget,
  type SuccessorProfileTarget,
} from "./store-multibrowser-successor-preflight.js";

type Fixture = ReturnType<typeof fixture>;

type MutableManifest = {
  schemaVersion: string;
  authoritySha256: string;
  source: { head: string; tree: string };
  productVersion: string;
  contractVersion: string;
  migrationLevel: number;
  packages: {
    chromium: {
      filename: string;
      sha256: string;
      bytes: number;
      inventoryCount: number;
      version: string;
      browser: string;
    };
    firefox: {
      filename: string;
      sha256: string;
      bytes: number;
      inventoryCount: number;
      version: string;
      browser: string;
    };
  };
};

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "octoport-multibrowser-"));
  const chromiumBytes = Buffer.from("chromium-successor-package");
  const firefoxBytes = Buffer.from("firefox-successor-package");
  const chromiumFilename = "OCTOPORT_v0.2.13_CHROMIUM_STORE.zip";
  const firefoxFilename = "OCTOPORT_v0.2.13_FIREFOX_STORE.zip";
  const chromiumZipPath = join(dir, chromiumFilename);
  const firefoxZipPath = join(dir, firefoxFilename);
  writeFileSync(chromiumZipPath, chromiumBytes);
  writeFileSync(firefoxZipPath, firefoxBytes);

  const manifest: MutableManifest = {
    schemaVersion: "b1_release_candidate_v2",
    authoritySha256: "a".repeat(64),
    source: {
      head: "1".repeat(40),
      tree: "2".repeat(40),
    },
    productVersion: MULTIBROWSER_SUCCESSOR_VERSION,
    contractVersion: "control_plane_v2",
    migrationLevel: 55,
    packages: {
      chromium: {
        filename: chromiumFilename,
        sha256:
          "8d0664dda71e5b1f12e4bd69e42b53325ee8d213eb6d4869d7291799fce5b463",
        bytes: chromiumBytes.length,
        inventoryCount: 43,
        version: MULTIBROWSER_SUCCESSOR_VERSION,
        browser: "chromium",
      },
      firefox: {
        filename: firefoxFilename,
        sha256:
          "b987ce3a24258d3922f61b2d650c17ef029d895a25aab0ec6d27cccacec3c037",
        bytes: firefoxBytes.length,
        inventoryCount: 44,
        version: MULTIBROWSER_SUCCESSOR_VERSION,
        browser: "firefox",
      },
    },
  };
  const manifestPath = join(dir, "B1_RC_MANIFEST.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  return {
    dir,
    manifest,
    manifestPath,
    chromiumZipPath,
    firefoxZipPath,
  };
}

function rewrite(
  value: Fixture,
  mutate: (manifest: MutableManifest) => void,
): void {
  const manifest = JSON.parse(
    JSON.stringify(value.manifest),
  ) as MutableManifest;
  mutate(manifest);
  writeFileSync(value.manifestPath, JSON.stringify(manifest, null, 2));
}

describe("repaired Chrome STORE 0.2.13 canonical preflight", () => {
  it("keeps repaired Chrome distinct from the frozen Opera/Yandex and Firefox artifacts", () => {
    const result = readStore0213RepairedChromeCanonicalTarget();
    expect(result).toMatchObject({
      schemaVersion: "store_0213_repaired_chrome_preflight_v1",
      evidenceLevel: "SOURCE_PREFLIGHT",
      readOnly: true,
      catalogMutationAuthorized: false,
      packageBuildAuthorized: false,
      livePublicationAuthorized: false,
      ordinaryAuthAccepted: false,
      liveOwnerAccepted: false,
      deploymentAuthorized: false,
      source: {
        head: "087eab3394aac5164e8b3d16459eabf0697895d9",
        tree: "7c72525e6e91c2ddda65e5d8ca0226846c04ae66",
      },
      productVersion: "0.2.13",
      chromeRepairArtifact: {
        filename: "Octoport-Chrome-0.2.13-test-7d12ddcb.zip",
        sha256:
          "7d12ddcbd82e18e26885c94f6a02e512dbade2c57b7e89ac9444dcbe0cac8cf4",
        bytes: 2300829,
        bytesVerified: false,
      },
    });
    expect(result.release.browserArtifacts).toEqual([
      {
        browserFamily: "chrome",
        artifactSha256:
          "7d12ddcbd82e18e26885c94f6a02e512dbade2c57b7e89ac9444dcbe0cac8cf4",
      },
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
    ]);
  });

  it("rejects non-exact repaired Chrome package bytes and basename", () => {
    const dir = mkdtempSync(join(tmpdir(), "octoport-repaired-chrome-"));
    const path = join(dir, "Octoport-Chrome-0.2.13-test-7d12ddcb.zip");
    writeFileSync(path, Buffer.from("not-the-exact-package"));
    expect(() => readStore0213RepairedChromeCanonicalTarget(path)).toThrow(
      "REPAIRED_CHROME_PACKAGE_MISMATCH",
    );
  });
});

describe("multi-browser successor STORE preflight", () => {
  it("binds exact successor packages to four explicit browser/profile targets", () => {
    const f = fixture();
    const result = readMultibrowserSuccessorTarget(f.manifestPath);

    expect(result).toMatchObject({
      schemaVersion: "store_multibrowser_successor_preflight_v1",
      evidenceLevel: "SOURCE_PREFLIGHT",
      readOnly: true,
      catalogMutationAuthorized: false,
      packageBuildAuthorized: false,
      livePublicationAuthorized: false,
      currentImmutableVersion: "0.2.12",
      productVersion: "0.2.13",
      contractVersion: "control_plane_v2",
      release: {
        releaseChannel: "stable",
        supportedContracts: ["control_plane_v2"],
        supportedBrowsers: ["chrome", "opera", "yandex_chromium", "firefox"],
        browserArtifacts: [
          {
            browserFamily: "chrome",
            artifactSha256:
              "8d0664dda71e5b1f12e4bd69e42b53325ee8d213eb6d4869d7291799fce5b463",
          },
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
      packages: {
        chromium: {
          kind: "chromium",
          version: "0.2.13",
          browser: "chromium",
          bytesVerified: false,
        },
        firefox: {
          kind: "firefox",
          version: "0.2.13",
          browser: "firefox",
          bytesVerified: false,
        },
      },
    });
    expect(
      new Set(result.release.browserArtifacts.map((row) => row.browserFamily)),
    ).toEqual(new Set(["chrome", "opera", "yandex_chromium", "firefox"]));

    expect(result.profiles).toHaveLength(4);
    expect(new Set(result.profiles.map((item) => item.profileKey)).size).toBe(
      4,
    );
    expect(
      new Set(result.profiles.map((item) => item.profileContentSha256)).size,
    ).toBe(4);

    const opera = result.profiles.find(
      (item) => item.browserFamily === "opera",
    )!;
    expect(opera).toMatchObject({
      observedBrowserVersion: "136.0.6008.22",
      runtimeCompatibilityVersion: "136.0.0.0",
      packageKind: "chromium",
      profileKey: STORE1_PROFILE_KEY,
      profileContentSha256: STORE1_PROFILE_SHA256,
      reusesExistingOperaProfile: true,
      approvedMinimumBrowserVersion: "136",
      browserMinimumDecisionRequired: false,
      compatibility: {
        browserFamilies: ["opera"],
        minimumBrowserVersions: [
          { browserFamily: "opera", minimumVersion: "136" },
        ],
        minimumExtensionVersion: "0.2.7",
      },
    });

    expect(
      result.profiles.find((item) => item.browserFamily === "chrome"),
    ).toMatchObject({
      observedBrowserVersion: "147.0.7727.116",
      runtimeCompatibilityVersion: "147.0.0.0",
      packageKind: "chromium",
      profileKey: "chatgpt-web-chrome-v1",
      reusesExistingOperaProfile: false,
      approvedMinimumBrowserVersion: null,
      browserMinimumDecisionRequired: true,
      compatibility: {
        browserFamilies: ["chrome"],
        minimumBrowserVersions: [],
        minimumExtensionVersion: "0.2.13",
      },
    });
    expect(
      result.profiles.find((item) => item.browserFamily === "yandex_chromium"),
    ).toMatchObject({
      observedBrowserVersion: "26.8.1.1111",
      runtimeCompatibilityVersion: "26.8.0.0",
      packageKind: "chromium",
      profileKey: "chatgpt-web-yandex-v1",
      approvedMinimumBrowserVersion: null,
      browserMinimumDecisionRequired: true,
      compatibility: {
        browserFamilies: ["yandex_chromium"],
        minimumBrowserVersions: [],
      },
    });
    expect(
      result.profiles.find((item) => item.browserFamily === "firefox"),
    ).toMatchObject({
      observedBrowserVersion: "155.0.1",
      runtimeCompatibilityVersion: "155.0",
      packageKind: "firefox",
      profileKey: "chatgpt-web-firefox-v1",
      approvedMinimumBrowserVersion: null,
      browserMinimumDecisionRequired: true,
      compatibility: {
        browserFamilies: ["firefox"],
        minimumBrowserVersions: [],
      },
    });
  });

  it("rejects successor manifest digests that drift from accepted canonical artifacts", () => {
    const f = fixture();
    rewrite(f, (manifest) => {
      manifest.packages.firefox.sha256 = "0".repeat(64);
    });
    expect(() => readMultibrowserSuccessorTarget(f.manifestPath)).toThrow(
      "MULTIBROWSER_CANONICAL_PACKAGE_DIGEST_MISMATCH",
    );
  });

  it("parses a manifest without claiming package bytes were verified", () => {
    const f = fixture();
    const result = readMultibrowserSuccessorTarget(f.manifestPath);
    expect(result.packages.chromium.bytesVerified).toBe(false);
    expect(result.packages.firefox.bytesVerified).toBe(false);
    expect(result.catalogMutationAuthorized).toBe(false);
    expect(result.packageBuildAuthorized).toBe(false);
  });

  it("refuses to widen the immutable current 0.2.12 release", () => {
    const f = fixture();
    rewrite(f, (manifest) => {
      manifest.productVersion = MULTIBROWSER_CURRENT_VERSION;
      manifest.packages.chromium.version = MULTIBROWSER_CURRENT_VERSION;
      manifest.packages.firefox.version = MULTIBROWSER_CURRENT_VERSION;
    });
    expect(() => readMultibrowserSuccessorTarget(f.manifestPath)).toThrow(
      "MULTIBROWSER_CURRENT_RELEASE_IMMUTABLE",
    );
  });

  it.each(["0.2.11", "0.2.14"])(
    "requires the exact next patch version instead of %s",
    (version) => {
      const f = fixture();
      rewrite(f, (manifest) => {
        manifest.productVersion = version as "0.2.13";
        manifest.packages.chromium.version = version as "0.2.13";
        manifest.packages.firefox.version = version as "0.2.13";
      });
      expect(() => readMultibrowserSuccessorTarget(f.manifestPath)).toThrow(
        "MULTIBROWSER_SUCCESSOR_VERSION_REQUIRED",
      );
    },
  );

  it("rejects malformed successor version", () => {
    const f = fixture();
    rewrite(f, (manifest) => {
      manifest.productVersion = "0.2";
    });
    expect(() => readMultibrowserSuccessorTarget(f.manifestPath)).toThrow(
      "MULTIBROWSER_MANIFEST_VERSION_INVALID",
    );
  });

  it("requires both exact package entries", () => {
    const f = fixture();
    rewrite(f, (manifest) => {
      delete (manifest.packages as { firefox?: unknown }).firefox;
    });
    expect(() => readMultibrowserSuccessorTarget(f.manifestPath)).toThrow(
      "MULTIBROWSER_FIREFOX_PACKAGE_INVALID",
    );
  });

  it("rejects a package assigned to the wrong package browser kind", () => {
    const f = fixture();
    rewrite(f, (manifest) => {
      manifest.packages.chromium.browser = "firefox";
    });
    expect(() => readMultibrowserSuccessorTarget(f.manifestPath)).toThrow(
      "MULTIBROWSER_CHROMIUM_PACKAGE_INVALID",
    );
  });

  it("rejects package version mismatch", () => {
    const f = fixture();
    rewrite(f, (manifest) => {
      manifest.packages.firefox.version = "0.2.12";
    });
    expect(() => readMultibrowserSuccessorTarget(f.manifestPath)).toThrow(
      "MULTIBROWSER_FIREFOX_PACKAGE_INVALID",
    );
  });

  it("rejects mismatched package bytes instead of trusting the manifest hash", () => {
    const f = fixture();
    writeFileSync(f.chromiumZipPath, Buffer.from("tampered"));
    expect(() =>
      readMultibrowserSuccessorTarget(f.manifestPath, {
        chromiumZipPath: f.chromiumZipPath,
        firefoxZipPath: f.firefoxZipPath,
      }),
    ).toThrow("MULTIBROWSER_CHROMIUM_PACKAGE_MISMATCH");
  });

  it("rejects a package path whose basename differs from the manifest", () => {
    const f = fixture();
    const renamed = join(f.dir, "other.zip");
    writeFileSync(renamed, readFileSync(f.firefoxZipPath));
    expect(() =>
      readMultibrowserSuccessorTarget(f.manifestPath, {
        firefoxZipPath: renamed,
      }),
    ).toThrow("MULTIBROWSER_FIREFOX_PACKAGE_MISMATCH");
  });

  it("fails closed on duplicate profile keys", () => {
    const f = fixture();
    const result = readMultibrowserSuccessorTarget(f.manifestPath);
    const profiles = JSON.parse(
      JSON.stringify(result.profiles),
    ) as SuccessorProfileTarget[];
    profiles[1]!.profileKey = profiles[0]!.profileKey;
    expect(() => assertMultibrowserProfileTargets(profiles)).toThrow(
      "MULTIBROWSER_PROFILE_KEY_DUPLICATE",
    );
  });

  it("keeps historical Chrome profile undecided instead of cross-binding repaired authority", () => {
    const f = fixture();
    const result = readMultibrowserSuccessorTarget(f.manifestPath);
    const chrome = result.profiles.find(
      (item) => item.browserFamily === "chrome",
    )!;
    expect(chrome.approvedMinimumBrowserVersion).toBeNull();
    expect(chrome.browserMinimumDecisionRequired).toBe(true);
    expect(chrome.compatibility.minimumBrowserVersions).toEqual([]);
  });

  it("binds Chrome 147 only to the repaired 7d12 canonical target", () => {
    const result = readStore0213RepairedChromeCanonicalTarget();
    expect(result.release.browserArtifacts[0]).toEqual({
      browserFamily: "chrome",
      artifactSha256:
        "7d12ddcbd82e18e26885c94f6a02e512dbade2c57b7e89ac9444dcbe0cac8cf4",
    });
    expect(result.chromeProfile).toMatchObject({
      browserFamily: "chrome",
      approvedMinimumBrowserVersion: "147",
      browserMinimumDecisionRequired: false,
      compatibility: {
        browserFamilies: ["chrome"],
        minimumBrowserVersions: [
          { browserFamily: "chrome", minimumVersion: "147" },
        ],
      },
    });
  });

  it("rejects product-version substitution for runtime compatibility evidence", () => {
    const f = fixture();
    const result = readMultibrowserSuccessorTarget(f.manifestPath);
    const profiles = JSON.parse(
      JSON.stringify(result.profiles),
    ) as SuccessorProfileTarget[];
    const chrome = profiles.find((item) => item.browserFamily === "chrome")!;
    (
      chrome as unknown as { runtimeCompatibilityVersion?: string }
    ).runtimeCompatibilityVersion = chrome.observedBrowserVersion;
    expect(() => assertMultibrowserProfileTargets(profiles)).toThrow(
      "MULTIBROWSER_PROFILE_RUNTIME_VERSION_EVIDENCE_INVALID",
    );
  });

  it("requires approved minimums to be satisfied by runtime compatibility evidence", () => {
    const f = fixture();
    const result = readMultibrowserSuccessorTarget(f.manifestPath);

    for (const runtimeCompatibilityVersion of ["", "135.9.9.9"]) {
      const profiles = JSON.parse(
        JSON.stringify(result.profiles),
      ) as SuccessorProfileTarget[];
      const opera = profiles.find((item) => item.browserFamily === "opera")!;
      (
        opera as unknown as { runtimeCompatibilityVersion?: string }
      ).runtimeCompatibilityVersion = runtimeCompatibilityVersion;
      expect(() => assertMultibrowserProfileTargets(profiles)).toThrow(
        runtimeCompatibilityVersion
          ? "MULTIBROWSER_PROFILE_RUNTIME_BELOW_APPROVED_MINIMUM"
          : "MULTIBROWSER_PROFILE_RUNTIME_VERSION_EVIDENCE_INVALID",
      );
    }
  });

  it("fails closed on a browser/profile scope mismatch", () => {
    const f = fixture();
    const result = readMultibrowserSuccessorTarget(f.manifestPath);
    const profiles = JSON.parse(
      JSON.stringify(result.profiles),
    ) as SuccessorProfileTarget[];
    const chrome = profiles.find((item) => item.browserFamily === "chrome")!;
    chrome.compatibility.browserFamilies = ["opera"];
    expect(() => assertMultibrowserProfileTargets(profiles)).toThrow(
      "MULTIBROWSER_PROFILE_SCOPE_INVALID",
    );
  });
});
