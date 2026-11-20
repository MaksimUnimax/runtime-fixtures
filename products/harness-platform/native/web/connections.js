window.__ModuleLoader__.load({
  id:'harness-integrations',
  factory(require) {
    const React=require('react'),h=React.createElement;
    return {inject:['slots'],apply(ctx) {
      const a=window.harnessAccount;
      const post=(url,data)=>a.api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
      const status={saved:'Сохранено',verified:'Связь подтверждена',unconfirmed:'Связь не подтверждена',denied:'Доступ отклонён'};
      function Connections({initial={},after}) {
        const [list,setList]=React.useState(null),[provider,setProvider]=React.useState(initial.provider||'');
        const [fields,setFields]=React.useState(initial.fields||{}),[name,setName]=React.useState(initial.name||'');
        const [msg,setMsg]=React.useState(initial.notice||''),[busy,setBusy]=React.useState(false);
        const [target,setTarget]=React.useState(''),[phrase,setPhrase]=React.useState(''),[rows,setRows]=React.useState([]);
        const refresh=()=>a.api('/api/integrations').then(setList);
        React.useEffect(()=>{refresh().catch(e=>setMsg(e.message));},[]);
        async function act(fn){
          setBusy(true);setMsg('');
          try {await fn();}catch(e){setMsg(e.message);}finally{setBusy(false);}
        }
        const entry=list?.providers[provider];
        const select=value=>{setProvider(value);setFields({});setName('');setMsg('');};
        return h('section',{'data-private-connection':true,className:'service-settings'},
          h('h2',null,'Интеграции'),
          list?.connections.map(c=>h('div',{key:c.id,className:'service-connection'},
            h('div',null,h('strong',null,c.name),h('small',null,list.providers[c.provider].title+' · '+status[c.status])),
            h('button',{disabled:busy,onClick:()=>act(async()=>{
              const r=await post('/api/integrations/'+c.id+'/check',{});await refresh();
              setMsg(Object.entries(r.checks).map(([k,v])=>k+' · '+status[v]).join(' / '));
            })},'Проверить'),
            c.provider==='wordstat' && h('button',{onClick:()=>{setTarget(c.id);setRows([]);}},'Собрать семантику'))),
          target && h('form',{onSubmit:e=>{e.preventDefault();act(async()=>setRows((await post('/api/integrations/'+target+'/semantics',{phrase})).rows));}},
            h('label',null,'Поисковая фраза',h('input',{required:true,value:phrase,onChange:e=>setPhrase(e.target.value)})),
            h('button',{disabled:busy},'Получить запросы'),rows.length>0 && h('ul',null,rows.map(r=>h('li',{key:r.phrase},r.phrase+' · '+r.count)))),
          list && h('label',null,'Сервис',h('select',{'aria-label':'Сервис',value:provider,onChange:e=>select(e.target.value)},
            h('option',{value:''},'Выберите сервис'),Object.entries(list.providers).map(([id,p])=>h('option',{key:id,value:id},p.title)))),
          entry && h('form',{autoComplete:'off',onSubmit:e=>{e.preventDefault();act(async()=>{
            await post('/api/integrations',{provider,name:name.trim()||entry.title,fields,...(initial.chatId?{chatId:initial.chatId}:{})});
            window.dispatchEvent(new Event('harness:grants'));setFields({});setProvider('');setName('');await refresh();setMsg('Ключи сохранены');after?.();
          });}},
            h('label',null,'Название подключения',h('input',{maxLength:80,value:name,placeholder:entry.title,onChange:e=>setName(e.target.value)})),
            provider==='ozon' && h('small',null,'Введите пару ключей Seller или Performance. Можно подключить оба API.'),
            Object.entries(entry.fields).map(([k,label])=>h('label',{key:k},label,h('input',{
              type:'password',required:provider!=='ozon',autoComplete:'off',spellCheck:false,maxLength:8192,value:fields[k]||'',
              onChange:e=>setFields(old=>{const n={...old};if(e.target.value)n[k]=e.target.value;else delete n[k];return n;})}))),
            h('button',{disabled:busy},'Сохранить подключение')),
          h('p',{role:'status'},msg));
      }
      function Models() {
        const [data,setData]=React.useState(null),[filter,setFilter]=React.useState(''),[msg,setMsg]=React.useState('');
        const [busy,setBusy]=React.useState(false);
        React.useEffect(()=>{a.api('/api/model-settings').then(setData).catch(e=>setMsg(e.message));},[]);
        const choose=async model=>{setBusy(true);try{
          setData(await post('/api/model-settings',{model}));setMsg('Выбор сохранён');
        } catch(e){setMsg(e.message);}finally{setBusy(false);}};
        const radio=(id,title)=>h('label',{className:'service-model',key:id},h('input',{type:'radio',name:'model',disabled:busy,
            checked:data?.model===id,onChange:()=>choose(id)}),title);
        const groups=new Map();
        for(const m of [...(data?.models||[])].sort((a,b)=>a.id.localeCompare(b.id))){
          if(!(m.id+' '+m.name).toLowerCase().includes(filter.toLowerCase()))continue;
          if(!groups.has(m.family))groups.set(m.family,[]);groups.get(m.family).push(m);
        }
        return h('section',{className:'service-settings'},h('h2',null,'Выбор ИИ'),radio('direct','DeepSeek · прямое подключение'),
          h('label',null,'Поиск модели',h('input',{type:'search',value:filter,onChange:e=>setFilter(e.target.value)})),
          data&&!data.models.length && h('p',null,'Каталог OpenRouter временно недоступен'),
          [...groups].map(([family,models])=>h('details',{key:family,open:filter?true:undefined},
            h('summary',null,family+' ('+models.length+')'),models.map(m=>radio(m.id,m.name)))),
          h('p',{role:'status'},msg));
      }
      function PrivateDialog() {
        const [request,setRequest]=React.useState(null),ref=React.useRef(null);
        React.useEffect(()=>{const open=e=>setRequest({...e.detail,key:crypto.randomUUID()});
          window.addEventListener('harness:connection',open);return()=>window.removeEventListener('harness:connection',open);},[]);
        React.useEffect(()=>{if(request&&!ref.current.open)ref.current.showModal();},[request]);
        if(!request)return null;
        return h('dialog',{ref,className:'account-dialog','data-private-connection':true,'aria-label':'Подключение сервиса',onCancel:()=>setRequest(null)},
          (request.provider||request.newConnection)&&!a.guest?h(Connections,{key:request.key,initial:request,after:()=>setRequest({notice:request.chatId?'Подключение добавлено в этот чат':'Ключи сохранены'})}):h('p',{role:'status'},request.notice),
          h('button',{type:'button',onClick:()=>setRequest(null)},'Закрыть'));
      }
      ctx.slots.inject('shell.overlay',()=>ctx.slots.register({name:'shell.overlay',id:'private-connection'},PrivateDialog));
      if(a.guest)return;
      const names={ozon:'Ozon',wb:'Wildberries',wordstat:'Яндекс Вордстат'};
      function ChatDock({sessionId}){
        const [rows,setRows]=React.useState([]),[open,setOpen]=React.useState(false);
        const [error,setError]=React.useState(''),[busy,setBusy]=React.useState(false);
        const dialog=React.useRef(null);
        const url='/api/chats/'+encodeURIComponent(sessionId)+'/integrations';
        const view=React.useSyncExternalStore(React.useCallback(listener=>a.live.subscribe(sessionId,listener),[sessionId]),
          ()=>a.live.views.get(sessionId)||null);
        React.useEffect(()=>{
          const controller=new AbortController();
          const refresh=()=>a.api(url,{signal:controller.signal}).then(v=>{if(!controller.signal.aborted)setRows(v.connections);})
            .catch(e=>{if(!controller.signal.aborted)setError(e.message);});
          setRows([]);setError('');setOpen(false);refresh();
          window.addEventListener('harness:grants',refresh);
          return ()=>{controller.abort();window.removeEventListener('harness:grants',refresh);};
        },[url]);
        React.useEffect(()=>{if(open && !dialog.current.open)dialog.current.showModal();},[open]);
        const active=rows.filter(row=>row.attached);
        const labels={sending:'Отправляю сообщение…',accepted:'Сообщение принято',model:'Модель готовит ответ…',
          thinking:'Модель обдумывает ответ…',tool:'Модель запрашивает данные…',writing:'Модель отвечает…',failed:'Не удалось завершить запрос'};
        async function toggle(row){
          const before=rows;
          setBusy(true);setError('');
          setRows(before.map(item=>item.id===row.id?{...item,attached:!item.attached}:item));
          try {setRows((await post(url,{connectionId:row.id,enabled:!row.attached})).connections);}
          catch(e){setRows(before);setError(e.message);}finally{setBusy(false);}
        }
        return h('div',{className:'chat-access'},
          view && h('div',{'data-live-turn':view.stage,className:'chat-live'},
            h('small',{role:'status'},labels[view.stage]),view.text && h('div',{className:'chat-live-text'},view.text),
            view.stage==='failed' && h('button',{onClick:()=>a.live.clear(sessionId,view.rid)},'Закрыть')),
          h('button',{className:'chat-access-trigger','aria-haspopup':'dialog',onClick:()=>setOpen(true)},
            'Подключения'+(active.length?' · '+active.map(r=>r.name).join(', '):'')),
          open && h('dialog',{ref:dialog,className:'account-dialog chat-grants','aria-label':'Подключения этого чата',onCancel:()=>setOpen(false)},
            h('header',null,h('h2',null,'Подключения этого чата'),
              h('button',{type:'button','aria-label':'Закрыть',onClick:()=>setOpen(false)},'×')),
            rows.length===0 && !error && h('p',null,'Подключите магазин или сервис, чтобы использовать его в разговоре.'),
            rows.map(row=>h('label',{key:row.id,className:'chat-grant'},
              h('input',{type:'checkbox',checked:row.attached,disabled:busy,onChange:()=>toggle(row)}),
              h('span',null,h('strong',null,row.name),h('small',null,
                (row.access.length?row.access.join(', '):names[row.provider])+' · '+(status[row.status]||row.status))))),
            h('p',{role:'status'},error),
            h('button',{onClick:()=>{setOpen(false);window.dispatchEvent(new CustomEvent('harness:connection',{
              detail:{newConnection:true,chatId:sessionId}}));}},'Добавить подключение')));
      }
      ctx.slots.inject('conversation.input.dock',()=>ctx.slots.register({
        name:'conversation.input.dock',id:'harness-chat-connections',inject:sessionId=>({sessionId})
      },ChatDock));
      const section=(id,title,order,component)=>ctx.slots.inject('settings.section',()=>ctx.slots.register({
        name:'settings.section',id,order,label:()=>title},component));
      section('integrations','Интеграции',5,Connections);
      if(a.wallet?.modelChoice)section('model-choice','Выбор ИИ',6,Models);
    }};
  }
});
