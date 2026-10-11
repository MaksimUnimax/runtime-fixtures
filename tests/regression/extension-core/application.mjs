import assert from 'node:assert/strict';
import path from 'node:path';
import { makeWorker, until, signFixtureBootstrap } from './worker-harness.mjs';
const runtime = path.resolve(process.argv[2]);
const results = [];
const selectedScenario = process.argv[3] || null;
async function test(id, fn) { if (selectedScenario && id !== selectedScenario) return; await fn(); results.push({ id, status: 'PASS' }); }
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
          if (kind === 'clear') { stats.writes++; records.clear(); }
          r.result = kind === 'get' ? records.get(value) : kind === 'all' ? [...records.values()] : value?.artifact_key;
          r.onsuccess?.(); queueMicrotask(() => tx.oncomplete?.()); }); return r;
      }; return { get: k => op('get', k), put: v => op('put', v), delete: k => op('delete', k), getAll: () => op('all'), clear: () => op('clear') }; } }; return tx;
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
  const worker = await makeWorker(runtime, { indexedDB: idb, ...options, fetch: async (url, init, n) => {
    if (url.endsWith("/v1/ai-prompt-tree")) return options.treeFetch ? options.treeFetch(url, init, n) : new Response('{"code":"NOT_FOUND"}', { status: 404, headers: { "content-type": "application/json" } });
    return options.fetch ? options.fetch(url, init, n) : new Response('{"result":{"value":42}}', { headers: { "content-type": "application/json" } });
  } });
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
await test('APP-01b-WB-personal-token-policy-fails-closed', async () => {
  const s = await setup(); try {
    const normalized = s.worker.call('SellerAgentsWBReference.credentials.normalizeSellerCredentials',
      { token: fixtureToken, tokenType: 'personal' }, { required: true });
    assert.equal(normalized.token, fixtureToken);
    assert.equal(normalized.tokenType, 'personal');
    assert.equal(normalized.clientSecret, '');
    const headers = s.worker.call('SellerAgentsWBReference.credentials.sellerHeaders',
      { token: fixtureToken, tokenType: 'personal' }, { hasBody: true });
    assert.equal(headers.Authorization, 'Bearer '+fixtureToken);
    assert.equal(headers['X-Client-Secret'], undefined);
    assert.equal(headers['Content-Type'], 'application/json');
    assert.throws(() => s.worker.call('SellerAgentsWBReference.credentials.normalizeSellerCredentials',
      { token: fixtureToken, tokenType: 'service' }, { required: true }),
      error => error?.code === 'UNSUPPORTED_TOKEN_TYPE');
    assert.throws(() => s.worker.call('SellerAgentsWBReference.credentials.normalizeSellerCredentials',
      { token: fixtureToken, tokenType: 'personal', clientSecret: 'FIXTURE_SERVICE_SECRET' }, { required: true }),
      error => error?.code === 'CLIENT_SECRET_UNSUPPORTED_PERSONAL_BUILD');
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
    const store = await s.save(wb(fixtureToken));
    const start = await s.start(store); await s.execute(start, api+'\n'+api);
    await entered;
    assert.equal((await s.popup('OZ_WORK_HIDE', { conversation_key: start.key })).ok, true);
    // Historical APP-04 ID is retained. R3 Hide changes visibility only.
    release(); const owner = await s.collected(start); assert.equal(s.worker.network.length, 2);
    const hiddenClick = await s.worker.request({ type: 'OZ_EXECUTE_COMMAND', conversation_key: start.key,
      command_text: api, manual_request_id: 'hidden-new-click', work_session_id: start.session.start_intent_id }, start.sender);
    assert.equal(hiddenClick.code, 'WORK_SESSION_NOT_VISIBLE');
    assert.equal(s.worker.network.length, 2);
    await s.deliver(start, owner);
    assert.equal((await s.popup('OZ_WORK_FINISH', { conversation_key: start.key })).ok, true);
    const late = await s.worker.request({ type: 'OZ_WORK_DELIVERY_ASSERT', conversation_key: start.key, owner_id: owner.operation_id, delivery_id: owner.delivery_id }); assert.equal(late.ok, false);
    const finished = await s.worker.call('workSessionFor', start.key);
    assert.equal(finished.finished, true);
    const resume = await s.popup('SA_WORK_RESUME', { conversation_key: start.key });
    assert.equal(resume.ok, false); assert.equal(resume.code, 'WORK_SESSION_FINISHED');
    const current = await s.popup('SA_POPUP_STATE'); assert.equal(current.work.can_resume, false);
    await s.worker.call('(() => OzonWorkSessionModel.markStorageUnavailable())');
    const blockedStart = await s.popup('SA_WORK_START', { store_id: store.id });
    assert.equal(blockedStart.code, 'WORK_STATE_COMMIT_UNCONFIRMED');
    assert.deepEqual(plain(await s.worker.call('getPendingWorkStarts')), {});
    assert.equal(s.worker.network.length, 2);
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
    assert.equal(s.worker.messages.filter(m=>m.type==='OZ_BATCH_DELIVERY_AVAILABLE').length,0);
    release(); await until(() => s.worker.network.length === 2, 'APP-05 second provider request');
    assert.equal(s.worker.network.length, 2);
    assert.equal((await s.worker.call('bindingForConversationKey', first.key)).store_context.storeId, a.id);
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
    assert.equal(expired.last_error.code,'RESULT_BUFFER_EXPIRED'); assert.equal(expired.outgoing_text,null); assert.equal(expired.batch,null);
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
await test('APP-10b-WB-confirmed-cabinet-quota-shares-across-store-cards-and-marketplace-methods', async () => {
  const s = await setup({ fetch: async (url) => {
    if (url.includes('/api/v3/warehouses')) return new Response('limited', { status:429, headers:{'x-ratelimit-retry':'30'} });
    if (url.includes('/api/v3/offices')) return new Response('{"result":[]}', { headers:{'content-type':'application/json'} });
    return new Response('{"result":[]}', { headers:{'content-type':'application/json'} });
  } }); try {
    const a = await s.save(wb(fixtureToken)), b = await s.save(wb('FIXTURE_CONFIRMED_CARD_TWO'));
    await s.worker.call('saCatalog.confirmProviderIdentity', a.id, a.credentialRevision, 'wb-confirmed-cabinet');
    await s.worker.call('saCatalog.confirmProviderIdentity', b.id, b.credentialRevision, 'wb-confirmed-cabinet');
    const first = await s.start(a);
    const tab = s.worker.addTab(88, 'wb-confirmed-second-dialogue');
    const second = await s.start(b, { tabId:88, ...tab });
    await s.execute(first, 'WB_API_V1 {"operation":"seller_warehouses","params":{}}', 'wb-confirmed-first');
    await s.collected(first);
    assert.equal(s.worker.network.filter(x=>x.url.includes('/api/v3/warehouses')).length, 1);
    await s.execute(second, 'WB_API_V1 {"operation":"marketplace_offices","params":{}}', 'wb-confirmed-second');
    await until(async()=>{const o=await s.worker.call('getManualOperation',second.key);return o?.batch?.request_state==='quota_waiting'&&o;},'confirmed WB cabinet shares Marketplace observed wait');
    assert.equal(s.worker.network.filter(x=>x.url.includes('/api/v3/offices')).length, 0);
    assert.equal(s.worker.network.length, 1, 'second confirmed card is blocked before provider fetch');
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
await test('C3A-02-missing-provenance-is-not-a-bearer-authority', async () => {
  const s = await setup(); try {
    const started = await s.start(await s.save(wb(fixtureToken)));
    const keys = await s.worker.call('(() => OzonRuntime.STORAGE_KEYS)');
    s.worker.backing.local[keys.WORK_SESSIONS][started.key].admission_provenance = null;
    await s.execute(started, api, 'c3a-missing-provenance');
    await s.collected(started);
    assert.equal(s.worker.network.length, 1);
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
await test('PAR-32-package-subset-UNKNOWN-block-version-and-reload-never-repeat-provider', async () => {
  const s = await setup({ fetch: async () => { throw new TypeError('fixture provider connection lost'); } });
  let restarted;
  try {
    const store = await s.save(wb(fixtureToken)), started = await s.start(store);
    await s.execute(started);
    const owner = await s.collected(started), binding = await s.worker.call('bindingForConversationKey', started.key);
    const receipt = owner.r3_commands.receipts[owner.r3_execution_id];
    assert.equal(receipt.items[0].state, 'UNKNOWN'); assert.equal(s.worker.network.length, 1);
    const source = { protocol: 2, documentKey: 'controlled-r3-document', workSessionId: started.session.start_intent_id,
      bindingId: binding.binding_id, conversationKey: started.key,
      messageIdentity: { kind: 'provider-message', id: 'fixture-message:explicit-fixture-block' }, blockOrdinal: 0 };
    const click = (text, id) => ({ type: 'OZ_EXECUTE_COMMAND', conversation_key: started.key,
      command_text: text, manual_request_id: id, work_session_id: started.session.start_intent_id, command_source: source });
    for (const [text, id] of [[api, 'new-click'], [api + '\n', 'changed-block']]) {
      const answer = await s.worker.request(click(text, id));
      assert.equal(answer.code, 'COMMAND_OUTCOME_UNKNOWN_EXPLICIT_RETRY_REQUIRED', JSON.stringify(answer));
    }
    const oldContent = await s.worker.request({ ...click(api, 'old-content'), command_source: null });
    assert.equal(oldContent.code, 'COMMAND_PROTOCOL_RELOAD_REQUIRED');
    assert.equal(s.worker.network.length, 1);
    const backing = s.worker.backing; s.worker.close();
    restarted = await makeWorker(runtime, { backing, seedAuthority: false, fetch: async () => { throw new Error('reload must not dispatch provider'); } });
    const answer = await restarted.request(click(api, 'after-reload'));
    assert.equal(answer.code, 'COMMAND_OUTCOME_UNKNOWN_EXPLICIT_RETRY_REQUIRED', JSON.stringify(answer));
    assert.equal(restarted.network.length, 0);
    const preserved = await restarted.call('getManualOperation', started.key);
    assert.equal(preserved.r3_commands.receipts[owner.r3_execution_id].items[0].state, 'UNKNOWN');
    assert.equal(preserved.r3_commands.receipts[owner.r3_execution_id].payloadExpiresAt, receipt.payloadExpiresAt);
  } finally { restarted?.close(); s.worker.close(); }
});
await test('PAR-33-35-package-subset-explicit-review-confirm-and-double-click', async () => {
  let text = api, source, count = 0;
  const s = await setup({ fetch: async () => { if (++count === 1) throw new TypeError('provider result lost');
    return new Response('{"name":"fixture seller"}', { headers: { 'content-type': 'application/json' } }); },
    readBlockResponse: () => ({ ok: true, command_text: text, command_source: source }) });
  try {
    const store = await s.save(wb(fixtureToken)), started = await s.start(store);
    await s.execute(started); const old = await s.collected(started);
    const binding = await s.worker.call('bindingForConversationKey', started.key);
    source = { protocol: 2, documentKey: old.r3_source.documentKey, workSessionId: started.session.start_intent_id,
      bindingId: binding.binding_id, conversationKey: started.key, messageIdentity: old.r3_source.messageIdentity, blockOrdinal: 0 };
    await s.deliver(started, old);
    const fields = { execution_id: old.r3_execution_id };
    const review = await s.popup('SA_R3_RETRY_REVIEW', fields); assert.equal(review.ok, true, JSON.stringify(review));
    assert.equal(review.items[0].supported, true, JSON.stringify(review.items)); assert.equal(count, 1);
    const noItems = await s.popup('SA_R3_RETRY_PREVIEW', { ...fields, block_version: review.block_version, ordinals: [] });
    assert.equal(noItems.code, 'RETRY_SELECTION_REQUIRED');
    const preview = await s.popup('SA_R3_RETRY_PREVIEW', { ...fields, block_version: review.block_version, ordinals: [0] });
    assert.equal(preview.ok, true, JSON.stringify(preview)); assert.equal(count, 1);
    const confirm = { ...fields, confirmation_id: preview.confirmationId, block_version: preview.block_version, ordinals: [0], confirmed: true };
    text += '\n';
    const changed = await s.popup('SA_R3_RETRY_CONFIRM', confirm); assert.equal(changed.code, 'RETRY_PREVIEW_CHANGED'); assert.equal(count, 1);
    text = api;
    const answers = await Promise.all([s.popup('SA_R3_RETRY_CONFIRM', confirm), s.popup('SA_R3_RETRY_CONFIRM', confirm)]);
    for (const answer of answers) assert.equal(answer.ok, true, JSON.stringify(answer));
    assert.equal(answers.filter(answer => answer.accepted).length, 1);
    const current = await s.collected(started); assert.equal(count, 2);
    assert.notEqual(current.r3_execution_id, old.r3_execution_id);
    assert.equal(current.r3_commands.receipts[current.r3_execution_id].predecessor, old.r3_execution_id);
    assert.deepEqual(current.r3_commands.receipts[old.r3_execution_id], old.r3_commands.receipts[old.r3_execution_id]);
    const duplicate = await s.popup('SA_R3_RETRY_CONFIRM', confirm); assert.equal(duplicate.duplicate, true); assert.equal(count, 2);
  } finally { s.worker.close(); }
});
await test('PAR-36-38-package-subset-copy-exact-buffer-double-click-and-worker-crash', async () => {
  const s = await setup(); let restarted;
  try {
    const store = await s.save(wb(fixtureToken)), started = await s.start(store);
    await s.execute(started); const original = await s.collected(started); await s.deliver(started, original);
    const fields = { execution_id: original.r3_execution_id };
    const preview = await s.popup('SA_R3_COPY_PREVIEW', fields); assert.equal(preview.ok, true, JSON.stringify(preview));
    assert.equal(preview.buffer, original.outgoing_text); assert.equal(preview.expiresAt, original.payload_expires_at_ms);
    assert.equal(s.worker.network.length, 1);
    const confirmation = { ...fields, confirmation_id: preview.confirmationId, confirmed: true };
    const answers = await Promise.all([s.popup('SA_R3_COPY_CONFIRM', confirmation), s.popup('SA_R3_COPY_CONFIRM', confirmation)]);
    for (const answer of answers) assert.equal(answer.ok, true, JSON.stringify(answer));
    assert.equal(answers.filter(answer => answer.accepted).length, 1);
    const copy = await s.worker.call('getManualOperation', started.key);
    assert.notEqual(copy.delivery_id, original.delivery_id); assert.equal(copy.outgoing_text, original.outgoing_text);
    assert.equal(copy.payload_expires_at_ms, original.payload_expires_at_ms);
    assert.equal(copy.r3_commands.deliveries[original.delivery_id].state, 'CONFIRMED');
    await s.deliver(started, copy); assert.equal(s.worker.network.length, 1);
    const duplicate = await s.popup('SA_R3_COPY_CONFIRM', confirmation); assert.equal(duplicate.duplicate, true);
    const preview2 = await s.popup('SA_R3_COPY_PREVIEW', fields); assert.equal(preview2.ok, true, JSON.stringify(preview2));
    const next = await s.popup('SA_R3_COPY_CONFIRM', { ...fields, confirmation_id: preview2.confirmationId, confirmed: true });
    assert.equal(next.ok, true, JSON.stringify(next));
    const pending = await s.worker.call('getManualOperation', started.key), backing = s.worker.backing; s.worker.close();
    restarted = await makeWorker(runtime, { backing, seedAuthority: false, fetch: async () => { throw new Error('copy never calls API'); } });
    const send = await restarted.request({ type: 'OZ_BATCH_DELIVERY_INSERT_COMMIT', owner_kind: 'manual', owner_id: pending.operation_id,
      conversation_key: started.key, delivery_id: pending.delivery_id, actor_id: 'after-crash' });
    assert.equal(send.code, 'COPY_OUTCOME_UNKNOWN_NO_RETRY', JSON.stringify(send)); assert.equal(restarted.network.length, 0);
    const history = await restarted.call('getManualOperation', started.key);
    assert.equal(history.r3_commands.deliveries[pending.delivery_id].state, 'DELIVERY_INTENT');
  } finally { restarted?.close(); s.worker.close(); }
});
await test('PAR-37-package-subset-copy-confirmation-rejected-after-Finish-expiry-and-logout', async () => {
  for (const mode of ['Finish', 'expiry', 'logout']) {
    const s = await setup();
    try {
      const store = await s.save(wb(fixtureToken)), started = await s.start(store);
      await s.execute(started); const owner = await s.collected(started); await s.deliver(started, owner);
      const fields = { execution_id: owner.r3_execution_id }, preview = await s.popup('SA_R3_COPY_PREVIEW', fields);
      assert.equal(preview.ok, true, JSON.stringify(preview));
      if (mode === 'Finish') assert.equal((await s.popup('OZ_WORK_FINISH', { conversation_key: started.key })).ok, true);
      if (mode === 'logout') { const reset = await s.popup('SA_AUTH_RESET'); assert.equal(reset.ok, true, JSON.stringify(reset)); }
      if (mode === 'expiry') { const keys = await s.worker.call('(() => OzonRuntime.STORAGE_KEYS)'); s.worker.backing.local[keys.MANUAL_OPERATIONS][started.key].payload_expires_at_ms = 1; }
      const result = await s.popup('SA_R3_COPY_CONFIRM', { ...fields, confirmation_id: preview.confirmationId, confirmed: true });
      assert.equal(result.ok, false, mode + ': ' + JSON.stringify(result)); assert.equal(s.worker.network.length, 1);
    } finally { s.worker.close(); }
  }
});
await test('PAR-36-package-subset-copy-local-HELP-without-provider-intent', async () => {
  const s = await setup(); try {
    const store = await s.save(wb(fixtureToken)), started = await s.start(store);
    await s.execute(started, 'WB_HELP_V1 {"operation":"catalog","params":{"offset":0,"limit":1}}');
    const old = await s.collected(started); await s.deliver(started, old); assert.equal(s.worker.network.length, 0);
    const preview = await s.popup('SA_R3_COPY_PREVIEW', { execution_id: old.r3_execution_id });
    assert.equal(preview.ok, true, JSON.stringify(preview));
    const copy = await s.popup('SA_R3_COPY_CONFIRM', { execution_id: old.r3_execution_id, confirmation_id: preview.confirmationId, confirmed: true });
    assert.equal(copy.ok, true, JSON.stringify(copy));
    const owner = await s.worker.call('getManualOperation', started.key); await s.deliver(started, owner);
    assert.equal(owner.outgoing_text, old.outgoing_text); assert.equal(s.worker.network.length, 0);
    assert.ok(owner.r3_commands.receipts[old.r3_execution_id].items.every(item => item.providerAttemptId === null));
  } finally { s.worker.close(); }
});
await test('PAR-36-38-package-subset-copy-original-attachment-and-reject-corruption', async () => {
  const bytes = new Uint8Array([37,80,68,70,45,49,10,0,255]);
  const s = await setup({ fetch: async () => new Response(bytes, { headers: { 'content-type': 'application/pdf',
    'content-disposition': 'attachment; filename="retained-original.pdf"' } }) });
  try {
    s.worker.setDialogue('11111111-1111-4111-8111-111111111111');
    const store = await s.save(wb(fixtureToken)), started = await s.start(store);
    const contract = await s.worker.call('(() => SellerAgentsWBReference.contract)');
    const meta = Object.values(contract.OPERATIONS).find(m => m.response_mode === 'binary' && m.execution_enabled && m.privacy === 'standard');
    const params = { path: Object.fromEntries([...meta.path.matchAll(/\{([^}]+)\}/g)].map(m => [m[1], 'fixture'])),
      query: Object.fromEntries(meta.required_query_keys.map(k => [k, '1'])), ...(meta.body_required ? { body: {} } : {}) };
    await s.execute(started, 'WB_API_V1 ' + JSON.stringify({ operation: meta.alias, params }));
    const original = await s.collected(started);
    async function deliverAttachment(owner) {
      const fields = { owner_kind: 'manual', owner_id: owner.operation_id, conversation_key: started.key,
        delivery_id: owner.delivery_id, actor_id: 'fixture-copy-attachment' };
      const commit = await s.worker.portRequest({ type: 'OZ_ATTACHMENT_COMMIT', ...fields });
      assert.equal(commit.attach_allowed, true, JSON.stringify(commit));
      const twice = await s.worker.portRequest({ type: 'OZ_ATTACHMENT_COMMIT', ...fields }); assert.equal(twice.attach_allowed, false);
      const ready = await s.worker.portRequest({ type: 'OZ_ATTACHMENT_READY', ...fields,
        attached_filenames: commit.recovery.artifact_descriptors.map(d => d.filename) }); assert.equal(ready.ok, true, JSON.stringify(ready));
      const send = await s.worker.portRequest({ type: 'OZ_ATTACHMENT_SEND_COMMIT', ...fields }); assert.equal(send.click_allowed, true, JSON.stringify(send));
      const sentTwice = await s.worker.portRequest({ type: 'OZ_ATTACHMENT_SEND_COMMIT', ...fields }); assert.equal(sentTwice.click_allowed, false);
      const done = await s.worker.portRequest({ type: 'OZ_ATTACHMENT_CONFIRM', ...fields, confirmed_user_turn_id: 'fixture-confirmed-copy' });
      assert.equal(done.confirmed, true, JSON.stringify(done)); return commit.recovery.artifact_descriptors;
    }
    const descriptors = await deliverAttachment(original);
    const preview = await s.popup('SA_R3_COPY_PREVIEW', { execution_id: original.r3_execution_id });
    assert.equal(preview.ok, true, JSON.stringify(preview)); assert.equal(preview.attachments.length, descriptors.length);
    const accepted = await s.popup('SA_R3_COPY_CONFIRM', { execution_id: original.r3_execution_id,
      confirmation_id: preview.confirmationId, confirmed: true }); assert.equal(accepted.ok, true, JSON.stringify(accepted));
    const copy = await s.worker.call('getManualOperation', started.key);
    assert.equal(copy.payload_expires_at_ms, original.payload_expires_at_ms);
    const copied = await deliverAttachment(copy); assert.deepEqual(copied, descriptors); assert.equal(s.worker.network.length, 1);
    const preview2 = await s.popup('SA_R3_COPY_PREVIEW', { execution_id: original.r3_execution_id }); assert.equal(preview2.ok, true, JSON.stringify(preview2));
    const record = s.idb.records.get(descriptors.find(d => d.source_kind === 'original_provider_file').artifact_key);
    const originalBytes = record.bytes;
    record.bytes = new Uint8Array([0,1,2]).buffer;
    const bad = await s.popup('SA_R3_COPY_CONFIRM', { execution_id: original.r3_execution_id,
      confirmation_id: preview2.confirmationId, confirmed: true });
    assert.equal(bad.code, 'COPY_ARTIFACT_MISMATCH', JSON.stringify(bad)); assert.equal(s.worker.network.length, 1);
    record.bytes = originalBytes;
    const allowed = await s.popup('SA_R3_COPY_CONFIRM', { execution_id: original.r3_execution_id,
      confirmation_id: preview2.confirmationId, confirmed: true }); assert.equal(allowed.ok, true, JSON.stringify(allowed));
    s.idb.records.delete(record.artifact_key);
    const absent = await s.worker.portRequest({ type: 'OZ_ATTACHMENT_COMMIT', owner_kind: 'manual', owner_id: original.operation_id,
      conversation_key: started.key, delivery_id: allowed.delivery_id, actor_id: 'fixture-after-artifact-loss' });
    assert.equal(absent.code, 'COPY_ARTIFACT_UNAVAILABLE', JSON.stringify(absent)); assert.equal(s.worker.network.length, 1);
  } finally { s.worker.close(); }
});
await test('AI-TREE-04-08-package-subset-signed-Start-pin-update-and-command-no-tree-fetch', async () => {
  let s, version=1, treeFetches=0;
  const aiId='61000000-0000-4000-8000-000000000001';
  const treeBody=()=>({format:'octoport_prompt_tree_v1',root:'root',nodes:[{id:'root',text:`PERSONAL_R3_TREE_VERSION_${version}`,children:[]}]});
  s=await setup({treeFetch:async(url,init)=>{
    if(!url.endsWith('/v1/ai-prompt-tree'))return new Response('{"result":{"value":42}}',{headers:{'content-type':'application/json'}});
    treeFetches++;const request=JSON.parse(init.body),auth=s.worker.backing.local.seller_agents_control_auth_v2;
    const body=treeBody(),sha256=await s.worker.call('OctoportPromptTrees.digest',body);
    const claim={claimVersion:'ai_prompt_tree_claim_v1',accountId:auth.authority.payload.account.id,
      deviceId:auth.credentials.deviceId,sessionId:auth.credentials.sessionId,requestNonce:request.requestNonce,
      detected:request.bootstrap.detectedAi,aiId,issuedAt:new Date().toISOString(),
      publication:{version,format:body.format,sha256,body:request.known?.version===version?null:body,publishedAt:new Date().toISOString()}};
    const canonical=await s.worker.call('SellerAgentsBootstrapVerifier.canonicalJson',claim),bytes=Buffer.from(canonical);
    const {createPrivateKey,sign}=await import('node:crypto');
    const key=createPrivateKey({key:Buffer.from(s.worker.backing.local.__seller_agents_fixture_signing_key.privateKey,'base64'),format:'der',type:'pkcs8'});
    const signature=sign(null,Buffer.concat([Buffer.from('Octoport ai prompt tree v1\0fixture-key\0'),bytes]),key).toString('base64url');
    return new Response(JSON.stringify({treeEnvelopeVersion:'ai_prompt_tree_envelope_v1',algorithm:'Ed25519',keyId:'fixture-key',payload:bytes.toString('base64url'),signature}),{headers:{'content-type':'application/json'}});
  }});
  try {
    const store=await s.save(wb(fixtureToken));
    const started=await s.popup('SA_WORK_START',{store_id:store.id});assert.equal(started.ok,true,JSON.stringify(started));assert.equal(started.prompt_tree_available,true,JSON.stringify(started));
    const pending=await until(async()=>{const p=(await s.worker.call('getPendingWorkStarts'))[s.worker.tabId];return p?.send_outcome==='sent_acknowledged'&&p;},'tree-pinned Start');
    assert.equal(pending.prompt_tree.aiId,aiId);assert.equal(pending.prompt_tree.version,1);assert.equal(treeFetches,1);
    const beforeMessages=s.worker.messages.length,beforeProvider=s.worker.network.length;
    version=2;const next=await s.worker.call('SellerAgentsControlClient.getPromptTree',s.worker.identity,{refresh:true});
    assert.equal(next.pin.version,2,JSON.stringify(next));assert.equal(treeFetches,2);
    assert.equal(s.worker.messages.length,beforeMessages);assert.equal(s.worker.network.length,beforeProvider);
    const oldPrompt=await s.worker.call('saPendingPrompt',pending);assert.match(oldPrompt,/PERSONAL_R3_TREE_VERSION_1/);assert.doesNotMatch(oldPrompt,/PERSONAL_R3_TREE_VERSION_2/);
    const active=await s.worker.request({type:'OZ_WORK_PENDING_IDENTITY',identity:s.worker.identity,intent_id:pending.intent_id,revision:pending.revision,first_response_complete:true});assert.equal(active.ok,true,JSON.stringify(active));
    const work={key:active.binding.conversation_key,session:active.session,identity:s.worker.identity,tabId:s.worker.tabId};
    await s.execute(work,api,'tree-exchange-two');const owner=await s.collected(work);
    assert.equal(owner.prompt_tree.version,2);assert.equal(owner.prompt_tree.aiId,aiId);assert.equal(treeFetches,2);
    await s.deliver(work,owner);assert.equal(s.worker.network.length,beforeProvider+1);assert.equal(treeFetches,2);
  } finally {s.worker.close();}
});

await test('PAR-01-package-subset-pending-ChatGPT-Start-survives-Alice-grant', async () => {
  let s;
  s=await setup({fetch:async(url,init)=>{
    if(url.endsWith('/v1/bootstrap')) {
      const payload=plain(s.worker.backing.local.seller_agents_control_auth_v2.authority.payload);
      payload.ai.detected=JSON.parse(init.body).detectedAi;
      return new Response(JSON.stringify(await signFixtureBootstrap(s.worker.backing,payload)),{headers:{'content-type':'application/json'}});
    }
    return new Response('{"result":{}}',{headers:{'content-type':'application/json'}});
  }});
  try {
    const store=await s.save(wb(fixtureToken)),start=await s.popup('SA_WORK_START',{store_id:store.id});
    assert.equal(start.ok,true,JSON.stringify(start));
    const pending=await until(async()=>{const p=(await s.worker.call('getPendingWorkStarts'))[s.worker.tabId];return p?.send_outcome==='sent_acknowledged'&&p;},'ChatGPT pending Start');
    await s.worker.call('SellerAgentsControlClient.bootstrap',{detectedAi:{family:'alice',surface:'web',variant:null}});
    assert.equal(s.worker.backing.local.seller_agents_control_auth_v2.authority.requestedAi,'alice');
    assert.equal(await s.worker.call('SellerAgentsControlClient.canWork','chatgpt'),true);
    await s.worker.call('saPendingGuard',pending);
    const preserved=(await s.worker.call('getPendingWorkStarts'))[s.worker.tabId];
    assert.equal(preserved.intent_id,pending.intent_id);assert.equal(preserved.send_outcome,'sent_acknowledged');
    const active=await s.worker.request({type:'OZ_WORK_PENDING_IDENTITY',identity:s.worker.identity,intent_id:pending.intent_id,revision:pending.revision,first_response_complete:true});
    assert.equal(active.ok,true,JSON.stringify(active));assert.equal(s.worker.network.length,0);
  } finally {s.worker.close();}
});
async function r3TreeResponse(s, init) {
  const request=JSON.parse(init.body),auth=s.worker.backing.local.seller_agents_control_auth_v2;
  const body={format:'octoport_prompt_tree_v1',root:'root',nodes:[{id:'root',text:'DENY_BOUNDARY_TREE',children:[]}]};
  const sha256=await s.worker.call('OctoportPromptTrees.digest',body);
  const claim={claimVersion:'ai_prompt_tree_claim_v1',accountId:auth.authority.payload.account.id,
    deviceId:auth.credentials.deviceId,sessionId:auth.credentials.sessionId,requestNonce:request.requestNonce,
    detected:request.bootstrap.detectedAi,aiId:'62000000-0000-4000-8000-000000000001',issuedAt:new Date().toISOString(),
    publication:{version:1,format:body.format,sha256,body:request.known?.version===1?null:body,publishedAt:new Date().toISOString()}};
  const bytes=Buffer.from(await s.worker.call('SellerAgentsBootstrapVerifier.canonicalJson',claim));
  const {createPrivateKey,sign}=await import('node:crypto');
  const key=createPrivateKey({key:Buffer.from(s.worker.backing.local.__seller_agents_fixture_signing_key.privateKey,'base64'),format:'der',type:'pkcs8'});
  const signature=sign(null,Buffer.concat([Buffer.from('Octoport ai prompt tree v1\0fixture-key\0'),bytes]),key).toString('base64url');
  return new Response(JSON.stringify({treeEnvelopeVersion:'ai_prompt_tree_envelope_v1',algorithm:'Ed25519',keyId:'fixture-key',payload:bytes.toString('base64url'),signature}),{headers:{'content-type':'application/json'}});
}
await test('AI-TREE-R3-package-data-failure-preserves-cache-authenticated-deny-invalidates',async()=>{
 let s,mode='ok',count=0;
 s=await setup({treeFetch:async(url,init)=>{
   count++;assert.equal(init.cache,'no-store');assert.equal(new Headers(init.headers).get('cache-control'),'no-store');
   if(mode==='ok')return r3TreeResponse(s,init);
   return new Response(JSON.stringify({code:mode==='deny'?'BOOTSTRAP_UNAVAILABLE':'SERVICE_UNAVAILABLE'}),{status:mode==='deny'?403:503,headers:{'content-type':'application/json'}});
 }});
 try {
   const first=await s.worker.call('SellerAgentsControlClient.getPromptTree',s.worker.identity);assert.equal(first.available,true,JSON.stringify(first));
   mode='network';const stale=await s.worker.call('SellerAgentsControlClient.getPromptTree',s.worker.identity,{refresh:true});
   assert.equal(stale.available,true,JSON.stringify(stale));assert.equal(stale.pin.sha256,first.pin.sha256);assert.equal(await s.worker.call('SellerAgentsControlClient.canWork','chatgpt'),true);
   mode='deny';const denied=await s.worker.call('SellerAgentsControlClient.getPromptTree',s.worker.identity,{refresh:true});
   assert.equal(denied.available,false,JSON.stringify(denied));assert.equal(await s.worker.call('SellerAgentsControlClient.canWork','chatgpt'),false);
   const cached=await s.worker.call('SellerAgentsControlClient.getPromptTree',s.worker.identity,{cacheOnly:true});assert.equal(cached.available,false);assert.equal(count,3);
   assert.equal(s.worker.network.length,0);assert.equal(s.worker.messages.filter(x=>x.message?.type==='OZ_SEND_PROMPT').length,0);
 }finally{s.worker.close();}
});
await test('AI-TREE-R3-package-late-deny-after-timeout-no-hidden-retry',async()=>{
 let s,late,requests=0;
 s=await setup({timerScale:0.01,treeFetch:async(url,init)=>{
   requests++;if(requests===1)return r3TreeResponse(s,init);
   return new Promise(resolve=>{late=resolve;});
 }});
 try {
   assert.equal((await s.worker.call('SellerAgentsControlClient.getPromptTree',s.worker.identity)).available,true);
   const timeout=await s.worker.call('SellerAgentsControlClient.getPromptTree',s.worker.identity,{refresh:true});
   assert.equal(timeout.available,true,JSON.stringify(timeout));assert.equal(timeout.warning.code,'CONTROL_REQUEST_TIMEOUT');assert.equal(requests,2);
   late(new Response('{"code":"BOOTSTRAP_UNAVAILABLE"}',{status:403,headers:{'content-type':'application/json'}}));
   await until(async()=>!(await s.worker.call('SellerAgentsControlClient.canWork','chatgpt')),'late tree deny must invalidate authority');
   assert.equal(requests,2);assert.equal((await s.worker.call('SellerAgentsControlClient.getPromptTree',s.worker.identity,{cacheOnly:true})).available,false);
 }finally{s.worker.close();}
});
await test('AI-TREE-R3-package-Firefox-no-consent-no-identified-tree-request',async()=>{
 let requests=0;
 const s=await setup({userAgent:'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',firefoxPermissions:{getAll:async()=>({data_collection:[]})},treeFetch:async()=>{requests++;throw new Error('identified tree request forbidden');}});
 try {
   const result=await s.worker.call('SellerAgentsControlClient.getPromptTree',s.worker.identity);
   assert.equal(result.available,false,JSON.stringify(result));assert.equal(result.warning.code,'AI_TREE_TECHNICAL_PERMISSION_REQUIRED',JSON.stringify(result));
   assert.equal(requests,0);assert.equal(s.worker.network.length,0);
 }finally{s.worker.close();}
});

await test('AI-TREE-R3-package-existing-config-sync-refreshes-tree-without-business-effects',async()=>{
 let s,requests=0;
 s=await setup({fetch:async(url,init)=>{
   assert.ok(url.endsWith('/v1/bootstrap'));
   const payload=plain(s.worker.backing.local.seller_agents_control_auth_v2.authority.payload);
   payload.ai.detected=JSON.parse(init.body).detectedAi;
   return new Response(JSON.stringify(await signFixtureBootstrap(s.worker.backing,payload)),{headers:{'content-type':'application/json'}});
 },treeFetch:async(url,init)=>{requests++;return r3TreeResponse(s,init);}});
 try {
   const beforeMessages=s.worker.messages.length;
   await s.worker.call('SellerAgentsControlClient.bootstrap',{detectedAi:{family:'chatgpt',surface:'web',variant:null}});
   const cached=await until(async()=>{const r=await s.worker.call('SellerAgentsControlClient.getPromptTree',s.worker.identity,{cacheOnly:true});return r.available&&r;},'existing config synchronization must populate the tree');
   assert.equal(cached.pin.aiId,'62000000-0000-4000-8000-000000000001');assert.equal(requests,1);
   await s.worker.call('SellerAgentsControlClient.bootstrap',{detectedAi:{family:'chatgpt',surface:'web',variant:null}});
   await new Promise(resolve=>setTimeout(resolve,30));assert.equal(requests,1);
   assert.equal(s.worker.messages.length,beforeMessages);assert.equal(s.worker.network.length,0);
 }finally{s.worker.close();}
});

await test('PAR-29-package-subset-auth-migration-repeat-original-TTL-one-scope',async()=>{
 const seed=await setup();let backing;
 try{await seed.worker.call('SellerAgentsControlClient.canWork','chatgpt');backing=plain(seed.worker.backing);}finally{seed.worker.close();}
 const raw=backing.local.seller_agents_control_auth_v2;
 delete raw.authStateSchema;delete raw.authMigration;delete raw.grants;delete raw.principalEpoch;delete raw.accessEpoch;
 const envelope=plain(raw.authority.envelope),expires=raw.authority.payload.expiresAt,generation=raw.generation;
 const first=await setup({backing});let migrated;
 try{
   assert.equal(await first.worker.call('SellerAgentsControlClient.canWork','chatgpt'),true);
   assert.equal(await first.worker.call('SellerAgentsControlClient.canWork','alice'),false);
   migrated=plain(first.worker.backing.local.seller_agents_control_auth_v2);
   assert.equal(migrated.authStateSchema,2);assert.equal(migrated.authMigration.phase,'COMMITTED');assert.match(migrated.authMigration.migrationId,/^auth-v2:[a-f0-9]{64}$/);
   assert.equal(migrated.generation,generation);assert.equal(migrated.authority.payload.expiresAt,expires);assert.deepEqual(migrated.authority.envelope,envelope);
   assert.equal(Object.keys(migrated.grants).length,1);assert.equal(Object.values(migrated.grants)[0].authority.requestedAi,'chatgpt');
   assert.equal(first.worker.network.length,0);backing=plain(first.worker.backing);
 }finally{first.worker.close();}
 const second=await setup({backing});
 try{
   assert.equal(await second.worker.call('SellerAgentsControlClient.canWork','chatgpt'),true);
   const after=second.worker.backing.local.seller_agents_control_auth_v2;
   assert.deepEqual(plain(after.authMigration),migrated.authMigration);assert.equal(after.authority.payload.expiresAt,expires);
   assert.equal(Object.values(after.grants)[0].grantEpoch,Object.values(migrated.grants)[0].grantEpoch);assert.equal(Object.keys(after.grants).length,1);
   assert.equal(second.worker.network.length,0);
 }finally{second.worker.close();}
});
await test('PAR-29-30-package-subset-unsupported-partial-corrupt-auth-preserved-closed',async()=>{
 const seed=await setup();let original;
 try{await seed.worker.call('SellerAgentsControlClient.canWork','chatgpt');original=plain(seed.worker.backing);}finally{seed.worker.close();}
 const cases=[
   ['future',s=>{s.authStateSchema=3;}],
   ['staging',s=>{s.authMigration.phase='STAGING';}],
   ['bad-grants',s=>{s.grants=[];}],
   ['stale-fence',s=>{Object.values(s.grants)[0].accessEpoch+=1;}],
   ['negative-epoch',s=>{s.principalEpoch=-1;}]
 ];
 for(const [name,change] of cases){
   const backing=plain(original);change(backing.local.seller_agents_control_auth_v2);const before=plain(backing.local.seller_agents_control_auth_v2);
   const worker=await makeWorker(runtime,{backing,indexedDB:fakeIDB()});
   try{
     assert.equal(await worker.call('SellerAgentsControlClient.canWork','chatgpt'),false,name);
     assert.equal(await worker.call('SellerAgentsControlClient.canWork','alice'),false,name);
     assert.deepEqual(plain(worker.backing.local.seller_agents_control_auth_v2),before,name);
     assert.equal(worker.network.length,0,name);assert.equal(worker.messages.length,0,name);
   }finally{worker.close();}
 }
});
await test('PAR-29-package-subset-auth-migration-write-failure-never-opens-worker',async()=>{
 const seed=await setup();let original;
 try{original=plain(seed.worker.backing);}finally{seed.worker.close();}
 for(const failRemove of [false,true]){
  const backing=plain(original),raw=backing.local.seller_agents_control_auth_v2;
  delete raw.authStateSchema;delete raw.authMigration;delete raw.grants;delete raw.principalEpoch;delete raw.accessEpoch;
  const before=plain(raw);let failedWrites=0;
  const worker=await makeWorker(runtime,{backing,indexedDB:fakeIDB(),onStorageWrite:async(kind,values)=>{
    if(kind==='local'&&values.seller_agents_control_auth_v2){failedWrites++;throw new Error('injected storage failure');}
  },onStorageRemove:async(kind,keys)=>{
    if(failRemove && kind==='local' && [keys].flat().includes('seller_agents_control_auth_v2'))throw new Error('injected remove failure');
  }});
  try{
    let allowed=false;try{allowed=await worker.call('SellerAgentsControlClient.canWork','chatgpt');}catch(error){assert.match(String(error),/AUTH_STATE_COMMIT_UNCONFIRMED/);}
    assert.equal(allowed,false);assert.ok(failedWrites>0);assert.equal(await worker.call('SellerAgentsControlClient.canWork','chatgpt'),false);
    const retained=worker.backing.local.seller_agents_control_auth_v2;
    if(failRemove)assert.deepEqual(plain(retained),before);else assert.equal(retained,undefined);
    assert.equal(worker.network.length,0);
  }finally{worker.close();}
 }
});

await test('PAR-29-package-subset-migration-readback-failure-no-effects',async()=>{
 const seed=await setup();let original;
 try{original=plain(seed.worker.backing);}finally{seed.worker.close();}
 const backing=plain(original),raw=backing.local.seller_agents_control_auth_v2;
 delete raw.authStateSchema;delete raw.authMigration;delete raw.grants;delete raw.principalEpoch;delete raw.accessEpoch;
 let migrationWritten=false,blockedReads=0;
 const worker=await makeWorker(runtime,{backing,indexedDB:fakeIDB(),onStorageWrite:async(kind,values)=>{
   if(kind==='local'&&values.seller_agents_control_auth_v2?.authMigration?.phase==='COMMITTED')migrationWritten=true;
 },onStorageRead:(kind,keys)=>{
   if(migrationWritten && kind==='local' && (keys==null || [keys].flat().includes('seller_agents_control_auth_v2'))){
     blockedReads++;throw new Error('injected migration readback failure');
   }
 }});
 try{
   let allowed=false;
   try{allowed=await worker.call('SellerAgentsControlClient.canWork','chatgpt');}
   catch(error){assert.match(String(error),/AUTH_STATE_COMMIT_UNCONFIRMED|injected migration readback failure/);}
   assert.equal(allowed,false);assert.equal(migrationWritten,true);assert.ok(blockedReads>0);
   assert.equal(await worker.call('SellerAgentsControlClient.canWork','chatgpt'),false);
   assert.equal(worker.network.length,0);assert.equal(worker.messages.length,0);
 }finally{worker.close();}
});

await test('PAR-29-package-subset-legacy-denied-and-orphan-stay-closed-across-restarts',async()=>{
 const seed=await setup();let original;
 try{await seed.worker.call('SellerAgentsControlClient.canWork','chatgpt');original=plain(seed.worker.backing);}finally{seed.worker.close();}
 for(const scenario of ['explicit-deny','signed-out-orphan']){
  let backing=plain(original),raw=backing.local.seller_agents_control_auth_v2;
  delete raw.authStateSchema;delete raw.authMigration;delete raw.grants;delete raw.principalEpoch;delete raw.accessEpoch;
  if(scenario==='explicit-deny')raw.authority.workAllowed=false;
  else raw.credentials=null;
  const originalExpiry=raw.authority.payload.expiresAt;
  let migrationId;
  for(let restart=0;restart<2;restart++){
   const worker=await makeWorker(runtime,{backing,indexedDB:fakeIDB()});
   try{
    for(const ai of ['chatgpt','alice'])assert.equal(await worker.call('SellerAgentsControlClient.canWork',ai),false,scenario+':'+restart+':'+ai);
    const saved=plain(worker.backing.local.seller_agents_control_auth_v2);
    assert.equal(saved.authStateSchema,2);assert.equal(saved.authMigration.phase,'COMMITTED');
    if(restart===0)migrationId=saved.authMigration.migrationId;else assert.equal(saved.authMigration.migrationId,migrationId);
    assert.ok(Object.values(saved.grants||{}).every(grant=>grant.authority.workAllowed!==true));
    if(scenario==='explicit-deny'){
     assert.equal(saved.authority.workAllowed,false);assert.equal(saved.authority.payload.expiresAt,originalExpiry);
    }else{
     assert.equal(saved.credentials,null);assert.equal(saved.authority,null);assert.equal(saved.cacheClock,null);
    }
    assert.equal(worker.network.length,0);assert.equal(worker.messages.length,0);
    backing=plain(worker.backing);
   }finally{worker.close();}
  }
 }
});

await test('R3-branding-default-Ozon-Start-keeps-protocol-and-custom-text',async()=>{
 const s=await setup();
 try{
  const store=await s.save(ozon('FIXTURE_BRAND_CLIENT','FIXTURE_BRAND_KEY'));
  await s.start(store);
  const prompts=s.worker.messages.filter(message=>message.type==='OZ_WORK_SEND_INITIAL_PROMPT');
  assert.equal(prompts.length,1);const text=prompts[0].prompt_text;
  assert.match(text,/НАЧАЛО РАБОТЫ С OCTOPORT/);
  assert.doesNotMatch(text,/Ozon Bridge/i,'default Start must not request the former product name');
  for(const protocol of ['OZON_API_V1','OZON_HELP_V2','OZON_RESULT_V1'])assert.ok(text.includes(protocol),protocol);
  assert.ok(text.includes('кнопку Ozon'));
  const saved={text:'Моя сохранённая инструкция Ozon Bridge / OZON_API_V1',is_default:false,updated_at:'2026-10-01T00:00:00.000Z'};
  const normalized=await s.worker.call('normalizeGlobalAutoStartPromptRecord',saved);
  assert.equal(normalized.changed,false);assert.deepEqual(plain(normalized.record),saved);
  assert.equal(s.worker.network.length,0);
 }finally{s.worker.close();}
});

await test('R3-bootstrap-safe-rejection-diagnostic-survives-restart', async () => {
  const authKey='seller_agents_control_auth_v2'; let worker, payload, fixtureCalls=0;
  worker=await makeWorker(runtime,{fetch:async url=>{
    assert.ok(url.endsWith('/v1/bootstrap'));fixtureCalls++;
    return new Response(JSON.stringify(await signFixtureBootstrap(worker.backing,payload)),{status:200,headers:{'content-type':'application/json'}});
  }});
  let backing, diagnostic;
  try {
    payload=structuredClone(worker.backing.local[authKey].authority.payload);
    const secrets=[worker.backing.local[authKey].credentials.accessToken,worker.backing.local[authKey].credentials.refreshToken,payload.account.id,payload.ai.profile.profileKey];
    payload.compatibility.extension.status='UPDATE_REQUIRED';
    await assert.rejects(worker.call('SellerAgentsControlClient.bootstrap',{detectedAi:{family:'chatgpt',surface:'web',variant:null}}),e=>e.code==='BOOTSTRAP_PROFILE_INCOMPATIBLE');
    const status=await worker.call('SellerAgentsControlClient.status');
    assert.equal(status.authenticated,false);assert.equal(status.workAllowed,false);assert.equal(status.authority,null);
    diagnostic=plain(status.lastError.bootstrapDiagnostic);
    assert.equal(diagnostic.stage,'SIGNED_AUTHORITY');assert.equal(diagnostic.diagnosticVersion,'bootstrap_rejection_v1');
    assert.deepEqual(diagnostic.checks,[{check:'PAYLOAD_VARIANT',passed:true},{check:'PAYLOAD_PRESENT',passed:true},{check:'ACCESS_BASIS_ALLOWED',passed:true},{check:'ACCOUNT_ACTIVE',passed:true},{check:'DEVICE_ACTIVE',passed:true},{check:'EXTENSION_STATUS_ALLOWED',passed:false}]);
    assert.match(diagnostic.recordedAt,/^\d{4}-\d{2}-\d{2}T/);
    const support=await worker.popup({type:'SA_SUPPORT_SNAPSHOT',tab_id:worker.tabId});assert.equal(support.ok,true);assert.deepEqual(plain(support.snapshot.auth.bootstrapRejection),diagnostic);assert.equal(support.snapshot.auth.bootstrapRetryAvailable,true);
    for(const secret of secrets)assert.ok(!JSON.stringify(support.snapshot).includes(secret),'support projection must exclude identifiers and credentials');
    assert.equal(fixtureCalls,1);backing=worker.backing;
  }finally{worker.close();}
  worker=await makeWorker(runtime,{backing,fetch:async()=>{throw new Error('Unexpected diagnostic restore network');}});
  try {
    const support=await worker.popup({type:'SA_SUPPORT_SNAPSHOT',tab_id:worker.tabId});assert.deepEqual(plain(support.snapshot.auth.bootstrapRejection),diagnostic);assert.equal(support.snapshot.auth.workAllowed,false);
    assert.equal(worker.network.length,0);
  }finally{worker.close();}
  backing.local[authKey].lastError.bootstrapDiagnostic.checks.push({check:'SECRET_FIXTURE_NOT_ALLOWED',passed:false});
  worker=await makeWorker(runtime,{backing,fetch:async()=>{throw new Error('Unexpected diagnostic sanitizer network');}});
  try {
    const support=await worker.popup({type:'SA_SUPPORT_SNAPSHOT',tab_id:worker.tabId});assert.equal(support.snapshot.auth.bootstrapRejection,null);assert.ok(!JSON.stringify(support.snapshot).includes('SECRET_FIXTURE_NOT_ALLOWED'));assert.equal(support.snapshot.auth.lastErrorCode,'BOOTSTRAP_PROFILE_INCOMPATIBLE');assert.equal(support.snapshot.auth.workAllowed,false);
  }finally{worker.close();}
});

await test('PAR-28-package-subset-late-snapshot-after-Finish-and-rebind',async()=>{
 for(const transition of process.argv[4]?[process.argv[4]]:['finish','rebind']){
  const s=await setup({syncFetch:async()=>new Response('{"code":"TEMPORARILY_UNAVAILABLE"}',{status:503,headers:{'content-type':'application/json'}})});
  let backing,idb,key,expected;
  try {
   const a=await s.save(wb('FIXTURE_PAR28_A')),b=await s.save(wb('FIXTURE_PAR28_B'));
   const started=await s.start(a);key=started.key;
   const oldBinding=plain(await s.worker.call('bindingForConversationKey',key));
   const context={conversationKey:key,binding:oldBinding,store:a,workGeneration:started.session.start_intent_id};
   const intent=plain(await s.worker.call('SellerAgentsSyncJournal.createSnapshotReadIntent',context));
   const journal=await s.worker.call('SellerAgentsSyncJournal.read');
   const bound=Object.values(journal.entries).filter(e=>e.kind==='BINDING_UPSERT'&&e.entityId===intent.entityIds[0]).at(-1);
   assert.ok(bound,'actual Start must record its binding');
   if(transition==='finish')assert.equal((await s.popup('OZ_WORK_FINISH',{conversation_key:key})).ok,true);
   else await s.start(b,{confirm:true});
   expected=plain(await s.worker.call('workSessionFor',key));
   const currentBinding=plain(await s.worker.call('bindingForConversationKey',key));
   const messages=s.worker.messages.length;
   const late=await s.worker.call('SellerAgentsSyncJournal.applySnapshotRead',{intent,currentConversationKey:key,binding:oldBinding,store:a,workGeneration:started.session.start_intent_id,snapshots:[{entityId:intent.entityIds[0],serverRevision:999999,serverState:plain(bound.payload)}]});
   assert.equal(late.applied,false);assert.equal(late.code,'SYNC_SNAPSHOT_CONTEXT_STALE');
   assert.deepEqual(plain(await s.worker.call('workSessionFor',key)),expected);
   assert.deepEqual(plain(await s.worker.call('bindingForConversationKey',key)),currentBinding);
   assert.equal(s.worker.messages.length,messages,'late snapshot itself must not send any message');
   if(transition==='finish'){assert.equal(expected.finished,true);assert.equal((await s.popup('SA_WORK_RESUME',{conversation_key:key})).code,'WORK_SESSION_FINISHED');}
   else {assert.equal(currentBinding.store_context.storeId,b.id);assert.notEqual(expected.start_intent_id,started.session.start_intent_id);}
   assert.equal(s.worker.network.length,0);
   backing=s.worker.backing;idb=s.worker.idb;
  }finally{s.worker.close();}
  const reopened=await makeWorker(runtime,{backing,indexedDB:idb,syncFetch:async()=>new Response('{}',{status:503}),fetch:async()=>{throw new Error('No provider calls allowed in PAR28 restart');}});
  try{
   const restored=await reopened.call('workSessionFor',key);assert.equal(restored.start_intent_id,expected.start_intent_id);assert.equal(restored.finished,expected.finished);assert.equal(reopened.network.length,0);assert.equal(reopened.messages.length,0);
  }finally{reopened.close();}
 }
});

await test('PAR-28-rebind-finish-guard-rejects-wrong-terminal',async()=>{
 for(const failure of ['foreign-work','unknown-terminal','not-finished','wrong-revision']){
  const s=await setup();
  try{
   const a=await s.save(wb('FIXTURE_GUARD_A')),b=await s.save(wb('FIXTURE_GUARD_B'));const started=await s.start(a);
   await s.worker.call(`(mode => { const guard=saRebindAfterFinishGuard; saRebindAfterFinishGuard=async token=>{const read=saReadAdmissionSnapshot;saReadAdmissionSnapshot=async input=>{const current=await read(input),fence={...current.fence},work={...current.work};if(mode==='foreign-work'){fence.workIntentId='fixture-foreign-work';work.work_session_id='fixture-foreign-work';}if(mode==='unknown-terminal')work.terminal_state_known=false;if(mode==='not-finished')work.finished=false;if(mode==='wrong-revision')fence.workRevision+=1;return {...current,fence,work};};try{return await guard(token);}finally{saReadAdmissionSnapshot=read;}};return true;})`,failure);
   const before=s.worker.messages.filter(x=>x.type==='OZ_WORK_SEND_INITIAL_PROMPT').length;
   const response=await s.popup('SA_WORK_START',{store_id:b.id,confirm_change:true});
   assert.equal(response.ok,false);assert.equal(response.code,'WORK_ADMISSION_CONTEXT_CHANGED');
   assert.equal((await s.worker.call('bindingForConversationKey',started.key)).store_context.storeId,a.id);
   assert.equal((await s.worker.call('workSessionFor',started.key)).finished,true);
   assert.equal(s.worker.messages.filter(x=>x.type==='OZ_WORK_SEND_INITIAL_PROMPT').length,before);assert.equal(s.worker.network.length,0);
  }finally{s.worker.close();}
 }
});


await test('A06-popup-unconfirmed-ACK-is-truthful-and-nonconsuming', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(path.join(runtime, 'popup.js'), 'utf8');
  const start = source.indexOf('function transferReceivePresentation(result)');
  const end = source.indexOf('\nasync function requestTransferReceivePending()', start);
  assert.ok(start >= 0 && end > start);
  const presentation = new Function(source.slice(start, end) + '; return transferReceivePresentation;')();
  const statusStart = source.indexOf('function actionSuccessText(result)');
  const status = new Function(source.slice(statusStart, start) + '; return actionSuccessText;')();
  const cases = [
    [{ok:false,code:'TRANSFER_ACK_UNCONFIRMED',importState:'IMPORTED_PENDING_ACK',ackConfirmed:false,result:{stores:['PRIVATE_FIXTURE']}}, /сохранён локально.*не подтвердил/i],
    [{ok:false,code:'TRANSFER_REQUEST_MISMATCH',importState:'IMPORTED_PENDING_ACK',ackConfirmed:false}, /не подтвердил завершение/i],
    ...['TRANSFER_EXPIRED','TRANSFER_REPLAY','TRANSFER_ACK_UNCONFIRMED'].map(code => [{ok:false,code,importState:'PENDING',ackConfirmed:false}, /не подтвердил завершение/i]),
    [{ok:false,code:'TRANSFER_EXPIRED',importState:'EXPIRED',ackConfirmed:false}, /подтвердил.*истёк/i],
    [{ok:false,code:'TRANSFER_REPLAY',importState:'CANCELLED',ackConfirmed:false}, /подтвердил отмену/i],
  ];
  const handlerStart = source.indexOf('$("transfer-receive").onclick =');
  const handlerEnd = source.indexOf('\n$("support-generate")', handlerStart);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  for (const [response, expected] of cases) {
    const shown = presentation(response);
    assert.match(shown.text, expected); assert.equal(shown.consume, false);
    assert.doesNotMatch(shown.text, /PRIVATE_FIXTURE|Передача принята|Создайте новый запрос/);
    const elements = {'transfer-receive':{},'transfer-status':{}}, calls=[];
    let result;
    const install = new Function('$','action','requestTransferReceivePending','request',source.slice(handlerStart,handlerEnd));
    install(id=>elements[id],async fn=>{result=await fn();},async()=>({response,presentation:shown}),async(...args)=>calls.push(args));
    await elements['transfer-receive'].onclick();
    assert.equal(elements['transfer-status'].textContent,shown.text);
    assert.equal(status(result),shown.text,'general status must not claim generic success');
    assert.deepEqual(calls,[],'unconfirmed/terminal result must not be consumed');
  }
  for (const code of ['TRANSFER_ACCOUNT_MISMATCH','AUTH_REQUIRED']) {
    assert.equal(presentation({ok:false,code,importState:'PENDING',ackConfirmed:false}),null);
  }
  assert.equal(presentation({ok:false,code:'TRANSFER_ACK_UNCONFIRMED',importState:'IMPORTED_PENDING_ACK'}),null);
  assert.equal(presentation({ok:true,importState:'IMPORTED',requestId:'fixture'}).consume,true);
});

if (selectedScenario && results.length !== 1) throw new Error('Selected scenario was not executed');
console.log(JSON.stringify({ status:'PASS', results, live_provider_calls:0, scope:'actual generated worker/popup messages and attachment port; simulated browser and provider; not installed live acceptance' },null,2));
