/* Ephemeral signed adapter profile consumer. Packaged behavior only; no remote selectors/code. */
(() => {
  "use strict";

  const consumer = globalThis.SellerAgentsSignedAiProfileConsumer;
  const bridge = globalThis.SellerAgentsSignedProfileDomBridge;
  if (!consumer || !bridge) return;

  let disposed = false;
  let applied = null;
  let pending = null;
  let epoch = 0;

  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function scopeKey(scope) { return scope ? `${scope.family}|${scope.surface}|${scope.variant ?? ""}` : ""; }
  function currentScope() {
    const value = bridge.scope?.();
    if (!value || !["chatgpt", "alice"].includes(value.family) || value.surface !== "web" || value.variant !== null) return null;
    return { family: value.family, surface: "web", variant: null };
  }
  function currentProfile() {
    const key = scopeKey(currentScope());
    return applied && applied.scopeKey === key ? applied.profile : null;
  }
  function sameAuthority(left, right) {
    return Boolean(left && right &&
      left.authGeneration === right.authGeneration &&
      left.bootstrapSnapshotSha256 === right.bootstrapSnapshotSha256);
  }
  function identity(profile) {
    return profile ? {
      profileKey: profile.profileKey,
      revision: profile.revision,
      scopeVariant: profile.scopeVariant,
      contentSha256: profile.contentSha256,
    } : null;
  }
  function sameIdentity(left, right) {
    return Boolean(left && right &&
      left.profileKey === right.profileKey &&
      left.revision === right.revision &&
      left.scopeVariant === right.scopeVariant &&
      left.contentSha256 === right.contentSha256);
  }
  function semanticRole(element) {
    if (!(element instanceof Element)) return null;
    const explicit = String(element.getAttribute("role") || "").trim().toLowerCase();
    if (["main", "article", "textbox", "button", "status"].includes(explicit)) return explicit;
    const tag = String(element.tagName || "").toLowerCase();
    if (tag === "main" || tag === "article" || tag === "button") return tag;
    if (tag === "textarea" || (tag === "input" && !["button", "submit", "reset", "checkbox", "radio", "file", "hidden"].includes(String(element.getAttribute("type") || "text").toLowerCase()))) return "textbox";
    if (element.getAttribute("contenteditable") === "true") return "textbox";
    return null;
  }
  function plan(slot) { return currentProfile()?.content?.selectors?.[slot] || null; }
  function firstResolved(planValue, resolve) {
    if (!planValue) return resolve({ kind: "packaged_selector_reference" });
    for (const primitive of [planValue.primary, ...(planValue.fallbacks || [])]) {
      const value = resolve(primitive);
      if (Array.isArray(value) ? value.length > 0 : Boolean(value)) return value;
    }
    return Array.isArray(resolve(planValue.primary)) ? [] : null;
  }
  function roleAllows(element, primitive) {
    return primitive?.kind !== "accessibility_role_name" || semanticRole(element) === primitive.role;
  }
  function resolveAssistantMessages(_adapter, baseline) {
    const rows = Array.isArray(baseline) ? baseline.filter((node) => node instanceof Element) : [];
    const p = plan("assistantResponse");
    if (!p) return rows;
    return firstResolved(p, (primitive) => primitive?.kind === "packaged_selector_reference"
      ? rows
      : rows.filter((node) => roleAllows(node, primitive)));
  }
  function resolveComposerContext(_adapter, baseline) {
    if (!baseline) return null;
    const p = plan("composer");
    if (!p) return baseline;
    return firstResolved(p, (primitive) => {
      if (primitive?.kind === "packaged_selector_reference") return baseline;
      return [baseline.composer, baseline.root, baseline.form].some((node) => roleAllows(node, primitive)) ? baseline : null;
    });
  }
  function resolveSendButton(_adapter, _context, baseline) {
    if (!(baseline instanceof Element)) return null;
    const p = plan("send");
    if (!p) return baseline;
    return firstResolved(p, (primitive) =>
      primitive?.kind === "packaged_selector_reference" || roleAllows(baseline, primitive) ? baseline : null);
  }
  function resolveConversationRoot() {
    const adapter = bridge.adapter?.();
    const context = adapter?.composerContext?.() || null;
    const baseline = context?.root || context?.form || null;
    const p = plan("conversation");
    if (!p) return baseline;
    return firstResolved(p, (primitive) => {
      if (!(baseline instanceof Element)) return null;
      return primitive?.kind === "packaged_selector_reference" || roleAllows(baseline, primitive) ? baseline : null;
    });
  }
  function workInFlight() { return bridge.workInFlight?.() === true; }

  function runtimeRequest(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          const error = chrome.runtime.lastError;
          if (error) reject(Object.assign(new Error("SIGNED_PROFILE_RUNTIME_MESSAGE_FAILED"), { code: "SIGNED_PROFILE_RUNTIME_MESSAGE_FAILED" }));
          else resolve(response);
        });
      } catch (_) {
        reject(Object.assign(new Error("SIGNED_PROFILE_RUNTIME_MESSAGE_FAILED"), { code: "SIGNED_PROFILE_RUNTIME_MESSAGE_FAILED" }));
      }
    });
  }
  async function sendReceipt(request, fields) {
    const receipt = {
      messageType: "OZ_SIGNED_AI_PROFILE_RECEIPT",
      protocolVersion: consumer.PROTOCOL_VERSION,
      requestId: request.requestId,
      ai: clone(request.ai),
      ...fields,
    };
    if (!consumer.validReceipt(receipt)) return { ok: false, accepted: false, code: "INVALID_PROFILE" };
    try { return await runtimeRequest(receipt); }
    catch (_) { return { ok: false, accepted: false, code: "STALE_REQUEST" }; }
  }
  function invalidatePending() {
    epoch += 1;
    pending = null;
  }
  function clearApplied() { applied = null; }
  function tokenCurrent(token) {
    return !disposed && token?.epoch === epoch && scopeKey(currentScope()) === token.scopeKey;
  }
  function responseCurrent(token) {
    return tokenCurrent(token) && pending === token;
  }
  async function refresh(reason = "refresh") {
    if (disposed) return { ok: false, code: "DISPOSED" };
    const ai = currentScope();
    if (!ai) { invalidatePending(); clearApplied(); return { ok: false, code: "AI_SCOPE_UNAVAILABLE" }; }

    const token = { epoch: ++epoch, requestId: crypto.randomUUID(), scopeKey: scopeKey(ai), reason };
    if (applied && applied.scopeKey !== token.scopeKey) clearApplied();
    pending = token;
    const request = {
      messageType: "OZ_REQUEST_SIGNED_AI_PROFILE",
      protocolVersion: consumer.PROTOCOL_VERSION,
      requestId: token.requestId,
      ai,
    };
    let response;
    try { response = await runtimeRequest(request); }
    catch (_) {
      if (responseCurrent(token)) { pending = null; clearApplied(); }
      return { ok: false, code: "PROFILE_REQUEST_FAILED" };
    }
    if (!responseCurrent(token)) return { ok: false, code: "STALE_REQUEST" };
    const responseValid = await consumer.validResponse(response);
    if (!responseCurrent(token)) return { ok: false, code: "STALE_REQUEST" };

    if (!responseValid) {
      if (applied && applied.scopeKey === token.scopeKey) clearApplied();
      const receipt = await sendReceipt(request, { status: "REJECTED", reason: "INVALID_PROFILE" });
      if (!tokenCurrent(token)) return { ok: false, code: "STALE_REQUEST" };
      if (pending === token) pending = null;
      return { ok: false, code: receipt?.code || "INVALID_PROFILE" };
    }
    if (response.requestId !== request.requestId || scopeKey(response.ai) !== token.scopeKey) {
      const receipt = await sendReceipt(request, { status: "REJECTED", reason: "STALE_REQUEST" });
      if (!tokenCurrent(token)) return { ok: false, code: "STALE_REQUEST" };
      if (pending === token) pending = null;
      return { ok: false, code: receipt?.code || "STALE_REQUEST" };
    }
    if (response.status === "UNAVAILABLE") {
      if (applied && applied.scopeKey === token.scopeKey) clearApplied();
      const receipt = await sendReceipt(request, { status: "CLEARED", reason: response.reason });
      if (!tokenCurrent(token)) return { ok: false, code: "STALE_REQUEST" };
      if (pending === token) pending = null;
      if (!receipt?.ok || receipt.accepted !== true) return { ok: false, code: receipt?.code || "STALE_REQUEST" };
      return { ok: true, status: "CLEARED", reason: response.reason };
    }
    if (ai.family !== "chatgpt") {
      if (applied && applied.scopeKey === token.scopeKey) clearApplied();
      const receipt = await sendReceipt(request, { status: "REJECTED", reason: "AI_SCOPE_MISMATCH" });
      if (!tokenCurrent(token)) return { ok: false, code: "STALE_REQUEST" };
      if (pending === token) pending = null;
      return { ok: false, code: receipt?.code || "AI_SCOPE_MISMATCH" };
    }
    if (workInFlight()) {
      const receipt = await sendReceipt(request, {
        status: "DEFERRED",
        authority: clone(response.authority),
        profile: identity(response.profile),
        reason: "WORK_IN_FLIGHT",
      });
      if (!tokenCurrent(token)) return { ok: false, code: "STALE_REQUEST" };
      if (pending === token) pending = null;
      if (!receipt?.ok || receipt.accepted !== true) return { ok: false, code: receipt?.code || "STALE_REQUEST" };
      return { ok: true, status: "DEFERRED" };
    }

    const next = {
      requestId: request.requestId,
      epoch: token.epoch,
      scopeKey: token.scopeKey,
      authority: clone(response.authority),
      profile: clone(response.profile),
    };
    applied = next;
    const receipt = await sendReceipt(request, {
      status: "APPLIED",
      authority: clone(response.authority),
      profile: identity(response.profile),
    });
    if (!tokenCurrent(token) || applied !== next) return { ok: false, code: "STALE_REQUEST" };
    if (pending === token) pending = null;
    if (!receipt?.ok || receipt.accepted !== true) {
      if (applied === next) clearApplied();
      queueMicrotask(() => { if (!disposed) void refresh("receipt_rejected"); });
      return { ok: false, code: receipt?.code || "STALE_REQUEST" };
    }
    return { ok: true, status: "APPLIED", requestId: next.requestId, authority: clone(next.authority), profile: identity(next.profile) };
  }
  async function ensure(expected) {
    const refreshed = await refresh("work_start_ensure");
    if (!refreshed?.ok || refreshed.status !== "APPLIED" || !applied) return { ok: false, applied: false, code: refreshed?.code || refreshed?.status || "PROFILE_NOT_APPLIED" };
    if (applied.requestId !== refreshed.requestId) return { ok: false, applied: false, code: "STALE_REQUEST" };
    if (!sameAuthority(applied.authority, expected?.authority) || !sameIdentity(identity(applied.profile), expected?.profile)) {
      const current = applied;
      if (current.requestId === refreshed.requestId) clearApplied();
      return { ok: false, applied: false, code: "PROFILE_FENCE_MISMATCH" };
    }
    return { ok: true, applied: true, authority: clone(applied.authority), profile: identity(applied.profile) };
  }
  function onRuntimeMessage(message, _sender, sendResponse) {
    if (message?.type === "OZ_SIGNED_AI_PROFILE_REFRESH") {
      invalidatePending();
      queueMicrotask(() => { if (!disposed) void refresh(message.reason === "profile_changed" ? "profile_changed" : "authority_changed"); });
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "OZ_SIGNED_AI_PROFILE_ENSURE") {
      ensure(message.expected).then(sendResponse).catch(() => sendResponse({ ok: false, applied: false, code: "PROFILE_ENSURE_FAILED" }));
      return true;
    }
    return false;
  }

  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  globalThis.SellerAgentsSignedProfileRuntime = Object.freeze({
    refresh,
    ensure,
    resolveAssistantMessages,
    resolveComposerContext,
    resolveSendButton,
    resolveConversationRoot,
    debugState: () => ({
      applied: applied ? { authority: clone(applied.authority), profile: identity(applied.profile), scopeKey: applied.scopeKey } : null,
      pending: pending ? { requestId: pending.requestId, scopeKey: pending.scopeKey } : null,
      workInFlight: workInFlight(),
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      invalidatePending();
      clearApplied();
      try { chrome.runtime.onMessage.removeListener(onRuntimeMessage); } catch (_) {}
    },
  });

  queueMicrotask(() => { if (!disposed) void refresh("module_start"); });
})();
