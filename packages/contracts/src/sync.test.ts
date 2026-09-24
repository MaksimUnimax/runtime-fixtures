import { describe, expect, it } from "vitest";
import {
  SellerAgentsSyncReadEntityIdV1Schema,
  SellerAgentsSyncRequestV1Schema,
  SellerAgentsSyncResponseV1Schema,
  SellerAgentsSyncSnapshotV1Schema,
} from "./index.js";

const installationId = "123e4567-e89b-42d3-a456-426614174000";
const requestId = "123e4567-e89b-42d3-a456-426614174001";
const digest = "a".repeat(64);
const conversationEntityId = `conversation:${digest}`;
const jsonBytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

const payload = (overrides: Record<string, unknown> = {}) => ({
  kind: "BINDING_UPSERT",
  conversationKeyDigest: digest,
  bindingId: "binding-1",
  bindingRevision: 1,
  storeId: "store-1",
  marketplace: "ozon",
  credentialRevision: "credential-1",
  bindingState: "BOUND",
  ...overrides,
});
const entry = (overrides: Record<string, unknown> = {}) => ({
  requestId,
  mutationId: "mutation-1",
  entityId: "legacy-random-binding-id",
  baseRevision: 0,
  localSequence: 1,
  mutationGeneration: "generation-1",
  kind: "BINDING_UPSERT",
  payload: payload(),
  ...overrides,
});

const request = (overrides: Record<string, unknown> = {}) => ({
  syncVersion: "seller_agents_sync_v1",
  installationId,
  entries: [entry()],
  ...overrides,
});

const marker = (index: number) => ({
  installationId,
  deliveryMarkerId: `marker-${index}-${"d".repeat(110)}`,
  bindingId: "b".repeat(128),
  bindingRevision: index + 1,
  storeId: "s".repeat(128),
  marketplace: "ozon",
  workGeneration: "w".repeat(160),
  aiOrderId: "a".repeat(240),
  clientDeliveredAtMs: index + 1,
  clientSequence: index,
  orderProvenance: "AI_ORDERED",
  serverReceiveAtMs: index + 1,
  revoked: false,
});
const stateWithMarkers = (count: number) =>
  payload({
    bindingId: "b".repeat(128),
    storeId: "s".repeat(128),
    credentialRevision: "c".repeat(128),
    workGeneration: "w".repeat(160),
    deliveryOrder: {
      aiOrderId: "z".repeat(240),
      clientDeliveredAtMs: 1,
      clientSequence: 1,
      orderProvenance: "AI_ORDERED",
      serverReceiveAtMs: 1,
    },
    reconciliation: {
      classification: "IN_SYNC",
      preferred: {
        state: "VALID_CURRENT",
        installationId,
        reason: "R".repeat(64),
      },
      markers: Array.from({ length: count }, (_, index) => marker(index)),
      observedInstallationIds: Array.from(
        { length: 4 },
        (_, index) =>
          `123e4567-e89b-42d3-a456-${index.toString().padStart(12, "0")}`,
      ),
      serverReceiveAtMs: 1,
    },
  });

const canonicalReads = (count: number) =>
  Array.from(
    { length: count },
    (_, index) => `conversation:${index.toString(16).padStart(64, "0")}`,
  );

