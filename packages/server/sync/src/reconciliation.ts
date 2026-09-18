import type { ExtensionPrincipal } from "@product/extension-auth";
import type { SellerAgentsSyncEntryV1 } from "@product/contracts";

export const RECONCILIATION_CLASSES = {
  IN_SYNC: "IN_SYNC",
  SERVER_AHEAD_COMPATIBLE: "SERVER_AHEAD_COMPATIBLE",
  LOCAL_PENDING: "LOCAL_PENDING",
  SAME_BINDING_MERGEABLE: "SAME_BINDING_MERGEABLE",
  EXPLICIT_BINDING_CONFLICT: "EXPLICIT_BINDING_CONFLICT",
  LOCAL_FINISH_SUPERSEDED_BY_NEWER_EXPLICIT_BINDING:
    "LOCAL_FINISH_SUPERSEDED_BY_NEWER_EXPLICIT_BINDING",
  SERVER_FINISH_WINS_OVER_LATE_DELIVERY:
    "SERVER_FINISH_WINS_OVER_LATE_DELIVERY",
  STALE_DELIVERY_OBSOLETE: "STALE_DELIVERY_OBSOLETE",
  REQUIRES_EXPLICIT_USER_REBIND_RESOLUTION:
    "REQUIRES_EXPLICIT_USER_REBIND_RESOLUTION",
  UNKNOWN_REMOTE_INSTALLATION_STATE: "UNKNOWN_REMOTE_INSTALLATION_STATE",
} as const;
export type ReconciliationClass =
  (typeof RECONCILIATION_CLASSES)[keyof typeof RECONCILIATION_CLASSES];
export type SyncPayload = SellerAgentsSyncEntryV1["payload"];

type Marker = {
  installationId: string;
  entityId?: string;
  accountId?: string;
  deliveryMarkerId: string;
  conversationKeyDigest: string;
  bindingId: string | null;
  bindingRevision: number;
  storeId: string | null;
  marketplace: "ozon" | "wildberries" | null;
  credentialRevision?: string | null;
  workGeneration?: string | null;
  aiOrderId?: string | null;
  clientDeliveredAtMs?: number | null;
  clientSequence?: number | null;
  orderProvenance?:
    | "AI_ORDERED"
    | "CLIENT_APPROXIMATE"
    | "SERVER_RECEIVE_FALLBACK";
  serverReceiveAtMs: number;
  revoked?: boolean;
};
export type StoredState = SyncPayload;

const explicit = (payload: SyncPayload | null): payload is SyncPayload =>
  Boolean(
    payload && (payload.kind === "BINDING_UPSERT" || payload.kind === "FINISH"),
  );
const stateKind = (payload: SyncPayload): "BOUND" | "FINISHED" =>
  payload.bindingState || (payload.kind === "FINISH" ? "FINISHED" : "BOUND");
const identity = (
  payload: SyncPayload | null,
  accountId: string,
  entityId: string,
): string =>
  payload
    ? [
        accountId,
        entityId,
        payload.conversationKeyDigest,
        payload.bindingId,
        payload.bindingRevision,
        payload.storeId,
        payload.marketplace,
        payload.credentialRevision,
        payload.workGeneration,
        stateKind(payload),
      ].join("|")
    : "";
