import {
  BootstrapDetectedAiV1Schema,
  type BootstrapDetectedAiV1,
} from "@product/contracts";
import type { BrowserFamily } from "@product/shared";
import { BrowserFamilies } from "@product/shared";
import type {
  P3BootstrapPolicyCatalog,
  P3FeatureRule,
} from "@product/remote-config";
import { selectRolloutCandidateV1 } from "@product/remote-config";
import {
  compareBrowserVersionV1,
  type ContractVersion,
  type CompatibilityPolicyRevision,
} from "@product/compatibility";
import { compareSemVerV1 } from "@product/shared";
import {
  BootstrapAiResolutionService,
  type BootstrapAiResolutionV1,
} from "./ai-resolution.js";

export type LocalClientAuthority = {
  schemaVersion: "local_client_authority_v1";
  contractVersion: "control_plane_v2";
  compatibility: {
    releases: Array<{
      extensionVersion: string;
      contractVersions: ContractVersion[];
      browserFamilies: BrowserFamily[];
    }>;
    policies: Array<{
      policyKey: string;
      revision: number;
      contractVersion: "control_plane_v2";
      browserFamily: BrowserFamily | null;
      minimumExtensionVersion: string | null;
      recommendedExtensionVersion: string | null;
      minimumBrowserVersion: string | null;
      maintenanceMode: boolean;
      maintenanceCode: string | null;
      blockedVersions: string[];
    }>;
  };
  featureRules: Array<{
    featureKey: string;
    revision: number;
    contractVersion: "control_plane_v2";
    enabled: boolean;
    browserFamily: BrowserFamily | null;
    minimumExtensionVersion: string | null;
  }>;
  ai:
    | { status: "UNCONFIGURED" }
    | {
        status: "CANDIDATES";
        detected: BootstrapDetectedAiV1;
        candidates: Array<{
          browserFamily: BrowserFamily;
          resolution: LocalAiCandidateResolution;
        }>;
      };
};

type LocalAiCandidateResolution =
  | {
      status: "UNAVAILABLE";
      reason: Extract<
        BootstrapAiResolutionV1,
        { status: "UNAVAILABLE" }
      >["reason"];
    }
  | {
      status: "RESOLVED";
      profile: Extract<
        BootstrapAiResolutionV1,
        { status: "RESOLVED" }
      >["profile"];
    };

export type MaterializeLocalClientAuthorityInput = {
  contractVersion: "control_plane_v2";
  accountId: string;
  deviceId: string;
  detectedAi?: BootstrapDetectedAiV1;
};

export type LocalClientAuthorityResult =
  | {
      configVersion: number;
      signingKeyId: string;
      sourceFingerprintSha256: string;
      localClientAuthority: LocalClientAuthority;
    }
  | {
      failure:
        | "INVALID_INPUT"
        | "NO_CONFIG_RELEASE"
        | "CONFIG_SOURCE_INVALID"
        | "LOCAL_AUTHORITY_SOURCE_INVALID";
    };

function invalidPolicy(policy: CompatibilityPolicyRevision): boolean {
  return (
    policy.contractVersion !== "control_plane_v2" ||
    policy.maintenanceMode !== (policy.maintenanceCode !== null) ||
    (policy.browserFamily === null && policy.minimumBrowserVersion !== null) ||
    (!!policy.minimumExtensionVersion &&
      !!policy.recommendedExtensionVersion &&
      compareSemVerV1(
        policy.recommendedExtensionVersion,
        policy.minimumExtensionVersion,
      ) < 0) ||
    (!!policy.minimumBrowserVersion &&
      compareBrowserVersionV1(
        policy.minimumBrowserVersion,
        policy.minimumBrowserVersion,
      ) === undefined)
  );
}

