(() => {
  "use strict";

  // Result recovery is deliberately a separate journal dimension from the
  // provider-attempt record.  It may contain a bounded business result, but it
  // never changes provider authority and it never creates a provider retry.
  const SCHEMA_VERSION = 1;
  const TECHNICAL_RETENTION_MS = 60 * 60 * 1000;
  const MAX_BUFFER_BYTES = 16 * 1024 * 1024;
  const RESULT_PHASES = Object.freeze({
    NONE: "NONE",
    BUFFERED: "BUFFERED",
    MATERIALIZED: "MATERIALIZED",
    EXPIRED: "EXPIRED",
    UNAVAILABLE: "UNAVAILABLE",
  });
  const DELIVERY_OUTCOMES = Object.freeze({
    NOT_ATTEMPTED: "NOT_ATTEMPTED",
    CLAIMED: "CLAIMED",
    COMMITTED: "COMMITTED",
    UNKNOWN: "DELIVERY_OUTCOME_UNKNOWN",
    CONFIRMED: "CONFIRMED",
    KNOWN_PRE_IRREVERSIBLE_FAILURE: "KNOWN_PRE_IRREVERSIBLE_FAILURE",
  });

  const text = (value, max = 320) => {
    const output = String(value ?? "").trim();
    return output ? output.slice(0, max) : null;
  };
  const number = (value, fallback = null) => {
    const output = Number(value);
    return Number.isFinite(output) ? output : fallback;
  };
  const clone = (value) => {
    if (value === undefined) return undefined;
    try {
      return structuredClone(value);
    } catch (_) {
      return JSON.parse(JSON.stringify(value));
    }
  };
  const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

  function contextOf(value = {}) {
    const source = value.context || value;
    return Object.freeze({
      accountId: text(source.accountId || source.account_id, 160),
      conversationKey: text(source.conversationKey || source.conversation_key, 320),
      marketplace: text(source.marketplace, 64),
      storeId: text(source.storeId || source.store_id, 240),
      bindingId: text(source.bindingId || source.binding_id, 240),
      bindingRevision: number(source.bindingRevision ?? source.binding_revision, null),
      workGeneration: text(source.workGeneration || source.work_generation || source.workSessionId || source.work_session_id, 240),
      aiSurface: text(source.aiSurface || source.ai_surface, 160),
      aiProfile: text(source.aiProfile || source.ai_profile, 240),
    });
  }

  function sameContext(left, right) {
    const a = contextOf(left);
    const b = contextOf(right);
    return [
      "accountId", "conversationKey", "marketplace", "storeId", "bindingId",
      "bindingRevision", "workGeneration", "aiSurface", "aiProfile",
    ].every((field) => a[field] === b[field]);
  }

  function sanitize(value, key = "", seen = new WeakSet()) {
    const lower = String(key).toLowerCase();
    if (["authorization", "access_token", "api_key", "apikey", "client_secret", "storage_state", "storagestate"].some((part) => lower.includes(part))) return undefined;
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return value;
    }
    if (value === undefined || typeof value === "function" || typeof value === "symbol") return undefined;
    if (typeof value === "object") {
      if (seen.has(value)) return undefined;
      seen.add(value);
      if (Array.isArray(value)) return value.map((item) => sanitize(item, key, seen)).filter((item) => item !== undefined);
      const output = {};
      for (const [childKey, childValue] of Object.entries(value)) {
        const next = sanitize(childValue, childKey, seen);
        if (next !== undefined) output[childKey] = next;
      }
      return output;
    }
    return undefined;
  }

  function bufferId(input = {}) {
    return text(input.result_buffer_id || input.buffer_id) ||
      `${text(input.logical_execution_id, 240) || "execution"}:${text(input.provider_attempt_id, 240) || "attempt"}`;
  }

  function createBuffer(input = {}, now = Date.now()) {
    const payload = sanitize({
      ok: input.ok === true,
      request_id: text(input.request_id, 240),
      operation: text(input.operation, 160),
      http_status: number(input.http_status, 0),
      external_request_executed: input.external_request_executed !== false,
      executed_command_fingerprint: text(input.executed_command_fingerprint, 160),
      report_text: text(input.report_text, 8 * 1024 * 1024),
      result: input.result,
    });
    const created = number(input.created_at_ms, now) || now;
    const expires = Math.min(
      created + TECHNICAL_RETENTION_MS,
      number(input.expires_at_ms, created + TECHNICAL_RETENTION_MS) || created + TECHNICAL_RETENTION_MS,
    );
    const base = {
      schema_version: SCHEMA_VERSION,
      phase: RESULT_PHASES.BUFFERED,
      result_buffer_id: bufferId(input),
      logical_execution_id: text(input.logical_execution_id, 240),
      provider_attempt_id: text(input.provider_attempt_id, 240),
      execution_id: text(input.execution_id, 240),
      command_index: number(input.command_index, null),
      projection_kind: text(input.projection_kind, 64) || "single",
      context: contextOf(input),
      created_at_ms: created,
      expires_at_ms: expires,
      payload: payload,
      delivery_outcome: input.delivery_outcome || DELIVERY_OUTCOMES.NOT_ATTEMPTED,
      provider_replay_forbidden: true,
    };
    if (bytes(base) > MAX_BUFFER_BYTES) {
      return Object.freeze({
        schema_version: SCHEMA_VERSION,
        phase: RESULT_PHASES.UNAVAILABLE,
        result_buffer_id: base.result_buffer_id,
        logical_execution_id: base.logical_execution_id,
        provider_attempt_id: base.provider_attempt_id,
        execution_id: base.execution_id,
        command_index: base.command_index,
        projection_kind: base.projection_kind,
        context: base.context,
        created_at_ms: created,
        expires_at_ms: expires,
        unavailable_code: "RESULT_BUFFER_TOO_LARGE",
        provider_replay_forbidden: true,
      });
    }
    return Object.freeze(base);
  }

  function expire(buffer, now = Date.now()) {
    if (!buffer || typeof buffer !== "object") return null;
    return Object.freeze({
      schema_version: SCHEMA_VERSION,
      phase: RESULT_PHASES.EXPIRED,
      result_buffer_id: text(buffer.result_buffer_id, 240),
      logical_execution_id: text(buffer.logical_execution_id, 240),
      provider_attempt_id: text(buffer.provider_attempt_id, 240),
      execution_id: text(buffer.execution_id, 240),
      command_index: number(buffer.command_index, null),
      projection_kind: text(buffer.projection_kind, 64) || "single",
      context: contextOf(buffer),
      created_at_ms: number(buffer.created_at_ms, now),
      expires_at_ms: number(buffer.expires_at_ms, now),
      expired_at_ms: now,
      provider_replay_forbidden: true,
      delivery_replay_forbidden: true,
    });
  }

  function normalize(buffer, now = Date.now()) {
    if (!buffer || typeof buffer !== "object") return null;
    if (buffer.phase === RESULT_PHASES.BUFFERED && number(buffer.expires_at_ms, 0) <= now) return expire(buffer, now);
    return buffer;
  }

  function recoveryDecision({ providerAttempt = null, resultBuffer = null, deliveryOutcome = DELIVERY_OUTCOMES.NOT_ATTEMPTED, currentContext = null, finish = false, now = Date.now() } = {}) {
    if (providerAttempt?.state === "OUTCOME_UNKNOWN") return { type: "blocked", code: "PROVIDER_OUTCOME_UNKNOWN_NO_RETRY" };
    if (finish === true) return { type: "blocked", code: "STALE_DELIVERY_CONTEXT" };
    const buffer = normalize(resultBuffer, now);
    if (!buffer || buffer.phase === RESULT_PHASES.NONE) return { type: "blocked", code: "RESULT_RECOVERY_UNAVAILABLE_NO_REPLAY" };
    if (buffer.phase === RESULT_PHASES.EXPIRED) return { type: "blocked", code: "RESULT_BUFFER_EXPIRED" };
    if (buffer.phase === RESULT_PHASES.UNAVAILABLE) return { type: "blocked", code: "RESULT_RECOVERY_UNAVAILABLE_NO_REPLAY" };
    if (currentContext && !sameContext(buffer.context, currentContext)) return { type: "blocked", code: "STALE_DELIVERY_CONTEXT" };
    if ([DELIVERY_OUTCOMES.COMMITTED, DELIVERY_OUTCOMES.UNKNOWN].includes(deliveryOutcome)) return { type: "blocked", code: "DELIVERY_OUTCOME_UNKNOWN_NO_RETRY" };
    if (deliveryOutcome === DELIVERY_OUTCOMES.CONFIRMED) return { type: "none", code: "DELIVERY_CONFIRMED" };
    return { type: "resume_local_result", code: "KNOWN_RESULT_RECOVERY_SAFE", provider_calls: 0 };
  }

  function compact(buffer, now = Date.now()) {
    if (!buffer) return null;
    return number(buffer.expires_at_ms, 0) <= now ? expire(buffer, now) : buffer;
  }

  globalThis.SellerAgentsResultRecovery = Object.freeze({
    SCHEMA_VERSION,
    TECHNICAL_RETENTION_MS,
    MAX_BUFFER_BYTES,
    RESULT_PHASES,
    DELIVERY_OUTCOMES,
    contextOf,
    sameContext,
    createBuffer,
    normalize,
    expire,
    compact,
    recoveryDecision,
  });
})();
