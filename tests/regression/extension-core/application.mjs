import assert from 'node:assert/strict';
import path from 'node:path';
import { makeWorker, until } from './worker-harness.mjs';
const runtime = path.resolve(process.argv[2]);
const results = [];
async function test(id, fn) { await fn(); results.push({ id, status: 'PASS' }); }
const wb = token => ({ marketplace: 'wildberries', credentials: { token }, personalDataEnabled: true });
const ozon = (id, key) => ({ marketplace: 'ozon', credentials: { seller: { clientId: id, apiKey: key } }, personalDataEnabled: true });
const fixtureToken = 'FIXTURE_PERSONAL_WB_NEVER_REAL';
const api = 'WB_API_V1 {"operation":"seller_info","params":{}}';
const plain = x => JSON.parse(JSON.stringify(x));
function fakeIDB() {
  const records = new Map();
  const stats = { reads: 0, writes: 0 };
  return { records, open() {
    const request = {};
    queueMicrotask(() => { request.result = { objectStoreNames: { contains: () => true }, close() {}, transaction() {
      const tx = { objectStore() { const op = (kind, value) => {
        const r = {};
        queueMicrotask(() => { if (kind === 'get' || kind === 'all') stats.reads++;
          if (kind === 'put') { stats.writes++; records.set(value.artifact_key, value); }
          if (kind === 'delete') { stats.writes++; records.delete(value); }
          r.result = kind === 'get' ? records.get(value) : kind === 'all' ? [...records.values()] : value?.artifact_key;
          r.onsuccess?.(); queueMicrotask(() => tx.oncomplete?.()); }); return r;
      }; return { get: k => op('get', k), put: v => op('put', v), delete: k => op('delete', k), getAll: () => op('all') }; } }; return tx;
    } }; request.onsuccess?.(); }); return request;
  }, stats };
}
async function popupState(worker, tabId) {
  return worker.request({ type: 'SA_POPUP_STATE', tab_id: tabId }, { url: 'chrome-extension://core-fixture/popup.html' });
}
await test('APP-00-popup-state-is-available-without-AI-tab', async () => {
  const signedOut = await makeWorker(runtime, { seedAuthority: false, fetch: async () => { throw new Error('signed-out popup must not call control plane'); } });
  try {
    for (const tabId of [999, 0, 1001]) {
      const state = await popupState(signedOut, tabId);
      assert.equal(state.ok, true, JSON.stringify(state));
      assert.deepEqual(plain(state.identity), { ai_id: null, origin: null, conversation_id: null, status: 'unavailable', source: 'none', chat_path: '' });
      assert.equal(state.conversation_key, null); assert.equal(state.pending, null); assert.equal(state.work, null); assert.equal(state.operation, null);
      assert.equal(state.context.work_active, false); assert.equal(state.context.button_visible, false);
    }
  } finally { signedOut.close(); }

  const pending = await makeWorker(runtime, { seedAuthority: false, fetch: async url => {
    if (url.endsWith('/v1/device-authorizations')) return new Response(JSON.stringify({ status: 'pending', authorizationId: '44444444-4444-4444-8444-444444444444', deviceCode: 'D'.repeat(43), userCode: 'ABCD-EFGH', expiresAt: new Date(Date.now() + 60000).toISOString() }), { headers: { 'content-type': 'application/json' } });
    throw new Error('unexpected pending fixture request ' + url);
  } });
  try {
    const started = await pending.request({ type: 'SA_AUTH_START', tab_id: pending.tabId }, { url: 'chrome-extension://core-fixture/popup.html' }); assert.equal(started.ok, true, JSON.stringify(started)); assert.equal(started.auth.pending.userCode, 'ABCD-EFGH');
    const state = await popupState(pending, 999);
    assert.equal(state.ok, true, JSON.stringify(state)); assert.equal(state.auth.pending.userCode, 'ABCD-EFGH');
    assert.deepEqual(plain(state.identity), { ai_id: null, origin: null, conversation_id: null, status: 'unavailable', source: 'none', chat_path: '' });
    assert.equal(state.account.kind, 'signed_out'); assert.equal(state.stores.length, 0); assert.equal(state.work, null);
  } finally { pending.close(); }

  const accountOnly = await makeWorker(runtime);
  try {
    const saved = await accountOnly.request({ type: 'SA_STORE_SAVE', tab_id: accountOnly.tabId, store: wb('FIXTURE_ACCOUNT_ONLY_TOKEN') }, { url: 'chrome-extension://core-fixture/popup.html' }); assert.equal(saved.ok, true, JSON.stringify(saved));
    const state = await popupState(accountOnly, 999);
    assert.equal(state.ok, true, JSON.stringify(state)); assert.equal(state.auth.authenticated, true); assert.equal(state.auth.accountId, accountOnly.accountId);
    assert.equal(state.stores.length, 1); assert.equal(state.stores[0].id, saved.store.id); assert.deepEqual(plain(state.identity), { ai_id: null, origin: null, conversation_id: null, status: 'unavailable', source: 'none', chat_path: '' });
    assert.equal(state.conversation_key, null); assert.equal(state.pending, null); assert.equal(state.work, null); assert.equal(state.operation, null); assert.equal(state.context.work_active, false);
  } finally { accountOnly.close(); }

  const supported = await makeWorker(runtime);
  try {
    const state = await popupState(supported, supported.tabId);
    assert.equal(state.ok, true, JSON.stringify(state)); assert.equal(state.identity.ai_id, 'chatgpt'); assert.equal(state.identity.conversation_id, supported.identity.conversation_id);
    assert.match(state.conversation_key, /chatgpt\.com\|core-fixture-dialogue/);
  } finally { supported.close(); }

  const noConversation = await makeWorker(runtime);
  try {
    noConversation.setDialogue('');
    const saved = await noConversation.request({ type: 'SA_STORE_SAVE', tab_id: noConversation.tabId, store: wb('FIXTURE_PENDING_START_TOKEN') }, { url: 'chrome-extension://core-fixture/popup.html' });
    const started = await noConversation.request({ type: 'SA_WORK_START', tab_id: noConversation.tabId, store_id: saved.store.id, confirm_change: true }, { url: 'chrome-extension://core-fixture/popup.html' });
    assert.equal(started.ok, true, JSON.stringify(started));
    const state = await popupState(noConversation, noConversation.tabId);
    assert.equal(state.identity.ai_id, 'chatgpt'); assert.equal(state.identity.conversation_id, null); assert.equal(state.conversation_key, null); assert.ok(state.pending);
  } finally { noConversation.close(); }
});
async function setup(options = {}) {
  const idb = fakeIDB();
  const worker = await makeWorker(runtime, { indexedDB: idb, fetch: async (url, init, n) => options.fetch ? options.fetch(url, init, n) : new Response('{"result":{"value":42}}', { headers: { 'content-type': 'application/json' } }), ...options });
  const popup = (type, fields = {}) => worker.popup({ type, tab_id: worker.tabId, ...fields });
  const initial = await popup('SA_POPUP_STATE'); assert.equal(initial.ok, true, JSON.stringify(initial));
  async function save(store) { const r = await popup('SA_STORE_SAVE', { store }); assert.equal(r.ok, true, JSON.stringify(r)); return r.store; }
  async function start(store, { tabId = worker.tabId, identity = worker.identity, sender, confirm = false } = {}) {
    const r = await popup('SA_WORK_START', { tab_id: tabId, store_id: store.id, confirm_change: confirm });
    assert.equal(r.ok, true, JSON.stringify(r));
    if (r.accepted === false) return r;
    const pending = await until(async () => { const p = (await worker.call('getPendingWorkStarts'))[tabId]; return p?.send_outcome === 'sent_acknowledged' && p; }, 'application Start send acknowledgement');
    const active = await worker.request({ type: 'OZ_WORK_PENDING_IDENTITY', identity, intent_id: pending.intent_id, revision: pending.revision, first_response_complete: true }, sender);
    assert.equal(active.ok, true, JSON.stringify(active));
    return { key: active.binding.conversation_key, session: active.session, identity, sender, tabId };
  }
  async function execute(started, source = api, requestId = 'explicit-fixture-block') {
    const r = await worker.request({ type: 'OZ_EXECUTE_COMMAND', conversation_key: started.key, command_text: source,
      manual_request_id: requestId, work_session_id: started.session.start_intent_id }, started.sender);
    assert.equal(r.ok, true, JSON.stringify(r)); return r;
  }
  async function collected(started) { return until(async () => { const o = await worker.call('getManualOperation', started.key); if (o?.status === 'failed') throw new Error(JSON.stringify(o.last_error)); return o?.status === 'delivering' && o; }, 'application result collected'); }
  async function deliver(started, owner) {
    const fields = { owner_kind: 'manual', owner_id: owner.operation_id, conversation_key: started.key, delivery_id: owner.delivery_id, actor_id: 'fixture-content' };
    const commit = await worker.request({ type: 'OZ_BATCH_DELIVERY_INSERT_COMMIT', ...fields }, started.sender);
    assert.equal(commit.insert_allowed, true, JSON.stringify(commit));
    const inserted = await worker.request({ type: 'OZ_BATCH_DELIVERY_INSERTED', ...fields }, started.sender);
    assert.equal(inserted.ok, true, JSON.stringify(inserted));
    const send = await worker.request({ type: 'OZ_WORK_SEND_COMMIT', ...fields }, started.sender);
    assert.equal(send.click_allowed, true, JSON.stringify(send));
    const twice = await worker.request({ type: 'OZ_WORK_SEND_COMMIT', ...fields }, started.sender);
    assert.equal(twice.click_allowed, false);
    const done = await worker.request({ type: 'OZ_BATCH_DELIVERY_COMPLETE', ...fields, delivery_confirmed: true, confirmation_basis: 'microphone' }, started.sender);
    assert.equal(done.ok, true, JSON.stringify(done));
    assert.equal((await worker.call("getManualOperation", started.key)).status, "completed");
    return fields;
  }
  return { worker, idb, popup, save, start, execute, collected, deliver };
}
await test('APP-01-popup-sender-catalog-names-and-secret-isolation', async () => {
  const s = await setup(); try {
    const denied = await s.worker.request({ type: 'SA_STORE_SAVE', store: wb(fixtureToken) }); assert.equal(denied.code, 'POPUP_SENDER_REQUIRED');
    for(const url of ['https://chatgpt.com/c/fixture','chrome-extension://other-extension/popup.html','chrome-extension://core-fixture/other.html']) {
      const response=await s.worker.request({type:'SA_POPUP_STATE',tab_id:s.worker.tabId},{url,tab:{id:999}});
      assert.equal(response.code,'POPUP_SENDER_REQUIRED');
    }
    const ownPage=await s.worker.request({type:'SA_POPUP_STATE',tab_id:s.worker.tabId},{url:'chrome-extension://core-fixture/popup.html',tab:{id:999}});
    assert.equal(ownPage.ok,true);
    const a = await s.save(wb(fixtureToken)), b = await s.save(wb('FIXTURE_SECOND'));
    assert.equal(a.name, 'WB 1'); assert.equal(b.name, 'WB 2'); assert.notEqual(a.id, b.id);
    const renamed = await s.save({ id: a.id, marketplace: a.marketplace, name: 'Новый магазин', personalDataEnabled: true });
    assert.equal(renamed.id, a.id); assert.equal(renamed.credentialRevision, a.credentialRevision);
    const state = await s.popup('SA_POPUP_STATE'); assert.ok(!JSON.stringify(state).includes(fixtureToken));
    assert.equal(s.worker.network.length, 0);
  } finally { s.worker.close(); }
});
await test('APP-02-real-WB-Start-HELP-API-common-text-delivery-durable-send-no-replay', async () => {
  const s = await setup(); try {
    const store = await s.save(wb(fixtureToken)), started = await s.start(store);
    assert.ok(s.worker.messages.find(x => x.prompt_text)?.prompt_text.includes('WB_HELP_V1'));
    await s.execute(started, 'WB_HELP_V1 {"operation":"describe","params":{"alias":"seller_info"}}\n'+api);
    const owner = await s.collected(started); assert.equal(s.worker.network.length, 1);
    assert.ok(owner.outgoing_text.startsWith('WB_BATCH_RESULT_V1')); assert.ok(owner.outgoing_text.includes(store.id));
    assert.deepEqual(plain(owner.batch.entries.map(x => x.kind)), ['guidance','command']);
    assert.equal(owner.execution_context.storeId, store.id);
    assert.ok(!JSON.stringify(owner).includes(fixtureToken));
    await s.deliver(started, owner);
    const duplicate = await s.worker.request({ type: 'OZ_EXECUTE_COMMAND', conversation_key: started.key, command_text: api, manual_request_id: 'explicit-fixture-block', work_session_id: started.session.start_intent_id });
    assert.equal(duplicate.code, 'MANUAL_REQUEST_DUPLICATE'); assert.equal(s.worker.network.length, 1);
  } finally { s.worker.close(); }
});
await test('APP-03-two-WB-stores-two-dialogues-pinned-credentials-and-Ozon', async () => {
  const seen = [];
  const s = await setup({ fetch: async (url, init) => { seen.push({ url, headers: init.headers }); return new Response('{"result":[]}', { headers: { 'content-type': 'application/json' } }); } }); try {
    const a = await s.save(wb(fixtureToken)), b = await s.save(wb('FIXTURE_TOKEN_B'));
    const first = await s.start(a), tab = s.worker.addTab(78, 'second-dialogue');
    const second = await s.start(b, { tabId: 78, ...tab });
    await Promise.all([s.execute(first), s.execute(second)]);
    await Promise.all([s.collected(first), s.collected(second)]);
    assert.deepEqual(seen.map(x=>x.headers.Authorization).sort(), ['Bearer '+fixtureToken, 'Bearer FIXTURE_TOKEN_B'].sort());
    const o = await s.save(ozon('FIXTURE_OZON_CLIENT', 'FIXTURE_OZON_KEY'));
    const thirdTab = s.worker.addTab(79, 'ozon-dialogue');
    const third = await s.start(o, { tabId: 79, ...thirdTab });
    await s.execute(third, 'OZON_API_V1 {"operation":"roles","params":{}}');
    const oo = await s.collected(third);
    assert.equal(oo.execution_context.marketplace, 'ozon');
    assert.equal(seen.at(-1).headers['Client-Id'], 'FIXTURE_OZON_CLIENT');
  } finally { s.worker.close(); }
});
await test('APP-04-Hide-stops-not-yet-dispatched-tail-and-Finish-stops-delivery', async () => {
  let release, arrived;
  const entered = new Promise(r => arrived = r), wait = new Promise(r => release = r);
  const s = await setup({ fetch: async () => { arrived(); await wait; return new Response('{}', { headers: { 'content-type': 'application/json' } }); } }); try {
    const start = await s.start(await s.save(wb(fixtureToken))); await s.execute(start, api+'\n'+api);
    await entered;
    assert.equal((await s.popup('OZ_WORK_HIDE', { conversation_key: start.key })).ok, true);
    release(); const owner = await s.collected(start); assert.equal(s.worker.network.length, 1);
    await s.deliver(start, owner);
    assert.equal((await s.popup('OZ_WORK_FINISH', { conversation_key: start.key })).ok, true);
    const late = await s.worker.request({ type: 'OZ_WORK_DELIVERY_ASSERT', conversation_key: start.key, owner_id: owner.operation_id, delivery_id: owner.delivery_id }); assert.equal(late.ok, false);
  } finally { release?.(); s.worker.close(); }
});
await test('APP-05-conflicting-store-confirmation-cannot-bypass-admission', async () => {
  let release, arrived;
  const entered = new Promise(r => arrived = r), wait = new Promise(r => release = r);
  const s = await setup({ fetch: async () => { arrived(); await wait; return new Response('{}', { headers: { 'content-type': 'application/json' } }); } }); try {
    const a = await s.save(wb(fixtureToken)), b = await s.save(wb('FIXTURE_NEW_STORE'));
    const first = await s.start(a); await s.execute(first, api+'\n'+api); await entered;
    const rejected = await s.popup('SA_WORK_START', { store_id: b.id }); assert.equal(rejected.code, 'STORE_CHANGE_CONFIRMATION_REQUIRED');
    const stillRejected = await s.popup('SA_WORK_START', { store_id: b.id, confirm_change: true });
    assert.equal(stillRejected.code, 'WORK_START_ALREADY_IN_PROGRESS');
    release(); await new Promise(r=>setTimeout(r,30));
    assert.equal(s.worker.network.length, 2);
    assert.equal((await s.worker.call('bindingForConversationKey', first.key)).store_context.storeId, a.id);
    assert.equal(s.worker.messages.filter(m=>m.type==='OZ_BATCH_DELIVERY_AVAILABLE').length,0);
    assert.equal((await s.worker.call('workSessionFor', first.key)).state,'active_visible');
  } finally { release?.(); s.worker.close(); }
});
await test('APP-06-TTL-recovery-no-renewal-and-legacy-autorun-disabled', async () => {
  const s = await setup(); try {
    const start = await s.start(await s.save(wb(fixtureToken))); await s.execute(start);
    const owner = await s.collected(start);
    const keys = await s.worker.call('(() => OzonRuntime.STORAGE_KEYS)');
    s.worker.backing.local[keys.MANUAL_OPERATIONS][start.key].payload_expires_at_ms = Date.now()-1;
    const expired = await s.worker.call('getManualOperation', start.key);
    assert.equal(expired.last_error.code,'RESULT_EXPIRED'); assert.equal(expired.outgoing_text,null); assert.equal(expired.batch,null);
    assert.equal((await s.worker.request({ type:'OZ_WORK_DELIVERY_ASSERT',conversation_key:start.key,owner_id:owner.operation_id,delivery_id:owner.delivery_id })).ok,false);
    assert.equal((await s.popup('OZ_AUTO_START',{conversation_key:start.key})).code,'LEGACY_ACTION_DISABLED');
    assert.equal(s.worker.network.length,1);
  } finally { s.worker.close(); }
});
await test('APP-07-binary-original-file-common-attachment-port-and-expiry', async () => {
  const bytes = new Uint8Array([37,80,68,70,45,49,10,0,255]);
  const s = await setup({ fetch: async () => new Response(bytes,{ headers: {'content-type':'application/pdf','content-disposition':'attachment; filename="original-report.pdf"'} }) }); try {
    s.worker.setDialogue('11111111-1111-4111-8111-111111111111');
    const store = await s.save(wb(fixtureToken)), start = await s.start(store);
    const ref = await s.worker.call('(() => SellerAgentsWBReference.contract)');
    const meta = Object.values(ref.OPERATIONS).find(m=>m.response_mode==='binary'&&m.execution_enabled&&m.privacy==='standard');
    assert.ok(meta);
    const params = { path:Object.fromEntries([...meta.path.matchAll(/\{([^}]+)\}/g)].map(m=>[m[1],'fixture'])),query:Object.fromEntries(meta.required_query_keys.map(k=>[k,'1'])),...(meta.body_required?{body:{}}:{}) };
    await s.execute(start,'WB_API_V1 '+JSON.stringify({operation:meta.alias,params}));
    const owner=await s.collected(start);
    assert.equal(owner.delivery.mode,'attachment_watch_v1');
    const fields={owner_kind:'manual',owner_id:owner.operation_id,conversation_key:start.key,delivery_id:owner.delivery_id,actor_id:'fixture-attachment'};
    const commit=await s.worker.portRequest({type:'OZ_ATTACHMENT_COMMIT',...fields}); assert.equal(commit.attach_allowed,true,JSON.stringify(commit));
    const descriptor=commit.recovery.artifact_descriptors.find(d=>d.source_kind==='original_provider_file'); assert.equal(descriptor.filename,'original-report.pdf');
    const chunk=await s.worker.portRequest({type:'OZ_ATTACHMENT_ARTIFACT_CHUNK',...fields,artifact_key:descriptor.artifact_key});
    assert.deepEqual(Buffer.from(chunk.chunk_base64,'base64'),Buffer.from(bytes));
    const record=s.idb.records.get(descriptor.artifact_key); record.expires_at_ms=Date.now()-1;
    const late=await s.worker.portRequest({type:'OZ_ATTACHMENT_ARTIFACT_CHUNK',...fields,artifact_key:descriptor.artifact_key}); assert.equal(late.ok,false);
    assert.equal(s.worker.network.length,1);
  } finally { s.worker.close(); }
});
await test('APP-08-account-catalog-isolation-and-await-account-change', async () => {
  const s = await setup(); try {
    const api = await s.worker.call('(() => SellerAgentsStoreCatalog)');
    let account = 'fixture-account-A', serial = 0, backing = {}, flip = false;
    const catalog = api.create({ read: async key => { if (flip) account = 'fixture-account-B'; return { [key]: backing[key] }; },
      write: async value => Object.assign(backing, plain(value)), currentAccount: async () => account,
      normalizeCredentials: (_marketplace, value, old) => value.token ? value : old,
      revision: async (_marketplace, value) => value.token, uuid: () => 'fixture-'+(++serial) });
    const a = await catalog.save({ marketplace:'wildberries',credentials:{token:'fixture-A'} });
    account = 'fixture-account-B';assert.equal((await catalog.list()).length,0);await assert.rejects(catalog.get(a.id));
    account = 'fixture-account-A';assert.equal((await catalog.list())[0].id,a.id);
    flip = true;await assert.rejects(catalog.list(),/ACCOUNT_CHANGED/);
  } finally { s.worker.close(); }
});
await test('APP-09-Ozon-local-file-reference-is-owned-by-store-not-name-or-dialogue', async () => {
  const s = await setup(); try {
    const a = await s.save(ozon('FIXTURE_CLIENT_A','FIXTURE_KEY_A'));
    const b = await s.save(ozon('FIXTURE_CLIENT_B','FIXTURE_KEY_B'));
    const first = await s.start(a), tab = s.worker.addTab(78,'second-ozon-dialogue');
    const second = await s.start(b,{tabId:78,...tab});
    const ref='rpf_s_FIXTURE_STORE_A_ONLY';
    const makeGuard = await s.worker.call('(() => async (key) => { const p=await captureBatchContext(key, "fixture", "fixture-ref"); return {snapshot:p,assertCurrent:async()=>{}}; })');
    const guardA = await makeGuard(first.key), guardB = await makeGuard(second.key);
    const remember = await s.worker.call('(() => saRememberOzonFileRefs)'), check = await s.worker.call('(() => saCheckOzonFileRef)');
    await remember({report_text:'OZON_RESULT_V1\n'+JSON.stringify({result:{report_file_ref:ref}})},guardA);
    await check({operation:'report_file_get',params:{file_ref:ref}},guardA);
    await assert.rejects(check({operation:'report_file_get',params:{file_ref:ref}},guardB),/REPORT_FILE_STORE_MISMATCH/);
    assert.equal(s.worker.network.length,0);
  } finally { s.worker.close(); }
});
await test('APP-10-WB-observed-quota-holds-tail-without-Ozon-intervals-or-auto-retry', async () => {
  const s = await setup({ fetch: async () => new Response('{"error":"fixture quota"}', { status:429, headers:{'content-type':'application/json','retry-after':'120'} }) }); try {
    const started = await s.start(await s.save(wb(fixtureToken)));
    await s.execute(started, api+'\n'+api);
    const owner = await until(async()=>{const o=await s.worker.call('getManualOperation',started.key);return o?.batch?.request_state==='quota_waiting'&&o;},'WB tail waits for observed Retry-After');
    const state = plain(await s.worker.call('publicManualOperation', owner));
    assert.equal(state.quota_wait.source,'provider_retry_after');
    assert.equal(state.quota_wait.marketplace,'wildberries');
    assert.equal(state.quota_wait.automatic_retry,false);
    assert.equal(state.quota_wait.explicit_resume_required,true);
    assert.ok(state.quota_wait.next_allowed_at>Date.now());
    for(const key of ['family','min_interval_ms','bridge_launch_safety_ms','effective_interval_ms','scope']) assert.ok(!(key in state.quota_wait));
    assert.equal(s.worker.network.length,1);
    await s.popup('SA_RESUME_QUOTA',{conversation_key:started.key});
    await new Promise(r=>setTimeout(r,30));
    assert.equal(s.worker.network.length,1,'early explicit resume cannot skip provider deadline');
  } finally { s.worker.close(); }
});
await test('C3A-01-valid-Work-command-gates-before-one-provider-request-and-no-control-call', async () => {
  const s = await setup(); try {
    const started = await s.start(await s.save(wb(fixtureToken)));
    const controlBefore = s.worker.controlNetwork.length;
    await s.execute(started, api);
    await s.collected(started);
    assert.equal(s.worker.network.length, 1);
    assert.equal(s.worker.controlNetwork.length, controlBefore);
  } finally { s.worker.close(); }
});
await test('C3A-02-missing-provenance-denies-before-provider', async () => {
  const s = await setup(); try {
    const started = await s.start(await s.save(wb(fixtureToken)));
    const keys = await s.worker.call('(() => OzonRuntime.STORAGE_KEYS)');
    s.worker.backing.local[keys.WORK_SESSIONS][started.key].admission_provenance = null;
    await s.execute(started, api, 'c3a-missing-provenance');
    await s.collected(started);
    assert.equal(s.worker.network.length, 0);
  } finally { s.worker.close(); }
});
await test('C3A-03-hidden-Work-denies-before-provider', async () => {
  const s = await setup(); try {
    const started = await s.start(await s.save(wb(fixtureToken)));
    assert.equal((await s.popup('OZ_WORK_HIDE', { conversation_key: started.key })).ok, true);
    const denied = await s.worker.request({ type: 'OZ_EXECUTE_COMMAND', conversation_key: started.key, command_text: api,
      manual_request_id: 'c3a-hidden', work_session_id: started.session.start_intent_id }, started.sender);
    assert.equal(denied.code, 'WORK_SESSION_NOT_VISIBLE');
    assert.equal(s.worker.network.length, 0);
  } finally { s.worker.close(); }
});
await test('C3A-04-finish-during-authority-crypto-evaluation-drops-stale-positive', async () => {
  let pause = false, entered, release;
  const cryptoEntered = new Promise(resolve => { entered = resolve; });
  const cryptoRelease = new Promise(resolve => { release = resolve; });
  const s = await setup({ beforeCryptoVerify: async () => { if (pause) { entered(); await cryptoRelease; } } }); try {
    const started = await s.start(await s.save(wb(fixtureToken)));
    pause = true;
    await s.execute(started, api, 'c3a-finish-race');
    await cryptoEntered;
    assert.equal((await s.popup('OZ_WORK_FINISH', { conversation_key: started.key })).ok, true);
    release();
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(s.worker.network.length, 0);
  } finally { release(); s.worker.close(); }
});
console.log(JSON.stringify({ status:'PASS', results, live_provider_calls:0, scope:'actual generated worker/popup messages and attachment port; simulated browser and provider; not installed live acceptance' },null,2));
