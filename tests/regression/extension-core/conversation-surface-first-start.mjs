import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { webcrypto, createHash } from "node:crypto";
const root = path.resolve(import.meta.dirname, "../../..");
const source = (name) => fs.readFileSync(path.join(root, name), "utf8");
function composedSource(name, target) {
  let result = source(name);
  for (const patch of JSON.parse(source("apps/extension/application-patches.json"))) {
    if (patch.target !== target) continue;
    assert.equal(result.split(patch.old).length - 1, 1, `Unique composed patch: ${target}`);
    let replacement = patch.new;
    if (patch.new_source !== undefined) {
      assert.equal(patch.new_source, "apps/extension/src/content/position-own-button.js");
      replacement = source(patch.new_source) + "\n";
      assert.equal(createHash("sha256").update(replacement).digest("hex"), patch.new_sha256);
    }
    result = result.replace(patch.old, replacement);
  }
  return result;
}

function fixture(provider = "alice") {
  let clock = 0;
  class Node {
    constructor(parent = null, { id = "", text = "", main = false, hidden = false } = {}) {
      Object.assign(this, { parent, id, text, main, hidden, isConnected: true });
    }
    contains(node) { for (let n = node; n; n = n.parent) if (n === this) return true; return false; }
    closest(selector) {
      for (let n = this; n; n = n.parent) {
        if (selector.includes("aria-hidden") ? n.hidden : n.main) return n;
      }
      return null;
    }
    getClientRects() { return this.hidden || this.noRect || !this.isConnected ? [] : [{}]; }
    getAttribute() { return null; }
  }
  let body = new Node(), mains = [], users = [], assistants = [];
  let desktopRoots = provider === "qwen" ? [new Node(body)] : [];
  if (provider === "qwen") mains = [new Node(desktopRoots[0], { main: true })];
  const composerRoot = new Node(mains[0] || body), composer = new Node(composerRoot);
  const adapter = { id: provider, composerContext: () => composer.isConnected ? ({ root: composerRoot, composer }) : null,
    userMessages: () => users, assistantMessages: () => assistants,
    messageId: (node) => node.id, messageText: (node) => node.text };
  const context = { URL, TextEncoder, crypto: webcrypto, Date: class extends Date { static now() { return clock; } },
    location: { origin: provider === "qwen" ? "https://chat.qwen.ai" : "https://alice.yandex.ru", pathname: "/", search: "", hash: "" },
    document: { get body() { return body; }, querySelectorAll: selector => selector === ".desktop-layout-content-inner" ? desktopRoots : mains, querySelector: () => null } };
  vm.createContext(context);
  for (const file of ["packages/bridge-core/src/work/conversation-identity.js",
    "apps/extension/src/background/compat/conversation-identity.js",
    "apps/extension/src/content/conversation-surface.js"]) vm.runInContext(source(file), context);
  return { api: context.SellerAgentsConversationSurface, adapter, context, Node,
    get user() { return users[0]; }, get assistant() { return assistants[0]; },
    advanceTime(ms) { clock += ms; },
    replaceUserNode() { users[0] = new Node(users[0].parent, { id: users[0].id, text: users[0].text }); },
    explicitIdentity(id) { desktopRoots[0].getAttribute = key => key === "data-chat-id" ? id : null; },
    addMessages(text = "Начальная инструкция") {
      if (provider === "qwen") {
        if (mains[0]) mains[0].isConnected = false;
        mains = [new Node(desktopRoots[0], { main: true })];
        composerRoot.parent = mains[0]; composer.isConnected = true;
      }
      const messageRoot = provider === "qwen" ? mains[0] : body;
      users = [new Node(messageRoot, { id: "user-1", text })];
      assistants = [new Node(messageRoot, { id: "assistant-1", text: "Готово" })];
      context.location.pathname = provider === "qwen" ? "/c/guest" : "/chat/new-conversation/";
    },
    remountGap() {
      for (const main of mains) main.isConnected = false;
      mains = []; composer.isConnected = false; users = []; assistants = [];
      context.location.pathname = "/c/new-chat";
    },
    partialRemountGap() {
      mains[0].noRect = true;
      composer.value = "Начальная инструкция";
      context.location.pathname = "/c/new-chat";
    },
    alterPartialGap(kind) {
      if (kind === "replacement main") {
        mains[0] = new Node(desktopRoots[0], { main: true }); mains[0].noRect = true;
        composerRoot.parent = mains[0];
      }
      if (kind === "replacement composer") {
        const other = new Node(composerRoot); other.value = composer.value;
        adapter.composerContext = () => ({ root: composerRoot, composer: other });
      }
      if (kind === "cleared prompt") composer.value = "";
      if (kind === "hidden old main") mains[0].hidden = true;
      if (kind === "hidden composer") composer.hidden = true;
      if (kind === "extra main") mains.push(new Node(desktopRoots[0], { main: true }));
    },
    hiddenMainInGap() { mains = [new Node(desktopRoots[0], { main: true, hidden: true })]; },
    hiddenMessageInGap() { users = [new Node(desktopRoots[0], { id: "hidden-1", text: "History", hidden: true })]; },
    hideDesktopRoot() { desktopRoots[0].hidden = true; },
    replaceBody() { body = new Node(); composerRoot.parent = body; },
    hiddenWitness() { users[0].hidden = true; },
    replaceDesktopRoot() { desktopRoots[0].isConnected = false; desktopRoots = [new Node(body)]; },
    duplicateDesktopRoot() { desktopRoots.push(new Node(body)); },
    splitMainRoots() {
      mains = [new Node(body, { main: true }), new Node(body, { main: true })];
      users[0].parent = mains[0]; assistants[0].parent = mains[1];
    } };
}
const cases = [
  ["mainless first Start keeps its surface only with the owned message witness", async () => {
    const f = fixture(), before = await f.api.ready(f.adapter);
    f.api.beginStart(f.adapter, "intent-1", "Начальная инструкция");
    f.addMessages();
    const after = await f.api.ready(f.adapter);
    assert.equal(after.status, "confirmed");
    assert.equal(after.surface_id, before.surface_id);
    assert.equal(before.conversation_id, null);
    assert.equal(after.conversation_id, "local:" + before.surface_id);
  }],
  ["same body and changed URL without the owned prompt do not authorize continuity", async () => {
    const f = fixture(), before = await f.api.ready(f.adapter);
    f.api.beginStart(f.adapter, "intent-1", "Начальная инструкция");
    f.addMessages("Чужое сообщение");
    const after = await f.api.ready(f.adapter);
    assert(after.status !== "confirmed" || after.surface_id !== before.surface_id, "unproved continuity must not authorize the pending surface");
  }],
  ["matching text on a replaced root is not a new witness", async () => {
    const f = fixture(), before = await f.api.ready(f.adapter);
    f.api.beginStart(f.adapter, "intent-1", "Начальная инструкция");
    f.replaceBody(); f.addMessages();
    const after = await f.api.ready(f.adapter);
    assert(after.status !== "confirmed" || after.surface_id !== before.surface_id, "unproved continuity must not authorize the pending surface");
  }],
  ["hidden matching message cannot prove first Start", async () => {
    const f = fixture(), before = await f.api.ready(f.adapter);
    f.api.beginStart(f.adapter, "intent-1", "Начальная инструкция");
    f.addMessages(); f.hiddenWitness();
    const after = await f.api.ready(f.adapter);
    assert(after.status !== "confirmed" || after.surface_id !== before.surface_id, "unproved continuity must not authorize the pending surface");
  }],
  ["multiple conversation main roots remain a conflict", async () => {
    const f = fixture(), before = await f.api.ready(f.adapter);
    f.api.beginStart(f.adapter, "intent-1", "Начальная инструкция");
    f.addMessages(); f.splitMainRoots();
    assert.notEqual((await f.api.ready(f.adapter)).status, "confirmed");
  }],
  ["ended Start cannot promote a later matching message", async () => {
    const f = fixture(), before = await f.api.ready(f.adapter);
    f.api.beginStart(f.adapter, "intent-1", "Начальная инструкция");
    f.api.endStart("intent-1");
    f.addMessages();
    assert.notEqual((await f.api.ready(f.adapter)).surface_id, before.surface_id);
  }],
];
for (const [name, change, success] of [
  ["Qwen remount with the exact owned message", () => {}, true],
  ["Qwen remount with unrelated user text", f => { f.addMessages("Foreign text"); }, false],
  ["Qwen remount with a hidden owned message", f => f.hiddenWitness(), false],
  ["Qwen remount under a replaced stable parent", f => { f.replaceDesktopRoot(); f.addMessages(); }, false],
  ["Qwen remount with multiple desktop parents", f => f.duplicateDesktopRoot(), false],
  ["Qwen remount with multiple conversation mains", f => f.splitMainRoots(), false],
]) cases.push([name, async () => {
  const f = fixture("qwen"), before = await f.api.ready(f.adapter);
  f.api.beginStart(f.adapter, "intent-qwen", "Начальная инструкция");
  f.addMessages(); change(f);
  const after = await f.api.ready(f.adapter);
  if (success) { assert.equal(after.status, "confirmed"); assert.equal(after.surface_id, before.surface_id); }
  else assert(after.status !== "confirmed" || after.surface_id !== before.surface_id, "unproved root continuity must remain blocked");
}]);

