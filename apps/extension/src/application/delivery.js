async function saPrompt(pinned) {
  const store = await saAssertStore(pinned);
  const header = `Seller Agents. Источник: ${store.marketplace === "ozon" ? "Ozon" : "Wildberries"}. Магазин: ${JSON.stringify(store.name)}. Store ID: ${store.id}. Новая рабочая сессия: прежние данные диалога могут относиться к другому магазину. Не смешивай источники.\n`;
  if (store.marketplace === "ozon") return header + DEFAULT_AUTO_START_TEXT;
  return header + [
    "Ты работаешь с разрешёнными данными Wildberries через расширение пользователя. Секреты хранит расширение: никогда не проси ключ в чате.",
    "Пользователь разрешает один блок кнопкой WB. Выводи все явные независимые команды шага в одном fenced text code block. Выполняются последовательно; одна API-команда — максимум один запрос, HELP — локально.",
    'Начинай с локальной справки WB_HELP_V1 {"operation":"catalog","params":{"offset":0,"limit":25}}. Следующие страницы справки запроси явно.',
    'Перед незнакомой операцией: WB_HELP_V1 {"operation":"describe","params":{"alias":"seller_info"}}. Не придумывай операции, поля, права или схемы.',
    'API envelope: WB_API_V1 {"operation":"seller_info","params":{}}. Для иных операций params содержит path, query, body только по локальной карточке.',
    "Справка основана на закреплённой версии API. Подтверждением доступа служит ответ конкретной операции, а не наличие alias в справке.",
    "Не строй скрытые пагинации, опросы, повторы или зависимые запросы до получения ответа. После промежуточного ответа формируй следующий явный блок.",
    "Полученные WB_RESULT_V1 и WB_BATCH_RESULT_V1 относятся только к указанному магазину. Ошибки, UNKNOWN и отсутствие загруженного файла не являются успехом.",
    "Большие результаты и оригинальные файлы расширение прикрепляет к сообщению; читай их полностью. Локальный технический буфер живёт не более часа, архива нет.",
    `Передача персональных данных: ${store.personalDataEnabled ? "разрешена пользователем для этого магазина" : "выключена; соответствующие операции блокирует код"}. Только чтение; изменение цен, рекламы и карточек запрещено.`,
    "Ответь кратко, что подключён к указанному источнику и магазину; уточни задачу пользователя."
  ].join("\n");
}
function saCombinedReport(entries, owner) {
  const p = owner.execution_context;
  const header = { source: p.marketplace, store_id: p.storeId, binding_id: p.bindingId,
    work_session_id: p.workSessionId, result_count: entries.length, created_at: owner.created_at,
    expires_at: new Date(owner.payload_expires_at_ms).toISOString() };
  return `${p.marketplace === "wildberries" ? "WB" : "OZON"}_BATCH_RESULT_V1\n${JSON.stringify(header)}\n\n` +
    entries.map((entry, i) => `===== RESULT ${i + 1}/${entries.length} =====\n${entry.report_text || ""}`).join("\n\n");
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
    const artifactIdentity = String(entry.provider_attempt?.provider_attempt_id || entry.request_id || `${owner.operation_id}:${entryIndex}`)
      .replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 180);
    const ref = `sa_file_${artifactIdentity || `result-${entryIndex}`}`;
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
