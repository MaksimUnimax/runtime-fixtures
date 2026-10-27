import { describe, expect, it, vi } from "vitest";
import {
  ConfigReleaseSchema,
  P3FeatureRuleSchema,
  P3RolloutRevisionSchema,
  P3RolloutSchema,
  resolveP3BootstrapPolicy,
  type ConfigRelease,
  type P3BootstrapPolicyCatalog,
  type P3FeatureRule,
  type P3Rollout,
  type P3RolloutRevision,
} from "./index.js";

const ids = {
  rollout: "11111111-1111-4111-8111-111111111111",
  revision: "22222222-2222-4222-8222-222222222222",
  baseline: "33333333-3333-4333-8333-333333333333",
  candidate: "44444444-4444-4444-8444-444444444444",
  other: "99999999-9999-4999-8999-999999999999",
};
const contracts = ["control_plane_v1", "control_plane_v2"] as const;

function fixture(
  contractVersion: ConfigRelease["contractVersion"],
  state: P3RolloutRevision["state"] = "ACTIVE",
  percentageBps = 10000,
) {
  const config = ConfigReleaseSchema.parse({
    configVersion: 7,
    contractVersion,
    snapshotVersion:
      contractVersion === "control_plane_v1"
        ? "bootstrap_snapshot_v1"
        : "bootstrap_snapshot_v2",
    envelopeVersion:
      contractVersion === "control_plane_v1"
        ? "bootstrap_envelope_v1"
        : "bootstrap_envelope_v2",
    contentHashSha256: "a".repeat(64),
    sourceFingerprintSha256: "b".repeat(64),
    signingKeyId: "fixture-key",
    publishedAt: new Date("2026-10-24T00:00:00Z"),
    createdAt: new Date("2026-10-24T00:00:00Z"),
  });
  const baseline = P3FeatureRuleSchema.parse({
    id: ids.baseline,
    featureKey: "feature.fixture",
    revision: 1,
    contractVersion,
    enabled: false,
    browserFamily: null,
    minimumExtensionVersion: null,
  });
  const candidate = P3FeatureRuleSchema.parse({
    ...baseline,
    id: ids.candidate,
    revision: 2,
    enabled: true,
  });
  const rollout = P3RolloutSchema.parse({
    id: ids.rollout,
    rolloutKey: "feature.fixture.rollout",
    targetKind: "FEATURE_RULE",
    subjectKind: "ACCOUNT",
    cohortSeed: Buffer.alloc(32, 7),
  });
  const revision = P3RolloutRevisionSchema.parse({
    id: ids.revision,
    rolloutId: rollout.id,
    targetKind: "FEATURE_RULE",
    revision: 1,
    state,
    percentageBps,
    baselineConfigVersion: null,
    candidateConfigVersion: null,
    baselineFeatureRuleRevisionId: baseline.id,
    candidateFeatureRuleRevisionId: candidate.id,
  });
  const rules = new Map<string, P3FeatureRule>([
    [baseline.id, baseline],
    [candidate.id, candidate],
  ]);
  const rollouts = new Map<string, P3Rollout>([[rollout.id, rollout]]);
  const catalog = {
    findRolloutByKey: async () => undefined,
    findLatestRolloutRevision: async () => undefined,
    findConfigRelease: async () => undefined,
    findLatestConfigRelease: vi.fn(async () => config),
    listConfigCompatibilityPolicyRevisions: async () => [],
    listConfigFeatureRules: vi.fn(async () => [baseline]),
    listConfigFeatureRolloutRevisions: vi.fn(async () => [revision]),
    findExtensionRelease: async () => undefined,
    listReleaseContracts: async () => [],
    listReleaseBrowsers: async () => [],
    listBlockedVersions: async () => [],
    listCompatibilityPolicyRevisions: async () => [],
    listLatestExtensionReleaseSupports: async () => [],
    findRolloutById: vi.fn(async (id: string) => rollouts.get(id)),
    findFeatureRuleRevision: vi.fn(async (id: string) => rules.get(id)),
    findFeatureDefinition: async () => undefined,
    findSigningKey: async () => undefined,
    listSigningKeyEvents: async () => [],
    listConfigReleaseCompatibilityPolicies: async () => [],
  } satisfies P3BootstrapPolicyCatalog;
  const input = {
    contractVersion,
    extensionVersion: "1.2.3",
    browser: { family: "chrome" as const, version: "120" },
    accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    deviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  };
  return {
    catalog,
    input,
    baseline,
    candidate,
    rollout,
    revision,
    rules,
    rollouts,
  };
}

