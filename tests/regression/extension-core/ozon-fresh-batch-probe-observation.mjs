import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

// Inert source + compiled-composition parity. No browser, provider, credentials,
// storage or network. Optional fourth arg supplies isolated proposed source.
const runtimeArg = process.argv[2] || null;
const root = path.resolve(process.argv[3] || process.cwd());
const sourcePath = path.resolve(
  process.argv[4] || path.join(root, "apps/extension/src/background/context/ensureBatchCapabilityAndPlanning.js"),
);
const source = readFileSync(sourcePath, "utf8").trim();
let testedSource = source;
if (runtimeArg && runtimeArg !== "-") {
  const worker = readFileSync(runtimeArg, "utf8");
  const match = /^async function ensureBatchCapabilityAndPlanning\([\s\S]*?^}[ \t]*$/m.exec(worker);
  assert.ok(match, "compiled worker must contain the exact application capability planner");
  testedSource = match[0].trim();
  // Report bounded mismatch metadata, never dump a full worker into CI logs.
  if (testedSource !== source) {
    let firstDifference = 0;
    const sharedLength = Math.min(testedSource.length, source.length);
    while (
      firstDifference < sharedLength &&
      testedSource[firstDifference] === source[firstDifference]
    ) firstDifference++;
    assert.fail(
      "compiled worker source mismatch: actual_length=" + testedSource.length +
      " expected_length=" + source.length +
      " first_difference=" + firstDifference,
    );
  }
}

async function verify(mode) {
  let owner = { batch: {
    entries:[{kind:"command",status:"pending",command:{operation:"INERT_READ"}}],
    next_index:0,request_state:"idle",planning_state:"pending",capability_resolution:null,
  }};
  const trace = { calls:0, before:null, diagnostics:[] };
  const profiles = {
    local_refusal:{status:"unknown",subscription_type:"UNKNOWN",probe_performed:false,probe_observation:"NOT_ATTEMPTED",probe_http_status:0,probe_error_code:"MISSING_API_KEY"},
    fetch_unknown:{status:"unknown",subscription_type:"UNKNOWN",probe_performed:true,probe_observation:"FETCH_INVOKED_OUTCOME_UNKNOWN",probe_http_status:0,probe_error_code:"PROVIDER_FETCH_FAILED"},
    http_403:{status:"unknown",subscription_type:"UNKNOWN",probe_performed:true,probe_observation:"RESPONSE_OBSERVED",probe_http_status:403,probe_error_code:"SELLER_CAPABILITY_PROBE_HTTP_ERROR"},
    response_200:{status:"known",subscription_type:"PREMIUM",probe_performed:true,probe_observation:"RESPONSE_OBSERVED",probe_http_status:200,probe_error_code:null},
  };
  const env = {
    Date, WORKER_SESSION_ID:"INERT_SAME_WORKER",
    diagnostic:async(name,value)=>trace.diagnostics.push({name,value}),
    capabilityUnknownProfile:()=>({status:"unknown",probe_performed:true}),
    OzonContract:{
      sellerCapabilityRequirement:()=>({required:mode!=="not_needed"}),
      planCommandForSellerCapability:(command,profile)=>profile.status==="unknown"
        ? {action:"reject",error:{code:"ENTITLEMENT_UNKNOWN",message:"INERT_DENY"},planning:{capability:{status:"unknown"}}}
        : {action:"execute",command,planning:{capability:{status:profile.status}}},
    },
    OzonProvider:{resolveSellerCapability:async()=>{
      trace.calls++;
      trace.before={...owner.batch.capability_resolution};
      assert.equal(trace.before.state,"requesting");
      assert.equal(trace.before.probe_performed,false,"reservation cannot claim a completed probe");
      assert.equal(trace.before.probe_observation,"RESERVED_NOT_SENT");
      return profiles[mode];
    }},
  };
  vm.runInNewContext(testedSource+";globalThis.testInvoke=ensureBatchCapabilityAndPlanning;",env,{
    filename:"composed-owned-capability-plan.js",
  });
  const options={
    ownerKind:"INERT",ownerId:"INERT",
    getOwner:async()=>owner,
    mutateOwner:async fn=>{owner=fn(owner);return owner},
    ownerMatches:()=>true,isCollecting:()=>true,
    failOwner:async()=>{throw new Error("NO_FAIL_OWNER_ALLOWED")},
    executionContext:{settings:async()=>({sellerApiMetadata:{},sellerCredentials:{}})},
  };
  const first=await env.testInvoke(options);
  assert.equal(first.code,"BATCH_PLANNING_READY");
  const resolution=owner.batch.capability_resolution;
  const expected=mode==="not_needed"
    ? {attempt:false,observation:"NOT_NEEDED",calls:0}
    : {attempt:profiles[mode].probe_performed,observation:profiles[mode].probe_observation,calls:1};
  assert.equal(trace.calls,expected.calls);
  assert.equal(resolution.probe_performed,expected.attempt);
  assert.equal(resolution.probe_observation,expected.observation);
  assert.equal(resolution.state,mode==="not_needed"?"not_needed":"complete");
  if(mode!=="not_needed")assert.equal(resolution.profile.probe_observation,expected.observation);
  assert.equal(owner.batch.entries[0].kind,["response_200","not_needed"].includes(mode)?"command":"planning_error");
  const second=await env.testInvoke(options);
  assert.equal(second.code,"BATCH_PLANNING_READY");
  assert.equal(trace.calls,expected.calls,"no second provider attempt on complete planning");
  const completion=trace.diagnostics.find(entry=>entry.name==="BATCH_CAPABILITY_PLANNING_COMPLETED");
  assert.ok(completion);
  assert.equal(completion.value.capability_probe_performed,expected.attempt);
  assert.equal(completion.value.capability_probe_observation,expected.observation);
}

for(const mode of ["local_refusal","fetch_unknown","http_403","response_200","not_needed"])
  await verify(mode);
console.log("OZON_FRESH_BATCH_DURABLE_PROBE_OBSERVATION_5_CASES_PASS");
