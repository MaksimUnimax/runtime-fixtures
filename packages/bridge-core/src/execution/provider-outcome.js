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

  const fail = (code) => {
    throw Object.assign(new Error(code), { code });
  };

  function plainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function exactKeys(value, expected, code) {
    if (!plainObject(value)) fail(code);
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    if (
      actual.length !== wanted.length ||
      actual.some((key, index) => key !== wanted[index])
    )
      fail(code);
    return value;
  }

  function safeByteLength(value, code = "PROVIDER_RESPONSE_OUTCOME_RETENTION_INVALID") {
    if (!Number.isSafeInteger(value) || value < 0) fail(code);
    return value;
  }

  function safeDescriptor(value) {
    exactKeys(
      value,
      ["ref", "sha256", "byte_length"],
      "PROVIDER_RESPONSE_OUTCOME_RETENTION_INVALID",
    );
    const ref = value.ref;
    const sha256 = value.sha256;
    if (
      typeof ref !== "string" ||
      !ref ||
      ref !== ref.trim() ||
      ref.length > 512 ||
      typeof sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(sha256)
    )
      fail("PROVIDER_RESPONSE_OUTCOME_RETENTION_INVALID");
    return Object.freeze({
      ref,
      sha256,
      byte_length: safeByteLength(value.byte_length),
    });
  }

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

  function safeVerificationDetails(value) {
    exactKeys(
      value,
      [
        "transport",
        "http",
        "parse",
        "schema",
        "semantic",
        "source_revision",
        "fully_verified",
      ],
      "PROVIDER_RESPONSE_OUTCOME_DISPOSITION_INVALID",
    );
    const allowedParse = new Set(["text", "json", "empty", "invalid_json", "binary"]);
    const allowedSchema = new Set(["not_configured", "pass", "failed"]);
    const allowedSemantic = new Set(["not_configured", "pass", "error"]);
    if (
      value.transport !== "response_received" ||
      !["success", "error"].includes(value.http) ||
      !allowedParse.has(value.parse) ||
      !allowedSchema.has(value.schema) ||
      !allowedSemantic.has(value.semantic) ||
      typeof value.fully_verified !== "boolean" ||
      !(
        value.source_revision === null ||
        (typeof value.source_revision === "string" &&
          value.source_revision.length > 0 &&
          value.source_revision.length <= 240)
      )
    )
      fail("PROVIDER_RESPONSE_OUTCOME_DISPOSITION_INVALID");
    const verified =
      value.http === "success" &&
      value.schema === "pass" &&
      value.semantic === "pass";
    if (value.fully_verified !== verified)
      fail("PROVIDER_RESPONSE_OUTCOME_DISPOSITION_INVALID");
    return Object.freeze({
      transport: value.transport,
      http: value.http,
      parse: value.parse,
      schema: value.schema,
      semantic: value.semantic,
      source_revision: value.source_revision,
      fully_verified: value.fully_verified,
    });
  }

  function safeProcessingError(value) {
    exactKeys(
      value,
      ["code", "stage", "automatic_retry"],
      "PROVIDER_RESPONSE_OUTCOME_DISPOSITION_INVALID",
    );
    if (
      !/^[A-Z0-9_]{1,100}$/.test(value.code || "") ||
      value.stage !== "response_processing" ||
      value.automatic_retry !== false
    )
      fail("PROVIDER_RESPONSE_OUTCOME_DISPOSITION_INVALID");
    return Object.freeze({
      code: value.code,
      stage: "response_processing",
      automatic_retry: false,
    });
  }

  function safeDisposition(value) {
    if (!plainObject(value))
      fail("PROVIDER_RESPONSE_OUTCOME_DISPOSITION_INVALID");
    const failure =
      value.disposition === "MALFORMED_DECLARED_JSON" ||
      value.disposition === "RESPONSE_PROCESSING_FAILED";
    exactKeys(
      value,
      failure
        ? [
            "disposition",
            "verification_details",
            "error",
            "provider_http_ok",
            "provider_http_status",
            "body_omitted",
            "raw_capture_policy",
          ]
        : [
            "disposition",
            "verification_details",
            "provider_http_ok",
            "provider_http_status",
          ],
      "PROVIDER_RESPONSE_OUTCOME_DISPOSITION_INVALID",
    );
    if (
      typeof value.provider_http_ok !== "boolean" ||
      !Number.isInteger(value.provider_http_status) ||
      value.provider_http_status < 0 ||
      value.provider_http_status > 999
    )
      fail("PROVIDER_RESPONSE_OUTCOME_DISPOSITION_INVALID");
    const details = safeVerificationDetails(value.verification_details);
    if (
      details.http !== (value.provider_http_ok ? "success" : "error")
    )
      fail("PROVIDER_RESPONSE_OUTCOME_DISPOSITION_INVALID");

    if (failure) {
      const error = safeProcessingError(value.error);
      const expected =
        error.code === "PROVIDER_JSON_INVALID"
          ? "MALFORMED_DECLARED_JSON"
          : "RESPONSE_PROCESSING_FAILED";
      exactKeys(
        value.raw_capture_policy,
        ["chat_access_blocked"],
        "PROVIDER_RESPONSE_OUTCOME_DISPOSITION_INVALID",
      );
      if (
        value.disposition !== expected ||
        value.body_omitted !== true ||
        value.raw_capture_policy.chat_access_blocked !== true ||
        details.fully_verified
      )
        fail("PROVIDER_RESPONSE_OUTCOME_DISPOSITION_INVALID");
      return Object.freeze({
        disposition: value.disposition,
        verification_details: details,
        error,
        provider_http_ok: value.provider_http_ok,
        provider_http_status: value.provider_http_status,
        body_omitted: true,
        raw_capture_policy: Object.freeze({ chat_access_blocked: true }),
      });
    }

    if (details.parse === "binary" && value.provider_http_ok !== true)
      fail("PROVIDER_RESPONSE_OUTCOME_DISPOSITION_INVALID");

    const expected = details.fully_verified
      ? "VERIFIED_PROVIDER_SCHEMA_AND_SEMANTICS"
      : details.parse === "binary"
        ? "BINARY_BYTES_CAPTURED"
        : details.parse !== "json"
          ? "NON_JSON_BODY"
          : "STRUCTURAL_ONLY_PROVIDER_SCHEMA_PENDING";
    if (value.disposition !== expected)
      fail("PROVIDER_RESPONSE_OUTCOME_DISPOSITION_INVALID");
    return Object.freeze({
      disposition: value.disposition,
      verification_details: details,
      provider_http_ok: value.provider_http_ok,
      provider_http_status: value.provider_http_status,
    });
  }

  function sameDescriptor(left, right) {
    return (
      left.ref === right.ref &&
      left.sha256 === right.sha256 &&
      left.byte_length === right.byte_length
    );
  }

  function safeQuarantineRetention(value) {
    if (!plainObject(value))
      fail("PROVIDER_RESPONSE_OUTCOME_RETENTION_INVALID");
    if (value.stored_locally === false) {
      exactKeys(
        value,
        ["stored_locally", "raw_retention_failed", "chat_access_blocked"],
        "PROVIDER_RESPONSE_OUTCOME_RETENTION_INVALID",
      );
      if (
        value.raw_retention_failed !== true ||
        value.chat_access_blocked !== true
      )
        fail("PROVIDER_RESPONSE_OUTCOME_RETENTION_INVALID");
      return Object.freeze({
        stored_locally: false,
        raw_retention_failed: true,
        chat_access_blocked: true,
      });
    }
    exactKeys(
      value,
      ["stored_locally", "ref", "sha256", "byte_length", "chat_access_blocked"],
      "PROVIDER_RESPONSE_OUTCOME_RETENTION_INVALID",
    );
    if (value.stored_locally !== true || value.chat_access_blocked !== true)
      fail("PROVIDER_RESPONSE_OUTCOME_RETENTION_INVALID");
    const descriptor = safeDescriptor({
      ref: value.ref,
      sha256: value.sha256,
      byte_length: value.byte_length,
    });
    return Object.freeze({
      stored_locally: true,
      ref: descriptor.ref,
      sha256: descriptor.sha256,
      byte_length: descriptor.byte_length,
      chat_access_blocked: true,
    });
  }

  function safeStorageError(value, disposition) {
    exactKeys(
      value,
      ["code", "provider_http_status", "provider_ok", "automatic_retry"],
      "PROVIDER_RESPONSE_OUTCOME_RETENTION_INVALID",
    );
    if (
      value.code !== "ARTIFACT_STORAGE_FAILED" ||
      value.provider_http_status !== disposition.provider_http_status ||
      value.provider_ok !== true ||
      value.automatic_retry !== false
    )
      fail("PROVIDER_RESPONSE_OUTCOME_RETENTION_INVALID");
    return Object.freeze({
      code: "ARTIFACT_STORAGE_FAILED",
      provider_http_status: value.provider_http_status,
      provider_ok: true,
      automatic_retry: false,
    });
  }

  function safeBinaryRetention(value, disposition) {
    exactKeys(
      value,
      ["artifact_refs", "delivery_error", "result_policy"],
      "PROVIDER_RESPONSE_OUTCOME_RETENTION_INVALID",
    );
    if (!Array.isArray(value.artifact_refs) || !plainObject(value.result_policy))
      fail("PROVIDER_RESPONSE_OUTCOME_RETENTION_INVALID");

    if (value.delivery_error === null) {
      if (value.artifact_refs.length !== 1)
        fail("PROVIDER_RESPONSE_OUTCOME_RETENTION_INVALID");
      const artifact = safeDescriptor(value.artifact_refs[0]);
      exactKeys(
        value.result_policy,
        ["artifact", "byte_length", "delivery_status"],
        "PROVIDER_RESPONSE_OUTCOME_RETENTION_INVALID",
      );
      const policyArtifact = safeDescriptor(value.result_policy.artifact);
      const length = safeByteLength(value.result_policy.byte_length);
      if (
        !sameDescriptor(artifact, policyArtifact) ||
        artifact.byte_length !== length ||
        value.result_policy.delivery_status !== "PREPARED_NOT_ATTACHED"
      )
        fail("PROVIDER_RESPONSE_OUTCOME_RETENTION_INVALID");
      return Object.freeze({
        artifact_refs: Object.freeze([artifact]),
        delivery_error: null,
        result_policy: Object.freeze({
          artifact,
          byte_length: length,
          delivery_status: "PREPARED_NOT_ATTACHED",
        }),
      });
    }

    if (value.artifact_refs.length !== 0)
      fail("PROVIDER_RESPONSE_OUTCOME_RETENTION_INVALID");
    const deliveryError = safeStorageError(value.delivery_error, disposition);
    exactKeys(
      value.result_policy,
      ["byte_length", "delivery_error", "bytes_preserved_in_result"],
      "PROVIDER_RESPONSE_OUTCOME_RETENTION_INVALID",
    );
    const policyError = safeStorageError(
      value.result_policy.delivery_error,
      disposition,
    );
    const length = safeByteLength(value.result_policy.byte_length);
    if (
      value.result_policy.bytes_preserved_in_result !== true ||
      JSON.stringify(deliveryError) !== JSON.stringify(policyError)
    )
      fail("PROVIDER_RESPONSE_OUTCOME_RETENTION_INVALID");
    return Object.freeze({
      artifact_refs: Object.freeze([]),
      delivery_error: deliveryError,
      result_policy: Object.freeze({
        byte_length: length,
        delivery_error: deliveryError,
        bytes_preserved_in_result: true,
      }),
    });
  }

  function attachResponseProcessing(record, disposition, retention) {
    if (
      !plainObject(record) ||
      record.state !== STATES.RESPONSE_RECEIVED ||
      !plainObject(record.response) ||
      record.response_processing !== undefined
    )
      fail("PROVIDER_RESPONSE_OUTCOME_STATE_INVALID");
    const checked = safeDisposition(disposition);
    if (
      checked.provider_http_status !== record.response.http_status ||
      checked.provider_http_ok !== record.response.ok
    )
      fail("PROVIDER_RESPONSE_OUTCOME_METADATA_MISMATCH");

    let checkedRetention;
    if (retention !== undefined && retention !== null) {
      const failure =
        checked.disposition === "MALFORMED_DECLARED_JSON" ||
        checked.disposition === "RESPONSE_PROCESSING_FAILED";
      if (failure) checkedRetention = safeQuarantineRetention(retention);
      else if (checked.verification_details.parse === "binary")
        checkedRetention = safeBinaryRetention(retention, checked);
      else fail("PROVIDER_RESPONSE_OUTCOME_RETENTION_INVALID");
    }

    const snapshot = Object.freeze({
      ...checked,
      ...(checkedRetention ? { retention: checkedRetention } : {}),
    });
    return Object.freeze({ ...record, response_processing: snapshot });
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
    attachResponseProcessing,
    compactHistory,
    canAutomaticallyDispatch,
    responseClassification,
    responseMetadata,
  });
})();
