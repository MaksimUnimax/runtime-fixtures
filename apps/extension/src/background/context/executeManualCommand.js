async function executeManualCommand(
  commandText,
  conversationKey,
  sender,
  manualRequestId,
  commandSource = null,
  recovery = null,
) {
  if (recovery && !saR3RetryPermits.delete(recovery)) throw saError("RETRY_INTERNAL_PERMIT_REQUIRED");
  const key = normalizeConversationKey(conversationKey);
  const senderTabId = Number(sender?.tab?.id || 0);
  if (!Number.isInteger(senderTabId) || senderTabId <= 0) {
    throw Object.assign(
      new Error(
        "Ручная Ozon-команда должна приходить из content script поддерживаемого AI.",
      ),
      { code: "MANUAL_SENDER_TAB_MISSING" },
    );
  }
  let requestToken = String(manualRequestId || "").trim();
  if (!requestToken)
    throw Object.assign(new Error("Manual request ID отсутствует."), {
      code: "MANUAL_REQUEST_ID_MISSING",
    });
  const ingressRequestToken = requestToken;
  const liveIdentity = await assertTabConversation(senderTabId, key);
  const binding = await strictBindingForIdentity(liveIdentity);
  const manualAutoSend = (await getSettings()).autoSend !== false;
  const workSession = await workSessionFor(key);

  let entries;
  let sourceStage = "command_discovery";
  if (workSession.state !== OzonWorkSessionModel.STATES.ACTIVE_VISIBLE) {
    sourceStage = "work_session_gate";
    entries = [
      batchErrorEntry(
        Object.assign(
          new Error(
            "Work-session этого AI-диалога не находится в состоянии active_visible. Ozon API request не выполнен.",
          ),
          { code: "WORK_SESSION_NOT_VISIBLE" },
        ),
        sourceStage,
        OzonContract.textFingerprint(commandText),
      ),
    ];
  } else if (!(await getManualMode(key))) {
    sourceStage = "manual_gate";
    entries = [
      batchErrorEntry(
        Object.assign(
          new Error(
            "Кнопка Ozon выключена для этого AI-диалога. API-запрос не выполнен.",
          ),
          { code: "MANUAL_MODE_OFF" },
        ),
        sourceStage,
        OzonContract.textFingerprint(commandText),
      ),
    ];
  } else {
    const run = await getAutoRun(key);
    if (run && !BridgeAutorunModel.canEnableManualMode(run.status)) {
      sourceStage = "manual_gate";
      entries = [
        batchErrorEntry(
          Object.assign(
            new Error("Авторежим активен. Ручной API-вызов не выполнен."),
            { code: "AUTO_MODE_ACTIVE" },
          ),
          sourceStage,
          OzonContract.textFingerprint(commandText),
        ),
      ];
    } else {
      try {
        entries = binding.store_context?.marketplace === "wildberries" ? SellerAgentsWBAdapter.discover(commandText) : discoverBatchEntries(commandText);
        if (binding.store_context?.marketplace === "ozon" && /\bWB_(?:API|HELP|FILE)_V[12]\b/.test(commandText)) throw saError("MIXED_MARKETPLACE_BLOCK");
      } catch (error) {
        entries = [
          batchErrorEntry(
            error,
            "command_discovery",
            OzonContract.textFingerprint(commandText),
          ),
        ];
      }
      if (!entries.length) {
        entries = [
          batchErrorEntry(
            Object.assign(
              new Error("В тексте не найдено ни одной OZON_API_V1 команды."),
              { code: "NO_OZON_COMMANDS" },
            ),
            "command_discovery",
            OzonContract.textFingerprint(commandText),
          ),
        ];
      }
    }
  }

  const r3Enabled = await saEnabled();
  const r3Prepared = r3Enabled ? await saR3PrepareCommandSource(commandSource, sender, liveIdentity, binding, workSession, key, commandText) : null;
  if (r3Prepared) requestToken = recovery?.context.requestId || r3Prepared.requestToken;
  if (r3Enabled && !await SellerAgentsControlClient.canWork(liveIdentity))
    throw Object.assign(new Error("Work policy blocked"), { code: "WORK_POLICY_BLOCKED" });
  const promptTree = { pin: null };
  if (r3Enabled && workSession.state === OzonWorkSessionModel.STATES.ACTIVE_VISIBLE) {
    if (!Object.prototype.hasOwnProperty.call(workSession, "prompt_tree"))
      throw saError("WORK_PROMPT_TREE_PIN_MISSING_START_REQUIRED");
    if (workSession.prompt_tree)
      promptTree.pin = await SellerAgentsControlClient.validatePromptTreePin(liveIdentity, workSession.prompt_tree);
  }
  if (r3Prepared && promptTree.pin) r3Prepared.source.promptTree = { aiId: promptTree.pin.aiId, version: promptTree.pin.version, sha256: promptTree.pin.sha256 };
  const executionContext = await captureBatchContext(
    key,
    commandText,
    requestToken,
  );
  if (recovery) {
    SellerAgentsExecutionContext.assertSame(recovery.context, await saReadContext(key, { commandHash: executionContext.commandHash, requestId: executionContext.requestId }));
    if (!r3Prepared || recovery.blockVersion !== r3Prepared.blockVersion || recovery.blockOriginKey !== r3Prepared.blockOriginKey)
      throw saError("RETRY_PREVIEW_CHANGED");
    entries = recovery.ordinals.map(ordinal => {
      if (!entries[ordinal]) throw saError("RETRY_SELECTION_CHANGED");
      return { ...entries[ordinal], r3_original_ordinal: ordinal };
    });
  }
  const r3Reservation = recovery?.reservation || (r3Prepared ? await saR3ReserveCommand(r3Prepared, executionContext, entries, ingressRequestToken) : null);
  const operationId = `ozmanual-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  let duplicateOperation = null;
  const operation = await mutateManualOperation(key, async (current) => {
    let seen = [];
    if (await saEnabled()) {
      const guard = SellerAgentsExecutionContext.createGuard(executionContext, () => readBatchContextState(key, { commandHash: executionContext.commandHash, requestId: requestToken }));
      await guard.assertCurrent();
      seen = current?.execution_context?.workSessionId === executionContext.workSessionId ? (current.seen_request_ids || []) : [];
      if (seen.includes(ingressRequestToken)) throw saError("MANUAL_REQUEST_DUPLICATE");
      if (seen.length >= 2000) throw saError("WORK_MARKER_CAPACITY_START_REQUIRED");
    }
    if (current?.manual_request_id === ingressRequestToken) {
      duplicateOperation = current;
      return current;
    }
    if (manualOperationActive(current)) return current;
    return {
      operation_id: operationId,
      manual_request_id: ingressRequestToken,
      conversation_key: key,
      origin: liveIdentity.origin,
      conversation_id: liveIdentity.conversation_id,
      binding_snapshot: bindingSnapshot(binding),
      execution_context: executionContext,
      prompt_tree: promptTree.pin,
      ...(r3Reservation ? { r3_execution_id: r3Reservation.executionId, r3_source: r3Prepared.source,
        r3_block_origin_key: r3Prepared.blockOriginKey, r3_block_version: r3Prepared.blockVersion } : {}),
      seen_request_ids: [...seen, ingressRequestToken],
      payload_expires_at_ms: r3Reservation?.payloadExpiresAt || Date.now() + 3600000,
      tab_id: senderTabId,
      status: MANUAL_OPERATION_STATUSES.REQUESTING,
      operation: null,
      last_operation: null,
      command_summary: `${entries.length} queued OZON_API_V1 item(s)`,
      request_id: null,
      request_worker_session_id: null,
      delivery_id: null,
      outgoing_text: null,
      auto_send: manualAutoSend,
      report_prefix_applied: false,
      delivery_confirmed: false,
      delivery: null,
      batch: {
        phase: "collecting",
        source: "manual_copy",
        entries,
        next_index: 0,
        request_state: "idle",
        request_worker_session_id: null,
        planning_state: "pending",
        capability_resolution: null,
        query_planning_state: "pending",
        query_plan: null,
        quota_wait: null,
        request_quota: null,
        created_at: now,
      },
      created_at: now,
      completed_at: null,
      last_error: null,
    };
  });
  if (duplicateOperation) {
    throw Object.assign(
      new Error(
        "Эта ручная операция уже принята. Повторный API-вызов запрещён.",
      ),
      {
        code: "MANUAL_REQUEST_DUPLICATE",
        operation_id: duplicateOperation.operation_id,
      },
    );
  }
  if (!operation || operation.operation_id !== operationId) {
    throw Object.assign(
      new Error("Bridge уже выполняет или доставляет ручной Ozon batch."),
      { code: "MANUAL_OPERATION_ACTIVE" },
    );
  }
  await diagnostic("MANUAL_BATCH_ACCEPTED", {
    operation_id: operationId,
    manual_request_id: ingressRequestToken,
    conversation_id: liveIdentity.conversation_id,
    tab_id: senderTabId,
    item_count: entries.length,
    command_count: entries.filter((entry) => entry.kind === "command").length,
    pre_execution_error_count: entries.filter(
      (entry) => entry.kind !== "command",
    ).length,
    source_stage: sourceStage,
  });
  launchBatchProcessor("manual", key, operationId, "manual_admission");
  return {
    ok: true,
    accepted: true,
    manual_operation_id: operationId,
    manual_request_id: ingressRequestToken,
    item_count: entries.length,
    command_count: entries.filter((entry) => entry.kind === "command").length,
    pre_execution_error_count: entries.filter(
      (entry) => entry.kind !== "command",
    ).length,
  };
}
