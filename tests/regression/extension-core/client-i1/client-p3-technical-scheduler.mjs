import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(".");
const worker = fs.readFileSync(path.join(root, "service_worker.js"), "utf8");
const marker = "/* P3: one installation-local coordinator";
const start = worker.indexOf(marker);
assert.ok(start >= 0, "composed worker contains P3 coordinator");
const source = worker.slice(worker.lastIndexOf("(() => {", start), worker.indexOf("\n})();", start) + "\n})();".length);
assert.equal((worker.match(/chrome\.alarms\?\.onAlarm\?\.addListener/g) || []).length, 1, "one worker alarm boundary");
assert.equal(worker.includes("periodInMinutes"), false, "no repeating scheduler alarm");
assert.equal(worker.includes("seller-agents-payload-cleanup"), false, "legacy cleanup alarm removed");

const persisted = {};
const makeContext = () => {
  const alarms = new Map();
  const listeners = [];
  const startupListeners = [];
  const installedListeners = [];
  const context = {
    console, Date, JSON, Object, Number, String, Boolean, Array, Map, Set, WeakSet,
    structuredClone, TextEncoder, Promise, crypto: globalThis.crypto,
    chrome: {
      storage: { local: {
        async get(key) {
          const keys = Array.isArray(key) ? key : [key];
          return Object.fromEntries(keys.filter((item) => item !== undefined).map((item) => [item, persisted[item]]));
        },
        async set(values) { Object.assign(persisted, values); },
      } },
      alarms: {
        onAlarm: { addListener(listener) { listeners.push(listener); } },
        async create(name, details) { alarms.set(name, details); },
        async clear(name) { alarms.delete(name); return true; },
      },
      runtime: { onStartup: { addListener(listener) { startupListeners.push(listener); } }, onInstalled: { addListener(listener) { installedListeners.push(listener); } } },
    },
    OzonRuntime: { STORAGE_KEYS: { MANUAL_OPERATIONS: "manual", AUTO_RUNS: "autoruns", WORK_SESSION_RECOVERIES: "recoveries" } },
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "technical-scheduler.js" });
  return { context, alarms, listeners, startupListeners, installedListeners };
};

const first = makeContext();
let recoveries = 0;
persisted.manual = {
  "chatgpt:c:a": { status: "requesting", operation_id: "exec-a", batch: { entries: [{ status: "requesting", provider_attempt_id: "attempt-a", result_buffer: { phase: "BUFFERED" } }] } },
};
first.context.resumeKnownResultRecoveries = async () => { recoveries += 1; persisted.manual = {}; };
await first.context.SellerAgentsTechnicalScheduler.schedule(
  first.context.SellerAgentsTechnicalScheduler.KINDS.RESULT,
  { taskId: "result:known", dueAt: Date.now(), identity: { conversationKey: "chatgpt:c:a", executionId: "exec-a", providerAttemptId: "attempt-a", report_text: "must-not-persist" } },
);
assert.equal(JSON.stringify(persisted).includes("must-not-persist"), false, "scheduler stores identities only");

// Simulate MV3 termination before the alarm fires, then reconstruct from the durable task.
const second = makeContext();
second.context.resumeKnownResultRecoveries = async () => { recoveries += 1; persisted.manual = {}; };
await Promise.all([second.context.SellerAgentsTechnicalScheduler.wake("alarm"), second.context.SellerAgentsTechnicalScheduler.wake("duplicate-alarm")]);
assert.equal(recoveries, 1, "duplicate wake is single-flight");
assert.deepEqual((await second.context.SellerAgentsTechnicalScheduler.state()).entries, {}, "completed task is removed durably");

// Late alarms after completion are harmless, and a bounded due batch does not starve storage.
let expiryRuns = 0;
second.context.saCleanupExpiredPayloads = async () => { expiryRuns += 1; };
for (let index = 0; index < 20; index += 1) await second.context.SellerAgentsTechnicalScheduler.schedule(
  second.context.SellerAgentsTechnicalScheduler.KINDS.EXPIRY,
  { taskId: `expiry:${index}`, dueAt: Date.now(), identity: { artifactKey: `artifact-${index}` } },
);
await second.context.SellerAgentsTechnicalScheduler.wake("bounded-batch");
assert.equal(expiryRuns, 16, "due work is bounded per wake");
await second.context.SellerAgentsTechnicalScheduler.wake("late-alarm");
assert.equal(expiryRuns, 20, "late wake drains remaining durable work without duplication");
for (let index = 0; index < 100; index += 1) await second.context.SellerAgentsTechnicalScheduler.wake(`soak-${index}`);
assert.equal(expiryRuns, 20, "100 duplicate/late wake deliveries remain side-effect free after drain");

