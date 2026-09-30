import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { makeWorker } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const popupJs = readFileSync(path.join(runtime, "popup.js"), "utf8");

function extract(source, begin, end) {
  const start = source.indexOf(begin);
  const finish = source.indexOf(end, start);
  assert.ok(start >= 0 && finish > start, `missing source block: ${begin}`);
  return source.slice(start, finish);
}

const requestStartSource = extract(
  popupJs,
  "async function requestStart(fields = {})",
  "\nfunction startStatusText",
);
const requestStart = new Function(
  "request",
  "texts",
  `${requestStartSource}; return requestStart;`,
)(
  async (_type, fields) => fields.response,
  { WORK_START_ALREADY_PENDING: "Запуск уже выполняется. Повторная инструкция не отправлена" },
);

await assert.rejects(
  requestStart({ response: { ok: true, accepted: false, code: "WORK_START_ALREADY_PENDING" } }),
  /Повторная инструкция не отправлена/,
);
await assert.rejects(
  requestStart({ response: { ok: true } }),
  /Запуск не подтверждён/,
);
assert.deepEqual(
  await requestStart({ response: { ok: true, accepted: true, pending_start: { revision: 1 } } }),
  { ok: true, accepted: true, pending_start: { revision: 1 } },
);

const startStatusSource = extract(
  popupJs,
  "function startStatusText(lastStart)",
  "\nfunction transferReceivePresentation",
);
const startStatusText = new Function(
  "texts",
  `${startStatusSource}; return startStatusText;`,
)({ WORK_START_ALREADY_PENDING: "Запуск уже выполняется. Повторная инструкция не отправлена" });
assert.equal(startStatusText(null), null);
assert.equal(startStatusText({ outcome: "active" }), null);
assert.match(startStatusText({ outcome: "sent_acknowledged" }), /инструкция отправлена/);
assert.match(startStatusText({ outcome: "unknown_no_retry" }), /повтор заблокирован/);
assert.match(startStatusText({ outcome: "pending" }), /ожидает подтверждения/);
assert.match(
  startStatusText({ outcome: "blocked", code: "WORK_START_ALREADY_PENDING" }),
  /Повторная инструкция не отправлена/,
);
assert.match(
  startStatusText({ outcome: "failed", code: "WORK_START_SEND_TARGET_UNAVAILABLE" }),
  /WORK_START_SEND_TARGET_UNAVAILABLE/,
);

const actionSuccessSource = extract(
  popupJs,
  "function actionSuccessText(result)",
  "\nfunction transferReceivePresentation",
);
const actionSource = extract(
  popupJs,
  "async function action(fn)",
  "\nfunction selected",
);
assert.match(popupJs, /popupAction: "WORK_START_ACCEPTED"/);

const createActionHarness = new Function(
  "requestImpl",
  "texts",
  "initialState",
  `
    let busy = false;
    let state = initialState;
    let refreshState = initialState;
    const statusNode = { textContent: "" };
    const $ = () => statusNode;
    const request = requestImpl;
    async function refresh() { state = refreshState; }
    ${requestStartSource}
    ${startStatusSource}
    ${actionSuccessSource}
    ${actionSource}
    return {
      statusNode,
      setRefreshState(value) { refreshState = value; },
      async runStart(response) {
        await action(async () => {
          await requestStart({ response });
          return { popupAction: "WORK_START_ACCEPTED" };
        });
        return statusNode.textContent;
      },
      async runGeneric() {
        await action(async () => ({ ok: true }));
        return statusNode.textContent;
      },
    };
  `,
);

const pendingHarness = createActionHarness(
  async (_type, fields) => fields.response,
  { WORK_START_ALREADY_PENDING: "Запуск уже выполняется. Повторная инструкция не отправлена" },
  {
    context: { work_active: false },
    work: { state: null },
    lastStart: { outcome: "pending", code: null },
  },
);
assert.match(
  await pendingHarness.runStart({ ok: true, accepted: true, start_intent_id: "intent-1" }),
  /ожидает подтверждения|Ожидаем подтверждение/,
);
assert.notEqual(pendingHarness.statusNode.textContent, "Готово");

