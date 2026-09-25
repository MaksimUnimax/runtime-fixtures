import {
  BootstrapAiResolutionV1Schema,
  type BootstrapAiResolutionV1,
  type BootstrapDetectedAiV1,
} from "@product/contracts";
import {
  compareBrowserVersionV1,
  type ContractVersion,
} from "@product/compatibility";
import {
  profileRevisionFingerprint,
  selectAssignedProfileRevision,
  validateProfileContent,
  type AssignmentMode,
} from "@product/adapter-registry";
import {
  BrowserFamilies,
  compareSemVerV1,
  type BrowserFamily,
} from "@product/shared";
export type { BootstrapAiResolutionV1 } from "@product/contracts";

export type BootstrapAiResolutionInput = {
  detected: BootstrapDetectedAiV1;
  contractVersion: ContractVersion;
  extensionVersion: string;
  browser: { family: BrowserFamily; version: string };
  accountId: string;
  deviceId: string;
};

export type BootstrapLocalAiResolutionInput = {
  detected: BootstrapDetectedAiV1;
  contractVersion: ContractVersion;
  accountId: string;
  deviceId: string;
};

export type BootstrapAiHierarchySnapshot = {
  adapterId: string;
  adapterKey: string;
  adapterStatus: string;
  surfaceId: string;
  surfaceKey: string;
  surfaceStatus: string;
  variantId: string | null;
  variantKey: string | null;
  variantStatus: string | null;
};

export type BootstrapAiAssignmentRevisionSnapshot = {
  revision: number;
  mode: string;
  baselineProfileRevisionId: string;
  candidateProfileRevisionId: string | null;
  percentageBps: number;
};

export type BootstrapAiAssignmentSnapshot = {
  id: string;
  variantId: string | null;
  browserFamily: string;
  subjectKind: string;
  cohortSeed: Buffer;
  latest: BootstrapAiAssignmentRevisionSnapshot | null;
};

export type BootstrapAiProfileSnapshot = {
  revisionId: string;
  profileId: string;
  profileKey: string;
  profileStatus: string;
  adapterId: string;
  surfaceId: string;
  variantId: string | null;
  revision: number;
  schemaVersion: string;
  state: string;
  content: unknown;
  compatibility: unknown;
  contentSha256: string;
};

export type BootstrapAiResolutionSnapshot = {
  hierarchy: BootstrapAiHierarchySnapshot | null;
  exactAssignment: BootstrapAiAssignmentSnapshot | null;
  defaultAssignment: BootstrapAiAssignmentSnapshot | null;
  profiles: BootstrapAiProfileSnapshot[];
};

/** The DB implementation must return all rows from one PostgreSQL statement. */
export interface BootstrapAiResolutionRepository {
  resolve(input: {
    family: string;
    surface: string;
    variant: string | null;
    browserFamily: BrowserFamily;
  }): Promise<BootstrapAiResolutionSnapshot>;
}

export class BootstrapAiResolutionError extends Error {
  constructor(public readonly code = "AI_RESOLUTION_SOURCE_CORRUPTED") {
    super(code);
  }
}

function unavailable(
  detected: BootstrapDetectedAiV1,
  reason: Extract<BootstrapAiResolutionV1, { status: "UNAVAILABLE" }>["reason"],
): BootstrapAiResolutionV1 {
  return { status: "UNAVAILABLE", detected, reason };
}

function assertAssignmentRevision(
  revision: BootstrapAiAssignmentRevisionSnapshot,
): asserts revision is BootstrapAiAssignmentRevisionSnapshot & {
  mode: AssignmentMode;
  candidateProfileRevisionId: string | null;
} {
  if (
    !["DIRECT", "ROLLOUT", "PAUSED"].includes(revision.mode) ||
    !Number.isInteger(revision.revision) ||
    revision.revision < 1 ||
    !Number.isInteger(revision.percentageBps) ||
    revision.percentageBps < 0 ||
    revision.percentageBps > 10000 ||
    !revision.baselineProfileRevisionId
  )
    throw new BootstrapAiResolutionError();
  if (
    revision.mode === "DIRECT" &&
    (revision.candidateProfileRevisionId !== null ||
      revision.percentageBps !== 0)
  )
    throw new BootstrapAiResolutionError();
  if (
    (revision.mode === "ROLLOUT" || revision.mode === "PAUSED") &&
    (!revision.candidateProfileRevisionId ||
      revision.candidateProfileRevisionId ===
        revision.baselineProfileRevisionId)
  )
    throw new BootstrapAiResolutionError();
}

function resolveSelectedRevision(
  assignment: BootstrapAiAssignmentSnapshot,
  input: BootstrapAiResolutionInput | BootstrapLocalAiResolutionInput,
  browserFamily: BrowserFamily,
): string {
  if (assignment.cohortSeed.length !== 32)
    throw new BootstrapAiResolutionError();
  if (assignment.browserFamily !== browserFamily)
    throw new BootstrapAiResolutionError();
  if (
    assignment.subjectKind !== "ACCOUNT" &&
    assignment.subjectKind !== "DEVICE"
  )
    throw new BootstrapAiResolutionError();
  if (!assignment.latest) throw new BootstrapAiResolutionError();
  assertAssignmentRevision(assignment.latest);
  return selectAssignedProfileRevision({
    mode: assignment.latest.mode,
    baselineProfileRevisionId: assignment.latest.baselineProfileRevisionId,
    candidateProfileRevisionId: assignment.latest.candidateProfileRevisionId,
    percentageBps: assignment.latest.percentageBps,
    cohortSeed: assignment.cohortSeed,
    subjectKind: assignment.subjectKind,
    subjectId:
      assignment.subjectKind === "ACCOUNT" ? input.accountId : input.deviceId,
  });
}