// Source/package preflight: an extension update wake reconstructs technical state without clearing other local state.
persisted.seller_agents_stores_v1 = { marker: "stores-survive-update" };
persisted.seller_agents_control_auth_v2 = { marker: "auth-survives-update" };
persisted.seller_agents_sync_journal_v1 = { marker: "sync-survives-update" };
await second.context.SellerAgentsTechnicalScheduler.schedule(
  second.context.SellerAgentsTechnicalScheduler.KINDS.EXPIRY,
  { taskId: "expiry:update-future", dueAt: Date.now() + 60_000, identity: { artifactKey: "future-artifact" } },
);
const preservedBefore = structuredClone({ stores: persisted.seller_agents_stores_v1, auth: persisted.seller_agents_control_auth_v2, sync: persisted.seller_agents_sync_journal_v1 });
const beforeUpdateTask = (await second.context.SellerAgentsTechnicalScheduler.state()).entries["expiry:update-future"];
const afterUpdate = makeContext();
assert.equal(afterUpdate.installedListeners.length, 1, "one onInstalled wake listener");
afterUpdate.installedListeners[0]({ reason: "update", previousVersion: "0.2.4" });
await afterUpdate.context.SellerAgentsTechnicalScheduler.wake("join-installed-update");
assert.deepEqual(
  { stores: persisted.seller_agents_stores_v1, auth: persisted.seller_agents_control_auth_v2, sync: persisted.seller_agents_sync_journal_v1 },
  preservedBefore,
  "update wake must not clear unrelated installation-local state",
);
assert.deepEqual(
  (await afterUpdate.context.SellerAgentsTechnicalScheduler.state()).entries["expiry:update-future"],
  beforeUpdateTask,
  "future durable technical task survives update reconstruction",
);

// New read-only A11/SA-DATA-01 regressions on exact-source MV3 scheduler.
// The product's saPrunePayload derives legacy TTL from created_at + 3600000.
function wipeFixture() { for (const key of Object.keys(persisted)) delete persisted[key]; }
const TTL = 3600000, baseNow = Date.now(), checks = [];
function syntheticOwner(createdAt, expiresAt, hasPayload=true) {
  const result = { status: hasPayload ? "collected" : "failed",
    created_at: new Date(createdAt).toISOString(),
    outgoing_text: hasPayload ? "SYNTHETIC_ONLY_NOT_REAL_REPORT" : null,
    batch: hasPayload ? { entries: [{ provider_attempt: { provider_attempt_id: "synthetic-attempt" } }] } : null,
    last_error: hasPayload ? null : { code: "RESULT_BUFFER_EXPIRED" } };
  if (expiresAt !== undefined) result.payload_expires_at_ms = expiresAt;
  return result;
}
// Repeated expiry of a pruned owner should not recreate due-now work indefinitely.
wipeFixture();
persisted.manual = { pruned: syntheticOwner(baseNow-TTL-10000,baseNow-10000,false) };
const pruned = makeContext();
let expiredPrunedCalls=0;
pruned.context.saCleanupExpiredPayloads = async()=> { expiredPrunedCalls++; };
await pruned.context.SellerAgentsTechnicalScheduler.wake("after-prune-first");
await pruned.context.SellerAgentsTechnicalScheduler.wake("after-prune-second");
const oldPrunedState = await pruned.context.SellerAgentsTechnicalScheduler.state();
checks.push({ id:"A11-P3-01", label:"pruned buffer does not cause endless retry",
  expected:"no recurrent cleanup and no due expiry", observed:{
    cleanupCalls:expiredPrunedCalls,
    hasPendingExpiry:Boolean(oldPrunedState.entries["expiry:buffers"]),
  },pass:expiredPrunedCalls===0&&!oldPrunedState.entries["expiry:buffers"] });
