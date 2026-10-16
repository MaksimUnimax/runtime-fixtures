import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../../..");
const source = fs.readFileSync(path.join(root, "apps/extension/src/application/popup.js"), "utf8");
const first = source.indexOf("async function openKeyFiles(mode)"), last = source.indexOf('function invalidateBackupReview(', first);
assert.ok(first >= 0 && last > first, "native import entry extraction bounds");
const entry = source.slice(first, last), rows = [];
async function test(name, run) { try { await run(); rows.push({ name, status: "PASS" }); }
catch (error) { rows.push({ name, status: "FAIL", error: error.message }); } }
function fixture({ durable = false, firefox = false, deny = false } = {}) {
  const nodes = new Map(), calls = [];
  const node = id => { if (!nodes.has(id)) nodes.set(id, { focus() { calls.push("focus:" + id); }, scrollIntoView() { calls.push("scroll:" + id); } }); return nodes.get(id); };
  const open = options => { calls.push(options ? "chrome:" + options.windowId : "firefox"); return deny ? Promise.reject(new Error("denied")) : Promise.resolve(); };
  const ctx = { $: node, chrome: { sidePanel: { open } }, browser: firefox ? { sidebarAction: { open } } : undefined,
    close: () => calls.push("close") };
  vm.createContext(ctx); vm.runInContext("const durableImportMode=" + durable + "; const windowId=4;\n" + entry, ctx);
  return { ctx, node, calls };
}
await test("upload stays in the action popup and focuses its native file input", async () => {
  const f = fixture(); await f.node("keys-upload").onclick();
  assert.deepEqual(f.calls, ["scroll:backup", "focus:backup-file"]);
});
await test("the native file input is not intercepted or redirected", async () => {
  const f = fixture(); assert.equal(f.node("backup-file").onclick, undefined);
  assert.deepEqual(f.calls, []);
});
await test("Firefox also keeps the import in the action popup", async () => {
  const f = fixture({ firefox: true }); await f.node("keys-upload").onclick();
  assert.deepEqual(f.calls, ["scroll:backup", "focus:backup-file"]);
});
await test("popup import does not depend on side panel permission", async () => {
  const f = fixture({ deny: true }); await f.node("keys-upload").onclick();
  assert.deepEqual(f.calls, ["scroll:backup", "focus:backup-file"]);
});
await test("export focuses its password without changing the selected import file", async () => {
  const f = fixture(), files = [{ name: "selected-backup.json" }]; f.node("backup-file").files = files;
  await f.node("keys-download").onclick();
  assert.deepEqual(f.calls, ["scroll:backup", "focus:backup-password"]);
  assert.equal(f.node("backup-file").files, files);
});
console.log(JSON.stringify({ evidenceType: "SOURCE", results: rows }, null, 2));
if (rows.some(row => row.status !== "PASS")) process.exitCode = 1;
