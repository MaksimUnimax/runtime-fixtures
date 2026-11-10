import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  acw1IdBytes, acw1U32, acw1U64, acw1UnverifiedKeyThumbprint,
  acw1PreparedBinding, acw1RequestBinding, acw1RequestProofTranscript,
  acw1AckBinding, acw1ResultBinding, acw1CheckResultEnvelopeBindings,
} from "./account-code-bindings.ts";

// Literal public goldens from the accepted immutable b82 fixture; no private
// scalar/key, signing, MAC, encryption or issuer operation is used here.
const f = JSON.parse(readFileSync(new URL("./account-code-wire.fixture.json", import.meta.url), "utf8"));
const p = f.positive, id = f.ids, json = JSON.stringify;
const P = JSON.parse(p.P04.preparedCanonicalUTF8);
const C = JSON.parse(p.P05.plaintextCanonicalUTF8);
const AD = JSON.parse(p.P05.AADCanonicalUTF8);
const ticket = JSON.parse(Buffer.from(p.P03.ticket.split(".")[0], "base64url").toString());
const proof = p.P04.signatureP1363Base64url;
const preparedContext = Object.fromEntries(["attemptId", "codeId", "accountId", "codeRevision",
  "actorUserId", "proofThumbprint", "recipientThumbprint"].map(k => [k, P[k]]));
const resultContext = Object.fromEntries(Object.entries(C).filter(([k]) => !["accessToken", "refreshToken"].includes(k)));
const keyContext = { proofThumbprint: AD.proofThumbprint, recipientThumbprint: AD.recipientThumbprint };
const requestContext = { attemptId: id.attemptId, serverNonce: ticket.serverNonce };
const commitContext = { ...requestContext, preparedBinding: p.P04.preparedBinding };
const ackContext = { ...commitContext, resultId: id.resultId, resultDigest: p.P05.resultDigest };
const full = unsigned => json({ ...unsigned, proof });
const hex = b => Buffer.from(b).toString("hex");
const reject = async fn => assert.rejects(fn, e => typeof e.code === "string" &&
  !e.message.includes("__PUBLIC_MISMATCH__"));
const throws = fn => assert.throws(fn, e => typeof e.code === "string");