function checkCompatibility(
  profile: ReturnType<typeof validateProfileContent>["compatibility"],
  input: BootstrapAiResolutionInput,
): boolean {
  if (profile.contractVersion !== input.contractVersion) return false;
  if (!profile.browserFamilies.includes(input.browser.family)) return false;
  const minimumBrowser = profile.minimumBrowserVersions.find(
    (value) => value.browserFamily === input.browser.family,
  );
  if (
    minimumBrowser &&
    (compareBrowserVersionV1(
      input.browser.version,
      minimumBrowser.minimumVersion,
    ) ?? -1) < 0
  )
    return false;
  return (
    !profile.minimumExtensionVersion ||
    compareSemVerV1(input.extensionVersion, profile.minimumExtensionVersion) >=
      0
  );
}

export function resolveBootstrapAiSnapshot(
  input: BootstrapAiResolutionInput | BootstrapLocalAiResolutionInput,
  snapshot: BootstrapAiResolutionSnapshot,
  expectedBrowserFamily?: BrowserFamily,
): BootstrapAiResolutionV1 {
  const hierarchy = snapshot.hierarchy;
  if (!hierarchy) return unavailable(input.detected, "UNSUPPORTED_DETECTED_AI");
  if (
    input.detected.variant !== null &&
    (hierarchy.variantId === null ||
      hierarchy.variantKey !== input.detected.variant)
  )
    return unavailable(input.detected, "UNSUPPORTED_DETECTED_AI");
  if (
    hierarchy.adapterStatus !== "ACTIVE" ||
    hierarchy.surfaceStatus !== "ACTIVE" ||
    (hierarchy.variantId !== null && hierarchy.variantStatus !== "ACTIVE")
  )
    return unavailable(input.detected, "AI_DISABLED");

  const assignment =
    input.detected.variant !== null
      ? snapshot.exactAssignment?.latest
        ? snapshot.exactAssignment
        : snapshot.defaultAssignment
      : snapshot.defaultAssignment;
  if (!assignment) return unavailable(input.detected, "NO_PROFILE");
  const selectedRevisionId = resolveSelectedRevision(
    assignment,
    input,
    expectedBrowserFamily ??
      ("browser" in input
        ? input.browser.family
        : (assignment.browserFamily as BrowserFamily)),
  );
  const selected = snapshot.profiles.filter(
    (profile) => profile.revisionId === selectedRevisionId,
  );
  if (selected.length !== 1) throw new BootstrapAiResolutionError();
  const profile = selected[0]!;
  if (
    profile.state !== "PUBLISHED" ||
    profile.profileStatus !== "ACTIVE" ||
    profile.schemaVersion !== "adapter_profile_v1" ||
    profile.adapterId !== hierarchy.adapterId ||
    profile.surfaceId !== hierarchy.surfaceId ||
    profile.variantId !== assignment.variantId ||
    (assignment.variantId !== null &&
      assignment.variantId !== hierarchy.variantId)
  )
    throw new BootstrapAiResolutionError();

  let validated: ReturnType<typeof validateProfileContent>;
  try {
    validated = validateProfileContent({
      content: profile.content,
      compatibility: profile.compatibility,
    });
  } catch {
    throw new BootstrapAiResolutionError();
  }
  if (
    profileRevisionFingerprint({
      content: validated.content,
      compatibility: validated.compatibility,
    }) !== profile.contentSha256 ||
    validated.contentSha256 !== profile.contentSha256
  )
    throw new BootstrapAiResolutionError();
  if (
    "browser" in input &&
    "extensionVersion" in input &&
    !checkCompatibility(validated.compatibility, input)
  )
    return unavailable(input.detected, "PROFILE_INCOMPATIBLE");

  return BootstrapAiResolutionV1Schema.parse({
    status: "RESOLVED",
    detected: input.detected,
    profile: {
      profileKey: profile.profileKey,
      revision: profile.revision,
      scopeVariant: assignment.variantId ? hierarchy.variantKey : null,
      schemaVersion: "adapter_profile_v1",
      contentSha256: profile.contentSha256,
      content: validated.content,
      compatibility: validated.compatibility,
    },
  });
}

export class BootstrapAiResolutionService {
  constructor(private readonly repository: BootstrapAiResolutionRepository) {}

  async resolve(
    input: BootstrapAiResolutionInput,
  ): Promise<BootstrapAiResolutionV1> {
    const snapshot = await this.repository.resolve({
      family: input.detected.family,
      surface: input.detected.surface,
      variant: input.detected.variant,
      browserFamily: input.browser.family,
    });
    return resolveBootstrapAiSnapshot(input, snapshot);
  }

  async resolveLocalCandidates(
    input: BootstrapLocalAiResolutionInput,
  ): Promise<
    Array<{ browserFamily: BrowserFamily; resolution: BootstrapAiResolutionV1 }>
  > {
    const candidates = await Promise.all(
      BrowserFamilies.map(async (browserFamily) => {
        const snapshot = await this.repository.resolve({
          family: input.detected.family,
          surface: input.detected.surface,
          variant: input.detected.variant,
          browserFamily,
        });
        if (!snapshot.exactAssignment && !snapshot.defaultAssignment)
          return null;
        return {
          browserFamily,
          resolution: resolveBootstrapAiSnapshot(
            input,
            snapshot,
            browserFamily,
          ),
        };
      }),
    );
    return candidates.filter(
      (candidate): candidate is NonNullable<typeof candidate> =>
        candidate !== null,
    );
  }
}
