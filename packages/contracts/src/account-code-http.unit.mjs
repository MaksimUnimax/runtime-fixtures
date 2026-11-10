import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { encodeAcj1 } from "./account-code-acj1.js";
import { acw1HttpBoundary, acw1HttpError, acw1HttpResponseMetadata } from "./account-code-http.ts";

let registered = 0, callbacks = 0;
function unit(name, fn) {
  registered++;
  test(name, async t => { callbacks++; await fn(t); });
}
after(() => {
  console.log("HTTP_BOUNDARY_CALLBACKS registered=" + registered + " entered=" + callbacks);
  const filtered = process.execArgv.some(arg => arg === "--test-name-pattern" || arg.startsWith("--test-name-pattern="));
  if (!filtered) assert.equal(callbacks, registered);
  else assert.ok(callbacks > 0 && callbacks <= registered);
});
const f = JSON.parse(readFileSync(new URL("./account-code-wire.fixture.json", import.meta.url), "utf8"));
const p = f.positive, id = f.ids, json = JSON.stringify;
const proof = p.P04.signatureP1363Base64url;
const marker = "__PUBLIC_HTTP_PRIVATE_INPUT_MARKER__";
const accountPath = "/v1/accounts/" + id.accountId + "/connection-code";
const attemptPath = "/v1/account-code/attempts/" + id.attemptId;
const requests = {
  allocate: { profile: "ACW1", operation: "allocate", proofKey: p.P02.proofPublicKey, recipientKey: p.P02.recipientPublicKey },
  prepare: { ...p.P04.prepareRequestWithoutProof, proof },
  commit: { ...p.P04.commitRequestWithoutProof, proof },
  status: { profile: "ACW1", operation: "status", attemptId: id.attemptId, ticket: p.P03.ticket, preparedBinding: null, proof },
  cancel: { profile: "ACW1", operation: "cancel", attemptId: id.attemptId, ticket: p.P03.ticket, preparedBinding: null, proof },
  ack: { ...p.P06.ackRequestWithoutProof, proof },
};
const ticketPayload = JSON.parse(Buffer.from(p.P03.ticket.split(".")[0], "base64url").toString());
for (const [operation, revision] of [["issue", 0], ["rotate", 1]]) {
  // Public schema fixture only, no MAC signing or issuance. MAC is an existing
  // explicitly public fixture byte string, not authority for this local data.
  const payload = { profile: "ACW1", kind: "write", keyVersion: 1, operation,
    operationId: id.operationId, accountId: id.accountId, baseRevision: revision,
    portalBinding: p.P03.portalBinding, issuedAt: ticketPayload.issuedAt, notAfter: ticketPayload.notAfter };
  const ticket = Buffer.from(encodeAcj1(payload)).toString("base64url") + "." + p.P03.ticketMAC;
  requests[operation] = { profile: "ACW1", operation, operationId: id.operationId, ticket, expectedRevision: revision };
}
const targets = { issue: accountPath, rotate: accountPath + "/rotate", allocate: "/v1/account-code/attempts",
  ...Object.fromEntries(["prepare", "commit", "status", "cancel", "ack"].map(op => [op, attemptPath + "/" + op])) };
