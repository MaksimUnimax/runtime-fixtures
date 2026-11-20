window.__ModuleLoader__.load({
  id:'harness-account',
  factory(require) {
    const React=require('react'), h=React.createElement;
    return {inject:['slots','uiWorkspace','sessions'],apply(ctx) {
      const a=window.harnessAccount;
      const subscribers=new Set();
      let panel=a.panel;
      function select(value) {panel=value;for(const listener of subscribers)listener();}
      function usePanel(){return React.useSyncExternalStore(listener=>{subscribers.add(listener);return()=>subscribers.delete(listener);},()=>panel);}
      function Footer({wide}) {
        const title=a.guest?'Войти':'Баланс';
        return h('div',{className:'account-actions'},
          h('button',{type:'button',title,onClick:()=>select(a.guest?'login':'wallet')},wide?title:(a.guest?'↪':'◉')),
          wide && a.guest && h('a',{href:'/register'},'Создать аккаунт и сохранить чат'),
          wide && !a.guest && h('button',{type:'button',onClick:()=>select('tools')},'Функции'),
          wide && !a.guest && h('form',{action:'/logout',method:'post'},h('button',null,'Выйти')),
          wide && a.wallet?.canGrant && h('a',{href:'/admin'},'Администрирование'));
      }
      function Field(name,title,props={}) {
        return h('label',{key:name},title,h('input',{name,required:true,...props}));
      }
      function Features() {
        const [names,setNames]=React.useState(null);
        const active=ctx.sessions.list.getSnapshot();
        const id=Object.values(active.byId).find(row=>row.retainedBy?.mainView>0)?.id;
        React.useEffect(()=>{
          const abort=new AbortController();
          if(id) a.api('/api/chats/'+encodeURIComponent(id)+'/tools',{signal:abort.signal})
            .then(setNames).catch(()=>{if(!abort.signal.aborted)setNames(['Не удалось загрузить инструменты']);});
          else setNames([]);
          return ()=>abort.abort();
        },[id]);
        return h('div',{'data-testid':'tools'},names===null?'Загрузка…':names.length
          ? h('ul',null,names.map(name=>h('li',{key:name},name))) : 'Нет доступных инструментов');
      }
      function Dialog() {
        const mode=usePanel(), ref=React.useRef(null);
        React.useEffect(()=>{if(mode && !ref.current.open)ref.current.showModal();},[mode]);
        const close=()=>{select('');if(['/register','/login'].includes(location.pathname))history.replaceState(null,'',a.selected ? '/app/chats/'+encodeURIComponent(a.selected) : '/');};
        if(!mode)return null;
        if(mode==='tools') return h('dialog',{className:'account-dialog',ref,onCancel:close,'aria-label':'Функции'},
          h('h2',null,'Функции'),h(Features),h('button',{type:'button',onClick:close},'Закрыть'));
        if(mode==='notice') return h('dialog',{className:'account-dialog',ref,onCancel:close},
          h('h2',null,a.error),h('button',{type:'button',onClick:close},'Закрыть'));
        const signup=mode==='register', wallet=mode==='wallet';
        return h('dialog',{className:'account-dialog',ref,'aria-labelledby':'dialog-title',onCancel:close},
          h('button',{className:'account-close',type:'button','aria-label':'Закрыть',onClick:close},'×'),
          h('h2',{id:'dialog-title'},wallet?'Баланс':signup?'Создать аккаунт':'Вход в Harness'),
          a.error && h('p',{role:'alert'},a.error),
          wallet ? h(React.Fragment,null,
            h('p',null,'Доступно · '+a.wallet.available+' монет'),h('p',null,'В резерве · '+a.wallet.reserved),
            h('label',null,'Предел на запрос, монет',h('input',{inputMode:'decimal',defaultValue:a.limit||a.wallet.turnLimit,
              onChange:e=>{a.limit=e.target.value.replace(',','.');}})),
            h('ul',null,a.wallet.charges.map(c=>h('li',{key:c.operationId||c.requestId},(c.pending?'На сверке · ':'Списано · ')+c.coins)))) :
          h(React.Fragment,null,h('form',{action:signup?'/register':'/login',method:'post'},
            Field('login','Логин',{autoComplete:'username',maxLength:254}),
            Field('password','Пароль',{type:'password',autoComplete:signup?'new-password':'current-password',minLength:signup?15:1,maxLength:256}),
            signup && h('small',null,'Пароль от 15 символов. Сохраните код восстановления.'),
            signup && Field('recovery','Код восстановления',{readOnly:true,value:a.recovery}),
            h('button',{type:'submit'},signup?'Зарегистрироваться и открыть чат':'Войти')),
            h('a',{href:signup?'/login':'/register'},signup?'Войти в существующий аккаунт':'Создать аккаунт и сохранить чат'),
            h('button',{type:'button',onClick:close},'Продолжить как гость')));
      }
      ctx.slots.inject('sidebar.footer.action',()=>ctx.slots.register({name:'sidebar.footer.action',id:'harness-account'},Footer));
      ctx.slots.inject('shell.overlay',()=>ctx.slots.register({name:'shell.overlay',id:'harness-auth'},Dialog));
      function Cost({seq,sessionId}) {
        const cost=a.costs.get(sessionId+'|'+seq);
        if(!cost) return null;
        const amount=cost.rub ?? cost.usd;
        return h('small',{className:'model-cost'},amount ?
          'Оценка стоимости · '+amount.replace('.',',')+(cost.rub?' ₽':' USD') : 'Оценка стоимости пока недоступна');
      }
      if(a.wallet?.canGrant)ctx.slots.inject('conversation.chat.turnTail',()=>ctx.slots.register({
        name:'conversation.chat.turnTail',id:'harness-cost',inject:sessionId=>({sessionId})
      },Cost));
      const sessions=ctx.sessions.list;
      let opened=false;
      const sync=()=>{
        const snapshot=sessions.getSnapshot();
        if(snapshot.phase!=='ready')return;
        if(!opened){
          opened=true;
          if(a.selected)ctx.uiWorkspace.openSession(a.selected);
        }
        const current=Object.values(snapshot.byId).find(row=>row.retainedBy?.mainView>0)?.id;
        if(current && !panel){
          const path='/app/chats/'+encodeURIComponent(current);
          if(location.pathname!==path)history.replaceState(null,'',path);
        }
      };
      ctx.effect(()=>sessions.subscribe(sync),'account session links');sync();
    }};
  }
});
