import { describe, expect, it, vi } from "vitest";
import {
  BlockedExtensionVersionSchema,
  ExtensionReleaseSchema,
  ReleaseBrowserSupportSchema,
  ReleaseContractSupportSchema,
  resolveCompatibility,
  type CompatibilityResolverInput,
} from "./index.js";
import {
  resolveP3BootstrapPolicy,
  type P3BootstrapPolicyCatalog,
} from "../../remote-config/src/index.js";

const releaseId = "22222222-2222-4222-8222-222222222222";
const policyId = "11111111-1111-4111-8111-111111111111";
const foreignId = "33333333-3333-4333-8333-333333333333";
const now = new Date("2026-10-23T00:00:00.000Z");

function input(): CompatibilityResolverInput {
  return {
    contractVersion: "control_plane_v2",
    extensionVersion: "0.2.37",
    browserFamily: "chrome",
    browserVersion: "151",
    release: {
      id: releaseId,
      version: "0.2.37",
      releaseChannel: "beta",
      artifactSha256: "a".repeat(64),
      releasedAt: now,
      createdAt: now,
    },
    releaseContracts: [{ releaseId, contractVersion: "control_plane_v2" }],
    releaseBrowsers: [{ releaseId, browserFamily: "chrome" }],
    policies: [
      {
        id: policyId,
        policyKey: "chrome",
        revision: 1,
        contractVersion: "control_plane_v2",
        browserFamily: "chrome",
        minimumExtensionVersion: "0.2.37",
        recommendedExtensionVersion: null,
        minimumBrowserVersion: "147",
        maintenanceMode: false,
        maintenanceCode: null,
        publishedAt: now,
        createdAt: now,
      },
    ],
    blockedVersions: new Map(),
  };
}

function foreignRow(
  value: CompatibilityResolverInput,
  kind: "contract" | "browser",
) {
  if (kind === "contract") {
    value.releaseContracts[0]!.releaseId = foreignId;
    expect(
      ReleaseContractSupportSchema.safeParse(value.releaseContracts[0]).success,
    ).toBe(true);
  } else {
    value.releaseBrowsers[0]!.releaseId = foreignId;
    expect(
      ReleaseBrowserSupportSchema.safeParse(value.releaseBrowsers[0]).success,
    ).toBe(true);
  }
}

function catalog(value: CompatibilityResolverInput): P3BootstrapPolicyCatalog {
  const config = {
    configVersion: 1,
    contractVersion: "control_plane_v2" as const,
    snapshotVersion: "bootstrap_snapshot_v2" as const,
    envelopeVersion: "bootstrap_envelope_v2" as const,
    contentHashSha256: "a".repeat(64),
    sourceFingerprintSha256: "b".repeat(64),
    signingKeyId: "synthetic",
    publishedAt: now,
    createdAt: now,
  };
  return {
    findLatestConfigRelease: async () => config,
    findConfigRelease: async () => config,
    findExtensionRelease: async () => value.release,
    listReleaseContracts: async () => value.releaseContracts,
    listReleaseBrowsers: async () => value.releaseBrowsers,
    listCompatibilityPolicyRevisions: async () => value.policies,
    listConfigCompatibilityPolicyRevisions: async () => value.policies,
    listBlockedVersions: async (id) => [
      ...(value.blockedVersions.get(id) ?? []),
    ],
    listLatestExtensionReleaseSupports: async () => [],
    findRolloutByKey: async () => undefined,
    findRolloutById: async () => undefined,
    findLatestRolloutRevision: async () => undefined,
    findFeatureDefinition: async () => undefined,
    findFeatureRuleRevision: async () => undefined,
    findSigningKey: async () => undefined,
    listSigningKeyEvents: async () => [],
    listConfigReleaseCompatibilityPolicies: async () => [],
    listConfigFeatureRules: async () => [],
    listConfigFeatureRolloutRevisions: async () => [],
  };
}

