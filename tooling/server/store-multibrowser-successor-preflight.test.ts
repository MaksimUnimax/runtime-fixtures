import { createHash } from "node:crypto";
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

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "octoport-multibrowser-"));
  const chromiumBytes = Buffer.from("chromium-successor-package");
  const firefoxBytes = Buffer.from("firefox-successor-package");
  const chromiumFilename = "OCTOPORT_v0.2.12_CHROMIUM_STORE.zip";
  const firefoxFilename = "OCTOPORT_v0.2.12_FIREFOX_STORE.zip";
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
        sha256: sha256(chromiumBytes),
        bytes: chromiumBytes.length,
        inventoryCount: 43,
        version: MULTIBROWSER_SUCCESSOR_VERSION,
        browser: "chromium",
      },
      firefox: {
        filename: firefoxFilename,
        sha256: sha256(firefoxBytes),
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

describe("multi-browser successor STORE preflight", () => {
  it("binds exact successor packages to four explicit browser/profile targets", () => {
    const f = fixture();
    const result = readMultibrowserSuccessorTarget(f.manifestPath, {
      chromiumZipPath: f.chromiumZipPath,
      firefoxZipPath: f.firefoxZipPath,
    });

    expect(result).toMatchObject({
      schemaVersion: "store_multibrowser_successor_preflight_v1",
      evidenceLevel: "SOURCE_PREFLIGHT",
      readOnly: true,
      catalogMutationAuthorized: false,
      packageBuildAuthorized: false,
      currentImmutableVersion: "0.2.11",
      productVersion: "0.2.12",
      contractVersion: "control_plane_v2",
      release: {
        releaseChannel: "stable",
        supportedContracts: ["control_plane_v2"],
        supportedBrowsers: ["opera", "chrome", "yandex_chromium", "firefox"],
      },
      packages: {
        chromium: {
          kind: "chromium",
          version: "0.2.12",
          browser: "chromium",
          bytesVerified: true,
        },
        firefox: {
          kind: "firefox",
          version: "0.2.12",
          browser: "firefox",
          bytesVerified: true,
        },
      },
    });

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
      packageKind: "chromium",
      profileKey: "chatgpt-web-chrome-v1",
      reusesExistingOperaProfile: false,
      approvedMinimumBrowserVersion: null,
      browserMinimumDecisionRequired: true,
      compatibility: {
        browserFamilies: ["chrome"],
        minimumBrowserVersions: [],
        minimumExtensionVersion: "0.2.12",
      },
    });
    expect(
      result.profiles.find((item) => item.browserFamily === "yandex_chromium"),
    ).toMatchObject({
      observedBrowserVersion: "26.8.1.1111",
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

  it("parses a manifest without claiming package bytes were verified", () => {
    const f = fixture();
    const result = readMultibrowserSuccessorTarget(f.manifestPath);
    expect(result.packages.chromium.bytesVerified).toBe(false);
    expect(result.packages.firefox.bytesVerified).toBe(false);
    expect(result.catalogMutationAuthorized).toBe(false);
    expect(result.packageBuildAuthorized).toBe(false);
  });

  it("refuses to widen the immutable current 0.2.11 release", () => {
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

  it.each(["0.2.10", "0.2.13"])(
    "requires the exact next patch version instead of %s",
    (version) => {
      const f = fixture();
      rewrite(f, (manifest) => {
        manifest.productVersion = version as "0.2.12";
        manifest.packages.chromium.version = version as "0.2.12";
        manifest.packages.firefox.version = version as "0.2.12";
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
      manifest.packages.firefox.version = "0.2.11";
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

  it("does not promote observed browser versions into unapproved profile minimums", () => {
    const f = fixture();
    const result = readMultibrowserSuccessorTarget(f.manifestPath);
    const profiles = JSON.parse(
      JSON.stringify(result.profiles),
    ) as SuccessorProfileTarget[];
    const chrome = profiles.find((item) => item.browserFamily === "chrome")!;
    chrome.compatibility.minimumBrowserVersions = [
      {
        browserFamily: "chrome",
        minimumVersion: chrome.observedBrowserVersion,
      },
    ];
    expect(() => assertMultibrowserProfileTargets(profiles)).toThrow(
      "MULTIBROWSER_PROFILE_BROWSER_MINIMUM_UNAUTHORIZED",
    );
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
