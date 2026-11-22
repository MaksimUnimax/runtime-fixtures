(() => {
  const sampleMs = 15000;
  const idleMs = 60000;
  const page = document.body;
  const account = page.dataset.account ? JSON.parse(page.dataset.account) : null;
  const memberPage = Boolean(account?.login) || page.classList.contains('octo-admin');
  const foreground = () =>
    (memberPage || document.documentElement.dataset.session === 'member') && !document.hidden && document.hasFocus();
  let lastActivity = performance.now();
  let since = null;
  let session;
  let enrolling = false;

  async function enroll() {
    if (enrolling || session !== undefined) return;
    enrolling = true;
    try {
      const response = await fetch('/api/account/activity',{cache:'no-store'});
      if (response.ok) {
        session = (await response.json()).session;
        if (foreground()) since = performance.now();
      } else if (response.status === 401) session = null;
    } catch {}
    finally { enrolling = false; }
  }

  function sample(now, leaving = false) {
    const end = Math.min(now, lastActivity + idleMs);
    const seconds = since === null ? 0 : Math.min(20, Math.floor((end - since) / 1000));
    if (seconds > 0 && session) {
      fetch('/api/account/activity', {
        method: 'POST', body: new URLSearchParams({seconds,session}), credentials: 'same-origin',
        keepalive: true, cache: 'no-store'
      }).then(response=>{if(response.status===401){session=null;since=null;}}).catch(() => {});
    }
    since = session && !leaving && foreground() && now < lastActivity + idleMs ? now : null;
    if (!leaving && foreground() && now < lastActivity+idleMs) enroll();
  }

  function interact() {
    const now = performance.now();
    if (now >= lastActivity + idleMs) sample(now);
    lastActivity = now;
    if (foreground()) {
      enroll();
      if (session && since === null) since = now;
    }
  }

  for (const event of ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart']) {
    window.addEventListener(event, interact, {passive: true, capture: true});
  }
  window.addEventListener('focus', interact);
  window.addEventListener('blur', () => sample(performance.now(), true));
  window.addEventListener('pagehide', () => sample(performance.now(), true));
  window.addEventListener('pageshow', interact);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) sample(performance.now(), true);
    else interact();
  });
  if (!memberPage) {
    new MutationObserver(interact).observe(document.documentElement,{attributeFilter:['data-session']});
  }
  interact();
  setInterval(() => sample(performance.now()), sampleMs);
})();
