import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(process.argv[2]);
const worker = fs.readFileSync(path.join(root, "service_worker.js"), "utf8");
const marker = "/* P3: one installation-local coordinator";
const start = worker.indexOf(marker);
assert.ok(start >= 0, "composed worker contains shared technical coordinator");
const source = worker.slice(
  worker.lastIndexOf("(() => {", start),
  worker.indexOf("\n})();", start) + "\n})();".length,
);
const STORAGE_KEY = "seller_agents_technical_wake_v1";
const TASK_ID = "authority:refresh";
const persisted = {};

function makeContext(client) {
  const alarms = new Map();
  const alarmListeners = [];
  const context = {
    console,
    Date,
    JSON,
    Object,
    Number,
    String,
    Boolean,
    Array,
    Map,
    Set,
    WeakSet,
    structuredClone,
    TextEncoder,
    Promise,
    crypto: globalThis.crypto,
    SellerAgentsControlClient: client,
    chrome: {
      storage: {
        local: {
          async get(key) {
            const keys = Array.isArray(key) ? key : [key];
            return Object.fromEntries(
              keys
                .filter((item) => item !== undefined)
                .map((item) => [item, persisted[item]]),
            );
          },
          async set(values) {
            Object.assign(persisted, structuredClone(values));
          },
        },
      },
      alarms: {
        onAlarm: {
          addListener(listener) {
            alarmListeners.push(listener);
          },
        },
        async create(name, details) {
          alarms.set(name, structuredClone(details));
        },
        async clear(name) {
          alarms.delete(name);
          return true;
        },
      },
      runtime: {
        onStartup: { addListener() {} },
        onInstalled: { addListener() {} },
      },
    },
    OzonRuntime: {
      STORAGE_KEYS: {
        MANUAL_OPERATIONS: "manual",
        AUTO_RUNS: "autoruns",
        WORK_SESSION_RECOVERIES: "recoveries",
      },
    },
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "technical-scheduler.js" });
  return { context, alarms, alarmListeners };
}

const identity = (suffix) => ({
  accountId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  sessionId: "33333333-3333-4333-8333-333333333333",
  generation: 7,
  contractVersion: "control_plane_v3",
  configVersion: 31,
  serverTime: `2026-09-27T00:00:0${suffix}Z`,
  paidThrough: "2026-10-01T00:00:00Z",
});

delete persisted[STORAGE_KEY];
let refreshCalls = 0;
const dormant = makeContext({
  async getSubscriptionRefreshPlan() {
    return { active: false, reason: "NEGOTIATION_DORMANT" };
  },
  async runSubscriptionRefreshTask() {
    refreshCalls += 1;
  },
});
await dormant.context.SellerAgentsTechnicalScheduler.wake("v2-dormant");
assert.equal(refreshCalls, 0);
assert.deepEqual(
  (await dormant.context.SellerAgentsTechnicalScheduler.state()).entries,
  {},
  "v2/dormant client creates no licence task",
);

delete persisted[STORAGE_KEY];
let renewalCalls = 0;
let currentPlan = {
  active: true,
  reason: "CADENCE",
  dueAt: Date.now() - 1,
  identity: identity(1),
};
const renewingClient = {
  async getSubscriptionRefreshPlan() {
    return structuredClone(currentPlan);
  },
  async runSubscriptionRefreshTask(receivedIdentity) {
    renewalCalls += 1;
    assert.deepEqual(receivedIdentity, currentPlan.identity);
    await new Promise((resolve) => setTimeout(resolve, 5));
    currentPlan = {
      active: true,
      reason: "CADENCE",
      dueAt: Date.now() + 24 * 60 * 60 * 1000,
      identity: identity(2),
    };
    return { status: "REFRESHED" };
  },
};
const renewal = makeContext(renewingClient);
await Promise.all([
  renewal.context.SellerAgentsTechnicalScheduler.wake("tab-a"),
  renewal.context.SellerAgentsTechnicalScheduler.wake("tab-b"),
  renewal.context.SellerAgentsTechnicalScheduler.wake("tab-c"),
]);
assert.equal(renewalCalls, 1, "simultaneous tab wakes share one refresh");
let state = await renewal.context.SellerAgentsTechnicalScheduler.state();
assert.equal(Object.keys(state.entries).length, 1);
assert.equal(state.entries[TASK_ID].kind, "SIGNED_ACCESS_REFRESH");
assert.equal(
  state.entries[TASK_ID].identity.serverTime,
  currentPlan.identity.serverTime,
  "renewal replaces the durable authority identity",
);
assert.ok(
  state.entries[TASK_ID].dueAt > Date.now() + 23 * 60 * 60 * 1000,
  "renewal schedules the next roughly-daily refresh, not a catch-up burst",
);

persisted[STORAGE_KEY].entries[TASK_ID].dueAt = Date.now() - 1;
let sleepCalls = 0;
currentPlan = {
  ...currentPlan,
  dueAt: Date.now() - 60 * 60 * 1000,
};
renewingClient.runSubscriptionRefreshTask = async () => {
  sleepCalls += 1;
  currentPlan = {
    active: true,
    reason: "CADENCE",
    dueAt: Date.now() + 24 * 60 * 60 * 1000,
    identity: identity(3),
  };
  return { status: "REFRESHED" };
};
const afterSleep = makeContext(renewingClient);
await Promise.all([
  afterSleep.context.SellerAgentsTechnicalScheduler.wake("startup"),
  afterSleep.context.SellerAgentsTechnicalScheduler.wake("tab-after-sleep"),
]);
assert.equal(sleepCalls, 1, "restart/sleep performs one overdue refresh");
state = await afterSleep.context.SellerAgentsTechnicalScheduler.state();
assert.equal(
  state.entries[TASK_ID].identity.serverTime,
  identity(3).serverTime,
);
assert.ok(state.entries[TASK_ID].dueAt > Date.now());