// Primary installed observation: one stable parent, then 351 ms with no
// main/composer/message, then new main and the owned message on /c/new-chat,
// followed by /c/guest. The empty frame must suspend effects, not lose Start.
cases.push(["Qwen empty remount gap preserves pending identity without authorizing effects", async () => {
  const f = fixture("qwen"), before = await f.api.ready(f.adapter);
  f.api.beginStart(f.adapter, "intent-qwen-gap", "Начальная инструкция");
  f.remountGap();
  for (let frame = 0; frame < 3; frame += 1) {
    const gap = await f.api.ready(f.adapter);
    assert.equal(gap.status, "unknown");
    assert.equal(gap.conversation_id, null);
    assert.equal(gap.surface_id, before.surface_id);
  }
  f.addMessages(); f.context.location.pathname = "/c/new-chat";
  const witnessed = await f.api.ready(f.adapter);
  assert.equal(witnessed.status, "confirmed");
  assert.equal(witnessed.surface_id, before.surface_id);
  f.context.location.pathname = "/c/guest";
  const promoted = await f.api.ready(f.adapter);
  assert.equal(promoted.status, "confirmed");
  assert.equal(promoted.surface_id, before.surface_id);
}]);
for (const [name, change] of [
  ["no Start", () => {}],
  ["ended Start", f => f.api.endStart("intent-qwen-gap")],
  ["different parent", f => f.replaceDesktopRoot()],
  ["duplicate parent", f => f.duplicateDesktopRoot()],
  ["hidden parent", f => f.hideDesktopRoot()],
  ["hidden main", f => f.hiddenMainInGap()],
  ["hidden history", f => f.hiddenMessageInGap()],
  ["different origin", f => { f.context.location.origin = "https://chatgpt.com"; }],
]) cases.push([`Qwen empty remount gap rejects ${name}`, async () => {
  const f = fixture("qwen"), before = await f.api.ready(f.adapter);
  if (name !== "no Start") f.api.beginStart(f.adapter, "intent-qwen-gap", "Начальная инструкция");
  f.remountGap(); change(f);
  const gap = await f.api.ready(f.adapter);
  assert.notEqual(gap.status, "confirmed");
  assert.notEqual(gap.surface_id, before.surface_id, "unproved gap must not retain the pending surface");
}]);

