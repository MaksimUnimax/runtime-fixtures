// Full repository checkout, Node 22+ and Python 3. No credentials or network
// access beyond loopback: node --test products/harness-platform/usage-reconciliation/test_gateway.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createGateway } from '../../../integrations/harness-native-lab/gateway/server.mjs';

const component = fileURLToPath(new URL('.', import.meta.url));

async function listenLoopback(server) {
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  return `http://127.0.0.1:${server.address().port}`;
}

async function closeServer(server) {
  if (!server.listening) return;
  const closed = once(server, 'close');
  server.close();
  server.closeAllConnections();
  await closed;
}

test('native gateway receipt reconciles once after a duplicate terminal line', { timeout: 15000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'harness-gateway-reconcile-'));
  const journal = path.join(directory, 'attempts.jsonl');
  let requests = 0;
  const usage = {
    input_tokens: 101, cache_read_input_tokens: 19,
    cache_creation_input_tokens: 0, output_tokens: 7,
  };
  const upstream = http.createServer((req, res) => {
    requests++;
    req.resume();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'fixture-response', type: 'message', model: 'deepseek-flash',
      stop_reason: 'end_turn', content: [{ type: 'text', text: 'fixture reply' }], usage,
    }));
  });
  let gateway;
  try {
    const upstreamBase = await listenLoopback(upstream);
    gateway = createGateway({
      logFile: journal, virtualKey: 'fixture-client', realKey: 'fixture-upstream',
      userId: 'fixture-owner', upstreamBase, fx: 80, timeoutMs: 3000,
    });
    const address = await listenLoopback(gateway.server);
    const response = await fetch(`${address}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'fixture-client' },
      body: JSON.stringify({
        model: 'deepseek-flash', max_tokens: 15,
        messages: [{ role: 'user', content: 'fixture prompt' }],
      }),
      signal: AbortSignal.timeout(4000),
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).usage, usage);
    await gateway.flush();
    const journalLines = (await readFile(journal, 'utf8')).trimEnd().split('\n');
    assert.equal(journalLines.length, 2);
    const [admitted, finished] = journalLines.map(line => JSON.parse(line));
    assert.equal(admitted.schema, 'harness-lab-model-attempt/v1');
    assert.equal(admitted.event, 'admitted');
    assert.equal(finished.event, 'finished');
    assert.equal(finished.attempt_id, admitted.attempt_id);
    assert.equal(finished.outcome, 'completed');
    assert.equal(finished.status, 200);
    assert.deepEqual(finished.usage, usage);
    assert.equal(finished.quote.fx_rub_per_usd, 80);
    assert.equal(requests, 1);

    const run = () => JSON.parse(execFileSync(process.env.PYTHON || 'python3',
      ['reconcile.py', journal, '--tariffs', 'tariffs.json'],
      { cwd: component, encoding: 'utf8', timeout: 4000 }));
    const first = run();
    await appendFile(journal, journalLines[1] + '\n');
    const second = run();
    for (const report of [first, second]) {
      assert.equal(report.status, 'complete');
      assert.equal(report.unique_attempts, 1);
      // Verified by hand from the fixture, independent of the gateway's float quote:
      // (101 × 0.30 + 19 × 0.006 + 7 × 1.20) / 1M, then multiply by 80.
      assert.equal(report.known_usd, '0.000038814');
      assert.equal(report.known_rub, '0.00310512');
      assert.equal(report.total_usd, report.known_usd);
      assert.equal(report.total_rub, report.known_rub);
    }
    assert.equal(first.duplicate_events, 0);
    assert.equal(second.duplicate_events, 1);
    assert.equal(requests, 1);
  } finally {
    try {
      if (gateway) await closeServer(gateway.server);
      await closeServer(upstream);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});
