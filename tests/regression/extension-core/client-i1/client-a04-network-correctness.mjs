import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { makeWorker } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const workerSource = fs.readFileSync(path.join(runtime, "service_worker.js"), "utf8");
const marker = "/* P3: one installation-local coordinator";
const markerAt = workerSource.indexOf(marker);
assert.ok(markerAt >= 0, "composed worker contains technical scheduler");
const schedulerSource = workerSource.slice(
  workerSource.lastIndexOf("(() => {", markerAt),
  workerSource.indexOf("\n})();", markerAt) + "\n})();".length,
);
const response = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
const future = (ms) => new Date(Date.now() + ms).toISOString();
const refreshed = (accessToken = "a04_rotated_access_token") =>
  response({
    tokenType: "Bearer",
    accessToken,
    accessTokenExpiresAt: future(3_600_000),
    refreshToken: "R".repeat(43),
    refreshTokenExpiresAt: future(7_200_000),
  });
const expireStoredAccess = (backing) => (kind, keys) => {
  if (
    kind === "local" &&
    String(keys).includes("seller_agents_control_auth_v2") &&
    backing.local.seller_agents_control_auth_v2
  ) {
    backing.local.seller_agents_control_auth_v2.credentials.accessTokenExpiresAt =
      new Date(Date.now() - 1000).toISOString();
  }
};
const recordStore = (worker, suffix = "one") =>
  worker.call("SellerAgentsSyncJournal.recordStoreMetadata", {
    store: {
      id: `a04-store-${suffix}`,
      marketplace: "ozon",
      name: "A04 synthetic",
      credentialRevision: `a04-revision-${suffix}`,
      metadataRevision: 1,
      providerIdentityState: "UNCONFIRMED",
      lifecycleState: "ACTIVE",
    },
  });

{
  let clock = 1_800_000_000_000;
  class Clock extends Date {
    static now() { return clock; }
  }
  const persisted = {};
  const alarms = new Map();
  const journal = {
    entries: {
      "binding:1": {
        requestId: "request-1",
        installationId: "installation-1",
        localSequence: 1,
        attempts: 0,
        nextAttemptAt: 0,
        status: "PENDING",
        kind: "BINDING_UPSERT",
      },
    },
  };
  let syncCalls = 0;
  const context = {
    console, Date: Clock, structuredClone, Promise, Map, Set, Object, Array,
    Number, String, Boolean, JSON, TextEncoder,
    WORKER_SESSION_ID: "a04-worker",
    SellerAgentsSyncJournal: {
      read: async () => structuredClone(journal),
      syncNow: async () => {
        syncCalls += 1;
        journal.entries = {};
        return { ok: true, sent: 1 };
      },
    },
    OzonRuntime: {
      STORAGE_KEYS: {
        MANUAL_OPERATIONS: "manual",
        AUTO_RUNS: "autoruns",
        WORK_SESSION_RECOVERIES: "recoveries",
      },
    },
    chrome: {
      storage: { local: {
        async get(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.filter(Boolean).map((key) => [key, persisted[key]]));
        },
        async set(values) { Object.assign(persisted, structuredClone(values)); },
      } },
      alarms: {
        onAlarm: { addListener() {} },
        async create(name, details) { alarms.set(name, details); },
        async clear(name) { alarms.delete(name); return true; },
      },
      runtime: { onStartup: { addListener() {} }, onInstalled: { addListener() {} } },
    },
  };
  context.globalThis = context;
  vm.runInNewContext(schedulerSource, context, { filename: "technical-scheduler.js" });
  const scheduler = context.SellerAgentsTechnicalScheduler;
  await scheduler.schedule(scheduler.KINDS.SYNC, {
    taskId: "sync:pending",
    dueAt: clock + 5000,
    identity: { requestId: "request-1", installationId: "installation-1" },
  });
  clock += 30_000;
  await scheduler.wake("alarm");
  assert.equal(syncCalls, 1, "existing first-sync deadline survives reconstruction");
  assert.deepEqual((await scheduler.state()).entries, {}, "successful sync task drains");

  journal.entries = {
    "marker:2": {
      requestId: "request-marker",
      installationId: "installation-1",
      localSequence: 2,
      attempts: 0,
      nextAttemptAt: 0,
      status: "PENDING",
      kind: "DELIVERY_MARKER",
    },
  };
  await scheduler.wake("delivery-marker-only");
  assert.equal(syncCalls, 1, "delivery marker does not create its own network wake");
  assert.equal((await scheduler.state()).entries["sync:pending"], undefined);
}

