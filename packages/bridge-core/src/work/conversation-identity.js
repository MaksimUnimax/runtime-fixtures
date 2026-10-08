/* Shared conversation evidence and continuity model. No provider route prefixes. */
(() => {
  "use strict";
  const VERSION = 1;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const token = (value) => typeof value === "string" && value.length <= 256 && !/[\s|\u0000-\u001f]/u.test(value) ? value.trim().toLowerCase() : "";
  const unique = (items) => [...new Set((items || []).map(token).filter(Boolean))];
  const opaque = (items) => [...new Set((items || []).filter((value) =>
    typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\s|\u0000-\u001f]/u.test(value)))];
  function externalKey(value) {
    if (UUID.test(value)) return value.toLowerCase();
    const bytes = new TextEncoder().encode(value);
    return bytes.length <= 120 ? "ref:" + [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("") : null;
  }
  function originOf(value) {
    try { const url = new URL(value); return url.protocol === "https:" ? url.origin.toLowerCase() : ""; }
    catch (_) { return ""; }
  }
  function locator(value, origin) {
    try {
      const url = new URL(value, origin);
      if (url.origin.toLowerCase() !== originOf(origin)) return null;
      // Only an opaque identifier is a candidate. A candidate alone never
      // establishes that this is a conversation, or resolves multiple IDs.
      const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      return { path: (url.pathname.replace(/\/+$/, "") || "/") + url.search + url.hash, ids: unique(parts.filter((part) => UUID.test(part))) };
    } catch (_) { return null; }
  }
  function resolveEvidence(input = {}) {
    const origin = originOf(input.origin);
    const provider = token(input.provider);
    const path = locator(input.pathname || "/", origin);
    const base = { proof_version: VERSION, origin, ai_id: provider || null, chat_path: path?.path || "",
      conversation_id: null, status: "unknown", source: "surface_unverified",
      identity_scope: "none", surface_id: token(input.surfaceId) || null,
      account_scope: token(input.accountScope) || null };
    if (!origin || !provider) return { ...base, status: "unsupported", source: "unsupported_origin" };
    if (input.conflict) return { ...base, status: "conflict", source: String(input.conflict) };
    if (input.surfaceConfirmed !== true) return base;
    const explicit = opaque(input.explicitIds);
    if (explicit.length > 1) return { ...base, status: "conflict", source: "multiple_active_conversation_ids" };
    // A locator is a navigation signal, never proof that an arbitrary token
    // identifies a dialogue. Providers may expose an explicit active ID;
    // otherwise the shared tracker supplies a document-scoped binding.
    if (explicit.length && externalKey(explicit[0])) return { ...base, conversation_id: externalKey(explicit[0]), status: "confirmed",
      source: "active_surface_id", identity_scope: "conversation" };
    if (base.surface_id && input.hasMessages === true) return { ...base,
      conversation_id: "local:" + base.surface_id, status: "confirmed",
      source: "local_surface",
      identity_scope: "document" };
    return { ...base, source: "new_conversation_pending" };
  }
  function createTracker({ newToken }) {
    if (typeof newToken !== "function") throw new TypeError("newToken is required");
    let state = null;
    let start = null;
    let forceLocal = false;
    function beginStart(intentId) {
      if (!state) throw new Error("CONVERSATION_SURFACE_REQUIRED");
      start = { intentId: String(intentId), surfaceId: state.surfaceId,
        origin: state.origin, provider: state.provider, path: state.path,
        empty: state.ids.size === 0, root: state.root };
      return start.surfaceId;
    }
    function endStart(intentId, { retainWitness = false } = {}) {
      if (start?.intentId !== String(intentId)) return;
      // Only the completed, witnessed first send may bridge its still-pending
      // route promotion. Cancellation never authorizes later continuity.
      if (retainWitness && start.empty && !start.promoted && start.witnessId) start.completed = true;
      else start = null;
    }
    function observe(input) {
      const origin = originOf(input.origin), provider = token(input.provider);
      const path = locator(input.pathname || "/", origin)?.path || "";
      const ids = opaque(input.messageIds).slice(-256);
      const account = token(input.accountScope);
      const explicit = opaque(input.explicitIds);
      const externalId = explicit.length === 1 ? externalKey(explicit[0]) : null;
      if (start && start.surfaceId === state?.surfaceId &&
          start.root === input.root && input.startWitness === start.intentId &&
          input.startWitnessMessageId && ids.includes(input.startWitnessMessageId) &&
          (!start.witnessId || start.witnessId === input.startWitnessMessageId)) {
        start.witnessId = input.startWitnessMessageId;
      }
      let reason = null;
      if (!state || state.origin !== origin || state.provider !== provider || state.account !== account) reason = "context_changed";
      else if (externalId && state.externalId && externalId !== state.externalId) reason = "external_identity_changed";
      else if (path !== state.path) {
        const sameId = state.identity?.identity_scope === "conversation" &&
          resolveEvidence({ ...input, surfaceId: state.surfaceId }).conversation_id === state.identity.conversation_id;
        // A renderer may replace the root while assigning the first route.
        // Only an already recorded, still visible Start message can bridge it.
        const retainedWitness = start?.witnessId && input.surfaceConfirmed === true &&
          !input.conflict && explicit.length <= 1 &&
          input.startWitnessMessageId === start.witnessId && ids.includes(start.witnessId);
        const promotion = start && start.empty && start.surfaceId === state.surfaceId &&
          (start.root === input.root || retainedWitness) && input.startWitness === start.intentId &&
          (!start.completed || (input.startWitnessMessageId === start.witnessId &&
            ids.includes(start.witnessId)));
        if (!sameId && !promotion) {
          if (start && !start.completed && start.empty && start.root === input.root) return { ...state.identity, conversation_id: null, status: "unknown", source: "pending_route_continuity" };
          reason = "navigation";
        } else if (promotion) {
          start.promoted = true;
          if (start.completed) start = null;
        }
      } else if (state.ids.size && ids.length && !ids.some((id) => state.ids.has(id))) {
        // This might be a different dialogue or a virtualized history window.
        // Keep the old proof, suspend effects, and resume only on corroboration.
        return { ...state.identity, conversation_id: null, status: "unknown", source: "history_continuity_unverified" };
      } else if (state.ids.size && input.hasMessages !== true && input.surfaceConfirmed === true) {
        return { ...state.identity, conversation_id: null, status: "unknown", source: "history_continuity_unverified" };
      } else if (state.root !== input.root && state.ids.size === 0) reason = "empty_surface_replaced";
      if (reason) {
        state = { origin, provider, account, path, root: input.root, surfaceId: token(newToken()),
          ids: new Set(), identity: null };
        start = null;
        forceLocal = false;
      }
      if (externalId) state.externalId = externalId;
      state.path = path;
      state.root = input.root;
      ids.forEach((id) => state.ids.add(id));
      while (state.ids.size > 256) state.ids.delete(state.ids.values().next().value);
      const identity = resolveEvidence({ ...input, surfaceId: state.surfaceId });
      if (forceLocal && identity.status === "confirmed") {
        identity.conversation_id = "local:" + state.surfaceId;
        identity.identity_scope = "document";
        identity.source = "explicit_local_surface";
      }
      // A local binding never changes its address mid-operation merely because
      // a stronger identifier appeared. Recovery in a new document must prove
      // an external identity again; it cannot resurrect this local token.
      if (state.identity?.identity_scope === "document" && identity.status === "confirmed") {
        identity.conversation_id = state.identity.conversation_id;
        identity.identity_scope = "document";
        identity.source = "local_surface_continuity";
      }
      state.identity = identity;
      return { ...identity };
    }
    function adoptLocal(id, surfaceId) {
      if (!state || state.surfaceId !== surfaceId || !isLocal(id) || !state.identity || state.identity.status !== "confirmed") return false;
      state.identity = { ...state.identity, conversation_id: id, identity_scope: "document", source: "local_evidence_restored" };
      return true;
    }
    function confirmSurface(input) {
      state = null; start = null; forceLocal = false;
      observe(input);
      forceLocal = true;
      return observe(input);
    }
    return Object.freeze({ observe, beginStart, endStart, confirmSurface, adoptLocal });
  }
  function normalizeProof(value) {
    if (value?.version !== 1 || !/^[a-f0-9]{64}$/.test(String(value.locator_digest || ""))) return null;
    const message_ids = [...new Set((value.message_ids || []).filter((id) => typeof id === "string" && id.length > 0 && id.length <= 256 && !/[\u0000-\u001f]/u.test(id)))].slice(-32);
    return { version: 1, locator_digest: value.locator_digest, message_ids };
  }
  function matchingProof(left, right) {
    const a = normalizeProof(left), b = normalizeProof(right);
    return Boolean(a && b && a.locator_digest === b.locator_digest && a.message_ids.filter((id) => b.message_ids.includes(id)).length >= 2);
  }
  function isLocal(value) {
    return /(?:^|\|)local:[a-z0-9:-]+$/i.test(String(value || ""));
  }
  globalThis.SellerAgentsConversationIdentity = Object.freeze({
    VERSION, locator, originOf, resolveEvidence, createTracker, isLocal, normalizeProof, matchingProof
  });
})();
