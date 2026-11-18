/* Octoport Harness: authenticated UI. No provider secrets or model calls in the browser. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = {user:null,chats:[],chat:null,messages:[],pending:null,poll:null,busy:false,spoken:new Set(),speechEpoch:0,authEpoch:0,navEpoch:0,recognition:null};
  const ROOT = '/harness/api';
  const store = {get(key){try{return localStorage.getItem(key);}catch{return null;}},set(key,value){try{localStorage.setItem(key,value);}catch{}}};
  const pendingKey = () => `octoport.harness.pending.${state.user?.id || ''}`;
  const chatKey = () => `octoport.harness.chat.${state.user?.id || ''}`;
  function notice(text, error=false) { $('notice').textContent=text||''; $('notice').hidden=!text; $('notice').classList.toggle('error',error); }
  function persistPending() { try { if(state.pending)sessionStorage.setItem(pendingKey(),JSON.stringify(state.pending));else sessionStorage.removeItem(pendingKey()); }catch{} }
  function setBusy(busy) {state.busy=busy;$('busy').hidden=!busy;$('send').disabled=busy;$('new-chat').disabled=busy;document.querySelectorAll('.chat-item').forEach(el=>el.disabled=busy);}
  function safeRelative(value,fallback) {try{const u=new URL(value,location.origin);return u.origin===location.origin?u.pathname+u.search+u.hash:fallback;}catch{return fallback;}}
  function showLogin(message='',loginUrl='/harness/login') {
    cancelSpeech();state.recognition?.abort();state.recognition=null;clearTimeout(state.poll);state.authEpoch++;state.navEpoch++;
    state.user=null;state.pending=null;state.chat=null;state.chats=[];state.messages=[];state.spoken.clear();setBusy(false);$('messages').replaceChildren();$('chat-list').replaceChildren();
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
  function resizePrompt(){const el=$('prompt');el.style.height='auto';el.style.height=Math.min(el.scrollHeight,180)+'px';}
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
  function renderMessages(){
    const list=$('messages');list.replaceChildren();$('empty-state').hidden=state.messages.length>0;
    state.messages.forEach((msg,index)=>{
      if(!['user','assistant'].includes(msg.role))return;const text=messageText(msg);if(!text)return;
      const article=document.createElement('article');article.className='message '+msg.role;article.dataset.messageId=messageId(msg,index);
      const label=document.createElement('div');label.className='message-label';label.textContent=msg.role==='user'?'Вы':'Octoport';
      const body=document.createElement('div');body.className='message-body';if(msg.role==='user')body.textContent=text;else renderBody(body,text);article.append(label,body);
      if(msg.role==='assistant'){
        const meta=msg.metadata||{};const details=[];if(meta.period_label)details.push(String(meta.period_label));if(meta.source_label)details.push(String(meta.source_label));if(meta.incomplete)details.push('Данные получены частично');
        if(details.length){const hint=document.createElement('p');hint.className='message-meta';hint.textContent=details.join(' · ');article.append(hint);}
        const actions=document.createElement('div');actions.className='message-actions';
        const copy=document.createElement('button');copy.type='button';copy.className='quiet-button';copy.textContent='Копировать';copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(text);copy.textContent='Скопировано';setTimeout(()=>{copy.textContent='Копировать';},1800);}catch{notice('Не удалось скопировать автоматически. Выделите текст ответа и скопируйте его.');}});actions.append(copy);
        if('speechSynthesis' in window){const speak=document.createElement('button');speak.type='button';speak.className='quiet-button';speak.textContent='Озвучить';speak.addEventListener('click',()=>speakText(text,messageId(msg,index),true));actions.append(speak);}
        article.append(actions);
      }
      list.append(article);
    });
  }
  function renderChats(){
    const nav=$('chat-list');nav.replaceChildren();if(!state.chats.length){const p=document.createElement('p');p.className='history-empty';p.textContent='Здесь появятся ваши разговоры';nav.append(p);return;}
    for(const chat of state.chats){const b=document.createElement('button');b.className='chat-item'+(state.chat?.id===chat.id?' active':'');b.textContent=chat.title||'Новый разговор';b.title=b.textContent;b.disabled=state.busy;b.addEventListener('click',()=>openChat(chat.id).catch(handleError));nav.append(b);}
  }
  function handleError(error){if(error.status!==401&&!error.stale)notice(error.message||'Не удалось связаться с сервером.',true);}
  async function refreshChats(){const result=await api('/chats');state.chats=Array.isArray(result.chats)?result.chats:[];renderChats();}
  async function openChat(id){
    const navigation=++state.navEpoch;cancelSpeech();sidebar(false);const result=await api('/chats/'+encodeURIComponent(id));if(navigation!==state.navEpoch)return;state.chat=result.chat||{id};state.messages=Array.isArray(result.messages)?result.messages:[];store.set(chatKey(),state.chat.id);$('chat-title').textContent=state.chat.title||'Новый разговор';renderChats();renderMessages();scrollEnd();
  }
  function freshChat(){if(state.busy)return;state.navEpoch++;cancelSpeech();state.chat=null;state.messages=[];store.set(chatKey(),'');$('chat-title').textContent='Новый разговор';renderChats();renderMessages();notice('');sidebar(false);$('prompt').focus();}
  async function ensureChat(text){if(state.chat)return;const data=await api('/chats',{method:'POST',body:JSON.stringify({title:text.slice(0,80)})});state.chat=data.chat||data;store.set(chatKey(),state.chat.id);$('chat-title').textContent=state.chat.title||text.slice(0,80);await refreshChats();}
  function finishPending(){clearTimeout(state.poll);state.pending=null;persistPending();setBusy(false);}
  async function pollRequest(){
    const pending=state.pending;if(!pending)return;
    try{
      const result=await api('/requests/'+encodeURIComponent(pending.request_id));if(state.pending!==pending)return;
      const status=result.status||result.state;
      if(['completed','succeeded','done'].includes(status)){
        const chatId=pending.chat_id;const navigation=state.navEpoch;finishPending();await refreshChats();if(state.navEpoch!==navigation||state.chat?.id!==chatId){notice('Ответ готов в предыдущем разговоре.');return;}const appliedNavigation=state.navEpoch+1;await openChat(chatId);if(state.navEpoch!==appliedNavigation||state.chat?.id!==chatId)return;
        // History is authoritative. A completed job may also carry a final response.
        const msg=typeof result.message==='string'?{role:'assistant',text:result.message,id:result.message_id||pending.request_id}:result.message;
        if(msg&&messageText(msg)&&!state.messages.some(x=>x.role==='assistant'&&(x.id===msg.id||messageText(x)===messageText(msg)))){state.messages.push({...msg,role:'assistant'});renderMessages();scrollEnd();}
        if(msg&&messageText(msg)&&$('auto-speech').checked)speakText(messageText(msg),messageId(msg,pending.request_id));
        if((!msg||!messageText(msg))&&result.text){const fallback={role:'assistant',text:result.text,id:pending.request_id,metadata:result.metadata};if(!state.messages.some(x=>x.role==='assistant'&&messageText(x)===result.text)){state.messages.push(fallback);renderMessages();scrollEnd();}if($('auto-speech').checked)speakText(result.text,pending.request_id);}
        notice('');return;
      }
      if(['failed','cancelled','canceled','rejected'].includes(status)){const navigation=state.navEpoch;finishPending();const e=typeof result.error==='string'?result.error:result.error?.message||'Не удалось обработать вопрос. Повторного запроса к магазину не было.';notice(e,true);try{if(state.navEpoch===navigation&&state.chat?.id===pending.chat_id)await openChat(pending.chat_id);}catch{}return;}
      if(['unknown','interrupted'].includes(status)){finishPending();notice('Исполнение прервалось, и результат не подтверждён. Этот вопрос не отправляется повторно. Вы можете продолжить разговор новым вопросом.',true);return;}
      const seconds=Math.floor((Date.now()-pending.started)/1000);$('busy-label').textContent=seconds>25?`Получаем данные и готовим ответ · ${seconds} с`:'Подбираем шаблон и получаем данные…';
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
    cancelSpeech();notice('');setBusy(true);
    try{
      await ensureChat(text);if(epoch!==state.authEpoch)return;const requestId=crypto.randomUUID();state.pending={request_id:requestId,chat_id:state.chat.id,started:Date.now()};persistPending();
      const optimistic={id:requestId,role:'user',text,created_at:new Date().toISOString()};state.messages.push(optimistic);renderMessages();scrollEnd();$('prompt').value='';resizePrompt();
      try{const receipt=await api('/chats/'+encodeURIComponent(state.chat.id)+'/messages',{method:'POST',body:JSON.stringify({text,request_id:requestId})});if(receipt.request_id&&receipt.request_id!==requestId){state.pending.request_id=receipt.request_id;persistPending();}}
      catch(error){if(error.stale||epoch!==state.authEpoch)return;if(error.status&&error.status<500&&error.status!==408){finishPending();$('prompt').value=text;resizePrompt();handleError(error);return;}notice('Проверяем, принял ли сервер вопрос. Повторная отправка не выполняется.');}
      await pollRequest();
    }catch(error){if(error.stale||epoch!==state.authEpoch)return;if(!state.pending)setBusy(false);handleError(error);}
  }
  function cancelSpeech(){state.speechEpoch++;if('speechSynthesis' in window)speechSynthesis.cancel();$('stop-speaking').hidden=true;}
  function plainSpeech(text){return String(text).replace(/```[\s\S]*?```/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/https?:\/\/\S+/g,'').replace(/^[|\s:]*[-:]{3,}[-|:\s]*$/gm,'').replace(/[#*`]/g,'').replace(/\|/g,', ').replace(/\n{3,}/g,'\n\n').trim();}
  function speechChunks(text){const out=[];let current='';for(const part of text.split(/(?<=[.!?;\n])\s*/u)){if(current.length+part.length>220&&current){out.push(current.trim());current='';}if(part.length>260){for(let i=0;i<part.length;i+=220)out.push(part.slice(i,i+220));}else current+=part+' ';}if(current.trim())out.push(current.trim());return out.filter(Boolean);}
  function speakText(text,id,explicit=false){
    if(!('speechSynthesis'in window)||(!explicit&&state.spoken.has(id)))return;
    cancelSpeech();const chunks=speechChunks(plainSpeech(text));if(!chunks.length)return;
    state.spoken.add(id);const epoch=state.speechEpoch;const voices=speechSynthesis.getVoices();const voice=voices.find(v=>/^ru(?:-|_)/i.test(v.lang)&&v.localService)||voices.find(v=>/^ru(?:-|_)/i.test(v.lang));
    $('stop-speaking').hidden=false;let index=0;
    const next=()=>{if(epoch!==state.speechEpoch)return;if(index>=chunks.length){$('stop-speaking').hidden=true;return;}const utterance=new SpeechSynthesisUtterance(chunks[index++]);utterance.lang='ru-RU';utterance.rate=1;if(voice)utterance.voice=voice;utterance.onend=next;utterance.onerror=(event)=>{if(epoch!==state.speechEpoch)return;$('stop-speaking').hidden=true;if(!['interrupted','canceled'].includes(event.error))notice('Браузер не смог озвучить ответ. Текст доступен; нажмите «Озвучить», чтобы попробовать ещё раз.');};speechSynthesis.speak(utterance);};next();
  }
  function setupDictation(){
    const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;if(!Recognition)return;
    const button=$('dictate');button.hidden=false;let recognition=null;
    button.addEventListener('click',()=>{if(recognition){recognition.stop();return;}const epoch=state.authEpoch;cancelSpeech();const instance=new Recognition();recognition=instance;state.recognition=instance;instance.lang='ru-RU';instance.interimResults=false;instance.continuous=false;button.classList.add('recording');button.title='Остановить запись';notice('Слушаю вопрос. Перед отправкой его можно проверить и исправить.');instance.onresult=(event)=>{if(epoch!==state.authEpoch)return;const words=Array.from(event.results).map(r=>r[0].transcript).join(' ');$('prompt').value=[$('prompt').value.trim(),words].filter(Boolean).join(' ');resizePrompt();notice('');$('prompt').focus();};instance.onerror=(event)=>{if(epoch!==state.authEpoch)return;notice(event.error==='not-allowed'?'Микрофон недоступен. Разрешите доступ в браузере или напишите вопрос.':'Не удалось распознать речь. Вопрос можно ввести текстом.',true);};instance.onend=()=>{recognition=null;state.recognition=null;button.classList.remove('recording');button.title='Продиктовать вопрос';};try{instance.start();}catch{recognition=null;state.recognition=null;notice('Не удалось включить микрофон.',true);}});
  }
  async function boot(){
    $('auto-speech').checked=store.get('octoport.harness.speech')!=='off';if(!('speechSynthesis'in window)){$('auto-speech').disabled=true;$('auto-speech').checked=false;$('auto-speech').parentElement.title='Озвучивание недоступно в этом браузере';}
    try{
      const info=await api('/me');if(info.authenticated===false){showLogin('',info.login_url);return;}state.user=info.user||{};state.user.id=state.user.id||state.user.customer_id;
      if(!state.user.id)throw new Error('Не удалось определить аккаунт. Войдите повторно.');
      const name=state.user.name||state.user.display_name||state.user.email||'Ваш аккаунт';$('user-name').textContent=name;$('avatar').textContent=name.charAt(0).toUpperCase();
      const stores=Array.isArray(info.stores)?info.stores:[];$('store-count').textContent=`Магазинов: ${stores.length}`;$('connection-label').textContent=stores.length?'Ваши магазины подключены':'Подключите магазин в личном кабинете';
      $('store-badges').replaceChildren();for(const s of stores){const b=document.createElement('span');b.className='store-badge';b.textContent=s.name||s.title||s.marketplace||s.provider;$('store-badges').append(b);}
      if(info.stores_url)$('stores-link').href=safeRelative(info.stores_url,'/app/stores/');
      $('loading').hidden=true;$('login-screen').hidden=true;$('app').hidden=false;
      await refreshChats();let pending;try{pending=JSON.parse(sessionStorage.getItem(pendingKey())||'null');}catch{}
      const last=pending?.chat_id||store.get(chatKey());if(last&&state.chats.some(x=>x.id===last))await openChat(last);
      if(pending?.request_id&&pending?.chat_id){state.pending=pending;state.pending.poll_errors=0;setBusy(true);notice('Проверяем результат ранее отправленного вопроса.');pollRequest();}
      if(!stores.length)notice('Подключите Ozon или Wildberries в разделе «Мои магазины», затем вернитесь в чат.');
      setupDictation();
    }catch(error){if(error.status!==401)showLogin(error.message||'Не удалось открыть аккаунт.');}
  }
  $('composer').addEventListener('submit',send);$('prompt').addEventListener('input',resizePrompt);$('prompt').addEventListener('keydown',(e)=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&window.matchMedia('(min-width: 721px)').matches){e.preventDefault();send();}});
  $('new-chat').addEventListener('click',freshChat);$('menu').addEventListener('click',()=>sidebar(!$('sidebar').classList.contains('open')));$('sidebar-backdrop').addEventListener('click',()=>sidebar(false));
  document.querySelectorAll('[data-prompt]').forEach(button=>button.addEventListener('click',()=>{$('prompt').value=button.dataset.prompt;resizePrompt();$('prompt').focus();}));
  $('auto-speech').addEventListener('change',()=>{store.set('octoport.harness.speech',$('auto-speech').checked?'on':'off');if(!$('auto-speech').checked)cancelSpeech();});$('stop-speaking').addEventListener('click',cancelSpeech);
  $('logout').addEventListener('click',async()=>{cancelSpeech();$('logout').disabled=true;try{await api('/logout',{method:'POST',body:'{}'});clearTimeout(state.poll);state.messages=[];state.chats=[];state.chat=null;$('messages').replaceChildren();$('chat-list').replaceChildren();showLogin('Вы вышли из аккаунта.');}catch(error){handleError(error);}finally{$('logout').disabled=false;}});
  window.addEventListener('pagehide',cancelSpeech);window.addEventListener('online',()=>{if(state.pending&&!state.busy){state.pending.poll_errors=0;setBusy(true);pollRequest();}});
  boot();
})();
