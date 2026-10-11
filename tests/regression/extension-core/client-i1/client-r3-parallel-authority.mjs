import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { webcrypto, createHash } from "node:crypto";
const source = await fs.readFile(new URL("../../../../packages/control-client/src/parallel-authority.js", import.meta.url), "utf8");
const sandbox = { URL, AbortController, crypto: webcrypto, performance, setTimeout, clearTimeout };
vm.runInNewContext(source, sandbox, { filename: "parallel-authority.js" });
const { createBootstrapScheduler } = sandbox.SellerAgentsParallelAuthority;
const flush = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function watch(promise) {
  const row = { state: "pending" };
  row.done = promise.then(value => Object.assign(row, { state: "fulfilled", value }),
    error => Object.assign(row, { state: "rejected", error }));
  return row;
}
function fixture() {
  let time = 0, timerId = 0, id = 0, epoch = 1;
  const timers = new Map(), late = [], quarantines = [];
  const clock = {
    now: () => time,
    setTimer(fn, delay) { const key = ++timerId; timers.set(key, { fn, at: time + delay }); return key; },
    clearTimer(key) { timers.delete(key); },
    async advance(ms, deliverTimers = true) {
      time += ms;
      if (deliverTimers) {
        for (;;) {
          const due = [...timers].filter(([, t]) => t.at <= time).sort((a, b) => a[1].at - b[1].at);
          if (!due.length) break;
          const [key, t] = due[0]; timers.delete(key); t.fn();
        }
      }
      await flush();
    },
  };
  const fence = scopeKey => ({ scopeKey, environmentKey: "env", principalEpoch: epoch, accessEpoch: 1, grantEpoch: 1 });
  const make = (overrides = {}) => createBootstrapScheduler({
    ...clock, makeId: () => "id-" + (++id),
    isFenceCurrent: f => f.principalEpoch === epoch,
    observeLateOutcome: item => { late.push(item); },
    quarantine: error => { quarantines.push(error.code); },
    ...overrides,
  });
  return { clock, fence, make, late, quarantines, changePrincipal() { epoch++; } };
}
let count = 0;
async function test(name, fn) {
  await fn(); count++; console.log("PASS " + name);
}
await test("PAR-02/source: 30s waiter is retired while first acquisition takes45s; only explicit retry dispatches it", async () => {
  const f = fixture(), queue = f.make(), first = deferred(), calls = [];
  const a = watch(queue.request({ fence: f.fence("chatgpt"), run: () => { calls.push("A"); return first.promise; } }));
  const b = watch(queue.request({ fence: f.fence("alice"), waitMs: 30000, run: () => { calls.push("B"); return "B"; } }));
  await flush();
  assert.deepEqual(calls, ["A"]);
  await f.clock.advance(30000);
  assert.equal(b.state, "rejected");
  assert.equal(b.error.code, "BOOTSTRAP_QUEUE_WAIT_EXPIRED");
  assert.equal(b.error.acquisition, "NOT_STARTED");
  assert.equal(b.error.retryRequiresExplicitAction, true);
  assert.equal(queue.inspect().scopeSequences.alice, 2);
  assert.equal(queue.inspect().queuedScopes.length, 0);
  await f.clock.advance(15000);
  first.resolve("allow-A"); await flush();
  assert.equal(a.state, "fulfilled");
  assert.deepEqual(calls, ["A"]);
  const explicit = watch(queue.request({ fence: f.fence("alice"), run: () => { calls.push("B-explicit"); return "allow-B"; } }));
  await flush();
  assert.equal(explicit.state, "fulfilled");
  assert.equal(explicit.value.ticket.scopeSeq, 3);
  assert.deepEqual(calls, ["A", "B-explicit"]);
});
await test("PAR-02/source: 65s wait admits second scope after first60s timeout; late allow cannot become current", async () => {
  const f = fixture(), queue = f.make(), first = deferred(), calls = [];
  const a = watch(queue.request({ fence: f.fence("chatgpt"), run: () => { calls.push("A"); return first.promise; } }));
  const b = watch(queue.request({ fence: f.fence("alice"), run: () => { calls.push("B"); return "allow-B"; } }));
  await flush(); await f.clock.advance(60000);
  assert.equal(a.error.code, "BOOTSTRAP_ACTIVE_EXPIRED");
  assert.equal(b.state, "fulfilled");
  assert.deepEqual(calls, ["A", "B"]);
  first.resolve("late-allow-A"); await flush();
  assert.equal(f.late.length, 1);
  assert.equal(queue.isCurrent(f.late[0].ticket), false);
  assert.equal(queue.isCurrent(b.value.ticket), true);
});
await test("PAR-02/source: overdue dequeue is rejected even when timer callback has not run", async () => {
  const f = fixture(), queue = f.make(), first = deferred(); let secondCalls = 0;
  watch(queue.request({ fence: f.fence("chatgpt"), run: () => first.promise }));
  const b = watch(queue.request({ fence: f.fence("alice"), waitMs: 30000, run: () => { secondCalls++; } }));
  await flush(); await f.clock.advance(31000, false);
  first.resolve("A"); await flush();
  assert.equal(secondCalls, 0);
  assert.equal(b.error.code, "BOOTSTRAP_QUEUE_WAIT_EXPIRED");
  assert.equal(queue.inspect().scopeSequences.alice, 2);
});
await test("PAR-02/source: coalesced caller cancellation preserves the other caller and uses one acquisition", async () => {
  const f = fixture(), queue = f.make(), pending = deferred(), abort = new AbortController(); let calls = 0;
  const run = () => { calls++; return pending.promise; };
  const a = watch(queue.request({ fence: f.fence("chatgpt"), run, signal: abort.signal }));
  const b = watch(queue.request({ fence: f.fence("chatgpt"), run }));
  await flush(); abort.abort(); await flush();
  assert.equal(a.error.code, "BOOTSTRAP_WAITER_CANCELLED");
  assert.equal(b.state, "pending");
  assert.equal(queue.inspect().scopeSequences.chatgpt, 1);
  pending.resolve("allow"); await flush();
  assert.equal(calls, 1);
  assert.equal(b.state, "fulfilled");
});
await test("PAR-02/source: cancelling last queued caller prevents all future automatic sends", async () => {
  const f = fixture(), queue = f.make(), pending = deferred(), abort = new AbortController(); let calls = 0;
  watch(queue.request({ fence: f.fence("chatgpt"), run: () => pending.promise }));
  const b = watch(queue.request({ fence: f.fence("alice"), signal: abort.signal, run: () => { calls++; } }));
  await flush(); abort.abort(); await flush(); pending.resolve("A"); await flush();
  assert.equal(b.error.acquisition, "NOT_STARTED");
  assert.equal(calls, 0);
  assert.equal(queue.inspect().scopeSequences.alice, 2);
});
await test("PAR-02/source: a repeat of first scope cannot overtake already queued second scope", async () => {
  const f = fixture(), queue = f.make(), first = deferred(), second = deferred(), calls = [];
  const a = queue.request({ fence: f.fence("chatgpt"), run: () => { calls.push("A1"); return first.promise; } });
  watch(queue.request({ fence: f.fence("alice"), run: () => { calls.push("B1"); return second.promise; } }));
  const repeat = watch(a.then(() => queue.request({ fence: f.fence("chatgpt"), run: () => { calls.push("A2"); return "A2"; } })));
  await flush(); first.resolve("A1"); await flush();
  assert.deepEqual(calls, ["A1", "B1"]);
  second.resolve("B1"); await flush();
  assert.deepEqual(calls, ["A1", "B1", "A2"]);
  assert.equal(repeat.state, "fulfilled");
});
await test("PAR-02/source: unknown security commit quarantines instead of freeing a competing writer", async () => {
  const f = fixture(), queue = f.make(), pending = deferred(); let calls = 0;
  const a = watch(queue.request({ fence: f.fence("chatgpt"), run: ticket => { ticket.beginSecurityCommit(); return pending.promise; } }));
  const b = watch(queue.request({ fence: f.fence("alice"), run: () => { calls++; return "B"; } }));
  await flush(); await f.clock.advance(60000);
  assert.equal(queue.inspect().closed, true);
  assert.equal(a.error.code, "BOOTSTRAP_SECURITY_QUARANTINE");
  assert.equal(b.error.code, "BOOTSTRAP_SECURITY_QUARANTINE");
  assert.equal(calls, 0);
  assert.deepEqual(f.quarantines, ["BOOTSTRAP_SECURITY_COMMIT_UNKNOWN"]);
});
await test("PAR-02/source: logout retires queued old-principal work without sending it", async () => {
  const f = fixture(), queue = f.make(), pending = deferred(); let calls = 0;
  watch(queue.request({ fence: f.fence("chatgpt"), run: () => pending.promise }));
  const b = watch(queue.request({ fence: f.fence("alice"), run: () => { calls++; } }));
  await flush(); f.changePrincipal(); pending.resolve("old-principal-allow"); await flush();
  assert.equal(b.error.code, "BOOTSTRAP_CONTEXT_CHANGED");
  assert.equal(calls, 0);
  assert.equal(f.late.length, 1);
});
await test("PAR-02/source: worker replacement never resumes old RAM ticket", async () => {
  const f = fixture(), old = f.make(), pending = deferred();
  const oldResult = watch(old.request({ fence: f.fence("chatgpt"), run: () => pending.promise }));
  await flush(); old.dispose();
  const next = f.make(), fresh = watch(next.request({ fence: f.fence("chatgpt"), run: () => "fresh" }));
  await flush(); pending.resolve("old"); await flush();
  assert.equal(oldResult.error.code, "BOOTSTRAP_WORKER_RETIRED");
  assert.equal(fresh.state, "fulfilled");
  assert.equal(next.isCurrent(f.late[0].ticket), false);
  assert.equal(next.isCurrent(fresh.value.ticket), true);
});
await test("PAR-02/source: resolved or rejected unconfirmed security commit never frees admission", async () => {
  for (const rejects of [false, true]) {
    const f = fixture(), queue = f.make(); let sends = 0;
    const a = watch(queue.request({ fence: f.fence("chatgpt"), run: ticket => {
      ticket.beginSecurityCommit();
      if (rejects) throw new Error("disk failed");
      return "unconfirmed";
    } }));
    const b = watch(queue.request({ fence: f.fence("alice"), run: () => sends++ }));
    await flush();
    assert.equal(a.error.code, "BOOTSTRAP_SECURITY_QUARANTINE");
    assert.equal(b.error.code, "BOOTSTRAP_SECURITY_QUARANTINE");
    assert.equal(sends, 0);
    assert.deepEqual(f.quarantines, ["BOOTSTRAP_SECURITY_COMMIT_UNKNOWN"]);
  }
});
await test("PAR-02/source: disposing during security write still records quarantine", async () => {
  const f = fixture(), queue = f.make(), pending = deferred();
  const a = watch(queue.request({ fence: f.fence("chatgpt"), run: ticket => {
    ticket.beginSecurityCommit(); return pending.promise;
  } }));
  await flush(); queue.dispose(); await flush();
  assert.equal(a.error.code, "BOOTSTRAP_SECURITY_QUARANTINE");
  assert.deepEqual(f.quarantines, ["BOOTSTRAP_SECURITY_COMMIT_UNKNOWN"]);
});
await test("PAR-02/source: failed fence read closes admission without stranded waiter", async () => {
  const f = fixture(); let broken = false;
  const queue = f.make({ isFenceCurrent: () => { if (broken) throw new Error("unreadable fence"); return true; } });
  const pending = deferred();
  const a = watch(queue.request({ fence: f.fence("chatgpt"), run: () => pending.promise }));
  const b = watch(queue.request({ fence: f.fence("alice"), run: () => "must not run" }));
  await flush(); broken = true; pending.resolve("allow"); await flush();
  assert.equal(queue.inspect().closed, true);
  assert.equal(a.error.code, "BOOTSTRAP_SECURITY_QUARANTINE");
  assert.equal(b.error.code, "BOOTSTRAP_SECURITY_QUARANTINE");
});
await test("PAR-02/source: confirmed security write preserves normal FIFO admission", async () => {
  const f = fixture(), queue = f.make();
  const a = watch(queue.request({ fence: f.fence("chatgpt"), run: ticket => {
    ticket.beginSecurityCommit(); ticket.finishSecurityCommit(); return "confirmed";
  } }));
  const b = watch(queue.request({ fence: f.fence("alice"), run: () => "B" }));
  await flush();
  assert.equal(a.state, "fulfilled"); assert.equal(b.state, "fulfilled");
  assert.equal(queue.inspect().closed, false); assert.equal(f.quarantines.length, 0);
});
const scopePorts = { canonicalJson: value => JSON.stringify(value, (key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item),
  sha256: async value => createHash("sha256").update(value).digest("hex") };
const scopeInput = { controlApiOrigin: "https://control.example.test", portalOrigin: "https://portal.example.test",
  allowedOrigins: ["https://control.example.test", "https://portal.example.test"],
  accountId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", deviceId: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB",
  sessionId: "CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC", principalEpoch: 3,
  contractVersion: "control_plane_v3", extensionVersion: "0.2.15", browser: { family: "chrome", version: "152.0.0.0" },
  trustBundleSha256: "d".repeat(64), privacyProjection: "identified", ai: { family: "chatgpt", surface: "web", variant: null } };
const scopeIdentity = input => sandbox.SellerAgentsParallelAuthority.createScopeIdentity(input, scopePorts);
await test("PAR-03/source scope: ChatGPT Standard and Work share signed scope, not DOM binding", async () => {
  const standard = await scopeIdentity({ ...scopeInput, presentation: "Standard", profileRevision: 1 });
  const work = await scopeIdentity({ ...scopeInput, presentation: "Work", profileRevision: 2 });
  assert.equal(standard.scopeKey, work.scopeKey);
  assert.equal(standard.environmentKey, work.environmentKey);
  assert.equal(JSON.parse(standard.principalKey).accountId, scopeInput.accountId.toLowerCase());
  assert.notEqual((await scopeIdentity({ ...scopeInput, ai: { family: "alice", surface: "web", variant: null } })).scopeKey, standard.scopeKey);
});
await test("PAR-03/source scope: full environment and principal epoch partition grants", async () => {
  const base = await scopeIdentity(scopeInput);
  for (const change of [{ principalEpoch: 4 }, { extensionVersion: "0.2.16" },
    { browser: { family: "chrome", version: "152.0.0.1" } }, { trustBundleSha256: "e".repeat(64) },
    { privacyProjection: "privacy-neutral" }, { contractVersion: "control_plane_v2" }]) {
    assert.notEqual((await scopeIdentity({ ...scopeInput, ...change })).scopeKey, base.scopeKey);
  }
  assert.equal((await scopeIdentity({ ...scopeInput, serverTime: "2099-01-01", configVersion: 99, expiresAt: "2100-01-01" })).scopeKey, base.scopeKey);
});
await test("PAR-03/source scope: empty variant and invented Work scope are rejected", async () => {
  for (const ai of [{ family: "chatgpt", surface: "web", variant: "" }, { family: "chatgpt_work", surface: "web", variant: null }]) {
    await assert.rejects(scopeIdentity({ ...scopeInput, ai }), { code: "SCOPE_AI_UNSUPPORTED" });
  }
});
await test("PAR-03/source scope: production origins are exact packaged HTTPS origins", async () => {
  await assert.rejects(scopeIdentity({ ...scopeInput, controlApiOrigin: "https://untrusted.example.test" }), { code: "SCOPE_ORIGIN_INVALID" });
  await assert.rejects(scopeIdentity({ ...scopeInput, controlApiOrigin: "https://control.example.test/path" }), { code: "SCOPE_ORIGIN_INVALID" });
  const dev = { ...scopeInput, controlApiOrigin: "http://127.0.0.1:43100", allowedOrigins: [...scopeInput.allowedOrigins, "http://127.0.0.1:43100"] };
  await assert.rejects(scopeIdentity(dev), { code: "SCOPE_ORIGIN_INVALID" });
  assert.ok((await scopeIdentity({ ...dev, development: true })).scopeKey);
});
await test("PAR-02/source: verified writer acknowledges its own grant epoch without changing the captured ticket", async () => {
  const f = fixture(); let grantEpoch = 1, captured;
  const queue = f.make({ isFenceCurrent: fence => fence.principalEpoch === 1 && fence.grantEpoch === grantEpoch });
  const a = watch(queue.request({ fence: f.fence("chatgpt"), run: request => {
    captured = request.fence;
    request.beginSecurityCommit(); grantEpoch = 2;
    request.finishSecurityCommit({ ...request.fence, grantEpoch });
    request.assertCurrent(); return "committed";
  } }));
  await flush(); assert.equal(a.state, "fulfilled"); assert.equal(captured.grantEpoch, 1);
  assert.equal(a.value.ticket.fence.grantEpoch, 1); assert.equal(f.quarantines.length, 0);
});
await test("PAR-02/source: commit cannot acknowledge another principal or silently leave a security commit open", async () => {
  const f = fixture(), queue = f.make();
  const a = watch(queue.request({ fence: f.fence("chatgpt"), run: request => {
    request.beginSecurityCommit();
    request.finishSecurityCommit({ ...request.fence, principalEpoch: 2 });
  } }));
  await flush(); assert.equal(a.state, "rejected");
  assert.equal(a.error.code, "BOOTSTRAP_SECURITY_QUARANTINE");
  assert.deepEqual(f.quarantines, ["BOOTSTRAP_SECURITY_COMMIT_UNKNOWN"]);
});
await test("PAR-18/source: confirmed revocation preserves the precise rejection and cancels old-principal queue", async () => {
  const f = fixture(), queue = f.make(), first = deferred(); let calls = 0;
  const a = watch(queue.request({ fence: f.fence("chatgpt"), run: async request => {
    await first.promise; request.beginSecurityCommit(); f.changePrincipal();
    request.finishRevocationCommit(); throw Object.assign(new Error("UNAUTHORIZED"), { code: "UNAUTHORIZED" });
  } }));
  const b = watch(queue.request({ fence: f.fence("alice"), run: () => { calls++; } }));
  await flush(); first.resolve(); await flush();
  assert.equal(a.error.code, "UNAUTHORIZED"); assert.equal(b.error.code, "BOOTSTRAP_CONTEXT_CHANGED");
  assert.equal(calls, 0); assert.equal(f.quarantines.length, 0);
});
await test("PAR-02/source: replacement during an unknown security commit rejects without a stranded queue", async () => {
  const f = fixture(), queue = f.make(), hold = deferred(); let dispatched = 0;
  const first = watch(queue.request({ fence: f.fence("chatgpt"), run: async lease => {
    lease.beginSecurityCommit(); await hold.promise;
  } }));
  await flush();
  const second = watch(queue.request({ fence: { ...f.fence("chatgpt"), accessEpoch: 2 }, run: () => { dispatched++; } }));
  await flush();
  assert.equal(first.state, "rejected"); assert.equal(first.error.code, "BOOTSTRAP_SECURITY_QUARANTINE");
  assert.equal(second.state, "rejected"); assert.equal(second.error.code, "BOOTSTRAP_SECURITY_QUARANTINE");
  assert.deepEqual(f.quarantines, ["BOOTSTRAP_SECURITY_COMMIT_UNKNOWN"]);
  assert.equal(dispatched, 0); assert.equal(queue.inspect().queuedScopes.length, 0);
  hold.resolve(); await flush(); assert.equal(dispatched, 0);
});
await test("PAR-02/source: incompatible operation rejects without replacing a coalesced acquisition", async () => {
  const f = fixture(), queue = f.make(), hold = deferred(); let calls = 0;
  const run = () => { calls++; return hold.promise; };
  const a = watch(queue.request({ fence: f.fence("chatgpt"), requestKey: "policy", run }));
  const b = watch(queue.request({ fence: f.fence("chatgpt"), requestKey: "policy", run }));
  await flush();
  await assert.rejects(queue.request({ fence: f.fence("chatgpt"), requestKey: "raw", run }), {
    code: "BOOTSTRAP_REQUEST_CONFLICT", acquisition: "NOT_STARTED", retryRequiresExplicitAction: true,
  });
  assert.equal(calls, 1); assert.equal(queue.inspect().queuedScopes.length, 0);
  assert.equal(a.state, "pending"); assert.equal(b.state, "pending");
  hold.resolve("cache"); await flush();
  assert.equal(a.value.value, "cache"); assert.equal(b.value.value, "cache");
  const explicit = await queue.request({ fence: f.fence("chatgpt"), requestKey: "raw", run: () => { calls++; return "online"; } });
  assert.equal(explicit.value, "online"); assert.equal(calls, 2);
});
console.log("SOURCE bootstrap scheduler: " + count + " scenarios passed; no package/installed acceptance claimed.");

if (process.argv[2]) {
  const { makeWorker, signFixtureBootstrap, until } = await import("../worker-harness.mjs");
  const runtime = process.argv[2], AUTH = "seller_agents_control_auth_v2";
  const backing = { local: {}, session: {} }, calls = []; let releaseFirst, mode = "allow";
  let template;
  const fetch = async (url, options) => {
    if (!url.endsWith("/v1/bootstrap")) throw new Error("Unexpected control call: " + url);
    const family = JSON.parse(options.body).detectedAi?.family;
    calls.push(family);
    if (mode === "transport") throw new Error("fixture disconnected");
    const payload = structuredClone(template); payload.serverTime = new Date(Date.now()).toISOString();
    payload.ai.detected.family = family;
    if (mode === "deny") { payload.devicePolicy.status = "REVOKED"; }
    const result = new Response(JSON.stringify(await signFixtureBootstrap(backing, payload)), { headers: { "content-type": "application/json" } });
    if (calls.length === 1) return new Promise(resolve => { releaseFirst = () => resolve(result); });
    return result;
  };
  let worker = await makeWorker(runtime, { backing, fetch });
  template = structuredClone(backing.local[AUTH].authority.payload);
  const ai = family => ({ detectedAi: { family, surface: "web", variant: null } });
  try {
    await test("PAR-01/package: real client serializes only bootstrap and retains two signed grants", async () => {
      const generation = await worker.call("SellerAgentsControlClient.generation");
      const a = watch(worker.call('(function () { const options = { detectedAi: { family: "chatgpt", surface: "web", variant: null } }; const pending = SellerAgentsControlClient.bootstrapWithPolicy(options); options.detectedAi.family = "alice"; return pending; })'));
      await until(() => releaseFirst || a.state === "rejected", "first bootstrap request");
      assert.equal(a.state, "pending", a.error?.stack);
      const identical = watch(worker.call("SellerAgentsControlClient.bootstrapWithPolicy", ai("chatgpt")));
      const conflict = { code: "BOOTSTRAP_REQUEST_CONFLICT", acquisition: "NOT_STARTED", retryRequiresExplicitAction: true };
      await assert.rejects(worker.call("SellerAgentsControlClient.bootstrap", ai("chatgpt")), conflict);
      for (const constraint of [
        { context: null },
        { expectedAccountId: template.account.id },
        { minimumServerTimeExclusive: 0 },
        { detectedAi: { family: "chatgpt", surface: "other", variant: null } },
        { detectedAi: { family: "chatgpt", surface: "web", variant: "work" } },
      ]) await assert.rejects(worker.call("SellerAgentsControlClient.bootstrapWithPolicy", { ...ai("chatgpt"), ...constraint }), conflict);
      assert.deepEqual(calls, ["chatgpt"], "incompatible constraints neither dispatch nor replace the original snapshot");
      const b = watch(worker.call("SellerAgentsControlClient.bootstrapWithPolicy", ai("alice")));
      await new Promise(resolve => setTimeout(resolve, 20)); assert.deepEqual(calls, ["chatgpt"]);
      releaseFirst(); await Promise.all([a.done, b.done, identical.done]);
      assert.equal(identical.state, "fulfilled", identical.error?.stack);
      assert.deepEqual(identical.value, a.value);
      assert.equal(a.state, "fulfilled", a.error?.stack); assert.equal(b.state, "fulfilled", b.error?.stack);
      assert.equal(await worker.call("SellerAgentsControlClient.canWork", "chatgpt"), true);
      assert.equal(await worker.call("SellerAgentsControlClient.canWork", "alice"), true);
      assert.equal(Object.keys(backing.local[AUTH].grants).length, 2);
      assert.equal(await worker.call("SellerAgentsControlClient.generation"), generation);
    });
    await test("PAR-20/package subset: ordinary refresh preserves both grants and grant epochs", async () => {
      const before = structuredClone(backing.local[AUTH].grants);
      await worker.call("SellerAgentsControlClient.bootstrapWithPolicy", ai("chatgpt"));
      for (const [key, old] of Object.entries(before)) assert.equal(backing.local[AUTH].grants[key].grantEpoch, old.grantEpoch);
      assert.equal(await worker.call("SellerAgentsControlClient.canWork", "alice"), true);
    });
    await test("PAR-01/package: restart verifies both cached grants; failed Alice acquisition uses only Alice cache", async () => {
      worker.close(); mode = "transport";
      worker = await makeWorker(runtime, { backing, seedAuthority: false, fetch });
      for (const family of ["alice", "chatgpt"]) assert.equal(await worker.call("SellerAgentsControlClient.canWork", family), true);
      const cached = await worker.call("SellerAgentsControlClient.bootstrapWithPolicy", ai("alice"));
      assert.equal(cached.source, "CACHE"); assert.equal(cached.payload.ai.detected.family, "alice");
      assert.equal(await worker.call("SellerAgentsControlClient.canWork", "chatgpt"), true);
    });
    await test("PAR-18/package subset: common device denial still revokes both AI grants", async () => {
      mode = "deny";
      await assert.rejects(worker.call("SellerAgentsControlClient.bootstrapWithPolicy", ai("alice")));
      for (const family of ["alice", "chatgpt"]) assert.equal(await worker.call("SellerAgentsControlClient.canWork", family), false);
      assert.equal(Object.keys(backing.local[AUTH].grants).length, 0);
    });
  } finally { worker.close(); }
  console.log("PACKAGE client scope integration completed; simulated transport, no installed/live acceptance.");
}
