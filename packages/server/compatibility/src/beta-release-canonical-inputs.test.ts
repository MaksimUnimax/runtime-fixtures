import { describe, expect, it } from "vitest";
import {
  BETA_RELEASE_CANONICAL_INPUTS_V1,
  BetaReleaseCanonicalInputsV1Schema,
  STORE_0_2_13_RELEASE_CANONICAL_INPUTS_V1,
  Store0213ReleaseCanonicalInputsV1Schema,
  PublishExtensionReleaseCommandSchema,
  ReleaseChannelSchema,
} from "./index.js";

describe("beta release canonical input contract", () => {
  it("binds the exact accepted 0.2.12 release identity and stable channel", () => {
    const parsed = BetaReleaseCanonicalInputsV1Schema.parse(
      BETA_RELEASE_CANONICAL_INPUTS_V1,
    );

    expect(parsed.release).toEqual({
      productVersion: "0.2.12",
      contractVersion: "control_plane_v2",
      releaseChannel: "stable",
      supportedBrowsers: ["chrome", "opera", "yandex_chromium", "firefox"],
    });
    expect(ReleaseChannelSchema.parse(parsed.release.releaseChannel)).toBe(
      "stable",
    );
    expect(parsed.channelAuthority).toEqual({
      selection: "EXPLICIT_VERSIONED_SOURCE_VALUE",
      freeBetaAdmissionIsReleaseChannel: false,
      derivedFromSemVerOrFilename: false,
    });
  });

  it("adds exact 0.2.13 authority without rewriting historical 0.2.12", () => {
    expect(BETA_RELEASE_CANONICAL_INPUTS_V1.release.productVersion).toBe(
      "0.2.12",
    );

    const parsed = Store0213ReleaseCanonicalInputsV1Schema.parse(
      STORE_0_2_13_RELEASE_CANONICAL_INPUTS_V1,
    );
    expect(parsed.release).toEqual({
      productVersion: "0.2.13",
      contractVersion: "control_plane_v2",
      releaseChannel: "stable",
      supportedBrowsers: ["chrome", "opera", "yandex_chromium", "firefox"],
    });
    expect(parsed.artifacts).toEqual([
      {
        carrier: "chromium",
        sha256:
          "8d0664dda71e5b1f12e4bd69e42b53325ee8d213eb6d4869d7291799fce5b463",
        browserFamilies: ["chrome", "opera", "yandex_chromium"],
      },
      {
        carrier: "firefox",
        sha256:
          "b987ce3a24258d3922f61b2d650c17ef029d895a25aab0ec6d27cccacec3c037",
        browserFamilies: ["firefox"],
      },
    ]);

    const browserArtifacts = parsed.artifacts.flatMap((artifact) =>
      artifact.browserFamilies.map((browserFamily) => ({
        browserFamily,
        artifactSha256: artifact.sha256,
      })),
    );
    const exactCommand = PublishExtensionReleaseCommandSchema.parse({
      version: parsed.release.productVersion,
      releaseChannel: parsed.release.releaseChannel,
      browserArtifacts,
      releasedAt: new Date("2026-10-06T00:00:00.000Z"),
      supportedContracts: [parsed.release.contractVersion],
      supportedBrowsers: parsed.release.supportedBrowsers,
    });
    expect(exactCommand.browserArtifacts).toEqual([
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
    ]);

    expect(
      Store0213ReleaseCanonicalInputsV1Schema.safeParse({
        ...parsed,
        release: { ...parsed.release, productVersion: "0.2.12" },
      }).success,
    ).toBe(false);
    expect(
      Store0213ReleaseCanonicalInputsV1Schema.safeParse({
        ...parsed,
        artifacts: [
          { ...parsed.artifacts[0], sha256: "0".repeat(64) },
          parsed.artifacts[1],
        ],
      }).success,
    ).toBe(false);

    expect(parsed.authority).toEqual({
      evidenceLevel: "SOURCE_CANONICAL_INPUT",
      catalogMutationAuthorized: false,
      packageBuildAuthorized: false,
      livePublicationAuthorized: false,
    });
    expect(Object.isFrozen(STORE_0_2_13_RELEASE_CANONICAL_INPUTS_V1)).toBe(
      true,
    );
    expect(
      Object.isFrozen(STORE_0_2_13_RELEASE_CANONICAL_INPUTS_V1.release),
    ).toBe(true);
    expect(
      Object.isFrozen(STORE_0_2_13_RELEASE_CANONICAL_INPUTS_V1.artifacts),
    ).toBe(true);
  });

  it("binds each browser family to its exact accepted carrier digest", () => {
    expect(BETA_RELEASE_CANONICAL_INPUTS_V1.artifacts).toEqual([
      {
        carrier: "chromium",
        sha256:
          "90f6d67a5c3f3a2650886e32411f076349d7f429b3d4ed8ac1aa617e61ac77d7",
        browserFamilies: ["chrome", "opera", "yandex_chromium"],
      },
      {
        carrier: "firefox",
        sha256:
          "a29ad0de5f91fdcf6fbd09a6443f31a754af7248e41ec8429dc74ed26e76dd9c",
        browserFamilies: ["firefox"],
      },
    ]);
  });

  it("binds the canonical browser-specific publication mapping without flattening artifacts", () => {
    const canonical = BETA_RELEASE_CANONICAL_INPUTS_V1;
    const digests = canonical.artifacts.map((artifact) => artifact.sha256);

    expect(new Set(digests).size).toBe(2);
    expect(canonical.currentPersistenceBoundary).toEqual({
      model: "UNIQUE_VERSION_WITH_BROWSER_SPECIFIC_ARTIFACT_SHA256",
      exactMulticarrierBindingRepresentable: true,
      exactMulticarrierPublicationCommandRepresentable: true,
      storageMode: "EXACT_BROWSER_ARTIFACTS",
    });

    const browserArtifacts = canonical.artifacts.flatMap((artifact) =>
      artifact.browserFamilies.map((browserFamily) => ({
        browserFamily,
        artifactSha256: artifact.sha256,
      })),
    );
    const exactCommand = PublishExtensionReleaseCommandSchema.parse({
      version: canonical.release.productVersion,
      releaseChannel: canonical.release.releaseChannel,
      browserArtifacts,
      releasedAt: new Date("2026-10-05T00:00:00.000Z"),
      supportedContracts: [canonical.release.contractVersion],
      supportedBrowsers: canonical.release.supportedBrowsers,
    });
    expect(exactCommand.browserArtifacts).toEqual([
      { browserFamily: "chrome", artifactSha256: digests[0] },
      { browserFamily: "opera", artifactSha256: digests[0] },
      { browserFamily: "yandex_chromium", artifactSha256: digests[0] },
      { browserFamily: "firefox", artifactSha256: digests[1] },
    ]);
  });

  it("rejects channel, digest, mapping, and extra-field drift", () => {
    const canonical = BETA_RELEASE_CANONICAL_INPUTS_V1;

    expect(
      BetaReleaseCanonicalInputsV1Schema.safeParse({
        ...canonical,
        release: { ...canonical.release, releaseChannel: "free-beta" },
      }).success,
    ).toBe(false);

    expect(
      BetaReleaseCanonicalInputsV1Schema.safeParse({
        ...canonical,
        artifacts: [
          { ...canonical.artifacts[0], sha256: "0".repeat(64) },
          canonical.artifacts[1],
        ],
      }).success,
    ).toBe(false);

    expect(
      BetaReleaseCanonicalInputsV1Schema.safeParse({
        ...canonical,
        artifacts: [
          {
            ...canonical.artifacts[0],
            browserFamilies: ["opera", "chrome", "yandex_chromium"],
          },
          canonical.artifacts[1],
        ],
      }).success,
    ).toBe(false);

    expect(
      BetaReleaseCanonicalInputsV1Schema.safeParse({
        ...canonical,
        writerAuthority: true,
      }).success,
    ).toBe(false);
  });

  it("carries no dynamic publication or privileged authority and is deeply frozen", () => {
    const canonical = BETA_RELEASE_CANONICAL_INPUTS_V1;

    expect(canonical.authority).toEqual({
      evidenceLevel: "SOURCE_CANONICAL_INPUT",
      catalogMutationAuthorized: false,
      packageBuildAuthorized: false,
      livePublicationAuthorized: false,
    });
    expect(canonical.exclusions).toEqual([
      "NO_DB_IDENTIFIERS",
      "NO_RELEASE_TIMESTAMPS",
      "NO_ADMIN_IDENTITY_OR_AUTHORIZATION",
      "NO_SIGNING_KEY_MATERIAL",
      "NO_LIVE_OR_CATALOG_MUTATION_AUTHORITY",
      "NO_PACKAGE_BUILD_AUTHORITY",
      "NO_SINGLE_DIGEST_FLATTENING_OF_DISTINCT_CARRIERS",
    ]);

    const visit = (value: unknown): void => {
      if (value === null || typeof value !== "object") return;
      expect(Object.isFrozen(value)).toBe(true);
      for (const child of Object.values(value as Record<string, unknown>))
        visit(child);
    };
    visit(canonical);
  });
});
