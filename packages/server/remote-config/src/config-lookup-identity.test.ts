import { describe, expect, it, vi } from "vitest";
import {
  ConfigReleaseSchema,
  P3RolloutRevisionSchema,
  P3RolloutSchema,
  listP3SelectableConfigReleases,
  resolveP3BootstrapPolicy,
  type ConfigRelease,
  type P3BootstrapPolicyCatalog,
  type P3Rollout,
  type P3RolloutRevision,
} from "./index.js";

const now = new Date("2026-10-23T00:00:00.000Z");
const rollout = P3RolloutSchema.parse({
  id: "11111111-1111-4111-8111-111111111111",
  rolloutKey: "bootstrap.config",
  targetKind: "CONFIG_RELEASE",
  subjectKind: "ACCOUNT",
  cohortSeed: Buffer.alloc(32, 7),
});

function config(
  configVersion: number,
  contractVersion: ConfigRelease["contractVersion"] = "control_plane_v1",
): ConfigRelease {
  return ConfigReleaseSchema.parse({
    configVersion,
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
    publishedAt: now,
    createdAt: now,
  });
}

function input(
  contractVersion: ConfigRelease["contractVersion"] = "control_plane_v1",
) {
  return {
    contractVersion,
    extensionVersion: "1.2.3",
    browser: { family: "chrome" as const, version: "120" },
    accountId: "synthetic-account",
    deviceId: "synthetic-device",
  };
}

function fixture(
  state: P3RolloutRevision["state"] = "ACTIVE",
  percentageBps = 0,
) {
  const revision = P3RolloutRevisionSchema.parse({
    id: "22222222-2222-4222-8222-222222222222",
    rolloutId: rollout.id,
    targetKind: "CONFIG_RELEASE",
    revision: 1,
    state,
    percentageBps,
    baselineConfigVersion: 7,
    candidateConfigVersion: 8,
    baselineFeatureRuleRevisionId: null,
    candidateFeatureRuleRevisionId: null,
  });
  const rows = new Map<number, ConfigRelease>([
    [7, config(7)],
    [8, config(8)],
  ]);
  const catalog = {
    findRolloutByKey: vi.fn(
      async (): Promise<P3Rollout | undefined> => rollout,
    ),
    findLatestRolloutRevision: vi.fn(async () => revision),
    findConfigRelease: vi.fn(async (version: number) => rows.get(version)),
    findLatestConfigRelease: vi.fn(
      async (contractVersion: ConfigRelease["contractVersion"]) =>
        config(
          contractVersion === "control_plane_v1" ? 9 : 22,
          contractVersion,
        ),
    ),
    listConfigCompatibilityPolicyRevisions: vi.fn(async () => []),
    listConfigFeatureRules: vi.fn(async () => []),
    listConfigFeatureRolloutRevisions: vi.fn(async () => []),
    findExtensionRelease: async () => undefined,
    listReleaseContracts: async () => [],
    listReleaseBrowsers: async () => [],
    listBlockedVersions: async () => [],
    listCompatibilityPolicyRevisions: async () => [],
    listLatestExtensionReleaseSupports: async () => [],
    findRolloutById: async () => undefined,
    findFeatureRuleRevision: async () => undefined,
    findFeatureDefinition: async () => undefined,
    findSigningKey: async () => undefined,
    listSigningKeyEvents: async () => [],
    listConfigReleaseCompatibilityPolicies: async () => [],
  } satisfies P3BootstrapPolicyCatalog;
  return { catalog, rows };
}

const selections = [
  ["ACTIVE", 0, 7],
  ["ACTIVE", 10000, 8],
  ["PAUSED", 10000, 7],
] as const;

