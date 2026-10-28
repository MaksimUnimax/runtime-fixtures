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
    "Полученные WB_RESULT_V1 и WB_BATCH_RESULT_V1 относятся только к указанному магазину. Ошибки, UNKNOWN и отсутствие загруженного файла не являются успехом.",
    "Большие результаты и оригинальные файлы расширение прикрепляет к сообщению; читай их полностью. Локальный технический буфер живёт не более часа, архива нет.",
    `Передача персональных данных: ${store.personalDataEnabled ? "разрешена пользователем для этого магазина" : "выключена; соответствующие операции блокирует код"}. Только чтение; изменение цен, рекламы и карточек запрещено.`,
    "Ответь кратко, что подключён к указанному источнику и магазину; уточни задачу пользователя."
  ].join("\n") + hints;
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


// WB application helpers extend the frozen Ozon file worker without editing
// the imported baseline. Its IndexedDB store remains the attachment authority.
function saWbFileError(code) { return Object.assign(new Error(code), { code }); }
function saWbFileBytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  throw saWbFileError("APPLICATION_FILE_BYTES_INVALID");
}
async function saWbFileHash(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(d, (v) => v.toString(16).padStart(2, "0")).join("");
}
(function saInstallApplicationArtifactMethods() {
  const original = globalThis.OzonFileDeliveryWorker;
  if (!original?.DB_NAME || !original?.STORE_NAME) return;
  if (typeof original.storeApplicationArtifact === "function" && typeof original.copyManifest === "function") return;
  const MAX_TTL_MS = 60 * 60 * 1000;
  async function openDb() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(original.DB_NAME, 1);
      r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains(original.STORE_NAME))
        db.createObjectStore(original.STORE_NAME, { keyPath: "artifact_key" }); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error || saWbFileError("APPLICATION_FILE_DB_OPEN_FAILED"));
      r.onblocked = () => reject(saWbFileError("APPLICATION_FILE_DB_BLOCKED"));
    });
  }
  async function transaction(mode, executor) {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(original.STORE_NAME, mode);
        let result, ready = false, settled = false;
        function fail(error) {
          if (settled) return;
          settled = true;
          try { tx.abort(); } catch (_) {}
          reject(error);
        }
        tx.onabort = () => fail(tx.error || saWbFileError("APPLICATION_FILE_TX_ABORTED"));
        tx.onerror = () => fail(tx.error || saWbFileError("APPLICATION_FILE_TX_FAILED"));
        tx.oncomplete = () => {
          if (settled) return;
          if (!ready) return fail(saWbFileError("APPLICATION_FILE_TX_INCOMPLETE"));
          settled = true; resolve(result);
        };
        try { executor(tx.objectStore(original.STORE_NAME), (value) => {
          ready = true; result = value;
        }, fail); } catch (error) { fail(error); }
      });
    } finally { try { db.close(); } catch (_) {} }
  }
  function equalRecord(old, row) {
    return old?.artifact_key === row.artifact_key && old?.source_kind === row.source_kind &&
      old?.filename === row.filename && old?.mime_type === row.mime_type &&
      old?.extension === row.extension && old?.sha256 === row.sha256 &&
      old?.byte_length === row.byte_length && Number(old?.expires_at_ms) > Date.now();
  }
  function descriptor(row) {
    return Object.freeze({
      artifact_key: String(row.artifact_key), source_kind: String(row.source_kind),
      filename: String(row.filename), mime_type: String(row.mime_type || "application/octet-stream"),
      extension: String(row.extension || ""), byte_length: Number(row.byte_length),
      sha256: String(row.sha256), complete: true
    });
  }
  async function storeApplicationArtifact(input) {
    const key = String(input?.artifact_key || "");
    if (!/^provider:sa_file_[a-f0-9]{64}$/.test(key) || input?.source_kind !== "original_provider_file")
      throw saWbFileError("APPLICATION_FILE_IDENTITY_INVALID");
    const bytes = saWbFileBytes(input.bytes);
    const now = Date.now(), expires = Number(input.expires_at_ms);
    if (!Number.isFinite(expires) || expires <= now)
      throw saWbFileError("APPLICATION_FILE_EXPIRED_NO_RETRY");
    const filename = String(input.filename || "wb-report.bin")
      .replace(/[\u0000-\u001f\u007f]/g, "").replace(/[\\/]/g, "_")
      .trim().replace(/^\.+/, "").replace(/\.{2,}/g, ".").slice(0, 180) || "wb-report.bin";
    const fresh = { artifact_key: key, source_kind: input.source_kind, filename,
      mime_type: String(input.mime_type || "application/octet-stream").slice(0, 160),
      extension: String(input.extension || "").toLowerCase().slice(0, 24),
      byte_length: bytes.byteLength, sha256: await saWbFileHash(bytes),
      bytes: bytes.buffer, created_at_ms: now,
      expires_at_ms: Math.min(expires, now + MAX_TTL_MS) };
    const row = await transaction("readwrite", (store, done, fail) => {
      const get = store.get(key);
      get.onsuccess = () => {
        try {
          if (get.result) {
            if (!equalRecord(get.result, fresh))
              return fail(saWbFileError("APPLICATION_FILE_IDENTITY_CONFLICT_NO_OVERWRITE"));
            return done(get.result);
          }
          const add = store.add(fresh); // atomic add: no overwriting existing artifacts.
          add.onsuccess = () => done(fresh);
          add.onerror = () => fail(add.error || saWbFileError("APPLICATION_FILE_INSERT_FAILED"));
        } catch (e) { fail(e); }
      };
      get.onerror = () => fail(get.error || saWbFileError("APPLICATION_FILE_READ_FAILED"));
    });
    return descriptor(row); // IndexedDB transaction has committed.
  }
  async function copyManifest(delivery) {
    if (delivery?.mode !== "attachment_watch_v1" ||
        !["attachment_committed", "attachment_ready", "attachment_send_committed", "attachment_confirmed"].includes(delivery.phase) ||
        !Array.isArray(delivery.artifact_descriptors) || !delivery.artifact_descriptors.length)
      throw saWbFileError("ATTACHMENT_MANIFEST_NOT_READY_NO_RETRY");
    const manifests = [];
    for (const expected of delivery.artifact_descriptors) {
      const record = await transaction("readonly", (store, done, fail) => {
        const get = store.get(String(expected?.artifact_key || ""));
        get.onsuccess = () => done(get.result);
        get.onerror = () => fail(get.error || saWbFileError("ATTACHMENT_MANIFEST_READ_FAILED"));
      });
      if (!record || Number(record.expires_at_ms) <= Date.now() ||
          record.artifact_key !== expected.artifact_key ||
          record.byte_length !== expected.byte_length || record.sha256 !== expected.sha256 ||
          record.filename !== expected.filename || record.source_kind !== expected.source_kind ||
          await saWbFileHash(saWbFileBytes(record.bytes)) !== record.sha256)
        throw saWbFileError("ATTACHMENT_MANIFEST_INTEGRITY_UNKNOWN_NO_RETRY");
      manifests.push(descriptor(record));
    }
    return manifests;
  }
  globalThis.OzonFileDeliveryWorker = Object.freeze({
    ...original,
    storeApplicationArtifact: typeof original.storeApplicationArtifact === "function"
      ? original.storeApplicationArtifact : storeApplicationArtifact,
    copyManifest: typeof original.copyManifest === "function"
      ? original.copyManifest : copyManifest
  });
})();
