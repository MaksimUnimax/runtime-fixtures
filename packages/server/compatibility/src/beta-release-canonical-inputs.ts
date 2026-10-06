import { z } from "zod";

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

const ChromiumArtifactSchema = z
  .object({
    carrier: z.literal("chromium"),
    sha256: z.literal(
      "90f6d67a5c3f3a2650886e32411f076349d7f429b3d4ed8ac1aa617e61ac77d7",
    ),
    browserFamilies: z.tuple([
      z.literal("chrome"),
      z.literal("opera"),
      z.literal("yandex_chromium"),
    ]),
  })
  .strict();

const FirefoxArtifactSchema = z
  .object({
    carrier: z.literal("firefox"),
    sha256: z.literal(
      "a29ad0de5f91fdcf6fbd09a6443f31a754af7248e41ec8429dc74ed26e76dd9c",
    ),
    browserFamilies: z.tuple([z.literal("firefox")]),
  })
  .strict();

export const BetaReleaseCanonicalInputsV1Schema = z
  .object({
    schemaVersion: z.literal("beta_release_canonical_inputs_v1"),
    release: z
      .object({
        productVersion: z.literal("0.2.12"),
        contractVersion: z.literal("control_plane_v2"),
        releaseChannel: z.literal("stable"),
        supportedBrowsers: z.tuple([
          z.literal("chrome"),
          z.literal("opera"),
          z.literal("yandex_chromium"),
          z.literal("firefox"),
        ]),
      })
      .strict(),
    artifacts: z.tuple([ChromiumArtifactSchema, FirefoxArtifactSchema]),
    channelAuthority: z
      .object({
        selection: z.literal("EXPLICIT_VERSIONED_SOURCE_VALUE"),
        freeBetaAdmissionIsReleaseChannel: z.literal(false),
        derivedFromSemVerOrFilename: z.literal(false),
      })
      .strict(),
    currentPersistenceBoundary: z
      .object({
        model: z.literal(
          "UNIQUE_VERSION_WITH_BROWSER_SPECIFIC_ARTIFACT_SHA256",
        ),
        exactMulticarrierBindingRepresentable: z.literal(true),
        exactMulticarrierPublicationCommandRepresentable: z.literal(true),
        storageMode: z.literal("EXACT_BROWSER_ARTIFACTS"),
      })
      .strict(),
    authority: z
      .object({
        evidenceLevel: z.literal("SOURCE_CANONICAL_INPUT"),
        catalogMutationAuthorized: z.literal(false),
        packageBuildAuthorized: z.literal(false),
        livePublicationAuthorized: z.literal(false),
      })
      .strict(),
    exclusions: z.tuple([
      z.literal("NO_DB_IDENTIFIERS"),
      z.literal("NO_RELEASE_TIMESTAMPS"),
      z.literal("NO_ADMIN_IDENTITY_OR_AUTHORIZATION"),
      z.literal("NO_SIGNING_KEY_MATERIAL"),
      z.literal("NO_LIVE_OR_CATALOG_MUTATION_AUTHORITY"),
      z.literal("NO_PACKAGE_BUILD_AUTHORITY"),
      z.literal("NO_SINGLE_DIGEST_FLATTENING_OF_DISTINCT_CARRIERS"),
    ]),
  })
  .strict()
  .superRefine((value, ctx) => {
    const artifactDigests = value.artifacts.map((artifact) => artifact.sha256);
    if (new Set(artifactDigests).size !== artifactDigests.length) {
      ctx.addIssue({
        code: "custom",
        path: ["artifacts"],
        message: "carrier artifacts must remain distinct",
      });
    }

    for (const artifact of value.artifacts) {
      if (!Sha256Schema.safeParse(artifact.sha256).success) {
        ctx.addIssue({
          code: "custom",
          path: ["artifacts", artifact.carrier, "sha256"],
          message: "invalid sha256",
        });
      }
    }

    const mappedBrowsers = value.artifacts.flatMap(
      (artifact) => artifact.browserFamilies,
    );
    if (
      mappedBrowsers.length !== value.release.supportedBrowsers.length ||
      mappedBrowsers.some(
        (browser, index) => browser !== value.release.supportedBrowsers[index],
      )
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["artifacts"],
        message: "browser-to-carrier mapping must match supported browsers",
      });
    }
  });