{
  const backing = { local: {}, session: {} };
  const routes = [];
  let syncBearer = null;
  const worker = await makeWorker(runtime, {
    backing,
    onStorageRead: expireStoredAccess(backing),
    fetch: async (url) => {
      assert.ok(url.endsWith("/v1/auth/refresh"), url);
      routes.push("refresh");
      return refreshed();
    },
    syncFetch: async (_url, init) => {
      routes.push("sync");
      syncBearer = init.headers.get("Authorization");
      return response({ syncVersion: "seller_agents_sync_v1", results: [] });
    },
  });
  try {
    await worker.call("SellerAgentsControlClient.synchronizeMetadata", {
      syncVersion: "seller_agents_sync_v1",
      entries: [{ requestId: "a04-sync" }],
    });
    assert.deepEqual(routes, ["refresh", "sync"]);
    assert.equal(syncBearer, "Bearer a04_rotated_access_token");
    assert.equal((await worker.call("SellerAgentsControlClient.status")).authenticated, true);
  } finally { worker.close(); }
}

{
  const backing = { local: {}, session: {} };
  let refreshCalls = 0;
  const worker = await makeWorker(runtime, {
    backing,
    onStorageRead: expireStoredAccess(backing),
    fetch: async (url) => {
      assert.ok(url.endsWith("/v1/auth/refresh"), url);
      refreshCalls += 1;
      return refreshed("a04_health_access_token");
    },
  });
  try {
    const health = await worker.call("SellerAgentsControlClient.acquireSignedHealthAuthority", {
      detectedAi: { family: "chatgpt", surface: "web", variant: null },
    });
    assert.equal(refreshCalls, 1);
    assert.equal(health.payload.status, "PASS");
  } finally { worker.close(); }
}
{
  const backing = { local: {}, session: {} };
  const routes = [];
  let transferBearer = null;
  const worker = await makeWorker(runtime, {
    backing,
    onStorageRead: expireStoredAccess(backing),
    fetch: async (url, init) => {
      if (url.endsWith("/v1/auth/refresh")) {
        routes.push("refresh");
        return refreshed("a04_transfer_access_token");
      }
      if (url.endsWith("/v1/credential-transfers/pending/source")) {
        routes.push("transfer");
        transferBearer = init.headers.get("Authorization");
        return response([]);
      }
      throw new Error("unexpected control request: " + url);
    },
  });
  try {
    const transfers = await worker.call("SellerAgentsControlClient.listCredentialTransfers");
    assert.equal(Array.isArray(transfers), true);
    assert.equal(transfers.length, 0);
    assert.deepEqual(routes, ["refresh", "transfer"]);
    assert.equal(transferBearer, "Bearer a04_transfer_access_token");
  } finally { worker.close(); }
}
{
  const bearers = [];
  let refreshCalls = 0;
  const worker = await makeWorker(runtime, {
    fetch: async (url) => {
      assert.ok(url.endsWith("/v1/auth/refresh"), url);
      refreshCalls += 1;
      return refreshed("a04_retry_access_token");
    },
    syncFetch: async (_url, init, call) => {
      bearers.push(init.headers.get("Authorization"));
      if (call === 1) return response({ error: { code: "UNAUTHORIZED" } }, 401);
      return response({ syncVersion: "seller_agents_sync_v1", results: [] });
    },
  });
  try {
    await worker.call("SellerAgentsControlClient.synchronizeMetadata", {
      syncVersion: "seller_agents_sync_v1",
      entries: [{ requestId: "a04-reactive" }],
    });
    assert.equal(refreshCalls, 1);
    assert.equal(bearers.length, 2);
    assert.notEqual(bearers[0], bearers[1]);
    assert.equal(bearers[1], "Bearer a04_retry_access_token");
  } finally { worker.close(); }
}
{
  let refreshCalls = 0;
  const worker = await makeWorker(runtime, {
    fetch: async (url) => {
      assert.ok(url.endsWith("/v1/auth/refresh"), url);
      refreshCalls += 1;
      throw new Error("refresh transport unavailable");
    },
    syncFetch: async () => response({ error: { code: "UNAUTHORIZED" } }, 401),
  });
  try {
    await recordStore(worker, "reactive-refresh-offline");
    const outcome = await worker.call("SellerAgentsSyncJournal.syncNow", "a04-reactive-refresh-offline");
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, "UNAUTHORIZED",
      "confirmed 401 is not downgraded to offline when reactive refresh transport fails");
    assert.equal(refreshCalls, 2, "refresh transport keeps its existing bounded two-attempt behavior");
  } finally { worker.close(); }
}

