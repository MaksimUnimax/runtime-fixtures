(() => {
  "use strict";

  // Result recovery is deliberately a separate journal dimension from the
  // provider-attempt record.  It may contain a bounded business result, but it
  // never changes provider authority and it never creates a provider retry.
  const SCHEMA_VERSION = 2;
  const BUFFER_INTEGRITY_VERSION = 2;
  // Old schema-2/integrity-1 writers could remove a structured credential
  // while retaining its value in report_text. Their hashes prove bytes, not
  // that this writer's structured-key/report-reflection policy ran.
  const SANITIZATION_POLICY = "structured-key-and-report-reflection-v2";
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
  const encoder = () => new TextEncoder();
  const serializedBytes = (value) => {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string") throw new TypeError("RESULT_BUFFER_PAYLOAD_INVALID");
    return { serialized, byteLength: encoder().encode(serialized).byteLength };
  };
  async function sha256Hex(value) {
    const subtle = globalThis.crypto && globalThis.crypto.subtle;
    if (!subtle || typeof subtle.digest !== "function") throw new Error("RESULT_BUFFER_INTEGRITY_UNAVAILABLE");
    const digest = await subtle.digest("SHA-256", encoder().encode(value));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function unavailable(base, code) {
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
      created_at_ms: base.created_at_ms,
      expires_at_ms: base.expires_at_ms,
      unavailable_code: code,
      provider_replay_forbidden: true,
      delivery_replay_forbidden: true,
    });
  }

  function contextOf(value = {}) {
    const source = value.context || value;
    return Object.freeze({
      accountId: text(source.accountId || source.account_id, 160),
      conversationKey: text(source.conversationKey || source.conversation_key, 320),
      marketplace: text(source.marketplace, 64),
      storeId: text(source.storeId || source.store_id, 240),
      bindingId: text(source.bindingId || source.binding_id, 240),
      bindingRevision: number(source.bindingRevision ?? source.binding_revision, null),
      workSessionId: text(source.workSessionId || source.work_session_id, 240),
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
      "bindingRevision", "workSessionId", "workGeneration", "aiSurface", "aiProfile",
    ].every((field) => a[field] === b[field]);
  }

  function sameProviderAttempt(buffer, providerAttempt) {
    if (!buffer || !providerAttempt?.provider_attempt_id ||
        buffer.provider_attempt_id !== providerAttempt.provider_attempt_id) return false;
    for (const field of ["logical_execution_id", "execution_id"]) {
      if (providerAttempt[field] != null && buffer[field] !== providerAttempt[field]) return false;
    }
    return providerAttempt.command_index == null ||
      Number(buffer.command_index) === Number(providerAttempt.command_index);
  }

  function resultKeyPolicy(key) {
    // Canonicalize candidate field names only. Business text/report bytes and
    // retained JSON property names must not be normalized or rewritten.
    const decoded = String(key).replace(/\\u(?:\{([a-f0-9]{1,6})\}|([a-f0-9]{4}))/giu,
      (literal, wide, narrow) => {
        const code = parseInt(wide || narrow, 16);
        return code <= 0x10ffff ? String.fromCodePoint(code) : literal;
      });
    const canonical = decoded.normalize("NFKC")
      .replace(/[\s_\-\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, "").toLowerCase();
    // Only established credential field forms may be removed. A suffix such
    // as continuation_token may instead be business data; without a provider
    // response contract we cannot silently drop it and call the result whole.
    if (/^(?:proxyauthorization|authorization|accesstoken|apikey|clientsecret|storagestate|(?:password|passwd|passphrase|pwd)(?:hash|digest|value)?|(?:privatekey|secretkey)(?:pem|der|pkcs8|pkcs1|bytes|base64|hex|value)?|refreshtokens?|sessiontoken|sessionkey|secret|token|cookies?|setcookie|jwt)$/u.test(canonical)) {
      return "credential";
    }
    const ambiguous = ["authorization", "accesstoken", "apikey", "clientsecret", "storagestate"]
      .some((part) => canonical.includes(part)) ||
      /(?:(?:password|passwd|passphrase|pwd)(?:hash|digest|value)?|(?:privatekey|secretkey)(?:pem|der|pkcs8|pkcs1|bytes|base64|hex|value)?|refreshtokens?|sessionkey|secret|token|cookies?|setcookie|jwt)$/u.test(canonical);
    return ambiguous ? "ambiguous" : "safe";
  }

  function sensitiveResultKey(key) {
    return resultKeyPolicy(key) !== "safe";
  }

  function hasCurrentSanitizationPolicy(buffer) {
    return buffer?.schema_version === SCHEMA_VERSION &&
      buffer.integrity?.version === BUFFER_INTEGRITY_VERSION &&
      buffer.integrity?.sanitization_policy === SANITIZATION_POLICY;
  }

  function collectDeniedScalars(value, output, visited = new WeakSet()) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
      const scalar = String(value);
      if (scalar) output.add(scalar);
      return;
    }
    if (!value || typeof value !== "object" || visited.has(value)) return;
    // This set only scans a removed branch for report contamination. It never
    // constructs retained JSON and therefore cannot remove repeated aliases.
    visited.add(value);
    for (const child of Object.values(value)) collectDeniedScalars(child, output, visited);
  }

  function sanitize(value) {
    const deniedScalars = new Set();
    // Native JSON serialization tracks the active ancestor chain, preserves
    // repeated references, array positions/null slots and toJSON semantics,
    // and rejects actual cycles/BigInt instead of silently reducing data.
    const serialized = JSON.stringify(value, (key, item) => {
      const policy = resultKeyPolicy(key);
      if (policy === "safe") return item;
      if (policy === "ambiguous") throw new Error("RESULT_BUFFER_AMBIGUOUS_RESULT_KEY");
      collectDeniedScalars(item, deniedScalars);
      return undefined;
    });
    if (typeof serialized !== "string") throw new TypeError("RESULT_BUFFER_PAYLOAD_INVALID");
    // JSON.parse preserves an own __proto__ field without prototype mutation.
    return { payload: JSON.parse(serialized), deniedScalars };
  }

  function hasSensitiveResult(value, visited = new WeakSet()) {
    if (!value || typeof value !== "object" || visited.has(value)) return false;
    visited.add(value);
    try {
      for (const key of Object.keys(value)) {
        if (sensitiveResultKey(key) || hasSensitiveResult(value[key], visited)) return true;
      }
      return false;
    } catch (_) { return true; }
  }

  function bufferId(input = {}) {
    return text(input.result_buffer_id || input.buffer_id) ||
      `${text(input.logical_execution_id, 240) || "execution"}:${text(input.provider_attempt_id, 240) || "attempt"}`;
  }

  async function createBuffer(input = {}, now = Date.now()) {
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
      payload: null,
      delivery_outcome: input.delivery_outcome || DELIVERY_OUTCOMES.NOT_ATTEMPTED,
      provider_replay_forbidden: true,
    };
    const reportText = input.report_text;
    if (typeof reportText !== "string") return unavailable(base, "RESULT_BUFFER_REPORT_TEXT_INVALID");
    let payload;
    try {
      const sanitized = sanitize({
      ok: input.ok === true,
      request_id: text(input.request_id, 240),
      operation: text(input.operation, 160),
      http_status: number(input.http_status, 0),
      external_request_executed: input.external_request_executed !== false,
      executed_command_fingerprint: text(input.executed_command_fingerprint, 160),
      // report_text is business data: retain the exact supplied string, including
      // empty values, whitespace, line endings, and all Unicode code units.
      report_text: reportText,
      result: input.result,
      });
      // Never redact or truncate a useful report. If a credential removed
      // from structured data is also present verbatim in that report, the
      // complete result is unavailable, with both replay prohibitions kept.
      // This is not a claim to classify arbitrary unstructured business text.
      for (const scalar of sanitized.deniedScalars) {
        if (reportText.includes(scalar)) return unavailable(base, "RESULT_BUFFER_SENSITIVE_REPORT");
      }
      payload = sanitized.payload;
    } catch (error) {
      return unavailable(base, error?.message === "RESULT_BUFFER_AMBIGUOUS_RESULT_KEY"
        ? "RESULT_BUFFER_AMBIGUOUS_RESULT_KEY" : "RESULT_BUFFER_PAYLOAD_INVALID");
    }
    base.payload = payload;

    let serializedPayload;
    let payloadByteLength;
    try {
      const serialized = serializedBytes(payload);
      serializedPayload = serialized.serialized;
      payloadByteLength = serialized.byteLength;
    } catch (_) {
      return unavailable(base, "RESULT_BUFFER_PAYLOAD_INVALID");
    }
    if (payloadByteLength > MAX_BUFFER_BYTES) return unavailable(base, "RESULT_BUFFER_TOO_LARGE");

    try {
      base.integrity = {
        version: BUFFER_INTEGRITY_VERSION,
        sanitization_policy: SANITIZATION_POLICY,
        report_text_bytes: encoder().encode(reportText).byteLength,
        report_text_sha256: await sha256Hex(reportText),
        payload_bytes: payloadByteLength,
        payload_sha256: await sha256Hex(serializedPayload),
      };
      if (serializedBytes(base).byteLength > MAX_BUFFER_BYTES) return unavailable(base, "RESULT_BUFFER_TOO_LARGE");
    } catch (_) {
      return unavailable(base, "RESULT_BUFFER_INTEGRITY_UNAVAILABLE");
    }
    return Object.freeze(base);
  }

  async function validateBuffer(buffer) {
    if (!buffer || typeof buffer !== "object") return { valid: false, code: "RESULT_BUFFER_MISSING" };
    if (buffer.phase === RESULT_PHASES.UNAVAILABLE) {
      return { valid: false, code: buffer.unavailable_code || "RESULT_RECOVERY_UNAVAILABLE_NO_REPLAY" };
    }
    if (buffer.phase !== RESULT_PHASES.BUFFERED) return { valid: false, code: "RESULT_BUFFER_INVALID_PHASE" };
    if (Number(buffer.schema_version || 0) < SCHEMA_VERSION || !buffer.integrity) {
      return { valid: false, code: "RESULT_BUFFER_INTEGRITY_UNVERIFIABLE" };
    }
    if (buffer.schema_version !== SCHEMA_VERSION) {
      return { valid: false, code: "RESULT_BUFFER_INTEGRITY_UNSUPPORTED" };
    }
    if (!hasCurrentSanitizationPolicy(buffer)) {
      return { valid: false, code: "RESULT_BUFFER_PROVENANCE_UNVERIFIABLE" };
    }
    if (!buffer.payload || typeof buffer.payload !== "object" || typeof buffer.payload.report_text !== "string") {
      return { valid: false, code: "RESULT_BUFFER_INTEGRITY_MISMATCH" };
    }
    if (hasSensitiveResult(buffer.payload.result)) return { valid: false, code: "RESULT_BUFFER_SENSITIVE_RESULT" };

    try {
      const payload = serializedBytes(buffer.payload);
      const reportByteLength = encoder().encode(buffer.payload.report_text).byteLength;
      const snapshot = serializedBytes(buffer);
      if (payload.byteLength > MAX_BUFFER_BYTES || snapshot.byteLength > MAX_BUFFER_BYTES) {
        return { valid: false, code: "RESULT_BUFFER_TOO_LARGE" };
      }
      if (payload.byteLength !== Number(buffer.integrity.payload_bytes) ||
          reportByteLength !== Number(buffer.integrity.report_text_bytes)) {
        return { valid: false, code: "RESULT_BUFFER_INTEGRITY_MISMATCH" };
      }
      const [reportDigest, payloadDigest] = await Promise.all([
        sha256Hex(buffer.payload.report_text),
        sha256Hex(payload.serialized),
      ]);
      if (reportDigest !== buffer.integrity.report_text_sha256 ||
          payloadDigest !== buffer.integrity.payload_sha256) {
        return { valid: false, code: "RESULT_BUFFER_INTEGRITY_MISMATCH" };
      }
      return {
        valid: true,
        code: "RESULT_BUFFER_INTEGRITY_VALID",
        payload_sha256: payloadDigest,
        report_text_sha256: reportDigest,
        snapshot: snapshot.serialized,
      };
    } catch (_) {
      return { valid: false, code: "RESULT_BUFFER_INTEGRITY_MISMATCH" };
    }
  }

  function matchesValidatedSnapshot(buffer, snapshot) {
    if (!buffer || typeof snapshot !== "string") return false;
    try {
      return JSON.stringify(buffer) === snapshot;
    } catch (_) {
      return false;
    }
  }

  function isLegacyBufferedResult(buffer) {
    return !!buffer && (buffer.schema_version === 1 ||
      (buffer.schema_version === SCHEMA_VERSION && !hasCurrentSanitizationPolicy(buffer))) &&
      buffer.phase === RESULT_PHASES.BUFFERED &&
      buffer.provider_replay_forbidden === true;
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
    if (buffer.phase === RESULT_PHASES.BUFFERED && buffer.schema_version === SCHEMA_VERSION && !hasCurrentSanitizationPolicy(buffer)) {
      return unavailable(buffer, "RESULT_BUFFER_PROVENANCE_UNVERIFIABLE");
    }
    if (buffer.phase === RESULT_PHASES.BUFFERED && hasSensitiveResult(buffer.payload?.result)) {
      return unavailable(buffer, "RESULT_BUFFER_SENSITIVE_RESULT");
    }
    return buffer;
  }

  async function recoveryDecision({ providerAttempt = null, resultBuffer = null, deliveryOutcome = DELIVERY_OUTCOMES.NOT_ATTEMPTED, currentContext = null, finish = false, now = Date.now() } = {}) {
    if (providerAttempt?.state === "OUTCOME_UNKNOWN") return { type: "blocked", code: "PROVIDER_OUTCOME_UNKNOWN_NO_RETRY" };
    if (finish === true) return { type: "blocked", code: "STALE_DELIVERY_CONTEXT" };
    const buffer = normalize(resultBuffer, now);
    if (!buffer || buffer.phase === RESULT_PHASES.NONE) return { type: "blocked", code: "RESULT_RECOVERY_UNAVAILABLE_NO_REPLAY" };
    if (buffer.phase === RESULT_PHASES.EXPIRED) return { type: "blocked", code: "RESULT_BUFFER_EXPIRED" };
    if (buffer.phase === RESULT_PHASES.UNAVAILABLE) return { type: "blocked", code: buffer.unavailable_code || "RESULT_RECOVERY_UNAVAILABLE_NO_REPLAY" };
    if (currentContext && !sameContext(buffer.context, currentContext)) return { type: "blocked", code: "STALE_DELIVERY_CONTEXT" };
    if ([DELIVERY_OUTCOMES.COMMITTED, DELIVERY_OUTCOMES.UNKNOWN].includes(deliveryOutcome)) return { type: "blocked", code: "DELIVERY_OUTCOME_UNKNOWN_NO_RETRY" };
    if (deliveryOutcome === DELIVERY_OUTCOMES.CONFIRMED) return { type: "none", code: "DELIVERY_CONFIRMED" };
    if (!sameProviderAttempt(buffer, providerAttempt)) return { type: "blocked", code: "RESULT_BUFFER_ATTEMPT_MISMATCH" };
    const integrity = await validateBuffer(buffer);
    if (!integrity.valid) return { type: "blocked", code: integrity.code };
    return {
      type: "resume_local_result",
      code: "KNOWN_RESULT_RECOVERY_SAFE",
      provider_calls: 0,
      integrity_snapshot: integrity.snapshot,
      integrity_payload_sha256: integrity.payload_sha256,
      integrity_report_text_sha256: integrity.report_text_sha256,
    };
  }

  function compact(buffer, now = Date.now()) {
    if (!buffer) return null;
    if (number(buffer.expires_at_ms, 0) <= now) return expire(buffer, now);
    return normalize(buffer, now);
  }

  globalThis.SellerAgentsResultRecovery = Object.freeze({
    SCHEMA_VERSION,
    TECHNICAL_RETENTION_MS,
    MAX_BUFFER_BYTES,
    RESULT_PHASES,
    DELIVERY_OUTCOMES,
    contextOf,
    sameContext,
    sameProviderAttempt,
    createBuffer,
    validateBuffer,
    matchesValidatedSnapshot,
    isLegacyBufferedResult,
    normalize,
    expire,
    compact,
    recoveryDecision,
  });
})();
