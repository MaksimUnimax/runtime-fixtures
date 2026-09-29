import { describe, expect, it } from "vitest";
import {
  STORE1_ACCEPTED_ARTIFACT_SHA256,
  STORE1_ACCEPTED_SOURCE_HEAD,
  STORE1_ACCEPTED_SOURCE_TREE,
  STORE1_CONTRACT,
  STORE1_AI_SURFACE,
  STORE1_POLICY_KEY,
  STORE1_PROFILE_KEY,
  STORE1_PROFILE_SHA256,
  STORE1_VERSION,
  planStore1Activation,
  type Store1ActivationReadback,
  type Store1PackageAuthority,
  type Store1V2SignaturePreflightProof,
} from "./store1-opera-admin-activation.js";
import { trustStore1V2SignaturePreflightProofForTest } from "./store1-v2-signature-preflight.js";

const authority: Store1PackageAuthority = {
  sourceHead: STORE1_ACCEPTED_SOURCE_HEAD,
  sourceTree: STORE1_ACCEPTED_SOURCE_TREE,
  version: STORE1_VERSION,
  contractVersion: STORE1_CONTRACT,
  artifactSha256: STORE1_ACCEPTED_ARTIFACT_SHA256,
  filename: `OCTOPORT_v${STORE1_VERSION}_CHROMIUM_STORE.zip`,
};
const previousProfileSha256 =
  "24b03fc9b89c3ec849e96bbc10ce8138382e29807e0e7251aca41ec2de357985";
const ids = {
  policy: "00000000-0000-4000-8000-000000000001",
  adapter: "00000000-0000-4000-8000-000000000002",
  surface: "00000000-0000-4000-8000-000000000003",
  variant: "00000000-0000-4000-8000-000000000004",
  profile: "00000000-0000-4000-8000-000000000005",
  revision: "00000000-0000-4000-8000-000000000006",
  assignment: "00000000-0000-4000-8000-000000000007",
  user: "00000000-0000-4000-8000-000000000008",
  account: "00000000-0000-4000-8000-000000000009",
  device: "00000000-0000-4000-8000-000000000010",
};
function exactSignatureProof(): Store1V2SignaturePreflightProof {
  return trustStore1V2SignaturePreflightProofForTest({
    schemaVersion: "store1_v2_signature_preflight_v1",
    verified: true,
    artifactSha256: STORE1_ACCEPTED_ARTIFACT_SHA256,
    trustBundleSha256: "c".repeat(64),
    contractVersion: STORE1_CONTRACT,
    snapshotVersion: "bootstrap_snapshot_v2",
    envelopeVersion: "bootstrap_envelope_v2",
    configVersion: 8,
    configContentHashSha256: "a".repeat(64),
    configSourceFingerprintSha256: "b".repeat(64),
    signingKeyId: "store1-preprod-base",
    accountId: ids.account,
    deviceId: ids.device,
    extensionVersion: STORE1_VERSION,
    browserFamily: "opera",
    browserVersion: "136",
    controlApiOrigin: "https://api.octoport.test",
    serverTime: "2030-01-01T00:00:00.000Z",
    expiresAt: "2030-01-01T00:15:00.000Z",
    aiStatus: "UNCONFIGURED",
  });
}
function exactReadback(): Store1ActivationReadback {
  return {
    signaturePreflight: exactSignatureProof(),
    release: {
      version: STORE1_VERSION,
      releaseChannel: "stable",
      artifactSha256: authority.artifactSha256,
      supportedContracts: [STORE1_CONTRACT],
      supportedBrowsers: ["opera"],
    },
    policies: [
      {
        id: ids.policy,
        policyKey: STORE1_POLICY_KEY,
        contractVersion: STORE1_CONTRACT,
        browserFamily: "opera",
        minimumExtensionVersion: STORE1_VERSION,
        recommendedExtensionVersion: STORE1_VERSION,
        minimumBrowserVersion: "136",
        maintenanceMode: false,
        maintenanceCode: null,
        blockedVersions: [],
        linkedConfigVersions: [8],
      },
    ],
    config: {
      configVersion: 8,
      contractVersion: STORE1_CONTRACT,
      snapshotVersion: "bootstrap_snapshot_v2",
      envelopeVersion: "bootstrap_envelope_v2",
      contentHashSha256: "a".repeat(64),
      sourceFingerprintSha256: "b".repeat(64),
      signingKeyId: "store1-preprod-base",
      signingKeyState: "ACTIVE",
      compatibilityPolicyRevisionIds: [ids.policy],
    },
    adapters: [{ id: ids.adapter, machineKey: "chatgpt", status: "ACTIVE" }],
    adapterNextCursor: null,
    surfaces: [
      { id: ids.surface, machineKey: STORE1_AI_SURFACE, status: "ACTIVE" },
    ],
    surfaceNextCursor: null,
    variants: [
      {
        id: ids.variant,
        machineKey: "standard_composer_v1",
        status: "ACTIVE",
      },
    ],
    variantNextCursor: null,
    profiles: [
      {
        id: ids.profile,
        machineKey: STORE1_PROFILE_KEY,
        status: "ACTIVE",
        adapterId: ids.adapter,
        surfaceId: ids.surface,
        variantId: null,
      },
    ],
    profileNextCursor: null,
    profileRevisions: [
      {
        id: ids.revision,
        revision: 1,
        state: "PUBLISHED",
        contentSha256: STORE1_PROFILE_SHA256,
      },
    ],
    profileRevisionNextCursor: null,
    assignments: [
      {
        id: ids.assignment,
        adapterId: ids.adapter,
        surfaceId: ids.surface,
        variantId: null,
        browserFamily: "opera",
        subjectKind: "ACCOUNT",
        latest: {
          revision: 1,
          mode: "DIRECT",
          baselineProfileRevisionId: ids.revision,
          candidateProfileRevisionId: null,
          percentageBps: 0,
        },
      },
    ],
    assignmentNextCursor: null,
    betaState: { mode: "CLOSED" },
    reviewerUser: {
      id: ids.user,
      status: "ACTIVE",
      queriedEmailVerified: true,
    },
    reviewerAccounts: [{ id: ids.account, status: "ACTIVE" }],
    reviewerAccountNextCursor: null,
    reviewerAdmission: { accountId: ids.account, admitted: true },
  };
}

