import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { validateProfileContent } from "../../packages/server/adapter-registry/src/index.js";

export const STORE1_VERSION = "0.2.4" as const;
export const STORE1_CONTRACT = "control_plane_v2" as const;
export const STORE1_BROWSER = "opera" as const;
export const STORE1_BROWSER_MINIMUM = "136" as const;
export const STORE1_POLICY_KEY = "store1.opera.v2" as const;
export const STORE1_PROFILE_KEY = "chatgpt-standard-opera-v1" as const;
export const STORE1_REASON = "STORE-1 Opera reviewer catalog activation";
export const STORE1_ACCEPTED_SOURCE_HEAD =
  "e7d66152bdb77918b65115486c9829ef7a634e69" as const;
export const STORE1_ACCEPTED_SOURCE_TREE =
  "01ae2c1d84a354a11d919a313f8d9909d1285b6a" as const;
export const STORE1_ACCEPTED_ARTIFACT_SHA256 =
  "0c1fb4c9c81c600332dfb6dc2dcfb9c3221dafe9940eab3811112a4e9fc5d71c" as const;

function selector(
  strategy:
    | "conversation_root"
    | "composer_root"
    | "send_control"
    | "assistant_response",
  reference:
    | "conversation-root"
    | "composer-root"
    | "send-control"
    | "assistant-response",
) {
  return {
    strategy,
    primary: { kind: "packaged_selector_reference" as const, reference },
    fallbacks: [],
    timeoutMs: 1000,
    observationMode: "polling" as const,
  };
}
function contour(
  key: "page_identity" | "conversation_root" | "composer_root" | "send_control",
  expectedState: "PRESENT" | "INTERACTIVE",
  strategy:
    | "page_identity"
    | "conversation_root"
    | "composer_root"
    | "send_control",
) {
  return { key, required: true, expectedState, strategy };
}

export const STORE1_PROFILE_CONTENT = {
  schemaVersion: "adapter_profile_v1" as const,
  page: {
    identityStrategy: "page_identity" as const,
    conversationStrategy: "conversation_root" as const,
    composerStrategy: "composer_root" as const,
  },
  selectors: {
    conversation: selector("conversation_root", "conversation-root"),
    composer: selector("composer_root", "composer-root"),
    send: selector("send_control", "send-control"),
    assistantResponse: selector("assistant_response", "assistant-response"),
  },
  observation: { mode: "polling" as const, intervalMs: 100 },
  contours: [
    contour("page_identity", "PRESENT", "page_identity"),
    contour("conversation_root", "PRESENT", "conversation_root"),
    contour("composer_root", "INTERACTIVE", "composer_root"),
    contour("send_control", "INTERACTIVE", "send_control"),
  ],
};

export const STORE1_PROFILE_COMPATIBILITY = {
  schemaVersion: "profile_compatibility_v1" as const,
  contractVersion: STORE1_CONTRACT,
  browserFamilies: [STORE1_BROWSER],
  minimumBrowserVersions: [
    { browserFamily: STORE1_BROWSER, minimumVersion: STORE1_BROWSER_MINIMUM },
  ],
  minimumExtensionVersion: STORE1_VERSION,
};

export const STORE1_PROFILE_SHA256 = validateProfileContent({
  content: STORE1_PROFILE_CONTENT,
  compatibility: STORE1_PROFILE_COMPATIBILITY,
}).contentSha256;

export type Store1PackageAuthority = {
  sourceHead: string;
  sourceTree: string;
  version: typeof STORE1_VERSION;
  contractVersion: typeof STORE1_CONTRACT;
  artifactSha256: string;
  filename: string;
};
type ReleaseCandidateManifest = {
  productVersion?: unknown;
  contractVersion?: unknown;
  source?: { head?: unknown; tree?: unknown };
  packages?: {
    chromium?: {
      version?: unknown;
      browser?: unknown;
      sha256?: unknown;
      filename?: unknown;
    };
  };
};

