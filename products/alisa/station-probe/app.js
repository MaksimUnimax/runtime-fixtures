'use strict';
const el = id => document.getElementById(id);
let token = location.hash.slice(1) || sessionStorage.getItem('station-probe-access') || '';
history.replaceState(null, '', location.pathname);
if (token) sessionStorage.setItem('station-probe-access', token);
let busy = false, connected = false, selected = false, qrPoll = null;
let deviceListSignature = '';
const errors = {link_expired:'Ссылка истекла или открыта без доступа. Нужна новая ссылка проверки.',
 qr_expired:'QR истёк. Нажмите «Получить QR для входа» ещё раз.',
 test_rate_limit:'Подождите 12 секунд между проверками.',
 outcome_unknown_no_retry:'Исход предыдущей команды неизвестен. Автоматический повтор отключён.',
 selection_locked:'Колонка уже выбрана. Для новой колонки сначала отключите проверку.',
 not_connected:'Сначала подтвердите вход в Яндекс.', select_device:'Сначала выберите колонку.',
 quasar_auth_required:'Яндекс не подтвердил доступ к управлению колонкой. Требуется проверка способа входа.'};
function message(text) { el('status').textContent = text; }
async function api(kind, body = {}) {
 const r = await fetch('/station-probe/api/' + kind, {method:'POST', headers:{'Content-Type':'application/json',Authorization:'Bearer ' + token},body:JSON.stringify(body),cache:'no-store'});
 const out = await r.json(); if (!r.ok) throw new Error(errors[out.error] || ('Проверка остановлена: ' + out.error)); return out;
}
function view(v) {
 connected = !!v.connected; selected = !!v.selected;
 el('devices').disabled = busy || !connected;
 el('select').disabled = busy || !connected || selected;
 el('speaker').disabled = busy || !connected || selected;
 el('qr-start').disabled = busy || connected;
 el('text-test').disabled = el('skill-test').disabled = busy || !selected || v.uncertain;
 const signature = JSON.stringify(v.devices || []);
 if (v.devices && v.devices.length && signature !== deviceListSignature) {
  deviceListSignature = signature;
  const prev = el('speaker').value;
  el('speaker').replaceChildren(...v.devices.map(d => {const o=document.createElement('option');o.value=d.id;o.textContent=d.name;return o;}));
  if (v.selected || prev) el('speaker').value = v.selected || prev;
 }
 el('attempts').replaceChildren(...(v.attempts || []).map(a => {const li=document.createElement('li');
  const states={waiting:'Ожидание 15 секунд',sending:'Отправляю',accepted_not_heard:'Яндекс принял команду. Проверьте звук на колонке.',cancelled:'Отменено',unknown_no_retry:'Исход неизвестен. Повтор отключён.'};
  li.textContent = 'Проверка '+a.number+' · '+(a.mode==='skill'?'Наш навык':'Контрольная фраза')+' · '+(states[a.state]||a.state)+(a.error?' ('+a.error+')':'');return li;}));
}
async function run(fn) {if (busy) return;busy=true;try {await fn();}catch(e){message(e.message);}finally{busy=false;try{view(await api('status'));}catch{}}}
el('qr-start').onclick = () => run(async()=>{
 message('Получаю QR Яндекса…');const v=await api('qr');
 const blob=new Blob([v.svg],{type:'image/svg+xml'}),url=URL.createObjectURL(blob),img=document.createElement('img');
 img.src=url;img.alt='QR для подтверждения входа в Яндекс';img.onload=()=>URL.revokeObjectURL(url);el('qr').replaceChildren(img);
 el('qr-link').href=v.link;el('qr-link').hidden=false;
 message('Отсканируйте QR камерой телефона или приложением Яндекса и подтвердите вход.');
 clearInterval(qrPoll);qrPoll=setInterval(async()=>{if(busy)return;busy=true;try{const s=await api('poll');view(s);if(s.connected){clearInterval(qrPoll);el('qr').replaceChildren();el('qr-link').hidden=true;message('Яндекс подключён. Нажмите «Показать мои колонки».');}}catch(e){clearInterval(qrPoll);message(e.message);}finally{busy=false;}},3000);
});
el('devices').onclick=()=>run(async()=>{const v=await api('devices');view(v);message(v.devices.length?'Выберите колонку из списка.':'Колонки не найдены в этом аккаунте. Сообщите результат проверки.');});
el('select').onclick=()=>run(async()=>{view(await api('select',{device:el('speaker').value}));message('Колонка выбрана. Можно проверить автоматическую речь.');});
for (const [id,mode] of [['text-test','text'],['skill-test','skill']])el(id).onclick=()=>run(async()=>{view(await api('delay',{mode}));message('Проверка запущена. Через 15 секунд колонка должна заговорить. Ничего ей не говорите.');});
el('revoke').onclick=()=>run(async()=>{view(await api('revoke'));clearInterval(qrPoll);el('qr').replaceChildren();el('qr-link').hidden=true;el('speaker').replaceChildren();deviceListSignature='';message('Сессия очищена. Команды, ожидавшие запуска, отменены. Уже отправленную команду отозвать нельзя.');});
if(!token)message(errors.link_expired);else run(async()=>{const s=await api('status');view(s);message(s.connected?(s.selected?'Колонка выбрана. Можно проверить автоматическую речь.':'Яндекс подключён. Нажмите «Показать мои колонки».'):'Нажмите «Получить QR для входа».');});
setInterval(async()=>{if(busy||!token)return;try{view(await api('status'));}catch{}},3000);
