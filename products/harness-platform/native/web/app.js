const byId = id => document.getElementById(id);
const chatId = /^\/app\/chats\/([A-Za-z0-9_-]+)\/?$/.exec(location.pathname)?.[1];
const chatPath = `/api/chats/${encodeURIComponent(chatId ?? '')}`;
let view = 'chat';
let journal = { messages: [], events: [], nextBefore: null };
let loaded = false;
let pendingTurn = null;

class HttpError extends Error {
  constructor(status) { super(`HTTP ${status}`); this.status = status; }
}

async function api(path, options) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options });
  if (response.status === 401) location.replace('/login');
  if (!response.ok) throw new HttpError(response.status);
  return response.json();
}

function showError(error, operation) {
  const descriptions = {
    400: 'Проверьте введённые данные', 401: 'Требуется вход', 403: 'Доступ запрещён',
    402: 'Недостаточно доступных монет для запроса',
    404: operation === 'open' ? 'Чат недоступен' : 'Действие недоступно',
    409: 'Конфликт с сохранённым запросом', 413: 'Слишком длинное сообщение',
    502: 'Сервис не смог вернуть результат', 503: 'Сервис временно недоступен',
  };
  const problem = byId('problem');
  problem.textContent = error instanceof HttpError
    ? descriptions[error.status] ?? `Ошибка сервиса (${error.status})`
    : 'Не удалось загрузить данные. Обновите страницу или повторите действие.';
  problem.hidden = false;
}

function chatName(id) { return `Чат · ${id.slice(-8)}`; }

function displayChatList(ids) {
  const list = byId('chat-list');
  const rows = ids.map(id => {
    const row = document.createElement('li');
    const link = document.createElement('a');
    link.href = `/app/chats/${encodeURIComponent(id)}`;
    link.textContent = chatName(id);
    if (id === chatId) link.setAttribute('aria-current', 'page');
    row.append(link);
    return row;
  });
  list.replaceChildren(...rows);
}

function displayTools(names) {
  const tools = byId('tools');
  if (!names.length) { tools.textContent = 'Нет доступных инструментов'; return; }
  const list = document.createElement('ul');
  for (const name of names) {
    const row = document.createElement('li');
    row.textContent = name;
    list.append(row);
  }
  tools.replaceChildren(list);
}

async function drawTranscript() {
  const { renderTranscript } = await import('./widgets.js');
  await renderTranscript(byId('history'), { ...journal, view, chatId });
}

function eventPage(before = null) {
  const query = before === null ? '' : `?before=${encodeURIComponent(before)}`;
  return api(`${chatPath}/events${query}`);
}

function joinWindows(earlier, later) {
  return { adminCosts: later.adminCosts, events: [...earlier.events, ...later.events], messages: [...earlier.messages, ...later.messages],
    nextBefore: earlier.nextBefore };
}

async function showWindow(next) {
  journal = next;
  byId('older').hidden = next.nextBefore === null;
  await drawTranscript();
}

async function updateJournal() {
  let page = await eventPage();
  if (Boolean(page.adminCosts) !== Boolean(journal.adminCosts)) return showWindow(page);
  const tail = journal.messages.at(-1);
  if (tail) {
    // Another device may have advanced the same journal by more than one page.
    // Read back to the saved tail before appending new turns to the local window.
    const sameTail = message => message.requestId === tail.requestId && message.role === tail.role;
    while (page.nextBefore !== null && !page.messages.some(sameTail)) {
      const older = await eventPage(page.nextBefore);
      if (Boolean(older.adminCosts) !== Boolean(page.adminCosts)) return showWindow(await eventPage());
      page = joinWindows(older, page);
    }
    const index = page.messages.findIndex(sameTail);
    if (index !== -1) {
      const lastSeq = journal.events.at(-1)?.seq ?? -1;
      page = joinWindows(journal, { adminCosts: page.adminCosts, messages: page.messages.slice(index + 1),
        events: page.events.filter(event => event.seq > lastSeq) });
    }
  }
  await showWindow(page);
}

byId('older').addEventListener('click', async () => {
  const older = byId('older');
  const send = byId('send');
  if (older.disabled || !loaded || journal.nextBefore === null) return;
  older.disabled = send.disabled = true;
  try {
    const page = await eventPage(journal.nextBefore);
    if (Boolean(page.adminCosts) !== Boolean(journal.adminCosts)) await updateJournal();
    else await showWindow(joinWindows(page, journal));
  } catch (error) { showError(error, 'history'); }
  finally { older.disabled = send.disabled = false; }
});

async function selectView(next) {
  view = next;
  for (const name of ['chat', 'trajectory']) {
    const tab = byId(`${name}-tab`);
    tab.setAttribute('aria-selected', String(name === next));
    tab.tabIndex = name === next ? 0 : -1;
  }
  byId('history').setAttribute('aria-label', next === 'chat' ? 'История сообщений' : 'Траектория');
  if (loaded) {
    try { await drawTranscript(); }
    catch (error) { showError(error, 'view'); }
  }
}

for (const name of ['chat', 'trajectory']) {
  const tab = byId(`${name}-tab`);
  tab.addEventListener('click', () => selectView(name));
  tab.addEventListener('keydown', event => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'chat' : event.key === 'End' ? 'trajectory' :
      name === 'chat' ? 'trajectory' : 'chat';
    byId(`${next}-tab`).focus();
    selectView(next);
  });
}

byId('new-chat').addEventListener('click', async () => {
  const button = byId('new-chat');
  button.disabled = true;
  try {
    const chat = await api('/api/chats', { method: 'POST' });
    location.assign(`/app/chats/${encodeURIComponent(chat.chatId)}`);
  } catch (error) { showError(error, 'create'); button.disabled = false; }
});

