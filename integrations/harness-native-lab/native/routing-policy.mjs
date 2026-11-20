// Pure decision helpers; this module does not call an LLM, change messages, or choose MCP tools.
export const RESULT_SCHEMA = 'harness-lab-tool-result/v1';
export const DATA_TOOLS = Object.freeze([
  'mcp__business__yandex_collect_phrases',
  'mcp__business__marketplace_orders_report',
  'mcp__business__marketplace_stock_snapshot',
]);

export function humanText(message) {
  if (!message?.id || !['user', 'user-rpc'].includes(message.source?.kind)) return null;
  const content = message.content;
  if (!Array.isArray(content)) return null;
  return content.filter(block => block?.type === 'text').map(block => block.text).join('\n');
}

export function explicitAnalysisIntent(text) {
  const value = String(text).normalize('NFKC').toLowerCase();
  if (/(?:не|без)\s+(?:нужен\s+)?(?:анализ\p{L}*|сравнен\p{L}*|рассужден\p{L}*)/u.test(value)) return false;
  if (/(?:^|\s)не\s+(?:проанализируй|анализируй|сравни|сопоставляй)/u.test(value)) return false;
  return /(?:^|\s)(?:проанализируй|сравни|сопоставь|проведи\s+анализ|объясни\s+причин\p{L}*|найди\s+причин\p{L}*|анализ\s*:|analy[sz]e|compare|explain\s+(?:the\s+)?(?:causes|reasons))(?:\s|[,:.!?]|$)/u.test(value);
}

export function referencesExistingData(text) {
  return /(?:эт(?:и|их|им|ими|ом|ого|от|у)\s+(?:данн\p{L}*|результат\p{L}*|отч[её]т\p{L}*|цифр\p{L}*)|полученн\p{L}*\s+(?:данн\p{L}*|результат\p{L}*|отч[её]т\p{L}*)|данн\p{L}*\s+выше|these\s+(?:data|results|numbers)|previous\s+(?:report|results))/iu.test(text);
}

export function isDataEvidence(execution, result, tools = DATA_TOOLS) {
  if (!execution?.agent || execution.signal?.aborted || !tools.includes(execution.name) || result?.isError !== false) return false;
  const value = result.value;
  if (!value || value.isError === true) return false;
  return isCanonicalData(value.structuredContent);
}

function isCanonicalData(structured) {
  return Boolean(structured?.schema === RESULT_SCHEMA
    && structured.kind === 'data'
    && structured.complete === true
    && typeof structured.as_of === 'string'
    && structured.source && typeof structured.source === 'object'
    && structured.data && typeof structured.data === 'object'
    && !Array.isArray(structured.data)
    && Object.keys(structured.data).some(key => key !== 'warnings'));
}

export function sameSelection(a, b) {
  return !!a && !!b && a.provider === b.provider && a.model === b.model && a.reasoningEffort === b.reasoningEffort;
}

export function lastSelectionEvent(session) {
  for (let i = session.log.length - 1; i >= 0; i--) {
    const event = session.log[i];
    if (event.type === 'model/selection') return event;
  }
  return null;
}

export function initialMode(session, record, fast) {
  const last = lastSelectionEvent(session);
  if (record?.mode === 'manual') return 'manual';
  // A gap between the session log and sidecar is interpreted conservatively.
  // Do not overwrite a manual choice after an interrupted sidecar write.
  if (record?.mode === 'auto') return (last?.seq ?? null) === record.lastSelectionSeq ? 'auto' : 'manual';
  if (session.log.some(event => event.type === 'request/header')) return 'manual';
  return !last || sameSelection(last.data, fast) ? 'auto' : 'manual';
}

export function historyDataEvidence(session) {
  const visible = session.deriveMessages().filter(message => message.role === 'tool' && !message.isError);
  for (let i = session.log.length - 1; i >= 0; i--) {
    const event = session.log[i];
    if (event.type !== 'tool/result' || event.data.message?.isError) continue;
    const message = event.data.message;
    const callId = message?.toolCallId;
    if (!callId || !Array.isArray(message.content)) continue;
    if (!visible.some(item => item.toolCallId === callId && JSON.stringify(item.content) === JSON.stringify(message.content))) continue;
    const call = session.log.slice(0, i).reverse().find(item => item.type === 'tool/call' && item.data.callId === callId && item.data.turn === event.data.turn);
    if (!call || !DATA_TOOLS.includes(call.data.name)) continue;
    // The official MCP adapter renders canonical content once into this native
    // role=tool result. A user quotation has neither this event nor its call.
    // Successful structuredContent itself is execution-local in rc.1, so read
    // the server's identical JSON text, not an invented metadata projection.
    let structured;
    try { structured = JSON.parse(message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')); }
    catch { continue; }
    if (isCanonicalData(structured)) return { callId, seq: event.seq, tool: call.data.name };
  }
  return null;
}

export function freshTurn(turn, analysis) {
  return { turn, analysis, promoted: false, highStep: null, dataCalls: new Set() };
}
