/* One document-scoped observation shared by text and attachment delivery. */
(() => {
  "use strict";
  if (globalThis.SellerAgentsConversationSurface?.version === 1) return;
  const core = globalThis.SellerAgentsConversationIdentity;
  const tracker = core.createTracker({ newToken: () => crypto.randomUUID() });
  const text = (value) => String(value || "").replace(/\s+/g, " ").trim();
  let pending = null;
  let lastInput = null;
  let address = null;
  function locatorDigest() {
    const value = location.origin + location.pathname + (location.search || "") + (location.hash || "");
    if (address?.value === value) return address;
    const entry = { value, digest: null, promise: null };
    address = entry;
    entry.promise = crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
      .then((bytes) => { entry.digest = [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); })
      .catch(() => { entry.failed = true; });
    return entry;
  }
  function capture(adapter) {
    const origin = String(location.origin).toLowerCase();
    const provider = globalThis.BB2ConversationIdentity.providerForOrigin(origin);
    if (!adapter || adapter.id !== provider) return { origin, provider: null };
    const composer = adapter.composerContext?.() || null;
    const messages = [...(adapter.userMessages?.() || []), ...(adapter.assistantMessages?.() || [])]
      .filter((node) => node?.isConnected && (!node.getClientRects || node.getClientRects().length > 0) && !node.closest?.('[aria-hidden="true"], [hidden]'));
    const roots = new Set(messages.map((node) => node.closest?.("main, [role='main']") || document.body).filter(Boolean));
    const composerRoot = composer?.composer?.closest?.("main, [role='main']") || composer?.root || null;
    const mainRoots = [...document.querySelectorAll("main, [role='main']")].filter((node) =>
      !node.getClientRects || node.getClientRects().length > 0);
    const root = roots.size === 1 ? [...roots][0] :
      mainRoots.length === 1 ? mainRoots[0] : composerRoot;

    const inSurface = root ? messages.filter((node) => root.contains(node)) : [];
    const explicitIds = [];
    // Read only identifiers with a declared conversation meaning, on the
    // selected surface itself. A region id or arbitrary DOM UUID is not one.
    for (const attribute of ["data-conversation-id", "data-chat-id", "data-thread-id"]) {
      const id = root?.getAttribute?.(attribute);
      if (id) explicitIds.push(id);
    }
    if (provider === "alice") {
      const active = document.querySelector('button[data-testid="chatlist-item-active"][aria-current="page"]');
      const item = active?.closest?.(".ChatListItem[id]");
      if (item?.id) explicitIds.push(item.id);
    }
    let startWitness = null;
    if (pending && pending.root === root) {
      for (const node of adapter.userMessages?.() || []) {
        const id = adapter.messageId(node);
        if (id && !pending.baseline.has(id) && text(adapter.messageText(node)) === pending.text) {
          startWitness = pending.intentId;
          break;
        }
      }
    }
    const canonicalHref = document.querySelector('link[rel="canonical"][href]')?.href || "";
    const messageIds = inSurface.map((node) => adapter.messageId(node)).filter(Boolean);
    const surfaceConfirmed = Boolean(root && roots.size <= 1 &&
      (composer?.composer?.isConnected || inSurface.length));
    lastInput = { origin, provider, pathname: location.pathname + (location.search || "") + (location.hash || ""), canonicalHref,
      explicitIds, requiresExplicitId: provider === "alice", root,
      surfaceConfirmed, hasMessages: inSurface.length > 0, messageIds, startWitness,
      conflict: roots.size > 1 ? "multiple_conversation_surfaces" : null };
    return lastInput;
  }
  function read(adapter) {
    const input = capture(adapter);
    const identity = tracker.observe(input);
    const digest = locatorDigest();
    if (!digest.digest) return { ...identity, conversation_id: null, status: "unknown", source: digest.failed ? "surface_proof_unavailable" : "surface_proof_pending" };
    return { ...identity, identity_evidence: { version: 1, locator_digest: digest.digest, message_ids: (input.messageIds || []).slice(-32) } };
  }
  async function ready(adapter) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const identity = read(adapter);
      if (identity.source !== "surface_proof_pending") return identity;
      await address.promise;
    }
    return read(adapter);
  }
  function adoptLocal(adapter, message) {
    const here = read(adapter);
    if (here.surface_id !== message.surface_id || !core.matchingProof(here.identity_evidence, message.identity_evidence)) return null;
    if (!tracker.adoptLocal(message.conversation_id, here.surface_id)) return null;
    return read(adapter);
  }
  function beginStart(adapter, intentId, prompt) {
    const identity = read(adapter);
    if (!lastInput?.root) throw Object.assign(new Error("Не найдено поле текущего диалога."), { code: "CONVERSATION_SURFACE_UNAVAILABLE" });
    tracker.beginStart(intentId);
    pending = { intentId: String(intentId), text: text(prompt), root: lastInput.root,
      baseline: new Set((adapter.userMessages?.() || []).map((node) => adapter.messageId(node)).filter(Boolean)) };
    return identity;
  }
  function endStart(intentId) {
    tracker.endStart(intentId);
    if (pending?.intentId === String(intentId)) pending = null;
  }
  function confirmCurrent(adapter) {
    const input = capture(adapter);
    pending = null;
    return tracker.confirmSurface(input);
  }
  globalThis.SellerAgentsConversationSurface = Object.freeze({
    version: 1, read, ready, beginStart, endStart, confirmCurrent, adoptLocal
  });
})();
