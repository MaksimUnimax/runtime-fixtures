/* B02: deterministic original-source/assembled-worker concurrency regression.
 * Pure VM with delayed chrome.storage-style reads; never touches the browser,
 * credentials, provider, production storage, or any real AI session.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '../../../..');
const arg = process.argv[2];
const workerPath = arg
  ? path.join(path.resolve(arg), 'service_worker.js')
  : path.join(root, 'apps/extension/src/imported/ozon-v0.1.22/service_worker.js');
const source = fs.readFileSync(workerPath, 'utf8');
function section(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'Missing original production code anchor: ' + start);
  return source.slice(a, b);
}
const code = [
  section('function normalizeConversationKey(value) {', 'function normalizeTabId(value) {'),
  section('function normalizeIdentity(identity) {', 'function sameConversationIdentity('),
  section('function withConversationMapsWrite(fn) {', 'async function resolveConfirmedConversationKey('),
  section('async function getAutoRun(conversationKey) {', 'async function setManualMode(conversationKey, enabled) {'),
  section('function withPrefixWrite(fn) {', 'function publicRun(run) {'),
].join('\n');

const K = Object.freeze({
  MANUAL_MODES: 'ozmb_manual_modes',
  AUTO_RUNS: 'ozmb_auto_runs',
  REPORT_PREFIXES: 'ozmb_report_prefixes',
  AUTO_START_PROMPTS: 'ozmb_auto_start_prompts',
});
const other = 'https://chatgpt.com|other-conversation';
const newer = 'https://chatgpt.com|new-confirmed-chat';
const legacy = 'chatgpt:c:new-confirmed-chat';
const identity = { origin: 'https://chatgpt.com', conversation_id: 'new-confirmed-chat', status: 'confirmed' };
const copy = value => structuredClone(value);
const results = [];

async function migrationVsOtherWriters(withLegacy) {
  let readEntered;
  const gateEntered = new Promise(resolve => { readEntered = resolve; });
  let releaseRead;
  const held = new Promise(resolve => { releaseRead = resolve; });
  let paused = false;
  const maps = {
    [K.AUTO_RUNS]: { [other]: { run_id: 'other-run', status: 'DISPATCH_INTENT_COMMITTED' } },
    [K.MANUAL_MODES]: {},
    [K.REPORT_PREFIXES]: {},
    [K.AUTO_START_PROMPTS]: {},
  };
  if (withLegacy) {
    maps[K.AUTO_RUNS][legacy] = { run_id: 'old-run', conversation_key: legacy };
    maps[K.MANUAL_MODES][legacy] = true;
    maps[K.REPORT_PREFIXES][legacy] = { text: 'old-prefix' };
    maps[K.AUTO_START_PROMPTS][legacy] = { text: 'old-prompt', is_default: false };
  }
  const storageGet = async keys => {
    const names = Array.isArray(keys) ? keys : [keys];
    const snapshot = Object.fromEntries(names.map(k => [k, copy(maps[k] || {})]));
    if (names.length === 4 && !paused) {
      paused = true;
      readEntered();
      await held;
    }
    return snapshot;
  };
  const storageSet = async values => {
    Object.assign(maps, copy(values));
  };
  const context = vm.createContext({
    KEYS: K, storageGet, storageSet,
    DEFAULT_AUTO_START_TEXT: 'default',
    BB2ConversationIdentity: { providerForOrigin: origin => origin === 'https://chatgpt.com' ? 'chatgpt' : null, isLocal: () => false },
    SellerAgentsConversationIdentity: { normalizeProof: proof => proof || null },
    BridgeAutorunModel: {
      canEnableManualMode: () => true,
      normalizePrefixRecord: value => value,
      noteConfirmedPrefix: (previous, applied, id) => ({ ...previous, applied, id }),
    },
  });
  vm.runInContext(
    'let conversationMapsWriteLock = Promise.resolve();\n' + code +
    '\nthis.migrate=migrateLegacyConversationStorage;' +
    'this.mutate=mutateAutoRun;' +
    'this.manual=writeManualModeState;' +
    'this.prefix=saveReportPrefix;' +
    'this.prompt=saveAutoStartPrompt;',
    context, { filename: 'ACTUAL_COMPOSED_B02_WORKER_MAP_FUNCTIONS.js' },
  );
  const migration = context.migrate(identity);
  await gateEntered;
  const writers = [
    context.mutate(other, current => ({ ...current, status: 'RESPONSE_RECEIVED' })),
    context.manual(other, true),
    context.prefix(other, { report_prefix_enabled: true, report_prefix_text: 'other-prefix', report_prefix_interval: 2 }),
    context.prompt(other, 'other-prompt'),
  ];
  // The read was captured before the other dialogue changed any of the maps.
  // With a shared lock, all writers wait until migration has safely committed.
  releaseRead();
  await Promise.all([migration, ...writers]);
  assert.equal(maps[K.AUTO_RUNS][other].status, 'RESPONSE_RECEIVED');
  assert.equal(maps[K.MANUAL_MODES][other], true);
  assert.equal(maps[K.REPORT_PREFIXES][other].text, 'other-prefix');
  assert.equal(maps[K.AUTO_START_PROMPTS][other].text, 'other-prompt');
  if (withLegacy) {
    for (const k of Object.values(K)) {
      assert.equal(Object.hasOwn(maps[k], legacy), false, 'legacy key remains in ' + k);
      assert.equal(Object.hasOwn(maps[k], newer), true, 'migrated key missing in ' + k);
    }
    assert.equal(maps[K.AUTO_RUNS][newer].conversation_key, newer);
  } else {
    for (const k of Object.values(K)) {
      assert.equal(Object.hasOwn(maps[k], newer), false, 'migration created ghost record in ' + k);
      assert.equal(Object.hasOwn(maps[k], legacy), false);
    }
  }
  await assert.rejects(context.migrate({ ...identity, status: 'conflict' }), error => error?.code === 'CONVERSATION_IDENTITY_CONFLICT');
  // Subsequent writes must work after a rejected operation; the shared lock is not poisoned.
  await context.prompt(other, 'prompt-after-rejected-conflict');
  assert.equal(maps[K.AUTO_START_PROMPTS][other].text, 'prompt-after-rejected-conflict');
  results.push({ name: withLegacy ? 'legacy-map-migration' : 'no-legacy-map-migration',
    status: 'PASS', keys_preserved: Object.values(K), cross_dialogue_run: maps[K.AUTO_RUNS][other].status });
}

await migrationVsOtherWriters(false);
await migrationVsOtherWriters(true);
console.log(JSON.stringify({
  verdict: 'SOURCE_PACKAGE_FOUR_MAP_RACE_PASS__NOT_NATIVE_ACCEPTANCE',
  worker_path: path.relative(root, workerPath),
  cases: results,
  provider_calls: 0,
  browser_mutations: 0,
  real_storage_mutations: 0,
}, null, 2));
