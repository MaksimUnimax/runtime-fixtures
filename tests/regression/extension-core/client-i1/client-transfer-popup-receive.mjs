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

assert.deepEqual(transferReceivePresentation({ ok: true, importState: "IMPORTED", requestId: "request" }), { text: "Передача принята и магазин импортирован.", consume: true });
assert.deepEqual(transferReceivePresentation({ ok: true, importState: "CONFLICT" }), { text: "Передача получена, но импорт остановлен из-за конфликта магазина.", consume: false });
assert.deepEqual(transferReceivePresentation({ ok: false, code: "SOURCE_OFFLINE", importState: "SOURCE_OFFLINE" }), { text: "Источник ещё не доставил передачу.", consume: false });
assert.deepEqual(transferReceivePresentation({ ok: false, importState: "PENDING" }), { text: "Активной передачи для получения нет.", consume: false });
assert.equal(transferReceivePresentation({ ok: false, code: "TRANSFER_REPLAY" }), null);

assert.match(source, /chrome\.runtime\.sendMessage\(\{ type: "SA_TRANSFER_RECEIVE_PENDING", tab_id: tabId \}\)/);
assert.match(source, /transfer-receive[\s\S]*requestTransferReceivePending\(\)/);
assert.doesNotMatch(source, /request\("SA_TRANSFER_RECEIVE_PENDING"\)/);
console.log(JSON.stringify({ status: "PASS", scope: "A02_TRANSFER_POPUP_RECEIVE_OUTCOMES", cases: 5 }, null, 2));
