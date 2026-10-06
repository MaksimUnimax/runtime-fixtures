import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { SemVerV1Schema } from "../../packages/shared/src/index.js";
import { validateProfileContent } from "../../packages/server/adapter-registry/src/index.js";
import {
  BETA_RELEASE_CANONICAL_INPUTS_V1,
  STORE_0_2_13_RELEASE_CANONICAL_INPUTS_V1,
  STORE_0_2_13_REPAIRED_CHROME_RELEASE_CANONICAL_INPUTS_V1,
} from "../../packages/server/compatibility/src/beta-release-canonical-inputs.js";
import {
  STORE1_CONTRACT,
  STORE1_PROFILE_COMPATIBILITY,
  STORE1_PROFILE_CONTENT,
  STORE1_PROFILE_KEY,
  STORE1_PROFILE_SHA256,
} from "./store1-opera-admin-activation.js";

const HASH = /^[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;

export const MULTIBROWSER_CURRENT_VERSION =
  BETA_RELEASE_CANONICAL_INPUTS_V1.release.productVersion;
export const MULTIBROWSER_SUCCESSOR_VERSION =
  STORE_0_2_13_RELEASE_CANONICAL_INPUTS_V1.release.productVersion;
export const MULTIBROWSER_EVIDENCE_LEVEL = "SOURCE_PREFLIGHT" as const;

type PackageKind = "chromium" | "firefox";
type BrowserTargetFamily = "chrome" | "opera" | "yandex_chromium" | "firefox";

type ManifestPackage = {
  filename?: unknown;
  sha256?: unknown;
  bytes?: unknown;
  inventoryCount?: unknown;
  version?: unknown;
  browser?: unknown;
};

type CandidateManifest = {
  schemaVersion?: unknown;
  source?: { head?: unknown; tree?: unknown };
  productVersion?: unknown;
  contractVersion?: unknown;
  migrationLevel?: unknown;
  packages?: {
    chromium?: ManifestPackage;
    firefox?: ManifestPackage;
  };
};

export type SuccessorPackageTarget = {
  kind: PackageKind;
  filename: string;
  sha256: string;
  bytes: number;
  inventoryCount: number | null;
  version: typeof MULTIBROWSER_SUCCESSOR_VERSION;
  browser: PackageKind;
  bytesVerified: boolean;
};

export type SuccessorProfileTarget = {
  browserFamily: BrowserTargetFamily;
  observedBrowserVersion: string;
  runtimeCompatibilityVersion: string;
  packageKind: PackageKind;
  profileKey: string;
  profileContentSha256: string;
  compatibility: {
    schemaVersion: "profile_compatibility_v1";
    contractVersion: typeof STORE1_CONTRACT;
    browserFamilies: BrowserTargetFamily[];
    minimumBrowserVersions: Array<{
      browserFamily: BrowserTargetFamily;
      minimumVersion: string;
    }>;
    minimumExtensionVersion: string | null;
  };
  reusesExistingOperaProfile: boolean;
  approvedMinimumBrowserVersion: string | null;
  browserMinimumDecisionRequired: boolean;
};

export type MultibrowserSuccessorTarget = {
  schemaVersion: "store_multibrowser_successor_preflight_v1";
  evidenceLevel: typeof MULTIBROWSER_EVIDENCE_LEVEL;
  readOnly: true;
  catalogMutationAuthorized: false;
  packageBuildAuthorized: false;
  livePublicationAuthorized: false;
  source: { head: string; tree: string };
  currentImmutableVersion: typeof MULTIBROWSER_CURRENT_VERSION;
  productVersion: typeof MULTIBROWSER_SUCCESSOR_VERSION;
  contractVersion: typeof STORE1_CONTRACT;
  migrationLevel: number;
  release: {
    releaseChannel: "stable";
    supportedContracts: [typeof STORE1_CONTRACT];
    supportedBrowsers: BrowserTargetFamily[];
    browserArtifacts: Array<{
      browserFamily: BrowserTargetFamily;
      artifactSha256: string;
    }>;
  };
  packages: {
    chromium: SuccessorPackageTarget;
    firefox: SuccessorPackageTarget;
  };
  profiles: SuccessorProfileTarget[];
};

const BROWSER_SPECS = [
  {
    browserFamily: "opera",
    observedBrowserVersion: "136.0.6008.22",
    runtimeCompatibilityVersion: "136.0.0.0",
    packageKind: "chromium",
    profileKey: STORE1_PROFILE_KEY,
    reusesExistingOperaProfile: true,
    approvedProfileMinimumBrowserVersion: "136",
  },
  {
    browserFamily: "chrome",
    observedBrowserVersion: "147.0.7727.116",
    runtimeCompatibilityVersion: "147.0.0.0",
    packageKind: "chromium",
    profileKey: "chatgpt-web-chrome-v1",
    reusesExistingOperaProfile: false,
    approvedProfileMinimumBrowserVersion: null,
  },
  {
    browserFamily: "yandex_chromium",
    observedBrowserVersion: "26.8.1.1111",
    runtimeCompatibilityVersion: "26.8.0.0",
    packageKind: "chromium",
    profileKey: "chatgpt-web-yandex-v1",
    reusesExistingOperaProfile: false,
    approvedProfileMinimumBrowserVersion: null,
  },
  {
    browserFamily: "firefox",
    observedBrowserVersion: "155.0.1",
    runtimeCompatibilityVersion: "155.0",
    packageKind: "firefox",
    profileKey: "chatgpt-web-firefox-v1",
    reusesExistingOperaProfile: false,
    approvedProfileMinimumBrowserVersion: null,
  },
] as const;

function requiredString(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(code);
  return value;
}

function parseBrowserVersion(value: string): number[] | null {
  const parts = value.split(".");
  if (
    parts.length < 1 ||
    parts.length > 4 ||
    parts.some((part) => !/^(?:0|[1-9]\d*)$/.test(part))
  )
    return null;
  const numbers = parts.map(Number);
  if (
    numbers.some(
      (part) => !Number.isSafeInteger(part) || part < 0 || part > 2147483647,
    )
  )
    return null;
  return [...numbers, ...Array(4 - numbers.length).fill(0)];
}

function browserVersionAtLeast(actual: string, minimum: string): boolean {
  const left = parseBrowserVersion(actual);
  const right = parseBrowserVersion(minimum);
  if (!left || !right) return false;
  for (let index = 0; index < 4; index += 1) {
    if (left[index]! > right[index]!) return true;
    if (left[index]! < right[index]!) return false;
  }
  return true;
}

function packageTarget(
  pkg: ManifestPackage | undefined,
  kind: PackageKind,
  productVersion: typeof MULTIBROWSER_SUCCESSOR_VERSION,
  zipPath?: string,
): SuccessorPackageTarget {
  if (
    !pkg ||
    pkg.browser !== kind ||
    pkg.version !== productVersion ||
    typeof pkg.filename !== "string" ||
    !HASH.test(String(pkg.sha256 ?? "")) ||
    typeof pkg.bytes !== "number" ||
    !Number.isSafeInteger(pkg.bytes) ||
    pkg.bytes <= 0 ||
    !(
      pkg.inventoryCount === undefined ||
      (typeof pkg.inventoryCount === "number" &&
        Number.isSafeInteger(pkg.inventoryCount) &&
        pkg.inventoryCount > 0)
    )
  )
    throw new Error(`MULTIBROWSER_${kind.toUpperCase()}_PACKAGE_INVALID`);

  let bytesVerified = false;
  if (zipPath) {
    const bytes = readFileSync(zipPath);
    if (
      basename(zipPath) !== pkg.filename ||
      bytes.length !== pkg.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== pkg.sha256
    )
      throw new Error(`MULTIBROWSER_${kind.toUpperCase()}_PACKAGE_MISMATCH`);
    bytesVerified = true;
  }

  return {
    kind,
    filename: pkg.filename,
    sha256: pkg.sha256 as string,
    bytes: pkg.bytes,
    inventoryCount:
      typeof pkg.inventoryCount === "number" ? pkg.inventoryCount : null,
    version: productVersion,
    browser: kind,
    bytesVerified,
  };
}

function profileTarget(
  spec: (typeof BROWSER_SPECS)[number],
): SuccessorProfileTarget {
  if (spec.reusesExistingOperaProfile) {
    if (
      STORE1_PROFILE_COMPATIBILITY.browserFamilies.length !== 1 ||
      STORE1_PROFILE_COMPATIBILITY.browserFamilies[0] !== "opera" ||
      STORE1_PROFILE_SHA256 !==
        validateProfileContent({
          content: STORE1_PROFILE_CONTENT,
          compatibility: STORE1_PROFILE_COMPATIBILITY,
        }).contentSha256
    )
      throw new Error("MULTIBROWSER_EXISTING_OPERA_PROFILE_DRIFT");

    return {
      browserFamily: "opera",
      observedBrowserVersion: spec.observedBrowserVersion,
      runtimeCompatibilityVersion: spec.runtimeCompatibilityVersion,
      packageKind: "chromium",
      profileKey: STORE1_PROFILE_KEY,
      profileContentSha256: STORE1_PROFILE_SHA256,
      compatibility: {
        schemaVersion: "profile_compatibility_v1",
        contractVersion: STORE1_CONTRACT,
        browserFamilies: ["opera"],
        minimumBrowserVersions:
          STORE1_PROFILE_COMPATIBILITY.minimumBrowserVersions.map((row) => ({
            browserFamily: row.browserFamily,
            minimumVersion: row.minimumVersion,
          })),
        minimumExtensionVersion:
          STORE1_PROFILE_COMPATIBILITY.minimumExtensionVersion,
      },
      reusesExistingOperaProfile: true,
      approvedMinimumBrowserVersion: "136",
      browserMinimumDecisionRequired: false,
    };
  }

  const compatibility = {
    schemaVersion: "profile_compatibility_v1" as const,
    contractVersion: STORE1_CONTRACT,
    browserFamilies: [spec.browserFamily],
    minimumBrowserVersions: [],
    minimumExtensionVersion: MULTIBROWSER_SUCCESSOR_VERSION,
  };
  const validated = validateProfileContent({
    content: STORE1_PROFILE_CONTENT,
    compatibility,
  });

  return {
    browserFamily: spec.browserFamily,
    observedBrowserVersion: spec.observedBrowserVersion,
    runtimeCompatibilityVersion: spec.runtimeCompatibilityVersion,
    packageKind: spec.packageKind,
    profileKey: spec.profileKey,
    profileContentSha256: validated.contentSha256,
    compatibility,
    reusesExistingOperaProfile: false,
    approvedMinimumBrowserVersion: null,
    browserMinimumDecisionRequired: true,
  };
}

export function assertMultibrowserProfileTargets(
  profiles: SuccessorProfileTarget[],
): void {
  if (profiles.length !== BROWSER_SPECS.length)
    throw new Error("MULTIBROWSER_PROFILE_TARGET_COUNT_INVALID");

  const keys = profiles.map((profile) => profile.profileKey);
  const fingerprints = profiles.map((profile) => profile.profileContentSha256);
  if (new Set(keys).size !== keys.length)
    throw new Error("MULTIBROWSER_PROFILE_KEY_DUPLICATE");
  if (new Set(fingerprints).size !== fingerprints.length)
    throw new Error("MULTIBROWSER_PROFILE_FINGERPRINT_DUPLICATE");

  for (const spec of BROWSER_SPECS) {
    const profile = profiles.find(
      (candidate) => candidate.browserFamily === spec.browserFamily,
    );
    if (!profile) throw new Error("MULTIBROWSER_PROFILE_SCOPE_INVALID");

    const expectedMinimum = spec.approvedProfileMinimumBrowserVersion;
    if (!parseBrowserVersion(profile.runtimeCompatibilityVersion))
      throw new Error("MULTIBROWSER_PROFILE_RUNTIME_VERSION_EVIDENCE_INVALID");
    if (
      expectedMinimum !== null &&
      !browserVersionAtLeast(
        profile.runtimeCompatibilityVersion,
        expectedMinimum,
      )
    )
      throw new Error("MULTIBROWSER_PROFILE_RUNTIME_BELOW_APPROVED_MINIMUM");
    if (
      profile.runtimeCompatibilityVersion !== spec.runtimeCompatibilityVersion
    )
      throw new Error("MULTIBROWSER_PROFILE_RUNTIME_VERSION_EVIDENCE_INVALID");

    if (
      profile.packageKind !== spec.packageKind ||
      profile.profileKey !== spec.profileKey ||
      profile.observedBrowserVersion !== spec.observedBrowserVersion ||
      profile.compatibility.contractVersion !== STORE1_CONTRACT ||
      profile.compatibility.browserFamilies.length !== 1 ||
      profile.compatibility.browserFamilies[0] !== spec.browserFamily ||
      profile.compatibility.minimumBrowserVersions.length > 1 ||
      profile.compatibility.minimumBrowserVersions.some(
        (row) => row.browserFamily !== spec.browserFamily,
      )
    )
      throw new Error("MULTIBROWSER_PROFILE_SCOPE_INVALID");

    if (expectedMinimum === null) {
      if (profile.compatibility.minimumBrowserVersions.length !== 0)
        throw new Error("MULTIBROWSER_PROFILE_BROWSER_MINIMUM_UNAUTHORIZED");
    } else if (
      profile.compatibility.minimumBrowserVersions.length !== 1 ||
      profile.compatibility.minimumBrowserVersions[0]?.minimumVersion !==
        expectedMinimum
    )
      throw new Error("MULTIBROWSER_PROFILE_BROWSER_MINIMUM_INVALID");

    const expectedExtensionMinimum = spec.reusesExistingOperaProfile
      ? STORE1_PROFILE_COMPATIBILITY.minimumExtensionVersion
      : MULTIBROWSER_SUCCESSOR_VERSION;
    if (
      profile.compatibility.minimumExtensionVersion !== expectedExtensionMinimum
    )
      throw new Error("MULTIBROWSER_PROFILE_EXTENSION_MINIMUM_INVALID");

    if (spec.reusesExistingOperaProfile !== profile.reusesExistingOperaProfile)
      throw new Error("MULTIBROWSER_PROFILE_REUSE_FLAG_INVALID");
    if (
      profile.approvedMinimumBrowserVersion !==
        spec.approvedProfileMinimumBrowserVersion ||
      profile.browserMinimumDecisionRequired !==
        (spec.approvedProfileMinimumBrowserVersion === null)
    )
      throw new Error("MULTIBROWSER_PROFILE_BROWSER_MINIMUM_AUTHORITY_INVALID");
  }

  const opera = profiles.find((profile) => profile.browserFamily === "opera");
  if (
    opera?.profileKey !== STORE1_PROFILE_KEY ||
    opera.profileContentSha256 !== STORE1_PROFILE_SHA256
  )
    throw new Error("MULTIBROWSER_EXISTING_OPERA_PROFILE_CHANGED");
}

export type Store0213RepairedChromeCanonicalTarget = {
  schemaVersion: "store_0213_repaired_chrome_preflight_v1";
  evidenceLevel: typeof MULTIBROWSER_EVIDENCE_LEVEL;
  readOnly: true;
  catalogMutationAuthorized: false;
  packageBuildAuthorized: false;
  livePublicationAuthorized: false;
  ordinaryAuthAccepted: false;
  liveOwnerAccepted: false;
  deploymentAuthorized: false;
  source: { head: string; tree: string };
  productVersion: typeof MULTIBROWSER_SUCCESSOR_VERSION;
  release: {
    releaseChannel: "stable";
    supportedContracts: [typeof STORE1_CONTRACT];
    supportedBrowsers: BrowserTargetFamily[];
    browserArtifacts: Array<{
      browserFamily: BrowserTargetFamily;
      artifactSha256: string;
    }>;
  };
  chromeRepairArtifact: {
    filename: string;
    sha256: string;
    bytes: number;
    bytesVerified: boolean;
  };
};

export function readStore0213RepairedChromeCanonicalTarget(
  chromeZipPath?: string,
): Store0213RepairedChromeCanonicalTarget {
  const canonical = STORE_0_2_13_REPAIRED_CHROME_RELEASE_CANONICAL_INPUTS_V1;
  const historical = STORE_0_2_13_RELEASE_CANONICAL_INPUTS_V1;
  const historicalByBrowser = new Map(
    historical.artifacts.flatMap((artifact) =>
      artifact.browserFamilies.map(
        (browserFamily) => [browserFamily, artifact.sha256] as const,
      ),
    ),
  );

  const chrome = canonical.browserArtifacts[0];
  if (
    chrome.browserFamily !== "chrome" ||
    chrome.artifactSha256 === historicalByBrowser.get("chrome")
  )
    throw new Error("REPAIRED_CHROME_CANONICAL_IDENTITY_INVALID");

  for (const browserFamily of [
    "opera",
    "yandex_chromium",
    "firefox",
  ] as const) {
    const repaired = canonical.browserArtifacts.find(
      (artifact) => artifact.browserFamily === browserFamily,
    );
    if (
      !repaired ||
      repaired.artifactSha256 !== historicalByBrowser.get(browserFamily)
    )
      throw new Error("REPAIRED_CHROME_NON_CHROME_DIGEST_DRIFT");
  }

  let bytesVerified = false;
  if (chromeZipPath) {
    const bytes = readFileSync(chromeZipPath);
    if (
      basename(chromeZipPath) !== canonical.chromeRepairArtifact.filename ||
      bytes.length !== canonical.chromeRepairArtifact.bytes ||
      createHash("sha256").update(bytes).digest("hex") !==
        canonical.chromeRepairArtifact.sha256
    )
      throw new Error("REPAIRED_CHROME_PACKAGE_MISMATCH");
    bytesVerified = true;
  }

  return {
    schemaVersion: "store_0213_repaired_chrome_preflight_v1",
    evidenceLevel: MULTIBROWSER_EVIDENCE_LEVEL,
    readOnly: true,
    catalogMutationAuthorized: false,
    packageBuildAuthorized: false,
    livePublicationAuthorized: false,
    ordinaryAuthAccepted: false,
    liveOwnerAccepted: false,
    deploymentAuthorized: false,
    source: { ...canonical.source },
    productVersion: canonical.release.productVersion,
    release: {
      releaseChannel: canonical.release.releaseChannel,
      supportedContracts: [canonical.release.contractVersion],
      supportedBrowsers: [...canonical.release.supportedBrowsers],
      browserArtifacts: canonical.browserArtifacts.map((artifact) => ({
        browserFamily: artifact.browserFamily,
        artifactSha256: artifact.artifactSha256,
      })),
    },
    chromeRepairArtifact: {
      ...canonical.chromeRepairArtifact,
      bytesVerified,
    },
  };
}

export function readMultibrowserSuccessorTarget(
  manifestPath: string,
  packagePaths: {
    chromiumZipPath?: string;
    firefoxZipPath?: string;
  } = {},
): MultibrowserSuccessorTarget {
  const manifest = JSON.parse(
    readFileSync(manifestPath, "utf8"),
  ) as CandidateManifest;
  const productVersion = requiredString(
    manifest.productVersion,
    "MULTIBROWSER_MANIFEST_VERSION_REQUIRED",
  );

  if (!SemVerV1Schema.safeParse(productVersion).success)
    throw new Error("MULTIBROWSER_MANIFEST_VERSION_INVALID");
  if (productVersion === MULTIBROWSER_CURRENT_VERSION)
    throw new Error("MULTIBROWSER_CURRENT_RELEASE_IMMUTABLE");
  if (productVersion !== MULTIBROWSER_SUCCESSOR_VERSION)
    throw new Error("MULTIBROWSER_SUCCESSOR_VERSION_REQUIRED");

  if (
    manifest.schemaVersion !== "b1_release_candidate_v2" ||
    manifest.contractVersion !== STORE1_CONTRACT ||
    typeof manifest.migrationLevel !== "number" ||
    !Number.isSafeInteger(manifest.migrationLevel) ||
    manifest.migrationLevel < 0 ||
    !GIT_SHA.test(String(manifest.source?.head ?? "")) ||
    !GIT_SHA.test(String(manifest.source?.tree ?? ""))
  )
    throw new Error("MULTIBROWSER_MANIFEST_INVALID");

  const chromium = packageTarget(
    manifest.packages?.chromium,
    "chromium",
    MULTIBROWSER_SUCCESSOR_VERSION,
    packagePaths.chromiumZipPath,
  );
  const firefox = packageTarget(
    manifest.packages?.firefox,
    "firefox",
    MULTIBROWSER_SUCCESSOR_VERSION,
    packagePaths.firefoxZipPath,
  );
  const canonicalChromiumSha =
    STORE_0_2_13_RELEASE_CANONICAL_INPUTS_V1.artifacts.find(
      (artifact) => artifact.carrier === "chromium",
    )!.sha256;
  const canonicalFirefoxSha =
    STORE_0_2_13_RELEASE_CANONICAL_INPUTS_V1.artifacts.find(
      (artifact) => artifact.carrier === "firefox",
    )!.sha256;
  if (
    chromium.sha256 !== canonicalChromiumSha ||
    firefox.sha256 !== canonicalFirefoxSha
  )
    throw new Error("MULTIBROWSER_CANONICAL_PACKAGE_DIGEST_MISMATCH");
  const profiles = BROWSER_SPECS.map(profileTarget);
  assertMultibrowserProfileTargets(profiles);

  return {
    schemaVersion: "store_multibrowser_successor_preflight_v1",
    evidenceLevel: MULTIBROWSER_EVIDENCE_LEVEL,
    readOnly: true,
    catalogMutationAuthorized: false,
    packageBuildAuthorized: false,
    livePublicationAuthorized: false,
    source: {
      head: manifest.source!.head as string,
      tree: manifest.source!.tree as string,
    },
    currentImmutableVersion: MULTIBROWSER_CURRENT_VERSION,
    productVersion: MULTIBROWSER_SUCCESSOR_VERSION,
    contractVersion:
      STORE_0_2_13_RELEASE_CANONICAL_INPUTS_V1.release.contractVersion,
    migrationLevel: manifest.migrationLevel,
    release: {
      releaseChannel:
        STORE_0_2_13_RELEASE_CANONICAL_INPUTS_V1.release.releaseChannel,
      supportedContracts: [
        STORE_0_2_13_RELEASE_CANONICAL_INPUTS_V1.release.contractVersion,
      ],
      supportedBrowsers: [
        ...STORE_0_2_13_RELEASE_CANONICAL_INPUTS_V1.release.supportedBrowsers,
      ],
      browserArtifacts:
        STORE_0_2_13_RELEASE_CANONICAL_INPUTS_V1.artifacts.flatMap((artifact) =>
          artifact.browserFamilies.map((browserFamily) => ({
            browserFamily,
            artifactSha256: artifact.sha256,
          })),
        ),
    },
    packages: { chromium, firefox },
    profiles,
  };
}
