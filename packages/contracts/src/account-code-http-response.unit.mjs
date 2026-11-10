import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { encodeAcj1 } from "./account-code-acj1.js";
import { consumeAcw1HttpResponse as consume, consumeAcw1HttpMetadataResponse as metadata } from "./account-code-http-response.ts";

// Expectations are literal FINAL v2 rules, written before execution. Existing
// P01-P06 constants are PUBLIC SYNTHETIC, never credentials or issuer authority.
let registered = 0, entered = 0;
function unit(name, fn) { registered++; test(name, () => { entered++; fn(); }); }
after(() => {
  console.log("HTTP_RESPONSE_CALLBACKS registered=" + registered + " entered=" + entered);
  const filtered = process.execArgv.some(x => x === "--test-name-pattern" || x.startsWith("--test-name-pattern="));
  if (!filtered) assert.equal(entered, registered);
  else assert.ok(entered > 0 && entered <= registered);
});
const fixture = JSON.parse(readFileSync(new URL("./account-code-wire.fixture.json", import.meta.url), "utf8"));
const p = fixture.positive, id = fixture.ids, json = JSON.stringify;
const clone = x => JSON.parse(json(x));
const marker = "__PUBLIC_RESPONSE_PRIVATE_MARKER__";
const ops = ["issue", "rotate", "allocate", "prepare", "commit", "cancel", "status", "ack"];
const errors = { INVALID_REQUEST:400, AUTH_REQUIRED:401, FORBIDDEN:403, RATE_LIMITED:429,
  SERVICE_UNAVAILABLE:503, ACCOUNT_CODE_INVALID:400, ACCOUNT_CODE_UNAVAILABLE:503,
  ACCOUNT_CODE_REVISION_CONFLICT:409, ATTEMPT_EXPIRED:409, ATTEMPT_CONFLICT:409, RECOVERY_UNAVAILABLE:409 };
const prepared = JSON.parse(p.P04.preparedCanonicalUTF8), ad = JSON.parse(p.P05.AADCanonicalUTF8);
const envelope = { aad:ad, ciphertext:p.P05.ciphertext, tag:p.P05.tag };
const binding = p.P04.preparedBinding;
const ref = Object.fromEntries(["resultId","resultDigest","deviceId","sessionId","grantIssuedAt",
  "accessExpiresAt","refreshExpiresAt","initialRefreshGeneration"].map(k => [k, ad[k]]));
const ticketPayload = JSON.parse(p.P03.ticketPayloadCanonicalUTF8);
const allocation = { attemptId:id.attemptId, ticket:p.P03.ticket, serverNonce:ticketPayload.serverNonce,
  proofThumbprint:p.P02.proofThumbprint, recipientThumbprint:p.P02.recipientThumbprint,
  issuedAt:ticketPayload.issuedAt, notAfter:ticketPayload.notAfter };
const active = { accountId:id.accountId, codeRevision:1, state:"ACTIVE", createdAt:1 };
const absent = { accountId:id.accountId, codeRevision:0, state:"ABSENT", createdAt:null };
const ctx = { attemptId:id.attemptId, operationId:id.operationId, accountId:id.accountId };
const error = (operation, code) => ({ profile:"ACW1", operation, error:{ code } });
function common(r, expectedOperation) {
  assert.equal(r.verification, "UNVERIFIED"); assert.equal(r.executionOutcome, "UNKNOWN");
  assert.equal(r.downstreamDispatched, false); assert.equal(r.cacheEnforcement, "NOT_CHECKED");
  assert.deepEqual(r.requiredResponseMetadata, { headers:{ "cache-control":"no-store" } });
  assert.deepEqual(r.safeLog, { expectedOperation, executionOutcome:"UNKNOWN" });
  assert.ok(Object.isFrozen(r)); assert.ok(Object.isFrozen(r.safeLog));
  assert.ok(Object.isFrozen(r.requiredResponseMetadata.headers));
  for (const k of ["authenticated", "noGrant", "retry", "remint", "cancelSuccess", "ackAllowed", "installReady"])
    assert.equal(Object.hasOwn(r,k), false);
  assert.equal(json(r.safeLog).includes(marker), false);
}
function unknown(r, op="commit") {
  common(r,op); assert.equal(r.kind,"UNKNOWN_TRANSPORT");
  assert.equal(Object.hasOwn(r,"data"),false); assert.equal(Object.hasOwn(r,"status"),false);
  assert.equal(json(r).includes(marker), false);
}
const states = [];
function add(op,state,fields={}) {
  states.push({ op, state, value:{ profile:"ACW1", operation:op, state,
    ...(!["issue","rotate","allocate"].includes(op) ? {attemptId:id.attemptId} : {}), ...fields } });
}
for (const op of ["issue","rotate"]) {
  add(op,"CODE_ISSUED",{operationId:id.operationId,metadata:active,accountCode:p.P03.accountCode});
  add(op,"APPLIED_SECRET_NOT_REPLAYABLE",{operationId:id.operationId,metadata:active});
}
add("allocate","ALLOCATED",{allocation}); add("status","ALLOCATED",{allocation});
for (const op of ["prepare","status","commit"]) add(op,"PREPARED",{prepared,preparedBinding:binding});
for (const op of ["commit","status","cancel"]) add(op,"COMMITTED",{preparedBinding:binding,result:envelope});
for (const op of ["commit","status","cancel","ack"]) {
  add(op,"COMMITTED_DELIVERED",{preparedBinding:binding,resultRef:ref,ackedAt:2,reason:"ACKNOWLEDGED"});
  for (const reason of ["REFRESH_ROTATED","REVOKED","AUTHORITY_DENIED","CREDENTIAL_EXPIRED","WINDOW_EXPIRED","CIPHERTEXT_MISSING"])
    add(op,"COMMITTED_NO_RECOVERY",{preparedBinding:binding,resultRef:ref,ackedAt:null,reason});
}
for (const op of ["cancel","status","commit"]) for (const state of ["CANCELLED","EXPIRED_NO_COMMIT"])
  for (const preparedBinding of [null,binding]) add(op,state,{preparedBinding});