describe("pinned config lookup identity", () => {
  it.each(selections)(
    "rejects wrong pinned config in %s at %i bps (selected %i)",
    async (state, bps, selected) => {
      const { catalog, rows } = fixture(state, bps);
      rows.set(selected, config(99));
      expect(await resolveP3BootstrapPolicy(input(), catalog)).toEqual({
        failure: "CONFIG_SOURCE_INVALID",
      });
      expect(catalog.findConfigRelease).toHaveBeenCalledExactlyOnceWith(
        selected,
      );
      expect(
        catalog.listConfigCompatibilityPolicyRevisions,
      ).not.toHaveBeenCalled();
      expect(catalog.listConfigFeatureRules).not.toHaveBeenCalled();
      expect(catalog.listConfigFeatureRolloutRevisions).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["ACTIVE", 7],
    ["ACTIVE", 8],
    ["PAUSED", 7],
    ["PAUSED", 8],
  ] as const)(
    "rejects wrong pinned config %s/%i when enumerating selectable releases",
    async (state, selected) => {
      const { catalog, rows } = fixture(state, 10000);
      rows.set(selected, config(99));
      await expect(listP3SelectableConfigReleases(catalog)).rejects.toThrow(
        "P3_ROLLOUT_SOURCE_INVALID",
      );
    },
  );

  it.each(selections)(
    "preserves exact config selection %s/%i/%i",
    async (state, bps, selected) => {
      const { catalog } = fixture(state, bps);
      expect(await resolveP3BootstrapPolicy(input(), catalog)).toMatchObject({
        configVersion: selected,
      });
      expect(
        (await listP3SelectableConfigReleases(catalog)).map(
          (release) => release.configVersion,
        ),
      ).toEqual(state === "PAUSED" ? [7] : [7, 8]);
    },
  );

  it.each(selections)(
    "keeps missing selected config distinct from wrong identity %s/%i/%i",
    async (state, bps, selected) => {
      const { catalog, rows } = fixture(state, bps);
      rows.delete(selected);
      expect(await resolveP3BootstrapPolicy(input(), catalog)).toEqual({
        failure: "NO_CONFIG_RELEASE",
      });
      await expect(listP3SelectableConfigReleases(catalog)).rejects.toThrow(
        "P3_ROLLOUT_SOURCE_INVALID",
      );
    },
  );

  it.each(["RETIRED", "ABSENT"] as const)(
    "retains ordinary latest selection for %s rollout",
    async (state) => {
      const { catalog, rows } = fixture("RETIRED");
      if (state === "ABSENT")
        catalog.findRolloutByKey.mockResolvedValue(undefined);
      rows.clear();
      expect(await resolveP3BootstrapPolicy(input(), catalog)).toMatchObject({
        configVersion: 9,
      });
      expect(
        (await listP3SelectableConfigReleases(catalog)).map(
          (release) => release.configVersion,
        ),
      ).toEqual([9]);
      expect(catalog.findConfigRelease).not.toHaveBeenCalled();
    },
  );

  it("keeps v2 ordinary-latest selection independent of v1 rollout", async () => {
    const { catalog, rows } = fixture();
    rows.clear();
    expect(
      await resolveP3BootstrapPolicy(input("control_plane_v2"), catalog),
    ).toMatchObject({ configVersion: 22 });
    expect(
      (await listP3SelectableConfigReleases(catalog, "control_plane_v2")).map(
        (release) => release.configVersion,
      ),
    ).toEqual([22]);
    expect(catalog.findConfigRelease).not.toHaveBeenCalled();
    expect(catalog.findRolloutByKey).not.toHaveBeenCalled();
  });

  it.each([
    [0, 7, 8],
    [10000, 8, 7],
  ])(
    "does not inspect the unselected config in the per-subject resolver %i/%i/%i",
    async (bps, selected, unselected) => {
      const { catalog, rows } = fixture("ACTIVE", bps);
      rows.set(unselected, config(99));
      expect(await resolveP3BootstrapPolicy(input(), catalog)).toMatchObject({
        configVersion: selected,
      });
      expect(catalog.findConfigRelease).toHaveBeenCalledExactlyOnceWith(
        selected,
      );
    },
  );

  it("retains rejection of an exact-number release with a wrong contract", async () => {
    const { catalog, rows } = fixture();
    rows.set(7, config(7, "control_plane_v2"));
    expect(await resolveP3BootstrapPolicy(input(), catalog)).toEqual({
      failure: "CONFIG_SOURCE_INVALID",
    });
  });
});
