import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext, runInNewContext } from "node:vm";
import { createHash, generateKeyPairSync, sign, webcrypto } from "node:crypto";
const root=resolve(process.argv[2] || process.cwd());
globalThis.crypto ||= webcrypto;
const moduleFiles=["packages/control-client/src/prompt-trees.js","packages/control-client/src/crypto.js"];
const storeBundle=existsSync(resolve(root,"manifest.json")) && existsSync(resolve(root,"service_worker.js"));
const packaged=storeBundle || existsSync(resolve(root,"shared/bootstrap_verifier.js"));
if(storeBundle) {
  const worker=readFileSync(resolve(root,"service_worker.js"),"utf8");
  const sourceRoot=fileURLToPath(new URL("../../../../",import.meta.url));
  for(const file of moduleFiles) {
    const expected=readFileSync(resolve(sourceRoot,file),"utf8");
    const start=worker.indexOf(expected);
    assert.ok(start>=0,`Exact source module missing from STORE service_worker.js: ${file}`);
    assert.equal(worker.indexOf(expected,start+1),-1,`Duplicate STORE module: ${file}`);
    // Execute bytes read from the archive, not the source used to locate them.
    runInThisContext(worker.slice(start,start+expected.length),{filename:`service_worker.js:${file}`});
  }
  console.log("PACKAGE module provenance: exact prompt-tree and crypto bytes from STORE service_worker.js; not installed worker acceptance.");
} else {
  for(const file of packaged?["shared/bootstrap_verifier.js"]:moduleFiles)
    runInThisContext(readFileSync(resolve(root,file),"utf8"),{filename:file});
}
const trees=globalThis.OctoportPromptTrees,verifier=globalThis.SellerAgentsBootstrapVerifier;
const {privateKey,publicKey}=generateKeyPairSync("ed25519"),der=publicKey.export({type:"spki",format:"der"});
const bundle={trustBundleVersion:"bootstrap_trust_bundle_v1",algorithm:"Ed25519",publicKeyFormat:"spki_der",publicKeyEncoding:"base64",
  fingerprintAlgorithm:"sha256",fingerprintEncoding:"lowercase_hex",keys:[{keyId:"tree-key",publicKey:der.toString("base64"),
    fingerprintSha256:createHash("sha256").update(der).digest("hex"),lifecycle:"ACTIVE",trustEligibility:"SIGNING_AND_VERIFICATION"}]};
