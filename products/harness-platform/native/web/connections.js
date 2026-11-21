window.__ModuleLoader__.load({
  id:'harness-integrations',
  factory(require) {
    const React=require('react'),h=React.createElement;
    const {Switch}=require('@deepseek-ai/dsh-client-ui-primitives');
    return {inject:['slots'],apply(ctx) {
      const a=window.harnessAccount;
      const post=(url,data)=>a.api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
      const status={saved:'Сохранено',verified:'Связь подтверждена',unconfirmed:'Связь не подтверждена',denied:'Доступ отклонён'};
      function KeyGuide({title,steps}) {
        return h('details',{className:'connection-guide'},h('summary',null,title),
          h('ol',null,steps.map(step=>h('li',{key:step},step))));
      }
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
          entry && provider==='wb' && h(KeyGuide,{title:'Как получить токен Wildberries',steps:list.keyGuides['Wildberries API']}),
          entry && provider==='ozon' && ['Ozon Seller','Ozon Performance'].map(kind=>h(KeyGuide,{
            key:kind,title:'Как получить ключи '+kind,steps:list.keyGuides[kind]})),
          entry && h('form',{autoComplete:'off',onSubmit:e=>{e.preventDefault();act(async()=>{
            await post('/api/integrations',{provider,name:name.trim()||entry.title,fields,...(initial.chatId?{chatId:initial.chatId}:{})});
            window.dispatchEvent(new Event('harness:grants'));setFields({});setProvider('');setName('');await refresh();
            const notice=initial.chatId?'Подключение добавлено в этот чат':'Ключи сохранены. Нажмите «Подключения» над полем сообщения и включите магазин.';
            setMsg(notice);after?.(notice);
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
        const [busy,setBusy]=React.useState(false),[free,setFree]=React.useState(false);
        const serial=React.useRef(0),saving=React.useRef(false);
        async function refresh(manual=false){
          if(saving.current)return;
          const id=++serial.current;
          try{
            const next=await a.api('/api/model-settings'+(manual?'?refresh=1':''));
            if(id===serial.current){setData(next);setMsg('');}
          }catch(e){if(id===serial.current)setMsg(e.message);}
        }
        React.useEffect(()=>{
          refresh();const timer=setInterval(()=>{if(!document.hidden)refresh();},60000);
          return ()=>{clearInterval(timer);serial.current++;};
        },[]);
        async function choose(model){
          if(!data || saving.current)return;
          const id=++serial.current;saving.current=true;setBusy(true);
          try{
            const next=await post('/api/model-settings',{model,revision:data.revision});
            if(id===serial.current){setData(next);setMsg('Выбор сохранён');}
          }catch(e){
            if(id===serial.current){setMsg(e.message);try{const next=await a.api('/api/model-settings');if(id===serial.current)setData(next);}catch{}}
          }finally{saving.current=false;setBusy(false);}
        }
        const radio=(id,title,disabled=false)=>h('label',{className:'service-model',key:id},h('input',{type:'radio',name:'model',
          disabled:busy||disabled,checked:data?.inherited?id==='default':data?.model===id,onChange:()=>choose(id)}),title);
        const groups=new Map();
        for(const m of [...(data?.models||[])].sort((a,b)=>a.family.localeCompare(b.family)||a.name.localeCompare(b.name))){
          if(free&&!m.free || !(m.id+' '+m.name+' '+m.family).toLowerCase().includes(filter.toLowerCase()))continue;
          if(!groups.has(m.family))groups.set(m.family,[]);groups.get(m.family).push(m);
        }
        return h('section',{className:'service-settings'},h('h2',null,'Выбор ИИ'),
          data && radio('default','Общая модель Octoport'+(data.inherited?' · '+(data.model==='direct'?'DeepSeek':data.model):'')),
          data && radio('direct','DeepSeek · прямое подключение'),
          h('label',null,'Поиск модели или производителя',h('input',{type:'search',value:filter,onChange:e=>setFilter(e.target.value)})),
          h('button',{type:'button',disabled:busy,onClick:()=>refresh(true)},'Обновить список'),
          h('label',null,h('input',{type:'checkbox',checked:free,onChange:e=>setFree(e.target.checked)}),' Только бесплатные'),
          data?.catalogAt&&h('small',null,'Каталог обновлён '+new Date(data.catalogAt*1000).toLocaleString('ru-RU')),
          data?.choiceMessage && h('p',{role:'status'},data.choiceMessage),
          data?.confirmTariff && h('button',{type:'button',disabled:busy,onClick:()=>choose(data.model)},'Выбрать платный тариф'),
          data?.catalogMessage && h('p',{role:'status'},data.catalogMessage),
          !data&&!msg && h('p',{role:'status'},'Загрузка каталога…'),
          data&&!groups.size && h('p',{role:'status'},'Подходящих моделей нет.'),
          [...groups].map(([family,models])=>h('details',{key:family,open:filter?true:undefined},
            h('summary',null,family+' ('+models.length+')'),models.map(m=>radio(m.id,m.name+
              (m.free?' · Бесплатно':'')+(!m.chat?(m.image?' · Для иллюстраций':' · Для других задач'):''),!m.chat)))),
          h('p',{role:'status'},msg));
      }
      function PrivateDialog() {
        const [request,setRequest]=React.useState(null),ref=React.useRef(null);
        React.useEffect(()=>{const open=e=>setRequest({...e.detail,key:crypto.randomUUID()});
          window.addEventListener('harness:connection',open);return()=>window.removeEventListener('harness:connection',open);},[]);
        React.useEffect(()=>{if(request&&!ref.current.open)ref.current.showModal();},[request]);
        if(!request)return null;
        return h('dialog',{ref,className:'account-dialog','data-private-connection':true,'aria-label':'Подключение сервиса',onCancel:()=>setRequest(null)},
          (request.provider||request.newConnection)&&!a.guest?h(Connections,{key:request.key,initial:request,after:notice=>setRequest({notice})}):h('p',{role:'status'},request.notice),
          h('button',{type:'button',onClick:()=>setRequest(null)},'Закрыть'));
      }
      ctx.slots.inject('shell.overlay',()=>ctx.slots.register({name:'shell.overlay',id:'private-connection'},PrivateDialog));
      if(a.guest)return;
      const names={ozon:'Ozon',wb:'Wildberries',wordstat:'Яндекс Вордстат'};
      function ChatDock({sessionId}){
        const [rows,setRows]=React.useState(null),[open,setOpen]=React.useState(false);
        const [error,setError]=React.useState(''),[busy,setBusy]=React.useState(false);
        const dialog=React.useRef(null);
        const url='/api/chats/'+encodeURIComponent(sessionId)+'/integrations';
        const view=React.useSyncExternalStore(React.useCallback(listener=>a.live.subscribe(sessionId,listener),[sessionId]),
          ()=>a.live.views.get(sessionId)||null);
        React.useEffect(()=>{
          const controller=new AbortController();
          const refresh=()=>a.api(url,{signal:controller.signal}).then(v=>{if(!controller.signal.aborted)setRows(v.connections);})
            .catch(e=>{if(!controller.signal.aborted)setError(e.message);});
          setRows(null);setError('');setOpen(false);refresh();
          window.addEventListener('harness:grants',refresh);
          return ()=>{controller.abort();window.removeEventListener('harness:grants',refresh);};
        },[url]);
        React.useEffect(()=>{if(open && !dialog.current.open)dialog.current.showModal();},[open]);
        const saved=React.useSyncExternalStore(React.useCallback(listener=>{
          const update=e=>{if(e.detail===sessionId)listener();};
          a.activityEvents.addEventListener('saved-images',update);
          return ()=>a.activityEvents.removeEventListener('saved-images',update);
        },[sessionId]),()=>a.savedIllustrations.get(sessionId));
        const active=(rows||[]).filter(row=>row.attached);
        const labels={sending:'Отправляю сообщение…',accepted:'Сообщение принято',model:'Модель готовит ответ',
          thinking:'Модель обдумывает ответ',tool:'Модель запрашивает данные',model_wait:'Модель временно занята. Повторим запрос автоматически',marketplace_wait:'Ждём следующей разрешённой попытки',writing:'Модель отвечает…',failed:'Не удалось завершить запрос'};
        async function toggle(row,enabled){
          const before=rows;
          setBusy(true);setError('');
          setRows(before.map(item=>item.id===row.id?{...item,attached:!item.attached}:item));
          try {
            setRows((await post(url,{connectionId:row.id,enabled})).connections);
            window.dispatchEvent(new Event('harness:grants'));
          }
          catch(e){setRows(before);setError(e.message);}finally{setBusy(false);}
        }
        return h('div',{className:'chat-access'},
          saved?.length>0 && h('section',{'aria-label':'Готовые иллюстрации'},
            h('p',null,'Готовые иллюстрации этого чата'),
            saved.map((url,i)=>h('a',{href:url,key:url,target:'_blank',rel:'noopener'},'Открыть иллюстрацию '+(i+1)))),
          view && h('div',{'data-live-turn':view.stage,className:'chat-live'},
            h('small',{role:'status'},labels[view.stage], ['model','thinking','tool','marketplace_wait','model_wait'].includes(view.stage) &&
              h('span',{className:'thinking-dots','aria-hidden':true},[0,1,2].map(i=>h('span',{key:i},'.')))),view.text && h('div',{className:'chat-live-text'},view.text),
            view.stage==='model_wait' && h('button',{type:'button',onClick:()=>post('/api/chats/'+encodeURIComponent(sessionId)+'/progress/'+encodeURIComponent(view.rid)+'/cancel',{}).catch(e=>setError(e.message))},'Отменить ожидание'),
            view.stage==='failed' && h('button',{onClick:()=>a.live.clear(sessionId,view.rid)},'Закрыть')),
          h('button',{className:'chat-access-trigger','aria-haspopup':'dialog',onClick:()=>setOpen(true)},
            'Подключения'+(active.length?' · '+active.map(r=>r.name).join(', '):'')),
          open && h('dialog',{ref:dialog,className:'account-dialog chat-grants','aria-label':'Подключения этого чата',onCancel:()=>setOpen(false)},
            h('header',null,h('h2',null,'Подключения этого чата'),
              h('button',{type:'button','aria-label':'Закрыть',onClick:()=>setOpen(false)},'×')),
            !error && (rows===null ? h('p',{role:'status'},'Загружаем подключения…') :
              h('p',null,rows.length ? 'Включите переключатель рядом с нужным магазином. Изменения действуют в этом чате.' :
                'Нажмите «Добавить подключение» и выберите Ozon или Wildberries. В форме есть пошаговая инструкция по получению ключей.')),
            // Reuse the pinned General Settings row and its native animated Switch.
            (rows||[]).map(row=>h('div',{key:row.id,className:'Pt1bsG_row'},
              h('div',null,h('div',{className:'Pt1bsG_title'},row.name),
                h('div',{className:'Pt1bsG_description'},
                  (row.access.length?row.access.join(', '):names[row.provider])+' · '+(status[row.status]||row.status))),
              h(Switch,{label:row.name+' · '+names[row.provider],checked:row.attached,disabled:busy,onChange:enabled=>toggle(row,enabled)}))),
            error && h('p',{role:'alert'},error),
            h('button',{onClick:()=>{setOpen(false);window.dispatchEvent(new CustomEvent('harness:connection',{
              detail:{newConnection:true,chatId:sessionId}}));}},'Добавить подключение')));
      }
      ctx.slots.inject('conversation.input.dock',()=>ctx.slots.register({
        name:'conversation.input.dock',id:'harness-chat-connections',inject:sessionId=>({sessionId})
      },ChatDock));
      const section=(id,title,order,component)=>ctx.slots.inject('settings.section',()=>ctx.slots.register({
        name:'settings.section',id,order,label:()=>title},component));
      section('integrations','Интеграции',5,Connections);
      if(a.modelChoice)section('model-choice','Выбор ИИ',6,Models);
    }};
  }
});
