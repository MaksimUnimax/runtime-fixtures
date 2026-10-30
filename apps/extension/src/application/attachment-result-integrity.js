/* F-05 additive guard for frozen Ozon delivery modules. */
(() => {
  "use strict";

  const STATE_KEY = "__octoportF05AttachmentResultIntegrity__";
  const state = globalThis[STATE_KEY] || (globalThis[STATE_KEY] = { portListenerInstalled: false });
  const PORT_NAME = "ozon-attachment-delivery-v1";
  const ATTACHMENT_MODE = "attachment_watch_v1";
  const LEGACY_CODE = "RESULT_BUFFER_INTEGRITY_UNVERIFIABLE";

  function isKnownLegacyMaterializedProviderResult(entry) {
    const states = globalThis.SellerAgentsProviderOutcome?.STATES;
    const recovery = globalThis.SellerAgentsResultRecovery;
    return entry?.kind === "command" && entry.status === "complete" &&
      entry.result_phase === "MATERIALIZED" &&
      [states?.RESPONSE_RECEIVED, states?.COMPLETED_KNOWN, states?.FAILED_KNOWN,
        states?.RETRY_WAIT_KNOWN].filter(Boolean).includes(entry.provider_attempt?.state) &&
      recovery?.isLegacyBufferedResult?.(entry.result_buffer) === true;
  }

  function hasKnownLegacyProviderResult(owner) {
    return (owner?.batch?.entries || []).some(isKnownLegacyMaterializedProviderResult);
  }

  function assertLegacyReportNotClaimed(run, payload) {
    if (String(payload?.mode || "legacy") !== "batch_watch_v1" || !hasKnownLegacyProviderResult(run)) return;
    throw Object.assign(new Error("Сохранённый legacy report нельзя признать полным; доставка запрещена."), {
      code: LEGACY_CODE,
    });
  }

  function wrapClaimDelivery() {
    const model = globalThis.BridgeAutorunModel;
    if (!model || typeof model.claimDelivery !== "function" || model.claimDelivery.__f05LegacyDeliveryGuard === true) return;
    const original = model.claimDelivery;
    function claimDelivery(run, payload = {}) {
      assertLegacyReportNotClaimed(run, payload);
      return original.call(this, run, payload);
    }
    Object.defineProperty(claimDelivery, "__f05LegacyDeliveryGuard", { value: true });
    globalThis.BridgeAutorunModel = Object.freeze({ ...model, claimDelivery });
  }

  function ownerStorageKey(kind) {
    const keys = globalThis.OzonRuntime?.STORAGE_KEYS || {};
    return kind === "manual" ? keys.MANUAL_OPERATIONS : keys.AUTO_RUNS;
  }

  function ownerId(owner, kind) {
    return kind === "manual" ? String(owner?.operation_id || "") : String(owner?.run_id || "");
  }

  function senderContextMatchesOwner(port, message, owner) {
    const sender = port?.sender || {};
    const senderTab = Number(sender?.tab?.id || 0);
    if (!Number.isInteger(senderTab) || senderTab <= 0 || senderTab !== Number(owner?.tab_id || 0)) return false;

    const expectedOrigin = String(owner?.origin || "").trim().toLowerCase();
    const senderUrl = sender?.url || sender?.tab?.url || "";
    let senderOrigin = "";
    try {
      const parsed = new URL(String(senderUrl));
      if (parsed.protocol !== "https:") return false;
      senderOrigin = parsed.origin.toLowerCase();
    } catch (_) { return false; }
    if (!expectedOrigin || senderOrigin !== expectedOrigin) return false;

    const liveOwner = message?.live_owner;
    if (!liveOwner || typeof liveOwner !== "object" || Array.isArray(liveOwner)) return false;
    const liveOrigin = String(liveOwner.origin || "").trim().toLowerCase();
    const conversationId = String(liveOwner.conversation_id || "").trim().toLowerCase();
    if (liveOrigin !== expectedOrigin || conversationId !== String(owner?.conversation_id || "").trim().toLowerCase()) return false;
    try {
      const parsed = new URL(liveOrigin);
      if (parsed.protocol !== "https:" || parsed.origin.toLowerCase() !== liveOrigin) return false;
    } catch (_) { return false; }

    const identity = globalThis.BB2ConversationIdentity;
    const provider = identity?.providerForOrigin?.(liveOrigin);
    if (!provider) return false;
    const path = provider === "alice" ? `/chat/${conversationId}` : `/c/${conversationId}`;
    if (identity.conversationIdFromPath?.(path, provider) !== conversationId) return false;

    const messageKey = String(message?.conversation_key || "").trim().toLowerCase();
    const ownerKey = String(owner?.conversation_key || "").trim().toLowerCase();
    return Boolean(messageKey) && (!ownerKey || messageKey === ownerKey);
  }

  async function attachmentBlockCode(port, message) {
    const preferredKind = String(message?.owner_kind || "").toLowerCase();
    const preferredId = String(message?.owner_id || message?.run_id || message?.operation_id || "");
    const conversationKey = String(message?.conversation_key || "").trim().toLowerCase();
    const type = String(message?.type || "");
    const phaseByType = {
      OZ_ATTACHMENT_COMMIT: ["attachment_claimed"],
      OZ_ATTACHMENT_SEND_COMMIT: ["attachment_ready"],
      OZ_ATTACHMENT_ARTIFACT_META: ["attachment_committed", "attachment_ready", "attachment_send_committed"],
      OZ_ATTACHMENT_ARTIFACT_CHUNK: ["attachment_committed", "attachment_ready", "attachment_send_committed"],
    };
    const allowedPhases = phaseByType[type];
    if (!allowedPhases || !conversationKey) return null;
    const kinds = preferredKind ? [preferredKind] : ["manual", "autorun"];
    for (const kind of kinds) {
      if (kind !== "manual" && kind !== "autorun") continue;
      const storageKey = ownerStorageKey(kind);
      if (!storageKey) continue;
      const data = await chrome.storage.local.get(storageKey);
      const owner = data?.[storageKey]?.[conversationKey] || null;
      if (!owner || (preferredId && ownerId(owner, kind) !== preferredId)) continue;
      const delivery = owner.delivery || {};
      if (delivery.mode !== ATTACHMENT_MODE) continue;
      if (!senderContextMatchesOwner(port, message, owner)) return null;
      if (message?.delivery_id && String(delivery.delivery_id || "") !== String(message.delivery_id)) return null;
      if (!allowedPhases.includes(String(delivery.phase || ""))) return null;
      return hasKnownLegacyProviderResult(owner) ? LEGACY_CODE : null;
    }
    return null;
  }

  function postResponse(port, message, code) {
    try {
      port.postMessage({
        kind: "response",
        request_id: String(message?.request_id || ""),
        response: {
          ok: false,
          code,
          error: code === LEGACY_CODE
            ? "Сохранённый legacy report нельзя признать полным; действие с attachment запрещено."
            : "Не удалось проверить integrity сохранённого результата; действие с attachment запрещено.",
        },
      });
    } catch (_) {}
  }

  function guardAttachmentPort(port) {
    if (port?.name !== PORT_NAME || !port.onMessage || typeof port.onMessage.addListener !== "function") return;
    const event = port.onMessage;
    const originalAddListener = event.addListener;
    try {
      Object.defineProperty(event, "addListener", {
        configurable: true,
        writable: true,
        value(listener) {
          if (typeof listener !== "function") return originalAddListener.call(event, listener);
          return originalAddListener.call(event, (message) => {
            if (!Object.prototype.hasOwnProperty.call({
              OZ_ATTACHMENT_COMMIT: true,
              OZ_ATTACHMENT_SEND_COMMIT: true,
              OZ_ATTACHMENT_ARTIFACT_META: true,
              OZ_ATTACHMENT_ARTIFACT_CHUNK: true,
            }, String(message?.type || "")) || !message?.request_id) return listener(message);
            void attachmentBlockCode(port, message).then((code) => {
              if (code) postResponse(port, message, code);
              else listener(message);
            }).catch(() => postResponse(port, message, "RESULT_BUFFER_INTEGRITY_CHECK_UNAVAILABLE"));
          });
        },
      });
    } catch (_) {
      // Disconnect before the frozen worker receives any request if the guard cannot be installed.
      try { port.disconnect?.(); } catch (_) {}
    }
  }

  if (!state.portListenerInstalled && globalThis.chrome?.runtime?.onConnect?.addListener) {
    chrome.runtime.onConnect.addListener(guardAttachmentPort);
    state.portListenerInstalled = true;
  }
  wrapClaimDelivery();
})();
