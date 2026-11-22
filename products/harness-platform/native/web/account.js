window.__ModuleLoader__.load({
  id:'harness-account',
  factory(require) {
    const React=require('react'), h=React.createElement;
    return {inject:['slots','uiWorkspace','sessions','contextMenus'],apply(ctx) {
      const a=window.harnessAccount;
      ctx.inject(['theme'], scope => {
        const adopt=()=>scope.theme.setTheme(window.octoTheme.preference());
        document.addEventListener('octo-theme', adopt);
        scope.effect(()=>()=>document.removeEventListener('octo-theme', adopt));
        adopt();
      });
      const ui=require('@deepseek-ai/dsh-client-ui-primitives');
      const {Sidebar:PluginSidebar,Catalog:PluginCatalog,CatalogSettings}=window.octoPluginMenu(React,ctx,a.api,ui);
      const {Menu,Modal,Button,IconUserOutlineMedium,IconSettingsOutlineMedium,IconChevronRightOutlineRegular,
        IconEllipsisOutlineMedium}=ui;
      const subscribers=new Set();
      const entry=new URL(location.href);
      const requested=entry.searchParams.get('account');
      let openSettingsOnMount=!a.guest && requested==='settings';
      let panel=a.panel || (!a.guest && ['profile','wallet'].includes(requested) ? requested : '');
      if (requested) {
        entry.searchParams.delete('account');
        history.replaceState(history.state,'',entry);
      }
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
      function Coin() {
        return h('svg',{className:'octo-coin',width:18,height:18,viewBox:'0 0 24 24',
          fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},
          h('ellipse',{cx:12,cy:8,rx:8,ry:4}),
          h('path',{d:'M4 8v4c0 2.2 3.6 4 8 4s8-1.8 8-4V8M4 12v4c0 2.2 3.6 4 8 4s8-1.8 8-4v-4'}));
      }
      function AccountLauncher({wide,openSettings,settingsShortcut}) {
        React.useEffect(()=>{
          if(openSettingsOnMount && openSettings){openSettingsOnMount=false; openSettings();}
        },[openSettings]);
        const available=useAvailableCoins();
        const [open,setOpen]=React.useState(false);
        const trigger=React.useRef(null), logout=React.useRef(null);
        const login=a.login || 'Аккаунт';
        const name=login.includes('@') ? login.slice(0,login.lastIndexOf('@')) || login : login;
        const balance=available==null?'—':coinAmount.format(available)+' монет';
        const items=[
          ...(!a.guest ? [
            {id:'profile',label:'Профиль',icon:h(IconUserOutlineMedium,{size:16})},
            {id:'wallet',label:'Баланс',icon:h(Coin)}
          ] : wide ? [] : [
            {id:'login',label:'Войти'},
            {id:'register',label:'Создать аккаунт'}
          ]),
          {id:'settings',label:'Настройки',icon:h(IconSettingsOutlineMedium,{size:16}),shortcut:settingsShortcut},
          {id:'about',label:'О сервисе'},
          ...(a.canGrant ? [{id:'admin',label:'Администрирование'}] : []),
          ...(!a.guest ? [{id:'divider',type:'separator'},{id:'logout',label:'Выйти'}] : [])
        ];
        const commands={
          profile:()=>select('profile'),wallet:()=>select('wallet'),
          login:()=>select('login'),register:()=>location.assign('/register'),settings:openSettings,
          about:()=>location.assign('/about/'),admin:()=>location.assign('/admin'),logout:()=>logout.current.requestSubmit()
        };
        return h('div',{className:'account-actions','data-wide':wide},
          a.guest && wide && h(React.Fragment,null,
            h('button',{type:'button',onClick:()=>select('login')},'Войти'),
            h('a',{href:'/register'},'Создать аккаунт')),
          !a.guest && h('button',{type:'button',className:'balance-action','aria-label':'Баланс','aria-haspopup':'dialog',
            title:balance,onClick:()=>select('wallet')},h(Coin),wide && h('span',{className:'sidebar-coins'},balance)),
          h(Menu,{open,portal:true,autoFocus:true,side:'top',align:'start',
            className:'octo-account-anchor',listClassName:'octo-account-menu',items,
            anchor:h('button',{ref:trigger,type:'button',className:'octo-account-trigger',
              'aria-label':a.guest?'Меню':'Меню аккаунта','aria-haspopup':'menu','aria-expanded':open,
              title:a.guest?'Меню':login,onClick:()=>setOpen(value=>!value)},
              h(a.guest?IconEllipsisOutlineMedium:IconUserOutlineMedium,{size:18}),
              wide && h('span',{className:'octo-account-name'},a.guest?'Меню':name),
              wide && h(IconChevronRightOutlineRegular,{size:14})),
            onClose:()=>setOpen(false),onSelect:id=>{
              setOpen(false);
              trigger.current?.focus();
              commands[id]?.();
            }}),
          !a.guest && h('form',{ref:logout,action:'/logout',method:'post',hidden:true}));
      }
      function Field(name,title,props={}) {
        return h('label',{key:name},title,h('input',{name,required:true,...props}));
      }
      function Profile() {
        const [busy,setBusy]=React.useState(false);
        const [message,setMessage]=React.useState(null);
        async function submit(event) {
          event.preventDefault();
          const form=event.currentTarget;
          const fields=new FormData(form);
          fields.delete('username');
          if(fields.get('password')!==fields.get('confirmation')) {
            setMessage({error:true,text:'Новые пароли не совпадают.'});
            return;
          }
          setBusy(true);
          setMessage(null);
          try {
            await a.api('/api/profile/password',{method:'POST',body:new URLSearchParams(fields)});
            form.reset();
            setMessage({error:false,text:'Пароль изменён. На других устройствах потребуется войти снова.'});
          } catch(error) {
            setMessage({error:true,text:error.message});
          } finally {
            setBusy(false);
          }
        }
        const password={type:'password',maxLength:256};
        return h(React.Fragment,null,
          h('div',{className:'octo-profile-identity'},h(IconUserOutlineMedium,{size:18}),h('span',null,a.login)),
          h('form',{className:'octo-password-form',method:'post',action:'/api/profile/password',onSubmit:submit},
            h('input',{type:'text',name:'username',autoComplete:'username',value:a.login||'',readOnly:true,hidden:true}),
            Field('current','Текущий пароль',{...password,autoComplete:'current-password',disabled:busy}),
            Field('password','Новый пароль',{...password,autoComplete:'new-password',disabled:busy}),
            Field('confirmation','Повторите новый пароль',{...password,autoComplete:'new-password',disabled:busy}),
            h(Button,{type:'submit',variant:'primary',disabled:busy},busy?'Сохраняем…':'Изменить пароль')),
          message && h('p',{role:message.error?'alert':'status'},message.text));
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
          h('a',{className:'octo-wallet-topup',href:'#buy-coins','data-buy-coins':''},'Купить монеты'),
          wallet.reserved!=='0' && h('p',null,'Ожидает расчёта · '+coinAmount.format(wallet.reserved)),
          wallet.charges.length>0 && h('div',{className:'wallet-charges'},
            h(Button,{type:'button',variant:'outline','aria-expanded':showCharges,'aria-controls':historyId,
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
        if(mode==='plugins')return h(PluginCatalog,{close});
        if(mode==='notice') return h('dialog',{className:'account-dialog',ref,onCancel:close},
          h('h2',null,a.error),h('button',{type:'button',onClick:close},'Закрыть'));
        const closeButton=h('button',{className:'account-close',type:'button','aria-label':'Закрыть',onClick:close},'×');
        if(mode==='wallet' || mode==='profile') {
          const wallet=mode==='wallet', title=wallet?'Баланс':'Профиль';
          return h(Modal,{open:true,title,onClose:close,className:'octo-account-panel',closeLabel:'Закрыть'},
            h('div',{className:wallet?'octo-wallet-body':'octo-profile-body'},wallet?h(Wallet):h(Profile)));
        }
        const signup=mode==='register';
        return h('dialog',{className:'account-dialog',ref,'aria-labelledby':'dialog-title',onCancel:close},
          closeButton,h('h2',{id:'dialog-title'},signup?'Создать аккаунт':'Вход в octoport'),
          signup && h('p',null,'За первую регистрацию вы получите 10 монет для работы в Октопорте.'),
          a.error && h('p',{role:'alert'},a.error),
          h('form',{action:signup?'/register':'/login',method:'post'},
            Field('login','Логин',{autoComplete:'username',maxLength:254}),
            Field('password','Пароль',{type:'password',autoComplete:signup?'new-password':'current-password',maxLength:256}),
            
            h('button',{type:'submit',className:'account-primary'},signup?'Создать аккаунт':'Войти')),
            h('a',{className:'auth-alternative',href:signup?'/login':'/register'},signup?'Войти в существующий аккаунт':'Создать аккаунт'));
      }
      ctx.slots.inject('settings.launcher',()=>ctx.slots.register({name:'settings.launcher'},AccountLauncher));
      if (!a.guest) {
        ctx.slots.inject('sidebar.workspaces.afterList',()=>ctx.slots.register({
          name:'sidebar.workspaces.afterList'
        },props=>h(PluginSidebar,{...props,openCatalog:()=>select('plugins')})));
        ctx.slots.inject('settings.section',()=>ctx.slots.register({
          name:'settings.section',id:'plugins',order:6,label:()=>'Плагины'
        },CatalogSettings));
      }
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
      function Illustration({seq,sessionId}) {
        const url=a.illustrations.get(sessionId+'|'+seq);
        if(!url)return null;
        return h('a',{href:url,target:'_blank',rel:'noopener',className:'chat-illustration'},
          h('img',{src:url,alt:'Иллюстрация к ответу',loading:'lazy'}),h('span',null,'Открыть иллюстрацию'));
      }
      if(!a.guest)ctx.slots.inject('conversation.chat.turnTail',()=>ctx.slots.register({
        name:'conversation.chat.turnTail',id:'chat-illustration',inject:sessionId=>({sessionId})
      },Illustration));
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
