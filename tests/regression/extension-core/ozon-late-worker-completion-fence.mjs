import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
const workerArg=process.argv[2]||"-";
const root=path.resolve(process.argv[3]||process.cwd());
const owned=fs.readFileSync(path.resolve(process.argv[4]||path.join(root,"apps/extension/src/background/context/ensureBatchCapabilityAndPlanning.js")),"utf8").trim();
const worker=fs.readFileSync(workerArg==="-"
  ? path.join(root,"apps/extension/src/imported/ozon-v0.1.22/service_worker.js")
  : path.resolve(workerArg),"utf8");
const match=/^async function ensureBatchCapabilityAndPlanning\([\s\S]*?^}[ \t]*$/m.exec(worker);
assert.ok(match,"compiled worker must contain the owned batch planner");
if(workerArg!=="-")assert.equal(match[0].trim(),owned,"source and packaged worker body must equal owned source");
const code=owned;
const contractPath=workerArg==="-"
  ? path.join(root,"apps/extension/src/imported/ozon-v0.1.22/shared/ozon_contract.js")
  : path.join(path.dirname(path.resolve(workerArg)),"shared/ozon_contract.js");
const contract=fs.readFileSync(contractPath,"utf8");
const unknown=/^function capabilityUnknownProfile\([\s\S]*?^}[ \t]*$/m.exec(worker);
assert.ok(unknown);
async function scenario(knownBeforeOldCompletion) {
 let durable={batch:{planning_state:"pending",request_state:"idle",next_index:0,
   capability_resolution:null,
   entries:[{kind:"command",status:"pending",command:{operation:"inert_premium",params:{}}}]
 }};
 let oldCalls=0,newCalls=0,failOwnerCalls=0,ready;
 let resolveOld;
 const started=new Promise(resolve=>{ready=resolve});
 const pending=new Promise(resolve=>{resolveOld=resolve});
 function createWorker(session,resolveProvider) {
   const context=vm.createContext({Date,TextEncoder,TextDecoder,WORKER_SESSION_ID:session});
   context.OzonEntitlements={
     requirementFor:()=>({known:true,required:true,allowed_subscription_types:["PREMIUM"],reasons:["INERT_REQUIRED"]}),
     humanTierList:()=>"PREMIUM"
   };
   vm.runInContext(contract,context);
   const ops=vm.runInContext('({inert_premium:{effect:"READ",method:"POST",path:"/v1/roles",provider:"seller_api",response_style:"json",execution_enabled:false}})',context);
   context.OzonContract=context.OzonContractFactory.createOzonContract({operations:ops});
   vm.runInContext(unknown[0],context);
   context.OzonProvider={resolveSellerCapability:resolveProvider};
   context.diagnostic=async()=>{};
   vm.runInContext(code+";globalThis.runBatch=ensureBatchCapabilityAndPlanning",context);
   const asRealm=()=>vm.runInContext("("+JSON.stringify(durable)+")",context);
   const options={
     ownerKind:"INERT",ownerId:"INERT",ownerMatches:()=>true,isCollecting:()=>true,
     getOwner:async()=>asRealm(),
     mutateOwner:async callback=>{
       const current=asRealm();
       const changed=callback(current);
       durable=JSON.parse(JSON.stringify(changed));
       return asRealm();
     },
     failOwner:async()=>{failOwnerCalls++},
     executionContext:{settings:async()=>({sellerApiMetadata:{},sellerCredentials:{}})},
   };
   return ()=>context.runBatch(options);
 }
 const old=createWorker("OLD_WORKER",async()=>{oldCalls++;ready();return pending;});
 const newer=createWorker("NEW_WORKER",async()=>{newCalls++;throw Error("PROVIDER_REPLAY_FORBIDDEN")});
 const originalPending=old();
 const phase=await Promise.race([
   started.then(()=>"RESERVED"),
   originalPending.then(r=>"EARLY:"+r.code,e=>"FAILED:"+e.message),
   new Promise(resolve=>setTimeout(()=>resolve("TIMEOUT"),1500))
 ]);
 assert.equal(phase,"RESERVED","old worker must be awaiting its provider: "+phase);
 assert.equal(durable.batch.capability_resolution.state,"requesting");
 assert.equal(durable.batch.capability_resolution.request_worker_session_id,"OLD_WORKER");
 if(knownBeforeOldCompletion){
   durable={...durable,batch:{...durable.batch,capability_resolution:{
     state:"complete",request_worker_session_id:null,
     probe_performed:true,probe_observation:"RESPONSE_OBSERVED",
     profile:{status:"known",subscription_type:"PREMIUM",is_premium:true,
       probe_performed:true,probe_observation:"RESPONSE_OBSERVED",
       probe_http_status:200,probe_error_code:null}
   }}};
 }else{
   const recovered=await newer();
   assert.equal(recovered.code,"BATCH_PLANNING_READY");
   assert.equal(durable.batch.capability_resolution.probe_observation,"RECOVERED_UNKNOWN");
   assert.equal(durable.batch.capability_resolution.probe_performed,null);
   assert.equal(durable.batch.entries[0].kind,"planning_error");
 }
 const saved=JSON.stringify(durable);
 resolveOld({status:"known",subscription_type:"PREMIUM",is_premium:true,
   probe_performed:true,probe_observation:"RESPONSE_OBSERVED",probe_http_status:200,probe_error_code:null});
 const late=await originalPending;
 assert.equal(late.ok,false,"old worker must not authorize after supersession");
 assert.equal(late.code,"CAPABILITY_PROBE_RESULT_SUPERSEDED");
 assert.equal(failOwnerCalls,0,"stale completion must not fail the newer owner");
 assert.equal(JSON.stringify(durable),saved,"newer durable state and results retained");
 assert.equal(oldCalls,1);assert.equal(newCalls,0,"no repeated capability probe");
 return {mode:knownBeforeOldCompletion?"known_completed_by_other":"recovered_unknown",
   discarded_stale_callback:true,failOwnerCalls,oldCalls,newCalls,
   newer_state_preserved:true};
}
const results=[await scenario(false),await scenario(true)];
console.log(JSON.stringify({verdict:"INERT_LATE_WORKER_COMPLETION_FENCE_2_PASS",results,real_network_calls:0,no_stale_business_dispatch:true}));
