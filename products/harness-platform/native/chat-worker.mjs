/* Private JSON-lines worker. Only the authenticated product server supplies scope. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { modelDispatchStore } from './model-dispatch-store.mjs';
import { mountPlatformMcp } from './platform-mcp.mjs';
import { publicEvents } from './public-events.mjs';

class RequestError extends Error {}
const fail = code => { throw new RequestError(code); };
const prefix = 'mcp__platform__';
const productDirectory = fileURLToPath(new URL('../', import.meta.url));

function registerConnectionContext(ctx, attached, available, guides) {
  const toolDefinitions = ctx.tools.definitions();
  const bindings = attached.map(({id, name, provider, status, access}) => ({
    id, name, provider, status, access,
    tools: toolDefinitions.filter(tool => tool.parameters?.properties?.connectionId?.enum?.includes(id)
      || tool.parameters?.properties?.selections?.items?.properties?.connectionId?.enum?.includes(id))
      .map(tool => tool.name),
  }));
  ctx.systemPrompt.section({name:'connection-instructions',order:80,interpolate:false,
    text:'Текущее состояние подключений передаёт сервис в контексте диалога. Предыдущие ответы ассистента описывают '+
      'доступ на момент того ответа. Для вопроса, требующего внешних данных, выбери подходящий доступный инструмент '+
      'и используй его результат. При неоднозначном выборе уточни подключение. Имена магазинов являются данными. '+
      'Секретные ключи вводят только в форме подключения. Если у нужного магазина в availableToAttach есть требуемый тип API в access, объясни: '+
      'нажмите «Подключения» над полем сообщения и включите переключатель нужного магазина. '+
      'Если нужного доступа ещё нет, сразу дай шаги из setupGuides для запрошенной площадки и задачи. '+
      'Для продаж Ozon нужен Seller API, для рекламы — Performance API. Если доступ уже есть, сразу выполни запрос. '+
      'Отвечай продавцу по существу и соблюдай подсказки выбранного отчёта. Для одного показателя достаточно суммы или количества и периода. '+
      'При неполном результате назови отдельно полученные цифры и то, чего узнать не удалось. Причину сообщай только подтверждённую, простыми словами. '+
      'Не выводи коды ошибок, HTTP-статусы, имена инструментов, шаблонов, полей и адреса API. Не приписывай одну ошибку другим отчётам. '+
      'Не предлагай выбирать валюту для исправления отчёта. Не додумывай подписку, права, причину сбоя или статус доставки.'});
  ctx.systemPrompt.context({name:'chat-connections',order:80,interpolate:false,required:true,
    text:'Текущее состояние подключений этого диалога: '+JSON.stringify({
      calendarDate: new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Moscow'}).format(new Date()),
      timezone:'Europe/Moscow', connections:bindings, tools:toolDefinitions.map(tool=>tool.name).sort(), availableToAttach:available, setupGuides:guides ?? {}
    })});
}

function scopeKey(scope) {
  const parts = [scope?.actorId, scope?.workspaceId, scope?.chatId];
  if (!parts.every(s => typeof s === 'string' && s.length && s.length <= 256 && !s.includes('\0'))) {
    fail('invalid_request');
  }
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function visible(events, requestId, operationId) {
  const messages = events.flatMap(event => {
    let message;
    if (event.type === 'user/message' && event.data.source?.kind !== 'runtime-context') message = event.data;
    else if (event.type === 'assistant/message') message = event.data.message;
    else return [];
    const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('');
    if (message.role === 'assistant' && !text && message.content.some(block => block.type === 'tool-call')) {
      return [];
    }
    return [{ requestId, role: message.role, text }];
  });
  const last = messages.at(-1);
  if (operationId && last?.role === 'assistant') last.operationId = operationId;
  return messages;
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
  const journalFile = path.join(directory, 'native-chats.sqlite3');
  const db = new DatabaseSync(journalFile);
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS deleted_chat_scopes (scope_key TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS native_batches (
      scope_key TEXT NOT NULL, revision INTEGER NOT NULL, request_id TEXT NOT NULL,
      action TEXT NOT NULL, input TEXT NOT NULL, created_at INTEGER NOT NULL, events TEXT NOT NULL,
      PRIMARY KEY(scope_key, revision), UNIQUE(scope_key, request_id)
    );
    CREATE INDEX IF NOT EXISTS native_activity_by_scope
      ON native_batches(scope_key, revision DESC, json_extract(events,'$[#-1].time'));
  `);
  const platform = env.HARNESS_MODEL_GATEWAY_URL ? new DatabaseSync(env.HARNESS_PLATFORM_DATABASE, { readOnly: true }) : null;
  platform?.exec('PRAGMA busy_timeout=5000');
  const budget = platform?.prepare(`SELECT budget_hit, EXISTS(SELECT 1 FROM coin_attempts a
      WHERE a.operation_id=o.operation_id) AS used FROM coin_orders o WHERE operation_id=?`);
  const retryWindow = platform?.prepare(
    'SELECT deadline_ms, retry_at_ms FROM marketplace_retry_windows WHERE token_hash=?');
  const firstBatches = db.prepare(`SELECT request_id, action, input FROM native_batches
    WHERE scope_key=? ORDER BY revision LIMIT ?`);
  const byRequest = db.prepare('SELECT * FROM native_batches WHERE scope_key=? AND request_id=?');
  const all = db.prepare('SELECT * FROM native_batches WHERE scope_key=? ORDER BY revision');
  const insert = db.prepare('INSERT INTO native_batches VALUES (?,?,?,?,?,?,?)');
  const waitTable = platform?.prepare("SELECT 1 FROM sqlite_master WHERE name='openrouter_waits'");
  function checkParked(req) {
    if (!waitTable?.get()) {
      if (req.restore) fail('unavailable');
      return;
    }
    const {actorId,workspaceId,chatId}=req.scope;
    const row=platform.prepare(`SELECT w.attempt,w.resume_owner,o.operation_id FROM openrouter_waits w
      JOIN coin_attempts a ON a.attempt_id=w.attempt JOIN usage_operations o USING(operation_id)
      WHERE o.actor_id=? AND o.workspace_id=? AND o.chat_id=? LIMIT 1`).get(actorId,workspaceId,chatId);
    if (req.restore) {
      if (!row || row.attempt!==req.restore.attempt || row.operation_id!==req.grant?.operationId
          || row.resume_owner!==createHash('sha256').update(req.grant.token).digest('hex')) fail('busy');
    } else if (row) fail('chat_busy');
  }
  const dispatch = modelDispatchStore(db, fail, checkParked);
  const recent = db.prepare(`SELECT b.request_id, b.events, d.operation_id FROM native_batches b
    LEFT JOIN native_model_dispatch d USING (scope_key, request_id)
    WHERE b.scope_key=? ORDER BY b.revision DESC LIMIT ? OFFSET ?`);
  const eventPage = db.prepare(`SELECT b.request_id, b.revision, b.events, d.operation_id FROM native_batches b
    LEFT JOIN native_model_dispatch d USING (scope_key, request_id)
    WHERE b.scope_key=? AND b.revision < ? ORDER BY b.revision DESC LIMIT ?`);
  const deleted = db.prepare('SELECT 1 FROM deleted_chat_scopes WHERE scope_key=?');
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
    return visible(JSON.parse(row.events), req.requestId, dispatch.operationId(key, req.requestId)).at(-1);
  }

  // SQLite commits the complete immutable prefix or none of it. A second worker
  // can race the first import, so check again after acquiring the writer lock.
  async function adoptGuestHistory(key, history) {
    function alreadyImported() {
      const rows = firstBatches.all(key, history.length);
      if (!rows.length) return false;
      if (rows.length !== history.length || rows.some((row, i) => row.action !== 'guest' ||
          row.request_id !== history[i].requestId || row.input !== history[i].text)) {
        throw new Error('Inconsistent guest history');
      }
      return true;
    }
    if (alreadyImported()) return;
    const ctx = new Context();
    try {
      await mount(ctx, 'dsh-session');
      const { createUserMessage, createAssistantMessage } = await load('dsh-llm');
      const createdAt = history[0].at;
      const session = ctx.sessions.create(key, { meta: { createdAt } });
      let offset = 0;
      const batches = history.map(({ text, answer, at }, index) => {
        const turn = index + 1;
        const step = { turn, step: 1 };
        session.append('turn/start', { turn });
        session.append('step/start', step);
        session.append('user/message', createUserMessage({
          source: { kind: 'user' }, content: [{ type: 'text', text }],
        }), { surfaceOp: 'append' });
        const message = createAssistantMessage({
          source: { provider: 'harness-local', model: 'published-help' },
          content: [{ type: 'text', text: answer }],
        });
        session.append('assistant/message', { ...step, message, stream: [] }, { surfaceOp: 'append' });
        session.append('step/end', step);
        session.append('turn/end', { turn, reason: { kind: 'completed' } });
        const events = session.snapshotEvents(offset).map(event => ({ ...event, time: at }));
        offset += events.length;
        return JSON.stringify(events);
      });
      db.exec('BEGIN IMMEDIATE');
      try {
        if (deleted.get(key)) fail('unavailable');
        if (!alreadyImported()) {
          history.forEach(({ requestId, text }, i) =>
            insert.run(key, i, requestId, 'guest', text, createdAt, batches[i]));
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    } finally {
      await ctx.fiber.dispose();
    }
  }

  function deleteChat(scope, key) {
    // Delete ownership, grants and both copies of the transcript in one SQLite transaction.
    // Keep account-wide integrations and the wallet ledger, including unsettled charges.
    const writer = new DatabaseSync(journalFile);
    try {
      writer.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON');
      writer.prepare('ATTACH DATABASE ? AS account').run(env.HARNESS_PLATFORM_DATABASE);
      writer.exec('BEGIN IMMEDIATE');
      const {workspaceId, actorId, chatId} = scope;
      const removed = writer.prepare(`DELETE FROM account.chats WHERE chat_id=? AND workspace_id=?
        AND EXISTS(SELECT 1 FROM account.workspaces WHERE workspace_id=? AND owner_id=?)`)
        .run(chatId, workspaceId, workspaceId, actorId);
      if (!removed.changes) fail('unavailable');
      if (writer.prepare('SELECT 1 FROM native_model_dispatch WHERE scope_key=? AND active_until>?').get(key, Date.now()))
        fail('chat_busy');
      writer.prepare('DELETE FROM account.guest_chats WHERE chat_id=? AND claimed_actor=?').run(chatId,actorId);
      writer.prepare('INSERT INTO deleted_chat_scopes VALUES (?)').run(key);
      writer.prepare('DELETE FROM native_batches WHERE scope_key=?').run(key);
      writer.exec('COMMIT');
      return {deleted:true};
    } finally { writer.close(); } // Closing rolls back any unfinished transaction.
  }

  async function execute(req, key) {
    if (deleted.get(key)) fail('unavailable');
    if (req.action === 'deleteChat') return deleteChat(req.scope,key);
    if (req.claimedGuest && firstBatches.get(key, 1)?.action !== 'guest') {
      // The guest handler never starts this worker. Only an authenticated chat
      // can import its frozen FAQ transcript. An atomic import also covers restarts.
      const source = new DatabaseSync(env.HARNESS_PLATFORM_DATABASE, { readOnly: true });
      let history;
      try {
        const { actorId, workspaceId, chatId } = req.scope;
        history = source.prepare(`SELECT t.request_id AS requestId, t.text, t.answer, t.at_ms AS at
          FROM guest_turns t JOIN guest_chats g USING (chat_id)
          JOIN identity_accounts a ON a.actor_id=g.claimed_actor
          WHERE a.actor_id=? AND a.workspace_id=? AND g.chat_id=? ORDER BY t.rowid`)
          .all(actorId, workspaceId, chatId);
      } finally { source.close(); }
      if (!history.length) fail('unavailable');
      await adoptGuestHistory(key, history);
    }
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
          messages.push(...visible(batch, row.request_id, row.operation_id));
        }
        return { events, messages, nextBefore: rows.length > limit ? window[0].revision : null };
      }
      return recent.all(key, limit, offset).reverse()
        .flatMap(row => visible(JSON.parse(row.events), row.request_id, row.operation_id));
    }
    const metered = req.action === 'turn' && Boolean(env.HARNESS_MODEL_GATEWAY_URL);
    const write = req.action === 'append' || req.action === 'turn';
    if (write) {
      if (typeof req.text !== 'string' || !req.text.trim() || Buffer.byteLength(req.text) > 8192 ||
          typeof req.requestId !== 'string' || !req.requestId.length || req.requestId.length > 128) {
        fail('invalid_request');
      }
      const result = dispatch.atomic(() => {
        const cached = previous(key, req);
        if (!cached) dispatch.check(key, req);
        return cached;
      });
      if (result) return result;
      if (metered) {
        if (req.replayOnly === true) fail('payment_required');
        if (!Number.isSafeInteger(req.deadline) || !/^[A-Za-z0-9_-]{43}$/.test(req.grant?.token ?? '') ||
            !/^[a-f0-9]{32}$/.test(req.grant?.operationId ?? '')) fail('invalid_request');
      } else if (req.action === 'turn' && env.HARNESS_OFFLINE_MODEL !== '1') fail('unavailable');
    } else if (req.action !== 'tools' && req.action !== 'call') {
      fail('invalid_request');
    }
    if(req.action==='turn')req.progress?.({stage:'accepted'});
    const ctx = new Context();
    let reserved = false;
    let transportStarted = false;
    let waitCancelled = false;
    let providerRefusal;
    let checkpointContext;
    let seedLength;
    let timer;
    let deadline = req.deadline;
    try {
      if (req.action !== 'append') {
        await mount(ctx, 'dsh-system-prompt');
        await mount(ctx, 'dsh-tools');
        const attached=req.connections||[], available=req.availableServices||[];
        if(attached.length || env.HARNESS_PLATFORM_COMPOSITION) await mountPlatformMcp(ctx, await load('dsh-mcp-client'), {
          pythonExecutable: env.HARNESS_TEST_PYTHON, productDirectory,
          integrationKeyFile:env.HARNESS_INTEGRATIONS_KEY_FILE, databasePath: env.HARNESS_PLATFORM_DATABASE,
          compositionModule: env.HARNESS_PLATFORM_COMPOSITION || undefined, scope: req.scope,
          marketplaceTurn: metered && req.grant ? {
            question: req.text, requestId: req.requestId, deadline: req.deadline,
            token: req.grant.token, resumeRateLimits: attached.some(connection => ['ozon', 'wb'].includes(connection.provider)),
          } : undefined,
        });
        if(req.illustrations && req.grant && env.HARNESS_ROUTER_LOCAL){
          const {defineTool}=await load('dsh-tools');
          ctx.tools.register(defineTool({
            name:'create_illustration', description:'Создай иллюстрацию по описанию пользователя. Изображение будет прикреплено к сообщению автоматически.',
            parameters:{prompt:{type:'string',required:true,description:'Описание требуемой иллюстрации'}},
            output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
            timeoutMs:2147483647,
            async execute({prompt},exec){
              const response=await fetch(env.HARNESS_ROUTER_LOCAL+'/illustrate',{method:'POST',signal:exec.signal,
                headers:{'Content-Type':'application/json','x-operation':req.grant.token},
                body:JSON.stringify({prompt,...(exec.agent && checkpointContext ? {checkpoint:{
                  ...checkpointContext, events:exec.agent.session.snapshotEvents(seedLength),
                  priorCalls:exec.agent.session.snapshotEvents(seedLength).filter(e=>e.type==='assistant/message').length
                },callId:exec.callId} : {})})});
              if(!response.ok)return 'Не удалось создать изображение. '+(await response.text()).slice(0,250);
              await response.json();
              return 'Изображение готово и прикреплено к ответу в этом чате.';
            }
          }));
        }
        registerConnectionContext(ctx,attached,available,req.connectionGuides);
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
      if (metered) {
        const cached = dispatch.atomic(() => {
          const answer = previous(key, req);
          if (answer) return answer;
          dispatch.reserve(key, req);
          reserved = true;
        });
        if (cached) return cached;
      }
      const rows = all.all(key);
      const seed = rows.flatMap(row => JSON.parse(row.events));
      seedLength=seed.length;
      checkpointContext={baseRevision:rows.length,text:req.text,connections:req.connections||[],
        illustrations:!!req.illustrations,availableServices:req.availableServices||[],connectionGuides:req.connectionGuides||{}};
      if(req.restore && req.restore.baseRevision!==rows.length) fail('conflict');
      const createdAt = rows[0]?.created_at ?? Date.now();
      let events;
      if (req.action === 'append') {
        const session = ctx.sessions.create(key, { seed, meta: { createdAt } });
        const { createUserMessage } = await load('dsh-llm');
        const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: req.text }] });
        session.append('user/message', message, { surfaceOp: 'append' });
        events = session.snapshotEvents(seed.length);
      } else {
        const input = { load, ctx, chatId: key, seed, progress:req.grant?.model ? undefined : req.progress, text: req.text, requestId: req.requestId };
        let turn;
        if (metered) {
          const runGatewayTurn = req.grant.model ? (await import('./openrouter-turn.mjs')).runRouterTurn
            : (await import('./gateway-turn.mjs')).runGatewayTurn;
          const controller = new AbortController();
          const followsMarketplace = req.illustrations || !!req.grant.model || req.connections?.some(connection => ['ozon', 'wb'].includes(connection.provider));
          const grantHash = createHash('sha256').update(req.grant.token).digest('hex');
          let waitUntil = 0;
          let dispatchLease = deadline;
          const watchDeadline = () => {
            const now = Date.now();
            try {
              const retry = followsMarketplace && retryWindow.get(grantHash);
              if (retry && retry.deadline_ms > deadline) {
                deadline = retry.deadline_ms;
                waitUntil = retry.retry_at_ms;
                req.progress?.({ stage: waitUntil ? 'marketplace_wait' : 'tool', deadline, retryAt: waitUntil });
              }
              if (deadline > dispatchLease && now >= dispatchLease - 60_000) {
                const lease = Math.min(deadline, now + 120_000);
                dispatch.extend(key, req, lease);
                dispatchLease = lease;
              }
            } catch (error) {
              if (error.errcode !== 5) {
                controller.abort(error);
                return;
              }
            }
            if (waitUntil && now >= waitUntil) {
              waitUntil = 0;
              req.progress?.({ stage: 'tool' });
            }
            if (now >= deadline) controller.abort();
            else timer = setTimeout(watchDeadline, Math.min(deadline - now, followsMarketplace ? 500 : 120_000));
          };
          watchDeadline();
          if (req.restore?.imageCall) {
            transportStarted=true;
            const response=await fetch(env.HARNESS_ROUTER_LOCAL+'/illustrate',{method:'POST',signal:controller.signal,
              headers:{'Content-Type':'application/json','x-operation':req.grant.token},
              body:JSON.stringify({resumeAttempt:req.restore.attempt,checkpoint:checkpointContext})});
            if (!response.ok) fail('turn_unconfirmed');
            await response.json();
            const events=req.restore.events;
            const assistant=events.findLast(e=>e.type==='assistant/message');
            const calls=assistant?.data.message.content.filter(block=>block.type==='tool-call') || [];
            const current=calls.find(call=>call.id===req.restore.imageCall && call.name==='create_illustration');
            if (!current) fail('turn_unconfirmed');
            const call=events.findLast(e=>e.type==='tool/call' && e.data.callId===current.id);
            const step=call?.data || assistant.data;
            const last=events.at(-1);
            const ready='Изображение готово и прикреплено к ответу в этом чате.';
            const toolMessage={role:'tool',source:{kind:'tool',callId:current.id},toolCallId:current.id,
              content:[{type:'text',text:ready}],isError:false,id:randomUUID()};
            events.push({type:'tool/result',seq:last.seq+1,time:Date.now(),surfaceOp:'append',
              ...(call?{sourceEventSeqs:[call.seq]}:{}),data:{turn:step.turn,step:step.step,message:toolMessage}});
            const completed=new Set(events.filter(e=>e.type==='tool/result' && e.seq>assistant.seq).map(e=>e.data.message.toolCallId));
            if (calls.some(item=>!completed.has(item.id))) {
              // Other parallel tools may already have had side effects. Never replay them.
              fail('turn_unconfirmed');
            }
          }
          turn = await runGatewayTurn({ ...input, grant: req.grant,
            restore:req.restore,
            checkpointContext:req.grant.model ? checkpointContext : undefined,
            onTransport: () => { transportStarted = true; },
            onWaitCancelled: () => { waitCancelled = true; },
            onProviderRefusal: reason => { providerRefusal = reason; },
            gatewayUrl: req.grant.model ? env.HARNESS_ROUTER_LOCAL : env.HARNESS_MODEL_GATEWAY_URL,
            model: req.grant.model || req.grant.directModel || env.HARNESS_CHAT_MODEL,
            reasoningEffort: req.grant.model ? undefined : req.grant.effort,
            signal: controller.signal });
        } else {
          const { runOfflineTurn } = await import('./offline-turn.mjs');
          turn = await runOfflineTurn({ ...input, toolUnavailable: () => fail('unavailable') });
        }
        events = turn.events.slice(seed.length);
      }
      const messages = visible(events, req.requestId);
      const role = req.action === 'append' ? 'user' : 'assistant';
      if (messages[0]?.role !== 'user' || messages[0]?.text !== req.text || messages.at(-1)?.role !== role) {
        throw new Error('Incomplete native turn');
      }
      const answer = dispatch.atomic(() => {
        if (deleted.get(key)) fail('unavailable');
        const cached = previous(key, req);
        if (cached) return cached;
        if (metered && (deadline <= Date.now() || !dispatch.owns(key,req))) fail('turn_unconfirmed');
        if (!metered) dispatch.check(key, req);
        try {
          insert.run(key, rows.length, req.requestId, req.action, req.text, createdAt, JSON.stringify(events));
        } catch (error) {
          if (error.errcode === 1555 || error.errcode === 2067) fail('conflict');
          throw error;
        }
        if (metered) dispatch.release(key, req);
        return metered ? { ...messages.at(-1), operationId: req.grant.operationId } : messages.at(-1);
      });
      reserved = false;
      return answer;
    } catch (error) {
      if (waitCancelled) fail('model_wait_cancelled');
      if (providerRefusal) fail(providerRefusal);
      if (transportStarted && !(error instanceof RequestError)) {
        const billing = budget.get(req.grant.operationId);
        if (billing?.budget_hit) {
          // A rejected first leg can safely retry with the same request key after funding.
          transportStarted = Boolean(billing.used);
          fail('payment_required');
        }
        fail('turn_unconfirmed');
      }
      throw error;
    } finally {
      clearTimeout(timer);
      try {
        if (reserved) {
          if (waitCancelled) dispatch.cancel(key, req);
          else if (transportStarted) dispatch.release(key, req);
          else dispatch.discard(key, req);
        }
      } finally {
        await ctx.fiber.dispose();
      }
    }
  }

  // Preserve request order for one conversation while different chats execute concurrently.
  async function run(req) {
    const key = scopeKey(req?.scope);
    if (req.action === 'deleteChat' && active.has(key)) fail('chat_busy');
    if (count >= 32) fail('busy');
    count++;
    if (['events','history'].includes(req.action) && (!req.claimedGuest || firstBatches.get(key,1)?.action==='guest')) {
      try { return await execute(req,key); } finally { count--; }
    }
    const job = (active.get(key) ?? Promise.resolve()).catch(() => {}).then(() => execute(req, key));
    active.set(key, job);
    try { return await job; }
    finally {
      count--;
      if (active.get(key) === job) active.delete(key);
    }
  }
  return { run, async close() { await Promise.allSettled(active.values()); platform?.close(); db.close(); } };
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
      request.progress = progress => process.stdout.write(JSON.stringify({id,progress})+"\n");
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
