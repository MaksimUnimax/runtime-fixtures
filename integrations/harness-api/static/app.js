/* Octoport Harness: authenticated UI. No provider secrets or model calls in the browser. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = {user:null,permissions:{},chats:[],chat:null,messages:[],pending:null,poll:null,busy:false,authEpoch:0,navEpoch:0,view:'chat',pluginScope:'account',pluginEpoch:0,featureEpoch:0,meterEpoch:0,features:[]};
  const ROOT = '/harness/api';
  const store = {get(key){try{return localStorage.getItem(key);}catch{return null;}},set(key,value){try{localStorage.setItem(key,value);}catch{}}};
  const pendingKey = () => `octoport.harness.pending.${state.user?.tenant_id || ''}.${state.user?.id || ''}`;
  const chatKey = () => `octoport.harness.chat.${state.user?.tenant_id || ''}.${state.user?.id || ''}`;
  function notice(text, error=false) { $('notice').textContent=text||''; $('notice').hidden=!text; $('notice').classList.toggle('error',error); }
  function persistPending() { try { if(state.pending)sessionStorage.setItem(pendingKey(),JSON.stringify(state.pending));else sessionStorage.removeItem(pendingKey()); }catch{} }
  function setBusy(busy) {state.busy=busy;$('busy').hidden=!busy;$('send').disabled=busy||!$('prompt').value.trim();$('new-chat').disabled=busy;document.querySelectorAll('.chat-item').forEach(el=>el.disabled=busy);}
  function safeRelative(value,fallback) {try{const u=new URL(value,location.origin);return u.origin===location.origin?u.pathname+u.search+u.hash:fallback;}catch{return fallback;}}
  function showLogin(message='',loginUrl='/harness/login') {
    clearTimeout(state.poll);state.authEpoch++;state.navEpoch++;state.pluginEpoch++;state.featureEpoch++;state.meterEpoch++;
    $('prompt').value='';$('chat-title').textContent='Новый чат';notice('');sidebar(false);state.user=null;state.pending=null;state.chat=null;state.chats=[];state.messages=[];state.permissions={};state.features=[];setBusy(false);$('plugin-list').replaceChildren();$('meter-list').replaceChildren();$('meter-link').hidden=true;switchView('chat');$('messages').replaceChildren();$('chat-list').replaceChildren();
    $('loading').hidden=true;$('app').hidden=true;$('login-screen').hidden=false;
    $('login-link').href=safeRelative(loginUrl,'/harness/login');$('login-error').hidden=!message;$('login-error').textContent=message;
  }
  async function api(path,options={}) {
    const epoch=state.authEpoch;
    const response=await fetch(ROOT+path,{credentials:'same-origin',cache:'no-store',...options,headers:{Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
    let body;try{body=await response.json();}catch{throw Object.assign(new Error('Сервер вернул неполный ответ. Повторная отправка вопроса не выполнялась.'),{status:response.status});}
    if(epoch!==state.authEpoch)throw Object.assign(new Error('Устаревший ответ сессии'),{stale:true});
    if(response.status===401){showLogin('Сессия завершилась. Войдите, чтобы продолжить разговор.',body.login_url);throw Object.assign(new Error('Требуется вход'),{status:401});}
    if(!response.ok){const message=typeof body.error==='string'?body.error:body.error?.message||body.message||'Не удалось выполнить запрос.';throw Object.assign(new Error(message),{status:response.status,body});}
    return body;
  }
  function scrollEnd(){const box=$('conversation');requestAnimationFrame(()=>{box.scrollTop=box.scrollHeight;});}
  function resizePrompt(){const el=$('prompt');el.style.height='auto';el.style.height=Math.min(el.scrollHeight,180)+'px';$('send').disabled=state.busy||!el.value.trim();}
  function sidebar(open){$('sidebar').classList.toggle('open',open);$('sidebar-backdrop').hidden=!open;$('menu').setAttribute('aria-expanded',String(open));}
  function escapeInline(parent,value){
    // Formatting uses DOM text nodes, never HTML or execution of a model response.
    const parts=String(value).split(/(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]{1,160}\]\((?:https?:\/\/[^)\s]+|\/harness\/api\/reports\/[^)\s]+)\))/g);
    for(const part of parts){
      const link=part.match(/^\[([^\]\n]+)\]\(([^)\s]+)\)$/);let trusted=null;
      if(link){try{const u=new URL(link[2],location.origin);if(u.origin===location.origin&&!u.search&&!u.hash&&!u.username&&!u.password&&/^\/harness\/api\/reports\/[0-9a-f-]{36}\/[0-9a-f]{64}$/.test(u.pathname))trusted=u;}catch{}}
      if(trusted){const el=document.createElement('a');el.textContent=link[1];el.href=trusted.href;el.target='_blank';el.rel='noopener noreferrer';parent.append(el);}
      else if(part.startsWith('**')&&part.endsWith('**')){const el=document.createElement('strong');el.textContent=part.slice(2,-2);parent.append(el);}else if(part.startsWith('`')&&part.endsWith('`')){const el=document.createElement('code');el.textContent=part.slice(1,-1);parent.append(el);}else parent.append(document.createTextNode(part));
    }
  }
  function renderBody(parent,text){
    const lines=String(text||'').replace(/\r\n?/g,'\n').split('\n');let i=0;
    const cells=(line)=>line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(x=>x.trim());
    while(i<lines.length){const line=lines[i];if(!line.trim()){i++;continue;}
      if(line.startsWith('```')){const block=[];i++;while(i<lines.length&&!lines[i].startsWith('```'))block.push(lines[i++]);if(i<lines.length)i++;const pre=document.createElement('pre');const code=document.createElement('code');code.textContent=block.join('\n');pre.append(code);parent.append(pre);continue;}
      if(i+1<lines.length&&line.includes('|')&&/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i+1])){
        const wrap=document.createElement('div');wrap.className='table-scroll';const table=document.createElement('table');const head=document.createElement('thead');const tr=document.createElement('tr');for(const cell of cells(line)){const th=document.createElement('th');escapeInline(th,cell);tr.append(th);}head.append(tr);table.append(head);i+=2;const tbody=document.createElement('tbody');while(i<lines.length&&lines[i].includes('|')&&lines[i].trim()){const row=document.createElement('tr');for(const cell of cells(lines[i++])){const td=document.createElement('td');escapeInline(td,cell);row.append(td);}tbody.append(row);}table.append(tbody);wrap.append(table);parent.append(wrap);continue;
      }
      const heading=line.match(/^(#{1,4})\s+(.+)$/);if(heading){const h=document.createElement('h'+Math.min(heading[1].length+1,4));escapeInline(h,heading[2]);parent.append(h);i++;continue;}
      if(/^\s*[-*]\s+/.test(line)){const ul=document.createElement('ul');while(i<lines.length&&/^\s*[-*]\s+/.test(lines[i])){const li=document.createElement('li');escapeInline(li,lines[i++].replace(/^\s*[-*]\s+/,''));ul.append(li);}parent.append(ul);continue;}
      const p=document.createElement('p');const para=[line];i++;while(i<lines.length&&lines[i].trim()&&!/^(#{1,4}\s|```|\s*[-*]\s)/.test(lines[i])&&!(i+1<lines.length&&lines[i].includes('|')&&lines[i+1].includes('---')))para.push(lines[i++]);escapeInline(p,para.join('\n'));parent.append(p);
    }
  }
  function messageText(msg){if(typeof msg.text==='string')return msg.text;if(typeof msg.content==='string')return msg.content;if(Array.isArray(msg.content))return msg.content.filter(x=>x.type==='text').map(x=>x.text).join('\n');return '';}
  function messageId(msg,index=0){return String(msg.id||msg.message_id||`${state.chat?.id}:${msg.role}:${msg.created_at||index}`);}
  function trustedReport(value){
    try{const u=new URL(value,location.origin);return u.origin===location.origin&&!u.search&&!u.hash&&!u.username&&!u.password&&/^\/harness\/api\/reports\/[0-9a-f-]{36}\/[0-9a-f]{64}$/.test(u.pathname)?u.href:null;}catch{return null;}
  }
  function canMeter(){return state.permissions.developer_meter===true&&state.features.some(p=>p.id==='dev-meter'&&p.enabled);}
  const number=(value)=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('ru-RU'):'нет данных';
  function rubles(value){if(value===null||value===undefined||value==='')return 'нет оценки';const n=Number(value);return Number.isFinite(n)?n.toLocaleString('ru-RU',{minimumFractionDigits:4,maximumFractionDigits:6})+' ₽':'нет оценки';}
  function meterElement(meter){
    const el=document.createElement('details');el.className='meter-details';
    const summary=document.createElement('summary');const total=meter.tokens?.total;const rub=meter.rub||{};
    summary.textContent=(rub.complete===true&&rub.estimated!=null?'≈ '+rubles(rub.estimated):'Стоимость не определена')+' · '+(total==null?'токены не подтверждены':number(total)+' токенов');el.append(summary);
    const dl=document.createElement('dl');
    const row=(key,value)=>{const dt=document.createElement('dt');dt.textContent=key;const dd=document.createElement('dd');dd.textContent=String(value);dl.append(dt,dd);};
    row('Вход',number(meter.tokens?.prompt));row('Из кэша',number(meter.tokens?.cache_hit));row('Без кэша',number(meter.tokens?.cache_miss));row('Выход',number(meter.tokens?.completion));row('Вызовы модели',number(meter.calls?.model));row('Финальные вызовы',number(meter.calls?.final));
    if(rub.complete!==true){row('Подтверждённая часть',rubles(rub.known));row('Без оценки',number(rub.unpriced_attempts));}
    for(const quote of meter.quotes||[]){if(quote.period)row('Тариф',['off_peak','offpeak'].includes(quote.period)?'Вне пика':quote.period==='peak'?'Пиковый':quote.period);if(quote.as_of)row('Снимок тарифа',quote.as_of);if(quote.fx_as_of)row('Курс от',quote.fx_as_of);const fx=quote.rates?.rub_per_currency??quote.rates?.rub_per_usd??quote.rates?.usd_rub;if(fx!=null)row('USD / RUB',fx);}
    el.append(dl);const note=document.createElement('p');note.className='meter-note';note.textContent='Оценка по квитанциям API, тарифу и курсу на момент запроса. Это не банковское списание. Повторные попытки учитываются; отсутствие квитанции не считается нулевым расходом.';el.append(note);return el;
  }
  function renderMessages(){
    const list=$('messages');list.replaceChildren();const empty=!state.messages.some(msg=>['user','assistant'].includes(msg.role)&&messageText(msg));$('empty-state').hidden=!empty;$('workspace').classList.toggle('is-empty',empty&&state.view==='chat');$('workspace').classList.toggle('is-new-chat',!state.chat&&state.view==='chat');
    state.messages.forEach((msg,index)=>{
      if(!['user','assistant'].includes(msg.role))return;const text=messageText(msg);if(!text)return;
      const article=document.createElement('article');article.className='message '+msg.role;article.dataset.messageId=messageId(msg,index);
      const label=document.createElement('span');label.className='sr-only';label.textContent=msg.role==='user'?'Вы:':'Harness:';
      const body=document.createElement('div');body.className='message-body';if(msg.role==='user')body.textContent=text;else renderBody(body,text);article.append(label,body);
      if(msg.role==='assistant'){
        const presentation=msg.presentation||{};
        if(typeof presentation.details==='string'&&presentation.details.trim()&&presentation.details.trim()!==text.trim()){
          const details=document.createElement('details');details.className='response-details';const title=document.createElement('summary');title.textContent='Подробнее';const content=document.createElement('div');content.className='message-body';renderBody(content,presentation.details);details.append(title,content);article.append(details);
        }
        const reports=document.createElement('div');reports.className='report-links';for(const report of presentation.report_urls||[]){const href=trustedReport(report.url);if(!href)continue;const link=document.createElement('a');link.href=href;link.target='_blank';link.rel='noopener noreferrer';link.textContent=report.label||'Полный отчёт';reports.append(link);}if(reports.childElementCount)article.append(reports);
        const meta=msg.metadata||{};if(meta.incomplete){const hint=document.createElement('p');hint.className='message-meta';hint.textContent='Данные получены частично';article.append(hint);}
        const actions=document.createElement('div');actions.className='message-actions';const copy=document.createElement('button');copy.type='button';copy.className='quiet-button';copy.textContent='Копировать';copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(text);copy.textContent='Скопировано';setTimeout(()=>{copy.textContent='Копировать';},1800);}catch{notice('Не удалось скопировать автоматически. Выделите текст ответа и скопируйте его.');}});actions.append(copy);article.append(actions);
        const meter=msg.meter||meta.meter;if(canMeter()&&meter&&typeof meter==='object')article.append(meterElement(meter));
      }
      list.append(article);
    });
  }
  function renderChats(){
    const nav=$('chat-list');nav.replaceChildren();if(!state.chats.length){const p=document.createElement('p');p.className='history-empty';p.textContent='Пока нет чатов';nav.append(p);return;}
    for(const chat of state.chats){const b=document.createElement('button');b.className='chat-item'+(state.chat?.id===chat.id?' active':'');b.textContent=chat.title||'Новый чат';b.title=b.textContent;b.disabled=state.busy;b.addEventListener('click',()=>openChat(chat.id).catch(handleError));nav.append(b);}
  }
  function handleError(error){if(error.status!==401&&!error.stale)notice(error.message||'Не удалось связаться с сервером.',true);}
  async function refreshChats(){const result=await api('/chats');state.chats=Array.isArray(result.chats)?result.chats:[];renderChats();}
  async function openChat(id,preserveView=false){
    const navigation=++state.navEpoch;if(!preserveView)switchView('chat');sidebar(false);const result=await api('/chats/'+encodeURIComponent(id));if(navigation!==state.navEpoch)return;state.chat=result.chat||{id};state.messages=Array.isArray(result.messages)?result.messages:[];store.set(chatKey(),state.chat.id);$('chat-title').textContent=state.chat.title||'Новый чат';renderChats();renderMessages();scrollEnd();await refreshFeatures();
  }
  function freshChat(){if(state.busy)return;state.navEpoch++;switchView('chat');state.chat=null;state.messages=[];store.set(chatKey(),'');$('chat-title').textContent='Новый чат';renderChats();renderMessages();notice('');sidebar(false);refreshFeatures().catch(handleError);$('prompt').focus();}
  async function ensureChat(text){if(state.chat)return;const data=await api('/chats',{method:'POST',body:JSON.stringify({title:text.slice(0,80)})});state.chat=data.chat||data;store.set(chatKey(),state.chat.id);$('chat-title').textContent=state.chat.title||text.slice(0,80);await refreshChats();}
  function finishPending(){clearTimeout(state.poll);state.pending=null;persistPending();setBusy(false);}
  async function pollRequest(){
    const pending=state.pending;if(!pending)return;
    try{
      const result=await api('/requests/'+encodeURIComponent(pending.request_id));if(state.pending!==pending)return;
      const status=result.status||result.state;
      if(['completed','succeeded','done'].includes(status)){
        const chatId=pending.chat_id;const navigation=state.navEpoch;finishPending();await refreshChats();if(state.navEpoch!==navigation||state.chat?.id!==chatId){notice('Ответ готов в предыдущем разговоре.');return;}const appliedNavigation=state.navEpoch+1;await openChat(chatId,true);if(state.navEpoch!==appliedNavigation||state.chat?.id!==chatId)return;
        // History is authoritative. A completed job may also carry a final response.
        const msg=typeof result.message==='string'?{role:'assistant',text:result.message,id:result.message_id||pending.request_id}:result.message;
        if(msg&&messageText(msg)){const existing=msg.id?state.messages.findIndex(x=>x.role==='assistant'&&x.id===msg.id):-1;if(existing>=0){state.messages[existing]={...state.messages[existing],...msg,role:'assistant',metadata:{...state.messages[existing].metadata,...msg.metadata}};}else{state.messages.push({...msg,role:'assistant'});}renderMessages();scrollEnd();}
        if((!msg||!messageText(msg))&&result.text){const fallback={role:'assistant',text:result.text,id:pending.request_id,metadata:result.metadata};if(!state.messages.some(x=>x.role==='assistant'&&messageText(x)===result.text)){state.messages.push(fallback);renderMessages();scrollEnd();}}
        notice('');return;
      }
      if(['failed','cancelled','canceled','rejected'].includes(status)){const navigation=state.navEpoch;finishPending();const e=typeof result.error==='string'?result.error:result.error?.message||'Не удалось обработать вопрос. Повторного запроса к магазину не было.';notice(e,true);try{if(state.navEpoch===navigation&&state.chat?.id===pending.chat_id)await openChat(pending.chat_id,true);}catch{}return;}
      if(['unknown','interrupted'].includes(status)){finishPending();notice('Исполнение прервалось, и результат не подтверждён. Этот вопрос не отправляется повторно. Вы можете продолжить разговор новым вопросом.',true);return;}
      const seconds=Math.floor((Date.now()-pending.started)/1000);$('busy-label').textContent=seconds>25?`Получаем данные и готовим ответ · ${seconds} с`:'Обрабатываем запрос…';
      state.poll=setTimeout(pollRequest,seconds>30?2200:1200);
    }catch(error){
      if(error.status===401||error.stale)return;if(state.pending!==pending)return;
      pending.poll_errors=(pending.poll_errors||0)+1;
      if(error.status===403){finishPending();notice('Этот запрос недоступен для текущего аккаунта.',true);return;}
      if(pending.poll_errors>5){setBusy(false);notice('Связь с сервером прервалась. Вопрос не отправлялся заново. Обновите страницу для проверки его состояния.',true);return;}
      $('busy-label').textContent='Восстанавливаем связь с текущим запросом…';state.poll=setTimeout(pollRequest,2500);
    }
  }
  async function send(event){
    event?.preventDefault();const epoch=state.authEpoch;const text=$('prompt').value.trim();if(!text||state.busy)return;if(text.length>1200){notice('Сократите вопрос до 1200 символов. Текст сохранён в поле ввода.',true);return;}
    if(state.pending){notice('Сначала дождитесь результата предыдущего запроса. Обновление страницы проверит его состояние без повторной отправки.',true);return;}
    notice('');setBusy(true);
    try{
      await ensureChat(text);if(epoch!==state.authEpoch)return;const requestId=crypto.randomUUID();state.pending={request_id:requestId,chat_id:state.chat.id,started:Date.now()};persistPending();
      const optimistic={id:requestId,role:'user',text,created_at:new Date().toISOString()};state.messages.push(optimistic);renderMessages();scrollEnd();$('prompt').value='';resizePrompt();
      try{const receipt=await api('/chats/'+encodeURIComponent(state.chat.id)+'/messages',{method:'POST',body:JSON.stringify({text,request_id:requestId})});if(receipt.request_id&&receipt.request_id!==requestId){state.pending.request_id=receipt.request_id;persistPending();}}
      catch(error){if(error.stale||epoch!==state.authEpoch)return;if(error.status&&error.status<500&&error.status!==408){finishPending();$('prompt').value=text;resizePrompt();handleError(error);return;}notice('Проверяем, принял ли сервер вопрос. Повторная отправка не выполняется.');}
      await pollRequest();
    }catch(error){if(error.stale||epoch!==state.authEpoch)return;if(!state.pending)setBusy(false);handleError(error);}
  }
  function switchView(view){
    state.view=view;$('conversation').hidden=view!=='chat';$('composer-wrap').hidden=view!=='chat';$('plugins-view').hidden=view!=='plugins';$('meter-view').hidden=view!=='meter';$('workspace').classList.toggle('showing-settings',view!=='chat');$('workspace').classList.toggle('is-empty',view==='chat'&&!state.messages.length);$('workspace').classList.toggle('is-new-chat',view==='chat'&&!state.chat);$('plugins-link').classList.toggle('active',view==='plugins');$('meter-link').classList.toggle('active',view==='meter');
  }
  async function refreshFeatures(){
    const epoch=++state.featureEpoch;const chat=state.chat?.id;const data=await api(chat?'/chats/'+encodeURIComponent(chat)+'/plugins':'/plugins');if(epoch!==state.featureEpoch||chat!==state.chat?.id)return;
    state.features=Array.isArray(data.plugins)?data.plugins:[];const matrix=state.features.find(p=>p.id==='matrix');$('mode-label').textContent=matrix?.enabled?'Матрица':'Плагины';renderMessages();
  }
  async function showPlugins(scope){
    if(scope)state.pluginScope=scope;if(state.pluginScope==='chat'&&!state.chat)state.pluginScope='account';switchView('plugins');sidebar(false);await loadPlugins();
  }
  async function loadPlugins(){
    const epoch=++state.pluginEpoch;const chat=state.chat?.id;const scope=state.pluginScope;
    $('scope-chat').disabled=!chat;$('scope-chat').setAttribute('aria-selected',String(scope==='chat'));$('scope-account').setAttribute('aria-selected',String(scope==='account'));$('plugin-status').textContent='Загружаем плагины…';$('plugin-list').replaceChildren();
    try{const data=await api(scope==='chat'?'/chats/'+encodeURIComponent(chat)+'/plugins':'/plugins');if(epoch!==state.pluginEpoch||state.view!=='plugins')return;renderPlugins(data);$('plugin-status').textContent=scope==='chat'?'Настройки этого чата':'Настройки по умолчанию для вашего аккаунта';}catch(error){if(epoch===state.pluginEpoch&&!error.stale&&error.status!==401)$('plugin-status').textContent=error.message;}
  }
  function renderPlugins(data){
    const list=$('plugin-list');list.replaceChildren();for(const plugin of data.plugins||[]){
      const card=document.createElement('article');card.className='plugin-card';card.dataset.pluginId=plugin.id;const icon=document.createElement('span');icon.className='plugin-icon';icon.textContent=plugin.required?'⌘':'◇';icon.setAttribute('aria-hidden','true');
      const info=document.createElement('div');info.className='plugin-info';const title=document.createElement('h2');title.textContent=plugin.name||plugin.id;const desc=document.createElement('p');desc.textContent=plugin.description||'';const meta=document.createElement('div');meta.className='plugin-meta';const source=plugin.required?'Всегда включён':plugin.setting_source==='chat'?'Настройка чата':plugin.setting_source==='account'?'Настройка аккаунта':'По умолчанию';meta.textContent=plugin.id+' · '+(plugin.version||'1.0.0')+' · '+source;info.append(title,desc,meta);
      const controls=document.createElement('div');controls.className='plugin-controls';const label=document.createElement('span');label.className='small';label.textContent=plugin.enabled?'Включён':'Выключен';const toggle=document.createElement('input');toggle.type='checkbox';toggle.className='plugin-switch';toggle.checked=plugin.enabled===true;toggle.disabled=plugin.required===true;toggle.setAttribute('aria-label',(plugin.name||plugin.id));controls.append(label,toggle);card.append(icon,info,controls);list.append(card);
      toggle.addEventListener('change',async()=>{
        const scope=state.pluginScope,chat=state.chat?.id,epoch=state.pluginEpoch;toggle.disabled=true;try{
          const prefix=scope==='chat'?'/chats/'+encodeURIComponent(chat)+'/plugins/':'/plugins/';const result=await api(prefix+encodeURIComponent(plugin.id),{method:'POST',body:JSON.stringify({enabled:toggle.checked})});if(epoch!==state.pluginEpoch||state.view!=='plugins')return;renderPlugins(result);$('plugin-status').textContent='Сохранено '+(scope==='chat'?'для этого чата.':'для вашего аккаунта.');await refreshFeatures();
        }catch(error){if(epoch!==state.pluginEpoch||error.stale||error.status===401)return;toggle.checked=plugin.enabled===true;toggle.disabled=false;$('plugin-status').textContent=error.message;}
      });
    }
  }
  async function showMeter(){
    if(state.permissions.developer_meter!==true)return;switchView('meter');sidebar(false);const epoch=++state.meterEpoch;$('meter-status').textContent='Загружаем расход запросов…';$('meter-list').replaceChildren();
    try{const data=await api('/developer/meter');if(epoch!==state.meterEpoch||state.view!=='meter')return;const requests=data.requests||[];for(const request of requests){const card=document.createElement('article');card.className='meter-card';const title=document.createElement('h2');const statuses={completed:'Готово',failed:'Ошибка',interrupted:'Прерван',running:'Выполняется',pending:'В очереди'};title.textContent=(statuses[request.state||request.status]||request.state||request.status||'Запрос')+' · '+String(request.job_id||request.request_id||'').slice(0,8);card.append(title);if(request.meter)card.append(meterElement(request.meter));else{const p=document.createElement('p');p.className='muted small';p.textContent='Квитанция расхода недоступна';card.append(p);}$('meter-list').append(card);}$('meter-status').textContent=requests.length?'Последние запросы: '+requests.length:'Пока нет запросов с квитанциями расхода.';}catch(error){if(epoch===state.meterEpoch&&!error.stale&&error.status!==401)$('meter-status').textContent=error.status===403?'Плагин расхода недоступен или выключен. Проверьте его состояние в разделе «Плагины».':error.message;}
  }
  function applyTheme(dark){document.body.toggleAttribute('data-ds-dark-theme',dark);$('theme-label').textContent=dark?'Светлая тема':'Тёмная тема';$('theme-toggle').setAttribute('aria-pressed',String(dark));}
  function collapseSidebar(collapsed){$('app').classList.toggle('rail',collapsed);$('collapse-sidebar').title=collapsed?'Развернуть боковую панель':'Свернуть боковую панель';$('collapse-sidebar').setAttribute('aria-label',$('collapse-sidebar').title);}
  async function boot(){
    applyTheme(store.get('octoport.harness.theme')==='dark');collapseSidebar(window.innerWidth>=768&&(store.get('octoport.harness.sidebar')==='rail'||window.innerWidth<1024));resizePrompt();
    try{
      const info=await api('/me');if(info.authenticated===false){showLogin('',info.login_url);return;}state.permissions=info.permissions||{};$('meter-link').hidden=state.permissions.developer_meter!==true;state.user=info.user||{};state.user.id=state.user.id||state.user.customer_id;
      if(!state.user.id)throw new Error('Не удалось определить аккаунт. Войдите повторно.');
      const name=state.user.name||state.user.display_name||state.user.email||'Ваш аккаунт';$('user-name').textContent=name;$('avatar').textContent=name.charAt(0).toUpperCase();
      const stores=Array.isArray(info.stores)?info.stores:[];$('store-count').textContent=`Магазинов: ${stores.length}`;$('connection-label').textContent=stores.length===1?(stores[0].name||stores[0].title||'Мой магазин'):stores.length?'Мои магазины ('+stores.length+')':'Подключить магазин';
      if(info.stores_url){$('stores-link').href=safeRelative(info.stores_url,'/app/stores/');$('workspace-link').href=$('stores-link').href;}
      $('loading').hidden=true;$('login-screen').hidden=true;$('app').hidden=false;
      await refreshChats();let pending;try{pending=JSON.parse(sessionStorage.getItem(pendingKey())||'null');}catch{}
      const last=pending?.chat_id||store.get(chatKey());if(last&&state.chats.some(x=>x.id===last))await openChat(last);
      if(pending?.request_id&&pending?.chat_id){state.pending=pending;state.pending.poll_errors=0;setBusy(true);notice('Проверяем результат ранее отправленного вопроса.');pollRequest();}
      await refreshFeatures();
      if(!stores.length)notice('Подключите Ozon или Wildberries в разделе «Мои магазины». Команды плагинов доступны уже сейчас.');
    }catch(error){if(error.status!==401)showLogin(error.message||'Не удалось открыть аккаунт.');}
  }
  $('composer').addEventListener('submit',send);$('prompt').addEventListener('input',resizePrompt);$('prompt').addEventListener('keydown',(e)=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&window.matchMedia('(min-width: 721px)').matches){e.preventDefault();send();}});
  $('new-chat').addEventListener('click',freshChat);$('menu').addEventListener('click',()=>sidebar(!$('sidebar').classList.contains('open')));$('sidebar-backdrop').addEventListener('click',()=>sidebar(false));
  $('plugins-link').addEventListener('click',()=>showPlugins('account').catch(handleError));$('chat-plugins').addEventListener('click',()=>showPlugins('chat').catch(handleError));$('mode-button').addEventListener('click',()=>showPlugins(state.chat?'chat':'account').catch(handleError));$('scope-chat').addEventListener('click',()=>showPlugins('chat').catch(handleError));$('scope-account').addEventListener('click',()=>showPlugins('account').catch(handleError));
  document.querySelectorAll('.back-chat').forEach(button=>button.addEventListener('click',()=>{state.pluginEpoch++;state.meterEpoch++;switchView('chat');renderMessages();}));$('meter-link').addEventListener('click',showMeter);$('refresh-meter').addEventListener('click',showMeter);
  $('theme-toggle').addEventListener('click',()=>{const dark=!document.body.hasAttribute('data-ds-dark-theme');applyTheme(dark);store.set('octoport.harness.theme',dark?'dark':'light');});$('collapse-sidebar').addEventListener('click',()=>{if(window.innerWidth<768){sidebar(false);return;}const rail=!$('app').classList.contains('rail');collapseSidebar(rail);store.set('octoport.harness.sidebar',rail?'rail':'expanded');});window.addEventListener('resize',()=>{if(window.innerWidth<768)collapseSidebar(false);});
  $('logout').addEventListener('click',async()=>{$('logout').disabled=true;try{await api('/logout',{method:'POST',body:'{}'});clearTimeout(state.poll);state.messages=[];state.chats=[];state.chat=null;$('messages').replaceChildren();$('chat-list').replaceChildren();showLogin('Вы вышли из аккаунта.');}catch(error){handleError(error);}finally{$('logout').disabled=false;}});
  window.addEventListener('online',()=>{if(state.pending&&!state.busy){state.pending.poll_errors=0;setBusy(true);pollRequest();}});
  boot();
})();
