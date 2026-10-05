import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { makeWorker } from './worker-harness.mjs';

// Offline regression over the actual composed runtime. No browser/network or
// provider calls; only the composer and Chrome transport boundary are fakes.
const runtime = path.resolve(process.argv[2]);
const source = fs.readFileSync(path.join(runtime, 'content_script.js'), 'utf8');
const workerSource = fs.readFileSync(path.join(runtime, 'service_worker.js'), 'utf8');
const applicationRuntimeSource = fs.readFileSync(path.join(runtime, 'shared/application.js'), 'utf8');
const start = source.indexOf('  async function sendWorkSessionPrompt(');
const end = source.indexOf('\n  async function currentRecovery(', start);
assert(start >= 0 && end > start);
const body = source.slice(start, end);
const results = [];
async function test(id, fn) { await fn(); results.push({ id, status: 'PASS' }); }
await test('tab-message-transport-classification-is-bounded', async () => {
  const transportStart = workerSource.indexOf('const TAB_MESSAGE_TRANSPORT_CLASSES = new Set([');
  const transportEnd = workerSource.indexOf('\nasync function tabMessage(', transportStart);
  assert(transportStart >= 0 && transportEnd > transportStart);
  const sandbox = { Set };
  vm.createContext(sandbox);
  vm.runInContext(
    workerSource.slice(transportStart, transportEnd) +
      '\nglobalThis.classifyTabMessageTransportError = classifyTabMessageTransportError;' +
      '\nglobalThis.safeTabMessageTransportClass = safeTabMessageTransportClass;',
    sandbox,
  );
  const classify = sandbox.classifyTabMessageTransportError;
  const safe = sandbox.safeTabMessageTransportClass;
  assert.equal(classify({ message: 'Could not establish connection. Receiving end does not exist.' }), 'NO_RECEIVER');
  assert.equal(classify({ message: 'The message port closed before a response was received.' }), 'PORT_CLOSED');
  assert.equal(classify({ message: 'No tab with id: 7.' }), 'TAB_GONE');
  assert.equal(classify({ message: 'Extension context invalidated.' }), 'CONTEXT_INVALIDATED');
  assert.equal(classify({ message: 'Unrecognized localized failure text' }), 'OTHER_TAB_MESSAGE_ERROR');
  assert.equal(classify(new Error('arbitrary sync exception'), 'sync_exception'), 'SYNC_SEND_EXCEPTION');
  assert.equal(safe('NO_RECEIVER'), 'NO_RECEIVER');
  assert.equal(safe('raw browser error'), null);

  const tabMessageEnd = workerSource.indexOf('\nasync function stopWatch(', transportEnd);
  assert(tabMessageEnd > transportEnd);
  const transportRuntime = workerSource.slice(transportStart, tabMessageEnd);
  const makeTransportSandbox = ({ lastError = null, throwSync = null } = {}) => {
    const transportSandbox = {
      Set,
      chrome: {
        runtime: { lastError },
        tabs: {
          sendMessage: (_tabId, _message, callback) => {
            if (throwSync) throw throwSync;
            callback(undefined);
          },
        },
      },
    };
    vm.createContext(transportSandbox);
    vm.runInContext(transportRuntime + '\nglobalThis.tabMessageForTest = tabMessage;', transportSandbox);
    return transportSandbox;
  };
  const runtimeFailure = await makeTransportSandbox({
    lastError: { message: 'Could not establish connection. Receiving end does not exist. RAW_BROWSER_TEXT' },
  }).tabMessageForTest(7, { type: 'SYNTHETIC' });
  assert.deepEqual(JSON.parse(JSON.stringify(runtimeFailure)), {
    ok: false,
    code: 'TAB_MESSAGE_ERROR',
    transport_class: 'NO_RECEIVER',
  });
  assert(!Object.hasOwn(runtimeFailure, 'error'));
  assert(!JSON.stringify(runtimeFailure).includes('RAW_BROWSER_TEXT'));

  const syncFailure = await makeTransportSandbox({
    throwSync: new Error('RAW_SYNC_EXCEPTION_TEXT'),
  }).tabMessageForTest(7, { type: 'SYNTHETIC' });
  assert.deepEqual(JSON.parse(JSON.stringify(syncFailure)), {
    ok: false,
    code: 'TAB_MESSAGE_ERROR',
    transport_class: 'SYNC_SEND_EXCEPTION',
  });
  assert(!Object.hasOwn(syncFailure, 'error'));
  assert(!JSON.stringify(syncFailure).includes('RAW_SYNC_EXCEPTION_TEXT'));

  const dispatchStart = workerSource.indexOf('async function dispatchPendingWorkStartPrompt(');
  const dispatchEnd = workerSource.indexOf('\nasync function clearPendingWorkStart(', dispatchStart);
  assert(dispatchStart >= 0 && dispatchEnd > dispatchStart);
  const dispatch = workerSource.slice(dispatchStart, dispatchEnd);
  assert.match(dispatch, /transport_class: lostTransportClass/);
  assert.doesNotMatch(dispatch, /transport_class:\s*sent\?\.error/);
  const lostMarker = dispatch.indexOf('WORK_START_CONTENT_RESPONSE_LOST_NO_RETRY');
  assert(lostMarker >= 0);
  assert.match(dispatch.slice(lostMarker), /return;/);
});