for (const op of ["status","cancel","commit","ack"]) add(op,"UNKNOWN_EXPIRED");
for (const [n,s] of states.entries()) unit("state union " + n + " " + s.op + "/" + s.state, () => {
  const r=consume(s.op,200,json(s.value),ctx); common(r,s.op);
  assert.equal(r.kind,"ACW1_STATE_DATA"); assert.equal(r.status,200); assert.deepEqual(r.data,s.value);
});
unit("all unlisted operation/state pairs are UNKNOWN", () => {
  const representatives=[...new Map(states.map(x => [x.state,x])).values()];
  for(const s of representatives) for(const op of ops) {
    if(states.some(x=>x.op===op && x.state===s.state)) continue;
    const value={...s.value,operation:op}; unknown(consume(op,200,json(value),ctx),op);
  }
});
for (const [code,status] of Object.entries(errors)) unit("closed error/status mapping " + code, () => {
  for(const op of ops) {
    const value=error(op,code), r=consume(op,status,json(value),ctx);common(r,op);
    assert.equal(r.kind,"ACW1_ERROR_DATA");assert.equal(r.status,status);assert.deepEqual(r.data,value);
    for(const wrong of [200,400,401,403,409,429,503,500].filter(x=>x!==status))
      unknown(consume(op,wrong,json(value),ctx),op);
  }
});
for(const op of ["issue","rotate"]) unit("metadata permit " + op, () => {
  const m=op==="issue"?absent:active;
  const payload={profile:"ACW1",kind:"write",keyVersion:1,operation:op,operationId:id.operationId,
    accountId:id.accountId,baseRevision:m.codeRevision,portalBinding:p.P03.portalBinding,
    issuedAt:ticketPayload.issuedAt,notAfter:ticketPayload.notAfter};
  // Encode public structural payload with existing public MAC bytes; no signing.
  const ticket=Buffer.from(encodeAcj1(payload)).toString("base64url")+"."+p.P03.ticketMAC;
  const body={profile:"ACW1",metadata:m,writePermit:{operationId:id.operationId,ticket,
    issuedAt:payload.issuedAt,notAfter:payload.notAfter}};
  const r=metadata(op,200,json(body),ctx);common(r,op);assert.equal(r.kind,"ACW1_METADATA_DATA");assert.deepEqual(r.data,body);
  unknown(metadata(op,200,json(body),{...ctx,operationId:id.resultId}),op);
  unknown(metadata(op,200,json(body),{...ctx,accountId:id.resultId}),op);
  for(const [code,status] of Object.entries(errors)) {
    const e=metadata(op,status,json(error(op,code)),ctx);common(e,op);assert.equal(e.kind,"ACW1_ERROR_DATA");
  }
});
for(const outcome of ["APPLIED_SECRET_NOT_REPLAYABLE","UNKNOWN","UNKNOWN_EXPIRED"]) unit("lookup metadata "+outcome,()=>{
  const receipt={operationId:id.operationId,outcome,...(outcome==="APPLIED_SECRET_NOT_REPLAYABLE"?{codeRevision:1,createdAt:1}:{})};
  const value={profile:"ACW1",metadata:active,receipt};
  const r=metadata("lookup",200,json(value),ctx);common(r,null);assert.equal(r.kind,"ACW1_METADATA_DATA");assert.deepEqual(r.data,value);
  unknown(metadata("lookup",200,json(value),{...ctx,operationId:id.resultId}),null);
  unknown(metadata("lookup",200,json(value),{}),null);
});
unit("lookup non200 and undefined metadata mode do not invent operation",()=>{
  for(const status of [400,401,403,409,429,503]) for(const op of ops)
    unknown(metadata("lookup",status,json(error(op,"SERVICE_UNAVAILABLE")),ctx),null);
  for(const mode of [undefined,null,"LOOKUP","commit",marker]) unknown(metadata(mode,200,"{}",ctx),null);
});
for(const [name,mutate] of [
  ["C01 extra top-level message",x=>({...x,message:marker})],
  ["C02 nested reason",x=>({...x,error:{...x.error,reason:marker}})],
  ["C03 unknown code",x=>({...x,error:{code:marker}})],
  ["C04 operation mismatch",x=>({...x,operation:"cancel"})],
]) unit(name,()=>{
  unknown(consume("commit",409,json(mutate(error("commit","ATTEMPT_CONFLICT"))),ctx));
});
const committed=states.find(x=>x.op==="commit" && x.state==="COMMITTED").value;
const preparedResponse=states.find(x=>x.op==="prepare").value;
unit("all response operation mismatches stay UNKNOWN",()=>{
  for(const s of states) for(const op of ops.filter(o=>o!==s.op)) unknown(consume(op,200,json(s.value),ctx),op);
});
unit("expected identity, missing context and invalid context shapes stay UNKNOWN",()=>{
  unknown(consume("commit",200,json(committed),{}));
  unknown(consume("commit",200,json(committed),{...ctx,attemptId:id.resultId}));
  unknown(consume("commit",200,json(committed),{...ctx,accountId:id.resultId}));
  const write=states.find(x=>x.op==="issue").value;
  unknown(consume("issue",200,json(write),{accountId:id.accountId}),"issue");
  unknown(consume("issue",200,json(write),{...ctx,operationId:id.resultId}),"issue");
  for(const context of [null,[],1,{extra:marker},{attemptId:marker},{attemptId:null},
    Object.create({attemptId:id.attemptId}),{[Symbol("extra")]:marker},
    Object.defineProperty({},"attemptId",{value:id.attemptId})])
    unknown(consume("commit",200,json(committed),context));
});
unit("context getters and converted body toJSON are never called",()=>{
  let getters=0,jsonCalls=0;
  const context={get attemptId(){getters++;return id.attemptId;}};
  unknown(consume("commit",200,json(committed),context));
  unknown(consume("commit",200,{toJSON(){jsonCalls++;return committed;}},ctx));
  assert.equal(getters,0);assert.equal(jsonCalls,0);
});
unit("wrong profile/state/missing/extra fields are UNKNOWN without repair",()=>{
  for(const value of [null,[],{}, {...committed,profile:"OTHER"},{...committed,state:marker},
    {...committed,extra:marker},{...committed,preparedBinding:null},{...committed,result:null}])
    unknown(consume("commit",200,json(value),ctx));
  const value=clone(committed);delete value.attemptId;unknown(consume("commit",200,json(value),ctx));
});
unit("closed nested P/Client and E/tag/result-ref schemas retain raw rejection",()=>{
  const value=clone(preparedResponse);value.prepared.client.label=marker;
  unknown(consume("prepare",200,json(value),ctx),"prepare");
  const e=clone(committed);e.result.aad.extra=marker;unknown(consume("commit",200,json(e),ctx));
  const bad=clone(committed);bad.result.tag="AA";unknown(consume("commit",200,json(bad),ctx));
  const delivered=clone(states.find(x=>x.state==="COMMITTED_DELIVERED").value);
  delivered.resultRef.extra=marker;unknown(consume(delivered.operation,200,json(delivered),ctx),delivered.operation);
});
unit("valid-width tag mutations remain UNVERIFIED, not authentication",()=>{
  const value=clone(committed);value.result.tag=Buffer.alloc(16,42).toString("base64url");
  const r=consume("commit",200,json(value),ctx);common(r,"commit");assert.equal(r.kind,"ACW1_STATE_DATA");
});
unit("raw duplicate keys and escaped aliases rejected before conversion",()=>{
  const valid=json(committed);
  for(const body of [valid.replace('"profile":"ACW1"','"profile":"OTHER","profile":"ACW1"'),
    valid.replace('"operation":"commit"','"operat\\u0069on":"commit","operation":"commit"')])
    unknown(consume("commit",200,new TextEncoder().encode(body),ctx));
});
unit("forbidden numeric lexemes rejected before conversion",()=>{
  const valid=json(committed), n=String(ad.grantIssuedAt);
  for(const number of ["-0","+0","0.0","0e0","1e3","9007199254740992"])
    unknown(consume("commit",200,valid.replace('"grantIssuedAt":'+n,'"grantIssuedAt":'+number),ctx));
});
unit("raw UTF8/BOM/cap/truncated/no-body are UNKNOWN, never truncated to valid",()=>{
  const valid=json(committed);
  for(const body of [undefined,null,"",valid.slice(0,-1),"\ufeff"+valid,
    new Uint8Array([0xc3,0x28]),new Uint8Array([0xef,0xbb,0xbf,...new TextEncoder().encode(valid)]),
    valid+" ".repeat(16385),new Uint8Array(16385),Buffer.from("null"),"[",'{"x":"\\ud800"}'])
    unknown(consume("commit",200,body,ctx));
});
unit("ordinary wire whitespace and permitted escaping stay raw-codec compatible",()=>{
  const text=" \r\n\t"+json(committed).replace('"profile"','"profi\\u006ce"')+" \n";
  const r=consume("commit",200,new TextEncoder().encode(text),ctx);common(r,"commit");assert.equal(r.kind,"ACW1_STATE_DATA");
});
unit("unknown or missing status/body/operation never becomes ACW1 success",()=>{
  for(const status of [undefined,null,"200",0,201,202,204,301,404,500,NaN,Infinity,-0,200.5])
    unknown(consume("commit",status,json(committed),ctx));
  for(const op of [undefined,null,{},"lookup","COMMIT",marker]) unknown(consume(op,200,json(committed),ctx),null);
  for(const status of [400,401,403,409,429,503]) unknown(consume("commit",status,json(committed),ctx));
});
unit("errors never echo sensitive marker, thrown details or unknown transport",()=>{
  for(const body of ["<html>"+marker,"Error "+marker,json({message:marker}),
    json({profile:"ACW1",operation:"commit",error:{code:"ATTEMPT_CONFLICT",input:marker}})])
    unknown(consume("commit",409,body,ctx));
});
unit("safeLog excludes valid parsed sensitive DTO and metadata stays a requirement",()=>{
  const value=clone(preparedResponse);value.prepared.technicalDataConsent="PRESENT";value.prepared.client.label=marker;
  const r=consume("prepare",200,json(value),ctx);common(r,"prepare");assert.equal(r.kind,"ACW1_STATE_DATA");
  assert.equal(json(r.data).includes(marker),true);assert.equal(json(r.safeLog).includes(marker),false);
  assert.equal(Object.hasOwn(r,"cacheEnforced"),false);
});
unit("CANCELLED/EXPIRED/ABSENT/errors never authorize no-grant or retries",()=>{
  for(const s of states.filter(x=>["CANCELLED","EXPIRED_NO_COMMIT","UNKNOWN_EXPIRED"].includes(x.state)))
    common(consume(s.op,200,json(s.value),ctx),s.op);
  for(const code of ["ATTEMPT_CONFLICT","RATE_LIMITED","SERVICE_UNAVAILABLE"])
    common(consume("commit",errors[code],json(error("commit",code)),ctx),"commit");
});
unit("consumer does not dispatch, hash, store or mutate the input",()=>{
  let fetches=0,hashes=0;const oldFetch=globalThis.fetch;
  const oldDigest=globalThis.crypto.subtle.digest;
  const bytes=new TextEncoder().encode(json(committed)),before=bytes.slice(),saved=json(ctx);
  globalThis.fetch=()=>{fetches++;throw new Error("not permitted");};
  globalThis.crypto.subtle.digest=()=>{hashes++;throw new Error("not permitted");};
  try {
    const r=consume("commit",200,bytes,ctx);common(r,"commit");assert.equal(r.kind,"ACW1_STATE_DATA");
    assert.deepEqual(bytes,before);assert.equal(json(ctx),saved);assert.equal(fetches,0);assert.equal(hashes,0);
  } finally {globalThis.fetch=oldFetch;globalThis.crypto.subtle.digest=oldDigest;}
});
