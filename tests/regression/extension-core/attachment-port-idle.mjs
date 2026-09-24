import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const runtimePath = path.resolve(process.argv[2]);
const contentSource = fs.readFileSync(path.join(runtimePath, 'attachment_delivery_port_content.js'), 'utf8');
const wakeSource = fs.readFileSync(path.join(runtimePath, 'attachment_delivery_wake_content.js'), 'utf8');
assert.doesNotMatch(contentSource, /RECOVERY_POLL_MS|setInterval\s*\(/, 'composed attachment runtime has no minute polling interval');
const conversationKey = 'https://chatgpt.com|idle-fixture-conversation';
const owner = { owner_kind: 'manual', owner_id: 'fixture-owner-1', delivery_id: 'fixture-delivery-1', conversation_key: conversationKey,
  origin: 'https://chatgpt.com', conversation_id: 'idle-fixture-conversation', delivery_mode: 'attachment_watch_v1', adapter_id: 'chatgpt' };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

class FakeHTMLElement {
  constructor() { this.style = {}; this.isConnected = false; this.textContent = ''; }
  appendChild(child) { child.isConnected = true; }
  remove() { this.isConnected = false; }
}

function makePage({ respond, disconnectFirst = false } = {}) {
  const page = { ports: [], requests: [], intervals: 0, wakeListener: null };
  const document = {
    querySelector: () => null,
    getElementById: () => null,
    createElement: () => new FakeHTMLElement(),
    documentElement: new FakeHTMLElement()
  };
  const identity = { status: 'confirmed', origin: 'https://chatgpt.com', ai_id: 'chatgpt', conversation_id: 'idle-fixture-conversation' };
  const activeAdapter = { id: 'chatgpt', composerContext: () => null };
  const event = () => {
    const listeners = [];
    return { addListener(fn) { listeners.push(fn); }, fire(value) { for (const fn of [...listeners]) fn(value); } };
  };
  const context = {
    console: { debug() {}, log() {}, warn() {}, error() {} },
    document,
    location: { origin: identity.origin, pathname: '/c/idle-fixture-conversation' },
    Element: class Element {}, HTMLElement: FakeHTMLElement,
    BB2ConversationIdentity: { resolveWithEvidence: () => identity },
    OzonAIAdapters: { adapterForLocation: () => activeAdapter },
    setTimeout, clearTimeout, setInterval(fn, ms) { page.intervals++; return setInterval(fn, ms); }, clearInterval,
    queueMicrotask,
    chrome: { runtime: {
      lastError: null,
      onMessage: event(),
      connect() {
        const port = { onMessage: event(), onDisconnect: event(), disconnected: false,
          postMessage(message) {
            page.requests.push(message);
            const requestIndex = page.requests.length;
            if (disconnectFirst && requestIndex === 2) { queueMicrotask(() => port.disconnect()); return; }
            Promise.resolve(respond?.(message, requestIndex)).then(response => {
              if (response === undefined || port.disconnected) return;
              queueMicrotask(() => port.onMessage.fire({ kind: 'response', request_id: message.request_id, response }));
            });
          },
          disconnect() { if (port.disconnected) return; port.disconnected = true; page.closes++; port.onDisconnect.fire(); }
        };
        page.closes ??= 0;
        page.ports.push(port);
        return port;
      }
    } }
  };
  context.globalThis = context;
  vm.runInNewContext(contentSource, context, { filename: 'attachment_delivery_port_content.js' });
  vm.runInNewContext(wakeSource, context, { filename: 'attachment_delivery_wake_content.js' });
  page.context = context;
  page.runtime = context.__OZON_ATTACHMENT_DELIVERY_PORT_RUNTIME__;
  page.wake = fields => context.chrome.runtime.onMessage.fire({ type: 'OZ_ATTACHMENT_DELIVERY_WAKE', ...fields });
  return page;
}

const terminal = { ok: true, recovery: null };
const startup = makePage({ respond: () => terminal });
await wait(320);
assert.equal(startup.requests.length, 1, 'one bounded startup recovery probe runs');
assert.equal(startup.ports.length, 1, 'startup probe connects on demand');
assert.equal(startup.closes, 1, 'idle startup probe intentionally disconnects');
assert.equal(startup.runtime.port, null);
assert.equal(startup.runtime.pending.size, 0);
assert.equal(startup.runtime.reconnect_timer, null);
assert.equal('poll_timer' in startup.runtime, false, 'runtime has no minute poll timer');
assert.equal(startup.intervals, 0, 'composed attachment runtime creates no interval');
await wait(80);
assert.equal(startup.requests.length, 1, 'idle runtime does not poll again');

const unsupported = { ...owner, delivery_phase: 'unsupported-fixture-phase' };
const targeted = makePage({ respond: async (_message, index) => {
  if (index === 1) return terminal;
  await wait(180);
  return { ok: true, recovery: unsupported };
} });
await wait(320);
assert.equal(targeted.runtime.port, null);
targeted.wake(owner);
await wait(80);
assert.equal(targeted.ports.length, 2, 'targeted wake reconnects from idle');
assert.equal(targeted.closes, 1, 'wake keeps its Port while recovery RPC is active');
const targetedRequest = targeted.requests.at(-1);
assert.equal(targetedRequest.owner_kind, owner.owner_kind);
assert.equal(targetedRequest.owner_id, owner.owner_id);
assert.equal(targetedRequest.delivery_id, owner.delivery_id);
assert.equal(targetedRequest.conversation_key, conversationKey);
await wait(300);
assert.equal(targeted.runtime.port, null, 'failed terminal recovery returns to idle');
assert.equal(targeted.runtime.reconnect_timer, null);
assert.equal(targeted.requests.length, 2, 'terminal failure did not start another recovery loop');

const disconnected = makePage({ disconnectFirst: true, respond: message => message.type === 'OZ_ATTACHMENT_RECOVERY_GET' ? { ok: true, recovery: unsupported } : terminal });
await wait(320);
disconnected.wake(owner);
await wait(650);
assert.equal(disconnected.requests.length, 3, 'active disconnect retries by re-reading recovery on a new Port');
assert.equal(disconnected.ports.length, 3, 'startup, failed active connection, and bounded reconnect are distinct');
assert.equal(disconnected.runtime.port, null, 'active recovery reconnect is released after terminal failure');
assert.equal(disconnected.runtime.reconnect_timer, null);

const cancelledRecovery = { ...owner, delivery_phase: 'attachment_claimed' };
const cancelled = makePage({ respond: (_message, index) => index === 2 ? { ok: true, recovery: cancelledRecovery } : terminal });
await wait(320);
cancelled.wake(owner);
await wait(300);
assert.equal(cancelled.runtime.port, null, 'cancelled active recovery releases its Port');
assert.equal(cancelled.runtime.reconnect_timer, null);
assert.equal(cancelled.runtime.active_tasks, 0);

console.log(JSON.stringify({ status: 'PASS', startup: true, targetedWake: true, activeReconnect: true, cancellation: true, failureCleanup: true }));
