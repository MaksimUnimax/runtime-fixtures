/* Private JSON-lines worker. Only the authenticated product server supplies scope. */
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mountPlatformMcp } from './platform-mcp.mjs';
import { publicEvents } from './public-events.mjs';

class RequestError extends Error {}
const fail = code => { throw new RequestError(code); };
const prefix = 'mcp__platform__';
const productDirectory = fileURLToPath(new URL('../', import.meta.url));

function scopeKey(scope) {
  const parts = [scope?.actorId, scope?.workspaceId, scope?.chatId];
  if (!parts.every(s => typeof s === 'string' && s.length && s.length <= 256 && !s.includes('\0'))) {
    fail('invalid_request');
  }
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function visible(events, requestId) {
  return events.flatMap(event => {
    let message;
    if (event.type === 'user/message') message = event.data;
    else if (event.type === 'assistant/message') message = event.data.message;
    else return [];
    const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('');
    if (message.role === 'assistant' && !text && message.content.some(block => block.type === 'tool-call')) {
      return [];
    }
    return [{ requestId, role: message.role, text }];
  });
}

export async function openWorker(env) {
  const modules = env.HARNESS_NODE_MODULES;
  const directory = env.HARNESS_CHAT_DIRECTORY;
  if (!path.isAbsolute(modules) || !path.isAbsolute(directory)) throw new Error('Absolute paths required');
  const resolve = createRequire(path.join(modules, '_runtime.cjs')).resolve;
  const { version } = JSON.parse(await readFile(resolve('@deepseek-ai/dsh/package.json'), 'utf8'));
  if (version !== '0.2.2-rc.1') throw new Error('Unsupported Harness version');
  const load = name => import(pathToFileURL(resolve('@deepseek-ai/' + name)).href);
  const { Context } = await load('cordis');
  await mkdir(directory, { mode: 0o700, recursive: true });
  const db = new DatabaseSync(path.join(directory, 'native-chats.sqlite3'));
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS native_batches (
      scope_key TEXT NOT NULL, revision INTEGER NOT NULL, request_id TEXT NOT NULL,
      action TEXT NOT NULL, input TEXT NOT NULL, created_at INTEGER NOT NULL, events TEXT NOT NULL,
      PRIMARY KEY(scope_key, revision), UNIQUE(scope_key, request_id)
    )`);
  const byRequest = db.prepare('SELECT * FROM native_batches WHERE scope_key=? AND request_id=?');
  const all = db.prepare('SELECT * FROM native_batches WHERE scope_key=? ORDER BY revision');
  const recent = db.prepare('SELECT request_id, events FROM native_batches WHERE scope_key=? ORDER BY revision DESC LIMIT ? OFFSET ?');
  const eventPage = db.prepare(`SELECT request_id, revision, events FROM native_batches
    WHERE scope_key=? AND revision < ? ORDER BY revision DESC LIMIT ?`);
  const insert = db.prepare('INSERT INTO native_batches VALUES (?,?,?,?,?,?,?)');
  const active = new Map();
  let count = 0;

  async function mount(ctx, name) {
    const plugin = await load(name);
    const fiber = ctx.plugin(plugin.default ?? plugin, {});
    await fiber.await();
    if (fiber._error) throw fiber._error;
  }

  function previous(key, req) {
    const row = byRequest.get(key, req.requestId);
    if (!row) return undefined;
    if (row.action !== req.action || row.input !== req.text) fail('conflict');
    return visible(JSON.parse(row.events), req.requestId).at(-1);
  }

  async function execute(req, key) {
    if (req.action === 'history' || req.action === 'events') {
      const limit = req.limit ?? 30;
      const offset = req.offset ?? 0;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 ||
          !Number.isSafeInteger(offset) || offset < 0) fail('invalid_request');
      if (req.action === 'events') {
        const before = req.before ?? Number.MAX_SAFE_INTEGER;
        if (!Number.isSafeInteger(before) || before < 0) fail('invalid_request');
        const rows = eventPage.all(key, before, limit + 1);
        const window = rows.slice(0, limit).reverse();
        const events = [], messages = [];
        for (const row of window) {
          const batch = publicEvents(JSON.parse(row.events));
          events.push(...batch);
          messages.push(...visible(batch, row.request_id));
        }
        return { events, messages, nextBefore: rows.length > limit ? window[0].revision : null };
      }
      return recent.all(key, limit, offset).reverse()
        .flatMap(row => visible(JSON.parse(row.events), row.request_id));
    }
    const write = req.action === 'append' || req.action === 'turn';
    if (write) {
      if (typeof req.text !== 'string' || !req.text.trim() || Buffer.byteLength(req.text) > 8192 ||
          typeof req.requestId !== 'string' || !req.requestId.length || req.requestId.length > 128) {
        fail('invalid_request');
      }
      const result = previous(key, req);
      if (result) return result;
      if (req.action === 'turn' && env.HARNESS_OFFLINE_MODEL !== '1') fail('unavailable');
    } else if (req.action !== 'tools' && req.action !== 'call') {
      fail('invalid_request');
    }
    const ctx = new Context();
    try {
      if (req.action !== 'append') {
        await mount(ctx, 'dsh-system-prompt');
        await mount(ctx, 'dsh-tools');
        await mountPlatformMcp(ctx, await load('dsh-mcp-client'), {
          pythonExecutable: env.HARNESS_TEST_PYTHON, productDirectory,
          databasePath: env.HARNESS_PLATFORM_DATABASE,
          compositionModule: env.HARNESS_PLATFORM_COMPOSITION || undefined, scope: req.scope,
        });
      }
      if (req.action === 'tools') {
        return ctx.tools.definitions().map(t => t.name).filter(name => name.startsWith(prefix))
          .map(name => name.slice(prefix.length)).sort();
      }
      if (req.action === 'call') {
        if (typeof req.name !== 'string' || !req.arguments || typeof req.arguments !== 'object' ||
            Array.isArray(req.arguments)) fail('invalid_request');
        const tool = ctx.tools.get(prefix + req.name);
        if (!tool) fail('unavailable');
        try {
          const answer = await tool.execute(req.arguments, { signal: AbortSignal.timeout(10_000) });
          return answer.structuredContent.result;
        } catch (error) {
          if (/unavailable/i.test(error.message)) fail('unavailable');
          if (/schema|invalid.*input/i.test(error.message)) fail('invalid_request');
          throw error;
        }
      }
      // Capture the complete native delta, including the unpublished end-of-seed
      // marker inserted by the native session constructor before its first event.
      await mount(ctx, 'dsh-session');
      const rows = all.all(key);
      const seed = rows.flatMap(row => JSON.parse(row.events));
      const createdAt = rows[0]?.created_at ?? Date.now();
      let events;
      if (req.action === 'append') {
        const session = ctx.sessions.create(key, { seed, meta: { createdAt } });
        const { createUserMessage } = await load('dsh-llm');
        const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: req.text }] });
        session.append('user/message', message, { surfaceOp: 'append' });
        events = session.snapshotEvents(seed.length);
      } else {
        const { runOfflineTurn } = await import('./offline-turn.mjs');
        const turn = await runOfflineTurn({
          load, ctx, chatId: key, seed, text: req.text, requestId: req.requestId,
          toolUnavailable: () => fail('unavailable'),
        });
        events = turn.events.slice(seed.length);
      }
      const messages = visible(events, req.requestId);
      const role = req.action === 'append' ? 'user' : 'assistant';
      if (messages[0]?.role !== 'user' || messages[0]?.text !== req.text || messages.at(-1)?.role !== role) {
        throw new Error('Incomplete native turn');
      }
      // Optimistic revision also detects a second worker serving the same directory.
      try {
        insert.run(key, rows.length, req.requestId, req.action, req.text, createdAt, JSON.stringify(events));
      } catch (error) {
        if (error.errcode !== 1555 && error.errcode !== 2067) throw error;
        return previous(key, req) ?? fail('conflict');
      }
      return messages.at(-1);
    } finally {
      await ctx.fiber.dispose();
    }
  }

  // Preserve request order for one conversation while different chats execute concurrently.
  async function run(req) {
    const key = scopeKey(req?.scope);
    if (count >= 32) fail('busy');
    count++;
    const job = (active.get(key) ?? Promise.resolve()).catch(() => {}).then(() => execute(req, key));
    active.set(key, job);
    try { return await job; }
    finally {
      count--;
      if (active.get(key) === job) active.delete(key);
    }
  }
  return { run, async close() { await Promise.allSettled(active.values()); db.close(); } };
}

async function main() {
  process.umask(0o077);
  const worker = await openWorker(process.env);
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  async function respond(line) {
    let id = null;
    let response;
    try {
      const request = JSON.parse(line);
      id = request.id;
      const result = await worker.run(request);
      response = { id, ok: true, result };
    } catch (error) {
      const code = error instanceof RequestError ? error.message : 'internal';
      response = { id, ok: false, error: code };
    }
    let frame = JSON.stringify(response);
    if (Buffer.byteLength(frame) > 8 * 1024 * 1024 - 1) {
      frame = JSON.stringify({ id, ok: false, error: 'result_too_large' });
    }
    process.stdout.write(frame + '\n');
  }
  const pending = new Set();
  for await (const line of input) {
    const task = respond(line);
    pending.add(task);
    task.finally(() => pending.delete(task));
  }
  await Promise.allSettled(pending);
  await worker.close();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
