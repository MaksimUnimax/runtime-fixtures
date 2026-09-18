// Payload-free mirror, fed only after successful writes through the sole manual record store.
let manualContextOwners = new Map();
function manualContextOwnerSummary(owner) {
  return owner
    ? {
        operation_id: owner.operation_id,
        status: owner.status,
        execution_context: owner.execution_context,
      }
    : null;
}
function rememberManualContextOwners(records) {
  manualContextOwners = new Map(
    Object.entries(records || {}).map(([key, owner]) => [
      key,
      manualContextOwnerSummary(owner),
    ]),
  );
}
/* D2.2 standalone Ozon carrier. Service account/store catalog is connected in later D2/I1 steps. */
async function readBatchContextState(key, immutable, ownerIdentity = null) {
  if (await saEnabled()) return saReadContext(key, immutable, ownerIdentity);
  const data = await storageGet([
    KEYS.SELLER_CLIENT_ID,
    KEYS.SELLER_API_KEY,
    KEYS.PERFORMANCE_CLIENT_ID,
    KEYS.PERFORMANCE_CLIENT_SECRET,
    KEYS.PERSONAL_DATA_ENABLED,
    KEYS.CONVERSATION_BINDINGS,
    KEYS.WORK_SESSIONS,
  ]);
  const seller = OzonCredentials.normalizeSellerCredentials({
    clientId: data[KEYS.SELLER_CLIENT_ID] || "",
    apiKey: data[KEYS.SELLER_API_KEY] || "",
  });
  const performance = OzonCredentials.normalizePerformanceCredentials({
    clientId: data[KEYS.PERFORMANCE_CLIENT_ID] || "",
    clientSecret: data[KEYS.PERFORMANCE_CLIENT_SECRET] || "",
  });
  const binding = normalizeBindingRecord(
    data[KEYS.CONVERSATION_BINDINGS]?.[key],
    key,
  );
  const work = OzonWorkSessionModel.normalize(
    data[KEYS.WORK_SESSIONS]?.[key],
    key,
  );
  const currentOwner = manualContextOwners.get(key);
  const ownerActive =
    !ownerIdentity ||
    (currentOwner?.operation_id === ownerIdentity.operation_id &&
      manualOperationActive(currentOwner) &&
      SellerAgentsExecutionContext.fields.every(
        (field) =>
          currentOwner.execution_context?.[field] ===
          ownerIdentity.execution_context[field],
      ));
  return {
    ...immutable,
    accountId: "standalone-local-development",
    marketplace: "ozon",
    storeId: await sha256Hex(
      JSON.stringify([
        "standalone-ozon-store",
        seller.clientId,
        performance.clientId,
      ]),
    ),
    credentialRevision: await sha256Hex(
      JSON.stringify([
        "standalone-ozon-credentials",
        seller.clientId,
        seller.apiKey,
        performance.clientId,
        performance.clientSecret,
      ]),
    ),
    conversationKey: key,
    bindingId: binding?.binding_id || "unbound",
    bindingRevision: binding?.revision || 0,
    workSessionId: work.start_intent_id || "inactive",
    policyRevision:
      data[KEYS.PERSONAL_DATA_ENABLED] === true
        ? "personal-enabled"
        : "personal-disabled",
    active:
      ownerActive &&
      [
        OzonWorkSessionModel.STATES.ACTIVE_VISIBLE,
        OzonWorkSessionModel.STATES.ACTIVE_HIDDEN,
        OzonWorkSessionModel.STATES.RECOVERING,
      ].includes(work.state),
  };
}
async function captureBatchContext(key, text, requestId) {
  const immutable = { commandHash: await sha256Hex(String(text)), requestId };
  const state = await readBatchContextState(key, immutable);
  if (!state.active) return null; // A rejected pre-execution local error is never an API authorization.
  return SellerAgentsExecutionContext.snapshot(state);
}
async function createBatchExecutionGuard(owner) {
  if (await saEnabled()) return saGuard(owner);
  if (owner && !manualContextOwners.has(owner.conversation_key))
    manualContextOwners.set(
      owner.conversation_key,
      manualContextOwnerSummary(owner),
    );
  const pinned = owner?.execution_context;
  if (!pinned) {
    if ((owner?.batch?.entries || []).some((e) => e.kind === "command"))
      throw SellerAgentsExecutionContext.error("EXECUTION_CONTEXT_MISSING");
    return null;
  }
  const guard = SellerAgentsExecutionContext.createGuard(pinned, () =>
    readBatchContextState(
      owner.conversation_key,
      { commandHash: pinned.commandHash, requestId: pinned.requestId },
      owner,
    ),
  );
  await guard.assertCurrent();
  // Capture once, then verify against the pinned identity. Never retain credentials in the durable operation record.
  const settings = structuredClone(await getSettings());
  const settingsRevision = await sha256Hex(
    JSON.stringify([
      "standalone-ozon-credentials",
      settings.sellerCredentials.clientId,
      settings.sellerCredentials.apiKey,
      settings.performanceCredentials.clientId,
      settings.performanceCredentials.clientSecret,
    ]),
  );
  if (settingsRevision !== pinned.credentialRevision)
    throw SellerAgentsExecutionContext.error();
  await guard.assertCurrent();
  Object.freeze(settings.sellerCredentials);
  Object.freeze(settings.performanceCredentials);
  Object.freeze(settings);
  return Object.freeze({
    ...guard,
    async settings() {
      await guard.assertCurrent();
      return settings;
    },
  });
}
async function assertManualBatchContext(key, operationId) {
  const owner = await getManualOperation(key);
  if (!owner || owner.operation_id !== operationId)
    throw SellerAgentsExecutionContext.error();
  const guard = await createBatchExecutionGuard(owner);
  if (guard) await guard.assertCurrent();
  return guard;
}
async function runComposedBatchQueue(options) {
  const original = options;
  let context = null;
  try {
    if (options.ownerKind === "manual")
      context = await createBatchExecutionGuard(await options.getOwner());
    if (context?.snapshot.marketplace === "wildberries") return SellerAgentsGuardedBatchQueue.run(options, { context, ports: SellerAgentsWBBatch.createPorts(context, { quota: saQuota, diagnostic, workerId: WORKER_SESSION_ID, flights: batchCollectionRequests }) });
    const ports = {
      normalizeKey: normalizeConversationKey,
      singleFlight,
      flights: batchCollectionRequests,
      workerId: WORKER_SESSION_ID,
      preparePolicy: (o) =>
        ensureBatchLocalPolicy({ ...o, executionContext: context }),
      prepareCapability: (o) =>
        ensureBatchCapabilityAndPlanning({ ...o, executionContext: context }),
      prepareQueries: ensureBatchQueryPlanning,
      diagnostic,
      beforeProviderDispatch: async () => {
        if (typeof context?.assertDispatchAuthority === "function")
          await context.assertDispatchAuthority();
      },
      guidanceResult: localGuidanceResult,
      policyErrorResult: buildPersonalDataPolicyErrorResult,
      planningErrorResult: buildCapabilityPlanningErrorResult,
      findGroup: findBatchQueryGroup,
      readCache: (command) => readAnalyticsResultCacheForCurrentSettings(command, context),
      projectGroup: buildCoalescedLogicalResult,
      prepareQuota: (command) => prepareProviderQuotaForCommand(command, context),
      groupError: buildCoalescedExecutionErrorResult,
      persistQuotaWait: persistBatchQuotaWait,
      quotaMetadata: safeQuotaMetadata,
      execute: (text, opts) => executeOzonCore(text, { ...opts, executionContext: context }),
      groupPlanning: coalescedPlanningForEntry,
      storeCache: (command, result, profile) =>
        storeAnalyticsResultCacheForCurrentSettings(
          command,
          result,
          profile,
          context,
        ),
      cachedResult: buildCachedSingleResult,
      acquisitionPlanning,
      executionError: buildExecutionErrorResult,
      projectSingle: projectPrefetchedSingleResult,
      reviewedAcquisitionProfile: (command) =>
        OzonContract.reviewedAnalyticsAcquisitionProfile(command),
      providerId: "seller_api",
      coalescedOperation: "analytics_data",
      bridgeErrorCode: "OZON_BRIDGE_ERROR",
    };
    return await SellerAgentsGuardedBatchQueue.run(options, { context, ports });
  } catch (error) {
    if (!error?.execution_context_error) throw error;
    const current = await original.getOwner();
    if (original.ownerMatches(current) && original.isCollecting(current))
      await original.failOwner(error.code, error.message);
    return { ok: false, code: error.code };
  }
}
