// The catalogue installs plugins in the account. Sidebar actions target the selected chat.
(() => {
  const components = new WeakMap();
  window.octoPluginMenu = (React,ctx,api,ui) => {
    if (components.has(ctx)) return components.get(ctx);
    const h=React.createElement;
    const send=(path,data)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const catalogLabel='Плагины';
    const {Menu:Popup,Modal,Button,IconEllipsisOutlineRegular,IconDataOutlineMedium,IconPersonalizationOutlineMedium,IconChevronRightOutlineRegular}=ui;
    function Dialog({label,close,children,className=''}) {
      return h(Modal,{open:true,title:label,closeLabel:'Закрыть',onClose:close,
        className:('octo-plugin-panel '+className).trim()},
        h('div',{className:'octo-plugin-content'},children));
    }
    function Fold({label,initial=false,children}) {
      const [expanded,setExpanded]=React.useState(initial);
      const region=React.useId();
      return h('div',{className:'octo-plugin-fold'},
        h('button',{type:'button',className:'octo-plugin-fold-trigger','aria-expanded':expanded,'aria-controls':region,
          onClick:()=>setExpanded(open=>!open)},label,h(IconChevronRightOutlineRegular,{size:16})),
        h('div',{id:region,hidden:!expanded,className:'octo-plugin-fold-body'},children));
    }
    function Action(props) {
      return h(Button,{type:'button',variant:'outline',...props});
    }
    function initialPeriod() {
      const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow'}).format(new Date());
      const end=new Date(today+'T00:00:00Z');
      end.setUTCDate(end.getUTCDate()-1);
      const start=new Date(end);
      start.setUTCDate(start.getUTCDate()-364);
      return [start.toISOString().slice(0,10),end.toISOString().slice(0,10)];
    }
    function Coefficient({id,metric,entry,job,onSave,onCalculate,busy,title:providerTitle}) {
      const [value,setValue]=React.useState(entry?.value??'');
      React.useEffect(()=>setValue(entry?.value??''),[entry?.revision]);
      const title=metric.title+' ('+metric.unit+')';
      return h('section',{className:'plugin-metric'},
        h('h3',null,metric.title),
        h('p',null,entry ? (entry.source==='manual'?'Вручную':'По отчётам '+providerTitle)+
          (entry.since?' · '+entry.since+' — '+entry.until:'')+' · '+new Date(entry.updated).toLocaleDateString('ru-RU') : 'Значение ещё не задано'),
        h('label',null,title,h('input',{value,inputMode:'decimal',placeholder:'Введите число',onChange:e=>setValue(e.target.value)})),
        h('div',{className:'plugin-buttons'},
          h(Action,{disabled:busy||value.trim()===''||value===entry?.value,onClick:()=>onSave(id,value,entry?.revision??null)},'Сохранить'),
          h(Action,{disabled:busy||job?.state==='running',onClick:()=>onCalculate(id,entry?.revision??null)},'Рассчитать')),
        job&&job.state!=='done'&&h('p',{role:job.state==='failed'?'alert':'status'},job.message));
    }
    function Marketplace({url,close,title,provider}) {
      const [cid,setCid]=React.useState(''),[sku,setSku]=React.useState(''),[data,setData]=React.useState(null);
      const [error,setError]=React.useState(''),[busy,setBusy]=React.useState(false),[tick,refresh]=React.useReducer(n=>n+1,0);
      const [period,setPeriod]=React.useState(initialPeriod),[models,setModels]=React.useState(null);
      const [search,setSearch]=React.useState(''),[limit,setLimit]=React.useState(100);
      const [office,setOffice]=React.useState(''),[scheme,setScheme]=React.useState('FBS');
      const [modelDraft,setModelDraft]=React.useState(null);
      const model=modelDraft?.model??data?.model??'',effort=modelDraft?.effort??data?.effort??'';
      const path=url+'?'+new URLSearchParams({cid,sku});
      const active=React.useRef(''),catalog=React.useRef({});
      active.current=path;
      React.useEffect(()=>{
        const controller=new AbortController();
        const cached=catalog.current[cid];
        api(path+(cached?.stamp?'&catalogAt='+encodeURIComponent(cached.stamp):''),{signal:controller.signal}).then(next=>{
          if(controller.signal.aborted)return;
          if(cid){if(next.products)catalog.current[cid]={stamp:next.catalogAt,products:next.products};else next.products=cached?.products||[];}
          setData(next);setError('');
          if(!cid && next.stores.some(s=>s.selected))setCid(next.stores.find(s=>s.selected).id);
        }).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
        return ()=>controller.abort();
      },[path,tick]);
      const pending=data?.jobs?.some(j=>j.state==='running');
      React.useEffect(()=>{if(!pending)return;const timer=setTimeout(refresh,1500);return()=>clearTimeout(timer);},[pending,tick,data]);
      async function act(fn,reload=true) {
        setBusy(true);setError('');
        try{await fn();if(reload&&active.current===path)refresh();}
        catch(e){if(active.current===path)setError(e.message);}
        finally{setBusy(false);}
      }
      const changeStore=id=>{if(cid===id){refresh();return;}setData(null);setSku('');setSearch('');setLimit(100);setCid(id);setError('');};
      const choose=(row)=>act(async()=>{
        await send(url+'/store',{cid:row.id});
        window.dispatchEvent(new Event('harness:grants'));changeStore(row.id);refresh();
      });
      const modelChange=key=>{
        setModelDraft({model:key,effort:models?.find(m=>m.id===key)?.defaultEffort??''});
      };
      const modelChoices=models?.find(m=>m.id===model)?.efforts??[];
      const job=metric=>data?.jobs?.find(j=>j.metric===metric);
      const current=data?.stores.find(s=>s.id===cid&&s.selected);
      const catalogJob=job('cards');
      const productRows=React.useMemo(()=>{
        const needle=search.trim().toLocaleLowerCase('ru');
        return (data?.products||[]).filter(p=>!needle||[p.sku,p.offer,p.title].some(v=>v.toLocaleLowerCase('ru').includes(needle)));
      },[data?.products,search]);
      const shown=productRows.slice(0,limit);
      const selectedProduct=data?.products?.find(p=>p.sku===sku);
      if(selectedProduct&&!shown.includes(selectedProduct))shown.unshift(selectedProduct);
      React.useEffect(()=>{
        if(!cid||!current?.selected||data.catalogAt||catalogJob)return;
        let alive=true;
        send(url+'/refresh',{cid}).then(()=>{if(alive)refresh();}).catch(e=>{if(alive)setError(e.message);});
        return()=>{alive=false;};
      },[cid,current?.selected,data?.catalogAt,catalogJob?.id]);
      return h(Dialog,{label:title,close,className:'octo-plugin-settings'},error&&h('p',{role:'alert'},error),
        !data ? h('p',{role:'status'},'Загружаем настройки…') : h(React.Fragment,null,
          h('h3',null,'Магазины'),data.stores.length===0&&h(Action,{onClick:()=>{
            close();
            ctx.slots.entries('sidebar.settings')[0]?.store.create().actions.openSection('integrations');
          }},'Добавить магазин'),
          h('div',{className:'plugin-stores'},data.stores.map(s=>h(Action,{key:s.id,disabled:busy,'aria-pressed':cid===s.id,
            onClick:()=>s.selected?changeStore(s.id):choose(s)},s.selected?s.name:'Дать доступ к данным · '+s.name))),
          current&&h(React.Fragment,null,h('div',{className:'plugin-controls'},
            h('label',null,'Найти товар',h('input',{type:'search',placeholder:'Название или артикул',value:search,onChange:e=>{setSearch(e.target.value);setLimit(100);}})),
            h('label',null,'Область расчёта',h('select',{'aria-label':'Область расчёта',value:sku,disabled:busy,onChange:e=>{setSku(e.target.value);setData(null);}},
              h('option',{value:''},'Весь магазин'),shown.map(p=>h('option',{key:p.sku,value:p.sku},
                [p.title,p.offer,(provider==='ozon'?'SKU ':'WB ')+p.sku].filter(Boolean).join(' · '))))),
            productRows.length>limit&&h(Action,{onClick:()=>setLimit(n=>n+100)},'Показать ещё товары'),
            h(Action,{disabled:busy||catalogJob?.state==='running',onClick:()=>act(()=>send(url+'/refresh',{cid}))},'Обновить товары'),
            h(Action,{disabled:busy,onClick:()=>act(async()=>{await send(url+'/disconnect',{cid});window.dispatchEvent(new Event('harness:grants'));changeStore('');})},'Отозвать доступ к данным магазина')),
            catalogJob?.state!=='done'&&catalogJob&&h('p',{role:'status'},catalogJob.message),
            provider==='wb'&&h(Fold,{label:'Схемы складов'},h('p',null,'Если в финансовом отчёте WB не указана схема доставки, её можно задать для этого склада.'),
              Object.entries(data.schemes||{}).map(([name,value])=>h('div',{key:name,className:'plugin-row'},h('span',null,name+' · '+value),
                h(Action,{disabled:busy,onClick:()=>act(()=>send(url+'/scheme',{cid,office:name,scheme:''}))},'Удалить'))),
              h('div',{className:'plugin-controls'},h('label',null,'Название склада WB',h('input',{value:office,onChange:e=>setOffice(e.target.value)})),
                h('label',null,'Схема',h('select',{'aria-label':'Схема',value:scheme,onChange:e=>setScheme(e.target.value)},['FBS','FBW'].map(v=>h('option',{key:v},v)))),
                h(Action,{disabled:busy||!office.trim(),onClick:()=>act(async()=>{await send(url+'/scheme',{cid,office,scheme});setOffice('');})},'Сохранить схему'))),
            h('fieldset',{className:'plugin-period'},h('legend',null,'Период автоматического расчёта'),
              ['С','По'].map((label,i)=>h('label',{key:label},label,h('input',{type:'date',value:period[i],onChange:e=>{
                const next=period.slice();next[i]=e.target.value;setPeriod(next);
              }}))),h(Action,{onClick:()=>setPeriod(initialPeriod())},'За год')),
            h('div',{className:'plugin-grid'},Object.entries(data.metrics).map(([id,metric])=>h(Coefficient,{key:cid+sku+id,
              id,metric,title,entry:data.values?.[id],job:job(id),busy,
              onSave:(metric,value,revision)=>act(()=>send(url+'/save',{cid,sku,metric,value,revision})),
              onCalculate:(metric,revision)=>act(()=>send(url+'/calculate',{cid,sku,metric,revision,since:period[0],until:period[1],requestId:crypto.randomUUID().replaceAll('-','')}))})))),
          h(Fold,{label:'Модель для расчётов'},
            h('p',null,data.model?data.model+' · '+data.effort:'Используется общая модель Octoport.'),
            h(Action,{disabled:busy,onClick:()=>act(async()=>setModels((await api(url+'?models=1')).models),false)},'Запросить модели'),
            models&&h('div',{className:'plugin-controls'},
              h('label',null,'Модель',h('select',{'aria-label':'Модель',value:model,onChange:e=>modelChange(e.target.value)},h('option',{value:''},'Общая модель Octoport'),
                modelGroups(models))),
              model&&h('label',null,'Рассуждение',h('select',{'aria-label':'Рассуждение',value:effort,onChange:e=>setModelDraft({model,effort:e.target.value})},
                modelChoices.map(v=>h('option',{key:v,value:v},v)))),
              h(Action,{disabled:busy,onClick:()=>act(async()=>{
                const saved=await send(url+'/model',{model,effort});
                setData(prev=>prev&&({...prev,model:saved.model,effort:saved.effort}));setModelDraft(null);
              })},'Сохранить модель')))));
    }
    function modelGroups(models){
      const groups=new Map();
      for(const m of models){
        const family=m.family || 'DeepSeek';
        if(!groups.has(family))groups.set(family,[]);
        groups.get(family).push(h('option',{key:m.id,value:m.id},m.name+(m.free?' · Бесплатно':'')));
      }
      return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([family,rows])=>h('optgroup',{key:family,label:family},rows));
    }
    function Illustrations({url,close,title}){
      const [rows,setRows]=React.useState([]),[model,setModel]=React.useState(''),[msg,setMsg]=React.useState('');
      const [busy,setBusy]=React.useState(true);
      React.useEffect(()=>{
        const ctrl=new AbortController();
        Promise.all([api(url,{signal:ctrl.signal}),api(url+'?models=1',{signal:ctrl.signal})]).then(([current,catalog])=>{
          if(!ctrl.signal.aborted){setRows(catalog.models);setModel(current.model);setMsg(catalog.catalogMessage || '');}
        }).catch(e=>{if(!ctrl.signal.aborted)setMsg(e.message);}).finally(()=>{if(!ctrl.signal.aborted)setBusy(false);});
        return ()=>ctrl.abort();
      },[url]);
      async function save(){
        setBusy(true);
        try{await send(url+'/model',{model,effort:'auto'});setMsg('Модель иллюстраций сохранена');}
        catch(e){setMsg(e.message);}finally{setBusy(false);}
      }
      return h(Dialog,{label:title,close,className:'octo-plugin-settings'},
        h('label',null,'Модель для создания иллюстраций',h('select',{value:model,disabled:busy,onChange:e=>setModel(e.target.value)},
          h('option',{value:''},'Выберите модель'),modelGroups(rows))),
        h(Action,{disabled:busy,onClick:save},'Сохранить модель'),h('p',{role:'status'},msg));
    }
    function TelegramReports({url,title,close}) {
      const [data,setData]=React.useState(null),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
      React.useEffect(()=>{
        const controller=new AbortController();
        api(url,{signal:controller.signal}).then(setData).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
        return ()=>controller.abort();
      },[url]);
      async function act(action) {
        setBusy(true);setError('');
        try {
          await send(url+'/'+action,{});
          setData(await api(url));
        } catch(e){setError(e.message);} finally {setBusy(false);}
      }
      const messages={
        limited:'Telegram попросил подождать. Доставка продолжится автоматически.',
        unknown:'Telegram не подтвердил отправку. Проверьте личный чат с ботом.',
        rejected:'Telegram отклонил отправку. Проверьте подключение.',
        sending:'Отчёт отправляется.'
      };
      return h(Dialog,{label:title,close,className:'octo-plugin-settings'},
        error&&h('p',{role:'alert'},error),
        !data&&!error&&h('p',{role:'status'},'Загружаем настройки…'),
        data&&h(React.Fragment,null,
          h('p',null,'Бот присылает в личные сообщения готовые отчёты по данным маркетплейсов из этого диалога.'),
          h('p',{role:'status'},data.subscribed?'Отчёты этого чата включены.':data.linked?'Telegram подключён к аккаунту.':'Добавьте интеграцию Telegram в разделе «Интеграции».'),
          messages[data.status]&&h('p',{role:'status'},messages[data.status]),
          data.lastSent&&h('p',null,'Последняя отправка: '+new Date(data.lastSent*1000).toLocaleString('ru-RU')),
          !data.linked&&h(Action,{onClick:()=>{
            close();
            ctx.slots.entries('sidebar.settings')[0]?.store.create().actions.openSection('integrations');
          }},'Открыть интеграции'),
          data.linked&&!data.subscribed&&h(Action,{disabled:busy,onClick:()=>act('enable')},'Получать новые отчёты этого чата'),
          ['unknown','rejected'].includes(data.status)&&h(Action,{disabled:busy,onClick:()=>act('resume')},'Продолжить со следующего отчёта'),
          data.subscribed&&h(Action,{disabled:busy,onClick:()=>act('pause')},'Остановить доставку из этого чата')));
    }
    function Timers({url,title,close}) {
      const [events,setEvents]=React.useState([]),[cursor,setCursor]=React.useState(null);
      const [form,setForm]=React.useState(null),[text,setText]=React.useState('');
      const [error,setError]=React.useState(''),[busy,setBusy]=React.useState(false),[history,setHistory]=React.useState(null);
      const chat=decodeURIComponent(url.split('/')[3]);
      async function load(after) {
        const page=await api(url+(after?'?before='+after:''));
        setEvents(old=>after?[...old,...page.events]:page.events);setCursor(page.nextCursor);
      }
      React.useEffect(()=>{load().catch(e=>setError(e.message));},[url]);
      async function act(fn) {
        setBusy(true);setError('');
        try { await fn(); } catch(e) {setError(e.message);} finally {setBusy(false);}
      }
      function start(kind,eventId) {setForm({kind,eventId});setText('');setHistory(null);}
      const button=(label,fn,disabled=false)=>h(Action,{disabled:disabled||busy,onClick:fn},label);
      const labels={active:'Активен',paused:'На паузе',completed:'Завершён'};
      return h(Dialog,{label:title,close},
        error&&h('p',{role:'alert'},error),
        form?h('form',{onSubmit:e=>{e.preventDefault();if(!text.trim())return;
          act(async()=>{const sent=window.harnessAccount.timerPrompt(chat,text.trim(),form);close();await sent;})
        }},h('label',null,form.eventId?'Что изменить?':'Что и когда должен сделать Октопус?',
          h('textarea',{autoFocus:true,value:text,required:true,onChange:e=>setText(e.target.value)})),
          h('div',{className:'plugin-buttons'},h(Button,{type:'submit',disabled:busy||!text.trim()},'Протестировать'),
            button('Назад',()=>setForm(null)))):h(React.Fragment,null,
          h('div',{className:'plugin-buttons'},button('Создать отчёт',()=>start('report')),
            button('Создать действие',()=>start('action'))),
          events.length===0&&h('p',null,'В этом чате пока нет таймеров.'),
          events.map(e=>h('section',{key:e.id,className:'octo-plugin-row'},
            h('div',null,h('strong',null,e.instructions[0]),h('p',null,labels[e.status],
              e.nextAt?' · '+new Date(e.nextAt).toLocaleString('ru-RU',{timeZone:e.schedule.zone})+' · '+e.schedule.zone:''),
              h('div',{className:'plugin-buttons'},button('Редактировать',()=>start(e.kind,e.id)),
                e.status!=='completed'&&button(e.status==='paused'?'Возобновить':'На паузу',()=>act(async()=>{
                  await send(url+'/events/'+e.id+(e.status==='paused'?'/resume':'/pause'),{});await load();})),
                button('История',()=>act(async()=>setHistory((await api(url+'/events/'+e.id+'/history')).runs))),
                button('Удалить',()=>act(async()=>{await send(url+'/events/'+e.id+'/delete',{});await load();})))))),
          cursor&&button('Показать ещё',()=>act(()=>load(cursor))),
          history&&h('section',null,h('h3',null,'История запусков'),!history.length&&h('p',null,'Запусков пока нет.'),
            history.map(r=>h('p',{key:r.due},new Date(r.due/1000).toLocaleString('ru-RU'),' · ',
             r.message||'В очереди',r.telegram&&r.telegram!=='off'?' · Telegram: '+r.telegram:'')))));
    }
    const panels={timer:Timers,wb:Marketplace,ozon:Marketplace,images:Illustrations,telegram:TelegramReports};
    function useCatalog(url) {
      const [data,setData]=React.useState(null),[error,setError]=React.useState(''),[busy,setBusy]=React.useState(false);
      React.useEffect(()=>{
        const controller=new AbortController();
        let revision=0;
        async function refresh() {
          const version=++revision;
          try {
            const next=await api(url,{signal:controller.signal});
            if(!controller.signal.aborted&&version===revision){setData(next);setError('');}
          }catch(e){if(!controller.signal.aborted&&version===revision)setError(e.message);}
        }
        const foreground=()=>{if(document.visibilityState==='visible')refresh();};
        refresh();window.addEventListener('harness:grants',refresh);
        document.addEventListener('visibilitychange',foreground);
        return ()=>{
          controller.abort();window.removeEventListener('harness:grants',refresh);
          document.removeEventListener('visibilitychange',foreground);
        };
      },[url]);
      async function update(path,body) {
        setBusy(true);setError('');
        try {
          await send(path,body);
          window.dispatchEvent(new Event('harness:grants'));
        }catch(e){setError(e.message);return false;}
        finally{setBusy(false);}
        return true;
      }
      return {data,error,busy,update};
    }
    const accountUrl='/api/plugins';
    function CatalogItems() {
      const {data,error,busy,update}=useCatalog(accountUrl);
      function branch(parent) {
        return data.categories.filter(c=>c.parent===parent).map(c=>{
          const items=data.plugins.filter(p=>p.category===c.id);
          return h(Fold,{key:c.id,label:c.title,initial:items.length>0},
            items.map(p=>h('div',{key:p.id,className:'octo-plugin-row'},
              h('div',null,h('strong',null,p.title),h('p',null,p.description)),
              p.installed?h('span',null,'Установлен'):h(Action,{disabled:busy,'aria-label':'Установить '+p.title,
                onClick:()=>update(accountUrl,{plugin:p.id,installed:true})},'Установить'))),
            !items.length&&!data.categories.some(x=>x.parent===c.id)&&h('p',null,'Плагинов пока нет.'),branch(c.id));
        });
      }
      return h(React.Fragment,null,
        error&&h('p',{role:'alert'},error),
        data ? branch(null) : !error&&h('p',{role:'status'},'Загружаем каталог…'));
    }
    function Catalog({close}) {
      return h(Dialog,{label:catalogLabel,close,className:'octo-plugin-catalog'},h(CatalogItems));
    }
    function CatalogSettings() {
      return h('section',{className:'octo-plugin-content octo-plugin-preferences'},
        h('h2',null,catalogLabel),h(CatalogItems));
    }
    function SidebarLink({title,Icon,wide,onClick,buttonRef}) {
      return h('button',{type:'button',className:'octo-plugin-link',ref:buttonRef,title,'aria-label':title,
        'aria-haspopup':'dialog',onClick},h(Icon,{size:wide?16:18}),wide&&h('span',null,title));
    }
    function Menu({chat,wide,openCatalog}) {
      const url=chat?'/api/chats/'+encodeURIComponent(chat)+'/plugins':accountUrl;
      const {data,error,busy,update}=useCatalog(url);
      const [panel,setPanel]=React.useState(''),[actions,setActions]=React.useState(''),[remove,setRemove]=React.useState(null);
      const catalogButton=React.useRef(null);
      const installed=(data?.plugins||[]).filter(p=>p.installed);
      React.useEffect(()=>{
        if(!chat || !window.harnessAccount.timerChats)return;
        if(installed.some(p=>p.id==='timer'&&p.enabled)) window.harnessAccount.timerChats.add(chat);
        else window.harnessAccount.timerChats.delete(chat);
      },[chat,data]);
      const plugin=installed.find(p=>p.id===panel&&p.enabled);
      function installedRow(p) {
        const Icon=p.provider==='wb'?IconDataOutlineMedium:IconPersonalizationOutlineMedium;
        const isOpen=actions===p.id, hasSettings=p.enabled&&Object.hasOwn(panels,p.provider);
        const state=p.enabled?'Актив':'Не актив';
        const items=[...(!wide&&hasSettings?[{id:'open',label:'Открыть плагин'}]:[]),
          ...(chat?[{id:'toggle',label:p.enabled?'Отключить':'Подключить'}]:[]),
          {id:'remove',label:'Удалить',danger:true,separatorBefore:true}];
        const label=wide?'Действия плагина «'+p.title+'»':p.title;
        return h('li',{key:p.id,'data-active':String(p.enabled)},
          wide&&(hasSettings?h(SidebarLink,{title:p.title,Icon,wide,onClick:()=>setPanel(p.id)}):
            h('span',{className:'octo-plugin-link octo-plugin-label'},h(Icon,{size:16}),h('span',null,p.title))),
          wide&&chat&&h('span',{className:'octo-plugin-state'},state),
          h(Popup,{open:isOpen,portal:true,autoFocus:true,align:'start',side:'bottom',className:'octo-plugin-overflow',
            listClassName:'octo-plugin-menu',items,
            anchor:h('button',{type:'button',className:wide?'octo-plugin-more':'octo-plugin-link octo-plugin-compact',
              title:wide||!chat?label:label+' · '+state,'aria-label':label,'aria-description':chat?state:undefined,
              'aria-haspopup':'menu','aria-expanded':isOpen,disabled:busy,onClick:()=>setActions(isOpen?'':p.id)},
              wide?h(IconEllipsisOutlineRegular,{size:16}):h(React.Fragment,null,h(Icon,{size:18}),
                chat&&h('span',{className:'octo-plugin-indicator','aria-hidden':true}))),
            onClose:()=>setActions(''),onSelect:id=>{
              setActions('');
              if(id==='toggle')update(url,{plugin:p.id,enabled:!p.enabled});
              if(id==='open')setPanel(p.id);
              if(id==='remove')setRemove(p);
            }}));
      }
      return h('div',{className:'octo-plugin-navigation','data-wide':wide},
        h(SidebarLink,{wide,title:catalogLabel,Icon:IconPersonalizationOutlineMedium,onClick:openCatalog,buttonRef:catalogButton}),
        error&&!remove&&h('p',{role:'alert'},error),
        installed.length>0&&h('nav',{'aria-label':'Установленные плагины',className:'octo-installed-plugins'},
          wide&&h('div',{className:'octo-plugin-list-title'},'Установленные плагины'),
          h('ul',null,installed.map(installedRow))),
        remove&&h(Dialog,{label:'Удалить плагин?',close:()=>{if(!busy)setRemove(null);}},
          h('p',null,'«'+remove.title+'» будет удалён из установленных плагинов и отключён во всех ваших диалогах.'),
          error&&h('p',{role:'alert'},error),
          h('div',{className:'plugin-buttons'},h(Action,{disabled:busy,onClick:()=>setRemove(null)},'Отмена'),
            h(Action,{disabled:busy,onClick:async()=>{
              if(await update(accountUrl,{plugin:remove.id,installed:false})){
                setRemove(null);catalogButton.current?.focus({preventScroll:true});
              }
            }},'Удалить'))),
        plugin&&Object.hasOwn(panels,plugin.provider)&&h(panels[plugin.provider],{key:plugin.id,url:url+'/'+encodeURIComponent(plugin.id),
          title:plugin.title,provider:plugin.provider,close:()=>setPanel('')}));
    }
    function Sidebar({wide,openCatalog}) {
      const selection=ctx.uiWorkspace.selection;
      const chat=React.useSyncExternalStore(cb=>selection.subscribe(cb),()=>selection.getSnapshot().sessionId);
      const selected=window.harnessAccount.hasChat(chat)?chat:null;
      return h(Menu,{key:selected||'account',chat:selected,wide,openCatalog});
    }
    const productPlugins={Sidebar,Catalog,CatalogSettings};
    components.set(ctx,productPlugins);
    return productPlugins;
  };
})();
