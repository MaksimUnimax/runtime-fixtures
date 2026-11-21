async function finalizeManualBatch(
  conversationKey,
  operationId,
  entries,
  batchSnapshot = null,
) {
  const key = normalizeConversationKey(conversationKey);
  await assertManualBatchContext(key, operationId);
  let owner = await getManualOperation(key);
  entries = await saPrepareDelivery(entries, owner);
  const cap19 = owner?.cap19_selection
    ? await saPrepareCAP19Delivery(owner)
    : { refs: [], progress: null };
  owner = await getManualOperation(key);
  const combinedReport = owner?.execution_context && await saEnabled() ? saCombinedReport(entries, owner, cap19.progress) : formatCombinedBatchReport(entries, batchSnapshot);
  const prefixed = await saEnabled() ? { outgoing_text: combinedReport, report_prefix_applied: false } : await applyPrefixToReport(key, combinedReport);
  const deliveryId = `manual-delivery-${crypto.randomUUID()}`;
  const cap19Effect=cap19.refs.length ? SellerAgentsWBSalesFinanceManual.beginEffect(owner,cap19.refs[0]) : null;
  try {
  await assertManualBatchContext(key, operationId);
  let claimed = false;
  const operation = await mutateManualOperation(key, (current) => {
    if (
      !current ||
      current.operation_id !== operationId ||
      current.status !== MANUAL_OPERATION_STATUSES.REQUESTING ||
      !current.batch
    )
      return current;
    const currentEntries = Array.isArray(current.batch.entries)
      ? current.batch.entries
      : [];
    if (
      Math.max(0, Number(current.batch.next_index || 0)) < currentEntries.length
    )
      return current;
    if (currentEntries.some((entry) => entry?.status !== "complete"))
      return current;
    if(cap19Effect){
      SellerAgentsWBSalesFinanceManual.admitEffect(cap19Effect);
      if(current.cap19_artifact_intent?.artifact_key!==cap19.refs[0].artifact_key ||
         current.cap19_artifact_intent?.sha256!==cap19.refs[0].sha256)throw saError("CAP19_CLAIM_DESCRIPTOR_CHANGED");
    }
    claimed = true;
    const next = BridgeAutorunModel.claimDelivery({ ...current, batch: { ...current.batch, entries } }, {
      deliveryId,
      requestId: "",
      outgoingText: prefixed.outgoing_text,
      outgoingHash: "",
      reportPrefixApplied: prefixed.report_prefix_applied === true,
      mode: "batch_watch_v1",
      ...(cap19.refs.length ? {derived_file_refs:cap19.refs} : {}),
    });
    next.delivery.payload_expires_at_ms = current.payload_expires_at_ms;
    next.delivery.marketplace = current.execution_context?.marketplace;
    next.delivery_id = deliveryId;
    next.outgoing_text = prefixed.outgoing_text;
    next.report_prefix_applied = prefixed.report_prefix_applied === true;
    next.request_worker_session_id = null;
    next.batch = {
      ...current.batch,
      entries,
      phase: "collected",
      request_state: "idle",
      request_worker_session_id: null,
      combined_report_ready: true,
      collected_at: new Date().toISOString(),
    };
    return next;
  });
  if (!claimed) return { ok: false, code: "BATCH_FINALIZE_RACE" };
  if(cap19Effect){await assertManualBatchContext(key,operationId);SellerAgentsWBSalesFinanceManual.admitEffect(cap19Effect);}
  await diagnostic("BATCH_COLLECTION_COMPLETED", {
    owner_kind: "manual",
    owner_id: operationId,
    result_count: entries.length,
    delivery_id: deliveryId,
    report_prefix_applied: prefixed.report_prefix_applied === true,
  });
  void attemptManualBatchDelivery(key, operationId);
  return {
    ok: true,
    collected: true,
    result_count: entries.length,
    delivery_id: deliveryId,
    operation,
  };
  } finally {if(cap19Effect)SellerAgentsWBSalesFinanceManual.endEffect(cap19Effect);}
}