for (const [name, gapPath, landingPath] of [
  ["unrelated same-origin gap", "/c/existing-thread", "/c/existing-thread"],
  ["unrelated landing after observed gap", "/c/new-chat", "/c/existing-thread"],
  ["query-bearing transition", "/c/new-chat?thread=other", "/c/guest"],
]) cases.push([`Qwen ${name} cannot witness the same prompt`, async () => {
  const f = fixture("qwen"), before = await f.api.ready(f.adapter);
  f.api.beginStart(f.adapter, "intent-qwen-gap", "Начальная инструкция");
  f.remountGap(); f.context.location.pathname = gapPath;
  const gap = await f.api.ready(f.adapter);
  assert.notEqual(gap.status, "confirmed");
  f.addMessages(); f.context.location.pathname = landingPath;
  const after = await f.api.ready(f.adapter);
  assert.notEqual(after.surface_id, before.surface_id, "matching text in a different route must not bind the pending Work");
}]);
cases.push(["Qwen remount of a nonempty conversation cannot retain first-Start continuity", async () => {
  const f = fixture("qwen"); f.addMessages("Previous message");
  const before = await f.api.ready(f.adapter);
  f.api.beginStart(f.adapter, "intent-existing", "Начальная инструкция");
  f.remountGap(); const gap = await f.api.ready(f.adapter);
  assert.notEqual(gap.status, "confirmed");
  assert.notEqual(gap.surface_id, before.surface_id);
}]);

