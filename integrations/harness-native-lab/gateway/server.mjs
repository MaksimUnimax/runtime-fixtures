import http from 'node:http';
import https from 'node:https';
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PRICES = Object.freeze({
  'deepseek-flash': { input: 0.30, cache: 0.006, output: 1.20 },
  'deepseek-v4-pro': { input: 1.32, cache: 0.044, output: 3.96 },
});

const USAGE_KEYS = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];
const STOP_REASONS = new Set(['end_turn', 'max_tokens', 'stop_sequence', 'tool_use', 'refusal']);
const REQUEST_FIELDS = new Set(['model', 'max_tokens', 'messages', 'system', 'stream', 'thinking',
  'output_config', 'temperature', 'top_p', 'tools', 'tool_choice', 'stop_sequences', 'metadata',
  'dsh_session_log', 'dsh_plugin_packages']);
const CLIENT_TOOL_FIELDS = new Set(['name', 'description', 'input_schema', 'defer_loading']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const tokenCount = value => Number.isSafeInteger(value) && value >= 0;
const completeUsage = value => object(value) && USAGE_KEYS.every(key => tokenCount(value[key]));
const invalidUsage = value => !object(value) || USAGE_KEYS.some(key => Object.hasOwn(value, key) && !tokenCount(value[key]));

function textBlocks(content) {
  return typeof content === 'string' || Array.isArray(content) && content.every(block =>
    object(block) && block.type === 'text' && typeof block.text === 'string');
}

function textHistory(messages) {
  return Array.isArray(messages) && messages.length > 0 && messages.every(message => {
    if (!object(message) || !['user', 'assistant', 'system'].includes(message.role)) return false;
    if (typeof message.content === 'string') return true;
    if (!Array.isArray(message.content)) return false;
    return message.content.every(block => {
      if (!object(block)) return false;
      if (block.type === 'text') return typeof block.text === 'string';
      if (message.role === 'assistant' && block.type === 'thinking') return typeof block.thinking === 'string';
      if (message.role === 'assistant' && block.type === 'tool_use') {
        return typeof block.id === 'string' && typeof block.name === 'string' && object(block.input);
      }
      if (message.role === 'user' && block.type === 'tool_result') {
        return typeof block.tool_use_id === 'string' &&
          (block.content === undefined || block.content === null || textBlocks(block.content));
      }
      return false;
    });
  });
}

function clientTools(tools) {
  return tools === undefined || tools === null || Array.isArray(tools) && tools.every(tool =>
    object(tool) && Object.keys(tool).every(key => CLIENT_TOOL_FIELDS.has(key)) &&
    typeof tool.name === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(tool.name) &&
    object(tool.input_schema) && (tool.description === undefined || typeof tool.description === 'string') &&
    (tool.defer_loading === undefined || typeof tool.defer_loading === 'boolean'));
}

export function normalizeUsage(value) {
  if (!object(value)) return null;
  const out = {};
  for (const key of USAGE_KEYS) if (tokenCount(value[key])) out[key] = value[key];
  return Object.keys(out).length ? out : null;
}

export function quoteUsage(model, usage, fx = null) {
  const rates = PRICES[model];
  if (!rates || !completeUsage(usage)) return null;
  if (usage.cache_creation_input_tokens && usage.cache_creation_input_tokens !== 0) return null;
  // Messages input_tokens excludes cache reads. Never add message_start to message_delta.
  const usd = (usage.input_tokens * rates.input + usage.cache_read_input_tokens * rates.cache + usage.output_tokens * rates.output) / 1e6;
  return { usd_peak_estimate: usd, rub_peak_estimate: Number.isFinite(fx) && fx > 0 ? usd * fx : null,
    pricing_version: 'deepseek-2026-11-18-peak-cap', quote_kind: 'conservative_peak_estimate',
    prices_usd_per_million: rates, fx_rub_per_usd: fx,
    note: 'Usage is actual; monetary amount uses peak rates. Off-peak charges can be lower; this is not a wallet debit.' };
}

/** Native-lab read-only meter projection. No credentials, prompts or provider IDs. */
export async function readMeterSummary(logFile, now = Date.now()) {
  let source;
  try { source = await readFile(logFile, 'utf8'); }
  catch (error) {
    if (error?.code === 'ENOENT') source = '';
    else throw error;
  }
  const totals = { usd: 0, rub: 0, calls: 0, unknown: 0 };
  const recent = { usd: 0, rub: 0, calls: 0, unknown: 0 };
  let latest = null;
  const sessions = new Map();
  for (const line of source.split('\n')) {
    if (!line) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.event !== 'finished') continue;
    const ts = Date.parse(event.finished_at || '');
    const valid = Number.isFinite(event.quote?.rub_peak_estimate)
      && event.quote.rub_peak_estimate >= 0
      && Number.isFinite(event.quote?.usd_peak_estimate)
      && event.quote.usd_peak_estimate >= 0
      && event.outcome === 'completed';
    for (const sum of [totals, ...Number.isFinite(ts) && now-ts >= 0 && now-ts < 86400000 ? [recent] : []]) {
      if (!valid) { sum.unknown++; continue; }
      sum.usd += event.quote.usd_peak_estimate;
      sum.rub += event.quote.rub_peak_estimate;
      sum.calls++;
    }
    if (typeof event.session_id === 'string' && event.session_id.length <= 160) {
      let perSession = sessions.get(event.session_id);
      if (!perSession) { perSession = { usd: 0, rub: 0, calls: 0, unknown: 0 }; sessions.set(event.session_id, perSession); }
      if (valid) { perSession.usd += event.quote.usd_peak_estimate; perSession.rub += event.quote.rub_peak_estimate; perSession.calls++; }
      else perSession.unknown++;
    }
    if (!latest || (Number.isFinite(ts) && ts > latest.ts)) {
      latest = { ts, estimated_rub: valid ? event.quote.rub_peak_estimate : null,
        model: event.model, outcome: event.outcome, pricing_version: event.quote?.pricing_version || null,
        session_id: event.session_id || null };
    }
  }
  const finish = sum => ({ completed_model_calls: sum.calls, uncertain_attempts: sum.unknown,
    usd_peak_estimate: Math.round(sum.usd * 1e8) / 1e8, rub_peak_estimate: Math.round(sum.rub * 1e6) / 1e6 });
  return { schema: 'harness-lab-meter/v1', scope: 'single-owner-lab-all-sessions',
    total: finish(totals), last_24h: finish(recent),
    last_completed: latest ? { rub_peak_estimate: latest.estimated_rub, model: latest.model,
      outcome: latest.outcome, pricing_version: latest.pricing_version } : null,
    last_active_session: latest?.session_id && sessions.has(latest.session_id)
      ? finish(sessions.get(latest.session_id)) : null,
    disclaimer: 'Peak-price RUB estimate from terminal DeepSeek usage; not invoice or wallet debit. Unknown attempts are not zero.' };
}