describe("N2 seller sync shared wire", () => {
  it("keeps legacy mutation entity IDs compatible", () => {
    const parsed = SellerAgentsSyncRequestV1Schema.parse(request());
    expect(parsed.entries[0]?.entityId).toBe("legacy-random-binding-id");
    expect(parsed.readEntityIds).toBeUndefined();
  });
  it("accepts bounded canonical read-only requests in request order", () => {
    const storeEntityId = `store:store-${installationId}`;
    const parsed = SellerAgentsSyncRequestV1Schema.parse(
      request({
        entries: [],
        readEntityIds: [conversationEntityId, storeEntityId],
      }),
    );
    expect(parsed.readEntityIds).toEqual([conversationEntityId, storeEntityId]);
  });

  it("rejects empty, duplicate, noncanonical and oversized combined requests", () => {
    expect(
      SellerAgentsSyncRequestV1Schema.safeParse(
        request({ entries: [], readEntityIds: [] }),
      ).success,
    ).toBe(false);
    expect(
      SellerAgentsSyncRequestV1Schema.safeParse(
        request({
          entries: [],
          readEntityIds: [conversationEntityId, conversationEntityId],
        }),
      ).success,
    ).toBe(false);
    expect(
      SellerAgentsSyncRequestV1Schema.safeParse(
        request({ entries: [], readEntityIds: ["legacy-random-binding-id"] }),
      ).success,
    ).toBe(false);
    expect(
      SellerAgentsSyncRequestV1Schema.safeParse(
        request({ entries: [entry()], readEntityIds: canonicalReads(32) }),
      ).success,
    ).toBe(false);
  });

  it("bounds canonical store entity IDs to the existing 128-byte key width", () => {
    expect(
      SellerAgentsSyncReadEntityIdV1Schema.safeParse(`store:${"x".repeat(122)}`)
        .success,
    ).toBe(true);
    expect(
      SellerAgentsSyncReadEntityIdV1Schema.safeParse(`store:${"x".repeat(123)}`)
        .success,
    ).toBe(false);
    expect(
      SellerAgentsSyncReadEntityIdV1Schema.safeParse("store:bad\nstore")
        .success,
    ).toBe(false);
  });

  it("accepts missing snapshots as the legacy response shape", () => {
    expect(
      SellerAgentsSyncResponseV1Schema.parse({
        syncVersion: "seller_agents_sync_v1",
        results: [],
      }),
    ).toEqual({ syncVersion: "seller_agents_sync_v1", results: [] });
  });
  it("accepts ordered missing-entity snapshots and rejects duplicate snapshots", () => {
    const snapshot = {
      entityId: conversationEntityId,
      serverRevision: 0,
      serverState: null,
    };
    expect(SellerAgentsSyncSnapshotV1Schema.parse(snapshot)).toEqual(snapshot);
    expect(
      SellerAgentsSyncResponseV1Schema.safeParse({
        syncVersion: "seller_agents_sync_v1",
        results: [],
        snapshots: [snapshot, snapshot],
      }).success,
    ).toBe(false);
  });

  it("rejects snapshot state above the 4096 UTF-8 byte durable bound", () => {
    const oversized = stateWithMarkers(8);
    expect(jsonBytes(oversized)).toBeGreaterThan(4096);
    expect(
      SellerAgentsSyncSnapshotV1Schema.safeParse({
        entityId: conversationEntityId,
        serverRevision: 1,
        serverState: oversized,
      }).success,
    ).toBe(false);
  });
  it("rejects a response above 256 KiB while preserving per-state bounds", () => {
    const candidates = Array.from({ length: 8 }, (_, index) =>
      stateWithMarkers(index + 1),
    ).filter((state) => jsonBytes(state) <= 4096);
    const boundedLargeState = candidates.at(-1);
    expect(boundedLargeState).toBeDefined();
    expect(jsonBytes(boundedLargeState)).toBeGreaterThan(3000);

    const readIds = canonicalReads(32);
    const result = {
      requestId,
      mutationId: "M".repeat(320),
      entityId: "e".repeat(128),
      outcome: "ACK",
      serverRevision: 1,
      serverState: boundedLargeState,
      code: "A".repeat(64),
    };
    const response = {
      syncVersion: "seller_agents_sync_v1",
      results: Array.from({ length: 32 }, () => result),
      snapshots: readIds.map((entityId) => ({
        entityId,
        serverRevision: 1,
        serverState: boundedLargeState,
      })),
    };
    expect(jsonBytes(response)).toBeGreaterThan(256 * 1024);
    expect(SellerAgentsSyncResponseV1Schema.safeParse(response).success).toBe(
      false,
    );
  });
});