// Installed 0.2.18 primary trace: the SAME main loses its client rect while
// the SAME composer retains the pending prompt, before both are remounted.
cases.push(["Qwen partial remount retains observation but never authorizes effects", async () => {
  const f = fixture("qwen"), before = await f.api.ready(f.adapter);
  f.api.beginStart(f.adapter, "intent-partial", "Начальная инструкция");
  f.partialRemountGap();
  for (let frame = 0; frame < 3; frame += 1) {
    const gap = await f.api.ready(f.adapter);
    assert.equal(gap.surface_id, before.surface_id);
    assert.equal(gap.status, "unknown");
    assert.equal(gap.conversation_id, null);
  }
  f.addMessages(); f.context.location.pathname = "/c/new-chat";
  const witnessed = await f.api.ready(f.adapter);
  assert.equal(witnessed.status, "confirmed");
  assert.equal(witnessed.surface_id, before.surface_id);
  f.context.location.pathname = "/c/guest";
  assert.equal((await f.api.ready(f.adapter)).surface_id, before.surface_id);
}]);
for (const kind of ["replacement main", "replacement composer", "cleared prompt",
  "hidden old main", "hidden composer", "extra main"]) {
  cases.push([`Qwen partial remount rejects ${kind}`, async () => {
    const f = fixture("qwen"), before = await f.api.ready(f.adapter);
    f.api.beginStart(f.adapter, "intent-partial", "Начальная инструкция");
    f.partialRemountGap(); f.alterPartialGap(kind);
    const gap = await f.api.ready(f.adapter);
    assert.notEqual(gap.surface_id, before.surface_id);
    f.addMessages();
    assert.notEqual((await f.api.ready(f.adapter)).surface_id, before.surface_id);
  }]);
}

// Exercise the real Alice adapter against the observed author/bubble/control structure.
class AliceElement {
  constructor({ role = null, body = false, text = "", hidden = false } = {}) {
    Object.assign(this, { role, body, textContent: text, innerText: text, hidden, isConnected: true, children: [], parent: null });
  }
  append(child) { child.parent = this; this.children.push(child); return child; }
  matches(selector) { return selector === '[data-message-role="user"]' && this.role === "user"; }
  closest(selector) {
    for (let n = this; n; n = n.parent) {
      if (selector.includes("aria-hidden") ? n.hidden : Boolean(n.role)) return n;
    }
    return null;
  }
  querySelectorAll() { return this.children.flatMap(child => [...(child.body ? [child] : []), ...child.querySelectorAll()]); }
  getClientRects() { return this.hidden || !this.isConnected ? [] : [{}]; }
  getBoundingClientRect() { return { width: 100, height: 20 }; }
}
const aliceContext = { Element: AliceElement, HTMLElement: AliceElement,
  getComputedStyle: node => ({ display: node.hidden ? "none" : "block", visibility: "visible" }) };
// Use the same ordered adapter dependencies as the actual composition. A new
// packaged adapter must not require a second manually maintained fixture list.
const registrySource = "apps/extension/src/imported/ozon-v0.1.22/shared/ai_adapters.js";
const adapterSources = JSON.parse(source("apps/extension/composition.json"))
  .application_files["shared/ai_adapters.js"];
const registryIndex = adapterSources.indexOf(registrySource);
assert.ok(registryIndex > 0, "composition declares adapter dependencies before registry");
for (const file of adapterSources.slice(0, registryIndex))
  vm.runInNewContext(source(file), aliceContext);
