import assert from 'node:assert/strict';
import {makeWorker, signFixtureBootstrap} from '../worker-harness.mjs';

// Alice-first requirement against the exact runtime supplied by this qualification.
// Real packaged evaluator and signature verification; ephemeral fixture keys,
// stores and account identities only. No browser, provider, DB or external send.
const runtime = process.argv[2];
const AUTH = 'seller_agents_control_auth_v2';
const ORIGINS = {alice:'https://alice.yandex.ru',chatgpt:'https://chatgpt.com',qwen:'https://chat.qwen.ai',kimi:'https://www.kimi.ai',grok:'https://grok.com',gemini:'https://gemini.google.com',claude:'https://claude.ai',deepseek:'https://chat.deepseek.com'};
const cases = [];
const clone = structuredClone;
async function record(id, fn) {
  try { const actual = await fn(); cases.push({id,status:'PASS',...actual}); }
  catch(e) { cases.push({id,status:'FAIL',error:e.message}); }
}
function request(worker,family,marketplace,operation) {
  const auth=clone(worker.backing.local[AUTH]),authority=auth.authority,payload=authority.payload,profile=payload.ai.profile;
  const origin=ORIGINS[family],conversationId='alice-scope-fixture',conversationKey=origin+'|'+conversationId;
  const store={accountId:payload.account.id,id:'scope-fixture-store',marketplace,credentialRevision:'fixture-credential-r1'};
  const binding={binding_id:'scope-fixture-binding',revision:1,origin,ai_id:family,conversation_id:conversationId,conversation_key:conversationKey,store_context:{...store,authGeneration:authority.generation}};
  return {operation,source:'ONLINE',cachedAuthority:authority,cacheClock:auth.cacheClock,effectiveTimeMs:auth.cacheClock.effectiveTimeMs,
    identity:{origin,conversationId,key:conversationKey,provider:family},binding,store,
    work:{state:'inactive',conversation_key:conversationKey,start_intent_id:null},
    current:{accountId:payload.account.id,expectedAccountId:payload.account.id,generation:authority.generation,expectedGeneration:authority.generation,
      deviceId:authority.deviceId,expectedDeviceId:authority.deviceId,sessionId:authority.sessionId,expectedSessionId:authority.sessionId,
      aiFamily:family,aiSurface:'web',aiVariant:null,aiProfile:{profileKey:profile.profileKey,revision:profile.revision,scopeVariant:profile.scopeVariant,contentSha256:profile.contentSha256},
      origin,conversationId,conversationKey,storeId:store.id,marketplace,credentialRevision:store.credentialRevision,expectedCredentialRevision:store.credentialRevision,
      bindingId:binding.binding_id,bindingRevision:binding.revision,workStartIntentId:null,expectedWorkStartIntentId:null}};
}
for(const family of Object.keys(ORIGINS)) {
  const worker=await makeWorker(runtime,{aiFamily:'alice',fetch:async()=>{throw Error('UNEXPECTED_NETWORK');}});
  try {
    for(const marketplace of ['ozon','wildberries']) for(const mode of ['ONLINE_FRESH','CACHE_GRACE']) for(const operation of ['START','CONTINUE']) {
      await record(`${family}/${marketplace}/${mode}/${operation}`,async()=>{
        const input=request(worker,family,marketplace,operation),payload=input.cachedAuthority.payload;
        payload.ai.detected={family,surface:'web',variant:null};
        input.cachedAuthority.requestedAi=family;
        input.cachedAuthority.cacheBinding.detectedAi={family,surface:'web',variant:null};
        // Model an existing valid all-eight signed grant, including stale cache.
        payload.entitlements={'source.ozon':true,'source.wildberries':true,...Object.fromEntries(Object.keys(ORIGINS).map(f=>['ai.'+f,true]))};
        if(mode==='CACHE_GRACE') {input.source='CACHE';payload.expiresAt=new Date(input.effectiveTimeMs-1).toISOString();payload.offlineGraceUntil=new Date(input.effectiveTimeMs+60000).toISOString();}
        input.cachedAuthority.envelope=await signFixtureBootstrap(worker.backing,payload);
        const result=await worker.call('SellerAgentsAutonomousWorkAuthority.evaluate',input);
        assert.equal(result.allowed,family==='alice',JSON.stringify({actualAllowed:result.allowed,deniedGates:result.deniedGates,freshness:result.freshness,expectedAllowed:family==='alice'}));
        return {actualAllowed:result.allowed,freshness:result.freshness};
      });
    }
    if(family==='alice') for(const reason of ['expired','revoked','foreign-store','missing-profile']) {
      await record('alice/control/'+reason,async()=>{
        const input=request(worker,family,'ozon','CONTINUE');
        if(reason==='expired')input.effectiveTimeMs=Date.parse(input.cachedAuthority.payload.offlineGraceUntil);
        if(reason==='revoked')input.current.knownRevoke=true;
        if(reason==='foreign-store')input.current.storeId='other-store';
        if(reason==='missing-profile') {input.cachedAuthority.payload.ai={status:'UNCONFIGURED'};input.cachedAuthority.envelope=await signFixtureBootstrap(worker.backing,input.cachedAuthority.payload);}
        const result=await worker.call('SellerAgentsAutonomousWorkAuthority.evaluate',input);assert.equal(result.allowed,false);return {actualAllowed:result.allowed,deniedGates:result.deniedGates};
      });
    }
    assert.equal(worker.network.length,0);
    assert.equal(worker.controlNetwork.length,0);
  } finally {worker.close();}
}
const failures=cases.filter(x=>x.status==='FAIL');
console.log(JSON.stringify({suite:'ALICE_FIRST_COMPILED_RELEASE_RUNTIME',runtime,status:failures.length?'FAIL':'PASS',total:cases.length,passed:cases.length-failures.length,failed:failures.length,cases,level:'Actual packaged pure evaluator plus synthetic signed grants; not complete ingress/server/installed acceptance'},null,2));
process.exitCode=failures.length?1:0;
