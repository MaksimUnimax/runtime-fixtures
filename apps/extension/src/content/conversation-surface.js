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
    const pathname = location.pathname + (location.search || "") + (location.hash || "");
    // A retained empty Qwen frame may finish only the observed guest route
    // promotion. A different route ends that observation before any matching
    // historical text could be considered an owned-message witness.
    if (pending?.qwenRemountGap && (provider !== "qwen" ||
        !["/c/new-chat", "/c/guest"].includes(pathname))) {
      tracker.endStart(pending.intentId);
      pending = null;
    }
    const composer = adapter.composerContext?.() || null;
    const observedMessages = [...(adapter.userMessages?.() || []), ...(adapter.assistantMessages?.() || [])];
    const messages = observedMessages.filter((node) => node?.isConnected && (!node.getClientRects || node.getClientRects().length > 0) && !node.closest?.('[aria-hidden="true"], [hidden]'));
    const roots = new Set(messages.map((node) => node.closest?.("main, [role='main']") || document.body).filter(Boolean));
    const composerRoot = composer?.composer?.closest?.("main, [role='main']") || composer?.root || null;
    const allMainRoots = [...document.querySelectorAll("main, [role='main']")];
    const mainRoots = allMainRoots.filter((node) =>
      !node.getClientRects || node.getClientRects().length > 0);
    // Alice's guest chat can have no semantic main. Its empty editor uses a
    // nested composer root, but the first visible message is rooted at body.
    // Choose that same proven document root before the irreversible first
    // send; never generalize this fallback to another AI or ambiguous roots.
    const aliceNoMainRoot = provider === "alice" && mainRoots.length === 0 &&
      composer?.composer?.isConnected && document.body?.contains?.(composer.composer) &&
      (roots.size === 0 || (roots.size === 1 && roots.has(document.body)));
    // Qwen replaces its home-page main on the first guest send. Its observed
    // desktop content parent survives that transition. Use it only when one
    // visible main, the composer, and every visible message belong to it.
    // Exact owned-message witnessing and all navigation fences still apply.
    const allQwenRoots = provider === "qwen" ? [...document.querySelectorAll('.desktop-layout-content-inner')] : [];
    const qwenRoots = allQwenRoots.filter((node) => node.isConnected && node.getClientRects().length > 0 &&
        !node.closest('[aria-hidden="true"], [hidden]'));
    const qwenRoot = allMainRoots.length === 1 && qwenRoots.length === 1 && mainRoots.length === 1 && roots.size <= 1 &&
      composer?.composer?.isConnected && qwenRoots[0].contains(mainRoots[0]) &&
      qwenRoots[0].contains(composer.composer) && messages.every((node) => mainRoots[0].contains(node))
      ? qwenRoots[0] : null;
    // Qwen also keeps the SAME old main/composer briefly while that main has
    // no client rect. Retain only an already pending empty Start, with the
    // original nodes and exact prompt still present, on the observed route.
    // This and the fully empty remount frame suspend confirmation; neither
    // authorizes Send, retry, hidden history or a replacement surface.
    const qwenPartialGap = allMainRoots.length === 1 && mainRoots.length === 0 &&
      pending?.qwenInitialMain === allMainRoots[0] && allMainRoots[0].isConnected &&
      pending.qwenInitialComposer === composer?.composer && composer?.composer?.isConnected &&
      composerRoot === allMainRoots[0] && pending.root.contains(composer.composer) &&
      !allMainRoots[0].closest('[aria-hidden="true"], [hidden]') &&
      !composer.composer.closest('[aria-hidden="true"], [hidden]') &&
      text(composer.composer.value) === pending.text;
    const qwenGapRoot = pending?.emptySurface && pending.initialPath === "/" && pathname === "/c/new-chat" &&
      !pending.witnessId && pending.baseline.size === 0 &&
      allQwenRoots.length === 1 && qwenRoots.length === 1 && pending.root === qwenRoots[0] &&
      observedMessages.length === 0 &&
      ((allMainRoots.length === 0 && !composer) || qwenPartialGap) ? qwenRoots[0] : null;
    if (qwenGapRoot) pending.qwenRemountGap = true;
    const hasObservedRoot = ["claude", "deepseek"].includes(provider);
    const observedRoot = hasObservedRoot ? adapter.conversationRoot?.() || null : null;
    const observedRootValid = Boolean(observedRoot?.isConnected && composer?.composer?.isConnected &&
      observedRoot.contains(composer.composer) && messages.every(node => observedRoot.contains(node)));
    const root = hasObservedRoot ? (observedRootValid ? observedRoot : null) :
      aliceNoMainRoot ? document.body : qwenRoot || qwenGapRoot || (
      roots.size === 1 ? [...roots][0] :
      mainRoots.length === 1 ? mainRoots[0] : composerRoot);

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
    const messageIds = inSurface.map((node) => adapter.messageId(node)).filter(Boolean);
    let startWitness = null, startWitnessMessageId = null, renamePreviousId = null;
    if (pending && roots.size <= 1 && (pending.root === root || pending.witnessId)) {
      for (const node of adapter.userMessages?.() || []) {
        // Never discover a new witness on another root, or in hidden history.
        if (!inSurface.includes(node)) continue;
        const id = adapter.messageId(node);
        if (!id || pending.baseline.has(id) || text(adapter.messageText(node)) !== pending.text) continue;
        if (!pending.witnessId || id === pending.witnessId) {
          if (pending.witnessNode && pending.witnessNode !== node) pending.renameUnavailable = true;
          pending.witnessNode ||= node;
          pending.witnessId = id;
          pending.witnessRoot = root; pending.witnessPath = pathname;
          startWitness = pending.intentId;
          startWitnessMessageId = id;
          break;
        }
        // Primary guest trace: the same owned node receives its server UUID
        // 571 ms after /c/guest. Never infer this continuity from text alone.
        if (provider === "qwen" && pending.emptySurface && pending.initialPath === "/" &&
            pending.baseline.size === 0 && !pending.renameUnavailable &&
            node === pending.witnessNode && root === pending.witnessRoot && root === qwenRoot &&
            pathname === "/c/guest" && pathname === pending.witnessPath &&
            explicitIds.length === 0 && messageIds.filter(value => value === id).length === 1) {
          renamePreviousId = pending.witnessId;
          startWitness = pending.intentId; startWitnessMessageId = id;
          break;
        }
      }
    }
    const canonicalHref = document.querySelector('link[rel="canonical"][href]')?.href || "";
    if (provider === "qwen" && pending?.witnessNode && !startWitness) pending.renameUnavailable = true;
    const surfaceConfirmed = Boolean(!qwenGapRoot && root && roots.size <= 1 &&
      (composer?.composer?.isConnected || inSurface.length));
    lastInput = { origin, provider, pathname, canonicalHref,
      explicitIds, requiresExplicitId: provider === "alice", root,
      qwenInitialMain: qwenRoot ? mainRoots[0] : null, qwenInitialComposer: qwenRoot ? composer.composer : null,
      surfaceConfirmed, hasMessages: inSurface.length > 0, messageIds, startWitness, startWitnessMessageId, renamePreviousId,
      conflict: roots.size > 1 ? "multiple_conversation_surfaces" : null };
    return lastInput;
  }
  function read(adapter) {
    const input = capture(adapter);
    if (input.renamePreviousId && tracker.renameStartMessage(input, input.renamePreviousId)) {
      pending.witnessId = input.startWitnessMessageId;
      pending.renameUnavailable = true;
    }
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
      emptySurface: lastInput.surfaceConfirmed && !lastInput.hasMessages, initialPath: lastInput.pathname,
      qwenInitialMain: lastInput.qwenInitialMain, qwenInitialComposer: lastInput.qwenInitialComposer,
      baseline: new Set((adapter.userMessages?.() || []).map((node) => adapter.messageId(node)).filter(Boolean)) };
    return identity;
  }
  function endStart(intentId, reason = "terminal") {
    const retainWitness = reason === "active_visible" &&
      pending?.intentId === String(intentId) && Boolean(pending.witnessId);
    tracker.endStart(intentId, { retainWitness });
    if (!retainWitness && pending?.intentId === String(intentId)) pending = null;
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