vm.runInNewContext(composedSource(registrySource, "shared/ai_adapters.js"), aliceContext);
const realAlice = aliceContext.OzonAIAdapters.ADAPTERS.alice;
cases.push(["Alice exact prompt excludes author and Expand controls", async () => {
  const wrapper = new AliceElement({ role: "user", text: "Я\nНачальная инструкция\nРазвернуть" });
  wrapper.append(new AliceElement({ body: true, text: "Начальная инструкция" }));
  assert.equal(realAlice.messageText(wrapper), "Начальная инструкция");
  assert.equal(realAlice.messageText(new AliceElement({ role: "alice", text: "Готово" })), "Готово");
}]);
for (const variant of ["missing", "duplicate", "hidden", "disconnected", "nested_foreign_role"]) {
  cases.push([`Alice ${variant} semantic bubble cannot witness Start`, async () => {
    const wrapper = new AliceElement({ role: "user", text: "Начальная инструкция" });
    const bubble = new AliceElement({ body: true, text: "Начальная инструкция" });
    if (variant === "nested_foreign_role") wrapper.append(new AliceElement({ role: "user" })).append(bubble);
    else if (variant !== "missing") wrapper.append(bubble);
    if (variant === "duplicate") wrapper.append(new AliceElement({ body: true, text: "Начальная инструкция" }));
    if (variant === "hidden") bubble.hidden = true;
    if (variant === "disconnected") bubble.isConnected = false;
    assert.equal(realAlice.messageText(wrapper), "");
  }]);
}
function responseWatchFixture() {
  const content = composedSource("apps/extension/src/imported/ozon-v0.1.22/content_script.js", "content_script.js");
  const begin = content.indexOf("  function setWorkStartObservationNotice("), end = content.indexOf("  async function sendWorkSessionPrompt(", begin);
  assert(begin >= 0 && end > begin);
  const timers = new Map(), watches = new Map(), calls = [], events = [], notices = [];
  let timerId = 0, live = true, now = 0;
  const identity = { origin: "https://chatgpt.com", ai_id: "chatgpt", conversation_id: "owned-dialogue" };
  const context = { SellerAgentsConversationSurface: { endStart: () => {} }, workStartWatches: watches, workRuntimeGeneration: "owned-runtime", Date: { now: () => now },
    setInterval: callback => { const id = ++timerId; timers.set(id, callback); return id; },
    clearInterval: id => timers.delete(id), current: () => live, conversationIdentity: () => identity,
    assistantMessages: () => [{ id: "new-assistant", text: "Observed reply" }], assistantMessageText: item => item.text,
    clearToast: key => notices.push({ clear: key }), toast: (text, level, duration, key) => notices.push({ text, level, duration, key }),
    currentAIAdapter: () => ({ messageId: x => x.id }),
    assistantTurnComplete: () => true, recordContentDiagnostic: (event, detail) => events.push({ event, ...detail }),
    sendRuntime: (type, detail) => new Promise((resolve, reject) => calls.push({ type, detail, resolve, reject })) };
  vm.runInNewContext(content.slice(begin, end), context);
  const start = () => context.startWorkStartResponseWatch({ intentId: "one-start", revision: 1, origin: identity.origin, aiId: identity.ai_id, assistantBaselineIds: [] });
  return { start, calls, events, identity, watches, stop: () => context.stopWorkStartWatch("one-start", 1),
    tick: () => { for (const callback of [...timers.values()]) callback(); },
    dispose: () => { live = false; }, expire: () => { now = 120001; } };
}
const drain = () => new Promise(resolve => setImmediate(resolve));
cases.push(["slow worker binding allows only one in-flight observer request", async () => {
  const f = responseWatchFixture(); f.start(); f.tick(); f.tick(); f.tick();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].type, "OZ_WORK_PENDING_IDENTITY");
  f.calls[0].resolve({ ok: true, waiting: true }); await drain(); f.tick();
  assert.equal(f.calls.length, 2, "only an acknowledged waiting state can be observed again");
  f.calls[1].resolve({ ok: true }); await drain(); f.tick();
  assert.equal(f.calls.length, 2); assert.equal(f.watches.size, 0);
  assert.equal(f.events.at(-1).reason, "active_visible");
}]);
cases.push(["lost worker response ends observation without a second binding or Send", async () => {
  const f = responseWatchFixture(); f.start(); f.tick(); f.calls[0].reject(new Error("transport lost"));
  await drain(); f.tick(); assert.equal(f.calls.length, 1); assert.equal(f.watches.size, 0);
  assert.equal(f.events.at(-1).reason, "worker_response_unavailable");
}]);
cases.push(["late response cannot terminate a replacement watch", async () => {
  const f = responseWatchFixture(); f.start(); f.tick(); f.stop(); f.start();
  f.calls[0].resolve({ ok: true }); await drain(); assert.equal(f.watches.size, 1);
  f.tick(); assert.equal(f.calls.length, 2); f.calls[1].resolve({ ok: true }); await drain();
  assert.equal(f.watches.size, 0);
}]);
for (const [boundary, prepare, expected] of [
  ["runtime disposed", f => f.dispose(), null],
  ["deadline expired", f => f.expire(), "OZ_WORK_PENDING_TIMEOUT"],
  ["provider identity changed", f => { f.identity.ai_id = "alice"; }, "OZ_WORK_PENDING_CANCEL"],
]) cases.push([`response watch preserves ${boundary} fence`, async () => {
  const f = responseWatchFixture(); f.start(); prepare(f); f.tick();
  assert.equal(f.watches.size, 0);
  assert.equal(f.calls.length, expected ? 1 : 0);
  if (expected) { assert.equal(f.calls[0].type, expected); f.calls[0].resolve({ ok: true }); }
  await drain(); f.tick(); assert.equal(f.calls.length, expected ? 1 : 0);
}]);
for (const [boundary, prepare, reason] of [
  ["deadline", f => f.expire(), "worker_response_unavailable"],
  ["runtime disposal", f => f.dispose(), "runtime_disposed"],
]) cases.push([`held worker callback cannot outlive ${boundary}`, async () => {
  const f = responseWatchFixture(); f.start(); f.tick(); assert.equal(f.calls.length, 1);
  prepare(f); f.tick(); assert.equal(f.watches.size, 0); assert.equal(f.calls.length, 1);
  assert.equal(f.events.at(-1).reason, reason);
  f.calls[0].resolve({ ok: true }); await drain(); f.tick();
  assert.equal(f.calls.length, 1, "unknown worker outcome must not issue cancel, retry, or Send");
}]);
for (const code of ["WORK_START_SEND_OUTCOME_UNKNOWN_NO_RETRY", "WORK_START_SEND_NOT_ACKNOWLEDGED"]) {
  cases.push([`negative waiting response ${code} never retries observation`, async () => {
    const f = responseWatchFixture(); f.start(); f.tick();
    f.calls[0].resolve({ ok: false, waiting: true, code }); await drain(); f.tick();
    assert.equal(f.calls.length, 1); assert.equal(f.watches.size, 0); assert.equal(f.events.at(-1).reason, code);
  }]);
}