const activeHarness = createActionHarness(
  async (_type, fields) => fields.response,
  {},
  { context: { work_active: false }, work: { state: null }, lastStart: null },
);
activeHarness.setRefreshState({
  context: { work_active: true },
  work: { state: "active_visible" },
  lastStart: { outcome: "active", code: null },
});
assert.equal(
  await activeHarness.runStart({ ok: true, accepted: true, start_intent_id: "intent-2" }),
  "Работа запущена",
);

const rejectedHarness = createActionHarness(
  async (_type, fields) => fields.response,
  { WORK_START_ALREADY_PENDING: "Запуск уже выполняется. Повторная инструкция не отправлена" },
  { context: { work_active: false }, work: { state: null }, lastStart: null },
);
assert.match(
  await rejectedHarness.runStart({ ok: true, accepted: false, code: "WORK_START_ALREADY_PENDING" }),
  /Повторная инструкция не отправлена/,
);
assert.match(
  await rejectedHarness.runStart({ ok: true }),
  /Запуск не подтверждён/,
);
assert.equal(await rejectedHarness.runGeneric(), "Готово");

const backing = {
  local: {
    ozmb_diagnostics: [
      {
        sequence: 1,
        event: "WORK_PENDING_START_TERMINAL",
        tab_id: 66,
        reason: "WORK_START_SEND_TARGET_UNAVAILABLE",
        conversation_id: "PRIVATE_CONVERSATION_66",
        prompt_text: "PRIVATE_PROMPT_66",
      },
      {
        sequence: 2,
        event: "WORK_START_ACTION_RESULT",
        tab_id: 77,
        stage: "not_accepted",
        code: "WORK_START_ALREADY_PENDING",
        outcome: "blocked",
        conversation_id: "PRIVATE_CONVERSATION_77",
      },
      {
        sequence: 3,
        event: "WORK_PENDING_START_TERMINAL",
        reason: "WORK_START_SHOULD_NOT_CROSS_TAB",
        conversation_id: "PRIVATE_UNSCOPED",
      },
    ],
  },
  session: {},
};
const worker = await makeWorker(runtime, {
  backing,
  userAgent: "Mozilla/5.0 Chrome/147.0.7727.116 Safari/537.36",
});
try {
  const tab77 = JSON.parse(JSON.stringify(
    (await worker.popup({ type: "SA_SUPPORT_SNAPSHOT", tab_id: 77 })).snapshot,
  ));
  assert.deepEqual(tab77.work.lastStart, {
    stage: "not_accepted",
    code: "WORK_START_ALREADY_PENDING",
    outcome: "blocked",
  });

  const tab66 = JSON.parse(JSON.stringify(
    (await worker.popup({ type: "SA_SUPPORT_SNAPSHOT", tab_id: 66 })).snapshot,
  ));
  assert.deepEqual(tab66.work.lastStart, {
    stage: "terminal",
    code: "WORK_START_SEND_TARGET_UNAVAILABLE",
    outcome: "failed",
  });

  const tab88 = JSON.parse(JSON.stringify(
    (await worker.popup({ type: "SA_SUPPORT_SNAPSHOT", tab_id: 88 })).snapshot,
  ));
  assert.equal(tab88.work.lastStart, null);

  for (const snapshot of [tab77, tab66, tab88]) {
    const serialized = JSON.stringify(snapshot);
    for (const forbidden of [
      "PRIVATE_CONVERSATION_66",
      "PRIVATE_PROMPT_66",
      "PRIVATE_CONVERSATION_77",
      "PRIVATE_UNSCOPED",
    ]) assert.equal(serialized.includes(forbidden), false, forbidden);
  }
} finally {
  worker.close();
}

const reopened = await makeWorker(runtime, {
  backing,
  seedAuthority: false,
  userAgent: "Mozilla/5.0 Chrome/147.0.7727.116 Safari/537.36",
});
try {
  const snapshot = JSON.parse(JSON.stringify(
    (await reopened.popup({ type: "SA_SUPPORT_SNAPSHOT", tab_id: 77 })).snapshot,
  ));
  assert.deepEqual(snapshot.work.lastStart, {
    stage: "not_accepted",
    code: "WORK_START_ALREADY_PENDING",
    outcome: "blocked",
  });
} finally {
  reopened.close();
}

console.log(JSON.stringify({
  status: "PASS",
  scope: "A06_START_ACTION_FEEDBACK_AND_TAB_SCOPED_DIAGNOSTICS",
  executionAuthority: false,
  providerCalls: 0,
}, null, 2));
