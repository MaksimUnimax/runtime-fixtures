import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { makeWorker, signFixtureBootstrap } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const popupHtml = readFileSync(path.join(runtime, "popup.html"), "utf8");
const popupJs = readFileSync(path.join(runtime, "popup.js"), "utf8");
assert.match(popupHtml, /id="support-generate"/);
assert.match(popupHtml, /id="support-snapshot"[^>]*readonly/);
assert.match(popupHtml, /никуда не отправляется автоматически/);
assert.match(popupHtml, /только наблюдаемая среда/);
assert.match(popupHtml, /id="compatibility-note"/);
assert.match(popupJs, /request\("SA_SUPPORT_SNAPSHOT"\)/);
assert.match(popupJs, /support-snapshot/);
assert.match(popupJs, /UPDATE_RECOMMENDED/);
assert.match(popupJs, /Текущая версия пока разрешена/);
assert.match(popupJs, /async function requestStart/);
assert.match(popupJs, /response\?\.accepted !== true/);
assert.match(
  popupJs,
  /WORK_START_ALREADY_PENDING: "Запуск уже выполняется\. Повторная инструкция не отправлена"/,
);
// Exercise the actual packaged entry rather than requiring adjacent statements:
// Start now creates an intent before awaiting the accepted worker response.
const requestStartBegin = popupJs.indexOf("async function requestStart(");
const requestStartEnd = popupJs.indexOf("\nfunction ", requestStartBegin + 1);
const startBegin = popupJs.indexOf('$("start").onclick =');
const startEnd = popupJs.indexOf('$("confirm").onclick =', startBegin);
assert.ok(requestStartBegin >= 0 && requestStartEnd > requestStartBegin);
assert.ok(startBegin >= 0 && startEnd > startBegin);
const startEntry = popupJs.slice(requestStartBegin, requestStartEnd)
  + popupJs.slice(startBegin, startEnd);
for (const changeStore of [false, true]) {
  for (const accepted of [false, true]) {
    const calls = [], start = {};
    let resolveResponse, confirmation, result, settled = false, sequence = 0;
    const response = new Promise(resolve => { resolveResponse = resolve; });
    const context = vm.createContext({
      $: id => { assert.equal(id, "start"); return start; },
      selectedId: "selected-store",
      state: { context: { store_id: changeStore ? "previous-store" : null } },
      texts: {},
      crypto: { randomUUID: () => `start-intent-${++sequence}` },
      request: async (type, fields) => {
        calls.push({ type, ...fields });
        return response;
      },
      action: fn => { result = fn(); },
      confirm: (_message, fn) => { confirmation = fn; },
    });
    vm.runInContext(startEntry, context, { filename: "packaged-popup-start-entry.js" });
    start.onclick();
    if (changeStore) {
      assert.equal(calls.length, 0, "changing store requires explicit confirmation");
      assert.equal(result, undefined);
      assert.equal(typeof confirmation, "function");
      context.selectedId = "later-selection";
      result = confirmation();
    } else assert.equal(confirmation, undefined);
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{
      type: "SA_WORK_START", store_id: "selected-store", confirm_change: changeStore,
      start_intent_id: "start-intent-1",
    }]);
    const observed = result.then(
      value => { settled = true; return { value }; },
      error => { settled = true; return { error }; },
    );
    for (let turn = 0; turn < 8; turn++) await Promise.resolve();
    assert.equal(settled, false, "popup must await the worker response before reporting acceptance");
    resolveResponse({ accepted, prompt_tree_available: true, prompt_tree_warning: null });
    const outcome = await observed;
    if (accepted) {
      assert.equal(outcome.error, undefined);
      assert.deepEqual(JSON.parse(JSON.stringify(outcome.value)), {
        popupAction: "WORK_START_ACCEPTED", startIntentId: "start-intent-1",
        storeId: "selected-store", promptTreeAvailable: true, promptTreeWarning: null,
      });
    } else {
      assert.match(outcome.error?.message ?? "", /Запуск не подтверждён/);
      assert.equal(outcome.value, undefined);
    }
    assert.equal(calls.length, 1, "response handling must not resend Start");
  }
}
const worker = await makeWorker(runtime, {
  userAgent: "Mozilla/5.0 Chrome/147.0.7727.116 Safari/537.36",
});
try {
  const ozon = await worker.popup({
    type: "SA_STORE_SAVE",
    store: {
      marketplace: "ozon",
      name: "PRIVATE_OZON_NAME",
      personalDataEnabled: false,
      credentials: {
        seller: { clientId: "123456", apiKey: "A06_OZON_SECRET" },
        performance: {},
      },
    },
  });
  const wb = await worker.popup({
    type: "SA_STORE_SAVE",
    store: {
      marketplace: "wildberries",
      name: "PRIVATE_WB_NAME",
      personalDataEnabled: false,
      credentials: { token: "A06_WB_SECRET_TOKEN_1234567890" },
    },
  });
  const response = await worker.popup({ type: "SA_SUPPORT_SNAPSHOT", tab_id: 77 });
  assert.equal(response.ok, true);
  const snapshot = JSON.parse(JSON.stringify(response.snapshot));
  assert.deepEqual(Object.keys(snapshot).sort(), [
    "auth", "browser", "extension", "generatedAt", "page", "privacy",
    "snapshotVersion", "stores", "work",
  ]);
  assert.equal(snapshot.snapshotVersion, "seller_agents_support_snapshot_v1");
  assert.equal(snapshot.extension.version, "0.2.4");
  assert.equal(snapshot.extension.environment, "LOCAL DEVELOPMENT");
  assert.deepEqual(snapshot.browser, {
    family: "chrome",
    version: "147.0.7727.116",
    evidence: "OBSERVED_RUNTIME_ONLY",
  });
  assert.equal(snapshot.auth.authenticated, true);
  assert.equal(snapshot.auth.workAllowed, true);
  assert.deepEqual(snapshot.auth.compatibility, {
    extensionStatus: "SUPPORTED",
    minimumExtensionVersion: null,
    browserStatus: "SUPPORTED",
  });
  assert.equal(snapshot.page.aiFamily, "chatgpt");
  assert.equal(snapshot.page.identityStatus, "confirmed");
  assert.deepEqual(snapshot.stores, { total: 2, ozon: 1, wildberries: 1 });
  assert.equal(snapshot.work.pending, false);
  assert.equal(snapshot.work.lastStart, null);
  assert.deepEqual(snapshot.privacy, {
    accountIdentifiersIncluded: false,
    deviceSessionIdentifiersIncluded: false,
    storeIdentifiersIncluded: false,
    credentialsIncluded: false,
    conversationIdentifiersIncluded: false,
    marketplacePayloadIncluded: false,
  });
  const serialized = JSON.stringify(snapshot);
  for (const forbidden of [
    "PRIVATE_OZON_NAME",
    "PRIVATE_WB_NAME",
    "A06_OZON_SECRET",
    "A06_WB_SECRET_TOKEN_1234567890",
    "123456",
    ozon.store.id,
    wb.store.id,
  ]) assert.equal(serialized.includes(forbidden), false, forbidden);
  assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(serialized), false);
} finally {
  worker.close();
}

