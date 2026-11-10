import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseAcj1, parseCanonicalAcj1, encodeAcj1, frameAcw1,
  decodeBase64url, encodeBase64url,
} from "./account-code-acj1.js";
import {
  parseAcw1Request, parseAcw1Response, parseAcw1MetadataResponse,
  parseAcw1Error, parseAcw1Envelope, parseAcw1CredentialPlaintext,
  ACW1_ERROR_HTTP,
} from "./account-code-wire.js";

const f = JSON.parse(readFileSync(new URL("./account-code-wire.fixture.json", import.meta.url), "utf8"));
const p = f.positive, id = f.ids;
const prepared = JSON.parse(p.P04.preparedCanonicalUTF8);
const credential = JSON.parse(p.P05.plaintextCanonicalUTF8);
const aad = JSON.parse(p.P05.AADCanonicalUTF8);
const envelope = { aad, ciphertext: p.P05.ciphertext, tag: p.P05.tag };
const ticketPayload = JSON.parse(Buffer.from(p.P03.ticket.split(".")[0], "base64url").toString());
const proof = p.P04.signatureP1363Base64url;
const context = { attemptId: id.attemptId };
const json = JSON.stringify;
const copy = (v) => structuredClone(v);
const rejects = (fn) => assert.throws(fn, (e) =>
  typeof e.code === "string" && !String(e.message).includes("__SYNTHETIC_TELEMETRY__"));
const resultRef = Object.fromEntries(
  ["resultId", "resultDigest", "deviceId", "sessionId", "grantIssuedAt",
    "accessExpiresAt", "refreshExpiresAt", "initialRefreshGeneration"]
    .map((key) => [key, aad[key]]),
);
const allocation = {
  attemptId: id.attemptId, ticket: p.P03.ticket, serverNonce: ticketPayload.serverNonce,
  proofThumbprint: ticketPayload.proofThumbprint,
  recipientThumbprint: ticketPayload.recipientThumbprint,
  issuedAt: ticketPayload.issuedAt, notAfter: ticketPayload.notAfter,
};

