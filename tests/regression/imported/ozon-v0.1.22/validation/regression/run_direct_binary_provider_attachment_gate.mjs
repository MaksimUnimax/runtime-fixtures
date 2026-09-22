import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import { webcrypto } from "node:crypto";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const source = (path) => readFileSync(join(ROOT, "dist-step7-candidate", path), "utf8");

const operationMeta = Object.freeze({
  performance_daily_csv: Object.freeze({ provider: "performance_api", response_style: "binary", response_content_types: ["text/csv"] }),
  performance_statistics_report_download: Object.freeze({ provider: "performance_api", response_style: "binary", response_content_types: ["text/csv", "application/zip"] }),
  return_giveout_get_pdf: Object.freeze({ provider: "seller_api", response_style: "binary", response_content_types: ["application/pdf"], policy_group: "personal_data_read" }),
  return_giveout_get_png: Object.freeze({ provider: "seller_api", response_style: "binary", response_content_types: ["image/png"], policy_group: "personal_data_read" })
});

const toBase64 = (bytes) => Buffer.from(bytes).toString("base64");
const fromBase64 = (value) => new Uint8Array(Buffer.from(String(value || ""), "base64"));
const bytesEqual = (a, b) => Buffer.from(a).equals(Buffer.from(b));

function fixtureFor(type) {
  if (type === "text/csv") return new TextEncoder().encode("\uFEFFdate;campaign;expense\n2026-08-01;123;10.50\n");
  if (type === "application/zip") return Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00, 0x41, 0x42, 0x43, 0x44]);
  if (type === "application/pdf") return new TextEncoder().encode("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n");
  if (type === "image/png") return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
  throw new Error(`unknown fixture type ${type}`);
}

function resultReport(operation, result, httpStatus = 200) {
  return `OZON_RESULT_V1\n${JSON.stringify({
    bridge: "ozon-llm-api-bridge",
    version: "0.1.19",
    request_id: `req-${operation}`,
    operation,
    command: { operation, fingerprint: "deadbeef" },
    request_meta: { provider: operation.startsWith("performance_") ? "performance_api" : "seller_api", external_request_executed: true },
    http_status: httpStatus,
    result
  }, null, 2)}`;
}

const artifacts = new Map();
let providerCalls = 0;
let uuidSequence = 0;
const fixtureByOperation = Object.freeze({
  performance_daily_csv: "text/csv",
  performance_statistics_report_download: "application/zip",
  return_giveout_get_pdf: "application/pdf",
  return_giveout_get_png: "image/png"
});

const baseProvider = Object.freeze({
  async executeCommandObject(command) {
    providerCalls += 1;
    const operation = String(command?.operation || "");
    const type = fixtureByOperation[operation];
    if (!type) throw new Error(`unexpected operation ${operation}`);
    const bytes = fixtureFor(type);
    const result = Object.freeze({
      content_type: type,
      byte_length: bytes.byteLength,
      encoding: "base64",
      file_content_base64: toBase64(bytes)
    });
    return Object.freeze({
      ok: true,
      operation,
      provider: operation.startsWith("performance_") ? "performance_api" : "seller_api",
      http_status: 200,
      result,
      report_text: resultReport(operation, result),
      response_meta: Object.freeze({ content_type: type }),
      elapsed_ms: 1
    });
  }
});

function createContext(provider = baseProvider) {
  const context = vm.createContext({
    console,
    URL,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    Promise,
    crypto: webcrypto,
    indexedDB: { open() { throw new Error("default IndexedDB writer must not be used by deterministic gate"); } },
    ProviderTransportCore: Object.freeze({ reportBase64ToBytes: fromBase64 }),
    OzonOperationRegistry: Object.freeze({ operation(name) { return operationMeta[String(name || "")] || null; } }),
    OzonProvider: provider,
    OzonContract: Object.freeze({ parseCommand() { throw new Error("executeCommand text path not used in this gate"); } })
  });
  context.globalThis = context;
  return context;
}

const context = createContext();
vm.runInContext(source("shared/direct_binary_file_delivery_patch.js"), context, { filename: "direct_binary_file_delivery_patch.js" });
const patch = context.OzonDirectBinaryDeliveryPatch;
assert.ok(patch && typeof patch.wrapProvider === "function");

const wrapped = patch.wrapProvider(baseProvider, {
  artifactWriter: async (artifact) => { artifacts.set(artifact.artifact_key, structuredClone(artifact)); },
  uuid: () => `00000000-0000-4000-8000-${String(++uuidSequence).padStart(12, "0")}`,
  now: () => 1_788_858_000_000 + uuidSequence
});

