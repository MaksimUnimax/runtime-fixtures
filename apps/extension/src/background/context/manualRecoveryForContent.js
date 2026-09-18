async function manualRecoveryForContent(operation, candidateTabId) {
  if (!operation || !manualOperationActive(operation))
    return { owner: true, recovery: null, operation };
  const owner = await manualOwnerDecision(operation, candidateTabId, {
    allowRebind: true,
  });
  if (!owner.owner) return { ...owner, recovery: null };
  let current = owner.operation || operation;
  if (current.status === MANUAL_OPERATION_STATUSES.REQUESTING) {
    const requestState = String(current.batch?.request_state || "idle");
    const requestWorker = String(
      current.batch?.request_worker_session_id || "",
    );
    if (
      requestState === "requesting" &&
      requestWorker &&
      requestWorker !== WORKER_SESSION_ID
    ) {
      const requesting = (current.batch?.entries || []).filter((entry) => entry?.status === "requesting");
      const knownBuffered = requesting.length > 0 && requesting.every((entry) =>
        entry?.provider_attempt?.state === SellerAgentsProviderOutcome.STATES.RESPONSE_RECEIVED &&
        entry?.result_buffer?.phase === SellerAgentsResultRecovery.RESULT_PHASES.BUFFERED,
      );
      if (knownBuffered) {
        setTimeout(() => {
          launchBatchProcessor("manual", current.conversation_key, current.operation_id, "known_result_recovery");
        }, 0);
        return {
          owner: true,
          rebound: owner.rebound === true,
          operation: current,
          recovery: { type: "resume_local_result", code: "KNOWN_RESULT_RECOVERY_SAFE", provider_calls: 0 },
        };
      }
      const knownWithoutBuffer = requesting.some((entry) =>
        [SellerAgentsProviderOutcome.STATES.RESPONSE_RECEIVED, SellerAgentsProviderOutcome.STATES.COMPLETED_KNOWN, SellerAgentsProviderOutcome.STATES.FAILED_KNOWN].includes(entry?.provider_attempt?.state) &&
        entry?.result_buffer?.phase !== SellerAgentsResultRecovery.RESULT_PHASES.BUFFERED,
      );
      if (knownWithoutBuffer) {
        current = await failManualBatch(
          current.conversation_key,
          current.operation_id,
          "RESULT_RECOVERY_UNAVAILABLE_NO_REPLAY",
          "Известный provider result не имеет локального projection buffer; повторный provider request запрещён.",
        );
        return {
          owner: true,
          rebound: owner.rebound === true,
          operation: current,
          recovery: { type: "blocked", code: "RESULT_RECOVERY_UNAVAILABLE_NO_REPLAY" },
        };
      }
      current = await mutateManualOperation(
        current.conversation_key,
        (value) => {
          if (!value || value.operation_id !== current.operation_id || !value.batch)
            return value;
          const entries = (value.batch.entries || []).map((entry) => {
            if (entry?.provider_attempt?.state !== "DISPATCH_INTENT_COMMITTED") return entry;
            const attempt = SellerAgentsProviderOutcome.markUnknown(
              entry.provider_attempt,
              Date.now(),
              "worker_restart",
            );
            return {
              ...entry,
              provider_attempt: attempt,
              provider_attempt_history: (entry.provider_attempt_history || []).map((row) =>
                row.provider_attempt_id === attempt.provider_attempt_id ? attempt : row,
              ),
            };
          });
          return { ...value, batch: { ...value.batch, entries } };
        },
      );
      current = await failManualBatch(
        current.conversation_key,
        current.operation_id,
        "REQUEST_OUTCOME_UNKNOWN_NO_RETRY",
        "Service worker перезапустился во время ручного Ozon API request. Исход запроса неизвестен; автоматический повтор запрещён.",
      );
      await diagnostic(
        "REQUEST_RECOVERY_BLOCKED_NO_RETRY",
        {
          owner_kind: "manual",
          owner_id: current?.operation_id || operation.operation_id,
          previous_worker_session_id: requestWorker,
          worker_session_id: WORKER_SESSION_ID,
        },
        { level: "error" },
      );
      return {
        owner: true,
        rebound: owner.rebound === true,
        operation: current,
        recovery: null,
      };
    }
    setTimeout(() => {
      launchBatchProcessor(
        "manual",
        current.conversation_key,
        current.operation_id,
        "manual_recovery",
      );
    }, 0);
    return {
      owner: true,
      rebound: owner.rebound === true,
      operation: current,
      recovery: null,
    };
  }
  if (
    current.status !== MANUAL_OPERATION_STATUSES.DELIVERING ||
    current.delivery?.mode !== "batch_watch_v1"
  )
    return {
      owner: true,
      rebound: owner.rebound === true,
      operation: current,
      recovery: null,
    };
  try {
    await assertManualBatchContext(
      current.conversation_key,
      current.operation_id,
    );
  } catch (error) {
    if (!error?.execution_context_error) throw error;
    current = await failManualBatch(
      current.conversation_key,
      current.operation_id,
      error.code,
      error.message,
    );
    return { owner: true, operation: current, recovery: null };
  }
  if (current.delivery.phase === BridgeAutorunModel.DELIVERY_PHASES.CLAIMED)
    return {
      owner: true,
      rebound: owner.rebound === true,
      operation: current,
      recovery: manualBatchRecoveryPayload(current, "deliver_claimed"),
    };
  if (current.delivery.phase === BridgeAutorunModel.DELIVERY_PHASES.INSERTED)
    return {
      owner: true,
      rebound: owner.rebound === true,
      operation: current,
      recovery: manualBatchRecoveryPayload(current, "watch_delivery"),
    };
  if (
    current.delivery.phase ===
    BridgeAutorunModel.DELIVERY_PHASES.INSERT_COMMITTED
  )
    return {
      owner: true,
      rebound: owner.rebound === true,
      operation: current,
      recovery: {
        ...manualBatchRecoveryPayload(
          current,
          "delivery_insert_outcome_unknown",
        ),
        code: "DELIVERY_INSERT_OUTCOME_UNKNOWN_NO_RETRY",
      },
    };
  return {
    owner: true,
    rebound: owner.rebound === true,
    operation: current,
    recovery: null,
  };
}
