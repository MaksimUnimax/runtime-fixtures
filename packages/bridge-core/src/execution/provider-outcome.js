(() => {
  "use strict";

  const STATES = Object.freeze({
    NOT_DISPATCHED: "NOT_DISPATCHED",
    DISPATCH_INTENT_COMMITTED: "DISPATCH_INTENT_COMMITTED",
    RESPONSE_RECEIVED: "RESPONSE_RECEIVED",
    RETRY_WAIT_KNOWN: "RETRY_WAIT_KNOWN",
    OUTCOME_UNKNOWN: "OUTCOME_UNKNOWN",
    COMPLETED_KNOWN: "COMPLETED_KNOWN",
    FAILED_KNOWN: "FAILED_KNOWN",
  });
  const MAX_HISTORY = 8;
  const UNKNOWN_RETENTION_MS = 60 * 60 * 1000;

  function text(value, max = 160) {
    const output = String(value ?? "").trim();
    return output ? output.slice(0, max) : null;
  }

  function safeIso(value, now = Date.now()) {
    const ms = Date.parse(String(value || ""));
    return Number.isFinite(ms) && ms <= Number(now)
      ? new Date(ms).toISOString()
      : new Date(Number(now)).toISOString();
  }

  function responseClassification(response) {
    const status = Number(response?.httpStatus || response?.http_status || 0);
    const retryAfter = text(
      response?.responseMeta?.retry_after ?? response?.response_meta?.retry_after,
    );
    if (status === 429) return "KNOWN_429";
    if (status === 401 || status === 403) return "KNOWN_AUTH_ERROR";
    if (status >= 200 && status < 300) return "KNOWN_SUCCESS";
    if (status >= 400) return "KNOWN_PROVIDER_ERROR";
    if (response?.external_request_executed === false) return "KNOWN_LOCAL_RESULT";
    return retryAfter ? "KNOWN_RESPONSE" : "KNOWN_RESPONSE";
  }

  function responseMetadata(response) {
    const meta = response?.responseMeta || response?.response_meta || {};
    return Object.freeze({
      http_status: Number(response?.httpStatus || response?.http_status || 0),
      ok: response?.ok === true,
      classification: responseClassification(response),
      retry_after: text(meta.retry_after),
      provider_request_id: text(meta.request_id || response?.provider_request_id),
    });
  }

  function identity(input = {}) {
    const output = {};
    for (const [key, value] of Object.entries({
      logical_execution_id: input.logical_execution_id,
      provider_attempt_id: input.provider_attempt_id,
      execution_id: input.execution_id,
      command_index: input.command_index,
      account: input.account,
      conversation: input.conversation,
      work_generation: input.work_generation,
      binding: input.binding,
      binding_revision: input.binding_revision,
      marketplace: input.marketplace,
      store: input.store,
      credential_revision: input.credential_revision,
      operation: input.operation,
      attempt_number: input.attempt_number,
    })) {
      if (value !== undefined && value !== null && String(value) !== "")
        output[key] = typeof value === "number" ? value : text(value, 240);
    }
    return output;
  }

  function createIntent(input, now = Date.now()) {
    const record = {
      schema_version: 1,
      state: STATES.DISPATCH_INTENT_COMMITTED,
      outcome: null,
      ...identity(input),
      created_at: safeIso(null, now),
      intent_committed_at: safeIso(null, now),
      response_received_at: null,
      finalized_at: null,
      response: null,
      delivery_state: "PENDING",
    };
    if (!record.provider_attempt_id || !record.logical_execution_id)
      throw Object.assign(new Error("Provider attempt identity is incomplete"), {
        code: "PROVIDER_ATTEMPT_IDENTITY_MISSING",
      });
    return Object.freeze(record);
  }

  function withState(record, state, patch = {}, now = Date.now()) {
    if (!record || typeof record !== "object")
      throw new TypeError("Provider attempt record is required");
    if (record.state === STATES.OUTCOME_UNKNOWN && state !== STATES.OUTCOME_UNKNOWN)
      throw Object.assign(new Error("UNKNOWN provider outcome cannot be replayed"), {
        code: "PROVIDER_UNKNOWN_REPLAY_FORBIDDEN",
      });
    return Object.freeze({
      ...record,
      ...patch,
      state,
      finalized_at: [
        STATES.RETRY_WAIT_KNOWN,
        STATES.OUTCOME_UNKNOWN,
        STATES.COMPLETED_KNOWN,
        STATES.FAILED_KNOWN,
      ].includes(state)
        ? safeIso(null, now)
        : record.finalized_at || null,
    });
  }

  function markResponseReceived(record, response, now = Date.now()) {
    if (record?.state === STATES.OUTCOME_UNKNOWN)
      return withState(record, STATES.OUTCOME_UNKNOWN, {}, now);
    return withState(
      record,
      STATES.RESPONSE_RECEIVED,
      {
        outcome: "KNOWN_RESPONSE",
        response: responseMetadata(response),
        response_received_at: safeIso(null, now),
      },
      now,
    );
  }

  function markKnown(record, ok, now = Date.now()) {
    if (record?.state === STATES.OUTCOME_UNKNOWN)
      return withState(record, STATES.OUTCOME_UNKNOWN, {}, now);
    const response = record.response || {};
    if (response.classification === "KNOWN_429" && response.retry_after)
      return withState(record, STATES.RETRY_WAIT_KNOWN, { outcome: "KNOWN_RESPONSE" }, now);
    return withState(
      record,
      ok === true ? STATES.COMPLETED_KNOWN : STATES.FAILED_KNOWN,
      { outcome: "KNOWN_RESPONSE" },
      now,
    );
  }

  function markUnknown(record, now = Date.now(), reason = "dispatch_started_without_durable_response") {
    return withState(
      record,
      STATES.OUTCOME_UNKNOWN,
      { outcome: "UNKNOWN_OUTCOME", unknown_reason: text(reason, 200) },
      now,
    );
  }

  function beginPermittedRetry(record, providerAttemptId, now = Date.now()) {
    if (record?.state !== STATES.RETRY_WAIT_KNOWN)
      throw Object.assign(new Error("Only a known retry wait can create a new attempt"), {
        code: "PROVIDER_RETRY_NOT_PERMITTED",
      });
    return createIntent({
      ...record,
      provider_attempt_id: providerAttemptId,
      attempt_number: Number(record.attempt_number || 1) + 1,
    }, now);
  }

  function compactHistory(history, now = Date.now(), max = MAX_HISTORY) {
    const rows = Array.isArray(history) ? history.filter((row) => row && typeof row === "object") : [];
    const retained = rows.filter((row) => {
      if ([STATES.DISPATCH_INTENT_COMMITTED, STATES.RESPONSE_RECEIVED, STATES.RETRY_WAIT_KNOWN].includes(row.state)) return true;
      const at = Date.parse(String(row.finalized_at || row.created_at || ""));
      return Number.isFinite(at) && Number(now) - at <= UNKNOWN_RETENTION_MS;
    });
    return retained.slice(-Math.max(1, Math.min(Number(max) || MAX_HISTORY, MAX_HISTORY)));
  }

  function canAutomaticallyDispatch(record) {
    return record?.state === STATES.NOT_DISPATCHED;
  }

  globalThis.SellerAgentsProviderOutcome = Object.freeze({
    STATES,
    MAX_HISTORY,
    UNKNOWN_RETENTION_MS,
    createIntent,
    markResponseReceived,
    markKnown,
    markUnknown,
    beginPermittedRetry,
    compactHistory,
    canAutomaticallyDispatch,
    responseClassification,
    responseMetadata,
  });
})();
