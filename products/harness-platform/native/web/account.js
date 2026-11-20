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
      function Mark({size=24}) {
        return h('span', {className:'octo-mark', role:'img', 'aria-label':'octoport',
          style:{width:size, height:size}});
      }
      function Wordmark() {
        return h('span',{className:'octo-lockup'},h('span',null,'octoport'),h('small',null,'Harness'));
      }
      for (const [name, component] of [
        ['sidebar.brand.mark', Mark], ['sidebar.brand.name', Wordmark], ['conversation.hero.brand.mark', Mark]
      ]) {
        ctx.slots.inject(name, () => ctx.slots.register({name}, component));
      }
      function Footer({wide}) {
        const title=a.guest?'Войти':'Баланс';
        return h('div',{className:'account-actions'},
          h('button',{type:'button',title,onClick:()=>select(a.guest?'login':'wallet')},wide?title:(a.guest?'↪':'◉')),
          wide && a.guest && h('a',{href:'/register'},'Создать аккаунт и сохранить чат'),
          !a.guest && h('button',{type:'button',title:'Интеграции','aria-label':'Интеграции',onClick:()=>{
            const settings=ctx.slots.entries('sidebar.settings')[0];
            settings?.store.create().actions.openSection('integrations');
          }},wide?'Интеграции':'⇄'),
          wide && h('a',{href:'https://octoport.ru/about/'},'О сервисе'),
          wide && !a.guest && h('form',{action:'/logout',method:'post'},h('button',null,'Выйти')),
          a.wallet?.canGrant && h('a',{href:'/admin',title:'Администрирование','aria-label':'Администрирование'},wide?'Администрирование':'⚙'));
      }
      function Field(name,title,props={}) {
        return h('label',{key:name},title,h('input',{name,required:true,...props}));
      }
      function Wallet() {
        const [wallet,setWallet]=React.useState(a.wallet);
        const [error,setError]=React.useState('');
        React.useEffect(()=>{
          const controller=new AbortController();
          a.api('/api/wallet',{signal:controller.signal}).then(next=>{a.wallet=next;setWallet(next);})
            .catch(()=>{if(!controller.signal.aborted)setError('Не удалось обновить баланс');});
          return ()=>controller.abort();
        },[]);
        return h(React.Fragment,null,
          h('p',{className:'wallet-amount'},h('span',null,'Доступно · '),wallet.available,h('small',null,' монет')),
          h('p',{className:'wallet-price'},'1 монета покрывает 1 ₽ расходов.'),
          h('p',{className:'wallet-price'},'Цена покупки · '+Number(wallet.salePrice.rubPerCoin).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:4})+' ₽ за монету'),
          wallet.reserved!=='0' && h('p',null,'Ожидает расчёта · '+wallet.reserved),
          error && h('p',{role:'alert'},error),
          wallet.charges.length>0 && h('ul',{className:'wallet-history'},wallet.charges.map(c=>h('li',{key:c.operationId||c.requestId},(c.pending?'На сверке · ':'Списано · ')+c.coins))));
      }
      function Dialog() {
        const mode=usePanel(), ref=React.useRef(null);
        React.useEffect(()=>{if(mode && !ref.current.open)ref.current.showModal();},[mode]);
        const close=()=>{select('');if(['/register','/login'].includes(location.pathname))history.replaceState(null,'',a.selected ? '/app/chats/'+encodeURIComponent(a.selected) : '/');};
        if(!mode)return null;
        if(mode==='notice') return h('dialog',{className:'account-dialog',ref,onCancel:close},
          h('h2',null,a.error),h('button',{type:'button',onClick:close},'Закрыть'));
        const signup=mode==='register', wallet=mode==='wallet';
        return h('dialog',{className:'account-dialog',ref,'aria-labelledby':'dialog-title',onCancel:close},
          h('button',{className:'account-close',type:'button','aria-label':'Закрыть',onClick:close},'×'),
          h('h2',{id:'dialog-title'},wallet?'Баланс':signup?'Создать аккаунт':'Вход в octoport'),
          a.error && h('p',{role:'alert'},a.error),
          wallet ? h(Wallet) :
          h(React.Fragment,null,h('form',{action:signup?'/register':'/login',method:'post'},
            Field('login','Логин',{autoComplete:'username',maxLength:254}),
            Field('password','Пароль',{type:'password',autoComplete:signup?'new-password':'current-password',maxLength:256}),
            
            signup && h('details',{className:'recovery'},h('summary',null,'Код восстановления'),
              h('small',null,'Сохраните код, чтобы восстановить доступ.'),
              Field('recovery','Ваш код',{readOnly:true,value:a.recovery})),
            h('button',{type:'submit',className:'account-primary'},signup?'Зарегистрироваться и открыть чат':'Войти')),
            h('a',{href:signup?'/login':'/register'},signup?'Войти в существующий аккаунт':'Создать аккаунт и сохранить чат'),
            h('button',{type:'button',onClick:close},'Продолжить как гость')));
      }
      ctx.slots.inject('sidebar.footer.action',()=>ctx.slots.register({name:'sidebar.footer.action',id:'harness-account'},Footer));
      ctx.slots.inject('shell.overlay',()=>ctx.slots.register({name:'shell.overlay',id:'harness-auth'},Dialog));
      function Cost({seq,sessionId}) {
        const cost=a.costs.get(sessionId+'|'+seq);
        if(!cost) return null;
        if ('coins' in cost) {
          const labels=[];
          for(const [provider,t] of Object.entries(cost.providers||{}))labels.push(provider==='DeepSeek'?'octoport':provider,'Вход '+t.input,'Кэш '+t.cache,'Выход '+t.output,'Всего '+(t.input+t.cache+t.output)+' токенов');
          if(cost.rub!==null)labels.push(cost.rub.replace('.',',')+' ₽');
          labels.push('Списано '+cost.coins.replace('.',',')+' монет');
          if(cost.pending)labels.push('На сверке');
          return h('small',{className:'model-cost'},labels.join(' · '));
        }
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
