import { describe, expect, it } from "vitest";
import type { ExtensionPrincipal } from "@product/extension-auth";
import type { SellerAgentsSyncEntryV1 } from "@product/contracts";
import {
  applyReconciliationEntry,
  compareDeliveryMarkers,
  RECONCILIATION_CLASSES,
} from "./reconciliation.js";

const account = "00000000-0000-4000-8000-000000000001";
const installationA = "00000000-0000-4000-8000-000000000002";
const installationB = "00000000-0000-4000-8000-000000000003";
const principal = (deviceId: string): ExtensionPrincipal => ({
  accountId: account,
  deviceId,
  sessionId: "00000000-0000-4000-8000-000000000004",
});
const payload = (overrides: Record<string, unknown> = {}) => ({
  kind: "BINDING_UPSERT" as const,
  conversationKeyDigest: "a".repeat(64),
  bindingId: "binding-1",
  bindingRevision: 1,
  storeId: "store-1",
  marketplace: "ozon" as const,
  credentialRevision: "credential-1",
  bindingState: "BOUND" as const,
  workGeneration: "generation-1",
  ...overrides,
});
const entry = (
  overrides: Record<string, unknown> = {},
): SellerAgentsSyncEntryV1 =>
  ({
    requestId: "00000000-0000-4000-8000-000000000010",
    mutationId: "mutation-1",
    entityId: "b".repeat(64),
    baseRevision: 0,
    localSequence: 1,
    mutationGeneration: "generation-1",
    kind: "BINDING_UPSERT",
    payload: payload(),
    ...overrides,
  }) as SellerAgentsSyncEntryV1;

