/* P3: one installation-local coordinator for durable technical wakes. */
(() => {
  "use strict";

  const STORAGE_KEY = "seller_agents_technical_wake_v1";
  const ALARM = "seller-agents-technical-wake-v1";
  const VERSION = 1;
  const MAX_TASKS = 32;
  const MAX_DUE_PER_WAKE = 16;
  const CLAIM_MS = 30_000;
  const RETRY_MS = 60_000;
  const KINDS = Object.freeze({
    SYNC: "C3E_PENDING_SYNC_RETRY",
    QUOTA: "KNOWN_PROVIDER_QUOTA_WAIT",
    RESULT: "KNOWN_RESULT_RECOVERY",
    EXPIRY: "TECHNICAL_BUFFER_EXPIRY",
    WORK: "SAFE_WORKER_RESTART_RECONSTRUCTION",
  });
  const allowedKinds = new Set(Object.values(KINDS));
  let readFlight = null;
  let writeFlight = Promise.resolve();
  let dispatchFlight = null;

  const text = (value, max = 240) => {
    const output = String(value ?? "").trim();
    return output ? output.slice(0, max) : null;
  };
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clone = (value) => value === undefined ? undefined : structuredClone(value);
  const workerId = () => text(globalThis.WORKER_SESSION_ID, 160) || "worker-unknown";

  function empty() {
    return { version: VERSION, entries: {}, updatedAt: 0 };
  }

  function identity(value) {
    const source = value && typeof value === "object" ? value : {};
    const output = {};
    for (const key of [
      "accountId", "installationId", "conversationKey", "bindingId", "bindingRevision",
      "workGeneration", "executionId", "providerAttemptId", "deliveryId", "requestId",
      "retryGeneration", "ownerKind", "ownerId", "queueIndex", "artifactKey",
    ]) {
      const item = source[key];
      if (item === null || item === undefined || item === "") continue;
      output[key] = typeof item === "number" ? item : text(item, 240);
    }
    return output;
  }

  function normalize(raw) {
    const source = raw && typeof raw === "object" ? raw : empty();
    const result = { version: VERSION, entries: {}, updatedAt: finite(source.updatedAt) };
    if (source.version !== VERSION || !source.entries || typeof source.entries !== "object") return result;
    for (const [taskId, entry] of Object.entries(source.entries).slice(0, MAX_TASKS)) {
      if (!entry || !allowedKinds.has(entry.kind) || text(taskId, 320) !== taskId) continue;
      const normalized = {
        taskId,
        kind: entry.kind,
        dueAt: Math.max(0, finite(entry.dueAt)),
        revision: Math.max(1, Math.floor(finite(entry.revision, 1))),
        attempts: Math.max(0, Math.floor(finite(entry.attempts))),
        claimedUntil: Math.max(0, finite(entry.claimedUntil)),
        claimedBy: text(entry.claimedBy, 160),
        identity: identity(entry.identity),
      };
      result.entries[taskId] = normalized;
    }
    return result;
  }

  async function read() {
    if (!readFlight) readFlight = (async () => {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      return normalize(data?.[STORAGE_KEY]);
    })().finally(() => { readFlight = null; });
    return readFlight;
  }

  function mutate(fn) {
    const next = writeFlight.then(fn, fn);
    writeFlight = next.catch(() => null);
    return next;
  }

  async function write(next) {
    const normalized = normalize(next);
    normalized.updatedAt = Date.now();
    await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
    readFlight = null;
    return normalized;
  }

  async function arm(state) {
    const entries = Object.values(state.entries);
    if (!entries.length || !chrome.alarms?.create) {
      try { await chrome.alarms?.clear?.(ALARM); } catch (_) {}
      return;
    }
    const earliest = Math.min(...entries.map((entry) => entry.dueAt));
    await chrome.alarms.create(ALARM, { when: Math.max(Date.now() + 100, earliest) });
  }

  async function schedule(kind, { taskId, dueAt = Date.now(), identity: taskIdentity = {}, replace = true } = {}) {
    if (!allowedKinds.has(kind) || !text(taskId, 320)) return { ok: false, code: "TECHNICAL_TASK_INVALID" };
    const result = await mutate(async () => {
      const state = clone(await read());
      const current = state.entries[taskId];
      if (current && !replace && current.dueAt <= Number(dueAt)) return state;
      state.entries[taskId] = {
        taskId: String(taskId), kind, dueAt: Math.max(0, finite(dueAt, Date.now())),
        revision: current ? current.revision + 1 : 1, attempts: current?.attempts || 0,
        claimedUntil: 0, claimedBy: null, identity: identity(taskIdentity),
      };
      const entries = Object.values(state.entries).sort((a, b) => a.dueAt - b.dueAt || a.taskId.localeCompare(b.taskId));
      state.entries = Object.fromEntries(entries.slice(0, MAX_TASKS).map((entry) => [entry.taskId, entry]));
      return write(state);
    });
    await arm(result);
    return { ok: true, taskId: String(taskId) };
  }

  async function cancel(taskId) {
    const result = await mutate(async () => {
      const state = clone(await read());
      delete state.entries[String(taskId)];
      return write(state);
    });
    await arm(result);
    return { ok: true };
  }

  async function cancelKind(kind) {
    const result = await mutate(async () => {
      const state = clone(await read());
      for (const [taskId, entry] of Object.entries(state.entries)) if (entry.kind === kind) delete state.entries[taskId];
      return write(state);
    });
    await arm(result);
    return { ok: true };
  }

  async function claim(taskId, now) {
    return mutate(async () => {
      const state = clone(await read());
      const entry = state.entries[taskId];
      if (!entry || entry.dueAt > now || entry.claimedUntil > now) return null;
      entry.claimedUntil = now + CLAIM_MS;
      entry.claimedBy = workerId();
      entry.attempts += 1;
      await write(state);
      return entry;
    });
  }

  async function finish(entry, { failed = false } = {}) {
    const result = await mutate(async () => {
      const state = clone(await read());
      const current = state.entries[entry.taskId];
      if (!current || current.revision !== entry.revision) return state;
      if (failed) {
        current.dueAt = Date.now() + RETRY_MS;
        current.claimedUntil = 0;
        current.claimedBy = null;
      } else delete state.entries[entry.taskId];
      return write(state);
    });
    await arm(result);
  }

  async function reconstruct() {
    const now = Date.now();
    try {
      const journal = globalThis.SellerAgentsSyncJournal;
      const state = await journal?.read?.();
      const pending = Object.values(state?.entries || {}).filter((entry) =>
        ["PENDING", "RETRY_WAIT"].includes(entry.status) && entry.kind !== "DELIVERY_MARKER");
      if (pending.length) {
        const first = pending.sort((a, b) => (a.nextAttemptAt || 0) - (b.nextAttemptAt || 0) || a.localSequence - b.localSequence)[0];
        const scheduled = (await read()).entries["sync:pending"];
        const sameRequest = scheduled?.identity?.requestId === first.requestId;
        const dueAt = first.nextAttemptAt || (sameRequest ? scheduled?.dueAt : 0) || now + 1000;
        await schedule(KINDS.SYNC, { taskId: "sync:pending", dueAt, identity: { requestId: first.requestId, installationId: first.installationId, retryGeneration: first.attempts } });
      } else await cancelKind(KINDS.SYNC);
    } catch (_) {}

    try {
      const keys = globalThis.OzonRuntime?.STORAGE_KEYS;
      const data = await chrome.storage.local.get([keys?.MANUAL_OPERATIONS, keys?.AUTO_RUNS, keys?.WORK_SESSION_RECOVERIES]);
      const manual = data?.[keys?.MANUAL_OPERATIONS] || {};
      const autoruns = data?.[keys?.AUTO_RUNS] || {};
      let quotaAt = null, quotaIdentity = {};
      for (const [conversationKey, owner] of [...Object.entries(manual), ...Object.entries(autoruns)]) {
        const wait = owner?.batch?.request_state === "quota_waiting" ? Number(owner.batch.quota_wait?.next_allowed_at || 0) : 0;
        if (wait && (quotaAt === null || wait < quotaAt)) {
          quotaAt = wait;
          quotaIdentity = { conversationKey, executionId: owner.operation_id || owner.run_id, queueIndex: owner.batch?.next_index, retryGeneration: owner.batch?.quota_wait?.waiting_since };
        }
      }
      if (quotaAt !== null) await schedule(KINDS.QUOTA, { taskId: "quota:pending", dueAt: quotaAt, identity: quotaIdentity });
      else await cancelKind(KINDS.QUOTA);

      let expiryAt = null;
      for (const owner of Object.values(manual)) {
        const expiry = Number(owner?.payload_expires_at_ms || 0);
        if (expiry > 0) expiryAt = expiryAt === null ? expiry : Math.min(expiryAt, expiry);
      }
      if (expiryAt !== null) await schedule(KINDS.EXPIRY, { taskId: "expiry:buffers", dueAt: expiryAt, identity: { retryGeneration: "payload" } });
      else await cancel("expiry:buffers");

      let knownResult = false, resultIdentity = {};
      for (const [conversationKey, owner] of Object.entries(manual)) {
        if (!["requesting", "collecting"].includes(String(owner?.status))) continue;
        const entry = (owner.batch?.entries || []).find((item) => item?.status === "requesting" && item.result_buffer?.phase === "BUFFERED");
        if (entry) {
          knownResult = true;
          resultIdentity = { conversationKey, executionId: owner.operation_id, providerAttemptId: entry.provider_attempt_id, bindingId: owner.execution_context?.bindingId, workGeneration: owner.execution_context?.workSessionId };
          break;
        }
      }
      if (knownResult) await schedule(KINDS.RESULT, { taskId: "result:known", dueAt: now, identity: resultIdentity });
      else await cancelKind(KINDS.RESULT);

      const recoveries = data?.[keys?.WORK_SESSION_RECOVERIES] || {};
      if (Object.keys(recoveries).length) await schedule(KINDS.WORK, { taskId: "work:recovery", dueAt: now, identity: { conversationKey: Object.keys(recoveries).sort()[0] } });
      else await cancelKind(KINDS.WORK);
    } catch (_) {}
  }

  async function dispatch(entry) {
    if (entry.kind === KINDS.SYNC) return globalThis.SellerAgentsSyncJournal?.syncNow?.("technical_wake");
    if (entry.kind === KINDS.QUOTA) return globalThis.resumeProviderQuotaWaits?.();
    if (entry.kind === KINDS.RESULT) return globalThis.resumeKnownResultRecoveries?.();
    if (entry.kind === KINDS.EXPIRY) return globalThis.saCleanupExpiredPayloads?.();
    if (entry.kind === KINDS.WORK) return globalThis.resumeWorkSessionRecoveries?.();
    return null;
  }

  async function wake(reason = "event") {
    if (dispatchFlight) return dispatchFlight;
    dispatchFlight = (async () => {
      await reconstruct();
      const now = Date.now();
      const state = await read();
      const due = Object.values(state.entries).filter((entry) => entry.dueAt <= now && entry.claimedUntil <= now)
        .sort((a, b) => a.dueAt - b.dueAt || a.taskId.localeCompare(b.taskId)).slice(0, MAX_DUE_PER_WAKE);
      for (const candidate of due) {
        const entry = await claim(candidate.taskId, now);
        if (!entry) continue;
        try { await dispatch(entry); await finish(entry); }
        catch (_) { await finish(entry, { failed: true }); }
      }
      await reconstruct();
      const finalState = await read();
      await arm(finalState);
      return { ok: true, reason, processed: due.length };
    })().finally(() => { dispatchFlight = null; });
    return dispatchFlight;
  }

  if (chrome.alarms?.onAlarm?.addListener) chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name === ALARM) void wake("alarm");
  });
  chrome.runtime?.onStartup?.addListener(() => { void wake("startup"); });
  chrome.runtime?.onInstalled?.addListener(() => { void wake("installed"); });

  globalThis.SellerAgentsTechnicalScheduler = Object.freeze({
    ALARM, KINDS, schedule, cancel, cancelKind, wake,
    state: async () => clone(await read()),
  });
})();
