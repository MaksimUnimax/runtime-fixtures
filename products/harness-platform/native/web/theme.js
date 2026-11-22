(() => {
  const root = document.documentElement, media = matchMedia('(prefers-color-scheme: dark)');
  const modes = ['system', 'light', 'dark'];
  function preference() {
    return document.cookie.match(/(?:^|;\s*)octoport_theme=(system|light|dark)(?:;|$)/)?.[1] || 'system';
  }
  function apply() {
    const mode = preference();
    const shade = mode === 'system' ? (media.matches ? 'dark' : 'light') : mode;
    const changed = root.dataset.theme !== mode || root.dataset.appearance !== shade;
    root.dataset.theme = mode;
    root.dataset.appearance = shade;
    document.querySelectorAll('[data-theme-select]').forEach(select => { select.value = mode; });
    if (changed) document.dispatchEvent(new CustomEvent('octo-theme', {detail:mode}));
  }
  function set(mode) {
    if (!modes.includes(mode)) return;
    if (preference() !== mode) {
      document.cookie = 'octoport_theme='+mode+'; Path=/; Max-Age=31536000; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'');
      try { localStorage.setItem('octoport.theme.changed', mode+':'+Date.now()); } catch {}
    }
    apply();
  }
  window.octoTheme = {set, preference};
  media.addEventListener('change', apply);
  window.addEventListener('storage', event => { if (event.key === 'octoport.theme.changed') apply(); });
  window.addEventListener('pageshow', apply);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) apply(); });
  document.addEventListener('DOMContentLoaded', apply);
  document.addEventListener('change', event => { if (event.target.matches('[data-theme-select]')) set(event.target.value); });
  apply();
})();
