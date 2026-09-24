import { describe, expect, it } from "vitest";
import {
  SyncService,
  type SyncRepository,
  type SyncRepositoryResult,
  type SyncSnapshotReader,
} from "./index.js";
import type { ExtensionPrincipal } from "@product/extension-auth";
import type { SellerAgentsSyncEntryV1 } from "@product/contracts";

const principal: ExtensionPrincipal = {
  accountId: "00000000-0000-4000-8000-000000000001",
  deviceId: "00000000-0000-4000-8000-000000000002",
  sessionId: "00000000-0000-4000-8000-000000000003",
};
const entry = (overrides: Record<string, unknown> = {}) => ({
  requestId: "00000000-0000-4000-8000-000000000010",
  mutationId: "device:1",
  entityId: "a".repeat(64),
  baseRevision: 0,
  localSequence: 1,
  mutationGeneration: "device:a:1",
  kind: "BINDING_UPSERT",
  payload: {
    kind: "BINDING_UPSERT",
    conversationKeyDigest: "b".repeat(64),
    bindingId: "binding-1",
    bindingRevision: 2,
    storeId: "store-1",
    marketplace: "ozon",
    credentialRevision: "credential-1",
  },
  ...overrides,
});
type Receipt = {
  fingerprint: string;
  mutationId: string;
  entityId: string;
  result: SyncRepositoryResult;
};
function repository(): SyncRepository & {
  state: Map<
    string,
    { revision: number; payload: SellerAgentsSyncEntryV1["payload"] | null }
  >;
  receipts: Map<string, Receipt>;
} {
  const state = new Map<
      string,
      { revision: number; payload: SellerAgentsSyncEntryV1["payload"] | null }
    >(),
    receipts = new Map<string, Receipt>();
  return {
    state,
    receipts,
    async apply({
      principal: owner,
      entry: item,
      fingerprint,
    }): Promise<SyncRepositoryResult> {
      const requestKey = `${owner.accountId}:${owner.deviceId}:${item.requestId}`;
      const prior = receipts.get(requestKey);
      if (prior) {
        if (
          prior.fingerprint !== fingerprint ||
          prior.mutationId !== item.mutationId ||
          prior.entityId !== item.entityId
        )
          throw new Error("SYNC_REQUEST_ID_CONFLICT");
        return prior.result;
      }
      const current = state.get(`${owner.accountId}:${item.entityId}`) || {
        revision: 0,
        payload: null,
      };
      const result: SyncRepositoryResult =
        item.baseRevision !== current.revision
          ? {
              outcome: "CONFLICT",
              serverRevision: current.revision,
              serverState: current.payload,
              code: "SYNC_CONFLICT",
            }
          : {
              outcome: "ACK",
              serverRevision: current.revision + 1,
              serverState: item.payload,
              code: null,
            };
      if (result.outcome === "ACK")
        state.set(`${owner.accountId}:${item.entityId}`, {
          revision: result.serverRevision,
          payload: item.payload,
        });
      receipts.set(requestKey, {
        fingerprint,
        mutationId: item.mutationId,
        entityId: item.entityId,
        result,
      });
      return result;
    },
  };
}

