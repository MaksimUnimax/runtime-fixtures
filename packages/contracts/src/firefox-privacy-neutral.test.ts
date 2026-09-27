import { describe, expect, it } from "vitest";
import {
  AdminDeviceItemV1Schema,
  BootstrapRequestV2Schema,
  BootstrapRequestV3Schema,
  BootstrapRequestSchema,
  ControlPlaneContractVersionSchema,
  BootstrapSnapshotPayloadV2Schema,
  BootstrapSnapshotPayloadV3Schema,
  BootstrapSnapshotPayloadSchema,
  SignedBootstrapEnvelopeSchema,
  LocalClientAuthorityV1Schema,
} from "./index.js";

const deviceId = "22222222-2222-4222-8222-222222222222";
const accountId = "11111111-1111-4111-8111-111111111111";
const detectedAi = { family: "chatgpt", surface: "page" };

const localAuthority = {
  schemaVersion: "local_client_authority_v1" as const,
  contractVersion: "control_plane_v2" as const,
  compatibility: {
    releases: [
      {
        extensionVersion: "0.2.4",
        contractVersions: ["control_plane_v2" as const],
        browserFamilies: ["firefox" as const],
      },
    ],
    policies: [],
  },
  featureRules: [],
  ai: { status: "UNCONFIGURED" as const },
};

const commonPayload = {
  snapshotVersion: "bootstrap_snapshot_v2" as const,
  contractVersion: "control_plane_v2" as const,
  configVersion: 1,
  issuedAt: "2026-09-25T00:00:00.000Z",
  serverTime: "2026-09-25T00:00:00.000Z",
  expiresAt: "2026-09-25T00:15:00.000Z",
  offlineGraceUntil: "2026-09-26T00:15:00.000Z",
  accessBasis: "BETA" as const,
  account: { id: accountId, status: "ACTIVE" as const },
  subscription: { state: "NONE" as const, planRevision: null },
  devicePolicy: { status: "ACTIVE" as const },
  entitlements: {},
};

