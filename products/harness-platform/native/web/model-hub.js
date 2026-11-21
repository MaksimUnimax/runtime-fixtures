const byId = id => document.getElementById(id);
const form = byId('save');
const accountForm = byId('cloudflare-account');
const stamp = value => new Date(value * 1000).toLocaleString('ru-RU');
const statuses = { research: 'Проверить прямого поставщика', key_saved: 'Ключ сохранён, требуется прямая проверка', needs_key: 'Требуется ключ', excluded: 'Регистрация отключена для проекта' };
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
function renderEnrollment(rows) {
  const active = rows.filter(row => row.kind === 'free');
  byId('enrollment').replaceChildren(...active.map(row => {
    const item = document.createElement('li');
    const title = document.createElement('strong');
    title.textContent = row.name;
    item.append(title, ' · Есть бесплатный тариф', row.configured ? ' · ключ уже сохранён. ' : '. ', row.terms, ' ');
    if (!row.configured) {
      const link = document.createElement('a');
      link.href = row.url;
      link.textContent = 'Открыть кабинет';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      item.append(link, '. ', row.steps);
    }
    return item;
  }));
  list('excluded', rows.filter(row => row.kind === 'excluded').map(row => row.name + ' · ' + row.terms), 'Нет исключений');
}
function render(data) {
  byId('catalog').textContent = monitor('Каталог OpenRouter', data.catalog);
  byId('monitor').textContent = monitor('Проверка Codex', data.monitor);
  renderEnrollment(data.enrollment || []);
  const providers = data.providers;
  const select = form.elements.provider;
  const prior = select.value;
  const eligible = data.registration_providers || Object.fromEntries(
    (data.enrollment || []).filter(row => row.kind === 'free').map(row => [row.id,row.name])
  );
  const choices = Object.entries(eligible).map(([id, name]) => new Option(name,id));
  for (const key of data.keys.filter(k => !(k.provider in eligible))) {
    const option = new Option('Заменить ключ · ' + providers[key.provider] + ' · ' + key.label, 'saved:' + key.id);
    option.dataset.provider = key.provider;
    option.dataset.label = key.label;
    choices.push(option);
  }
  select.replaceChildren(...choices);
  if (choices.some(option => option.value === prior)) select.value = prior;
  syncKeyLabel();
  const requests = Object.entries(data.missing).map(([id, models]) => providers[id] + ' · ' + models.join(', '));
  for (const row of data.enrollment || []) {
    if (row.kind === 'free' && !row.configured && !(row.id in data.missing)) {
      requests.push(row.name + ' · добавить ключ для проверки прямого API. Инструкция в разделе «Где получить ключ».');
    }
  }
  list('missing', requests, data.catalog?.succeeded ? 'Все известные необходимые ключи сохранены' : 'Ожидается каталог');
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
  list('models', data.models.map(m => m.model + ' · ' + statuses[m.status] + (m.findings || []).map(r => ' · ' + r.finding + (r.source ? ' · ' + r.source : '')).join('')), 'Кандидатов пока нет');
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
function syncKeyLabel() {
  const option = form.elements.provider.selectedOptions[0];
  const label = form.elements.label;
  const locked = option?.dataset.label;
  if (locked || label.readOnly) label.value = locked || '';
  label.readOnly = Boolean(locked);
}
form.elements.provider.addEventListener('change',syncKeyLabel);
byId('refresh').addEventListener('click',refresh);
form.addEventListener('submit',async event => {
  event.preventDefault();
  const button = form.querySelector('button');
  if (button.disabled) return;
  button.disabled = true;
  byId('problem').textContent = byId('saved').textContent = '';
  try {
    const fields = Object.fromEntries(new FormData(form));
    const option = form.elements.provider.selectedOptions[0];
    if (option?.dataset.provider) {
      fields.provider = option.dataset.provider;
      fields.label = option.dataset.label;
    }
    await load('/api/admin/model-hub/keys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(fields)});
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
