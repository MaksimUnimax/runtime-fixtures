/* B02: deterministic source/package map-writer concurrency regression.
 * The attachment consumer is the actual composed shared/file_delivery_port_worker.js.
 * VM storage is synthetic; this never opens a browser, provider, account, or live store.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const runtimeArg = process.argv.slice(2).find(value => !value.startsWith('--'));
assert.ok(runtimeArg, 'Pass the actual composed runtime directory; frozen donor fallback is not valid for this regression.');
const runtimePath = path.resolve(runtimeArg);
const serviceWorker = fs.readFileSync(path.join(runtimePath, 'service_worker.js'), 'utf8');
const entryWorker = fs.readFileSync(path.join(runtimePath, 'service_worker_entry.js'), 'utf8');
const attachmentWorker = fs.readFileSync(path.join(runtimePath, 'shared/file_delivery_port_worker.js'), 'utf8');
const modelSource = fs.readFileSync(path.join(runtimePath, 'shared/bridge_autorun_model.js'), 'utf8');

function section(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'Missing actual composed source anchor: ' + start);
  return source.slice(a, b);
}

const entryMainAt = entryWorker.indexOf('importScripts("service_worker.js")');
const entryAttachmentAt = entryWorker.indexOf('importScripts("shared/file_delivery_port_worker.js")');
assert.ok(entryMainAt >= 0 && entryAttachmentAt > entryMainAt,
  'The actual service_worker_entry must load the main queue before the attachment consumer.');

const modelProbe = vm.createContext({
  OzonAIDeliveryCapabilities: {},
  crypto: { randomUUID: () => 'model-probe-uuid' },
});
vm.runInContext(modelSource, modelProbe, { filename: 'actual-composed-shared-bridge_autorun_model.js' });
const BridgeAutorunModel = modelProbe.BridgeAutorunModel;
assert.ok(BridgeAutorunModel?.ATTACHMENT_PHASES?.SEND_COMMITTED,
  'The actual composed BridgeAutorunModel must load before building fixture states.');
const PHASES = BridgeAutorunModel.ATTACHMENT_PHASES;
const RUN_STATUSES = BridgeAutorunModel.RUN_STATUSES;

const mainCode = [
  section(serviceWorker, 'function normalizeConversationKey(value) {', 'function normalizeTabId(value) {'),
  section(serviceWorker, 'function normalizeIdentity(identity) {', 'function sameConversationIdentity('),
  section(serviceWorker, 'function withConversationMapsWrite(fn) {', 'async function resolveConfirmedConversationKey('),
  section(serviceWorker, 'async function getAutoRun(conversationKey) {', 'async function setManualMode('),
  section(serviceWorker, 'function withPrefixWrite(fn) {', 'function publicRun('),
  section(serviceWorker, 'async function bindConversation(context, options = {}) {',
    '\n// All four per-conversation maps share a single read-modify-write queue.'),
].join('\n');

const K = Object.freeze({
  MANUAL_MODES: 'ozmb_manual_modes',
  AUTO_RUNS: 'ozmb_auto_runs',
  REPORT_PREFIXES: 'ozmb_report_prefixes',
  AUTO_START_PROMPTS: 'ozmb_auto_start_prompts',
  MANUAL_OPERATIONS: 'ozmb_manual_operations',
  CONVERSATION_BINDINGS: 'ozmb_conversation_bindings',
});
const ORIGIN = 'https://chatgpt.com';
const other = ORIGIN + '|other-conversation';
const newer = ORIGIN + '|new-confirmed-chat';
const legacy = 'chatgpt:c:new-confirmed-chat';
const identity = { origin: ORIGIN, conversation_id: 'new-confirmed-chat', status: 'confirmed' };
const appliedDeliveryId = 'delivery-B-confirmed';
const copy = value => structuredClone(value);

function baseMaps({ withLegacy = false, collision = false, ownerKind = 'manual', applied = true } = {}) {
  const deliveryOwner = {
    operation_id: 'operation-B',
    run_id: 'run-B',
    status: ownerKind === 'autorun' ? RUN_STATUSES.DELIVERING : 'delivering',
    sequence: 4,
    tab_id: 7,
    origin: ORIGIN,
    conversation_id: 'other-conversation',
    authority_allowed: true,
    authority_expires_at_ms: Date.now() + 60_000,
    delivery: {
      mode: 'attachment_watch_v1',
      phase: PHASES.SEND_COMMITTED,
      delivery_id: appliedDeliveryId,
      report_prefix_applied: applied,
      artifact_descriptors: [],
    },
  };
  const maps = {
    [K.AUTO_RUNS]: {
      [other]: ownerKind === 'autorun' ? deliveryOwner : {
        run_id: 'other-run',
        status: RUN_STATUSES.PAUSED,
        unchanged_marker: 'B-auto-run',
      },
    },
    [K.MANUAL_MODES]: { [other]: false },
    [K.REPORT_PREFIXES]: {
      [other]: {
        enabled: true,
        text: 'B original prefix',
        interval: 4,
        delivered_count: 7,
        last_applied_at_count: 3,
        last_confirmed_delivery_id: 'B-previous-delivery',
        updated_at: '2026-10-31T00:00:00.000Z',
      },
    },
    [K.AUTO_START_PROMPTS]: { [other]: { text: 'B prompt', is_default: false } },
    [K.MANUAL_OPERATIONS]: ownerKind === 'manual' ? { [other]: deliveryOwner } : {},
    [K.CONVERSATION_BINDINGS]: {},
  };
  if (withLegacy) {
    maps[K.AUTO_RUNS][legacy] = {
      run_id: 'legacy-run',
      conversation_key: legacy,
      status: RUN_STATUSES.PAUSED,
    };
    maps[K.MANUAL_MODES][legacy] = true;
    maps[K.REPORT_PREFIXES][legacy] = {
      enabled: true, text: 'legacy A', interval: 2, delivered_count: 1,
      last_applied_at_count: 0, last_confirmed_delivery_id: 'legacy-A-id',
    };
    maps[K.AUTO_START_PROMPTS][legacy] = { text: 'legacy A prompt', is_default: false };
    if (collision) {
      maps[K.AUTO_RUNS][newer] = {
        run_id: 'real-A-run',
        conversation_key: newer,
        status: RUN_STATUSES.PAUSED,
      };
      maps[K.MANUAL_MODES][newer] = false;
      maps[K.REPORT_PREFIXES][newer] = {
        enabled: true, text: 'real A prefix', interval: 6, delivered_count: 22,
        last_applied_at_count: 12, last_confirmed_delivery_id: 'real-A-id',
      };
      maps[K.AUTO_START_PROMPTS][newer] = { text: 'real A prompt', is_default: false };
    }
  }
  return maps;
}

function createStore(initial) {
  const maps = copy(initial);
  let readPause = null;
  let nextSetFailure = null;
  return {
    maps,
    pauseNextRead(matches) {
      let signalEntered;
      let release;
      const entered = new Promise(resolve => { signalEntered = resolve; });
      const held = new Promise(resolve => { release = resolve; });
      const gate = { matches, entered, signalEntered, held, release, consumed: false };
      readPause = gate;
      return { entered, release: () => release(), gate };
    },
    failNextSet(matches, error) { nextSetFailure = { matches, error }; },
    async get(keys) {
      const names = Array.isArray(keys) ? keys : [keys];
      const result = Object.fromEntries(names.map(key => [key, copy(maps[key] || {})]));
      const gate = readPause;
      if (gate && !gate.consumed && gate.matches(keys, names)) {
        gate.consumed = true;
        gate.signalEntered();
        await gate.held;
      }
      return result;
    },
    async set(values) {
      if (nextSetFailure && nextSetFailure.matches(values)) {
        const failure = nextSetFailure.error;
        nextSetFailure = null;
        throw failure;
      }
      Object.assign(maps, copy(values));
    },
  };
}

function makeMessage(ownerKind = 'manual', ownerId = 'operation-B', deliveryId = appliedDeliveryId) {
  return {
    conversation_key: other,
    owner_kind: ownerKind,
    owner_id: ownerId,
    delivery_id: deliveryId,
    live_owner: { origin: ORIGIN, conversation_id: 'other-conversation', status: 'confirmed' },
  };
}

function makeSender(tabId = 7, origin = ORIGIN) {
  return { tab: { id: tabId, url: origin + '/c/other-conversation' }, url: origin + '/c/other-conversation' };
}

function createWorld(initial) {
  const store = createStore(initial);
  let bindingLock = Promise.resolve();
  let authorityCalls = 0;
  let sellerAgentsEnabled = false;
  let uuid = 0;
  let queueCount = 0;
  const queueWaiters = new Set();
  const bindingWrite = fn => {
    const next = bindingLock.then(fn, fn);
    bindingLock = next.catch(() => null);
    return next;
  };
  const sandbox = {
    KEYS: K,
    storageGet: keys => store.get(keys),
    storageSet: values => store.set(values),
    DEFAULT_AUTO_START_TEXT: 'default prompt',
    BB2ConversationIdentity: {
      providerForOrigin: origin => origin === ORIGIN ? 'chatgpt' : null,
      isLocal: () => false,
    },
    SellerAgentsConversationIdentity: { normalizeProof: proof => proof || null },
    OzonRuntime: { STORAGE_KEYS: K },
    ProviderTransportCore: {},
    OzonAIDeliveryCapabilities: {},
    URL,
    crypto: { randomUUID: () => 'synthetic-uuid-' + (++uuid) },
    chrome: {
      storage: { local: { get: keys => store.get(keys), set: values => store.set(values) } },
      runtime: { onConnect: { addListener() {} } },
      tabs: { async sendMessage() { return { ok: true }; } },
    },
    saEnabled: async () => sellerAgentsEnabled,
    async getManualOperation(key) {
      return copy(store.maps[K.MANUAL_OPERATIONS]?.[key] || null);
    },
    async mutateManualOperation(key, mutator) {
      const current = copy(store.maps[K.MANUAL_OPERATIONS]?.[key] || null);
      const next = await mutator(current);
      const operations = { ...(store.maps[K.MANUAL_OPERATIONS] || {}) };
      if (next) operations[key] = copy(next);
      else delete operations[key];
      store.maps[K.MANUAL_OPERATIONS] = operations;
      return copy(next || null);
    },
    async saAssertDeliveryOwner(owner) {
      authorityCalls += 1;
      if (owner.authority_allowed === false) {
        throw Object.assign(new Error('synthetic authority denied'), { code: 'OWNER_AUTHORITY_DENIED' });
      }
      if (Number(owner.authority_expires_at_ms || 0) <= Date.now()) {
        throw Object.assign(new Error('synthetic authority expired'), { code: 'OWNER_AUTHORITY_EXPIRED' });
      }
    },
    normalizeTabId: value => Number(value),
    sameConversationIdentity: (left, right) =>
      left?.origin === right?.origin && left?.conversation_id === right?.conversation_id,
    withBindingWrite: bindingWrite,
    async resolveConfirmedConversationKey(value) {
      return String(value.origin) + '|' + String(value.conversation_id);
    },
    async tabIdentity() {
      return { origin: ORIGIN, conversation_id: 'bind-chat', status: 'confirmed', ai_id: 'chatgpt' };
    },
    async getConversationBindings() { return copy(store.maps[K.CONVERSATION_BINDINGS] || {}); },
    normalizeBindingRecord(value) { return value || null; },
    async saNextBindingRevision() { return 1; },
    async diagnostic() {},
    bindingSnapshot(record) { return { binding_id: record.binding_id, revision: record.revision }; },
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(modelSource, context, { filename: 'actual-composed-shared-bridge_autorun_model.js' });
  if (!context.BridgeAutorunModel?.ATTACHMENT_PHASES?.SEND_COMMITTED) {
    throw new Error('Actual composed BridgeAutorunModel did not initialize in the service-worker VM.');
  }
  const exportedMain = [
    'let conversationMapsWriteLock = Promise.resolve();',
    'let queueObserver = null;',
    'const originalConversationMapsWrite = withConversationMapsWrite;',
    'withConversationMapsWrite = function(fn) {',
    '  if (queueObserver) queueObserver();',
    '  return originalConversationMapsWrite(fn);',
    '};',
    'this.setQueueObserver = fn => { queueObserver = fn; };',
    'this.migrate = migrateLegacyConversationStorage;',
    'this.mutate = mutateAutoRun;',
    'this.manual = writeManualModeState;',
    'this.prefix = saveReportPrefix;',
    'this.notePrefix = noteConfirmedPrefix;',
    'this.prompt = saveAutoStartPrompt;',
    'this.bind = bindConversation;',
  ].join('\n');
  vm.runInContext(mainCode + '\n' + exportedMain, context, { filename: 'actual-composed-service_worker-map-functions.js' });
  context.setQueueObserver(() => {
    queueCount += 1;
    for (const waiter of queueWaiters) {
      if (queueCount >= waiter.target) {
        queueWaiters.delete(waiter);
        waiter.resolve();
      }
    }
  });
  const exposeAnchor = '  globalThis.OzonFileDeliveryWorker = Object.freeze({';
  assert.equal(attachmentWorker.split(exposeAnchor).length - 1, 1, 'Actual attachment worker export anchor must be unique.');
  const instrumentedPort = attachmentWorker.replace(
    exposeAnchor,
    '  globalThis.__B02_ATTACHMENT_TEST = Object.freeze({ confirmAttachmentDelivery, commitAttachment, commitAttachmentSend, rollbackAttachmentSend, ownerForMessage });\n' + exposeAnchor,
  );
  vm.runInContext(instrumentedPort, context, { filename: 'actual-composed-shared-file_delivery_port_worker.js' });
  const portUsesSharedPrefixQueue = attachmentWorker.includes('await withConversationMapsWrite(async () => {');
  const portUsesSharedAutoRunsQueue =
    attachmentWorker.includes('const write = kind === "autorun" ? withConversationMapsWrite : withStateWrite;');
  return {
    context,
    store,
    authorityCalls: () => authorityCalls,
    enableSellerAgentsManualRecord: () => { sellerAgentsEnabled = true; },
    queueCount: () => queueCount,
    portUsesSharedQueue: portUsesSharedPrefixQueue && portUsesSharedAutoRunsQueue,
    portUsesSharedPrefixQueue,
    portUsesSharedAutoRunsQueue,
    attachment: context.__B02_ATTACHMENT_TEST,
    async waitForQueue(target, timeoutMs = 1500) {
      if (queueCount >= target) return;
      let resolve;
      const waiting = new Promise(done => { resolve = done; });
      const waiter = { target, resolve };
      queueWaiters.add(waiter);
      try { await withDeadline(waiting, 'shared queue admission ' + target, timeoutMs); }
      finally { queueWaiters.delete(waiter); }
    },
  };
}

async function withDeadline(promise, label, timeoutMs = 1500) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label + ' exceeded ' + timeoutMs + 'ms')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const cases = [];
function addFailure(result, message) { result.failures.push(message); }
function check(result, condition, message) { if (!condition) addFailure(result, message); }
async function runCase(name, action) {
  const result = { name, status: 'PASS', failures: [] };
  try { await action(result); }
  catch (error) { addFailure(result, String(error?.stack || error)); }
  result.status = result.failures.length ? 'FAIL' : 'PASS';
  cases.push(result);
  return result;
}
async function capture(result, label, promise, timeoutMs = 1500) {
  try { return await withDeadline(promise, label, timeoutMs); }
  catch (error) {
    addFailure(result, label + ': ' + String(error?.message || error));
    return undefined;
  }
}

function makeQueueEventWaiter(world, target) {
  return world.waitForQueue(target, 1500);
}

function mapSnapshotGate(store) {
  return store.pauseNextRead((keys, names) => Array.isArray(keys) && names.length === 4);
}
function prefixReadGate(store) {
  return store.pauseNextRead((keys, names) => names.length === 1 && names[0] === K.REPORT_PREFIXES);
}

async function confirmManual(world, ownerId = 'operation-B', deliveryId = appliedDeliveryId, sender = makeSender()) {
  return world.attachment.confirmAttachmentDelivery(makeMessage('manual', ownerId, deliveryId), sender);
}
async function confirmAutorun(world) {
  return world.attachment.confirmAttachmentDelivery(makeMessage('autorun', 'run-B', appliedDeliveryId), makeSender());
}

async function migrationVsOtherWriters(withLegacy, result) {
  const seed = baseMaps({ withLegacy });
  const beforeB = {
    autoRun: copy(seed[K.AUTO_RUNS][other]),
    manualMode: seed[K.MANUAL_MODES][other],
    prefix: copy(seed[K.REPORT_PREFIXES][other]),
    prompt: copy(seed[K.AUTO_START_PROMPTS][other]),
  };
  const world = createWorld(seed);
  const readGate = mapSnapshotGate(world.store);
  const migration = world.context.migrate(identity);
  await withDeadline(readGate.entered, 'migration snapshot entry');
  const writers = [
    world.context.mutate(other, current => ({ ...current, status: RUN_STATUSES.STOPPED })),
    world.context.manual(other, true),
    world.context.prefix(other, { report_prefix_enabled: true, report_prefix_text: 'other-prefix', report_prefix_interval: 2 }),
    world.context.prompt(other, 'other-prompt'),
  ];
  readGate.release();
  await withDeadline(Promise.all([migration, ...writers]), 'original migration/writer source case');
  const maps = world.store.maps;
  check(result, maps[K.AUTO_RUNS][other].status === RUN_STATUSES.STOPPED, 'original source case lost B AUTO_RUNS transition');
  check(result, beforeB.autoRun.status !== maps[K.AUTO_RUNS][other].status, 'B AUTO_RUNS writer did not change its preimage');
  check(result, maps[K.MANUAL_MODES][other] === true, 'original source case lost B MANUAL_MODES value');
  check(result, beforeB.manualMode !== maps[K.MANUAL_MODES][other], 'B MANUAL_MODES writer did not change its preimage');
  check(result, maps[K.REPORT_PREFIXES][other]?.text === 'other-prefix', 'original source case lost B prefix settings');
  check(result, JSON.stringify(beforeB.prefix) !== JSON.stringify(maps[K.REPORT_PREFIXES][other]),
    'B REPORT_PREFIXES writer did not change its preimage');
  check(result, maps[K.AUTO_START_PROMPTS][other]?.text === 'other-prompt', 'original source case lost B prompt');
  check(result, JSON.stringify(beforeB.prompt) !== JSON.stringify(maps[K.AUTO_START_PROMPTS][other]),
    'B AUTO_START_PROMPTS writer did not change its preimage');
  if (withLegacy) {
    for (const key of Object.values(K).slice(0, 4)) {
      check(result, !Object.hasOwn(maps[key], legacy), 'legacy key remains in ' + key);
      check(result, Object.hasOwn(maps[key], newer), 'migrated key is missing in ' + key);
    }
    check(result, maps[K.AUTO_RUNS][newer]?.conversation_key === newer, 'migrated AUTO_RUNS key was not normalized');
  } else {
    for (const key of Object.values(K).slice(0, 4)) {
      check(result, !Object.hasOwn(maps[key], newer), 'no-legacy migration created a ghost key in ' + key);
      check(result, !Object.hasOwn(maps[key], legacy), 'no-legacy migration retained an old key in ' + key);
    }
  }
  let conflict;
  try { await world.context.migrate({ ...identity, status: 'conflict' }); }
  catch (error) { conflict = error; }
  check(result, conflict?.code === 'CONVERSATION_IDENTITY_CONFLICT', 'original identity-conflict refusal changed');
  await withDeadline(world.context.prompt(other, 'prompt-after-rejected-identity'), 'original post-refusal writer');
  check(result, maps[K.AUTO_START_PROMPTS][other]?.text === 'prompt-after-rejected-identity',
    'original post-refusal writer did not recover');
  check(result, world.portUsesSharedQueue === portUsesSharedQueueExpected,
    'actual attachment port queue inventory did not match the implementation under test');
}

const portUsesSharedQueueExpected = attachmentWorker.includes(
  'const write = kind === "autorun" ? withConversationMapsWrite : withStateWrite;',
) && attachmentWorker.includes('await withConversationMapsWrite(async () => {');

await runCase('source-package-existing-no-legacy-writers', async function (result) {
  await migrationVsOtherWriters(false, result);
});
await runCase('source-package-existing-legacy-writers', async function (result) {
  await migrationVsOtherWriters(true, result);
});

await runCase('shared-queue-writer-inventory-and-load-order', async function (result) {
  check(result, entryMainAt >= 0 && entryAttachmentAt > entryMainAt, 'attachment worker no longer loads after main worker');
  check(result, portUsesSharedQueueExpected, 'port prefix confirmation and autorun mutation do not both use the main map queue');
  check(result, !/function\s+withConversationMapsWrite\s*\(/.test(attachmentWorker),
    'attachment worker redeclared a second queue instead of using the main worker queue');
  result.writers = [
    'main: migrateLegacyConversationStorage writes all four maps',
    'main: mutateAutoRun writes AUTO_RUNS',
    'main: writeManualModeState writes MANUAL_MODES',
    'main: first bindConversation binding clears MANUAL_MODES',
    'main: saveReportPrefix and noteConfirmedPrefix write REPORT_PREFIXES',
    'main: get/save/resetAutoStartPrompt write AUTO_START_PROMPTS',
    'attachment: noteConfirmedPrefix writes REPORT_PREFIXES',
    'attachment: mutateOwner(kind=autorun) writes AUTO_RUNS',
    'attachment: mutateOwner(kind=manual) writes MANUAL_OPERATIONS and remains on its existing queue',
  ];
  result.load_order = 'service_worker_entry imports service_worker.js before shared/file_delivery_port_worker.js';
  result.same_queue = portUsesSharedQueueExpected;
});

async function runMigrationConfirmRace(order, withLegacy, applied, sellerAgentsManual) {
  const manualPath = sellerAgentsManual ? 'selleragents-manual-record' : 'legacy-manual-map';
  const label = 'migration-attachment-' + order + '-legacy-' + withLegacy +
    '-applied-' + applied + '-' + manualPath;
  await runCase(label, async function (result) {
    const world = createWorld(baseMaps({ withLegacy, ownerKind: 'manual', applied }));
    if (sellerAgentsManual) world.enableSellerAgentsManualRecord();
    const migrationStartCount = world.queueCount();
    let migrationGate;
    let prefixGate;
    let migration;
    let confirmation;
    if (order === 'migration-first') {
      migrationGate = mapSnapshotGate(world.store);
      migration = world.context.migrate(identity);
      await capture(result, 'migration snapshot entry', migrationGate.entered);
      confirmation = confirmManual(world);
      if (world.portUsesSharedQueue) {
        await capture(result, 'attachment queue entry behind held migration', makeQueueEventWaiter(world, migrationStartCount + 2));
      } else {
        await capture(result, 'pre-fix independent attachment confirmation', confirmation);
      }
      migrationGate.release();
      await capture(result, 'migration completion', migration);
      await capture(result, 'attachment confirmation completion', confirmation);
    } else {
      prefixGate = prefixReadGate(world.store);
      confirmation = confirmManual(world);
      await capture(result, 'attachment prefix snapshot entry', prefixGate.entered);
      const queueBeforeMigration = world.queueCount();
      migration = world.context.migrate(identity);
      if (world.portUsesSharedQueue) {
        await capture(result, 'migration queue entry behind held attachment confirmation',
          makeQueueEventWaiter(world, queueBeforeMigration + 1));
        prefixGate.release();
        await capture(result, 'attachment confirmation completion', confirmation);
        await capture(result, 'migration completion', migration);
      } else {
        await capture(result, 'pre-fix migration completion while attachment read is held', migration);
        prefixGate.release();
        await capture(result, 'attachment confirmation completion', confirmation);
      }
    }
    const maps = world.store.maps;
    const prefix = maps[K.REPORT_PREFIXES][other];
    check(result, prefix?.delivered_count === 8,
      'B prefix delivery counter was not preserved and incremented exactly once (actual=' + prefix?.delivered_count + ')');
    check(result, prefix?.last_confirmed_delivery_id === appliedDeliveryId,
      'B last_confirmed_delivery_id was lost (actual=' + prefix?.last_confirmed_delivery_id + ')');
    check(result, prefix?.last_applied_at_count === (applied ? 8 : 3),
      'applied flag changed prefix application count (actual=' + prefix?.last_applied_at_count + ')');
    check(result, prefix?.text === 'B original prefix', 'unrelated B prefix settings were overwritten');
    check(result, maps[K.AUTO_RUNS][other]?.unchanged_marker === 'B-auto-run',
      'unrelated B AUTO_RUNS record changed during A migration');
    check(result, maps[K.MANUAL_OPERATIONS][other]?.status === 'completed',
      'manual confirmation did not preserve its operation-record scope');
    check(result, maps[K.MANUAL_OPERATIONS][other]?.last_confirmed_delivery_id === appliedDeliveryId,
      'manual operation did not retain its confirmed delivery ID');
    check(result, maps[K.MANUAL_MODES][other] === false,
      'manual attachment confirmation changed the separate MANUAL_MODES value');
    if (withLegacy) {
      for (const key of [K.MANUAL_MODES, K.AUTO_RUNS, K.REPORT_PREFIXES, K.AUTO_START_PROMPTS]) {
        check(result, !Object.hasOwn(maps[key], legacy), 'legacy A key remains after migration in ' + key);
        check(result, Object.hasOwn(maps[key], newer), 'legacy A value was not migrated in ' + key);
      }
    } else {
      for (const key of [K.MANUAL_MODES, K.AUTO_RUNS, K.REPORT_PREFIXES, K.AUTO_START_PROMPTS]) {
        check(result, !Object.hasOwn(maps[key], newer), 'migration without legacy A created a ghost in ' + key);
      }
    }
    check(result, world.portUsesSharedQueue === portUsesSharedQueueExpected,
      'attachment consumer used an unexpected queue implementation');
    result.confirmed = true;
    result.legacy_a = withLegacy;
    result.applied = applied;
    result.manual_path = manualPath;
    result.unrelated_b_counter = prefix?.delivered_count;
    result.unrelated_b_delivery_id = prefix?.last_confirmed_delivery_id;
  });
}

for (const sellerAgentsManual of [true, false]) {
  for (const legacyA of [false, true]) {
    for (const applied of [false, true]) {
      await runMigrationConfirmRace('migration-first', legacyA, applied, sellerAgentsManual);
      await runMigrationConfirmRace('confirmation-first', legacyA, applied, sellerAgentsManual);
    }
  }
}

await runCase('migration-preserves-both-key-collision-policy', async function (result) {
  const world = createWorld(baseMaps({ withLegacy: true, collision: true }));
  await capture(result, 'colliding legacy migration', world.context.migrate(identity));
  const maps = world.store.maps;
  check(result, maps[K.AUTO_RUNS][newer]?.run_id === 'real-A-run', 'AUTO_RUNS collision did not preserve real-key record');
  check(result, maps[K.MANUAL_MODES][newer] === false, 'MANUAL_MODES collision did not preserve explicit real-key false');
  check(result, maps[K.REPORT_PREFIXES][newer]?.text === 'real A prefix', 'REPORT_PREFIXES collision did not preserve real-key record');
  check(result, maps[K.AUTO_START_PROMPTS][newer]?.text === 'real A prompt', 'AUTO_START_PROMPTS collision did not preserve real-key record');
  for (const key of [K.MANUAL_MODES, K.AUTO_RUNS, K.REPORT_PREFIXES, K.AUTO_START_PROMPTS]) {
    check(result, !Object.hasOwn(maps[key], legacy), 'old collision key remains in ' + key);
  }
});

async function runAutorunMigrationRace(order) {
  await runCase('migration-permitted-autorun-' + order, async function (result) {
    const world = createWorld(baseMaps({ ownerKind: 'autorun', applied: false }));
    let migrationGate;
    let prefixGate;
    let migration;
    let confirmation;
    if (order === 'migration-first') {
      migrationGate = mapSnapshotGate(world.store);
      migration = world.context.migrate(identity);
      await capture(result, 'autorun migration snapshot entry', migrationGate.entered);
      confirmation = confirmAutorun(world);
      if (world.portUsesSharedQueue) {
        await capture(result, 'autorun queue entry behind held migration', makeQueueEventWaiter(world, 2));
      } else {
        await capture(result, 'pre-fix independent autorun confirmation', confirmation);
      }
      migrationGate.release();
      await capture(result, 'autorun migration completion', migration);
      await capture(result, 'autorun confirmation completion', confirmation);
    } else {
      prefixGate = prefixReadGate(world.store);
      confirmation = confirmAutorun(world);
      await capture(result, 'autorun prefix snapshot entry', prefixGate.entered);
      migration = world.context.migrate(identity);
      if (world.portUsesSharedQueue) {
        await capture(result, 'autorun migration queue entry', makeQueueEventWaiter(world, 2));
        prefixGate.release();
        await capture(result, 'autorun confirmation completion', confirmation);
        await capture(result, 'autorun migration completion', migration);
      } else {
        await capture(result, 'pre-fix migration during autorun confirmation', migration);
        prefixGate.release();
        await capture(result, 'autorun confirmation completion', confirmation);
      }
    }
    const run = world.store.maps[K.AUTO_RUNS][other];
    const prefix = world.store.maps[K.REPORT_PREFIXES][other];
    check(result, run?.status === RUN_STATUSES.WAITING_COMMAND, 'permitted port autorun transition was rolled back (actual=' + run?.status + ')');
    check(result, run?.sequence === 5, 'actual model did not advance autorun sequence once (actual=' + run?.sequence + ')');
    check(result, run?.batch === null, 'actual model did not clear the completed autorun batch');
    check(result, run?.last_confirmed_delivery_id === appliedDeliveryId, 'autorun delivery ID was lost');
    check(result, run?.delivery === null, 'autorun confirmation did not finish the committed delivery');
    check(result, prefix?.delivered_count === 8, 'autorun confirmation lost B prefix counter');
    check(result, prefix?.last_confirmed_delivery_id === appliedDeliveryId, 'autorun confirmation lost B prefix delivery ID');
  });
}
await runAutorunMigrationRace('migration-first');
await runAutorunMigrationRace('confirmation-first');

async function prefixSettingsRace(order) {
  await runCase('prefix-settings-vs-attachment-' + order, async function (result) {
    const world = createWorld(baseMaps({ ownerKind: 'manual', applied: true }));
    const payload = {
      report_prefix_enabled: true,
      report_prefix_text: 'B updated prefix setting',
      report_prefix_interval: 9,
    };
    let pause;
    let save;
    let confirmation;
    if (order === 'settings-first') {
      pause = prefixReadGate(world.store);
      save = world.context.prefix(other, payload);
      await capture(result, 'prefix settings snapshot entry', pause.entered);
      confirmation = confirmManual(world);
      if (world.portUsesSharedQueue) {
        await capture(result, 'attachment queue entry behind held settings update', makeQueueEventWaiter(world, 2));
      } else {
        await capture(result, 'pre-fix confirmation against held prefix setting', confirmation);
      }
      pause.release();
      await capture(result, 'prefix settings update completion', save);
      await capture(result, 'attachment confirmation completion', confirmation);
    } else {
      pause = prefixReadGate(world.store);
      confirmation = confirmManual(world);
      await capture(result, 'attachment prefix snapshot entry', pause.entered);
      save = world.context.prefix(other, payload);
      if (world.portUsesSharedQueue) {
        await capture(result, 'settings queue entry behind held attachment update', makeQueueEventWaiter(world, 2));
        pause.release();
        await capture(result, 'attachment confirmation completion', confirmation);
        await capture(result, 'prefix settings update completion', save);
      } else {
        await capture(result, 'pre-fix prefix settings completion while confirmation is held', save);
        pause.release();
        await capture(result, 'attachment confirmation completion', confirmation);
      }
    }
    const prefix = world.store.maps[K.REPORT_PREFIXES][other];
    check(result, prefix?.text === payload.report_prefix_text, 'prefix settings were overwritten by an attachment confirmation');
    check(result, prefix?.interval === payload.report_prefix_interval, 'prefix interval was overwritten by an attachment confirmation');
    check(result, prefix?.delivered_count === 8, 'prefix settings write lost attachment counter update');
    check(result, prefix?.last_confirmed_delivery_id === appliedDeliveryId, 'prefix settings write lost attachment delivery ID');
  });
}
await prefixSettingsRace('settings-first');
await prefixSettingsRace('confirmation-first');

await runCase('actual-model-prefix-counter-delivery-id-dedup', async function (result) {
  const world = createWorld(baseMaps());
  const deliveryId = 'delivery-B-dedup';
  await capture(result, 'first actual-model prefix confirmation',
    world.context.notePrefix(other, false, deliveryId));
  const first = copy(world.store.maps[K.REPORT_PREFIXES][other]);
  check(result, first.delivered_count === 8, 'actual model did not count the first confirmed delivery');
  check(result, first.last_applied_at_count === 3, 'applied=false changed the last-applied sequence');
  check(result, first.last_confirmed_delivery_id === deliveryId, 'actual model did not save the confirmed delivery ID');

  await capture(result, 'duplicate actual-model prefix confirmation',
    world.context.notePrefix(other, false, deliveryId));
  await capture(result, 'duplicate ID with applied=true',
    world.context.notePrefix(other, true, deliveryId));
  const afterDuplicates = world.store.maps[K.REPORT_PREFIXES][other];
  check(result, afterDuplicates.delivered_count === 8, 'actual model did not deduplicate the confirmed delivery ID');
  check(result, afterDuplicates.last_applied_at_count === 3, 'duplicate ID changed application count');
  check(result, afterDuplicates.last_confirmed_delivery_id === deliveryId, 'duplicate ID replaced the confirmed delivery ID');
});

await runCase('shared-queue-storage-rejection-recovers', async function (result) {
  const world = createWorld(baseMaps({ ownerKind: 'manual', applied: false }));
  world.store.failNextSet(
    values => Object.hasOwn(values, K.REPORT_PREFIXES),
    Object.assign(new Error('synthetic chrome.storage.local.set rejection'), { code: 'FAKE_STORAGE_WRITE_REJECTED' }),
  );
  let failure;
  try { await confirmManual(world); }
  catch (error) { failure = error; }
  check(result, failure?.code === 'FAKE_STORAGE_WRITE_REJECTED', 'actual attachment storage-set rejection did not propagate');
  check(result, world.store.maps[K.REPORT_PREFIXES][other]?.delivered_count === 7,
    'failed storage callback changed the prefix map');
  check(result, world.store.maps[K.MANUAL_OPERATIONS][other]?.delivery?.phase === PHASES.SEND_COMMITTED,
    'failed prefix callback advanced the manual operation record');
  const recovered = await capture(result, 'successful map write after rejected storage callback',
    world.context.prefix(other, {
      report_prefix_enabled: true,
      report_prefix_text: 'B after storage rejection',
      report_prefix_interval: 5,
    }));
  check(result, recovered?.text === 'B after storage rejection', 'next shared-queue write did not succeed after storage rejection');
  check(result, world.store.maps[K.REPORT_PREFIXES][other]?.last_confirmed_delivery_id === 'B-previous-delivery',
    'recovery write changed the unconfirmed delivery ID');
  check(result, world.portUsesSharedPrefixQueue, 'failed attachment storage callback was not inside the shared map queue');
});

await runCase('new-binding-reset-and-no-nested-map-queue-deadlock', async function (result) {
  const bindKey = ORIGIN + '|bind-chat';
  const world = createWorld({
    ...baseMaps(),
    [K.MANUAL_MODES]: { [other]: true, [bindKey]: true },
    [K.AUTO_RUNS]: {
      [other]: { run_id: 'other-run', status: RUN_STATUSES.PAUSED, unchanged_marker: 'B-auto-run' },
      [bindKey]: { run_id: 'legacy-bound-run', status: RUN_STATUSES.PAUSED, binding_snapshot: null },
    },
  });
  const bound = await capture(result, 'new binding with post-bind autorun update', world.context.bind({
    tab_id: 11,
    origin: ORIGIN,
    conversation_id: 'bind-chat',
  }), 2000);
  check(result, bound?.conversation_key === bindKey, 'new binding did not return the confirmed conversation key');
  check(result, !Object.hasOwn(world.store.maps[K.MANUAL_MODES], bindKey), 'new binding did not clear its MANUAL_MODES value');
  check(result, world.store.maps[K.MANUAL_MODES][other] === true, 'new binding reset changed another dialogue MANUAL_MODES value');
  check(result, Boolean(world.store.maps[K.AUTO_RUNS][bindKey]?.binding_snapshot),
    'post-bind legacy autorun snapshot update did not complete');
  check(result, world.queueCount() >= 2, 'new binding and post-bind AUTO_RUNS update did not use the common map queue');
});

await runCase('owner-expected-id-and-synthetic-authority-error-plumbing', async function (result) {
  async function rejectedConfirmation(name, setup, expectedCode) {
    const world = createWorld(baseMaps({ ownerKind: 'manual' }));
    const message = makeMessage();
    const sender = makeSender();
    setup(world, message, sender);
    let failure;
    try { await world.attachment.confirmAttachmentDelivery(message, sender); }
    catch (error) { failure = error; }
    check(result, failure?.code === expectedCode, name + ' refusal code changed (actual=' + failure?.code + ')');
    check(result, world.store.maps[K.REPORT_PREFIXES][other]?.delivered_count === 7,
      name + ' reached the REPORT_PREFIXES writer');
    check(result, world.store.maps[K.MANUAL_OPERATIONS][other]?.delivery?.phase === PHASES.SEND_COMMITTED,
      name + ' changed the manual operation record');
    return world;
  }
  await rejectedConfirmation('wrong owner tab', (_world, _message, sender) => {
    sender.tab.id = 99;
  }, 'ATTACHMENT_NON_OWNER_TAB');
  await rejectedConfirmation('wrong expected owner ID', (_world, message) => {
    message.owner_id = 'wrong-operation-id';
  }, 'ATTACHMENT_DELIVERY_NOT_FOUND');
  await rejectedConfirmation('wrong delivery ID', (_world, message) => {
    message.delivery_id = 'unexpected-delivery-id';
  }, 'ATTACHMENT_DELIVERY_ID_MISMATCH');
  const denied = await rejectedConfirmation('authority denial', world => {
    world.store.maps[K.MANUAL_OPERATIONS][other].authority_allowed = false;
  }, 'OWNER_AUTHORITY_DENIED');
  check(result, denied.authorityCalls() === 1, 'actual attachment owner authority guard was not called');
  const expired = await rejectedConfirmation('expired owner authority', world => {
    world.store.maps[K.MANUAL_OPERATIONS][other].authority_expires_at_ms = Date.now() - 1;
  }, 'OWNER_AUTHORITY_EXPIRED');
  check(result, expired.authorityCalls() === 1, 'actual attachment consumer bypassed the TTL guard');
});

await runCase('attachment-confirmation-and-send-no-replay', async function (result) {
  const world = createWorld(baseMaps({ ownerKind: 'manual' }));
  await capture(result, 'first actual attachment confirmation', confirmManual(world));
  const afterFirst = copy(world.store.maps[K.REPORT_PREFIXES][other]);
  let duplicate;
  try { await confirmManual(world); }
  catch (error) { duplicate = error; }
  check(result, duplicate?.code === 'ATTACHMENT_DELIVERY_NOT_FOUND',
    'a confirmed attachment delivery was accepted again');
  check(result, world.store.maps[K.REPORT_PREFIXES][other]?.delivered_count === afterFirst.delivered_count,
    'duplicate confirmation replayed prefix accounting');

  const committed = createWorld(baseMaps({ ownerKind: 'manual' }));
  committed.store.maps[K.MANUAL_OPERATIONS][other].delivery.phase = PHASES.ATTACH_COMMITTED;
  const commitResult = await capture(result, 'attach-committed no-retry fence',
    committed.attachment.commitAttachment(makeMessage(), makeSender()));
  check(result, commitResult?.attach_allowed === false && commitResult?.code === 'ATTACH_OUTCOME_UNKNOWN_NO_RETRY',
    'attach-committed outcome-unknown fence changed');

  const sendCommitted = createWorld(baseMaps({ ownerKind: 'manual' }));
  const sendResult = await capture(result, 'send-committed click fence',
    sendCommitted.attachment.commitAttachmentSend(makeMessage(), makeSender()));
  check(result, sendResult?.click_allowed === false && sendResult?.already_committed === true,
    'committed Send was permitted again');
});

await runCase('manual-owner-confirmation-retains-operation-record-scope', async function (result) {
  const world = createWorld(baseMaps({ ownerKind: 'manual' }));
  world.enableSellerAgentsManualRecord();
  await capture(result, 'actual manual operation-record confirmation', confirmManual(world));
  const operation = world.store.maps[K.MANUAL_OPERATIONS][other];
  check(result, operation?.status === 'completed' && operation?.delivery === null,
    'manual owner did not complete through MANUAL_OPERATIONS');
  check(result, operation?.last_confirmed_delivery_id === appliedDeliveryId,
    'manual operation record lost its confirmed delivery ID');
  check(result, world.store.maps[K.AUTO_RUNS][other]?.unchanged_marker === 'B-auto-run',
    'manual owner confirmation wrote through AUTO_RUNS');
  check(result, world.store.maps[K.MANUAL_MODES][other] === false,
    'manual owner confirmation changed MANUAL_MODES');
  check(result, world.store.maps[K.REPORT_PREFIXES][other]?.last_confirmed_delivery_id === appliedDeliveryId,
    'manual owner confirmation did not update REPORT_PREFIXES');
  check(result, world.authorityCalls() === 4,
    'manual owner authority was not checked before and inside the operation-record mutation');
});

const failedCases = cases.filter(item => item.status === 'FAIL');
console.log(JSON.stringify({
  verdict: failedCases.length ? 'FAIL' : 'SOURCE_PACKAGE_FOUR_MAP_ATTACHMENT_RACE_PASS',
  runtime_path: runtimePath,
  runtime_version: process.version,
  attachment_consumer: 'actual composed shared/file_delivery_port_worker.js',
  autorun_model: 'actual composed shared/bridge_autorun_model.js loaded into each VM before service_worker.js and the attachment consumer',
  authority_guard_fixture: 'synthetic saAssertDeliveryOwner verifies invocation and error propagation only; no security or TTL qualification',
  port_prefix_uses_shared_queue: portUsesSharedQueueExpected && attachmentWorker.includes('await withConversationMapsWrite(async () => {'),
  port_autorun_uses_shared_queue: attachmentWorker.includes('const write = kind === "autorun" ? withConversationMapsWrite : withStateWrite;'),
  map_writer_inventory: [
    'service_worker.js:migrateLegacyConversationStorage -> all four maps',
    'service_worker.js:mutateAutoRun -> AUTO_RUNS',
    'service_worker.js:writeManualModeState -> MANUAL_MODES',
    'service_worker.js:bindConversation first binding -> MANUAL_MODES reset',
    'service_worker.js:saveReportPrefix/noteConfirmedPrefix -> REPORT_PREFIXES',
    'service_worker.js:get/save/resetAutoStartPrompt -> AUTO_START_PROMPTS',
    'shared/file_delivery_port_worker.js:noteConfirmedPrefix -> REPORT_PREFIXES',
    'shared/file_delivery_port_worker.js:mutateOwner autorun branch -> AUTO_RUNS',
    'shared/file_delivery_port_worker.js:manual owner branch -> MANUAL_OPERATIONS only',
  ],
  cases,
  full_failure_count: failedCases.length,
  full_failures: failedCases.flatMap(item => item.failures.map(message => ({ case: item.name, message }))),
  browser: false,
  network: false,
  provider_calls: 0,
  installed_acceptance: false,
}, null, 2));
if (failedCases.length) process.exitCode = 1;