test("literal UUID/u32/u64 byte oracles", () => {
  assert.equal(hex(acw1IdBytes("00112233-4455-4677-8899-aabbccddeeff")), "00112233445546778899aabbccddeeff");
  assert.equal(hex(acw1U32(0)), "00000000");
  assert.equal(hex(acw1U32(0xffffffff)), "ffffffff");
  assert.equal(hex(acw1U64(0)), "0000000000000000");
  assert.equal(hex(acw1U64(0x01020304)), "0000000001020304");
  assert.equal(hex(acw1U64(Number.MAX_SAFE_INTEGER)), "001fffffffffffff");
});
for (const n of [-0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 1n]) {
  test("integer field rejection: " + String(n), () => { throws(() => acw1U32(n)); throws(() => acw1U64(n)); });
}
test("u32 overflow and noncanonical UUID rejection", () => {
  throws(() => acw1U32(0x100000000));
  for (const value of [id.attemptId.toUpperCase(), id.attemptId.replaceAll("-", ""),
    "00112233-4455-1677-8899-aabbccddeeff", "00112233-4455-4677-0899-aabbccddeeff", " " + id.attemptId])
    throws(() => acw1IdBytes(value));
});
for (const [name, key, golden] of [["proof", p.P02.proofPublicKey, p.P02.proofThumbprint],
  ["recipient", p.P02.recipientPublicKey, p.P02.recipientThumbprint]]) {
  test("P02 literal " + name + " structural key hash remains unverified", async () => {
    const value = await acw1UnverifiedKeyThumbprint(json(key));
    assert.equal(value.digest, golden); assert.equal(value.purpose, "key-thumbprint");
    assert.equal(value.verification, "UNVERIFIED"); assert.equal(value.onCurveChecked, false);
    assert.equal(Object.isFrozen(value), true);
  });
}
test("structural key hash refuses private/extra/noncanonical coordinates", async () => {
  for (const key of [{ ...p.P02.proofPublicKey, d: "__PUBLIC_MISMATCH__" },
    { ...p.P02.proofPublicKey, x: p.P02.proofPublicKey.x + "=" },
    { ...p.P02.proofPublicKey, crv: "P-384" }]) await reject(() => acw1UnverifiedKeyThumbprint(json(key)));
});
test("off-curve-shaped public bytes never become a validated key", async () => {
  const zero = Buffer.alloc(32).toString("base64url");
  const out = await acw1UnverifiedKeyThumbprint(json({ crv: "P-256", kty: "EC", x: zero, y: zero }));
  assert.equal(out.onCurveChecked, false); assert.equal(out.verification, "UNVERIFIED");
});
test("P04 literal retained prepared binding", async () => {
  const out = await acw1PreparedBinding(p.P04.preparedCanonicalUTF8, preparedContext, p.P04.preparedBinding);
  assert.equal(out.digest, p.P04.preparedBinding); assert.equal(out.verification, "UNVERIFIED");
});
for (const field of ["attemptId", "codeId", "accountId", "actorUserId", "codeRevision", "proofThumbprint", "recipientThumbprint"]) {
  test("prepared expected context rejects " + field + " mismatch", async () => {
    const ctx = { ...preparedContext, [field]: field === "codeRevision" ? P.codeRevision + 1 :
      field.endsWith("Thumbprint") ? p.P03.portalBinding : id.resultId };
    await reject(() => acw1PreparedBinding(json(P), ctx));
  });
}
test("changed retained P content cannot reuse a previous binding", async () => {
  const changed = { ...P, preparedAt: P.preparedAt + 1 };
  assert.notEqual((await acw1PreparedBinding(json(changed), preparedContext)).digest, p.P04.preparedBinding);
  await reject(() => acw1PreparedBinding(json(changed), preparedContext, p.P04.preparedBinding));
});
test("P04 prepare request hash and commit proof transcript literal bytes", async () => {
  const prepare = await acw1RequestBinding("prepare", full(p.P04.prepareRequestWithoutProof), requestContext);
  assert.equal(prepare.requestHash.digest, p.P04.prepareRequestHash);
  const commit = await acw1RequestBinding("commit", full(p.P04.commitRequestWithoutProof), commitContext);
  assert.equal(commit.requestHash.digest, p.P04.requestHash);
  assert.equal(hex(commit.proofTranscript), p.P04.proofTranscriptHex);
  assert.equal(commit.verification, "UNVERIFIED");
});
test("P06 ACK uses normative request/request-proof purposes", async () => {
  const out = await acw1AckBinding(full(p.P06.ackRequestWithoutProof), ackContext);
  assert.equal(out.requestHash.digest, p.P06.requestHash);
  assert.equal(hex(out.proofTranscript), p.P06.proofTranscriptHex);
  assert.equal(out.operation, "ack");
});
test("purpose-tag mismatch cannot be passed as a request digest", async () => {
  const prepared = await acw1PreparedBinding(json(P), preparedContext);
  throws(() => acw1RequestProofTranscript("commit", id.attemptId, ticket.serverNonce, prepared));
});
test("operation substitution and path/nonce mismatch reject", async () => {
  await reject(() => acw1RequestBinding("status", full(p.P04.commitRequestWithoutProof), commitContext));
  await reject(() => acw1RequestBinding("commit", full(p.P04.commitRequestWithoutProof), { ...commitContext, attemptId: id.accountId }));
  await reject(() => acw1RequestBinding("commit", full(p.P04.commitRequestWithoutProof), { ...commitContext, serverNonce: p.P03.portalBinding }));
});
test("proof transcript binds operation, attempt and decoded nonce", async () => {
  const out = await acw1RequestBinding("commit", full(p.P04.commitRequestWithoutProof), commitContext);
  assert.notEqual(hex(acw1RequestProofTranscript("status", id.attemptId, ticket.serverNonce, out.requestHash)), p.P04.proofTranscriptHex);
  assert.notEqual(hex(acw1RequestProofTranscript("commit", id.accountId, ticket.serverNonce, out.requestHash)), p.P04.proofTranscriptHex);
  assert.notEqual(hex(acw1RequestProofTranscript("commit", id.attemptId, p.P03.portalBinding, out.requestHash)), p.P04.proofTranscriptHex);
});
test("retained prepared binding and ACK result mismatches reject", async () => {
  await reject(() => acw1RequestBinding("commit", full(p.P04.commitRequestWithoutProof), { ...commitContext, preparedBinding: p.P03.portalBinding }));
  await reject(() => acw1AckBinding(full(p.P06.ackRequestWithoutProof), { ...ackContext, resultId: id.accountId }));
  await reject(() => acw1AckBinding(full(p.P06.ackRequestWithoutProof), { ...ackContext, resultDigest: p.P03.portalBinding }));
});
for (const operation of ["status", "cancel"]) {
  test(operation + " null binding remains valid after client lost PREPARED response", async () => {
    const unsigned = { profile: "ACW1", operation, attemptId: id.attemptId,
      ticket: p.P03.ticket, preparedBinding: null };
    assert.equal((await acw1RequestBinding(operation, full(unsigned), commitContext)).operation, operation);
    const changed = { ...unsigned, preparedBinding: p.P03.portalBinding };
    await reject(() => acw1RequestBinding(operation, full(changed), commitContext));
  });
}
test("proof is excluded from U, and a hash never verifies the signature", async () => {
  const req = p.P04.commitRequestWithoutProof;
  const tiny = Buffer.concat([Buffer.alloc(31), Buffer.from([1]), Buffer.alloc(31), Buffer.from([1])]).toString("base64url");
  const out = await acw1RequestBinding("commit", json({ ...req, proof: tiny }), commitContext);
  assert.equal(out.requestHash.digest, p.P04.requestHash);
  assert.equal(out.verification, "UNVERIFIED");
});
test("request privacy projection remains the existing strict boundary", async () => {
  const req = { ...p.P04.prepareRequestWithoutProof,
    client: { clientType: "browser_extension", label: "__PUBLIC_MISMATCH__" } };
  await reject(() => acw1RequestBinding("prepare", full(req), requestContext));
});
test("raw duplicate and negative-zero evidence cannot disappear before hashing", async () => {
  const req = full(p.P04.commitRequestWithoutProof);
  await reject(() => acw1RequestBinding("commit", req.replace('"profile":"ACW1"', '"profile":"ACW1","profile":"ACW1"'), commitContext));
  await reject(() => acw1PreparedBinding(json(P).replace('"preparedAt":'+P.preparedAt, '"preparedAt":-0'), preparedContext));
});
test("P05 result digest literal and no credentials in returned helper metadata", async () => {
  const out = await acw1ResultBinding(p.P05.plaintextCanonicalUTF8, resultContext, p.P05.resultDigest);
  assert.equal(out.digest, p.P05.resultDigest); assert.equal(out.purpose, "result");
  assert.deepEqual(Object.keys(out).sort(), ["digest", "profile", "purpose", "verification"]);
});
for (const field of Object.keys(resultContext)) {
  test("result context rejects mismatch in " + field, async () => {
    const actual = resultContext[field]; const value = typeof actual === "number" ? actual + 1 : "__PUBLIC_MISMATCH__";
    await reject(() => acw1ResultBinding(p.P05.plaintextCanonicalUTF8, { ...resultContext, [field]: value }));
  });
}
test("result digest mismatch and changed token cannot reuse immutable resultDigest", async () => {
  await reject(() => acw1ResultBinding(p.P05.plaintextCanonicalUTF8, resultContext, p.P03.portalBinding));
  const changed = p.P05.plaintextCanonicalUTF8.replace(C.accessToken, "PUBLIC_SYNTHETIC_CHANGED");
  await reject(() => acw1ResultBinding(changed, resultContext, p.P05.resultDigest));
});
test("C must remain canonical; public context cannot carry opaque tokens", async () => {
  await reject(() => acw1ResultBinding(" " + p.P05.plaintextCanonicalUTF8, resultContext));
  await reject(() => acw1ResultBinding(p.P05.plaintextCanonicalUTF8, { ...resultContext, accessToken: C.accessToken }));
});
test("public C/AD/result bindings match without claiming AEAD verification", async () => {
  const envelope = { aad: AD, ciphertext: p.P05.ciphertext, tag: p.P05.tag };
  const out = await acw1CheckResultEnvelopeBindings(p.P05.plaintextCanonicalUTF8, envelope, resultContext, keyContext);
  assert.equal(out.digest, p.P05.resultDigest); assert.equal(out.verification, "UNVERIFIED");
  const wrongTag = { ...envelope, tag: Buffer.alloc(16).toString("base64url") };
  assert.equal((await acw1CheckResultEnvelopeBindings(p.P05.plaintextCanonicalUTF8, wrongTag, resultContext, keyContext)).verification, "UNVERIFIED");
});
test("AD shared metadata, digest and expected key mismatches reject", async () => {
  const envelope = { aad: AD, ciphertext: p.P05.ciphertext, tag: p.P05.tag };
  for (const aad of [{ ...AD, accountId: id.resultId }, { ...AD, resultDigest: p.P03.portalBinding },
    { ...AD, grantIssuedAt: AD.grantIssuedAt + 1 }])
    await reject(() => acw1CheckResultEnvelopeBindings(p.P05.plaintextCanonicalUTF8, { ...envelope, aad }, resultContext, keyContext));
  await reject(() => acw1CheckResultEnvelopeBindings(p.P05.plaintextCanonicalUTF8, envelope, resultContext,
    { ...keyContext, proofThumbprint: p.P03.portalBinding }));
});
test("inputs are snapshotted before async SHA, without invoking accessors", async () => {
  const ctx = { ...preparedContext }; const pending = acw1PreparedBinding(json(P), ctx);
  ctx.accountId = id.resultId; assert.equal((await pending).digest, p.P04.preparedBinding);
  let invoked = false; const bad = { ...preparedContext };
  Object.defineProperty(bad, "accountId", { enumerable: true, get() { invoked = true; return id.accountId; } });
  await reject(() => acw1PreparedBinding(json(P), bad)); assert.equal(invoked, false);
});
