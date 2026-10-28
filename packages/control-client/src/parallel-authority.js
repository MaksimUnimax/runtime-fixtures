/* Per-principal bootstrap scheduling. This queue never executes business commands. */
(() => {
  "use strict";

  // Optional in-memory I1 observation. It has no authority or transport effects.
  function i1BootstrapDiagnostic(event, fields = {}, links = {}) {
    let port;
    try {
      if (globalThis.SellerAgentsControlConfig?.environment !== "LOCAL DEVELOPMENT") return null;
      port = globalThis.__OCTOPORT_I1_BOOTSTRAP_DIAGNOSTIC_V1__;
      if (port && typeof port.record === "function") port.record(event, fields, links);
    } catch (_) {
      try { if (port && typeof port.gap === "function") port.gap(); } catch (_) {}
    }
  }

  const WAIT_MS = 65000, ACTIVE_MS = 60000;
  const fenceFields = ["principalEpoch", "accessEpoch", "grantEpoch", "environmentKey", "scopeKey"];
  const failure = (code, details = {}) => Object.assign(new Error(code), { code, ...details });
  function captureFence(value) {
    if (!value || typeof value !== "object") throw failure("BOOTSTRAP_FENCE_REQUIRED");
    for (const name of ["principalEpoch", "accessEpoch", "grantEpoch"]) {
      if (!Number.isSafeInteger(value[name]) || value[name] < 0) throw failure("BOOTSTRAP_FENCE_INVALID");
    }
    for (const name of ["environmentKey", "scopeKey"]) {
      if (typeof value[name] !== "string" || !value[name]) throw failure("BOOTSTRAP_FENCE_INVALID");
    }
    return Object.freeze(Object.fromEntries(fenceFields.map(name => [name, value[name]])));
  }
  async function createScopeIdentity(input, { canonicalJson, sha256 } = {}) {
    if (typeof canonicalJson !== "function" || typeof sha256 !== "function") throw failure("SCOPE_HASH_PORT_REQUIRED");
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const principal = {};
    for (const field of ["controlApiOrigin", "portalOrigin"]) {
      let parsed;
      try { parsed = new URL(input[field]); } catch (_) { throw failure("SCOPE_ORIGIN_INVALID"); }
      const loopbackDevelopment = input.development === true && parsed.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
      if (input[field] !== parsed.origin || !(parsed.protocol === "https:" || loopbackDevelopment) ||
          !Array.isArray(input.allowedOrigins) || !input.allowedOrigins.includes(parsed.origin)) throw failure("SCOPE_ORIGIN_INVALID");
      principal[field] = parsed.origin;
    }
    for (const field of ["accountId", "deviceId", "sessionId"]) {
      if (!uuid.test(input[field] || "")) throw failure("SCOPE_PRINCIPAL_INVALID");
      principal[field] = input[field].toLowerCase();
    }
    if (!Number.isSafeInteger(input.principalEpoch) || input.principalEpoch < 0) throw failure("SCOPE_PRINCIPAL_INVALID");
    principal.principalEpoch = input.principalEpoch;
    const ai = input.ai;
    if (!ai || !["chatgpt", "alice", "qwen", "kimi", "grok", "gemini", "claude", "deepseek"].includes(ai.family) || ai.surface !== "web" || ai.variant !== null)
      throw failure("SCOPE_AI_UNSUPPORTED");
    if (!["control_plane_v2", "control_plane_v3"].includes(input.contractVersion) ||
        typeof input.extensionVersion !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(input.extensionVersion) ||
        !input.browser || !["chrome", "opera", "yandex_chromium", "firefox", "safari"].includes(input.browser.family) ||
        typeof input.browser.version !== "string" || !/^\d+(?:\.\d+){0,3}$/.test(input.browser.version) ||
        !/^[0-9a-f]{64}$/.test(input.trustBundleSha256 || "") ||
        !["identified", "privacy-neutral"].includes(input.privacyProjection)) throw failure("SCOPE_ENVIRONMENT_INVALID");
    const principalKey = canonicalJson(principal);
    const environmentKey = await sha256(canonicalJson({ contractVersion: input.contractVersion,
      extensionVersion: input.extensionVersion, browser: { family: input.browser.family, version: input.browser.version },
      trustBundleSha256: input.trustBundleSha256, privacyProjection: input.privacyProjection }));
    const scope = Object.freeze({ family: ai.family, surface: ai.surface, variant: null });
    const scopeKey = await sha256(canonicalJson({ keyVersion: 1, principalKey, environmentKey, ai: scope }));
    return Object.freeze({ principalKey, environmentKey, scopeKey, ai: scope });
  }
  const sameFence = (a, b) => fenceFields.every(name => a[name] === b[name]);
  function createBootstrapScheduler({
    isFenceCurrent, observeLateOutcome, quarantine,
    now = () => performance.now(),
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = id => clearTimeout(id),
    makeId = () => crypto.randomUUID(),
    workerInstanceId = makeId(),
    waitTimeoutMs = WAIT_MS,
    activeTimeoutMs = ACTIVE_MS,
    maxScopes = 2,
  }) {
    for (const fn of [isFenceCurrent, observeLateOutcome, quarantine]) {
      if (typeof fn !== "function") throw failure("BOOTSTRAP_SECURITY_OBSERVER_REQUIRED");
    }
    if (!Number.isFinite(waitTimeoutMs) || waitTimeoutMs <= 0 || waitTimeoutMs > WAIT_MS ||
        !Number.isFinite(activeTimeoutMs) || activeTimeoutMs <= 0 || activeTimeoutMs > ACTIVE_MS ||
        maxScopes !== 2) throw failure("BOOTSTRAP_LIMIT_INVALID");
    const scopes = new Map(), sequence = new Map(), deadlines = new WeakMap(), queue = [];
    let active = null, closed = false, pumping = false, quarantined = false;
    function quarantineAll(error) {
      closed = true;
      if (!quarantined) {
        quarantined = true;
        try { Promise.resolve(quarantine(error)).catch(() => {}); } catch (_) { /* Closed. */ }
      }
      for (const pending of [...scopes.values()]) retire(pending, "BOOTSTRAP_SECURITY_QUARANTINE");
    }
    function fenceCurrent(fence) {
      try { return isFenceCurrent(fence) === true; }
      catch (error) { quarantineAll(error); return false; }
    }
    function nextSeq(key) {
      const next = (sequence.get(key) || 0) + 1;
      if (!Number.isSafeInteger(next)) throw failure("BOOTSTRAP_SEQUENCE_EXHAUSTED");
      sequence.set(key, next);
      return next;
    }
    function current(job) {
      return !closed && job.ticket.workerInstanceId === workerInstanceId &&
        sequence.get(job.key) === job.ticket.scopeSeq && fenceCurrent(job.committedFence || job.ticket.fence);
    }
    function releaseWaiter(job, waiter, outcome, value) {
      if (waiter.done) return;
      waiter.done = true;
      clearTimer(waiter.timer);
      waiter.signal?.removeEventListener("abort", waiter.onAbort);
      job.waiters.delete(waiter);
      waiter[outcome](value);
    }
    function remove(job) {
      if (scopes.get(job.key) === job) scopes.delete(job.key);
      const index = queue.indexOf(job);
      if (index !== -1) queue.splice(index, 1);
      if (active === job) active = null;
      clearTimer(job.activeTimer);
    }
    function retire(job, code, details = {}) {
      if (job.state === "retired" || job.state === "settled") return;
      if (job.commitStarted && !quarantined) {
        quarantineAll(failure("BOOTSTRAP_SECURITY_COMMIT_UNKNOWN"));
        return;
      }
      i1BootstrapDiagnostic("RETIRE_BEGIN", {retire_code:code,dispatched:job.dispatched,commit_started:job.commitStarted,waiter_count:job.waiters.size}, {acquisitionId:job.ticket.acquisitionId,callerSignal:job.controller.signal});
      const acquisition = job.dispatched ? "OUTCOME_UNKNOWN" : "NOT_STARTED";
      job.state = "retired";
      if (sequence.get(job.key) === job.ticket.scopeSeq) nextSeq(job.key);
      remove(job);
      const error = failure(code, { acquisition, retryRequiresExplicitAction: true, ...details });
      for (const waiter of [...job.waiters]) releaseWaiter(job, waiter, "reject", error);
      // Logical slot release is bounded; abort does not promise physical cancellation.
      i1BootstrapDiagnostic("LEASE_ABORT_BEGIN", {caller_aborted:job.controller.signal.aborted}, {acquisitionId:job.ticket.acquisitionId,callerSignal:job.controller.signal});
      job.controller.abort(error);
      i1BootstrapDiagnostic("LEASE_ABORT_DONE", {caller_aborted:job.controller.signal.aborted}, {acquisitionId:job.ticket.acquisitionId,callerSignal:job.controller.signal});
      pump();
    }
    function late(job, outcome) {
      Promise.resolve().then(() => observeLateOutcome(Object.freeze({
        ticket: job.ticket, ...outcome,
      }))).catch(error => {
        // An unknown security commit must never be bypassed by a concurrent writer.
        quarantineAll(error);
      });
    }
    function settle(job, ok, value) {
      if (job.state !== "active") {
        late(job, ok ? { value } : { error: value });
        return;
      }
      if (job.commitStarted) {
        quarantineAll(failure("BOOTSTRAP_SECURITY_COMMIT_UNKNOWN"));
        late(job, ok ? { value } : { error: value });
        return;
      }
      if (job.revocationCommitted && ok) {
        quarantineAll(failure("BOOTSTRAP_ALLOW_AFTER_REVOCATION"));
        return;
      }
      if (now() >= job.activeDeadline || !job.revocationCommitted && !current(job)) {
        retire(job, now() >= job.activeDeadline ? "BOOTSTRAP_ACTIVE_EXPIRED" : "BOOTSTRAP_CONTEXT_CHANGED");
        late(job, ok ? { value } : { error: value });
        return;
      }
      job.state = "settled";
      remove(job);
      for (const waiter of [...job.waiters]) {
        releaseWaiter(job, waiter, ok ? "resolve" : "reject",
          ok ? Object.freeze({ value, ticket: job.ticket }) : value);
      }
      pump();
    }
    function pump() {
      if (pumping || closed || active) return;
      pumping = true;
      try {
        while (!closed && !active && queue.length) {
          const job = queue[0];
          // Recheck deadlines before effects, including after a suspended worker wakes.
          for (const waiter of [...job.waiters]) {
            if (now() >= waiter.deadline) {
              releaseWaiter(job, waiter, "reject", failure("BOOTSTRAP_QUEUE_WAIT_EXPIRED", {
                acquisition: "NOT_STARTED", retryRequiresExplicitAction: true,
              }));
            }
          }
          if (!job.waiters.size) {
            retire(job, "BOOTSTRAP_QUEUE_WAIT_EXPIRED");
            continue;
          }
          if (!current(job)) {
            retire(job, "BOOTSTRAP_CONTEXT_CHANGED");
            continue;
          }
          queue.shift();
          active = job;
          job.state = "active";
          job.activeDeadline = now() + activeTimeoutMs;
          deadlines.set(job.ticket, job.activeDeadline);
          for (const waiter of job.waiters) clearTimer(waiter.timer);
          i1BootstrapDiagnostic("SCHEDULER_TIMER_ARM", {timer_kind:"ACTIVE",configured_timeout_ms:activeTimeoutMs}, {acquisitionId:job.ticket.acquisitionId});
          job.activeTimer = setTimer(() => {
            i1BootstrapDiagnostic("SCHEDULER_TIMER_FIRE", {timer_kind:"ACTIVE"}, {acquisitionId:job.ticket.acquisitionId});
            retire(job, "BOOTSTRAP_ACTIVE_EXPIRED");
          }, activeTimeoutMs);
          const request = Object.freeze({
            ...job.ticket, signal: job.controller.signal,
            deadline: job.activeDeadline,
            beginSecurityCommit() {
              this.assertCurrent();
              job.commitStarted = true;
            },
            finishRevocationCommit() {
              // A confirmed common denial intentionally invalidates the captured fence.
              // Preserve its original rejection; it can never complete as an allow.
              if (!job.commitStarted || job.state !== "active" || closed || now() >= job.activeDeadline ||
                  sequence.get(job.key) !== job.ticket.scopeSeq)
                throw failure("BOOTSTRAP_REVOCATION_COMMIT_INVALID");
              job.commitStarted = false;
              job.revocationCommitted = true;
            },
            finishSecurityCommit(committedFence = null) {
              if (committedFence !== null) {
                const next = captureFence(committedFence), before = job.committedFence || job.ticket.fence;
                // Only the current writer may acknowledge its own committed epoch change.
                // The immutable acquisition ticket and every command fence stay unchanged.
                if (!job.commitStarted || job.state !== "active" || closed || now() >= job.activeDeadline ||
                    sequence.get(job.key) !== job.ticket.scopeSeq || next.scopeKey !== before.scopeKey ||
                    next.environmentKey !== before.environmentKey || next.principalEpoch !== before.principalEpoch ||
                    next.accessEpoch < before.accessEpoch || !fenceCurrent(next))
                  throw failure("BOOTSTRAP_COMMIT_FENCE_INVALID");
                job.committedFence = next;
              }
              this.assertCurrent();
              job.commitStarted = false;
            },
            assertCurrent() {
              if (job.state !== "active" || now() >= job.activeDeadline || !current(job)) {
                throw failure("BOOTSTRAP_ATTEMPT_OBSOLETE");
              }
            },
          });
          // No retry or re-enqueue occurs here, even when the run rejects.
          Promise.resolve().then(() => {
            request.assertCurrent();
            job.dispatched = true;
            i1BootstrapDiagnostic("ACQUISITION_DISPATCH", {dispatched:true}, {acquisitionId:job.ticket.acquisitionId,callerSignal:job.controller.signal});
            return job.run(request);
          }).then(value => settle(job, true, value), error => settle(job, false, error));
        }
      } finally { pumping = false; }
    }
    function request({ fence: suppliedFence, requestKey = "", run, signal, waitMs = waitTimeoutMs }) {
      if (closed) return Promise.reject(failure("BOOTSTRAP_SECURITY_QUARANTINE"));
      if (typeof requestKey !== "string" || typeof run !== "function" || !Number.isFinite(waitMs) || waitMs <= 0 || waitMs > WAIT_MS) {
        return Promise.reject(failure("BOOTSTRAP_REQUEST_INVALID"));
      }
      let fence;
      try { fence = captureFence(suppliedFence); }
      catch (error) { return Promise.reject(error); }
      if (!fenceCurrent(fence)) return Promise.reject(failure("BOOTSTRAP_CONTEXT_CHANGED"));
      if (signal?.aborted) return Promise.reject(failure("BOOTSTRAP_WAITER_CANCELLED", {
        acquisition: "NOT_STARTED", retryRequiresExplicitAction: true,
      }));
      const key = fence.scopeKey;
      let job = scopes.get(key);
      if (job && !sameFence(job.ticket.fence, fence)) {
        retire(job, "BOOTSTRAP_CONTEXT_CHANGED");
        if (closed) return Promise.reject(failure("BOOTSTRAP_SECURITY_QUARANTINE"));
        job = null;
      }
      if (job && job.requestKey !== requestKey) return Promise.reject(failure("BOOTSTRAP_REQUEST_CONFLICT", {
        acquisition: "NOT_STARTED", retryRequiresExplicitAction: true,
      }));
      if (!job) {
        if (scopes.size >= maxScopes) return Promise.reject(failure("BOOTSTRAP_SCOPE_CAPACITY", {
          acquisition: "NOT_STARTED", retryRequiresExplicitAction: true,
        }));
        const ticket = Object.freeze({
          workerInstanceId, acquisitionId: makeId(), scopeSeq: nextSeq(key), fence,
        });
        job = { key, ticket, requestKey, run, waiters: new Set(), state: "queued",
          controller: new AbortController(), activeTimer: null, activeDeadline: null,
          dispatched: false, commitStarted: false };
        scopes.set(key, job);
        queue.push(job);
      }
      const pending = job;
      const promise = new Promise((resolve, reject) => {
        const waiter = { resolve, reject, signal, done: false, timer: null,
          deadline: now() + waitMs, onAbort: null };
        waiter.onAbort = () => {
          releaseWaiter(pending, waiter, "reject", failure("BOOTSTRAP_WAITER_CANCELLED", {
            acquisition: pending.state === "queued" ? "NOT_STARTED" : "OUTCOME_UNKNOWN",
            retryRequiresExplicitAction: true,
          }));
          if (!pending.waiters.size) retire(pending, "BOOTSTRAP_WAITER_CANCELLED");
        };
        pending.waiters.add(waiter);
        signal?.addEventListener("abort", waiter.onAbort, { once: true });
        if (pending.state === "queued") {
          waiter.timer = setTimer(() => {
            if (pending.state !== "queued" || waiter.done) return;
            releaseWaiter(pending, waiter, "reject", failure("BOOTSTRAP_QUEUE_WAIT_EXPIRED", {
              acquisition: "NOT_STARTED", retryRequiresExplicitAction: true,
            }));
            if (!pending.waiters.size) retire(pending, "BOOTSTRAP_QUEUE_WAIT_EXPIRED");
          }, waitMs);
        }
      });
      pump();
      return promise;
    }
    return Object.freeze({
      request,
      isCurrent(ticket) {
        return Boolean(ticket && ticket.workerInstanceId === workerInstanceId &&
          !closed && sequence.get(ticket.fence.scopeKey) === ticket.scopeSeq &&
          now() < (deadlines.get(ticket) ?? -Infinity) &&
          fenceCurrent(scopes.get(ticket.fence.scopeKey)?.committedFence || ticket.fence));
      },
      invalidate(scopeKey, code = "BOOTSTRAP_CONTEXT_CHANGED") {
        const job = scopes.get(scopeKey);
        if (job) retire(job, code); else nextSeq(scopeKey);
      },
      dispose(code = "BOOTSTRAP_WORKER_RETIRED") {
        closed = true;
        for (const job of [...scopes.values()]) retire(job, code);
      },
      inspect() {
        return Object.freeze({
          workerInstanceId, closed, activeScope: active?.key || null,
          queuedScopes: Object.freeze(queue.map(job => job.key)),
          scopeSequences: Object.freeze(Object.fromEntries(sequence)),
        });
      },
    });
  }
  globalThis.SellerAgentsParallelAuthority = Object.freeze({
    BOOTSTRAP_WAIT_MS: WAIT_MS, BOOTSTRAP_ACTIVE_MS: ACTIVE_MS,
    captureFence, createScopeIdentity, createBootstrapScheduler,
  });
})();