const headers = [["Idempotency-Key", id.operationId]];
function checkCommon(value) {
  assert.equal(value.verification, "UNVERIFIED");
  assert.equal(value.downstreamDispatched, false);
  assert.deepEqual(value.metadata, { headers: { "cache-control": "no-store" } });
}
function safeError(value, operation) {
  checkCommon(value); assert.equal(value.kind, "ACW1_ERROR"); assert.equal(value.status, 400);
  assert.deepEqual(value.body, { profile: "ACW1", operation, error: { code: "INVALID_REQUEST" } });
  assert.equal(value.executionOutcome, "UNKNOWN"); assert.equal(json(value).includes(marker), false);
}
function transport(value) {
  checkCommon(value); assert.equal(value.kind, "TRANSPORT_HANDLING_REQUIRED");
  assert.equal(value.status, null); assert.equal(value.body, null); assert.equal(value.executionOutcome, "UNKNOWN");
  assert.equal(json(value).includes(marker), false);
}
for (const operation of Object.keys(targets)) {
  unit("exact POST route/request: " + operation, () => {
    const result = acw1HttpBoundary("POST", targets[operation], headers, json(requests[operation]));
    checkCommon(result); assert.equal(result.kind, "PARSED_POST");
    assert.equal(result.operation, operation); assert.deepEqual(result.request, requests[operation]);
    assert.equal(Object.hasOwn(result, "status"), false); assert.equal(Object.hasOwn(result, "body"), false);
  });
  unit("wrong method never parses/dispatches: " + operation, () => {
    transport(acw1HttpBoundary("PATCH", targets[operation], headers, json(requests[operation])));
  });
}
for (const action of ["issue", "rotate"]) {
  unit("GET metadata action " + action + " is only an unverified read intent", () => {
    const value = acw1HttpBoundary("GET", accountPath + "?action=" + action);
    checkCommon(value); assert.equal(value.kind, "METADATA_READ");
    assert.deepEqual(value.read, { accountId: id.accountId, mode: action, errorOperation: action });
    assert.equal(Object.hasOwn(value, "status"), false); assert.equal(Object.hasOwn(value, "body"), false);
  });
}
unit("GET lookup preserves missing error-operation contract boundary", () => {
  const value = acw1HttpBoundary("GET", accountPath + "?operationId=" + id.operationId);
  checkCommon(value); assert.equal(value.kind, "METADATA_READ");
  assert.deepEqual(value.read, { accountId: id.accountId, mode: "lookup", operationId: id.operationId, errorOperation: null });
  transport(acw1HttpError(value.read.errorOperation, "SERVICE_UNAVAILABLE"));
});
unit("raw query ambiguity/extra/duplicate keys never choose an operation", () => {
  for (const query of ["", "?action=issue&action=rotate", "?action=issue&operationId="+id.operationId,
    "?operationId="+id.operationId+"&operationId="+id.operationId, "?action=issue&extra="+marker,
    "?action=%69ssue", "?operationId="+id.operationId.toUpperCase(), "?action=other"]) {
    transport(acw1HttpBoundary("GET", accountPath + query));
  }
});
unit("no path/method repair, absolute URL/dot/percent/trailing aliases", () => {
  for (const target of [accountPath+"/", accountPath.replace("/accounts/", "/accounts/../accounts/"),
    accountPath.replace(id.accountId, id.accountId.toUpperCase()), "https://example.invalid"+accountPath,
    accountPath.replace("/v1/", "/%761/"), targets.commit+"?x="+marker, targets.commit+"#"+marker,
    targets.commit.replace(id.attemptId, ":id"), "/other/"+marker]) {
    transport(acw1HttpBoundary("POST", target, headers, json(requests.commit)));
  }
  transport(acw1HttpBoundary("post", targets.commit, [], json(requests.commit)));
  transport(acw1HttpBoundary("HEAD", accountPath+"?action=issue"));
});
unit("GET with body is outside supported metadata read boundary", () => {
  transport(acw1HttpBoundary("GET", accountPath+"?action=issue", [], marker));
});
unit("raw target terminators cannot bypass exact route matching", () => {
  for (const ending of ["\n", "\r\n", "\u2028", "\u2029"]) {
    transport(acw1HttpBoundary("POST", targets.issue+ending, headers, json(requests.issue)));
    transport(acw1HttpBoundary("POST", targets.commit+ending, [], json(requests.commit)));
    transport(acw1HttpBoundary("GET", accountPath+"?action=issue"+ending));
    transport(acw1HttpBoundary("GET", accountPath+"?operationId="+id.operationId+ending));
  }
});
unit("route literal wins over untrusted body operation", () => {
  for (const operation of Object.keys(targets)) {
    const bad = { ...requests[operation], operation: marker };
    safeError(acw1HttpBoundary("POST", targets[operation], headers, json(bad)), operation);
  }
});
unit("write header name case is HTTP-insensitive; value is exact", () => {
  assert.equal(acw1HttpBoundary("POST", targets.issue, [["iDeMpOtEnCy-KeY", id.operationId]], json(requests.issue)).kind, "PARSED_POST");
  for (const hs of [[], [["Idempotency-Key", id.resultId]], [["Idempotency-Key", " "+id.operationId]],
    [["Idempotency-Key", id.operationId],["idempotency-key",id.operationId]]]) {
    safeError(acw1HttpBoundary("POST", targets.issue, hs, json(requests.issue)), "issue");
  }
});
unit("path account/ticket and path attempt/body are exactly correlated", () => {
  safeError(acw1HttpBoundary("POST", accountPath.replace(id.accountId,id.resultId), headers, json(requests.issue)), "issue");
  safeError(acw1HttpBoundary("POST", targets.commit.replace(id.attemptId,id.resultId), [], json(requests.commit)), "commit");
});
unit("unknown/duplicate/null raw DTO fields rejected without details", () => {
  const valid = json(requests.prepare);
  for (const raw of [json({ ...requests.prepare, extra: marker }), json({ ...requests.prepare, client: null }),
    valid.replace('"profile":"ACW1"', '"profile":"ACW1","profile":"'+marker+'"'),
    json({ ...requests.prepare, client: { clientType: "browser_extension", label: marker } }),
    json({ ...requests.prepare, proof: null })]) {
    safeError(acw1HttpBoundary("POST", targets.prepare, [], raw), "prepare");
  }
});
unit("numeric lexemes and UTF8/body cap preserved at raw boundary", () => {
  for (const raw of [json(requests.issue).replace('"expectedRevision":0','"expectedRevision":-0'),
    json(requests.issue).replace('"expectedRevision":0','"expectedRevision":0e0'),
    " ".repeat(8193), new Uint8Array([0xc0,0xaf]), new Uint8Array([0xef,0xbb,0xbf,0x30])]) {
    safeError(acw1HttpBoundary("POST", targets.issue, headers, raw), "issue");
  }
  safeError(acw1HttpBoundary("POST", targets.issue, headers), "issue");
});
const mapping = { INVALID_REQUEST:400,AUTH_REQUIRED:401,FORBIDDEN:403,RATE_LIMITED:429,SERVICE_UNAVAILABLE:503,
  ACCOUNT_CODE_INVALID:400,ACCOUNT_CODE_UNAVAILABLE:503,ACCOUNT_CODE_REVISION_CONFLICT:409,
  ATTEMPT_EXPIRED:409,ATTEMPT_CONFLICT:409,RECOVERY_UNAVAILABLE:409 };
