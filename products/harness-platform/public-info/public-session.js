(() => {
  const root = document.documentElement;
  const auth = document.querySelector('#public-auth'), form = auth.querySelector('form');
  const title = auth.querySelector('h2'), submit = form.querySelector('button'), swap = auth.querySelector('[data-switch-auth]');
  const alert = auth.querySelector('[role=alert]'), bonus = auth.querySelector('[data-signup-note]');
  const coins = new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2, maximumFractionDigits:2});
  let statusRequest, guestRequest, mode, signupReady = false, posting = false;
  function state(member = false, data = {}) {
    root.dataset.session = member ? 'member' : 'guest';
    document.querySelectorAll('.member-menu').forEach(menu => {menu.open=false;});
    document.querySelectorAll('[data-admin]').forEach(link => {link.hidden=!data.admin;});
    const login = data.login || 'Аккаунт';
    const name = login.includes('@') ? login.slice(0, login.lastIndexOf('@')) || login : login;
    document.querySelectorAll('[data-member-name]').forEach(label => {
      label.textContent = name;
      label.title = login;
    });
    document.querySelectorAll('[data-balance]').forEach(label => {
      label.textContent = data.available == null ? '—' : coins.format(data.available)+' монет';
    });
  }
  async function refresh() {
    statusRequest?.abort();
    const request = new AbortController();
    statusRequest = request;
    try {
      const r = await fetch('/api/session/status?menu=1',{cache:'no-store',signal:request.signal});
      if (!r.ok) throw Error();
      const data = await r.json();
      if (!request.signal.aborted) state(data.authenticated === true,data);
      return data.authenticated === true;
    } catch {
      if (!request.signal.aborted) state();
      return false;
    }
  }
  async function startGuest() {
    const response = await fetch('/guest/session', {method:'POST', cache:'no-store'});
    if (!response.ok) throw Error('Не удалось открыть гостевой чат.');
    return (await response.json()).chat;
  }
  function guest() {
    if (!guestRequest) {
      const start = navigator.locks ? navigator.locks.request('octoport.guest.session', startGuest) : startGuest();
      guestRequest = start.finally(() => {guestRequest=null;});
    }
    return guestRequest;
  }
  window.octoGuestSession = guest;
  function message(text='') {alert.textContent=text;alert.hidden=!text;}
  function open(next) {
    if (posting) return;
    const signup = next === 'register';
    mode = signup ? 'register' : 'login';
    title.textContent = signup ? 'Создать аккаунт' : 'Вход в Октопорт';
    submit.textContent = signup ? 'Создать аккаунт' : 'Войти';
    swap.textContent = signup ? 'Войти в существующий аккаунт' : 'Создать аккаунт';
    form.action = '/'+mode;
    form.elements.password.autocomplete = signup ? 'new-password' : 'current-password';
    form.elements.password.value = '';
    signupReady=false;
    bonus.hidden = !signup;
    message();
    if (!auth.open) auth.showModal();
    form.elements.login.focus({preventScroll:true});
  }
  const closeButton=auth.querySelector('.octo-auth-close');
  closeButton.onclick=()=>auth.close();
  auth.addEventListener('cancel',event=>{if(posting)event.preventDefault();});
  auth.addEventListener('close',()=>{form.reset();message();});
  swap.onclick=()=>open(mode==='register'?'login':'register');
  document.addEventListener('click',event=>{
    const link=event.target.closest('a');
    if (link && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey &&
        ['/register','/login'].includes(link.getAttribute('href'))) {
      event.preventDefault(); open(link.pathname.slice(1));
    }
    document.querySelectorAll('.member-menu[open]').forEach(menu=>{if(!menu.contains(event.target))menu.open=false;});
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape') document.querySelectorAll('.member-menu[open]').forEach(menu=>{menu.open=false;menu.querySelector('summary').focus();});
  });
  document.addEventListener('octo-login',()=>open('login'));
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(posting)return;
    posting=true;submit.disabled=swap.disabled=closeButton.disabled=true;
    message();
    try {
      if(mode==='register' && !signupReady) { await guest(); signupReady=true; }
      const data=new URLSearchParams(new FormData(form));
      const r=await fetch(form.action,{method:'POST',body:data,headers:{Accept:'application/json'},cache:'no-store'});
      const result=await r.json();
      if(!r.ok||!result.authenticated) {
        if(r.status===401)signupReady=false;
        throw Error(result.detail||'Не удалось войти. Проверьте логин и пароль.');
      }
      signupReady=false;
      auth.close();
      state(true);
      await refresh();
      try {localStorage.setItem('octoport.account.changed',String(Date.now()));} catch {}
      if (['/register','/login'].includes(location.pathname)) {
        location.replace('/app/');
        return;
      }
      document.dispatchEvent(new CustomEvent('octo-authenticated',{detail:{registered:mode==='register'}}));
    } catch(error){message(error instanceof TypeError?'Ошибка связи. Повторите попытку.':error.message);}
    finally {posting=false;submit.disabled=swap.disabled=closeButton.disabled=false;}
  });
  window.addEventListener('pagehide',()=>{statusRequest?.abort();state();});
  window.addEventListener('pageshow',event=>{if(event.persisted)refresh();});
  window.addEventListener('storage',event=>{if(event.key==='octoport.account.changed')refresh();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  refresh();
  if(['login','register'].includes(document.body.dataset.authEntry)) {
    open(document.body.dataset.authEntry);
    message(document.body.dataset.authError);
  }
})();
