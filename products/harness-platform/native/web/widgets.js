// The stock frontend supplies its pinned React, Cordis and UI runtime through
// the documented client-modules bootstrap. Product data never enters a Host RPC.
import { installWidgetHost } from './widget-host.js';

const release = '0.2.2-rc.1';
const group = '@deepseek-ai/';
const project = 'harness-platform-chat';
const uiBase = '/ui-assets/harness/';
const packageUrl = name => uiBase + name + '/lib/client.js';
let initialization;

async function loadScript(url) {
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Не удалось загрузить компонент Harness'));
    document.head.append(script);
  });
}

async function initialize() {
  const hidden = document.createElement('div');
  hidden.id = 'root';
  hidden.hidden = true;
  document.body.append(hidden);
  const modules = 'dsh-client-modules';
  const imports = [modules, 'dsh-client-ui-conversation', 'dsh-client-ui-chat', 'dsh-client-ui-trajectory'];
  const factories = new Map();
  const mounted = Promise.withResolvers();
  const rows = [
    { id: group + modules, rev: release, url: packageUrl(modules) },
    { id: project, rev: release, url: '/ui-assets/project/widgets.js' },
  ];
  window.__DSH_BOOT__ = {
    rev: release, release: { version: release }, entries: rows,
    batches: rows.map((row, index) => ({
      phase: index ? 'application' : 'bootstrap', url: row.url, rev: row.rev, entries: [row.id],
    })),
  };
  window.__ModuleLoader__ = {
    mode: 'queue', pendingQueue: [],
    load(registration) { factories.set(registration.id, registration.factory); },
    create(options) {
      const require = id => {
        if (!(id in options.staticModules)) throw new Error('Unavailable browser module: ' + id);
        return options.staticModules[id];
      };
      const whale = 'plugins/@deepseek-ai/dsh-client-ui-chat/assets/running-whale%402x-06738fa29b2f.png';
      require.asset = name => {
        if (name !== whale) throw new Error('Unknown native display asset');
        return uiBase + 'dsh-client-ui-chat/lib/assets/running-whale%402x-06738fa29b2f.png';
      };
      const plugin = name => factories.get(group + name)(require);
      const core = plugin(modules);
      this.pendingQueue.push({ id: project, factory: () => ({
        apply(ctx) {
          try {
            const render = installWidgetHost({ require, plugin });
            ctx.reflect.provide('uiRenderer', { mount(container) {
              container.replaceChildren();
              mounted.resolve(render);
              return () => {};
            } });
          } catch (error) { mounted.reject(error); throw error; }
        },
      }) });
      return core.createClientModuleSystem(this, { id: group + modules, exports: core }, options);
    },
  };
  for (const name of imports) await loadScript(packageUrl(name));
  const assets = uiBase + 'dsh-web-frontend/dist/assets/';
  for (const name of ['vendor-DV2921Zo.css', 'index-lh_YM6sT.css']) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = assets + name;
    document.head.append(link);
  }
  await import(assets + 'index-BgUyXZcc.js');
  // Boot errors from the release shell appear in its own boot DOM. Give the
  // product caller a bounded failure even when the upstream kernel stops early.
  let timeout;
  try {
    return await Promise.race([mounted.promise, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Не удалось открыть штатное окно Harness')), 12_000);
    })]);
  } finally { clearTimeout(timeout); }
}

export async function renderTranscript(element, data) {
  initialization ??= initialize();
  const render = await initialization;
  render(element, data);
}
