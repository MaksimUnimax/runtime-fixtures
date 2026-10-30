import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { createHash, webcrypto } from "node:crypto";

async function main() {
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw new Error("F-05 attachment-consumer regression requires Node.js 24 or newer; production bytes are never rewritten for older parsers.");

  const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(".");
  const checkoutRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  const fixtureConversationId = "00000000-0000-4000-8000-000000000005";
  const otherConversationId = "00000000-0000-4000-8000-000000000006";
  const sourceImported = path.join(root, "apps/extension/src/imported/ozon-v0.1.22/shared");
  const runtimeImported = path.join(root, "shared");
  const shared = fs.existsSync(path.join(runtimeImported, "file_delivery_model_policy.js"))
    ? runtimeImported
    : sourceImported;
  const integrityGuardPath = fs.existsSync(path.join(runtimeImported, "attachment_result_integrity.js"))
    ? path.join(runtimeImported, "attachment_result_integrity.js")
    : path.join(root, "apps/extension/src/application/attachment-result-integrity.js");
  const serviceWorkerPath = fs.existsSync(path.join(root, "service_worker.js"))
    ? path.join(root, "service_worker.js")
    : path.join(checkoutRoot, "apps/extension/src/imported/ozon-v0.1.22/service_worker.js");
  const recoverySourcePath = path.join(checkoutRoot, "packages/bridge-core/src/execution/result-recovery.js");
  const outcomeSourcePath = path.join(checkoutRoot, "packages/bridge-core/src/execution/provider-outcome.js");
  const batchQueueSourcePath = path.join(checkoutRoot, "packages/bridge-core/src/execution/batch-queue.js");

  function extractModule(bundle, marker, label) {
    const index = bundle.indexOf(marker);
    assert.notEqual(index, -1, `built service worker is missing ${label}`);
    const start = bundle.lastIndexOf("(() => {", index);
    const endMarker = bundle.indexOf("\n})();", index);
    assert.ok(start >= 0 && endMarker > index, `cannot extract unchanged ${label} module bytes`);
    return Buffer.from(bundle.slice(start, endMarker + "\n})();".length), "utf8");
  }

  const moduleBytes = new Map();
  const sourceMode = fs.existsSync(path.join(root, "packages/bridge-core/src/execution/result-recovery.js")) &&
    fs.existsSync(path.join(root, "packages/bridge-core/src/execution/provider-outcome.js"));
  const applicationDeliveryPath = sourceMode
    ? path.join(checkoutRoot, "apps/extension/src/application/delivery.js")
    : path.join(root, "shared/application.js");
  if (sourceMode) {
    moduleBytes.set("result-recovery.js", fs.readFileSync(path.join(root, "packages/bridge-core/src/execution/result-recovery.js")));
    moduleBytes.set("provider-outcome.js", fs.readFileSync(path.join(root, "packages/bridge-core/src/execution/provider-outcome.js")));
  } else {
    assert.ok(fs.existsSync(serviceWorkerPath), "pass a source checkout or a built runtime/extracted runtime directory");
    const bundle = fs.readFileSync(serviceWorkerPath, "utf8");
    moduleBytes.set("result-recovery.js", extractModule(bundle, "const SCHEMA_VERSION = 2;", "schema-2 result-recovery"));
    moduleBytes.set("provider-outcome.js", extractModule(bundle, "const STATES = Object.freeze({", "provider-outcome"));
  }

  moduleBytes.set("batch-queue.js", fs.readFileSync(batchQueueSourcePath));

  for (const name of ["bridge_autorun_model.js", "file_delivery_model_policy.js", "file_delivery_port_worker.js"])
    moduleBytes.set(name, fs.readFileSync(path.join(shared, name)));
  moduleBytes.set("conversation_identity.js", fs.readFileSync(path.join(shared, "conversation_identity.js")));
  for (const name of ["ozon_operation_registry.js", "ozon_contract.js"])
    moduleBytes.set(name, fs.readFileSync(path.join(shared, name)));
  moduleBytes.set("attachment-result-integrity.js", fs.readFileSync(integrityGuardPath));
  moduleBytes.set("application-delivery.js", fs.readFileSync(applicationDeliveryPath));
  moduleBytes.set("service_worker.js", fs.readFileSync(serviceWorkerPath));

  function extractDonorRegion(bundle, startMarker, endMarker, label) {
    const start = bundle.indexOf(startMarker);
    const end = bundle.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0 && end > start, `cannot extract ${label}`);
    return bundle.slice(start, end).trim();
  }

  const donorBundle = moduleBytes.get("service_worker.js").toString("utf8");
  const finalizeBytes = sourceMode
    ? fs.readFileSync(path.join(root, "apps/extension/src/background/context/finalizeManualBatch.js"))
    : Buffer.from(extractDonorRegion(donorBundle, "async function finalizeManualBatch(", "\nfunction launchBatchProcessor(", "composed manual batch finalizer"), "utf8");
  moduleBytes.set("finalizeManualBatch.js", finalizeBytes);
  const combinedReportBytes = sourceMode
    ? fs.readFileSync(path.join(root, "apps/extension/src/background/context/formatCombinedBatchReport.js"))
    : Buffer.from(extractDonorRegion(donorBundle, "function formatCombinedBatchReport(", "\nfunction commandRequiresPersonalDataPolicy(", "composed combined report formatter"), "utf8");
  moduleBytes.set("formatCombinedBatchReport.js", combinedReportBytes);

  const sourceHashes = Object.fromEntries([...moduleBytes].map(([name, bytes]) => [name, createHash("sha256").update(bytes).digest("hex")]));
  function currentModuleBytes() {
    const current = new Map();
    if (sourceMode) {
      current.set("result-recovery.js", fs.readFileSync(path.join(root, "packages/bridge-core/src/execution/result-recovery.js")));
      current.set("provider-outcome.js", fs.readFileSync(path.join(root, "packages/bridge-core/src/execution/provider-outcome.js")));
    } else {
      const bundle = fs.readFileSync(serviceWorkerPath, "utf8");
      current.set("result-recovery.js", extractModule(bundle, "const SCHEMA_VERSION = 2;", "schema-2 result-recovery"));
      current.set("provider-outcome.js", extractModule(bundle, "const STATES = Object.freeze({", "provider-outcome"));
    }
    current.set("batch-queue.js", fs.readFileSync(batchQueueSourcePath));
    for (const name of ["bridge_autorun_model.js", "file_delivery_model_policy.js", "file_delivery_port_worker.js"])
      current.set(name, fs.readFileSync(path.join(shared, name)));
    current.set("conversation_identity.js", fs.readFileSync(path.join(shared, "conversation_identity.js")));
    for (const name of ["ozon_operation_registry.js", "ozon_contract.js"])
      current.set(name, fs.readFileSync(path.join(shared, name)));
    current.set("attachment-result-integrity.js", fs.readFileSync(integrityGuardPath));
    current.set("application-delivery.js", fs.readFileSync(applicationDeliveryPath));
    current.set("service_worker.js", fs.readFileSync(serviceWorkerPath));
    const currentBundle = current.get("service_worker.js").toString("utf8");
    current.set("finalizeManualBatch.js", sourceMode
      ? fs.readFileSync(path.join(root, "apps/extension/src/background/context/finalizeManualBatch.js"))
      : Buffer.from(extractDonorRegion(currentBundle, "async function finalizeManualBatch(", "\nfunction launchBatchProcessor(", "current composed manual batch finalizer"), "utf8"));
    current.set("formatCombinedBatchReport.js", sourceMode
      ? fs.readFileSync(path.join(root, "apps/extension/src/background/context/formatCombinedBatchReport.js"))
      : Buffer.from(extractDonorRegion(currentBundle, "function formatCombinedBatchReport(", "\nfunction commandRequiresPersonalDataPolicy(", "current composed combined report formatter"), "utf8"));
    return current;
  }
  const normalizeIdentitySource = extractDonorRegion(donorBundle, "function normalizeIdentity(identity) {", "\nfunction conversationKeyFromIdentity(", "identity context validator");
  const storage = new Map();
  const artifactRows = new Map();
  const connectListeners = [];
  const MANUAL_OPERATIONS = "manual_operations";
  const AUTO_RUNS = "auto_runs";

  function fakeRequest(value, transaction) {
    const request = {};
    queueMicrotask(() => {
      request.result = value;
      request.onsuccess?.();
      queueMicrotask(() => transaction.oncomplete?.());
    });
    return request;
  }

  const indexedDB = {
    open() {
      const db = {
        objectStoreNames: { contains: () => true },
        createObjectStore: () => ({}),
        transaction: () => {
          const transaction = {
            oncomplete: null,
            objectStore: () => ({
              get: (key) => fakeRequest(artifactRows.has(String(key)) ? structuredClone(artifactRows.get(String(key))) : undefined, transaction),
              put: (record) => {
                artifactRows.set(String(record.artifact_key), structuredClone(record));
                return fakeRequest(String(record.artifact_key), transaction);
              },
              delete: (key) => {
                artifactRows.delete(String(key));
                return fakeRequest(undefined, transaction);
              },
              getAll: () => fakeRequest([...artifactRows.values()].map((value) => structuredClone(value)), transaction),
            }),
          };
          return transaction;
        },
        close() {},
      };
      const request = { result: db };
      queueMicrotask(() => {
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };

  const chrome = {
    runtime: {
      onConnect: { addListener: (listener) => connectListeners.push(listener) },
    },
    storage: {
      local: {
        async get(key) {
          return { [key]: structuredClone(storage.get(key) || {}) };
        },
        async set(values) {
          for (const [key, value] of Object.entries(values)) storage.set(key, structuredClone(value));
        },
      },
    },
  };

  const context = vm.createContext({
    console,
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    URL,
    Uint8Array,
    ArrayBuffer,
    structuredClone,
    chrome,
    indexedDB,
    OzonRuntime: { STORAGE_KEYS: { MANUAL_OPERATIONS, AUTO_RUNS } },
    ProviderTransportCore: {},
    OzonAIDeliveryCapabilities: {
      adapterIdForOrigin: () => "chatgpt",
      generatedTextDecision: (_adapterId, text) => ({ representation: text.length > 40 ? "text_document" : "plain_text", unicode_chars: [...text].length, threshold: 40 }),
      unicodeLength: (text) => [...String(text)].length,
      utf8ByteLength: (text) => new TextEncoder().encode(String(text)).byteLength,
      profile: () => ({ status: "implemented", attachment_strategy: "file_input_v1", max_files_per_turn: 10 }),
      fileDispatchDecision: () => ({ dispatch_allowed: true, reason: "synthetic_test_fixture" }),
    },
    setTimeout: () => 0,
    clearTimeout: () => {},
  });
  context.globalThis = context;

  vm.runInContext(moduleBytes.get("conversation_identity.js").toString("utf8"), context, { filename: "conversation_identity.js" });
  vm.runInContext(`${normalizeIdentitySource}\nglobalThis.normalizeIdentity = normalizeIdentity;`, context, { filename: "unchanged donor identity context validator" });
  vm.runInContext(moduleBytes.get("attachment-result-integrity.js").toString("utf8"), context, { filename: "attachment-result-integrity.js (worker prelude)" });
  for (const name of ["ozon_operation_registry.js", "ozon_contract.js", "result-recovery.js", "provider-outcome.js", "batch-queue.js", "bridge_autorun_model.js", "file_delivery_model_policy.js", "file_delivery_port_worker.js"])
    vm.runInContext(moduleBytes.get(name).toString("utf8"), context, { filename: name });
  vm.runInContext(moduleBytes.get("attachment-result-integrity.js").toString("utf8"), context, { filename: "attachment-result-integrity.js (worker postload)" });

  const capabilitySummarySource = extractDonorRegion(donorBundle, "function safeBatchCapabilitySummary(", "\nfunction commandRequiresPersonalDataPolicy(", "batch report formatting helpers");
  const querySummarySource = extractDonorRegion(donorBundle, "function safeBatchQueryPlannerSummary(", "\nfunction buildBatchQueryPlan(", "batch query summary");
  const versionMatch = donorBundle.match(/(?:const|var) VERSION\s*=\s*["']([^"']+)["']/);
  assert.ok(versionMatch, "donor service worker exposes its compiled version constant");
  context.VERSION = versionMatch[1];
  context.MANUAL_OPERATION_STATUSES = { REQUESTING: "requesting" };
  context.normalizeConversationKey = (value) => String(value || "").trim().toLowerCase();
  context.assertManualBatchContext = async () => {};
  context.applyPrefixToReport = async (_key, outgoingText) => ({ outgoing_text: outgoingText, report_prefix_applied: false });
  context.diagnostic = async () => {};
  context.attemptManualBatchDelivery = () => {};
  vm.runInContext(`${capabilitySummarySource}\n${querySummarySource}\n${moduleBytes.get("formatCombinedBatchReport.js").toString("utf8")}\n${moduleBytes.get("finalizeManualBatch.js").toString("utf8")}\nglobalThis.__f05FinalizeManualBatch = finalizeManualBatch;\nglobalThis.__f05FormatCombinedReport = formatCombinedBatchReport;`, context, { filename: "composed service-worker finalization and app-owned report formatter" });
  const applicationDeliverySource = moduleBytes.get("application-delivery.js").toString("utf8");
  const applicationDeliveryStart = applicationDeliverySource.indexOf("function saCombinedReport(entries, owner) {");
  assert.notEqual(applicationDeliveryStart, -1, "actual application delivery projection functions are present");
  vm.runInContext(`${applicationDeliverySource.slice(applicationDeliveryStart).trim()}\nglobalThis.saCombinedReport = saCombinedReport;\nglobalThis.saPrepareDelivery = saPrepareDelivery;`, context, { filename: "unchanged application delivery projection functions" });
  context.saEnabled = async () => false;
  vm.runInContext("globalThis.__f05FormatOzonReport = (inputJson) => OzonContract.formatResultReport(JSON.parse(inputJson));", context, { filename: "same-realm Ozon formatter fixture" });

  const api = context.SellerAgentsResultRecovery;
  const outcome = context.SellerAgentsProviderOutcome;
  const now = Date.now();
  const contextData = {
    accountId: "synthetic-account",
    conversationKey: `chatgpt:${fixtureConversationId}`,
    marketplace: "ozon",
    storeId: "synthetic-store",
    bindingId: "synthetic-binding",
    bindingRevision: 1,
    workGeneration: "synthetic-generation",
    workSessionId: "synthetic-generation",
  };
  const freshBuffer = await api.createBuffer({
    logical_execution_id: "fresh-logical",
    provider_attempt_id: "fresh-attempt",
    execution_id: "fresh-execution",
    command_index: 0,
    context: contextData,
    created_at_ms: now,
    expires_at_ms: now + api.TECHNICAL_RETENTION_MS,
    ok: true,
    request_id: "fresh-request",
    operation: "seller_info",
    http_status: 200,
    report_text: "verified report",
    result: { value: 42 },
  }, now);
  assert.equal(freshBuffer.schema_version, 2);
  const knownAttemptStates = [outcome.STATES.RESPONSE_RECEIVED, outcome.STATES.COMPLETED_KNOWN];
  const legacyEntry = {
    kind: "command",
    status: "complete",
    result_phase: "MATERIALIZED",
    provider_attempt_id: "legacy-attempt",
    provider_attempt: { state: knownAttemptStates[1], provider_attempt_id: "legacy-attempt" },
    report_text: "truncated legacy report",
    result_buffer: {
      schema_version: 1,
      phase: "BUFFERED",
      provider_replay_forbidden: true,
      delivery_replay_forbidden: true,
      payload: { report_text: "truncated legacy report", result: { value: 1 } },
    },
  };
  assert.throws(() => context.BridgeAutorunModel.claimDelivery({
    run_id: "legacy-new-claim",
    batch: { entries: [legacyEntry] },
    origin: "https://chatgpt.com",
  }, { deliveryId: "legacy-new-delivery", mode: "batch_watch_v1", outgoingText: "x".repeat(100) }), {
    code: "RESULT_BUFFER_INTEGRITY_UNVERIFIABLE",
  });

  const completeText = "Complete verified report 😀\n" + "full row data\n".repeat(20);
  const freshMaterialized = {
    kind: "command",
    status: "complete",
    result_phase: "MATERIALIZED",
    provider_attempt_id: "fresh-attempt",
    provider_attempt: { state: outcome.STATES.COMPLETED_KNOWN, provider_attempt_id: "fresh-attempt" },
    report_text: "verified report",
    result_buffer: freshBuffer,
  };
  const freshClaim = context.BridgeAutorunModel.claimDelivery({
    run_id: "fresh-run",
    batch: { entries: [freshMaterialized] },
    origin: "https://chatgpt.com",
  }, { deliveryId: "fresh-delivery", mode: "batch_watch_v1", outgoingText: completeText });
  assert.equal(freshClaim.delivery.mode, "attachment_watch_v1", "fresh schema-2 full report remains eligible for attachment delivery");
  assert.equal(freshClaim.delivery.generated_text_document.complete, true);
  assert.equal(freshClaim.delivery.artifact_text, completeText);

  const ownerKey = `chatgpt:${fixtureConversationId}`;
  const baseOwner = {
    conversation_key: ownerKey,
    origin: "https://chatgpt.com",
    conversation_id: fixtureConversationId,
    tab_id: 22,
    status: "delivering",
  };
  storage.set(MANUAL_OPERATIONS, {
    [ownerKey]: {
      ...baseOwner,
      operation_id: "legacy-stale",
      batch: { entries: [legacyEntry] },
      delivery: {
        delivery_id: "legacy-stale-delivery",
        mode: "attachment_watch_v1",
        phase: "attachment_claimed",
        adapter_id: "chatgpt",
        artifact_text: "truncated legacy report",
        generated_text_document: { artifact_id: "legacy-stale-artifact", filename: "legacy.txt", unicode_char_length: 24, byte_length: 24, complete: true },
        provider_file_refs: [],
      },
    },
  });

  function connectedPort(senderOverrides = {}) {
    const responses = [];
    const messageListeners = [];
    const senderUrl = senderOverrides.url || `https://chatgpt.com/c/${fixtureConversationId}`;
    const port = {
      name: "ozon-attachment-delivery-v1",
      sender: { tab: { id: senderOverrides.tabId ?? 22, url: senderUrl }, url: senderUrl },
      onMessage: { addListener: (listener) => messageListeners.push(listener) },
      postMessage: (message) => responses.push(message),
      disconnect() { this.disconnected = true; },
      responses,
      messageListeners,
    };
    for (const listener of connectListeners) listener(port);
    return port;
  }

  async function send(port, message) {
    let resolveResponse;
    const responseWait = new Promise((resolve) => { resolveResponse = resolve; });
    const previousPostMessage = port.postMessage;
    port.postMessage = (value) => {
      previousPostMessage(value);
      if (value?.request_id === message.request_id) resolveResponse(value.response);
    };
    for (const listener of port.messageListeners) listener(message);
    return await Promise.race([
      responseWait,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`attachment request timed out: ${message.type}`)), 2_000)),
    ]);
  }

  const stalePort = connectedPort();
  const staleResponse = await send(stalePort, {
    type: "OZ_ATTACHMENT_COMMIT",
    request_id: "legacy-commit-request",
    conversation_key: ownerKey,
    owner_kind: "manual",
    owner_id: "legacy-stale",
    delivery_id: "legacy-stale-delivery",
    live_owner: { origin: "https://chatgpt.com", conversation_id: fixtureConversationId },
  });
  assert.equal(staleResponse.code, "RESULT_BUFFER_INTEGRITY_UNVERIFIABLE");
  const invalidLegacyContextCases = [
    { name: "wrong-tab", sender: { tabId: 23 }, message: {}, code: "ATTACHMENT_NON_OWNER_TAB" },
    { name: "wrong-origin", sender: { url: `https://other.example/c/${fixtureConversationId}` }, message: {}, code: "ATTACHMENT_ORIGIN_MISMATCH" },
    { name: "wrong-conversation", sender: {}, message: { live_owner: { origin: "https://chatgpt.com", conversation_id: otherConversationId } }, code: "ATTACHMENT_CONVERSATION_MISMATCH" },
    { name: "wrong-delivery-id", sender: {}, message: { delivery_id: "other-delivery" }, code: "ATTACHMENT_DELIVERY_ID_MISMATCH" },
  ];
  for (const [index, scenario] of invalidLegacyContextCases.entries()) {
    const port = connectedPort(scenario.sender);
    const response = await send(port, {
      type: "OZ_ATTACHMENT_COMMIT",
      request_id: `legacy-invalid-context-${index}`,
      conversation_key: ownerKey,
      owner_kind: "manual",
      owner_id: "legacy-stale",
      delivery_id: "legacy-stale-delivery",
      live_owner: { origin: "https://chatgpt.com", conversation_id: fixtureConversationId },
      ...scenario.message,
    });
    assert.equal(response.code, scenario.code, `${scenario.name} is rejected by the unchanged worker authority`);
    assert.notEqual(response.code, "RESULT_BUFFER_INTEGRITY_UNVERIFIABLE", `${scenario.name} cannot learn the legacy result state`);
  }
  assert.equal(artifactRows.size, 0, "the actual built attachment consumer creates no artifact for a legacy partial report");
  assert.equal(storage.get(MANUAL_OPERATIONS)[ownerKey].delivery.phase, "attachment_claimed", "the guard leaves the existing claim intact for diagnosed failure handling");

  const committedLegacyOwner = {
    ...storage.get(MANUAL_OPERATIONS)[ownerKey],
    delivery: { ...storage.get(MANUAL_OPERATIONS)[ownerKey].delivery, phase: "attachment_committed" },
  };
  storage.set(MANUAL_OPERATIONS, { [ownerKey]: committedLegacyOwner });
  const committedPort = connectedPort();
  const committedResponse = await send(committedPort, {
    type: "OZ_ATTACHMENT_COMMIT",
    request_id: "already-attach-committed-request",
    conversation_key: ownerKey,
    owner_kind: "manual",
    owner_id: "legacy-stale",
    delivery_id: "legacy-stale-delivery",
    live_owner: { origin: "https://chatgpt.com", conversation_id: fixtureConversationId },
  });
  assert.equal(committedResponse.code, "ATTACH_OUTCOME_UNKNOWN_NO_RETRY", "an existing attachment commit remains unknown and is never retried");
  assert.equal(artifactRows.size, 0);

  const sendCommittedOwner = {
    ...committedLegacyOwner,
    delivery: { ...committedLegacyOwner.delivery, phase: "attachment_send_committed", attachment_send_actor_id: "previous-actor" },
  };
  storage.set(MANUAL_OPERATIONS, { [ownerKey]: sendCommittedOwner });
  const sendCommittedPort = connectedPort();
  const sendCommittedResponse = await send(sendCommittedPort, {
    type: "OZ_ATTACHMENT_SEND_COMMIT",
    request_id: "already-send-committed-request",
    conversation_key: ownerKey,
    owner_kind: "manual",
    owner_id: "legacy-stale",
    delivery_id: "legacy-stale-delivery",
    actor_id: "synthetic-actor",
    live_owner: { origin: "https://chatgpt.com", conversation_id: fixtureConversationId },
  });
  assert.equal(sendCommittedResponse.click_allowed, false, "an existing send commit never grants another Send click");
  assert.equal(sendCommittedResponse.already_committed, true);

  const legacyArtifactKey = "legacy-incomplete-artifact";
  const legacyArtifactBytes = new TextEncoder().encode("partial legacy body");
  artifactRows.set(legacyArtifactKey, {
    artifact_key: legacyArtifactKey,
    source_kind: "generated_bridge_text",
    filename: "legacy-partial.txt",
    mime_type: "text/plain;charset=utf-8",
    extension: "txt",
    byte_length: legacyArtifactBytes.byteLength,
    sha256: "0".repeat(64),
    bytes: legacyArtifactBytes.buffer,
  });
  const legacyReadyOwner = {
    ...committedLegacyOwner,
    delivery: {
      ...committedLegacyOwner.delivery,
      phase: "attachment_ready",
      artifact_descriptors: [{ artifact_key: legacyArtifactKey, source_kind: "generated_bridge_text", filename: "legacy-partial.txt", mime_type: "text/plain;charset=utf-8", extension: "txt", byte_length: legacyArtifactBytes.byteLength, sha256: "0".repeat(64), complete: true }],
    },
  };
  storage.set(MANUAL_OPERATIONS, { [ownerKey]: legacyReadyOwner });
  const readyPort = connectedPort();
  const readySend = await send(readyPort, {
    type: "OZ_ATTACHMENT_SEND_COMMIT",
    request_id: "legacy-ready-send-request",
    conversation_key: ownerKey,
    owner_kind: "manual",
    owner_id: "legacy-stale",
    delivery_id: "legacy-stale-delivery",
    actor_id: "synthetic-actor",
    live_owner: { origin: "https://chatgpt.com", conversation_id: fixtureConversationId },
  });
  assert.equal(readySend.code, "RESULT_BUFFER_INTEGRITY_UNVERIFIABLE", "legacy READY cannot grant a new Send click");
  assert.equal(readySend.click_allowed, undefined);
  assert.equal(storage.get(MANUAL_OPERATIONS)[ownerKey].delivery.phase, "attachment_ready", "the guard preserves READY for outcome observation");

  const legacyMeta = await send(readyPort, {
    type: "OZ_ATTACHMENT_ARTIFACT_META",
    request_id: "legacy-artifact-meta-request",
    conversation_key: ownerKey,
    owner_kind: "manual",
    owner_id: "legacy-stale",
    delivery_id: "legacy-stale-delivery",
    live_owner: { origin: "https://chatgpt.com", conversation_id: fixtureConversationId },
  });
  assert.equal(legacyMeta.code, "RESULT_BUFFER_INTEGRITY_UNVERIFIABLE");
  assert.equal(legacyMeta.descriptors, undefined, "legacy metadata does not advertise a partial body as complete");
  const legacyChunk = await send(readyPort, {
    type: "OZ_ATTACHMENT_ARTIFACT_CHUNK",
    request_id: "legacy-artifact-chunk-request",
    conversation_key: ownerKey,
    owner_kind: "manual",
    owner_id: "legacy-stale",
    delivery_id: "legacy-stale-delivery",
    live_owner: { origin: "https://chatgpt.com", conversation_id: fixtureConversationId },
    artifact_key: legacyArtifactKey,
    offset: 0,
    length: 1024,
  });
  assert.equal(legacyChunk.code, "RESULT_BUFFER_INTEGRITY_UNVERIFIABLE");
  assert.equal(legacyChunk.chunk_base64, undefined, "legacy partial bytes are never delivered as a complete artifact");
  const legacyRecovery = await send(readyPort, {
    type: "OZ_ATTACHMENT_RECOVERY_GET",
    request_id: "legacy-ready-recovery-request",
    conversation_key: ownerKey,
    owner_kind: "manual",
    owner_id: "legacy-stale",
    live_owner: { origin: "https://chatgpt.com", conversation_id: fixtureConversationId },
  });
  assert.equal(legacyRecovery.recovery.delivery_phase, "attachment_ready", "legacy phase and outcome observation remain available");

  const attachedOwner = {
    ...baseOwner,
    operation_id: "fresh-owner",
    batch: { entries: [freshMaterialized] },
    delivery: { ...freshClaim.delivery, delivery_id: "fresh-built-delivery", phase: "attachment_claimed", adapter_id: "chatgpt" },
  };
  storage.set(MANUAL_OPERATIONS, { [ownerKey]: attachedOwner });
  const freshPort = connectedPort();
  const freshResponse = await send(freshPort, {
    type: "OZ_ATTACHMENT_COMMIT",
    request_id: "fresh-commit-request",
    conversation_key: ownerKey,
    owner_kind: "manual",
    owner_id: "fresh-owner",
    delivery_id: "fresh-built-delivery",
    actor_id: "synthetic-actor",
    live_owner: { origin: "https://chatgpt.com", conversation_id: fixtureConversationId },
  });
  assert.equal(freshResponse.attach_allowed, true);
  assert.equal(freshResponse.recovery.delivery_phase, "attachment_committed");
  const committedOwner = storage.get(MANUAL_OPERATIONS)[ownerKey];
  assert.equal(committedOwner.delivery.phase, "attachment_committed");
  assert.match(committedOwner.delivery.outgoing_text, /"complete":true/);
  const artifactKey = committedOwner.delivery.artifact_descriptors[0].artifact_key;
  const artifact = artifactRows.get(artifactKey);
  assert.equal(artifact.source_kind, "generated_bridge_text");
  assert.equal(Buffer.from(artifact.bytes).toString("utf8"), completeText, "the real artifact consumer materializes the full verified source text");

  const integrationKey = ownerKey;
  const integrationContext = {
    accountId: "synthetic-account",
    conversationKey: integrationKey,
    marketplace: "ozon",
    storeId: "synthetic-store",
    bindingId: "synthetic-binding",
    bindingRevision: 1,
    workGeneration: "synthetic-generation",
    workSessionId: "synthetic-generation",
  };
  const makeFormattedResult = (rowCount) => ({
    rows: Array.from({ length: rowCount }, (_, index) => ({
      description: `позиция 😀\r\n\t${index}-` + "x".repeat(2_000),
      metrics: Array.from({ length: 900 }, (_value, metric) => metric),
    })),
  });
  const formatOzonReport = (result, requestId) => context.__f05FormatOzonReport(JSON.stringify({
    requestId,
    command: { operation: "seller_info", params: {} },
    requestMeta: { host_alias: "seller_api", http_method: "POST", path_alias: "/v1/seller/info", external_request_executed: true },
    httpStatus: 200,
    result,
    elapsedMs: 123,
  }));
  const utf8Bytes = (value) => new TextEncoder().encode(value);
  function extractFormattedReport(text, index, total) {
    const marker = `===== OZON RESULT ${index}/${total} =====`;
    const markerStart = text.indexOf(marker);
    assert.notEqual(markerStart, -1, `combined report contains ${marker}`);
    const bodyStart = markerStart + marker.length + 2;
    const nextMarker = index < total ? text.indexOf(`===== OZON RESULT ${index + 1}/${total} =====`, bodyStart) : -1;
    return text.slice(bodyStart, nextMarker < 0 ? text.length : nextMarker - 2);
  }
  function extractCombinedHeader(text, firstResultCount) {
    const prefix = "OZON_BATCH_RESULT_V1\n\n";
    assert.ok(text.startsWith(prefix), "fallback combined report keeps its established header prefix");
    const marker = `===== OZON RESULT 1/${firstResultCount} =====`;
    const markerStart = text.indexOf(marker, prefix.length);
    assert.notEqual(markerStart, -1, "fallback combined report contains its first result frame");
    return JSON.parse(text.slice(prefix.length, markerStart - 2));
  }
  let activeOwnerRef = null;
  context.getManualOperation = async () => structuredClone(activeOwnerRef.value);
  context.mutateManualOperation = async (_key, mutator) => {
    const current = activeOwnerRef.value;
    const next = mutator(current);
    if (next !== current) activeOwnerRef.value = structuredClone(next);
    storage.set(MANUAL_OPERATIONS, { [integrationKey]: structuredClone(activeOwnerRef.value) });
    return structuredClone(activeOwnerRef.value);
  };

  function integrationOwner(operationId) {
    return {
      ...baseOwner,
      operation_id: operationId,
      status: "requesting",
      execution_context: integrationContext,
      payload_expires_at_ms: Date.now() + 3_600_000,
      batch: {
        next_index: 0,
        request_state: "idle",
        request_worker_session_id: null,
        entries: [{
          kind: "command",
          status: "pending",
          operation: "seller_info",
          command: { operation: "seller_info", params: {} },
          execution_command: { operation: "seller_info", params: {} },
          command_text: "synthetic seller_info report fixture",
          command_fingerprint: `f05-${operationId}`,
          command_index: 0,
        }],
        groups: [],
      },
    };
  }

  function createIntegratedQueue(ownerRef, providerResult, counts, workerId) {
    activeOwnerRef = ownerRef;
    const queue = context.SellerAgentsBatchQueue.create({
      normalizeKey: (value) => String(value || ""),
      singleFlight: (_flights, _key, run) => run(),
      flights: new Map(),
      preparePolicy: async () => ({ ok: true }),
      prepareCapability: async () => ({ ok: true }),
      prepareQueries: async () => ({ ok: true }),
      workerId,
      diagnostic: async () => {},
      guidanceResult: () => ({ report_text: "guidance" }),
      policyErrorResult: () => ({ report_text: "policy" }),
      planningErrorResult: () => ({ report_text: "planning" }),
      findGroup: (batch, groupId) => batch.groups.find((group) => group.group_id === groupId) || null,
      readCache: async () => ({ hit: false }),
      projectGroup: (_member, _group, physical) => physical,
      prepareQuota: async () => ({ required: false, allowed: true, quota: null }),
      groupError: () => ({ report_text: "group-error" }),
      persistQuotaWait: async () => {},
      quotaMetadata: () => null,
      execute: async (_commandText, ports) => {
        counts.providerCalls += 1;
        const value = { ...providerResult, result: structuredClone(providerResult.result) };
        ports.onProviderResponse({ http_status: value.http_status, ok: value.ok, external_request_executed: true });
        await ports.onProviderResult(value);
        return value;
      },
      groupPlanning: () => ({}),
      storeCache: async () => {},
      cachedResult: () => ({ report_text: "cached" }),
      acquisitionPlanning: () => ({}),
      executionError: () => ({ report_text: "execution-error" }),
      projectSingle: (_entry, result) => ({ ...result, report_text: formatOzonReport(result.result, result.request_id) }),
      reviewedAcquisitionProfile: () => ({ applicable: true, profile_id: "fixture" }),
      providerId: "ozon",
      coalescedOperation: "coalesced",
      bridgeErrorCode: "BRIDGE_ERROR",
    });
    const getOwner = async () => structuredClone(ownerRef.value);
    const mutateOwner = async (update) => {
      const current = structuredClone(ownerRef.value);
      const next = update(current);
      assert.equal(next && typeof next.then, "undefined", "production queue storage mutators stay synchronous");
      if (next !== current) ownerRef.value = structuredClone(next);
      storage.set(MANUAL_OPERATIONS, { [integrationKey]: structuredClone(ownerRef.value) });
      return structuredClone(ownerRef.value);
    };
    return () => queue.process({
      conversationKey: integrationKey,
      ownerKind: "manual",
      ownerId: ownerRef.value.operation_id,
      getOwner,
      mutateOwner,
      ownerMatches: (owner) => owner?.operation_id === ownerRef.value.operation_id,
      isCollecting: (owner) => owner?.status === "requesting",
      failOwner: async (code) => {
        counts.failures.push(code);
        ownerRef.value = { ...ownerRef.value, status: "failed", last_error: { code } };
        storage.set(MANUAL_OPERATIONS, { [integrationKey]: structuredClone(ownerRef.value) });
      },
      finalizeOwner: async (owner, entries) => {
        counts.finalizations += 1;
        return context.__f05FinalizeManualBatch(integrationKey, ownerRef.value.operation_id, entries, owner?.batch || null);
      },
    });
  }

  async function runIntegratedReport(rowCount, operationId) {
    const providerResult = {
      ok: true,
      request_id: `${operationId}-provider-result`,
      operation: "seller_info",
      http_status: 200,
      external_request_executed: true,
      report_text: "",
      result: makeFormattedResult(rowCount),
    };
    providerResult.report_text = formatOzonReport(providerResult.result, providerResult.request_id);
    const counts = { providerCalls: 0, finalizations: 0, failures: [] };
    const ownerRef = { value: structuredClone(integrationOwner(operationId)) };
    const initialProcess = createIntegratedQueue(ownerRef, providerResult, counts, `${operationId}-before-restart`);
    let resumeAfterBuffer;
    const bufferCommitted = new Promise((resolve) => { resumeAfterBuffer = resolve; });
    context.__SELLER_AGENTS_TEST_HOOKS = { afterResultBufferCommit: async () => { resumeAfterBuffer(); return new Promise(() => {}); } };
    void initialProcess();
    await bufferCommitted;

    const stoppedEntry = ownerRef.value.batch.entries[0];
    assert.equal(counts.providerCalls, 1, "the actual queue reached its post-buffer stop hook after one provider call");
    assert.equal(stoppedEntry.status, "requesting");
    assert.equal(stoppedEntry.result_buffer.phase, "BUFFERED");
    assert.equal(stoppedEntry.result_buffer.schema_version, 2);
    assert.equal(stoppedEntry.result_buffer.payload.report_text, providerResult.report_text, "the frozen Ozon formatter report is persisted byte-for-byte");
    assert.equal(JSON.stringify(stoppedEntry.result_buffer.payload.result), JSON.stringify(providerResult.result), "the full formatter result is persisted with the report");
    assert.equal(Object.isFrozen(stoppedEntry.result_buffer), false, "synthetic storage persists a mutable structured clone");
    const reportBytes = utf8Bytes(providerResult.report_text).byteLength;
    const bufferBytes = utf8Bytes(JSON.stringify(stoppedEntry.result_buffer)).byteLength;
    assert.ok(reportBytes > 8_388_608, "the actual formatter report exceeds the former 8 MiB report limit");
    assert.ok(bufferBytes <= api.MAX_BUFFER_BYTES, "the complete report and full result fit under the 16 MiB serialized-buffer limit");
    assert.equal((await api.validateBuffer(stoppedEntry.result_buffer)).valid, true);

    context.__SELLER_AGENTS_TEST_HOOKS = undefined;
    storage.set(MANUAL_OPERATIONS, { [integrationKey]: structuredClone(ownerRef.value) });
    const restartProcess = createIntegratedQueue(ownerRef, providerResult, counts, `${operationId}-after-restart`);
    const recovered = await restartProcess();
    assert.equal(recovered.ok, true);
    assert.equal(recovered.collected, true, "the unchanged service-worker finalizer claims the recovered completed report");
    assert.equal(counts.providerCalls, 1, "restart materializes locally without another provider call");
    assert.equal(counts.finalizations, 1);
    assert.deepEqual(counts.failures, []);

    const completedOwner = storage.get(MANUAL_OPERATIONS)[integrationKey];
    assert.equal(completedOwner.status, "delivering");
    assert.equal(completedOwner.batch.entries[0].status, "complete");
    assert.equal(completedOwner.batch.entries[0].result_phase, "MATERIALIZED");
    assert.equal(completedOwner.batch.entries[0].report_text, providerResult.report_text, "recovery projection preserves the exact business report");
    const expectedCompleteBusinessReport = completedOwner.delivery.artifact_text;
    assert.equal(extractFormattedReport(expectedCompleteBusinessReport, 1, 1), providerResult.report_text, "fallback framing retains the actual large Ozon report byte-for-byte");
    assert.equal(extractCombinedHeader(expectedCompleteBusinessReport, 1).result_count, 1, "fallback header reports the complete result count");
    assert.equal(completedOwner.delivery.mode, "attachment_watch_v1");
    assert.equal(completedOwner.delivery.phase, "attachment_claimed");
    assert.equal(completedOwner.delivery.artifact_text, expectedCompleteBusinessReport);
    assert.equal(completedOwner.delivery.generated_text_document.complete, true);
    assert.equal(completedOwner.delivery.generated_text_document.byte_length, utf8Bytes(expectedCompleteBusinessReport).byteLength);
    assert.ok(utf8Bytes(expectedCompleteBusinessReport).byteLength > 8_388_608);

    const port = connectedPort();
    const message = {
      conversation_key: integrationKey,
      owner_kind: "manual",
      owner_id: operationId,
      delivery_id: completedOwner.delivery.delivery_id,
      live_owner: { origin: "https://chatgpt.com", conversation_id: fixtureConversationId },
    };
    const committed = await send(port, { ...message, type: "OZ_ATTACHMENT_COMMIT", request_id: `${operationId}-commit` });
    assert.equal(committed.attach_allowed, true, "the composed actual consumer allows a fresh schema-2 attachment");
    assert.equal(committed.recovery.delivery_phase, "attachment_committed");
    const meta = await send(port, { ...message, type: "OZ_ATTACHMENT_ARTIFACT_META", request_id: `${operationId}-meta` });
    assert.equal(meta.ok, true);
    assert.equal(meta.descriptors.length, 1);
    const descriptor = meta.descriptors[0];
    const chunkSize = context.OzonFileDeliveryWorker.MAX_CHUNK_BYTES;
    const chunks = [];
    let offset = 0;
    while (offset < descriptor.byte_length) {
      const chunk = await send(port, {
        ...message,
        type: "OZ_ATTACHMENT_ARTIFACT_CHUNK",
        request_id: `${operationId}-chunk-${offset}`,
        artifact_key: descriptor.artifact_key,
        offset,
        length: chunkSize,
      });
      assert.equal(chunk.ok, true);
      assert.equal(chunk.offset, offset);
      assert.equal(chunk.total_byte_length, descriptor.byte_length);
      chunks.push(Buffer.from(chunk.chunk_base64, "base64"));
      offset += chunk.byte_length;
      assert.equal(chunk.eof, offset >= descriptor.byte_length);
    }
    assert.equal(chunks.length, Math.ceil(descriptor.byte_length / chunkSize), "every actual attachment chunk is fetched exactly once");
    const deliveredBytes = Buffer.concat(chunks);
    const expectedBytes = Buffer.from(expectedCompleteBusinessReport, "utf8");
    assert.deepEqual(deliveredBytes, expectedBytes, "actual worker chunks reconstruct the exact completed business report UTF-8 bytes");
    assert.equal(createHash("sha256").update(deliveredBytes).digest("hex"), descriptor.sha256);
    assert.equal(createHash("sha256").update(expectedBytes).digest("hex"), descriptor.sha256);
    const storedArtifact = artifactRows.get(descriptor.artifact_key);
    assert.equal(storedArtifact.source_kind, "generated_bridge_text");
    assert.equal(Buffer.from(storedArtifact.bytes).toString("utf8"), expectedCompleteBusinessReport);
    return { reportBytes, bufferBytes, attachmentBytes: deliveredBytes.byteLength, chunkCount: chunks.length };
  }

  async function runFallbackFidelityCases() {
    const operationId = "f05-fallback-byte-fidelity";
    const groupId = "f05-fallback-group";
    const reportCases = [
      { report: "", label: "empty" },
      { report: " \t\r\n  \r\n", label: "whitespace-crlf" },
      { report: "  🛍️ Unicode 😀 with margin\r\nline  \n ", label: "unicode-margin" },
      { report: "[GROUP member 1]\r\n  ", label: "group-first", group: true },
      { report: "\t[GROUP member 2]  \n", label: "group-second", group: true },
    ];
    const currentTime = Date.now();
    const entries = [];
    for (const [index, item] of reportCases.entries()) {
      const providerAttemptId = `fallback-attempt-${index}`;
      const physicalRequestId = item.group ? "fallback-physical-group" : `fallback-physical-${index}`;
      const resultBuffer = await api.createBuffer({
        logical_execution_id: `fallback-logical-${index}`,
        provider_attempt_id: providerAttemptId,
        execution_id: `fallback-execution-${index}`,
        command_index: index,
        projection_kind: item.group ? "physical" : "single",
        context: integrationContext,
        created_at_ms: currentTime,
        expires_at_ms: currentTime + api.TECHNICAL_RETENTION_MS,
        ok: true,
        request_id: physicalRequestId,
        operation: item.group ? "analytics_data" : "seller_info",
        http_status: 200,
        report_text: item.report,
        result: { label: item.label, rows: [index] },
      }, currentTime);
      assert.equal(resultBuffer.phase, "BUFFERED", `${item.label} fixture has a complete schema-2 result buffer`);
      entries.push({
        kind: "command",
        status: "complete",
        result_phase: "MATERIALIZED",
        provider_attempt_id: providerAttemptId,
        provider_attempt: { state: outcome.STATES.COMPLETED_KNOWN, provider_attempt_id: providerAttemptId },
        request_id: physicalRequestId,
        physical_request_id: physicalRequestId,
        command_index: index,
        query_group_id: item.group ? groupId : null,
        report_text: item.report,
        result_buffer: resultBuffer,
        external_request_executed: true,
      });
    }
    entries.push({ kind: "policy_error", status: "complete", report_text: null, external_request_executed: false });
    entries.push({ kind: "pre_execution_error", status: "complete", external_request_executed: false });
    const groups = [{ group_id: groupId, leader_index: 3, member_indexes: [3, 4], physical_command_fingerprint: "fallback-group-fingerprint" }];
    const owner = {
      ...baseOwner,
      operation_id: operationId,
      status: "requesting",
      created_at: new Date(currentTime).toISOString(),
      execution_context: integrationContext,
      payload_expires_at_ms: currentTime + 3_600_000,
      batch: {
        next_index: entries.length,
        request_state: "idle",
        query_planning_state: "complete",
        query_plan: { groups },
        entries,
        groups,
      },
    };
    activeOwnerRef = { value: structuredClone(owner) };
    storage.set(MANUAL_OPERATIONS, { [integrationKey]: structuredClone(owner) });
    const finalized = await context.__f05FinalizeManualBatch(integrationKey, operationId, entries, owner.batch);
    assert.equal(finalized.ok, true, "the actual composed finalizer claims mixed empty, whitespace, Unicode and group reports");
    assert.equal(finalized.collected, true);
    const claimedOwner = storage.get(MANUAL_OPERATIONS)[integrationKey];
    assert.equal(claimedOwner.delivery.mode, "attachment_watch_v1");
    assert.equal(claimedOwner.delivery.phase, "attachment_claimed");
    const artifactText = claimedOwner.delivery.artifact_text;
    const header = extractCombinedHeader(artifactText, reportCases.length);
    assert.equal(header.result_count, reportCases.length, "only absent/null reports are skipped; empty and whitespace reports count");
    assert.equal(header.bridge, "ozon-llm-api-bridge");
    assert.equal(header.delivery_mode, "sequential_batch_single_delivery");
    assert.equal(header.query_planner.coalesced_group_count, 1, "existing grouped-query header metadata remains intact");
    assert.equal(header.query_planner.coalesced_logical_count, 2);
    assert.equal(header.query_planner.logical_business_result_count, reportCases.length);
    assert.equal(header.query_planner.physical_business_request_count, 4);
    for (const [index, item] of reportCases.entries()) {
      const actual = extractFormattedReport(artifactText, index + 1, reportCases.length);
      assert.deepEqual(utf8Bytes(actual), utf8Bytes(item.report), `${item.label} report bytes survive the actual fallback finalizer`);
    }
    assert.equal(artifactText.includes("===== OZON RESULT 6/"), false, "null and absent report_text values do not create result frames");

    const message = {
      conversation_key: integrationKey,
      owner_kind: "manual",
      owner_id: operationId,
      delivery_id: claimedOwner.delivery.delivery_id,
      live_owner: { origin: "https://chatgpt.com", conversation_id: fixtureConversationId },
    };
    const port = connectedPort();
    const committed = await send(port, { ...message, type: "OZ_ATTACHMENT_COMMIT", request_id: `${operationId}-commit` });
    assert.equal(committed.attach_allowed, true, "the actual attachment consumer accepts the fallback finalizer artifact");
    const meta = await send(port, { ...message, type: "OZ_ATTACHMENT_ARTIFACT_META", request_id: `${operationId}-meta` });
    assert.equal(meta.ok, true);
    assert.equal(meta.descriptors.length, 1);
    const descriptor = meta.descriptors[0];
    const chunk = await send(port, {
      ...message,
      type: "OZ_ATTACHMENT_ARTIFACT_CHUNK",
      request_id: `${operationId}-chunk-0`,
      artifact_key: descriptor.artifact_key,
      offset: 0,
      length: descriptor.byte_length,
    });
    assert.equal(chunk.ok, true);
    const artifactBytes = Buffer.from(chunk.chunk_base64, "base64");
    assert.deepEqual(artifactBytes, Buffer.from(artifactText, "utf8"), "actual worker artifact bytes equal the complete finalized fallback report");
    assert.equal(createHash("sha256").update(artifactBytes).digest("hex"), descriptor.sha256);
    return { reportCount: header.result_count, artifactBytes: artifactBytes.byteLength, sha256: descriptor.sha256 };
  }

  const integrated = await runIntegratedReport(600, "f05-integrated-full-report");
  const fallbackFidelity = await runFallbackFidelityCases();

  const oversizeResult = {
    ok: true,
    request_id: "f05-integrated-oversize-provider-result",
    operation: "seller_info",
    http_status: 200,
    external_request_executed: true,
    report_text: "",
    result: makeFormattedResult(1_000),
  };
  oversizeResult.report_text = formatOzonReport(oversizeResult.result, oversizeResult.request_id);
  const oversizeCounts = { providerCalls: 0, finalizations: 0, failures: [] };
  const oversizeOwnerRef = { value: structuredClone(integrationOwner("f05-integrated-oversize")) };
  const oversizeInitial = createIntegratedQueue(oversizeOwnerRef, oversizeResult, oversizeCounts, "f05-integrated-oversize-before-restart");
  let oversizeResume;
  const oversizeCommitted = new Promise((resolve) => { oversizeResume = resolve; });
  context.__SELLER_AGENTS_TEST_HOOKS = { afterResultBufferCommit: async () => { oversizeResume(); return new Promise(() => {}); } };
  void oversizeInitial();
  await oversizeCommitted;
  assert.equal(oversizeOwnerRef.value.batch.entries[0].result_buffer.phase, "UNAVAILABLE");
  assert.equal(oversizeOwnerRef.value.batch.entries[0].result_buffer.unavailable_code, "RESULT_BUFFER_TOO_LARGE");
  assert.equal(oversizeOwnerRef.value.batch.entries[0].result_buffer.payload, undefined);
  assert.ok(utf8Bytes(oversizeResult.report_text).byteLength > 8_388_608);
  const artifactsBeforeOversizeRestart = artifactRows.size;
  context.__SELLER_AGENTS_TEST_HOOKS = undefined;
  const oversizeRestart = createIntegratedQueue(oversizeOwnerRef, oversizeResult, oversizeCounts, "f05-integrated-oversize-after-restart");
  const oversizeRecovery = await oversizeRestart();
  assert.equal(oversizeRecovery.code, "RESULT_BUFFER_TOO_LARGE");
  assert.deepEqual(oversizeCounts.failures, ["RESULT_BUFFER_TOO_LARGE"]);
  assert.equal(oversizeCounts.providerCalls, 1, "oversized known results remain unavailable and are never replayed");
  assert.equal(oversizeCounts.finalizations, 0, "oversized unavailable results cannot reach delivery finalization");
  assert.equal(artifactRows.size, artifactsBeforeOversizeRestart, "oversized unavailable results create no attachment artifact");

  const afterHashes = Object.fromEntries([...currentModuleBytes()].map(([name, bytes]) => [name, createHash("sha256").update(bytes).digest("hex")]));
  assert.deepEqual(afterHashes, sourceHashes, "source and built module bytes remain stable during this run");
  console.log(JSON.stringify({
    status: "PASS",
    runtime: process.version,
    source_transforms: 0,
    source_sha256: sourceHashes,
    consumer_artifact: sourceMode ? "SOURCE" : "BUILT_RUNTIME",
    scope: "offline actual result-recovery/batch-queue, app-owned composed finalizer and fallback formatter, integrity guard, and attachment port consumer; synthetic storage/provider ports only; no browser, network, install, or live owner",
    checks: [
      "fresh-schema2-claim-creates-complete-text-document",
      "legacy-claim-ready-send-metadata-and-chunk-denied-without-context-disclosure",
      "wrong-tab-origin-conversation-and-delivery-id-forwarded-to-donor-rejection",
      "attachment-committed-outcome-unknown-and-send-committed-fence-preserved",
      "fresh-schema2-attachment-commit-materializes-full-exact-text",
      "actual-fallback-finalize-artifact-preserves-empty-whitespace-crlf-unicode-mixed-groups-and-header-count",
      "actual-ozon-large-report-full-result-queue-buffer-restart-finalize-attachment-all-chunks-utf8-sha256",
      "actual-ozon-oversize-buffer-unavailable-no-finalization-no-artifact-no-replay",
    ],
    legacy_partial_body_disclosed: false,
    fresh_artifact_bytes: Buffer.from(artifact.bytes).byteLength,
    integrated_report_bytes: integrated.reportBytes,
    integrated_buffer_bytes: integrated.bufferBytes,
    integrated_attachment_bytes: integrated.attachmentBytes,
    integrated_chunk_count: integrated.chunkCount,
    fallback_fidelity: fallbackFidelity,
    browser_or_installed_acceptance: "NOT_TESTED",
  }));
}

await main();
