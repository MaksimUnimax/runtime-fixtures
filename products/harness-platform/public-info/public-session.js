(() => {
  const root = document.documentElement;
  const cabinetLinks = document.querySelectorAll('[data-cabinet]');
  let request;

  function clear() {
    request?.abort();
    request = undefined;
    delete root.dataset.session;
    for (const link of cabinetLinks) link.href = '/login';
  }

  async function refresh() {
    clear();
    const current = new AbortController();
    request = current;
    try {
      const response = await fetch('/api/session/status', {
        credentials: 'same-origin', cache: 'no-store', signal: current.signal
      });
      if (!response.ok) return;
      const state = await response.json();
      if (!current.signal.aborted && typeof state.authenticated === 'boolean') {
        if (state.authenticated) {
          for (const link of cabinetLinks) link.href = '/app/';
        }
        root.dataset.session = state.authenticated ? 'member' : 'guest';
      }
    } catch {
      // The chat link works for either session while the status is unavailable.
    }
  }

  window.addEventListener('pagehide', clear);
  document.addEventListener('visibilitychange', () => document.hidden ? clear() : refresh());
  window.addEventListener('pageshow', () => { if (!document.hidden && !root.dataset.session && !request) refresh(); });
  refresh();
})();
