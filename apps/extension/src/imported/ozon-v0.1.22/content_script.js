/* global BB2ConversationIdentity, BB2ManualControls, OzonContract, OzonRuntime, OzonAIAdapters, BB2ComposerSend, BB2ProvenWritingCapture */
(() => {
  "use strict";

  const VERSION = "0.1.22";
  const runtimeId = `${VERSION}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const RUNTIME_KEY = "__OZON_LLM_API_BRIDGE_RUNTIME__";
  const STAGE_ATTR = "data-ozon-bridge-stage";
  const STAGE_DELIVERY_ATTR = "data-ozon-bridge-delivery";
  const SEND_RENDER_WAIT_MS = 2000;
  const SEND_TARGET_STABLE_SAMPLES = 3;
  const SEND_TARGET_SAMPLE_INTERVAL_MS = 200;
  const SEND_TARGET_ATTEMPT_TIMEOUT_MS = 5000;
  const SEND_TARGET_RETRY_DELAYS_MS = Object.freeze([0, 500, 1000, 2000, 4000, 8000]);
  const SEND_CLICK_RETRY_DELAYS_MS = Object.freeze([0, 250, 500, 1000, 2000]);
  const SEND_CLICK_RETRYABLE_CODES = Object.freeze([
    "SEND_TARGET_INCOMPLETE",
    "COMPOSER_DETACHED",
    "COMPOSER_FORM_DETACHED",
    "BUTTON_DETACHED",
    "COMPOSER_NOT_VISIBLE",
    "BUTTON_NOT_VISIBLE",
    "BUTTON_DISABLED",
    "BUTTON_ARIA_DISABLED",
    "BUTTON_COMPOSER_FORM_MISMATCH",
    "BUTTON_CLICK_FAILED"
  ]);
  const COMPOSER_SEND_SETTLE_TIMEOUT_MS = 7000;
  const BUSY_BLOCKS = new WeakSet();
  const OWN_BUTTONS = new Map();
  const manualKnownBlocks = new Set();
  let ownButtonHost = null;
  let ownButtonShadow = null;
  let positionRaf = 0;
  let aiMode = "auto";
  let activeAdapter = null;
  let observer = null;
  let manualFlushTimer = null;
  const manualPendingRoots = new Set();
  const manualTrackedRoots = new Set();
  let manualTailRoot = null;
  let manualEnabled = false;
  let manualConversationKey = null;
  let manualBridgeReady = false;
  let runtimeMessageListener = null;
  let workRuntimeGeneration = null;
  let sendButtonProfile = null;
  let microphoneButtonProfile = null;
  let copyButtonProfiles = [];
  let pickerState = null;
  let microphonePickerActive = false;
  let suppressPickerClick = false;
  const recoveryInFlight = new Set();
  const manualRecoveryInFlight = new Set();
  let activeDeliveryWatch = null;
  let activeManualComposerWait = null;
  const DELIVERY_WATCH_INTERVAL_MS = 2000;
  const MANUAL_COMPOSER_WAIT_TOAST_KEY = "manual-report-composer-wait";

  const AUTO_PROMPT_STABILITY_MS = 2000;
  const AUTO_PROMPT_DEBOUNCE_MS = 200;
  let autoObserver = null;
  let autoTimer = null;
  let activeAutoWatch = null;
  let autoFirstSeen = null;
  let autoTickInFlight = false;
  let identityPollTimer = null;
  let lastObservedConversationKey = null;
  let quotaWaitCountdownTimer = null;
  let quotaWaitProbeTimer = null;
  let quotaWaitProbeDeadline = 0;
  let activeQuotaWait = null;
  const workStartWatches = new Map();
  const QUOTA_WAIT_TOAST_KEY = "provider-quota-wait";

  const prior = globalThis[RUNTIME_KEY];
  if (prior?.dispose) { try { prior.dispose(); } catch (_) {} }
  const runtime = { id: runtimeId, disposed: false, dispose: null };
  globalThis[RUNTIME_KEY] = runtime;

  function current() { return !runtime.disposed && globalThis[RUNTIME_KEY] === runtime; }
  function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

  async function sha256Hex(value) {
    const bytes = new TextEncoder().encode(String(value || ""));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function assertRecoveryTextIntegrity(recovery) {
    const expected = String(recovery?.outgoing_hash || "").trim().toLowerCase();
    if (!expected) return true;
    const actual = await sha256Hex(String(recovery?.outgoing_text || ""));
    if (actual !== expected) {
      throw Object.assign(new Error("Сохранённый Ozon delivery text не совпадает с его SHA-256. Автоматическая отправка заблокирована."), { code: "DELIVERY_INTEGRITY_MISMATCH" });
    }
    return true;
  }
  function canonicalText(value) { return String(value || "").replace(/\u00a0/g, " ").replace(/\r\n/g, "\n").trim(); }
  function normalizedDeliveryText(value) { return canonicalText(value).replace(/\s+/g, " ").trim(); }

  function currentAIAdapter() {
    const resolved = OzonAIAdapters.adapterForLocation(aiMode);
    activeAdapter = resolved || null;
    return activeAdapter;
  }

  function assistantMessages() {
    const adapter = currentAIAdapter();
    return adapter ? adapter.assistantMessages() : [];
  }

  function userMessages() {
    const adapter = currentAIAdapter();
    return adapter ? adapter.userMessages() : [];
  }

  function turnSections() {
    return [...assistantMessages(), ...userMessages()];
  }

  globalThis.BB2CaptureEnvironment = Object.freeze({ turnSections });

  function assistantTurnIds() {
    const adapter = currentAIAdapter();
    if (!adapter) return [];
    return assistantMessages().map((message) => adapter.messageId(message)).filter(Boolean);
  }

  function userTurnIds() {
    const adapter = currentAIAdapter();
    if (!adapter) return [];
    return userMessages().map((message) => adapter.messageId(message)).filter(Boolean);
  }

  function userTurnRecords() {
    const adapter = currentAIAdapter();
    if (!adapter) return [];
    return userMessages().map((message) => ({
      id: adapter.messageId(message),
      text: canonicalText(adapter.messageText(message))
    })).filter((item) => item.id);
  }

  function matchingNewUserTurn(baselineIds, expectedText, requestId = "") {
    const baseline = baselineIds instanceof Set ? baselineIds : new Set(baselineIds || []);
    const expected = normalizedDeliveryText(expectedText);
    const requestToken = String(requestId || "").trim();
    for (const record of userTurnRecords()) {
      if (baseline.has(record.id)) continue;
      const actual = normalizedDeliveryText(record.text);
      if (expected && actual === expected) return record.id;
      if (requestToken && actual.includes("OZON_RESULT_V1") && actual.includes(requestToken)) return record.id;
    }
    return null;
  }

  function aliceActiveHistoryConversationId() {
    const active = document.querySelector('button[data-testid="chatlist-item-active"][aria-current="page"]');
    if (!(active instanceof Element)) return null;
    const item = active.closest('.ChatListItem[id]');
    if (!(item instanceof Element)) return null;
    return String(item.id || "").trim().toLowerCase() || null;
  }

  function conversationIdentity() {
    const canonicalHref = document.querySelector('link[rel="canonical"][href]')?.href || "";
    const adapter = currentAIAdapter();
    const activeConversationId = adapter?.id === "alice" ? aliceActiveHistoryConversationId() : null;
    const resolved = typeof BB2ConversationIdentity.resolveWithEvidence === "function"
      ? BB2ConversationIdentity.resolveWithEvidence({ origin: location.origin, pathname: location.pathname, canonicalHref, activeConversationId })
      : BB2ConversationIdentity.resolve({ origin: location.origin, pathname: location.pathname, canonicalHref });
    if (!adapter || resolved.ai_id !== adapter.id) {
      return { ...resolved, conversation_id: null, status: "adapter_mismatch", source: "ai_mode_mismatch", selected_ai_mode: aiMode, active_adapter_id: adapter?.id || null };
    }
    return { ...resolved, selected_ai_mode: aiMode, active_adapter_id: adapter.id };
  }

  function conversationKeyFromLocation() {
    const here = conversationIdentity();
    if (!here?.origin || !here?.conversation_id || here.status !== "confirmed") return null;
    return `${String(here.origin).toLowerCase()}|${String(here.conversation_id).toLowerCase()}`;
  }

  function sameConversation(origin, conversationId) {
    const here = conversationIdentity();
    return Boolean(
      here?.status === "confirmed" &&
      here?.conversation_id &&
      String(here.origin || "").toLowerCase() === String(origin || "").toLowerCase() &&
      String(here.conversation_id).toLowerCase() === String(conversationId || "").toLowerCase()
    );
  }

  function sendRuntime(type, payload = {}) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type, ...payload }, (response) => {
          const err = chrome.runtime.lastError;
          if (err) return resolve({ ok: false, code: "RUNTIME_ERROR", error: err.message });
          resolve(response || { ok: false, code: "EMPTY_RESPONSE", error: "Пустой ответ service worker." });
        });
      } catch (error) {
        resolve({ ok: false, code: "RUNTIME_ERROR", error: String(error?.message || error) });
      }
    });
  }

  function recordContentDiagnostic(event, details = {}) {
    sendRuntime("OZ_RECORD_DIAGNOSTIC", { event, details }).catch(() => null);
  }

  const statusToastByKey = new Map();

  function ensureToastRoot() {
    let root = document.getElementById("ozon-llm-api-bridge-toast-root");
    if (root) return root;
    root = document.createElement("div");
    root.id = "ozon-llm-api-bridge-toast-root";
    // Status plates belong at the top so they never cover the ChatGPT composer.
    Object.assign(root.style, { position: "fixed", right: "18px", top: "18px", zIndex: "2147483647", display: "grid", gap: "8px", maxWidth: "460px", pointerEvents: "none" });
    document.documentElement.appendChild(root);
    return root;
  }

  function clearToast(key) {
    const normalized = String(key || "");
    if (!normalized) return false;
    const previous = statusToastByKey.get(normalized);
    if (!previous) return false;
    statusToastByKey.delete(normalized);
    try { previous.remove(); } catch (_) {}
    return true;
  }

  function toast(text, tone = "info", timeout = 5000, key = "") {
    const normalizedKey = String(key || "");
    if (normalizedKey) clearToast(normalizedKey);
    const item = document.createElement("div");
    item.textContent = text;
    Object.assign(item.style, {
      position: "relative",
      font: "13px/1.4 system-ui, sans-serif", color: tone === "error" ? "#7f1d1d" : "#0f172a",
      background: tone === "error" ? "#fee2e2" : tone === "success" ? "#dcfce7" : "#e0f2fe",
      border: "1px solid rgba(15,23,42,.16)", borderRadius: "10px", padding: "10px 38px 10px 12px",
      boxShadow: "0 8px 24px rgba(15,23,42,.18)", pointerEvents: "auto", whiteSpace: "pre-wrap"
    });
    const remove = () => {
      if (normalizedKey && statusToastByKey.get(normalizedKey) === item) statusToastByKey.delete(normalizedKey);
      try { item.remove(); } catch (_) {}
    };
    const close = document.createElement("button");
    close.setAttribute("type", "button");
    close.setAttribute("aria-label", "Закрыть");
    close.setAttribute("title", "Закрыть");
    close.textContent = "×";
    Object.assign(close.style, {
      position: "absolute", right: "8px", top: "6px", width: "24px", height: "24px",
      padding: "0", border: "0", borderRadius: "6px", background: "transparent", color: "inherit",
      font: "700 20px/24px system-ui, sans-serif", textAlign: "center", cursor: "pointer", opacity: "0.72"
    });
    close.addEventListener("click", (event) => {
      try { event.preventDefault(); event.stopPropagation(); } catch (_) {}
      remove();
    });
    item.appendChild(close);
    ensureToastRoot().appendChild(item);
    if (normalizedKey) statusToastByKey.set(normalizedKey, item);
    if (Number(timeout) > 0) setTimeout(remove, timeout);
    return item;
  }

  function updateToastText(key, text) {
    const item = statusToastByKey.get(String(key || ""));
    if (!item) return false;
    const first = item.firstChild;
    if (first && first.nodeType === Node.TEXT_NODE) first.nodeValue = String(text || "");
    else item.insertBefore(document.createTextNode(String(text || "")), item.firstChild || null);
    return true;
  }

  function publicQuotaWaitFromState(response) {
    const manual = response?.manual_operation?.quota_wait;
    if (manual && Number(manual.next_allowed_at || 0) > 0) return manual;
    const auto = response?.auto_run?.quota_wait;
    if (auto && Number(auto.next_allowed_at || 0) > 0) return auto;
    return null;
  }

  function formatLocalClock(epochMs) {
    try {
      return new Date(Number(epochMs)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    } catch (_) { return "--:--:--"; }
  }

  function stopQuotaWaitProbe() {
    if (quotaWaitProbeTimer) clearInterval(quotaWaitProbeTimer);
    quotaWaitProbeTimer = null;
    quotaWaitProbeDeadline = 0;
  }

  function stopQuotaWaitCountdown({ clear = true } = {}) {
    if (quotaWaitCountdownTimer) clearInterval(quotaWaitCountdownTimer);
    quotaWaitCountdownTimer = null;
    activeQuotaWait = null;
    if (clear) clearToast(QUOTA_WAIT_TOAST_KEY);
  }

  function quotaWaitText(wait, now = Date.now()) {
    const due = Number(wait?.next_allowed_at || 0);
    if (!due) return "";
    const remainingMs = Math.max(0, due - Number(now));
    if (remainingMs <= 0) return "Лимит Ozon снят — отправляем запрос…";
    const seconds = Math.ceil(remainingMs / 1000);
    const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
    const ss = String(seconds % 60).padStart(2, "0");
    return [
      "Ожидание лимита Ozon",
      `Ограничение частоты запросов Ozon. Следующий запрос через ${mm}:${ss}.`,
      "Запрос сохранён и выполнится автоматически. Повторно нажимать не нужно.",
      `Следующая попытка: ${formatLocalClock(due)}`
    ].join("\n");
  }

  function renderQuotaWait(wait) {
    const due = Number(wait?.next_allowed_at || 0);
    if (!due) { stopQuotaWaitCountdown(); return false; }
    const same = Number(activeQuotaWait?.next_allowed_at || 0) === due;
    activeQuotaWait = { ...wait, next_allowed_at: due };
    const text = quotaWaitText(activeQuotaWait);
    if (!same || !statusToastByKey.has(QUOTA_WAIT_TOAST_KEY)) toast(text, "info", 0, QUOTA_WAIT_TOAST_KEY);
    else updateToastText(QUOTA_WAIT_TOAST_KEY, text);
    if (!quotaWaitCountdownTimer) {
      quotaWaitCountdownTimer = setInterval(() => {
        if (!current() || !activeQuotaWait) return;
        updateToastText(QUOTA_WAIT_TOAST_KEY, quotaWaitText(activeQuotaWait));
      }, 1000);
    }
    return true;
  }

  function syncQuotaWaitFromState(response) {
    const wait = publicQuotaWaitFromState(response);
    if (wait) { stopQuotaWaitProbe(); return renderQuotaWait(wait); }
    if (response?.ready === true || response?.manual_operation_active === false) stopQuotaWaitCountdown();
    return false;
  }

  function startQuotaWaitProbe() {
    stopQuotaWaitProbe();
    quotaWaitProbeDeadline = Date.now() + 5000;
    const probe = async () => {
      if (!current() || !manualEnabled || Date.now() > quotaWaitProbeDeadline) { stopQuotaWaitProbe(); return; }
      const key = conversationKeyFromLocation();
      if (!key || key !== manualConversationKey) { stopQuotaWaitProbe(); return; }
      const response = await sendRuntime("OZ_GET_MANUAL_STATE", { conversation_key: key });
      if (!response?.ok) return;
      if (syncQuotaWaitFromState(response)) return;
      if (response.ready === true || response.manual_operation_active === false) stopQuotaWaitProbe();
    };
    quotaWaitProbeTimer = setInterval(() => { void probe(); }, 250);
    void probe();
  }

  function visible(element) {
    if (!(element instanceof Element) || !element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function normalizeCopyButtonProfiles(value) {
    return BB2ManualControls.normalizeCopyButtonProfileCollection(value).profiles;
  }

  function replaceCopyButtonProfiles(value, reason = "update") {
    copyButtonProfiles = normalizeCopyButtonProfiles(value);
    recordContentDiagnostic("LEGACY_COPY_BUTTON_PROFILES_RETAINED", { reason, custom_profile_count: copyButtonProfiles.length, execution_dependency: false });
  }

  function assistantMessageContainer(node) {
    if (!(node instanceof Element)) return null;
    const adapter = currentAIAdapter();
    if (!adapter) return null;
    return adapter.assistantMessages().find((message) => message === node || message.contains(node)) || null;
  }

  function bindingFromRoot(root) {
    if (!(root instanceof Element)) return null;
    const adapter = currentAIAdapter();
    if (!adapter) return null;
    const message = assistantMessageContainer(root);
    if (!message) return null;
    const blocks = adapter.findCodeBlocks(message);
    if (!blocks.includes(root)) return null;
    return { root, body: root, section: message, adapter_id: adapter.id };
  }

  function supportedBindingsInSection(section) {
    const adapter = currentAIAdapter();
    if (!adapter || !(section instanceof Element)) return [];
    return adapter.findCodeBlocks(section).map((root) => ({ root, body: root, section, adapter_id: adapter.id }));
  }

  function commandText(binding) {
    const adapter = OzonAIAdapters.ADAPTERS[binding?.adapter_id] || currentAIAdapter();
    if (!adapter || !binding?.root?.isConnected) return "";
    return String(adapter.readCodeText(binding.root) || "");
  }


  function ensureOwnButtonSurface() {
    if (ownButtonHost?.isConnected && ownButtonShadow) return ownButtonShadow;
    const host = document.createElement("div");
    host.id = "ozon-bridge-own-button-host";
    Object.assign(host.style, {
      position: "fixed", inset: "0", zIndex: "2147483646", pointerEvents: "none",
      width: "0", height: "0", overflow: "visible"
    });
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      button.ozon-bridge-block-action {
        all: initial;
        box-sizing: border-box;
        position: fixed;
        min-width: 68px;
        height: 32px;
        padding: 0 10px;
        border: 1px solid rgba(37, 99, 235, .72);
        border-radius: 8px;
        background: rgba(37, 99, 235, .96);
        color: white;
        font: 700 12px/30px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        text-align: center;
        cursor: pointer;
        box-shadow: 0 4px 14px rgba(15, 23, 42, .24);
        pointer-events: auto;
        user-select: none;
        white-space: nowrap;
      }
      button.ozon-bridge-block-action:hover:not(:disabled) { filter: brightness(1.06); }
      button.ozon-bridge-block-action:focus-visible { outline: 3px solid rgba(96, 165, 250, .55); outline-offset: 2px; }
      button.ozon-bridge-block-action:disabled {
        cursor: default;
        background: rgba(71, 85, 105, .88);
        border-color: rgba(148, 163, 184, .7);
        color: rgba(255,255,255,.86);
        box-shadow: 0 2px 8px rgba(15,23,42,.16);
      }
    `;
    shadow.appendChild(style);
    (document.body || document.documentElement).appendChild(host);
    ownButtonHost = host;
    ownButtonShadow = shadow;
    return shadow;
  }

  function positionOwnButton(record) {
    if (!record?.button || !record?.binding?.root?.isConnected) return false;
    const adapter = OzonAIAdapters.ADAPTERS[record.binding.adapter_id] || currentAIAdapter();
    const anchor = adapter?.geometryAnchor(record.binding.root) || record.binding.root;
    if (!(anchor instanceof Element) || !anchor.isConnected) return false;
    const rect = anchor.getBoundingClientRect();
    const button = record.button;
    const width = Math.max(68, button.getBoundingClientRect().width || 68);
    const height = 32;
    const outsideLeft = rect.right + 10;
    const roomOutside = outsideLeft + width <= window.innerWidth - 8;
    let left;
    let top;
    if (roomOutside) {
      left = outsideLeft;
      top = Math.max(8, Math.min(window.innerHeight - height - 8, rect.top + 4));
    } else {
      left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + 8));
      top = Math.max(8, Math.min(window.innerHeight - height - 8, rect.top + 46));
    }
    button.style.left = `${Math.round(left)}px`;
    button.style.top = `${Math.round(top)}px`;
    const onScreen = rect.bottom >= 0 && rect.top <= window.innerHeight && rect.right >= 0 && rect.left <= window.innerWidth;
    button.style.display = onScreen ? "block" : "none";
    return true;
  }

  function scheduleOwnButtonPositioning() {
    if (positionRaf) return;
    positionRaf = requestAnimationFrame(() => {
      positionRaf = 0;
      for (const [block, record] of [...OWN_BUTTONS.entries()]) {
        if (!block.isConnected || !record.binding?.section?.isConnected) {
          try { record.resize_observer?.disconnect(); } catch (_) {}
          try { record.button.remove(); } catch (_) {}
          OWN_BUTTONS.delete(block);
          manualKnownBlocks.delete(block);
          continue;
        }
        positionOwnButton(record);
      }
    });
  }

  function removeOwnButton(block) {
    const record = OWN_BUTTONS.get(block);
    if (!record) return false;
    record.destroyed = true;
    try { record.resize_observer?.disconnect(); } catch (_) {}
    try { record.button.remove(); } catch (_) {}
    OWN_BUTTONS.delete(block);
    return true;
  }

  function clearOwnButtons() {
    for (const block of [...OWN_BUTTONS.keys()]) removeOwnButton(block);
    if (positionRaf) cancelAnimationFrame(positionRaf);
    positionRaf = 0;
    try { ownButtonHost?.remove(); } catch (_) {}
    ownButtonHost = null;
    ownButtonShadow = null;
  }

  function manualOperationLooksActive(operation) {
    return Boolean(operation && ["requesting", "delivering"].includes(String(operation.status || "")));
  }

  function renderOwnButton(record) {
    if (!record?.button) return;
    const ready = manualEnabled && manualBridgeReady;
    record.button.disabled = !ready || record.in_flight === true;
    record.button.textContent = record.in_flight ? "Ozon…" : "Ozon";
    record.button.title = ready
      ? `Ozon manual: выполнить команды из этого ${record.binding.adapter_id === "alice" ? "Alice" : "ChatGPT"} code block`
      : "Ozon manual: bridge занят; API-вызов заблокирован до завершения текущей delivery";
  }

  function setManualBridgeReady(ready, reason = "state_sync") {
    const next = ready === true;
    const changed = manualBridgeReady !== next;
    manualBridgeReady = next;
    if (next) stopQuotaWaitCountdown();
    if (next && manualEnabled) decorateExistingBindings();
    for (const record of OWN_BUTTONS.values()) renderOwnButton(record);
    if (changed) recordContentDiagnostic(next ? "MANUAL_BRIDGE_READY" : "MANUAL_BRIDGE_BUSY", {
      conversation_key: manualConversationKey || conversationKeyFromLocation() || "",
      reason,
      own_button_count: OWN_BUTTONS.size,
      ai_adapter: currentAIAdapter()?.id || null
    });
    return manualBridgeReady;
  }

  async function handleCopy(binding) {
    if (!manualEnabled) return;
    const currentKey = conversationKeyFromLocation();
    if (manualConversationKey !== currentKey) {
      await syncManualState();
      if (!manualEnabled || manualConversationKey !== currentKey) return;
    }
    const adapter = OzonAIAdapters.ADAPTERS[binding?.adapter_id] || currentAIAdapter();
    if (!adapter || !binding?.root?.isConnected || !binding?.section?.isConnected || !adapter.assistantMessages().includes(binding.section)) {
      toast("Ozon: code block был заменён/удалён. Ничего не отправлено; дождитесь повторного binding.", "error", 7000);
      scheduleManualRescan();
      return;
    }
    const text = commandText(binding); // Read live raw block text only now, on the extension-owned click.
    if (!manualBridgeReady) return;
    const blockNode = binding.root;
    if (BUSY_BLOCKS.has(blockNode)) {
      toast("Ozon: этот exact block node уже передан bridge. Повторный batch не отправлен.", "info");
      return;
    }
    setManualBridgeReady(false, "manual_batch_admission");
    BUSY_BLOCKS.add(blockNode);
    const operationConversationKey = String(manualConversationKey || currentKey);
    const manualRequestId = crypto.randomUUID();
    let accepted = false;
    toast("Ozon: передаю raw code block общему parser/queue…", "info", 0, "operation-state");
    try {
      const response = await sendRuntime("OZ_EXECUTE_COMMAND", { command_text: text, conversation_key: operationConversationKey, manual_request_id: manualRequestId });
      if (!response?.ok || response.accepted !== true) throw Object.assign(new Error(response?.error || "Ozon Bridge не принял batch."), { code: response?.code || "BATCH_NOT_ACCEPTED" });
      accepted = true;
      toast(`Ozon: batch принят (${Number(response.item_count || 0)} элементов). Запросы выполняются строго последовательно; итог будет отправлен одним сообщением.`, "success", 7000, "operation-state");
      startQuotaWaitProbe();
    } catch (error) {
      toast(`Ozon: ${error.message}`, "error", 0, "operation-state");
    } finally {
      BUSY_BLOCKS.delete(blockNode);
      const record = OWN_BUTTONS.get(binding.root);
      if (record) { record.in_flight = false; renderOwnButton(record); }
      if (!accepted) {
        try { await syncManualState(); } catch (_) {}
      }
    }
  }

  function decorateBinding(binding) {
    if (!manualEnabled || !binding?.root?.isConnected || OWN_BUTTONS.has(binding.root)) return false;
    const shadow = ensureOwnButtonSurface();
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ozon-bridge-block-action";
    button.setAttribute("aria-label", "Ozon Bridge — выполнить команды из этого code block");
    const record = { binding, button, in_flight: false, resize_observer: null, destroyed: false };
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (record.destroyed || OWN_BUTTONS.get(binding.root) !== record || !record.button.isConnected) return;
      if (!manualEnabled || !manualBridgeReady || record.in_flight) return;
      if (!binding.root.isConnected || !binding.section.isConnected) {
        removeOwnButton(binding.root);
        scheduleManualRescan();
        return;
      }
      record.in_flight = true;
      renderOwnButton(record);
      queueMicrotask(() => handleCopy(binding).finally(() => {
        record.in_flight = false;
        renderOwnButton(record);
      }));
    });
    shadow.appendChild(button);
    try {
      if (globalThis.ResizeObserver) {
        record.resize_observer = new ResizeObserver(() => scheduleOwnButtonPositioning());
        record.resize_observer.observe(binding.root);
      }
    } catch (_) { record.resize_observer = null; }
    OWN_BUTTONS.set(binding.root, record);
    renderOwnButton(record);
    positionOwnButton(record);
    recordContentDiagnostic("OWN_CODE_BUTTON_BOUND", {
      ai_adapter: binding.adapter_id,
      assistant_message_id: (OzonAIAdapters.ADAPTERS[binding.adapter_id] || currentAIAdapter())?.messageId(binding.section) || null
    });
    return true;
  }

  function allStructuralBindings() {
    const adapter = currentAIAdapter();
    if (!adapter) return [];
    const bindings = [];
    for (const message of adapter.assistantMessages()) {
      for (const root of adapter.findCodeBlocks(message)) {
        if (root?.isConnected) bindings.push({ root, body: root, section: message, adapter_id: adapter.id });
      }
    }
    return bindings;
  }

  function decorateExistingBindings() {
    if (!manualEnabled) return { roots: [], visitedNodes: 0, capped: false };
    const bindings = allStructuralBindings();
    for (const binding of bindings) {
      manualKnownBlocks.add(binding.root);
      decorateBinding(binding);
    }
    scheduleOwnButtonPositioning();
    return { roots: bindings.map((binding) => binding.root), visitedNodes: bindings.length, capped: false };
  }

  let manualRescanTimer = null;
  function scheduleManualRescan(delay = 60) {
    if (!manualEnabled || manualRescanTimer) return;
    manualRescanTimer = setTimeout(() => {
      manualRescanTimer = null;
      if (!manualEnabled) return;
      const bindings = allStructuralBindings();
      const live = new Set(bindings.map((binding) => binding.root));
      for (const block of [...manualKnownBlocks]) if (!live.has(block)) manualKnownBlocks.delete(block);
      for (const block of [...OWN_BUTTONS.keys()]) if (!live.has(block)) removeOwnButton(block);
      for (const binding of bindings) {
        if (manualKnownBlocks.has(binding.root)) continue;
        manualKnownBlocks.add(binding.root);
        decorateBinding(binding);
      }
      scheduleOwnButtonPositioning();
    }, delay);
  }

  function stopManualObserver() {
    manualEnabled = false;
    manualBridgeReady = false;
    if (observer) observer.disconnect();
    observer = null;
    if (manualFlushTimer) clearTimeout(manualFlushTimer);
    manualFlushTimer = null;
    if (manualRescanTimer) clearTimeout(manualRescanTimer);
    manualRescanTimer = null;
    manualPendingRoots.clear();
    manualTrackedRoots.clear();
    manualKnownBlocks.clear();
    manualTailRoot = null;
    clearOwnButtons();
    window.removeEventListener("scroll", scheduleOwnButtonPositioning, true);
    window.removeEventListener("resize", scheduleOwnButtonPositioning, true);
  }

  function startManualObserver() {
    if (!current() || !manualEnabled || observer) return;
    decorateExistingBindings();
    observer = new MutationObserver(() => {
      if (!manualEnabled) return;
      const currentKey = conversationKeyFromLocation();
      if (manualConversationKey !== currentKey) {
        void syncAllState();
        return;
      }
      scheduleManualRescan();
    });
    const observerRoot = document.querySelector("main") || document.body || document.documentElement;
    observer.observe(observerRoot, { childList: true, subtree: true, characterData: true });
    window.addEventListener("scroll", scheduleOwnButtonPositioning, true);
    window.addEventListener("resize", scheduleOwnButtonPositioning, true);
  }

  function applyManualMode(enabled, conversationKey = conversationKeyFromLocation()) {
    const next = enabled === true;
    const key = conversationKey || conversationKeyFromLocation();
    if (!key) {
      stopManualComposerWait("manual_context_missing");
      stopManualObserver();
      manualConversationKey = null;
      return false;
    }
    if (manualConversationKey && manualConversationKey !== key) {
      stopManualComposerWait("manual_conversation_changed");
      stopManualObserver();
    }
    manualConversationKey = String(key);
    if (next) {
      if (manualEnabled && observer) return true;
      manualEnabled = true;
      startManualObserver();
    } else {
      stopManualComposerWait("manual_mode_disabled");
      if (!manualEnabled && !observer && OWN_BUTTONS.size === 0) return true;
      stopManualObserver();
      manualConversationKey = String(key);
    }
    console.info(`[Ozon Bridge ${VERSION}] manual mode ${next ? "ON" : "OFF"} for ${key}`);
    return true;
  }

  async function syncManualState() {
    const key = conversationKeyFromLocation();
    if (!key) {
      applyManualMode(false, null);
      return { ok: false, code: "CONVERSATION_NOT_CONFIRMED" };
    }
    const response = await sendRuntime("OZ_GET_MANUAL_STATE", { conversation_key: key });
    const enabled = response?.ok && response.enabled === true;
    applyManualMode(enabled, key);
    setManualBridgeReady(enabled && response.ready === true, "manual_state_sync");
    syncQuotaWaitFromState(response);
    return response;
  }

  function chatgptInsideAssistantEditor(node) {
    return Boolean(node?.closest?.('section[data-turn="assistant"], [data-message-author-role="assistant"], [data-writing-block], [data-writing-block-id], #code-block-viewer'));
  }

  function chatgptComposerContextFromNode(node) {
    if (!(node instanceof HTMLElement) || !visible(node) || chatgptInsideAssistantEditor(node)) return null;
    const form = node.closest("form");
    if (!form || chatgptInsideAssistantEditor(form)) return null;
    return { composer: node, form };
  }

  function chatgptPrimaryComposerContext() {
    const selectors = ["#prompt-textarea", '[data-testid="prompt-textarea"]', 'textarea[id*="prompt" i]', 'textarea[data-testid*="prompt" i]', '[contenteditable="true"][id*="prompt" i]', '[contenteditable="true"][data-testid*="prompt" i]'];
    const candidates = [];
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        const context = chatgptComposerContextFromNode(node);
        if (!context) continue;
        let score = 0;
        if (node.id === "prompt-textarea") score += 1000;
        if ((node.getAttribute("data-testid") || "") === "prompt-textarea") score += 800;
        if (context.form.closest("#composer-background, [data-testid*='composer' i]")) score += 400;
        score += Math.min(200, node.getBoundingClientRect().top);
        candidates.push({ context, score });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.context || null;
  }

  function composerText(composer) {
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) return composer.value || "";
    return composer.textContent || "";
  }

  function setComposerText(composer, text) {
    composer.focus();
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(composer), "value");
      const setter = descriptor?.set;
      if (!setter) throw new Error("Composer value setter unavailable.");
      setter.call(composer, text);
    } else {
      composer.textContent = text;
    }
    composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    composer.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function buttonToken(button) {
    return [button.getAttribute("data-testid") || "", button.getAttribute("aria-label") || "", button.getAttribute("title") || "", button.getAttribute("name") || "", button.getAttribute("type") || "", button.textContent || ""].join(" ").toLowerCase();
  }

  function manualButtonSignature(button) {
    const testid = button.getAttribute("data-testid") || "";
    const aria = button.getAttribute("aria-label") || "";
    const title = button.getAttribute("title") || "";
    const name = button.getAttribute("name") || "";
    return {
      kind: "bb2_manual_send_button_v1",
      tag: button.tagName.toLowerCase(),
      testid, aria, title, name,
      type: button.getAttribute("type") || "",
      text_hint: (testid || aria || title || name) ? "" : canonicalText(button.textContent || "").slice(0, 120),
      form_index: null
    };
  }

  function signatureMatchesButton(profile, button) {
    if (!profile || profile.kind !== "bb2_manual_send_button_v1" || !(button instanceof HTMLElement)) return false;
    if (profile.tag && button.tagName.toLowerCase() !== profile.tag) return false;
    for (const [key, attribute] of [["testid", "data-testid"], ["aria", "aria-label"], ["title", "title"], ["name", "name"], ["type", "type"]]) {
      if (profile[key] && (button.getAttribute(attribute) || "") !== profile[key]) return false;
    }
    if (profile.text_hint && canonicalText(button.textContent || "").slice(0, 120) !== profile.text_hint) return false;
    return true;
  }

  function chatgptManualSendButton(context) {
    if (!sendButtonProfile || !context?.form) return null;
    const candidates = [...context.form.querySelectorAll('button, [role="button"], input[type="submit"]')]
      .filter((button) => signatureMatchesButton(sendButtonProfile, button))
      .filter((button) => visible(button) && !chatgptInsideAssistantEditor(button))
      .filter((button) => !(button instanceof HTMLButtonElement && button.disabled) && button.getAttribute("aria-disabled") !== "true");
    if (candidates.length === 1) return candidates[0];
    if (Number.isInteger(sendButtonProfile.form_index)) {
      const all = [...context.form.querySelectorAll('button, [role="button"], input[type="submit"]')];
      const indexed = all[sendButtonProfile.form_index] || null;
      if (indexed && candidates.includes(indexed)) return indexed;
    }
    return null;
  }

  function chatgptSendButtonCandidates(context) {
    if (!context?.form?.contains(context.composer)) return [];
    const workSubmit = chatgptWorkSubmitButton(context);
    if (workSubmit && !controlDisabled(workSubmit)) return [{ button: workSubmit, score: 2000 }];
    if (sendButtonProfile) {
      const manualCandidates = [...context.form.querySelectorAll('button, [role="button"], input[type="submit"]')]
        .filter((button) => signatureMatchesButton(sendButtonProfile, button))
        .filter((button) => button instanceof HTMLElement && visible(button) && !chatgptInsideAssistantEditor(button))
        .filter((button) => !(button instanceof HTMLButtonElement && button.disabled) && button.getAttribute("aria-disabled") !== "true");
      if (manualCandidates.length > 0) return manualCandidates;
    }
    return [...context.form.querySelectorAll('button, [role="button"], input[type="submit"]')]
      .filter((button) => button instanceof HTMLElement && visible(button) && !chatgptInsideAssistantEditor(button))
      .filter((button) => !(button instanceof HTMLButtonElement && button.disabled) && button.getAttribute("aria-disabled") !== "true")
      .filter((button) => !/stop|cancel|abort|останов|отмен/.test(buttonToken(button)))
      .map((button) => {
        const token = buttonToken(button);
        let score = 0;
        if ((button.getAttribute("data-testid") || "").toLowerCase().includes("send")) score += 1000;
        if (/\bsend\b|отправ/.test(token)) score += 600;
        if ((button.getAttribute("type") || "").toLowerCase() === "submit") score += 300;
        return { button, score };
      }).sort((a, b) => b.score - a.score);
  }

  function chatgptSendButton(context) {
    if (!context?.form?.contains(context.composer)) return null;
    const workSubmit = chatgptWorkSubmitButton(context);
    if (workSubmit && !controlDisabled(workSubmit)) return workSubmit;
    if (sendButtonProfile) {
      const manual = chatgptManualSendButton(context);
      if (manual) return manual;
    }
    const candidates = chatgptSendButtonCandidates(context);
    const top = candidates[0];
    if (!top) return null;
    if (top.score >= 600) return candidates.filter((x) => x.score === top.score).length === 1 ? top.button : null;
    const submitOnly = candidates.filter((x) => x.score === 300);
    return submitOnly.length === 1 ? submitOnly[0].button : null;
  }

  function sendButtonFingerprint(button) {
    if (!(button instanceof HTMLElement)) return "";
    return [
      button.tagName,
      button.getAttribute("data-testid") || "",
      button.getAttribute("aria-label") || "",
      button.getAttribute("title") || "",
      button.getAttribute("type") || "",
      button.getAttribute("name") || ""
    ].join("|");
  }


  function microphoneButtonSignature(button) {
    const base = manualButtonSignature(button);
    return { ...base, kind: "bb2_manual_microphone_button_v1" };
  }

  function signatureMatchesMicrophoneButton(profile, button) {
    if (!profile || profile.kind !== "bb2_manual_microphone_button_v1" || !(button instanceof HTMLElement)) return false;
    const comparable = { ...profile, kind: "bb2_manual_send_button_v1" };
    return signatureMatchesButton(comparable, button);
  }

  function chatgptAllComposerControls(context) {
    if (!context?.form?.contains(context.composer)) return [];
    return [...context.form.querySelectorAll('button, [role="button"], input[type="submit"]')]
      .filter((button) => button instanceof HTMLElement && visible(button) && !chatgptInsideAssistantEditor(button));
  }

  function chatgptBuiltinMicrophoneButton(context) {
    const candidates = chatgptAllComposerControls(context).filter((button) => {
      const testid = (button.getAttribute("data-testid") || "").toLowerCase();
      const token = buttonToken(button);
      return ["composer-speech-button", "voice-mode-button", "composer-voice-button", "microphone-button"].includes(testid) ||
        /(?:^|\s)(?:microphone|mic|voice mode|start voice|микрофон|голосов(?:ой|ого|ые)? режим)(?:\s|$)/u.test(token);
    });
    return candidates.length === 1 ? candidates[0] : null;
  }

  function chatgptMicrophoneButton(context) {
    if (!context?.form) return null;
    if (microphoneButtonProfile) {
      const manual = chatgptAllComposerControls(context).filter((button) => signatureMatchesMicrophoneButton(microphoneButtonProfile, button));
      if (manual.length === 1) return manual[0];
      if (Number.isInteger(microphoneButtonProfile.form_index)) {
        const all = [...context.form.querySelectorAll('button, [role="button"], input[type="submit"]')];
        const indexed = all[microphoneButtonProfile.form_index] || null;
        if (indexed && manual.includes(indexed)) return indexed;
      }
    }
    return chatgptBuiltinMicrophoneButton(context);
  }

  function chatgptWorkSubmitButton(context) {
    if (!context?.form?.contains(context.composer)) return null;
    const candidates = [...context.form.querySelectorAll('button#composer-submit-button[data-testid="send-button"]')]
      .filter((button) => button instanceof HTMLElement && visible(button) && !chatgptInsideAssistantEditor(button));
    return candidates.length === 1 ? candidates[0] : null;
  }

  function chatgptStopButton(context) {
    const candidates = chatgptAllComposerControls(context).filter((button) => {
      const testid = (button.getAttribute("data-testid") || "").toLowerCase();
      const token = buttonToken(button);
      return testid.includes("stop") || /(?:^|\s)(?:stop|stop generating|cancel generation|остановить|прервать генерац)(?:\s|$)/u.test(token);
    });
    return candidates.length === 1 ? candidates[0] : null;
  }

  function chatgptRecognizedSendControl(context) {
    if (!context?.form?.contains(context.composer)) return null;
    const workSubmit = chatgptWorkSubmitButton(context);
    if (workSubmit) return workSubmit;
    const controls = chatgptAllComposerControls(context);
    if (sendButtonProfile) {
      const manual = controls.filter((button) => signatureMatchesButton(sendButtonProfile, button));
      if (manual.length === 1) return manual[0];
      if (Number.isInteger(sendButtonProfile.form_index)) {
        const all = [...context.form.querySelectorAll('button, [role="button"], input[type="submit"]')];
        const indexed = all[sendButtonProfile.form_index] || null;
        if (indexed && manual.includes(indexed)) return indexed;
      }
    }
    const scored = controls
      .filter((button) => button !== chatgptMicrophoneButton(context) && button !== chatgptStopButton(context))
      .map((button) => {
        const testid = (button.getAttribute("data-testid") || "").toLowerCase();
        const token = buttonToken(button);
        let score = 0;
        if (testid === "send-button" || testid.includes("send-button")) score += 1000;
        if (/\bsend\b|отправ/u.test(token)) score += 600;
        if ((button.getAttribute("type") || "").toLowerCase() === "submit") score += 300;
        return { button, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);
    const top = scored[0];
    if (!top) return null;
    return scored.filter((item) => item.score === top.score).length === 1 ? top.button : null;
  }

  function controlDisabled(button) {
    return Boolean(button instanceof HTMLButtonElement && button.disabled) || button?.getAttribute?.("aria-disabled") === "true";
  }

  function classifyChatgptComposerControl() {
    const context = chatgptPrimaryComposerContext();
    if (!context) return { kind: "unknown", context: null, button: null };
    const workSubmit = chatgptWorkSubmitButton(context);
    if (workSubmit) return { kind: controlDisabled(workSubmit) ? "work_send_disabled" : "work_send_active", context, button: workSubmit };
    const microphone = chatgptMicrophoneButton(context);
    if (microphone) return { kind: "microphone", context, button: microphone };
    const stop = chatgptStopButton(context);
    if (stop) return { kind: "stop", context, button: stop };
    const send = chatgptRecognizedSendControl(context);
    if (send) return { kind: controlDisabled(send) ? "send_disabled" : "send_active", context, button: send };
    return { kind: "unknown", context, button: null };
  }


  // Alice delivery is isolated from the proven ChatGPT v0.1.12 composer/delivery resolver.
  function alicePrimaryComposerContext() {
    const adapter = currentAIAdapter();
    if (!adapter || adapter.id !== "alice" || typeof adapter.composerContext !== "function") return null;
    const context = adapter.composerContext();
    if (!context?.composer || !context?.root || !context.composer.isConnected || !context.root.isConnected) return null;
    if (!visible(context.composer)) return null;
    return context;
  }

  function aliceAllComposerControls(context) {
    const root = context?.root;
    if (!(root instanceof Element) || !root.contains(context?.composer)) return [];
    return [...root.querySelectorAll('button, [role="button"], input[type="submit"]')]
      .filter((button) => button instanceof HTMLElement && visible(button));
  }

  function classifyAliceComposerControl(context = alicePrimaryComposerContext()) {
    if (!context) return { kind: "unknown", context: null, button: null };
    const adapter = currentAIAdapter();
    if (!adapter || adapter.id !== "alice" || typeof adapter.classifyComposerControl !== "function") return { kind: "unknown", context, button: null };
    const classified = adapter.classifyComposerControl(context, visible);
    if (classified?.kind === "ready") return { kind: "alice_ready", context, button: classified.button || null };
    return { kind: classified?.kind || "unknown", context, button: classified?.button || null };
  }

  function aliceSendButtonCandidates(context) {
    const classified = classifyAliceComposerControl(context);
    if (["send_active", "send_disabled"].includes(classified.kind) && classified.button) return [{ button: classified.button, score: 2000 }];
    return [];
  }

  function aliceSendButton(context) {
    const classified = classifyAliceComposerControl(context);
    return classified.kind === "send_active" ? classified.button : null;
  }

  function primaryComposerContext() {
    const adapter = currentAIAdapter();
    if (!adapter) return null;
    return adapter.id === "alice" ? alicePrimaryComposerContext() : chatgptPrimaryComposerContext();
  }

  function allComposerControls(context) {
    const adapter = currentAIAdapter();
    if (!adapter) return [];
    return adapter.id === "alice" ? aliceAllComposerControls(context) : chatgptAllComposerControls(context);
  }

  function sendButtonCandidates(context) {
    const adapter = currentAIAdapter();
    if (!adapter) return [];
    return adapter.id === "alice" ? aliceSendButtonCandidates(context) : chatgptSendButtonCandidates(context);
  }

  function sendButton(context) {
    const adapter = currentAIAdapter();
    if (!adapter) return null;
    return adapter.id === "alice" ? aliceSendButton(context) : chatgptSendButton(context);
  }

  function microphoneButton(context) {
    const adapter = currentAIAdapter();
    if (!adapter || adapter.id === "alice") return null;
    return chatgptMicrophoneButton(context);
  }

  function stopButton(context) {
    const adapter = currentAIAdapter();
    if (!adapter) return null;
    if (adapter.id === "alice") {
      const classified = classifyAliceComposerControl(context);
      return classified.kind === "stop" ? classified.button : null;
    }
    return chatgptStopButton(context);
  }

  function recognizedSendControl(context) {
    const adapter = currentAIAdapter();
    if (!adapter) return null;
    if (adapter.id === "alice") {
      const classified = classifyAliceComposerControl(context);
      return ["send_active", "send_disabled"].includes(classified.kind) ? classified.button : null;
    }
    return chatgptRecognizedSendControl(context);
  }

  function classifyComposerControl() {
    const adapter = currentAIAdapter();
    if (!adapter) return { kind: "unknown", context: null, button: null };
    return adapter.id === "alice" ? classifyAliceComposerControl() : classifyChatgptComposerControl();
  }

  function diagnosticForControlKind(kind) {
    return {
      send_active: "BUTTON_SEND_ACTIVE",
      work_send_active: "BUTTON_WORK_SEND_ACTIVE",
      work_send_disabled: "BUTTON_WORK_SEND_DISABLED",
      send_disabled: "BUTTON_SEND_DISABLED",
      stop: "BUTTON_STOP",
      microphone: "BUTTON_MICROPHONE",
      alice_ready: "BUTTON_ALICE_READY",
      unknown: "BUTTON_UNKNOWN"
    }[kind] || "BUTTON_UNKNOWN";
  }

  function stopDeliveryWatch(reason = "stopped") {
    const active = activeDeliveryWatch;
    if (!active) return false;
    active.cancelled = true;
    if (typeof active.wake_cancel === "function") {
      try { active.wake_cancel(); } catch (_) {}
      active.wake_cancel = null;
    }
    activeDeliveryWatch = null;
    recordContentDiagnostic(reason === "delivery_success" ? "DELIVERY_WATCH_DESTROYED" : "DELIVERY_ABORTED", {
      run_id: active.run_id,
      delivery_id: active.delivery_id,
      reason
    });
    return true;
  }

  async function waitForDeliveryWatchWake(state) {
    if (!current() || !state || state.cancelled || activeDeliveryWatch !== state) return "cancelled";
    return await new Promise((resolve) => {
      let settled = false;
      let timer = null;
      let observer = null;
      let cancel = null;
      const finish = (reason) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (observer) {
          try { observer.disconnect(); } catch (_) {}
        }
        if (state.wake_cancel === cancel) state.wake_cancel = null;
        resolve(reason);
      };
      cancel = () => finish("cancelled");
      state.wake_cancel = cancel;
      try {
        const watchContext = primaryComposerContext();
        const watchRoot = watchContext?.form || watchContext?.root || document.documentElement;
        observer = new MutationObserver(() => finish("mutation"));
        observer.observe(watchRoot, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ["disabled", "aria-disabled", "class", "data-testid", "aria-label", "title"]
        });
      } catch (_) {
        observer = null;
      }
      timer = setTimeout(() => finish("timeout"), DELIVERY_WATCH_INTERVAL_MS);
    });
  }

  async function runBatchDeliveryWatch(recovery) {
    if (!recovery || recovery.delivery_mode !== "batch_watch_v1") return { ok: false, code: "BATCH_DELIVERY_MODE_MISMATCH" };
    if (!sameConversation(recovery.origin, recovery.conversation_id) || recovery.conversation_key !== conversationKeyFromLocation()) return { ok: false, code: "CONVERSATION_MISMATCH" };
    const ownerKind = String(recovery.owner_kind || "autorun");
    const ownerId = String(recovery.owner_id || recovery.run_id || recovery.operation_id || "");
    if (!ownerId) return { ok: false, code: "BATCH_DELIVERY_OWNER_MISSING" };
    if (activeDeliveryWatch?.delivery_id === recovery.delivery_id && activeDeliveryWatch?.owner_kind === ownerKind && activeDeliveryWatch?.owner_id === ownerId) return { ok: true, deduplicated: true };
    if (activeDeliveryWatch) stopDeliveryWatch("replaced");
    const state = {
      owner_kind: ownerKind,
      owner_id: ownerId,
      run_id: String(recovery.run_id || ""),
      conversation_key: String(recovery.conversation_key || ""),
      origin: String(recovery.origin || "").toLowerCase(),
      conversation_id: String(recovery.conversation_id || "").toLowerCase(),
      delivery_id: String(recovery.delivery_id || ""),
      click_attempts: 0,
      send_click_committed: false,
      wake_cancel: null,
      cancelled: false
    };
    activeDeliveryWatch = state;
    recordContentDiagnostic("DELIVERY_WATCH_STARTED", { owner_kind: state.owner_kind, owner_id: state.owner_id, delivery_id: state.delivery_id, fallback_poll_ms: DELIVERY_WATCH_INTERVAL_MS });

    while (current() && activeDeliveryWatch === state && !state.cancelled) {
      if (!sameConversation(state.origin, state.conversation_id) || state.conversation_key !== conversationKeyFromLocation()) {
        stopDeliveryWatch("conversation_changed");
        return { ok: false, code: "CONVERSATION_MISMATCH" };
      }
      const classified = classifyComposerControl();
      recordContentDiagnostic(diagnosticForControlKind(classified.kind), { owner_kind: state.owner_kind, owner_id: state.owner_id, delivery_id: state.delivery_id, click_attempts: state.click_attempts });
      if (classified.kind === "microphone") {
        // Proven ChatGPT v0.1.12 completion path: Microphone is the sole success marker.
        const completion = await sendRuntime("OZ_BATCH_DELIVERY_COMPLETE", {
          owner_kind: state.owner_kind,
          owner_id: state.owner_id,
          run_id: state.run_id,
          conversation_key: state.conversation_key,
          delivery_id: state.delivery_id,
          delivery_confirmed: true,
          confirmation_basis: "microphone",
          click_attempts: state.click_attempts
        });
        if (!completion?.ok) {
          recordContentDiagnostic("DELIVERY_SUCCESS_ACK_FAILED", { owner_kind: state.owner_kind, owner_id: state.owner_id, delivery_id: state.delivery_id, code: completion?.code || "DELIVERY_CONFIRMATION_REJECTED" });
          await sleep(DELIVERY_WATCH_INTERVAL_MS);
          continue;
        }
        recordContentDiagnostic("DELIVERY_SUCCESS", { owner_kind: state.owner_kind, owner_id: state.owner_id, delivery_id: state.delivery_id, click_attempts: state.click_attempts, confirmation_basis: "microphone" });
        toast("Ozon: объединённый batch-результат доставлен; Microphone подтверждён.", "success", 5000, "autorun-state");
        stopDeliveryWatch("delivery_success");
        if (state.owner_kind === "manual") {
          setManualBridgeReady(manualEnabled && manualConversationKey === state.conversation_key, "microphone_confirmed");
        }
        return { ok: true, delivered: true, click_attempts: state.click_attempts };
      }
      if (classified.kind === "work_send_disabled") {
        if (!state.send_click_committed) {
          recordContentDiagnostic("WORK_SEND_DISABLED_BEFORE_DELIVERY_CLICK_IGNORED", { owner_kind: state.owner_kind, owner_id: state.owner_id, delivery_id: state.delivery_id });
          await waitForDeliveryWatchWake(state);
          continue;
        }
        const completion = await sendRuntime("OZ_BATCH_DELIVERY_COMPLETE", { owner_kind: state.owner_kind, owner_id: state.owner_id, run_id: state.run_id, conversation_key: state.conversation_key, delivery_id: state.delivery_id, delivery_confirmed: true, confirmation_basis: "work_submit_disabled_after_click", click_attempts: state.click_attempts });
        if (!completion?.ok) { await sleep(DELIVERY_WATCH_INTERVAL_MS); continue; }
        recordContentDiagnostic("DELIVERY_SUCCESS", { owner_kind: state.owner_kind, owner_id: state.owner_id, delivery_id: state.delivery_id, click_attempts: state.click_attempts, confirmation_basis: "work_submit_disabled_after_click" });
        stopDeliveryWatch("delivery_success");
        if (state.owner_kind === "manual") setManualBridgeReady(manualEnabled && manualConversationKey === state.conversation_key, "work_submit_confirmed");
        return { ok: true, delivered: true, click_attempts: state.click_attempts };
      }
      if (classified.kind === "alice_ready") {
        // Alice has a different, explicit lifecycle control. It may confirm only after this delivery's one-shot Send click.
        if (!state.send_click_committed) {
          recordContentDiagnostic("ALICE_READY_BEFORE_DELIVERY_CLICK_IGNORED", { owner_kind: state.owner_kind, owner_id: state.owner_id, delivery_id: state.delivery_id, click_attempts: state.click_attempts });
          await waitForDeliveryWatchWake(state);
          continue;
        }
        const completion = await sendRuntime("OZ_BATCH_DELIVERY_COMPLETE", {
          owner_kind: state.owner_kind,
          owner_id: state.owner_id,
          run_id: state.run_id,
          conversation_key: state.conversation_key,
          delivery_id: state.delivery_id,
          delivery_confirmed: true,
          confirmation_basis: "alice_ready",
          click_attempts: state.click_attempts
        });
        if (!completion?.ok) {
          recordContentDiagnostic("DELIVERY_SUCCESS_ACK_FAILED", { owner_kind: state.owner_kind, owner_id: state.owner_id, delivery_id: state.delivery_id, code: completion?.code || "DELIVERY_CONFIRMATION_REJECTED" });
          await sleep(DELIVERY_WATCH_INTERVAL_MS);
          continue;
        }
        recordContentDiagnostic("DELIVERY_SUCCESS", { owner_kind: state.owner_kind, owner_id: state.owner_id, delivery_id: state.delivery_id, click_attempts: state.click_attempts, confirmation_basis: "alice_ready" });
        toast("Ozon: объединённый batch-результат доставлен; Alice снова готова к вводу.", "success", 5000, "autorun-state");
        stopDeliveryWatch("delivery_success");
        if (state.owner_kind === "manual") {
          setManualBridgeReady(manualEnabled && manualConversationKey === state.conversation_key, "alice_ready_confirmed");
        }
        return { ok: true, delivered: true, click_attempts: state.click_attempts };
      }
      if (["send_active", "work_send_active"].includes(classified.kind)) {
        if (state.send_click_committed) {
          recordContentDiagnostic("SEND_ACTIVE_IGNORED_AFTER_DELIVERY_CLICK", { owner_kind: state.owner_kind, owner_id: state.owner_id, delivery_id: state.delivery_id, click_attempts: state.click_attempts });
        } else {
          const fresh = classifyComposerControl();
          const button = ["send_active", "work_send_active"].includes(fresh.kind) ? fresh.button : null;
          if (button instanceof HTMLElement && button.isConnected && visible(button) && !controlDisabled(button)) {
            try {
              button.click();
              state.click_attempts += 1;
              state.send_click_committed = true;
              recordContentDiagnostic("SEND_CLICKED", { owner_kind: state.owner_kind, owner_id: state.owner_id, delivery_id: state.delivery_id, click_attempts: state.click_attempts });
            } catch (error) {
              recordContentDiagnostic("SEND_CLICK_FAILED", { owner_kind: state.owner_kind, owner_id: state.owner_id, delivery_id: state.delivery_id, code: error.code || "BUTTON_CLICK_FAILED", error: error.message || String(error) });
            }
          }
        }
      }
      await waitForDeliveryWatchWake(state);
    }
    return { ok: false, code: "DELIVERY_WATCH_STOPPED" };
  }

  function stopManualComposerWait(reason = "stopped", { clearPlate = true } = {}) {
    const state = activeManualComposerWait;
    if (state) {
      state.cancelled = true;
      if (typeof state.wake_cancel === "function") {
        try { state.wake_cancel(); } catch (_) {}
        state.wake_cancel = null;
      }
      activeManualComposerWait = null;
      recordContentDiagnostic("MANUAL_COMPOSER_WAIT_STOPPED", {
        owner_id: state.owner_id,
        delivery_id: state.delivery_id,
        reason
      });
    }
    if (clearPlate) clearToast(MANUAL_COMPOSER_WAIT_TOAST_KEY);
    return Boolean(state);
  }

  function showManualComposerWaitPlate() {
    if (!statusToastByKey.has(MANUAL_COMPOSER_WAIT_TOAST_KEY)) {
      toast("Очистите поле ввода, чтобы получить отчёт.", "info", 0, MANUAL_COMPOSER_WAIT_TOAST_KEY);
    }
  }

  async function waitForManualComposerWake(state) {
    if (!current() || !state || state.cancelled || activeManualComposerWait !== state) return "cancelled";
    return await new Promise((resolve) => {
      let settled = false;
      let timer = null;
      let observer = null;
      let cancel = null;
      const finish = (reason) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (observer) {
          try { observer.disconnect(); } catch (_) {}
        }
        if (state.wake_cancel === cancel) state.wake_cancel = null;
        resolve(reason);
      };
      cancel = () => finish("cancelled");
      state.wake_cancel = cancel;
      try {
        const context = primaryComposerContext();
        const root = context?.form || context?.root || document.documentElement;
        observer = new MutationObserver(() => finish("mutation"));
        observer.observe(root, { childList: true, subtree: true, characterData: true });
      } catch (_) {
        observer = null;
      }
      timer = setTimeout(() => finish("timeout"), DELIVERY_WATCH_INTERVAL_MS);
    });
  }

  async function runManualComposerClearWait(state) {
    if (!state || activeManualComposerWait !== state) return { ok: false, code: "MANUAL_COMPOSER_WAIT_NOT_ACTIVE" };
    while (current() && activeManualComposerWait === state && !state.cancelled) {
      if (!manualEnabled || manualConversationKey !== state.conversation_key) {
        stopManualComposerWait("manual_mode_disabled");
        return { ok: false, cancelled: true, code: "MANUAL_MODE_DISABLED" };
      }
      if (!sameConversation(state.origin, state.conversation_id) || state.conversation_key !== conversationKeyFromLocation()) {
        stopManualComposerWait("conversation_changed");
        return { ok: false, cancelled: true, code: "CONVERSATION_MISMATCH" };
      }
      const context = primaryComposerContext();
      if (context && !canonicalText(composerText(context.composer))) {
        stopManualComposerWait("composer_clear", { clearPlate: false });
        try {
          const result = await performBatchClaimedDelivery(state.recovery);
          if (result?.waiting_for_composer_clear !== true) clearToast(MANUAL_COMPOSER_WAIT_TOAST_KEY);
          return result;
        } catch (error) {
          clearToast(MANUAL_COMPOSER_WAIT_TOAST_KEY);
          if (error?.code === "MANUAL_MODE_DISABLED" || error?.code === "MANUAL_DELIVERY_STATE_MISMATCH") {
            return { ok: false, cancelled: true, code: error.code };
          }
          await sendRuntime("OZ_BATCH_DELIVERY_FAILED", {
            owner_kind: "manual",
            owner_id: state.owner_id,
            conversation_key: state.conversation_key,
            delivery_id: state.delivery_id,
            code: error.code || "MANUAL_DELIVERY_RECOVERY_FAILED",
            error: error.message || String(error)
          }).catch(() => null);
          throw error;
        }
      }
      if (context) showManualComposerWaitPlate();
      await waitForManualComposerWake(state);
    }
    return { ok: false, cancelled: true, code: "MANUAL_COMPOSER_WAIT_STOPPED" };
  }

  function startManualComposerClearWait(recovery) {
    const ownerId = String(recovery?.owner_id || recovery?.operation_id || "");
    const deliveryId = String(recovery?.delivery_id || "");
    if (!ownerId || !deliveryId) return { ok: false, code: "MANUAL_COMPOSER_WAIT_INVALID" };
    if (activeManualComposerWait?.owner_id === ownerId && activeManualComposerWait?.delivery_id === deliveryId) {
      if (primaryComposerContext()) showManualComposerWaitPlate();
      return { ok: true, waiting_for_composer_clear: true, deduplicated: true };
    }
    if (activeManualComposerWait) stopManualComposerWait("replaced");
    const state = {
      owner_id: ownerId,
      delivery_id: deliveryId,
      conversation_key: String(recovery.conversation_key || ""),
      origin: String(recovery.origin || "").toLowerCase(),
      conversation_id: String(recovery.conversation_id || "").toLowerCase(),
      recovery,
      wake_cancel: null,
      cancelled: false
    };
    activeManualComposerWait = state;
    recordContentDiagnostic("MANUAL_COMPOSER_WAIT_STARTED", {
      owner_id: ownerId,
      delivery_id: deliveryId,
      fallback_poll_ms: DELIVERY_WATCH_INTERVAL_MS
    });
    if (primaryComposerContext()) showManualComposerWaitPlate();
    void runManualComposerClearWait(state).catch((error) => {
      if (activeManualComposerWait === state) stopManualComposerWait("wait_failed");
      recordContentDiagnostic("MANUAL_COMPOSER_WAIT_FAILED", {
        owner_id: ownerId,
        delivery_id: deliveryId,
        code: error.code || "MANUAL_COMPOSER_WAIT_FAILED",
        error: error.message || String(error)
      });
    });
    return { ok: true, waiting_for_composer_clear: true };
  }

  async function performBatchClaimedDelivery(recovery) {
    if (!recovery || recovery.delivery_mode !== "batch_watch_v1") throw Object.assign(new Error("Неверный batch delivery mode."), { code: "BATCH_DELIVERY_MODE_MISMATCH" });
    if (!sameConversation(recovery.origin, recovery.conversation_id) || recovery.conversation_key !== conversationKeyFromLocation()) throw Object.assign(new Error("Batch delivery адресована другому AI-диалогу."), { code: "CONVERSATION_MISMATCH" });
    const ownerKind = String(recovery.owner_kind || "autorun");
    const ownerId = String(recovery.owner_id || recovery.run_id || recovery.operation_id || "");
    if (!ownerId) throw Object.assign(new Error("Batch delivery owner отсутствует."), { code: "BATCH_DELIVERY_OWNER_MISSING" });
    const preInsertContext = primaryComposerContext();
    if (!preInsertContext || canonicalText(composerText(preInsertContext.composer))) {
      if (ownerKind === "manual") return startManualComposerClearWait(recovery);
      if (!preInsertContext) throw Object.assign(new Error("Не найден composer текущего AI для batch delivery."), { code: "COMPOSER_NOT_FOUND" });
      throw Object.assign(new Error("Composer текущего AI содержит пользовательский текст. Batch insertion не начат; существующий текст не изменён."), { code: "COMPOSER_CONTAINS_OTHER_TEXT" });
    }
    const commit = await sendRuntime("OZ_BATCH_DELIVERY_INSERT_COMMIT", {
      owner_kind: ownerKind,
      owner_id: ownerId,
      run_id: recovery.run_id || "",
      conversation_key: recovery.conversation_key,
      delivery_id: recovery.delivery_id,
      actor_id: runtimeId,
      assistant_baseline_ids: assistantTurnIds()
    });
    if (!commit?.ok || commit.insert_allowed !== true) {
      if (commit?.already_inserted && commit?.recovery) {
        void runBatchDeliveryWatch(commit.recovery);
        return { ok: true, watching: true, already_inserted: true };
      }
      throw Object.assign(new Error(commit?.error || "Batch insertion не разрешён; outcome может быть неизвестен."), { code: commit?.code || "DELIVERY_INSERT_COMMIT_REJECTED" });
    }

    const insertContext = primaryComposerContext();
    if (!insertContext) throw Object.assign(new Error("Composer исчез после commit-before-insert; автоматическая повторная вставка запрещена."), { code: "COMPOSER_NOT_FOUND_AFTER_INSERT_COMMIT" });
    setComposerText(insertContext.composer, String(recovery.outgoing_text || ""));
    recordContentDiagnostic("DELIVERY_INSERTED_LOCAL", { owner_kind: ownerKind, owner_id: ownerId, delivery_id: recovery.delivery_id });
    const inserted = await sendRuntime("OZ_BATCH_DELIVERY_INSERTED", {
      owner_kind: ownerKind,
      owner_id: ownerId,
      run_id: recovery.run_id || "",
      conversation_key: recovery.conversation_key,
      delivery_id: recovery.delivery_id,
      actor_id: runtimeId
    });
    if (!inserted?.ok || inserted.inserted !== true) {
      throw Object.assign(new Error(inserted?.error || "Worker не подтвердил inserted state; автоматическая повторная вставка запрещена."), { code: inserted?.code || "DELIVERY_INSERT_ACK_FAILED" });
    }
    if (ownerKind === "manual") clearToast(MANUAL_COMPOSER_WAIT_TOAST_KEY);
    toast(`Ozon: полный batch вставлен. Жду Send → ready lifecycle ${currentAIAdapter()?.label || "AI"}, не перечитывая содержимое composer.`, "info", 0, "autorun-state");
    void runBatchDeliveryWatch(inserted.recovery || { ...recovery, type: "watch_delivery", delivery_phase: "inserted" });
    return { ok: true, inserted: true, watching: true };
  }

  function composerSendDeps() {
    return { resolveContext: primaryComposerContext, resolveButton: sendButton, candidateButtons: sendButtonCandidates, visible, readComposerText: composerText, fingerprint: sendButtonFingerprint, sleep };
  }

  async function waitForStableSendTarget(timeoutMs = 10000, expectedText = null) {
    return BB2ComposerSend.waitForValidatedTarget({
      expectedText,
      timeoutMs,
      sampleIntervalMs: SEND_TARGET_SAMPLE_INTERVAL_MS,
      requiredStableSamples: SEND_TARGET_STABLE_SAMPLES,
      deps: composerSendDeps()
    });
  }

  async function stabilizeComposerForSend(expectedText, area, details = {}) {
    const startedAt = Date.now();
    const minimumReadyAt = startedAt + SEND_RENDER_WAIT_MS;
    const deadline = startedAt + Math.max(8000, SEND_RENDER_WAIT_MS + 4000);
    let stableSamples = 0;
    let lastComposer = null;
    recordContentDiagnostic(`${area}_COMPOSER_STABILIZATION_STARTED`, { ...details, minimum_wait_ms: SEND_RENDER_WAIT_MS });
    while (Date.now() < deadline) {
      const context = primaryComposerContext();
      const exactText = Boolean(context) && normalizedDeliveryText(composerText(context.composer)) === normalizedDeliveryText(expectedText);
      const scopeConnected = context ? (context.form ? context.form.isConnected : context.root?.isConnected) : false;
      if (context && exactText && context.composer.isConnected && scopeConnected) {
        stableSamples = context.composer === lastComposer ? stableSamples + 1 : 1;
        lastComposer = context.composer;
        if (Date.now() >= minimumReadyAt && stableSamples >= SEND_TARGET_STABLE_SAMPLES) {
          recordContentDiagnostic(`${area}_COMPOSER_STABILIZED`, { ...details, elapsed_ms: Date.now() - startedAt, stable_samples: stableSamples, composer_tag: context.composer.tagName, contenteditable: context.composer.getAttribute("contenteditable") || null });
          return context;
        }
      } else {
        stableSamples = 0;
        lastComposer = null;
      }
      await sleep(SEND_TARGET_SAMPLE_INTERVAL_MS);
    }
    recordContentDiagnostic(`${area}_COMPOSER_STABILIZATION_FAILED`, { ...details, elapsed_ms: Date.now() - startedAt, composer_present: Boolean(primaryComposerContext()) });
    throw new Error("Поле ввода текущего AI не подтвердило устойчивое состояние после программной вставки текста.");
  }

  function retryableComposerClickError(error) {
    if (!(error instanceof BB2ComposerSend.ComposerSendError)) return false;
    if (error.click_event_observed === true) return false;
    return SEND_CLICK_RETRYABLE_CODES.includes(error.code);
  }

  async function waitForStableSendTargetWithRetry({ area, runId, expectedText, details = {} }) {
    const expectedNormalized = expectedText === null ? null : normalizedDeliveryText(expectedText);
    for (let attemptIndex = 0; attemptIndex < SEND_TARGET_RETRY_DELAYS_MS.length; attemptIndex += 1) {
      if (!current()) throw Object.assign(new Error("Content runtime superseded while waiting for Send target."), { code: "CONTENT_RUNTIME_SUPERSEDED" });
      const delayMs = SEND_TARGET_RETRY_DELAYS_MS[attemptIndex];
      if (delayMs > 0) {
        recordContentDiagnostic(`${area}_SEND_TARGET_RETRY_WAIT`, { ...details, run_id: runId, target_attempt: attemptIndex + 1, retry_delay_ms: delayMs });
        await sleep(delayMs);
      }
      const context = primaryComposerContext();
      if (context && expectedNormalized !== null) {
        const actualNormalized = normalizedDeliveryText(composerText(context.composer));
        if (actualNormalized !== expectedNormalized) {
          throw Object.assign(new Error("Composer text changed while waiting for Send target."), { code: "COMPOSER_TEXT_CHANGED" });
        }
      }
      const target = await waitForStableSendTarget(SEND_TARGET_ATTEMPT_TIMEOUT_MS, expectedText);
      if (target) {
        recordContentDiagnostic(`${area}_SEND_TARGET_READY`, { ...details, run_id: runId, target_attempt: attemptIndex + 1, retry_delay_ms: delayMs });
        return target;
      }
      recordContentDiagnostic(`${area}_SEND_TARGET_RETRY`, { ...details, run_id: runId, target_attempt: attemptIndex + 1, retry_delay_ms: delayMs });
    }
    if (!current()) throw Object.assign(new Error("Content runtime superseded while waiting for Send target."), { code: "CONTENT_RUNTIME_SUPERSEDED" });
    return null;
  }

  async function clickComposerUntilEmpty({ area, runId, expectedText = null, initialTarget = null, details = {} }) {
    const expectedNormalized = expectedText === null ? null : normalizedDeliveryText(expectedText);
    let clickAttempts = 0;
    let target = initialTarget;
    for (let attemptIndex = 0; attemptIndex < SEND_CLICK_RETRY_DELAYS_MS.length; attemptIndex += 1) {
      if (!current()) throw Object.assign(new Error("Content runtime superseded during composer send."), { code: "CONTENT_RUNTIME_SUPERSEDED" });
      const delayMs = SEND_CLICK_RETRY_DELAYS_MS[attemptIndex];
      if (delayMs > 0) {
        recordContentDiagnostic(`${area}_SEND_CLICK_RETRY_WAIT`, { ...details, run_id: runId, retry_attempt: attemptIndex + 1, retry_delay_ms: delayMs, click_attempts: clickAttempts });
        await sleep(delayMs);
      }
      const context = primaryComposerContext();
      if (!context) {
        target = null;
        recordContentDiagnostic(`${area}_COMPOSER_WAITING`, { ...details, run_id: runId, reason: "composer_missing", retry_attempt: attemptIndex + 1, click_attempts: clickAttempts });
        continue;
      }
      const currentText = canonicalText(composerText(context.composer));
      if (!currentText) {
        recordContentDiagnostic(`${area}_COMPOSER_EMPTY`, { ...details, run_id: runId, retry_attempt: attemptIndex + 1, click_attempts: clickAttempts });
        return { composer_empty: true, click_attempts: clickAttempts, click_event_observed: false };
      }
      if (expectedNormalized !== null && normalizedDeliveryText(currentText) !== expectedNormalized) {
        throw Object.assign(new Error("Composer text changed before Send click."), { code: "COMPOSER_TEXT_CHANGED" });
      }
      if (!target) target = await waitForStableSendTarget(SEND_TARGET_ATTEMPT_TIMEOUT_MS, expectedText);
      if (!target) {
        recordContentDiagnostic(`${area}_SEND_BUTTON_WAITING`, { ...details, run_id: runId, retry_attempt: attemptIndex + 1, click_attempts: clickAttempts });
        continue;
      }
      try {
        const clickResult = BB2ComposerSend.clickSynchronously({
          target,
          expectedText,
          deps: composerSendDeps(),
          beforeClick(snapshot) {
            recordContentDiagnostic(`${area}_PRE_SEND_SNAPSHOT`, { ...details, run_id: runId, retry_attempt: attemptIndex + 1, click_attempt: clickAttempts + 1, ...snapshot });
          }
        });
        clickAttempts += 1;
        recordContentDiagnostic(`${area}_SEND_CALLED`, { ...details, run_id: runId, retry_attempt: attemptIndex + 1, click_attempt: clickAttempts, click_method: clickResult.method, click_event_observed: clickResult.click_event_observed, ...clickResult.trace });
        target = null;
        if (!clickResult.click_event_observed) {
          recordContentDiagnostic(`${area}_SEND_CLICK_NO_EVENT_RETRY_SAFE`, { ...details, run_id: runId, retry_attempt: attemptIndex + 1, click_attempts: clickAttempts });
          continue;
        }
        const composerEmpty = await waitForComposerEmpty(COMPOSER_SEND_SETTLE_TIMEOUT_MS);
        recordContentDiagnostic(`${area}_SEND_CLICK_OBSERVED`, { ...details, run_id: runId, retry_attempt: attemptIndex + 1, click_attempts: clickAttempts, composer_empty: composerEmpty });
        return { composer_empty: composerEmpty, click_attempts: clickAttempts, click_event_observed: true };
      } catch (error) {
        if (error?.method_called === true) clickAttempts += 1;
        const safeToRetry = retryableComposerClickError(error);
        recordContentDiagnostic(`${area}_SEND_CLICK_ERROR`, { ...details, run_id: runId, retry_attempt: attemptIndex + 1, click_attempts: clickAttempts, code: error?.code || "SEND_CLICK_FAILED", click_event_observed: error?.click_event_observed === true, retry_safe: safeToRetry });
        if (!safeToRetry) throw error;
        target = null;
      }
    }
    if (!current()) throw Object.assign(new Error("Content runtime superseded during composer send."), { code: "CONTENT_RUNTIME_SUPERSEDED" });
    throw Object.assign(new Error("Send click retry budget exhausted before any click event was observed."), { code: `${area}_SEND_CLICK_RETRY_EXHAUSTED`, click_attempts: clickAttempts });
  }

  async function waitForMatchingNewUserTurn(baselineIds, expectedText, requestId = "", timeoutMs = 15000) {
    const baseline = baselineIds instanceof Set ? baselineIds : new Set(baselineIds || []);
    const deadline = Date.now() + timeoutMs;
    while (current() && Date.now() < deadline) {
      const next = matchingNewUserTurn(baseline, expectedText, requestId);
      if (next) return next;
      await sleep(150);
    }
    return null;
  }

  async function waitForComposerEmpty(timeoutMs = 7000) {
    const deadline = Date.now() + timeoutMs;
    while (current() && Date.now() < deadline) {
      const context = primaryComposerContext();
      if (context && !canonicalText(composerText(context.composer))) return true;
      await sleep(120);
    }
    return false;
  }

  async function deliverReport(reportText, autoSend, { confirmUserTurn = false, runId = "manual", deliveryId = "", requestId = "", requireCommit = false, conversationKey = "" } = {}) {
    toast("Ozon: передаю результат в текущий AI…", "info", 0, "operation-state");
    const assistantBaselineIds = assistantTurnIds();
    const baselineUsers = new Set(userTurnIds());
    const context = primaryComposerContext();
    if (!context) throw new Error("Не найдено поле ввода текущего AI для результата.");
    const existing = canonicalText(composerText(context.composer));
    const existingStage = context.composer.getAttribute(STAGE_DELIVERY_ATTR) || "";
    const ownsStage = context.composer.getAttribute(STAGE_ATTR) === "1" && Boolean(deliveryId) && existingStage === deliveryId;
    if (existing && !ownsStage && normalizedDeliveryText(existing) !== normalizedDeliveryText(reportText)) {
      throw new Error("В поле ChatGPT уже есть неотправленный текст до подготовки отчёта.");
    }
    if (!existing || !ownsStage) setComposerText(context.composer, reportText);
    recordContentDiagnostic(existing && ownsStage ? "DELIVERY_TEXT_REUSED" : "DELIVERY_TEXT_STAGED", { run_id: runId, delivery_id: deliveryId || null });
    if (deliveryId) {
      context.composer.setAttribute(STAGE_ATTR, "1");
      context.composer.setAttribute(STAGE_DELIVERY_ATTR, deliveryId);
    }
    if (!autoSend) {
      toast("Ozon: результат помещён в composer. Нажмите Send вручную.", "success", 0, "operation-state");
      return { sent: false, delivery_confirmed: false, composer_empty: false, click_attempts: 0, assistant_baseline_ids: assistantBaselineIds };
    }
    await stabilizeComposerForSend(reportText, "DELIVERY", { run_id: runId, delivery_id: deliveryId || null, reused_existing_text: Boolean(existing && ownsStage) });
    const preCommitTarget = await waitForStableSendTargetWithRetry({ area: "DELIVERY", runId, expectedText: reportText, details: { delivery_id: deliveryId || null } });
    if (!preCommitTarget) throw Object.assign(new Error("Send-кнопка не готова после исчерпания pre-commit retry budget."), { code: "DELIVERY_SEND_TARGET_RETRY_EXHAUSTED" });
    if (requireCommit) {
      const commit = await sendRuntime("OZ_AUTO_DELIVERY_COMMIT_REQUEST", {
        run_id: runId,
        delivery_id: deliveryId,
        conversation_key: conversationKey,
        baseline_user_turn_ids: [...baselineUsers],
        actor_id: runtimeId
      });
      if (!commit.ok || !commit.committed) throw Object.assign(new Error(commit.error || "Ozon delivery commit rejected."), { code: commit.code || "DELIVERY_COMMIT_REJECTED" });
      if (commit.click_allowed !== true) {
        recordContentDiagnostic("DELIVERY_COMMITTED_BY_OTHER_RUNTIME", { run_id: runId, delivery_id: deliveryId || null, actor_id: runtimeId });
        return { sent: false, committed_elsewhere: true, commit_recovery: commit.recovery || null, delivery_confirmed: false, composer_empty: false, click_attempts: 0, assistant_baseline_ids: assistantBaselineIds };
      }
    }
    const sent = await clickComposerUntilEmpty({ area: "DELIVERY", runId, expectedText: reportText, initialTarget: preCommitTarget, details: { delivery_id: deliveryId || null } });
    const currentContext = primaryComposerContext();
    if (currentContext && deliveryId) {
      currentContext.composer.removeAttribute(STAGE_ATTR);
      currentContext.composer.removeAttribute(STAGE_DELIVERY_ATTR);
    }
    let confirmedUserTurnId = null;
    if (confirmUserTurn) confirmedUserTurnId = await waitForMatchingNewUserTurn(baselineUsers, reportText, requestId, 15000);
    const confirmed = confirmUserTurn ? Boolean(confirmedUserTurnId) : sent.composer_empty === true;
    recordContentDiagnostic("DELIVERY_USER_TURN_CONFIRMATION", { run_id: runId, delivery_id: deliveryId || null, confirmed, confirmed_user_turn_id: confirmedUserTurnId || null, composer_empty: sent.composer_empty === true, click_attempts: sent.click_attempts });
    if (confirmed) toast("Ozon: результат отправлен в чат.", "success", 3500, "operation-state");
    else toast("Ozon: composer опустел, но matching user-turn не подтверждён. Delivery сохранена; повторный Send/API запрещён, будет только reconciliation.", "error", 0, "operation-state");
    return {
      sent: true,
      delivery_confirmed: confirmed,
      confirmed_user_turn_id: confirmedUserTurnId,
      composer_empty: sent.composer_empty === true,
      click_attempts: sent.click_attempts,
      assistant_baseline_ids: assistantBaselineIds
    };
  }

  async function sendAutoStart(messageText, runId, conversationKey = conversationKeyFromLocation()) {
    const initialContext = primaryComposerContext();
    if (!initialContext) throw Object.assign(new Error("Не найден composer текущего AI."), { code: "COMPOSER_NOT_FOUND" });
    const existing = canonicalText(composerText(initialContext.composer));
    if (existing && normalizedDeliveryText(existing) !== normalizedDeliveryText(messageText)) {
      throw Object.assign(new Error("Нижнее поле содержит неотправленный текст до подготовки команды запуска."), { code: "COMPOSER_CONTAINS_OTHER_TEXT" });
    }

    // Reference parity: Start confirmation is based on the committed Send making the composer empty.
    // Unlike result delivery, the happy path MUST NOT wait for or require a matching user-turn DOM record.
    const assistantBaselineIds = assistantTurnIds();
    if (!existing) setComposerText(initialContext.composer, messageText);
    recordContentDiagnostic(existing ? "START_TEXT_REUSED" : "START_TEXT_STAGED", { run_id: runId });

    await stabilizeComposerForSend(messageText, "START", { run_id: runId, reused_existing_text: Boolean(existing) });
    const preCommitTarget = await waitForStableSendTargetWithRetry({ area: "START", runId, expectedText: messageText });
    if (!preCommitTarget) throw Object.assign(new Error("Send-кнопка не готова после исчерпания pre-commit retry budget."), { code: "START_SEND_TARGET_RETRY_EXHAUSTED" });

    const commit = await sendRuntime("OZ_AUTO_START_COMMIT_REQUEST", {
      run_id: runId,
      conversation_key: conversationKey,
      baseline_user_turn_ids: [],
      actor_id: runtimeId
    });
    if (!commit.ok || !commit.committed) throw Object.assign(new Error(commit.error || "Ozon start commit rejected."), { code: commit.code || "START_COMMIT_REJECTED" });
    if (commit.click_allowed !== true) {
      recordContentDiagnostic("START_COMMITTED_BY_OTHER_RUNTIME", { run_id: runId, actor_id: runtimeId });
      return {
        committed: true,
        sent: false,
        committed_elsewhere: true,
        composer_empty: false,
        click_attempts: 0,
        assistant_baseline_ids: assistantBaselineIds,
        run_id: runId,
        identity: conversationIdentity()
      };
    }

    const sent = await clickComposerUntilEmpty({ area: "START", runId, expectedText: messageText, initialTarget: preCommitTarget });
    toast("Ozon Autorun: запуск отправлен. Жду новый OZON_API_V1 block.", "success", 0, "autorun-state");
    return {
      committed: true,
      sent: true,
      composer_empty: sent.composer_empty === true,
      click_attempts: sent.click_attempts,
      assistant_baseline_ids: assistantBaselineIds,
      run_id: runId,
      identity: conversationIdentity()
    };
  }

  function stopWorkStartWatch(intentId, revision, reason = "terminal") {
    const key = `${String(intentId || "")}:${Number(revision || 0)}`;
    const watch = workStartWatches.get(key);
    if (!watch) return;
    clearInterval(watch.timer);
    workStartWatches.delete(key);
    recordContentDiagnostic("WORK_START_WATCHER_STOPPED", { intent_id: watch.intent_id, revision: watch.revision, conversation_id: watch.last_conversation_id || null, runtime_generation: workRuntimeGeneration || null, reason });
  }

  function startWorkStartResponseWatch({ intentId, revision, origin, aiId, assistantBaselineIds }) {
    const key = `${String(intentId || "")}:${Number(revision || 0)}`;
    if (workStartWatches.has(key)) return true;
    stopWorkStartWatch(intentId, revision, "replaced");
    const watch = { intent_id: String(intentId || ""), revision: Number(revision || 0), origin: String(origin || "").toLowerCase(), ai_id: String(aiId || ""), assistant_baseline_ids: new Set(assistantBaselineIds || []), deadline: Date.now() + 120000, last_conversation_id: null, timer: null };
    watch.timer = setInterval(() => { void (async () => {
      if (!current()) { stopWorkStartWatch(watch.intent_id, watch.revision, "runtime_disposed"); return; }
      if (Date.now() > watch.deadline) {
        stopWorkStartWatch(watch.intent_id, watch.revision, "response_timeout");
        await sendRuntime("OZ_WORK_PENDING_TIMEOUT", { intent_id: watch.intent_id, revision: watch.revision });
        return;
      }
      const currentIdentity = conversationIdentity();
      if (currentIdentity.origin !== watch.origin || currentIdentity.ai_id !== watch.ai_id) {
        stopWorkStartWatch(watch.intent_id, watch.revision, "identity_mismatch");
        await sendRuntime("OZ_WORK_PENDING_CANCEL", { intent_id: watch.intent_id, revision: watch.revision, reason: "identity_mismatch" });
        return;
      }
      if (!currentIdentity.conversation_id) return;
      watch.last_conversation_id = currentIdentity.conversation_id;
      const newAssistantMessages = assistantMessages().filter((item) => {
        const id = currentAIAdapter()?.messageId(item);
        return id && !watch.assistant_baseline_ids.has(id);
      });
      const last = newAssistantMessages[newAssistantMessages.length - 1] || null;
      const complete = Boolean(last && assistantTurnComplete(last));
      const response = await sendRuntime("OZ_WORK_PENDING_IDENTITY", { intent_id: watch.intent_id, revision: watch.revision, identity: currentIdentity, first_response_complete: complete, runtime_generation: workRuntimeGeneration || null });
      if (!response?.waiting) stopWorkStartWatch(watch.intent_id, watch.revision, response?.ok ? "active_visible" : response?.code || "worker_rejected");
    })(); }, 500);
    workStartWatches.set(key, watch);
    recordContentDiagnostic("WORK_START_WATCHER_STARTED", { intent_id: watch.intent_id, revision: watch.revision, conversation_id: conversationIdentity().conversation_id || null, runtime_generation: workRuntimeGeneration || null, assistant_baseline_count: watch.assistant_baseline_ids.size });
  }

  async function sendWorkSessionPrompt(messageText, intentId, revision) {
    const context = primaryComposerContext();
    if (!context) throw Object.assign(new Error("Не найден composer текущего AI."), { code: "COMPOSER_NOT_FOUND" });
    const assistantBaselineIds = new Set(assistantTurnIds());
    const existing = canonicalText(composerText(context.composer));
    if (existing && normalizedDeliveryText(existing) !== normalizedDeliveryText(messageText)) throw Object.assign(new Error("Composer содержит другой неотправленный текст."), { code: "COMPOSER_CONTAINS_OTHER_TEXT" });
    if (!existing) setComposerText(context.composer, messageText);
    const target = await waitForStableSendTargetWithRetry({ area: "WORK_START", runId: intentId, expectedText: messageText });
    if (!target) throw Object.assign(new Error("Send control не готов."), { code: "WORK_START_SEND_TARGET_UNAVAILABLE" });
    const identityBefore = conversationIdentity();
    const commit = await sendRuntime("OZ_WORK_START_COMMIT_REQUEST", { intent_id: intentId, revision, identity: identityBefore, actor_id: runtimeId, runtime_generation: workRuntimeGeneration || null });
    if (!commit?.ok || commit.committed !== true) throw Object.assign(new Error(commit?.error || "Work Start durable commit rejected."), { code: commit?.code || "WORK_START_COMMIT_REJECTED" });
    if (commit.click_allowed !== true) {
      return { ok: true, sent: false, committed_elsewhere: true, intent_id: intentId, revision, identity: identityBefore, assistant_baseline_ids: [...assistantBaselineIds] };
    }
    let sent;
    try {
      sent = await clickComposerUntilEmpty({ area: "WORK_START", runId: intentId, expectedText: messageText, initialTarget: target, details: { work_session_revision: revision, runtime_generation: workRuntimeGeneration || null } });
    } catch (error) {
      await sendRuntime("OZ_WORK_START_SEND_OUTCOME", { intent_id: intentId, revision, identity: conversationIdentity(), actor_id: runtimeId, runtime_generation: workRuntimeGeneration || null, click_event_observed: error?.click_event_observed === true, composer_empty: false, assistant_baseline_ids: [...assistantBaselineIds] }).catch(() => null);
      throw error;
    }
    const identity = conversationIdentity();
    const outcome = await sendRuntime("OZ_WORK_START_SEND_OUTCOME", { intent_id: intentId, revision, identity, actor_id: runtimeId, runtime_generation: workRuntimeGeneration || null, click_event_observed: sent.click_event_observed === true, composer_empty: sent.composer_empty === true, assistant_baseline_ids: [...assistantBaselineIds] });
    if (!outcome?.ok || outcome.accepted !== true) throw Object.assign(new Error(outcome?.error || "Work Start send outcome acknowledgement failed."), { code: outcome?.code || "WORK_START_SEND_OUTCOME_REJECTED", click_event_observed: sent.click_event_observed === true });
    recordContentDiagnostic("WORK_START_SEND_OUTCOME", { intent_id: intentId, revision, conversation_id: identity.conversation_id || null, runtime_generation: workRuntimeGeneration || null, click_event_observed: sent.click_event_observed === true, composer_empty: sent.composer_empty === true, send_outcome: outcome.send_outcome || null });
    if (sent.composer_empty !== true) throw Object.assign(new Error("Work Start click was observed but Send outcome is not confirmed; automatic retry is forbidden."), { code: "WORK_START_SEND_OUTCOME_UNKNOWN_NO_RETRY", click_event_observed: sent.click_event_observed === true });
    startWorkStartResponseWatch({ intentId, revision, origin: identityBefore.origin, aiId: identityBefore.ai_id, assistantBaselineIds });
    return { ok: true, sent: true, send_observed: true, composer_empty: true, click_event_observed: sent.click_event_observed === true, intent_id: intentId, revision, identity, assistant_baseline_ids: [...assistantBaselineIds] };
  }

  async function currentRecovery(conversationKey, runId) {
    const response = await sendRuntime("OZ_GET_AUTO_RECOVERY", { conversation_key: conversationKey, run_id: runId });
    if (!response?.ok) return null;
    return response.recovery || null;
  }

  async function reconcileCommittedStart(recovery) {
    if (!recovery || !sameConversation(recovery.origin, recovery.conversation_id) || recovery.conversation_key !== conversationKeyFromLocation()) return false;
    const baseline = new Set(recovery.baseline_user_turn_ids || []);
    const confirmedUserTurnId = await waitForMatchingNewUserTurn(baseline, recovery.message_text || "", "", 8000);
    if (!confirmedUserTurnId) {
      recordContentDiagnostic("START_RECONCILIATION_PENDING", { run_id: recovery.run_id });
      toast("Ozon Autorun: start уже committed, но соответствующий user-turn не найден. Повторный Send запрещён; оставляю run для reconciliation.", "error", 9000);
      return false;
    }
    const completion = await sendRuntime("OZ_AUTO_START_COMPLETE", {
      run_id: recovery.run_id,
      conversation_key: recovery.conversation_key,
      actor_id: runtimeId,
      reconcile: true,
      start_confirmed: true,
      confirmed_user_turn_id: confirmedUserTurnId,
      composer_empty: true,
      click_attempts: 0,
      assistant_baseline_ids: assistantTurnIds()
    });
    if (!completion?.ok) throw Object.assign(new Error(completion?.error || "Start reconciliation rejected."), { code: completion?.code || "START_RECONCILIATION_REJECTED" });
    toast("Ozon Autorun: ранее committed start подтверждён по существующему user-turn. Повторный Send не выполнялся.", "success", 7000);
    return true;
  }

  async function reconcileCommittedDelivery(recovery) {
    if (!recovery || !sameConversation(recovery.origin, recovery.conversation_id) || recovery.conversation_key !== conversationKeyFromLocation()) return false;
    await assertRecoveryTextIntegrity(recovery);
    const baseline = new Set(recovery.baseline_user_turn_ids || []);
    const confirmedUserTurnId = await waitForMatchingNewUserTurn(baseline, recovery.outgoing_text || "", recovery.request_id || "", 8000);
    if (!confirmedUserTurnId) {
      recordContentDiagnostic("DELIVERY_RECONCILIATION_PENDING", { run_id: recovery.run_id, delivery_id: recovery.delivery_id || null, request_id: recovery.request_id || null });
      toast("Ozon Autorun: delivery уже committed, но matching user-turn пока не найден. Повторный Send и повторный Ozon API запрещены; оставляю доставку для reconciliation.", "error", 9000);
      return false;
    }
    const completion = await sendRuntime("OZ_AUTO_DELIVERY_COMPLETE", {
      run_id: recovery.run_id,
      conversation_key: recovery.conversation_key,
      delivery_confirmed: true,
      confirmed_user_turn_id: confirmedUserTurnId,
      composer_empty: true,
      click_attempts: 0,
      delivery_id: recovery.delivery_id,
      assistant_baseline_ids: assistantTurnIds()
    });
    if (!completion?.ok) throw Object.assign(new Error(completion?.error || "Delivery reconciliation rejected."), { code: completion?.code || "DELIVERY_RECONCILIATION_REJECTED" });
    toast("Ozon Autorun: ранее committed результат подтверждён по существующему user-turn. Повторный Send/API не выполнялся.", "success", 7000);
    return true;
  }

  async function performClaimedDelivery(recovery) {
    if (recovery?.delivery_mode === "batch_watch_v1") return await performBatchClaimedDelivery(recovery);
    if (!recovery || !sameConversation(recovery.origin, recovery.conversation_id) || recovery.conversation_key !== conversationKeyFromLocation()) {
      throw Object.assign(new Error("Recovery delivery адресована другому AI-диалогу."), { code: "CONVERSATION_MISMATCH" });
    }
    await assertRecoveryTextIntegrity(recovery);
    const delivery = await deliverReport(recovery.outgoing_text || "", true, {
      confirmUserTurn: true,
      runId: recovery.run_id,
      deliveryId: recovery.delivery_id,
      requestId: recovery.request_id || "",
      requireCommit: true,
      conversationKey: recovery.conversation_key
    });
    if (delivery.committed_elsewhere) {
      const latest = delivery.commit_recovery || await currentRecovery(recovery.conversation_key, recovery.run_id);
      if (latest?.type === "reconcile_delivery") await reconcileCommittedDelivery(latest);
      return { ok: true, committed_elsewhere: true };
    }
    const completion = await sendRuntime("OZ_AUTO_DELIVERY_COMPLETE", {
      run_id: recovery.run_id,
      conversation_key: recovery.conversation_key,
      delivery_confirmed: delivery.delivery_confirmed === true,
      confirmed_user_turn_id: delivery.confirmed_user_turn_id || null,
      composer_empty: delivery.composer_empty === true,
      click_attempts: Number(delivery.click_attempts || 0),
      delivery_id: recovery.delivery_id,
      assistant_baseline_ids: delivery.assistant_baseline_ids || assistantTurnIds()
    });
    if (!completion?.ok) throw Object.assign(new Error(completion?.error || "Не удалось подтвердить доставку."), { code: completion?.code || "DELIVERY_CONFIRMATION_REJECTED" });
    return { ok: true, completion };
  }

  async function recoverManualDelivery(recovery) {
    if (!recovery || recovery.owner_kind !== "manual" || !recovery.owner_id || !recovery.delivery_id || recovery.delivery_mode !== "batch_watch_v1") return { ok: false, code: "MANUAL_RECOVERY_INVALID" };
    if (recovery.conversation_key !== conversationKeyFromLocation() || !sameConversation(recovery.origin, recovery.conversation_id)) return { ok: false, code: "CONVERSATION_MISMATCH" };
    const key = `${recovery.owner_id}:${recovery.delivery_id}`;
    if (manualRecoveryInFlight.has(key)) return { ok: true, deduplicated: true };
    manualRecoveryInFlight.add(key);
    try {
      if (recovery.type === "deliver_claimed") return await performBatchClaimedDelivery(recovery);
      if (recovery.type === "watch_delivery") return await runBatchDeliveryWatch(recovery);
      if (recovery.type === "delivery_insert_outcome_unknown") {
        toast("Ozon: исход вставки batch неизвестен после перезапуска; повторная вставка запрещена.", "error", 0, "operation-state");
        return { ok: false, code: recovery.code || "DELIVERY_INSERT_OUTCOME_UNKNOWN_NO_RETRY" };
      }
      return { ok: false, code: "MANUAL_RECOVERY_INVALID" };
    } catch (error) {
      await sendRuntime("OZ_BATCH_DELIVERY_FAILED", {
        owner_kind: "manual",
        owner_id: recovery.owner_id,
        conversation_key: recovery.conversation_key,
        delivery_id: recovery.delivery_id,
        code: error.code || "MANUAL_DELIVERY_RECOVERY_FAILED",
        error: error.message || String(error)
      }).catch(() => null);
      throw error;
    } finally {
      manualRecoveryInFlight.delete(key);
    }
  }

  async function runRecoveryOnce(recovery, { propagate = false } = {}) {
    if (!recovery?.type || !recovery?.run_id) return { ok: false, code: "RECOVERY_INVALID" };
    const key = `${recovery.type}:${recovery.run_id}:${recovery.delivery_id || ""}`;
    if (recoveryInFlight.has(key)) return { ok: true, deduplicated: true };
    recoveryInFlight.add(key);
    try {
      if (recovery.type === "dispatch_start") {
        const result = await sendAutoStart(String(recovery.message_text || ""), String(recovery.run_id || ""), String(recovery.conversation_key || ""));
        if (result.committed_elsewhere) {
          const latest = await currentRecovery(recovery.conversation_key, recovery.run_id);
          if (latest?.type === "reconcile_start") await reconcileCommittedStart(latest);
        }
        return { ok: true, handled: true };
      }
      if (recovery.type === "reconcile_start") return { ok: true, handled: await reconcileCommittedStart(recovery) };
      if (recovery.type === "deliver_claimed") {
        await performClaimedDelivery(recovery);
        return { ok: true, handled: true };
      }
      if (recovery.type === "watch_delivery" && recovery.delivery_mode === "batch_watch_v1") {
        void runBatchDeliveryWatch(recovery);
        return { ok: true, handled: true, watching: true };
      }
      if (recovery.type === "delivery_insert_outcome_unknown") {
        toast("Ozon Autorun: insertion был committed, но подтверждение вставки потеряно. Автоматическая повторная вставка запрещена; используйте Stop/Abort и перезапустите сбор вручную при необходимости.", "error", 0, "autorun-state");
        return { ok: false, code: recovery.code || "DELIVERY_INSERT_OUTCOME_UNKNOWN_NO_RETRY" };
      }
      if (recovery.type === "collection_resuming") return { ok: true, handled: true };
      if (recovery.type === "reconcile_delivery") return { ok: true, handled: await reconcileCommittedDelivery(recovery) };
      if (recovery.type === "request_outcome_unknown") {
        toast("Ozon Autorun: service worker перезапустился во время Ozon request. Исход запроса неизвестен; автоматический повтор запрещён.", "error", 0, "autorun-state");
        return { ok: false, code: "REQUEST_OUTCOME_UNKNOWN" };
      }
      return { ok: false, code: "RECOVERY_UNSUPPORTED" };
    } catch (error) {
      recordContentDiagnostic("RECOVERY_FAILED", { run_id: recovery.run_id, type: recovery.type, code: error.code || "RECOVERY_FAILED", error: error.message || String(error) });
      toast(`Ozon recovery: ${error.message}`, "error", 0, "autorun-state");
      if (propagate) throw error;
      return { ok: false, code: error.code || "RECOVERY_FAILED", error: error.message || String(error) };
    } finally {
      recoveryInFlight.delete(key);
    }
  }

  function stopAutoWatch(reason = "stopped") {
    const previous = activeAutoWatch;
    if (autoObserver) autoObserver.disconnect();
    autoObserver = null;
    if (autoTimer) clearTimeout(autoTimer);
    autoTimer = null;
    activeAutoWatch = null;
    autoFirstSeen = null;
    autoTickInFlight = false;
    if (reason) {
      console.info(`[Ozon Bridge ${VERSION}] auto watch stopped: ${reason}`);
      if (previous) recordContentDiagnostic("PROMPT_WATCH_STOPPED", { run_id: previous.run_id, reason });
    }
  }

  async function reportAutoPreExecutionError(error, { stage = "pre_execution", assistantTurnId = "", commandText = "" } = {}) {
    const watch = activeAutoWatch ? { ...activeAutoWatch } : null;
    if (!watch) return { ok: false, accepted: false, code: "AUTO_WATCH_NOT_ACTIVE" };
    const code = String(error?.code || error?.name || "AUTO_PREEXEC_ERROR");
    const message = String(error?.message || error || "Ozon Autorun pre-execution error.");
    const fingerprintSource = commandText || `${stage}|${assistantTurnId}|${code}|${message}`;
    const commandFingerprint = OzonContract.textFingerprint(fingerprintSource);
    recordContentDiagnostic("PREEXEC_ERROR_REPORT_REQUESTED", {
      run_id: watch.run_id,
      assistant_turn_id: assistantTurnId || null,
      stage,
      code,
      command_fingerprint: commandFingerprint
    });
    const response = await sendRuntime("OZ_AUTO_PREEXEC_ERROR", {
      run_id: watch.run_id,
      conversation_key: watch.conversation_key,
      watch_id: watch.watch_id,
      assistant_turn_id: assistantTurnId,
      error_stage: stage,
      error_code: code,
      error_message: message,
      command_fingerprint: commandFingerprint
    });
    if (response?.accepted) {
      toast(`Ozon Autorun: ошибка ${code} передаётся в чат; внешний Ozon API request не выполнялся.`, "error", 0, "autorun-state");
      stopAutoWatch("preexec_error_accepted");
      return response;
    }
    if (response?.ignored) {
      stopAutoWatch("preexec_error_already_owned");
      return response;
    }
    if (response?.paused) {
      stopAutoWatch("worker_paused");
      return response;
    }
    toast(`Ozon Autorun: не удалось передать ошибку в чат — ${response?.error || response?.code || "worker rejected pre-execution error"}`, "error", 0, "autorun-state");
    stopAutoWatch("preexec_error_rejected");
    return response;
  }

  function scheduleAutoTick(delay = 0) {
    if (!activeAutoWatch || autoTimer) return;
    autoTimer = setTimeout(() => {
      autoTimer = null;
      autoTick().catch(async (error) => {
        try {
          const response = await reportAutoPreExecutionError(error, { stage: "watcher_runtime" });
          if (!response?.accepted && !response?.ignored && activeAutoWatch) stopAutoWatch("tick_error");
        } catch (reportError) {
          toast(`Ozon Autorun: ошибка watcher — ${error.message}; ошибка доставки в чат — ${reportError.message}`, "error", 0, "autorun-state");
          stopAutoWatch("tick_error_delivery_failed");
        }
      });
    }, delay);
  }

  function assistantMessageText(section) {
    const adapter = currentAIAdapter();
    if (!adapter || !(section instanceof HTMLElement)) return "";
    return String(adapter.messageText(section) || "").replace(/\u00a0/g, " ").trim();
  }

  function assistantTurnComplete(section) {
    const adapter = currentAIAdapter();
    return Boolean(adapter && section instanceof HTMLElement && adapter.messageComplete(section));
  }

  // Keep both Autorun ingress checks aligned with the ordered API/HELP discovery contract.
  function autorunCommandMarkerPresent(value) {
    const text = String(value || "");
    return [OzonContract.PREFIX, OzonRuntime.RUNTIME.helpPrefix, OzonRuntime.RUNTIME.helpPrefixV2]
      .some((prefix) => typeof prefix === "string" && prefix.length > 0 && text.includes(prefix));
  }

  function candidateAfterAssistantBaseline(baselineIds, watchId) {
    const adapter = currentAIAdapter();
    if (!adapter) return { waiting: true };
    const baseline = baselineIds instanceof Set ? baselineIds : new Set(baselineIds || []);
    const assistants = assistantMessages().filter((message) => {
      const id = adapter.messageId(message);
      return Boolean(id) && !baseline.has(id);
    });
    const assistant = assistants[assistants.length - 1] || null;
    if (!assistant) return { waiting: true };
    const assistantTurnId = adapter.messageId(assistant);
    const messageText = assistantMessageText(assistant);
    const complete = assistantTurnComplete(assistant);
    const hasMarker = autorunCommandMarkerPresent(messageText);
    const messageFingerprint = hasMarker ? OzonContract.textFingerprint(messageText) : "";
    return {
      assistant_turn_id: assistantTurnId,
      assistant_text: messageText,
      complete,
      has_marker: hasMarker,
      message_fingerprint: messageFingerprint,
      structural_signature: [watchId || "", assistantTurnId, complete ? "complete" : "pending", messageFingerprint].join("||")
    };
  }

  async function autoTick() {
    if (!current() || !activeAutoWatch || autoTickInFlight) return;
    autoTickInFlight = true;
    try {
      if (!sameConversation(activeAutoWatch.origin, activeAutoWatch.conversation_id) || conversationKeyFromLocation() !== activeAutoWatch.conversation_key) {
        stopAutoWatch("conversation_changed");
        return;
      }
      const candidate = candidateAfterAssistantBaseline(activeAutoWatch.assistant_baseline_ids, activeAutoWatch.watch_id);
      if (candidate.waiting || !candidate.complete || !candidate.has_marker || !candidate.assistant_text) {
        autoFirstSeen = null;
        scheduleAutoTick(750);
        return;
      }
      if (!autoFirstSeen || autoFirstSeen.signature !== candidate.structural_signature) {
        autoFirstSeen = { signature: candidate.structural_signature, at: Date.now() };
        recordContentDiagnostic("PROMPT_CANDIDATE_STABILITY_STARTED", {
          run_id: activeAutoWatch.run_id,
          assistant_turn_id: candidate.assistant_turn_id,
          message_fingerprint: candidate.message_fingerprint,
          capture_mode: "full_assistant_message"
        });
        scheduleAutoTick(AUTO_PROMPT_STABILITY_MS);
        return;
      }
      const elapsed = Date.now() - autoFirstSeen.at;
      if (elapsed < AUTO_PROMPT_STABILITY_MS) {
        scheduleAutoTick(AUTO_PROMPT_STABILITY_MS - elapsed);
        return;
      }
      const latestSection = assistantMessages().find((item) => currentAIAdapter()?.messageId(item) === candidate.assistant_turn_id) || null;
      if (!latestSection || !assistantTurnComplete(latestSection)) {
        autoFirstSeen = null;
        scheduleAutoTick(750);
        return;
      }
      const latestText = assistantMessageText(latestSection);
      const latestFingerprint = OzonContract.textFingerprint(latestText);
      if (!autorunCommandMarkerPresent(latestText) || latestFingerprint !== candidate.message_fingerprint) {
        autoFirstSeen = null;
        scheduleAutoTick(AUTO_PROMPT_STABILITY_MS);
        return;
      }

      recordContentDiagnostic("PROMPT_ACCEPTED", {
        run_id: activeAutoWatch.run_id,
        assistant_turn_id: candidate.assistant_turn_id,
        message_fingerprint: latestFingerprint,
        capture_mode: "full_assistant_message"
      });
      toast("Ozon Autorun: найден OZON API/help marker; обрабатываю через общий безопасный discovery path.", "info", 0, "autorun-state");
      const autorunContext = {
        run_id: activeAutoWatch.run_id,
        conversation_key: activeAutoWatch.conversation_key,
        watch_id: activeAutoWatch.watch_id
      };
      const response = await sendRuntime("OZ_AUTO_MESSAGE_READY", {
        run_id: autorunContext.run_id,
        conversation_key: autorunContext.conversation_key,
        watch_id: autorunContext.watch_id,
        assistant_turn_id: candidate.assistant_turn_id,
        assistant_text: latestText,
        message_fingerprint: latestFingerprint
      });
      if (!response?.accepted) {
        if (response?.paused) stopAutoWatch("worker_paused");
        else if (response?.ignored) scheduleAutoTick(1000);
        else {
          toast(`Ozon Autorun: ${response?.error || "assistant message не принят"}`, "error", 0, "autorun-state");
          stopAutoWatch("message_rejected");
        }
        return;
      }
      recordContentDiagnostic("BATCH_HANDOFF_ACCEPTED", {
        run_id: autorunContext.run_id,
        assistant_turn_id: candidate.assistant_turn_id,
        item_count: Number(response.item_count || 0),
        command_count: Number(response.command_count || 0),
        pre_execution_error_count: Number(response.pre_execution_error_count || 0)
      });
      stopAutoWatch("batch_accepted");
    } finally {
      autoTickInFlight = false;
    }
  }

  function beginAutoWatch(message) {
    stopAutoWatch("replaced");
    if (!sameConversation(message.origin, message.conversation_id)) return false;
    if (message.conversation_key !== conversationKeyFromLocation()) return false;
    // Fail-safe mutual exclusion: autorun watcher removes any stale manual Copy listeners before it can programmatically verify a local Copy control.
    applyManualMode(false, message.conversation_key);
    activeAutoWatch = {
      run_id: String(message.run_id || ""),
      conversation_key: String(message.conversation_key || ""),
      origin: String(message.origin || "").toLowerCase(),
      conversation_id: String(message.conversation_id || "").toLowerCase(),
      watch_id: String(message.watch_id || ""),
      assistant_baseline_ids: new Set(Array.isArray(message.assistant_baseline_ids) ? message.assistant_baseline_ids : [])
    };
    autoObserver = new MutationObserver(() => {
      if (!autoTimer) scheduleAutoTick(AUTO_PROMPT_DEBOUNCE_MS);
    });
    autoObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["disabled", "aria-disabled", "class", "data-testid", "aria-label", "title"]
    });
    scheduleAutoTick(0);
    toast("Ozon Autorun: жду следующую OZON_API_V1 команду.", "success", 0, "autorun-state");
    recordContentDiagnostic("PROMPT_WATCH_STARTED", { run_id: activeAutoWatch.run_id, watch_id: activeAutoWatch.watch_id, assistant_baseline_count: activeAutoWatch.assistant_baseline_ids.size });
    console.info(`[Ozon Bridge ${VERSION}] auto watch started for ${activeAutoWatch.run_id}`);
    return true;
  }

  async function syncAllState() {
    const here = conversationIdentity();
    if (here?.status !== "confirmed" || !here?.conversation_id) {
      applyManualMode(false, null);
      stopAutoWatch("identity_not_confirmed");
      return { ok: false, code: here?.status === "conflict" ? "CONVERSATION_IDENTITY_CONFLICT" : "CONVERSATION_NOT_CONFIRMED" };
    }
    const response = await sendRuntime("OZ_CONTENT_READY", { identity: here });
    const key = response?.conversation_key || conversationKeyFromLocation();
    const manualModeEnabled = response?.ok && response.manual_mode === true;
    applyManualMode(manualModeEnabled, key);
    setManualBridgeReady(manualModeEnabled && !manualOperationLooksActive(response?.manual_operation), "content_state_sync");
    syncQuotaWaitFromState(response);
    if (response?.ok && response.work_start_watch?.intent_id) {
      startWorkStartResponseWatch({
        intentId: response.work_start_watch.intent_id,
        revision: response.work_start_watch.revision,
        origin: response.work_start_watch.origin,
        aiId: response.work_start_watch.ai_id,
        assistantBaselineIds: response.work_start_watch.assistant_baseline_ids || []
      });
    }
    if (response?.ok && response.auto_watch?.status === "waiting_command") beginAutoWatch(response.auto_watch);
    else stopAutoWatch(response?.owner === false ? "duplicate_non_owner" : "sync_not_waiting");
    if (response?.ok && response.manual_operation_owner !== false && response.manual_recovery) {
      queueMicrotask(() => { void recoverManualDelivery(response.manual_recovery).catch((error) => {
        recordContentDiagnostic("MANUAL_DELIVERY_RECOVERY_FAILED", { operation_id: response.manual_recovery.operation_id || null, code: error.code || "MANUAL_DELIVERY_RECOVERY_FAILED", error: error.message || String(error) });
        toast(`Ozon manual recovery: ${error.message}`, "error", 9000);
      }); });
    }
    if (response?.ok && response.owner !== false && response.recovery) {
      queueMicrotask(() => { void runRecoveryOnce(response.recovery); });
    }
    return response;
  }

  function restoreButtonPicker() {
    if (pickerState) {
      try { setComposerText(pickerState.context.composer, pickerState.original_text); } catch (_) {}
      pickerState = null;
    }
    microphonePickerActive = false;
  }

  function startSendButtonPicker() {
    const context = primaryComposerContext();
    if (!context) throw new Error("Не найден composer текущего AI.");
    restoreButtonPicker();
    pickerState = { context, original_text: composerText(context.composer) };
    setComposerText(context.composer, "BRIDGE_BUTTON_TEST — это тест, сообщение не будет отправлено.");
    toast("Ozon Bridge: нажмите нужную Send-кнопку в нижней форме. Клик будет перехвачен, тест не отправится.", "info", 9000);
  }


  function startMicrophoneButtonPicker() {
    restoreButtonPicker();
    microphonePickerActive = true;
    toast("Ozon Bridge: нажмите idle/ready control текущего AI. Клик будет перехвачен и не запустит действие.", "info", 9000);
  }

  document.addEventListener("pointerdown", (event) => {
    if (!pickerState && !microphonePickerActive) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    suppressPickerClick = true;
    const button = event.target instanceof Element ? event.target.closest('button, [role="button"], input[type="submit"]') : null;

    if (microphonePickerActive) {
      const context = primaryComposerContext();
      if (!(button instanceof HTMLElement) || !composerScope(context)?.contains(button)) {
        toast("Ozon Bridge: выберите ready-control только внутри composer текущего AI.", "info", 7000);
        return;
      }
      const profile = microphoneButtonSignature(button);
      profile.form_index = allComposerControls(context).indexOf(button);
      sendRuntime("OZ_SAVE_MICROPHONE_BUTTON_PROFILE", { profile }).then((response) => {
        if (!response.ok) throw new Error(response.error || "Не удалось сохранить Microphone-кнопку.");
        microphoneButtonProfile = profile;
        restoreButtonPicker();
        toast("Ozon Bridge: Microphone-кнопка сохранена.", "success", 6000);
      }).catch((error) => {
        restoreButtonPicker();
        toast(`Ozon Bridge: ${error.message}`, "error", 9000);
      });
      return;
    }


    if (!(button instanceof HTMLElement) || !composerScope(pickerState.context)?.contains(button)) {
      toast("Ozon Bridge: выберите кнопку только внутри composer текущего AI.", "info", 7000);
      return;
    }
    const profile = manualButtonSignature(button);
    profile.form_index = allComposerControls(pickerState.context).indexOf(button);
    sendRuntime("OZ_SAVE_SEND_BUTTON_PROFILE", { profile }).then((response) => {
      if (!response.ok) throw new Error(response.error || "Не удалось сохранить Send-кнопку.");
      sendButtonProfile = profile;
      restoreButtonPicker();
      toast("Ozon Bridge: Send-кнопка сохранена.", "success", 6000);
    }).catch((error) => {
      restoreButtonPicker();
      toast(`Ozon Bridge: ${error.message}`, "error", 9000);
    });
  }, true);

  document.addEventListener("click", (event) => {
    if (!suppressPickerClick) return;
    suppressPickerClick = false;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener("keydown", (event) => {
    if ((!pickerState && !microphonePickerActive) || event.key !== "Escape") return;
    event.preventDefault();
    restoreButtonPicker();
    toast("Ozon Bridge: выбор кнопки отменён.", "info", 5000);
  }, true);

  runtimeMessageListener = (message, _sender, sendResponse) => {
    if (message?.type === "OZ_START_MICROPHONE_BUTTON_PICKER") {
      try { startMicrophoneButtonPicker(); sendResponse({ ok: true }); }
      catch (error) { sendResponse({ ok: false, error: error.message, code: error.code || "CONTENT_ADAPTER_ERROR" }); }
      return false;
    }
    if (message?.type === "OZ_START_SEND_BUTTON_PICKER") {
      try { startSendButtonPicker(); sendResponse({ ok: true }); }
      catch (error) { sendResponse({ ok: false, error: error.message, code: error.code || "CONTENT_ADAPTER_ERROR" }); }
      return false;
    }
    if (message?.type === "OZ_SET_SEND_BUTTON_PROFILE") {
      sendButtonProfile = message.profile || null;
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "OZ_SET_MICROPHONE_BUTTON_PROFILE") {
      microphoneButtonProfile = message.profile || null;
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "OZ_SET_COPY_BUTTON_PROFILES") {
      replaceCopyButtonProfiles(message.profiles || null, "worker_update");
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "OZ_APPLY_AI_MODE") {
      const nextMode = OzonAIAdapters.normalizeMode(message.ai_mode);
      const beforeAdapterId = currentAIAdapter()?.id || null;
      if (nextMode !== aiMode) {
        aiMode = nextMode;
        activeAdapter = null;
      }
      const afterAdapterId = currentAIAdapter()?.id || null;
      const adapterChanged = beforeAdapterId !== afterAdapterId;
      if (adapterChanged) {
        stopAutoWatch("tab_ai_mode_changed");
        stopDeliveryWatch("tab_ai_mode_changed");
        stopManualObserver();
        lastObservedConversationKey = conversationKeyFromLocation();
        queueMicrotask(() => { void syncAllState(); });
      }
      recordContentDiagnostic("AI_ADAPTER_SELECTION_CHANGED", { ai_mode: aiMode, adapter_id: afterAdapterId, adapter_changed: adapterChanged, scope: "tab" });
      sendResponse({ ok: true, ai_mode: aiMode, adapter_id: afterAdapterId, adapter_changed: adapterChanged });
      return false;
    }
    if (message?.type === "OZ_PAGE_CONTEXT") {
      const here = conversationIdentity();
      sendResponse({ ok: true, conversation_key: conversationKeyFromLocation(), identity: here, href: location.href, ai_mode: aiMode, adapter_id: currentAIAdapter()?.id || null });
      return false;
    }
    if (message?.type === "OZ_WORK_RUNTIME_RENEW") {
      workRuntimeGeneration = String(message.runtime_generation || "");
      stopManualObserver();
      const currentKey = conversationKeyFromLocation();
      const contextMatches = Boolean(currentKey && currentKey === message.conversation_key);
      if (contextMatches) {
        applyManualMode(message.visible === true, currentKey);
        if (message.visible === true) queueMicrotask(() => { void syncManualState(); });
        else setManualBridgeReady(false, "work_runtime_renew_hidden");
      } else {
        applyManualMode(false, currentKey);
        setManualBridgeReady(false, "work_runtime_renew_context_mismatch");
      }
      sendResponse({ ok: true, runtime_generation: workRuntimeGeneration, ui_record_generation: `ui-${crypto.randomUUID()}`, identity: conversationIdentity(), applied: contextMatches });
      return false;
    }
    if (message?.type === "OZ_WORK_START_WATCH") {
      const here = conversationIdentity();
      if (here.status !== "confirmed" || here.origin !== String(message.origin || "").toLowerCase() || here.ai_id !== String(message.ai_id || "") || (message.conversation_id && here.conversation_id !== String(message.conversation_id || "").toLowerCase())) {
        sendResponse({ ok: false, started: false, code: "WORK_START_WATCH_CONTEXT_MISMATCH" });
        return false;
      }
      const started = startWorkStartResponseWatch({ intentId: String(message.intent_id || ""), revision: Number(message.revision || 0), origin: here.origin, aiId: here.ai_id, assistantBaselineIds: Array.isArray(message.assistant_baseline_ids) ? message.assistant_baseline_ids : [] });
      sendResponse({ ok: true, started: started === true, intent_id: String(message.intent_id || ""), revision: Number(message.revision || 0), runtime_generation: workRuntimeGeneration || null });
      return false;
    }
    if (message?.type === "OZ_WORK_SEND_INITIAL_PROMPT") {
      sendWorkSessionPrompt(String(message.prompt_text || ""), String(message.intent_id || ""), Number(message.revision || 0)).then(sendResponse).catch((error) => sendResponse({ ok: false, code: error.code || "WORK_START_SEND_FAILED", error: error.message || String(error) }));
      return true;
    }
    if (message?.type === "OZ_GET_IDENTITY") {
      sendResponse({ ok: true, identity: conversationIdentity(), href: location.href });
      return false;
    }
    if (message?.type === "OZ_WORK_APPLY_VISIBILITY") {
      const currentKey = conversationKeyFromLocation();
      const applied = Boolean(currentKey && message.conversation_key === currentKey);
      if (applied) {
        applyManualMode(message.visible === true, currentKey);
        if (message.visible === true) queueMicrotask(() => { void syncManualState(); });
        else setManualBridgeReady(false, "work_session_hidden");
      } else {
        applyManualMode(false, currentKey);
        setManualBridgeReady(false, "work_session_context_mismatch");
      }
      sendResponse({ ok: true, applied, conversation_key: currentKey, identity: conversationIdentity() });
      return false;
    }
    if (message?.type === "OZ_APPLY_MANUAL_MODE") {
      const currentKey = conversationKeyFromLocation();
      const applied = Boolean(currentKey && message.conversation_key === currentKey);
      if (applied) {
        // Only the worker's explicit Manual-OFF broadcast is allowed to cancel
        // the current Manual UI delivery watcher. Internal state sync may call
        // applyManualMode(false) for other lifecycle reasons and must not turn
        // a live delivery into DELIVERY_ABORTED/manual_ui_disabled.
        if (message.enabled !== true && activeDeliveryWatch?.owner_kind === "manual" && activeDeliveryWatch.conversation_key === currentKey) {
          stopDeliveryWatch("manual_ui_disabled");
        }
        applyManualMode(message.enabled === true, currentKey);
        if (message.enabled === true) queueMicrotask(() => { void syncManualState(); });
        else setManualBridgeReady(false, "manual_mode_disabled");
      } else {
        applyManualMode(false, currentKey);
        setManualBridgeReady(false, "manual_mode_context_mismatch");
      }
      sendResponse({ ok: true, applied, conversation_key: currentKey, identity: conversationIdentity() });
      return false;
    }
    if (message?.type === "OZ_AUTO_SEND_START") {
      (async () => {
        if (!sameConversation(message.origin, message.conversation_id) || message.conversation_key !== conversationKeyFromLocation()) {
          return { ok: false, code: "CONVERSATION_MISMATCH", error: "Autorun start адресован другому AI-диалогу." };
        }
        stopAutoWatch("auto_start");
        return { ok: true, ...(await sendAutoStart(String(message.message_text || ""), String(message.run_id || ""), String(message.conversation_key || conversationKeyFromLocation() || ""))) };
      })().then(sendResponse).catch((error) => sendResponse({ ok: false, code: error.code || "AUTO_START_FAILED", error: error.message || String(error) }));
      return true;
    }
    if (message?.type === "OZ_BATCH_DELIVERY_AVAILABLE") {
      (async () => {
        const recovery = message.recovery || null;
        if (!recovery || recovery.conversation_key !== conversationKeyFromLocation()) return { ok: false, code: "CONVERSATION_MISMATCH", error: "Batch delivery push адресован другому диалогу." };
        return recovery.owner_kind === "manual"
          ? await recoverManualDelivery(recovery)
          : await runRecoveryOnce(recovery, { propagate: true });
      })().then(sendResponse).catch((error) => sendResponse({ ok: false, code: error.code || "BATCH_DELIVERY_RECOVERY_FAILED", error: error.message || String(error) }));
      return true;
    }
    if (message?.type === "OZ_AUTO_DELIVERY_AVAILABLE") {
      (async () => {
        const recovery = message.recovery || null;
        if (!recovery || recovery.conversation_key !== conversationKeyFromLocation()) return { ok: false, code: "CONVERSATION_MISMATCH", error: "Delivery push адресован другому диалогу." };
        return await runRecoveryOnce(recovery, { propagate: true });
      })().then(sendResponse).catch((error) => sendResponse({ ok: false, code: error.code || "DELIVERY_RECOVERY_FAILED", error: error.message || String(error) }));
      return true;
    }
    if (message?.type === "OZ_AUTO_BEGIN_WATCH") {
      sendResponse({ ok: true, started: beginAutoWatch(message), identity: conversationIdentity() });
      return false;
    }
    if (message?.type === "OZ_AUTO_STOP_WATCH") {
      stopAutoWatch(message.reason || "worker");
      stopDeliveryWatch(message.reason || "worker");
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "OZ_AUTO_GET_BASELINE") {
      if (message.conversation_id && !sameConversation(message.origin || location.origin, message.conversation_id)) {
        sendResponse({ ok: false, code: "CONVERSATION_MISMATCH", error: "Baseline запрошен не у owner-диалога." });
        return false;
      }
      sendResponse({ ok: true, assistant_baseline_ids: assistantTurnIds(), identity: conversationIdentity() });
      return false;
    }
    return false;
  };
  chrome.runtime.onMessage.addListener(runtimeMessageListener);

  lastObservedConversationKey = conversationKeyFromLocation();
  identityPollTimer = setInterval(() => {
    if (!current()) return;
    const key = conversationKeyFromLocation();
    if (key === lastObservedConversationKey) return;
    lastObservedConversationKey = key;
    stopAutoWatch("conversation_route_changed");
    stopManualObserver();
    void syncAllState();
  }, 1000);

  Promise.all([
    sendRuntime("OZ_GET_TAB_AI_MODE"),
    sendRuntime("OZ_GET_SEND_BUTTON_PROFILE"),
    sendRuntime("OZ_GET_MICROPHONE_BUTTON_PROFILE"),
    sendRuntime("OZ_GET_COPY_BUTTON_PROFILES")
  ]).then(([aiResponse, sendResponse, microphoneResponse, copyResponse]) => {
    aiMode = OzonAIAdapters.normalizeMode(aiResponse?.ok ? aiResponse.ai_mode : "auto");
    activeAdapter = null;
    sendButtonProfile = sendResponse?.ok ? sendResponse.profile || null : null;
    microphoneButtonProfile = microphoneResponse?.ok ? microphoneResponse.profile || null : null;
    copyButtonProfiles = copyResponse?.ok ? normalizeCopyButtonProfiles(copyResponse.profiles) : [];
  }).finally(() => {
    lastObservedConversationKey = conversationKeyFromLocation();
    recordContentDiagnostic("AI_ADAPTER_SELECTED", { ai_mode: aiMode, adapter_id: currentAIAdapter()?.id || null, scope: "tab" });
    void syncAllState();
  });

  runtime.dispose = () => {
    if (runtime.disposed) return;
    runtime.disposed = true;
    stopManualComposerWait("content_dispose");
    stopManualObserver();
    stopAutoWatch("content_dispose");
    for (const watch of [...workStartWatches.values()]) stopWorkStartWatch(watch.intent_id, watch.revision, "content_dispose");
    stopDeliveryWatch("content_dispose");
    try { restoreButtonPicker(); } catch (_) {}
    if (identityPollTimer) clearInterval(identityPollTimer);
    identityPollTimer = null;
    stopQuotaWaitProbe();
    stopQuotaWaitCountdown();
    if (runtimeMessageListener) chrome.runtime.onMessage.removeListener(runtimeMessageListener);
    runtimeMessageListener = null;
    for (const key of [...statusToastByKey.keys()]) clearToast(key);
    try { if (globalThis[RUNTIME_KEY] === runtime) delete globalThis[RUNTIME_KEY]; } catch (_) {}
  };

  recordContentDiagnostic("CONTENT_RUNTIME_STARTED", { version: VERSION, identity: conversationIdentity(), ai_mode: aiMode, adapter_id: currentAIAdapter()?.id || null, ai_mode_scope: "per_tab" });
  console.info(`[Ozon Bridge ${VERSION}] content ready; multi-AI manual/autorun runtime loaded`);
})();