const uuid=n=>`${String(n).padStart(8,"0")}-1111-4111-8111-111111111111`;
const detected=family=>({family,surface:"web",variant:null});
const body=text=>({format:"octoport_prompt_tree_v1",root:"root",nodes:[{id:"root",text,children:[]}]});
const copy=value=>JSON.parse(JSON.stringify(value));
function envelope(claim,domain="Octoport ai prompt tree v1\0") {
  const bytes=Buffer.from(verifier.canonicalJson(claim));
  return {treeEnvelopeVersion:"ai_prompt_tree_envelope_v1",algorithm:"Ed25519",keyId:"tree-key",payload:bytes.toString("base64url"),
    signature:sign(null,Buffer.concat([Buffer.from(domain),Buffer.from("tree-key\0"),bytes]),privateKey).toString("base64url")};
}
function fixture() {
  let memory={},clock=1000000,context={origin:"https://control.invalid",accountId:uuid(1),deviceId:uuid(2),sessionId:uuid(3),principalEpoch:1,accessEpoch:1};
  const versions={chatgpt:{aiId:uuid(4),version:1,body:body("GPT only")},alice:{aiId:uuid(5),version:1,body:body("Alice only")},third:{aiId:uuid(6),version:1,body:body("Third AI")}};
  const trace={fetches:0,bodyDownloads:0,providerApi:0,send:0};let hook=null,dropWrite=false;
  const storage={get:async key=>({[key]:memory[key]===undefined?undefined:copy(memory[key])}),set:async value=>{if(!dropWrite)memory={...memory,...copy(value)};}};
  const fetchManifest=async request=>{
    trace.fetches++;const v=versions[request.detected.family],sha256=await trees.digest(v.body);
    const same=request.known?.aiId===v.aiId&&request.known.version===v.version&&request.known.sha256===sha256;
    const claim={claimVersion:"ai_prompt_tree_claim_v1",accountId:request.context.accountId,deviceId:request.context.deviceId,
      sessionId:request.context.sessionId,requestNonce:request.requestNonce,detected:request.detected,aiId:v.aiId,
      issuedAt:"2026-10-10T15:00:00.000Z",publication:{version:v.version,format:"octoport_prompt_tree_v1",sha256,
        body:same?null:copy(v.body),publishedAt:"2026-10-10T14:00:00.000Z"}};
    if(!same)trace.bodyDownloads++;return hook?hook(claim,request):envelope(claim);
  };
  const make=()=>trees.createCache({storage,verifier,trustBundle:bundle,authorize:async()=>context?copy(context):null,fetchManifest,now:()=>clock});
  return {cache:make(),make,trace,versions,memory:()=>memory,setMemory:x=>{memory=x;},advance:()=>{clock+=7*60*60*1000;},
    hook:fn=>{hook=fn;},deny:()=>{context=null;},changePrincipal:()=>{context={...context,sessionId:uuid(20),principalEpoch:2};},dropWrite:()=>{dropWrite=true;}};
}
let passed=0;
async function test(name,run){await run();passed++;console.log(`PASS ${name}`);}
await test("AI-TREE independent permanent IDs and data-only behavior",async()=>{
 const f=fixture();const [g,a]=await Promise.all([f.cache.get(detected("chatgpt")),f.cache.get(detected("alice"))]);
 assert.notEqual(g.aiId,a.aiId);assert.equal(trees.render(g.body),"GPT only");assert.equal(trees.render(a.body),"Alice only");
 assert.equal(f.trace.providerApi,0);assert.equal(f.trace.send,0);
});
await test("same AI concurrent sync coalesces; Standard/Work do not invent distinct tree IDs",async()=>{
 const f=fixture();let release;const gate=new Promise(r=>release=r);f.hook(async c=>{await gate;return envelope(c);});
 const a=f.cache.get(detected("chatgpt")),b=f.cache.get(detected("chatgpt"));await new Promise(r=>setTimeout(r,30));release();
 const [x,y]=await Promise.all([a,b]);assert.equal(f.trace.fetches,1);assert.equal(x.aiId,y.aiId);
});
await test("new publication affects the next acquisition, never the previously returned pin",async()=>{
 const f=fixture(),pin=await f.cache.get(detected("chatgpt"));f.versions.chatgpt={...f.versions.chatgpt,version:2,body:body("New draft published")};f.advance();
 const next=await f.cache.get(detected("chatgpt"));assert.equal(pin.version,1);assert.equal(trees.render(pin.body),"GPT only");assert.equal(next.version,2);
 next.body.nodes[0].text="outside mutation";assert.equal(trees.render((await f.cache.get(detected("chatgpt"))).body),"New draft published");
});
await test("same version checks metadata without downloading body again",async()=>{
 const f=fixture();await f.cache.get(detected("chatgpt"));f.advance();await f.cache.get(detected("chatgpt"));
 assert.equal(f.trace.fetches,2);assert.equal(f.trace.bodyDownloads,1);
});
await test("nonce and account-bound responses reject replay",async()=>{
 const f=fixture();f.hook(c=>envelope({...c,requestNonce:uuid(90)}));await assert.rejects(f.cache.get(detected("chatgpt")),/AI_TREE_RESPONSE_MISMATCH/);
 f.hook(c=>envelope({...c,accountId:uuid(91)}));await assert.rejects(f.cache.get(detected("chatgpt")),/AI_TREE_RESPONSE_MISMATCH/);
 assert.deepEqual(f.memory(),{});
});
await test("signature domain and unknown signing key cannot substitute another contract",async()=>{
 const f=fixture();f.hook(c=>envelope(c,"product-control-plane/bootstrap-snapshot/v1\0"));await assert.rejects(f.cache.get(detected("chatgpt")),/AI_TREE_INVALID_SIGNATURE/);
 f.hook(c=>({...envelope(c),keyId:"unknown-key"}));await assert.rejects(f.cache.get(detected("chatgpt")),/AI_TREE_UNKNOWN_SIGNING_KEY/);
});
await test("corrupt update preserves the previous verified copy",async()=>{
 const f=fixture();await f.cache.get(detected("chatgpt"));f.advance();f.hook(c=>envelope({...c,publication:{...c.publication,body:body("Corrupt bytes")}}));
 await assert.rejects(f.cache.get(detected("chatgpt")),/AI_TREE_HASH_MISMATCH/);
 assert.equal(trees.render((await f.cache.get(detected("chatgpt"),{offline:true})).body),"GPT only");
});
await test("version regression and same-version content replacement are rejected",async()=>{
 const f=fixture();f.versions.chatgpt.version=2;await f.cache.get(detected("chatgpt"));f.advance();f.versions.chatgpt.version=1;
 await assert.rejects(f.cache.get(detected("chatgpt")),/AI_TREE_VERSION_REGRESSION/);
 f.versions.chatgpt.version=2;f.versions.chatgpt.body=body("Changed same version");await assert.rejects(f.cache.get(detected("chatgpt")),/AI_TREE_VERSION_REGRESSION/);
});
await test("offline cache never grants authority after deny",async()=>{
 const f=fixture();await f.cache.get(detected("chatgpt"));f.deny();await assert.rejects(f.cache.get(detected("chatgpt"),{offline:true}),/AI_TREE_ACCESS_REQUIRED/);
});
await test("late response after principal change cannot be installed",async()=>{
 const f=fixture();f.hook(c=>{f.changePrincipal();return envelope(c);});await assert.rejects(f.cache.get(detected("chatgpt")),/AI_TREE_CONTEXT_CHANGED/);assert.deepEqual(f.memory(),{});
});
await test("restart re-verifies cache; modified cache is not accepted",async()=>{
 const f=fixture();await f.cache.get(detected("chatgpt"));const restarted=f.make();assert.equal((await restarted.get(detected("chatgpt"))).version,1);assert.equal(f.trace.fetches,1);
 const memory=copy(f.memory());Object.values(memory.octoport_prompt_trees_v1.entries)[0].body=body("Modified storage");f.setMemory(memory);
 await assert.rejects(f.make().get(detected("chatgpt"),{offline:true}),/AI_TREE_CACHE_UNVERIFIED/);
});
await test("unconfirmed cache write is not reported as installed",async()=>{
 const f=fixture();f.dropWrite();await assert.rejects(f.cache.get(detected("chatgpt")),/AI_TREE_STORAGE_READBACK_FAILED/);assert.deepEqual(f.memory(),{});
 await assert.rejects(f.cache.get(detected("chatgpt")),/AI_TREE_STORAGE_UNCONFIRMED/);
});
await test("third AI needs no ChatGPT/Alice special case",async()=>{
 const f=fixture();const third=await f.cache.get(detected("third"));assert.equal(third.aiId,uuid(6));assert.equal(trees.render(third.body),"Third AI");
});
await test("pinned exchange keeps verified old version after update; denial still blocks it",async()=>{
 const f=fixture(),old=await f.cache.get(detected("chatgpt"));
 f.versions.chatgpt={...f.versions.chatgpt,version:2,body:body("Next exchange")};f.advance();await f.cache.get(detected("chatgpt"));
 assert.equal((await f.cache.validatePinned(detected("chatgpt"),old)).version,1);
 const before=f.trace.fetches;await f.cache.validatePinned(detected("chatgpt"),old);assert.equal(f.trace.fetches,before);
 f.deny();await assert.rejects(f.cache.validatePinned(detected("chatgpt"),old),/AI_TREE_ACCESS_REQUIRED/);
});
await test("foreign or mutated exchange pin is rejected without a fetch",async()=>{
 const f=fixture(),g=await f.cache.get(detected("chatgpt")),a=await f.cache.get(detected("alice"));
 await assert.rejects(f.cache.validatePinned(detected("chatgpt"),a),/AI_TREE_PIN_ID_MISMATCH/);
 const changed=copy(g);changed.body=body("Tampered pin");await assert.rejects(f.cache.validatePinned(detected("chatgpt"),changed),/AI_TREE_CACHE_UNVERIFIED/);
 assert.equal(f.trace.fetches,2);
});
await test("storage alias cannot relabel a signed cache entry as another permanent AI ID",async()=>{
 const f=fixture();await f.cache.get(detected("chatgpt"));const saved=copy(f.memory()),s=saved.octoport_prompt_trees_v1;
 const oldKey=Object.keys(s.entries)[0],parts=JSON.parse(oldKey);parts[2]=uuid(99);s.entries[JSON.stringify(parts)]=s.entries[oldKey];delete s.entries[oldKey];
 s.aliases[Object.keys(s.aliases)[0]]=uuid(99);f.setMemory(saved);
 await assert.rejects(f.make().get(detected("chatgpt"),{offline:true}),/AI_TREE_CACHE_ID_MISMATCH/);
});
await test("explicit Start receives an immediate publication; commands and old Work preserve their pin",async()=>{
 const f=fixture(),old=await f.cache.get(detected("chatgpt")),alice=await f.cache.get(detected("alice"));
 f.versions.chatgpt={...f.versions.chatgpt,version:2,body:body("Published immediately before new dialogue")};
 const sourceRoot=fileURLToPath(new URL("../../../../",import.meta.url));
 const runtime=readFileSync(resolve(sourceRoot,"apps/extension/src/application/runtime.js"),"utf8");
 const start=runtime.indexOf("async function saPromptTreeForExchange("),end=runtime.indexOf("\nasync function saPendingPrompt",start);
 assert.ok(start>=0&&end>start);
 const exchange=runInNewContext(runtime.slice(start,end)+"; saPromptTreeForExchange",{
   SellerAgentsControlClient:{getPromptTree:async(identity,options)=>({available:true,pin:await f.cache.get(identity,{offline:options.cacheOnly,refresh:options.refresh})})}
 });
 const current=await exchange(detected("chatgpt"));
 assert.equal(current.pin.version,2,"Explicit Start must not wait for the six-hour background interval");
 assert.equal((await f.cache.validatePinned(detected("chatgpt"),old)).version,1);
 assert.equal((await f.cache.get(detected("alice"))).version,alice.version);
 assert.equal(trees.render(alice.body),"Alice only");
 const before=f.trace.fetches;
 assert.equal((await exchange(detected("chatgpt"),true)).pin.version,2);
 assert.equal(f.trace.fetches,before,"Ordinary command must not synchronize trees");
 assert.equal(f.trace.providerApi,0);assert.equal(f.trace.send,0);
});
console.log(JSON.stringify({level:packaged?"PACKAGE":"SOURCE",passed,installed:"NOT_RUN",owner:"NOT_RUN",providerApiCalls:0,sendCalls:0}));
