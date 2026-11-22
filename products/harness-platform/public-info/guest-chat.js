(() => {
  const chat = document.querySelector('[data-guest-chat]');
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
      content.textContent=text;
      section.append(label,content);pair.append(section);
    }
    return pair;
  }
  async function page(previous=false) {
    const version=revision;
    if(!id) id=await window.octoGuestSession();
    const r=await fetch('/guest/chats/'+encodeURIComponent(id)+'/events'+(previous?'?before='+cursor:''),{cache:'no-store'});
    if(!r.ok) throw Error('Не удалось загрузить переписку.');
    const data=await r.json();
    if(version!==revision)return;
    if (['/','/app/'].includes(location.pathname)) window.history.replaceState(window.history.state,'','/app/chats/'+encodeURIComponent(id));
    const rows=data.turns.map(turn);
    if(previous) history.prepend(...rows); else history.replaceChildren(...previousConversation,...rows);
    cursor=data.nextBefore;older.hidden=cursor==null;
    chat.classList.toggle('has-turns',history.childElementCount>0);
    if(!previous && rows.length) history.lastElementChild.scrollIntoView({block:'nearest'});
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
  form.onsubmit=async event=>{
    event.preventDefault();
    const text=input.value.trim();
    if(!text || busy)return;
    busy=true;button.disabled=true;input.readOnly=true;status.textContent='Октопус отвечает…';
    try {
      await loading;
      if(!id)id=await window.octoGuestSession();
      if(!pending || pending.text!==text)pending={text,request_id:crypto.randomUUID()};
      const r=await fetch('/guest/chats/'+encodeURIComponent(id)+'/turns',{
        method:'POST',headers:{Accept:'application/json'},body:new URLSearchParams(pending)});
      if(!r.ok) {
        if(r.status===401)id=null;
        throw Error(r.status===400?'Проверьте текст вопроса. Ключи магазина вводятся в настройках подключения.':'Не удалось отправить вопрос. Повторите попытку.');
      }
      await page();
      pending=null;input.value='';status.textContent='';
    } catch(e){status.textContent=e.message;}
    finally {busy=false;button.disabled=false;input.readOnly=false;input.focus({preventScroll:true});}
  };
  input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();form.requestSubmit();}});
  document.addEventListener('octo-authenticated',event=>{
    if(event.detail?.registered){previousConversation=Array.from(history.children);initialize();}
  });
  initialize();
})();
