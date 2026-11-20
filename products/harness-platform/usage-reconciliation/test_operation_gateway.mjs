import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createGateway } from '../../../integrations/harness-native-lab/gateway/server.mjs';
import { openOperationResolver } from '../../../integrations/harness-native-lab/gateway/operation-resolver.mjs';

const component = fileURLToPath(new URL('.', import.meta.url));
const python = process.env.HARNESS_TEST_PYTHON || process.env.PYTHON || 'python3';

function runPython(args, input) {
  return execFileSync(python, args, { cwd: component, input, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, HARNESS_RUB_PER_USD:"80", PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: path.dirname(path.resolve(component)) } });
}

function prepareGrants(database) {
  return JSON.parse(runPython(['-', database], `
from dataclasses import asdict
import json
import sys
import time
from unittest.mock import patch
from platform_core.storage import Scope, Store
from platform_core.operation_grants import issue_grant

database = sys.argv[1]
first = Scope("actor-a", "workspace-a", "chat-a")
second = Scope("actor-b", "workspace-b", "chat-b")
with Store(database) as store:
    store.provision(first)
    store.provision(second)
from platform_core.operation_grants import initialize_grants
from platform_core.coins import grant
import sqlite3
initialize_grants(database)
with sqlite3.connect(database) as db:
    for scope in (first, second):
        grant(db,"fixture", scope.workspace_id,scope.workspace_id,"10","fixture")

def issue(scope, **kwargs):
    return asdict(issue_grant(database, scope, source="chat", run_key="shared-turn-key", **kwargs))

grants = {"first": issue(first), "second": issue(second), "retry": issue(first),
          "revoked": issue(first)}
# The row remains present and the real resolver evaluates it against today's clock.
with patch("platform_core.operation_grants.time.time", return_value=time.time() - 60):
    grants["expired"] = issue(first, ttl_seconds=1)
print(json.dumps(grants))
`));
}

async function listen(server) {
  const ready = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await ready;
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  if (!server?.listening) return;
  const closed = once(server, 'close');
  server.close();
  server.closeAllConnections();
  await closed;
}

