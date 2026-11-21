// Registered once per native account sidebar.
(() => {
  const components = new WeakMap();
  window.octoPluginMenu = (React,ctx,api,ui) => {
    if (components.has(ctx)) return components.get(ctx);
    const h=React.createElement;
    const send=(path,data)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const {Modal,Button,Switch,IconDataOutlineMedium,IconPersonalizationOutlineMedium,IconChevronRightOutlineRegular}=ui;
    function Dialog({label,close,children,settings=false}) {
      return h(Modal,{open:true,title:label,closeLabel:'Закрыть',onClose:close,
        className:settings?'octo-plugin-panel octo-plugin-settings':'octo-plugin-panel'},
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
      return h(Dialog,{label:title,close,settings:true},error&&h('p',{role:'alert'},error),
        !data ? h('p',{role:'status'},'Загружаем настройки…') : h(React.Fragment,null,
          h('h3',null,'Магазины'),data.stores.length===0&&h('p',null,'Добавьте магазин в разделе «Интеграции».'),
          h('div',{className:'plugin-stores'},data.stores.map(s=>h(Action,{key:s.id,disabled:busy,'aria-pressed':cid===s.id,
            onClick:()=>s.selected?changeStore(s.id):choose(s)},s.selected?s.name:'Подключить в этом чате · '+s.name))),
          current&&h(React.Fragment,null,h('div',{className:'plugin-controls'},
            h('label',null,'Найти товар',h('input',{type:'search',placeholder:'Название или артикул',value:search,onChange:e=>{setSearch(e.target.value);setLimit(100);}})),
            h('label',null,'Область расчёта',h('select',{'aria-label':'Область расчёта',value:sku,disabled:busy,onChange:e=>{setSku(e.target.value);setData(null);}},
              h('option',{value:''},'Весь магазин'),shown.map(p=>h('option',{key:p.sku,value:p.sku},
                [p.title,p.offer,(provider==='ozon'?'SKU ':'WB ')+p.sku].filter(Boolean).join(' · '))))),
            productRows.length>limit&&h(Action,{onClick:()=>setLimit(n=>n+100)},'Показать ещё товары'),
            h(Action,{disabled:busy||catalogJob?.state==='running',onClick:()=>act(()=>send(url+'/refresh',{cid}))},'Обновить товары'),
            h(Action,{disabled:busy,onClick:()=>act(async()=>{await send(url+'/disconnect',{cid});window.dispatchEvent(new Event('harness:grants'));changeStore('');})},'Отключить магазин от чата')),
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
                models.map(m=>h('option',{key:m.id,value:m.id},m.name)))),
              model&&h('label',null,'Рассуждение',h('select',{'aria-label':'Рассуждение',value:effort,onChange:e=>setModelDraft({model,effort:e.target.value})},
                modelChoices.map(v=>h('option',{key:v,value:v},v)))),
              h(Action,{disabled:busy,onClick:()=>act(async()=>{
                const saved=await send(url+'/model',{model,effort});
                setData(prev=>prev&&({...prev,model:saved.model,effort:saved.effort}));setModelDraft(null);
              })},'Сохранить модель')))));
    }
    const panels={wb:Marketplace,ozon:Marketplace};
    function Menu({chat,wide}) {
      const url='/api/chats/'+encodeURIComponent(chat)+'/plugins';
      const [data,setData]=React.useState(null),[panel,setPanel]=React.useState(''),[err,setErr]=React.useState(''),[busy,setBusy]=React.useState(false);
      const latest=React.useRef(0);
      React.useEffect(()=>{
        const controller=new AbortController();
        async function refresh() {
          const revision=++latest.current;
          try {
            const result=await api(url,{signal:controller.signal});
            if(revision===latest.current){setData(result);setErr('');}
          } catch(e) {
            if(revision===latest.current&&!controller.signal.aborted)setErr(e.message);
          }
        }
        refresh();window.addEventListener('harness:grants',refresh);
        return()=>{latest.current++;controller.abort();window.removeEventListener('harness:grants',refresh);};
      },[url]);
      async function toggle(p) {
        latest.current++;
        setBusy(true);setErr('');
        try {
          const result=await send(url,{plugin:p.id,enabled:!p.enabled});
          latest.current++;setData(result);
          window.dispatchEvent(new Event('harness:grants'));
        } catch(e){setErr(e.message);}finally{setBusy(false);}
      }
      const plugin=data?.plugins.find(p=>p.id===panel&&p.enabled);
      const label='Плагины';
      function branch(parent) {
        return data.categories.filter(c=>c.parent===parent).map(c=>{
          const items=data.plugins.filter(p=>p.category===c.id);
          return h(Fold,{key:c.id,label:c.title,initial:items.length>0},
            items.map(p=>h('div',{key:p.id,className:'octo-plugin-row'},
              h('div',null,h('strong',null,p.title),h('p',null,p.description)),
              h(Switch,{label:'Подключить '+p.title,checked:p.enabled,disabled:busy,onChange:()=>toggle(p)}))),
            !items.length&&!data.categories.some(x=>x.parent===c.id)&&h('p',null,'Плагинов пока нет.'),branch(c.id));
        });
      }
      const enabled=(data?.plugins||[]).filter(p=>p.enabled);
      function link(title,Icon,open) {
        return h('button',{type:'button',className:'octo-plugin-link',title,'aria-label':title,'aria-haspopup':'dialog',
          onClick:open},h(Icon,{size:wide?16:18}),wide&&h('span',null,title));
      }
      return h('div',{className:'octo-plugin-navigation','data-wide':wide},
        link(label,IconPersonalizationOutlineMedium,()=>setPanel('catalog')),
        enabled.length>0&&h('nav',{'aria-label':'Подключённые плагины',className:'octo-enabled-plugins'},
          wide&&h('div',{className:'octo-plugin-list-title'},'Подключённые плагины'),
          h('ul',null,enabled.map(p=>h('li',{key:p.id},
            link(p.title,p.provider==='wb'?IconDataOutlineMedium:IconPersonalizationOutlineMedium,()=>setPanel(p.id)))))),
        panel==='catalog'&&h(Dialog,{label,close:()=>setPanel('')},
          err&&h('p',{role:'alert'},err),data?branch(null):!err&&h('p',{role:'status'},'Загружаем каталог…')),
        plugin&&panels[plugin.provider]&&h(panels[plugin.provider],{key:chat+plugin.id,url:url+'/'+encodeURIComponent(plugin.id),title:plugin.title,provider:plugin.provider,close:()=>setPanel('')}));
    }
    function Sidebar({wide}) {
      const selection=ctx.uiWorkspace.selection;
      const chat=React.useSyncExternalStore(cb=>selection.subscribe(cb),()=>selection.getSnapshot().sessionId);
      return window.harnessAccount.hasChat(chat)?h(Menu,{key:chat,chat,wide}):null;
    }
    components.set(ctx,Sidebar);
    return Sidebar;
  };
})();
