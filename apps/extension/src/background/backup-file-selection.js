/* Keep only the user's selected File in RAM while the native action popup closes. */
(() => {
  "use strict";
  if (!globalThis.chrome?.runtime?.onConnect?.addListener) return;
  const PORT = "SA_BACKUP_FILE_PICKER_V1";
  const MAX_BYTES = 8 * 1024 * 1024;
  const RETURN_WINDOW_MS = 1500;
  const LATE_RESULT_MS = 5000;
  let pending = null;
  const authority = () => globalThis.SellerAgentsControlClient;
  function discard(entry) {
    if (!entry) return;
    clearTimeout(entry.cleanup);
    if (entry.owner.disconnected) entry.owner.channel?.close();
    entry.file = null; entry.password = "";
    if (pending === entry) pending = null;
  }
  function current(entry) {
    if (pending !== entry) throw new Error("PICKER_CONTEXT_CHANGED");
    authority().assertBackupContext(entry.context);
  }
  async function sameSurface(windowId, tabId) {
    const tab = await chrome.tabs.get(tabId);
    return tab.active === true && tab.windowId === windowId;
  }
  async function reopen(entry) {
    if (entry.openAttempted || entry.claimed || !entry.hasResult) return;
    entry.openAttempted = true; // No replay on a rejected or unknown UI outcome.
    try {
      current(entry);
      const window = await chrome.windows.get(entry.windowId);
      if (!window.focused || !await sameSurface(entry.windowId, entry.tabId)) {
        discard(entry); return;
      }
      current(entry);
      if (entry.claimed) return;
      await chrome.action.openPopup({ windowId: entry.windowId });
    } catch (_) {
      // A subsequent normal opening may still claim the bounded RAM draft.
      // Never create a replacement window, tab, sidebar or popup URL.
    }
  }
  function receive(endpoint, data) {
    const entry = pending;
    if (!entry || entry.owner !== endpoint || entry.id !== data?.pickId ||
        entry.hasResult || data.type !== "result") return;
    try {
      current(entry);
      if (endpoint.disconnected && Date.now() - endpoint.closedAt > LATE_RESULT_MS) {
        discard(entry); return;
      }
      const file = data.file;
      if (file !== null && !(file instanceof File) || typeof data.password !== "string") return;
      if (file && file.size > MAX_BYTES) {
        entry.error = "BACKUP_FILE_TOO_LARGE"; entry.file = null;
      } else entry.file = file;
      entry.password = data.password;
      entry.hasResult = true; entry.resultAt = Date.now();
      clearTimeout(entry.cleanup);
      entry.cleanup = setTimeout(() => discard(entry), 60000);
      if (endpoint.disconnected) void reopen(entry);
    } catch (_) { discard(entry); }
  }
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === "local" && changes.seller_agents_control_auth_v2 && pending) {
      try { current(pending); } catch (_) { discard(pending); }
    }
  });
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== PORT) return;
    if (port.sender?.id !== chrome.runtime.id ||
        port.sender?.url !== chrome.runtime.getURL("popup.html") ||
        typeof BroadcastChannel !== "function" ||
        typeof chrome.action?.openPopup !== "function") {
      port.disconnect(); return;
    }
    const endpoint = { port, disconnected: false, closedAt: 0, channel: null,
      windowId: null, tabId: null, restoring: null, prepared: null, serial: Promise.resolve() };
    const reply = (requestId, fields) => {
      if (!endpoint.disconnected) {
        try { port.postMessage({ requestId, ...fields }); } catch (_) { /* closed */ }
      }
    };
    async function handle(message) {
      const requestId = message?.requestId;
      try {
        if (message?.type === "ping") return;
        if (message?.type === "hello") {
          if (endpoint.channel || !Number.isInteger(message.windowId) ||
              !Number.isInteger(message.tabId)) throw new Error("PICKER_CONTEXT_CHANGED");
          const context = await authority().captureBackupContext();
          if (!await sameSurface(message.windowId, message.tabId) || endpoint.disconnected)
            throw new Error("PICKER_CONTEXT_CHANGED");
          authority().assertBackupContext(context);
          endpoint.windowId = message.windowId; endpoint.tabId = message.tabId;
          const name = PORT + ":" + crypto.randomUUID();
          endpoint.channel = new BroadcastChannel(name);
          endpoint.channel.onmessage = event => receive(endpoint, event.data);
          const entry = pending;
          if (entry?.hasResult && !entry.claimed && entry.windowId === endpoint.windowId &&
              entry.tabId === endpoint.tabId) {
            try {
              current(entry); entry.claimed = endpoint; endpoint.restoring = entry;
            } catch (_) { discard(entry); }
          }
          reply(requestId, { ok: true, type: "hello", channel: name });
        } else if (message?.type === "ready") {
          const entry = endpoint.restoring;
          if (!entry) return;
          current(entry);
          endpoint.channel.postMessage({ type: "restore", pickId: entry.id,
            file: entry.file, password: entry.password, error: entry.error || null });
        } else if (message?.type === "prepare") {
          if (!endpoint.channel || !await sameSurface(endpoint.windowId, endpoint.tabId))
            throw new Error("PICKER_CONTEXT_CHANGED");
          const context = await authority().captureBackupContext();
          if (endpoint.disconnected) throw new Error("PICKER_CONTEXT_CHANGED");
          discard(pending);
          const entry = { id: crypto.randomUUID(), owner: endpoint, context,
            windowId: endpoint.windowId, tabId: endpoint.tabId, file: null, password: "",
            hasResult: false, resultAt: 0, openAttempted: false, claimed: null, cleanup: null };
          pending = entry; endpoint.prepared = entry;
          reply(requestId, { ok: true, type: "prepared", pickId: entry.id });
        } else if (message?.type === "clear" || message?.type === "restored") {
          if (pending && pending.id === message.pickId &&
              (pending.owner === endpoint || pending.claimed === endpoint)) discard(pending);
        } else throw new Error("PICKER_CONTEXT_CHANGED");
      } catch (_) {
        if (pending?.owner === endpoint || pending?.claimed === endpoint) discard(pending);
        reply(requestId, { ok: false, code: "PICKER_CONTEXT_CHANGED" });
      }
    }
    port.onMessage.addListener(message => {
      endpoint.serial = endpoint.serial.then(() => handle(message)).catch(() => null);
    });
    port.onDisconnect.addListener(() => {
      endpoint.disconnected = true; endpoint.closedAt = Date.now();
      // A queued structured-clone result may follow the port-disconnect IPC.
      // Keep this exact receiver; closing and recreating it would lose the task.
      const entry = pending;
      if (!entry || entry.owner !== endpoint) {
        endpoint.channel?.close();
        if (entry?.claimed === endpoint) discard(entry);
        return;
      }
      if (!entry.hasResult) entry.cleanup = setTimeout(() => discard(entry), LATE_RESULT_MS);
      // A slow teardown must not lose the File. Retain it for the next normal
      // opening, but do not reopen after a later deliberate popup close.
      if (entry.hasResult && Date.now() - entry.resultAt <= RETURN_WINDOW_MS) void reopen(entry);
    });
  });
})();