const duplicateKinds = [
  "same-revision",
  "same-rollout-revisions",
  "different-rollouts-conflicting",
  "different-rollouts-agreeing",
] as const;

function duplicateFeature(
  f: ReturnType<typeof fixture>,
  kind: (typeof duplicateKinds)[number],
) {
  if (kind === "same-revision") return [f.revision, f.revision];
  const second = P3RolloutRevisionSchema.parse({
    ...f.revision,
    id: "55555555-5555-4555-8555-555555555555",
    revision: 2,
    percentageBps: kind === "different-rollouts-agreeing" ? 10000 : 0,
  });
  if (kind.startsWith("different-rollouts")) {
    const other = P3RolloutSchema.parse({
      ...f.rollout,
      id: ids.other,
      rolloutKey: "feature.fixture.second-rollout",
    });
    f.rollouts.set(other.id, other);
    second.rolloutId = other.id;
  }
  return [f.revision, second];
}

for (const contract of contracts) {
  describe(`unambiguous feature rollout selection ${contract}`, () => {
    for (const reverse of [false, true]) {
      it.each(duplicateKinds)(
        `rejects %s regardless of catalog order (reverse=${reverse})`,
        async (kind) => {
          const f = fixture(contract);
          const revisions = duplicateFeature(f, kind);
          f.catalog.listConfigFeatureRolloutRevisions.mockResolvedValue(
            reverse ? [...revisions].reverse() : revisions,
          );
          expect(await resolveP3BootstrapPolicy(f.input, f.catalog)).toEqual({
            failure: "FEATURE_SOURCE_INVALID",
          });
        },
      );

      it(`preserves distinct feature rollouts (reverse=${reverse})`, async () => {
        const f = fixture(contract);
        const baseline = P3FeatureRuleSchema.parse({
          ...f.baseline,
          id: "55555555-5555-4555-8555-555555555555",
          featureKey: "feature.independent",
          enabled: true,
        });
        const candidate = P3FeatureRuleSchema.parse({
          ...baseline,
          id: "66666666-6666-4666-8666-666666666666",
          revision: 2,
          enabled: false,
        });
        const rollout = P3RolloutSchema.parse({
          ...f.rollout,
          id: "77777777-7777-4777-8777-777777777777",
          rolloutKey: "feature.independent.rollout",
        });
        const revision = P3RolloutRevisionSchema.parse({
          ...f.revision,
          id: "88888888-8888-4888-8888-888888888888",
          rolloutId: rollout.id,
          baselineFeatureRuleRevisionId: baseline.id,
          candidateFeatureRuleRevisionId: candidate.id,
        });
        f.rules.set(baseline.id, baseline);
        f.rules.set(candidate.id, candidate);
        f.rollouts.set(rollout.id, rollout);
        f.catalog.listConfigFeatureRules.mockResolvedValue([
          f.baseline,
          baseline,
        ]);
        const revisions = [f.revision, revision];
        f.catalog.listConfigFeatureRolloutRevisions.mockResolvedValue(
          reverse ? [...revisions].reverse() : revisions,
        );
        expect(
          await resolveP3BootstrapPolicy(f.input, f.catalog),
        ).toMatchObject({
          features: { "feature.fixture": true, "feature.independent": false },
        });
      });
    }

    it("keeps the direct rule when no rollout is linked", async () => {
      const f = fixture(contract);
      f.catalog.listConfigFeatureRolloutRevisions.mockResolvedValue([]);
      expect(await resolveP3BootstrapPolicy(f.input, f.catalog)).toMatchObject({
        features: { "feature.fixture": false },
      });
    });

    it.each([
      ["ACTIVE", 0, false],
      ["ACTIVE", 10000, true],
      ["PAUSED", 10000, false],
      ["RETIRED", 10000, false],
    ] as const)(
      "preserves one valid rollout %s/%i with feature=%s",
      async (state, bps, enabled) => {
        const f = fixture(contract, state, bps);
        expect(
          await resolveP3BootstrapPolicy(f.input, f.catalog),
        ).toMatchObject({
          features: { "feature.fixture": enabled },
        });
      },
    );
  });
}
