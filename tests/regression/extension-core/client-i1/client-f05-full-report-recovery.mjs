import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createHash, randomUUID, webcrypto } from "node:crypto";

async function main() {
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw new Error("F-05 raw-source regression requires Node.js 24 or newer; production bytes are never rewritten for older parsers.");

  const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(".");
  const sourcePaths = [
    "packages/bridge-core/src/execution/result-recovery.js",
    "packages/bridge-core/src/execution/provider-outcome.js",
    "packages/bridge-core/src/execution/batch-queue.js",
    "apps/extension/src/background/context/manualRecoveryForContent.js",
    "apps/extension/src/background/context/commitManualBatchDeliveryInsert.js",
    "apps/extension/src/imported/ozon-v0.1.22/shared/ozon_operation_registry.js",
    "apps/extension/src/imported/ozon-v0.1.22/shared/ozon_contract.js",
  ];
  const sourceHashes = {};
  const context = vm.createContext({
    console,
    TextEncoder,
    Uint8Array,
    structuredClone,
    crypto: { subtle: webcrypto.subtle, randomUUID },
    setTimeout,
    clearTimeout,
  });
  context.globalThis = context;
  for (const relativePath of sourcePaths) {
    const bytes = fs.readFileSync(path.join(root, relativePath));
    sourceHashes[relativePath] = createHash("sha256").update(bytes).digest("hex");
    vm.runInContext(bytes.toString("utf8"), context, { filename: relativePath });
  }
  vm.runInContext("globalThis.__f05FormatOzonReport = (inputJson) => OzonContract.formatResultReport(JSON.parse(inputJson));", context, { filename: "same-realm Ozon formatter fixture" });

  const api = context.SellerAgentsResultRecovery;
  const outcome = context.SellerAgentsProviderOutcome;
  const encoder = new TextEncoder();
  const now = 1_800_000_000_000;
  const contextData = {
    accountId: "acct",
    conversationKey: "chatgpt:fixture",
    marketplace: "ozon",
    storeId: "store",
    bindingId: "binding",
    bindingRevision: 3,
    workGeneration: "authority-generation",
    workSessionId: "generation",
  };
  const base = {
    logical_execution_id: "logical",
    provider_attempt_id: "attempt",
    execution_id: "execution",
    command_index: 0,
    context: contextData,
    created_at_ms: now,
    expires_at_ms: now + api.TECHNICAL_RETENTION_MS,
    ok: true,
    request_id: "request",
    operation: "seller_info",
    http_status: 200,
  };
  const bytes = (value) => encoder.encode(value).byteLength;
  const serializedBytes = (value) => bytes(JSON.stringify(value));
  const knownAttempt = { state: outcome.STATES.RESPONSE_RECEIVED, provider_attempt_id: "attempt" };

  async function requireHookBeforeProcessSettles(label, hookWait, processPromise) {
    const outcome = await Promise.race([
      hookWait.then(() => ({ kind: "hook" })),
      processPromise.then(
        (value) => ({ kind: "resolved", value }),
        (error) => ({ kind: "rejected", error }),
      ),
    ]);
    if (outcome.kind === "hook") return;
    if (outcome.kind === "rejected") throw new Error(`${label} queue rejected before its stop hook`, { cause: outcome.error });
    throw new Error(`${label} queue settled before its stop hook: ${JSON.stringify(outcome.value)}`);
  }

  const formattedOzonResult = (rowCount) => ({
    rows: Array.from({ length: rowCount }, (_, index) => ({
      description: `item-${index}-` + "x".repeat(2_000),
      metrics: Array.from({ length: 900 }, (_, metric) => metric),
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

  const exactText = "  first\r\nsecond\n\tтекст 😀  \r\n";
  const exactBuffer = await api.createBuffer({ ...base, report_text: exactText, result: { value: 1 } }, now);
  assert.equal(exactBuffer.phase, api.RESULT_PHASES.BUFFERED);
  assert.equal(exactBuffer.payload.report_text, exactText, "report_text must preserve whitespace, CRLF/LF, tabs and Unicode exactly");
  assert.equal(exactBuffer.payload.report_text.length, exactText.length);
  assert.equal(exactBuffer.integrity.report_text_bytes, bytes(exactText));
  assert.equal((await api.validateBuffer(exactBuffer)).valid, true);
  const emptyBuffer = await api.createBuffer({ ...base, report_text: "", result: { value: 1 } }, now);
  assert.equal(emptyBuffer.phase, api.RESULT_PHASES.BUFFERED);
  assert.equal(emptyBuffer.payload.report_text, "", "empty string is valid report data");

  const sublimitText = "s".repeat(9_000_000);
  const sublimit = await api.createBuffer({ ...base, report_text: sublimitText, result: { value: 1 } }, now);
  assert.equal(sublimit.phase, api.RESULT_PHASES.BUFFERED, "reports above the former 8 Mi-character limit remain recoverable when the complete payload fits");
  assert.equal(sublimit.payload.report_text, sublimitText);
  assert.equal((await api.recoveryDecision({ providerAttempt: knownAttempt, resultBuffer: sublimit, currentContext: contextData, now })).type, "resume_local_result");

  const completeOzonResult = formattedOzonResult(700);
  const completeOzonReport = formatOzonReport(completeOzonResult, "complete-ozon-report");
  const completeOzonBuffer = await api.createBuffer({ ...base, report_text: completeOzonReport, result: completeOzonResult }, now);
  assert.ok(bytes(completeOzonReport) > 8_388_608, "the actual Ozon formatter report exceeds the former 8 MiB cap");
  assert.equal(completeOzonBuffer.phase, api.RESULT_PHASES.BUFFERED, "the complete report and full result fit below the 16 MiB serialized cap");
  assert.ok(serializedBytes(completeOzonBuffer) <= api.MAX_BUFFER_BYTES);
  assert.equal(completeOzonBuffer.payload.report_text, completeOzonReport);
  assert.equal((await api.validateBuffer(completeOzonBuffer)).valid, true);
  assert.equal((await api.recoveryDecision({ providerAttempt: knownAttempt, resultBuffer: completeOzonBuffer, currentContext: contextData, now })).type, "resume_local_result");

  const oversizeOzonResult = formattedOzonResult(1_000);
  const oversizeOzonReport = formatOzonReport(oversizeOzonResult, "oversize-ozon-report");
  const oversizeOzonBuffer = await api.createBuffer({ ...base, report_text: oversizeOzonReport, result: oversizeOzonResult }, now);
  assert.ok(bytes(oversizeOzonReport) > 8_388_608, "the actual oversized Ozon report exceeds the former cap");
  assert.equal(oversizeOzonBuffer.phase, api.RESULT_PHASES.UNAVAILABLE);
  assert.equal(oversizeOzonBuffer.unavailable_code, "RESULT_BUFFER_TOO_LARGE");
  assert.equal(oversizeOzonBuffer.payload, undefined, "oversize complete data must not be retained partially");
  const oversizeOzonDecision = await api.recoveryDecision({ providerAttempt: knownAttempt, resultBuffer: oversizeOzonBuffer, currentContext: contextData, now });
  assert.equal(oversizeOzonDecision.type, "blocked");
  assert.equal(oversizeOzonDecision.code, "RESULT_BUFFER_TOO_LARGE");
  assert.equal(oversizeOzonBuffer.provider_replay_forbidden, true);

  const wrongType = await api.createBuffer({ ...base, report_text: 7, result: {} }, now);
  assert.equal(wrongType.phase, api.RESULT_PHASES.UNAVAILABLE);
  assert.equal(wrongType.unavailable_code, "RESULT_BUFFER_REPORT_TEXT_INVALID");

  const boundarySeed = await api.createBuffer({ ...base, report_text: "😀", result: { blob: "" } }, now);
  assert.equal(boundarySeed.phase, api.RESULT_PHASES.BUFFERED);
  const oldPayloadBytes = boundarySeed.integrity.payload_bytes;
  const oldDigitCount = String(oldPayloadBytes).length;
  const boundaryBlobBytes = api.MAX_BUFFER_BYTES - serializedBytes(boundarySeed) - (8 - oldDigitCount);
  const exactBoundary = await api.createBuffer({ ...base, report_text: "😀", result: { blob: "x".repeat(boundaryBlobBytes) } }, now);
  assert.equal(exactBoundary.phase, api.RESULT_PHASES.BUFFERED);
  assert.equal(serializedBytes(exactBoundary), api.MAX_BUFFER_BYTES, "the exact 16 MiB serialized-buffer boundary is accepted");
  assert.equal(exactBoundary.payload.report_text, "😀", "the exact boundary includes multibyte report text");
  const overBoundary = await api.createBuffer({ ...base, report_text: "😀", result: { blob: "x".repeat(boundaryBlobBytes + 1) } }, now);
  assert.equal(overBoundary.phase, api.RESULT_PHASES.UNAVAILABLE);
  assert.equal(overBoundary.unavailable_code, "RESULT_BUFFER_TOO_LARGE");

  const makeTampered = async () => JSON.parse(JSON.stringify(await api.createBuffer({ ...base, report_text: "complete report", result: { nested: { value: 1 } } }, now)));
  const truncated = await makeTampered();
  truncated.payload.report_text = truncated.payload.report_text.slice(0, -1);
  assert.equal((await api.validateBuffer(truncated)).code, "RESULT_BUFFER_INTEGRITY_MISMATCH");
  assert.equal((await api.recoveryDecision({ providerAttempt: knownAttempt, resultBuffer: truncated, currentContext: contextData, now })).code, "RESULT_BUFFER_INTEGRITY_MISMATCH");
  const altered = await makeTampered();
  altered.payload.result.nested.value = 2;
  assert.equal((await api.validateBuffer(altered)).code, "RESULT_BUFFER_INTEGRITY_MISMATCH");
  const alteredDigest = await makeTampered();
  alteredDigest.integrity.report_text_sha256 = "0".repeat(64);
  assert.equal((await api.validateBuffer(alteredDigest)).code, "RESULT_BUFFER_INTEGRITY_MISMATCH");
  const structurallyCorrupt = await makeTampered();
  structurallyCorrupt.payload = null;
  assert.equal((await api.validateBuffer(structurallyCorrupt)).code, "RESULT_BUFFER_INTEGRITY_MISMATCH");
  const legacy = await makeTampered();
  legacy.schema_version = 1;
  delete legacy.integrity;
  assert.equal((await api.validateBuffer(legacy)).code, "RESULT_BUFFER_INTEGRITY_UNVERIFIABLE");
  assert.equal((await api.recoveryDecision({ providerAttempt: knownAttempt, resultBuffer: legacy, currentContext: contextData, now })).code, "RESULT_BUFFER_INTEGRITY_UNVERIFIABLE");
  assert.equal(api.isLegacyBufferedResult(legacy), true);
  assert.equal(api.isLegacyBufferedResult(exactBuffer), false);
  assert.equal(api.matchesValidatedSnapshot(exactBuffer, JSON.stringify(exactBuffer)), true);
  assert.equal(api.matchesValidatedSnapshot(truncated, JSON.stringify(exactBuffer)), false);
  assert.equal((await api.recoveryDecision({
    providerAttempt: { ...knownAttempt, provider_attempt_id: "different-attempt" },
    resultBuffer: exactBuffer,
    currentContext: contextData,
    now,
  })).code, "RESULT_BUFFER_ATTEMPT_MISMATCH");

  function clone(value) {
    return structuredClone(value);
  }

  function ownerFor(entries, nextIndex = 0, options = {}) {
    const ownerContext = { ...contextData };
    return {
      operation_id: options.operationId || "owner",
      conversation_key: contextData.conversationKey,
      status: "collecting",
      execution_context: ownerContext,
      payload_expires_at_ms: options.payloadExpiresAt ?? now + 3_600_000,
      batch: {
        next_index: nextIndex,
        request_state: options.requestState || "requesting",
        request_worker_session_id: options.workerId || "stopped-worker",
        query_planning_state: Array.isArray(options.groups) && options.groups.length ? "complete" : "not_planned",
        entries,
        groups: options.groups || [],
      },
    };
  }

  function createQueueHarness(ownerRef, options = {}) {
    let finalizations = 0;
    const failures = [];
    const diagnostics = [];
    const queue = context.SellerAgentsBatchQueue.create({
      normalizeKey: (value) => String(value || ""),
      singleFlight: (_flights, _key, run) => run(),
      flights: new Map(),
      preparePolicy: async () => ({ ok: true }),
      prepareCapability: async () => ({ ok: true }),
      prepareQueries: async () => ({ ok: true }),
      workerId: options.workerId || "restart-worker",
      diagnostic: async (event, detail) => diagnostics.push({ event, detail }),
      guidanceResult: () => ({ report_text: "guidance" }),
      policyErrorResult: () => ({ report_text: "policy" }),
      planningErrorResult: () => ({ report_text: "planning" }),
      findGroup: (batch, groupId) => batch.groups.find((group) => group.group_id === groupId) || null,
      readCache: async () => ({ hit: false }),
      projectGroup: options.projectGroup || ((member, group, physical) => ({
        ok: true,
        request_id: `logical-${member.command_index}`,
        physical_request_id: physical.request_id,
        report_text: `GROUP-${group.group_id}-${member.command_index}:${physical.report_text}`,
        external_request_executed: true,
      })),
      prepareQuota: async () => ({ required: false, allowed: true, quota: null }),
      groupError: () => ({ report_text: "group-error" }),
      persistQuotaWait: async () => {},
      quotaMetadata: () => null,
      execute: options.execute || (async () => { throw new Error("Unexpected provider call in recovery test"); }),
      groupPlanning: () => ({}),
      storeCache: async () => {},
      cachedResult: () => ({ report_text: "cached" }),
      acquisitionPlanning: () => ({}),
      executionError: () => ({ report_text: "execution-error" }),
      projectSingle: options.projectSingle || ((_entry, result) => ({ ...result, report_text: `PROJECTED:${result.report_text}` })),
      reviewedAcquisitionProfile: options.reviewedAcquisitionProfile || (() => ({ applicable: true, profile_id: "fixture" })),
      providerId: "ozon",
      coalescedOperation: "coalesced",
      bridgeErrorCode: "BRIDGE_ERROR",
    });
    const ownerId = ownerRef.value.operation_id;
    const process = () => queue.process({
      conversationKey: contextData.conversationKey,
      ownerKind: "manual",
      ownerId,
      getOwner: async () => options.sharedOwner ? ownerRef.value : clone(ownerRef.value),
      mutateOwner: async (update) => {
        if (options.beforeMutation) {
          const beforeMutation = options.beforeMutation;
          options.beforeMutation = null;
          beforeMutation(ownerRef.value);
        }
        const current = ownerRef.value;
        const next = update(current);
        assert.equal(next && typeof next.then, "undefined", "storage mutation callback remains synchronous");
        if (next !== current) ownerRef.value = next;
        return ownerRef.value;
      },
      ownerMatches: (owner) => owner?.operation_id === ownerId,
      isCollecting: (owner) => owner?.status === "collecting",
      failOwner: async (code) => {
        failures.push(code);
        ownerRef.value = { ...ownerRef.value, status: "failed", last_error: { code } };
      },
      finalizeOwner: async () => {
        finalizations += 1;
        return { ok: true, code: "SYNTHETIC_FINALIZE_CALLED" };
      },
    });
    return { process, failures, diagnostics, get finalizations() { return finalizations; } };
  }

  async function bufferedEntry(id, index, report, resultValue, projectionKind = "single", queryGroupId = null) {
    const providerAttemptId = id;
    const resultBuffer = clone(await api.createBuffer({
      ...base,
      logical_execution_id: `logical-${index}`,
      provider_attempt_id: providerAttemptId,
      command_index: index,
      projection_kind: projectionKind,
      report_text: report,
      result: resultValue,
    }, now));
    assert.equal(resultBuffer.phase, api.RESULT_PHASES.BUFFERED);
    return {
      kind: "command",
      status: "requesting",
      provider_attempt_id: providerAttemptId,
      provider_attempt: {
        ...knownAttempt,
        provider_attempt_id: providerAttemptId,
        logical_execution_id: `logical-${index}`,
        execution_id: "execution",
        command_index: index,
      },
      command_index: index,
      command: { operation: "seller_info" },
      execution_command: { operation: "seller_info" },
      query_group_id: queryGroupId,
      result_buffer: resultBuffer,
      result_phase: "BUFFERED",
    };
  }

  const legacyPayload = { ok: true, report_text: "original business report", result: { value: 1 } };
  const legacyBuffer = {
    schema_version: 1,
    phase: "BUFFERED",
    result_buffer_id: "legacy-buffer",
    logical_execution_id: "legacy-logical",
    provider_attempt_id: "legacy-attempt",
    execution_id: "legacy-execution",
    command_index: 0,
    projection_kind: "single",
    context: contextData,
    created_at_ms: now,
    expires_at_ms: now + 3_600_000,
    payload: legacyPayload,
    provider_replay_forbidden: true,
    delivery_replay_forbidden: true,
  };
  function legacyMaterializedEntry() {
    return {
      kind: "command",
      status: "complete",
      result_phase: "MATERIALIZED",
      provider_attempt_id: "legacy-attempt",
      provider_attempt: { state: outcome.STATES.COMPLETED_KNOWN, provider_attempt_id: "legacy-attempt" },
      report_text: legacyPayload.report_text,
      result_buffer: clone(legacyBuffer),
    };
  }

  const legacyAtEndOwner = { value: ownerFor([legacyMaterializedEntry()], 1, { operationId: "legacy-at-end" }) };
  const legacyAtEnd = createQueueHarness(legacyAtEndOwner);
  const legacyAtEndResult = await legacyAtEnd.process();
  assert.equal(legacyAtEndResult.code, "RESULT_BUFFER_INTEGRITY_UNVERIFIABLE");
  assert.equal(legacyAtEnd.finalizations, 0, "an already-complete legacy result cannot reach finalization");
  assert.equal(legacyAtEnd.failures[0], "RESULT_BUFFER_INTEGRITY_UNVERIFIABLE");
  assert.equal(legacyAtEndOwner.value.batch.entries[0].status, "complete");

  const legacyAtHeadOwner = { value: ownerFor([legacyMaterializedEntry()], 0, { operationId: "legacy-at-head" }) };
  const legacyAtHead = createQueueHarness(legacyAtHeadOwner);
  const legacyAtHeadResult = await legacyAtHead.process();
  assert.equal(legacyAtHeadResult.code, "RESULT_BUFFER_INTEGRITY_UNVERIFIABLE");
  assert.equal(legacyAtHead.finalizations, 0, "legacy entry skipping is blocked before advancing next_index");

  const freshCompleteBuffer = await api.createBuffer({ ...base, report_text: "fresh complete", result: { value: 2 } }, now);
  const freshCompleteOwner = { value: ownerFor([{
    kind: "command", status: "complete", result_phase: "MATERIALIZED", provider_attempt_id: "fresh-attempt",
    provider_attempt: { state: outcome.STATES.COMPLETED_KNOWN, provider_attempt_id: "fresh-attempt" },
    report_text: "fresh complete", result_buffer: freshCompleteBuffer,
  }], 1, { operationId: "fresh-complete" }) };
  const freshCompleteQueue = createQueueHarness(freshCompleteOwner);
  assert.equal((await freshCompleteQueue.process()).code, "SYNTHETIC_FINALIZE_CALLED");
  assert.equal(freshCompleteQueue.finalizations, 1, "schema-2 complete results still finalize");

  const localDenialOwner = { value: ownerFor([{
    kind: "policy_error", status: "complete", report_text: "known local denial", external_request_executed: false,
  }], 1, { operationId: "local-denial" }) };
  const localDenialQueue = createQueueHarness(localDenialOwner);
  assert.equal((await localDenialQueue.process()).code, "SYNTHETIC_FINALIZE_CALLED");
  assert.equal(localDenialQueue.finalizations, 1, "known local-denial reports without legacy provider provenance remain usable");

  const singleReport = "raw single bytes  \r\n";
  const singleEntry = await bufferedEntry("single-attempt", 0, singleReport, { value: 1 });
  const singleOwnerRef = { value: ownerFor([singleEntry], 0, { operationId: "single-recovery" }) };
  const singleQueue = createQueueHarness(singleOwnerRef);
  const singleResult = await singleQueue.process();
  assert.equal(singleResult.code, "SYNTHETIC_FINALIZE_CALLED");
  assert.equal(singleQueue.finalizations, 1);
  assert.equal(singleOwnerRef.value.batch.entries[0].status, "complete");
  assert.equal(singleOwnerRef.value.batch.entries[0].report_text, `PROJECTED:${singleReport}`, "single recovery reapplies the normal pure result projection from validated bytes");
  assert.equal(singleOwnerRef.value.batch.entries[0].result_phase, "MATERIALIZED");
  assert.equal(singleOwnerRef.value.batch.entries[0].provider_attempt.state, outcome.STATES.COMPLETED_KNOWN);

  // Work session and authority generation are independent in the actual app.
  // Both must survive the buffer without being reconstructed from one another.
  assert.equal(singleOwnerRef.value.batch.entries[0].result_buffer.context.workSessionId, "generation");
  assert.equal(singleOwnerRef.value.batch.entries[0].result_buffer.context.workGeneration, "authority-generation");
  for (const changed of [{ workSessionId: "foreign-session" }, { workGeneration: "foreign-authority" }]) {
    const decision = await api.recoveryDecision({ providerAttempt: singleEntry.provider_attempt,
      resultBuffer: singleEntry.result_buffer, currentContext: { ...contextData, ...changed }, now });
    assert.equal(decision.code, "STALE_DELIVERY_CONTEXT");
  }
  const unprojected = await bufferedEntry("unprojected-attempt", 0, "WB_RESULT_V1\nsynthetic-exact", { value: 1 });
  const unprojectedOwner = { value: ownerFor([unprojected], 0, { operationId: "nonapplicable-projection" }) };
  const unprojectedQueue = createQueueHarness(unprojectedOwner, {
    reviewedAcquisitionProfile: () => null,
    projectSingle: () => { throw new Error("a non-applicable provider port must not be called"); },
  });
  assert.equal((await unprojectedQueue.process()).code, "SYNTHETIC_FINALIZE_CALLED");
  assert.equal(unprojectedOwner.value.batch.entries[0].report_text, "WB_RESULT_V1\nsynthetic-exact");
  for (const field of ["grantEpoch", "workGeneration", "workSessionId"]) {
    const entry = await bufferedEntry("context-race-" + field, 0, "unchanged report", { value: 1 });
    const reference = { value: ownerFor([entry], 0, { operationId: "context-race-" + field }) };
    const queue = createQueueHarness(reference, { beforeMutation: (owner) => {
      owner.execution_context = { ...owner.execution_context, [field]: "changed-after-validation" };
    } });
    assert.equal((await queue.process()).code, "STALE_DELIVERY_CONTEXT");
    assert.equal(reference.value.batch.entries[0].status, "requesting");
  }

  const singleTamperEntry = await bufferedEntry("single-tamper-attempt", 0, "complete report", { value: 1 });
  const singleTamperOwnerRef = { value: ownerFor([singleTamperEntry], 0, { operationId: "single-tamper" }) };
  const singleTamperQueue = createQueueHarness(singleTamperOwnerRef, {
    beforeMutation: (owner) => { owner.batch.entries[0].result_buffer.payload.report_text = "truncated during commit window"; },
  });
  const singleTamper = await singleTamperQueue.process();
  assert.equal(singleTamper.code, "RESULT_BUFFER_INTEGRITY_MISMATCH");
  assert.equal(singleTamperOwnerRef.value.batch.entries[0].status, "requesting", "corrupt live value is never committed complete/MATERIALIZED");

  let activeDigestGate = null;
  let projectedAfterDigestRace = null;
  const rawSubtle = webcrypto.subtle;
  context.crypto = {
    randomUUID,
    subtle: {
      digest: async (algorithm, data) => {
        const gate = activeDigestGate;
        if (gate) await gate.beforeDigest();
        return rawSubtle.digest(algorithm, data);
      },
    },
  };
  const raceEntry = await bufferedEntry("single-race-attempt", 0, "verified original report", { value: 1 });
  const raceOwnerRef = { value: ownerFor([raceEntry], 0, { operationId: "single-snapshot-race" }) };
  const raceQueue = createQueueHarness(raceOwnerRef, {
    sharedOwner: true,
    projectSingle: (_entry, result) => {
      projectedAfterDigestRace = result.report_text;
      return { ...result, report_text: result.report_text };
    },
  });
  let releaseSingleDigests;
  let singleDigestStarted;
  const singleDigestWait = new Promise((resolve) => { singleDigestStarted = resolve; });
  const singleDigestRelease = new Promise((resolve) => { releaseSingleDigests = resolve; });
  let singleDigestCalls = 0;
  activeDigestGate = {
    beforeDigest: async () => {
      singleDigestCalls += 1;
      if (singleDigestCalls === 2) singleDigestStarted();
      await singleDigestRelease;
    },
  };
  const singleRaceRun = raceQueue.process();
  await singleDigestWait;
  raceOwnerRef.value.batch.entries[0].result_buffer.payload.report_text = "mutated after digest snapshot";
  activeDigestGate = null;
  releaseSingleDigests();
  const singleRaceResult = await singleRaceRun;
  assert.equal(projectedAfterDigestRace, "verified original report", "recovery materializes the immutable bytes captured before async digest completion");
  assert.equal(singleRaceResult.code, "RESULT_BUFFER_INTEGRITY_MISMATCH");
  assert.equal(raceOwnerRef.value.batch.entries[0].status, "requesting");

  async function singleCommitRace(id, mutateLiveOwner, expectedCode) {
    const entry = await bufferedEntry(`${id}-attempt`, 0, `verified ${id} report`, { value: 1 });
    const ownerRef = { value: ownerFor([entry], 0, { operationId: id }) };
    const queue = createQueueHarness(ownerRef);
    let release;
    let started;
    const startedWait = new Promise((resolve) => { started = resolve; });
    const releaseWait = new Promise((resolve) => { release = resolve; });
    let digestCalls = 0;
    activeDigestGate = {
      beforeDigest: async () => {
        digestCalls += 1;
        if (digestCalls === 2) started();
        await releaseWait;
      },
    };
    const run = queue.process();
    await startedWait;
    mutateLiveOwner(ownerRef.value);
    activeDigestGate = null;
    release();
    const result = await run;
    assert.equal(result.code, expectedCode, `${id} is rejected by its commit-time binding`);
    assert.equal(ownerRef.value.batch.entries[0].status, "requesting");
    return result;
  }

  await singleCommitRace("single-ttl-race", (owner) => {
    owner.batch.entries[0].result_buffer.expires_at_ms = Date.now() - 1;
  }, "RESULT_BUFFER_EXPIRED");
  await singleCommitRace("single-attempt-race", (owner) => {
    owner.batch.entries[0].provider_attempt.state = outcome.STATES.OUTCOME_UNKNOWN;
  }, "PROVIDER_OUTCOME_UNKNOWN_NO_RETRY");
  await singleCommitRace("single-context-race", (owner) => {
    owner.execution_context.storeId = "changed-store";
  }, "STALE_DELIVERY_CONTEXT");

  const physicalReport = "physical report bytes\r\n";
  const groupEntries = [
    await bufferedEntry("group-attempt-0", 0, physicalReport, { rows: [1, 2] }, "physical", "group-a"),
    await bufferedEntry("group-attempt-1", 1, physicalReport, { rows: [1, 2] }, "physical", "group-a"),
  ];
  const group = { group_id: "group-a", leader_index: 0, member_indexes: [0, 1], physical_command_fingerprint: "fingerprint" };
  const groupOwnerRef = { value: ownerFor(groupEntries, 0, { operationId: "group-recovery", groups: [group] }) };
  const groupQueue = createQueueHarness(groupOwnerRef);
  const groupResult = await groupQueue.process();
  assert.equal(groupResult.code, "SYNTHETIC_FINALIZE_CALLED");
  assert.equal(groupQueue.finalizations, 1);
  assert.deepEqual(Array.from(groupOwnerRef.value.batch.entries, (entry) => entry.status), ["complete", "complete"]);
  assert.deepEqual(Array.from(groupOwnerRef.value.batch.entries, (entry) => entry.result_phase), ["MATERIALIZED", "MATERIALIZED"]);
  assert.deepEqual(Array.from(groupOwnerRef.value.batch.entries, (entry) => entry.report_text), [
    `GROUP-group-a-0:${physicalReport}`,
    `GROUP-group-a-1:${physicalReport}`,
  ]);

  let projectGroupPhysicalReport = null;
  const groupTamperEntries = [
    await bufferedEntry("group-tamper-0", 0, physicalReport, { rows: [1, 2] }, "physical", "group-tamper"),
    await bufferedEntry("group-tamper-1", 1, physicalReport, { rows: [1, 2] }, "physical", "group-tamper"),
  ];
  const groupTamper = { group_id: "group-tamper", leader_index: 0, member_indexes: [0, 1], physical_command_fingerprint: "fingerprint" };
  const groupTamperOwnerRef = { value: ownerFor(groupTamperEntries, 0, { operationId: "group-tamper", groups: [groupTamper] }) };
  const groupTamperQueue = createQueueHarness(groupTamperOwnerRef, {
    projectGroup: (member, currentGroup, physical) => {
      projectGroupPhysicalReport = physical.report_text;
      return {
        ok: true,
        request_id: `logical-${member.command_index}`,
        physical_request_id: physical.request_id,
        report_text: `GROUP-${currentGroup.group_id}-${member.command_index}:${physical.report_text}`,
        external_request_executed: true,
      };
    },
  });
  let groupRelease;
  let secondMemberDigestStarted;
  const groupDigestWait = new Promise((resolve) => { secondMemberDigestStarted = resolve; });
  const groupDigestRelease = new Promise((resolve) => { groupRelease = resolve; });
  let groupDigestCalls = 0;
  activeDigestGate = {
    beforeDigest: async () => {
      groupDigestCalls += 1;
      if (groupDigestCalls >= 3) {
        if (groupDigestCalls === 3) secondMemberDigestStarted();
        await groupDigestRelease;
      }
    },
  };
  const groupTamperRun = groupTamperQueue.process();
  await groupDigestWait;
  groupTamperOwnerRef.value.batch.entries[0].result_buffer.payload.report_text = "mutated first group member after its digest";
  activeDigestGate = null;
  groupRelease();
  const groupTamperResult = await groupTamperRun;
  assert.equal(projectGroupPhysicalReport, physicalReport, "group projection uses the first member's immutable verified payload snapshot");
  assert.equal(groupTamperResult.code, "RESULT_BUFFER_INTEGRITY_MISMATCH");
  assert.deepEqual(Array.from(groupTamperOwnerRef.value.batch.entries, (entry) => entry.status), ["requesting", "requesting"], "group recovery commits no member when any live member changed");

  let providerCalls = 0;
  let stopHookReached;
  const stopHookWait = new Promise((resolve) => { stopHookReached = resolve; });
  const stopOwnerRef = { value: ownerFor([{
    kind: "command",
    status: "pending",
    operation: "seller_info",
    command: { operation: "seller_info" },
    execution_command: { operation: "seller_info" },
    command_text: "synthetic seller_info",
    command_fingerprint: "synthetic-fingerprint",
  }], 0, { operationId: "stop-restart", requestState: "idle", payloadExpiresAt: Date.now() + 3_600_000 }) };
  context.__SELLER_AGENTS_TEST_HOOKS = {
    afterResultBufferCommit: async () => {
      stopHookReached();
      return new Promise(() => {});
    },
  };
  const stoppedQueue = createQueueHarness(stopOwnerRef, {
    workerId: "worker-before-restart",
    execute: async (_commandText, ports) => {
      providerCalls += 1;
      ports.onProviderResponse({ http_status: 200, ok: true, external_request_executed: true });
      await ports.onProviderResult({
        ok: true,
        request_id: "synthetic-provider-result",
        operation: "seller_info",
        http_status: 200,
        external_request_executed: true,
        report_text: "complete stop-hook report  \r\n",
        result: { value: 42 },
      });
      return { ok: true, report_text: "complete stop-hook report  \r\n", result: { value: 42 }, request_id: "synthetic-provider-result" };
    },
  });
  const stoppedQueueRun = stoppedQueue.process();
  await requireHookBeforeProcessSettles("single-result recovery", stopHookWait, stoppedQueueRun);
  assert.equal(providerCalls, 1, "the real queue stopped after its durable result-buffer hook");
  assert.equal(stopOwnerRef.value.batch.entries[0].status, "requesting");
  assert.equal(stopOwnerRef.value.batch.entries[0].result_buffer.phase, "BUFFERED");
  assert.equal(stopOwnerRef.value.batch.entries[0].result_buffer.schema_version, 2);
  assert.equal(stopOwnerRef.value.batch.entries[0].result_buffer.payload.report_text, "complete stop-hook report  \r\n");

  context.__SELLER_AGENTS_TEST_HOOKS = undefined;
  const restartedQueue = createQueueHarness(stopOwnerRef, {
    workerId: "worker-after-restart",
    execute: async () => {
      providerCalls += 1;
      throw new Error("Provider replay after restart is forbidden");
    },
  });
  const restarted = await restartedQueue.process();
  assert.equal(restarted.code, "SYNTHETIC_FINALIZE_CALLED");
  assert.equal(restartedQueue.finalizations, 1);
  assert.equal(providerCalls, 1, "restart recovers locally without a second provider call");
  assert.equal(stopOwnerRef.value.batch.entries[0].status, "complete");
  assert.equal(stopOwnerRef.value.batch.entries[0].result_phase, "MATERIALIZED");
  assert.equal(stopOwnerRef.value.batch.entries[0].report_text, "PROJECTED:complete stop-hook report  \r\n");

  let groupProviderCalls = 0;
  let groupStopHookReached;
  const groupStopHookWait = new Promise((resolve) => { groupStopHookReached = resolve; });
  const groupStopId = "stop-hook-group";
  const groupStopEntries = [0, 1].map((index) => ({
    kind: "command",
    status: "pending",
    operation: "analytics_data",
    command: { operation: "analytics_data", params: { metrics: ["revenue"], dimensions: ["day"] } },
    execution_command: { operation: "analytics_data", params: { metrics: ["revenue"], dimensions: ["day"] } },
    command_text: `synthetic analytics_data ${index}`,
    command_fingerprint: `synthetic-group-fingerprint-${index}`,
    query_group_id: groupStopId,
    command_index: index,
  }));
  const groupStopDefinition = {
    group_id: groupStopId,
    leader_index: 0,
    member_indexes: [0, 1],
    physical_command_fingerprint: "synthetic-physical-fingerprint",
    physical_command: { operation: "analytics_data", params: { metrics: ["revenue"], dimensions: ["day"] } },
    physical_metrics: ["revenue"],
  };
  const groupStopOwnerRef = { value: ownerFor(groupStopEntries, 0, { operationId: "group-stop-restart", groups: [groupStopDefinition], requestState: "idle" }) };
  context.__SELLER_AGENTS_TEST_HOOKS = {
    afterResultBufferCommit: async ({ indexes }) => {
      assert.deepEqual(Array.from(indexes), [0, 1], "the actual physical group result buffer commits both group members before the stop hook");
      groupStopHookReached();
      return new Promise(() => {});
    },
  };
  const stoppedGroupQueue = createQueueHarness(groupStopOwnerRef, {
    workerId: "group-worker-before-restart",
    execute: async (_commandText, ports) => {
      groupProviderCalls += 1;
      ports.onProviderResponse({ http_status: 200, ok: true, external_request_executed: true });
      await ports.onProviderResult({
        ok: true,
        request_id: "synthetic-group-provider-result",
        operation: "analytics_data",
        http_status: 200,
        external_request_executed: true,
        report_text: "complete physical group stop report  \r\n",
        result: { rows: [{ day: "2026-10-29", revenue: 42 }] },
      });
      return { ok: true, report_text: "complete physical group stop report  \r\n", result: { rows: [{ day: "2026-10-29", revenue: 42 }] }, request_id: "synthetic-group-provider-result" };
    },
  });
  const stoppedGroupQueueRun = stoppedGroupQueue.process();
  await requireHookBeforeProcessSettles("physical-group recovery", groupStopHookWait, stoppedGroupQueueRun);
  assert.equal(groupProviderCalls, 1, "the group queue stops after its durable physical result-buffer hook");
  assert.deepEqual(Array.from(groupStopOwnerRef.value.batch.entries, (entry) => entry.status), ["requesting", "requesting"]);
  assert.deepEqual(Array.from(groupStopOwnerRef.value.batch.entries, (entry) => entry.result_buffer?.schema_version), [2, 2]);
  assert.deepEqual(Array.from(groupStopOwnerRef.value.batch.entries, (entry) => entry.result_buffer?.phase), ["BUFFERED", "BUFFERED"]);

  context.__SELLER_AGENTS_TEST_HOOKS = undefined;
  const restartedGroupQueue = createQueueHarness(groupStopOwnerRef, {
    workerId: "group-worker-after-restart",
    execute: async () => {
      groupProviderCalls += 1;
      throw new Error("Group provider replay after restart is forbidden");
    },
  });
  const restartedGroup = await restartedGroupQueue.process();
  assert.equal(restartedGroup.code, "SYNTHETIC_FINALIZE_CALLED");
  assert.equal(restartedGroupQueue.finalizations, 1);
  assert.equal(groupProviderCalls, 1, "group restart recovers locally without another provider call");
  assert.deepEqual(Array.from(groupStopOwnerRef.value.batch.entries, (entry) => entry.status), ["complete", "complete"]);
  assert.deepEqual(Array.from(groupStopOwnerRef.value.batch.entries, (entry) => entry.result_phase), ["MATERIALIZED", "MATERIALIZED"]);
  assert.deepEqual(Array.from(groupStopOwnerRef.value.batch.entries, (entry) => entry.report_text), [
    "GROUP-stop-hook-group-0:complete physical group stop report  \r\n",
    "GROUP-stop-hook-group-1:complete physical group stop report  \r\n",
  ]);

  async function manualDeliveryDecision(entry, phase, mode = "batch_watch_v1") {
    const failures = [];
    const operation = {
      operation_id: "manual-delivery",
      conversation_key: contextData.conversationKey,
      status: "delivering",
      batch: { entries: [entry] },
      delivery: { mode, phase },
    };
    const manualContext = vm.createContext({
      manualOperationActive: () => true,
      MANUAL_OPERATION_STATUSES: { REQUESTING: "requesting", DELIVERING: "delivering" },
      SellerAgentsProviderOutcome: outcome,
      SellerAgentsResultRecovery: api,
      manualOwnerDecision: async (value) => ({ owner: true, operation: value }),
      MANUAL_OPERATION_OWNER_STATES: {},
      assertManualBatchContext: async () => {},
      failManualBatch: async (_conversationKey, _operationId, code) => {
        failures.push(code);
        return { ...operation, status: "failed", last_error: { code } };
      },
      BridgeAutorunModel: {
        DELIVERY_PHASES: { CLAIMED: "CLAIMED", INSERTED: "INSERTED", INSERT_COMMITTED: "INSERT_COMMITTED" },
        ATTACHMENT_PHASES: { CLAIMED: "attachment_claimed", ATTACH_COMMITTED: "attachment_committed", READY: "attachment_ready", SEND_COMMITTED: "attachment_send_committed" },
      },
      manualBatchRecoveryPayload: (_value, type) => ({ type }),
      diagnostic: async () => {},
      setTimeout: () => 0,
      launchBatchProcessor: () => {},
      WORKER_SESSION_ID: "current-worker",
      Date,
      String,
      Number,
      Object,
      Array,
      Promise,
    });
    manualContext.globalThis = manualContext;
    const relativePath = "apps/extension/src/background/context/manualRecoveryForContent.js";
    const raw = fs.readFileSync(path.join(root, relativePath));
    vm.runInContext(raw.toString("utf8"), manualContext, { filename: relativePath });
    const decision = await manualContext.manualRecoveryForContent(operation, 1);
    return { decision, failures };
  }

  async function manualInsertDecision(entry, phase) {
    let commitCalls = 0;
    let operation = {
      operation_id: "manual-insert",
      conversation_id: "conversation",
      tab_id: 1,
      status: "delivering",
      binding_snapshot: { binding_id: "binding" },
      batch: { entries: [entry] },
      delivery: { delivery_id: "manual-delivery", mode: "batch_watch_v1", phase },
    };
    const insertContext = vm.createContext({
      normalizeConversationKey: (value) => String(value || ""),
      getManualOperation: async () => operation,
      MANUAL_OPERATION_STATUSES: { DELIVERING: "delivering" },
      getManualMode: async () => true,
      assertManualBatchContext: async () => {},
      assertTabConversation: async () => ({}),
      strictBindingForIdentity: async () => ({ binding_id: "binding" }),
      BridgeAutorunModel: {
        DELIVERY_PHASES: { CLAIMED: "CLAIMED", INSERTED: "INSERTED", INSERT_COMMITTED: "INSERT_COMMITTED" },
        commitDeliveryInsert: (current) => {
          commitCalls += 1;
          return { ...current, delivery: { ...current.delivery, phase: "INSERT_COMMITTED" } };
        },
      },
      mutateManualOperation: async (_key, update) => {
        operation = update(operation);
        return operation;
      },
      diagnostic: async () => {},
      manualBatchRecoveryPayload: (_current, type) => ({ type }),
      publicManualOperation: (value) => value,
      SellerAgentsProviderOutcome: outcome,
      SellerAgentsResultRecovery: api,
    });
    insertContext.globalThis = insertContext;
    const relativePath = "apps/extension/src/background/context/commitManualBatchDeliveryInsert.js";
    const raw = fs.readFileSync(path.join(root, relativePath));
    vm.runInContext(raw.toString("utf8"), insertContext, { filename: relativePath });
    const result = await insertContext.commitManualBatchDeliveryInsert({
      conversation_key: contextData.conversationKey,
      owner_id: operation.operation_id,
      delivery_id: operation.delivery.delivery_id,
      actor_id: "fixture-actor",
    }, { tab: { id: 1 } });
    return { result, commitCalls };
  }

  const legacyDeliveryClaim = await manualDeliveryDecision(legacyMaterializedEntry(), "CLAIMED");
  assert.equal(legacyDeliveryClaim.decision.recovery.code, "RESULT_BUFFER_INTEGRITY_UNVERIFIABLE");
  assert.deepEqual(legacyDeliveryClaim.failures, ["RESULT_BUFFER_INTEGRITY_UNVERIFIABLE"]);
  const legacyAttachmentClaim = await manualDeliveryDecision(legacyMaterializedEntry(), "attachment_claimed", "attachment_watch_v1");
  assert.equal(legacyAttachmentClaim.decision.recovery.code, "RESULT_BUFFER_INTEGRITY_UNVERIFIABLE");
  assert.deepEqual(legacyAttachmentClaim.failures, ["RESULT_BUFFER_INTEGRITY_UNVERIFIABLE"]);
  for (const phase of ["attachment_committed", "attachment_ready", "attachment_send_committed"]) {
    const committedAttachment = await manualDeliveryDecision(legacyMaterializedEntry(), phase, "attachment_watch_v1");
    assert.deepEqual(committedAttachment.failures, [], `${phase} remains behind its existing no-replay fence`);
  }
  const legacyDirectInsert = await manualInsertDecision(legacyMaterializedEntry(), "CLAIMED");
  assert.equal(legacyDirectInsert.result.code, "RESULT_BUFFER_INTEGRITY_UNVERIFIABLE");
  assert.equal(legacyDirectInsert.result.insert_allowed, false);
  assert.equal(legacyDirectInsert.commitCalls, 0, "direct batch insert cannot commit a legacy MATERIALIZED report");
  const unknownDirectInsert = await manualInsertDecision(legacyMaterializedEntry(), "INSERT_COMMITTED");
  assert.equal(unknownDirectInsert.result.code, "DELIVERY_INSERT_OUTCOME_UNKNOWN_NO_RETRY");
  assert.equal(unknownDirectInsert.commitCalls, 0, "an existing committed insert remains an unknown outcome");
  const localDenialInsert = await manualInsertDecision({ kind: "policy_error", status: "complete", report_text: "local denial" }, "CLAIMED");
  assert.equal(localDenialInsert.result.insert_allowed, true, "local-denial batch delivery keeps its existing compatibility");
  assert.equal(localDenialInsert.commitCalls, 1);
  const legacyCommittedDelivery = await manualDeliveryDecision(legacyMaterializedEntry(), "INSERT_COMMITTED");
  assert.equal(legacyCommittedDelivery.decision.recovery.code, "DELIVERY_INSERT_OUTCOME_UNKNOWN_NO_RETRY");
  assert.deepEqual(legacyCommittedDelivery.failures, [], "legacy integrity reporting preserves an existing committed-insert uncertainty fence");
  const legacyInsertedDelivery = await manualDeliveryDecision(legacyMaterializedEntry(), "INSERTED");
  assert.equal(legacyInsertedDelivery.decision.recovery.type, "watch_delivery");
  assert.deepEqual(legacyInsertedDelivery.failures, [], "an already inserted report is monitored without replay");
  const freshDeliveryEntry = {
    kind: "command", status: "complete", result_phase: "MATERIALIZED",
    provider_attempt: { state: outcome.STATES.COMPLETED_KNOWN, provider_attempt_id: "fresh" },
    result_buffer: freshCompleteBuffer,
  };
  const freshDeliveryClaim = await manualDeliveryDecision(freshDeliveryEntry, "CLAIMED");
  assert.equal(freshDeliveryClaim.decision.recovery.type, "deliver_claimed", "fresh schema-2 completed reports remain deliverable");
  assert.deepEqual(freshDeliveryClaim.failures, []);

  const afterHashes = Object.fromEntries(sourcePaths.map((relativePath) => [
    relativePath,
    createHash("sha256").update(fs.readFileSync(path.join(root, relativePath))).digest("hex"),
  ]));
  assert.deepEqual(afterHashes, sourceHashes, "raw production sources remain stable for this run");
  console.log(JSON.stringify({
    status: "PASS",
    runtime: process.version,
    source_transforms: 0,
    source_sha256: sourceHashes,
    scenarios: [
      "exact-report-bytes",
      "empty-report",
      "report-over-old-8Mi-cap",
      "actual-ozon-registry-formatter-full-report-and-result-under-total-cap",
      "actual-ozon-registry-formatter-full-report-and-result-oversize",
      "invalid-report-type",
      "exact-buffer-boundary",
      "buffer-over-boundary",
      "report-truncation-detection",
      "result-tamper-detection",
      "digest-tamper-detection",
      "structural-corruption",
      "legacy-buffer-fail-closed",
      "buffer-provider-attempt-identity-binding",
      "legacy-complete-finalization-guard",
      "fresh-complete-and-local-denial-compatibility",
      "single-commit-recovery",
      "work-session-and-authority-generation-independent-binding",
      "non-applicable-projection-keeps-exact-provider-report",
      "full-context-change-after-validation-never-materializes",
      "single-commit-window-tamper",
      "immutable-payload-snapshot-after-async-digest",
      "commit-time-ttl-attempt-context-bindings",
      "group-commit-recovery-through-whole-queue",
      "group-commit-window-tamper-atomic",
      "owner-snapshot-buffer-commit-stop-hook-restart-no-replay",
      "physical-group-after-result-buffer-commit-stop-restart-no-provider-replay",
      "legacy-delivering-guard-before-claimed-insert",
      "legacy-attachment-claim-blocked-before-artifact-commit",
      "attachment-committed-ready-and-send-committed-fences-preserved",
      "direct-batch-insert-blocked-for-legacy-complete-result",
      "committed-insert-unknown-fence-preserved",
      "already-inserted-delivery-monitor-without-replay",
      "fresh-schema2-delivery-compatibility",
    ],
    finalization: { single: "PASS", group: "PASS", legacy_unverifiable: "BLOCKED" },
    commit_window_corruption_single: "BLOCKED",
    commit_window_corruption_group: "BLOCKED_ALL_MEMBERS",
    synthetic_provider_attempts: providerCalls,
    group_synthetic_provider_attempts: groupProviderCalls,
    external_provider_calls: 0,
    provider_replays_after_restart: 0,
    delivery_level: "source queue and raw manual-recovery consumer; built browser delivery remains a separate test",
  }));
}

await main();