function equalSecret(got, expected) {
  const a = Buffer.from(String(got || '')); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Copy only the fields defined by the product attribution contract.
function operationScope(resolver, credential) {
  const value = resolver(credential);
  if (!object(value)) return null;
  const { workspace_id, operation_id, source } = value;
  if (typeof workspace_id !== 'string' || !workspace_id || Array.from(workspace_id).length > 256 ||
      workspace_id.includes('\0') ||
      typeof operation_id !== 'string' || operation_id.length !== 32 || /[^a-f0-9]/.test(operation_id) ||
      typeof source !== 'string' || !/^[a-z]/.test(source) || /[^a-z0-9_.-]/.test(source) || source.length > 64) {
    return null;
  }
  return { workspace_id, operation_id, source };
}

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

export function createGateway(config) {
  const resolveAttribution = config.resolveAttribution;
  if (resolveAttribution !== undefined && typeof resolveAttribution !== 'function') {
    throw new TypeError('Expected a synchronous operation grant resolver');
  }
  let active = 0;
  let journal = Promise.resolve();
  const log = event => { journal = journal.then(() => appendFile(config.logFile, JSON.stringify(event) + '\n', { mode: 0o600 })); return journal; };
  const server = http.createServer(async (req, res) => {
    let entry = null, settled = false, upstreamReq, upstreamRes;
    let usage = null, usageFinal = false, responseId = null, responseModel = null;
    let usageInvalid = false, terminalDelta = false, streamError = false;
    let streamBuffer = '', plain = '', status = null;
    const settle = async (outcome, extra = {}) => {
      if (settled || !entry) return;
      settled = true;
      active--;
      const finalUsage = usageFinal && completeUsage(usage) ? usage : null;
      await log({ ...entry, event: 'finished', finished_at: new Date().toISOString(), elapsed_ms: Date.now() - entry.started_ms,
        status, outcome, provider_response_id: responseId, response_model: responseModel,
        usage: finalUsage, partial_usage: finalUsage ? null : usage,
        quote: quoteUsage(responseModel || entry.model, finalUsage, config.fx), ...extra });
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/lab-meter') {
        if (resolveAttribution) return json(res, 404, { error: 'not_found' });
        // Private loopback listener. Public proxy MUST first verify the
        // unmodified native Host cookie with auth_request.
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress))
          return json(res, 403, { error: 'loopback_only' });
        return json(res, 200, await readMeterSummary(config.logFile));
      }
      if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, service: 'harness-native-model-gateway', active, mode: resolveAttribution ? 'scoped-operations' : 'single-owner-lab', models: Object.keys(PRICES) });
      const incoming = req.headers['x-api-key'] || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const denied = () => json(res, 401, { error: { type: 'authentication_error', message: 'Invalid gateway credential' } });
      if (resolveAttribution ? !operationScope(resolveAttribution, incoming) : !equalSecret(incoming, config.virtualKey)) return denied();
      const isMessages = req.method === 'POST' && url.pathname === '/v1/messages';
      const isModels = req.method === 'GET' && ['/models', '/v1/models'].includes(url.pathname);
      if (!isMessages && !isModels) return json(res, 404, { error: { type: 'not_found_error', message: 'This test gateway supports text Messages and model discovery only' } });
      let body;
      if (isMessages) {
        const chunks = []; let length = 0;
        for await (const chunk of req) { length += chunk.length; if (length > (config.maxRequestBytes || 4 * 1024 * 1024)) { json(res, 413, { error: { type: 'invalid_request_error', message: 'Lab text request too large' } }); return; } chunks.push(chunk); }
        let parsed;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return json(res, 400, { error: { type: 'invalid_request_error', message: 'Expected JSON' } }); }
        if (!object(parsed) || !Object.keys(parsed).every(key => REQUEST_FIELDS.has(key))) return json(res, 400, { error: { type: 'invalid_request_error', message: 'Only native text Messages fields are allowed in this lab' } });
        if (!Object.hasOwn(PRICES, parsed.model)) return json(res, 400, { error: { type: 'invalid_request_error', message: 'Unsupported lab model' } });
        if (!Number.isInteger(parsed.max_tokens) || parsed.max_tokens <= 0 || parsed.max_tokens > (config.maxOutputTokens || 16384)) return json(res, 400, { error: { type: 'invalid_request_error', message: 'Output limit must be set within the lab allowance' } });
        if (!textHistory(parsed.messages) || !(parsed.system === undefined || parsed.system === null || textBlocks(parsed.system))) return json(res, 400, { error: { type: 'invalid_request_error', message: 'This lab accepts text history and native thinking/tool exchanges only' } });
        if (!clientTools(parsed.tools)) return json(res, 400, { error: { type: 'invalid_request_error', message: 'Only client-defined native tools are allowed; provider-side tools are outside this MCP lab' } });
        // Platform-owned, opaque identifier; native anonymous user header is not an authority.
        parsed.metadata = { user_id: config.userId || (resolveAttribution ? 'harness-operation-gateway' : 'harness-native-lab-owner-20261118') };
        body = Buffer.from(JSON.stringify(parsed));
        // Reading the body yielded. Recheck ownership, expiry and revocation at admission.
        const attribution = resolveAttribution ? operationScope(resolveAttribution, incoming) : null;
        if (resolveAttribution && !attribution) return denied();
        const sid = req.headers['x-deepseek-harness-session-id'];
        entry = { schema: 'harness-lab-model-attempt/v1', event: 'admitted', attempt_id: randomUUID(),
          ...(attribution && { attribution }),
          started_at: new Date().toISOString(), started_ms: Date.now(),
          session_id: typeof sid === 'string' && /^[a-zA-Z0-9_.:-]{1,160}$/.test(sid) ? sid : null,
          purpose: req.headers['x-deepseek-harness-compact'] === '1' ? 'compaction' : 'native-model-step',
          model: parsed.model, thinking: parsed.thinking?.type || null, effort: parsed.output_config?.effort || null,
          max_tokens: parsed.max_tokens, messages: parsed.messages.length,
          tools: (parsed.tools || []).map(t => t.name).filter(x => typeof x === 'string').slice(0, 80) };
        // Body reads yield. Admission must be checked and reserved together, with
        // no await between them, after validation and before the journal write.
        if (active >= (config.maxConcurrent || 4)) {
          entry = null;
          return json(res, 429, { error: { type: 'rate_limit_error', message: 'Lab concurrency limit reached' } });
        }
        active++;
        await log(entry);
        if (req.aborted || res.destroyed) { await settle('client_disconnected_before_dispatch'); return; }
      }
      const target = new URL(isModels ? '/models' : config.upstreamBase.replace(/\/$/, '') + '/v1/messages', config.upstreamBase);
      const headers = { 'x-api-key': config.realKey, 'authorization': 'Bearer ' + config.realKey,
        'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'accept': req.headers.accept || 'application/json' };
      if (body) headers['content-length'] = String(body.length);
      const transport = target.protocol === 'http:' ? http : https;
      upstreamReq = transport.request(target, { method: isMessages ? 'POST' : 'GET', headers, timeout: config.timeoutMs || 180000 }, up => {
        upstreamRes = up; status = up.statusCode;
        res.writeHead(status, { 'content-type': up.headers['content-type'] || 'application/json', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
        const streaming = String(up.headers['content-type']).includes('text/event-stream');
        up.on('data', chunk => {
          if (streaming) {
            streamBuffer += chunk.toString('utf8');
            let at;
            while ((at = streamBuffer.indexOf('\n')) !== -1) {
              const line = streamBuffer.slice(0, at).trim(); streamBuffer = streamBuffer.slice(at + 1);
              if (!line.startsWith('data:')) continue;
              try {
                const evt = JSON.parse(line.slice(5).trim());
                if (evt.type === 'message_start') {
                  responseId = evt.message?.id || null; responseModel = evt.message?.model || null;
                  usage = normalizeUsage(evt.message?.usage);
                  usageInvalid = invalidUsage(evt.message?.usage);
                  terminalDelta = false; usageFinal = false;
                }
                if (evt.type === 'message_delta' && evt.usage) {
                  usageInvalid ||= invalidUsage(evt.usage);
                  const n = normalizeUsage(evt.usage);
                  if (n) usage = { ...usage, ...n };
                  terminalDelta = STOP_REASONS.has(evt.delta?.stop_reason) && tokenCount(n?.output_tokens);
                  usageFinal = false;
                }
                if (evt.type === 'error') { streamError = true; usageFinal = false; }
                if (evt.type === 'message_stop') {
                  usageFinal = terminalDelta && !usageInvalid && !streamError && completeUsage(usage);
                }
              } catch { /* Only parse accounting fields; forward all wire bytes unchanged. */ }
            }
            if (streamBuffer.length > 2 * 1024 * 1024) streamBuffer = '';
          } else if (plain.length < 2 * 1024 * 1024) plain += chunk.toString('utf8');
          if (!res.write(chunk)) { up.pause(); res.once('drain', () => up.resume()); }
        });
        up.on('end', async () => {
          if (!streaming && isMessages) {
            try {
              const parsed = JSON.parse(plain); usage = normalizeUsage(parsed.usage);
              usageFinal = parsed.type === 'message' && STOP_REASONS.has(parsed.stop_reason) &&
                !invalidUsage(parsed.usage) && completeUsage(usage);
              responseId = parsed.id || null; responseModel = parsed.model || null;
            } catch {}
          }
          await settle(status >= 200 && status < 300 ? (streamError ? 'upstream_stream_error' : usageFinal ? 'completed' : 'usage_unknown') : 'upstream_error');
          res.end();
        });
        up.on('error', async () => { await settle('upstream_stream_error'); res.destroy(); });
      });
      upstreamReq.on('timeout', () => upstreamReq.destroy(new Error('upstream_timeout')));
      upstreamReq.on('error', async () => { await settle('transport_unknown'); if (!res.headersSent) json(res, 502, { error: { type: 'api_error', message: 'Model upstream transport failed; automatic replay is not performed by this gateway' } }); else res.destroy(); });
      res.on('close', () => { if (!res.writableEnded) { upstreamRes?.destroy(); upstreamReq?.destroy(); void settle('client_disconnected_unknown'); } });
      if (body) upstreamReq.write(body);
      upstreamReq.end();
    } catch {
      await settle('gateway_error');
      if (!res.headersSent) json(res, 500, { error: { type: 'api_error', message: 'Lab gateway failed' } }); else res.destroy();
    }
  });
  server.keepAliveTimeout = 65000;
  return { server, flush: () => journal };
}

