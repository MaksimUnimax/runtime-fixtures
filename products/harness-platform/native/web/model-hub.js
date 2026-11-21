const byId = id => document.getElementById(id);
const form = byId('save');
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
  list('keys', data.keys.map(k => providers[k.provider] + ' · ' + k.label), 'Ключи ещё не добавлены');
  list('models', data.models.map(m => m.model + ' · ' + statuses[m.status] + (m.research ? ' · ' + m.research.finding + ' · ' + m.research.source : '')), 'Кандидатов пока нет');
}
async function load(path = '/api/admin/model-hub', options = {}) {
  const response = await fetch(path, {credentials:'same-origin', cache:'no-store', ...options});
  if (!response.ok) throw new Error(({401:'Требуется вход',403:'Требуется доступ администратора',400:'Проверьте поставщика, ключ и метку',503:'Хранилище ключей недоступно'})[response.status] || 'Ошибка сервера');
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
refresh();