async function bootstrap(
  value: CompatibilityResolverInput,
  source: P3BootstrapPolicyCatalog = catalog(value),
) {
  return resolveP3BootstrapPolicy(
    {
      contractVersion: value.contractVersion,
      extensionVersion: value.extensionVersion,
      browser: { family: value.browserFamily, version: value.browserVersion },
      accountId: "synthetic-account",
      deviceId: "synthetic-device",
    },
    source,
  );
}

describe("compatibility catalog relational identity", () => {
  it("preserves a valid supported release", () => {
    expect(resolveCompatibility(input())).toEqual({
      extension: "SUPPORTED",
      browser: "SUPPORTED",
      minimumVersion: "0.2.37",
    });
  });

  it.each(["contract", "browser"] as const)(
    "rejects well-formed foreign %s support",
    (kind) => {
      const value = input();
      foreignRow(value, kind);
      expect(resolveCompatibility(value)).toBeUndefined();
    },
  );

  it.each(["contract", "browser"] as const)(
    "does not hide a foreign %s row behind a valid match",
    (kind) => {
      const value = input();
      if (kind === "contract")
        value.releaseContracts.push({
          releaseId: foreignId,
          contractVersion: "control_plane_v1",
        });
      else
        value.releaseBrowsers.push({
          releaseId: foreignId,
          browserFamily: "firefox",
        });
      expect(resolveCompatibility(value)).toBeUndefined();
    },
  );

  it.each(["contract", "browser"] as const)(
    "rejects dangling %s support when release is absent",
    (kind) => {
      const value = input();
      value.release = undefined;
      if (kind === "contract") value.releaseBrowsers = [];
      else value.releaseContracts = [];
      expect(resolveCompatibility(value)).toBeUndefined();
    },
  );

  it("keeps ordinary missing-release and missing-support outcomes", () => {
    const absent = input();
    absent.release = undefined;
    absent.releaseContracts = [];
    absent.releaseBrowsers = [];
    expect(resolveCompatibility(absent)).toMatchObject({
      extension: "UPDATE_REQUIRED",
      browser: "UNSUPPORTED_BROWSER",
    });
    const unsupported = input();
    unsupported.releaseContracts = [];
    unsupported.releaseBrowsers = [];
    expect(resolveCompatibility(unsupported)).toMatchObject({
      extension: "UPDATE_REQUIRED",
      browser: "UNSUPPORTED_BROWSER",
    });
  });

  it("preserves multiple properly linked contracts and browsers", () => {
    const value = input();
    value.releaseContracts.push({
      releaseId,
      contractVersion: "control_plane_v1",
    });
    value.releaseBrowsers.push({ releaseId, browserFamily: "firefox" });
    expect(resolveCompatibility(value)).toMatchObject({
      extension: "SUPPORTED",
      browser: "SUPPORTED",
    });
  });

  it.each(["0.2.37", "0.2.1"])(
    "rejects a foreign-policy block for %s",
    (version) => {
      const value = input();
      const row = { policyRevisionId: foreignId, extensionVersion: version };
      expect(BlockedExtensionVersionSchema.safeParse(row).success).toBe(true);
      value.blockedVersions = new Map([[policyId, [row]]]);
      expect(resolveCompatibility(value)).toBeUndefined();
    },
  );

  it("keeps a valid blocked version denied", () => {
    const value = input();
    value.blockedVersions = new Map([
      [
        policyId,
        [
          {
            policyRevisionId: policyId,
            extensionVersion: value.extensionVersion,
          },
        ],
      ],
    ]);
    expect(resolveCompatibility(value)).toMatchObject({
      extension: "UPDATE_REQUIRED",
    });
  });

  it("checks global policy linkage as well as browser policy linkage", () => {
    const value = input();
    value.policies[0]!.browserFamily = null;
    value.policies[0]!.minimumBrowserVersion = null;
    value.blockedVersions = new Map([
      [policyId, [{ policyRevisionId: foreignId, extensionVersion: "0.2.1" }]],
    ]);
    expect(resolveCompatibility(value)).toBeUndefined();
  });

  it("does not consume unrelated blocked-policy map entries", () => {
    const value = input();
    value.blockedVersions = new Map([
      [
        foreignId,
        [
          {
            policyRevisionId: releaseId,
            extensionVersion: value.extensionVersion,
          },
        ],
      ],
    ]);
    expect(resolveCompatibility(value)).toMatchObject({
      extension: "SUPPORTED",
      browser: "SUPPORTED",
    });
  });

  it("does not replace the intentional forward-compatible version rule", () => {
    const value = input();
    value.extensionVersion = "0.2.38";
    expect(resolveCompatibility(value)).toMatchObject({
      extension: "SUPPORTED",
    });
  });
});

