import assert from 'node:assert/strict';
import {makeWorker,signFixtureBootstrap} from '../worker-harness.mjs';
const fixtureEnvironment=process.env.APPLICATION_FIXTURE_ENVIRONMENT;
if(fixtureEnvironment)assert.ok(['LOCAL DEVELOPMENT','PREPRODUCTION'].includes(fixtureEnvironment));
const runtime=process.argv[2], AUTH='seller_agents_control_auth_v2';
const cases=[];
const offline=async()=>{throw Error('SYNTHETIC_OFFLINE');};
for(const [browser,userAgent] of [
  ['chrome','Mozilla/5.0 Chrome/120.0.0.0'],
  ['opera','Mozilla/5.0 Chrome/132.0.0.0 OPR/117.0.0.0'],
  ['yandex_chromium','Mozilla/5.0 Chrome/132.0.0.0 YaBrowser/25.4.0.0'],
  ['firefox','Mozilla/5.0 Firefox/140.0'],
]) {
  const make=options=>makeWorker(runtime,{...(fixtureEnvironment?{fixtureEnvironment}:{}),userAgent,...options});
  async function record(id,fn){if(process.argv[3]&&!id.includes(process.argv[3]))return;try{await fn();cases.push({browser,id,status:'PASS'});}catch(error){cases.push({browser,id,status:'FAIL',error:error.stack});}}
for(const family of ['chatgpt','qwen','kimi','grok','gemini','claude','deepseek']) {
  await record(`${family}/real-start-bootstrap-cache-denied`,async()=>{
    const seed=await make({aiFamily:'alice',fetch:offline});
    await seed.settings();
    const backing=seed.backing, authority=backing.local[AUTH].authority;
    const origins={chatgpt:'https://chatgpt.com',qwen:'https://chat.qwen.ai',kimi:'https://www.kimi.ai',grok:'https://grok.com',gemini:'https://gemini.google.com',claude:'https://claude.ai',deepseek:'https://chat.deepseek.com'};
    authority.payload.ai.detected={family,surface:'web',variant:null};
    authority.payload.entitlements['ai.'+family]=true;
    authority.requestedAi=family;
    authority.cacheBinding.detectedAi={family,surface:'web',variant:null};
    authority.envelope=await signFixtureBootstrap(backing,authority.payload);
    const catalog=backing.local.seller_agents_stores_v1;
    const store=Object.values(catalog.accounts[seed.accountId].stores)[0];
    const credentials=structuredClone(backing.local[AUTH].credentials);
    seed.close();
    const worker=await make({aiFamily:family,backing,seedAuthority:false,fetch:offline});
    try {
      assert.deepEqual(backing.local[AUTH].credentials,credentials);
      assert.equal(await worker.call('SellerAgentsControlClient.canWork',worker.identity),false);
      await assert.rejects(worker.call('SellerAgentsControlClient.ensureForIdentity',worker.identity));
      await assert.rejects(worker.call('SellerAgentsControlClient.bootstrap',{detectedAi:{family,surface:'web',variant:null}}));
      const ai={family,surface:'web',variant:null};
      const request={messageType:'OZ_REQUEST_SIGNED_AI_PROFILE',protocolVersion:'signed_ai_profile_consumer_v1',requestId:crypto.randomUUID(),ai};
      assert.equal(await worker.call('SellerAgentsSignedAiProfileConsumer.validRequest',request),true,'retained structural profile protocol');
      const url=origins[family]+'/c/core-fixture-dialogue';
      const profile=await worker.request(request,{id:'core-fixture',frameId:0,documentId:'release-fixture',url,tab:{id:worker.tabId,url}});
      assert.equal(profile.status,'UNAVAILABLE',JSON.stringify(profile));
      assert.equal(profile.reason,'WORK_NOT_ALLOWED');
      const start=await worker.popup({type:'SA_WORK_START',store_id:store.id,tab_id:worker.tabId,confirm_change:true,start_intent_id:'blocked-'+family});
      assert.equal(start.ok,false,JSON.stringify(start));
      assert.equal(worker.network.length,0);
      assert.equal(worker.controlNetwork.length,0);
      assert.equal(worker.messages.some(m=>m.type==='OZ_WORK_SEND_INITIAL_PROMPT'),false);
    } finally {worker.close();}
  });
}
for(const mutation of ['old-v1','wrong-scope','missing-scope','old-v1-foreign-generation']) {
  await record(`restore/${mutation}/preserves-data-and-principal-fences`,async()=>{
    const seed=await make({aiFamily:'alice',fetch:offline});
    await seed.settings();
    const keys=await seed.call('(function(){return KEYS;})');
    const backing=seed.backing;
    const auth=backing.local[AUTH];
    const credentials=structuredClone(auth.credentials);
    const stores=structuredClone(backing.local.seller_agents_stores_v1);
    assert.ok(stores.accounts[seed.accountId]);
    const unknown={synthetic_unknown:{outcome:'UNKNOWN',request_id:'must-not-retry',terminal:true}};
    // Use the actual store key; no new execution or outcome recovery is invented.
    const outcomeKey=keys.MANUAL_OPERATIONS;
    assert.equal(typeof outcomeKey,'string');
    backing.local[outcomeKey]=structuredClone(unknown);
    if(mutation.startsWith('old-v1')){auth.authority.cacheBinding.cacheVersion='control_cache_binding_v1';delete auth.authority.cacheBinding.aiReleaseScopeSha256;}
    if(mutation==='old-v1-foreign-generation')auth.generation++;
    if(mutation==='wrong-scope')auth.authority.cacheBinding.aiReleaseScopeSha256='0'.repeat(64);
    if(mutation==='missing-scope')delete auth.authority.cacheBinding.aiReleaseScopeSha256;
    seed.close();
    const worker=await make({aiFamily:'alice',backing,seedAuthority:false,fetch:offline});
    try {
      assert.equal(await worker.call('SellerAgentsControlClient.canWork',worker.identity),false);
      assert.equal(await worker.call('SellerAgentsControlClient.hasAuthority'),false);
      if(mutation==='old-v1-foreign-generation')assert.equal(backing.local[AUTH].credentials,null);
      else assert.deepEqual(backing.local[AUTH].credentials,credentials);
      assert.deepEqual(backing.local.seller_agents_stores_v1,stores);
      assert.deepEqual(backing.local[outcomeKey],unknown);
      assert.equal(worker.network.length,0);
      assert.equal(worker.controlNetwork.length,0);
    }finally{worker.close();}
  });
}
await record('alice/actual-start-ack-complete-and-offline-restore',async()=>{
  const worker=await make({aiFamily:'alice',fetch:offline});
  let next;
  try{
    await worker.settings();
    assert.equal(await worker.call('SellerAgentsControlClient.canWork',worker.identity),true);
    const conversation=await worker.start();
    assert.match(conversation,/alice/);
    assert.equal((await worker.call('getWorkSessions'))[conversation].state,'active_visible');
    assert.equal(worker.network.length,0);
    next=worker.backing;
  }finally{worker.close();}
  const restored=await make({aiFamily:'alice',backing:next,seedAuthority:false,fetch:offline});
  try{
    assert.equal(await restored.call('SellerAgentsControlClient.canWork',restored.identity),true);
    await restored.call('SellerAgentsControlClient.ensureForIdentity',restored.identity);
    assert.equal(restored.network.length,0);
    assert.ok(restored.controlNetwork.every(r=>new URL(r.url).pathname==='/v1/devices/current/client-metadata/forget'),'only existing Firefox privacy-forget traffic, no bootstrap/Health/provider request');
  }finally{restored.close();}
});
}
console.log(JSON.stringify({suite:'ALICE_RELEASE_REAL_LIFECYCLE',runtime,total:cases.length,failed:cases.filter(c=>c.status==='FAIL').length,cases,level:'actual composed worker and storage lifecycle; synthetic authority/tabs/provider; not installed'},null,2));
process.exitCode=cases.some(c=>c.status==='FAIL')?1:0;
