import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";

// SOURCE_VM only: mocks persistence, browser and provider. Does not claim
// actual file attachment or real WB/owner/production acceptance.
const root=path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)),"../../.."));
const sourcePath=path.resolve(process.argv[3] || path.join(root,"apps/extension/src/application/delivery.js"));
const source=fs.readFileSync(sourcePath,"utf8");
const sourceGitBlob=execFileSync("git",["hash-object",sourcePath],{encoding:"utf8"}).trim();
assert.ok(source.includes("async function saPrepareDelivery("));
const stored=new Map();
let fakeWrites=0,guards=0,sourceCalls=0;
const scope={
  Date,Uint8Array,Buffer,
  saEnabled:async()=>true,
  saGuard:async()=>({assertCurrent:async()=>{guards++;}}),
  saError:code=>Object.assign(new Error(code),{code}),
  sha256Hex:async text=>createHash("sha256").update(String(text||"")).digest("hex"),
  ProviderTransportCore:{reportBase64ToBytes:s=>new Uint8Array(Buffer.from(s,"base64"))},
  OzonAIDeliveryCapabilities:{extensionFromFilename:()=>"pdf"},
  OzonFileDeliveryWorker:{storeApplicationArtifact:async data=>{
    fakeWrites++;
    const checksum=createHash("sha256").update(Buffer.from(data.bytes)).digest("hex");
    const prior=stored.get(data.artifact_key);
    if(prior&&prior!==checksum)throw Object.assign(new Error("mock store rejects different bytes for same key"),{code:"SIMULATED_MISMATCH"});
    stored.set(data.artifact_key,checksum);
    return{filename:data.filename,byte_length:data.bytes.byteLength,sha256:checksum};
  }}
};
scope.globalThis=scope;
vm.createContext(scope);
vm.runInContext(source+"\nglobalThis.__prepare=saPrepareDelivery;",scope,{filename:"apps/extension/src/application/delivery.js",timeout:1600});
const entry=(attempt,content="SYNTHETIC")=>{
  const b=Buffer.from(content);
  return{http_status:200,operation:"wb-binary-fixture",request_id:"req-"+attempt,
    provider_attempt:{provider_attempt_id:attempt},
    report_text:"WB_RESULT_V1\n"+JSON.stringify({result:{
      content_base64:b.toString("base64"),byte_length:b.length,
      original_filename:"synthetic.pdf",content_type:"application/pdf"
    }})
  };
};
const owner=(account="acctA",store="storeA",operation="op1",marketplace="wildberries")=>({
  operation_id:operation,payload_expires_at_ms:Date.now()+60000,
  execution_context:{accountId:account,storeId:store,marketplace,
    bindingId:"binding1",bindingRevision:1,workSessionId:"session1",conversationKey:"conversation1"}
});
async function ref(attempt,account,store,operation,marketplace,content){
  sourceCalls++;
  const input=entry(attempt,content);
  const result=await scope.__prepare([input],owner(account,store,operation,marketplace));
  assert.equal(result.length,1);
  if(marketplace&&marketplace!=="wildberries"){assert.equal(result[0],input);return null;}
  assert.match(result[0].provider_file_ref,/^sa_file_[a-f0-9]{64}$/);
  assert.ok(result[0].report_text.includes("SAVED_FOR_ATTACHMENT_NOT_YET_SENT"));
  return result[0].provider_file_ref;
}
const different=[await ref("first"),await ref("second")];assert.notEqual(...different);
const punctuation=[await ref("p:a"),await ref("p/a")];assert.notEqual(...punctuation);
const crossAccount=[await ref("shared","acctA","storeA"),await ref("shared","acctB","storeB")];assert.notEqual(...crossAccount);
const crossStore=[await ref("shared","acctA","storeA"),await ref("shared","acctA","storeB")];assert.notEqual(...crossStore);
const longIds=[await ref("x".repeat(180)+"1"),await ref("x".repeat(180)+"2")];assert.notEqual(...longIds);
const operations=[await ref("same","acctA","storeA","op1"),await ref("same","acctA","storeA","op2")];assert.notEqual(...operations);
const stable=[await ref("same"),await ref("same")];assert.equal(...stable);
await ref("ignored","acctA","storeA","op1","ozon");
assert.equal(fakeWrites,sourceCalls-1);
assert.equal(guards,3*fakeWrites);
for(const [account,store] of [["","storeA"],["acctA",""]])
  await assert.rejects(()=>scope.__prepare([entry("invalid")],owner(account,store)),e=>e.code==="EXECUTION_CONTEXT_MISSING");
