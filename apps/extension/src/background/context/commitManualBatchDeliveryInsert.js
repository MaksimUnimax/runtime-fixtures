function isKnownLegacyMaterializedProviderResult(entry) {
  return entry?.kind === "command" && entry.status === "complete" &&
    entry.result_phase === SellerAgentsResultRecovery.RESULT_PHASES.MATERIALIZED &&
    [SellerAgentsProviderOutcome.STATES.RESPONSE_RECEIVED,
      SellerAgentsProviderOutcome.STATES.COMPLETED_KNOWN,
      SellerAgentsProviderOutcome.STATES.FAILED_KNOWN,
      SellerAgentsProviderOutcome.STATES.RETRY_WAIT_KNOWN].includes(entry.provider_attempt?.state) &&
    SellerAgentsResultRecovery.isLegacyBufferedResult(entry.result_buffer) === true;
}

async function commitManualBatchDeliveryInsert(message, sender) {
  const key = normalizeConversationKey(message.conversation_key);
  const operationId = String(message.owner_id || message.operation_id || "");
  const deliveryId = String(message.delivery_id || "");
  const actorId = String(message.actor_id || "");
  const senderTabId = Number(sender?.tab?.id || 0);
  let operation = await getManualOperation(key);
  if (
    !operation ||
    operation.operation_id !== operationId ||
    operation.status !== MANUAL_OPERATION_STATUSES.DELIVERING ||
    operation.delivery?.mode !== "batch_watch_v1"
  ) {
    return {
      ok: false,
      committed: false,
      insert_allowed: false,
      code: "MANUAL_DELIVERY_STATE_MISMATCH",
      error: "Manual batch delivery не находится в ожидаемом state.",
    };
  }
  if (
    !Number.isInteger(senderTabId) ||
    senderTabId !== Number(operation.tab_id)
  )
    return {
      ok: false,
      committed: false,
      insert_allowed: false,
      code: "MANUAL_NON_OWNER_TAB",
      error: "Manual batch delivery insert commit пришёл не из owner-вкладки.",
    };
  if (!(await getManualMode(key)))
    return {
      ok: false,
      committed: false,
      insert_allowed: false,
      code: "MANUAL_MODE_DISABLED",
      error:
        "Ручной режим выключен; pending delivery отменена до вставки отчёта.",
    };
  await assertManualBatchContext(key, operationId);
  const liveIdentity = await assertTabConversation(
    senderTabId,
    key,
    operation.conversation_id,
  );
  const binding = await strictBindingForIdentity(liveIdentity);
  if (
    String(operation.binding_snapshot?.binding_id || "") !==
    String(binding.binding_id || "")
  )
    return {
      ok: false,
      committed: false,
      insert_allowed: false,
      code: "MANUAL_BINDING_MISMATCH",
      error: "Manual batch binding изменился.",
    };
  if (operation.delivery?.delivery_id !== deliveryId)
    return {
      ok: false,
      committed: false,
      insert_allowed: false,
      code: "MANUAL_DELIVERY_ID_MISMATCH",
      error: "Delivery ID не совпадает.",
    };
  if (operation.delivery.phase === BridgeAutorunModel.DELIVERY_PHASES.INSERTED)
    return {
      ok: true,
      committed: true,
      insert_allowed: false,
      already_inserted: true,
      recovery: manualBatchRecoveryPayload(operation, "watch_delivery"),
    };
  if (
    operation.delivery.phase ===
    BridgeAutorunModel.DELIVERY_PHASES.INSERT_COMMITTED
  )
    return {
      ok: true,
      committed: true,
      insert_allowed: false,
      outcome_unknown: true,
      code: "DELIVERY_INSERT_OUTCOME_UNKNOWN_NO_RETRY",
    };
  if (operation.delivery.phase === BridgeAutorunModel.DELIVERY_PHASES.CLAIMED &&
      (operation.batch?.entries || []).some(isKnownLegacyMaterializedProviderResult))
    return {
      ok: false,
      committed: false,
      insert_allowed: false,
      code: "RESULT_BUFFER_INTEGRITY_UNVERIFIABLE",
      error: "Сохранённый legacy report нельзя признать полным; новая вставка в чат запрещена.",
    };
  if (operation.delivery.phase !== BridgeAutorunModel.DELIVERY_PHASES.CLAIMED)
    return {
      ok: false,
      committed: false,
      insert_allowed: false,
      code: "MANUAL_DELIVERY_NOT_CLAIMED",
      error: "Delivery ещё не готов к insertion commit.",
    };
  await assertManualBatchContext(key, operationId);
  let insertAllowed = false;
  operation = await mutateManualOperation(key, (current) => {
    if (
      !current ||
      current.operation_id !== operationId ||
      current.delivery?.delivery_id !== deliveryId ||
      current.delivery?.mode !== "batch_watch_v1"
    )
      return current;
    if (current.delivery.phase !== BridgeAutorunModel.DELIVERY_PHASES.CLAIMED)
      return current;
    insertAllowed = true;
    return BridgeAutorunModel.commitDeliveryInsert(current, {
      deliveryId,
      actorId,
      assistantBaselineIds: message.assistant_baseline_ids,
    });
  });
  if (!insertAllowed)
    return {
      ok: true,
      committed: true,
      insert_allowed: false,
      outcome_unknown: true,
      code: "DELIVERY_INSERT_OUTCOME_UNKNOWN_NO_RETRY",
    };
  await diagnostic("DELIVERY_INSERT_COMMITTED", {
    owner_kind: "manual",
    owner_id: operationId,
    delivery_id: deliveryId,
    tab_id: senderTabId,
    actor_id: actorId || null,
  });
  return {
    ok: true,
    committed: true,
    insert_allowed: true,
    operation: publicManualOperation(operation),
  };
}
