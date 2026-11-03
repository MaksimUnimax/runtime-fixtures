import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const runtime = path.resolve(process.argv[2]);
const source = fs.readFileSync(path.join(runtime, "content_script.js"), "utf8");
const adapterSource = fs.readFileSync(
  path.join(runtime, "shared/ai_adapters.js"),
  "utf8",
);
const ast = ts.createSourceFile(
  "actual-adapters.js",
  adapterSource,
  ts.ScriptTarget.Latest,
  true,
);
let alice;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "ALICE") {
    assert.equal(alice, undefined);
    alice = node.initializer.arguments[0];
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(alice);
function method(name) {
  const matches = alice.properties.filter((p) => p.name?.getText(ast) === name);
  assert.equal(matches.length, 1);
  return "(" + matches[0].getText(ast).replace(name, "function") + ")";
}
const start = source.indexOf("  async function runBatchDeliveryWatch(");
const end = source.indexOf("\n  function stopManualComposerWait", start);
assert.ok(start >= 0 && end > start);
const html = fs.readFileSync(
  path.join(
    root,
    "tests/regression/extension-core/fixtures/application-alice.html",
  ),
  "utf8",
);
const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
const canonical = (value) =>
  String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .trim();
const cases = [];
for (const spec of [
  { id: "real-fixture-one-click-exact-user-turn-confirms", expected: 1 },
  { id: "disabled-Send-is-not-Alice-ready", kind: "old-disabled", expected: 0 },
  {
    id: "different-user-text-does-not-confirm",
    kind: "changed-text",
    expected: 0,
  },
  { id: "non-user-role-does-not-confirm", kind: "changed-role", expected: 0 },
  {
    id: "ready-without-committed-click-does-not-confirm",
    kind: "no-click",
    expected: 0,
  },
  { id: "denied-commit-cannot-click-or-confirm", kind: "denied", expected: 0 },
]) {
  try {
    class Element {
      constructor(tag = "div") {
        this.tag = tag;
        this.dataset = {};
        this.children = [];
        this.events = {};
        this.attributes = {};
        this.isConnected = true;
        this.disabled = false;
        this.value = "";
        this.textContent = "";
        this.className = "";
        this.classList = { contains: () => false };
      }
      append(child) {
        child.parentElement = this;
        this.children.push(child);
      }
      replaceChildren() {
        this.children = [];
      }
      addEventListener(name, fn) {
        (this.events[name] ||= []).push(fn);
      }
      dispatchEvent(event) {
        for (const fn of this.events[event.type] || []) fn(event);
      }
      setAttribute(name, value) {
        this.attributes[name] = value;
      }
      getAttribute(name) {
        return this.attributes[name] ?? null;
      }
      getClientRects() {
        return [{}];
      }
      contains(node) {
        return node === composer || node === send;
      }
      matches(selector) {
        return (
          selector === '[data-message-role="user"]' &&
          this.dataset.messageRole === "user"
        );
      }
      closest(selector) {
        return selector === "[data-message-role]" ? this.parentElement : null;
      }
      querySelectorAll(selector) {
        return this.children.filter((n) =>
          selector.includes("AliceTextBubble")
            ? n.className.includes("AliceTextBubble")
            : selector.includes("data-filename")
              ? n.dataset.filename
              : false,
        );
      }
      querySelector() {
        return send;
      }
      click() {
        if (!this.disabled) {
          clicks++;
          this.dispatchEvent({ type: "click" });
          if (spec.kind === "old-disabled") {
            this.setAttribute("aria-label", "Отправить");
            this.disabled = true;
          }
          const user = turns.children.find(
            (n) => n.dataset.messageRole === "user",
          );
          if (user && spec.kind === "changed-text")
            user.children[0].textContent = "OTHER USER TEXT";
          if (user && spec.kind === "changed-role")
            user.dataset.messageRole = "alice";
        }
      }
    }
    const composer = new Element("textarea"),
      send = new Element("button"),
      turns = new Element(),
      attachments = new Element(),
      area = new Element();
    send.setAttribute("aria-label", "Отправить");
    send.disabled = true;
    let clicks = 0,
      commits = 0,
      confirmations = 0,
      running = true,
      wakes = 0;
    const timers = [],
      diagnostics = [];
    const context = vm.createContext({
      console,
      Set,
      Element,
      HTMLElement: Element,
      HTMLButtonElement: Element,
      InputEvent: class {
        constructor(type) {
          this.type = type;
        }
      },
      Event: class {
        constructor(type) {
          this.type = type;
        }
      },
      document: {
        createElement: (tag) => new Element(tag),
        body: new Element(),
        querySelector: (selector) =>
          ({
            "#turns": turns,
            "#attachments": attachments,
            '[data-testid="inputbase-textarea"]': composer,
            '[data-testid="oknyx"]': send,
          })[selector],
        querySelectorAll: () => attachments.children,
      },
      setTimeout: (fn) => timers.push(fn),
      visible: () => true,
      controlDisabled: (node) => node.disabled,
    });
    context.window = context;
    vm.runInContext(script, context);
    const classify = vm.runInContext(
      method("classifyComposerControl"),
      context,
    );
    const messageText = vm.runInContext(method("messageText"), context);
    const adapter = {
      id: "alice",
      userMessages: () =>
        turns.children.filter((n) => n.dataset.messageRole === "user"),
      messageId: (node) => node.id,
      messageText,
    };
    Object.assign(context, {
      activeDeliveryWatch: null,
      runtimeId: "synthetic-content",
      saContentContext: {},
      manualEnabled: true,
      manualConversationKey: "chat",
      DELIVERY_WATCH_INTERVAL_MS: 1,
      current: () => running,
      currentAIAdapter: () => adapter,
      sameConversation: () => true,
      conversationKeyFromLocation: () => "chat",
      canonicalText: canonical,
      userTurnIds: () => adapter.userMessages().map((n) => n.id),
      classifyComposerControl: () => {
        const value = classify({ root: area, composer });
        return {
          ...value,
          context: { root: area, composer },
          kind: value.kind === "ready" ? "alice_ready" : value.kind,
        };
      },
      primaryComposerContext: () => ({ root: area, composer }),
      composerText: () => composer.value,
      composerSendDeps: () => ({
        visible: () => true,
        readComposerText: () => composer.value,
      }),
      saCheckDelivery: async () => {},
      diagnosticForControlKind: (x) => x,
      recordContentDiagnostic: (name, fields) =>
        diagnostics.push({ name, code: fields?.code }),
      toast: () => {},
      setManualBridgeReady: () => {},
      waitForDeliveryWatchWake: async () => {
        if (++wakes > 4) running = false;
      },
      sleep: async () => {},
      stopDeliveryWatch: () => {
        context.activeDeliveryWatch = null;
        running = false;
      },
      sendRuntime: async (type, message) => {
        if (type === "OZ_WORK_SEND_COMMIT") {
          commits++;
          return {
            ok: spec.kind !== "denied",
            click_allowed: spec.kind !== "denied",
            send_click_committed: true,
            chatgpt_user_baseline: [],
          };
        }
        assert.equal(type, "OZ_BATCH_DELIVERY_COMPLETE");
        assert.equal(message.confirmation_basis, "alice_ready");
        assert.equal(message.confirmed_user_turn_id, "alice-user-sent-1");
        assert.equal(message.click_attempts, 1);
        confirmations++;
        return { ok: true };
      },
    });
    vm.runInContext(
      fs.readFileSync(path.join(runtime, "shared/composer_send.js"), "utf8"),
      context,
    );
    vm.runInContext(
      source.slice(start, end) + "\nglobalThis.watch = runBatchDeliveryWatch;",
      context,
    );
    if (spec.kind !== "no-click") {
      composer.value = "WB_BATCH_RESULT_V1\nFULL RAW REPORT";
      composer.dispatchEvent({ type: "input" });
    }
    await context.watch({
      delivery_mode: "batch_watch_v1",
      owner_kind: "manual",
      owner_id: "fixture",
      delivery_id: "fixture-delivery",
      conversation_key: "chat",
      origin: "https://alice.yandex.ru",
      conversation_id: "fixture",
      outgoing_text: "WB_BATCH_RESULT_V1\nFULL RAW REPORT",
    });
    assert.equal(confirmations, spec.expected, JSON.stringify(diagnostics));
    assert.equal(clicks, ["no-click", "denied"].includes(spec.kind) ? 0 : 1);
    assert.equal(commits, spec.kind === "no-click" ? 0 : 1);
    if (clicks)
      assert.equal(context.sent[0], "WB_BATCH_RESULT_V1\nFULL RAW REPORT");
    cases.push({ id: spec.id, status: "PASS", clicks, commits, confirmations });
  } catch (error) {
    cases.push({ id: spec.id, status: "FAIL", error: error.message });
  }
}
console.log(
  JSON.stringify(
    {
      scope:
        "actual fixture JS + actual adapter classifier/message reader + actual content delivery watch; bounded synthetic DOM/port, no browser/network/worker completion claim",
      cases,
    },
    null,
    2,
  ),
);
if (cases.some((c) => c.status === "FAIL")) process.exitCode = 1;
