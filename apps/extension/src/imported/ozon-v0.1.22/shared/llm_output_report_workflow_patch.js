/* global BridgeAutorunModel, OzonGuidance */
(() => {
  "use strict";

  const PATCH_KEY = "__OZON_LLM_OUTPUT_REPORT_WORKFLOW_PATCH_V1__";
  if (globalThis[PATCH_KEY]) return;

  const INSTRUCTION_PREFIX = "OZON_LLM_INSTRUCTIONS_V1";
  const REPORT_CREATE_OPERATIONS = new Set([
    "report_products_create",
    "report_returns_create_v2",
    "report_postings_create",
    "report_discounted_create",
    "report_placement_by_products_create",
    "report_placement_by_supplies_create",
    "report_marked_products_sales_create",
    "report_realization_posting_create"
  ]);

  const GENERATED_DOCUMENT_CREATE_WORKFLOWS = Object.freeze({
    cargoes_label_create: Object.freeze({ next_operation: "cargoes_label_get", fields: Object.freeze(["operation_id"]) }),
    cargoes_transport_label_by_order_create: Object.freeze({ next_operation: "cargoes_label_transport_by_order_status", fields: Object.freeze(["operation_id"]) }),
    cargoes_transport_label_create: Object.freeze({ next_operation: "cargoes_label_transport_status", fields: Object.freeze(["operation_id"]) }),
    posting_fbs_package_label_create: Object.freeze({ next_operation: "posting_fbs_package_label_get_v1", fields: Object.freeze(["task_id"]) }),
    fbp_act_from_create: Object.freeze({ next_operation: "fbp_act_from_get", fields: Object.freeze(["file_uuid"]) }),
    fbp_act_to_create: Object.freeze({ next_operation: "fbp_act_to_get", fields: Object.freeze(["code", "supply_id"]) }),
    fbp_label_create: Object.freeze({ next_operation: "fbp_label_get", fields: Object.freeze(["code", "supply_id"]) })
  });

  const GENERATED_DOCUMENT_RESOLVERS = Object.freeze({
    cargoes_label_get: Object.freeze({ fields: Object.freeze(["operation_id"]) }),
    cargoes_label_transport_by_order_status: Object.freeze({ fields: Object.freeze(["operation_id"]) }),
    cargoes_label_transport_status: Object.freeze({ fields: Object.freeze(["operation_id"]) }),
    fbp_act_from_get: Object.freeze({ fields: Object.freeze(["file_uuid"]) }),
    fbp_act_to_get: Object.freeze({ fields: Object.freeze(["code", "supply_id"]) }),
    fbp_label_get: Object.freeze({ fields: Object.freeze(["code", "supply_id"]) }),
    posting_fbs_package_label_get_v1: Object.freeze({ fields: Object.freeze(["task_id"]) })
  });

  const READY_STATUSES = new Set(["success", "ready", "done", "completed", "complete", "generated"]);
  const FAILED_STATUSES = new Set(["failed", "failure", "error", "cancelled", "canceled", "rejected"]);
  const PENDING_STATUSES = new Set(["processing", "pending", "queued", "waiting", "in_progress", "in-progress", "running", "created"]);

  function plain(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function findFirstField(value, fieldName, depth = 0) {
    if (depth > 10 || value === null || value === undefined) return null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findFirstField(item, fieldName, depth + 1);
        if (found !== null && found !== undefined) return found;
      }
      return null;
    }
    if (!plain(value)) return null;
    for (const [key, child] of Object.entries(value)) {
      if (String(key).toLowerCase() === String(fieldName).toLowerCase()) return child;
      const found = findFirstField(child, fieldName, depth + 1);
      if (found !== null && found !== undefined) return found;
    }
    return null;
  }

  function extractBalancedObject(source, start) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const char = source[index];
      if (inString) {
        if (escaped) { escaped = false; continue; }
        if (char === "\\") { escaped = true; continue; }
        if (char === '"') inString = false;
        continue;
      }
      if (char === '"') { inString = true; continue; }
      if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
      }
    }
    return null;
  }

  function resultEnvelopesFromDelivery(text) {
    const source = String(text || "");
    const marker = "OZON_RESULT_V1";
    const envelopes = [];
    let cursor = 0;
    while (cursor < source.length) {
      const markerAt = source.indexOf(marker, cursor);
      if (markerAt < 0) break;
      let jsonAt = markerAt + marker.length;
      while (/\s/.test(source[jsonAt] || "")) jsonAt += 1;
      if (source[jsonAt] !== "{") { cursor = markerAt + marker.length; continue; }
      const json = extractBalancedObject(source, jsonAt);
      if (!json) { cursor = jsonAt + 1; continue; }
      try {
        const parsed = JSON.parse(json);
        if (plain(parsed)) envelopes.push(parsed);
      } catch (_) {}
      cursor = jsonAt + json.length;
    }
    return envelopes;
  }

  function validReportCode(value) {
    const text = String(value || "").trim();
    return /^REPORT_[A-Za-z0-9_.:-]+$/i.test(text) ? text : null;
  }

  function validFileRef(value) {
    const text = String(value || "").trim();
    return /^rpf_[sp]_[A-Za-z0-9_-]+$/.test(text) ? text : null;
  }

  function normalizedStatus(result) {
    const status = findFirstField(result, "status");
    return typeof status === "string" ? status.trim().toLowerCase() : "";
  }

  function successfulEnvelope(envelope) {
    const status = Number(envelope?.http_status || 0);
    return status >= 200 && status < 300 && !findFirstField(envelope?.result, "error");
  }

  function exactParamsFromResult(result, fields) {
    const params = {};
    const missing = [];
    for (const field of fields || []) {
      const value = findFirstField(result, field);
      if (value === null || value === undefined || value === "") missing.push(field);
      else params[field] = cloneJson(value);
    }
    return { params, missing };
  }

  function workflowMetadataForOperation(operation) {
    const op = String(operation || "");
    if (REPORT_CREATE_OPERATIONS.has(op)) return Object.freeze({ kind: "report_download", role: "create", next_operation: "report_info" });
    if (op === "report_info") return Object.freeze({ kind: "report_download", role: "resolve_file", next_operation: "report_file_get" });
    if (op === "report_file_get") return Object.freeze({ kind: "report_download", role: "download", next_operation: null });
    if (GENERATED_DOCUMENT_CREATE_WORKFLOWS[op]) return Object.freeze({ kind: "generated_document", role: "create", next_operation: GENERATED_DOCUMENT_CREATE_WORKFLOWS[op].next_operation });
    if (GENERATED_DOCUMENT_RESOLVERS[op]) return Object.freeze({ kind: "generated_document", role: "resolve_file", next_operation: "report_file_get" });
    return null;
  }

  function continuationFromEnvelope(envelope, resultIndex) {
    const operation = String(envelope?.operation || "");
    if (!operation || !successfulEnvelope(envelope)) return null;
    const result = plain(envelope?.result) ? envelope.result : {};
    const generatedInline = findFirstField(result, "generated_file_inline") === true;
    const generatedFileRef = validFileRef(findFirstField(result, "generated_file_ref"));
    const reportFileRef = validFileRef(findFirstField(result, "report_file_ref"));

    if (generatedInline) {
      return Object.freeze({ source_result_index: resultIndex, source_operation: operation, kind: "generated_document", state: "file_downloaded", next_command: null, automatic_continuation: false });
    }

    const readyRef = generatedFileRef || reportFileRef;
    if (readyRef) {
      return Object.freeze({
        source_result_index: resultIndex,
        source_operation: operation,
        kind: operation === "report_info" ? "report_download" : "generated_document",
        state: "file_ready",
        next_command: Object.freeze({ operation: "report_file_get", params: Object.freeze({ file_ref: readyRef, offset: 0, limit: 200 }) }),
        automatic_continuation: false
      });
    }

    if (REPORT_CREATE_OPERATIONS.has(operation)) {
      const code = validReportCode(findFirstField(result, "code"));
      if (!code) {
        return Object.freeze({ source_result_index: resultIndex, source_operation: operation, kind: "report_download", state: "blocked_missing_fresh_code", next_command: null, automatic_continuation: false });
      }
      return Object.freeze({
        source_result_index: resultIndex,
        source_operation: operation,
        kind: "report_download",
        state: "created",
        next_command: Object.freeze({ operation: "report_info", params: Object.freeze({ code }) }),
        automatic_continuation: false
      });
    }

    if (operation === "report_info") {
      const status = normalizedStatus(result);
      const code = validReportCode(findFirstField(result, "code"));
      if (FAILED_STATUSES.has(status)) {
        return Object.freeze({ source_result_index: resultIndex, source_operation: operation, kind: "report_download", state: "failed", next_command: null, automatic_continuation: false });
      }
      if (READY_STATUSES.has(status)) {
        return Object.freeze({ source_result_index: resultIndex, source_operation: operation, kind: "report_download", state: "blocked_missing_fresh_file_ref", next_command: null, automatic_continuation: false });
      }
      if (!code) {
        return Object.freeze({ source_result_index: resultIndex, source_operation: operation, kind: "report_download", state: "blocked_missing_fresh_code", next_command: null, automatic_continuation: false });
      }
      return Object.freeze({
        source_result_index: resultIndex,
        source_operation: operation,
        kind: "report_download",
        state: PENDING_STATUSES.has(status) || !status ? "pending" : "pending_unclassified_status",
        next_command: Object.freeze({ operation: "report_info", params: Object.freeze({ code }) }),
        automatic_continuation: false
      });
    }

    if (operation === "report_file_get") {
      return Object.freeze({ source_result_index: resultIndex, source_operation: operation, kind: "report_download", state: "file_downloaded", next_command: null, automatic_continuation: false });
    }

    const createWorkflow = GENERATED_DOCUMENT_CREATE_WORKFLOWS[operation];
    if (createWorkflow) {
      const extracted = exactParamsFromResult(result, createWorkflow.fields);
      if (extracted.missing.length) {
        return Object.freeze({ source_result_index: resultIndex, source_operation: operation, kind: "generated_document", state: "blocked_missing_fresh_dependencies", missing_result_fields: Object.freeze(extracted.missing), next_command: null, automatic_continuation: false });
      }
      return Object.freeze({
        source_result_index: resultIndex,
        source_operation: operation,
        kind: "generated_document",
        state: "created",
        next_command: Object.freeze({ operation: createWorkflow.next_operation, params: Object.freeze(extracted.params) }),
        automatic_continuation: false
      });
    }

    const resolverWorkflow = GENERATED_DOCUMENT_RESOLVERS[operation];
    if (resolverWorkflow) {
      const status = normalizedStatus(result);
      if (FAILED_STATUSES.has(status)) {
        return Object.freeze({ source_result_index: resultIndex, source_operation: operation, kind: "generated_document", state: "failed", next_command: null, automatic_continuation: false });
      }
      const extracted = exactParamsFromResult(result, resolverWorkflow.fields);
      if (extracted.missing.length) {
        return Object.freeze({ source_result_index: resultIndex, source_operation: operation, kind: "generated_document", state: "blocked_missing_fresh_dependencies", missing_result_fields: Object.freeze(extracted.missing), next_command: null, automatic_continuation: false });
      }
      return Object.freeze({
        source_result_index: resultIndex,
        source_operation: operation,
        kind: "generated_document",
        state: "pending",
        next_command: Object.freeze({ operation, params: Object.freeze(extracted.params) }),
        automatic_continuation: false
      });
    }

    return null;
  }

  function commandOutputContract() {
    return Object.freeze({
      command_form: "single_text_code_block",
      max_command_forms_per_response: 1,
      group_independent_envelopes: true,
      dependent_envelopes: "next_turn_only",
      use_exact_next_command_when_present: true,
      submit_control: "Ozon",
      submit_instruction: "Для отправки команд в Ozon Bridge нажмите кнопку Ozon на этом блоке.",
      manual_copy_paste_required: false
    });
  }

  function instructionPayload(deliveryText) {
    const continuations = resultEnvelopesFromDelivery(deliveryText)
      .map((envelope, index) => continuationFromEnvelope(envelope, index + 1))
      .filter(Boolean);
    return Object.freeze({
      command_output: commandOutputContract(),
      workflow_continuations: Object.freeze(continuations)
    });
  }

  function stripExistingInstructionTail(text) {
    const source = String(text || "");
    const marker = `\n\n${INSTRUCTION_PREFIX}\n`;
    const at = source.lastIndexOf(marker);
    if (at < 0) return source;
    const jsonAt = at + marker.length;
    if (source[jsonAt] !== "{") return source;
    const json = extractBalancedObject(source, jsonAt);
    if (!json || source.slice(jsonAt + json.length).trim()) return source;
    try { JSON.parse(json); } catch (_) { return source; }
    return source.slice(0, at);
  }

  function appendInstructionTail(text) {
    const base = stripExistingInstructionTail(text);
    const payload = instructionPayload(base);
    return `${base}\n\n${INSTRUCTION_PREFIX}\n${JSON.stringify(payload, null, 2)}`;
  }

  function wrapBridgeAutorunModel() {
    const base = globalThis.BridgeAutorunModel;
    if (!base || typeof base.applyReportPrefix !== "function") throw new Error("BridgeAutorunModel.applyReportPrefix missing before LLM output patch.");
    const originalApply = base.applyReportPrefix.bind(base);
    function applyReportPrefix(outgoingText, record) {
      const original = originalApply(outgoingText, record);
      return { ...original, text: appendInstructionTail(original?.text || "") };
    }
    globalThis.BridgeAutorunModel = Object.freeze({ ...base, applyReportPrefix });
  }

  function wrapGuidance() {
    const base = globalThis.OzonGuidance;
    if (!base || typeof base.result !== "function") return;
    const originalResult = base.result.bind(base);
    function result(args) {
      const original = originalResult(args);
      const choices = (Array.isArray(original?.choices) ? original.choices : []).map((choice) => {
        if (!plain(choice) || !choice.operation) return choice;
        const workflow = workflowMetadataForOperation(choice.operation);
        return workflow ? Object.freeze({ ...choice, workflow }) : choice;
      });
      return Object.freeze({ ...original, choices: Object.freeze(choices) });
    }
    globalThis.OzonGuidance = Object.freeze({ ...base, result });
  }

  wrapBridgeAutorunModel();
  wrapGuidance();

  const api = Object.freeze({
    INSTRUCTION_PREFIX,
    REPORT_CREATE_OPERATIONS,
    GENERATED_DOCUMENT_CREATE_WORKFLOWS,
    GENERATED_DOCUMENT_RESOLVERS,
    workflowMetadataForOperation,
    resultEnvelopesFromDelivery,
    continuationFromEnvelope,
    instructionPayload,
    appendInstructionTail
  });
  globalThis.OzonLlmOutputReportWorkflowPatch = api;
  globalThis[PATCH_KEY] = api;
})();