describe("real bootstrap-policy consumer rejects foreign catalog links", () => {
  it.each([
    ["0.2.37", "0.2.36"],
    ["0.2.37", "0.2.38"],
    ["0.2.37+one", "0.2.37+two"],
    ["0.2.37-rc.1", "0.2.37"],
  ])(
    "rejects catalog release identity mismatch: requested %s, returned %s",
    async (requestedVersion, returnedVersion) => {
      const value = input();
      value.extensionVersion = requestedVersion;
      value.release!.version = returnedVersion;
      expect(ExtensionReleaseSchema.safeParse(value.release).success).toBe(
        true,
      );
      const source = catalog(value);
      const lookup = vi.spyOn(source, "findExtensionRelease");
      const contracts = vi.spyOn(source, "listReleaseContracts");
      const browsers = vi.spyOn(source, "listReleaseBrowsers");
      expect(await bootstrap(value, source)).toEqual({
        failure: "COMPATIBILITY_SOURCE_INVALID",
      });
      expect(lookup).toHaveBeenCalledWith(requestedVersion);
      expect(contracts).not.toHaveBeenCalled();
      expect(browsers).not.toHaveBeenCalled();
    },
  );

  it.each(["0.2.37", "0.2.38", "0.2.37+one", "0.2.38-rc.1"])(
    "preserves catalog release identity for matching version %s",
    async (version) => {
      const value = input();
      value.extensionVersion = version;
      value.release!.version = version;
      expect(await bootstrap(value)).toMatchObject({
        compatibility: {
          extension: { status: "SUPPORTED" },
          browser: { status: "SUPPORTED" },
        },
      });
    },
  );

  it.each(["contract", "browser"] as const)(
    "returns source-invalid for foreign %s support",
    async (kind) => {
      const value = input();
      foreignRow(value, kind);
      expect(await bootstrap(value)).toEqual({
        failure: "COMPATIBILITY_SOURCE_INVALID",
      });
    },
  );

  it("returns source-invalid for a foreign-policy blocked row", async () => {
    const value = input();
    value.blockedVersions = new Map([
      [policyId, [{ policyRevisionId: foreignId, extensionVersion: "0.2.1" }]],
    ]);
    expect(await bootstrap(value)).toEqual({
      failure: "COMPATIBILITY_SOURCE_INVALID",
    });
  });

  it("retains a valid snapshot policy and ordinary unsupported release", async () => {
    const value = input();
    expect(await bootstrap(value)).toMatchObject({
      configVersion: 1,
      compatibility: {
        extension: { status: "SUPPORTED" },
        browser: { status: "SUPPORTED" },
      },
    });
    value.release = undefined;
    value.releaseContracts = [];
    value.releaseBrowsers = [];
    expect(await bootstrap(value)).toMatchObject({
      configVersion: 1,
      compatibility: {
        extension: { status: "UPDATE_REQUIRED" },
        browser: { status: "UNSUPPORTED_BROWSER" },
      },
    });
  });
});