export function readStore1PackageAuthority(
  manifestPath: string,
  zipPath: string,
): Store1PackageAuthority {
  const manifest = JSON.parse(
    readFileSync(manifestPath, "utf8"),
  ) as ReleaseCandidateManifest;
  const pkg = manifest.packages?.chromium;
  if (
    manifest.productVersion !== STORE1_VERSION ||
    manifest.contractVersion !== STORE1_CONTRACT ||
    manifest.source?.head !== STORE1_ACCEPTED_SOURCE_HEAD ||
    manifest.source?.tree !== STORE1_ACCEPTED_SOURCE_TREE ||
    pkg?.version !== STORE1_VERSION ||
    pkg.browser !== "chromium" ||
    pkg.sha256 !== STORE1_ACCEPTED_ARTIFACT_SHA256 ||
    typeof pkg.filename !== "string"
  )
    throw new Error("STORE1_PACKAGE_MANIFEST_MISMATCH");
  const artifactSha256 = createHash("sha256")
    .update(readFileSync(zipPath))
    .digest("hex");
  if (
    artifactSha256 !== pkg.sha256 ||
    artifactSha256 !== STORE1_ACCEPTED_ARTIFACT_SHA256
  )
    throw new Error("STORE1_PACKAGE_SHA256_MISMATCH");
  if (basename(zipPath) !== pkg.filename)
    throw new Error("STORE1_PACKAGE_FILENAME_MISMATCH");
  return {
    sourceHead: manifest.source.head,
    sourceTree: manifest.source.tree,
    version: STORE1_VERSION,
    contractVersion: STORE1_CONTRACT,
    artifactSha256,
    filename: pkg.filename,
  };
}
type RegistryEntity = {
  id: string;
  machineKey: string;
  status: "ACTIVE" | "DISABLED";
};
type ProfileEntity = RegistryEntity & {
  adapterId: string;
  surfaceId: string;
  variantId: string | null;
};
type ProfileRevision = {
  id: string;
  revision: number;
  state: "DRAFT" | "CANDIDATE" | "PUBLISHED" | "RETIRED";
  contentSha256: string;
};
type Assignment = {
  id: string;
  latest: null | {
    revision: number;
    mode: "DIRECT" | "ROLLOUT" | "PAUSED";
    baselineProfileRevisionId: string;
    candidateProfileRevisionId: string | null;
    percentageBps: number;
  };
};
export type Store1ActivationReadback = {
  release?: null | {
    version: string;
    releaseChannel: string;
    artifactSha256: string | null;
    supportedContracts: string[];
    supportedBrowsers: string[];
  };
  policies?: Array<{
    id: string;
    policyKey: string;
    contractVersion: string;
    browserFamily: string | null;
    minimumExtensionVersion: string | null;
    recommendedExtensionVersion: string | null;
    minimumBrowserVersion: string | null;
    maintenanceMode: boolean;
    maintenanceCode: string | null;
    blockedVersions: string[];
    linkedConfigVersions: number[];
  }>;
  config?: null | {
    configVersion: number;
    contractVersion: string;
    snapshotVersion: string;
    envelopeVersion: string;
    compatibilityPolicyRevisionIds: string[];
  };
  adapters?: RegistryEntity[];
  adapterNextCursor?: string | null;
  surfaces?: RegistryEntity[];
  surfaceNextCursor?: string | null;
  variants?: RegistryEntity[];
  variantNextCursor?: string | null;
  profiles?: ProfileEntity[];
  profileNextCursor?: string | null;
  profileRevisions?: ProfileRevision[];
  profileRevisionNextCursor?: string | null;
  assignments?: Assignment[];
  assignmentNextCursor?: string | null;
  betaState?: { mode: "CLOSED" | "OPEN" | "PAUSED" };
  reviewerUser?: null | {
    id: string;
    status: "ACTIVE" | "SUSPENDED";
    queriedEmailVerified: boolean;
  };
  reviewerAccounts?: Array<{ id: string; status: "ACTIVE" | "SUSPENDED" }>;
  reviewerAccountNextCursor?: string | null;
  reviewerAdmission?: null | { accountId: string; admitted: boolean };
};
export type Store1HttpInstruction = {
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
  purpose: string;
};
export type Store1ActivationPlan =
  | { status: "READ"; next: Store1HttpInstruction }
  | { status: "POST"; next: Store1HttpInstruction }
  | { status: "BLOCKED"; code: string; detail: string }
  | { status: "CONFLICT"; code: string; detail: string }
  | {
      status: "READY";
      profileRevisionId: string;
      assignmentId: string;
      rollback: string[];
    };