describe("C3E sync contract", () => {
  it("applies one mutation exactly once and returns the same ACK on retry", async () => {
    const repo = repository(),
      service = new SyncService(repo),
      body = {
        syncVersion: "seller_agents_sync_v1",
        installationId: principal.deviceId,
        entries: [entry()],
      };
    const first = await service.apply(principal, body),
      second = await service.apply(principal, body);
    expect(first.results[0]).toMatchObject({
      outcome: "ACK",
      serverRevision: 1,
    });
    expect(second).toEqual(first);
    expect(
      repo.state.get(`${principal.accountId}:${"a".repeat(64)}`)?.revision,
    ).toBe(1);
  });
  it("fails closed on conflicting request reuse and installation mismatch", async () => {
    const repo = repository(),
      service = new SyncService(repo),
      body = {
        syncVersion: "seller_agents_sync_v1",
        installationId: principal.deviceId,
        entries: [entry()],
      };
    await service.apply(principal, body);
    await expect(
      service.apply(principal, {
        ...body,
        entries: [entry({ mutationId: "device:2" })],
      }),
    ).rejects.toThrow("SYNC_REQUEST_ID_CONFLICT");
    await expect(
      service.apply(principal, {
        ...body,
        installationId: "00000000-0000-4000-8000-000000000099",
      }),
    ).rejects.toThrow("ACCOUNT_IDENTITY_MISMATCH");
  });
  it("returns explicit stale-base conflict and does not overwrite newer state", async () => {
    const repo = repository(),
      service = new SyncService(repo),
      body = {
        syncVersion: "seller_agents_sync_v1",
        installationId: principal.deviceId,
        entries: [entry()],
      };
    await service.apply(principal, body);
    const stale = await service.apply(principal, {
      ...body,
      entries: [
        entry({
          requestId: "00000000-0000-4000-8000-000000000011",
          mutationId: "device:2",
          baseRevision: 0,
          localSequence: 2,
          mutationGeneration: "device:a:2",
          payload: { ...entry().payload, bindingRevision: 3 },
        }),
      ],
    });
    expect(stale.results[0]).toMatchObject({
      outcome: "CONFLICT",
      serverRevision: 1,
      code: "SYNC_CONFLICT",
    });
    expect(
      repo.state.get(`${principal.accountId}:${"a".repeat(64)}`)?.payload
        ?.bindingRevision,
    ).toBe(2);
  });
  it("supports read-only snapshots in request order without invoking mutations", async () => {
    const repo = repository();
    const calls: string[] = [];
    const reader: SyncSnapshotReader = {
      readSnapshots: async ({ entityIds }) => {
        calls.push("read");
        return entityIds.map((entityId, index) => ({
          entityId,
          serverRevision: index,
          serverState: null,
        }));
      },
    };
    const service = new SyncService(
      {
        apply: async (input) => {
          calls.push("mutation");
          return repo.apply(input);
        },
      },
      reader,
    );
    const readEntityIds = [`conversation:${"1".repeat(64)}`, "store:store-1"];

    const response = await service.apply(principal, {
      syncVersion: "seller_agents_sync_v1",
      installationId: principal.deviceId,
      entries: [],
      readEntityIds,
    });

    expect(response.results).toEqual([]);
    expect(response.snapshots).toEqual([
      {
        entityId: readEntityIds[0],
        serverRevision: 0,
        serverState: null,
      },
      {
        entityId: readEntityIds[1],
        serverRevision: 1,
        serverState: null,
      },
    ]);
    expect(calls).toEqual(["read"]);
    expect(repo.receipts.size).toBe(0);
  });

  it("applies all mutations before taking mixed-request snapshots", async () => {
    const repo = repository();
    const calls: string[] = [];
    const digest = "2".repeat(64);
    const entityId = `conversation:${digest}`;
    const reader: SyncSnapshotReader = {
      readSnapshots: async ({ principal: owner, entityIds }) => {
        calls.push("read");
        return entityIds.map((requestedEntityId) => {
          const current = repo.state.get(
            `${owner.accountId}:${requestedEntityId}`,
          );
          return {
            entityId: requestedEntityId,
            serverRevision: current?.revision ?? 0,
            serverState: current?.payload ?? null,
          };
        });
      },
    };
    const service = new SyncService(
      {
        apply: async (input) => {
          calls.push("mutation");
          return repo.apply(input);
        },
      },
      reader,
    );

    const response = await service.apply(principal, {
      syncVersion: "seller_agents_sync_v1",
      installationId: principal.deviceId,
      entries: [
        entry({
          entityId,
          payload: {
            ...entry().payload,
            conversationKeyDigest: digest,
            bindingRevision: 7,
          },
        }),
      ],
      readEntityIds: [entityId],
    });

    expect(calls).toEqual(["mutation", "read"]);
    expect(response.results[0]).toMatchObject({
      outcome: "ACK",
      serverRevision: 1,
    });
    expect(response.snapshots?.[0]).toMatchObject({
      entityId,
      serverRevision: 1,
      serverState: { bindingRevision: 7 },
    });
  });

  it("keeps mutation-only response shape and fails closed if a read-capable service lacks its reader", async () => {
    const repo = repository();
    const service = new SyncService(repo);
    const mutationOnly = await service.apply(principal, {
      syncVersion: "seller_agents_sync_v1",
      installationId: principal.deviceId,
      entries: [entry()],
    });
    expect(mutationOnly).not.toHaveProperty("snapshots");

    await expect(
      service.apply(principal, {
        syncVersion: "seller_agents_sync_v1",
        installationId: principal.deviceId,
        entries: [entry({ requestId: "00000000-0000-4000-8000-000000000099" })],
        readEntityIds: [`conversation:${"3".repeat(64)}`],
      }),
    ).rejects.toThrow("SYNC_SNAPSHOT_READER_UNAVAILABLE");
    expect(repo.receipts.size).toBe(1);
  });

  it("keeps independent entities independent and enforces the bounded batch", async () => {
    const repo = repository(),
      service = new SyncService(repo),
      items = Array.from({ length: 32 }, (_, i) =>
        entry({
          requestId: `00000000-0000-4000-8000-${String(i + 20).padStart(12, "0")}`,
          mutationId: `device:${i + 1}`,
          entityId: String(i).padStart(64, "0"),
          localSequence: i + 1,
          mutationGeneration: `device:${i + 1}`,
        }),
      );
    const response = await service.apply(principal, {
      syncVersion: "seller_agents_sync_v1",
      installationId: principal.deviceId,
      entries: items,
    });
    expect(response.results).toHaveLength(32);
    await expect(
      service.apply(principal, {
        syncVersion: "seller_agents_sync_v1",
        installationId: principal.deviceId,
        entries: [
          ...items,
          entry({
            requestId: "00000000-0000-4000-8000-000000000099",
            mutationId: "device:99",
            entityId: "z".repeat(64),
            localSequence: 99,
            mutationGeneration: "device:99",
          }),
        ],
      }),
    ).rejects.toThrow();
  });
});
