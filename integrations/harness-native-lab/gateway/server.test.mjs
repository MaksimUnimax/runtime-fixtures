import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGateway, quoteUsage } from './server.mjs';

const secret = 'test-virtual-key-that-is-not-a-real-credential';
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const stop = server => new Promise(resolve => server.close(resolve));

test('native Messages wire, final SSE accounting, credential isolation and denied replay surfaces', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'harness-gateway-test-'));
  let received = [], dispatches = 0;
  const upstream = http.createServer(async (req, res) => {
    dispatches++;
    const bytes = []; for await (const chunk of req) bytes.push(chunk);
    received.push({ headers: req.headers, body: JSON.parse(Buffer.concat(bytes).toString()) });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('event: message_start\ndata: ' + JSON.stringify({ type: 'message_start', message: { id: 'msg-fixture', model: 'deepseek-flash', usage: { input_tokens: 100, cache_read_input_tokens: 900, output_tokens: 0, cache_creation_input_tokens: 0 } } }) + '\n\n');
    res.write('event: content_block_delta\ndata: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'fixture answer' } }) + '\n\n');
    res.write('event: message_delta\ndata: ' + JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 100, cache_read_input_tokens: 900, output_tokens: 20, cache_creation_input_tokens: 0 } }) + '\n\n');
    res.end('event: message_stop\ndata: {"type":"message_stop"}\n\n');
  });
  const upstreamPort = await listen(upstream);
  const app = createGateway({ realKey: 'unit-test-upstream-key', virtualKey: secret, upstreamBase: `http://127.0.0.1:${upstreamPort}/anthropic`, logFile: join(dir, 'usage.jsonl'), userId: 'opaque-owner-test', fx: 80 });
  const port = await listen(app.server);
  try {
    const requestBody = { model: 'deepseek-flash', max_tokens: 512, stream: true, thinking: { type: 'disabled' },
      system: [{ type: 'text', text: 'Synthetic native prompt' }],
      messages: [
        { role: 'user', content: 'Unit test only' },
        { role: 'assistant', content: [{ type: 'thinking', thinking: 'synthetic reasoning', signature: 'fixture-signature' },
          { type: 'tool_use', id: 'call-fixture', name: 'read_report', input: { kind: 'synthetic' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-fixture', content: [{ type: 'text', text: 'Synthetic report' }] }] },
      ], tools: [{ name: 'read_report', input_schema: { type: 'object' } }], metadata: { user_id: 'untrusted-client' } };
    const denied = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'wrong' }, body: JSON.stringify(requestBody) });
    assert.equal(denied.status, 401); assert.equal(dispatches, 0); await denied.text();
    const response = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': secret, 'x-deepseek-harness-session-id': 'test-session-1' }, body: JSON.stringify(requestBody) });
    assert.equal(response.status, 200); assert.match(await response.text(), /fixture answer/);
    await app.flush();
    assert.equal(dispatches, 1);
    assert.equal(received[0].headers['x-api-key'], 'unit-test-upstream-key');
    assert.equal(received[0].body.metadata.user_id, 'opaque-owner-test');
    assert.deepEqual(received[0].body.messages, requestBody.messages);
    assert.deepEqual(received[0].body.thinking, requestBody.thinking);
    const rows = (await readFile(join(dir, 'usage.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(rows.length, 2); const done = rows[1];
    assert.equal(done.session_id, 'test-session-1');
    assert.deepEqual(done.usage, { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 });
    assert.equal(done.quote.usd_peak_estimate, (100 * 0.30 + 900 * 0.006 + 20 * 1.20) / 1e6);
    assert.ok(!JSON.stringify(rows).includes('Unit test only'));
    assert.ok(!JSON.stringify(rows).includes('upstream-key'));
    for (const path of ['/v1/files', '/internal/config']) {
      const r = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'x-api-key': secret } });
      assert.equal(r.status, 404); await r.text();
    }
    assert.equal(dispatches, 1);
  } finally { await stop(app.server); await stop(upstream); await rm(dir, { recursive: true, force: true }); }
});

test('unknown usage is never recorded as a free completed call', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'harness-gateway-unknown-'));
  const upstream = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end('data: {"type":"message_start","message":{"id":"partial","usage":{"input_tokens":500}}}\n\n'); });
  const p = await listen(upstream);
  const app = createGateway({ realKey: 'test', virtualKey: secret, upstreamBase: `http://127.0.0.1:${p}/anthropic`, logFile: join(dir, 'usage.jsonl') });
  const port = await listen(app.server);
  try {
    const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: 'POST', headers: { 'x-api-key': secret }, body: JSON.stringify({ model: 'deepseek-flash', max_tokens: 512, messages: [{ role: 'user', content: 'Synthetic test' }] }) });
    await r.text(); await app.flush();
    const rows = (await readFile(join(dir, 'usage.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(rows[1].outcome, 'usage_unknown'); assert.equal(rows[1].usage, null); assert.equal(rows[1].quote, null);
    assert.equal(quoteUsage('deepseek-flash', null), null);
  } finally { await stop(app.server); await stop(upstream); await rm(dir, { recursive: true, force: true }); }
});

