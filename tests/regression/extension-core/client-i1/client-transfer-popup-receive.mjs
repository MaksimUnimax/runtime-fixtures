import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const runtime = path.resolve(process.argv[2]);
const source = readFileSync(path.join(runtime, "popup.js"), "utf8");
const start = source.indexOf("function transferReceivePresentation(result)");
const end = source.indexOf("\nasync function requestTransferReceivePending()", start);
assert.ok(start >= 0 && end > start, "transferReceivePresentation must stay a standalone pure helper");
const helperSource = source.slice(start, end);
const transferReceivePresentation = new Function(`${helperSource}; return transferReceivePresentation;`)();

assert.deepEqual(transferReceivePresentation({ ok: true, importState: "IMPORTED", requestId: "request" }), { text: "Передача принята, ключи магазинов импортированы.", consume: true });
assert.deepEqual(transferReceivePresentation({ ok: true, importState: "CONFLICT" }), { text: "Передача получена, но импорт остановлен из-за конфликта магазина.", consume: false });
assert.deepEqual(transferReceivePresentation({ ok: false, code: "SOURCE_OFFLINE", importState: "SOURCE_OFFLINE" }), { text: "Источник ещё не доставил передачу.", consume: false });
assert.deepEqual(transferReceivePresentation({ ok: false, importState: "PENDING" }), { text: "Активной передачи для получения нет.", consume: false });
assert.equal(transferReceivePresentation({ ok: false, code: "TRANSFER_REPLAY" }), null);
assert.deepEqual(transferReceivePresentation({ ok: false, code: "TRANSFER_CREDENTIALS_MISSING", importState: "EMPTY_TRANSFER" }), { text: "В полученной передаче нет ключей. Ничего не импортировано.", consume: false });

assert.match(source, /chrome\.runtime\.sendMessage\(\{ type: "SA_TRANSFER_RECEIVE_PENDING", tab_id: tabId \}\)/);
assert.match(source, /transfer-receive[\s\S]*requestTransferReceivePending\(\)/);
assert.doesNotMatch(source, /request\("SA_TRANSFER_RECEIVE_PENDING"\)/);

const createStart = source.indexOf('$("transfer-create").onclick =');
const createEnd = source.indexOf('\n$("transfer-discover")', createStart);
const createHandler = source.slice(createStart, createEnd);
async function createRequest(selectedId, consent) {
  const elements = { "transfer-create": {}, "transfer-consent": { checked: consent }, "transfer-status": {} };
  const calls = [];
  const install = new Function("$", "action", "request", "selectedId", createHandler);
  install(id => elements[id], fn => fn(), async (type, body) => { calls.push({ type, body }); return { request: { expiresAt: new Date(Date.now() + 60000).toISOString() } }; }, selectedId);
  await elements["transfer-create"].onclick();
  return calls;
}
assert.deepEqual(await createRequest("", true), [{ type: "SA_TRANSFER_CREATE", body: { consent: true, selectedStoreIds: [] } }]);
assert.deepEqual(await createRequest("selected", true), [{ type: "SA_TRANSFER_CREATE", body: { consent: true, selectedStoreIds: ["selected"] } }]);
await assert.rejects(createRequest("", false), /согласие/);

console.log(JSON.stringify({ status: "PASS", scope: "A02_TRANSFER_POPUP_RECEIVE_OUTCOMES", cases: 9 }, null, 2));
