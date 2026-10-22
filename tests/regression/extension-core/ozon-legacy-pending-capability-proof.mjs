import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
const workerArg = process.argv[2] || "-";
const root = path.resolve(process.argv[3] || process.cwd());
const sourcePath = path.resolve(process.argv[4] || path.join(root,"apps/extension/src/background/context/ensureBatchCapabilityAndPlanning.js"));
const owned = readFileSync(sourcePath,"utf8").trim();
let code = owned;
if (workerArg !== "-") {
  const worker = readFileSync(path.resolve(workerArg),"utf8");
  const found = /^async function ensureBatchCapabilityAndPlanning\([\s\S]*?^}[ \t]*$/m.exec(worker);
  assert.ok(found,"compiled worker requires owned batch planner");
  assert.equal(found[0].trim(),owned,"compiled source/ZIP must match the exact owned source");
  code = found[0];
}
const contractPath = workerArg === "-"
  ? path.join(root,"apps/extension/src/imported/ozon-v0.1.22/shared/ozon_contract.js")
  : path.join(path.dirname(path.resolve(workerArg)),"shared/ozon_contract.js");
const contractSource = readFileSync(contractPath,"utf8");
const marker="INERT_PRIVATE_UNTRUSTED_ERROR";
const profiles = {
  legacy_known: {status:"known",subscription_type:"PREMIUM",is_premium:true,probe_performed:true,probe_http_status:200},
  legacy_outer_only: {status:"known",subscription_type:"PREMIUM",is_premium:true,probe_performed:true,probe_http_status:200},
  witnessed_known: {status:"known",subscription_type:"PREMIUM",is_premium:true,probe_performed:true,probe_observation:"RESPONSE_OBSERVED",probe_http_status:200},
  witnessed_http403: {status:"known",subscription_type:"PREMIUM",is_premium:true,probe_performed:true,probe_observation:"RESPONSE_OBSERVED",probe_http_status:403},
  unconfirmed_fetch: {status:"known",subscription_type:"PREMIUM",is_premium:true,probe_performed:true,probe_observation:"FETCH_INVOKED_OUTCOME_UNKNOWN",probe_http_status:0},
  recovered_unknown: {status:"unknown",subscription_type:"UNKNOWN",is_premium:null,probe_performed:null,probe_observation:"RECOVERED_UNKNOWN",probe_error_code:"CAPABILITY_PROBE_OUTCOME_UNKNOWN_NO_RETRY",probe_http_status:0},
  unknown_private_code: {status:"unknown",subscription_type:"UNKNOWN",probe_performed:true,probe_observation:"RESPONSE_OBSERVED",probe_http_status:403,probe_error_code:marker},
  no_capability_needed: {status:"not_needed",subscription_type:"UNKNOWN",probe_performed:false,probe_observation:"NOT_NEEDED",probe_http_status:0}
};
const expected={
 legacy_known:["planning_error","unknown","LEGACY_UNKNOWN",null],
 legacy_outer_only:["planning_error","unknown","LEGACY_UNKNOWN",null],
 witnessed_known:["command","known","RESPONSE_OBSERVED",true],
 witnessed_http403:["planning_error","unknown","RESPONSE_OBSERVED",true],
 unconfirmed_fetch:["planning_error","unknown","FETCH_INVOKED_OUTCOME_UNKNOWN",true],
 recovered_unknown:["planning_error","unknown","RECOVERED_UNKNOWN",null],
 unknown_private_code:["planning_error","unknown","RESPONSE_OBSERVED",true],
 no_capability_needed:["command","not_needed","NOT_NEEDED",false]
};
async function check(mode){
 const gated=mode!=="no_capability_needed";
 const ctx=vm.createContext({Date,TextEncoder,TextDecoder,WORKER_SESSION_ID:"INERT_CURRENT_WORKER"});
 ctx.OzonEntitlements={requirementFor:()=>({
   known:true,required:gated,allowed_subscription_types:["PREMIUM"],
   reasons:["INERT_PREMIUM_REQUIRED"]
 }),humanTierList:()=>"PREMIUM"};
 vm.runInContext(contractSource,ctx);
 const ops=vm.runInContext('({inert_premium:{effect:"READ",method:"POST",path:"/v1/roles",provider:"seller_api",response_style:"json",execution_enabled:false}})',ctx);
 ctx.OzonContract=ctx.OzonContractFactory.createOzonContract({operations:ops});
 ctx.capabilityUnknownProfile=()=>({status:"unknown"});
 ctx.OzonProvider={resolveSellerCapability:async()=>{throw Error("PROVIDER_RETRY_FORBIDDEN")}};
 ctx.diagnostic=async()=>{};
 vm.runInContext(code+";globalThis.testBatch=ensureBatchCapabilityAndPlanning;",ctx);
 const raw={batch:{planning_state:"pending",request_state:"idle",next_index:0,
  entries:[{kind:"command",status:"pending",command:{operation:"inert_premium",params:{}}}],
  capability_resolution:{state:"complete",probe_performed:profiles[mode].probe_performed,
    probe_observation:mode==="legacy_outer_only"?"RESPONSE_OBSERVED":profiles[mode].probe_observation,
    profile:profiles[mode]}
 }};
 let owner=vm.runInContext("("+JSON.stringify(raw)+")",ctx);
 const before=JSON.stringify(owner.batch.capability_resolution.profile);
 let failCalls=0,providerCalls=0;
 ctx.OzonProvider={resolveSellerCapability:async()=>{providerCalls++;throw Error("PROBE_REPLAY_FORBIDDEN")}};
 const args={ownerKind:"INERT",ownerId:"INERT",
  getOwner:async()=>owner,
  mutateOwner:async fn=>{owner=fn(owner);return owner},
  ownerMatches:()=>true,isCollecting:()=>true,
  failOwner:async()=>{failCalls++;throw Error("FAIL_OWNER_NOT_IN_SCOPE")},
  executionContext:{settings:async()=>({sellerApiMetadata:{},sellerCredentials:{}})}
 };
 const out=await ctx.testBatch(args);
 assert.equal(out.code,"BATCH_PLANNING_READY");
 const entry=owner.batch.entries[0],meta=entry.planning?.capability;
 const [kind,status,observation,performed]=expected[mode];
 assert.ok(meta,mode+" capability planning must exist");
 assert.equal(entry.kind,kind,mode+" fail closed");
 assert.equal(meta.status,status,mode+" actual entitlement status");
 assert.equal(meta.probe_observation,observation,mode+" observation");
 assert.equal(meta.probe_performed,performed,mode+" tri-state");
 if(gated)assert.equal(JSON.stringify(owner.batch.capability_resolution.profile),before,"persisted legacy profile must be untouched");
 assert.equal(JSON.stringify(entry.planning).includes(marker),false,"no private error code");
 if(mode==="unknown_private_code")assert.equal(meta.probe_error_code,"SELLER_CAPABILITY_PROBE_FAILED");
 assert.equal(failCalls,0);assert.equal(providerCalls,0);
 assert.equal((await ctx.testBatch(args)).code,"BATCH_PLANNING_READY");
 assert.equal(providerCalls,0,"no duplicate entitlement probe");
 return {mode,kind,status,observation,performed};
}
const results=[];
for(const mode of Object.keys(expected))results.push(await check(mode));
console.log(JSON.stringify({verdict:"INERT_R14_LEGACY_PENDING_PROOF_8_CASES_PASS",results,no_provider_calls:true,r15_completed_plan_not_patched:true}));
