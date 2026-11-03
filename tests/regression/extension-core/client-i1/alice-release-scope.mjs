import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createHash } from "node:crypto";

const root = new URL("../../../../", import.meta.url);
const descriptor = JSON.parse(fs.readFileSync(new URL("packages/contracts/src/ai-release-scope.v1.json", root), "utf8"));
const canonical = value => Array.isArray(value) ? "[" + value.map(canonical).join(",") + "]" :
  value && typeof value === "object" ? "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}" : JSON.stringify(value);
const bundle = { descriptor, sha256: createHash("sha256").update(canonical(descriptor)).digest("hex") };
const results = [];
const modules = ["ai-release-scope", "packaged-capabilities", "capability-intersection"].map(name =>
  fs.readFileSync(new URL(`packages/control-client/src/${name}.js`, root), "utf8"));
function realm(input = bundle) {
  const context = vm.createContext({});
  vm.runInContext(`globalThis.SellerAgentsControlConfig = ${JSON.stringify({ aiReleaseScope: input })};
    globalThis.SellerAgentsControlClient = { getVerifiedBootstrapMetadata() { throw new Error("UNEXPECTED_NETWORK"); } };`, context);
  for (const source of modules) vm.runInContext(source, context);
  return expr => JSON.parse(JSON.stringify(vm.runInContext(expr, context)));
}
function test(id, fn) { try { fn(); results.push({id,status:"PASS"}); } catch(e) { results.push({id,status:"FAIL",error:e.message}); } }
const call = realm();
test("canonical-source-and-browser-hash", () => {
  assert.deepEqual(call("SellerAgentsAiReleaseScope.snapshot()"), bundle);
  assert.equal(bundle.sha256, "10c20b39daec4d0a9733173222167ea7a56da2a128bbc182132591c8e5596261");
});
for (const family of descriptor.retainedAiFamilies) test("retained-presence-vs-release/" + family, () => {
  assert.equal(call(`SellerAgentsPackagedCapabilities.has("ai.${family}.web.adapter")`), true);
  assert.equal(call(`SellerAgentsPackagedCapabilities.releaseSupported("ai.${family}.web.adapter")`), family === "alice");
  assert.equal(call(`SellerAgentsAiReleaseScope.supportsAi(${JSON.stringify({family,surface:"web",variant:null})})`), family === "alice");
});
for (const bad of [null,{}, {descriptor}, {...bundle,sha256:"0".repeat(64)}, {...bundle,extra:true},
  {...bundle,descriptor:{...descriptor,revision:2}},
  {...bundle,descriptor:{...descriptor,enabledAi:[{family:"qwen",surface:"web",variant:null}]}},
  {...bundle,descriptor:{...descriptor,enabledAi:[...descriptor.enabledAi,{family:"chatgpt",surface:"web",variant:null}]}}]) test("invalid-bundle/" + results.length, () => {
    const read=realm(bad);assert.equal(read("SellerAgentsAiReleaseScope.snapshot()"),null);
    assert.equal(read('SellerAgentsPackagedCapabilities.releaseSupported("ai.alice.web.adapter")'),false);
});
for (const ai of [{family:"Alice",surface:"web",variant:null},{family:"alice",surface:"standard",variant:null},
  {family:"alice",surface:"web",variant:"work"},{family:"alice",surface:"web"},
  {family:"alice",surface:"web",variant:null,allowed:true}]) test("unknown-or-mismatching-tuple/"+results.length, () => {
    assert.equal(call(`SellerAgentsAiReleaseScope.supportsAi(${JSON.stringify(ai)})`),false);
});
test("release-and-source-caps-not-feature-flags", () => {
  const metadata={metadataVersion:"signed_bootstrap_metadata_v1",source:"CACHE",freshness:"STALE_BUT_OFFLINE_GRACE_ELIGIBLE",executionAuthority:false,configVersion:1,accessBasis:"BETA",
    signedEntitlements:{"source.ozon":true,"source.wildberries":false,...Object.fromEntries(descriptor.retainedAiFamilies.map(f=>["ai."+f,true]))},signedFeatures:{"source.wildberries":true,"ai.qwen":true}};
  const a=call(`SellerAgentsCapabilityIntersection.evaluateVerifiedMetadata(${JSON.stringify(metadata)})`);
  assert.equal(a.capabilities.length,10);assert.equal(a.executionAuthority,false);
  for(const row of a.capabilities)assert.equal(row.permissionSatisfied,["source.ozon","ai.alice"].includes(row.entitlementKey),row.entitlementKey);
});
test("immutable-captured-scope-and-global", () => {
  assert.deepEqual(call(`(() => { const before=SellerAgentsAiReleaseScope; const s=before.snapshot();
    try{s.descriptor.enabledAi.push({family:"qwen",surface:"web",variant:null});}catch{}
    SellerAgentsControlConfig.aiReleaseScope={allowed:true};
    try{globalThis.SellerAgentsAiReleaseScope={supportsAi:()=>true};}catch{}
    return {same:before===SellerAgentsAiReleaseScope,frozen:Object.isFrozen(s.descriptor.enabledAi),qwen:before.supportsFamily("qwen"),alice:before.supportsFamily("alice")}; })()`),
    {same:true,frozen:true,qwen:false,alice:true});
});
test("accessor-input-rejected-without-reading-getter", () => {
  assert.deepEqual(call(`(() => { let n=0;const b={descriptor:null,sha256:"${bundle.sha256}"};
    Object.defineProperty(b,"descriptor",{enumerable:true,get(){n++;return {};}});
    return {valid:SellerAgentsAiReleaseScope.validBundle(b),reads:n};})()`),{valid:false,reads:0});
});
const failed=results.filter(x=>x.status==="FAIL");
console.log(JSON.stringify({suite:"ALICE_RELEASE_SCOPE_PURE_REAL_MODULES",status:failed.length?"FAIL":"PASS",cases:results,failed:failed.length},null,2));
if(failed.length)process.exitCode=1;
