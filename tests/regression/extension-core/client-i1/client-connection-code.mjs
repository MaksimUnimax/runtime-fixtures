import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { makeWorker, until, signFixtureBootstrap } from "../worker-harness.mjs";
const runtime=path.resolve(process.argv[2]);
const AUTH="seller_agents_control_auth_v2";
const CODE="octo1_"+"A".repeat(43);
const OTHER="octo1_"+"B".repeat(42)+"A";
const accountId="11111111-1111-4111-8111-111111111111";
const deviceId="22222222-2222-4222-8222-222222222222";
const sessionId="33333333-3333-4333-8333-333333333333";
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
const tokens=(overrides={})=>({status:"activated",authenticationMethod:"ACCOUNT_CONNECTION_CODE",accountId,deviceId,sessionId,tokenType:"Bearer",accessToken:"connection_access_fixture",accessTokenExpiresAt:new Date(Date.now()+3600000).toISOString(),refreshToken:"C".repeat(43),refreshTokenExpiresAt:new Date(Date.now()+7200000).toISOString(),...overrides});
async function setup(options={}) {
 const backing=options.backing||{local:{},session:{}};
 let envelope,exchanges=[],legacyStarts=[];
 const worker=await makeWorker(runtime,{...options,backing,fetch:async(url,init)=>{
  if(url.endsWith("/v1/connection-codes/exchange")){
   exchanges.push({key:init.headers.get("Idempotency-Key"),body:JSON.parse(init.body)});
   return options.exchange?options.exchange(url,init):json(tokens(options.tokens));
  }
  if(url.endsWith("/v1/device-authorizations")){legacyStarts.push({method:init.method});return options.legacyStart?options.legacyStart(url,init):json({error:{code:"UNAVAILABLE"}},503);}
  if(url.includes("/v1/bootstrap")) return json(options.bootstrap?await options.bootstrap(backing,envelope):envelope);
  if(url.endsWith("/v1/auth/refresh")) return json({tokenType:"Bearer",accessToken:"connection_refresh_fixture",accessTokenExpiresAt:new Date(Date.now()+3600000).toISOString(),refreshToken:"D".repeat(43),refreshTokenExpiresAt:new Date(Date.now()+7200000).toISOString()});
  throw new Error("Unexpected fixture endpoint");
 }});
 if(options.seedAuthority!==false){
  envelope=structuredClone(backing.local[AUTH].authority.envelope);
  await worker.call("SellerAgentsControlClient.localReset");
 }
 return {worker,backing,exchanges,legacyStarts};
}
test("code is exchanged once, signed account verified, secret never persisted or projected",async()=>{
 const {worker,backing,exchanges}=await setup();
 try {
  const status=await worker.call("SellerAgentsControlClient.connectWithCode",{code:CODE});
  assert.equal(status.authenticated,true,JSON.stringify(status));
  assert.equal(status.accountId,accountId);
  assert.equal(status.authenticationMethod,"ACCOUNT_CONNECTION_CODE");
  assert.equal(status.deviceId,deviceId);
  assert.equal(exchanges.length,1);
  assert.equal(exchanges[0].body.code,CODE);
  assert.deepEqual(Object.keys(exchanges[0].body),["code"]);
  assert.equal(JSON.stringify(backing).includes(CODE),false);
  assert.equal(JSON.stringify(status).includes("connection_access_fixture"),false);
  assert.equal(worker.portalTabs.length,0);
  await worker.call("SellerAgentsControlClient.refresh",{force:true});
  assert.equal((await worker.call("SellerAgentsControlClient.status")).authenticationMethod,"ACCOUNT_CONNECTION_CODE");
 } finally{worker.close();}
});
test("two explicit calls share one in-flight exchange",async()=>{
 let release;
 const {worker,exchanges}=await setup({exchange:()=>new Promise(resolve=>{release=()=>resolve(json(tokens()));})});
 try {
  const a=worker.call("SellerAgentsControlClient.connectWithCode",{code:CODE});
  const b=worker.call("SellerAgentsControlClient.connectWithCode",{code:CODE});
  a.catch(()=>{});b.catch(()=>{});
  await until(()=>release,"exchange dispatch");release();
  const results=await Promise.all([a,b]);
  assert.equal(exchanges.length,1);
  assert.equal(results.every(r=>r.authenticated),true);
 } finally{release?.();worker.close();}
});
test("MV3 restart retains same attempt, sends nothing automatically, rejects changed code",async()=>{
 const {worker,backing,exchanges}=await setup({exchange:async()=>{throw new Error("network unavailable");}});
 try {
  await assert.rejects(worker.call("SellerAgentsControlClient.connectWithCode",{code:CODE}),{code:"CONNECTION_EXCHANGE_UNKNOWN"});
  assert.equal((await worker.call("SellerAgentsControlClient.status")).connectionPending.outcome,"UNKNOWN");
 }finally{worker.close();}
 const originalKey=exchanges[0].key;
 const next=await setup({backing,seedAuthority:false,exchange:async()=>json({error:{code:"CONNECTION_CODE_CLOSED"}},403)});
 try{
  assert.equal(next.exchanges.length,0);
  await assert.rejects(next.worker.call("SellerAgentsControlClient.connectWithCode",{code:OTHER}),{code:"CONNECTION_PREVIOUS_OUTCOME_UNKNOWN"});
  assert.equal(next.exchanges.length,0);
  await assert.rejects(next.worker.call("SellerAgentsControlClient.connectWithCode",{code:CODE}),{code:"CONNECTION_CODE_CLOSED"});
  assert.equal(next.exchanges[0].key,originalKey);
  assert.equal((await next.worker.call("SellerAgentsControlClient.status")).connectionPending.outcome,"REJECTED");
  await assert.rejects(next.worker.call("SellerAgentsControlClient.connectWithCode",{code:CODE}),{code:"CONNECTION_CODE_CLOSED"});
  assert.equal(next.exchanges.length,1);
  assert.equal(JSON.stringify(backing).includes(CODE),false);
 }finally{next.worker.close();}
});
test("cancel before late reply never installs its credentials",async()=>{
 let release;
 const {worker,backing,exchanges}=await setup({exchange:()=>new Promise(resolve=>{release=()=>resolve(json(tokens()));})});
 try{
  const flight=worker.call("SellerAgentsControlClient.connectWithCode",{code:CODE});flight.catch(()=>{});
  await until(()=>release,"held exchange");
  await worker.call("SellerAgentsControlClient.cancelActivation");
  release();
  await assert.rejects(flight);
  assert.equal((await worker.call("SellerAgentsControlClient.status")).authenticated,false);
  assert.equal(backing.local[AUTH].credentials,null);
  assert.equal(backing.local[AUTH].connectionAttempt,null);
  assert.equal(exchanges.length,1);
 }finally{release?.();worker.close();}
});
test("a signed response for a different account cannot authenticate code enrollment",async()=>{
 const {worker,backing}=await setup({bootstrap:async(backing,envelope)=>{
  const payload=JSON.parse(Buffer.from(envelope.payload,"base64url").toString());
  payload.account.id="99999999-9999-4999-8999-999999999999";
  return signFixtureBootstrap(backing,payload);
 }});
 try {
  const status=await worker.call("SellerAgentsControlClient.connectWithCode",{code:CODE});
  assert.equal(status.authenticated,false);
  assert.equal(status.accountId,null);
  assert.equal(backing.local[AUTH].authority,null);
  assert.equal(backing.local[AUTH].enrollment.accountId,accountId);
 }finally{worker.close();}
});
test("restored code session keeps its method and independent signed binding",async()=>{
 const {worker,backing}=await setup();
 await worker.call("SellerAgentsControlClient.connectWithCode",{code:CODE});worker.close();
 const restored=await setup({backing,seedAuthority:false});
 try{
  const status=await restored.worker.call("SellerAgentsControlClient.status");
  assert.equal(status.authenticated,true);
  assert.equal(status.authenticationMethod,"ACCOUNT_CONNECTION_CODE");
  assert.equal(restored.exchanges.length,0);
 }finally{restored.worker.close();}
});
test("invalid code and unconfirmed durable intent cannot send an exchange",async()=>{
 let failWrites=false;
 const {worker,exchanges}=await setup({onStorageWrite:(kind,values)=>{
  if(failWrites&&kind==="local"&&values[AUTH]?.connectionAttempt)throw new Error("fixture write failed");
 }});
 try{
  for(const code of [accountId,"octo1_"+"B".repeat(43),CODE+"extra"]){
   await assert.rejects(worker.call("SellerAgentsControlClient.connectWithCode",{code}),{code:"CONNECTION_CODE_INVALID"});
  }
  failWrites=true;
  await assert.rejects(worker.call("SellerAgentsControlClient.connectWithCode",{code:CODE}));
  assert.equal(exchanges.length,0);
 }finally{worker.close();}
});
test("connection cancellation does not remove legacy stores and allows a new explicit intent",async()=>{
 const {worker,backing,exchanges}=await setup({exchange:async()=>{throw new Error("network");}});
 backing.local.keep_legacy_store_fixture={owner:accountId,marker:"preserve"};
 try{
  await assert.rejects(worker.call("SellerAgentsControlClient.connectWithCode",{code:CODE}));
  const oldKey=exchanges[0].key;
  await worker.call("SellerAgentsControlClient.cancelActivation");
  await assert.rejects(worker.call("SellerAgentsControlClient.connectWithCode",{code:OTHER}));
  assert.notEqual(exchanges[1].key,oldKey);
  assert.equal(backing.local.keep_legacy_store_fixture.marker,"preserve");
 }finally{worker.close();}
});
test("terminal denial clears enrollment and remains safely restorable",async()=>{
 const {worker,backing}=await setup();
 try {
  await worker.call("SellerAgentsControlClient.connectWithCode",{code:CODE});
  await worker.call("SellerAgentsControlClient.localReset");
  assert.equal(backing.local[AUTH].enrollment,null);
  assert.equal(backing.local[AUTH].credentials,null);
 }finally{worker.close();}
 const next=await setup({backing,seedAuthority:false});
 try{assert.equal((await next.worker.call("SellerAgentsControlClient.status")).authenticated,false);}
 finally{next.worker.close();}
});

