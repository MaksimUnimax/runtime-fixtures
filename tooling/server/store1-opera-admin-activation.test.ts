import { describe, expect, it } from "vitest";
import {
  STORE1_ACCEPTED_ARTIFACT_SHA256,
  STORE1_ACCEPTED_SOURCE_HEAD,
  STORE1_ACCEPTED_SOURCE_TREE,
  STORE1_CONTRACT,
  STORE1_POLICY_KEY,
  STORE1_PROFILE_SHA256,
  STORE1_VERSION,
  planStore1Activation,
  type Store1ActivationReadback,
  type Store1PackageAuthority,
} from "./store1-opera-admin-activation.js";

const authority: Store1PackageAuthority = {
  sourceHead: STORE1_ACCEPTED_SOURCE_HEAD,
  sourceTree: STORE1_ACCEPTED_SOURCE_TREE,
  version: STORE1_VERSION,
  contractVersion: STORE1_CONTRACT,
  artifactSha256: STORE1_ACCEPTED_ARTIFACT_SHA256,
  filename: "OCTOPORT_v0.2.4_CHROMIUM_STORE.zip",
};
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
};
function exactReadback(): Store1ActivationReadback {
  return {
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
      compatibilityPolicyRevisionIds: [ids.policy],
    },
    adapters: [{ id: ids.adapter, machineKey: "chatgpt", status: "ACTIVE" }],
    adapterNextCursor: null,
    surfaces: [{ id: ids.surface, machineKey: "standard", status: "ACTIVE" }],
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
        machineKey: "chatgpt-standard-opera-v1",
        status: "ACTIVE",
        adapterId: ids.adapter,
        surfaceId: ids.surface,
        variantId: ids.variant,
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

  it("publishes only the exact accepted package after reviewer preflight", () => {
    const r = exactReadback();
    r.release = null;
    expect(planStore1Activation(authority, r)).toMatchObject({
      status: "POST",
      next: {
        path: "/v1/admin/compatibility/releases/0.2.4/publish",
        body: {
          version: "0.2.4",
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

  it("reports a missing v2 base config instead of inventing signing authority", () => {
    const r = exactReadback();
    r.config = null;
    expect(planStore1Activation(authority, r)).toMatchObject({
      status: "BLOCKED",
      code: "STORE1_V2_BASE_CONFIG_MISSING",
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

  it("continues every paginated catalog collection before absence decisions", () => {
    const cases = [
      ["adapters", "adapterNextCursor", ids.adapter],
      ["surfaces", "surfaceNextCursor", ids.surface],
      ["variants", "variantNextCursor", ids.variant],
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
      ["variants", "variantNextCursor", "STORE1_VARIANT_PAGINATION_UNKNOWN"],
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