async function main() {
  const dir = process.env.LAB_USAGE_DIR || '/var/lib/harness-native-lab/meter';
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const config = {
    realKey: (await readFile(process.env.DEEPSEEK_KEY_FILE, 'utf8')).trim(),
    upstreamBase: 'https://api.deepseek.com/anthropic',
    logFile: resolve(dir, 'model-attempts.jsonl'),
    fx: Number(process.env.LAB_FX_RUB_PER_USD) || null,
    maxOutputTokens: Number(process.env.LAB_MAX_OUTPUT_TOKENS || 16384),
  };
  if (!config.realKey) throw new Error('Missing upstream credential');
  let registry;
  if (process.env.HARNESS_USAGE_PLATFORM_DB !== undefined) {
    const { openOperationResolver } = await import('./operation-resolver.mjs');
    registry = openOperationResolver(process.env.HARNESS_USAGE_PLATFORM_DB);
    config.resolveAttribution = registry.resolve;
  } else {
    config.virtualKey = (await readFile(process.env.LAB_GATEWAY_KEY_FILE, 'utf8')).trim();
    if (config.virtualKey.length < 24) throw new Error('Missing lab credential');
  }
  const { server } = createGateway(config);
  server.once('close', () => registry?.close());
  server.listen(Number(process.env.LAB_GATEWAY_PORT || 18442), '127.0.0.1', () => console.log('harness-native-model-gateway listening on loopback'));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => { console.error('Model gateway startup failed'); process.exit(1); });