test('operation grants isolate concurrent usage through the gateway and reconciliation CLI',
  { timeout: 30000 }, async t => {
    const dir = await mkdtemp(path.join(tmpdir(), 'harness-operation-gateway-'));
    const journal = path.join(dir, 'attempts.jsonl');
    const db = path.join(dir, 'platform.sqlite3');
    const requests = [];
    let upstream, gateway, resolver;
    t.after(async () => {
      try {
        await Promise.all([close(gateway?.server), close(upstream)]);
      } finally {
        resolver?.close();
        await rm(dir, { recursive: true, force: true });
      }
    });
    const grants = prepareGrants(db);
    assert.equal(grants.first.operation_id, grants.retry.operation_id);
    assert.notEqual(grants.first.token, grants.retry.token);
    assert.notEqual(grants.first.operation_id, grants.second.operation_id);

    // Both first calls must reach the provider before either response is released.
    let releasePair;
    const pairReady = new Promise(resolve => { releasePair = resolve; });
    upstream = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks));
      const requestNumber = requests.push({ body, headers: req.headers, url: req.url });
      if (requestNumber === 2) releasePair();
      await pairReady;
      const second = body.messages[0].content === 'second fixture';
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: `fixture-response-${requestNumber}`, type: 'message',
        model: body.model, stop_reason: 'end_turn', content: [{ type: 'text', text: 'OK' }],
        usage: { input_tokens: second ? 100 : 10, output_tokens: second ? 10 : 5,
          cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }));
    });
    const upstreamBase = await listen(upstream);
    resolver = openOperationResolver(db);
    gateway = createGateway({ logFile: journal, resolveAttribution: resolver.resolve, billing: resolver.billing,
      realKey: 'local-provider-fixture-key', userId: 'server-user', upstreamBase, fx: 80, timeoutMs: 5000 });
    const address = await listen(gateway.server);
    function send(token, content) {
      return fetch(`${address}/v1/messages`, {
        method: 'POST', signal: AbortSignal.timeout(7000),
        headers: { 'content-type': 'application/json', 'x-api-key': token,
          'x-deepseek-harness-session-id': 'external-session', 'x-workspace-id': 'client-claim' },
        body: JSON.stringify({ model: 'deepseek-flash', max_tokens: 20,
          metadata: { user_id: 'client-claim', operation_id: 'client-operation' },
          messages: [{ role: 'user', content }] }),
      });
    }
    const responses = await Promise.all([
      send(grants.first.token, 'first fixture'), send(grants.second.token, 'second fixture'),
    ]);
    responses.push(await send(grants.retry.token, 'first fixture'));
    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.equal((await response.json()).stop_reason, 'end_turn');
    }
    assert.equal(requests.length, 3);
    const privateValues = Object.values(grants).flatMap(g => [g.token, g.operation_id, g.workspace_id]);
    for (const { headers, body, url } of requests) {
      assert.equal(url, '/v1/messages');
      assert.equal(headers['x-api-key'], 'local-provider-fixture-key');
      assert.equal(headers.authorization, 'Bearer local-provider-fixture-key');
      assert.deepEqual(body.metadata, { user_id: 'server-user' });
      const wire = JSON.stringify({ headers, body, url });
      for (const value of [...privateValues, 'client-claim', 'client-operation', 'external-session',
        'shared-turn-key', 'actor-a', 'actor-b', 'chat-a', 'chat-b']) {
        assert.ok(!wire.includes(value), 'unexpected client credential or caller identity at provider');
      }
    }

    assert.equal(resolver.resolve(grants.revoked.token).operation_id, grants.first.operation_id);
    runPython(['-c', 'import sys; from platform_core.operation_grants import revoke_grant; revoke_grant(sys.argv[1], sys.stdin.read())', db],
      grants.revoked.token);
    for (const token of ['x'.repeat(43), grants.expired.token, grants.revoked.token]) {
      const response = await send(token, 'denied fixture');
      assert.equal(response.status, 401);
      await response.text();
    }
    for (const headers of [{ 'x-api-key': grants.first.token }, {}]) {
      const meter = await fetch(`${address}/lab-meter`, { headers, signal: AbortSignal.timeout(4000) });
      assert.ok([401, 403, 404].includes(meter.status));
      assert.doesNotMatch(await meter.text(), /workspace-a|workspace-b|harness-lab-meter/);
    }
    assert.equal(requests.length, 3);

    await gateway.flush();
    const raw = await readFile(journal, 'utf8');
    for (const value of [...Object.values(grants).map(g => g.token), 'local-provider-fixture-key',
      'first fixture', 'second fixture', 'shared-turn-key', 'client-claim', 'client-operation']) {
      assert.ok(!raw.includes(value), 'unexpected credential or private payload in the journal');
    }
    const events = raw.trimEnd().split('\n').map(line => JSON.parse(line));
    assert.equal(events.length, 6);
    const seenAttempts = new Set();
    for (const grant of [grants.first, grants.second]) {
      const attribution = { workspace_id: grant.workspace_id, operation_id: grant.operation_id,
        source: grant.source };
      const owned = events.filter(e => e.attribution.operation_id === grant.operation_id);
      const attempts = new Set(owned.map(e => e.attempt_id));
      assert.equal(attempts.size, grant === grants.first ? 2 : 1);
      for (const id of attempts) {
        assert.ok(!seenAttempts.has(id));
        seenAttempts.add(id);
        assert.deepEqual(owned.filter(e => e.attempt_id === id).map(e => e.event), ['admitted', 'finished']);
      }
      for (const event of owned) assert.deepEqual(event.attribution, attribution);
    }
    const report = JSON.parse(runPython(['reconcile.py', journal, '--tariffs', 'tariffs.json', '--by-operation']));
    assert.equal(report.status, 'complete');
    assert.equal(report.unique_attempts, 3);
    assert.equal(report.total_usd, '0.00006');
    assert.equal(report.total_rub, '0.0048');
    const attribution = report.attribution;
    assert.equal(attribution.status, 'complete');
    assert.equal(attribution.assigned_attempts, 3);
    assert.equal(attribution.unassigned_attempts, 0);
    assert.equal(attribution.operations.length, 2);
    // Flash tariff: (10 × 0.30 + 5 × 1.20) twice, and (100 × 0.30 + 10 × 1.20), per million.
    for (const [grant, count, usd, rub] of [
      [grants.first, 2, '0.000018', '0.00144'], [grants.second, 1, '0.000042', '0.00336'],
    ]) {
      const group = attribution.operations.find(g => g.operation_id === grant.operation_id);
      assert.ok(group);
      assert.equal(group.workspace_id, grant.workspace_id);
      assert.equal(group.source, grant.source);
      assert.equal(group.unique_attempts, count);
      assert.equal(group.total_usd, usd);
      assert.equal(group.total_rub, rub);
    }
  });

