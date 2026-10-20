import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

// Source and extracted-ZIP orphaned-worker capability recovery; synthetic only.
const workerArg=process.argv[2]||"-";
const root=path.resolve(process.argv[3]||process.cwd());
const owned=readFileSync(path.resolve(process.argv[4]||path.join(root,"apps/extension/src/background/context/ensureBatchCapabilityAndPlanning.js")),"utf8").trim();
const worker=workerArg==="-"
 ? readFileSync(path.join(root,"apps/extension/src/imported/ozon-v0.1.22/service_worker.js"),"utf8")
 : readFileSync(path.resolve(workerArg),"utf8");
const ownedFunction=/^async function ensureBatchCapabilityAndPlanning\([\s\S]*?^}[ \t]*$/m.exec(worker);
assert.ok(ownedFunction,"worker must contain the batch planner");
if(workerArg!=="-")assert.equal(ownedFunction[0].trim(),owned,"compiled batch planner must match owned source");
const unknownProfile=/^function capabilityUnknownProfile\([\s\S]*?^}[ \t]*$/m.exec(worker);
assert.ok(unknownProfile,"frozen unknown-profile helper required");
const contractPath=workerArg==="-"
 ? path.join(root,"apps/extension/src/imported/ozon-v0.1.22/shared/ozon_contract.js")
 : path.join(path.dirname(path.resolve(workerArg)),"shared/ozon_contract.js");
const contract=readFileSync(contractPath,"utf8");

async function scenario(competingKnown){
 const ctx=vm.createContext({Date,TextEncoder,TextDecoder,WORKER_SESSION_ID:"INERT_CURRENT_WORKER"});
 ctx.OzonEntitlements={
  requirementFor:()=>({known:true,required:true,allowed_subscription_types:["PREMIUM"],reasons:["INERT_PREMIUM_REQUIRED"]}),
  humanTierList:()=>"PREMIUM",
 };
 vm.runInContext(contract,ctx);
 const ops=vm.runInContext('({inert_premium:{effect:"READ",method:"POST",path:"/v1/roles",provider:"seller_api",response_style:"json",execution_enabled:false}})',ctx);
 ctx.OzonContract=ctx.OzonContractFactory.createOzonContract({operations:ops});
 vm.runInContext(unknownProfile[0],ctx);
 let owner=vm.runInContext('({batch:{planning_state:"pending",request_state:"idle",next_index:0,entries:[{kind:"command",status:"pending",command:{operation:"inert_premium",params:{}}}],capability_resolution:{state:"requesting",request_worker_session_id:"PREVIOUS_WORKER",probe_performed:true,profile:null}}})',ctx);
 let calls=0,failed=0,mutations=0; const diag=[];
 ctx.OzonProvider={resolveSellerCapability:async()=>{calls++;throw Error("PROBE_REPLAY_FORBIDDEN")}};
 ctx.diagnostic=async(name,data)=>diag.push({name,data});
 vm.runInContext(owned+";globalThis.runBatch=ensureBatchCapabilityAndPlanning;",ctx);
 const invoke=()=>ctx.runBatch({
  ownerKind:"INERT",ownerId:"INERT",getOwner:async()=>owner,
  mutateOwner:async f=>{
   if(competingKnown&&mutations===0)owner=vm.runInContext('({batch:{planning_state:"pending",request_state:"idle",next_index:0,entries:[{kind:"command",status:"pending",command:{operation:"inert_premium",params:{}}}],capability_resolution:{state:"complete",probe_performed:true,probe_observation:"RESPONSE_OBSERVED",request_worker_session_id:null,profile:{status:"known",subscription_type:"PREMIUM",is_premium:true,probe_performed:true,probe_observation:"RESPONSE_OBSERVED",probe_http_status:200,probe_error_code:null}}}})',ctx);
   mutations++;owner=f(owner);return owner;
  },
  ownerMatches:()=>true,isCollecting:()=>true,failOwner:async()=>{failed++;throw Error("UNEXPECTED_FAIL_OWNER")},
  executionContext:{settings:async()=>({sellerApiMetadata:{},sellerCredentials:{}})},
 });
 assert.equal((await invoke()).code,"BATCH_PLANNING_READY");
 const r=owner.batch.capability_resolution,e=owner.batch.entries[0];
 if(competingKnown){
   assert.equal(r.probe_performed,true);assert.equal(r.probe_observation,"RESPONSE_OBSERVED");
   assert.equal(e.kind,"command");assert.equal(e.planning.capability.status,"known");
 }else{
   assert.equal(r.probe_performed,null,"lost worker dispatch outcome not proven");
   assert.equal(r.probe_observation,"RECOVERED_UNKNOWN");
   assert.equal(r.profile.probe_performed,null);
   assert.equal(r.profile.probe_observation,"RECOVERED_UNKNOWN");
   assert.equal(e.kind,"planning_error","unknown capability remains fail closed");
   assert.equal(e.planning.capability.probe_performed,null);
   assert.equal(e.planning.capability.probe_observation,"RECOVERED_UNKNOWN");
   const receipt=diag.find(x=>x.name==="CAPABILITY_PROBE_RECOVERY_NO_RETRY");
   assert.ok(receipt);assert.equal(receipt.data.probe_performed,null);
   assert.equal(receipt.data.probe_observation,"RECOVERED_UNKNOWN");
 }
 assert.equal(calls,0);assert.equal(failed,0);
 assert.equal((await invoke()).code,"BATCH_PLANNING_READY");
 assert.equal(calls,0,"no hidden duplicate capability request");
}
for(const racing of [false,true])await scenario(racing);
console.log("OZON_ORPHAN_RECOVERY_NO_REPLAY_2_CASES_PASS");