const stableRef=await ref("same");
const checksum=stored.get("provider:"+stableRef);
await assert.rejects(()=>scope.__prepare([entry("same","DIFFERENT_BYTES")],owner()),e=>e.code==="SIMULATED_MISMATCH");
assert.equal(stored.get("provider:"+stableRef),checksum);
assert.ok(stored.size<fakeWrites);
// R10: the same real attempt/request retains identity even if a preceding
// non-eligible batch entry is inserted during re-finalization/restart.
const batchSource = entry("stable-ordinal-attempt");
const batchOwner = owner();
const beforeOrd = stored.size, beforeWrites = fakeWrites;
const direct = await scope.__prepare([batchSource], batchOwner);
const shifted = await scope.__prepare([
  { status: "skipped", http_status: 500, report_text: "IGNORED" },
  batchSource,
], batchOwner);
sourceCalls += 2;
assert.equal(direct[0].provider_file_ref, shifted[1].provider_file_ref,
  "logical provider attempt must keep the same artifact ref despite unrelated entry reordering");
assert.equal(fakeWrites, beforeWrites+2);
assert.equal(stored.size, beforeOrd+1);
assert.match(direct[0].provider_file_ref, /^sa_file_[a-f0-9]{64}$/);

// R11: if there is no provider-attempt ID, a stable request ID still
// survives unrelated entry insertion, while the genuine no-ID fallback remains ordinal-scoped.
const requestOnly = { ...entry("request-only"), provider_attempt: undefined };
const reqBefore = await scope.__prepare([requestOnly], batchOwner);
const reqShifted = await scope.__prepare([{http_status:500,report_text:"UNQUALIFIED"}, requestOnly], batchOwner);
assert.equal(reqBefore[0].provider_file_ref, reqShifted[1].provider_file_ref,
  "stable request-only identity must survive unrelated batch insertion");
const noIds = { ...entry("no-ids"), provider_attempt: undefined, request_id: undefined };
const fallback0 = await scope.__prepare([noIds], batchOwner);
const fallback1 = await scope.__prepare([{http_status:500,report_text:"UNQUALIFIED"}, noIds], batchOwner);
assert.notEqual(fallback0[0].provider_file_ref, fallback1[1].provider_file_ref,
  "no stable request/attempt ID must use ordinal as fallback");
const changedRequest = { ...batchSource, request_id:"different-request-same-provider-attempt" };
const originalAttempt = await scope.__prepare([batchSource],batchOwner);
const shiftedRequest = await scope.__prepare([changedRequest],batchOwner);
assert.equal(originalAttempt[0].provider_file_ref,shiftedRequest[0].provider_file_ref,
  "provider-attempt authority must outrank incidental request ID");
const attemptNamespace = { ...entry("same-value"), request_id:"request-elsewhere" };
const requestNamespace = { ...entry("other-value"), provider_attempt:undefined, request_id:"same-value" };
const attemptRef = await scope.__prepare([attemptNamespace],batchOwner);
const requestRef = await scope.__prepare([requestNamespace],batchOwner);
assert.notEqual(attemptRef[0].provider_file_ref,requestRef[0].provider_file_ref,
  "attempt and request identity namespaces must not collide");
sourceCalls += 8;

console.log(JSON.stringify({status:"PASS",scenario:"A04_WB_ORIGINAL_FILE_REF_SCOPED_INJECTIVITY",level:"SOURCE_VM_SYNTHETIC_ONLY",
 sourceGitBlob,checks:15,
 assertions:{different_attempts:true,punctuation_distinct:true,account_and_store_separated:true,truncated_raw_ids_distinct:true,
 operation_separated:true,same_logical_key_stable:true,invalid_scope_rejected:true,changed_bytes_mock_rejected:true,non_WB_unchanged:true,stable_identity_across_ordinal_shift:true,request_fallback_stable:true,missing_ids_use_ordinal:true,attempt_id_priority:true,identity_type_domain_separated:true},
 calls:{source:sourceCalls,mock_persistence:fakeWrites,owner_guard:guards,provider_http:0},
 limitations:"Real IndexedDB artifact storage, copyManifest, installed attachment, owner/providers and production NOT VERIFIED"}));