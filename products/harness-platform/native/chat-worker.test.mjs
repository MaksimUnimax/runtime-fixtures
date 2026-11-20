import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { openWorker } from './chat-worker.mjs';

const native = { skip: !process.env.HARNESS_NODE_MODULES && 'requires the pinned native Harness' };

test('scope, event ordering, retry, conflict and replay across two native workers', native, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'platform-session-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const env = { ...process.env, HARNESS_CHAT_DIRECTORY: directory };
  const one = { actorId: 'one', workspaceId: 'w1', chatId: 'a' };
  // Same textual chat key must still select a separate journal under a different owner.
  const two = { actorId: 'two', workspaceId: 'w2', chatId: 'a' };
  const append = (scope, requestId, text) => ({ scope, action: 'append', requestId, text });
  const history = scope => ({ scope, action: 'history' });
  const a = append(one, 'unique1', 'first');
  const b = append(two, 'unique1', 'second');
  const worker = await openWorker(env);
  try {
    await Promise.all([worker.run(a), worker.run(b), worker.run(a)]);
    await assert.rejects(worker.run({ ...a, text: 'changed' }), /conflict/);
    await Promise.all(['2', '3', '4'].map(id => worker.run(append(one, id, id))));
    assert.deepEqual((await worker.run({ ...history(one), limit: 2, offset: 1 })).map(m => m.text), ['2', '3']);
    await assert.rejects(worker.run({ ...history(one), limit: 0 }), /invalid_request/);
  } finally { await worker.close(); }

  const [left, right] = await Promise.all([openWorker(env), openWorker(env)]);
  try {
    assert.deepEqual((await left.run(history(one))).map(m => m.text), ['first', '2', '3', '4']);
    assert.deepEqual(await right.run(history(two)), [{ requestId: 'unique1', text: 'second', role: 'user' }]);
    const page = await left.run({ scope: one, action: 'events', limit: 2 });
    assert.deepEqual(page.messages.map(m => m.text), ['3', '4']);
    assert.deepEqual(page.events.filter(e => e.type === 'user/message').map(e => e.data.content[0].text), ['3', '4']);
    const same = append(one, 'parallel', 'once');
    const result = await Promise.all([left.run(same), right.run(same)]);
    assert.deepEqual(result[0], result[1]);
    assert.equal((await left.run(history(one))).length, 5);
    const older = await right.run({ scope: one, action: 'events', limit: 2, before: page.nextBefore });
    assert.deepEqual(older.messages.map(m => m.text), ['first', '2']);
    assert.equal(older.nextBefore, null);
  } finally { await Promise.all([left.close(), right.close()]); }
});

test('two chats in one host have distinct, live native MCP capabilities', native, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'platform-mcp-host-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const product = fileURLToPath(new URL('../', import.meta.url));
  const python = process.env.HARNESS_TEST_PYTHON ??
    execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
  const database = path.join(directory, 'access.sqlite3');
  const composition = 'examples.reference_plugin';
  const one = { actorId: 'u1', workspaceId: 'w1', chatId: 'a' };
  const two = { actorId: 'u2', workspaceId: 'w2', chatId: 'b' };
  function cli(...args) {
    execFileSync(python, ['-m', 'platform_core', '--db', database, '--composition', composition, ...args],
      { cwd: product, stdio: 'pipe', timeout: 10_000 });
  }
  const args = s => ['--actor', s.actorId, '--workspace', s.workspaceId, '--chat', s.chatId];
  cli('init', ...args(one));
  cli('init', ...args(two));
  cli('grant', '--workspace', one.workspaceId, '--plugin', 'reference-text');
  cli('enable', ...args(one), '--plugin', 'reference-text');
  const worker = await openWorker({ ...process.env, HARNESS_CHAT_DIRECTORY: directory,
    HARNESS_PLATFORM_DATABASE: database, HARNESS_TEST_PYTHON: python, HARNESS_PLATFORM_COMPOSITION: composition });
  const tools = scope => worker.run({ scope, action: 'tools' });
  const call = scope => worker.run({ scope, action: 'call', name: 'summarize_text', arguments: { text: 'a b' } });
  try {
    assert.deepEqual(await Promise.all([tools(one), tools(two)]), [['summarize_text'], []]);
    assert.equal((await call(one)).words, 2);
    await assert.rejects(call(two), /unavailable/);
    cli('revoke', '--workspace', one.workspaceId, '--plugin', 'reference-text');
    assert.deepEqual(await tools(one), []);
    await assert.rejects(call(one), /unavailable/);
  } finally { await worker.close(); }
});
