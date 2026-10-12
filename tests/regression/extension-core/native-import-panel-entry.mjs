import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../../..");
const source = fs.readFileSync(path.join(root, "apps/extension/src/application/popup.js"), "utf8");
const first = source.indexOf("async function openKeyFiles(mode)"), last = source.indexOf('function invalidateBackupReview()', first);
const entry = source.slice(first, last), rows = [];
async function test(name, run) { try { await run(); rows.push({ name, status: "PASS" }); }
catch (error) { rows.push({ name, status: "FAIL", error: error.message }); } }
function fixture({ durable = false, firefox = false, deny = false } = {}) {
  const nodes = new Map(), calls = [];
  const node = id => { if (!nodes.has(id)) nodes.set(id, { focus() { calls.push("focus:" + id); }, scrollIntoView() {} }); return nodes.get(id); };
  const open = options => { calls.push(options ? "chrome:" + options.windowId : "firefox"); return deny ? Promise.reject(new Error("denied")) : Promise.resolve(); };
  const ctx = { $: node, chrome: { sidePanel: { open } }, browser: firefox ? { sidebarAction: { open } } : undefined,
    close: () => calls.push("close") };
  vm.createContext(ctx); vm.runInContext("const durableImportMode=" + durable + "; const windowId=4;\n" + entry, ctx);
  return { ctx, node, calls };
}
await test("Chrome upload opens the same-window panel before closing popup", async () => {
  const f = fixture(); await f.node("keys-upload").onclick(); assert.deepEqual(f.calls, ["chrome:4", "close"]);
});
await test("direct file click in popup is redirected to the durable panel", async () => {
  const f = fixture(); let prevented = 0;
  await f.node("backup-file").onclick({ preventDefault() { prevented++; } });
  assert.equal(prevented, 1); assert.deepEqual(f.calls, ["chrome:4", "close"]);
});
await test("Firefox uses its declared sidebar without creating a tab", async () => {
  const f = fixture({ firefox: true }); await f.node("keys-upload").onclick(); assert.deepEqual(f.calls, ["firefox", "close"]);
});
await test("panel refusal stays visible and does not close or fall back to another route", async () => {
  const f = fixture({ deny: true }); await f.node("keys-upload").onclick();
  assert.deepEqual(f.calls, ["chrome:4"]); assert.match(f.node("status").textContent, /Не удалось открыть/);
});
await test("durable panel retains the ordinary native file input", async () => {
  const f = fixture({ durable: true }); await f.node("keys-upload").onclick();
  assert.deepEqual(f.calls, ["focus:backup-file"]); assert.equal(f.node("backup-file").onclick, undefined);
});
console.log(JSON.stringify({ evidenceType: "SOURCE", results: rows }, null, 2));
if (rows.some(row => row.status !== "PASS")) process.exitCode = 1;
