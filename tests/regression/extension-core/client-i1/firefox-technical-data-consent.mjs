import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = process.cwd();
const identitySource = fs.readFileSync(
  path.resolve(ROOT, "packages/control-client/src/browser-identity.js"),
  "utf8",
);
const consentSource = fs.readFileSync(
  path.resolve(ROOT, "packages/control-client/src/technical-data-consent.js"),
  "utf8",
);
const CATEGORY = "technicalAndInteraction";

function makeRuntime({
  ua,
  grants = new Set(),
  requestDecision = true,
  queryFails = false,
  omitDataCollection = false,
} = {}) {
  const calls = { getAll: 0, request: 0, remove: 0 };
  const permissions = {
    async getAll() {
      calls.getAll += 1;
      if (queryFails) throw new Error("permission query failed");
      if (omitDataCollection) return {};
      return { data_collection: [...grants] };
    },
    async request(value) {
      calls.request += 1;
      assert.equal(JSON.stringify(value), JSON.stringify({ data_collection: [CATEGORY] }));
      if (requestDecision) grants.add(CATEGORY);
      return requestDecision;
    },
    async remove(value) {
      calls.remove += 1;
      assert.equal(JSON.stringify(value), JSON.stringify({ data_collection: [CATEGORY] }));
      return grants.delete(CATEGORY);
    },
  };
  const context = {
    navigator: { userAgent: ua },
    browser: { permissions },
    console,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(identitySource, context);
  vm.runInContext(consentSource, context);
  return {
    api: context.SellerAgentsTechnicalDataConsent,
    grants,
    calls,
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const chromeBody = {
  clientType: "browser_extension",
  browserFamily: "chrome",
  browserVersion: "153.0.0.0",
  extensionVersion: "0.2.4",
};
const chrome = makeRuntime({
  ua: "Mozilla/5.0 Chrome/153.0.0.0 Safari/537.36",
});
assert.deepEqual(
  plain((await chrome.api.projectControlRequest("device_authorization", chromeBody)).body),
  chromeBody,
);
assert.equal(chrome.calls.getAll, 0, "Chromium must not query Firefox consent");

const firefoxUa = "Mozilla/5.0 Gecko/20100101 Firefox/156.0";
const absent = makeRuntime({ ua: firefoxUa });
const absentProjection = plain(
  await absent.api.projectControlRequest("device_authorization", {
    clientType: "browser_extension",
    browserFamily: "firefox",
    browserVersion: "156.0",
    extensionVersion: "0.2.4",
  }),
);
assert.equal(absentProjection.consent.granted, false);
assert.deepEqual(absentProjection.body, { clientType: "browser_extension" });
await assert.rejects(
  () => absent.api.projectControlRequest("unknown", {}),
  /TECHNICAL_DATA_PROJECTION_KIND_INVALID/,
);
await assert.rejects(
  () => absent.api.projectControlRequest("bootstrap", null),
  /TECHNICAL_DATA_PROJECTION_BODY_INVALID/,
);

const declined = makeRuntime({ ua: firefoxUa, requestDecision: false });
assert.equal(await declined.api.requestFromUserGesture(), false);
assert.equal(declined.grants.has(CATEGORY), false);

const grantedStore = new Set();
const granted = makeRuntime({ ua: firefoxUa, grants: grantedStore });
assert.equal(await granted.api.requestFromUserGesture(), true);
assert.equal(grantedStore.has(CATEGORY), true);
const bootstrap = {
  contractVersion: "control_plane_v2",
  extensionVersion: "0.2.4",
  browser: { family: "firefox", version: "156.0" },
  deviceId: "device-1",
  lastConfigVersion: 9,
  detectedAi: { family: "chatgpt", surface: "web", variant: null },
};
assert.deepEqual(
  plain((await granted.api.projectControlRequest("bootstrap", bootstrap)).body),
  bootstrap,
);

const restarted = makeRuntime({ ua: firefoxUa, grants: grantedStore });
assert.equal((await restarted.api.consent()).granted, true, "restart must re-read Firefox permission");

const beforeRevoke = plain(
  (await restarted.api.projectControlRequest("health_authority", {
    healthTransportVersion: "health_transport_v1",
    bootstrap,
    bootstrapEnvelope: { payload: "signed" },
  })).body,
);
assert.equal(beforeRevoke.bootstrap.browser.family, "firefox");
assert.equal(await restarted.api.revoke(), true);
const afterRevoke = plain(
  (await restarted.api.projectControlRequest("health_authority", {
    healthTransportVersion: "health_transport_v1",
    bootstrap,
    bootstrapEnvelope: { payload: "signed" },
  })).body,
);
assert.equal(Object.hasOwn(afterRevoke.bootstrap, "browser"), false);
assert.equal(Object.hasOwn(afterRevoke.bootstrap, "extensionVersion"), false);
assert.equal(afterRevoke.bootstrap.deviceId, "device-1");
assert.ok(restarted.calls.getAll >= 3, "revocation must be observed by a fresh pre-send query");

const failedQuery = makeRuntime({ ua: firefoxUa, queryFails: true });
const failedProjection = plain(
  await failedQuery.api.projectControlRequest("bootstrap", bootstrap),
);
assert.equal(failedProjection.consent.granted, false);
assert.equal(failedProjection.consent.source, "query_failed");
assert.equal(Object.hasOwn(failedProjection.body, "browser"), false);

const unsupportedConsentShape = makeRuntime({
  ua: firefoxUa,
  omitDataCollection: true,
});
assert.equal((await unsupportedConsentShape.api.consent()).granted, false);

assert.deepEqual(bootstrap.browser, { family: "firefox", version: "156.0" });
assert.equal(bootstrap.extensionVersion, "0.2.4");

const runtime = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (runtime) {
  const worker = fs.readFileSync(path.join(runtime, "service_worker.js"), "utf8");
  assert.match(worker, /SellerAgentsTechnicalDataConsent/);
  assert.match(worker, /technicalAndInteraction/);
}

console.log(JSON.stringify({
  status: "PASS",
  category: CATEGORY,
  cases: [
    "chromium_unchanged",
    "firefox_absent",
    "decline",
    "grant",
    "restart",
    "revocation_before_next_projection",
    "query_failure_fail_closed",
    "missing_data_collection_fail_closed",
    "invalid_projection_fail_closed",
  ],
}));