const Store0213ChromiumArtifactSchema = z
  .object({
    carrier: z.literal("chromium"),
    sha256: z.literal(
      "8d0664dda71e5b1f12e4bd69e42b53325ee8d213eb6d4869d7291799fce5b463",
    ),
    browserFamilies: z.tuple([
      z.literal("chrome"),
      z.literal("opera"),
      z.literal("yandex_chromium"),
    ]),
  })
  .strict();

const Store0213FirefoxArtifactSchema = z
  .object({
    carrier: z.literal("firefox"),
    sha256: z.literal(
      "b987ce3a24258d3922f61b2d650c17ef029d895a25aab0ec6d27cccacec3c037",
    ),
    browserFamilies: z.tuple([z.literal("firefox")]),
  })
  .strict();

export const Store0213ReleaseCanonicalInputsV1Schema = z
  .object({
    schemaVersion: z.literal("beta_release_canonical_inputs_v1"),
    release: z
      .object({
        productVersion: z.literal("0.2.13"),
        contractVersion: z.literal("control_plane_v2"),
        releaseChannel: z.literal("stable"),
        supportedBrowsers: z.tuple([
          z.literal("chrome"),
          z.literal("opera"),
          z.literal("yandex_chromium"),
          z.literal("firefox"),
        ]),
      })
      .strict(),
    artifacts: z.tuple([
      Store0213ChromiumArtifactSchema,
      Store0213FirefoxArtifactSchema,
    ]),
    channelAuthority: z
      .object({
        selection: z.literal("EXPLICIT_VERSIONED_SOURCE_VALUE"),
        freeBetaAdmissionIsReleaseChannel: z.literal(false),
        derivedFromSemVerOrFilename: z.literal(false),
      })
      .strict(),
    currentPersistenceBoundary: z
      .object({
        model: z.literal(
          "UNIQUE_VERSION_WITH_BROWSER_SPECIFIC_ARTIFACT_SHA256",
        ),
        exactMulticarrierBindingRepresentable: z.literal(true),
        exactMulticarrierPublicationCommandRepresentable: z.literal(true),
        storageMode: z.literal("EXACT_BROWSER_ARTIFACTS"),
      })
      .strict(),
    authority: z
      .object({
        evidenceLevel: z.literal("SOURCE_CANONICAL_INPUT"),
        catalogMutationAuthorized: z.literal(false),
        packageBuildAuthorized: z.literal(false),
        livePublicationAuthorized: z.literal(false),
      })
      .strict(),
    exclusions: z.tuple([
      z.literal("NO_DB_IDENTIFIERS"),
      z.literal("NO_RELEASE_TIMESTAMPS"),
      z.literal("NO_ADMIN_IDENTITY_OR_AUTHORIZATION"),
      z.literal("NO_SIGNING_KEY_MATERIAL"),
      z.literal("NO_LIVE_OR_CATALOG_MUTATION_AUTHORITY"),
      z.literal("NO_PACKAGE_BUILD_AUTHORITY"),
      z.literal("NO_SINGLE_DIGEST_FLATTENING_OF_DISTINCT_CARRIERS"),
    ]),
  })
  .strict()
  .superRefine((value, ctx) => {
    const artifactDigests = value.artifacts.map((artifact) => artifact.sha256);
    if (new Set(artifactDigests).size !== artifactDigests.length) {
      ctx.addIssue({
        code: "custom",
        path: ["artifacts"],
        message: "carrier artifacts must remain distinct",
      });
    }

    for (const artifact of value.artifacts) {
      if (!Sha256Schema.safeParse(artifact.sha256).success) {
        ctx.addIssue({
          code: "custom",
          path: ["artifacts", artifact.carrier, "sha256"],
          message: "invalid sha256",
        });
      }
    }

    const mappedBrowsers = value.artifacts.flatMap(
      (artifact) => artifact.browserFamilies,
    );
    if (
      mappedBrowsers.length !== value.release.supportedBrowsers.length ||
      mappedBrowsers.some(
        (browser, index) => browser !== value.release.supportedBrowsers[index],
      )
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["artifacts"],
        message: "browser-to-carrier mapping must match supported browsers",
      });
    }
  });

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>))
      deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const BETA_RELEASE_CANONICAL_INPUTS_V1 = deepFreeze(
  BetaReleaseCanonicalInputsV1Schema.parse({
    schemaVersion: "beta_release_canonical_inputs_v1",
    release: {
      productVersion: "0.2.12",
      contractVersion: "control_plane_v2",
      releaseChannel: "stable",
      supportedBrowsers: ["chrome", "opera", "yandex_chromium", "firefox"],
    },
    artifacts: [
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
    ],
    channelAuthority: {
      selection: "EXPLICIT_VERSIONED_SOURCE_VALUE",
      freeBetaAdmissionIsReleaseChannel: false,
      derivedFromSemVerOrFilename: false,
    },
    currentPersistenceBoundary: {
      model: "UNIQUE_VERSION_WITH_BROWSER_SPECIFIC_ARTIFACT_SHA256",
      exactMulticarrierBindingRepresentable: true,
      exactMulticarrierPublicationCommandRepresentable: true,
      storageMode: "EXACT_BROWSER_ARTIFACTS",
    },
    authority: {
      evidenceLevel: "SOURCE_CANONICAL_INPUT",
      catalogMutationAuthorized: false,
      packageBuildAuthorized: false,
      livePublicationAuthorized: false,
    },
    exclusions: [
      "NO_DB_IDENTIFIERS",
      "NO_RELEASE_TIMESTAMPS",
      "NO_ADMIN_IDENTITY_OR_AUTHORIZATION",
      "NO_SIGNING_KEY_MATERIAL",
      "NO_LIVE_OR_CATALOG_MUTATION_AUTHORITY",
      "NO_PACKAGE_BUILD_AUTHORITY",
      "NO_SINGLE_DIGEST_FLATTENING_OF_DISTINCT_CARRIERS",
    ],
  }),
);

