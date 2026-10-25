import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const SOURCE = "apps/extension/src/imported/ozon-v0.1.22/shared";
const context = {
  BridgeAutorunModel: { applyReportPrefix: (text) => ({ text }) },
  OzonGuidance: { result: () => ({ choices: [] }) },
};
context.globalThis = context;
let providerRequests = 0;
context.fetch = () => {
  providerRequests += 1;
  throw new Error("CAP24_EXTERNAL_PROVIDER_REQUEST_FORBIDDEN");
};
vm.createContext(context);

// Verify the exact supported generated script: frozen donor plus the
// application composition patch. Changing only an exported wrapper is not
// enough because instructionPayload uses its lexical continuation.
const recipe = JSON.parse(
  fs.readFileSync(path.join(ROOT, "apps/extension/composition.json"), "utf8"),
);
assert.equal(
  recipe.application_patches,
  "apps/extension/application-patches.json",
);
const appPatches = JSON.parse(
  fs.readFileSync(path.join(ROOT, recipe.application_patches), "utf8"),
);
const reportPatches = appPatches.filter(
  (row) => row.target === "shared/llm_output_report_workflow_patch.js",
);
assert.equal(reportPatches.length, 1);
const reportPatch = reportPatches[0];
assert.deepEqual(Object.keys(reportPatch).sort(), ["new", "old", "target"]);
for (const file of [
  "ozon_operation_registry.js",
  "llm_output_report_workflow_patch.js",
]) {
  const relative = path.join(SOURCE, file);
  let source = fs.readFileSync(path.join(ROOT, relative), "utf8");
  if (file === "llm_output_report_workflow_patch.js") {
    assert.equal(
      source.split(reportPatch.old).length,
      2,
      "exact frozen anchor",
    );
    assert.notEqual(reportPatch.old, reportPatch.new);
    source = source.replace(reportPatch.old, reportPatch.new);
  }
  vm.runInContext(source, context, { filename: relative });
}

const operation = "report_placement_by_products_create";
const registry = context.OzonOperationRegistry.OPERATIONS;
const workflow = context.OzonLlmOutputReportWorkflowPatch;
assert.equal(
  registry[operation].path,
  "/v1/report/placement/by-products/create",
);
assert.equal(registry[operation].method, "POST");
assert.equal(registry[operation].effect, "READ");
assert.equal(registry[operation].execution_enabled, true);
assert.equal(registry[operation].workflow_role, "explicit_workflow_read_step");
assert.equal(
  workflow.workflowMetadataForOperation(operation).next_operation,
  "report_info",
);

const reportCode =
  "REPORT_seller_placement_by_products_1001_2000000000_11111111-2222-4333-8444-555555555555";
const staleRef = "rpf_s_INERT_PRIOR_STAGE";
const envelope = (op, body, http_status = 200) => ({
  operation: op,
  http_status,
  result: { result: body },
});
function check(operationName, body, status, next, httpStatus = 200) {
  const result = workflow.continuationFromEnvelope(
    envelope(operationName, body, httpStatus),
    0,
  );
  assert.equal(result?.state, status, operationName + " must be " + status);
  assert.equal(
    result?.next_command?.operation || null,
    next,
    operationName + " next command must stay explicit and safe",
  );
  assert.equal(result?.automatic_continuation, false);
  if (next === "report_info") {
    assert.equal(
      result?.next_command?.params?.code,
      reportCode,
      operationName + " must preserve the exact report identity",
    );
  }
  return result;
}

// Exercise the lexical instructionPayload closure and actual report-text
// rendering. They must not bypass the patched continuationFromEnvelope.
const serialise = (op, body) =>
  "OZON_RESULT_V1\n" + JSON.stringify(envelope(op, body));
const failedMessage = serialise("report_info", {
  status: "failed",
  error: "",
  code: reportCode,
  report_file_ref: staleRef,
});
const failedPayload = workflow.instructionPayload(failedMessage);
assert.equal(failedPayload.workflow_continuations.length, 1);
assert.equal(failedPayload.workflow_continuations[0].state, "failed");
assert.equal(failedPayload.workflow_continuations[0].next_command, null);
const pendingPayload = workflow.instructionPayload(
  serialise("report_info", {
    status: "processing",
    code: reportCode,
    report_file_ref: staleRef,
  }),
);
assert.equal(pendingPayload.workflow_continuations.length, 1);
assert.equal(pendingPayload.workflow_continuations[0].state, "pending");
assert.equal(
  pendingPayload.workflow_continuations[0].next_command.params.code,
  reportCode,
);
const renderedReport =
  context.BridgeAutorunModel.applyReportPrefix(failedMessage).text;