await test('last-start-projects-only-allowlisted-transport-class', async () => {
  const helperStart = applicationRuntimeSource.indexOf('function saSupportCode(');
  const helperEnd = applicationRuntimeSource.indexOf('\nasync function saSupportSnapshot(', helperStart);
  assert(helperStart >= 0 && helperEnd > helperStart);
  const key = 'diagnostics';
  const rows = [{
    event: 'WORK_START_CONTENT_RESPONSE_LOST_NO_RETRY',
    tab_id: 17,
    code: 'TAB_MESSAGE_ERROR',
    transport_class: 'NO_RECEIVER',
  }];
  const sandbox = {
    KEYS: { DIAGNOSTICS: key },
    storageGet: async () => ({ [key]: rows }),
    Set,
  };
  vm.createContext(sandbox);
  vm.runInContext(
    applicationRuntimeSource.slice(helperStart, helperEnd) +
      '\nglobalThis.saLastStartDiagnostic = saLastStartDiagnostic;',
    sandbox,
  );
  const projected = JSON.parse(JSON.stringify(await sandbox.saLastStartDiagnostic(17)));
  assert.deepEqual(projected, {
    stage: 'send',
    code: 'TAB_MESSAGE_ERROR',
    outcome: 'unknown_no_retry',
    transportClass: 'NO_RECEIVER',
  });
  rows[0].transport_class = 'Could not establish connection. Receiving end does not exist.';
  const rejectedRaw = JSON.parse(JSON.stringify(await sandbox.saLastStartDiagnostic(17)));
  assert.equal(rejectedRaw.transportClass, null);
  assert(!JSON.stringify(rejectedRaw).includes('Receiving end'));
});

