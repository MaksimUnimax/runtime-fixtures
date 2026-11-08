'use strict';
const $ = id => document.getElementById(id);
let state, busy=false, dirty=false, qrPolling=false;
const labels={waiting:'Ожидание расчёта',sending:'Отправка',manual:'Ручная выдача',unknown:'Исход отправки неизвестен. Автоповтора нет.',accepted_waiting_skill:'Команда принята Яндексом, ожидаем запрос навыка',responded_to_skill:'Навык получил и вернул готовый ответ',stopped:'Доставка остановлена'};
const errors={login_required:'Войдите в админку заново, затем вернитесь на эту страницу.',owner_required:'Настройки доступны владельцу.',settings_changed_reload:'Настройки изменились в другой вкладке. Обновите страницу перед сохранением.',interval_10_300:'Интервал должен быть от 10 до 300 секунд.',messages_1_6_max_200:'Введите 1–6 сообщений, до 200 символов каждое.',manual_command_reserved:'Эта фраза занята командой навыка. Выберите другую.',manual_command_words:'Используйте русскую фразу длиной от 2 до 60 символов.',delivery_unknown_reconnect:'Исход предыдущей отправки неизвестен. Отключите колонку и подключите заново.',qr_expired:'QR истёк. Запросите новый.',already_paired:'Колонка уже привязана.',connect_first:'Сначала подключите Яндекс.',disconnect_before_reselect:'Для выбора другой колонки сначала отключите текущую.'};
function render(s,fill=false){
 state=s;
 if(fill){$('enabled').checked=s.settings.enabled;$('interval').value=s.settings.interval_seconds;$('messages').value=s.settings.pending_messages.join('\n');$('manual').value=s.settings.manual_command;dirty=false;}
 $('connection').textContent=(s.connected?'Яндекс подключён. ':'Яндекс не подключён. ')+(s.selected?'Выбрана: '+s.selected.name+'. ':'')+(s.paired?'Голосовая привязка подтверждена. ':'Голосовая привязка ещё не завершена. ')+(s.job_state?labels[s.job_state]||s.job_state:'')+(s.uncertain?' Исход отправки неизвестен; повтор автоматически не выполняется.':'');
 const previous=$('device').value;$('device').replaceChildren(...s.devices.map(d=>{const o=document.createElement('option');o.value=d.id;o.textContent=d.name;return o;}));if(s.devices.some(d=>d.id===previous))$('device').value=previous;
 $('qr-start').disabled=s.connected;$('devices').disabled=!s.connected;$('select').disabled=!s.connected||!!s.selected||!s.devices.length;$('pair').disabled=!s.selected||s.paired||s.uncertain||s.pair_pending;$('disconnect').disabled=!s.connected&&!s.selected;
 if(s.connected)$('qr').hidden=true;
}
async function call(action,data={}){
 const r=await fetch('api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...data})});const d=await r.json();if(!r.ok){const error=new Error(errors[d.error]||'Операция не выполнена: '+d.error);error.code=d.error;throw error;}return d;
}
async function run(action,data={},fill=false){if(busy)return;if(action==='disconnect')qrPolling=false;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);$('status').textContent='Выполняется…';try{const s=await call(action,data);if(action==='qr'){$('qr').hidden=false;$('qr-image').src='qr.svg';qrPolling=true;}else render(s,fill);$('status').textContent=action==='settings'?'Настройки сохранены.':action==='pair'?'Сервис подключает выбранную колонку. Дождитесь её сообщения.':'Состояние обновлено.';}catch(e){if(action==='poll'&&['qr_expired','login_required','owner_required'].includes(e.code))qrPolling=false;$('status').textContent=e.message;}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);if(state)render(state);}}
$('settings').addEventListener('input',()=>dirty=true);
$('settings').addEventListener('submit',e=>{e.preventDefault();if(!state)return;run('settings',{revision:state.revision,settings:{enabled:$('enabled').checked,interval_seconds:Number($('interval').value),pending_messages:$('messages').value.split('\n').filter(x=>x.trim()),manual_command:$('manual').value}},true);});
$('qr-start').onclick=()=>run('qr');$('qr-poll').onclick=()=>run('poll');$('devices').onclick=()=>run('devices');$('select').onclick=async()=>{await run('select',{device:$('device').value});if(state?.selected&&!state.paired)await run('pair');};$('pair').onclick=()=>run('pair');$('refresh').onclick=()=>run('status',{},!dirty);$('disconnect').onclick=()=>run('disconnect');
run('status',{},true);

setInterval(async()=>{
 if(busy||!state)return;
 if(qrPolling){await run('poll');if(state.connected){qrPolling=false;await run('devices');if(!state.selected&&state.devices.length===1){await run('select',{device:state.devices[0].id});await run('pair');}}}
 else if(state.pair_pending&&!state.paired)await run('status');
},3000);