for (const [code,status] of Object.entries(mapping)) {
  unit("closed error body/status/no-store: " + code, () => {
    const error = acw1HttpError("commit", code); checkCommon(error);
    assert.equal(error.kind,"ACW1_ERROR"); assert.equal(error.status,status);
    assert.deepEqual(error.body,{profile:"ACW1",operation:"commit",error:{code}});
    assert.deepEqual(Object.keys(error.body).sort(),["error","operation","profile"]);
    assert.deepEqual(Object.keys(error.body.error),["code"]);
    assert.equal(error.executionOutcome,"UNKNOWN");
  });
}
unit("unknown codes/operations/errors require transport handler without copying input", () => {
  let getterCalled=false; const untrusted={message:marker,stack:marker,status:200};
  Object.defineProperty(untrusted,"code",{get(){getterCalled=true;return "FORBIDDEN";}});
  for(const code of [marker,"__proto__","toString",untrusted,null,500]) transport(acw1HttpError("commit",code));
  for(const operation of [marker,"lookup",null,untrusted]) transport(acw1HttpError(operation,"INVALID_REQUEST"));
  assert.equal(getterCalled,false);
});
unit("no-store response metadata contains no fabricated server status/result", () => {
  const meta=acw1HttpResponseMetadata(); assert.deepEqual(meta,{headers:{"cache-control":"no-store"}});
  assert.equal(Object.isFrozen(meta),true); assert.equal(Object.isFrozen(meta.headers),true);
  assert.throws(()=>{meta.headers["cache-control"]="public";},TypeError);
  assert.equal(Object.hasOwn(meta,"status"),false); assert.equal(Object.hasOwn(meta,"body"),false);
});
unit("safe error is immutable, no secret/header/input/reason projection", () => {
  const error=acw1HttpBoundary("POST",targets.prepare,[["Authorization",marker]],json({...requests.prepare,ticket:marker}));
  safeError(error,"prepare"); assert.equal(Object.isFrozen(error.body.error),true);
  assert.equal(json(error).includes(marker),false);
  for(const key of ["message","input","signature","ticket","reason","headers","stack"]) assert.equal(Object.hasOwn(error.body,key),false);
});
unit("schema success remains UNVERIFIED and never dispatches", () => {
  let dispatched=0;const oldFetch=globalThis.fetch;
  globalThis.fetch=()=>{dispatched++;throw new Error("unexpected public test dispatch");};
  try {
    const value=acw1HttpBoundary("POST",targets.commit,[["Authorization",marker]],json(requests.commit),()=>{dispatched++;});
    checkCommon(value);assert.equal(value.kind,"PARSED_POST");assert.equal(dispatched,0);
    const bad=acw1HttpBoundary("POST",targets.prepare,[],marker);safeError(bad,"prepare");assert.equal(dispatched,0);
  } finally {globalThis.fetch=oldFetch;}
});