byId('composer').addEventListener('submit', async event => {
  event.preventDefault();
  const button = byId('send');
  if (!loaded || button.disabled) return;
  const input = byId('message');
  const text = input.value;
  if (!text.trim()) { input.focus(); return; }
  if (new TextEncoder().encode(text).length > 8192) {
    showError(new HttpError(413), 'turn');
    return;
  }
  // Keep the identifier after a lost acknowledgement so a retry recovers the same turn.
  const maxCoins = byId('max-coins').value.trim().replace(',', '.');
  if (!pendingTurn || pendingTurn.text !== text || pendingTurn.maxCoins !== maxCoins)
    pendingTurn = { requestId: crypto.randomUUID(), text, maxCoins };
  byId('problem').hidden = true;
  byId('status').textContent = 'Отправка…';
  button.disabled = byId('older').disabled = true;
  input.readOnly = true;
  try {
    await api(`${chatPath}/turns`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pendingTurn) });
    input.value = '';
    pendingTurn = null;
    await updateJournal();
  } catch (error) { showError(error, 'turn'); }
  finally {
    button.disabled = byId('older').disabled = false;
    refreshWallet().catch(error => showError(error, 'wallet'));
    input.readOnly = false;
    byId('status').textContent = '';
  }
});

function renderCharge(charge) {
  const row = document.createElement('li');
  row.textContent = (charge.pending ? 'На сверке' : 'Списано') + ' · ' + charge.coins + ' · ' + (charge.chatId ? chatName(charge.chatId) : (charge.operationId ?? charge.requestId));
  if (charge.meter) {
    const detail = document.createElement('details'), summary = document.createElement('summary');
    summary.textContent = 'Расход DeepSeek · наценка ' + charge.meter.markupPercent + '%';
    detail.append(summary);
    if (charge.meter.providerUsd !== null) detail.append('Себестоимость · $' + charge.meter.providerUsd);
    for (const attempt of charge.meter.attempts) {
      const part = document.createElement('p'), u = attempt.usage;
      part.textContent = attempt.model + ' · ' + (u
        ? 'Вход ' + u.input_tokens + ' · Из кэша ' + u.cache_read_input_tokens + ' · Выход ' + u.output_tokens
        : 'Ожидается сверка расхода');
      detail.append(part);
    }
    row.append(detail);
  }
  return row;
}

let grantKey;
async function refreshWallet() {
  const wallet = await api('/api/wallet');
  byId('wallet').hidden = false;
  if (!byId('max-coins').value) byId('max-coins').value = wallet.turnLimit;
  byId('balance').textContent = 'Монеты · ' + wallet.available;
  byId('reserved').textContent = 'В резерве: ' + wallet.reserved + ' · Предел на запрос: ' + wallet.turnLimit;
  byId('charges').replaceChildren(...wallet.charges.map(renderCharge));
  const panel = byId('credit-panel');
  if (!wallet.canGrant) { panel.replaceChildren(); return; }
  if (panel.firstChild) return;
  const form = document.createElement('form');
  for (const [name, title] of [['login','Логин получателя'],['amount','Монеты'],['reason','Основание']]) {
    const label = document.createElement('label'), input = document.createElement('input');
    label.textContent = title;
    input.name = name;
    input.required = true;
    label.append(input);
    form.append(label);
  }
  const submit = document.createElement('button'), notice = document.createElement('output');
  submit.textContent = 'Начислить монеты';
  form.append(submit, notice);
  const inspectForm = document.createElement('form'), accountLabel = document.createElement('label');
  const accountInput = document.createElement('input'), inspect = document.createElement('button');
  const balance = document.createElement('output'), charges = document.createElement('ul');
  accountLabel.textContent = 'Логин для просмотра расходов';
  accountInput.required = true;
  accountLabel.append(accountInput);
  inspect.textContent = 'Показать расходы';
  inspectForm.append(accountLabel, inspect);
  inspectForm.addEventListener('submit', async event => {
    event.preventDefault();
    inspect.disabled = true;
    balance.replaceChildren();
    charges.replaceChildren();
    try {
      const login = accountInput.value.trim();
      const account = await api('/api/admin/accounts/' + encodeURIComponent(login) + '/wallet');
      balance.textContent = login + ' · Доступно ' + account.available + ' · В резерве ' + account.reserved;
      charges.replaceChildren(...account.charges.map(renderCharge));
    } catch (error) { showError(error, 'wallet'); }
    finally { inspect.disabled = false; }
  });
  panel.append(form, inspectForm, balance, charges);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(form)), signature = JSON.stringify(fields);
    if (grantKey?.signature !== signature) grantKey = { signature, id: crypto.randomUUID() };
    submit.disabled = true;
    try {
      await api('/api/admin/coin-grants', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...fields, requestId: grantKey.id }) });
      notice.textContent = 'Монеты начислены';
      form.reset();
      grantKey = null;
      await refreshWallet();
    } catch (error) { showError(error, 'wallet'); }
    finally { submit.disabled = false; }
  });
}

async function openPage() {
  await refreshWallet();
  const chats = await api('/api/chats');
  displayChatList(chats);
  if (!chatId) { byId('welcome').hidden = false; return; }
  if (!chats.includes(chatId)) throw new HttpError(404);
  byId('chat-name').textContent = chatName(chatId);
  byId('conversation').hidden = false;
  const toolsRequest = api(`${chatPath}/tools`).then(displayTools).catch(error => {
    byId('tools').textContent = 'Не удалось загрузить инструменты';
    showError(error, 'tools');
  });
  await updateJournal();
  loaded = true;
  byId('send').disabled = false;
  await toolsRequest;
}
openPage().catch(error => showError(error, 'open'));