const get = (path: string, purpose: string): Store1ActivationPlan => ({
  status: "READ",
  next: { method: "GET", path, purpose },
});
const post = (
  path: string,
  body: Record<string, unknown>,
  purpose: string,
): Store1ActivationPlan => ({
  status: "POST",
  next: { method: "POST", path, body, purpose },
});
const conflict = (code: string, detail: string): Store1ActivationPlan => ({
  status: "CONFLICT",
  code,
  detail,
});
function exactOne<T>(
  values: T[],
  matches: (value: T) => boolean,
): T | null | "CONFLICT" {
  const selected = values.filter(matches);
  return selected.length > 1 ? "CONFLICT" : (selected[0] ?? null);
}
function sorted(values: string[]): string[] {
  return [...values].sort();
}
function sameStrings(left: string[], right: string[]): boolean {
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
}

function reviewerPreflight(
  r: Store1ActivationReadback,
): Store1ActivationPlan | null {
  if (r.betaState === undefined)
    return get(
      "/v1/admin/beta/admission",
      "Verify global beta remains CLOSED before any STORE-1 mutation.",
    );
  if (r.betaState.mode !== "CLOSED")
    return {
      status: "BLOCKED",
      code: "STORE1_BETA_NOT_CLOSED",
      detail: "Reviewer preparation must not open general beta registration.",
    };
  if (r.reviewerUser === undefined)
    return get(
      "/v1/admin/users?email=<REVIEWER_EMAIL_PRIVATE>&limit=1",
      "Verify the dedicated reviewer identity already exists through the ordinary account path.",
    );
  if (!r.reviewerUser)
    return {
      status: "BLOCKED",
      code: "STORE1_REVIEWER_IDENTITY_PREEXISTING_REQUIRED",
      detail:
        "Current CLOSED beta has no targeted invite primitive. Do not open global registration or create a reviewer by SQL/admin bypass.",
    };
  if (r.reviewerUser.status !== "ACTIVE")
    return conflict(
      "STORE1_REVIEWER_SUSPENDED",
      "Reviewer user is not ACTIVE.",
    );
  if (!r.reviewerUser.queriedEmailVerified)
    return {
      status: "BLOCKED",
      code: "STORE1_REVIEWER_EMAIL_VERIFIED_REQUIRED",
      detail:
        "The queried reviewer email identity must already be verified for normal OTP login while beta remains CLOSED.",
    };
  if (r.reviewerAccounts === undefined)
    return get(
      "/v1/admin/accounts?ownerEmail=<REVIEWER_EMAIL_PRIVATE>&status=ACTIVE&limit=100",
      "Resolve all ACTIVE accounts owned by the reviewer through ordinary admin readback.",
    );
  if (r.reviewerAccountNextCursor === undefined)
    return {
      status: "BLOCKED",
      code: "STORE1_REVIEWER_ACCOUNT_PAGINATION_UNKNOWN",
      detail:
        "Reviewer account readback is incomplete because nextCursor was not recorded.",
    };
  if (r.reviewerAccountNextCursor !== null)
    return get(
      "/v1/admin/accounts?ownerEmail=<REVIEWER_EMAIL_PRIVATE>&status=ACTIVE&limit=100&cursor=" +
        encodeURIComponent(r.reviewerAccountNextCursor),
      "Continue reviewer ACTIVE-account pagination before selecting an account.",
    );
  if (r.reviewerAccounts.length !== 1)
    return {
      status: "BLOCKED",
      code:
        r.reviewerAccounts.length === 0
          ? "STORE1_REVIEWER_ACCOUNT_REQUIRED"
          : "STORE1_REVIEWER_ACCOUNT_AMBIGUOUS",
      detail:
        "Dedicated reviewer must own exactly one ACTIVE account for deterministic admission readback.",
    };
  const reviewerAccount = r.reviewerAccounts[0]!;
  if (r.reviewerAdmission === undefined)
    return get(
      `/v1/admin/beta/admission/accounts/${reviewerAccount.id}`,
      "Verify the reviewer account is already beta-admitted while global beta stays CLOSED.",
    );
  if (
    r.reviewerAdmission.accountId !== reviewerAccount.id ||
    !r.reviewerAdmission.admitted
  )
    return {
      status: "BLOCKED",
      code: "STORE1_REVIEWER_BETA_ADMISSION_REQUIRED",
      detail:
        "Reviewer account is not already admitted. Existing global beta controls cannot safely create one dedicated slot while remaining CLOSED.",
    };
  return null;
}