test("literal P01 ACJ1 and F expected bytes (no crypto reference)", () => {
  assert.equal(Buffer.from(encodeAcj1(p.P01.value)).toString("hex"), p.P01.canonicalHex);
  assert.equal(Buffer.from(frameAcw1(p.P01.frameLabel,
    ...p.P01.frameFieldsHex.map((x) => Buffer.from(x, "hex")))).toString("hex"), p.P01.framedHex);
});
for (const raw of ['{"a":-0}', '{"a":-1}', '{"a":+1}', '{"a":1.0}',
  '{"a":1e0}', '{"a":1E+0}', '{"a":01}', '{"a":9007199254740992}']) {
  test("raw lexical numeric rejection: " + raw, () => rejects(() => parseAcj1(raw)));
}
for (const raw of ['{"a":1,"a":1}', '{"a":1,"\\u0061":2}',
  '{"x":{"a":1,"a":2}}', '{"a":1,}', '[1,]', '[,]', 'true false', '{"a" 1}', '']) {
  test("raw grammar/duplicate rejection: " + raw, () => rejects(() => parseAcj1(raw)));
}
test("wire whitespace/escaping accepted; embedded canonical bytes are exact", () => {
  assert.deepEqual(parseAcj1(' { "\\u0061" : 1 } '), { a: 1 });
  rejects(() => parseCanonicalAcj1(' { "a":1 }'));
  rejects(() => parseCanonicalAcj1('{"\\u0061":1}'));
  assert.deepEqual(parseCanonicalAcj1('{"a":1}'), { a: 1 });
});
test("scalar strings and specified escaping, with ASCII byte key order", () => {
  const v = { z: "/\u2028\u2029😀", a: "\b\t\n\f\r\u0000\u001f\"\\" };
  const expected = '{"a":"\\b\\t\\n\\f\\r\\u0000\\u001f\\"\\\\","z":"/\u2028\u2029😀"}';
  assert.equal(new TextDecoder().decode(encodeAcj1(v)), expected);
  assert.deepEqual(parseAcj1(expected), v);
  rejects(() => parseAcj1('{"é":0}'));
  rejects(() => parseAcj1('{"a":"\\ud800"}'));
  rejects(() => parseAcj1('{"a":"\\udc00"}'));
  rejects(() => encodeAcj1({ a: "\ud800" }));
});
test("no prototype setter effect from raw object keys", () => {
  const v = parseAcj1('{"__proto__":{"x":1}}');
  assert.equal(Object.getPrototypeOf(v), Object.prototype);
  assert.equal(Object.hasOwn(v, "__proto__"), true);
  assert.equal({}.x, undefined);
});
test("UTF8 fatal decode/BOM and byte limits, not JS character count", () => {
  rejects(() => parseAcj1(new Uint8Array([0xc0, 0xaf])));
  rejects(() => parseAcj1(new Uint8Array([0xef, 0xbb, 0xbf, 0x30])));
  assert.equal(parseAcj1('"é"', 4), "é");
  rejects(() => parseAcj1('"é"', 3));
  rejects(() => encodeAcj1("é", 3));
});
test("encoder rejects non-JSON values, accessors and cycles without coercion", () => {
  for (const v of [-0, NaN, Infinity, 1.2, undefined, 1n, new Date(), [undefined]]) {
    rejects(() => encodeAcj1(v));
  }
  let invoked = false;
  const v = {}; Object.defineProperty(v, "a", { enumerable: true, get() { invoked = true; return 1; } });
  rejects(() => encodeAcj1(v)); assert.equal(invoked, false);
  const cycle = []; cycle.push(cycle); rejects(() => encodeAcj1(cycle));
});
test("iterative parse/encode handles bounded deep JSON without an invented depth policy", () => {
  const raw = "[".repeat(3000) + "0" + "]".repeat(3000);
  assert.equal(new TextDecoder().decode(encodeAcj1(parseAcj1(raw))), raw);
});
test("canonical base64url does not repair padding, pad bits or alphabet", () => {
  assert.equal(encodeBase64url(new Uint8Array([0])), "AA");
  assert.deepEqual(decodeBase64url("AA", 1), new Uint8Array([0]));
  for (const s of ["AA==", "AB", "A", "+A", "/A", "AA\n"]) rejects(() => decodeBase64url(s, 1));
});
test("F framing enforces ASCII labels/fixed-width lengths", () => {
  rejects(() => frameAcw1("é", new Uint8Array()));
  rejects(() => frameAcw1("x".repeat(65536), new Uint8Array()));
});