const AUTH = "seller_agents_control_auth_v2";
const compatibilityBacking = { local: {}, session: {} };
const compatibilitySeed = await makeWorker(runtime, {
  backing: compatibilityBacking,
  userAgent: "Mozilla/5.0 Chrome/147.0.7727.116 Safari/537.36",
});
compatibilitySeed.close();
const recommendedPayload = structuredClone(compatibilityBacking.local[AUTH].authority.payload);
recommendedPayload.compatibility = {
  ...recommendedPayload.compatibility,
  extension: { status: "UPDATE_RECOMMENDED", minimumVersion: "0.2.4" },
};
compatibilityBacking.local[AUTH].authority.payload = recommendedPayload;
compatibilityBacking.local[AUTH].authority.envelope = await signFixtureBootstrap(
  compatibilityBacking,
  recommendedPayload,
);
const recommendedWorker = await makeWorker(runtime, {
  backing: compatibilityBacking,
  seedAuthority: false,
  userAgent: "Mozilla/5.0 Chrome/147.0.7727.116 Safari/537.36",
});
try {
  const status = JSON.parse(JSON.stringify(
    await recommendedWorker.call("SellerAgentsControlClient.status"),
  ));
  assert.equal(status.authenticated, true);
  assert.equal(status.workAllowed, true);
  assert.deepEqual(status.compatibility, {
    extension: { status: "UPDATE_RECOMMENDED", minimumVersion: "0.2.4" },
    browser: { status: "SUPPORTED" },
  });
  const response = await recommendedWorker.popup({
    type: "SA_SUPPORT_SNAPSHOT",
    tab_id: 77,
  });
  const snapshot = JSON.parse(JSON.stringify(response.snapshot));
  assert.deepEqual(snapshot.auth.compatibility, {
    extensionStatus: "UPDATE_RECOMMENDED",
    minimumExtensionVersion: "0.2.4",
    browserStatus: "SUPPORTED",
  });
} finally {
  recommendedWorker.close();
}

