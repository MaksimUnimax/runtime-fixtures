(() => {
  const chat = document.querySelector('[data-guest-chat]');
  const transcript = chat.querySelector('.guest-transcript');
  const history = chat.querySelector('[role=log]'), older = chat.querySelector('.guest-older');
  const form = chat.querySelector('form'), input = form.querySelector('textarea');
  const button = form.querySelector('button'), status = chat.querySelector('[role=status]');
  let id, cursor, pending, loading, busy=false, revision=0;
  let previousConversation=[];
  function turn(row) {
    const pair=document.createElement('div');
    for (const [author,text] of [['Вы',row.text],['Октопус',row.answer]]) {
      const section=document.createElement('div'), label=document.createElement('strong'), content=document.createElement('p');
      section.className=author==='Вы'?'guest-question':'guest-answer';
      label.textContent=author;
      if (author==='Октопус') {
        const icon=document.createElement('span');
        icon.className='guest-mark';
        icon.setAttribute('aria-hidden','true');
        label.prepend(icon);
      }
      content.textContent=text;
      section.append(label,content);pair.append(section);
    }
    return pair;
  }
  async function requestChat(endpoint, options) {
    if (!id) id=await window.octoGuestSession();
    const request=chatId=>fetch('/guest/chats/'+encodeURIComponent(chatId)+endpoint, options);
    const original=id;
    const response=await request(original);
    if (response.status!==401 && response.status!==404) return response;
    id=await window.octoGuestSession();
    return id===original ? response : request(id);
  }
  async function page(previous=false) {
    const version=revision;
    const r=await requestChat('/events'+(previous?'?before='+cursor:''),{cache:'no-store'});
    if(!r.ok) throw Error('Не удалось загрузить переписку.');
    const data=await r.json();
    if(version!==revision)return;
    const path=location.pathname;
    const guestPath='/app/chats/'+encodeURIComponent(id);
    const guestDeepLink=path.startsWith('/app/chats/') && document.documentElement.dataset.session!=='member';
    if (path!==guestPath && (path==='/' || path==='/app/' || guestDeepLink)) {
      window.history.replaceState(window.history.state,'',guestPath);
    }
    const rows=data.turns.map(turn);
    const previousHeight=transcript.scrollHeight;
    const previousTop=transcript.scrollTop;
    if (previous) history.prepend(...rows);
    else history.replaceChildren(...previousConversation,...rows);
    cursor=data.nextBefore;older.hidden=cursor==null;
    const hasTurns=history.childElementCount>0;
    transcript.hidden=!hasTurns;
    chat.classList.toggle('has-turns',hasTurns);
    transcript.scrollTop=previous ? previousTop+transcript.scrollHeight-previousHeight : transcript.scrollHeight;
  }
  function initialize() {
    revision++;id=null;cursor=null;pending=null;status.textContent='';
    loading=page().catch(error=>{status.textContent=error.message;});
  }
  older.onclick=async()=>{
    older.disabled=true;
    try {await page(true);} catch(e){status.textContent=e.message;}
    finally {older.disabled=false;}
  };
  function updateSendButton() {
    button.disabled=busy || !input.value.trim();
  }
  input.addEventListener('input',updateSendButton);
  form.onsubmit=async event=>{
    event.preventDefault();
    const text=input.value.trim();
    if(!text || busy)return;
    busy=true;updateSendButton();input.readOnly=true;status.textContent='Октопус отвечает…';
    try {
      await loading;
      if(!pending || pending.text!==text)pending={text,request_id:crypto.randomUUID()};
      const r=await requestChat('/turns',{
        method:'POST',headers:{Accept:'application/json'},body:new URLSearchParams(pending)});
      if(!r.ok) {
        if(r.status===401)id=null;
        throw Error(r.status===400?'Проверьте текст вопроса. Ключи магазина вводятся в настройках подключения.':'Не удалось отправить вопрос. Повторите попытку.');
      }
      await page();
      pending=null;input.value='';status.textContent='';
    } catch(e){status.textContent=e.message;}
    finally {busy=false;updateSendButton();input.readOnly=false;input.focus({preventScroll:true});}
  };
  input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();form.requestSubmit();}});
  document.addEventListener('octo-authenticated',event=>{
    if(event.detail?.registered){previousConversation=Array.from(history.children);initialize();}
  });
  updateSendButton();
  initialize();
})();