function selectFeatureRules(
  rules: P3FeatureRule[],
  linkedRollouts: Awaited<
    ReturnType<P3BootstrapPolicyCatalog["listConfigFeatureRolloutRevisions"]>
  >,
  catalog: P3BootstrapPolicyCatalog,
  accountId: string,
  deviceId: string,
): Promise<LocalClientAuthority["featureRules"]> {
  return (async () => {
    if (rules.length > 128) throw new Error("feature limit");
    const selected = new Map<string, P3FeatureRule>();
    for (const rule of rules) {
      if (
        rule.contractVersion !== "control_plane_v2" ||
        selected.has(rule.featureKey)
      )
        throw new Error("invalid feature source");
      selected.set(rule.featureKey, rule);
    }
    const rolloutFeatures = new Set<string>();
    for (const revision of linkedRollouts) {
      if (
        revision.targetKind !== "FEATURE_RULE" ||
        revision.baselineFeatureRuleRevisionId === null ||
        revision.candidateFeatureRuleRevisionId === null
      )
        throw new Error("invalid feature rollout");
      const [rollout, baseline, candidate] = await Promise.all([
        catalog.findRolloutById(revision.rolloutId),
        catalog.findFeatureRuleRevision(revision.baselineFeatureRuleRevisionId),
        catalog.findFeatureRuleRevision(
          revision.candidateFeatureRuleRevisionId,
        ),
      ]);
      if (
        !rollout ||
        rollout.id !== revision.rolloutId ||
        rollout.targetKind !== "FEATURE_RULE" ||
        rollout.cohortSeed.length !== 32 ||
        !baseline ||
        !candidate ||
        baseline.featureKey !== candidate.featureKey ||
        baseline.contractVersion !== "control_plane_v2" ||
        candidate.contractVersion !== "control_plane_v2" ||
        !rules.some((rule) => rule.id === baseline.id) ||
        rolloutFeatures.has(baseline.featureKey)
      )
        throw new Error("invalid feature rollout source");
      rolloutFeatures.add(baseline.featureKey);
      const subjectId =
        rollout.subjectKind === "ACCOUNT" ? accountId : deviceId;
      selected.set(
        baseline.featureKey,
        selectRolloutCandidateV1({
          state: revision.state === "RETIRED" ? "PAUSED" : revision.state,
          percentageBps: revision.percentageBps,
          rolloutKey: rollout.rolloutKey,
          cohortSeed: rollout.cohortSeed,
          subjectKind: rollout.subjectKind,
          subjectId,
        })
          ? candidate
          : baseline,
      );
    }
    return [...selected.values()].map(
      ({
        featureKey,
        revision,
        enabled,
        browserFamily,
        minimumExtensionVersion,
      }) => ({
        featureKey,
        revision,
        contractVersion: "control_plane_v2" as const,
        enabled,
        browserFamily,
        minimumExtensionVersion,
      }),
    );
  })();
}

export class LocalClientAuthorityMaterializer {
  constructor(
    private readonly catalog: P3BootstrapPolicyCatalog,
    private readonly aiResolution: BootstrapAiResolutionService,
  ) {}

