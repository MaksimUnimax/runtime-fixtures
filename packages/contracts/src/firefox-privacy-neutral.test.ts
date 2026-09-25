import { describe, expect, it } from "vitest";
import {
  AdminDeviceItemV1Schema,
  BootstrapRequestV2Schema,
  BootstrapSnapshotPayloadV2Schema,
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