const request = (op, body) => parseAcw1Request(op, json(body), context);
test("allocate strict public wire shape, no code or same-purpose key reuse", () => {
  const body = { profile: "ACW1", operation: "allocate",
    proofKey: p.P02.proofPublicKey, recipientKey: p.P02.recipientPublicKey };
  assert.equal(parseAcw1Request("allocate", json(body)).operation, "allocate");
  rejects(() => parseAcw1Request("allocate", json({ ...body, accountCode: p.P03.accountCode })));
  rejects(() => parseAcw1Request("allocate", json({ ...body, recipientKey: body.proofKey })));
  rejects(() => parseAcw1Request("allocate", json({ ...body, proofKey: { ...body.proofKey, d: "AA" } })));
});
test("prepare/commit supplied literal structures, path/body/op exact", () => {
  const prepare = { ...p.P04.prepareRequestWithoutProof, proof };
  assert.equal(request("prepare", prepare).attemptId, id.attemptId);
  assert.equal(request("commit", { ...p.P04.commitRequestWithoutProof, proof }).operation, "commit");
  rejects(() => request("status", prepare));
  rejects(() => parseAcw1Request("prepare", json(prepare), { attemptId: id.accountId }));
  rejects(() => request("prepare", { ...prepare, accountId: id.accountId }));
});
test("WITHHELD extra telemetry rejects even structurally correct proof", () => {
  const body = { ...p.P04.prepareRequestWithoutProof, proof };
  body.client = { ...body.client, browserVersion: "__SYNTHETIC_TELEMETRY__" };
  rejects(() => request("prepare", body));
});
test("PRESENT string bounds are UTF8 bytes and do not grant consent", () => {
  const body = { ...p.P04.prepareRequestWithoutProof, proof, technicalDataConsent: "PRESENT",
    client: { clientType: "browser_extension", label: "é".repeat(64) } };
  assert.equal(request("prepare", body).technicalDataConsent, "PRESENT");
  rejects(() => request("prepare", { ...body, client: { ...body.client, label: "é".repeat(65) } }));
  rejects(() => request("prepare", { ...body, technicalDataConsent: "WITHHELD" }));
});
for (const operation of ["cancel", "status"]) {
  test(operation + " nullable binding only in exact designated request", () => {
    const body = { profile: "ACW1", operation, attemptId: id.attemptId,
      ticket: p.P03.ticket, preparedBinding: null, proof };
    assert.equal(request(operation, body).preparedBinding, null);
    delete body.preparedBinding; rejects(() => request(operation, body));
  });
}
test("commit and ACK require non-null result bindings", () => {
  rejects(() => request("commit", { ...p.P04.commitRequestWithoutProof, preparedBinding: null, proof }));
  assert.equal(request("ack", { ...p.P06.ackRequestWithoutProof, proof }).resultId, id.resultId);
  rejects(() => request("ack", { ...p.P06.ackRequestWithoutProof, resultDigest: null, proof }));
});
test("P1363 range/low-S grammar rejects high-S; math/proof validity is not executed", () => {
  const bytes = Buffer.from(proof, "base64url");
  const n = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
  const s = BigInt("0x" + bytes.subarray(32).toString("hex"));
  const high = Buffer.concat([bytes.subarray(0, 32), Buffer.from((n-s).toString(16).padStart(64,"0"),"hex")]).toString("base64url");
  rejects(() => request("commit", { ...p.P04.commitRequestWithoutProof, proof: high }));
});

