"use strict";
const $ = id => document.getElementById(id);
let tabId, state, marketplace = "ozon", selectedId = "", editingId = null, busy = false, confirmAction = null;
let backupText = "";
const texts = { ACCESS_CONFIRMED: "Доступ подтверждён этой проверкой; кабинет и полный набор прав ещё не подтверждены",
  CREDENTIAL_REJECTED: "Ключ отклонён (401). Причина и срок действия не подтверждены", ACCESS_DENIED: "Недостаточно прав (403)",
  CHECK_FAILED: "Не удалось проверить: сеть, ответ площадки или формат запроса", STORE_CHANGE_CONFIRMATION_REQUIRED: "Подтвердите смену магазина",
  WORK_SESSION_ALREADY_ACTIVE: "Этот магазин уже подключён", STORE_NOT_FOUND: "Магазин удалён. Откройте список заново",
  POPUP_CONTEXT_STALE: "Диалог изменился. Откройте расширение в нужной вкладке", WORK_START_UNSUPPORTED_PAGE: "Откройте поддерживаемый ИИ: ChatGPT или Алису",
  EXECUTION_CONTEXT_CHANGED: "Магазин или рабочая сессия изменились. Нажмите «Начать работу»", RESULT_EXPIRED: "Часовой срок результата истёк", NO_QUOTA_WAIT: "Нет пакета, ожидающего продолжения",
  AUTH_REQUIRED: "Выполните вход через портал", WORK_POLICY_BLOCKED: "Работа недоступна: подписанная политика не разрешила этот профиль ИИ", DEVICE_AUTH_CLOSED: "Попытка входа закрыта. Начните новую попытку", BOOTSTRAP_EXPIRED: "Проверенная сессия истекла. Выполните вход заново",
  UNSUPPORTED_BROWSER: "Текущий браузер или его версия не подтверждены подписанной совместимостью. Доказательства другого браузера не переносятся сюда", BOOTSTRAP_PROFILE_INCOMPATIBLE: "Подписанная конфигурация не разрешает текущую версию расширения или браузера", WORK_UNSUPPORTED_AI: "Откройте поддерживаемый ИИ: ChatGPT или Алису",
  SYNC_EXPLICIT_BINDING_CONFLICT: "На другой установке этот диалог привязан иначе. Автоматическая смена магазина заблокирована — проверьте магазин и выполните явный Start заново",
  SYNC_SERVER_FINISH_FENCE: "Для этого диалога уже подтверждено более новое завершение Work. Чтобы продолжить, выполните явный Start заново",
  SYNC_NEWER_BINDING_FENCE: "На другой установке подтверждена более новая привязка этого диалога. Проверьте выбранный магазин и выполните явный Start заново",
  CONVERSATION_MISMATCH: "Во время действия открытый ИИ-диалог изменился. Вернитесь в нужный диалог, откройте расширение заново и повторите действие",
  CONVERSATION_NOT_BOUND: "Этот ИИ-диалог сейчас не привязан к магазину. Выберите магазин и выполните «Начать работу»",
  WORK_START_ALREADY_IN_PROGRESS: "Для этого диалога уже идёт запуск или активная операция. Дождитесь её завершения либо завершите текущую работу перед новым Start",
  WORK_SESSION_NOT_INACTIVE: "Продолжить можно только завершённую Work-сессию. Проверьте текущее состояние диалога и используйте доступное действие",
  WORK_RESUME_OPERATION_ACTIVE: "В диалоге ещё выполняется операция. Дождитесь её завершения перед возобновлением Work",
  WORK_AUTHORITY_DENIED: "Текущая подписанная политика не разрешает это действие. Обновите состояние расширения; автоматический обход ограничения не выполняется",
  WORK_AUTHORITY_REFRESH_REQUIRED: "Нужно обновить подтверждённое состояние Work. Подключитесь к сети и повторите действие",
  BOOTSTRAP_SNAPSHOT_INVALID: "Подписанное состояние установки повреждено или неполно. Выполните повторный вход через портал",
  ACCOUNT_CHANGED: "Аккаунт изменился во время операции. Откройте расширение заново и повторите действие в нужном аккаунте",
  BACKUP_PASSWORD_CONFIRMATION_MISMATCH: "Пароль и подтверждение пароля не совпадают",
  BACKUP_EXPLICIT_ACTION_REQUIRED: "Импорт требует отдельного явного подтверждения после проверки файла",
  TRANSFER_INVALID: "Запрос передачи повреждён или устарел. Создайте новый запрос передачи и не повторяйте старый пакет",
  SOURCE_OFFLINE: "Источник передачи сейчас недоступен. Повтор не считается доставкой", TRANSFER_VAULT_UNAVAILABLE: "Безопасное локальное хранилище ключа передачи недоступно. Передача не начата", TRANSFER_VAULT_PERSIST_FAILED: "Не удалось безопасно сохранить локальный ключ передачи. Запрос не считается готовым", TRANSFER_VAULT_CLEAR_FAILED: "Не удалось подтвердить очистку локального ключа передачи. Сброс не считается завершённым",
  TRANSFER_KEY_MISSING: "Локальный ключ этой передачи отсутствует. Создайте новый запрос на получающей установке", TRANSFER_ACCOUNT_MISMATCH: "Передача относится к другому аккаунту или установке и заблокирована", TRANSFER_EXPIRED: "Срок запроса передачи истёк. Создайте новый запрос", TRANSFER_REPLAY: "Передача уже завершена или повтор заблокирован" };