export function planStore1Activation(
  authority: Store1PackageAuthority,
  r: Store1ActivationReadback,
): Store1ActivationPlan {
  if (
    authority.sourceHead !== STORE1_ACCEPTED_SOURCE_HEAD ||
    authority.sourceTree !== STORE1_ACCEPTED_SOURCE_TREE ||
    authority.version !== STORE1_VERSION ||
    authority.contractVersion !== STORE1_CONTRACT ||
    authority.artifactSha256 !== STORE1_ACCEPTED_ARTIFACT_SHA256
  )
    return conflict(
      "STORE1_PACKAGE_AUTHORITY_CONFLICT",
      "Package authority is not the accepted current STORE candidate.",
    );
  const reviewer = reviewerPreflight(r);
  if (reviewer) return reviewer;

  if (r.release === undefined)
    return get(
      `/v1/admin/compatibility/releases/${STORE1_VERSION}`,
      "Read exact immutable extension release before deciding publish/reuse.",
    );
  if (r.release === null)
    return post(
      `/v1/admin/compatibility/releases/${STORE1_VERSION}/publish`,
      {
        version: STORE1_VERSION,
        releaseChannel: "stable",
        artifactSha256: authority.artifactSha256,
        supportedContracts: [STORE1_CONTRACT],
        supportedBrowsers: [STORE1_BROWSER],
        reason: STORE1_REASON,
      },
      "Publish the exact accepted Opera package bytes through ordinary admin.",
    );
  if (
    r.release.version !== STORE1_VERSION ||
    r.release.releaseChannel !== "stable" ||
    r.release.artifactSha256 !== authority.artifactSha256 ||
    !sameStrings(r.release.supportedContracts, [STORE1_CONTRACT]) ||
    !sameStrings(r.release.supportedBrowsers, [STORE1_BROWSER])
  )
    return conflict(
      "STORE1_RELEASE_CONFLICT",
      "Version 0.2.4 already exists but does not bind the exact current Opera package.",
    );

  if (r.policies === undefined)
    return get(
      `/v1/admin/compatibility/policies?contractVersion=${STORE1_CONTRACT}&policyKey=${STORE1_POLICY_KEY}&scope=${STORE1_BROWSER}&limit=1`,
      "Read STORE-1 v2 Opera policy revisions.",
    );
  const policy = r.policies[0] ?? null;
  if (policy === null)
    return post(
      `/v1/admin/compatibility/policies/${STORE1_POLICY_KEY}/publish`,
      {
        contractVersion: STORE1_CONTRACT,
        browserFamily: STORE1_BROWSER,
        minimumExtensionVersion: STORE1_VERSION,
        recommendedExtensionVersion: STORE1_VERSION,
        minimumBrowserVersion: STORE1_BROWSER_MINIMUM,
        maintenanceMode: false,
        maintenanceCode: null,
        blockedVersions: [],
        reason: STORE1_REASON,
      },
      "Publish exact Opera compatibility policy.",
    );
  if (
    policy.policyKey !== STORE1_POLICY_KEY ||
    policy.contractVersion !== STORE1_CONTRACT ||
    policy.browserFamily !== STORE1_BROWSER ||
    policy.minimumExtensionVersion !== STORE1_VERSION ||
    policy.recommendedExtensionVersion !== STORE1_VERSION ||
    policy.minimumBrowserVersion !== STORE1_BROWSER_MINIMUM ||
    policy.maintenanceMode ||
    policy.maintenanceCode !== null ||
    policy.blockedVersions.length !== 0
  )
    return conflict(
      "STORE1_POLICY_CONFLICT",
      "Latest STORE-1 policy does not equal the bounded Opera target.",
    );

  if (r.config === undefined)
    return get(
      `/v1/admin/compatibility/config-releases/latest?contractVersion=${STORE1_CONTRACT}`,
      "Read current v2 config baseline and linked compatibility authority.",
    );
  if (r.config === null)
    return {
      status: "BLOCKED",
      code: "STORE1_V2_BASE_CONFIG_MISSING",
      detail:
        "No valid v2 base config exists. Initialize signing/config authority separately; this planner will not invent one.",
    };
  if (
    r.config.contractVersion !== STORE1_CONTRACT ||
    r.config.snapshotVersion !== "bootstrap_snapshot_v2" ||
    r.config.envelopeVersion !== "bootstrap_envelope_v2"
  )
    return conflict(
      "STORE1_V2_CONFIG_CONFLICT",
      "Latest v2 config has an unexpected snapshot/envelope shape.",
    );
  if (!r.config.compatibilityPolicyRevisionIds.includes(policy.id))
    return post(
      "/v1/admin/compatibility/config-releases/publish",
      {
        contractVersion: STORE1_CONTRACT,
        expectedLatestConfigVersion: r.config.configVersion,
        compatibilityPolicyRevisionIds: [policy.id],
        reason: STORE1_REASON,
      },
      "Add the exact STORE-1 policy to the current v2 config using CAS.",
    );

  if (r.adapters === undefined)
    return get(
      "/v1/admin/ai/registry/adapters?limit=100",
      "Read adapter registry before create/reuse.",
    );
  if (r.adapterNextCursor === undefined)
    return {
      status: "BLOCKED",
      code: "STORE1_ADAPTER_PAGINATION_UNKNOWN",
      detail:
        "Adapter readback is incomplete because nextCursor was not recorded.",
    };
  if (r.adapterNextCursor !== null)
    return get(
      "/v1/admin/ai/registry/adapters?limit=100&cursor=" +
        encodeURIComponent(r.adapterNextCursor),
      "Continue adapter pagination before deciding create/reuse.",
    );
  const adapter = exactOne(
    r.adapters,
    (value) => value.machineKey === "chatgpt",
  );
  if (adapter === "CONFLICT")
    return conflict(
      "STORE1_ADAPTER_CONFLICT",
      "Multiple chatgpt adapters exist.",
    );
  if (!adapter)
    return post(
      "/v1/admin/ai/registry/adapters",
      {
        machineKey: "chatgpt",
        displayName: "ChatGPT",
        description: "STORE-1 Standard reviewer slice",
        reason: STORE1_REASON,
      },
      "Create ChatGPT adapter through ordinary admin.",
    );
  if (adapter.status !== "ACTIVE")
    return conflict(
      "STORE1_ADAPTER_DISABLED",
      "ChatGPT adapter is not ACTIVE.",
    );

  if (r.surfaces === undefined)
    return get(
      `/v1/admin/ai/registry/adapters/${adapter.id}/surfaces?limit=100`,
      "Read ChatGPT surfaces before create/reuse.",
    );
  if (r.surfaceNextCursor === undefined)
    return {
      status: "BLOCKED",
      code: "STORE1_SURFACE_PAGINATION_UNKNOWN",
      detail:
        "Surface readback is incomplete because nextCursor was not recorded.",
    };
  if (r.surfaceNextCursor !== null)
    return get(
      `/v1/admin/ai/registry/adapters/${adapter.id}/surfaces?limit=100&cursor=${encodeURIComponent(r.surfaceNextCursor)}`,
      "Continue surface pagination before deciding create/reuse.",
    );
  const surface = exactOne(
    r.surfaces,
    (value) => value.machineKey === "standard",
  );
  if (surface === "CONFLICT")
    return conflict(
      "STORE1_SURFACE_CONFLICT",
      "Multiple standard surfaces exist.",
    );
  if (!surface)
    return post(
      "/v1/admin/ai/registry/surfaces",
      {
        adapterId: adapter.id,
        machineKey: "standard",
        displayName: "Standard",
        reason: STORE1_REASON,
      },
      "Create ChatGPT Standard surface.",
    );
  if (surface.status !== "ACTIVE")
    return conflict(
      "STORE1_SURFACE_DISABLED",
      "Standard surface is not ACTIVE.",
    );

  if (r.variants === undefined)
    return get(
      `/v1/admin/ai/registry/surfaces/${surface.id}/variants?limit=100`,
      "Read Standard variants before create/reuse.",
    );
  if (r.variantNextCursor === undefined)
    return {
      status: "BLOCKED",
      code: "STORE1_VARIANT_PAGINATION_UNKNOWN",
      detail:
        "Variant readback is incomplete because nextCursor was not recorded.",
    };
  if (r.variantNextCursor !== null)
    return get(
      `/v1/admin/ai/registry/surfaces/${surface.id}/variants?limit=100&cursor=${encodeURIComponent(r.variantNextCursor)}`,
      "Continue variant pagination before deciding create/reuse.",
    );
  const variant = exactOne(
    r.variants,
    (value) => value.machineKey === "standard_composer_v1",
  );
  if (variant === "CONFLICT")
    return conflict(
      "STORE1_VARIANT_CONFLICT",
      "Multiple standard_composer_v1 variants exist.",
    );
  if (!variant)
    return post(
      "/v1/admin/ai/registry/variants",
      {
        surfaceId: surface.id,
        machineKey: "standard_composer_v1",
        displayName: "Standard Composer v1",
        reason: STORE1_REASON,
      },
      "Create bounded Standard composer variant.",
    );
  if (variant.status !== "ACTIVE")
    return conflict(
      "STORE1_VARIANT_DISABLED",
      "Composer variant is not ACTIVE.",
    );

  if (r.profiles === undefined)
    return get(
      `/v1/admin/ai/profiles?adapterId=${adapter.id}&surfaceId=${surface.id}&variantId=${variant.id}&limit=100`,
      "Read exact scoped profiles before create/reuse.",
    );
  if (r.profileNextCursor === undefined)
    return {
      status: "BLOCKED",
      code: "STORE1_PROFILE_PAGINATION_UNKNOWN",
      detail:
        "Profile readback is incomplete because nextCursor was not recorded.",
    };
  if (r.profileNextCursor !== null)
    return get(
      `/v1/admin/ai/profiles?adapterId=${adapter.id}&surfaceId=${surface.id}&variantId=${variant.id}&limit=100&cursor=${encodeURIComponent(r.profileNextCursor)}`,
      "Continue profile pagination before deciding create/reuse.",
    );
  const profile = exactOne(
    r.profiles,
    (value) => value.machineKey === STORE1_PROFILE_KEY,
  );
  if (profile === "CONFLICT")
    return conflict(
      "STORE1_PROFILE_CONFLICT",
      "Multiple target profiles exist.",
    );
  if (!profile)
    return post(
      "/v1/admin/ai/profiles",
      {
        adapterId: adapter.id,
        surfaceId: surface.id,
        variantId: variant.id,
        machineKey: STORE1_PROFILE_KEY,
        displayName: "ChatGPT Standard Opera",
        reason: STORE1_REASON,
      },
      "Create immutable target profile identity.",
    );
  if (
    profile.status !== "ACTIVE" ||
    profile.adapterId !== adapter.id ||
    profile.surfaceId !== surface.id ||
    profile.variantId !== variant.id
  )
    return conflict(
      "STORE1_PROFILE_SCOPE_CONFLICT",
      "Existing target profile is disabled or bound to another hierarchy.",
    );

  if (r.profileRevisions === undefined)
    return get(
      `/v1/admin/ai/profiles/${profile.id}/revisions?limit=100`,
      "Read profile revisions and compare canonical content fingerprint.",
    );
  if (r.profileRevisionNextCursor === undefined)
    return {
      status: "BLOCKED",
      code: "STORE1_PROFILE_REVISION_PAGINATION_UNKNOWN",
      detail:
        "Profile revision readback is incomplete because nextCursor was not recorded.",
    };
  if (r.profileRevisionNextCursor !== null)
    return get(
      `/v1/admin/ai/profiles/${profile.id}/revisions?limit=100&cursor=${encodeURIComponent(r.profileRevisionNextCursor)}`,
      "Continue profile revision pagination before deciding create/reuse.",
    );
  const revision = exactOne(
    r.profileRevisions,
    (value) => value.contentSha256 === STORE1_PROFILE_SHA256,
  );
  if (revision === "CONFLICT")
    return conflict(
      "STORE1_PROFILE_REVISION_CONFLICT",
      "Multiple revisions share the exact target fingerprint.",
    );
  if (!revision)
    return post(
      `/v1/admin/ai/profiles/${profile.id}/revisions`,
      {
        content: STORE1_PROFILE_CONTENT,
        compatibility: STORE1_PROFILE_COMPATIBILITY,
        reason: STORE1_REASON,
      },
      "Create exact bounded profile draft.",
    );
  if (revision.state === "RETIRED")
    return conflict(
      "STORE1_PROFILE_REVISION_RETIRED",
      "Exact target revision was retired and is not reusable.",
    );
  if (revision.state === "DRAFT")
    return post(
      `/v1/admin/ai/profiles/${profile.id}/revisions/${revision.revision}/candidate`,
      { reason: STORE1_REASON },
      "Promote exact draft to candidate.",
    );
  if (revision.state === "CANDIDATE")
    return post(
      `/v1/admin/ai/profiles/${profile.id}/revisions/${revision.revision}/publish`,
      { reason: STORE1_REASON },
      "Publish exact candidate profile revision.",
    );

  if (r.assignments === undefined)
    return get(
      `/v1/admin/ai/assignments?adapterId=${adapter.id}&surfaceId=${surface.id}&variantId=${variant.id}&browserFamily=${STORE1_BROWSER}&subjectKind=ACCOUNT&limit=100`,
      "Read exact Opera account assignment scope.",
    );
  if (r.assignmentNextCursor === undefined)
    return {
      status: "BLOCKED",
      code: "STORE1_ASSIGNMENT_PAGINATION_UNKNOWN",
      detail:
        "Assignment readback is incomplete because nextCursor was not recorded.",
    };
  if (r.assignmentNextCursor !== null)
    return get(
      `/v1/admin/ai/assignments?adapterId=${adapter.id}&surfaceId=${surface.id}&variantId=${variant.id}&browserFamily=${STORE1_BROWSER}&subjectKind=ACCOUNT&limit=100&cursor=${encodeURIComponent(r.assignmentNextCursor)}`,
      "Continue assignment pagination before deciding create/reuse.",
    );
  if (r.assignments.length > 1)
    return conflict(
      "STORE1_ASSIGNMENT_CONFLICT",
      "Multiple assignments exist for the exact Opera account scope.",
    );
  const assignment = r.assignments[0] ?? null;
  if (!assignment)
    return post(
      "/v1/admin/ai/assignments",
      {
        adapterId: adapter.id,
        surfaceId: surface.id,
        variantId: variant.id,
        browserFamily: STORE1_BROWSER,
        subjectKind: "ACCOUNT",
        reason: STORE1_REASON,
      },
      "Create bounded Opera account assignment scope.",
    );
  if (!assignment.latest)
    return post(
      `/v1/admin/ai/assignments/${assignment.id}/direct`,
      {
        baselineProfileRevisionId: revision.id,
        expectedLatestAssignmentRevision: null,
        reason: STORE1_REASON,
      },
      "Select exact published profile through a DIRECT assignment.",
    );
  if (
    assignment.latest.mode !== "DIRECT" ||
    assignment.latest.baselineProfileRevisionId !== revision.id ||
    assignment.latest.candidateProfileRevisionId !== null ||
    assignment.latest.percentageBps !== 0
  )
    return conflict(
      "STORE1_ASSIGNMENT_TARGET_CONFLICT",
      "Existing Opera assignment points at another profile or rollout state.",
    );

  return {
    status: "READY",
    profileRevisionId: revision.id,
    assignmentId: assignment.id,
    rollback: [
      "Do not delete immutable extension/config/profile/assignment history.",
      "Correct compatibility/config authority by publishing a new revision with CAS.",
      "Correct profile selection by appending a new assignment revision.",
      "Keep beta CLOSED; reviewer access is existing ordinary identity + admission only.",
    ],
  };
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
function main(): void {
  if (process.argv[2] !== "plan")
    throw new Error(
      "Usage: tsx tooling/server/store1-opera-admin-activation.ts plan --manifest <B1_RC_MANIFEST.json> --zip <Opera zip> [--readback <safe JSON>]",
    );
  const manifestPath = arg("--manifest");
  const zipPath = arg("--zip");
  if (!manifestPath || !zipPath)
    throw new Error("STORE1_PACKAGE_INPUT_REQUIRED");
  const authority = readStore1PackageAuthority(manifestPath, zipPath);
  const readbackPath = arg("--readback");
  const readback = readbackPath
    ? (JSON.parse(
        readFileSync(readbackPath, "utf8"),
      ) as Store1ActivationReadback)
    : {};
  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: "store1_opera_admin_activation_plan_v1",
        authority,
        target: {
          browserFamily: STORE1_BROWSER,
          minimumBrowserVersion: STORE1_BROWSER_MINIMUM,
          profileContentSha256: STORE1_PROFILE_SHA256,
        },
        plan: planStore1Activation(authority, readback),
      },
      null,
      2,
    )}\n`,
  );
}

if (process.argv[1]?.endsWith("store1-opera-admin-activation.ts")) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "STORE1_PLAN_FAILED"}\n`,
    );
    process.exitCode = 1;
  }
}
