function renderCharge(charge) {
  const row = document.createElement('li');
  row.textContent = (charge.pending ? 'На сверке' : 'Списано') + ' · ' + charge.coins + ' · ' + (charge.chatId ? 'Чат · ' + charge.chatId.slice(-8) : (charge.operationId ?? charge.requestId));
  if (charge.meter) {
    const detail = document.createElement('details'), summary = document.createElement('summary');
    summary.textContent = 'Расход модели · '+(charge.meter.rubPerUsd ? charge.meter.rubPerUsd+' ₽/USD' : 'прежний тариф');
    detail.append(summary);
    if (charge.meter.providerUsd !== null) detail.append('Себестоимость · $' + charge.meter.providerUsd);
    for (const attempt of charge.meter.attempts) {
      const part = document.createElement('p'), u = attempt.usage;
      part.textContent = (attempt.tariff==='openrouter-v1'?'OpenRouter':'DeepSeek')+' · '+attempt.model + ' · ' + (u
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
const pricingForm = document.querySelector('#pricing');
const markup = pricingForm.elements.markupPercent;
function preview() {
  const value = markup.valueAsNumber;
  document.querySelector('#sale-price').textContent = markup.validity.valid && Number.isFinite(value)
    ? '1 монета стоит '+(1 + value/100).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:4})+' ₽. При расходе 1 монета = 1 ₽.' : '';
}
markup.addEventListener('input',preview);
markup.disabled = true;
request('/api/admin/coin-pricing').then(value=>{
  markup.value=value.markupPercent;markup.disabled=false;preview();
}).catch(error=>{document.querySelector('#problem').textContent=error.message;});
function keyStates(state) {
  for(const id of ['deepseek','openrouter']){
    const output=document.getElementById(id).querySelector('output');
    output.textContent=state[id].configured?'Ключ настроен':'Ключ ещё не добавлен';
  }
}
request('/api/admin/provider-keys').then(keyStates).catch(e=>{document.querySelector('#problem').textContent=e.message;});
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
    if (['openrouter','deepseek'].includes(form.id)) {
      keyStates(await request('/api/admin/provider-keys/'+form.id,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({key:fields.key})}));
      form.reset();
      form.querySelector('output').textContent='Новый ключ сохранён';
    } else if (form.id === 'pricing') {
      if(markup.disabled)return;
      const value=await request('/api/admin/coin-pricing',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({markupPercent:fields.markupPercent})});
      markup.value=value.markupPercent;preview();
      form.querySelector('output').textContent='Цена сохранена';
    } else if (form.id === 'grant') {
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
      document.querySelector('#meters').replaceChildren();
      const account = await request('/api/admin/accounts/' + encodeURIComponent(fields.login.trim()) + '/wallet');
      document.querySelector('#account').textContent = fields.login + ' · Доступно ' + account.available + ' · В резерве ' + account.reserved;
      for(const provider of ['DeepSeek','OpenRouter']) {
        const t=account.providerMeters?.[provider]||{input:0,cache:0,output:0,coins:'0'};
        const line=document.createElement('p');
        line.textContent=provider+' · вход '+t.input+' · кэш '+t.cache+' · выход '+t.output+' · всего '+(t.input+t.cache+t.output)+' токенов · списано '+t.coins+' монет';
        document.querySelector('#meters').append(line);
      }
      document.querySelector('#charges').replaceChildren(...account.charges.map(renderCharge));
    }
  } catch (error) { problem.textContent = error.message; }
  finally { button.disabled = false; }
});