const outputs = new Map();
for (const [operation, type] of Object.entries(fixtureByOperation)) {
  const before = providerCalls;
  const output = await wrapped.executeCommandObject({ operation, params: {} }, {}, {});
  outputs.set(operation, output);
  assert.equal(providerCalls, before + 1, `${operation}: provider request must execute exactly once`);
  assert.equal(output.ok, true);
  assert.equal(output.http_status, 200);
  assert.equal(output.result.content_type, type);
  assert.equal(output.result.format, type === "text/csv" ? "csv" : type === "application/zip" ? "zip" : type === "application/pdf" ? "pdf" : "png");
  assert.equal(output.result.generated_file_inline, true);
  assert.equal("file_content_base64" in output.result, false);
  assert.equal("encoding" in output.result, false);
  assert.equal(output.report_text.includes("file_content_base64"), false);
  assert.equal(output.report_text.includes("generated_file_ref"), true);
  const expectedPrefix = operation.startsWith("return_giveout_") ? "rpf_p_" : "rpf_s_";
  assert.equal(String(output.result.generated_file_ref).startsWith(expectedPrefix), true);
  const artifact = artifacts.get(`provider:${output.result.generated_file_ref}`);
  assert.ok(artifact, `${operation}: artifact must be persisted before safe result is returned`);
  assert.equal(artifact.source_kind, "original_provider_file");
  assert.equal(artifact.mime_type, type);
  assert.equal(artifact.extension, output.result.format);
  assert.equal(artifact.byte_length, fixtureFor(type).byteLength);
  assert.equal(bytesEqual(new Uint8Array(artifact.bytes), fixtureFor(type)), true);
  assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
}
assert.equal(providerCalls, 4);
console.log("REG_DIRECT_BINARY_CSV_ZIP_PDF_PNG_SINGLE_PROVIDER_CAPTURE_PASS");
console.log("REG_DIRECT_BINARY_BASE64_REDACTION_AND_OPAQUE_REF_PASS");
console.log("REG_DIRECT_BINARY_PERSONAL_POLICY_REF_PREFIX_PASS");

const modelContext = vm.createContext({ console, URL, TextEncoder, crypto: webcrypto });
modelContext.globalThis = modelContext;
vm.runInContext(source("shared/ai_delivery_capabilities.js"), modelContext, { filename: "ai_delivery_capabilities.js" });
vm.runInContext(source("shared/bridge_autorun_model.js"), modelContext, { filename: "bridge_autorun_model.js" });
vm.runInContext(source("shared/file_delivery_model_policy.js"), modelContext, { filename: "file_delivery_model_policy.js" });

assert.equal(modelContext.OzonAIDeliveryCapabilities.supportsFile("chatgpt", { filename: "report.zip", extension: "zip", byte_length: 14 }).supported, true);
assert.equal(modelContext.OzonAIDeliveryCapabilities.supportsFile("chatgpt", { filename: "barcode.png", extension: "png", byte_length: 16 }).supported, true);
console.log("REG_CHATGPT_ZIP_PNG_CAPABILITY_PASS");

const csvOutput = outputs.get("performance_daily_csv");
const durableRun = JSON.parse(JSON.stringify({
  origin: "https://chatgpt.com",
  status: modelContext.BridgeAutorunModel.RUN_STATUSES.COLLECTING,
  batch: {
    entries: [{
      status: "complete",
      http_status: 200,
      command: { operation: "performance_daily_csv", params: { dateFrom: "2026-08-01", dateTo: "2026-08-31" } },
      report_text: csvOutput.report_text
    }]
  }
}));
const recovered = modelContext.BridgeAutorunModel.claimDelivery(durableRun, {
  deliveryId: "direct-binary-reload",
  mode: "batch_watch_v1",
  outgoingText: `OZON_BATCH_RESULT_V1\n${JSON.stringify({ result_count: 1 })}`,
  reportPrefixApplied: false
});
assert.equal(recovered.delivery.mode, "attachment_watch_v1");
assert.deepEqual(Array.from(recovered.delivery.provider_file_refs), [csvOutput.result.generated_file_ref]);
console.log("REG_DIRECT_BINARY_DURABLE_REPORT_REF_RECOVERY_PASS");

let badCalls = 0;
const badProvider = Object.freeze({
  async executeCommandObject(command) {
    badCalls += 1;
    const bytes = new TextEncoder().encode("not-a-png");
    const result = { content_type: "image/png", byte_length: bytes.byteLength, encoding: "base64", file_content_base64: toBase64(bytes) };
    return { ok: true, operation: command.operation, http_status: 200, result, report_text: resultReport(command.operation, result), response_meta: { content_type: "image/png" } };
  }
});
const badContext = createContext(badProvider);
vm.runInContext(source("shared/direct_binary_file_delivery_patch.js"), badContext, { filename: "direct_binary_file_delivery_patch.js" });
const badWrapped = badContext.OzonDirectBinaryDeliveryPatch.wrapProvider(badProvider, {
  artifactWriter: async () => { throw new Error("bad magic must never persist"); },
  uuid: () => "bad",
  now: () => 1
});
await assert.rejects(
  () => badWrapped.executeCommandObject({ operation: "return_giveout_get_png", params: {} }, {}, {}),
  (error) => error?.code === "DIRECT_BINARY_MAGIC_MISMATCH" && error?.external_request_executed === true && error?.http_status === 200
);
assert.equal(badCalls, 1);
console.log("REG_DIRECT_BINARY_INVALID_MAGIC_FAIL_CLOSED_NO_RETRY_PASS");

console.log("DIRECT_BINARY_PROVIDER_ATTACHMENT_GATE_PASS");
