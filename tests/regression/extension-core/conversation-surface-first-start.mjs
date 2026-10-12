import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
const root = path.resolve(import.meta.dirname, "../../..");
const source = (name) => fs.readFileSync(path.join(root, name), "utf8");

function fixture() {
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
    getClientRects() { return this.hidden ? [] : [{}]; }
    getAttribute() { return null; }
  }
  let body = new Node(), mains = [], users = [], assistants = [];
  const composerRoot = new Node(body), composer = new Node(composerRoot);
  const adapter = { id: "alice", composerContext: () => ({ root: composerRoot, composer }),
    userMessages: () => users, assistantMessages: () => assistants,
    messageId: (node) => node.id, messageText: (node) => node.text };
  const context = { URL, TextEncoder, crypto: webcrypto,
    location: { origin: "https://alice.yandex.ru", pathname: "/", search: "", hash: "" },
    document: { get body() { return body; }, querySelectorAll: () => mains, querySelector: () => null } };
  vm.createContext(context);
  for (const file of ["packages/bridge-core/src/work/conversation-identity.js",
    "apps/extension/src/background/compat/conversation-identity.js",
    "apps/extension/src/content/conversation-surface.js"]) vm.runInContext(source(file), context);
  return { api: context.SellerAgentsConversationSurface, adapter, context, Node,
    addMessages(text = "Начальная инструкция") {
      users = [new Node(body, { id: "user-1", text })];
      assistants = [new Node(body, { id: "assistant-1", text: "Готово" })];
      context.location.pathname = "/chat/new-conversation/";
    },
    replaceBody() { body = new Node(); composerRoot.parent = body; },
    hiddenWitness() { users[0].hidden = true; },
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
const results = [];
for (const [name, run] of cases) {
  try { await run(); results.push({ name, status: "PASS" }); }
  catch (error) { results.push({ name, status: "FAIL", error: error.message }); }
}
console.log(JSON.stringify({ evidenceType: "SOURCE", results }, null, 2));
if (results.some((row) => row.status === "FAIL")) process.exitCode = 1;
