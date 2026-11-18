import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertRuntime, importRuntime } from '../runtime-import.mjs';
import * as policy from '../policy-plugin.mjs';
import { historyDataEvidence } from '../routing-policy.mjs';
import { NativeRpc } from '../native-rpc.mjs';

// A deterministic test-only LLM exercises the REAL installed Agent, Session,
// tool bridge and command/storage hooks. The launched product never imports it.
async function runtime(directory, responses, calls) {
  assertRuntime();
  const { Context } = await importRuntime('@deepseek-ai/cordis');
  const { LlmAdapter } = await importRuntime('@deepseek-ai/dsh-llm');
  const { createMcpToolDefinition } = await importRuntime('@deepseek-ai/dsh-mcp-client');
  const ctx = new Context();
  const fibers = [];
  const handles = [];
  async function mount(module, config = {}) {
    const imported = typeof module === 'string' ? await importRuntime(`@deepseek-ai/${module}`) : module;
    const fiber = ctx.plugin(imported.default ?? imported, config);
    fibers.push(fiber);
    await fiber.await();
    if (fiber._error) throw fiber._error;
  }
  class FixtureAdapter extends LlmAdapter {
    async resolveModel(provider, model) {
      return {
        provider, id: model, name: model, inputModalities: ['text'],
        reasoning: { efforts: [{ id: 'off', name: 'Off' }, { id: 'high', name: 'High' }], defaultEffort: 'off' },
      };
    }
    async *stream(options) {
      calls.push({ model: options.model, effort: options.reasoningEffort, maxTokens: options.maxTokens, messages: options.messages });
      const response = responses.shift();
      if (!response) throw new Error('Fixture had no response; unexpected extra model call');
      if (response.tool) {
        const rawName = typeof response.tool === 'string' ? response.tool : 'marketplace_orders_report';
        const block = { type: 'tool-call', id: `fixture-${randomUUID()}`, name: `mcp__business__${rawName}`, arguments: '{}' };
        yield { type: 'block-start', index: 0, blockType: 'tool-call' };
        yield { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: '{}' };
        yield { type: 'block-end', index: 0, block };
        yield { type: 'finish', reason: { kind: 'tool-calls' } };
      } else {
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'text-delta', index: 0, text: response.text };
        yield { type: 'block-end', index: 0, block: { type: 'text', text: response.text } };
        yield { type: 'finish', reason: { kind: 'stop' } };
      }
    }
  }
  try {
    for (const name of ['dsh-llm', 'dsh-session', 'dsh-session-projection', 'dsh-typert-registry', 'dsh-storage']) await mount(name);
    await mount('dsh-storage-json', { root: path.join(directory, 'storage') });
    await mount('dsh-storage-domain', { backend: 'json' });
    await mount('dsh-system-prompt', { includeHarnessIdentity: false, includeRuntimeContext: false, personaPrefix: 'Test fixture assistant.' });
    await mount('dsh-tools'); await mount('dsh-tool-executor-native'); await mount('dsh-agent'); await mount('dsh-commands');
    await mount('dsh-session-persistence-jsonl', { root: path.join(directory, 'sessions'), compression: 'none' });
    await mount('dsh-session-checkpoint-policy');
    ctx.llm.registerAdapter(['deepseek-official'], new FixtureAdapter());
    for (const rawName of ['marketplace_orders_report', 'marketplace_stock_snapshot']) {
      const tool = createMcpToolDefinition(ctx, {
      name: `mcp__business__${rawName}`, rawName, description: 'Fixture report',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      async call() {
        const structuredContent = { schema: 'harness-lab-tool-result/v1', kind: 'data', complete: true, as_of: '2026-11-18T00:00:00Z', source: { provider: 'fixture' }, data: rawName === 'marketplace_orders_report' ? { ordered_units: 17 } : { present: 23, reserved: 4 } };
        return { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent };
      },
    });
      ctx.tools.register(tool);
    }
    await mount(policy, {});
    await mount('dsh-agent-loop', { agents: [], maxParallelToolCalls: 1 });
    return {
      ctx,
      async agent(id = randomUUID(), resume = false) {
        const options = { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'off' };
        const handle = resume ? await ctx.agents.resume({ resumeSessionId: id, agentOptions: options }) : await ctx.agents.create({ sessionId: id, agentOptions: options });
        handles.push(handle); return handle.agent;
      },
      async close() {
        for (const handle of handles.reverse()) await handle.dispose();
        await ctx.sessionPersistence.flush();
        for (const fiber of fibers.reverse()) await fiber.dispose();
        await ctx.fiber.dispose();
      },
    };
  } catch (error) {
    for (const fiber of fibers.reverse()) await fiber.dispose().catch(() => {});
    await ctx.fiber.dispose().catch(() => {});
    throw error;
  }
}