export const STORE_0_2_13_RELEASE_CANONICAL_INPUTS_V1 = deepFreeze(
  Store0213ReleaseCanonicalInputsV1Schema.parse({
    schemaVersion: "beta_release_canonical_inputs_v1",
    release: {
      productVersion: "0.2.13",
      contractVersion: "control_plane_v2",
      releaseChannel: "stable",
      supportedBrowsers: ["chrome", "opera", "yandex_chromium", "firefox"],
    },
    artifacts: [
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
    ],
    channelAuthority: {
      selection: "EXPLICIT_VERSIONED_SOURCE_VALUE",
      freeBetaAdmissionIsReleaseChannel: false,
      derivedFromSemVerOrFilename: false,
    },
    currentPersistenceBoundary: {
      model: "UNIQUE_VERSION_WITH_BROWSER_SPECIFIC_ARTIFACT_SHA256",
      exactMulticarrierBindingRepresentable: true,
      exactMulticarrierPublicationCommandRepresentable: true,
      storageMode: "EXACT_BROWSER_ARTIFACTS",
    },
    authority: {
      evidenceLevel: "SOURCE_CANONICAL_INPUT",
      catalogMutationAuthorized: false,
      packageBuildAuthorized: false,
      livePublicationAuthorized: false,
    },
    exclusions: [
      "NO_DB_IDENTIFIERS",
      "NO_RELEASE_TIMESTAMPS",
      "NO_ADMIN_IDENTITY_OR_AUTHORIZATION",
      "NO_SIGNING_KEY_MATERIAL",
      "NO_LIVE_OR_CATALOG_MUTATION_AUTHORITY",
      "NO_PACKAGE_BUILD_AUTHORITY",
      "NO_SINGLE_DIGEST_FLATTENING_OF_DISTINCT_CARRIERS",
    ],
  }),
);

export type BetaReleaseCanonicalInputsV1 = z.infer<
  typeof BetaReleaseCanonicalInputsV1Schema
>;

export type Store0213ReleaseCanonicalInputsV1 = z.infer<
  typeof Store0213ReleaseCanonicalInputsV1Schema
>;
