function renderCharge(charge) {
  const row = document.createElement('li');
  row.textContent = (charge.pending ? 'На сверке' : 'Списано') + ' · ' + charge.coins + ' · ' + (charge.chatId ? 'Чат · ' + charge.chatId.slice(-8) : (charge.operationId ?? charge.requestId));
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

async function request(path, options) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options });
  if (response.status === 401) location.assign('/login');
  if (!response.ok) throw new Error(({403:'Требуются права администратора',404:'Аккаунт не найден',400:'Проверьте введённые данные',409:'Начисление конфликтует с предыдущей операцией'})[response.status] ?? 'Не удалось выполнить операцию');
  return response.json();
}
let pending;
for (const form of document.forms) form.addEventListener('submit', async event => {
  event.preventDefault();
  const fields = Object.fromEntries(new FormData(form));
  const button = form.querySelector('button');
  const problem = document.querySelector('#problem');
  if (button.disabled) return;
  button.disabled = true;
  problem.textContent = '';
  try {
    if (form.id === 'grant') {
      const signature = JSON.stringify(fields);
      if (pending?.signature !== signature) pending = { signature, id: crypto.randomUUID() };
      await request('/api/admin/coin-grants', {method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...fields, requestId:pending.id})});
      pending = null;
      form.reset();
      form.querySelector('output').textContent = 'Монеты начислены';
    } else {
      document.querySelector('#account').replaceChildren();
      document.querySelector('#charges').replaceChildren();
      const account = await request('/api/admin/accounts/' + encodeURIComponent(fields.login.trim()) + '/wallet');
      document.querySelector('#account').textContent = fields.login + ' · Доступно ' + account.available + ' · В резерве ' + account.reserved;
      document.querySelector('#charges').replaceChildren(...account.charges.map(renderCharge));
    }
  } catch (error) { problem.textContent = error.message; }
  finally { button.disabled = false; }
});