async function request(type, fields = {}) {
  const response = await chrome.runtime.sendMessage({ type, tab_id: tabId, ...fields });
  if (!response?.ok) throw new Error(texts[response?.code] || `Действие не выполнено: ${response?.code || "нет ответа расширения"}`);
  return response;
}
async function action(fn) { if (busy) return; busy = true; $("status").textContent = "Выполняем…"; try { await fn(); await refresh(); $("status").textContent = "Готово"; } catch (e) { $("status").textContent = e.message; } finally { busy = false; } }
function selected() { return state?.stores.find(x => x.id === selectedId); }
function onboardingModel(value) {
  const authenticated = value?.auth?.authenticated === true;
  const hasStore = authenticated && Array.isArray(value?.stores) && value.stores.length > 0;
  const aiReady = Boolean(value?.identity?.ai_id && ["chatgpt", "alice"].includes(value.identity.ai_id));
  const workReady = Boolean(value?.context?.work_active === true && ["active_visible", "active_hidden", "recovering"].includes(value?.work?.state));
  return [
    { id: "onboarding-auth", done: authenticated, text: authenticated ? "1. Вход через портал подтверждён." : "1. Войдите через портал и подтвердите эту установку." },
    { id: "onboarding-store", done: hasStore, text: hasStore ? "2. Магазин добавлен." : "2. Добавьте магазин Ozon или WB и сохраните его ключи локально." },
    { id: "onboarding-ai", done: aiReady, text: aiReady ? `3. Открыт ${value.identity.ai_id === "chatgpt" ? "ChatGPT" : "Алиса"}.` : "3. Откройте ChatGPT или Алису в текущей вкладке." },
    { id: "onboarding-work", done: workReady, text: workReady ? "4. Work активен — расширение готово к командам." : "4. После первых трёх шагов выберите магазин и нажмите «Начать работу»." },
  ];
}
function renderOnboarding() {
  const steps = onboardingModel(state);
  const firstPending = steps.find(step => !step.done)?.id || null;
  for (const step of steps) {
    const node = $(step.id);
    node.textContent = step.text;
    node.classList.toggle("done", step.done);
    if (step.id === firstPending) node.setAttribute("aria-current", "step"); else node.removeAttribute("aria-current");
  }
}
function render() {
  const authenticated = state.auth?.authenticated === true;
  $("account").textContent = state.account.label;
  $("auth").hidden = authenticated;
  $("catalog").hidden = !authenticated;
  $("auth-status").textContent = state.auth?.lastError ? (texts[state.auth.lastError.code] || state.auth.lastError.code) : authenticated ? "Вход подтверждён подписанным bootstrap V2." : state.auth?.pending ? "Откройте портал и подтвердите устройство для своего аккаунта." : "Войдите, чтобы подключить принадлежащий вам аккаунт.";
  $("auth-code").textContent = state.auth?.pending ? `Код подтверждения: ${state.auth.pending.userCode}` : "";
  $("auth-open").hidden = !state.auth?.pending;
  $("auth-start").textContent = state.auth?.pending ? "Открыть портал ещё раз" : "Войти через портал";
  $("auth-reset").hidden = !authenticated && !state.auth?.pending;
  $("auth-cancel").hidden = !state.auth?.pending;
  const extensionCompatibility = state.auth?.compatibility?.extension;
  const updateRecommended = authenticated && extensionCompatibility?.status === "UPDATE_RECOMMENDED";
  $("compatibility-note").hidden = !updateRecommended;
  $("compatibility-note").textContent = updateRecommended ? `Подписанная конфигурация рекомендует обновить расширение. Текущая версия пока разрешена.${extensionCompatibility.minimumVersion ? ` Минимально допустимая версия: ${extensionCompatibility.minimumVersion}.` : ""}` : "";
  renderOnboarding();
  if (!authenticated) return;
  for (const id of ["ozon", "wildberries"]) $(id).setAttribute("aria-pressed", String(id === marketplace));
  const choices = state.stores.filter(s => s.marketplace === marketplace);
  if (!choices.some(x => x.id === selectedId)) selectedId = choices[0]?.id || "";
  $("stores").replaceChildren(...choices.map(store => { const option = document.createElement("option"); option.value = store.id; option.textContent = store.name; return option; }));
  $("stores").value = selectedId;
  $("edit").disabled = $("remove").disabled = !selected();
  const s = selected();
  $("check-seller").hidden = $("check-performance").hidden = marketplace !== "ozon";
  $("check-token").hidden = marketplace !== "wildberries";
  $("check-seller").disabled = !s?.sellerPresent; $("check-performance").disabled = !s?.performancePresent; $("check-token").disabled = !s?.tokenPresent;
  $("verification").textContent = Object.entries(s?.verification || {}).map(([part, v]) => `${part}: ${texts[v.code] || v.code}`).join(". ") || "Кабинет и доступ не проверены. Проверка выполняется только по нажатию.";
  const connected = state.stores.find(x => x.id === state.context.store_id), active = state.context.work_active;
  const labels = { active_visible: "Работаем", active_hidden: "Работаем · кнопка скрыта", recovering: "Восстанавливаем", binding: "Подключаем", error: "Ошибка запуска", inactive: "Завершено" };
  $("connection").textContent = state.identity.ai_id ? connected ? `${labels[state.work?.state] || "Диалог подключён"}: ${connected.name} · ${connected.marketplace === "ozon" ? "Ozon" : "WB"}` : "Диалог не подключён" : "Откройте ChatGPT или Алису в текущей вкладке";
  $("selection").textContent = connected && selectedId !== connected.id ? "Выбран следующий магазин. Текущее подключение изменится только после подтверждения и нового Start." : "";
  if (state.pending) $("connection").textContent = state.pending.send_outcome === "outcome_unknown_no_retry" ? "Исход отправки инструкции неизвестен. Повторная отправка заблокирована" : "Запускаем: ожидаем подтверждение инструкции и ответа ИИ";
  $("start").disabled = Boolean(state.pending) || !s || !state.identity.ai_id || ["binding", "recovering", "finishing"].includes(state.work?.state);
  $("work-resume").hidden = !(state.context.store_id && state.work?.state === "inactive" && state.context.work_active !== true);
  $("work-resume").disabled = Boolean(state.pending) || !state.conversation_key;
  $("visibility").disabled = !active; $("finish").disabled = !active && state.work?.state !== "error" && !state.pending;
  $("visibility").textContent = state.context.button_visible ? "Скрыть кнопку" : "Показать кнопку";
  $("resume").hidden = !state.operation?.quota_wait;
}
async function refresh(first = false) {
  state = await request("SA_POPUP_STATE");
  if (first && state.context.store_id) { const current = state.stores.find(s => s.id === state.context.store_id); if (current) { selectedId = current.id; marketplace = current.marketplace; } }
  render();
}
function closeCard() { $("card").reset(); $("card").hidden = true; editingId = null; }
function openCard(store) {
  closeCard(); editingId = store?.id || null; $("card").hidden = false;
  $("name").value = store?.name || ""; $("seller-id").value = store?.sellerClientId || ""; $("performance-id").value = store?.performanceClientId || ""; $("personal").checked = store?.personalDataEnabled === true;
  $("seller").hidden = $("performance").hidden = marketplace !== "ozon"; $("wb").hidden = marketplace !== "wildberries";
  $("name").focus();
}
function confirm(text, fn) { $("confirmation-text").textContent = text; confirmAction = fn; $("confirmation").hidden = false; $("confirm").focus(); }
for (const id of ["ozon", "wildberries"]) $(id).onclick = () => { marketplace = id; selectedId = ""; closeCard(); render(); };
$("stores").onchange = () => { selectedId = $("stores").value; closeCard(); render(); };
$("add").onclick = () => openCard(null); $("edit").onclick = () => openCard(selected()); $("cancel").onclick = closeCard;
$("card").onsubmit = e => { e.preventDefault(); action(async () => {
  const credentials = marketplace === "wildberries" ? { token: $("token").value } : { seller: { clientId: $("seller-id").value, apiKey: $("seller-key").value }, performance: { clientId: $("performance-id").value, clientSecret: $("performance-key").value }, clearPerformance: $("clear-performance").checked };
  const response = await request("SA_STORE_SAVE", { store: { id: editingId, marketplace, name: $("name").value, personalDataEnabled: $("personal").checked, credentials } });
  selectedId = response.store.id; closeCard();
}); };
$("remove").onclick = () => { const id = selectedId; confirm(`Удалить магазин «${selected()?.name}» и его ключи? Все связанные с ним локальные рабочие сессии будут завершены.`, () => request("SA_STORE_DELETE", { store_id: id, confirm: true })); };
$("start").onclick = () => { const id = selectedId; const run = confirm_change => request("SA_WORK_START", { store_id: id, confirm_change, start_intent_id: crypto.randomUUID() });
  if (state.context.store_id && state.context.store_id !== id) confirm("В диалоге останутся данные предыдущего магазина. ИИ может смешать их в ответах. Старую работу завершим и отправим новую инструкцию для выбранного магазина.", () => run(true)); else action(() => run(false)); };
