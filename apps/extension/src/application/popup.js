"use strict";
const $ = id => document.getElementById(id);
let tabId, state, marketplace = "ozon", selectedId = "", editingId = null, busy = false, confirmAction = null;
const texts = { ACCESS_CONFIRMED: "Доступ подтверждён этой проверкой; кабинет и полный набор прав ещё не подтверждены",
  CREDENTIAL_REJECTED: "Ключ отклонён (401). Причина и срок действия не подтверждены", ACCESS_DENIED: "Недостаточно прав (403)",
  CHECK_FAILED: "Не удалось проверить: сеть, ответ площадки или формат запроса", STORE_CHANGE_CONFIRMATION_REQUIRED: "Подтвердите смену магазина",
  WORK_SESSION_ALREADY_ACTIVE: "Этот магазин уже подключён", STORE_NOT_FOUND: "Магазин удалён. Откройте список заново",
  POPUP_CONTEXT_STALE: "Диалог изменился. Откройте расширение в нужной вкладке", WORK_START_UNSUPPORTED_PAGE: "Откройте поддерживаемый ИИ: ChatGPT или Алису",
  EXECUTION_CONTEXT_CHANGED: "Магазин или рабочая сессия изменились. Нажмите «Начать работу»", RESULT_EXPIRED: "Часовой срок результата истёк", NO_QUOTA_WAIT: "Нет пакета, ожидающего продолжения",
  AUTH_REQUIRED: "Выполните вход через портал", WORK_POLICY_BLOCKED: "Работа недоступна: подписанная политика не разрешила этот профиль ИИ", DEVICE_AUTH_CLOSED: "Попытка входа закрыта. Начните новую попытку", BOOTSTRAP_EXPIRED: "Проверенная сессия истекла. Выполните вход заново" };
async function request(type, fields = {}) {
  const response = await chrome.runtime.sendMessage({ type, tab_id: tabId, ...fields });
  if (!response?.ok) throw new Error(texts[response?.code] || `Действие не выполнено: ${response?.code || "нет ответа расширения"}`);
  return response;
}
async function action(fn) { if (busy) return; busy = true; $("status").textContent = "Выполняем…"; try { await fn(); await refresh(); $("status").textContent = "Готово"; } catch (e) { $("status").textContent = e.message; } finally { busy = false; } }
function selected() { return state?.stores.find(x => x.id === selectedId); }
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
$("work-resume").onclick = () => action(() => request("OZ_WORK_RESUME", { conversation_key: state.conversation_key }));
$("visibility").onclick = () => action(() => request(state.context.button_visible ? "OZ_WORK_HIDE" : "OZ_WORK_SHOW", { conversation_key: state.conversation_key }));
$("finish").onclick = () => action(() => request("OZ_WORK_FINISH", { conversation_key: state.conversation_key }));
$("resume").onclick = () => action(() => request("SA_RESUME_QUOTA"));
$("auth-start").onclick = () => action(() => request("SA_AUTH_START"));
$("auth-open").onclick = () => action(() => request("SA_AUTH_OPEN_PORTAL"));
$("auth-cancel").onclick = () => action(() => request("SA_AUTH_CANCEL"));
$("auth-reset").onclick = () => confirm("Локально завершить текущую сессию и выбрать аккаунт заново? Сохранённые магазины останутся изолированными по аккаунту.", () => request("SA_AUTH_RESET"));
for (const part of ["seller", "performance", "token"]) $("check-" + part).onclick = () => action(() => request("SA_STORE_CHECK", { store_id: selectedId, part }));
chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => { tabId = tabs[0]?.id; return refresh(true); }).catch(e => { $("status").textContent = e.message; });

let refreshTimer;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !Object.keys(changes).some(key => ["seller_agents_control_auth_v2", "seller_agents_stores_v1", "ozmb_work_sessions_v1", "ozmb_pending_work_starts_v1", "ozmb_conversation_bindings", "ozmb_manual_operations"].includes(key))) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { if (!busy && tabId) refresh().catch(e => { $("status").textContent = e.message; }); }, 100);
});
