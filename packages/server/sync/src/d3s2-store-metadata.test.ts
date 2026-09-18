import { describe, expect, it } from "vitest";
import { SellerAgentsSyncEntryV1Schema } from "@product/contracts";
import {
  applyStoreMetadataEntry,
  STORE_RECONCILIATION_CLASSES,
} from "./reconciliation.js";

const account = "00000000-0000-4000-8000-000000000001";
const device = "00000000-0000-4000-8000-000000000002";
const digest = "a".repeat(64);
const store = (overrides: Record<string, unknown> = {}) => ({
  kind: "STORE_UPSERT" as const,
  conversationKeyDigest: digest,
  bindingId: null,
  bindingRevision: 0,
  storeId: "store-1",
  marketplace: "ozon" as const,
  name: "Synthetic shop",
  providerAccountId: null,
  providerIdentityState: "UNCONFIRMED" as const,
  credentialRevision: "a".repeat(64),
  metadataRevision: 1,
  lifecycleState: "ACTIVE" as const,
  ...overrides,
});
const entry = (overrides: Record<string, unknown> = {}) => ({
  requestId: "00000000-0000-4000-8000-000000000010",
  mutationId: "device:1",
  entityId: "store:store-1",
  baseRevision: 0,
  localSequence: 1,
  mutationGeneration: "device:store:1",
  kind: "STORE_UPSERT" as const,
  payload: store(),
  ...overrides,
});
const principal = {
  accountId: account,
  deviceId: device,
  sessionId: "00000000-0000-4000-8000-000000000003",
};

describe("D3/S2 store metadata on the existing C3E/C3F model", () => {
  it("accepts only the bounded metadata allowlist", () => {
    expect(SellerAgentsSyncEntryV1Schema.parse(entry()).payload).toMatchObject({
      storeId: "store-1",
      lifecycleState: "ACTIVE",
    });
    expect(() =>
      SellerAgentsSyncEntryV1Schema.parse({
        ...entry(),
        payload: { ...store(), credentials: { token: "synthetic" } },
      }),
    ).toThrow();
  });

  it("creates state, preserves identity on rename, and advances server revision", () => {
    const first = applyStoreMetadataEntry({
      current: null,
      serverRevision: 0,
      entry: entry(),
    });
    expect(first).toMatchObject({
      outcome: "ACK",
      serverRevision: 1,
      serverState: { storeId: "store-1", metadataRevision: 1 },
    });
    const rename = applyStoreMetadataEntry({
      current: first.serverState,
      serverRevision: 1,
      entry: entry({
        baseRevision: 1,
        mutationId: "device:2",
        payload: store({ name: "Renamed", metadataRevision: 2 }),
      }),
    });
    expect(rename).toMatchObject({
      outcome: "ACK",
      serverRevision: 2,
      serverState: {
        storeId: "store-1",
        name: "Renamed",
        providerAccountId: null,
      },
    });
  });

  it("accepts first identity confirmation and fails closed on a different confirmed account", () => {
    const first = applyStoreMetadataEntry({
      current: null,
      serverRevision: 0,
      entry: entry({
        payload: store({
          providerIdentityState: "CONFIRMED",
          providerAccountId: "provider-1",
        }),
      }),
    });
    const mismatch = applyStoreMetadataEntry({
      current: first.serverState,
      serverRevision: 1,
      entry: entry({
        baseRevision: 1,
        mutationId: "device:2",
        payload: store({
          providerIdentityState: "CONFIRMED",
          providerAccountId: "provider-2",
          metadataRevision: 2,
        }),
      }),
    });
    expect(mismatch).toMatchObject({
      outcome: "CONFLICT",
      code: STORE_RECONCILIATION_CLASSES.STORE_PROVIDER_IDENTITY_MISMATCH,
      serverState: { providerAccountId: "provider-1" },
    });
  });

  it("does not erase a confirmed identity on an unconfirmed update", () => {
    const first = applyStoreMetadataEntry({
      current: null,
      serverRevision: 0,
      entry: entry({
        payload: store({
          providerIdentityState: "CONFIRMED",
          providerAccountId: "provider-1",
        }),
      }),
    });
    const next = applyStoreMetadataEntry({
      current: first.serverState,
      serverRevision: 1,
      entry: entry({
        baseRevision: 1,
        mutationId: "device:2",
        payload: store({ metadataRevision: 2, name: "Renamed" }),
      }),
    });
    expect(next.serverState).toMatchObject({
      providerIdentityState: "CONFIRMED",
      providerAccountId: "provider-1",
      name: "Renamed",
    });
  });

  it("makes tombstones dominate stale upserts, independent of receive time", () => {
    const first = applyStoreMetadataEntry({
      current: null,
      serverRevision: 0,
      entry: entry(),
    });
    const tombstone = applyStoreMetadataEntry({
      current: first.serverState,
      serverRevision: 1,
      entry: entry({
        baseRevision: 1,
        mutationId: "device:2",
        kind: "STORE_TOMBSTONE",
        payload: store({
          kind: "STORE_TOMBSTONE",
          lifecycleState: "TOMBSTONED",
          metadataRevision: 2,
        }),
      }),
    });
    expect(tombstone).toMatchObject({
      outcome: "ACK",
      serverRevision: 2,
      serverState: { lifecycleState: "TOMBSTONED" },
    });
    const stale = applyStoreMetadataEntry({
      current: tombstone.serverState,
      serverRevision: 2,
      entry: entry({
        baseRevision: 0,
        mutationId: "device:3",
        payload: store({ name: "stale", metadataRevision: 0 }),
      }),
    });
    expect(stale).toMatchObject({
      outcome: "CONFLICT",
      serverRevision: 2,
      code: STORE_RECONCILIATION_CLASSES.STORE_TOMBSTONE_DOMINATES,
      serverState: { lifecycleState: "TOMBSTONED" },
    });
  });

  it("returns deterministic stale-base and stale-metadata conflicts", () => {
    const first = applyStoreMetadataEntry({
      current: null,
      serverRevision: 0,
      entry: entry(),
    });
    const staleBase = applyStoreMetadataEntry({
      current: first.serverState,
      serverRevision: 1,
      entry: entry({
        baseRevision: 0,
        mutationId: "device:2",
        payload: store({ name: "other", metadataRevision: 2 }),
      }),
    });
    expect(staleBase).toMatchObject({
      outcome: "CONFLICT",
      code: "SYNC_CONFLICT",
    });
    const staleMetadata = applyStoreMetadataEntry({
      current: first.serverState,
      serverRevision: 1,
      entry: entry({
        baseRevision: 1,
        mutationId: "device:3",
        payload: store({ metadataRevision: 0 }),
      }),
    });
    expect(staleMetadata).toMatchObject({
      outcome: "CONFLICT",
      code: STORE_RECONCILIATION_CLASSES.STORE_STALE_REVISION,
    });
  });

  it("never puts secrets, reports, AI bodies, or provider responses in state", () => {
    const result = applyStoreMetadataEntry({
      current: null,
      serverRevision: 0,
      entry: entry(),
    });
    const serialized = JSON.stringify(result.serverState);
    expect(serialized).not.toMatch(
      /token|secret|report|file|aiText|responseBody/i,
    );
  });

  it("does not use installation or wall-clock identity to resolve store metadata", () => {
    expect(principal.accountId).toBe(account);
    expect(
      JSON.stringify(
        applyStoreMetadataEntry({
          current: null,
          serverRevision: 0,
          entry: entry(),
        }),
      ),
    ).not.toMatch(/receiveAt|installationId|Date/);
  });
});
