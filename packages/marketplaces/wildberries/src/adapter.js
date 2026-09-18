(() => {
  "use strict";
  const { contract: C, credentials: Credentials, transport, guidance } = globalThis.SellerAgentsWBReference;
  const fail = (code) => { throw Object.assign(new Error(code), { code, external_request_executed: false }); };
  const codeOf = (error) => /^[A-Z0-9_]{1,100}$/.test(error?.code || "") ? error.code : "WB_BRIDGE_ERROR";
  const known = (operation) => Object.hasOwn(C.OPERATIONS, operation || "") ? operation : null;
  async function hash(value) {
    return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
      .map((x) => x.toString(16).padStart(2, "0")).join("");
  }
  async function credentialRevision(raw) {
    const value = Credentials.normalizeSellerCredentials(raw, { required: true });
    return hash(JSON.stringify(["seller-agents-wb-personal", value.token]));
  }
  async function createContext({ snapshot, readCurrent, credentials }) {
    const guard = globalThis.SellerAgentsExecutionContext.createGuard(snapshot, readCurrent);
    const saved = Credentials.normalizeSellerCredentials(structuredClone(credentials), { required: true });
    if (guard.snapshot.marketplace !== "wildberries") fail("MARKETPLACE_CONTEXT_MISMATCH");
    // Store credentialRevision is an opaque local fencing value. The execution
    // guard below compares that value with the current pinned store context;
    // never derive a server-visible revision from the credential secret. The
    // legacy adapter fixture format remains accepted only for old local
    // snapshots that explicitly carry the historical 64-hex revision.
    if (/^[0-9a-f]{64}$/.test(String(guard.snapshot.credentialRevision || "")) &&
        await credentialRevision(saved) !== guard.snapshot.credentialRevision)
      throw globalThis.SellerAgentsExecutionContext.error();
    await guard.assertCurrent();
    return Object.freeze({ ...guard, async credentials() { await guard.assertCurrent(); return saved; } });
  }
  function assertPolicy(command, context) {
    const meta = C.resolveOperation(command.operation);
    if (meta.privacy !== "standard" && context.snapshot.policyRevision !== "personal-enabled")
      fail("PERSONAL_DATA_DISABLED");
    C.preflightExecution(command);
    return meta;
  }
  function localError(error, operation = null, attempted = false, httpStatus = 0) {
    const code = codeOf(error);
    return { ok: false, bridge_error: true, external_request_executed: attempted,
      http_status: httpStatus, error: { code, message: code },
      report_text: "WB_RESULT_V1\n" + JSON.stringify({ operation: known(operation),
        provider: "wildberries", external_request_executed: attempted,
        physical_request_count: attempted ? 1 : 0, http_status: httpStatus,
        error: { code, automatic_retry: false }, result_omitted: true }) };
  }
  function parseHelp(text) {
    if (!text.startsWith("WB_HELP_V1")) return guidance.parseHelp(text);
    let raw;
    try { raw = JSON.parse(text.slice("WB_HELP_V1".length)); }
    catch { return { ok: false, code: "HELP_INVALID_JSON" }; }
    if (!raw || !Object.hasOwn(raw, "operation")) return guidance.parseHelp(text);
    try {
      if (Object.keys(raw).some((key) => !["operation", "params"].includes(key)) ||
        !raw.params || typeof raw.params !== "object" || Array.isArray(raw.params)) fail("HELP_UNKNOWN_FIELD");
      const allowed = raw.operation === "catalog" ? ["family", "offset", "limit"] :
        raw.operation === "describe" ? ["alias"] : null;
      if (!allowed || Object.keys(raw.params).some((key) => !allowed.includes(key))) fail("HELP_UNKNOWN_PARAM");
      const p = raw.params;
      if (raw.operation === "describe" && (typeof p.alias !== "string" || !/^[a-z0-9_]{1,120}$/.test(p.alias))) fail("HELP_INVALID_ALIAS");
      if (raw.operation === "catalog") {
        if (p.family !== undefined && !Object.hasOwn(C.HOSTS, p.family)) fail("HELP_UNKNOWN_FAMILY");
        if (!Number.isSafeInteger(p.offset ?? 0) || (p.offset ?? 0) < 0 ||
          !Number.isSafeInteger(p.limit ?? 25) || (p.limit ?? 25) < 1 || (p.limit ?? 25) > 50) fail("HELP_INVALID_PAGE");
      }
      return { ok: true, legacy: raw };
    } catch (error) { return { ok: false, code: codeOf(error) }; }
  }
  function discover(source) {
    const text = String(source || "");
    if (text.length > 262144) fail("COMMAND_SOURCE_TOO_LARGE");
    // Local file/recovery commands belong to application delivery, not the API adapter.
    // Reject them explicitly here; never silently drop them from an accepted block.
    if (/\bWB_FILE_V1\b/.test(text)) fail("LOCAL_FILE_APPLICATION_ROUTE_REQUIRED");
    if (/\bOZON_(?:API|HELP)_V[12]\b/.test(text)) fail("MIXED_MARKETPLACE_BLOCK");
    const rows = globalThis.SellerAgentsMixedBatchDiscovery.discover(text, {
      commandPrefix: "WB_API_V1", helpPrefixV1: "WB_HELP_V1", helpPrefixV2: "WB_HELP_V2",
      apiDiscover(commandText) {
        try {
          const command = C.parseCommand(commandText);
          C.buildRequest(command); // Serialization failures are local per-item results.
          return [{ ok: true, marker_index: 0, command, command_text: commandText }];
        } catch (error) { return [{ ok: false, marker_index: 0, code: codeOf(error) }]; }
      },
      parseHelp,
    });
    if (!rows.length) fail("NO_COMMAND_ENVELOPES");
    if (rows.length > 32) fail("TOO_MANY_COMMANDS");
    return rows.map((row, index) => {
      const item = row.kind === "api" ? row.discovery : row.help;
      if (!item.ok) return { index, kind: "pre_execution_error", status: "pending", error: { code: item.code } };
      if (row.kind === "help") return { index, kind: "guidance", status: "pending", guidance: item };
      return { index, kind: "command", status: "pending", command: item.command,
        operation: item.command.operation, command_text: item.command_text,
        command_fingerprint: C.commandFingerprint(item.command) };
    });
  }
  function localResult(entry) {
    if (entry.kind !== "guidance") return localError(entry.error);
    if (entry.guidance.legacy) {
      const { operation, params } = entry.guidance.legacy;
      const aliases = Object.keys(C.OPERATIONS).sort().filter((alias) => !params.family || C.OPERATIONS[alias].host === params.family);
      const card = (alias) => known(alias) ? { operation: alias, ...C.OPERATIONS[alias],
        authority: "PINNED_WB_REGISTRY_NOT_LIVE_ACCOUNT_PROOF" } : { operation: null, known: false };
      const offset = params.offset ?? 0, limit = params.limit ?? 25;
      const payload = operation === "describe" ? { operation_card: card(params.alias) } :
        { total: aliases.length, offset, limit, operations: aliases.slice(offset, offset + limit).map(card),
          next_offset: offset + limit < aliases.length ? offset + limit : null };
      return { ok: true, external_request_executed: false, http_status: 0,
        report_text: "WB_GUIDANCE_RESULT_V1\n" + JSON.stringify({ ...payload, local: true, physical_request_count: 0 }) };
    }
    const payload = guidance.result({ ...entry.guidance, status: "operations" });
    return { ok: true, external_request_executed: false, http_status: 0,
      report_text: guidance.format(payload) };
  }
  function safeTree(value, depth = 0, budget = { count: 0 }) {
    if (depth > 64) fail("RESPONSE_DEPTH_EXCEEDED");
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (++budget.count > 300000) fail("RESPONSE_KEY_LIMIT");
      if (["__proto__", "constructor", "prototype"].includes(key)) fail("UNSAFE_RESPONSE_KEY");
      safeTree(child, depth + 1, budget);
    }
  }
  function redactSecrets(value, secrets, seen = new WeakSet()) {
    if (typeof value === "string") {
      return secrets.reduce((text, secret) => secret ? text.split(secret).join("[REDACTED_CREDENTIAL]") : text, value);
    }
    if (!value || typeof value !== "object") return value;
    if (seen.has(value)) return undefined;
    seen.add(value);
    if (Array.isArray(value)) return value.map((item) => redactSecrets(item, secrets, seen));
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redactSecrets(child, secrets, seen)]));
  }
  function originalName(response) {
    const header = response?.headers?.get?.("content-disposition") || "";
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
    const plain = /filename="([^"]+)"|filename=([^;]+)/i.exec(header);
    let name = encoded?.[1] || plain?.[1] || plain?.[2] || "";
    if (encoded) { try { name = decodeURIComponent(name); } catch { return null; } }
    return name && name.length <= 240 && !/[\x00-\x1f\x7f/\\]/.test(name) && !/^\.+$/.test(name)
      ? name : null;
  }
  function createProvider({ fetchImpl = globalThis.fetch, timeoutMs = 30000, maxBytes = 3000000,
    maxBinaryBytes = 12000000, uuid = () => crypto.randomUUID() } = {}) {
    async function execute(commandText, { context, executionCommand = null, onProviderResponse = null, onProviderResult = null } = {}) {
      if (!context?.snapshot || typeof context.credentials !== "function") fail("EXECUTION_CONTEXT_MISSING");
      let attempted = false, httpStatus = 0, command, filename = null;
      try {
        await context.assertCurrent();
        if (context.snapshot.marketplace !== "wildberries") fail("MARKETPLACE_CONTEXT_MISMATCH");
        command = C.parseCommand(commandText);
        if (executionCommand && JSON.stringify(executionCommand) !== JSON.stringify(command))
          fail("WB_COMMAND_TRANSFORMATION_FORBIDDEN");
        const meta = assertPolicy(command, context), saved = await context.credentials();
        const request = C.buildRequest(command, Credentials.sellerHeaders(saved,
          { hasBody: meta.method === "POST" && command.body !== undefined }));
        const guardedFetch = async (url, init) => {
          if (typeof context.assertDispatchAuthority === "function")
            await context.assertDispatchAuthority();
          await context.assertCurrent(); // Last awaited step before actual fetch.
          if (attempted) fail("HIDDEN_PROVIDER_REQUEST_FORBIDDEN");
          attempted = true;
          const response = await fetchImpl(url, { ...init, credentials: "omit" });
          httpStatus = Number(response.status || 0);
          filename = originalName(response);
          return response;
        };
        const binary = request.response_mode === "binary";
        const response = await (binary ? transport.executeBinaryOnce : transport.executeJsonOnce)({
          fetchImpl: guardedFetch, request, timeoutMs, maxBytes: binary ? maxBinaryBytes : maxBytes });
        if (typeof onProviderResponse === "function")
          await onProviderResponse({ command, request, response });
        await context.assertCurrent();
        let result;
        if (!response.ok) result = { error: { code: "WB_API_ERROR", http_status: response.httpStatus, automatic_retry: false } };
        else if (binary) result = { content_base64: response.binaryBase64, byte_length: response.byteLength,
          content_type: response.responseMeta?.content_type || "application/octet-stream",
          original_filename: filename, delivery_status: "BYTES_RECEIVED_NOT_DELIVERED" };
        else {
          const declaredJson = /(?:^|[+/])json(?:;|$)/i.test(response.responseMeta?.content_type || "");
          if (declaredJson && !(response.rawText.trim() === "" && [204, 205].includes(response.httpStatus))) {
            try { result = JSON.parse(response.rawText); } catch { fail("PROVIDER_JSON_INVALID"); }
          } else result = response.parsed ?? response.rawText;
          safeTree(result);
          result = redactSecrets(C.sanitizeResult(command, result), [saved.token]);
        }
        const requestId = String(uuid());
        let report = C.formatResultReport({ requestId, command, httpStatus: response.httpStatus,
          requestMeta: { host_alias: request.host_alias, http_method: request.method, path_alias: command.operation },
          result, elapsedMs: response.elapsedMs, rateLimit: { retry_after: response.responseMeta?.retry_after || null } });
        // Never allow an echoed exact credential into a JSON/text result or diagnostics.
        if (!binary) report = report.split(saved.token).join("[REDACTED_CREDENTIAL]");
        const providerResult = { ok: response.ok, request_id: requestId, http_status: response.httpStatus,
          external_request_executed: true, report_text: report,
          result,
          executed_command_fingerprint: C.commandFingerprint(command),
          response_meta: { retry_after: response.responseMeta?.retry_after || null },
          verification: binary ? "BINARY_BYTES_CAPTURED" : "STRUCTURAL_ONLY_WB_SCHEMA_PENDING" };
        if (typeof onProviderResult === "function") await onProviderResult({ command, result, report_text: report, provider_result: providerResult });
        return providerResult;
      } catch (error) {
        if (error.execution_context_error) throw error;
        // The frozen transport normalizes fetch exceptions; recheck the guard so
        // cancellation cannot be downgraded to an ordinary provider error.
        await context.assertCurrent();
        return localError(error, command?.operation, attempted, httpStatus);
      }
    }
    return Object.freeze({ execute });
  }
  globalThis.SellerAgentsWBAdapter = Object.freeze({ hash, credentialRevision, createContext,
    discover, localResult, localError, assertPolicy, createProvider,
    operation: (command) => C.resolveOperation(command.operation) });
})();
