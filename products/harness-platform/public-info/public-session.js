(() => {
  const root = document.documentElement;
  let request;

  function clear() {
    request?.abort();
    request = undefined;
    delete root.dataset.session;
    document.querySelectorAll('.member-menu').forEach(menu => { menu.open = false; });
    document.querySelectorAll('[data-admin]').forEach(link => { link.hidden = true; });
    document.querySelectorAll('[data-member-name]').forEach(label => { label.textContent = 'Аккаунт'; });
  }

  async function refresh() {
    clear();
    const current = new AbortController();
    request = current;
    try {
      const response = await fetch('/api/session/status?menu=1', {
        credentials: 'same-origin', cache: 'no-store', signal: current.signal
      });
      if (!response.ok) return;
      const state = await response.json();
      if (!current.signal.aborted && typeof state.authenticated === 'boolean') {
        if (state.authenticated) {
          const name = (state.login || 'Аккаунт').split('@')[0] || 'Аккаунт';
          document.querySelectorAll('[data-member-name]').forEach(label => { label.textContent = name; });
          document.querySelectorAll('[data-admin]').forEach(link => { link.hidden = !state.admin; });
        }
        root.dataset.session = state.authenticated ? 'member' : 'guest';
      }
    } catch {
      // The chat link works for either session while the status is unavailable.
    }
  }

  document.addEventListener('click', event => {
    document.querySelectorAll('.member-menu[open]').forEach(menu => {
      if (!menu.contains(event.target)) menu.open = false;
    });
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    document.querySelectorAll('.member-menu[open]').forEach(menu => {
      menu.open = false;
      menu.querySelector('summary').focus();
    });
  });
  window.addEventListener('pagehide', clear);
  document.addEventListener('visibilitychange', () => document.hidden ? clear() : refresh());
  window.addEventListener('pageshow', () => { if (!document.hidden && !root.dataset.session && !request) refresh(); });
  refresh();
})();