function setup(options = {}) {
  const state = { draft: options.draft || '', writes: 0, clicks: 0, committed: options.committed || false, outcomes: [], current: true, conversation: 'synthetic-dialogue' };
  const composer = {};
  const context = { composer };
  const canonicalText = x => String(x || '').trim();
  const sandbox = {
    console, Set, runtimeId: 'synthetic-content-actor', workRuntimeGeneration: 'synthetic-generation',
    current: () => state.current,
    waitForWorkStartComposerContext: async () => context,
    primaryComposerContext: () => context,
    assistantTurnIds: () => [], canonicalText, normalizedDeliveryText: canonicalText,
    composerText: () => state.draft,
    setComposerText: (_, text) => { state.writes++; state.draft = text; },
    waitForStableSendTargetWithRetry: async () => options.noTarget ? null : {},
    conversationIdentity: () => ({ origin: 'https://synthetic.invalid', ai_id: 'chatgpt', conversation_id: state.conversation }),
    sendRuntime: async (type, message) => {
      if (type === 'OZ_WORK_START_COMMIT_REQUEST') {
        if (options.reject) return { ok: false, code: 'WORK_PENDING_CONVERSATION_CHANGED' };
        const allowed = !state.committed; state.committed = true;
        if (options.editDuringCommit) state.draft = 'owner typed another draft';
        if (options.replaceRuntime) state.current = false;
        if (options.navigateDuringCommit) state.conversation = 'another-dialogue';
        return { ok: true, committed: true, click_allowed: allowed };
      }
      if (type === 'OZ_WORK_START_VERIFY_COMMITTED') return options.revokeBeforeClick ? { ok: false, code: 'WORK_ADMISSION_CONTEXT_CHANGED' } : { ok: true, valid: true };
      assert.equal(type, 'OZ_WORK_START_SEND_OUTCOME'); state.outcomes.push(message);
      if (options.loseOutcome) return { ok: false, code: 'RUNTIME_ERROR' };
      return { ok: true, accepted: true, send_outcome: 'sent_acknowledged' };
    },
    clickComposerUntilEmpty: async () => { state.clicks++; state.draft = ''; return { click_event_observed: true, composer_empty: true }; },
    startWorkStartResponseWatch: () => {}, recordContentDiagnostic: () => {},
  };
  // Send transaction boundary; shared surface has separate model and browser coverage.
  sandbox.currentAIAdapter = () => ({});
  sandbox.SellerAgentsConversationSurface = { beginStart: () => sandbox.conversationIdentity() };
  vm.createContext(sandbox); vm.runInContext(body + '\nglobalThis.send = sendWorkSessionPrompt;', sandbox);
  return { state, send: () => sandbox.send('synthetic initial instruction', 'synthetic-intent', 1) };
}
await test('committed-intent-does-not-reinsert-draft', async () => {
  const { state, send } = setup({ committed: true });
  const result = await send(); assert.equal(result.committed_elsewhere, true);
  assert.equal(state.writes, 0); assert.equal(state.clicks, 0); assert.equal(state.draft, '');
});
await test('normal-start-inserts-and-clicks-once', async () => {
  const { state, send } = setup(); assert.equal((await send()).sent, true);
  assert.equal(state.writes, 1); assert.equal(state.clicks, 1);
  assert.equal(state.outcomes[0].composer_empty, true);
  await send(); assert.equal(state.writes, 1); assert.equal(state.clicks, 1); assert.equal(state.draft, '');
});
await test('concurrent-delivery-only-one-writer-and-click', async () => {
  const { state, send } = setup(); const results = await Promise.all([send(), send()]);
  assert.equal(results.filter(x => x.sent === true).length, 1);
  assert.equal(state.writes, 1); assert.equal(state.clicks, 1);
});
await test('lost-outcome-cannot-reinsert-or-repeat-click', async () => {
  const { state, send } = setup({ loseOutcome: true });
  await assert.rejects(send(), { code: 'RUNTIME_ERROR' });
  await send(); assert.equal(state.writes, 1); assert.equal(state.clicks, 1); assert.equal(state.draft, '');
});
await test('rejected-context-does-not-touch-composer', async () => {
  const { state, send } = setup({ reject: true });
  await assert.rejects(send(), { code: 'WORK_PENDING_CONVERSATION_CHANGED' });
  assert.equal(state.writes, 0); assert.equal(state.clicks, 0);
});
await test('owner-edit-during-commit-is-preserved', async () => {
  const { state, send } = setup({ editDuringCommit: true });
  await assert.rejects(send(), { code: 'COMPOSER_CONTAINS_OTHER_TEXT' });
  assert.equal(state.writes, 0); assert.equal(state.clicks, 0); assert.equal(state.draft, 'owner typed another draft');
  assert.equal(state.outcomes[0].click_event_observed, false);
});
await test('replaced-runtime-does-not-insert', async () => {
  const { state, send } = setup({ replaceRuntime: true });
  await assert.rejects(send(), { code: 'CONTENT_RUNTIME_SUPERSEDED' });
  assert.equal(state.writes, 0); assert.equal(state.clicks, 0);
});
await test('send-target-failure-is-recorded-before-click', async () => {
  const { state, send } = setup({ noTarget: true });
  await assert.rejects(send(), { code: 'WORK_START_SEND_TARGET_UNAVAILABLE' });
  assert.equal(state.clicks, 0); assert.equal(state.outcomes[0].click_event_observed, false);
});
await test('navigation-during-commit-does-not-insert', async () => {
  const { state, send } = setup({ navigateDuringCommit: true });
  await assert.rejects(send(), { code: 'WORK_PENDING_CONVERSATION_CHANGED' });
  assert.equal(state.writes, 0); assert.equal(state.clicks, 0);
});
await test('authority-is-rechecked-after-target-readiness', async () => {
  const { state, send } = setup({ revokeBeforeClick: true });
  await assert.rejects(send(), { code: 'WORK_ADMISSION_CONTEXT_CHANGED' });
  assert.equal(state.clicks, 0);
});
await test('encrypted-file-roundtrip-preserves-Ozon-and-WB-keys', async () => {
  const sourceWorker = await makeWorker(runtime);
  const targetWorker = await makeWorker(runtime);
  try {
    await sourceWorker.call('SellerAgentsActiveStoreCatalog.save', { marketplace: 'ozon', name: 'Synthetic Ozon', credentials: { seller: { clientId: '123456', apiKey: 'FIXTURE_OZON_NEVER_REAL' } } });
    await sourceWorker.call('SellerAgentsActiveStoreCatalog.save', { marketplace: 'wildberries', name: 'Synthetic WB', credentials: { token: 'FIXTURE_WB_NEVER_REAL' } });
    const password = 'synthetic-file-password';
    const exported = await sourceWorker.popup({ type: 'SA_BACKUP_EXPORT', password, passwordConfirmation: password });
    assert.equal(exported.ok, true, exported.code); assert.equal(exported.storeCount, 2);
    assert(!exported.backup.includes('FIXTURE_OZON_NEVER_REAL')); assert(!exported.backup.includes('FIXTURE_WB_NEVER_REAL'));
    const wrong = await targetWorker.popup({ type: 'SA_BACKUP_PREVIEW', backup: exported.backup, password: 'wrong-password' });
    assert.equal(wrong.ok, false);
    const preview = await targetWorker.popup({ type: 'SA_BACKUP_PREVIEW', backup: exported.backup, password });
    assert.equal(preview.ok, true, preview.code); assert.equal(preview.preview.safeImportCount, 2);
    const imported = await targetWorker.popup({ type: 'SA_BACKUP_IMPORT', backup: exported.backup, password, apply: true });
    assert.equal(imported.ok, true, imported.code); assert.equal(imported.imported.length, 2);
    for (const row of imported.imported) {
      const saved = await targetWorker.call('SellerAgentsActiveStoreCatalog.get', row.id);
      if (row.marketplace === 'ozon') assert.equal(saved.credentials.seller.apiKey, 'FIXTURE_OZON_NEVER_REAL');
      else assert.equal(saved.credentials.token, 'FIXTURE_WB_NEVER_REAL');
    }
    const repeated = await targetWorker.popup({ type: 'SA_BACKUP_IMPORT', backup: exported.backup, password, apply: true });
    assert.equal(repeated.ok, true); assert.equal(repeated.imported.length, 0);
    if (process.env.OWNER_UI_FIXTURE) {
      const state = await sourceWorker.popup({ type: 'SA_POPUP_STATE', tab_id: 1 });
      state.identity = { ai_id: 'chatgpt', status: 'unknown', conversation_id: null };
      state.pending = { send_outcome: 'committed_before_click' };
      state.lastStart = { stage: 'send', code: 'TAB_MESSAGE_ERROR', outcome: 'unknown_no_retry' };
      fs.writeFileSync(process.env.OWNER_UI_FIXTURE, JSON.stringify({ state, exported, preview, imported, password }));
    }
  } finally { sourceWorker.close(); targetWorker.close(); }
});
console.log(JSON.stringify({ level: 'PACKAGE_OFFLINE', status: 'PASS', cases: results }, null, 2));
