import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const file = process.argv[2] || "/root/octoport-control/worktrees/A/a06-ack-popup-main03066-r1-20261008/apps/extension/src/application/popup.js";
const source = readFileSync(file, "utf8");
const textsStart = source.indexOf("const texts = {");
const textsEnd = source.indexOf("\nasync function request(", textsStart);
const presentationStart = source.indexOf("function transferReceivePresentation(");
const presentationEnd = source.indexOf("\nasync function action(", presentationStart);
assert.ok(textsStart >= 0 && textsEnd > textsStart && presentationStart > 0 && presentationEnd > presentationStart, "exact popup handlers present");
const handler = new Function("chrome", "tabId",
  source.slice(textsStart, textsEnd) + "\n" +
  source.slice(presentationStart, presentationEnd) + "\n" +
  "return requestTransferReceivePending;");
const secret = "SYNTHETIC_SECRET_MUST_NOT_BE_DISPLAYED";
const requestId = "fixture-request-id";
let cases = 0;

async function runCase(name, response, expected) {
  let sent = 0;
  const chrome = { runtime: { sendMessage: async message => {
    assert.equal(message.type, "SA_TRANSFER_RECEIVE_PENDING");
    assert.equal(message.tab_id, 3);
    sent += 1;
    return response;
  } } };
  const receive = handler(chrome, 3);
  if (expected.error) {
    await assert.rejects(receive(), err => {
      assert.ok(err instanceof Error);
      assert.match(err.message, expected.error);
      assert.equal(err.message.includes(secret), false);
      assert.equal(err.message.includes(requestId), false);
      if (expected.rejectText) assert.doesNotMatch(err.message, expected.rejectText);
      return true;
    }, name);
  } else {
    const returned = await receive();
    assert.equal(returned.response, response);
    assert.equal(returned.presentation.consume, expected.consume, name);
    assert.match(returned.presentation.text, expected.text, name);
    assert.equal(returned.presentation.text.includes(secret), false);
    assert.equal(returned.presentation.text.includes(requestId), false);
  }
  assert.equal(sent, 1);
  cases += 1;
  console.log("PASS", name);
}

await runCase("UNCONFIRMED_ACK_IMPORTED_PENDING_PRIVATE",
  { ok: false, code: "TRANSFER_ACK_UNCONFIRMED", importState: "IMPORTED_PENDING_ACK",
    ackConfirmed: false, requestId, result: { storeIds: ["synthetic"], secret } },
  { error: /сохранены локально.*не подтвердил/i, rejectText: /снова импортирован/i });

await runCase("UNVERIFIED_EXPIRY_WITH_PENDING_ACK_NOT_TERMINAL",
  { ok: false, code: "TRANSFER_EXPIRED", importState: "PENDING", ackConfirmed: false, requestId },
  { error: /не подтвердил завершение передачи/i, rejectText: /Создайте новый запрос/ });

await runCase("UNVERIFIED_REPLAY_WITH_PENDING_ACK_NOT_TERMINAL",
  { ok: false, code: "TRANSFER_REPLAY", importState: "PENDING", ackConfirmed: false, requestId },
  { error: /не импортируйте их повторно/i, rejectText: /уже завершена/ });

await runCase("CONFIRMED_TERMINAL_EXPIRY_RETAINS_TERMINAL_WARNING",
  { ok: false, code: "TRANSFER_EXPIRED", importState: "EXPIRED", ackConfirmed: false, requestId },
  { error: /Срок запроса передачи истёк/i });

await runCase("SERVER_REQUEST_MISMATCH_NO_STORE_DISCLOSURE",
  { ok: false, code: "TRANSFER_REQUEST_MISMATCH", importState: "IMPORTED_PENDING_ACK",
    ackConfirmed: false, requestId, result: { secret } },
  { error: /Ответ относится к другой передаче/i });

await runCase("LOCAL_ACCOUNT_MISMATCH_KEEPS_REFUSAL",
  { ok: false, code: "TRANSFER_ACCOUNT_MISMATCH", importState: "PENDING",
    ackConfirmed: false, requestId, result: { secret } },
  { error: /другому аккаунту или установке/i });

await runCase("AUTH_REQUIRED_PROMPTS_REAL_LOGIN_NOT_ACK_RETRY",
  { ok: false, code: "AUTH_REQUIRED", importState: "PENDING", ackConfirmed: false },
  { error: /Выполните вход через портал/i });

await runCase("SOURCE_OFFLINE_NONTERMINAL_PRESENTATION",
  { ok: false, code: "SOURCE_OFFLINE", importState: "SOURCE_OFFLINE" },
  { consume: false, text: /Источник ещё не доставил передачу/i });

await runCase("CONFIRMED_IMPORTED_CAN_CONSUME_ONCE",
  { ok: true, importState: "IMPORTED", requestId },
  { consume: true, text: /ключи магазинов импортированы/i });

await runCase("IMPORTED_WITHOUT_REQUEST_ID_CANNOT_CONSUME",
  { ok: true, importState: "IMPORTED" },
  { consume: false, text: /ключи магазинов импортированы/i });

await runCase("CONFLICT_NEVER_CONSUMES",
  { ok: true, importState: "CONFLICT", requestId },
  { consume: false, text: /из-за конфликта/i });

await runCase("CREDENTIALS_MISSING_NEVER_CLAIMS_IMPORT",
  { ok: false, code: "TRANSFER_CREDENTIALS_MISSING", requestId },
  { consume: false, text: /нет ключей/i });

await runCase("NO_ACTIVE_TRANSFER_REMAINS_PENDING_PRESENTATION",
  { ok: false, importState: "PENDING" },
  { consume: false, text: /Активной передачи.*нет/i });

assert.equal(cases, 13);
console.log(JSON.stringify({ status: "PASS", scope: "A06_PRIVACY_SAFE_UNCONFIRMED_ACK_POPUP",
  cases, data_is_synthetic: true, installed_browser: false }, null, 2));
