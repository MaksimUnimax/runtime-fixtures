"use strict";
const $ = id => document.getElementById(id);
const BACKUP_IMPORT_FRAGMENT = "#backup-import";
const durableImportMode = globalThis.location?.hash === BACKUP_IMPORT_FRAGMENT;
let tabId, state, marketplace = "ozon", selectedId = "", editingId = null, busy = false, confirmAction = null;
let backupText = "";
let actionGeneration = 0, refreshGeneration = 0;
let refreshTimer, refreshRequested = false;
const FIREFOX_TECHNICAL_CATEGORY = "technicalAndInteraction";
function firefoxTechnicalPermissions() { return globalThis.browser?.permissions || null; }
function firefoxTechnicalAvailable() { return /Firefox\/\d/i.test(navigator.userAgent || "") && typeof firefoxTechnicalPermissions()?.getAll === "function"; }
async function refreshFirefoxTechnicalConsent() {
  const section = $("firefox-technical-consent");
  if (!section) return;
  const permissions = firefoxTechnicalPermissions();
  const available = firefoxTechnicalAvailable();
  section.hidden = !available;
  if (!available) return;
  let granted = false, readable = true;
  try {
    const current = await permissions.getAll();
    granted = Array.isArray(current?.data_collection) && current.data_collection.includes(FIREFOX_TECHNICAL_CATEGORY);
  } catch (_) { readable = false; }
  $("firefox-technical-status").textContent = !readable ? "Не удалось прочитать разрешение. Технические данные не передаются." : granted ? "Разрешено: версии Firefox и расширения могут передаваться для совместимости и диагностики." : "Не разрешено: версии Firefox и расширения не передаются; основная работа доступна.";
  $("firefox-technical-grant").hidden = granted;
  $("firefox-technical-revoke").hidden = !granted;
}
function requestFirefoxTechnicalConsentFromClick() {
  const permissions = firefoxTechnicalPermissions();
  if (!firefoxTechnicalAvailable() || typeof permissions?.request !== "function") return;
  $("firefox-technical-grant").disabled = true;
  let requested;
  try { requested = permissions.request({ data_collection: [FIREFOX_TECHNICAL_CATEGORY] }); }
  catch (_) { requested = Promise.reject(new Error("FIREFOX_TECHNICAL_PERMISSION_REQUEST_FAILED")); }
  Promise.resolve(requested).then(granted => {
    $("status").textContent = granted ? "Технические данные разрешены" : "Разрешение не выдано. Основная работа остаётся доступной";
  }).catch(() => { $("status").textContent = "Не удалось запросить разрешение. Технические данные не передаются"; })
    .finally(() => { $("firefox-technical-grant").disabled = false; refreshFirefoxTechnicalConsent().catch(() => null); });
}
function revokeFirefoxTechnicalConsentFromClick() {
  const permissions = firefoxTechnicalPermissions();
  if (!firefoxTechnicalAvailable() || typeof permissions?.remove !== "function") return;
  $("firefox-technical-revoke").disabled = true;
  let removed;
  try { removed = permissions.remove({ data_collection: [FIREFOX_TECHNICAL_CATEGORY] }); }
  catch (_) { removed = Promise.reject(new Error("FIREFOX_TECHNICAL_PERMISSION_REMOVE_FAILED")); }
  Promise.resolve(removed).then(() => { $("status").textContent = "Технические данные больше не передаются"; })
    .catch(() => { $("status").textContent = "Не удалось изменить разрешение"; })
    .finally(() => { $("firefox-technical-revoke").disabled = false; refreshFirefoxTechnicalConsent().catch(() => null); });
}
const texts = { PAGE_RUNTIME_INSTALL_FAILED: "Браузер не разрешил подключиться к странице. Проверьте разрешение расширения для этого сайта и повторите Start", PAGE_RUNTIME_RECOVERY_UNAVAILABLE: "Эта сборка не поддерживает восстановление связи со страницей", PAGE_TAB_UNAVAILABLE: "Вкладка закрыта или недоступна", PAGE_RUNTIME_NOT_PACKAGED: "В сборке отсутствует обработчик этой страницы", ACCESS_CONFIRMED: "Доступ подтверждён этой проверкой; кабинет и полный набор прав ещё не подтверждены",
  CREDENTIAL_REJECTED: "Ключ отклонён (401). Причина и срок действия не подтверждены", ACCESS_DENIED: "Недостаточно прав (403)",
  CHECK_FAILED: "Не удалось проверить: сеть, ответ площадки или формат запроса", STORE_CHANGE_CONFIRMATION_REQUIRED: "Подтвердите смену магазина",
  WORK_SESSION_ALREADY_ACTIVE: "Этот магазин уже подключён", STORE_NOT_FOUND: "Магазин удалён. Откройте список заново",
  POPUP_CONTEXT_STALE: "Диалог изменился. Откройте расширение в нужной вкладке", WORK_START_UNSUPPORTED_PAGE: "Откройте поддерживаемый ИИ: ChatGPT или Алису",
  WORK_START_ALREADY_PENDING: "Запуск уже выполняется. Повторная инструкция не отправлена", WORK_START_ALREADY_IN_PROGRESS: "Запуск уже выполняется. Дождитесь результата или завершите текущую работу",
  EXECUTION_CONTEXT_CHANGED: "Магазин или рабочая сессия изменились. Нажмите «Начать работу»", RESULT_EXPIRED: "Часовой срок результата истёк", NO_QUOTA_WAIT: "Нет пакета, ожидающего продолжения",
  AUTH_REQUIRED: "Выполните вход через портал", WORK_POLICY_BLOCKED: "Работа недоступна: подписанная политика не разрешила этот профиль ИИ", DEVICE_AUTH_CLOSED: "Попытка входа закрыта. Начните новую попытку", BOOTSTRAP_EXPIRED: "Проверенная сессия истекла. Выполните вход заново",
  UNSUPPORTED_BROWSER: "Текущий браузер или его версия не подтверждены подписанной совместимостью. Доказательства другого браузера не переносятся сюда", BOOTSTRAP_PROFILE_INCOMPATIBLE: "Подписанная конфигурация не разрешает текущую версию расширения или браузера", WORK_UNSUPPORTED_AI: "Откройте поддерживаемый ИИ: ChatGPT или Алису",
  SOURCE_OFFLINE: "Источник передачи сейчас недоступен. Повтор не считается доставкой", TRANSFER_VAULT_UNAVAILABLE: "Безопасное локальное хранилище ключа передачи недоступно. Передача не начата", TRANSFER_VAULT_PERSIST_FAILED: "Не удалось безопасно сохранить локальный ключ передачи. Запрос не считается готовым", TRANSFER_VAULT_CLEAR_FAILED: "Не удалось подтвердить очистку локального ключа передачи. Сброс не считается завершённым",
  TRANSFER_KEY_MISSING: "Локальный ключ этой передачи отсутствует. Создайте новый запрос на получающей установке", TRANSFER_ACCOUNT_MISMATCH: "Передача относится к другому аккаунту или установке и заблокирована", TRANSFER_REQUEST_MISMATCH: "Ответ относится к другой передаче. Подтверждение заблокировано; проверьте аккаунт и установку.",
  TRANSFER_ACK_UNCONFIRMED: "Ключи уже сохранены локально, но сервер не подтвердил завершение передачи. Не импортируйте их повторно. Проверьте эту передачу позже.",
  TRANSFER_EXPIRED: "Срок запроса передачи истёк. Создайте новый запрос", TRANSFER_REPLAY: "Передача уже завершена или повтор заблокирован" };
