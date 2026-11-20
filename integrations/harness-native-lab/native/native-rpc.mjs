import { randomUUID } from 'node:crypto';

/** Test/admin helper for the real native rc.1 protocol, never a product chat API. */
export class NativeRpc {
  constructor(baseURL, { headers = {}, fetchImpl = fetch } = {}) {
    this.baseURL = new URL(baseURL);
    this.headers = headers;
    this.fetch = fetchImpl;
    this.cookie = null;
  }

  async authenticate(entryURL) {
    const entry = new URL(entryURL);
    const token = entry.searchParams.get('token');
    if (!token) throw new Error('Native entry URL has no launch token');
    const target = new URL('/connect', this.baseURL);
    target.searchParams.set('token', token);
    target.searchParams.set('interactions', 'none');
    const response = await this.fetch(target, { headers: this.headers, redirect: 'manual' });
    const raw = response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie')].filter(Boolean);
    if (response.status !== 302 || raw.length === 0) throw new Error(`Native API token exchange failed (${response.status})`);
    this.cookie = raw.map(item => item.split(';', 1)[0]).join('; ');
  }

  async call(method, args = {}, { signal } = {}) {
    if (!this.cookie) throw new Error('Authenticate before native RPC');
    if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(method)) throw new Error('Invalid native Remote endpoint');
    const rpcId = randomUUID();
    const response = await this.fetch(new URL(`/api/${method}`, this.baseURL), {
      method: 'POST', signal,
      headers: { ...this.headers, 'Content-Type': 'application/json', Cookie: this.cookie },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } }),
    });
    if (!response.ok) throw new Error(`Native RPC ${method}: HTTP ${response.status}`);
    const envelope = await response.json();
    if (envelope.type !== 'server-response' || envelope.rpcId !== rpcId) throw new Error('Invalid native response envelope');
    if (!envelope.result?.ok) {
      const error = new Error(`Native RPC ${method}: ${envelope.result?.error?.code ?? 'unknown failure'}`);
      error.native = envelope.result?.error;
      throw error;
    }
    return envelope.result.value;
  }
  create(request = {}) { return this.call('session/create', { request }); }
  prompt(sessionId, text, requestId = randomUUID()) {
    return this.call('session/prompt', { request: { sessionId, requestId, mode: 'queue', content: [{ type: 'text', text }] } });
  }
  wait(sessionId, options = {}) { return this.call('session/wait', { request: { sessionId, timeoutMs: 60000, ...options } }); }
  events(sessionId, options = {}) { return this.call('session/events', { request: { address: { kind: 'session', sessionId }, maxMessages: 100, ...options } }); }
  selectModel(sessionId, model, reasoningEffort = 'off') { return this.call('session/selectModel', { request: { sessionId, provider: 'deepseek-official', model, reasoningEffort } }); }
}
