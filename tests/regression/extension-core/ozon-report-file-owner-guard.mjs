import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {fileURLToPath} from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
const appSource = readFileSync(path.join(ROOT, "apps/extension/src/application/runtime.js"), "utf8");
const coreSource = readFileSync(path.join(ROOT, "apps/extension/src/background/context/executeOzonCore.js"), "utf8");
const guardBegin = "async function saCheckOzonFileRef(command, context) {";
const guardEnd = "async function saRememberOzonFileRefs(response, context) {";
assert.equal(appSource.split(guardBegin).length, 2, "unique production app guard required");
assert.equal(appSource.split(guardEnd).length, 2);
const i=appSource.indexOf(guardBegin), j=appSource.indexOf(guardEnd, i);
assert.ok(i>=0 && j>i && j-i<2400);
const guardCode=appSource.slice(i,j);
const providerArgument = process.argv[2] ? path.resolve(process.argv[2]) : "";
const packageMode = providerArgument.endsWith("/shared/ozon_provider.js");
let selectedGuardCode = guardCode;
let selectedCoreSource = coreSource;
if (packageMode) {
  const runtime = path.dirname(path.dirname(providerArgument));
  const entry = readFileSync(path.join(runtime, "service_worker_entry.js"), "utf8");
  const packagedApplication = readFileSync(path.join(runtime, "shared/application.js"), "utf8");
  const packagedWorker = readFileSync(path.join(runtime, "service_worker.js"), "utf8");
  assert.ok(entry.includes('importScripts("shared/application.js")'), "packaged application must be loaded");
  assert.equal(packagedApplication.split(guardCode).length, 2, "package must retain exactly one matching guard");
  assert.equal(packagedWorker.split(coreSource).length, 2, "package must retain exactly one matching Ozon executor");
  const start = packagedApplication.indexOf(guardBegin), end = packagedApplication.indexOf(guardEnd, start);
  assert.ok(start >= 0 && end > start);
  selectedGuardCode = packagedApplication.slice(start, end);
  selectedCoreSource = packagedWorker.slice(packagedWorker.indexOf(coreSource), packagedWorker.indexOf(coreSource) + coreSource.length);
}
assert.match(coreSource, /await saCheckOzonFileRef\(command, executionContext\);/);
assert.ok(coreSource.indexOf("await saCheckOzonFileRef(command, executionContext);") <
  coreSource.indexOf("OzonProvider.executeCommandObject("),
  "account/store proof must precede provider attempt");

const REF="rpf_p_INERT_ONLY";
const OWN={accountId:"ACCOUNT_A", storeId:"STORE_A", credentialRevision:"REV_A",
  expires_at_ms:Date.now()+3600000};

function harness(owned, variant=null) {
  let providerCalls=0, guardChecks=0, recordReads=0;
  const localSource = variant==="remove_account_check"
    ? selectedGuardCode.replace('["accountId", "storeId", "credentialRevision"]','["storeId", "credentialRevision"]')
    : selectedGuardCode;
  if(variant==="remove_account_check") assert.notEqual(localSource,selectedGuardCode);
  const context={
    OzonContract:{
      parseCommand:()=>({operation:"report_file_get",params:{file_ref:REF}}),
      normalizeCommand:x=>x,
      commandFingerprint:()=>"INERT_FINGERPRINT",
      preflightExecution:()=>({meta:{provider:"report_file"}}),
      safeBridgeErrorPayload:e=>({code:e?.code||"UNKNOWN",message:"SOURCE_ONLY",http_status:0}),
    },
    OzonProvider:{
      async executeCommandObject(){
        providerCalls++;
        return {ok:true, http_status:200, report_text:"OZON_RESULT_V1\n{}",
          provider:"report_file", request_id:"INERT_REQUEST", rate_limit:null};
      },
    },
    saFileOwners:{async get(ref){recordReads++;assert.equal(ref,REF);return owned;}},
    saError:code=>Object.assign(new Error(code),{code}),
    saRememberOzonFileRefs:async()=>{},
    getSettings:async()=>({autoSend:false}),
    diagnostic:async()=>{},
    setStatus:async()=>{},
    safeQuotaMetadata:()=>null,
    extendAnalyticsQuotaFromRetryAfter:()=>null,
  };
  vm.createContext(context);
  vm.runInContext(localSource+"\n"+selectedCoreSource+"\nglobalThis.executeTest=executeOzonCore",context);
  return {
    call:current=>context.executeTest(REF,{executionContext:current}),
    calls:()=>({providerCalls,guardChecks,recordReads}),
    makeContext:(fields={},failCurrent=false)=>({
      snapshot:{accountId:"ACCOUNT_A",storeId:"STORE_A",credentialRevision:"REV_A",...fields},
      async settings(){return {sellerCredentials:{},performanceCredentials:{},autoSend:false};},
      async assertCurrent(){guardChecks++;if(failCurrent)throw Object.assign(new Error("REVOKED"),{code:"EXECUTION_CONTEXT_CHANGED"});},
    }),
  };
}
const checks=[];
async function negative(name,record,fields={},failCurrent=false,useNull=false,expected="REPORT_FILE_STORE_MISMATCH"){
  const h=harness(record);
  await assert.rejects(()=>h.call(useNull?null:h.makeContext(fields,failCurrent)),err=>err?.code===expected,name);
  assert.equal(h.calls().providerCalls,0,name+" must not enter Ozon provider");
  checks.push({name,pass:true,provider_calls:0});
}
const own=harness(OWN);
const actual=await own.call(own.makeContext());
assert.equal(actual.ok,true);
assert.equal(own.calls().providerCalls,1);
checks.push({name:"same-owner-allowed",pass:true,provider_calls:1});
await negative("different-account",OWN,{accountId:"ACCOUNT_B"});
await negative("different-store",OWN,{storeId:"STORE_B"});
await negative("different-credential-revision",OWN,{credentialRevision:"REV_B"});
await negative("missing-owner-record",null);
await negative("missing-execution-context",OWN,{},false,true);
await negative("expired-ref",{...OWN,expires_at_ms:Date.now()-100});
// Persistent RED until the current runtime.js single writer repairs the
// malformed/absent expiry fail-closed gap; do not turn these into expected PASS.
await negative("missing-expiry",{...OWN,expires_at_ms:undefined});
await negative("nan-expiry",{...OWN,expires_at_ms:NaN});
await negative("infinite-expiry",{...OWN,expires_at_ms:Infinity});
await negative("nonnumeric-expiry",{...OWN,expires_at_ms:"nonsense"});
await negative("revoked-current-authority",OWN,{},true,false,"EXECUTION_CONTEXT_CHANGED");
const weakened=harness(OWN,"remove_account_check");
const bad=await weakened.call(weakened.makeContext({accountId:"ACCOUNT_B"}));
assert.equal(bad.ok,true);
assert.equal(weakened.calls().providerCalls,1,"mutation must expose provider call");
checks.push({name:"mutation-removed-account-check-detected",pass:true,mutant_provider_calls:1});
export const guardResult = Object.freeze({
 status:"PASS",boundary:packageMode ? "COMPOSED_PACKAGE_GUARD_AND_EXECUTOR_VM" : "SOURCE_GUARD_AND_EXECUTOR_VM",
 cases:checks.length,checks,real_Ozon_calls:0,installed_acceptance:false,
 original_guard_source_loaded:true, package_files_verified:packageMode, mutation_sensitivity:true,
});