{
  let refreshCalls = 0;
  const worker = await makeWorker(runtime, {
    fetch: async (url) => {
      assert.ok(url.endsWith("/v1/auth/refresh"), url);
      refreshCalls += 1;
      return refreshed("a04_terminal_access_token");
    },
    syncFetch: async () => response({ error: { code: "UNAUTHORIZED" } }, 401),
  });
  try {
    await recordStore(worker, "terminal");
    const outcome = await worker.call("SellerAgentsSyncJournal.syncNow", "a04-terminal");
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, "UNAUTHORIZED");
    assert.equal(refreshCalls, 1);
    assert.equal((await worker.call("SellerAgentsControlClient.status")).authenticated, false);
    assert.equal(await worker.call("SellerAgentsControlClient.generation"), 2,
      "terminal auth is invalidated once by control-client, not reset again by sync journal");
  } finally { worker.close(); }
}

{
  const backing = { local: {}, session: {} };
  const worker = await makeWorker(runtime, {
    backing,
    onStorageRead: expireStoredAccess(backing),
    fetch: async (url) => {
      assert.ok(url.endsWith("/v1/auth/refresh"), url);
      return response({ error: { code: "SERVICE_UNAVAILABLE" } }, 503);
    },
  });
  try {
    await recordStore(worker, "refresh-offline");
    const outcome = await worker.call("SellerAgentsSyncJournal.syncNow", "a04-refresh-offline");
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, "SERVICE_UNAVAILABLE");
    assert.equal((await worker.call("SellerAgentsControlClient.status")).authenticated, true,
      "refresh transport/service failure keeps local auth for later retry");
    const journal = await worker.call("SellerAgentsSyncJournal.read");
    assert.equal(Object.values(journal.entries)[0].status, "RETRY_WAIT");
  } finally { worker.close(); }
}

{
  const worker = await makeWorker(runtime, {
    syncFetch: async () => response({ error: { code: "SERVICE_UNAVAILABLE" } }, 503, { "Retry-After": "60" }),
  });
  try {
    await recordStore(worker, "retry-after");
    const before = Date.now();
    const outcome = await worker.call("SellerAgentsSyncJournal.syncNow", "a04-retry-after");
    assert.equal(outcome.ok, false);
    const journal = await worker.call("SellerAgentsSyncJournal.read");
    const entry = Object.values(journal.entries)[0];
    assert.equal(entry.status, "RETRY_WAIT");
    assert.ok(entry.nextAttemptAt - before >= 59_000, "Retry-After is respected");
  } finally { worker.close(); }
}

console.log(JSON.stringify({
  status: "PASS",
  sync_alarm_deadline_preserved: true,
  delivery_marker_unscheduled: true,
  expired_access_refreshes_sync_health_transfer: true,
  one_401_refresh_retry: true,
  reactive_401_not_masked_by_refresh_transport: true,
  terminal_401_invalidates_once: true,
  refresh_service_failure_preserves_auth: true,
  retry_after_respected: true,
}));
