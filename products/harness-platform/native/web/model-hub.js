const byId = id => document.getElementById(id);
const form = byId('save');
const accountForm = byId('cloudflare-account');
const stamp = value => new Date(value * 1000).toLocaleString('ru-RU');
const statuses = { research: 'Проверить прямого поставщика', key_saved: 'Ключ сохранён, требуется прямая проверка', needs_key: 'Требуется ключ' };
function list(id, items, empty) {
  byId(id).replaceChildren(...(items.length ? items : [empty]).map(text => {
    const item = document.createElement('li');
    item.textContent = text;
    return item;
  }));
}
function monitor(title, state) {
  if (!state) return title + ' — ожидается первая проверка';
  const success = state.succeeded ? stamp(state.succeeded) : 'пока отсутствует';
  return title + ' · последняя попытка ' + stamp(state.attempted) + ' · успешная ' + success + (state.error ? ' · ' + state.error : '');
}
function render(data) {
  byId('catalog').textContent = monitor('Каталог OpenRouter', data.catalog);
  byId('monitor').textContent = monitor('Проверка Codex', data.monitor);
  const providers = data.providers;
  const select = form.elements.provider;
  const prior = select.value;
  select.replaceChildren(...Object.entries(providers).map(([key, name]) => new Option(name,key)));
  if (prior in providers) select.value = prior;
  list('missing', Object.entries(data.missing).map(([id, models]) => providers[id] + ' · ' + models.join(', ')),
    data.catalog?.succeeded ? 'Нет запросов на известные ключи' : 'Ожидается каталог');
  list('keys', data.keys.map(k => providers[k.provider] + ' · ' + k.label +
    (k.provider === 'cloudflare' ? (k.account_configured ? ' · Account ID сохранён' : ' · Требуется Account ID') : '')),
    'Ключи ещё не добавлены');
  for (const [i,k] of data.keys.entries()) {
    const item=byId('keys').children[i];
    const change=(action,title,confirmText)=>{
      const button=document.createElement('button');
      button.type='button';button.textContent=title;
      button.onclick=async()=>{
        if(confirmText && !window.confirm(confirmText))return;
        button.disabled=true;
        try{await load('/api/admin/model-hub/keys/'+encodeURIComponent(k.id)+'/control',{
          method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});}
        catch(e){byId('problem').textContent=e.message;button.disabled=false;}
      };
      item.append(' ',button);
    };
    change(k.enabled?'disable':'enable',k.enabled?'Отключить':'Включить');
    change('revoke','Удалить ключ','Удалить этот ключ из хаба Octoport?');
    if(k.provider==='google'){
      if(k.private_until>Date.now()/1000)change('google-public','Отозвать допуск данных магазина');
      else change('google-private','Подтвердить условия проекта Google',
        'Подтвердите, что для этого ключа действуют условия Google Paid Services по обработке данных: у проекта активен Cloud Billing либо к владельцу применимы условия ЕЭЗ, Швейцарии или Великобритании. Допуск действует 30 дней. Бесплатность самой модели проверяется отдельно перед запросом.');
    }
  }
  const colors={green:'Зелёный',yellow:'Жёлтый',red:'Красный',pending:'Проверяется'};
  list('direct',(data.routes||[]).map(r=>{
    const windows=Object.entries(r.windows).map(([window,w])=>window+' · вызовы '+w.calls+' · проверки '+w.probes+
      ' · p95 '+(w.p95===null?'—':w.p95+' мс')+' · простой '+w.down+' с · восстановлений '+w.recoveries+
      ' · отказы '+(Object.entries(w.errors).map(([e,n])=>e+' × '+n).join(', ')||'0')).join(' | ');
    return r.label+' · '+r.model+' · матрица: '+colors[r.color]+' · '+r.reason+' · текст: '+(r.public_ready?'доступен':r.text_reason)+' · '+(r.scope==='public'?'только публичные вопросы':'чат и матрица')+
      ' · качество '+r.power+' (тест v1) · занято '+r.in_use+'/'+r.capacity+' · проверено '+(r.checked?stamp(r.checked):'—')+
      (r.retry>Date.now()/1000?' · повтор после '+stamp(r.retry):'')+' · '+windows;
  }),'Ожидается прямая проверка');
  list('switches',(data.switches||[]).map(s=>stamp(s.t)+' · '+(s.previous||'Первый маршрут')+' → '+s.current+' · '+s.stage+' · '+s.reason),'Переключений пока нет');
  const accountKeys = data.keys.filter(k => k.provider === 'cloudflare');
  const keySelect = accountForm.elements.key_id;
  const previousKey = keySelect.value;
  accountForm.parentElement.hidden = !accountKeys.length;
  keySelect.replaceChildren(...accountKeys.map(k => new Option(k.label, k.id)));
  if (accountKeys.some(k => k.id === previousKey)) keySelect.value = previousKey;
  list('models', data.models.map(m => m.model + ' · ' + statuses[m.status] + (m.research ? ' · ' + m.research.finding + ' · ' + m.research.source : '')), 'Кандидатов пока нет');
}
async function load(path = '/api/admin/model-hub', options = {}) {
  const response = await fetch(path, {credentials:'same-origin', cache:'no-store', ...options});
  if (!response.ok) throw new Error(({401:'Требуется вход',403:'Требуется доступ администратора',400:'Проверьте введённые данные',503:'Хранилище ключей недоступно'})[response.status] || 'Ошибка сервера');
  render(await response.json());
}
function refresh() {
  byId('problem').textContent = '';
  load().catch(err => {byId('problem').textContent = err.message;});
}
byId('refresh').addEventListener('click',refresh);
form.addEventListener('submit',async event => {
  event.preventDefault();
  const button = form.querySelector('button');
  if (button.disabled) return;
  button.disabled = true;
  byId('problem').textContent = byId('saved').textContent = '';
  try {
    await load('/api/admin/model-hub/keys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))});
    form.elements.key.value = '';
    byId('saved').textContent = 'Ключ сохранён';
  } catch (error) { byId('problem').textContent = error.message; }
  finally { button.disabled = false; }
});
accountForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = accountForm.querySelector('button');
  const output = accountForm.querySelector('output');
  const key = accountForm.elements.key_id.value;
  if (button.disabled || !key) return;
  button.disabled = true;
  byId('problem').textContent = output.textContent = '';
  try {
    await load('/api/admin/model-hub/keys/' + encodeURIComponent(key) + '/cloudflare-account', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({account_id:accountForm.elements.account_id.value})
    });
    accountForm.elements.account_id.value = '';
    output.textContent = 'Account ID сохранён';
  } catch (error) { byId('problem').textContent = error.message; }
  finally { button.disabled = false; }
});
refresh();
