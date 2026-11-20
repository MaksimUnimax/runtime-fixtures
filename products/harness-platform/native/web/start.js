try {
  const styles = Array.from(document.querySelectorAll('link[data-chat-style]'), link => new Promise((resolve, reject) => {
    link.onload = resolve;
    link.onerror = () => reject(new Error('Chat stylesheet failed to load'));
    link.rel = 'stylesheet';
  }));
  const transportReady = import('./transport.js').then(({createTransport}) => createTransport(document.body.dataset));
  const [transport] = await Promise.all([transportReady, ...styles]);
  window.harnessAccount = transport.account;
  window.__DSH_TRANSPORT__ = {rpc: transport.rpc};
  window.__DSH_REMOTE_ACCESS__ = transport.access();
  window.__DSH_LOCALE__ = {read:async () => ({languages:['ru'], preference:'ru'}), onChange() {}};
  window.__DSH_SHORTCUTS_CONFIG__ = {stopSequenceMs:500};
  (window.__DSH_BOOT_READY__ ??= Promise.withResolvers()).resolve();
  await import('/ui-assets/harness/dsh-web-frontend/dist/assets/index-BgUyXZcc.js');
  document.getElementById('chat-opening')?.remove();
} catch (error) {
  const status = document.querySelector('#chat-opening [role="status"]');
  if (status) status.textContent = 'Не удалось открыть чат.';
  console.error('Harness startup failed', error);
}
