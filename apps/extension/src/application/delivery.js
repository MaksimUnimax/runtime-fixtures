async function saPrompt(pinned, tree = null) {
  const store = await saAssertStore(pinned);
  const header = `Октопорт. Источник: ${store.marketplace === "ozon" ? "Ozon" : "Wildberries"}. Магазин: ${JSON.stringify(store.name)}. Store ID: ${store.id}. Новая рабочая сессия: прежние данные диалога могут относиться к другому магазину. Не смешивай источники.\n`;
  const hints = tree ? `\n\nПодсказки Октопорта для выбранного ИИ, опубликованная версия ${tree.version}:\n${OctoportPromptTrees.render(tree.body)}` : "";
  if (store.marketplace === "ozon") return header + DEFAULT_AUTO_START_TEXT + hints;
  return header + [
    "Ты работаешь с разрешёнными данными Wildberries через расширение пользователя. Секреты хранит расширение: никогда не проси ключ в чате.",
    "Пользователь разрешает один блок кнопкой «Октопорт». Выводи все явные независимые команды шага в одном fenced text code block. Выполняются последовательно; одна API-команда — максимум один запрос, HELP — локально.",
    'Начинай с локальной справки WB_HELP_V1 {"operation":"catalog","params":{"offset":0,"limit":25}}. Следующие страницы справки запроси явно.',
    'Перед незнакомой операцией: WB_HELP_V1 {"operation":"describe","params":{"alias":"seller_info"}}. Не придумывай операции, поля, права или схемы.',
    'API envelope: WB_API_V1 {"operation":"seller_info","params":{}}. Для иных операций params содержит path, query, body только по локальной карточке.',
    "Справка основана на закреплённой версии API. Подтверждением доступа служит ответ конкретной операции, а не наличие alias в справке.",
    "Не строй скрытые пагинации, опросы, повторы или зависимые запросы до получения ответа. После промежуточного ответа формируй следующий явный блок.",
    'Для явной сверки продаж с финансами локальный WB_CAP19_V1 JSON в начале того же одобряемого блока выбирает begin {action,businessPeriod:{fromInclusive,toExclusive,timezone},salesAcquisition:{updatedSince,flag:0},financePeriod:"daily"|"weekly",pages:[{entryOrdinal,stream:"sales"|"finance",ordinal}]} или continue {action,collectionId,pages}. За ним идут настоящие явные WB_API_V1 команды; metadata не делает запросов. Используй точные collectionId/cursors из WB_CAP19_COLLECTION_V1, срок не продлевается. Полный JSON-файл передаётся как явно обозначенный UTF-8 TXT derived business report, без FX/чистой выручки/полного бизнес-покрытия.',

    "Полученные WB_RESULT_V1 и WB_BATCH_RESULT_V1 относятся только к указанному магазину. Ошибки, UNKNOWN и отсутствие загруженного файла не являются успехом.",
    "Большие результаты и оригинальные файлы расширение прикрепляет к сообщению; читай их полностью. Локальный технический буфер живёт не более часа, архива нет.",
    `Передача персональных данных: ${store.personalDataEnabled ? "разрешена пользователем для этого магазина" : "выключена; соответствующие операции блокирует код"}. Только чтение; изменение цен, рекламы и карточек запрещено.`,
    "Ответь кратко, что подключён к указанному источнику и магазину; уточни задачу пользователя."
  ].join("\n") + hints;
}
function saCombinedReport(entries, owner, cap19Progress = null) {
  const p = owner.execution_context;
  const header = { source: p.marketplace, store_id: p.storeId, binding_id: p.bindingId,
    work_session_id: p.workSessionId, result_count: entries.length, created_at: owner.created_at,
    expires_at: new Date(owner.payload_expires_at_ms).toISOString() };
  const text = `${p.marketplace === "wildberries" ? "WB" : "OZON"}_BATCH_RESULT_V1\n${JSON.stringify(header)}\n\n` +
    entries.map((entry, i) => `===== RESULT ${i + 1}/${entries.length} =====\n${entry.report_text || ""}`).join("\n\n") +
    (cap19Progress ? "\n\nWB_CAP19_COLLECTION_V1\n" + JSON.stringify(cap19Progress) : "");
  // Preserve the scoped batch and exact result envelopes. This is the shipped
  // Ozon next-command contract, independent of the optional legacy prefix.
  return p.marketplace === "ozon"
    ? OzonLlmOutputReportWorkflowPatch.appendInstructionTail(text) : text;
}
async function saAssertCAP19ValueSafety(owner, value) {
  // The credential remains in the existing application guard. The collector and
  // artifact ABI receive a veto capability, never a token or authenticated headers.
  const guard = await saGuard(owner);
  await guard.assertCurrent();
  const credentials = await guard.credentials();
  await guard.assertCurrent();
  const token = credentials?.token;
  if (typeof token !== "string" || !token) throw saError("CAP19_VALUE_SAFETY_UNAVAILABLE");
  const check = text => { if (text.includes(token)) throw saError("CAP19_CREDENTIAL_ECHO"); };
  const pending = [value], seen = new Set(); let nodes = 0;
  while (pending.length) {
    if (++nodes > 2000000) throw saError("CAP19_VALUE_SAFETY_LIMIT");
    const item = pending.pop();
    if (typeof item === "string") check(item);
    else if (item !== null && typeof item === "object") {
      if (seen.has(item)) throw saError("CAP19_VALUE_SAFETY_INVALID");
      seen.add(item);
      for (const [key, child] of Object.entries(item)) { check(key); pending.push(child); }
    } else if (item !== undefined) check(String(item));
  }
  // Also exclude an exact byte sequence spanning serialized syntax/escapes.
  const encoded = JSON.stringify(value);
  if (typeof encoded === "string") check(encoded);
  await guard.assertCurrent();
}
async function saPrepareCAP19Delivery(owner) {
  if(!owner?.cap19_selection)return {refs:[],progress:null};
  const guard=await saGuard(owner);
  const api=SellerAgentsWBSalesFinanceManual;
  const result=await api.completeForDelivery(owner,{
    assertCurrent:()=>guard.assertCurrent(),
    assertSafeValues:value=>saAssertCAP19ValueSafety(owner,value),
    recordIntent:async descriptor=>{
      await guard.assertCurrent();
      await mutateManualOperation(owner.conversation_key,async current=>{
        await guard.assertCurrent();
        if(current?.operation_id!==owner.operation_id || current.status!==MANUAL_OPERATION_STATUSES.REQUESTING)
          throw saError("CAP19_ARTIFACT_INTENT_OWNER");
        if(current.cap19_artifact_intent && JSON.stringify(current.cap19_artifact_intent)!==JSON.stringify(descriptor))
          throw saError("CAP19_ARTIFACT_INTENT_CONFLICT");
        return {...current,cap19_artifact_intent:descriptor};
      });
    },
    store:async(record,options)=>{
      const current=await getManualOperation(owner.conversation_key);
      await guard.assertCurrent();
      return OzonFileDeliveryWorker.storeApplicationArtifact(record,{...options,owner:current});
    },
    read:async(descriptor,options)=>{
      const current=await getManualOperation(owner.conversation_key);
      await guard.assertCurrent();
      return OzonFileDeliveryWorker.readApplicationArtifact(descriptor,{...options,owner:current});
    },
  });
  try { await saAssertCAP19ValueSafety(owner,result); }
  catch(error) { api.invalidateForOwner(owner.operation_id); throw error; }
  await guard.assertCurrent();return result;
}
async function saPrepareDelivery(entries, owner) {
  if (!await saEnabled() || owner?.execution_context?.marketplace !== "wildberries") return entries;
  const guard = await saGuard(owner), result = [];
  for (const [entryIndex, entry] of entries.entries()) {
    await guard.assertCurrent();
    if (!entry.report_text?.startsWith("WB_RESULT_V1\n") || !(entry.http_status >= 200 && entry.http_status < 300)) { result.push(entry); continue; }
    const envelope = JSON.parse(entry.report_text.slice(entry.report_text.indexOf("\n") + 1));
    const data = envelope.result;
    if (typeof data?.content_base64 !== "string") { result.push(entry); continue; }
    const bytes = ProviderTransportCore.reportBase64ToBytes(data.content_base64);
    if (bytes.byteLength !== data.byte_length) throw saError("FILE_BYTE_LENGTH_MISMATCH");
    // The artifact identity is tied to the logical result, not to a worker
    // invocation. Re-finalizing after a restart therefore reuses the same
    // bounded artifact key instead of orphaning a second local file.
    // Include the pinned account, store and logical result so two independent
    // provider attempts cannot alias after lossy sanitization or truncation.
    // Keep the key stable across worker restarts for the same accepted result.
    const scope = SellerAgentsExecutionContext.snapshot(owner.execution_context);
    // Same bounded string identity convention as the established browser/ledger
    // contracts: reject malformed or excessive context before SHA-256.
    const boundedId = value => typeof value === "string" &&
      value.length > 0 && value.length <= 512;
    if (![scope.accountId, scope.storeId, scope.bindingId,
          scope.workSessionId, owner.operation_id].every(boundedId) ||
        !Number.isSafeInteger(scope.bindingRevision) || scope.bindingRevision < 0)
      throw saError("EXECUTION_CONTEXT_MISSING");
    // The same logical provider attempt must retain its ref even if an
    // unrelated batch entry moves its ordinal during restart reconciliation.
    const rawAttemptId = entry.provider_attempt?.provider_attempt_id;
    const rawRequestId = entry.request_id;
    if ((rawAttemptId != null && rawAttemptId !== "" && !boundedId(rawAttemptId)) ||
        (rawRequestId != null && rawRequestId !== "" && !boundedId(rawRequestId)))
      throw saError("FILE_REFERENCE_IDENTITY_INVALID");
    const attemptId = boundedId(rawAttemptId) ? rawAttemptId : null;
    const requestId = boundedId(rawRequestId) ? rawRequestId : null;
    const logicalId = attemptId ? ["provider_attempt", attemptId]
      : requestId ? ["request", requestId] : ["ordinal", entryIndex];
    const ref = `sa_file_${await sha256Hex(JSON.stringify([
      "wb_file_ref_v1", scope.marketplace, scope.accountId, scope.storeId,
      scope.bindingId, scope.bindingRevision, scope.workSessionId,
      owner.operation_id, logicalId,
    ]))}`;
    const filename = data.original_filename || `wb-report-${entry.operation || "result"}.${/pdf/i.test(data.content_type) ? "pdf" : /csv/i.test(data.content_type) ? "csv" : /spreadsheetml/i.test(data.content_type) ? "xlsx" : "bin"}`;
    await guard.assertCurrent();
    const descriptor = await OzonFileDeliveryWorker.storeApplicationArtifact({ artifact_key: `provider:${ref}`,
      source_kind: "original_provider_file", filename, mime_type: data.content_type,
      extension: OzonAIDeliveryCapabilities.extensionFromFilename(filename), bytes,
      created_at_ms: Date.now(), expires_at_ms: owner.payload_expires_at_ms });
    await guard.assertCurrent();
    envelope.result = { filename: descriptor.filename, byte_length: descriptor.byte_length,
      sha256: descriptor.sha256, delivery_status: "SAVED_FOR_ATTACHMENT_NOT_YET_SENT" };
    result.push({ ...entry, provider_file_ref: ref, report_text: `WB_RESULT_V1\n${JSON.stringify(envelope)}` });
  }
  return result;
}