test("late cancellation after confirmed enrollment does not invalidate its signed generation",async()=>{
 const {worker,backing}=await setup();
 try{
  await worker.call("SellerAgentsControlClient.connectWithCode",{code:CODE});
  const generation=backing.local[AUTH].generation;
  await worker.call("SellerAgentsControlClient.cancelActivation");
  {
   assert.equal(backing.local[AUTH].generation,generation);
   assert.equal(backing.local[AUTH].authority.generation,generation);
   assert.equal((await worker.call("SellerAgentsControlClient.status")).authenticated,true);
  }
 }finally{worker.close();}
});

for (const outcome of ["PENDING", "UNKNOWN", "REJECTED", "ACTIVE"]) {
 test("overlapping enrollment after consent preserves one durable method: "+outcome, async()=>{
  let holdConsent=false,releaseConsent,releaseExchange;
  const permissions={getAll:()=>holdConsent?(holdConsent=false,new Promise(resolve=>{releaseConsent=()=>resolve({data_collection:["technicalAndInteraction"]});})):Promise.resolve({data_collection:["technicalAndInteraction"]})};
  const options={userAgent:"Mozilla/5.0 Firefox/140.0",firefoxPermissions:permissions,
   exchange:async()=>{
    if(outcome==="PENDING")await new Promise(resolve=>{releaseExchange=resolve;});
    if(outcome==="UNKNOWN"||outcome==="PENDING")throw new Error("isolated network uncertainty");
    return outcome==="REJECTED"?json({error:{code:"CONNECTION_CODE_CLOSED"}},403):json(tokens());
   }};
  const {worker,backing,exchanges,legacyStarts}=await setup(options);
  try {
   holdConsent=true;
   const old=worker.call("SellerAgentsControlClient.startActivation");old.catch(()=>{});
   await until(()=>releaseConsent,"legacy consent yield");
   const connection=worker.call("SellerAgentsControlClient.connectWithCode",{code:CODE});connection.catch(()=>{});
   await until(()=>exchanges.length===1,"connection intent dispatched");
   if(outcome!=="PENDING")await connection.catch(()=>{});
   releaseConsent();
   if(outcome==="ACTIVE")assert.equal((await old).authenticated,true);
   else await assert.rejects(old,{code:"CONNECTION_PREVIOUS_OUTCOME_UNKNOWN"});
   assert.equal(legacyStarts.length,0);
   assert.equal(backing.local[AUTH].pending,null);
   assert.equal(exchanges.length,1);
   releaseExchange?.();await connection.catch(()=>{});
  } finally {releaseConsent?.();releaseExchange?.();worker.close();}
  const restored=await setup({...options,backing,seedAuthority:false});
  try {
   const status=await restored.worker.call("SellerAgentsControlClient.status");
   assert.equal(status.authenticated,outcome==="ACTIVE");
   assert.equal(restored.exchanges.length,0);
   assert.equal(restored.legacyStarts.length,0);
   await restored.worker.call("SellerAgentsControlClient.localReset");
   assert.equal(backing.local[AUTH].connectionAttempt,null);
   assert.equal(backing.local[AUTH].pending,null);
  } finally {restored.worker.close();}
 });
}
test("legacy reservation before code intent rejects the other method without dispatch",async()=>{
 let release;
 const {worker,exchanges,legacyStarts,backing}=await setup({legacyStart:()=>new Promise(resolve=>{release=()=>resolve(json({error:{code:"UNAVAILABLE"}},503));})});
 try {
  const old=worker.call("SellerAgentsControlClient.startActivation");old.catch(()=>{});
  await until(()=>release,"legacy dispatch reserved");
  await assert.rejects(worker.call("SellerAgentsControlClient.connectWithCode",{code:CODE}),{code:"CONNECTION_LEGACY_ATTEMPT_PENDING"});
  assert.equal(exchanges.length,0);assert.equal(legacyStarts.length,1);
  assert.equal(backing.local[AUTH].connectionAttempt,null);
  release();await old.catch(()=>{});
  await worker.call("SellerAgentsControlClient.cancelActivation");
  assert.equal(backing.local[AUTH].pending,null);
 } finally {release?.();worker.close();}
});