describe("STORE-1 ordinary-admin activation planner", () => {
  it("completes CLOSED-beta reviewer preflight before catalog reads", () => {
    expect(planStore1Activation(authority, {})).toMatchObject({
      status: "READ",
      next: {
        method: "GET",
        path: "/v1/admin/beta/admission",
      },
    });
  });

  it("rejects non-accepted package authority before any read or mutation", () => {
    expect(
      planStore1Activation(
        { ...authority, artifactSha256: "c".repeat(64) },
        exactReadback(),
      ),
    ).toMatchObject({
      status: "CONFLICT",
      code: "STORE1_PACKAGE_AUTHORITY_CONFLICT",
    });
  });

  it("rejects the superseded 0.2.5 package authority before any read or mutation", () => {
    const stale = {
      sourceHead: "68f1621376be4d7aeeff44bc76cc326f8cc64954",
      sourceTree: "8eb20bbc19bbbaaa73ca1a9ba139efa90194ea9a",
      version: "0.2.5",
      contractVersion: STORE1_CONTRACT,
      artifactSha256:
        "33cbf1ad9ec4669abe3a65e24cfbaead4c7c3a1fa711261b2d186d107c33aea1",
      filename: "OCTOPORT_v0.2.5_CHROMIUM_STORE.zip",
    } as unknown as Store1PackageAuthority;
    expect(planStore1Activation(stale, exactReadback())).toMatchObject({
      status: "CONFLICT",
      code: "STORE1_PACKAGE_AUTHORITY_CONFLICT",
    });
  });

  it("publishes only the exact accepted package after reviewer preflight", () => {
    const r = exactReadback();
    r.release = null;
    expect(planStore1Activation(authority, r)).toMatchObject({
      status: "POST",
      next: {
        path: `/v1/admin/compatibility/releases/${STORE1_VERSION}/publish`,
        body: {
          version: STORE1_VERSION,
          artifactSha256: STORE1_ACCEPTED_ARTIFACT_SHA256,
          supportedContracts: ["control_plane_v2"],
          supportedBrowsers: ["opera"],
        },
      },
    });
  });
  it("fails closed on an immutable release hash mismatch", () => {
    const r = exactReadback();
    r.release = { ...r.release!, artifactSha256: "d".repeat(64) };
    expect(planStore1Activation(authority, r)).toMatchObject({
      status: "CONFLICT",
      code: "STORE1_RELEASE_CONFLICT",
    });
  });

  it("appends the 0.2.7 policy only over the exact accepted 0.2.6 predecessor", () => {
    const r = exactReadback();
    r.policies = [
      {
        ...r.policies![0]!,
        minimumExtensionVersion: "0.2.6",
        recommendedExtensionVersion: "0.2.6",
      },
    ];
    expect(planStore1Activation(authority, r)).toMatchObject({
      status: "POST",
      next: {
        path: `/v1/admin/compatibility/policies/${STORE1_POLICY_KEY}/publish`,
        body: {
          contractVersion: STORE1_CONTRACT,
          browserFamily: "opera",
          minimumExtensionVersion: STORE1_VERSION,
          recommendedExtensionVersion: STORE1_VERSION,
          minimumBrowserVersion: "136",
          maintenanceMode: false,
          maintenanceCode: null,
          blockedVersions: [],
        },
      },
    });
  });

  it("keeps a near-miss predecessor policy fail-closed", () => {
    const r = exactReadback();
    r.policies = [
      {
        ...r.policies![0]!,
        minimumExtensionVersion: "0.2.6",
        recommendedExtensionVersion: "0.2.6",
        minimumBrowserVersion: "135",
      },
    ];
    expect(planStore1Activation(authority, r)).toMatchObject({
      status: "CONFLICT",
      code: "STORE1_POLICY_CONFLICT",
    });
  });

  it("checks v2 base before a pending release mutation", () => {
    const r = exactReadback();
    r.release = null;
    delete r.config;
    expect(planStore1Activation(authority, r)).toMatchObject({
      status: "READ",
      next: {
        path: "/v1/admin/compatibility/config-releases/latest?contractVersion=control_plane_v2",
      },
    });
  });

  it("reports a missing v2 base before a pending release mutation", () => {
    const r = exactReadback();
    r.release = null;
    r.config = null;
    expect(planStore1Activation(authority, r)).toMatchObject({
      status: "BLOCKED",
      code: "STORE1_V2_BASE_CONFIG_MISSING",
    });
  });

  it("blocks a non-active v2 signing key before any catalog mutation", () => {
    const r = exactReadback();
    r.release = null;
    r.config = { ...r.config!, signingKeyState: "RETIRED" };
    expect(planStore1Activation(authority, r)).toMatchObject({
      status: "BLOCKED",
      code: "STORE1_V2_BASE_SIGNING_KEY_NOT_ACTIVE",
    });
  });

  it("requires cryptographic v2 proof before a pending catalog mutation", () => {
    const r = exactReadback();
    r.release = null;
    delete r.signaturePreflight;
    expect(planStore1Activation(authority, r)).toMatchObject({
      status: "BLOCKED",
      code: "STORE1_V2_SIGNATURE_PREFLIGHT_REQUIRED",
    });
  });

  it("rejects caller-controlled serialized proof before any catalog mutation", () => {
    const r = exactReadback();
    r.release = null;
    r.signaturePreflight = JSON.parse(
      JSON.stringify(r.signaturePreflight),
    ) as Store1V2SignaturePreflightProof;
    expect(planStore1Activation(authority, r)).toMatchObject({
      status: "BLOCKED",
      code: "STORE1_V2_SIGNATURE_PREFLIGHT_UNTRUSTED",
    });
  });

  it("blocks an expired trusted signature proof before any catalog mutation", () => {
    const r = exactReadback();
    r.release = null;
    r.signaturePreflight = trustStore1V2SignaturePreflightProofForTest({
      ...r.signaturePreflight!,
      serverTime: "2020-01-01T00:00:00.000Z",
      expiresAt: "2020-01-01T00:15:00.000Z",
    });
    expect(planStore1Activation(authority, r)).toMatchObject({
      status: "BLOCKED",
      code: "STORE1_V2_SIGNATURE_PREFLIGHT_EXPIRED",
    });
  });

  it("blocks a stale signature proof when current config identity changes", () => {
    const r = exactReadback();
    r.release = null;
    r.signaturePreflight = trustStore1V2SignaturePreflightProofForTest({
      ...r.signaturePreflight!,
      configContentHashSha256: "d".repeat(64),
    });
    expect(planStore1Activation(authority, r)).toMatchObject({
      status: "BLOCKED",
      code: "STORE1_V2_SIGNATURE_PREFLIGHT_STALE",
    });
  });

  it.each([
    ["signing key", { signingKeyId: "other-active-key" }],
    ["reviewer account", { accountId: "00000000-0000-4000-8000-000000000099" }],
  ])("rejects mismatched signature proof: %s", (_label, change) => {
    const r = exactReadback();
    r.release = null;
    r.signaturePreflight = trustStore1V2SignaturePreflightProofForTest({
      ...r.signaturePreflight!,
      ...change,
    });
    expect(planStore1Activation(authority, r)).toMatchObject({
      status: "CONFLICT",
      code: "STORE1_V2_SIGNATURE_PREFLIGHT_CONFLICT",
    });
  });

  it("blocks a missing reviewer before a pending release mutation", () => {
    const r = exactReadback();
    r.release = null;
    r.reviewerUser = null;
    expect(planStore1Activation(authority, r)).toMatchObject({
      status: "BLOCKED",
      code: "STORE1_REVIEWER_IDENTITY_PREEXISTING_REQUIRED",
    });
  });

  it("blocks a null reviewer admission readback instead of throwing", () => {
    const r = exactReadback();
    r.release = null;
    r.reviewerAdmission = null;
    expect(planStore1Activation(authority, r)).toMatchObject({
      status: "BLOCKED",
      code: "STORE1_REVIEWER_BETA_ADMISSION_REQUIRED",
    });
  });

  it("blocks an unverified queried reviewer email before any catalog mutation", () => {
    const r = exactReadback();
    r.release = null;
    r.reviewerUser = {
      id: ids.user,
      status: "ACTIVE",
      queriedEmailVerified: false,
    };
    expect(planStore1Activation(authority, r)).toMatchObject({
      status: "BLOCKED",
      code: "STORE1_REVIEWER_EMAIL_VERIFIED_REQUIRED",
    });
  });

  it("targets the packaged ChatGPT web surface instead of legacy Standard", () => {
    const r = exactReadback();
    r.surfaces = [
      {
        id: "00000000-0000-4000-8000-000000000011",
        machineKey: "standard",
        status: "ACTIVE",
      },
    ];
    r.surfaceNextCursor = null;
    expect(planStore1Activation(authority, r)).toMatchObject({
      status: "POST",
      next: {
        path: "/v1/admin/ai/registry/surfaces",
        body: {
          adapterId: ids.adapter,
          machineKey: "web",
          displayName: "Web",
        },
      },
    });
  });

  it("creates a distinct web/null profile and never reuses legacy variant scope", () => {
    const r = exactReadback();
    r.profiles = [
      {
        id: "00000000-0000-4000-8000-000000000012",
        machineKey: "chatgpt-standard-opera-v1",
        status: "ACTIVE",
        adapterId: ids.adapter,
        surfaceId: ids.surface,
        variantId: ids.variant,
      },
    ];
    r.profileNextCursor = null;
    expect(planStore1Activation(authority, r)).toMatchObject({
      status: "POST",
      next: {
        path: "/v1/admin/ai/profiles",
        body: {
          adapterId: ids.adapter,
          surfaceId: ids.surface,
          variantId: null,
          machineKey: STORE1_PROFILE_KEY,
          displayName: "ChatGPT Web Opera",
        },
      },
    });
  });

  it("creates a null-variant Opera assignment when only a legacy variant assignment exists", () => {
    const r = exactReadback();
    r.assignments = [
      {
        id: "00000000-0000-4000-8000-000000000013",
        adapterId: ids.adapter,
        surfaceId: ids.surface,
        variantId: ids.variant,
        browserFamily: "opera",
        subjectKind: "ACCOUNT",
        latest: {
          revision: 1,
          mode: "DIRECT",
          baselineProfileRevisionId: ids.revision,
          candidateProfileRevisionId: null,
          percentageBps: 0,
        },
      },
    ];
    r.assignmentNextCursor = null;
    expect(planStore1Activation(authority, r)).toMatchObject({
      status: "POST",
      next: {
        path: "/v1/admin/ai/assignments",
        body: {
          adapterId: ids.adapter,
          surfaceId: ids.surface,
          variantId: null,
          browserFamily: "opera",
          subjectKind: "ACCOUNT",
        },
      },
    });
  });

  it("advances the exact accepted 0.2.6 assignment predecessor with CAS", () => {
    const r = exactReadback();
    const previousRevisionId = "00000000-0000-4000-8000-000000000014";
    r.profileRevisions = [
      {
        id: previousRevisionId,
        revision: 1,
        state: "PUBLISHED",
        contentSha256: previousProfileSha256,
      },
      {
        id: ids.revision,
        revision: 2,
        state: "PUBLISHED",
        contentSha256: STORE1_PROFILE_SHA256,
      },
    ];
    r.assignments![0]!.latest = {
      revision: 1,
      mode: "DIRECT",
      baselineProfileRevisionId: previousRevisionId,
      candidateProfileRevisionId: null,
      percentageBps: 0,
    };
    expect(planStore1Activation(authority, r)).toMatchObject({
      status: "POST",
      next: {
        path: `/v1/admin/ai/assignments/${ids.assignment}/direct`,
        body: {
          baselineProfileRevisionId: ids.revision,
          expectedLatestAssignmentRevision: 1,
        },
      },
    });
  });

  it("keeps a non-exact predecessor assignment fail-closed", () => {
    const r = exactReadback();
    const previousRevisionId = "00000000-0000-4000-8000-000000000014";
    r.profileRevisions = [
      {
        id: previousRevisionId,
        revision: 1,
        state: "PUBLISHED",
        contentSha256: "e".repeat(64),
      },
      {
        id: ids.revision,
        revision: 2,
        state: "PUBLISHED",
        contentSha256: STORE1_PROFILE_SHA256,
      },
    ];
    r.assignments![0]!.latest = {
      revision: 1,
      mode: "DIRECT",
      baselineProfileRevisionId: previousRevisionId,
      candidateProfileRevisionId: null,
      percentageBps: 0,
    };
    expect(planStore1Activation(authority, r)).toMatchObject({
      status: "CONFLICT",
      code: "STORE1_ASSIGNMENT_TARGET_CONFLICT",
    });
  });

  it("does not upgrade a predecessor assignment with rollout state", () => {
    const r = exactReadback();
    const previousRevisionId = "00000000-0000-4000-8000-000000000014";
    r.profileRevisions = [
      {
        id: previousRevisionId,
        revision: 1,
        state: "PUBLISHED",
        contentSha256: previousProfileSha256,
      },
      {
        id: ids.revision,
        revision: 2,
        state: "PUBLISHED",
        contentSha256: STORE1_PROFILE_SHA256,
      },
    ];
    r.assignments![0]!.latest = {
      revision: 3,
      mode: "ROLLOUT",
      baselineProfileRevisionId: previousRevisionId,
      candidateProfileRevisionId: ids.revision,
      percentageBps: 5000,
    };
    expect(planStore1Activation(authority, r)).toMatchObject({
      status: "CONFLICT",
      code: "STORE1_ASSIGNMENT_TARGET_CONFLICT",
    });
  });

  it("continues every paginated catalog collection before absence decisions", () => {
    const cases = [
      ["adapters", "adapterNextCursor", ids.adapter],
      ["surfaces", "surfaceNextCursor", ids.surface],
      ["profiles", "profileNextCursor", ids.profile],
      ["assignments", "assignmentNextCursor", ids.assignment],
    ] as const;
    for (const [itemsKey, cursorKey, cursor] of cases) {
      const r = exactReadback() as Store1ActivationReadback &
        Record<string, unknown>;
      r[itemsKey] = [];
      r[cursorKey] = cursor;
      const plan = planStore1Activation(authority, r);
      expect(plan).toMatchObject({ status: "READ" });
      if (plan.status !== "READ") throw new Error("expected READ");
      expect(plan.next.path).toContain("cursor=" + cursor);
    }
  });

  it("blocks unknown completeness for every paginated catalog collection", () => {
    const cases = [
      ["adapters", "adapterNextCursor", "STORE1_ADAPTER_PAGINATION_UNKNOWN"],
      ["surfaces", "surfaceNextCursor", "STORE1_SURFACE_PAGINATION_UNKNOWN"],
      ["profiles", "profileNextCursor", "STORE1_PROFILE_PAGINATION_UNKNOWN"],
      [
        "assignments",
        "assignmentNextCursor",
        "STORE1_ASSIGNMENT_PAGINATION_UNKNOWN",
      ],
    ] as const;
    for (const [itemsKey, cursorKey, code] of cases) {
      const r = exactReadback() as Store1ActivationReadback &
        Record<string, unknown>;
      r[itemsKey] = [];
      delete r[cursorKey];
      expect(planStore1Activation(authority, r)).toMatchObject({
        status: "BLOCKED",
        code,
      });
    }
  });

  it("continues reviewer ACTIVE-account pagination before admission read", () => {
    const r = exactReadback();
    r.reviewerAccounts = [];
    r.reviewerAccountNextCursor = ids.account;
    expect(planStore1Activation(authority, r)).toMatchObject({
      status: "READ",
      next: {
        path:
          "/v1/admin/accounts?ownerEmail=<REVIEWER_EMAIL_PRIVATE>&status=ACTIVE&limit=100&cursor=" +
          ids.account,
      },
    });
  });

  it("blocks ambiguous reviewer ACTIVE accounts after complete pagination", () => {
    const r = exactReadback();
    r.reviewerAccounts = [
      { id: ids.account, status: "ACTIVE" },
      {
        id: "00000000-0000-4000-8000-000000000011",
        status: "ACTIVE",
      },
    ];
    expect(planStore1Activation(authority, r)).toMatchObject({
      status: "BLOCKED",
      code: "STORE1_REVIEWER_ACCOUNT_AMBIGUOUS",
    });
  });

  it("fails closed when profile revision pagination completeness is unknown", () => {
    const r = exactReadback();
    r.profileRevisions = [];
    delete r.profileRevisionNextCursor;
    expect(planStore1Activation(authority, r)).toMatchObject({
      status: "BLOCKED",
      code: "STORE1_PROFILE_REVISION_PAGINATION_UNKNOWN",
    });
  });

  it("continues profile revision pagination before deciding to create", () => {
    const r = exactReadback();
    r.profileRevisions = [];
    r.profileRevisionNextCursor = ids.revision;
    expect(planStore1Activation(authority, r)).toMatchObject({
      status: "READ",
      next: {
        path:
          "/v1/admin/ai/profiles/" +
          ids.profile +
          "/revisions?limit=100&cursor=" +
          ids.revision,
      },
    });
  });

  it("detects duplicate exact fingerprints after complete pagination", () => {
    const r = exactReadback();
    r.profileRevisions = [
      ...r.profileRevisions!,
      {
        id: "00000000-0000-4000-8000-000000000010",
        revision: 2,
        state: "PUBLISHED",
        contentSha256: STORE1_PROFILE_SHA256,
      },
    ];
    expect(planStore1Activation(authority, r)).toMatchObject({
      status: "CONFLICT",
      code: "STORE1_PROFILE_REVISION_CONFLICT",
    });
  });

  it("reaches READY only for the exact catalog and admitted reviewer", () => {
    expect(planStore1Activation(authority, exactReadback())).toMatchObject({
      status: "READY",
      profileRevisionId: ids.revision,
      assignmentId: ids.assignment,
    });
  });
});