async function request(type, fields = {}) {
  const response = await chrome.runtime.sendMessage({ type, tab_id: tabId, ...fields });
  if (!response?.ok) throw new Error(texts[response?.code] || `Действие не выполнено: ${response?.code || "нет ответа расширения"}`);
  return response;
}
async function requestStart(fields = {}) {
  const response = await request("SA_WORK_START", fields);
  if (response?.accepted !== true) {
    throw new Error(texts[response?.code] || `Запуск не подтверждён: ${response?.code || "расширение не подтвердило принятие"}`);
  }
  return response;
}
function startStatusText(lastStart) {
  if (!lastStart || lastStart.outcome === "active") return null;
  if (lastStart.outcome === "finished") return "Работа завершена по вашему запросу.";
  if (lastStart.outcome === "cancelled") {
    const reasons = {
      WORK_PENDING_SURFACE_CHANGED: "Изменилась страница диалога.",
      WORK_PENDING_CONVERSATION_CHANGED: "Вы открыли другой диалог.",
      WORK_PENDING_STORE_CHANGED: "Выбран другой магазин.",
      WORK_PENDING_AUTHORITY_CHANGED: "Изменился аккаунт или доступ к работе.",
      WORK_PENDING_CONTENT_CANCELLED: "Страница отменила ожидание ответа.",
      WORK_PENDING_TAB_CLOSED: "Вкладка диалога закрыта.",
    };
    return `Запуск отменён. ${Object.hasOwn(reasons, lastStart.code) ? reasons[lastStart.code] : "Контекст запуска изменился."}`;
  }
  if (lastStart.outcome === "sent_acknowledged") return "Последний запуск: инструкция отправлена. Ожидаем создание и подтверждение диалога ИИ.";
  if (lastStart.outcome === "unknown_no_retry") return "Последний запуск: исход отправки не подтверждён. Автоматический повтор заблокирован.";
  if (lastStart.outcome === "pending") return "Последний запуск ещё ожидает подтверждения диалога ИИ.";
  if (["failed", "blocked"].includes(lastStart.outcome)) {
    const code = typeof lastStart.code === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(lastStart.code) ? lastStart.code : null;
    const reason = code ? (texts[code] || `Код для поддержки: ${code}`) : "Причина не определена. Сохраните снимок диагностики для проверки.";
    return `Последний запуск не завершён. ${reason}`;
  }
  return null;
}
function actionSuccessText(result) {
  if (result?.popupAction !== "WORK_START_ACCEPTED") return "Готово";
  if (state?.context?.work_active === true && ["active_visible", "active_hidden"].includes(state?.work?.state)) return "Работа запущена";
  return startStatusText(state?.lastStart) || "Запуск принят. Ожидаем подтверждение инструкции и ответа ИИ";
}
function transferReceivePresentation(result) {
  if (result?.ok === true && result?.importState === "IMPORTED") return { text: "Передача принята, ключи магазинов импортированы.", consume: Boolean(result.requestId) };
  if (result?.ok === true && result?.importState === "CONFLICT") return { text: "Передача получена, но импорт остановлен из-за конфликта магазина.", consume: false };
  if (result?.ok === false && result?.code === "SOURCE_OFFLINE" && result?.importState === "SOURCE_OFFLINE") return { text: "Источник ещё не доставил передачу.", consume: false };
  if (result?.ok === false && result?.code === "TRANSFER_CREDENTIALS_MISSING") return { text: "В полученной передаче нет ключей. Ничего не импортировано.", consume: false };
  if (result?.ok === false && !result?.code && result?.importState === "PENDING") return { text: "Активной передачи для получения нет.", consume: false };
  return null;
}
async function requestTransferReceivePending() {
  const response = await chrome.runtime.sendMessage({ type: "SA_TRANSFER_RECEIVE_PENDING", tab_id: tabId });
  const presentation = transferReceivePresentation(response);
  if (!presentation) {
    // An unverified ACK failure does not prove terminal expiry or replay.
    // Do not tell the owner to re-import an already durable local result.
    const unconfirmedAck = response?.ok === false && response?.ackConfirmed === false
      && ["IMPORTED_PENDING_ACK", "PENDING"].includes(response?.importState)
      && ["TRANSFER_ACK_UNCONFIRMED", "TRANSFER_EXPIRED", "TRANSFER_REPLAY"].includes(response?.code);
    if (unconfirmedAck) throw new Error(texts.TRANSFER_ACK_UNCONFIRMED);
    throw new Error(texts[response?.code] || `Действие не выполнено: ${response?.code || "нет ответа расширения"}`);
  }
  return { response, presentation };
}
async function action(fn, { interrupt = false, accountOnly = false } = {}) {
  if (busy && !interrupt) {
    $("status").textContent = "Дождитесь завершения текущего действия.";
    return { popupAction: "BUSY_REJECTED" };
  }
  const generation = ++actionGeneration;
  refreshGeneration += 1;
  busy = true;
  if (!accountOnly && typeof render === "function") render();
  $("status").textContent = "Выполняем…";
  try {
    const result = await fn();
    if (generation !== actionGeneration) return;
    if (!accountOnly) await refresh();
    if (generation === actionGeneration) $("status").textContent = actionSuccessText(result);
  } catch (e) {
    if (generation === actionGeneration) $("status").textContent = e.message;
  } finally {
    if (generation === actionGeneration) {
      busy = false;
      if (!accountOnly && typeof render === "function") render();
      if (!accountOnly && refreshRequested) scheduleRefresh();
    }
  }
}
function selected() { return state?.stores.find(x => x.id === selectedId); }
function onboardingModel(value) {
  const authenticated = value?.auth?.authenticated === true;
  const hasStore = authenticated && Array.isArray(value?.stores) && value.stores.length > 0;
  const aiReady = Boolean(value?.page?.supported ?? value?.identity?.ai_id);
  const workReady = Boolean(value?.context?.work_active === true && ["active_visible", "active_hidden", "recovering"].includes(value?.work?.state));
  return [
    { id: "onboarding-auth", done: authenticated, text: authenticated ? "1. Вход через портал подтверждён." : "1. Войдите через портал и подтвердите эту установку." },
    { id: "onboarding-store", done: hasStore, text: hasStore ? "2. Магазин добавлен." : "2. Добавьте магазин Ozon или WB и сохраните его ключи локально." },
    { id: "onboarding-ai", done: aiReady, text: aiReady ? "3. Поддерживаемый ИИ открыт." : "3. Откройте поддерживаемый ИИ в текущей вкладке." },
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
  const supportedPage = Boolean(state.page?.supported ?? state.identity.ai_id);
  $("connection").textContent = supportedPage ? connected ? `${labels[state.work?.state] || "Диалог подключён"}: ${connected.name} · ${connected.marketplace === "ozon" ? "Ozon" : "WB"}` : "Диалог не подключён" : "Откройте поддерживаемый ИИ в текущей вкладке";
  $("selection").textContent = connected && selectedId !== connected.id ? "Выбран следующий магазин. Текущее подключение изменится только после подтверждения и нового Start." : "";
  if (supportedPage && state.page?.runtimeStatus === "unavailable" && !connected) {
    $("connection").textContent = state.page.transportClass === "NO_RECEIVER"
      ? "Страница ещё не подключена к расширению. Нажмите «Начать работу» — подключение будет восстановлено."
      : "Не удалось прочитать текущий диалог. Нажмите «Начать работу» для повторной проверки.";
  }
  const lastStartText = !connected ? startStatusText(state.lastStart) : null;
  if (lastStartText) $("connection").textContent = lastStartText;
  if (state.pending) $("connection").textContent = ["committed_before_click", "outcome_unknown_no_retry"].includes(state.pending.send_outcome) && state.lastStart?.outcome === "unknown_no_retry" ? "Не удалось подтвердить отправку инструкции. Она не будет вставлена или отправлена повторно автоматически" : "Запускаем: ожидаем подтверждение инструкции и ответа ИИ";
  const uncertainDialogue = Boolean(state.identity.ai_id && state.identity.status !== "confirmed");
  const localDialogue = state.identity.identity_scope === "document";
  $("conversation-note").hidden = !uncertainDialogue && !localDialogue;
  $("conversation-note").textContent = uncertainDialogue
    ? state.identity.source === "history_continuity_unverified"
      ? "Содержимое диалога изменилось. Новые действия приостановлены. Дождитесь загрузки прежней переписки или нажмите Start для текущего диалога."
      : "Дождитесь загрузки переписки. Start подключит текущий диалог после подтверждённой отправки инструкции и ответа ИИ."
    : localDialogue ? "Привязка действует в этом браузере. После перезагрузки она восстанавливается только при совпадении сохранённых признаков переписки." : "";
  $("start").disabled = busy || Boolean(state.pending) || !s || !supportedPage || ["binding", "recovering", "finishing"].includes(state.work?.state);
  $("work-resume").hidden = !(state.context.store_id && state.work?.state === "inactive" && state.context.work_active !== true);
  $("work-resume").disabled = busy || Boolean(state.pending) || !state.conversation_key;
  $("visibility").disabled = busy || !active; $("finish").disabled = !active && state.work?.state !== "error" && !state.pending;
  $("visibility").textContent = state.context.button_visible ? "Скрыть кнопку" : "Показать кнопку";
  $("resume").hidden = !state.operation?.quota_wait;
}
function scheduleRefresh() {
  refreshRequested = true;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    // A notification received while an action is busy remains pending. Its
    // finally block drains it after the older state response is consumed.
    if (!refreshRequested || busy || !tabId || durableImportMode) return;
    refresh().catch(e => { $("status").textContent = e.message; });
  }, 100);
}
async function refresh(first = false) {
  refreshRequested = false;
  clearTimeout(refreshTimer);
  const generation = ++refreshGeneration;
  const next = await request("SA_POPUP_STATE");
  if (generation !== refreshGeneration) return;
  state = next;
  if (first && state.context.store_id) { const current = state.stores.find(s => s.id === state.context.store_id); if (current) { selectedId = current.id; marketplace = current.marketplace; } }
  render();
  await refreshFirefoxTechnicalConsent();
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
$("start").onclick = () => { const id = selectedId; const run = async confirm_change => { await requestStart({ store_id: id, confirm_change, start_intent_id: crypto.randomUUID() }); return { popupAction: "WORK_START_ACCEPTED" }; };
  if (state.context.store_id && state.context.store_id !== id) confirm("В диалоге останутся данные предыдущего магазина. ИИ может смешать их в ответах. Старую работу завершим и отправим новую инструкцию для выбранного магазина.", () => run(true)); else action(() => run(false)); };
$("confirm").onclick = () => { const fn = confirmAction; confirmAction = null; $("confirmation").hidden = true; if (fn) action(fn); };
$("reject").onclick = () => { confirmAction = null; $("confirmation").hidden = true; };
$("work-resume").onclick = () => action(() => request("SA_WORK_RESUME", { conversation_key: state.conversation_key }));
$("visibility").onclick = () => action(() => request(state.context.button_visible ? "OZ_WORK_HIDE" : "OZ_WORK_SHOW", { conversation_key: state.conversation_key }));
$("finish").onclick = () => {
  const fields = { conversation_key: state.conversation_key, surface_id: state.identity?.surface_id || null };
  return action(() => request("OZ_WORK_FINISH", fields), { interrupt: true });
};
$("resume").onclick = () => action(() => request("SA_RESUME_QUOTA"));
$("transfer-create").onclick = () => action(async () => {
  if (!$("transfer-consent").checked) throw new Error("Сначала подтвердите явное согласие на передачу через транспорт Seller Agents");
  const result = await request("SA_TRANSFER_CREATE", { consent: true, selectedStoreIds: selectedId ? [selectedId] : [] });
  $("transfer-status").textContent = `Запрос создан до ${new Date(result.request.expiresAt).toLocaleTimeString()}. Источник должен быть активен.`;
});
$("transfer-discover").onclick = () => action(async () => {
  const result = await request("SA_TRANSFER_SOURCE_DISCOVER");
  $("transfer-status").textContent = result.requests.length ? `Найдено запросов: ${result.requests.length}. Передача выполняется только после явного действия источника.` : "Активных запросов нет. Если источник спит, он не будет обещанно найден немедленно.";
});
$("transfer-receive").onclick = () => action(async () => {
  const { response: result, presentation } = await requestTransferReceivePending();
  $("transfer-status").textContent = presentation.text;
  if (presentation.consume) void request("SA_TRANSFER_RESULT_CONSUME", { requestId: result.requestId }).catch(() => null);
});
$("support-generate").onclick = () => action(async () => {
  const result = await request("SA_SUPPORT_SNAPSHOT");
  $("support-snapshot").value = JSON.stringify(result.snapshot, null, 2);
  $("support-snapshot").hidden = false;
});
$("firefox-technical-grant").onclick = requestFirefoxTechnicalConsentFromClick;
$("firefox-technical-revoke").onclick = revokeFirefoxTechnicalConsentFromClick;
$("auth-start").onclick = () => action(() => request("SA_AUTH_START"));
$("auth-open").onclick = () => action(() => request("SA_AUTH_OPEN_PORTAL"));
$("auth-cancel").onclick = () => action(() => request("SA_AUTH_CANCEL"));
$("auth-reset").onclick = () => confirm("Локально завершить текущую сессию и выбрать аккаунт заново? Сохранённые магазины останутся изолированными по аккаунту.", () => request("SA_AUTH_RESET"));
for (const part of ["seller", "performance", "token"]) $("check-" + part).onclick = () => action(() => request("SA_STORE_CHECK", { store_id: selectedId, part }));
async function openKeyFiles(mode) {
  if (mode === "upload" && !durableImportMode) {
    try {
      await chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") + BACKUP_IMPORT_FRAGMENT });
    } catch (_) {
      $("status").textContent = "Не удалось открыть загрузку ключей. Повторите открытие страницы импорта.";
    }
    return;
  }
  $("backup").scrollIntoView({ block: "start", behavior: "smooth" });
  $(mode === "upload" ? "backup-file" : "backup-password").focus();
}
$("keys-download").onclick = () => openKeyFiles("download");
$("keys-upload").onclick = () => openKeyFiles("upload");
$("backup-file").onclick = event => {
  if (!durableImportMode) { event.preventDefault(); return openKeyFiles("upload"); }
};
$("backup-file").onchange = () => {
  backupText = "";
  $("backup-preview-result").hidden = true;
  $("backup-status").textContent = $("backup-file").files?.length ? "Файл выбран. Введите пароль и нажмите «Проверить файл»." : "";
};
function downloadBackup(name, value) {
  const url = URL.createObjectURL(new Blob([value], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
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
  $("backup-status").textContent = `Экспортировано магазинов: ${response.storeCount}. Пропущено без локальных ключей: ${response.skippedStoreCount || 0}. Скачивание запрошено: ${response.fileName}. Проверьте завершение в загрузках браузера.`;
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
}, { accountOnly: durableImportMode });
$("backup-import").onclick = () => action(async () => {
  if (!backupText) throw new Error("Сначала проверьте файл");
  const response = await request("SA_BACKUP_IMPORT", { backup: backupText, password: $("backup-import-password").value, apply: true });
  $("backup-status").textContent = `Импорт завершён: добавлено ${response.imported.length}; конфликты не перезаписаны.`;
  $("backup-preview-result").hidden = true; $("backup-file").value = ""; $("backup-import-password").value = ""; backupText = "";
}, { accountOnly: durableImportMode });
if (durableImportMode) {
  const backup = $("backup"), status = $("status");
  document.querySelector("main").replaceChildren(backup, status);
  backup.querySelector("h2").textContent = "Загрузить ключи из файла";
  for (const id of ["backup-password", "backup-password-confirm"]) $(id).closest("label").hidden = true;
  $("backup-export").hidden = true;
  backup.querySelector("hr").hidden = true;
  $("backup-file").focus();
} else {
const firefoxPermissionEvents = firefoxTechnicalPermissions();
firefoxPermissionEvents?.onAdded?.addListener(() => refreshFirefoxTechnicalConsent().catch(() => null));
firefoxPermissionEvents?.onRemoved?.addListener(() => refreshFirefoxTechnicalConsent().catch(() => null));
chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => { tabId = tabs[0]?.id; return refresh(true); }).catch(e => { $("status").textContent = e.message; });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !Object.keys(changes).some(key => ["seller_agents_control_auth_v2", "seller_agents_stores_v1", "ozmb_work_sessions_v1", "ozmb_pending_work_starts_v1", "ozmb_conversation_bindings", "ozmb_manual_operations"].includes(key))) return;
  scheduleRefresh();
});

}