async function qwenRenameFixture(activeBeforeGuest = false) {
  const f = fixture("qwen"), before = await f.api.ready(f.adapter);
  f.api.beginStart(f.adapter, "rename-intent", "Начальная инструкция");
  f.partialRemountGap();
  assert.equal((await f.api.ready(f.adapter)).source, "pending_route_continuity");
  f.addMessages("");
  f.assistant.id = "";
  f.context.location.pathname = "/c/new-chat";
  await f.api.ready(f.adapter);
  f.user.text = "Начальная инструкция";
  assert.equal((await f.api.ready(f.adapter)).status, "confirmed");
  if (activeBeforeGuest) f.api.endStart("rename-intent", "active_visible");
  f.context.location.pathname = "/c/guest";
  const guest = await f.api.ready(f.adapter);
  assert.equal(guest.status, "confirmed");
  assert.equal(guest.surface_id, before.surface_id);
  return { f, before };
}
for (const active of [false, true]) cases.push(["Qwen ID rename preserves owned node " + (active ? "after active_visible" : "while pending"), async () => {
  const { f, before } = await qwenRenameFixture();
  if (active) f.api.endStart("rename-intent", "active_visible");
  f.user.id = "user-server"; f.assistant.id = "assistant-server";
  const after = await f.api.ready(f.adapter);
  assert.equal(after.status, "confirmed");
  assert.equal(after.surface_id, before.surface_id);
  assert.equal(after.conversation_id, "local:" + before.surface_id);
  assert.deepEqual(Array.from(after.identity_evidence.message_ids), ["user-server", "assistant-server"]);
  assert.equal((await f.api.ready(f.adapter)).status, "confirmed");
}]);
for (const [kind, alter] of [
  ["replacement node with the same text", f => f.replaceUserNode()],
  ["changed text", f => { f.user.text = "Другой запрос"; }],
  ["hidden node", f => { f.user.hidden = true; }],
  ["disconnected node", f => { f.user.isConnected = false; }],
  ["replaced root", f => f.replaceDesktopRoot()],
  ["ambiguous roots", f => f.duplicateDesktopRoot()],
  ["changed route", f => { f.context.location.pathname = "/c/other"; }],
  ["changed origin", f => { f.context.location.origin = "https://example.invalid"; }],
  ["cancelled Start", f => f.api.endStart("rename-intent", "cancelled")],
  ["timed out Start", f => f.api.endStart("rename-intent", "response_timeout")],
  ["expired observation", f => f.advanceTime(120001)],
  ["duplicate current ID", f => { f.assistant.id = "user-server"; }],
  ["conflicting external identity", f => f.explicitIdentity("different-conversation")],
]) cases.push(["Qwen ID rename refuses " + kind, async () => {
  const { f, before } = await qwenRenameFixture();
  f.user.id = "user-server"; f.assistant.id = "assistant-server";
  alter(f);
  const after = await f.api.ready(f.adapter);
  assert(after.status !== "confirmed" || after.surface_id !== before.surface_id,
    "unproved ID replacement cannot continue the owned Start");
}]);
cases.push(["Qwen ID rename is single-use even after active_visible", async () => {
  const { f, before } = await qwenRenameFixture();
  f.api.endStart("rename-intent", "active_visible");
  f.user.id = "user-server"; f.assistant.id = "assistant-server";
  assert.equal((await f.api.ready(f.adapter)).status, "confirmed");
  f.user.id = "user-third"; f.assistant.id = "assistant-third";
  const after = await f.api.ready(f.adapter);
  assert(after.status !== "confirmed" || after.surface_id !== before.surface_id);
}]);
cases.push(["Qwen ID rename cannot revive after a witnessed text mismatch", async () => {
  const { f, before } = await qwenRenameFixture();
  f.user.text = "Different"; await f.api.ready(f.adapter);
  f.user.text = "Начальная инструкция";
  f.user.id = "user-server"; f.assistant.id = "assistant-server";
  const after = await f.api.ready(f.adapter);
  assert(after.status !== "confirmed" || after.surface_id !== before.surface_id);
}]);