describe("Firefox privacy-neutral shared bootstrap contract", () => {
  it("accepts exact identified and privacy-neutral v2 request variants", () => {
    expect(
      BootstrapRequestV2Schema.safeParse({
        contractVersion: "control_plane_v2",
        extensionVersion: "0.2.4",
        browser: { family: "firefox", version: "141.0" },
        deviceId,
        lastConfigVersion: null,
        detectedAi,
      }).success,
    ).toBe(true);
    expect(
      BootstrapRequestV2Schema.safeParse({
        contractVersion: "control_plane_v2",
        deviceId,
        lastConfigVersion: null,
        detectedAi,
      }).success,
    ).toBe(true);
  });

  it("rejects every partial or placeholder technical metadata request", () => {
    for (const value of [
      {
        contractVersion: "control_plane_v2",
        extensionVersion: "0.2.4",
        deviceId,
        lastConfigVersion: null,
      },
      {
        contractVersion: "control_plane_v2",
        browser: { family: "firefox", version: "141.0" },
        deviceId,
        lastConfigVersion: null,
      },
      {
        contractVersion: "control_plane_v2",
        browser: { family: "unknown", version: "0" },
        extensionVersion: "0.0.0",
        deviceId,
        lastConfigVersion: null,
      },
    ])
      expect(BootstrapRequestV2Schema.safeParse(value).success).toBe(false);
  });
  it("accepts the bounded local authority and rejects duplicate release identity", () => {
    expect(LocalClientAuthorityV1Schema.safeParse(localAuthority).success).toBe(
      true,
    );
    expect(
      LocalClientAuthorityV1Schema.safeParse({
        ...localAuthority,
        compatibility: {
          ...localAuthority.compatibility,
          releases: [
            ...localAuthority.compatibility.releases,
            ...localAuthority.compatibility.releases,
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("keeps identified and privacy-neutral signed payloads mutually exclusive", () => {
    const identified = {
      ...commonPayload,
      compatibility: {
        extension: { status: "SUPPORTED" as const, minimumVersion: null },
        browser: { status: "SUPPORTED" as const },
      },
      features: {},
      ai: { status: "UNCONFIGURED" as const },
    };
    const neutral = {
      ...commonPayload,
      localClientAuthority: localAuthority,
    };
    expect(BootstrapSnapshotPayloadV2Schema.safeParse(identified).success).toBe(
      true,
    );
    expect(BootstrapSnapshotPayloadV2Schema.safeParse(neutral).success).toBe(
      true,
    );
    expect(
      BootstrapSnapshotPayloadV2Schema.safeParse({
        ...neutral,
        compatibility: identified.compatibility,
      }).success,
    ).toBe(false);
    expect(
      BootstrapSnapshotPayloadV2Schema.safeParse({
        ...identified,
        localClientAuthority: localAuthority,
      }).success,
    ).toBe(false);
  });
});

describe("dormant bootstrap v3 contract", () => {
  const paid = {
    ...commonPayload,
    snapshotVersion: "bootstrap_snapshot_v3" as const,
    contractVersion: "control_plane_v3" as const,
    accessBasis: "COMMERCIAL" as const,
    account: { id: accountId, status: "ACTIVE" as const },
    subscription: { state: "ACTIVE" as const, planRevision: "plan-r1" },
    subscriptionAccess: {
      schemaVersion: "subscription_access_v1" as const,
      paidThrough: "2026-09-25T00:00:00.000Z",
      offlineHardUntil: "2026-09-28T00:00:00.000Z",
    },
  };
  const identifiedPaid = {
    ...paid,
    compatibility: {
      extension: { status: "SUPPORTED" as const, minimumVersion: null },
      browser: { status: "SUPPORTED" as const },
    },
    features: {},
    ai: { status: "UNCONFIGURED" as const },
  };
  const neutralPaid = {
    ...paid,
    localClientAuthority: {
      schemaVersion: "local_client_authority_v2" as const,
      contractVersion: "control_plane_v3" as const,
      compatibility: {
        releases: [
          {
            extensionVersion: "0.3.0",
            contractVersions: [
              "control_plane_v2" as const,
              "control_plane_v3" as const,
            ],
            browserFamilies: ["firefox" as const],
          },
        ],
        policies: [],
      },
      featureRules: [],
      ai: { status: "UNCONFIGURED" as const },
    },
  };

  it("parses standalone v3 requests and snapshots while active unions reject v3", () => {
    expect(
      BootstrapRequestV3Schema.safeParse({
        contractVersion: "control_plane_v3",
        extensionVersion: "0.3.0",
        browser: { family: "firefox", version: "141.0" },
        deviceId,
        lastConfigVersion: null,
        detectedAi,
      }).success,
    ).toBe(true);
    expect(
      BootstrapRequestV3Schema.safeParse({
        contractVersion: "control_plane_v3",
        deviceId,
        lastConfigVersion: null,
      }).success,
    ).toBe(true);
    expect(
      BootstrapSnapshotPayloadV3Schema.safeParse(identifiedPaid).success,
    ).toBe(true);
    expect(
      BootstrapSnapshotPayloadV3Schema.safeParse(neutralPaid).success,
    ).toBe(true);
    const { accessBasis: _accessBasis, ...withoutAccessBasis } = identifiedPaid;
    expect(
      BootstrapSnapshotPayloadV3Schema.safeParse(withoutAccessBasis).success,
    ).toBe(false);
    expect(
      BootstrapSnapshotPayloadSchema.safeParse(identifiedPaid).success,
    ).toBe(false);
    expect(
      ControlPlaneContractVersionSchema.safeParse("control_plane_v3").success,
    ).toBe(false);
    expect(
      BootstrapRequestSchema.safeParse({
        contractVersion: "control_plane_v3",
        deviceId,
        lastConfigVersion: null,
      }).success,
    ).toBe(false);
    expect(
      SignedBootstrapEnvelopeSchema.safeParse({
        envelopeVersion: "bootstrap_envelope_v3",
        algorithm: "Ed25519",
        keyId: "key-1",
        payload: "e30",
        signature: "AA",
      }).success,
    ).toBe(false);
  });

  it("requires exactly +72 hours and null subscriptionAccess for BETA/NONE", () => {
    for (const delta of [-1, 1]) {
      const date = new Date(
        Date.parse(paid.subscriptionAccess.offlineHardUntil) + delta,
      ).toISOString();
      expect(
        BootstrapSnapshotPayloadV3Schema.safeParse({
          ...identifiedPaid,
          subscriptionAccess: {
            ...paid.subscriptionAccess,
            offlineHardUntil: date,
          },
        }).success,
      ).toBe(false);
    }
    expect(
      BootstrapSnapshotPayloadV3Schema.safeParse({
        ...identifiedPaid,
        accessBasis: "BETA",
        subscriptionAccess: paid.subscriptionAccess,
      }).success,
    ).toBe(false);
    expect(
      BootstrapSnapshotPayloadV3Schema.safeParse({
        ...identifiedPaid,
        accessBasis: "NONE",
        subscriptionAccess: paid.subscriptionAccess,
      }).success,
    ).toBe(false);
    expect(
      BootstrapSnapshotPayloadV3Schema.safeParse({
        ...identifiedPaid,
        accessBasis: "BETA",
        subscriptionAccess: null,
      }).success,
    ).toBe(true);
    expect(
      BootstrapSnapshotPayloadV3Schema.safeParse({
        ...identifiedPaid,
        accessBasis: "NONE",
        subscription: { state: "NONE", planRevision: null },
        subscriptionAccess: null,
      }).success,
    ).toBe(true);
    for (const state of ["ACTIVE", "GRACE", "CANCELED"] as const) {
      expect(
        BootstrapSnapshotPayloadV3Schema.safeParse({
          ...identifiedPaid,
          accessBasis: "COMMERCIAL",
          subscription: { state, planRevision: "plan-r1" },
          subscriptionAccess: null,
        }).success,
      ).toBe(false);
    }
    expect(
      BootstrapSnapshotPayloadV3Schema.safeParse({
        ...identifiedPaid,
        accessBasis: "COMMERCIAL",
        subscription: { state: "TRIAL", planRevision: "plan-r1" },
        subscriptionAccess: null,
      }).success,
    ).toBe(true);
    expect(
      BootstrapSnapshotPayloadV3Schema.safeParse({
        ...identifiedPaid,
        accessBasis: "COMMERCIAL",
        subscription: { state: "TRIAL", planRevision: "plan-r1" },
        subscriptionAccess: paid.subscriptionAccess,
      }).success,
    ).toBe(false);
  });

  it("keeps legacy freshness separate from the commercial offline hard deadline", () => {
    expect(
      BootstrapSnapshotPayloadV3Schema.safeParse({
        ...identifiedPaid,
        subscription: { state: "GRACE", planRevision: "plan-r1" },
        offlineGraceUntil: "2026-10-10T00:00:00.000Z",
        subscriptionAccess: {
          ...paid.subscriptionAccess,
          paidThrough: "2026-09-25T00:00:00.000Z",
          offlineHardUntil: "2026-09-28T00:00:00.000Z",
        },
      }).success,
    ).toBe(true);
  });
});

describe("admin device privacy-neutral projection contract", () => {
  const base = {
    id: deviceId,
    status: "ACTIVE" as const,
    label: "Work browser",
    createdAt: "2026-09-25T00:00:00.000Z",
    activatedAt: "2026-09-25T00:00:01.000Z",
    lastSeenAt: "2026-09-25T00:00:02.000Z",
    revokedAt: null,
  };

  it("accepts exact withheld and present admin device projections", () => {
    expect(AdminDeviceItemV1Schema.safeParse(base).success).toBe(true);
    expect(
      AdminDeviceItemV1Schema.safeParse({
        ...base,
        browserFamily: "firefox",
        browserVersionLastSeen: "155.0",
        extensionVersionLastSeen: "0.2.4",
      }).success,
    ).toBe(true);
  });

  it("rejects partial legacy admin metadata instead of fabricating a present device", () => {
    for (const partial of [
      { ...base, browserFamily: "firefox" },
      {
        ...base,
        browserFamily: "firefox",
        browserVersionLastSeen: null,
      },
      {
        ...base,
        extensionVersionLastSeen: "0.2.4",
      },
    ])
      expect(AdminDeviceItemV1Schema.safeParse(partial).success).toBe(false);
  });
});