test('revoking paid access invalidates an existing chat grant at the gateway', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'harness-paid-admission-'));
  const database = path.join(dir, 'account.sqlite3');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const token = runPython(['-', database], `
import sys
from platform_core.identity import IdentityStore
from platform_core.operation_grants import issue_grant
path = sys.argv[1]
with IdentityStore(path) as store:
    store.create_account("owner", "Local password for one test")
    scope = store.create_user_chat(store.login("owner", "Local password for one test"))
    store.grant_coins("owner", "10", "test-credit-owner", "Acceptance fixture")
    print(issue_grant(path, scope, source="chat.turn", run_key="one").token)
`).trim();
  const resolver = openOperationResolver(database);
  try {
    assert.equal(resolver.resolve(token).source, 'chat.turn');
    runPython(['-m', 'platform_core.chat_service', '--db', database, 'set-access', 'owner', 'unpaid']);
    assert.equal(resolver.resolve(token), null);
  } finally {
    resolver.close();
  }
});

test('wallet prices cached input, output and peak calendar; recovery replays a receipt exactly once', async t => {
  const { coinBilling, period } = await import('../../../integrations/harness-native-lab/gateway/coin-billing.mjs');
  const { DatabaseSync } = await import('node:sqlite');
  const { writeFile } = await import('node:fs/promises');
  const dir = await mkdtemp(path.join(tmpdir(), 'coin-recovery-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir,'store.sqlite');
  const scopes = prepareGrants(file);
  const db = new DatabaseSync(file);
  t.after(() => db.close());
  const ledger = coinBilling(db);
  const ms = Date.UTC(2026,10,20,5);
  assert.equal(period(ms),'offpeak');
  assert.equal(period(ms + 3600000),'peak');
  assert.equal(period(Date.UTC(2027,9,1,7)),'offpeak');
  const entry = { attempt_id:'test-bill', attribution:scopes.first, model:'deepseek-flash', started_ms:ms, max_tokens:256 };
  assert.equal(ledger.reserve(entry, () => true, 800),true);
  const complete = { ...entry, event:'finished', finished_at:new Date(ms+1000).toISOString(), outcome:'completed',
    status:200, usage:{input_tokens:100, cache_read_input_tokens:1000, output_tokens:30, cache_creation_input_tokens:0} };
  const journal = path.join(dir,'usage.jsonl');
  await writeFile(journal,JSON.stringify(complete)+'\n'+JSON.stringify(complete)+'\n');
  // 100 * 0.15 + 1000 * .003 + 30 * .60 = 36 USD / million. At 80 RUB/USD this is 0.00288 coins.
  const reopened = new DatabaseSync(file);
  try {
    const restored = coinBilling(reopened);
    await restored.recover(journal);
    await restored.recover(journal);
    assert.equal(reopened.prepare('SELECT charge FROM coin_attempts').get().charge, 2880000000);
  } finally { reopened.close(); }
});
