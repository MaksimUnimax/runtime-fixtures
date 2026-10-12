import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../../..");
const source = fs.readFileSync(path.join(root, "apps/extension/src/background/compat/qwen-code-reader.js"), "utf8");
function fixture(text = "OZON_HELP_V2 " + "{}") {
  let unrelatedReads = 0, scriptCalls = 0;
  const markdown = { type: "code", text }, props = { token: markdown };
  Object.defineProperty(props, "auth", { get() { unrelatedReads++; throw new Error("forbidden unrelated state"); } });
  const component = { memoizedProps: props };
  Object.defineProperty(component, "memoizedState", { get() { unrelatedReads++; throw new Error("forbidden component state"); } });
  const block = { isConnected: true, textContent: "text1VISIBLE_TRUNCATED", __reactFiber$test: { return: component }, closest: () => section };
  const id = { closest: () => section, getAttribute: () => "message-1" };
  const section = { isConnected: true, closest: () => section, getAttribute: () => null,
    querySelectorAll: selector => selector === "[data-msg-id]" ? [id] : [block] };
  let sections = [section], currentUrl = "https://chat.qwen.ai/c/guest";
  const ctx = { URL, location: { origin: "https://chat.qwen.ai", href: currentUrl },
    document: { querySelectorAll: () => sections },
    saBrowserPage: async () => ({ url: currentUrl, origin: new URL(currentUrl).origin, aiFamily: "qwen" }),
    chrome: { runtime: { id: "extension-id" }, scripting: { executeScript: async options => {
      scriptCalls++;
      assert.equal(options.world, "MAIN");
      assert.deepEqual(JSON.parse(JSON.stringify(options.target)), { tabId: 7, documentIds: ["document-1"] });
      const result = options.func(...options.args);
      return [{ documentId: "document-1", frameId: 0, result }];
    } } }
  };
  vm.createContext(ctx); vm.runInContext(source, ctx);
  return { ctx, block, props, markdown, section,
    sender: { id: "extension-id", tab: { id: 7 }, frameId: 0, documentId: "document-1", url: currentUrl },
    message: { type: "OZ_QWEN_READ_CODE", messageId: "message-1", blockOrdinal: 0 },
    duplicate() { sections = [section, section]; },
    navigate() { currentUrl = "https://chat.qwen.ai/c/another"; },
    counts: () => ({ unrelatedReads, scriptCalls }) };
}
const rows = [];
async function test(name, run) {
  try { await run(); rows.push({ name, status: "PASS" }); }
  catch (error) { rows.push({ name, status: "FAIL", error: error.message }); }
}
await test("complete long Markdown code survives virtualized visible lines", async () => {
  const text = Array.from({ length: 2000 }, (_, i) => "public-line-" + i).join("\n"), f = fixture(text);
  const result = await f.ctx.saReadQwenCode(f.message, f.sender);
  assert.equal(result.text, text); assert.equal(result.ok, true);
  assert.equal(f.counts().unrelatedReads, 0); assert.equal(f.counts().scriptCalls, 1);
});
await test("unknown Markdown shape has no truncated DOM fallback", async () => {
  const f = fixture(); delete f.props.token;
  assert.equal((await f.ctx.saReadQwenCode(f.message, f.sender)).ok, false);
});
await test("code accessors are not invoked", async () => {
  const f = fixture(); let reads = 0;
  Object.defineProperty(f.markdown, "text", { get() { reads++; return "secret"; } });
  assert.equal((await f.ctx.saReadQwenCode(f.message, f.sender)).ok, false); assert.equal(reads, 0);
});
await test("duplicate provider message identity is rejected", async () => {
  const f = fixture(); f.duplicate(); assert.equal((await f.ctx.saReadQwenCode(f.message, f.sender)).ok, false);
});
await test("oversized code is rejected before crossing to content", async () => {
  const f = fixture("x".repeat(524289)); assert.equal((await f.ctx.saReadQwenCode(f.message, f.sender)).ok, false);
});
await test("wrong sender origin/frame/extension/document never injects", async () => {
  for (const change of [{ id: "another" }, { frameId: 1 }, { url: "https://chatgpt.com/" }, { documentId: "" }, { tab: null }]) {
    const f = fixture(); assert.equal((await f.ctx.saReadQwenCode(f.message, { ...f.sender, ...change })).ok, false);
    assert.equal(f.counts().scriptCalls, 0);
  }
});
await test("invalid block identifiers never inject", async () => {
  for (const change of [{ blockOrdinal: -1 }, { blockOrdinal: 128 }, { blockOrdinal: "0" }, { messageId: "" }, { messageId: "a\nb" }]) {
    const f = fixture(); assert.equal((await f.ctx.saReadQwenCode({ ...f.message, ...change }, f.sender)).ok, false);
    assert.equal(f.counts().scriptCalls, 0);
  }
});
await test("navigation during the read discards the returned text", async () => {
  const f = fixture(), execute = f.ctx.chrome.scripting.executeScript;
  f.ctx.chrome.scripting.executeScript = async options => { const result = await execute(options); f.navigate(); return result; };
  assert.equal((await f.ctx.saReadQwenCode(f.message, f.sender)).code, "QWEN_CODE_CONTEXT_CHANGED");
});
await test("browser document mismatch discards the returned text", async () => {
  const f = fixture(), execute = f.ctx.chrome.scripting.executeScript;
  f.ctx.chrome.scripting.executeScript = async options => { const result = await execute(options); result[0].documentId = "other"; return result; };
  assert.equal((await f.ctx.saReadQwenCode(f.message, f.sender)).ok, false);
});
console.log(JSON.stringify({ evidenceType: "SOURCE", results: rows }, null, 2));
if (rows.some(row => row.status !== "PASS")) process.exitCode = 1;