const tailMarker = "OZON_LLM_INSTRUCTIONS_V1\n";
assert.ok(renderedReport.includes(tailMarker));
const payloadInActualDelivery = JSON.parse(
  renderedReport.slice(
    renderedReport.lastIndexOf(tailMarker) + tailMarker.length,
  ),
);
assert.equal(payloadInActualDelivery.workflow_continuations[0].state, "failed");
assert.equal(
  payloadInActualDelivery.workflow_continuations[0].next_command,
  null,
);

const created = check(
  operation,
  { code: reportCode },
  "created",
  "report_info",
);
assert.equal(created.next_command.params.code, reportCode);
check(operation, {}, "blocked_missing_fresh_code", null);
assert.equal(
  workflow.continuationFromEnvelope(
    envelope(operation, { code: reportCode }, 503),
    0,
  ),
  null,
);
check(
  "report_info",
  { status: "processing", code: reportCode },
  "pending",
  "report_info",
);
check(
  "report_info",
  { status: "failed", error: "", code: reportCode },
  "failed",
  null,
);

// A provider response may contain a stale/foreign-looking ref. Status wins.
check(
  "report_info",
  { status: "failed", error: "", code: reportCode, report_file_ref: staleRef },
  "failed",
  null,
);
check(
  "report_info",
  {
    status: "cancelled",
    error: "",
    code: reportCode,
    generated_file_inline: true,
  },
  "failed",
  null,
);
check(
  "report_info",
  { status: "processing", code: reportCode, report_file_ref: staleRef },
  "pending",
  "report_info",
);
check(
  "report_info",
  { status: "unknown_phase", code: reportCode, report_file_ref: staleRef },
  "pending_unclassified_status",
  "report_info",
);
check(
  "report_info",
  { code: reportCode, report_file_ref: staleRef },
  "pending",
  "report_info",
);
check(
  "report_info",
  { status: "processing", report_file_ref: staleRef },
  "blocked_missing_fresh_code",
  null,
);

check(
  "report_info",
  {
    status: "processing",
    code: "INVALID REPORT CODE",
    report_file_ref: staleRef,
  },
  "blocked_missing_fresh_code",
  null,
);

// Only a confirmed successful report with a trusted opaque ref is file-ready.
const ready = check(
  "report_info",
  { status: "success", code: reportCode, report_file_ref: staleRef },
  "file_ready",
  "report_file_get",
);
assert.equal(ready.next_command.params.file_ref, staleRef);
check(
  "report_info",
  { status: "success", code: reportCode, generated_file_inline: true },
  "blocked_missing_fresh_file_ref",
  null,
);
check(
  "report_info",
  {
    status: "success",
    code: reportCode,
    file: "https://example.invalid/raw.xlsx",
  },
  "blocked_missing_fresh_file_ref",
  null,
);
check(
  "report_info",
  {
    status: "success",
    code: reportCode,
    report_file_ref: "https://example.invalid/raw.xlsx",
  },
  "blocked_missing_fresh_file_ref",
  null,
);
check(
  "report_file_get",
  { format: "xlsx", sheet: {} },
  "file_downloaded",
  null,
);
assert.equal(providerRequests, 0);

const readme = fs.readFileSync(
  path.join(ROOT, "docs/product/readiness/BUSINESS_SCENARIOS.tsv"),
  "utf8",
);
assert.match(
  readme,
  /^CAP-24\t[^\n]*REOPENED__STORAGE_PLACEMENT_REQUIRED_FOR_UNIT_ECONOMICS/m,
);

console.log(
  JSON.stringify({
    status: "PASS",
    scenario: "CAP-24",
    covered:
      "Ozon placement report terminal status outranks stale file reference",
    cases: 20,
    providerRequests,
    autoPolling: false,
    xlsxSkuCurrencyAmounts: "NOT_VERIFIED",
    level: "SOURCE_SYNTHETIC_ONLY",
  }),
);