// A legacy buffer lacking payload_expires_at_ms is still subject to one-hour TTL.
wipeFixture();
persisted.manual={ legacy:syntheticOwner(baseNow-2*TTL,undefined,true) };
const legacy=makeContext();
let legacyCleanup=0;
legacy.context.saCleanupExpiredPayloads=async()=>{
  legacyCleanup++;
  const entry=persisted.manual.legacy;
  entry.outgoing_text=null;entry.batch=null;entry.status="failed";
};
await legacy.context.SellerAgentsTechnicalScheduler.wake("legacy-expired-after-worker-wake");
checks.push({id:"A11-P3-02",label:"legacy expired buffer cleaned after wake",
  expected:"cleanup once", observed:{cleanupCalls:legacyCleanup,payloadRetained:Boolean(persisted.manual.legacy.outgoing_text)},
  pass:legacyCleanup===1&&!persisted.manual.legacy.outgoing_text});
// A legacy future buffer requires a technical alarm at the derived due time.
wipeFixture();
persisted.manual={ future:syntheticOwner(baseNow,undefined,true) };
const future=makeContext();
let futureCleanup=0;
future.context.saCleanupExpiredPayloads=async()=>{futureCleanup++;};
await future.context.SellerAgentsTechnicalScheduler.wake("legacy-future-start");
const futureEntry=(await future.context.SellerAgentsTechnicalScheduler.state()).entries["expiry:buffers"];
checks.push({id:"A11-P3-03",label:"legacy future buffer has a one-hour deadline",
  expected:"durable scheduled expiry",observed:{scheduled:Boolean(futureEntry),cleanupCalls:futureCleanup},
  pass:Boolean(futureEntry)&&Math.abs(futureEntry.dueAt-(baseNow+TTL))<3000&&futureCleanup===0});
// An explicitly expired active buffer must clean exactly once, not alarm-loop.
wipeFixture();
persisted.manual={ explicit:syntheticOwner(baseNow-2*TTL,baseNow-10000,true) };
const explicit=makeContext();
let explicitCleanup=0;
explicit.context.saCleanupExpiredPayloads=async()=>{
  explicitCleanup++;
  const entry=persisted.manual.explicit;
  entry.outgoing_text=null;entry.batch=null;entry.status="failed";
};
await explicit.context.SellerAgentsTechnicalScheduler.wake("explicit-expired-first");
await explicit.context.SellerAgentsTechnicalScheduler.wake("explicit-expired-after-cleanup");
const explicitState=(await explicit.context.SellerAgentsTechnicalScheduler.state()).entries["expiry:buffers"];
checks.push({id:"A11-P3-04",label:"explicit expired buffer cleans once without repeated alarm",
  expected:"single cleanup then no pending expiry",
  observed:{cleanupCalls:explicitCleanup,scheduled:Boolean(explicitState)},
  pass:explicitCleanup===1&&!explicitState});
// An invalid legacy creation date must fail closed, never retain report forever.
wipeFixture();
persisted.manual={ invalid:syntheticOwner(baseNow,undefined,true) };
persisted.manual.invalid.created_at="not-a-valid-date";
const invalid=makeContext();
let invalidCleanup=0;
invalid.context.saCleanupExpiredPayloads=async()=>{
  invalidCleanup++;
  persisted.manual.invalid.outgoing_text=null;
  persisted.manual.invalid.batch=null;
  persisted.manual.invalid.status="failed";
};
await invalid.context.SellerAgentsTechnicalScheduler.wake("invalid-created-at");
const invalidState=(await invalid.context.SellerAgentsTechnicalScheduler.state()).entries["expiry:buffers"];
checks.push({id:"A11-P3-05",label:"invalid legacy timestamp is cleaned fail-closed",
  expected:"cleanup once and no pending alarm",
  observed:{cleanupCalls:invalidCleanup,scheduled:Boolean(invalidState)},
  pass:invalidCleanup===1&&!invalidState});
const failed=checks.filter(x=>!x.pass);
console.log(JSON.stringify({
  status:failed.length?"FAIL":"PASS", scenarios:8, wake_deliveries:100,
  duplicate_wake_runs:0, payload_leak:false, max_due_per_wake:16,
  update_storage_preserved:true, expiry_regressions:checks.length, expiry_checks:checks,
  failure_ids:failed.map(x=>x.id)
}));
if(failed.length)process.exitCode=1;