function writeFixture(operation, revision) {
  // A deliberately unverified synthetic MAC, not key generation/signing.
  const payload = { accountId: id.accountId, baseRevision: revision,
    issuedAt: ticketPayload.issuedAt, keyVersion: 1, kind: "write",
    notAfter: ticketPayload.notAfter, operation, operationId: id.operationId,
    portalBinding: p.P03.portalBinding, profile: "ACW1" };
  const ticket = Buffer.from(json(payload)).toString("base64url") + "." + Buffer.alloc(32).toString("base64url");
  return { profile: "ACW1", operation, operationId: id.operationId, ticket, expectedRevision: revision };
}
for (const op of ["issue", "rotate"]) {
  test(op + " operation/header/ticket structure with no MAC authority claim", () => {
    const body = writeFixture(op, op === "issue" ? 0 : 1);
    assert.equal(parseAcw1Request(op, json(body), { idempotencyKey: id.operationId, accountId: id.accountId }).operation, op);
    rejects(() => parseAcw1Request(op, json(body), { idempotencyKey: id.accountId, accountId: id.accountId }));
    rejects(() => parseAcw1Request(op, json({ ...body, unexpected: true }), { idempotencyKey: id.operationId, accountId: id.accountId }));
  });
}
test("write ticket account binding matches the supplied canonical account path", () => {
  const body = writeFixture("issue", 0);
  const ctx = { idempotencyKey: id.operationId, accountId: id.accountId };
  assert.equal(parseAcw1Request("issue", json(body), ctx).operation, "issue");
  rejects(() => parseAcw1Request("issue", json(body), { ...ctx, accountId: id.attemptId }));
  rejects(() => parseAcw1Request("issue", json(body), { idempotencyKey: id.operationId }));
});
test("malformed embedded ticket, deadline and canonical encoding reject without repair", () => {
  const body = writeFixture("issue", 0);
  const payload = JSON.parse(Buffer.from(body.ticket.split(".")[0], "base64url").toString());
  const noncanonical = Buffer.from(" " + json(payload)).toString("base64url") + "." + body.ticket.split(".")[1];
  rejects(() => parseAcw1Request("issue", json({ ...body, ticket: noncanonical }), { idempotencyKey: id.operationId, accountId: id.accountId }));
  payload.notAfter++;
  const bad = Buffer.from(json(payload)).toString("base64url") + "." + body.ticket.split(".")[1];
  rejects(() => parseAcw1Request("issue", json({ ...body, ticket: bad }), { idempotencyKey: id.operationId, accountId: id.accountId }));
});
test("request cap rejects oversize prior to schema handling", () => {
  rejects(() => parseAcw1Request("allocate", " ".repeat(8193)));
});
test("literal C and E parse structurally; cryptographic verification is outside codec", () => {
  assert.equal(parseAcw1CredentialPlaintext(p.P05.plaintextCanonicalUTF8).resultId, id.resultId);
  assert.equal(parseAcw1Envelope(envelope).tag, p.P05.tag);
  const altered = copy(envelope); altered.tag = Buffer.alloc(16).toString("base64url");
  assert.equal(parseAcw1Envelope(altered).tag, altered.tag); // no fake AEAD validation
  rejects(() => parseAcw1Envelope({ ...envelope, tag: "AA" }));
  rejects(() => parseAcw1Envelope({ ...envelope, extra: true }));
});
test("decrypted credential plaintext requires exact ACJ1 bytes before any token use", () => {
  rejects(() => parseAcw1CredentialPlaintext(" " + p.P05.plaintextCanonicalUTF8));
  rejects(() => parseAcw1CredentialPlaintext(p.P05.plaintextCanonicalUTF8 + "\n"));
  const reversed = Object.fromEntries(Object.entries(credential).reverse());
  rejects(() => parseAcw1CredentialPlaintext(json(reversed)));
});
test("structural cap is distinct from crypto framing authentication", () => {
  const combined = Buffer.concat([Buffer.from(p.P05.ciphertext,"base64url"),Buffer.from(p.P05.tag,"base64url")]).toString("base64url");
  // Within caps, combined-tag semantic failure belongs to the later AEAD consumer.
  assert.equal(parseAcw1Envelope({ ...envelope, ciphertext: combined }).ciphertext, combined);
  rejects(() => parseAcw1Envelope({ ...envelope, ciphertext: Buffer.alloc(8193).toString("base64url") }));
});
test("ALLOCATED and PREPARED response unions", () => {
  assert.equal(parseAcw1Response("allocate", json({ profile:"ACW1",operation:"allocate",state:"ALLOCATED",allocation })).state,"ALLOCATED");
  for (const operation of ["prepare","status","commit"]) {
    const body = { profile:"ACW1",operation,state:"PREPARED",attemptId:id.attemptId,prepared,preparedBinding:p.P04.preparedBinding };
    assert.equal(parseAcw1Response(operation,json(body),context).state,"PREPARED");
    rejects(() => parseAcw1Response("ack",json({...body,operation:"ack"}),context));
  }
});
for (const operation of ["commit","status","cancel"]) {
  test("COMMITTED result union for " + operation, () => {
    const body = { profile:"ACW1",operation,state:"COMMITTED",attemptId:id.attemptId,preparedBinding:p.P04.preparedBinding,result:envelope };
    assert.equal(parseAcw1Response(operation,json(body),context).state,"COMMITTED");
    rejects(() => parseAcw1Response(operation,json({...body,preparedBinding:p.P03.portalBinding}),context));
  });
}
for (const operation of ["commit","status","cancel","ack"]) {
  test("DELIVERED/NO_RECOVERY metadata-only for " + operation, () => {
    const base = {profile:"ACW1",operation,attemptId:id.attemptId,preparedBinding:p.P04.preparedBinding,resultRef};
    const delivered = {...base,state:"COMMITTED_DELIVERED",ackedAt:credential.grantIssuedAt,reason:"ACKNOWLEDGED"};
    const missing = {...base,state:"COMMITTED_NO_RECOVERY",ackedAt:null,reason:"CIPHERTEXT_MISSING"};
    assert.equal(parseAcw1Response(operation,json(delivered),context).state,"COMMITTED_DELIVERED");
    assert.equal(parseAcw1Response(operation,json(missing),context).state,"COMMITTED_NO_RECOVERY");
    rejects(() => parseAcw1Response(operation,json({...missing,result:envelope}),context));
  });
}
test("no-grant terminal and unknown states, no invented success fields", () => {
  for (const state of ["CANCELLED","EXPIRED_NO_COMMIT"]) {
    assert.equal(parseAcw1Response("cancel",json({profile:"ACW1",operation:"cancel",attemptId:id.attemptId,state,preparedBinding:null}),context).state,state);
  }
  const body = {profile:"ACW1",operation:"status",attemptId:id.attemptId,state:"UNKNOWN_EXPIRED"};
  assert.equal(parseAcw1Response("status",json(body),context).state,"UNKNOWN_EXPIRED");
  rejects(() => parseAcw1Response("status",json({...body,preparedBinding:null}),context));
  rejects(() => parseAcw1Response("status",json({...body,state:"UNKNOWN"}),context));
});
test("metadata permit vs lookup and ABSENT invariants", () => {
  const body = writeFixture("issue",0);
  const payload = JSON.parse(Buffer.from(body.ticket.split(".")[0],"base64url").toString());
  const metadata = {accountId:id.accountId,codeRevision:0,state:"ABSENT",createdAt:null};
  const response = {profile:"ACW1",metadata,writePermit:{operationId:id.operationId,ticket:body.ticket,issuedAt:payload.issuedAt,notAfter:payload.notAfter}};
  assert.equal(parseAcw1MetadataResponse("issue",json(response),{accountId:id.accountId}).metadata.state,"ABSENT");
  rejects(() => parseAcw1MetadataResponse("lookup",json(response),{accountId:id.accountId,operationId:id.operationId}));
  const lookup = {profile:"ACW1",metadata,receipt:{operationId:id.operationId,outcome:"UNKNOWN"}};
  assert.equal(parseAcw1MetadataResponse("lookup",json(lookup),{accountId:id.accountId,operationId:id.operationId}).receipt.outcome,"UNKNOWN");
  rejects(() => parseAcw1MetadataResponse("lookup",json({...lookup,metadata:{...metadata,createdAt:0}}),{accountId:id.accountId,operationId:id.operationId}));
});
test("write success vs replay never mixes secret into replay", () => {
  const metadata = {accountId:id.accountId,codeRevision:1,state:"ACTIVE",createdAt:credential.grantIssuedAt};
  const body = {profile:"ACW1",operation:"issue",state:"CODE_ISSUED",operationId:id.operationId,metadata,accountCode:p.P03.accountCode};
  const ctx = {operationId:id.operationId};
  assert.equal(parseAcw1Response("issue",json(body),ctx).state,"CODE_ISSUED");
  const {accountCode,...rest}=body;
  const replay={...rest,state:"APPLIED_SECRET_NOT_REPLAYABLE"};
  assert.equal(parseAcw1Response("issue",json(replay),ctx).state,"APPLIED_SECRET_NOT_REPLAYABLE");
  rejects(() => parseAcw1Response("issue",json({...replay,accountCode}),ctx));
});
test("all 11 exact error aliases and transport distinction", () => {
  assert.equal(Object.keys(ACW1_ERROR_HTTP).length,11);
  for (const code of Object.keys(ACW1_ERROR_HTTP)) {
    assert.equal(parseAcw1Error("commit",json({profile:"ACW1",operation:"commit",error:{code}})).error.code,code);
  }
  rejects(() => parseAcw1Error("commit",'{"error":{"code":"SERVICE_UNAVAILABLE"}}'));
  rejects(() => parseAcw1Error("commit",json({profile:"ACW1",operation:"commit",error:{code:"ATTEMPT_CONFLICT",detail:"__SYNTHETIC_TELEMETRY__"}})));
});