describe("C3F reconciliation kernel", () => {
  it("allows compatible stale same-binding convergence without revision oscillation", () => {
    const first = applyReconciliationEntry({
      current: null,
      serverRevision: 0,
      entry: entry(),
      principal: principal(installationA),
      receiveAtMs: 100,
    });
    expect(first).toMatchObject({ outcome: "ACK", serverRevision: 1 });
    const second = applyReconciliationEntry({
      current: first.serverState,
      serverRevision: 1,
      entry: entry({
        requestId: "00000000-0000-4000-8000-000000000011",
        mutationId: "mutation-2",
      }),
      principal: principal(installationB),
      receiveAtMs: 200,
    });
    expect(second).toMatchObject({
      outcome: "ACK",
      serverRevision: 1,
      code: "SAME_BINDING_MERGEABLE",
    });
  });

  it("keeps explicit state above eligible and obsolete delivery markers", () => {
    const binding = applyReconciliationEntry({
      current: null,
      serverRevision: 0,
      entry: entry(),
      principal: principal(installationA),
      receiveAtMs: 100,
    });
    const marker = entry({
      requestId: "00000000-0000-4000-8000-000000000012",
      mutationId: "delivery-1",
      kind: "DELIVERY_MARKER",
      baseRevision: 0,
      payload: {
        ...payload(),
        kind: "DELIVERY_MARKER",
        deliveryMarkerId: "delivery-1",
        deliveryOrder: { aiOrderId: "message-2" },
      },
    });
    const accepted = applyReconciliationEntry({
      current: binding.serverState,
      serverRevision: 1,
      entry: marker,
      principal: principal(installationB),
      receiveAtMs: 300,
    });
    expect(accepted).toMatchObject({
      outcome: "ACK",
      serverRevision: 1,
      code: null,
    });
    expect(accepted.serverState?.kind).toBe("BINDING_UPSERT");
    expect(accepted.serverState?.reconciliation?.preferred.installationId).toBe(
      installationA,
    );
    expect(accepted.serverState?.reconciliation?.markers).toHaveLength(1);
    const stale = applyReconciliationEntry({
      current: accepted.serverState,
      serverRevision: 1,
      entry: {
        ...marker,
        requestId: "00000000-0000-4000-8000-000000000013",
        mutationId: "delivery-2",
        payload: {
          ...marker.payload,
          deliveryMarkerId: "delivery-2",
          storeId: "store-old",
          deliveryOrder: { aiOrderId: "message-99" },
        },
      },
      principal: principal(installationB),
      receiveAtMs: 400,
    });
    expect(stale).toMatchObject({
      outcome: "ACK",
      serverRevision: 1,
      code: RECONCILIATION_CLASSES.STALE_DELIVERY_OBSOLETE,
    });
    expect(stale.serverState?.storeId).toBe("store-1");
  });

  it("makes Finish revision authoritative over a late old-generation delivery", () => {
    const binding = applyReconciliationEntry({
      current: null,
      serverRevision: 0,
      entry: entry(),
      principal: principal(installationA),
      receiveAtMs: 100,
    });
    const finish = applyReconciliationEntry({
      current: binding.serverState,
      serverRevision: 1,
      entry: entry({
        requestId: "00000000-0000-4000-8000-000000000014",
        mutationId: "finish-1",
        baseRevision: 1,
        kind: "FINISH",
        payload: payload({
          kind: "FINISH",
          bindingRevision: 2,
          bindingState: "FINISHED",
        }),
      }),
      principal: principal(installationA),
      receiveAtMs: 200,
    });
    expect(finish).toMatchObject({ outcome: "ACK", serverRevision: 2 });
    const late = entry({
      requestId: "00000000-0000-4000-8000-000000000015",
      mutationId: "delivery-late",
      kind: "DELIVERY_MARKER",
      baseRevision: 1,
      payload: {
        ...payload(),
        kind: "DELIVERY_MARKER",
        deliveryMarkerId: "late",
        deliveryOrder: { aiOrderId: "message-3" },
      },
    });
    const result = applyReconciliationEntry({
      current: finish.serverState,
      serverRevision: 2,
      entry: late,
      principal: principal(installationB),
      receiveAtMs: 300,
    });
    expect(result).toMatchObject({
      outcome: "ACK",
      serverRevision: 2,
      code: RECONCILIATION_CLASSES.SERVER_FINISH_WINS_OVER_LATE_DELIVERY,
    });
    expect(result.serverState?.bindingState).toBe("FINISHED");
  });

  it("returns explicit conflict for an incompatible stale store and never selects by timestamp", () => {
    const binding = applyReconciliationEntry({
      current: null,
      serverRevision: 0,
      entry: entry(),
      principal: principal(installationA),
      receiveAtMs: 100,
    });
    const conflict = applyReconciliationEntry({
      current: binding.serverState,
      serverRevision: 1,
      entry: entry({
        requestId: "00000000-0000-4000-8000-000000000016",
        mutationId: "store-3",
        baseRevision: 0,
        payload: payload({ bindingRevision: 2, storeId: "store-3" }),
      }),
      principal: principal(installationB),
      receiveAtMs: 1,
    });
    expect(conflict).toMatchObject({
      outcome: "CONFLICT",
      serverRevision: 1,
      code: RECONCILIATION_CLASSES.EXPLICIT_BINDING_CONFLICT,
    });
    expect(conflict.serverState?.storeId).toBe("store-1");
    expect(
      compareDeliveryMarkers(
        {
          installationId: installationA,
          deliveryMarkerId: "a",
          conversationKeyDigest: "a",
          bindingId: "binding-1",
          bindingRevision: 1,
          storeId: "store-1",
          marketplace: "ozon",
          serverReceiveAtMs: 999,
          aiOrderId: "message-1",
        },
        {
          installationId: installationB,
          deliveryMarkerId: "b",
          conversationKeyDigest: "a",
          bindingId: "binding-1",
          bindingRevision: 1,
          storeId: "store-1",
          marketplace: "ozon",
          serverReceiveAtMs: 1,
          aiOrderId: "message-2",
        },
      ),
    ).toBeLessThan(0);
  });
});