test('body reads cannot race the atomic upstream concurrency allowance', { timeout: 5000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'harness-gateway-concurrency-'));
  let dispatched = 0;
  const upstream = http.createServer((req, res) => {
    dispatched++;
    req.resume();
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'message', id: 'fixture', model: 'deepseek-flash', stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }));
    }, 100);
  });
  const upstreamPort = await listen(upstream);
  const app = createGateway({ realKey: 'synthetic', virtualKey: secret, maxConcurrent: 1,
    upstreamBase: `http://127.0.0.1:${upstreamPort}/anthropic`, logFile: join(dir, 'usage.jsonl') });
  const port = await listen(app.server);
  const body = JSON.stringify({ model: 'deepseek-flash', max_tokens: 8, messages: [{ role: 'user', content: 'Synthetic' }] });
  let headers = 0, ready;
  const bothHeaders = new Promise(resolve => { ready = resolve; });
  app.server.on('request', req => { if (req.url === '/v1/messages' && ++headers === 2) ready(); });
  const clients = [];
  const pending = [0, 1].map(() => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: '/v1/messages', method: 'POST',
      headers: { 'x-api-key': secret, 'content-length': Buffer.byteLength(body), 'content-type': 'application/json' } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject); clients.push(req); req.flushHeaders();
  }));
  try {
    // Both handlers have received headers and are waiting on their bodies.
    await bothHeaders;
    for (const req of clients) req.end(body);
    assert.deepEqual((await Promise.all(pending)).sort(), [200, 429]);
    assert.equal(dispatched, 1);
    await app.flush();
    const rows = (await readFile(join(dir, 'usage.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(rows.filter(row => row.event === 'admitted').length, 1);
  } finally {
    for (const req of clients) req.destroy();
    await stop(app.server); await stop(upstream); await rm(dir, { recursive: true, force: true });
  }
});

test('all server-tool aliases and non-text payload paths are denied before upstream I/O', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'harness-gateway-text-only-'));
  let dispatched = 0;
  const upstream = http.createServer((req, res) => { dispatched++; req.resume(); res.end('{}'); });
  const upstreamPort = await listen(upstream);
  const app = createGateway({ realKey: 'synthetic', virtualKey: secret,
    upstreamBase: `http://127.0.0.1:${upstreamPort}/anthropic`, logFile: join(dir, 'usage.jsonl') });
  const port = await listen(app.server);
  const base = { model: 'deepseek-flash', max_tokens: 8, messages: [{ role: 'user', content: 'Synthetic' }] };
  const badTools = ['web_search_20250305', 'web_search_20260209', 'deepseek_web_search', 'deepseek_read_url', 'custom']
    .map(type => ({ ...base, tools: [{ type, name: 'search', input_schema: { type: 'object' } }] }));
  const badBlocks = ['image', 'document', 'file'].map(type => ({ ...base,
    messages: [{ role: 'user', content: [{ type, source: { type: 'base64', data: 'c3ludGhldGlj' } }] }] }));
  const bad = [...badTools, ...badBlocks,
    { ...base, messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'fixture', content: [{ type: 'image', source: { type: 'url', url: 'https://invalid.example/fixture' } }] }] }] },
    { ...base, system: [{ type: 'document', source: { type: 'text', data: 'Synthetic' } }] },
    { ...base, title: { enabled: true } }, { ...base, safety_check: { level: 'high' } },
  ];
  try {
    for (const body of bad) {
      const res = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: 'POST',
        headers: { 'x-api-key': secret, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal(res.status, 400); await res.text();
    }
    assert.equal(dispatched, 0);
  } finally { await stop(app.server); await stop(upstream); await rm(dir, { recursive: true, force: true }); }
});

test('partial, nonterminal and malformed SSE usage never becomes a completed quote', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'harness-gateway-partial-'));
  const start = { type: 'message_start', message: { id: 'synthetic', model: 'deepseek-flash',
    usage: { input_tokens: 50, output_tokens: 0, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 } } };
  const terminal = { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 7 } };
  const scenarios = [
    [start, { type: 'message_delta', delta: {}, usage: { output_tokens: 4 } }],
    [start, terminal],
    [start, { type: 'message_stop' }],
    [start, { ...terminal, usage: { output_tokens: 7, cache_read_input_tokens: -1 } }, { type: 'message_stop' }],
    [start, terminal, { type: 'error', error: { type: 'api_error' } }, { type: 'message_stop' }],
  ];
  let index = 0;
  const upstream = http.createServer((req, res) => {
    req.resume(); res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const frame of scenarios[index++]) res.write(`data: ${JSON.stringify(frame)}\n\n`);
    res.end();
  });
  const upstreamPort = await listen(upstream);
  const app = createGateway({ realKey: 'synthetic', virtualKey: secret,
    upstreamBase: `http://127.0.0.1:${upstreamPort}/anthropic`, logFile: join(dir, 'usage.jsonl') });
  const port = await listen(app.server);
  try {
    for (const _ of scenarios) {
      const response = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: 'POST', headers: { 'x-api-key': secret },
        body: JSON.stringify({ model: 'deepseek-flash', max_tokens: 8, stream: true, messages: [{ role: 'user', content: 'Synthetic' }] }) });
      await response.text();
    }
    await app.flush();
    const rows = (await readFile(join(dir, 'usage.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse).filter(row => row.event === 'finished');
    assert.equal(rows.length, scenarios.length);
    for (const row of rows) {
      assert.notEqual(row.outcome, 'completed');
      assert.equal(row.usage, null); assert.equal(row.quote, null); assert.ok(row.partial_usage);
    }
    assert.equal(index, scenarios.length, 'one upstream dispatch per explicit call, no automatic retries');
  } finally { await stop(app.server); await stop(upstream); await rm(dir, { recursive: true, force: true }); }
});
