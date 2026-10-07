import { BETA_CHATGPT_STANDARD_OPERA_INPUT_V1 } from "../../packages/server/adapter-registry/src/beta-canonical-inputs.js";
import { BETA_CHROME_POLICY_CANONICAL_INPUTS_V1 } from "../../packages/server/compatibility/src/beta-chrome-policy-canonical-inputs.js";
import { STORE_0_2_13_REPAIRED_CHROME_RELEASE_CANONICAL_INPUTS_V1 } from "../../packages/server/compatibility/src/beta-release-canonical-inputs.js";
import { readStore0213RepairedChromeCanonicalTarget } from "./store-multibrowser-successor-preflight.js";
import {
  analyzeStoreReleaseTransition,
  type StoreReleaseTransitionCatalog,
  type StoreReleaseTransitionReport,
  type StoreReleaseTransitionTarget,
} from "./store-release-transition-preflight.js";

export const CHROME_0213_MIGRATION_LEVEL = 58 as const;

export type Chrome0213TransitionTarget = StoreReleaseTransitionTarget<
  "chrome",
  "147",
  "store1.chrome.v2",
  string
> & {
  productVersion: "0.2.13";
  contractVersion: "control_plane_v2";
  migrationLevel: typeof CHROME_0213_MIGRATION_LEVEL;
};

export function readChrome0213TransitionTarget(): Chrome0213TransitionTarget {
  const repaired = readStore0213RepairedChromeCanonicalTarget();
  const release = STORE_0_2_13_REPAIRED_CHROME_RELEASE_CANONICAL_INPUTS_V1;
  const policy = BETA_CHROME_POLICY_CANONICAL_INPUTS_V1;
  const chromeArtifact = release.browserArtifacts.find(
    (item) => item.browserFamily === "chrome",
  );

  if (
    !chromeArtifact ||
    chromeArtifact.artifactSha256 !== repaired.chromeRepairArtifact.sha256 ||
    chromeArtifact.artifactSha256 !== policy.scope.exactChromeArtifactSha256 ||
    repaired.chromeProfile.browserFamily !== "chrome" ||
    repaired.chromeProfile.approvedMinimumBrowserVersion !==
      policy.policy.minimumBrowserVersion ||
    repaired.chromeProfile.browserMinimumDecisionRequired
  )
    throw new Error("CHROME0213_TRANSITION_CANONICAL_IDENTITY_INVALID");

  return {
    source: { ...release.source },
    productVersion: release.release.productVersion,
    contractVersion: release.release.contractVersion,
    migrationLevel: CHROME_0213_MIGRATION_LEVEL,
    artifactSha256: chromeArtifact.artifactSha256,
    packageFilename: release.chromeRepairArtifact.filename,
    packageBytes: release.chromeRepairArtifact.bytes,
    browserFamily: policy.policy.browserFamily,
    minimumBrowserVersion: policy.policy.minimumBrowserVersion,
    policyKey: policy.policy.policyKey,
    adapterKey: BETA_CHATGPT_STANDARD_OPERA_INPUT_V1.adapter.machineKey,
    surfaceKey: BETA_CHATGPT_STANDARD_OPERA_INPUT_V1.surface.machineKey,
    profileKey: repaired.chromeProfile.profileKey,
    profileContentSha256: repaired.chromeProfile.profileContentSha256,
  };
}

export function analyzeChrome0213Transition(
  catalog: StoreReleaseTransitionCatalog,
): StoreReleaseTransitionReport<Chrome0213TransitionTarget> {
  return analyzeStoreReleaseTransition(
    readChrome0213TransitionTarget(),
    catalog,
  );
}