async function prompt(agent, text) {
  agent.followup({ id: randomUUID(), role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] });
  await agent.whenIdle();
  const error = [...agent.session.log].reverse().find(event => event.type === 'turn/end');
  assert.notEqual(error?.data.reason?.kind, 'error', JSON.stringify(error?.data));
}

test('real rc.1: context, per-turn limits, genuine-tool promotion, manual override and restart', { skip: !process.env.HARNESS_NODE_MODULES, timeout: 30000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-native-policy-'));
  const calls = [], responses = [];
  let host;
  try {
    host = await runtime(directory, responses, calls);
    const agent = await host.agent();
    responses.push({ text: 'Запомнил янтарный.' });
    await prompt(agent, 'Контрольный цвет — янтарный.');
    responses.push({ text: 'Янтарный.' });
    await prompt(agent, 'Какой контрольный цвет?');
    assert.equal(calls.length, 2);
    assert.equal(calls.every(call => call.model === 'deepseek-flash' && call.effort === 'off'), true);
    assert.match(JSON.stringify(calls[1].messages), /янтарный/);

    responses.push({ tool: true }, { text: 'Разобрал 17 заказов.' });
    await prompt(agent, 'Проанализируй отчёт за прошлую неделю.');
    assert.deepEqual(calls.slice(-2).map(call => [call.model, call.effort, call.maxTokens]), [['deepseek-flash', 'off', 4096], ['deepseek-v4-pro', 'high', 8192]]);
    assert.equal(agent.model.current().model, 'deepseek-flash');
    const result = agent.session.log.find(event => event.type === 'tool/result');
    assert.equal(historyDataEvidence(agent.session)?.callId, result.data.message.toolCallId);

    responses.push({ text: 'Анализ тех же 17 заказов без нового API.' });
    await prompt(agent, 'Проанализируй эти данные подробнее.');
    assert.equal(calls.at(-1).model, 'deepseek-v4-pro');
    assert.equal(agent.session.log.filter(event => event.type === 'tool/call').length, 1);

    responses.push({ tool: true }, { tool: true }, { text: 'Последующий шаг снова быстрый.' });
    await prompt(agent, 'Сравни новые отчёты.');
    assert.deepEqual(calls.slice(-3).map(call => [call.model, call.effort]), [['deepseek-flash', 'off'], ['deepseek-v4-pro', 'high'], ['deepseek-flash', 'off']], 'a second successful tool result in the same turn must not buy another Pro step');

    responses.push({ tool: 'marketplace_stock_snapshot' }, { text: 'Остатки разобраны.' });
    await prompt(agent, 'Проанализируй текущие остатки.');
    assert.deepEqual(calls.slice(-2).map(call => call.model), ['deepseek-flash', 'deepseek-v4-pro']);
    assert.equal(historyDataEvidence(agent.session)?.tool, 'mcp__business__marketplace_stock_snapshot');

    for (let i = 0; i < 10; i++) {
      responses.push({ text: `Ответ ${i}` });
      await prompt(agent, `Обычная реплика ${i}`);
    }
    assert.equal(calls.slice(-10).every(call => call.model === 'deepseek-flash'), true, 'maxSteps must not stop a long multi-turn chat');

    const beforeCommand = calls.length;
    const command = await host.ctx.commands.execute(agent, '/lab-mode manual', [], new AbortController().signal);
    assert.equal(command.result.kind, 'success');
    assert.equal(calls.length, beforeCommand, 'native mode commands do not call a model');
    agent.model.select({ provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' });
    responses.push({ text: 'Ручной выбор сохранён.' });
    await prompt(agent, 'Привет');
    assert.equal(calls.at(-1).model, 'deepseek-v4-pro');

    const other = await host.agent();
    responses.push({ text: 'В этом чате цвет не называли.' });
    await prompt(other, 'Какой контрольный цвет?');
    assert.doesNotMatch(JSON.stringify(calls.at(-1).messages), /янтарный/);

    const bounded = await host.agent();
    const beforeBounded = calls.length;
    responses.push(...Array.from({ length: 8 }, () => ({ tool: true })));
    await prompt(bounded, 'Покажи данные.');
    assert.equal(calls.length - beforeBounded, 8, 'a continuing tool loop must stop before a ninth paid model step');

    const id = agent.id;
    await host.close(); host = null;
    host = await runtime(directory, responses, calls);
    const resumed = await host.agent(id, true);
    responses.push({ text: 'Янтарный; ручной режим.' });
    await prompt(resumed, 'Напомни контрольный цвет после перезапуска.');
    assert.equal(calls.at(-1).model, 'deepseek-v4-pro');
    assert.match(JSON.stringify(calls.at(-1).messages), /янтарный/);
    const status = await host.ctx.commands.execute(resumed, '/lab-mode status', [], new AbortController().signal);
    assert.match(status.result.text, /Ручной режим/);
    assert.equal(responses.length, 0);
  } finally {
    if (host) await host.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('native RPC helper requests satisfy the actual rc.1 generated strict codecs', { skip: !process.env.HARNESS_NODE_MODULES }, async () => {
  assertRuntime();
  const { TYPERT } = await importRuntime('@deepseek-ai/dsh-api-session-controller/typert');
  const methods = [];
  const client = new NativeRpc('http://127.0.0.1:18440', { fetchImpl: async (url, options) => {
    assert.equal(new Headers(options.headers).has('Origin'), false);
    if (!options.method) {
      assert.equal(url.pathname, '/connect');
      assert.equal(url.searchParams.get('interactions'), 'none');
      assert.equal(url.searchParams.get('token'), 'fixture-only-token');
      return new Response(null, { status: 302, headers: { 'Set-Cookie': 'fixture-api-cookie=value; HttpOnly', Location: '/' } });
    }
    const envelope = JSON.parse(options.body);
    const spec = TYPERT.invocations.find(item => `${item.namespace}/${item.method}` === envelope.method);
    assert.ok(spec, envelope.method);
    const parameter = spec.parameters.find(item => item.source === 'json');
    const parsed = parameter.strictCodec.create().safeParse(envelope.payload.args.request);
    assert.equal(parsed.success, true, `${envelope.method}: ${parsed.error?.message ?? ''}`);
    assert.equal(new Headers(options.headers).get('Cookie'), 'fixture-api-cookie=value');
    methods.push(envelope.method);
    return Response.json({ type: 'server-response', rpcId: envelope.rpcId, result: { ok: true, value: {} } });
  } });
  await client.authenticate('https://example.invalid/?token=fixture-only-token');
  const id = randomUUID();
  await client.create({ sessionId: id, cwd: '/tmp/native-rpc-fixture', agentPreset: 'lab-assistant' });
  await client.events(id, { maxMessages: 10 });
  await client.prompt(id, 'Fixture prompt');
  await client.wait(id, { timeoutMs: 1000, maxMessages: 10 });
  await client.selectModel(id, 'deepseek-v4-pro', 'high');
  assert.deepEqual(methods, ['session/create', 'session/events', 'session/prompt', 'session/wait', 'session/selectModel']);
  const events = TYPERT.invocations.find(item => item.namespace === 'session' && item.method === 'events');
  assert.equal(events.parameters[0].strictCodec.create().safeParse({ address: { sessionId: id } }).success, false, 'the exact native schema rejects an address without kind');
});
