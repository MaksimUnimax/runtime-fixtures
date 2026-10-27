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
    findRolloutById: vi.fn(async (): Promise<P3Rollout | undefined> => rollout),
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
  return { catalog, input, baseline, candidate, rollout, revision, rules };
}

const corruptions = [
  "rollout-id",
  "baseline-id",
  "candidate-id",
  "baseline-contract",
  "candidate-contract",
] as const;

function corrupt(
  f: ReturnType<typeof fixture>,
  kind: (typeof corruptions)[number],
) {
  const foreignContract =
    f.input.contractVersion === "control_plane_v1"
      ? "control_plane_v2"
      : "control_plane_v1";
  switch (kind) {
    case "rollout-id":
      f.catalog.findRolloutById.mockResolvedValue({
        ...f.rollout,
        id: ids.other,
      });
      break;
    case "baseline-id":
      // The lookup returns an actually linked rule, but not the pinned ID.
      f.revision.baselineFeatureRuleRevisionId = ids.other;
      f.rules.set(ids.other, f.baseline);
      break;
    case "candidate-id":
      f.rules.set(ids.candidate, { ...f.candidate, id: ids.other });
      break;
    case "baseline-contract":
      f.rules.set(ids.baseline, {
        ...f.baseline,
        contractVersion: foreignContract,
      });
      break;
    case "candidate-contract":
      f.rules.set(ids.candidate, {
        ...f.candidate,
        contractVersion: foreignContract,
      });
      break;
  }
}

for (const contract of contracts) {
  describe(`pinned feature rollout identity ${contract}`, () => {
    for (const bps of [0, 10000]) {
      it.each(corruptions)(
        `rejects wrong %s with ${bps} bps before returning feature policy`,
        async (kind) => {
          const f = fixture(contract, "ACTIVE", bps);
          corrupt(f, kind);
          expect(await resolveP3BootstrapPolicy(f.input, f.catalog)).toEqual({
            failure: "FEATURE_SOURCE_INVALID",
          });
          expect(f.catalog.findRolloutById).toHaveBeenCalledExactlyOnceWith(
            f.revision.rolloutId,
          );
          expect(f.catalog.findFeatureRuleRevision.mock.calls).toEqual([
            [f.revision.baselineFeatureRuleRevisionId],
            [f.revision.candidateFeatureRuleRevisionId],
          ]);
        },
      );
    }

    it.each([
      ["ACTIVE", 0, false],
      ["ACTIVE", 10000, true],
      ["PAUSED", 10000, false],
      ["RETIRED", 10000, false],
    ] as const)(
      "preserves valid selection %s/%i with feature=%s",
      async (state, bps, enabled) => {
        const f = fixture(contract, state, bps);
        expect(
          await resolveP3BootstrapPolicy(f.input, f.catalog),
        ).toMatchObject({
          configVersion: 7,
          features: { "feature.fixture": enabled },
        });
      },
    );

    it.each(["browser", "minimum-version"] as const)(
      "retains the selected rule's %s restriction",
      async (restriction) => {
        const f = fixture(contract);
        f.rules.set(ids.candidate, {
          ...f.candidate,
          ...(restriction === "browser"
            ? { browserFamily: "firefox" as const }
            : { minimumExtensionVersion: "2.0.0" }),
        });
        expect(
          await resolveP3BootstrapPolicy(f.input, f.catalog),
        ).toMatchObject({
          features: { "feature.fixture": false },
        });
      },
    );

    it.each([
      "missing-rule",
      "different-feature",
      "unlinked-baseline",
    ] as const)("retains existing rejection of %s", async (kind) => {
      const f = fixture(contract);
      if (kind === "missing-rule") f.rules.delete(ids.candidate);
      else if (kind === "different-feature")
        f.rules.set(ids.candidate, {
          ...f.candidate,
          featureKey: "feature.unrelated",
        });
      else f.catalog.listConfigFeatureRules.mockResolvedValue([]);
      expect(await resolveP3BootstrapPolicy(f.input, f.catalog)).toEqual({
        failure: "FEATURE_SOURCE_INVALID",
      });
    });
  });
}
