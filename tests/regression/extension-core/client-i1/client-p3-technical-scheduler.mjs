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
      runtime: { onStartup: { addListener() {} }, onInstalled: { addListener() {} } },
    },
    OzonRuntime: { STORAGE_KEYS: { MANUAL_OPERATIONS: "manual", AUTO_RUNS: "autoruns", WORK_SESSION_RECOVERIES: "recoveries" } },
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "technical-scheduler.js" });
  return { context, alarms, listeners };
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

console.log(JSON.stringify({ status: "PASS", scenarios: 7, wake_deliveries: 100, duplicate_wake_runs: 0, payload_leak: false, max_due_per_wake: 16 }));
