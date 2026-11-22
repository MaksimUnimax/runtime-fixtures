// Start the real operation gateway in front of a loopback Messages fixture.
import http from 'node:http';
import { once } from 'node:events';
import { createGateway } from '../../../integrations/harness-native-lab/gateway/server.mjs';
import { openOperationResolver } from '../../../integrations/harness-native-lab/gateway/operation-resolver.mjs';

const [database, journal] = process.argv.slice(2);
let calls = 0;
const upstream = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const request = JSON.parse(Buffer.concat(chunks));
  const last = request.messages.findLast(message=>message.role==='user').content;
  const prompt = last.find(block => block.type === 'text')?.text;
  if (prompt === 'interrupt fixture') {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.flushHeaders();
    return; // Intentionally hold this fixture stream until the test worker exits.
  }
  if (prompt === 'uncertain fixture') {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { type: 'api_error', message: 'fixture failure' } }));
    return;
  }
  if (prompt === 'delayed coin fixture') await new Promise(resolve => setTimeout(resolve, 900));
  const drawing=request.messages.some(m=>Array.isArray(m.content) && m.content.some(b=>b.type==='text' && b.text==='draw fixture'));
  const imageReceived=request.messages.some(m=>Array.isArray(m.content) && m.content.some(b=>b.type==='tool_result'
    && JSON.stringify(b.content).includes('Изображение готово')));
  const toolResult = last.find(block => block.type === 'tool_result');
  const opened = toolResult && JSON.stringify(toolResult.content).includes('opened');
  const useTool = drawing ? !imageReceived : prompt === 'tool fixture' || opened;
  const targetName = drawing ? 'create_illustration' : 'mcp__platform__summarize_text';
  const tool = request.tools?.find(t => t.name===targetName) ?? request.tools?.find(t=>t.name==='octoport_use');
  const activating=tool?.name==='octoport_use';
  if (!drawing && toolResult && !opened && (toolResult.is_error || !JSON.stringify(toolResult.content).includes('one two'))) {
    res.writeHead(422);
    res.end('Missing expected MCP result');
    return;
  }
  let answer = drawing && imageReceived ? 'Работа завершена' : toolResult ? 'tool result received' : 'answer to ' + prompt;
  if (prompt?.startsWith('inspect connections ')) {
    // Inspect the actual serialized provider request after a previous assistant reply.
    const update=request.messages.slice(request.messages.findLastIndex(m=>m.role==='assistant')+1)
      .filter(m=>m.role==='user').flatMap(m=>m.content).map(b=>b.text||'').join(' ');
    const tools=(request.tools||[]).map(t=>({ids:t.input_schema.properties?.connectionId?.enum ?? t.input_schema.properties?.selections?.items?.properties?.connectionId?.enum, deferred:t.defer_loading}));
    answer=JSON.stringify({
      currentStore:update.includes('Магазин Тест'), boundName:(request.tools||[]).some(t=>t.description.includes('mcp__platform__marketplace_report')),
      freshUpdate:update.includes('Текущее состояние подключений'), active:tools.filter(t=>t.ids).map(t=>t.ids.length),
      allImmediate:tools.every(t=>!t.deferred), secretLeaked:JSON.stringify(request).includes('private-sentinel')
    });
  }
  if (prompt === 'Как звучал мой первый вопрос в гостевом чате? Процитируй только вопрос.') {
    const earlier = request.messages.slice(0, -1).filter(message => message.role === 'user');
    const texts = earlier.flatMap(message => Array.isArray(message.content)
      ? message.content.filter(block => block.type === 'text').map(block => block.text)
      : [message.content]);
    answer = texts[0] ?? 'Предыдущего вопроса нет';
  }
  const event = (type, fields = {}) => res.write('event: ' + type + '\ndata: ' +
    JSON.stringify({ type, ...fields }) + '\n\n');
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  event('message_start', { message: { id: 'fixture-' + ++calls, role: 'assistant', type: 'message',
    content: [], model: request.model, usage: { input_tokens: 10, output_tokens: 0,
      cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
  const partial = prompt === 'browser fixture';
  const index = partial ? 1 : 0;
  if(partial){
    event('content_block_start',{index:0,content_block:{type:'thinking',thinking:''}});
    event('content_block_delta',{index:0,delta:{type:'thinking_delta',thinking:'private fixture trace'}});
    await new Promise(resolve=>setTimeout(resolve,700));
    event('content_block_stop',{index:0});
  }
  if (useTool && tool) {
    event('content_block_start', { index: 0, content_block: { type: 'tool_use', id: activating ? 'open-action' : 'test-call', name: tool.name, input: {} } });
    event('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: activating ? JSON.stringify({action:targetName,query:drawing?'circle':'text'}) : drawing ? '{"prompt":"circle"}' : '{"text":"one two"}' } });
  } else {
    event('content_block_start', { index, content_block: { type: 'text', text: '' } });
    if (prompt === 'browser fixture') {
      event('content_block_delta', { index, delta: { type: 'text_delta', text: 'answer to ' } });
      await new Promise(resolve=>setTimeout(resolve,1400));
      answer=prompt;
    }
    event('content_block_delta', { index, delta: { type: 'text_delta', text: answer } });
  }
  event('content_block_stop', {index});
  event('message_delta', { delta: { stop_reason: useTool && tool ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 5 } });
  event('message_stop');
  res.end();
});
async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return 'http://127.0.0.1:' + server.address().port;
}
const resolver = openOperationResolver(database);
const gateway = createGateway({ resolveAttribution: resolver.resolve, billing: resolver.billing, upstreamBase: await listen(upstream),
  now: () => Date.UTC(2026, 10, 20, 7), realKey: 'local-fixture', logFile: journal, fx: 80 });
console.log(await listen(gateway.server));
process.stdin.resume();
process.stdin.on('end', () => {
  gateway.server.close();
  upstream.close();
  gateway.server.closeAllConnections();
  upstream.closeAllConnections();
  resolver.close();
});