cases.push(["Qwen ID rename survives active_visible before guest route promotion", async () => {
  const { f, before } = await qwenRenameFixture(true);
  f.user.id = "user-server"; f.assistant.id = "assistant-server";
  const after = await f.api.ready(f.adapter);
  assert.equal(after.status, "confirmed");
  assert.equal(after.surface_id, before.surface_id);
  assert.deepEqual(Array.from(after.identity_evidence.message_ids), ["user-server", "assistant-server"]);
}]);

cases.push(["Qwen ID rename early-active retention never permits another final route", async () => {
  const f = fixture("qwen"), before = await f.api.ready(f.adapter);
  f.api.beginStart(f.adapter, "rename-intent", "Начальная инструкция");
  f.addMessages(); f.context.location.pathname = "/c/new-chat";
  assert.equal((await f.api.ready(f.adapter)).surface_id, before.surface_id);
  f.api.endStart("rename-intent", "active_visible");
  f.context.location.pathname = "/c/another";
  const after = await f.api.ready(f.adapter);
  assert(after.status !== "confirmed" || after.surface_id !== before.surface_id);
}]);
cases.push(["Qwen ID rename completed guest promotion cannot authorize later navigation", async () => {
  const { f, before } = await qwenRenameFixture(true);
  f.context.location.pathname = "/c/another";
  const after = await f.api.ready(f.adapter);
  assert(after.status !== "confirmed" || after.surface_id !== before.surface_id);
}]);

const results = [];
for (const [name, run] of cases) {
  try { await run(); results.push({ name, status: "PASS" }); }
  catch (error) { results.push({ name, status: "FAIL", error: error.message }); }
}
console.log(JSON.stringify({ evidenceType: "SOURCE", results }, null, 2));
if (results.some((row) => row.status === "FAIL")) process.exitCode = 1;
