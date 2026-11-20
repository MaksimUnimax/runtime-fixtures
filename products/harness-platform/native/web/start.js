import { createTransport } from './transport.js';

try {
  const transport = await createTransport(document.body.dataset);
  window.harnessAccount = transport.account;
  window.__DSH_TRANSPORT__ = {rpc: transport.rpc};
  window.__DSH_REMOTE_ACCESS__ = transport.access();
  window.__DSH_LOCALE__ = {read:async () => ({languages:['ru'], preference:'ru'}), onChange() {}};
  window.__DSH_SHORTCUTS_CONFIG__ = {stopSequenceMs:500};
  (window.__DSH_BOOT_READY__ ??= Promise.withResolvers()).resolve();
  await import('/ui-assets/harness/dsh-web-frontend/dist/assets/index-BgUyXZcc.js');
} catch (error) {
  document.getElementById('root').textContent = 'Не удалось открыть Harness. Обновите страницу.';
  console.error('Harness startup failed', error);
}
