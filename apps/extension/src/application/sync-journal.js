/* C3E: compact installation-local metadata journal. It observes local truth;
 * it never owns Work authority and never replays a business operation. */
(() => {
  "use strict";

  const STORAGE_KEY = "seller_agents_sync_journal_v1";
  const VERSION = "seller_agents_sync_v1";
  const MAX_BATCH = 32;
  const MAX_ENTRIES = 256;
  const MAX_PAYLOAD_BYTES = 1800;
  const RETRY_MS = [5000, 15000, 30000, 60000, 120000, 300000];
  const MAX_RETRY_MS = 300000;
  let stateFlight = null;
  let mutationFlight = Promise.resolve();
  let syncFlight = null;

  const text = (value, max = 256) => typeof value === "string" && value.length <= max ? value : null;
  const entityKey = value => typeof value === "string" && value.length > 0 && value.length <= 128;
  const integer = (value, fallback = 0) => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : fallback;
  const clone = value => value === undefined ? undefined : structuredClone(value);
  const canonicalJson = value => {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
  };
  const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  const digest = async value => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value))))].map(x => x.toString(16).padStart(2, "0")).join("");
  const stableJitter = (requestId, attempt) => {
    let hash = 2166136261;
    for (const char of `${requestId}:${attempt}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return 0.9 + (Math.abs(hash >>> 0) % 2001) / 10000;
  };
  const retryDelay = (requestId, attempt) => Math.min(MAX_RETRY_MS, Math.round((RETRY_MS[Math.min(Math.max(attempt - 1, 0), RETRY_MS.length - 1)] || MAX_RETRY_MS) * stableJitter(requestId, attempt)));

  function empty() {
    return { version: VERSION, sequence: 0, entries: {}, serverRevisions: {}, serverStates: {}, reconciliation: {}, snapshotAt: 0 };
  }
  function validEntry(entry) {
    return entry && typeof entry === "object" && text(entry.entryId, 320) && text(entry.requestId, 128) && text(entry.mutationId, 320) && text(entry.entityId, 128) && text(entry.kind, 64) && ["PENDING", "RETRY_WAIT", "IN_FLIGHT", "CONFLICT", "FAILED"].includes(entry.status) && Number.isSafeInteger(entry.localSequence) && bytes(entry.payload) <= MAX_PAYLOAD_BYTES;
  }
  function normalize(raw) {
    if (!raw || raw.version !== VERSION || !raw.entries || typeof raw.entries !== "object" || !raw.serverRevisions || typeof raw.serverRevisions !== "object") throw Object.assign(new Error("SYNC_JOURNAL_CORRUPT"), { code: "SYNC_JOURNAL_CORRUPT" });
    const result = { version: VERSION, sequence: integer(raw.sequence), entries: {}, serverRevisions: {}, serverStates: {}, reconciliation: {}, snapshotAt: integer(raw.snapshotAt) };
    for (const [key, entry] of Object.entries(raw.entries)) if (validEntry(entry)) result.entries[key] = clone(entry); else throw Object.assign(new Error("SYNC_JOURNAL_CORRUPT"), { code: "SYNC_JOURNAL_CORRUPT" });
    for (const [key, value] of Object.entries(raw.serverRevisions)) if (entityKey(key) && Number.isSafeInteger(Number(value)) && Number(value) >= 0) result.serverRevisions[key] = Number(value);
    for (const [key, value] of Object.entries(raw.serverStates || {})) if (entityKey(key) && value && typeof value === "object" && bytes(value) <= 4096) result.serverStates[key] = clone(value);
    for (const [key, value] of Object.entries(raw.reconciliation || {})) if (entityKey(key) && value && typeof value === "object" && bytes(value) <= 4096) result.reconciliation[key] = clone(value);
    if (Object.keys(result.entries).length > MAX_ENTRIES) throw Object.assign(new Error("SYNC_JOURNAL_CORRUPT"), { code: "SYNC_JOURNAL_CORRUPT" });
    return result;
  }
  async function read() {
    if (!stateFlight) stateFlight = (async () => {
      const data = await storageGet(STORAGE_KEY);
      const result = data[STORAGE_KEY] ? normalize(data[STORAGE_KEY]) : empty();
      const currentWorker = String(globalThis.WORKER_SESSION_ID || "worker-unknown");
      let changed = false;
      for (const entry of Object.values(result.entries)) {
        if (entry.status !== "IN_FLIGHT" || entry.attempt_worker_id === currentWorker) continue;
        entry.status = "RETRY_WAIT";
        entry.nextAttemptAt = Math.max(Date.now() + 1000, Number(entry.nextAttemptAt || 0));
        entry.lastError = "WORKER_RESTART_RECOVERY";
        entry.attempt_worker_id = null;
        changed = true;
      }
      if (changed) await storageSet({ [STORAGE_KEY]: result });
      return result;
    })().finally(() => { stateFlight = null; });
    return stateFlight;
  }
  async function write(next) {
    const normalized = normalize(next);
    await storageSet({ [STORAGE_KEY]: normalized });
    const readback = (await storageGet(STORAGE_KEY))[STORAGE_KEY];
    if (!readback || canonicalJson(readback) !== canonicalJson(normalized)) throw Object.assign(new Error("SYNC_JOURNAL_WRITE_READBACK_FAILED"), { code: "SYNC_JOURNAL_WRITE_READBACK_FAILED" });
    stateFlight = null;
    return normalized;
  }
  function mutate(fn) {
    const run = mutationFlight.then(fn, fn);
    mutationFlight = run.catch(() => {});
    return run;
  }
  async function identity() {
    // C3E records local metadata only. Reading the cached continuation state
    // avoids a control-authority checkpoint/persist side effect while a popup
    // mutation is being returned to its caller.
    const cached = await SellerAgentsControlClient.getCachedContinuationState?.();
    const authority = cached?.authority || await SellerAgentsControlClient.getAuthority();
    const accountId = text(authority?.payload?.account?.id, 128), installationId = text(authority?.deviceId, 128);
    if (!accountId || !installationId) throw Object.assign(new Error("AUTH_REQUIRED"), { code: "AUTH_REQUIRED" });
    return { accountId, installationId };
  }
  async function metadata({ binding = null, store = null, conversationKey = "", kind, deliveryId = null, deliveryOrder = null, workGeneration = null }) {
    const auth = await identity();
    if (["STORE_UPSERT", "STORE_TOMBSTONE"].includes(kind)) {
      const storeId = text(store?.id || store?.storeId, 128);
      const marketplace = text(store?.marketplace, 32);
      const metadataRevision = integer(store?.metadataRevision);
      if (!storeId || !marketplace || !metadataRevision && metadataRevision !== 0) throw Object.assign(new Error("STORE_METADATA_INVALID"), { code: "STORE_METADATA_INVALID" });
      return {
        auth,
        entityId: `store:${storeId}`,
        payload: {
          kind,
          conversationKeyDigest: await digest(`store:${storeId}`),
          bindingId: null,
          bindingRevision: 0,
          storeId,
          marketplace,
          credentialRevision: text(store?.credentialRevision, 128),
          name: text(store?.name, 80),
          providerAccountId: store?.providerIdentityState === "CONFIRMED" ? text(store?.providerAccountId, 128) : null,
          providerIdentityState: store?.providerIdentityState === "CONFIRMED" ? "CONFIRMED" : "UNCONFIRMED",
          metadataRevision,
          lifecycleState: kind === "STORE_TOMBSTONE" ? "TOMBSTONED" : "ACTIVE",
        },
      };
    }
    const keyDigest = await digest(conversationKey || binding?.conversation_key || binding?.conversation_id || binding?.binding_id || "unbound");
    const bindingId = text(binding?.binding_id, 128), baseBindingRevision = integer(binding?.revision) || 0;
    const bindingRevision = kind === "FINISH" ? baseBindingRevision + 1 : baseBindingRevision;
    const storeId = text(store?.id || binding?.store_context?.storeId, 128), marketplace = text(store?.marketplace || binding?.store_context?.marketplace, 32);
    const credentialRevision = text(store?.credentialRevision || binding?.store_context?.credentialRevision, 128);
    return {
      auth, entityId: bindingId || keyDigest, payload: {
        kind, conversationKeyDigest: keyDigest, bindingId, bindingRevision,
        storeId, marketplace, credentialRevision,
        bindingState: kind === "FINISH" ? "FINISHED" : "BOUND",
        workGeneration: text(workGeneration, 160),
        ...(kind === "DELIVERY_MARKER" ? {
          deliveryMarkerId: text(deliveryId, 128),
          deliveryOrder: deliveryOrder && typeof deliveryOrder === "object" ? {
            aiOrderId: text(deliveryOrder.aiOrderId || deliveryOrder.messageId, 240),
            clientDeliveredAtMs: Number.isSafeInteger(Number(deliveryOrder.clientDeliveredAtMs || deliveryOrder.deliveredAtMs)) ? Number(deliveryOrder.clientDeliveredAtMs || deliveryOrder.deliveredAtMs) : null,
            clientSequence: Number.isSafeInteger(Number(deliveryOrder.clientSequence)) && Number(deliveryOrder.clientSequence) >= 0 ? Number(deliveryOrder.clientSequence) : null,
            orderProvenance: text(deliveryOrder.orderProvenance, 32) || undefined,
          } : undefined,
        } : {})
      }
    };
  }
  function compact(next, entityId) {
    const related = Object.values(next.entries).filter(entry => entry.entityId === entityId);
    const replaceable = related.filter(entry => ["PENDING", "RETRY_WAIT"].includes(entry.status));
    for (const kind of ["BINDING_UPSERT", "FINISH", "DELIVERY_MARKER", "STORE_UPSERT", "STORE_TOMBSTONE"]) {
      const sameKind = replaceable.filter(entry => entry.kind === kind).sort((a, b) => a.localSequence - b.localSequence);
      for (const old of sameKind.slice(0, -1)) delete next.entries[old.entryId];
    }
    const storeEntries = replaceable.filter(entry => ["STORE_UPSERT", "STORE_TOMBSTONE"].includes(entry.kind)).sort((a, b) => a.localSequence - b.localSequence);
    const latestStore = storeEntries.at(-1);
    if (latestStore?.kind === "STORE_TOMBSTONE") for (const old of storeEntries) if (old.entryId !== latestStore.entryId) delete next.entries[old.entryId];
    const pendingExplicit = Object.values(next.entries).filter(entry => entry.entityId === entityId && ["BINDING_UPSERT", "FINISH"].includes(entry.kind) && ["PENDING", "RETRY_WAIT"].includes(entry.status)).sort((a, b) => a.localSequence - b.localSequence).at(-1);
    if (pendingExplicit) for (const marker of Object.values(next.entries)) if (marker.entityId === entityId && marker.kind === "DELIVERY_MARKER" && ["PENDING", "RETRY_WAIT"].includes(marker.status) && marker.localSequence < pendingExplicit.localSequence) delete next.entries[marker.entryId];
    const keys = Object.keys(next.entries);
    if (keys.length > MAX_ENTRIES) {
      const removable = Object.values(next.entries).filter(entry => ["PENDING", "RETRY_WAIT", "FAILED"].includes(entry.status)).sort((a, b) => a.localSequence - b.localSequence);
      for (const old of removable) {
        if (Object.keys(next.entries).length <= MAX_ENTRIES) break;
        delete next.entries[old.entryId];
      }
    }
    if (Object.keys(next.entries).length > MAX_ENTRIES) throw Object.assign(new Error("SYNC_JOURNAL_FULL"), { code: "SYNC_JOURNAL_FULL" });
  }
  function entryFor(next, record, auth, payload) {
    next.sequence += 1;
    const requestId = crypto.randomUUID(), mutationId = `${auth.installationId}:${next.sequence}`;
    return {
      entryId: `${record.entityId}:${next.sequence}`, requestId, mutationId, entityId: record.entityId,
      accountId: auth.accountId, installationId: auth.installationId, baseRevision: integer(next.serverRevisions[record.entityId]),
      localSequence: next.sequence, mutationGeneration: `${auth.installationId}:${record.entityId}:${next.sequence}`,
      kind: payload.kind, payload: clone(payload), status: "PENDING", attempts: 0,
      nextAttemptAt: 0, lastAttemptAt: 0, lastError: null, conflict: null,
      createdAt: Date.now()
    };
  }
  async function record(kind, input = {}) {
    const entry = await mutate(async () => {
      const recordData = await metadata({ ...input, kind });
      const next = clone(await read());
      const entry = entryFor(next, recordData, recordData.auth, recordData.payload);
      next.entries[entry.entryId] = entry;
      compact(next, entry.entityId);
      await write(next);
      return entry;
    });
    await schedule();
    return clone(entry);
  }
  function wireEntry(entry) {
    return { requestId: entry.requestId, mutationId: entry.mutationId, entityId: entry.entityId,
      baseRevision: entry.baseRevision, localSequence: entry.localSequence, mutationGeneration: entry.mutationGeneration,
      kind: entry.kind, payload: clone(entry.payload) };
  }
  function retryable(error) {
    return error?.code === "CONTROL_TRANSPORT_UNAVAILABLE" || [408, 425, 429, 500, 502, 503, 504].includes(Number(error?.status)) || error?.code === "SERVICE_UNAVAILABLE";
  }
  function authDenied(error) {
    return [401, 403].includes(Number(error?.status)) || ["UNAUTHORIZED", "DEVICE_MISMATCH", "DEVICE_REVOKED", "AUTH_REFRESH_INVALID", "ACCOUNT_IDENTITY_MISMATCH"].includes(error?.code);
  }
  async function schedule() {
    const next = await read(), due = Object.values(next.entries).filter(entry =>
      ["PENDING", "RETRY_WAIT"].includes(entry.status) && entry.kind !== "DELIVERY_MARKER");
    const scheduler = globalThis.SellerAgentsTechnicalScheduler;
    if (!due.length) {
      await scheduler?.cancelKind?.(scheduler.KINDS.SYNC);
      return;
    }
    const first = due.sort((a, b) => (a.nextAttemptAt || 0) - (b.nextAttemptAt || 0) || a.localSequence - b.localSequence)[0];
    await scheduler?.schedule?.(scheduler.KINDS.SYNC, {
      taskId: "sync:pending",
      dueAt: first.nextAttemptAt || Date.now() + 5000,
      identity: { requestId: first.requestId, installationId: first.installationId, retryGeneration: first.attempts },
    });
  }
  async function markBatch(entries, patch) {
    return mutate(async () => {
      const next = clone(await read());
      for (const entry of entries) if (next.entries[entry.entryId]) Object.assign(next.entries[entry.entryId], patch(entry));
      return write(next);
    });
  }
  async function syncNow(reason = "scheduled") {
    if (syncFlight) return syncFlight;
    syncFlight = (async () => {
      const now = Date.now(), next = await read();
      const selected = Object.values(next.entries).filter(entry => ["PENDING", "RETRY_WAIT"].includes(entry.status) && (entry.nextAttemptAt || 0) <= now).sort((a, b) => a.localSequence - b.localSequence).slice(0, MAX_BATCH);
      if (!selected.length) { await schedule(); return { ok: true, sent: 0, reason }; }
      await markBatch(selected, entry => ({ status: "IN_FLIGHT", attempts: entry.attempts + 1, attempt_worker_id: String(globalThis.WORKER_SESSION_ID || "worker-unknown"), lastAttemptAt: now, lastError: null }));
      try {
        const result = await SellerAgentsControlClient.synchronizeMetadata({ syncVersion: VERSION, entries: selected.map(wireEntry) });
        if (!result || result.syncVersion !== VERSION || !Array.isArray(result.results)) throw Object.assign(new Error("SYNC_CONTRACT_INVALID"), { code: "SYNC_CONTRACT_INVALID" });
        const byRequest = new Map(result.results.map(row => [row?.requestId, row]));
        if (byRequest.size !== selected.length || selected.some(entry => !byRequest.has(entry.requestId))) throw Object.assign(new Error("SYNC_CONTRACT_INVALID"), { code: "SYNC_CONTRACT_INVALID" });
        await mutate(async () => {
          const current = await read();
          for (const entry of selected) {
            const row = byRequest.get(entry.requestId), live = current.entries[entry.entryId];
            if (!live || row.mutationId !== live.mutationId || row.entityId !== live.entityId) throw Object.assign(new Error("SYNC_CONTRACT_INVALID"), { code: "SYNC_CONTRACT_INVALID" });
            const priorRevision = integer(current.serverRevisions[live.entityId]) || 0;
            if (Number(row.serverRevision) < priorRevision) continue;
            if (row.outcome === "ACK") {
              if (!Number.isSafeInteger(Number(row.serverRevision)) || Number(row.serverRevision) < live.baseRevision) throw Object.assign(new Error("SYNC_CONTRACT_INVALID"), { code: "SYNC_CONTRACT_INVALID" });
              current.serverRevisions[live.entityId] = Number(row.serverRevision);
              if (row.serverState) {
                if (["STORE_UPSERT", "STORE_TOMBSTONE"].includes(row.serverState.kind)) await globalThis.SellerAgentsActiveStoreCatalog?.applyRemoteMetadata?.(row.serverState);
                current.serverStates[live.entityId] = clone(row.serverState);
                current.reconciliation[live.entityId] = {
                  classification: row.code || row.serverState.reconciliation?.classification || (live.kind === "DELIVERY_MARKER" ? "IN_SYNC" : "SERVER_AHEAD_COMPATIBLE"),
                  preferred: row.serverState.reconciliation?.preferred || null,
                  serverRevision: Number(row.serverRevision),
                  serverState: clone(row.serverState),
                };
              } else if (live.kind === "DELIVERY_MARKER") {
                current.reconciliation[live.entityId] = { classification: "UNKNOWN_REMOTE_INSTALLATION_STATE", preferred: null, serverRevision: Number(row.serverRevision), serverState: null };
              }
              delete current.entries[live.entryId];
              for (const newer of Object.values(current.entries)) if (newer.entityId === live.entityId && newer.localSequence > live.localSequence && ["PENDING", "RETRY_WAIT"].includes(newer.status) && newer.baseRevision <= Number(row.serverRevision)) newer.baseRevision = Number(row.serverRevision);
            } else if (row.outcome === "CONFLICT") {
              if (row.serverState && ["STORE_UPSERT", "STORE_TOMBSTONE"].includes(row.serverState.kind)) await globalThis.SellerAgentsActiveStoreCatalog?.applyRemoteMetadata?.(row.serverState);
              live.status = "CONFLICT"; live.conflict = { serverRevision: integer(row.serverRevision), serverState: row.serverState || null, classification: row.code || "EXPLICIT_BINDING_CONFLICT" }; live.lastError = text(row.code, 128) || "SYNC_CONFLICT";
              current.reconciliation[live.entityId] = { classification: row.code || "EXPLICIT_BINDING_CONFLICT", preferred: row.serverState?.reconciliation?.preferred || null, serverRevision: integer(row.serverRevision), serverState: clone(row.serverState) };
            } else if (row.outcome === "RETRY") {
              live.status = "RETRY_WAIT"; live.nextAttemptAt = now + retryDelay(live.requestId, live.attempts); live.lastError = text(row.code, 128) || "SYNC_RETRY_WAIT";
            } else throw Object.assign(new Error("SYNC_CONTRACT_INVALID"), { code: "SYNC_CONTRACT_INVALID" });
          }
          await write(current);
        });
        await schedule(); return { ok: true, sent: selected.length, reason };
      } catch (error) {
        if (authDenied(error)) {
          await markBatch(selected, () => ({ status: "FAILED", nextAttemptAt: 0, lastError: text(error.code, 128) || "AUTH_REQUIRED" }));
        } else if (retryable(error)) {
          const retryAfterMs = Math.max(0, Number(error?.retryAfterMs) || 0);
          await markBatch(selected, entry => ({
            status: "RETRY_WAIT",
            nextAttemptAt: Date.now() + Math.min(MAX_RETRY_MS, Math.max(retryDelay(entry.requestId, entry.attempts), retryAfterMs)),
            lastError: text(error.code, 128) || "SYNC_RETRY_WAIT"
          }));
        } else {
          await markBatch(selected, () => ({ status: "FAILED", nextAttemptAt: 0, lastError: text(error.code, 128) || "SYNC_CONTRACT_INVALID" }));
        }
        await schedule(); return { ok: false, code: error?.code || "SYNC_FAILED", sent: 0, reason };
      }
    })().finally(() => { syncFlight = null; });
    return syncFlight;
  }
  async function assertCurrentActionAllowed(input = {}) {
    const auth = await identity();
    const keyDigest = await digest(input.conversationKey || input.binding?.conversation_key || input.binding?.binding_id || "unbound");
    const entityId = text(input.binding?.binding_id, 128) || keyDigest;
    const current = (await read()).reconciliation[entityId];
    if (!current?.serverState) return { allowed: true, code: null };
    const local = { accountId: auth.accountId, entityId, conversationKeyDigest: keyDigest, bindingId: input.binding?.binding_id || null, bindingRevision: integer(input.binding?.revision) || 0, storeId: input.store?.id || input.binding?.store_context?.storeId || null, marketplace: input.store?.marketplace || input.binding?.store_context?.marketplace || null, workGeneration: input.workGeneration || null, bindingState: "BOUND" };
    if (["EXPLICIT_BINDING_CONFLICT", "REQUIRES_EXPLICIT_USER_REBIND_RESOLUTION"].includes(current.classification))
      return { allowed: false, code: "SYNC_EXPLICIT_BINDING_CONFLICT" };
    return SellerAgentsReconciliation.allowsFutureAction({ local, server: current.serverState });
  }
  globalThis.SellerAgentsSyncJournal = Object.freeze({
    recordBinding: input => record("BINDING_UPSERT", input),
    recordFinish: input => record("FINISH", input),
    recordDeliveryMarker: input => record("DELIVERY_MARKER", input),
    recordStoreMetadata: input => record("STORE_UPSERT", input),
    recordStoreTombstone: input => record("STORE_TOMBSTONE", input),
    read: async () => clone(await read()),
    assertCurrentActionAllowed,
    syncNow,
    notifyNetworkRecovery: () => globalThis.SellerAgentsTechnicalScheduler?.wake?.("network_recovery") || syncNow("network_recovery")
  });
  queueMicrotask(() => { void globalThis.SellerAgentsTechnicalScheduler?.wake?.("worker_ready"); });
})();