$("confirm").onclick = () => { const fn = confirmAction; confirmAction = null; $("confirmation").hidden = true; if (fn) action(fn); };
$("reject").onclick = () => { confirmAction = null; $("confirmation").hidden = true; };
$("work-resume").onclick = () => action(() => request("SA_WORK_RESUME", { conversation_key: state.conversation_key }));
$("visibility").onclick = () => action(() => request(state.context.button_visible ? "OZ_WORK_HIDE" : "OZ_WORK_SHOW", { conversation_key: state.conversation_key }));
$("finish").onclick = () => action(() => request("OZ_WORK_FINISH", { conversation_key: state.conversation_key }));
$("resume").onclick = () => action(() => request("SA_RESUME_QUOTA"));
$("transfer-create").onclick = () => action(async () => {
  if (!$("transfer-consent").checked) throw new Error("Сначала подтвердите явное согласие на передачу через транспорт Seller Agents");
  if (!selectedId) throw new Error("Выберите магазин для передачи");
  const result = await request("SA_TRANSFER_CREATE", { consent: true, selectedStoreIds: [selectedId] });
  $("transfer-status").textContent = `Запрос создан до ${new Date(result.request.expiresAt).toLocaleTimeString()}. Источник должен быть активен.`;
});
$("transfer-discover").onclick = () => action(async () => {
  const result = await request("SA_TRANSFER_SOURCE_DISCOVER");
  $("transfer-status").textContent = result.requests.length ? `Найдено запросов: ${result.requests.length}. Передача выполняется только после явного действия источника.` : "Активных запросов нет. Если источник спит, он не будет обещанно найден немедленно.";
});
$("transfer-receive").onclick = () => action(async () => {
  const result = await request("SA_TRANSFER_RECEIVE_PENDING");
  $("transfer-status").textContent = result.importState === "IMPORTED" ? "Передача принята и магазин импортирован." : result.importState === "CONFLICT" ? "Передача получена, но импорт остановлен из-за конфликта магазина." : result.code === "SOURCE_OFFLINE" ? "Источник ещё не доставил передачу." : "Активной передачи для получения нет.";
  if (result.importState === "IMPORTED" && result.requestId) void request("SA_TRANSFER_RESULT_CONSUME", { requestId: result.requestId }).catch(() => null);
});
$("support-generate").onclick = () => action(async () => {
  const result = await request("SA_SUPPORT_SNAPSHOT");
  $("support-snapshot").value = JSON.stringify(result.snapshot, null, 2);
  $("support-snapshot").hidden = false;
});
$("auth-start").onclick = () => action(() => request("SA_AUTH_START"));
$("auth-open").onclick = () => action(() => request("SA_AUTH_OPEN_PORTAL"));
$("auth-cancel").onclick = () => action(() => request("SA_AUTH_CANCEL"));
$("auth-reset").onclick = () => confirm("Локально завершить текущую сессию и выбрать аккаунт заново? Сохранённые магазины останутся изолированными по аккаунту.", () => request("SA_AUTH_RESET"));
for (const part of ["seller", "performance", "token"]) $("check-" + part).onclick = () => action(() => request("SA_STORE_CHECK", { store_id: selectedId, part }));
function downloadBackup(name, value) {
  const url = URL.createObjectURL(new Blob([value], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function backupSummary(preview) {
  const conflicts = preview.classifications.filter(row => !["IMPORT_NEW", "SAME_CURRENT"].includes(row.kind));
  return `${preview.legacy ? "Распознан старый provider backup через явный адаптер. Пароль старого файла не проверяется." : "Зашифрованный Seller Agents backup v1."} Магазинов: ${preview.storeCount}. Ozon/WB: ${preview.marketplaces.join(", ") || "нет"}. Безопасно добавить: ${preview.safeImportCount}. Уже совпадают: ${preview.storeCount - preview.safeImportCount - preview.rejectedCount}. Отклонено конфликтов: ${preview.rejectedCount}. ${conflicts.length ? "Конфликты пропущены без перезаписи." : "Конфликтов нет."}`;
}
$("backup-export").onclick = () => action(async () => {
  const password = $("backup-password").value, confirmation = $("backup-password-confirm").value;
  if (password.length < 8) throw new Error("Пароль должен содержать не менее 8 символов");
  const response = await request("SA_BACKUP_EXPORT", { password, passwordConfirmation: confirmation });
  downloadBackup(response.fileName, response.backup);
  $("backup-password").value = $("backup-password-confirm").value = "";
  $("backup-status").textContent = `Экспортировано магазинов: ${response.storeCount}. Файл сохранён локально как ${response.fileName}.`;
});
$("backup-preview").onclick = () => action(async () => {
  const file = $("backup-file").files?.[0];
  if (!file) throw new Error("Выберите файл копии");
  if (file.size > 8 * 1024 * 1024) throw new Error("Файл больше 8 MiB");
  backupText = await file.text();
  const response = await request("SA_BACKUP_PREVIEW", { backup: backupText, password: $("backup-import-password").value });
  $("backup-summary").textContent = backupSummary(response.preview);
  $("backup-preview-result").hidden = false;
  $("backup-status").textContent = "Проверка завершена. Нажмите финальную кнопку, чтобы применить только безопасные новые магазины.";
});
$("backup-import").onclick = () => action(async () => {
  if (!backupText) throw new Error("Сначала проверьте файл");
  const response = await request("SA_BACKUP_IMPORT", { backup: backupText, password: $("backup-import-password").value, apply: true });
  $("backup-status").textContent = `Импорт завершён: добавлено ${response.imported.length}; конфликты не перезаписаны.`;
  $("backup-preview-result").hidden = true; $("backup-file").value = ""; $("backup-import-password").value = ""; backupText = "";
});
chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => { tabId = tabs[0]?.id; return refresh(true); }).catch(e => { $("status").textContent = e.message; });

let refreshTimer;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !Object.keys(changes).some(key => ["seller_agents_control_auth_v2", "seller_agents_stores_v1", "ozmb_work_sessions_v1", "ozmb_pending_work_starts_v1", "ozmb_conversation_bindings", "ozmb_manual_operations"].includes(key))) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { if (!busy && tabId) refresh().catch(e => { $("status").textContent = e.message; }); }, 100);
});
