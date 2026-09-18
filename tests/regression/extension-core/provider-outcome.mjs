import assert from "node:assert/strict";
import path from "node:path";
import { makeWorker } from "./worker-harness.mjs";

const root = path.resolve(process.argv[2] || path.resolve(import.meta.dirname, "../../.."));
const worker = await makeWorker(root);
const api = await worker.call("(() => SellerAgentsProviderOutcome)");
assert.ok(api, "provider outcome model must be composed");
const base = api.createIntent({
  logical_execution_id: "execution-1:0",
  provider_attempt_id: "attempt-1",
  execution_id: "execution-1",
  command_index: 0,
  account: "account-1",
  conversation: "conversation-1",
  work_generation: "work-1",
  binding: "binding-1",
  binding_revision: 3,
  marketplace: "wildberries",
  store: "store-1",
  credential_revision: "credential-1",
  operation: "seller_info",
  attempt_number: 1,
}, 1789344000000);
assert.equal(base.state, api.STATES.DISPATCH_INTENT_COMMITTED);
assert.equal(base.response, null);
assert.equal(base.credential_revision, "credential-1");
assert.equal(JSON.stringify(base).includes("token"), false);

const received = api.markResponseReceived(base, {
  ok: false,
  httpStatus: 429,
  responseMeta: { retry_after: "5", request_id: "provider-request-1" },
}, 1789344001000);
assert.equal(received.state, api.STATES.RESPONSE_RECEIVED);
assert.equal(received.outcome, "KNOWN_RESPONSE");
assert.equal(received.response.classification, "KNOWN_429");
const waiting = api.markKnown(received, false, 1789344002000);
assert.equal(waiting.state, api.STATES.RETRY_WAIT_KNOWN);
const retry = api.beginPermittedRetry(waiting, "attempt-2", 1789344003000);
assert.equal(retry.logical_execution_id, base.logical_execution_id);
assert.equal(retry.provider_attempt_id, "attempt-2");
assert.equal(retry.attempt_number, 2);

const unknown = api.markUnknown(base, 1789344004000, "worker_restart");
assert.equal(unknown.state, api.STATES.OUTCOME_UNKNOWN);
assert.equal(unknown.outcome, "UNKNOWN_OUTCOME");
assert.equal(api.canAutomaticallyDispatch(unknown), false);
assert.equal(api.markKnown(unknown, true).state, api.STATES.OUTCOME_UNKNOWN);
assert.throws(() => api.beginPermittedRetry(unknown, "attempt-3"), { code: "PROVIDER_RETRY_NOT_PERMITTED" });

const completed = api.markKnown(api.markResponseReceived(base, { ok: true, httpStatus: 200 }), true);
assert.equal(completed.state, api.STATES.COMPLETED_KNOWN);
assert.equal(completed.outcome, "KNOWN_RESPONSE");
assert.equal(api.compactHistory([base, unknown, completed], 1789344005000).length, 3);
assert.equal(api.compactHistory([unknown], 1789344005000 + api.UNKNOWN_RETENTION_MS + 1).length, 0);

console.log(JSON.stringify({
  status: "PASS",
  scenarios: 10,
  states: Object.values(api.STATES),
  unknown_auto_replay: false,
  known_429_new_attempt: true,
}, null, 2));
worker.close();