delete persisted[STORAGE_KEY];
let denyCalls = 0;
let denyPlan = {
  active: true,
  reason: "PAID_THROUGH",
  dueAt: Date.now() - 1,
  identity: identity(4),
};
const denyClient = {
  async getSubscriptionRefreshPlan() {
    return structuredClone(denyPlan);
  },
  async runSubscriptionRefreshTask() {
    denyCalls += 1;
    denyPlan = { active: false, reason: "V3_AUTHORITY_DENIED" };
    return { status: "DENY" };
  },
};
const deny = makeContext(denyClient);
await deny.context.SellerAgentsTechnicalScheduler.wake("paid-through");
assert.equal(denyCalls, 1);
assert.deepEqual(
  (await deny.context.SellerAgentsTechnicalScheduler.state()).entries,
  {},
  "authoritative deny removes the shared refresh task",
);

delete persisted[STORAGE_KEY];
let failures = 0;
const failurePlan = {
  active: true,
  reason: "CADENCE",
  dueAt: Date.now() - 1,
  identity: identity(5),
};
const failingClient = {
  async getSubscriptionRefreshPlan() {
    return structuredClone(failurePlan);
  },
  async runSubscriptionRefreshTask() {
    failures += 1;
    throw new TypeError("fixture transport unavailable");
  },
};
const retrying = makeContext(failingClient);
const beforeFirstFailure = Date.now();
await retrying.context.SellerAgentsTechnicalScheduler.wake("retry-1");
state = await retrying.context.SellerAgentsTechnicalScheduler.state();
assert.equal(failures, 1);
let delay = state.entries[TASK_ID].dueAt - beforeFirstFailure;
assert.ok(
  delay >= 13.5 * 60 * 1000 && delay <= 16.5 * 60 * 1000 + 1000,
  `first retry is 15m with bounded jitter, got ${delay}`,
);
assert.equal(state.entries[TASK_ID].attempts, 1);

persisted[STORAGE_KEY].entries[TASK_ID].dueAt = Date.now() - 1;
const beforeSecondFailure = Date.now();
await retrying.context.SellerAgentsTechnicalScheduler.wake("retry-2");
state = await retrying.context.SellerAgentsTechnicalScheduler.state();
assert.equal(failures, 2);
delay = state.entries[TASK_ID].dueAt - beforeSecondFailure;
assert.ok(
  delay >= 27 * 60 * 1000 && delay <= 33 * 60 * 1000 + 1000,
  `second retry doubles from 15m with bounded jitter, got ${delay}`,
);
assert.equal(state.entries[TASK_ID].attempts, 2);

for (let attempt = 3; attempt <= 10; attempt += 1) {
  persisted[STORAGE_KEY].entries[TASK_ID].dueAt = Date.now() - 1;
  const before = Date.now();
  await retrying.context.SellerAgentsTechnicalScheduler.wake(
    `retry-${attempt}`,
  );
  state = await retrying.context.SellerAgentsTechnicalScheduler.state();
  assert.ok(
    state.entries[TASK_ID].dueAt - before <= 6 * 60 * 60 * 1000 + 1000,
    "subscription retry remains capped at six hours",
  );
}
assert.equal(failures, 10);
assert.equal(
  JSON.stringify(persisted).includes("accessToken"),
  false,
  "durable scheduler contains no token material",
);

delete persisted[STORAGE_KEY];
let authorityChangeCalls = 0;
let authorityChangePlan = {
  active: true,
  reason: "CADENCE",
  dueAt: Date.now() - 1,
  identity: identity(6),
};
const authorityChangeClient = {
  async getSubscriptionRefreshPlan() {
    return structuredClone(authorityChangePlan);
  },
  async runSubscriptionRefreshTask() {
    authorityChangeCalls += 1;
    throw new TypeError("fixture old authority transport unavailable");
  },
};
const authorityChange = makeContext(authorityChangeClient);
await authorityChange.context.SellerAgentsTechnicalScheduler.wake(
  "old-authority-failure",
);
state = await authorityChange.context.SellerAgentsTechnicalScheduler.state();
assert.equal(state.entries[TASK_ID].attempts, 1);
authorityChangePlan = {
  active: true,
  reason: "CADENCE",
  dueAt: Date.now() + 24 * 60 * 60 * 1000,
  identity: identity(7),
};
await authorityChange.context.SellerAgentsTechnicalScheduler.wake(
  "new-authority",
);
state = await authorityChange.context.SellerAgentsTechnicalScheduler.state();
assert.equal(
  authorityChangeCalls,
  1,
  "new future authority is not refreshed early",
);
assert.equal(
  state.entries[TASK_ID].identity.serverTime,
  identity(7).serverTime,
  "new authority replaces the failed authority identity",
);
assert.equal(
  state.entries[TASK_ID].attempts,
  0,
  "retry attempts reset when signed authority identity changes",
);

console.log(
  JSON.stringify({
    status: "PASS",
    dormant_v2_no_task: true,
    multi_tab_single_flight: true,
    sleep_restart_one_overdue: true,
    renewal_reanchors: true,
    deny_cancels: true,
    bounded_retry_with_jitter: true,
    retry_cap_hours: 6,
    retry_resets_on_new_authority: true,
    token_material_persisted: false,
  }),
);
