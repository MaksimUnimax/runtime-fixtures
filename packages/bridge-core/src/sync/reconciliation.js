(() => {
  "use strict";

  const CLASSES = Object.freeze({
    IN_SYNC: "IN_SYNC",
    SERVER_AHEAD_COMPATIBLE: "SERVER_AHEAD_COMPATIBLE",
    LOCAL_PENDING: "LOCAL_PENDING",
    SAME_BINDING_MERGEABLE: "SAME_BINDING_MERGEABLE",
    EXPLICIT_BINDING_CONFLICT: "EXPLICIT_BINDING_CONFLICT",
    LOCAL_FINISH_SUPERSEDED_BY_NEWER_EXPLICIT_BINDING: "LOCAL_FINISH_SUPERSEDED_BY_NEWER_EXPLICIT_BINDING",
    SERVER_FINISH_WINS_OVER_LATE_DELIVERY: "SERVER_FINISH_WINS_OVER_LATE_DELIVERY",
    STALE_DELIVERY_OBSOLETE: "STALE_DELIVERY_OBSOLETE",
    REQUIRES_EXPLICIT_USER_REBIND_RESOLUTION: "REQUIRES_EXPLICIT_USER_REBIND_RESOLUTION",
    UNKNOWN_REMOTE_INSTALLATION_STATE: "UNKNOWN_REMOTE_INSTALLATION_STATE",
  });
  const PREFERRED_STATES = Object.freeze({
    UNSET: "UNSET",
    VALID_CURRENT: "VALID_CURRENT",
    REPLACEMENT_REQUIRED: "REPLACEMENT_REQUIRED",
  });
  const PROVENANCE = Object.freeze({
    AI_ORDERED: "AI_ORDERED",
    CLIENT_APPROXIMATE: "CLIENT_APPROXIMATE",
    SERVER_RECEIVE_FALLBACK: "SERVER_RECEIVE_FALLBACK",
  });
  const EXPLICIT_KINDS = new Set(["BINDING_UPSERT", "FINISH"]);

  const string = (value, max = 320) => typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
  const number = value => value === null || value === undefined || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;
  const integer = value => value === null || value === undefined || value === "" ? null : Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  const compareText = (left, right) => String(left || "").localeCompare(String(right || ""), "en", { numeric: true });
  const compareNumber = (left, right) => (left === right ? 0 : left < right ? -1 : 1);

  function contextOf(value = {}) {
    return {
      accountId: string(value.accountId),
      entityId: string(value.entityId || value.conversationKeyDigest),
      conversationKeyDigest: string(value.conversationKeyDigest || value.entityId, 64),
      bindingId: string(value.bindingId),
      bindingRevision: integer(value.bindingRevision),
      storeId: string(value.storeId),
      marketplace: string(value.marketplace, 32),
      workGeneration: string(value.workGeneration, 160),
      bindingState: string(value.bindingState, 32) || (value.kind === "FINISH" ? "FINISHED" : "BOUND"),
    };
  }

  function effectiveIdentity(value = {}) {
    const c = contextOf(value);
    return [c.accountId, c.entityId || c.conversationKeyDigest, c.bindingId, c.bindingRevision, c.storeId, c.marketplace, c.workGeneration, c.bindingState].join("|");
  }

  function sameBinding(left, right, { includeState = true } = {}) {
    const a = contextOf(left), b = contextOf(right);
    const fields = ["accountId", "entityId", "conversationKeyDigest", "bindingId", "bindingRevision", "storeId", "marketplace", "workGeneration"];
    if (includeState) fields.push("bindingState");
    return fields.every(field => a[field] === b[field]);
  }

  function deliveryEligibility(marker, current, { accountId = null, entityId = null } = {}) {
    if (!marker || !current) return { eligible: false, reason: "MISSING_CONTEXT" };
    const expected = contextOf({ ...current, accountId: accountId || current.accountId, entityId: entityId || current.entityId });
    const actual = contextOf({ ...marker, accountId: accountId || marker.accountId, entityId: entityId || marker.entityId });
    for (const field of ["accountId", "entityId", "conversationKeyDigest", "bindingId", "bindingRevision", "storeId", "marketplace", "workGeneration"]) {
      if (expected[field] !== actual[field]) return { eligible: false, reason: `MISMATCH_${field.toUpperCase()}` };
    }
    if (expected.bindingState === "FINISHED") return { eligible: false, reason: "FINISHED_BINDING" };
    if (actual.bindingState === "FINISHED") return { eligible: false, reason: "FINISHED_MARKER" };
    return { eligible: true, reason: null };
  }

  function markerProvenance(marker = {}) {
    if (marker.orderProvenance === PROVENANCE.AI_ORDERED && string(marker.aiOrderId, 240)) return PROVENANCE.AI_ORDERED;
    if (string(marker.aiOrderId, 240)) return PROVENANCE.AI_ORDERED;
    if (number(marker.clientDeliveredAtMs) !== null || integer(marker.clientSequence) !== null) return PROVENANCE.CLIENT_APPROXIMATE;
    return PROVENANCE.SERVER_RECEIVE_FALLBACK;
  }

  function compareDeliveryMarkers(left, right) {
    const a = { ...left, orderProvenance: markerProvenance(left) };
    const b = { ...right, orderProvenance: markerProvenance(right) };
    if (a.orderProvenance === PROVENANCE.AI_ORDERED && b.orderProvenance !== PROVENANCE.AI_ORDERED) return 1;
    if (b.orderProvenance === PROVENANCE.AI_ORDERED && a.orderProvenance !== PROVENANCE.AI_ORDERED) return -1;
    if (a.orderProvenance === PROVENANCE.AI_ORDERED && b.orderProvenance === PROVENANCE.AI_ORDERED) {
      const order = compareText(a.aiOrderId, b.aiOrderId);
      if (order) return order;
    } else {
      const aTime = number(a.clientDeliveredAtMs), bTime = number(b.clientDeliveredAtMs);
      if (aTime !== null || bTime !== null) {
        const order = compareNumber(aTime ?? Number.NEGATIVE_INFINITY, bTime ?? Number.NEGATIVE_INFINITY);
        if (order) return order;
      }
      const sequence = compareNumber(integer(a.clientSequence) ?? -1, integer(b.clientSequence) ?? -1);
      if (sequence) return sequence;
      const receive = compareNumber(number(a.serverReceiveAtMs) ?? Number.NEGATIVE_INFINITY, number(b.serverReceiveAtMs) ?? Number.NEGATIVE_INFINITY);
      if (receive) return receive;
    }
    const installation = compareText(a.installationId, b.installationId);
    if (installation) return installation;
    return compareText(a.deliveryMarkerId, b.deliveryMarkerId);
  }

  function eligibleMarkers(candidates, current) {
    return (Array.isArray(candidates) ? candidates : []).filter(candidate => deliveryEligibility(candidate, current).eligible && candidate.revoked !== true);
  }

  function chooseDeliveryMarker(candidates, current) {
    const eligible = eligibleMarkers(candidates, current);
    if (!eligible.length) return null;
    return [...eligible].sort((a, b) => compareDeliveryMarkers(a, b)).at(-1) || null;
  }

  function preferredExecutorDecision({ currentPreferred = null, candidates = [], currentBinding = null, reason = "reconcile" } = {}) {
    const preferred = currentPreferred?.installationId ? currentPreferred : null;
    const preferredEligible = Boolean(preferred && preferred.revoked !== true && deliveryEligibility(preferred.context || currentBinding, currentBinding || preferred.context).eligible);
    if (preferred && preferredEligible) return { state: PREFERRED_STATES.VALID_CURRENT, installationId: preferred.installationId, changed: false, reason: "VALID_CURRENT", decisionReason: reason };
    const selected = chooseDeliveryMarker(candidates, currentBinding);
    if (selected) return { state: PREFERRED_STATES.VALID_CURRENT, installationId: selected.installationId || null, changed: selected.installationId !== preferred?.installationId, reason: preferred ? "REPLACEMENT_REQUIRED" : "INITIALIZE_UNSET", decisionReason: reason };
    return { state: preferred ? PREFERRED_STATES.REPLACEMENT_REQUIRED : PREFERRED_STATES.UNSET, installationId: preferred?.installationId || null, changed: false, reason: preferred ? "NO_ELIGIBLE_REPLACEMENT" : "NO_ELIGIBLE_CANDIDATE", decisionReason: reason };
  }

  function explicitConflict(local, server) {
    return Boolean(local && server && !sameBinding(local, server, { includeState: false }) && (local.storeId !== server.storeId || local.marketplace !== server.marketplace || local.bindingId !== server.bindingId));
  }

  function classifyComparison({ local = null, server = null, pending = null, delivery = null } = {}) {
    if (pending) {
      if (pending.kind === "DELIVERY_MARKER") {
        if (!server) return CLASSES.UNKNOWN_REMOTE_INSTALLATION_STATE;
        const eligibility = deliveryEligibility(pending, server);
        if (!eligibility.eligible) return server.bindingState === "FINISHED" ? CLASSES.SERVER_FINISH_WINS_OVER_LATE_DELIVERY : CLASSES.STALE_DELIVERY_OBSOLETE;
      } else if (!server) return CLASSES.LOCAL_PENDING;
    }
    if (!server) return CLASSES.UNKNOWN_REMOTE_INSTALLATION_STATE;
    if (delivery && !deliveryEligibility(delivery, server).eligible) return server.bindingState === "FINISHED" ? CLASSES.SERVER_FINISH_WINS_OVER_LATE_DELIVERY : CLASSES.STALE_DELIVERY_OBSOLETE;
    if (!local) return CLASSES.SERVER_AHEAD_COMPATIBLE;
    if (sameBinding(local, server)) return pending ? CLASSES.SAME_BINDING_MERGEABLE : CLASSES.IN_SYNC;
    if (explicitConflict(local, server)) return CLASSES.EXPLICIT_BINDING_CONFLICT;
    if (local.bindingState === "FINISHED" && server.bindingRevision > local.bindingRevision) return CLASSES.LOCAL_FINISH_SUPERSEDED_BY_NEWER_EXPLICIT_BINDING;
    if (server.bindingRevision > local.bindingRevision) return CLASSES.SERVER_AHEAD_COMPATIBLE;
    return CLASSES.REQUIRES_EXPLICIT_USER_REBIND_RESOLUTION;
  }

  function reconcile({ local = null, server = null, pending = null, delivery = null, currentPreferred = null, candidates = [] } = {}) {
    const current = server || local;
    const classification = classifyComparison({ local, server, pending, delivery });
    const preference = preferredExecutorDecision({ currentPreferred, candidates, currentBinding: current, reason: classification });
    return Object.freeze({ classification, preference, deliveryEligible: delivery ? deliveryEligibility(delivery, current) : null, current: current ? contextOf(current) : null });
  }

  function allowsFutureAction({ local = null, server = null } = {}) {
    if (!server) return { allowed: true, code: null };
    if (server.bindingState === "FINISHED" && local && local.bindingRevision <= server.bindingRevision) return { allowed: false, code: "SYNC_SERVER_FINISH_FENCE" };
    if (local && server.bindingRevision > local.bindingRevision && !sameBinding(local, server, { includeState: false })) return { allowed: false, code: "SYNC_NEWER_BINDING_FENCE" };
    return { allowed: true, code: null };
  }

  const STORE_RECONCILIATION_CLASSES = Object.freeze({
    IN_SYNC: "IN_SYNC",
    SERVER_AHEAD_COMPATIBLE: "SERVER_AHEAD_COMPATIBLE",
    STORE_TOMBSTONE_DOMINATES: "STORE_TOMBSTONE_DOMINATES",
    STORE_PROVIDER_IDENTITY_MISMATCH: "STORE_PROVIDER_IDENTITY_MISMATCH",
    STORE_STALE_REVISION: "STORE_STALE_REVISION",
    UNKNOWN_REMOTE_INSTALLATION_STATE: "UNKNOWN_REMOTE_INSTALLATION_STATE",
  });
  function storeState(entry) {
    const payload = entry.payload || entry;
    return {
      kind: entry.kind || payload.kind,
      storeId: payload.storeId,
      marketplace: payload.marketplace,
      name: payload.name,
      providerAccountId: payload.providerIdentityState === "CONFIRMED" ? payload.providerAccountId : null,
      providerIdentityState: payload.providerIdentityState === "CONFIRMED" ? "CONFIRMED" : "UNCONFIRMED",
      credentialRevision: payload.credentialRevision || null,
      metadataRevision: Number.isSafeInteger(Number(payload.metadataRevision)) && Number(payload.metadataRevision) >= 0 ? Number(payload.metadataRevision) : 0,
      lifecycleState: (entry.kind || payload.kind) === "STORE_TOMBSTONE" ? "TOMBSTONED" : "ACTIVE",
    };
  }
  function sameStoreState(left, right) {
    return Boolean(left && right && left.storeId === right.storeId && left.marketplace === right.marketplace && left.name === right.name && left.providerAccountId === right.providerAccountId && left.providerIdentityState === right.providerIdentityState && left.credentialRevision === right.credentialRevision && left.metadataRevision === right.metadataRevision && left.lifecycleState === right.lifecycleState);
  }
  function applyStoreMetadata({ current = null, serverRevision = 0, entry, receiveAtMs = 0 } = {}) {
    const desired = storeState(entry);
    if (!desired.storeId || !["ozon", "wildberries"].includes(desired.marketplace) || !desired.name) return { outcome: "CONFLICT", serverRevision, serverState: current, code: "STORE_METADATA_INVALID" };
    if (!current) return { outcome: "ACK", serverRevision: serverRevision + 1, serverState: desired, code: null };
    if (current.lifecycleState === "TOMBSTONED") return { outcome: desired.lifecycleState === "TOMBSTONED" ? "ACK" : "CONFLICT", serverRevision, serverState: current, code: desired.lifecycleState === "TOMBSTONED" ? STORE_RECONCILIATION_CLASSES.IN_SYNC : STORE_RECONCILIATION_CLASSES.STORE_TOMBSTONE_DOMINATES };
    if (entry.baseRevision !== serverRevision) {
      if (sameStoreState(desired, current)) return { outcome: "ACK", serverRevision, serverState: current, code: STORE_RECONCILIATION_CLASSES.IN_SYNC };
      return { outcome: "CONFLICT", serverRevision, serverState: current, code: "SYNC_CONFLICT" };
    }
    if (current.providerIdentityState === "CONFIRMED" && desired.providerIdentityState === "CONFIRMED" && current.providerAccountId !== desired.providerAccountId)
      return { outcome: "CONFLICT", serverRevision, serverState: current, code: STORE_RECONCILIATION_CLASSES.STORE_PROVIDER_IDENTITY_MISMATCH };
    if (desired.metadataRevision < Number(current.metadataRevision || 0)) return { outcome: "CONFLICT", serverRevision, serverState: current, code: STORE_RECONCILIATION_CLASSES.STORE_STALE_REVISION };
    if (current.providerIdentityState === "CONFIRMED") {
      desired.providerIdentityState = "CONFIRMED";
      desired.providerAccountId = current.providerAccountId;
    }
    return { outcome: "ACK", serverRevision: serverRevision + 1, serverState: desired, code: null };
  }

  globalThis.SellerAgentsReconciliation = Object.freeze({
    CLASSES,
    PREFERRED_STATES,
    PROVENANCE,
    contextOf,
    effectiveIdentity,
    sameBinding,
    deliveryEligibility,
    markerProvenance,
    compareDeliveryMarkers,
    chooseDeliveryMarker,
    preferredExecutorDecision,
    classifyComparison,
    reconcile,
    allowsFutureAction,
    STORE_RECONCILIATION_CLASSES,
    applyStoreMetadata,
  });
})();
