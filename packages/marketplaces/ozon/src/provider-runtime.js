(() => {
  "use strict";

  function findFirstField(value, keyName, depth = 0) {
    if (depth > 8 || value === null || value === undefined) return null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findFirstField(item, keyName, depth + 1);
        if (found !== null && found !== undefined) return found;
      }
      return null;
    }
    if (typeof value !== "object") return null;
    for (const [key, child] of Object.entries(value)) {
      if (String(key).toLowerCase() === String(keyName).toLowerCase())
        return child;
      const found = findFirstField(child, keyName, depth + 1);
      if (found !== null && found !== undefined) return found;
    }
    return null;
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

  function arrayCountForField(value, field) {
    const found = findFirstField(value, field);
    return Array.isArray(found) ? found.length : null;
  }

  function safeQuotaRateMeta(quota, retryAfter = null) {
    const source = quota && typeof quota === "object" ? quota : {};
    const output = {};
    if (source.family)
      output.quota_family = String(source.family).slice(0, 120);
    if (Number.isFinite(Number(source.min_interval_ms)))
      output.min_interval_ms = Math.max(0, Number(source.min_interval_ms || 0));
    if (Number.isFinite(Number(source.dispatched_at)))
      output.last_provider_request_at = Number(source.dispatched_at);
    if (Number.isFinite(Number(source.next_allowed_at)))
      output.next_allowed_at = Number(source.next_allowed_at);
    if (retryAfter) output.retry_after = String(retryAfter).slice(0, 160);
    output.automatic_retry = false;
    return Object.keys(output).length > 1 ? Object.freeze(output) : null;
  }

  const REPORT_FILE_REF_TTL_MS = 30 * 60 * 1000;
  const REPORT_FILE_REF_MAX = 128;
  const REPORT_CODE_POLICY_MAX = 256;
  const REPORT_SESSION_SCHEMA_VERSION = 1;
  const REPORT_SESSION_STATE_KEY =
    globalThis.OzonRuntime?.STORAGE_KEYS?.REPORT_FILE_SESSION_STATE ||
    "ozmb_report_file_session_state_v1";
  let fallbackReportSessionState = null;
  let reportSessionWriteLock = Promise.resolve();

  function cloneJson(value) {
    if (value === null || value === undefined) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function defaultReportStateStore() {
    const storage = globalThis.chrome?.storage?.session;
    if (
      storage &&
      typeof storage.get === "function" &&
      typeof storage.set === "function"
    ) {
      return Object.freeze({
        async get() {
          const data = await storage.get(REPORT_SESSION_STATE_KEY);
          return data?.[REPORT_SESSION_STATE_KEY] ?? null;
        },
        async set(value) {
          await storage.set({ [REPORT_SESSION_STATE_KEY]: value });
        },
      });
    }
    return Object.freeze({
      async get() {
        return cloneJson(fallbackReportSessionState);
      },
      async set(value) {
        fallbackReportSessionState = cloneJson(value);
      },
    });
  }

  function withReportSessionWrite(fn) {
    const next = reportSessionWriteLock.then(fn, fn);
    reportSessionWriteLock = next.catch(() => null);
    return next;
  }

  function emptyReportSessionState() {
    return {
      schema_version: REPORT_SESSION_SCHEMA_VERSION,
      report_code_policies: {},
      report_file_refs: {},
    };
  }

  function boundedNewestEntries(entries, max) {
    const sorted = entries.sort(
      (a, b) =>
        Number(a[1]?.created_at_ms || 0) - Number(b[1]?.created_at_ms || 0),
    );
    return sorted.slice(Math.max(0, sorted.length - max));
  }

  function normalizeReportSessionState(raw, currentMs) {
    const current = Number(currentMs);
    if (
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw) ||
      Number(raw.schema_version) !== REPORT_SESSION_SCHEMA_VERSION
    )
      return emptyReportSessionState();
    const codePolicies = [];
    const rawCodePolicies =
      raw.report_code_policies &&
      typeof raw.report_code_policies === "object" &&
      !Array.isArray(raw.report_code_policies)
        ? raw.report_code_policies
        : {};
    for (const [rawCode, rawRecord] of Object.entries(rawCodePolicies)) {
      const code = String(rawCode || "").trim();
      if (
        !/^REPORT_/i.test(code) ||
        !rawRecord ||
        typeof rawRecord !== "object" ||
        Array.isArray(rawRecord)
      )
        continue;
      if (typeof rawRecord.personal_data_required !== "boolean") continue;
      const createdAt = Number(rawRecord.created_at_ms || 0);
      if (
        !Number.isFinite(createdAt) ||
        createdAt <= 0 ||
        createdAt > current ||
        current - createdAt > REPORT_FILE_REF_TTL_MS
      )
        continue;
      codePolicies.push([
        code,
        {
          personal_data_required: rawRecord.personal_data_required === true,
          created_at_ms: createdAt,
        },
      ]);
    }

    const fileRefs = [];
    const rawFileRefs =
      raw.report_file_refs &&
      typeof raw.report_file_refs === "object" &&
      !Array.isArray(raw.report_file_refs)
        ? raw.report_file_refs
        : {};
    for (const [rawRef, rawRecord] of Object.entries(rawFileRefs)) {
      const ref = String(rawRef || "").trim();
      if (
        !/^rpf_[sp]_[A-Za-z0-9_-]+$/.test(ref) ||
        !rawRecord ||
        typeof rawRecord !== "object" ||
        Array.isArray(rawRecord)
      )
        continue;
      if (typeof rawRecord.personal_data_required !== "boolean") continue;
      const createdAt = Number(rawRecord.created_at_ms || 0);
      if (
        !Number.isFinite(createdAt) ||
        createdAt <= 0 ||
        createdAt > current ||
        current - createdAt > REPORT_FILE_REF_TTL_MS
      )
        continue;
      const personalDataRequired = rawRecord.personal_data_required === true;
      const expectedMarker = personalDataRequired ? "p" : "s";
      if (!ref.startsWith(`rpf_${expectedMarker}_`)) continue;
      if (typeof rawRecord.url === "string" && rawRecord.url.trim()) {
        try {
          const trustedUrl =
            globalThis.ProviderTransportCore.normalizeTrustedReportFileUrl(
              rawRecord.url.trim(),
            );
          fileRefs.push([
            ref,
            {
              url: trustedUrl,
              personal_data_required: personalDataRequired,
              created_at_ms: createdAt,
            },
          ]);
        } catch (_) {}
        continue;
      }
      const inlineBase64 =
        typeof rawRecord.inline_base64 === "string"
          ? rawRecord.inline_base64
          : "";
      const contentType = String(rawRecord.content_type || "").toLowerCase();
      if (inlineBase64 && contentType === "application/pdf") {
        const byteLength = Math.max(0, Number(rawRecord.byte_length || 0));
        if (!Number.isFinite(byteLength)) continue;
        fileRefs.push([
          ref,
          {
            inline_base64: inlineBase64,
            content_type: contentType,
            byte_length: byteLength,
            personal_data_required: personalDataRequired,
            created_at_ms: createdAt,
          },
        ]);
      }
    }

    return {
      schema_version: REPORT_SESSION_SCHEMA_VERSION,
      report_code_policies: Object.fromEntries(
        boundedNewestEntries(codePolicies, REPORT_CODE_POLICY_MAX),
      ),
      report_file_refs: Object.fromEntries(
        boundedNewestEntries(fileRefs, REPORT_FILE_REF_MAX),
      ),
    };
  }

  function reportStateError(
    code,
    message,
    { externalRequestExecuted = false } = {},
  ) {
    const error = new Error(message);
    error.code = code;
    error.external_request_executed = externalRequestExecuted === true;
    return error;
  }

  function createOzonProvider({
    contract = globalThis.OzonContract,
    fetchImpl = globalThis.fetch,
    uuid = () => globalThis.crypto.randomUUID(),
    now = () => Date.now(),
    reportStateStore = defaultReportStateStore(),
  } = {}) {
    let performanceToken = null;
    let performanceTokenIdentity = null;
    const guardedFetch = (guard) =>
      guard
        ? async (url, init) => {
            if (typeof guard.assertDispatchAuthority === "function")
              await guard.assertDispatchAuthority();
            await guard.assertCurrent();
            return fetchImpl(url, init);
          }
        : fetchImpl;

    async function readReportSessionState({
      externalRequestExecuted = false,
    } = {}) {
      try {
        const raw = await reportStateStore.get();
        return normalizeReportSessionState(raw, Number(now()));
      } catch (error) {
        throw reportStateError(
          "REPORT_FILE_SESSION_STATE_READ_FAILED",
          `Не удалось прочитать session-state отчётов: ${String(error?.message || error || "unknown error").slice(0, 240)}`,
          { externalRequestExecuted },
        );
      }
    }

    async function mutateReportSessionState(
      mutator,
      { externalRequestExecuted = true } = {},
    ) {
      return withReportSessionWrite(async () => {
        const current = await readReportSessionState({
          externalRequestExecuted,
        });
        const mutable = {
          schema_version: REPORT_SESSION_SCHEMA_VERSION,
          report_code_policies: { ...current.report_code_policies },
          report_file_refs: { ...current.report_file_refs },
        };
        const output = await mutator(mutable);
        const normalized = normalizeReportSessionState(mutable, Number(now()));
        try {
          await reportStateStore.set(normalized);
        } catch (error) {
          throw reportStateError(
            "REPORT_FILE_SESSION_STATE_WRITE_FAILED",
            `Не удалось сохранить session-state отчётов: ${String(error?.message || error || "unknown error").slice(0, 240)}`,
            { externalRequestExecuted },
          );
        }
        return output;
      });
    }

    function operationRequiresPersonalData(operation) {
      const meta =
        globalThis.OzonOperationRegistry?.operation?.(operation) || null;
      return meta?.policy_group === "personal_data_read";
    }

    async function rememberReportCodePolicy(rawCode, operation) {
      const code = String(rawCode || "").trim();
      if (!/^REPORT_/i.test(code)) return;
      await mutateReportSessionState((state) => {
        state.report_code_policies[code] = {
          personal_data_required: operationRequiresPersonalData(operation),
          created_at_ms: Number(now()),
        };
      });
    }

    async function reportInfoPersonalDataRequired(command) {
      const code = String(command?.params?.code || "").trim();
      const state = await readReportSessionState({
        externalRequestExecuted: true,
      });
      const remembered = state.report_code_policies[code];
      return remembered ? remembered.personal_data_required === true : true;
    }

    function createReportFileRef(personalDataRequired) {
      const token = String(uuid()).replace(/[^A-Za-z0-9_-]/g, "");
      const marker = personalDataRequired === true ? "p" : "s";
      return `rpf_${marker}_${token}`;
    }

    async function registerReportFile(
      rawUrl,
      { personalDataRequired = true } = {},
    ) {
      const trustedUrl =
        globalThis.ProviderTransportCore.normalizeTrustedReportFileUrl(rawUrl);
      const ref = createReportFileRef(personalDataRequired);
      await mutateReportSessionState((state) => {
        state.report_file_refs[ref] = {
          url: trustedUrl,
          personal_data_required: personalDataRequired === true,
          created_at_ms: Number(now()),
        };
      });
      return ref;
    }

    function reportFileRefPolicy(ref) {
      const value = String(ref || "").trim();
      if (/^rpf_s_[A-Za-z0-9_-]+$/.test(value))
        return Object.freeze({ known: true, personal_data_required: false });
      if (/^rpf_p_[A-Za-z0-9_-]+$/.test(value))
        return Object.freeze({ known: true, personal_data_required: true });
      return Object.freeze({ known: false, personal_data_required: false });
    }

    async function resolveReportFileRef(ref) {
      const value = String(ref || "").trim();
      const state = await readReportSessionState({
        externalRequestExecuted: false,
      });
      const record = state.report_file_refs[value];
      if (!record) {
        throw reportStateError(
          "REPORT_FILE_REF_NOT_FOUND",
          "Report file ref неизвестен или истёк. Повторите report_info отдельной командой.",
          { externalRequestExecuted: false },
        );
      }
      return record;
    }

    async function executeReportFileCommand(command, executionGuard = null, onProviderResponse = null) {
      const record = await resolveReportFileRef(command.params.file_ref);
      if (record.inline_base64) {
        const started = Number(now());
        const bytes = globalThis.ProviderTransportCore.reportBase64ToBytes(
          record.inline_base64,
        );
        const parsedDocument =
          await globalThis.ProviderTransportCore.parseAiReadableReportBytes(
            bytes,
            {
              contentType: record.content_type || "application/pdf",
              pathname: "/inline-document.pdf",
              sheet: command.params.sheet ?? null,
              offset: Number(command.params.offset || 0),
              limit: Number(command.params.limit || 200),
            },
          );
        const response = Object.freeze({
          httpStatus: 200,
          ok: true,
          rawText: "",
          parsed: Object.freeze({
            content_type: record.content_type || "application/pdf",
            byte_length: bytes.byteLength,
            ...parsedDocument,
          }),
          byteLength: bytes.byteLength,
          elapsedMs: Math.max(0, Number(now()) - started),
          responseMeta: Object.freeze({
            content_type: record.content_type || "application/pdf",
            content_length: String(bytes.byteLength),
            request_id: null,
            retry_after: null,
          }),
        });
        const request = Object.freeze({
          method: "GET",
          host_alias: "report_file",
          path: "/__opaque_inline_document__",
          operation: "report_file_get",
          response_style: "binary",
          response_content_types: null,
          external_request_executed: false,
        });
        return { request, response, auth_request_performed: false };
      }
      const response =
        await globalThis.ProviderTransportCore.executeTrustedReportFileOnce({
          fetchImpl: guardedFetch(executionGuard),
          url: record.url,
          now,
          parseOptions: command.params,
        });
      const request = Object.freeze({
        method: "GET",
        host_alias: "report_file",
        path: "/__opaque_report_file__",
        operation: "report_file_get",
        response_style: "binary",
        response_content_types: null,
        external_request_executed: true,
      });
      if (typeof onProviderResponse === "function")
        await onProviderResponse({ command, request, response });
      return { request, response, auth_request_performed: false };
    }

    const GENERATED_DOCUMENT_URL_FIELD_BY_OPERATION = Object.freeze({
      cargoes_label_get: "file_url",
      cargoes_label_transport_by_order_status: "file_url",
      cargoes_label_transport_status: "file_url",
      fbp_act_from_get: "cdn_url",
      fbp_act_to_get: "label_url",
      fbp_label_get: "label_url",
      posting_fbs_package_label_get_v1: "file_url",
    });
    const DIRECT_PDF_OPERATIONS = new Set([
      "posting_fbs_act_container_labels",
      "posting_fbs_package_label",
    ]);

    async function registerInlineGeneratedDocument(
      binaryPayload,
      { personalDataRequired = true } = {},
    ) {
      const contentType = String(
        binaryPayload?.content_type || "application/octet-stream",
      ).toLowerCase();
      const base64 = String(binaryPayload?.file_content_base64 || "");
      if (!base64 || contentType !== "application/pdf") return null;
      const ref = createReportFileRef(personalDataRequired);
      await mutateReportSessionState((state) => {
        state.report_file_refs[ref] = {
          inline_base64: base64,
          content_type: contentType,
          byte_length: Number(binaryPayload?.byte_length || 0),
          personal_data_required: personalDataRequired === true,
          created_at_ms: Number(now()),
        };
      });
      return ref;
    }

    function clearPerformanceToken() {
      performanceToken = null;
    }

    async function getPerformanceToken(
      rawPerformanceCredentials,
      { force = false, executionGuard = null } = {},
    ) {
      const credentials =
        globalThis.OzonCredentials.normalizePerformanceCredentials(
          rawPerformanceCredentials,
          { required: true },
        );
      const identity = JSON.stringify([
        credentials.clientId,
        credentials.clientSecret,
      ]);
      const current = Number(now());
      if (
        !force &&
        performanceTokenIdentity === identity &&
        performanceToken?.access_token &&
        current < Number(performanceToken.expires_at_ms || 0) - 30_000
      ) {
        return Object.freeze({
          access_token: performanceToken.access_token,
          expires_at_ms: performanceToken.expires_at_ms,
          auth_request_performed: false,
          http_status: 0,
        });
      }

      const tokenRequest =
        globalThis.OzonCredentials.performanceTokenRequest(credentials);
      const response =
        await globalThis.ProviderTransportCore.executePerformanceJsonOnce({
          fetchImpl: guardedFetch(executionGuard),
          request: tokenRequest,
          now,
        });
      if (!response.ok) {
        clearPerformanceToken();
        const error = new Error(
          `Ozon Performance auth отклонён: HTTP ${response.httpStatus}.`,
        );
        error.code = "PERFORMANCE_AUTH_FAILED";
        error.http_status = response.httpStatus;
        throw error;
      }
      const payload =
        response.parsed && typeof response.parsed === "object"
          ? response.parsed
          : {};
      const accessToken = String(payload.access_token || "").trim();
      const tokenType = String(payload.token_type || "Bearer").trim();
      const expiresIn = Number(payload.expires_in || 0);
      if (
        !accessToken ||
        !/^Bearer$/i.test(tokenType) ||
        !Number.isFinite(expiresIn) ||
        expiresIn <= 0
      ) {
        clearPerformanceToken();
        const error = new Error(
          "Ozon Performance auth вернул некорректный token response.",
        );
        error.code = "INVALID_PERFORMANCE_TOKEN_RESPONSE";
        error.http_status = response.httpStatus;
        throw error;
      }
      performanceTokenIdentity = identity;
      performanceToken = Object.freeze({
        access_token: accessToken,
        expires_at_ms: current + Math.max(1, Math.floor(expiresIn)) * 1000,
      });
      return Object.freeze({
        access_token: accessToken,
        expires_at_ms: performanceToken.expires_at_ms,
        auth_request_performed: true,
        http_status: response.httpStatus,
      });
    }

    async function executeSellerCommand(
      command,
      rawCredentials,
      executionGuard = null,
      onProviderResponse = null,
    ) {
      const credentials = globalThis.OzonCredentials.normalizeSellerCredentials(
        rawCredentials,
        { required: true },
      );
      const request = contract.buildRequest(
        command,
        globalThis.OzonCredentials.sellerHeaders(credentials),
      );
      const response = await globalThis.ProviderTransportCore.executeJsonOnce({
        fetchImpl: guardedFetch(executionGuard),
        request,
        now,
      });
      if (typeof onProviderResponse === "function")
        await onProviderResponse({ command, request, response });
      return { request, response, auth_request_performed: false };
    }

    async function resolveSellerCapability(
      rawCredentials,
      executionGuard = null,
    ) {
      try {
        const credentials =
          globalThis.OzonCredentials.normalizeSellerCredentials(
            rawCredentials,
            { required: true },
          );
        const request = Object.freeze({
          url: `${contract.SELLER_API_BASE}/v1/seller/info`,
          method: "POST",
          headers: globalThis.OzonCredentials.sellerHeaders(credentials),
          body: undefined,
          operation: "__seller_capability_probe__",
          path: "/v1/seller/info",
          host_alias: "seller_api",
        });
        const response = await globalThis.ProviderTransportCore.executeJsonOnce(
          { fetchImpl: guardedFetch(executionGuard), request, now },
        );
        if (!response.ok) {
          const safeError = contract.safeErrorPayload(
            response.httpStatus,
            response.rawText,
            response.parsed,
          );
          return Object.freeze({
            status: "unknown",
            subscription_type: "UNKNOWN",
            is_premium: null,
            probe_performed: true,
            probe_http_status: response.httpStatus,
            probe_error_code:
              safeError.code || "SELLER_CAPABILITY_PROBE_HTTP_ERROR",
          });
        }
        const payload =
          response.parsed && typeof response.parsed === "object"
            ? response.parsed
            : {};
        const subscription =
          payload.subscription &&
          typeof payload.subscription === "object" &&
          !Array.isArray(payload.subscription)
            ? payload.subscription
            : {};
        const rawType = String(subscription.type || "UNKNOWN")
          .trim()
          .toUpperCase();
        const allowedTypes = Array.isArray(contract.SELLER_SUBSCRIPTION_TYPES)
          ? contract.SELLER_SUBSCRIPTION_TYPES
          : [];
        const subscriptionType = allowedTypes.includes(rawType)
          ? rawType
          : "UNKNOWN";
        const known = subscriptionType !== "UNKNOWN";
        return Object.freeze({
          status: known ? "known" : "unknown",
          subscription_type: subscriptionType,
          is_premium:
            typeof subscription.is_premium === "boolean"
              ? subscription.is_premium
              : null,
          probe_performed: true,
          probe_http_status: response.httpStatus,
          probe_error_code: known
            ? null
            : "SELLER_CAPABILITY_SUBSCRIPTION_UNKNOWN",
        });
      } catch (error) {
        return Object.freeze({
          status: "unknown",
          subscription_type: "UNKNOWN",
          is_premium: null,
          probe_performed: true,
          probe_http_status: Number(error?.http_status || 0),
          probe_error_code: String(
            error?.code || "SELLER_CAPABILITY_PROBE_FAILED",
          ).slice(0, 160),
        });
      }
    }

    async function executePerformanceCommand(
      command,
      rawPerformanceCredentials,
      executionGuard = null,
      onProviderResponse = null,
    ) {
      const token = await getPerformanceToken(rawPerformanceCredentials, {
        executionGuard,
      });
      const request = contract.buildPerformanceRequest(
        command,
        globalThis.OzonCredentials.performanceBearerHeaders(token.access_token),
      );
      const response =
        await globalThis.ProviderTransportCore.executePerformanceJsonOnce({
          fetchImpl: guardedFetch(executionGuard),
          request,
          now,
        });
      if (typeof onProviderResponse === "function")
        await onProviderResponse({ command, request, response });
      if (response.httpStatus === 401) clearPerformanceToken();
      return {
        request,
        response,
        auth_request_performed: token.auth_request_performed === true,
      };
    }

    async function executeCommandObject(
      commandInput,
      rawCredentials,
      rawPerformanceCredentials = {},
      {
        reportCommand = null,
        planning = null,
        quota = null,
        onProviderResponse = null,
        onProviderResult = null,
        executionGuard = null,
      } = {},
    ) {
      const command = contract.normalizeCommand(commandInput);
      const logicalCommand = reportCommand
        ? contract.normalizeCommand(reportCommand)
        : command;
      if (logicalCommand.operation !== command.operation) {
        const error = new Error(
          "Logical и physical operation должны совпадать.",
        );
        error.code = "PLANNED_OPERATION_MISMATCH";
        throw error;
      }
      const preflight = contract.preflightExecution(command);
      const provider = String(preflight.meta.provider || "seller_api");
      let effectiveQuota = quota;
      const responseReceiptHook = typeof onProviderResponse === "function"
        ? async (value) => {
            const next = await onProviderResponse(value);
            if (next) effectiveQuota = next;
            return next;
          }
        : null;
      let execution;
      if (provider === "report_file")
        execution = await executeReportFileCommand(command, executionGuard, responseReceiptHook);
      else if (provider === "performance_api")
        execution = await executePerformanceCommand(
          command,
          rawPerformanceCredentials,
          executionGuard,
          responseReceiptHook,
        );
      else if (provider === "seller_api")
        execution = await executeSellerCommand(
          command,
          rawCredentials,
          executionGuard,
          responseReceiptHook,
        );
      else {
        const error = new Error(
          `Неизвестный provider ${provider}; выполнение запрещено.`,
        );
        error.code = "INVALID_PROVIDER_DISPATCH";
        error.external_request_executed = false;
        throw error;
      }
      if (executionGuard) await executionGuard.assertCurrent();
      const { request, response } = execution;
      // The response receipt hook runs in the concrete business transport
      // helper, immediately after its normalized response is available. Token
      // acquisition is deliberately outside this boundary.
      const requestId = String(uuid());
      const errorPayload = response.ok
        ? null
        : contract.safeErrorPayload(
            response.httpStatus,
            response.rawText,
            response.parsed,
          );
      let result;
      if (response.ok) {
        try {
          contract.verifyProviderResponse(
            command,
            response.parsed ?? response.rawText,
          );
        } catch (verificationError) {
          verificationError.code =
            verificationError.code || "PROVIDER_RESPONSE_CONTRACT_MISMATCH";
          verificationError.http_status = Number(response.httpStatus || 0);
          verificationError.external_request_executed = true;
          verificationError.response_meta = response.responseMeta;
          verificationError.rate_limit = safeQuotaRateMeta(
            effectiveQuota,
            response.responseMeta.retry_after,
          );
          throw verificationError;
        }

        result = contract.sanitizeResult(
          command,
          response.parsed ?? response.rawText,
        );
        result = redactSecrets(result, [
          rawCredentials?.apiKey,
          rawCredentials?.api_key,
          rawPerformanceCredentials?.clientSecret,
          rawPerformanceCredentials?.client_secret,
        ]);
        if (command.operation !== "report_info") {
          const rawReportCode = findFirstField(response.parsed, "code");
          if (typeof rawReportCode === "string")
            await rememberReportCodePolicy(rawReportCode, command.operation);
        }
        if (command.operation === "report_info") {
          const rawFile = findFirstField(response.parsed, "file");
          if (typeof rawFile === "string" && rawFile.trim()) {
            const personalDataRequired =
              await reportInfoPersonalDataRequired(command);
            const fileRef = await registerReportFile(rawFile.trim(), {
              personalDataRequired,
            });
            result = Object.freeze({
              ...(result && typeof result === "object" && !Array.isArray(result)
                ? result
                : { result }),
              report_file_ref: fileRef,
            });
          }
        }

        const generatedUrlField =
          GENERATED_DOCUMENT_URL_FIELD_BY_OPERATION[command.operation];
        if (generatedUrlField) {
          const rawGeneratedUrl = findFirstField(
            response.parsed,
            generatedUrlField,
          );
          if (typeof rawGeneratedUrl === "string" && rawGeneratedUrl.trim()) {
            const generatedRef = await registerReportFile(
              rawGeneratedUrl.trim(),
              {
                personalDataRequired: operationRequiresPersonalData(
                  command.operation,
                ),
              },
            );
            result = Object.freeze({
              ...(result && typeof result === "object" && !Array.isArray(result)
                ? result
                : { result }),
              generated_file_ref: generatedRef,
            });
          }
        }
        if (DIRECT_PDF_OPERATIONS.has(command.operation)) {
          const generatedRef = await registerInlineGeneratedDocument(
            response.parsed,
            {
              personalDataRequired: operationRequiresPersonalData(
                command.operation,
              ),
            },
          );
          if (generatedRef) {
            const safe =
              result && typeof result === "object" && !Array.isArray(result)
                ? { ...result }
                : { result };
            delete safe.file_content_base64;
            safe.generated_file_ref = generatedRef;
            safe.format = "pdf";
            result = Object.freeze(safe);
          }
        }
      } else {
        result = { error: errorPayload };
      }
      const logicalFingerprint = contract.commandFingerprint(logicalCommand);
      const physicalFingerprint = contract.commandFingerprint(command);
      const exactRequestPreserved = logicalFingerprint === physicalFingerprint;
      const safePlanning = planning
        ? {
            ...planning,
            entitlement: planning.entitlement
              ? {
                  ...planning.entitlement,
                  exact_request_preserved: exactRequestPreserved,
                }
              : planning.entitlement,
            execution: {
              ...(planning.execution || {}),
              logical_command_fingerprint: logicalFingerprint,
              physical_command_fingerprint: physicalFingerprint,
              command_transformed: !exactRequestPreserved,
            },
          }
        : null;
      const reportText = contract.formatResultReport({
        requestId,
        command: logicalCommand,
        requestMeta: {
          host_alias: request.host_alias,
          http_method: request.method,
          path_alias: logicalCommand.operation,
          external_request_executed:
            request.external_request_executed !== false,
          capability_probe_executed:
            planning?.capability?.probe_performed === true,
          capability_probe_http_status: Number(
            planning?.capability?.probe_http_status || 0,
          ),
        },
        httpStatus: response.httpStatus,
        result,
        elapsedMs: response.elapsedMs,
        pagination: null,
        rateLimit: safeQuotaRateMeta(
          effectiveQuota,
          response.responseMeta.retry_after,
        ),
        planning: safePlanning,
      });
      const providerResult = Object.freeze({
        ok: response.ok,
        request_id: requestId,
        operation: logicalCommand.operation,
        provider: request.host_alias,
        command_fingerprint: contract.commandFingerprint(logicalCommand),
        executed_command_fingerprint: contract.commandFingerprint(command),
        http_status: response.httpStatus,
        report_text: reportText,
        response_meta: response.responseMeta,
        result,
        elapsed_ms: Number(response.elapsedMs || 0),
        rate_limit: safeQuotaRateMeta(
          effectiveQuota,
          response.responseMeta.retry_after,
        ),
        auth_request_performed: execution.auth_request_performed === true,
      });
      if (typeof onProviderResult === "function")
        await onProviderResult({
          command: logicalCommand,
          request,
          response,
          result,
          report_text: reportText,
          provider_result: providerResult,
        });
      return providerResult;
    }

    async function executeCommand(
      commandText,
      rawCredentials,
      rawPerformanceCredentials = {},
    ) {
      const command = contract.parseCommand(commandText);
      return executeCommandObject(
        command,
        rawCredentials,
        rawPerformanceCredentials,
      );
    }

    async function testConnection(rawCredentials, probeCommandText = null) {
      const credentials = globalThis.OzonCredentials.normalizeSellerCredentials(
        rawCredentials,
        { required: true },
      );
      if (probeCommandText)
        return executeCommand(probeCommandText, rawCredentials, {});
      const command = { operation: "roles", params: {} };
      const request = contract.buildRequest(
        command,
        globalThis.OzonCredentials.sellerHeaders(credentials),
      );
      const response = await globalThis.ProviderTransportCore.executeJsonOnce({
        fetchImpl,
        request,
        now,
      });
      if (!response.ok) {
        const error = contract.safeErrorPayload(
          response.httpStatus,
          response.rawText,
          response.parsed,
        );
        return Object.freeze({
          ok: false,
          code: error.code || "OZON_API_ERROR",
          message: `Ozon Seller API отклонил /v1/roles: HTTP ${response.httpStatus}.`,
          http_status: response.httpStatus,
          elapsed_ms: response.elapsedMs,
          response_meta: response.responseMeta,
        });
      }
      const payload =
        response.parsed && typeof response.parsed === "object"
          ? response.parsed
          : {};
      const expiresAt = findFirstField(payload, "expires_at");
      const rolesCount = arrayCountForField(payload, "roles");
      const methodsCount = arrayCountForField(payload, "methods");
      return Object.freeze({
        ok: true,
        code: "CONNECTED",
        message:
          "Ozon Seller API доступен; credentials приняты методом /v1/roles.",
        http_status: response.httpStatus,
        elapsed_ms: response.elapsedMs,
        expires_at: typeof expiresAt === "string" ? expiresAt : null,
        roles_count: Number.isInteger(rolesCount) ? rolesCount : null,
        methods_count: Number.isInteger(methodsCount) ? methodsCount : null,
        response_meta: response.responseMeta,
      });
    }

    async function testPerformanceConnection(rawPerformanceCredentials) {
      try {
        const token = await getPerformanceToken(rawPerformanceCredentials, {
          force: true,
        });
        return Object.freeze({
          ok: true,
          code: "PERFORMANCE_CONNECTED",
          message:
            "Ozon Performance API credentials приняты сервисом авторизации. У Performance API нет аналога Seller /v1/roles в официальном OpenAPI.",
          http_status: Number(token.http_status || 200),
          token_expires_at_ms: token.expires_at_ms,
          auth_request_performed: true,
        });
      } catch (error) {
        return Object.freeze({
          ok: false,
          code: String(error?.code || "PERFORMANCE_CONNECTION_TEST_FAILED"),
          message: String(
            error?.message || error || "Ozon Performance API auth failed",
          ),
          http_status: Number(error?.http_status || 0),
          auth_request_performed: true,
        });
      }
    }

    return Object.freeze({
      executeCommand,
      executeCommandObject,
      resolveSellerCapability,
      testConnection,
      testPerformanceConnection,
      clearPerformanceToken,
      reportFileRefPolicy,
    });
  }

  const OzonProvider = createOzonProvider();
  globalThis.OzonProvider = OzonProvider;
  globalThis.OzonProviderFactory = Object.freeze({ createOzonProvider });
})();
