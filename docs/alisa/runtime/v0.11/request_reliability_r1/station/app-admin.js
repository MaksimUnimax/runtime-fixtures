const $=id=>document.getElementById(id);let revision=0;
async function request(action,rest={}){const response=await fetch('api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...rest})});const value=await response.json();if(!response.ok)throw Error(value.error||'Недоступно');return value;}
async function load(){try{const s=await request('status');revision=s.revision;$('enabled').checked=s.settings.enabled;$('interval').value=s.settings.interval_seconds;$('messages').value=s.settings.pending_messages.join('\n');$('manual').value=s.settings.manual_command;$('status').textContent='Настройки загружены.';}catch(e){$('status').textContent=e.message;}}
$('settings').onsubmit=async event=>{event.preventDefault();try{await request('settings',{revision,settings:{enabled:$('enabled').checked,interval_seconds:Number($('interval').value),pending_messages:$('messages').value.split('\n').filter(x=>x.trim()),manual_command:$('manual').value}});$('status').textContent='Сохранено.';await load();}catch(e){$('status').textContent=e.message;}};load();


async function loadModelUsage(){try{const m=await request('model_usage');showEconomics(m.economics);const avg=m.average===null?'нет принятых запросов':m.average.toLocaleString('ru-RU',{maximumFractionDigits:4});$('model-usage').textContent=`Среднее: ${avg}. Обращений: ${m.attempts}; запросов: ${m.requests}. Получено ответов: ${m.received}; ошибок: ${m.failed}; неопределённых исходов: ${m.unknown}; без завершённой квитанции: ${m.pending}.`;$('model-usage-period').textContent=`Сбор с ${new Date(m.collection_started_at*1000).toLocaleString('ru-RU')}. ${m.full_window?'Показаны последние 7 дней.':'Полное непрерывное покрытие недели ещё не подтверждено; последний запуск '+new Date(m.coverage_since*1000).toLocaleString('ru-RU')+'.'}`;}catch(e){$('model-usage').textContent='Статистика временно недоступна. '+e.message;}}
$('model-usage-refresh').onclick=loadModelUsage;loadModelUsage();

let answerRevision=null;
function showAnswerSettings(value){answerRevision=value.revision;$('request-planning-prompt').value=value.request_planning_prompt;$('answer-prompt').value=value.answer_prompt;$('answer-extra-instruction').value=value.answer_extra_instruction;$('answer-save').disabled=false;}
async function loadAnswerSettings(){try{showAnswerSettings(await request('answer_settings'));$('answer-status').textContent='Инструкция загружена.';}catch(e){$('answer-status').textContent='Не удалось загрузить инструкцию: '+e.message;}}
$('answer-settings').onsubmit=async event=>{event.preventDefault();if(answerRevision===null)return;$('answer-save').disabled=true;try{showAnswerSettings(await request('answer_settings_save',{revision:answerRevision,request_planning_prompt:$('request-planning-prompt').value,answer_prompt:$('answer-prompt').value,answer_extra_instruction:$('answer-extra-instruction').value}));$('answer-status').textContent='Сохранено.';}catch(e){$('answer-status').textContent=e.message==='settings_changed_reload'?'Настройка уже изменена. Скопируйте свой текст и нажмите «Перечитать».':'Не удалось сохранить: '+e.message;}finally{$('answer-save').disabled=false;}};
$('answer-reload').onclick=loadAnswerSettings;loadAnswerSettings();

function showEconomics(economics){
 const host=$('request-economics');if(!host)return;
 host.textContent='';
 if(!economics){host.textContent='Экономика запросов пока недоступна.';return;}
 const note=document.createElement('p');note.textContent='Оценка по тарифу и курсу, сохранённым на момент отправки. Это не банковское списание. Неполная стоимость не равна нулю. Время вне API включает очередь, ожидание повтора и локальный расчёт.';host.appendChild(note);
 const table=document.createElement('table');const header=document.createElement('tr');
 for(const title of ['Запрос','Маршрут','Отправки / квитанции','Оценка, ₽','Время, сек.','Тариф / курс']){const cell=document.createElement('th');cell.textContent=title;header.appendChild(cell);}table.appendChild(header);
 for(const row of economics.requests||[]){
  const tr=document.createElement('tr');const timing=row.timing;
  const time=timing?`Всего ${(timing.total_ms/1000).toFixed(1)}; API ${(timing.provider_ms/1000).toFixed(1)}; вне API ${(timing.outside_provider_ms/1000).toFixed(1)}${timing.program_ms==null?'':`; программный этап ${(timing.program_ms/1000).toFixed(1)} (включая его вызовы и ожидания)`}`:'Нет полной отметки завершения';
  const quote=(row.quotes||[]).map(q=>`${q.as_of}: ${q.rates.input_cached} / ${q.rates.input_uncached} / ${q.rates.output} ${q.currency} за млн; ${q.fx_as_of}: ${q.rates.rub_per_currency} ₽/${q.currency} (${q.period==='peak'?'пиковый':'непиковый'} тариф; возраст курса ${q.fx_age_days} дн.)`).join('; ')||'Нет датированной оценки';
  const cost=row.known_rub===null?'Неизвестна':`${Number(row.known_rub).toLocaleString('ru-RU',{maximumFractionDigits:6})}${row.cost_complete?'':' + неизвестная часть'}`;
  for(const value of [row.request,row.route==='program'?'Программа':row.route==='direct'?'Прямой':'Не завершён',`${row.attempts} / ${row.complete_receipts}`,cost,time,quote]){const cell=document.createElement('td');cell.textContent=value;tr.appendChild(cell);}table.appendChild(tr);
 }
 host.appendChild(table);
}
