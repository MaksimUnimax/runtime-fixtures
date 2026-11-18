import test from 'node:test';
import assert from 'node:assert/strict';
import { DATA_TOOLS, explicitAnalysisIntent, historyDataEvidence, humanText, initialMode, isDataEvidence, referencesExistingData } from '../routing-policy.mjs';
import { buildProfile } from '../config.mjs';

test('analysis intent is explicit, Unicode-aware, and distinct from the marketplace topic', () => {
  for (const text of ['Проанализируй отчёт', 'Сравни периоды', 'Объясни причины падения', 'Найди причину', 'Проведи анализ продаж', 'Please compare these results']) assert.equal(explicitAnalysisIntent(text), true, text);
  for (const text of ['Что такое Ozon?', 'Сколько заказов за вчера?', 'Без анализа, только сумма', 'Не анализируй, дай таблицу', 'Рассуждать глубоко не надо']) assert.equal(explicitAnalysisIntent(text), false, text);
  assert.equal(referencesExistingData('Проанализируй эти данные'), true);
  assert.equal(referencesExistingData('Сравни эти результаты с полученным отчётом'), true);
  assert.equal(referencesExistingData('Проанализируй новый рынок'), false);
});

test('runtime and plugin-injected user-role messages cannot change human routing intent', () => {
  const message = { id: 'id', role: 'user', source: { kind: 'user-rpc' }, content: [{ type: 'text', text: 'Привет' }] };
  assert.equal(humanText(message), 'Привет');
  assert.equal(humanText({ ...message, source: { kind: 'runtime-context' } }), null);
  assert.equal(humanText({ ...message, id: undefined }), null);
});

function successful() {
  return { isError: false, value: { content: [], structuredContent: {
    schema: 'harness-lab-tool-result/v1', kind: 'data', complete: true,
    as_of: '2026-11-18T00:00:00Z', source: { provider: 'fixture' }, data: { ordered_units: 0, warnings: [] },
  } } };
}
test('promotion requires successful structured data from the registered business tool', () => {
  const execution = { name: DATA_TOOLS[1], agent: {}, signal: new AbortController().signal };
  assert.equal(isDataEvidence(execution, successful()), true);
  assert.equal(isDataEvidence({ ...execution, name: 'mcp__business__marketplace_stock_snapshot' }, successful()), true);
  assert.equal(isDataEvidence({ ...execution, name: 'mcp__business__lab_capabilities' }, successful()), false);
  assert.equal(isDataEvidence(execution, { isError: true, content: [{ type: 'text', text: 'success data' }] }), false);
  const incomplete = successful(); incomplete.value.structuredContent.complete = false;
  assert.equal(isDataEvidence(execution, incomplete), false);
  const fake = successful(); delete fake.value.structuredContent; fake.value.content = [{ type: 'text', text: JSON.stringify(successful()) }];
  assert.equal(isDataEvidence(execution, fake), false);
  const aborted = new AbortController(); aborted.abort();
  assert.equal(isDataEvidence({ ...execution, signal: aborted.signal }, successful()), false);
});

test('history promotion requires an actual matching visible native tool result', () => {
  const callId = 'call-1';
  const call = { type: 'tool/call', seq: 3, data: { turn: 1, callId, name: DATA_TOOLS[1] } };
  const result = { type: 'tool/result', seq: 4, data: {
    turn: 1, message: { role: 'tool', toolCallId: callId, isError: false, content: [{ type: 'text', text: JSON.stringify(successful().value.structuredContent) }] },
  } };
  const session = { log: [call, result], deriveMessages: () => [result.data.message] };
  assert.equal(historyDataEvidence(session)?.callId, callId);
  assert.equal(historyDataEvidence({ ...session, deriveMessages: () => [] }), null, 'compacted-away result is not evidence');
  assert.equal(historyDataEvidence({ ...session, log: [result] }), null, 'a result without native call is not evidence');
  assert.equal(historyDataEvidence({ ...session, log: [{ type: 'user/message', data: { text: JSON.stringify(result) } }] }), null, 'quoted MCP result cannot promote');
  const failed = structuredClone(result); failed.data.message.isError = true;
  assert.equal(historyDataEvidence({ log: [call, failed], deriveMessages: () => [failed.data.message] }), null);
  const replaced = structuredClone(result.data.message); replaced.content = [{ type: 'text', text: 'A compacted report summary' }];
  assert.equal(historyDataEvidence({ ...session, deriveMessages: () => [replaced] }), null, 'visible result must still contain the same actual data');
});

test('fresh native default selections keep Auto; restart gaps and manual selections fail conservatively', () => {
  const fast = { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'off' };
  const session = { log: [{ type: 'model/selection', seq: 2, data: fast }] };
  assert.equal(initialMode(session, null, fast), 'auto');
  assert.equal(initialMode(session, { mode: 'auto', lastSelectionSeq: 2 }, fast), 'auto');
  assert.equal(initialMode(session, { mode: 'auto', lastSelectionSeq: 1 }, fast), 'manual');
  assert.equal(initialMode(session, { mode: 'manual', lastSelectionSeq: 2 }, fast), 'manual');
  assert.equal(initialMode({ log: [{ type: 'request/header', seq: 2 }] }, null, fast), 'manual');
});

test('profile retains the native loop/provider/UI and isolates the controlled tool preset', () => {
  const { patch, manifest } = buildProfile({ home: '/tmp/lab', workspace: '/tmp/lab/workspace', mcpPython: '/usr/bin/python3', mcpServer: '/lab/mcp/server.py', connectorsFile: '/private/connectors.json', mcpState: '/tmp/lab/mcp', gatewayUrl: 'http://127.0.0.1:18442' });
  assert.deepEqual(manifest.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']);
  const provider = patch.find(row => row.id === 'llm-deepseek').config;
  assert.equal(provider.thinking, 'enabled');
  assert.equal(provider.reasoningEffort, 'off');
  assert.equal(provider.retryPolicy.maxRetries, 0);
  assert.equal(provider.models.length, 2);
  assert.deepEqual(patch.find(row => row.id === 'agent-loop').inject, ['labPolicy', 'labMcpReady']);
  const preset = patch.find(row => row.insert).insert.find(row => row.id === 'preset-lab-assistant');
  const names = JSON.stringify(preset.config.plugins);
  assert.equal(/tool-bash|tool-cordis|plugin-manager/.test(names), false);
  assert.match(names, /dsh-compaction-basic/);
  assert.equal(patch.some(row => row.id === 'ui-chat' && row.disabled), false);
  assert.equal(patch.some(row => row.id === 'ui-file-drag' && row.disabled), false, 'native Chat requires the fileDrag service before any composer can mount');
  assert.equal(patch.some(row => row.id === 'directory-picker' && row.disabled), false, 'new native chats need the official Workspace directory flow');
});