const startDiagnosticBacking = {
  local: {
    ozmb_diagnostics: [
      {
        sequence: 90,
        event: "WORK_START_ACTION_RESULT",
        tab_id: 77,
        stage: "accepted",
        outcome: "pending",
        conversation_id: "PRIVATE_CONVERSATION_SHOULD_NOT_LEAK",
      },
      {
        sequence: 91,
        event: "WORK_PENDING_START_TERMINAL",
        tab_id: 77,
        reason: "WORK_START_SEND_TARGET_UNAVAILABLE",
        conversation_id: "PRIVATE_CONVERSATION_SHOULD_NOT_LEAK",
        prompt_text: "PRIVATE_PROMPT_SHOULD_NOT_LEAK",
      },
    ],
  },
  session: {},
};
const pendingStartBacking = {
  local: {
    ozmb_diagnostics: [
      {
        sequence: 90,
        event: "WORK_START_ACTION_RESULT",
        tab_id: 77,
        stage: "accepted",
        outcome: "pending",
        conversation_id: "PRIVATE_PENDING_CONVERSATION_SHOULD_NOT_LEAK",
        prompt_text: "PRIVATE_PENDING_PROMPT_SHOULD_NOT_LEAK",
      },
    ],
  },
  session: {},
};
const pendingStartWorker = await makeWorker(runtime, {
  backing: pendingStartBacking,
  userAgent: "Mozilla/5.0 Chrome/147.0.7727.116 Safari/537.36",
});
try {
  const response = await pendingStartWorker.popup({
    type: "SA_SUPPORT_SNAPSHOT",
    tab_id: 77,
  });
  const snapshot = JSON.parse(JSON.stringify(response.snapshot));
  assert.deepEqual(snapshot.work.lastStart, {
    stage: "accepted",
    code: null,
    outcome: "pending",
  });
  const serialized = JSON.stringify(snapshot);
  assert.equal(
    serialized.includes("PRIVATE_PENDING_CONVERSATION_SHOULD_NOT_LEAK"),
    false,
  );
  assert.equal(
    serialized.includes("PRIVATE_PENDING_PROMPT_SHOULD_NOT_LEAK"),
    false,
  );
} finally {
  pendingStartWorker.close();
}

const startDiagnosticWorker = await makeWorker(runtime, {
  backing: startDiagnosticBacking,
  userAgent: "Mozilla/5.0 Chrome/147.0.7727.116 Safari/537.36",
});
try {
  const response = await startDiagnosticWorker.popup({
    type: "SA_SUPPORT_SNAPSHOT",
    tab_id: 77,
  });
  const snapshot = JSON.parse(JSON.stringify(response.snapshot));
  assert.deepEqual(snapshot.work.lastStart, {
    stage: "terminal",
    code: "WORK_START_SEND_TARGET_UNAVAILABLE",
    outcome: "failed",
  });
  const serialized = JSON.stringify(snapshot);
  assert.equal(
    serialized.includes("PRIVATE_CONVERSATION_SHOULD_NOT_LEAK"),
    false,
  );
  assert.equal(serialized.includes("PRIVATE_PROMPT_SHOULD_NOT_LEAK"), false);
} finally {
  startDiagnosticWorker.close();
}

const reopenedStartDiagnosticWorker = await makeWorker(runtime, {
  backing: startDiagnosticBacking,
  seedAuthority: false,
  userAgent: "Mozilla/5.0 Chrome/147.0.7727.116 Safari/537.36",
});
try {
  const response = await reopenedStartDiagnosticWorker.popup({
    type: "SA_SUPPORT_SNAPSHOT",
    tab_id: 77,
  });
  const snapshot = JSON.parse(JSON.stringify(response.snapshot));
  assert.deepEqual(snapshot.work.lastStart, {
    stage: "terminal",
    code: "WORK_START_SEND_TARGET_UNAVAILABLE",
    outcome: "failed",
  });
  const serialized = JSON.stringify(snapshot);
  assert.equal(
    serialized.includes("PRIVATE_CONVERSATION_SHOULD_NOT_LEAK"),
    false,
  );
  assert.equal(serialized.includes("PRIVATE_PROMPT_SHOULD_NOT_LEAK"), false);
} finally {
  reopenedStartDiagnosticWorker.close();
}

const deniedTechnicalWorker = await makeWorker(runtime, {
  userAgent: "Mozilla/5.0 Gecko/20100101 Firefox/156.0",
  firefoxPermissions: { getAll: async () => ({ data_collection: [] }) },
});
try {
  const response = await deniedTechnicalWorker.popup({ type: "SA_SUPPORT_SNAPSHOT", tab_id: 77 });
  const snapshot = JSON.parse(JSON.stringify(response.snapshot));
  assert.equal(Object.hasOwn(snapshot, "browser"), false, "Firefox opt-out omits browser family/version from support payload");
  assert.deepEqual(snapshot.extension, { environment: "LOCAL DEVELOPMENT" }, "Firefox opt-out omits extension version from support payload");
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes("firefox"), false);
  assert.equal(serialized.includes("156.0"), false);
  assert.equal(serialized.includes("0.2.4"), false);
} finally {
  deniedTechnicalWorker.close();
}
console.log(JSON.stringify({
  status: "PASS",
  scope: "A06_PRIVACY_SAFE_SUPPORT_AND_UPDATE_ADVISORY",
  browserEvidence: "OBSERVED_RUNTIME_ONLY",
  compatibilityAdvisory: "UPDATE_RECOMMENDED",
  executionAuthority: false,
}, null, 2));