export function sameEffectiveBinding(
  left: SyncPayload | null,
  right: SyncPayload | null,
  accountId: string,
  entityId: string,
): boolean {
  return Boolean(
    left &&
      right &&
      identity(left, accountId, entityId) ===
        identity(right, accountId, entityId),
  );
}
function markerEligible(
  marker: Marker,
  current: SyncPayload | null,
  accountId: string,
  entityId: string,
): boolean {
  if (!current || !explicit(current) || stateKind(current) === "FINISHED")
    return false;
  if (
    accountId &&
    marker.accountId !== undefined &&
    marker.accountId !== accountId
  )
    return false;
  if (entityId && marker.entityId !== undefined && marker.entityId !== entityId)
    return false;
  return (
    marker.conversationKeyDigest === current.conversationKeyDigest &&
    marker.bindingId === current.bindingId &&
    marker.bindingRevision === current.bindingRevision &&
    marker.storeId === current.storeId &&
    marker.marketplace === current.marketplace &&
    (marker.workGeneration || null) === (current.workGeneration || null)
  );
}
function provenance(
  marker: Marker,
): "AI_ORDERED" | "CLIENT_APPROXIMATE" | "SERVER_RECEIVE_FALLBACK" {
  if (marker.orderProvenance === "AI_ORDERED" && marker.aiOrderId)
    return "AI_ORDERED";
  if (marker.aiOrderId) return "AI_ORDERED";
  if (
    (marker.clientDeliveredAtMs !== undefined &&
      marker.clientDeliveredAtMs !== null) ||
    (marker.clientSequence !== undefined && marker.clientSequence !== null)
  )
    return "CLIENT_APPROXIMATE";
  return "SERVER_RECEIVE_FALLBACK";
}
function compareText(left: unknown, right: unknown): number {
  return String(left || "").localeCompare(String(right || ""), "en", {
    numeric: true,
  });
}
function compareNumber(left: number, right: number): number {
  return left === right ? 0 : left < right ? -1 : 1;
}
export function compareDeliveryMarkers(left: Marker, right: Marker): number {
  const lp = provenance(left),
    rp = provenance(right);
  if (lp === "AI_ORDERED" && rp !== "AI_ORDERED") return 1;
  if (rp === "AI_ORDERED" && lp !== "AI_ORDERED") return -1;
  if (lp === "AI_ORDERED" && rp === "AI_ORDERED") {
    const order = compareText(left.aiOrderId, right.aiOrderId);
    if (order) return order;
  } else {
    const time = compareNumber(
      left.clientDeliveredAtMs ?? Number.NEGATIVE_INFINITY,
      right.clientDeliveredAtMs ?? Number.NEGATIVE_INFINITY,
    );
    if (time) return time;
    const sequence = compareNumber(
      left.clientSequence ?? -1,
      right.clientSequence ?? -1,
    );
    if (sequence) return sequence;
    const receive = compareNumber(
      left.serverReceiveAtMs,
      right.serverReceiveAtMs,
    );
    if (receive) return receive;
  }
  return (
    compareText(left.installationId, right.installationId) ||
    compareText(left.deliveryMarkerId, right.deliveryMarkerId)
  );
}
function markersOf(state: SyncPayload | null): Marker[] {
  return (state?.reconciliation?.markers || []) as unknown as Marker[];
}
function preferredOf(state: SyncPayload | null): {
  state: "UNSET" | "VALID_CURRENT" | "REPLACEMENT_REQUIRED";
  installationId: string | null;
  reason?: string | null;
} {
  return (
    state?.reconciliation?.preferred || { state: "UNSET", installationId: null }
  );
}
function preferredDecision(
  state: SyncPayload,
  candidates: Marker[],
  actingInstallationId: string,
  revokedInstallationIds: string[] = [],
) {
  const prior = preferredOf(state);
  if (
    prior.installationId &&
    prior.state === "VALID_CURRENT" &&
    !revokedInstallationIds.includes(prior.installationId)
  )
    return {
      state: "VALID_CURRENT" as const,
      installationId: prior.installationId,
      reason: "VALID_CURRENT",
    };
  const eligible = candidates.filter(
    (marker) =>
      marker.revoked !== true &&
      markerEligible(marker, state, "", state.conversationKeyDigest),
  );
  const selected = [...eligible].sort(compareDeliveryMarkers).at(-1);
  if (selected)
    return {
      state: "VALID_CURRENT" as const,
      installationId: selected.installationId,
      reason: prior.installationId
        ? "REPLACEMENT_REQUIRED"
        : "INITIALIZE_UNSET",
    };
  return {
    state: "VALID_CURRENT" as const,
    installationId: actingInstallationId || prior.installationId || null,
    reason: prior.installationId ? "NO_ELIGIBLE_REPLACEMENT" : "EXPLICIT_ACTOR",
  };
}
function reconciliation(
  state: SyncPayload,
  classification: ReconciliationClass,
  markers: Marker[],
  actingInstallationId: string,
  receiveAtMs: number,
  preferredOverride?: {
    state: "UNSET" | "VALID_CURRENT" | "REPLACEMENT_REQUIRED";
    installationId: string | null;
    reason?: string | null;
  },
  revokedInstallationIds: string[] = [],
) {
  const priorObserved = state.reconciliation?.observedInstallationIds || [];
  const observedInstallationIds = [
    ...new Set([...priorObserved, actingInstallationId].filter(Boolean)),
  ]
    .sort()
    .slice(-16);
  const preferred =
    preferredOverride ||
    preferredDecision(
      state,
      markers,
      actingInstallationId,
      revokedInstallationIds,
    );
  return {
    ...state,
    reconciliation: {
      classification,
      preferred,
      markers: markers
        .slice(-4)
        .map((marker) => ({
          installationId: marker.installationId,
          deliveryMarkerId: marker.deliveryMarkerId,
          bindingId: marker.bindingId,
          bindingRevision: marker.bindingRevision,
          storeId: marker.storeId,
          marketplace: marker.marketplace,
          workGeneration: marker.workGeneration || null,
          aiOrderId: marker.aiOrderId || null,
          clientDeliveredAtMs: marker.clientDeliveredAtMs ?? null,
          clientSequence: marker.clientSequence ?? null,
          orderProvenance: provenance(marker),
          serverReceiveAtMs: marker.serverReceiveAtMs,
          revoked: marker.revoked,
        })),
      observedInstallationIds,
      serverReceiveAtMs: receiveAtMs,
    },
  } as unknown as SyncPayload;
}
function sanitizeExplicit(entry: SellerAgentsSyncEntryV1): SyncPayload {
  const payload = {
    ...entry.payload,
    kind: entry.kind,
    bindingState:
      entry.kind === "FINISH" ? ("FINISHED" as const) : ("BOUND" as const),
  };
  delete (payload as { deliveryMarkerId?: unknown }).deliveryMarkerId;
  delete (payload as { deliveryOrder?: unknown }).deliveryOrder;
  delete (payload as { reconciliation?: unknown }).reconciliation;
  return payload;
}
function markerFrom(
  entry: SellerAgentsSyncEntryV1,
  principal: ExtensionPrincipal,
  receiveAtMs: number,
): Marker {
  const order = entry.payload.deliveryOrder || {};
  return {
    ...entry.payload,
    installationId: principal.deviceId,
    entityId: entry.entityId,
    accountId: principal.accountId,
    deliveryMarkerId: entry.payload.deliveryMarkerId || entry.mutationId,
    aiOrderId: order.aiOrderId,
    clientDeliveredAtMs: order.clientDeliveredAtMs,
    clientSequence: order.clientSequence,
    orderProvenance: provenance({
      ...entry.payload,
      ...order,
      serverReceiveAtMs: receiveAtMs,
    } as unknown as Marker),
    serverReceiveAtMs: receiveAtMs,
    workGeneration: entry.payload.workGeneration || null,
  };
}
export function applyReconciliationEntry({
  current,
  serverRevision,
  entry,
  principal,
  receiveAtMs,
  revokedInstallationIds = [],
}: {
  current: StoredState | null;
  serverRevision: number;
  entry: SellerAgentsSyncEntryV1;
  principal: ExtensionPrincipal;
  receiveAtMs: number;
  revokedInstallationIds?: string[];
}): {
  outcome: "ACK" | "CONFLICT";
  serverRevision: number;
  serverState: StoredState | null;
  code: string | null;
} {
  if (entry.kind === "DELIVERY_MARKER") {
    if (!current)
      return {
        outcome: "ACK",
        serverRevision,
        serverState: null,
        code: RECONCILIATION_CLASSES.UNKNOWN_REMOTE_INSTALLATION_STATE,
      };
    const marker = markerFrom(entry, principal, receiveAtMs);
    if (!markerEligible(marker, current, principal.accountId, entry.entityId)) {
      const classified =
        stateKind(current) === "FINISHED"
          ? RECONCILIATION_CLASSES.SERVER_FINISH_WINS_OVER_LATE_DELIVERY
          : RECONCILIATION_CLASSES.STALE_DELIVERY_OBSOLETE;
      return {
        outcome: "ACK",
        serverRevision,
        serverState: reconciliation(
          current,
          classified,
          markersOf(current),
          principal.deviceId,
          receiveAtMs,
          preferredOf(current),
        ),
        code: classified,
      };
    }
    const markers = [
      ...markersOf(current).filter(
        (item) => item.installationId !== marker.installationId,
      ),
      marker,
    ]
      .sort(compareDeliveryMarkers)
      .slice(-4);
    const preferred = preferredDecision(
      current,
      markers,
      principal.deviceId,
      revokedInstallationIds,
    );
    return {
      outcome: "ACK",
      serverRevision,
      serverState: reconciliation(
        current,
        RECONCILIATION_CLASSES.IN_SYNC,
        markers,
        principal.deviceId,
        receiveAtMs,
        preferred,
        revokedInstallationIds,
      ),
      code: null,
    };
  }
  const desired = sanitizeExplicit(entry);
  if (current && entry.baseRevision !== serverRevision) {
    if (
      sameEffectiveBinding(
        desired,
        current,
        principal.accountId,
        entry.entityId,
      )
    )
      return {
        outcome: "ACK",
        serverRevision,
        serverState: reconciliation(
          current,
          RECONCILIATION_CLASSES.SAME_BINDING_MERGEABLE,
          markersOf(current),
          principal.deviceId,
          receiveAtMs,
          preferredOf(current),
        ),
        code: "SAME_BINDING_MERGEABLE",
      };
    return {
      outcome: "CONFLICT",
      serverRevision,
      serverState: reconciliation(
        current,
        RECONCILIATION_CLASSES.EXPLICIT_BINDING_CONFLICT,
        markersOf(current),
        principal.deviceId,
        receiveAtMs,
        preferredOf(current),
      ),
      code: RECONCILIATION_CLASSES.EXPLICIT_BINDING_CONFLICT,
    };
  }
  if (
    current &&
    sameEffectiveBinding(desired, current, principal.accountId, entry.entityId)
  )
    return {
      outcome: "ACK",
      serverRevision,
      serverState: reconciliation(
        current,
        RECONCILIATION_CLASSES.IN_SYNC,
        markersOf(current),
        principal.deviceId,
        receiveAtMs,
        preferredOf(current),
      ),
      code: null,
    };
  if (current && desired.bindingRevision <= current.bindingRevision)
    return {
      outcome: "CONFLICT",
      serverRevision,
      serverState: reconciliation(
        current,
        RECONCILIATION_CLASSES.EXPLICIT_BINDING_CONFLICT,
        markersOf(current),
        principal.deviceId,
        receiveAtMs,
        preferredOf(current),
      ),
      code: RECONCILIATION_CLASSES.EXPLICIT_BINDING_CONFLICT,
    };
  const next = reconciliation(
    desired,
    RECONCILIATION_CLASSES.IN_SYNC,
    [],
    principal.deviceId,
    receiveAtMs,
    {
      state: "VALID_CURRENT",
      installationId: principal.deviceId,
      reason: "EXPLICIT_ACCEPTED_BINDING_ACTION",
    },
  );
  return {
    outcome: "ACK",
    serverRevision: serverRevision + 1,
    serverState: next,
    code: null,
  };
}
