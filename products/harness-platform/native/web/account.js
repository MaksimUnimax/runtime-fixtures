window.__ModuleLoader__.load({
  id:'harness-account',
  factory(require) {
    const React=require('react'), h=React.createElement;
    return {inject:['slots','uiWorkspace','sessions','contextMenus'],apply(ctx) {
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
        return h('img',{className:'octo-wordmark',src:'/ui-assets/project/octoport-wordmark.svg?v=689f9cd2',
          width:112,height:28,alt:'octoport'});
      }
      for (const [name, component] of [
        ['sidebar.brand.mark', Mark], ['sidebar.brand.name', Wordmark], ['conversation.hero.brand.mark', Mark]
      ]) {
        ctx.slots.inject(name, () => ctx.slots.register({name}, component));
      }
      function useAvailableCoins() {
        const [available,setAvailable]=React.useState(null);
        React.useEffect(()=>{
          if (a.guest) return;
          let current;
          const refresh=()=>{
            current?.abort();
            const controller=new AbortController();
            current=controller;
            a.api('/api/wallet/balance',{signal:controller.signal})
              .then(data=>{if(!controller.signal.aborted)setAvailable(data.available);})
              .catch(()=>{if(!controller.signal.aborted)setAvailable(null);});
          };
          const visible=()=>{if(!document.hidden)refresh();};
          const update=event=>{current?.abort();setAvailable(event.detail);};
          a.balanceEvents.addEventListener('refresh',refresh);
          a.balanceEvents.addEventListener('balance',update);
          document.addEventListener('visibilitychange',visible);
          refresh();
          return ()=>{
            current?.abort();
            a.balanceEvents.removeEventListener('refresh',refresh);
            a.balanceEvents.removeEventListener('balance',update);
            document.removeEventListener('visibilitychange',visible);
          };
        },[]);
        return available;
      }
      const coinAmount=new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2});
      function Footer({wide}) {
        const available=useAvailableCoins();
        const count=available==null?'—':coinAmount.format(available);
        const title=a.guest?'Войти':'Баланс';
        return h('div',{className:'account-actions'},
          wide && a.guest && h('small',{className:'guest-coins'},'Монеты · доступны после входа'),
          h('button',{type:'button',className:'balance-action','aria-label':title,
            title:a.guest?title:(available==null?'Открыть баланс':'Доступно монет: '+count),
            onClick:()=>select(a.guest?'login':'wallet')},
            wide ? title : (a.guest?'↪':'◉'),
            wide && !a.guest && h('span',{className:'sidebar-coins'},count,' монет')),
          wide && a.guest && h('a',{href:'/register'},'Создать аккаунт'),
          !a.guest && h('button',{type:'button',title:'Интеграции','aria-label':'Интеграции',onClick:()=>{
            const settings=ctx.slots.entries('sidebar.settings')[0];
            settings?.store.create().actions.openSection('integrations');
          }},wide?'Интеграции':'⇄'),
          wide && h('a',{href:'https://octoport.ru/about/'},'О сервисе'),
          wide && !a.guest && h('form',{action:'/logout',method:'post'},h('button',null,'Выйти')),
          a.canGrant && h('a',{href:'/admin',title:'Администрирование','aria-label':'Администрирование'},wide?'Администрирование':'⚙'));
      }
      function Field(name,title,props={}) {
        return h('label',{key:name},title,h('input',{name,required:true,...props}));
      }
      function Wallet() {
        const [wallet,setWallet]=React.useState(null);
        const [showCharges,setShowCharges]=React.useState(false);
        const historyId=React.useId();
        const [error,setError]=React.useState('');
        React.useEffect(()=>{
          const controller=new AbortController();
          a.api('/api/wallet',{signal:controller.signal}).then(next=>{
            if(controller.signal.aborted)return;
            setWallet(next);
            a.balanceEvents.dispatchEvent(new CustomEvent('balance',{detail:next.available}));
          })
            .catch(()=>{if(!controller.signal.aborted)setError('Не удалось обновить баланс');});
          return ()=>controller.abort();
        },[]);
        if (!wallet) return h('p',{role:error?'alert':'status'},error || 'Загружаем баланс…');
        return h(React.Fragment,null,
          h('p',{className:'wallet-amount'},h('span',null,'Доступно'),coinAmount.format(wallet.available),h('small',null,' монет')),
          h('a',{className:'account-primary',href:'/payment'},'Пополнить баланс'),
          wallet.reserved!=='0' && h('p',null,'Ожидает расчёта · '+coinAmount.format(wallet.reserved)),
          wallet.charges.length>0 && h('div',{className:'wallet-charges'},
            h('button',{type:'button','aria-expanded':showCharges,'aria-controls':historyId,
              onClick:()=>setShowCharges(open=>!open)},showCharges?'Скрыть списания':'Показать списания'),
            h('ul',{className:'wallet-history',id:historyId,hidden:!showCharges,'aria-label':'История списаний',
              tabIndex:wallet.charges.length>5?0:undefined},wallet.charges.map(c=>
              h('li',{key:c.operationId||c.requestId},h('span',null,c.pending?'На сверке':'Списано'),
                h('span',null,coinAmount.format(c.coins),' монет'))))));
      }
      let deletion;
      if (!a.guest) ctx.effect(()=>ctx.contextMenus.register({
        id:'octoport.delete-chat',target:'session',order:650,
        resolve:({sessionId,displayTitle})=>[{
          id:'delete-chat',label:'Удалить чат',icon:{key:'workspace.delete'},danger:true,separatorBefore:true,
          run:()=>{deletion={id:sessionId,title:displayTitle};select('delete-chat');}
        }]
      }),'delete chat menu');
      function DeleteChat({target,close}) {
        const [busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
        const ref=React.useRef(null);
        React.useEffect(()=>{ref.current.showModal();},[]);
        async function remove() {
          setBusy(true);
          try {
            const next=await a.deleteChat(target.id);
            const workspace=ctx.uiWorkspace;
            const wasOpen=workspace.selection.getSnapshot().sessionId===target.id;
            if(wasOpen)workspace.clearMain();
            ctx.sessions.handleSessionRemoved(target.id);
            close();
            if(wasOpen){
              if(next)workspace.openSession(next);
              else {
                history.replaceState(null,'','/app/');
                await workspace.openWorkspace('personal');
              }
            }
          } catch(e){setError(e.message);setBusy(false);}
        }
        return h('dialog',{ref,className:'account-dialog','aria-labelledby':'delete-chat-title',
          onCancel:e=>{if(busy)e.preventDefault();else close();}},
          h('h2',{id:'delete-chat-title'},'Удалить чат?'),
          h('p',null,'История переписки «'+target.title+'» будет удалена.'),
          error && h('p',{role:'alert'},error),
          h('div',{className:'delete-chat-actions'},
            h('button',{type:'button',disabled:busy,onClick:close},'Отмена'),
            h('button',{type:'button',disabled:busy,onClick:remove},'Удалить чат')));
      }
      function Dialog() {
        const mode=usePanel(), ref=React.useRef(null);
        React.useEffect(()=>{if(mode && ref.current && !ref.current.open)ref.current.showModal();},[mode]);
        const close=()=>{select('');if(['/register','/login'].includes(location.pathname))history.replaceState(null,'',a.selected ? '/app/chats/'+encodeURIComponent(a.selected) : '/');};
        if(!mode)return null;
        if(mode==='delete-chat')return h(DeleteChat,{target:deletion,close});
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
            h('a',{className:'auth-alternative',href:signup?'/login':'/register'},signup?'Войти в существующий аккаунт':'Создать аккаунт')));
      }
      ctx.slots.inject('sidebar.footer.action',()=>ctx.slots.register({name:'sidebar.footer.action',id:'harness-account'},Footer));
      ctx.slots.inject('shell.overlay',()=>ctx.slots.register({name:'shell.overlay',id:'harness-auth'},Dialog));
      function Cost({seq,sessionId}) {
        const cost=a.costs.get(sessionId+'|'+seq);
        if(!cost) return null;
        if ('coins' in cost) {
          const labels=[];
          for(const [provider,t] of Object.entries(cost.providers||{}))labels.push(provider,'Вход '+t.input,'Кэш '+t.cache,'Выход '+t.output,'Всего '+(t.input+t.cache+t.output)+' токенов');
          if(cost.rub!==null)labels.push(cost.rub.replace('.',',')+' ₽');
          labels.push('Списано '+cost.coins.replace('.',',')+' монет');
          if(cost.pending)labels.push('На сверке');
          return h('small',{className:'model-cost'},labels.join(' · '));
        }
        const amount=cost.rub ?? cost.usd;
        return h('small',{className:'model-cost'},amount ?
          'Оценка стоимости · '+amount.replace('.',',')+(cost.rub?' ₽':' USD') : 'Оценка стоимости пока недоступна');
      }
      if(a.canGrant)ctx.slots.inject('conversation.chat.turnTail',()=>ctx.slots.register({
        name:'conversation.chat.turnTail',id:'harness-cost',inject:sessionId=>({sessionId})
      },Cost));
      ctx.effect(()=>{
        const update=({detail})=>ctx.sessions.handleSessionActivity(detail.id,detail.at);
        a.activityEvents.addEventListener('activity', update);
        return ()=>a.activityEvents.removeEventListener('activity', update);
      },'account chat activity');
      const selection=ctx.uiWorkspace.selection;
      const sync=()=>{
        const current=selection.getSnapshot().sessionId;
        if(current && !panel){
          const path='/app/chats/'+encodeURIComponent(current);
          if(location.pathname!==path)history.replaceState(null,'',path);
        }
      };
      ctx.effect(()=>selection.subscribe(sync),'account session links');
    }};
  }
});