  async materialize(
    input: MaterializeLocalClientAuthorityInput,
  ): Promise<LocalClientAuthorityResult> {
    if (
      input === null ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).some(
        (key) =>
          !["contractVersion", "accountId", "deviceId", "detectedAi"].includes(
            key,
          ),
      ) ||
      input.contractVersion !== "control_plane_v2" ||
      typeof input.accountId !== "string" ||
      input.accountId.length === 0 ||
      typeof input.deviceId !== "string" ||
      input.deviceId.length === 0 ||
      (input.detectedAi !== undefined &&
        !BootstrapDetectedAiV1Schema.safeParse(input.detectedAi).success)
    )
      return { failure: "INVALID_INPUT" };
    try {
      // V2's accepted authority is the ordinary latest release in its own stream.
      const config =
        await this.catalog.findLatestConfigRelease("control_plane_v2");
      if (!config) return { failure: "NO_CONFIG_RELEASE" };
      if (
        config.contractVersion !== "control_plane_v2" ||
        config.snapshotVersion !== "bootstrap_snapshot_v2" ||
        config.envelopeVersion !== "bootstrap_envelope_v2"
      )
        return { failure: "CONFIG_SOURCE_INVALID" };

      const [releaseRows, policyRows, featureRows, rolloutRows] =
        await Promise.all([
          this.catalog.listLatestExtensionReleaseSupports(64),
          this.catalog.listConfigCompatibilityPolicyRevisions(
            config.configVersion,
          ),
          this.catalog.listConfigFeatureRules(config.configVersion),
          this.catalog.listConfigFeatureRolloutRevisions(config.configVersion),
        ]);
      const releaseIds = new Set<string>();
      const releaseVersions = new Set<string>();
      const releases = releaseRows.map((release) => {
        if (releaseIds.has(release.id) || releaseVersions.has(release.version))
          throw new Error("duplicate release");
        releaseIds.add(release.id);
        releaseVersions.add(release.version);
        const { contractVersions, browserFamilies } = release;
        if (
          !contractVersions.length ||
          !browserFamilies.length ||
          new Set(contractVersions).size !== contractVersions.length ||
          new Set(browserFamilies).size !== browserFamilies.length
        )
          throw new Error("duplicate release support");
        return {
          extensionVersion: release.version,
          contractVersions,
          browserFamilies,
        };
      });

      if (policyRows.length > 32) throw new Error("policy limit");
      const policyIds = new Set<string>();
      const policyIdentity = new Set<string>();
      const familyCounts = new Map<string, number>();
      const policies = await Promise.all(
        policyRows.map(async (policy) => {
          if (invalidPolicy(policy) || policyIds.has(policy.id))
            throw new Error("invalid policy");
          const identity = `${policy.policyKey}\0${policy.revision}\0${policy.browserFamily ?? "*"}`;
          if (policyIdentity.has(identity)) throw new Error("duplicate policy");
          policyIdentity.add(identity);
          policyIds.add(policy.id);
          const familyKey = policy.browserFamily ?? "*";
          familyCounts.set(familyKey, (familyCounts.get(familyKey) ?? 0) + 1);
          if (familyCounts.get(familyKey)! > 1)
            throw new Error("duplicate compatibility scope");
          const blockedRows = await this.catalog.listBlockedVersions(policy.id);
          const blockedVersions = blockedRows.map(
            (row) => row.extensionVersion,
          );
          if (
            blockedVersions.length > 128 ||
            new Set(blockedVersions).size !== blockedVersions.length
          )
            throw new Error("invalid blocked versions");
          return {
            policyKey: policy.policyKey,
            revision: policy.revision,
            contractVersion: "control_plane_v2" as const,
            browserFamily: policy.browserFamily,
            minimumExtensionVersion: policy.minimumExtensionVersion,
            recommendedExtensionVersion: policy.recommendedExtensionVersion,
            minimumBrowserVersion: policy.minimumBrowserVersion,
            maintenanceMode: policy.maintenanceMode,
            maintenanceCode: policy.maintenanceCode,
            blockedVersions,
          };
        }),
      );
      const featureRules = await selectFeatureRules(
        featureRows,
        rolloutRows,
        this.catalog,
        input.accountId,
        input.deviceId,
      );

      let ai: LocalClientAuthority["ai"] = { status: "UNCONFIGURED" };
      if (input.detectedAi) {
        const resolved = await this.aiResolution.resolveLocalCandidates({
          detected: input.detectedAi,
          contractVersion: "control_plane_v2",
          accountId: input.accountId,
          deviceId: input.deviceId,
        });
        ai = {
          status: "CANDIDATES",
          detected: input.detectedAi,
          candidates: resolved.map(({ browserFamily, resolution }) => {
            if (resolution.status === "UNAVAILABLE")
              return {
                browserFamily,
                resolution: {
                  status: "UNAVAILABLE",
                  reason: resolution.reason,
                },
              };
            if (resolution.status !== "RESOLVED")
              throw new Error("invalid AI candidate resolution");
            return {
              browserFamily,
              resolution: { status: "RESOLVED", profile: resolution.profile },
            };
          }),
        };
      }
      if (new Set(BrowserFamilies).size !== BrowserFamilies.length)
        throw new Error("invalid browser families");
      return {
        configVersion: config.configVersion,
        signingKeyId: config.signingKeyId,
        sourceFingerprintSha256: config.sourceFingerprintSha256,
        localClientAuthority: {
          schemaVersion: "local_client_authority_v1",
          contractVersion: "control_plane_v2",
          compatibility: { releases, policies },
          featureRules,
          ai,
        },
      };
    } catch {
      return { failure: "LOCAL_AUTHORITY_SOURCE_INVALID" };
    }
  }
}
