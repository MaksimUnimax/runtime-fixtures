import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {createHarness,repo,fixture,clone,plain,hash} from "./wb-sales-finance-runtime-wiring.mjs";
const runtime=process.argv[2]||null,cases=[];
const test=async(name,fn)=>{await fn();cases.push({name,status:"PASS"});};
async function ready(){const h=await createHarness(runtime);await h.runSix({oneBlock:true});return h;}
function derived(h,owner){return owner.delivery.derived_file_refs[0];}
function storeRecord(ref,bytes){const keys=["artifact_key","source_kind","filename","mime_type","extension","byte_length","sha256","complete","serialization","serialization_version","identity_version","collection_id","owner_operation_id","scope_sha256","chain_sha256","result_sha256","expires_at_ms"];return {...Object.fromEntries(keys.map(k=>[k,ref[k]])),bytes};}
async function committed(h){
 const r=await h.port("OZ_ATTACHMENT_COMMIT");assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.attach_allowed,true);return r;
}
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"cap19-runtime-gold-"));
try{
 const out=path.join(temp,"gold.json");
 execFileSync("/usr/bin/python3",[path.join(repo,"tests/regression/extension-core/wb-sales-finance-gold.py"),path.join(repo,"tests/regression/extension-core/fixtures/wb-sales-finance-six-pages-v1.json"),out]);
 const gold=JSON.parse(fs.readFileSync(out,"utf8"));
 await test("real port attaches exact full JSON-labelled UTF8 TXT and independent numeric/semantic gold",async()=>{
  const h=await ready(),before=await h.getOwner(),ref=derived(h,before),r=await committed(h);
  const marker=r.recovery.outgoing_text;assert.match(marker,/^WB_BATCH_RESULT_V1\n/);
  const markerBody=JSON.parse(marker.slice(marker.indexOf("\n")+1));
  assert.equal(markerBody.delivery_representation,"ATTACHED_DOCUMENT_BUNDLE");assert.equal(markerBody.derived_business_report_count,1);
  const descriptors=r.recovery.artifact_descriptors;
  assert.equal(descriptors.filter(x=>x.source_kind==="derived_business_report").length,1);
  assert.equal(descriptors.length,markerBody.attachments.length);
  assert.deepEqual(plain(descriptors.find(x=>x.artifact_key===ref.artifact_key)),plain(ref));
  const chunks=[];
  for(let offset=0;offset<ref.byte_length;offset+=257){
   const response=await h.port("OZ_ATTACHMENT_ARTIFACT_CHUNK",{artifact_key:ref.artifact_key,offset,length:257});
   assert.equal(response.ok,true,JSON.stringify(response));chunks.push(Buffer.from(response.chunk_base64,"base64"));
  }
  const bytes=Buffer.concat(chunks);assert.equal(bytes.length,ref.byte_length);assert.equal(hash(bytes),ref.sha256);
  const report=JSON.parse(bytes.toString("utf8"));
  assert.deepEqual(report.financeTotals.map(({missingRetailAmount,missingForPay,...r})=>r),gold.financeTotals);
  assert.deepEqual(report.links.map(r=>[r.saleID,r.rrdId]),gold.pairs);
  assert.deepEqual(report.unmatchedSales.map(r=>r.saleID),gold.unmatchedSales);
  assert.deepEqual(report.unmatchedFinance.map(r=>r.rrdId),gold.unmatchedFinance);
  assert.deepEqual(report.sales.filter(r=>r.inBusinessEventPeriod).map(r=>r.saleID),gold.eventPeriodSales);
  assert.deepEqual(report.sales.filter(r=>!r.inBusinessEventPeriod).map(r=>r.saleID),gold.outsideEventPeriodSales);
  for(const key of ["operationalCurrency","FX","finalRevenue"])assert.equal(report.coverage[key],null);
  assert.equal(report.coverage.businessCoverageProved,false);assert.equal(report.coverage.atomicSnapshotProved,false);
  assert.equal(report.finance.find(r=>r.rrdId==="103").provenance.length,2);
  assert.equal(report.sales.find(r=>r.saleID==="S-CAP19-1002").provenance.length,2);
  assert.ok(report.sales.every(r=>typeof r.nmId==="string"));
  assert.equal(h.network.length,6);
 });
 await test("actual ready/Send/confirmation phases preserve exactly one Send and clear owner",async()=>{
  const h=await ready(),r=await committed(h),names=r.recovery.artifact_descriptors.map(x=>x.filename);
  assert.equal((await h.port("OZ_ATTACHMENT_READY",{attached_filenames:names,baseline_assistant_turn_ids:["a0"]})).ready,true);
  assert.equal((await h.port("OZ_ATTACHMENT_SEND_COMMIT",{baseline_user_turn_ids:["u0"]})).click_allowed,true);
  assert.equal((await h.port("OZ_ATTACHMENT_SEND_COMMIT",{baseline_user_turn_ids:["u0"]})).click_allowed,false);
  const confirmed=await h.port("OZ_ATTACHMENT_CONFIRM",{confirmed_user_turn_id:"u1"});assert.equal(confirmed.confirmed,true,JSON.stringify(confirmed));
  const owner=await h.getOwner();assert.equal(owner.status,"completed");assert.equal(owner.delivery,null);
 });
 await test("duplicate attachment commit is UNKNOWN without second attachment grant",async()=>{
  const h=await ready();await committed(h);const r=await h.port("OZ_ATTACHMENT_COMMIT");
  assert.equal(r.ok,true);assert.equal(r.attach_allowed,false);assert.equal(r.outcome_unknown,true);
 });
 await test("existing stored identity readback is idempotent without overwrite or provider replay",async()=>{
  const h=await ready(),owner=await h.getOwner(),ref=derived(h,owner),count=h.db.puts;
  const reread=await h.realm.OzonFileDeliveryWorker.readApplicationArtifact(ref,{owner,assertCurrent:async()=>h.realm.saAssertDeliveryOwner(owner)});
  assert.deepEqual(plain(reread),plain(ref));assert.equal(h.db.puts,count);assert.equal(h.network.length,6);
 });
 await test("known exact repeated store uses immutable existing row without overwrite",async()=>{
  const h=await ready(),owner=await h.getOwner(),ref=derived(h,owner),count=h.db.puts,record=h.db.records.get(ref.artifact_key);
  const reread=await h.realm.OzonFileDeliveryWorker.storeApplicationArtifact(storeRecord(ref,record.bytes),{owner,assertCurrent:async()=>h.realm.saAssertDeliveryOwner(owner),admit:()=>{}});
  assert.equal(reread.sha256,ref.sha256);assert.equal(h.db.puts,count);
 });
 await test("caller cannot mutate snapshot metadata/bytes during asynchronous guard",async()=>{
  const h=await ready(),owner=await h.getOwner(),ref=derived(h,owner),existing=h.db.records.get(ref.artifact_key),record=storeRecord(ref,new Uint8Array(existing.bytes).slice());
  let once=false;
  const result=await h.realm.OzonFileDeliveryWorker.storeApplicationArtifact(record,{owner,assertCurrent:async()=>{
   if(!once){once=true;record.expires_at_ms+=100000;record.bytes[0]^=1;}
   await h.realm.saAssertDeliveryOwner(owner);
  },admit:()=>{}});
  assert.equal(result.sha256,ref.sha256);assert.equal(result.expires_at_ms,ref.expires_at_ms);
 });
 await test("missing persisted artifact is not recreated or redownloaded",async()=>{
  const h=await ready(),owner=await h.getOwner(),ref=derived(h,owner);h.db.records.delete(ref.artifact_key);
  const r=await h.port("OZ_ATTACHMENT_COMMIT");assert.equal(r.ok,false);assert.match(r.code,/MISSING|UNAVAILABLE/);assert.equal(h.network.length,6);
  assert.equal(h.db.records.has(ref.artifact_key),false);
 });
 await test("tampered stored bytes fail exact hash and never disclose a chunk",async()=>{
  const h=await ready();await committed(h);const owner=await h.getOwner(),ref=derived(h,owner),record=h.db.records.get(ref.artifact_key);
  new Uint8Array(record.bytes)[0]^=1;
  const r=await h.port("OZ_ATTACHMENT_ARTIFACT_CHUNK",{artifact_key:ref.artifact_key});assert.equal(r.ok,false);assert.equal(r.chunk_base64,undefined);
 });
 await test("conflicting same identity is refused without overwrite",async()=>{
  const h=await ready(),owner=await h.getOwner(),ref=derived(h,owner),row=h.db.records.get(ref.artifact_key),count=h.db.puts;
  row.filename="conflict.txt";
  await assert.rejects(()=>h.realm.OzonFileDeliveryWorker.storeApplicationArtifact(storeRecord(ref,row.bytes),{owner,assertCurrent:async()=>{},admit:()=>{}}),e=>e.code==="APPLICATION_FILE_IDENTITY_CONFLICT_NO_OVERWRITE");
  assert.equal(h.db.puts,count);assert.equal(h.db.records.get(ref.artifact_key).filename,"conflict.txt");
 });
 for(const [name,mutate]of [
  ["binding",h=>h.live.bindingRevision++],["credential generation",h=>h.live.credentialRevision="other"],
  ["store",h=>h.live.storeId="OTHER"],["work generation",h=>h.live.workGeneration++],
  ["policy",h=>h.live.policyRevision="blocked"],["auth",h=>h.live.authGeneration++],
  ["authority access",h=>h.live.accessEpoch++],["conversation",h=>h.live.conversationKey="other"],
  ["active state",h=>h.live.active=false]
 ])await test("real chunk guards reject changed "+name,async()=>{
  const h=await ready();await committed(h);const owner=await h.getOwner(),ref=derived(h,owner);mutate(h);
  const r=await h.port("OZ_ATTACHMENT_ARTIFACT_CHUNK",{artifact_key:ref.artifact_key});assert.equal(r.ok,false);assert.equal(r.chunk_base64,undefined);
 });
 for(const [name,cancel]of [
  ["empty-map conversation OR",h=>h.realm.saCancelAdmission(999,h.key)],
  ["matching tab",h=>h.realm.saCancelAdmission(17,"other")],
  ["matching store",h=>h.realm.saCancelAdmissionsForStore(h.live.storeId)]
 ])await test("published artifact respects "+name+" cancellation",async()=>{
  const h=await ready();await committed(h);const owner=await h.getOwner(),ref=derived(h,owner);
  cancel(h);const r=await h.port("OZ_ATTACHMENT_ARTIFACT_CHUNK",{artifact_key:ref.artifact_key});assert.equal(r.ok,false);assert.equal(r.chunk_base64,undefined);
 });
 await test("unrelated tab/conversation/store cancellation preserves exact chunk",async()=>{
  const h=await ready();await committed(h);const owner=await h.getOwner(),ref=derived(h,owner);
  h.realm.saCancelAdmission(999,"other");h.realm.saCancelAdmissionsForStore("other");
  assert.equal((await h.port("OZ_ATTACHMENT_ARTIFACT_CHUNK",{artifact_key:ref.artifact_key})).ok,true);
 });
 await test("expiry after ready cannot grant Send even while operation payload remains alive",async()=>{
  const h=await ready(),r=await committed(h);await h.port("OZ_ATTACHMENT_READY",{attached_filenames:r.recovery.artifact_descriptors.map(x=>x.filename)});
  h.advance(300001);const send=await h.port("OZ_ATTACHMENT_SEND_COMMIT");assert.equal(send.ok,false);assert.equal(send.click_allowed,undefined);
 });
 for(const [name,move]of [
  ["monotonic lifetime",h=>h.advanceMonotonic(300001)],
  ["calendar rollback",h=>h.rollbackClock(1)]
 ])await test("asynchronous chunk rejects "+name+" change",async()=>{
  const h=await ready();await committed(h);const owner=await h.getOwner(),ref=derived(h,owner);
  h.hooks.pauseDigest=async()=>move(h);
  const r=await h.port("OZ_ATTACHMENT_ARTIFACT_CHUNK",{artifact_key:ref.artifact_key});assert.equal(r.ok,false);assert.equal(r.chunk_base64,undefined);
 });
 await test("cancellation during hash cannot disclose private bytes",async()=>{
  const h=await ready();await committed(h);const owner=await h.getOwner(),ref=derived(h,owner);
  h.hooks.pauseDigest=async()=>h.realm.saCancelAdmission(17,h.key);
  const r=await h.port("OZ_ATTACHMENT_ARTIFACT_CHUNK",{artifact_key:ref.artifact_key});assert.equal(r.ok,false);assert.equal(r.chunk_base64,undefined);
 });
 await test("cancellation during native owner write acknowledgement cannot grant Send",async()=>{
  const h=await ready(),r=await committed(h);await h.port("OZ_ATTACHMENT_READY",{attached_filenames:r.recovery.artifact_descriptors.map(x=>x.filename)});
  let once=false;h.hooks.ownerWrite=value=>{
   const owner=value.manual?.[h.key];
   if(!once && owner?.delivery?.phase===h.realm.BridgeAutorunModel.ATTACHMENT_PHASES.SEND_COMMITTED){once=true;h.realm.saCancelAdmission(17,h.key);}
  };
  const send=await h.port("OZ_ATTACHMENT_SEND_COMMIT");assert.equal(once,true);assert.equal(send.ok,false);assert.equal(send.click_allowed,undefined);
  h.hooks.ownerWrite=null;
  const retry=await h.port("OZ_ATTACHMENT_SEND_COMMIT");assert.equal(retry.click_allowed,undefined);
 });
 await test("stale context after original raw callback preserves effect and prevents a derived report",async()=>{
  const h=await createHarness(runtime);h.hooks.fetch=()=>{h.live.credentialRevision="changed-after-HTTP";};
  await h.execute(h.block([fixture.pages[0]]));
  const owner=await h.getOwner();assert.equal(h.network.length,1);assert.equal(owner.delivery?.derived_file_refs?.length||0,0);
  assert.ok(owner.batch?.entries.some(e=>e.external_request_executed===true) || owner.status==="failed");
 });
 await test("unqualified retained one-file route still rejects all-required bundle without dropping files",async()=>{
  const h=await ready(),text="complete additional required source report";
  await h.mutateOwner(o=>({...o,delivery:{...o.delivery,adapter_id:"qwen",artifact_text:text,
   generated_text_document:{artifact_id:"fixture-generated",filename:"full-source.txt",unicode_char_length:text.length,byte_length:Buffer.byteLength(text),complete:true},provider_file_refs:[]}}));
  const r=await h.port("OZ_ATTACHMENT_COMMIT");assert.equal(r.ok,false);assert.equal(r.code,"TARGET_AI_FILE_COUNT_UNSUPPORTED");
  assert.equal((await h.getOwner()).delivery.phase,h.realm.BridgeAutorunModel.ATTACHMENT_PHASES.CLAIMED);
  assert.ok((await h.getOwner()).delivery.derived_file_refs.length);
 });
 async function sequentialBundle(h,expectedKinds){
  let result=await committed(h),received=[],first=true;
  const inventory=(await h.getOwner()).delivery.attachment_bundle.inventory;
  assert.deepEqual(plain(inventory.map(d=>d.source_kind)),expectedKinds);
  for(let i=0;i<expectedKinds.length;i++){
   const recovery=result.recovery;
   const fields=Object.fromEntries(["bundle_schema","bundle_manifest_sha256","bundle_part_id","bundle_part_ordinal"].map(k=>[k,recovery[k]]));
   assert.equal(recovery.bundle_part_ordinal,i+1);assert.equal(recovery.artifact_descriptors.length,1);
   const descriptor=recovery.artifact_descriptors[0];
   const chunk=await h.port("OZ_ATTACHMENT_ARTIFACT_CHUNK",{...fields,artifact_key:descriptor.artifact_key});
   assert.equal(chunk.ok,true,JSON.stringify(chunk));const bytes=Buffer.from(chunk.chunk_base64,"base64");assert.equal(hash(bytes),descriptor.sha256);
   received.push({descriptor,bytes});
   assert.equal((await h.port("OZ_ATTACHMENT_READY",{...fields,attached_filenames:[descriptor.filename]})).ready,true);
   assert.equal((await h.port("OZ_ATTACHMENT_SEND_COMMIT",{...fields,baseline_user_turn_ids:["old-user"]})).click_allowed,true);
   const ack=await h.port("OZ_ATTACHMENT_CONFIRM",{...fields,confirmed_user_turn_id:"bundle-user-"+i});
   assert.equal(ack.ok,true,JSON.stringify(ack));
   if(i+1<expectedKinds.length){
    assert.equal(ack.bundle_complete,false);const owner=await h.getOwner();assert.equal(owner.status,"delivering");
    assert.ok(owner.batch);for(const d of inventory)assert.ok(h.db.records.has(d.artifact_key));
    result=await h.port("OZ_ATTACHMENT_COMMIT",Object.fromEntries(["bundle_schema","bundle_manifest_sha256","bundle_part_id","bundle_part_ordinal"].map(k=>[k,ack.recovery[k]])));
    assert.equal(result.attach_allowed,true,JSON.stringify(result));
   }else{assert.equal(ack.bundle_complete,true);assert.equal((await h.getOwner()).status,"completed");}
  }
  assert.equal(h.network.length,6,'multipart delivery never repeats provider collection');
  return received;
 }
 await test("Alice one-file turns deliver required generated and derived full TXT without dropping either",async()=>{
  const h=await ready(),text="complete additional required source report";
  await h.mutateOwner(o=>({...o,delivery:{...o.delivery,adapter_id:"alice",artifact_text:text,
   generated_text_document:{artifact_id:"fixture-generated",filename:"full-source.txt",unicode_char_length:text.length,byte_length:Buffer.byteLength(text),complete:true},provider_file_refs:[]}}));
  const received=await sequentialBundle(h,["generated_bridge_text","derived_business_report"]);
  assert.equal(received[0].bytes.toString('utf8'),text);
  const report=JSON.parse(received[1].bytes.toString('utf8'));
  assert.deepEqual(report.financeTotals.map(({missingRetailAmount,missingForPay,...r})=>r),gold.financeTotals);
  assert.deepEqual(report.links.map(r=>[r.saleID,r.rrdId]),gold.pairs);
 });
 await test("Alice sequential bundle preserves generated, original and derived exact bytes and gold",async()=>{
  const h=await ready(),text="complete required source report",original=Buffer.from("synthetic complete original source");
  const providerRef="sa_file_"+"f".repeat(64),providerKey="provider:"+providerRef;
  h.db.records.set(providerKey,{artifact_key:providerKey,source_kind:"original_provider_file",filename:"original.txt",mime_type:"text/plain;charset=utf-8",extension:"txt",byte_length:original.length,sha256:hash(original),bytes:new Uint8Array(original).buffer,created_at_ms:h.clock,expires_at_ms:h.clock+60000});
  await h.mutateOwner(o=>({...o,delivery:{...o.delivery,adapter_id:"alice",artifact_text:text,
   generated_text_document:{artifact_id:"fixture-three-generated",filename:"complete-source.txt",unicode_char_length:text.length,byte_length:Buffer.byteLength(text),complete:true},provider_file_refs:[providerRef]}}));
  const received=await sequentialBundle(h,["generated_bridge_text","original_provider_file","derived_business_report"]);
  assert.equal(received[0].bytes.toString('utf8'),text);assert.deepEqual(received[1].bytes,original);
  const report=JSON.parse(received[2].bytes.toString('utf8'));
  assert.deepEqual(report.financeTotals.map(({missingRetailAmount,missingForPay,...r})=>r),gold.financeTotals);
  assert.deepEqual(report.links.map(r=>[r.saleID,r.rrdId]),gold.pairs);
 });
 await test("eligible route preserves generated, original and derived files in one bundle",async()=>{
  const h=await ready(),content="complete required source report",original=new TextEncoder().encode("synthetic original complete source");
  const providerKey="provider:sa_file_CAP19fixture";
  h.db.records.set(providerKey,{artifact_key:providerKey,source_kind:"original_provider_file",filename:"original.txt",mime_type:"text/plain;charset=utf-8",extension:"txt",byte_length:original.length,sha256:hash(original),bytes:original.buffer,created_at_ms:h.clock,expires_at_ms:h.clock+60000});
  await h.mutateOwner(o=>({...o,delivery:{...o.delivery,adapter_id:"chatgpt",artifact_text:content,
   generated_text_document:{artifact_id:"fixture-complete-generated",filename:"complete-source.txt",unicode_char_length:content.length,byte_length:content.length,complete:true},provider_file_refs:["sa_file_CAP19fixture"]}}));
  const r=await committed(h),descriptors=r.recovery.artifact_descriptors;
  assert.deepEqual(plain(descriptors.map(x=>x.source_kind)),["generated_bridge_text","original_provider_file","derived_business_report"]);
  for(const d of descriptors){const response=await h.port("OZ_ATTACHMENT_ARTIFACT_CHUNK",{artifact_key:d.artifact_key});assert.equal(response.ok,true,JSON.stringify(response));assert.equal(hash(Buffer.from(response.chunk_base64,"base64")),d.sha256);}
 });
 await test("post-commit cancellation leaves durable identity UNKNOWN and never retries store",async()=>{
  const h=await ready(),owner=await h.getOwner(),ref=derived(h,owner),row=h.db.records.get(ref.artifact_key);
  h.db.records.delete(ref.artifact_key);let once=false;
  h.hooks.afterCommit=()=>{if(!once && h.db.records.has(ref.artifact_key)){once=true;h.realm.saCancelAdmission(17,h.key);}};
  await assert.rejects(()=>h.realm.OzonFileDeliveryWorker.storeApplicationArtifact(storeRecord(ref,row.bytes),{owner,assertCurrent:async()=>{},admit:()=>{}}),e=>e.artifact_effect==="COMMITTED_UNPUBLISHED");
  assert.equal(once,true);assert.equal(h.db.records.has(ref.artifact_key),true);assert.equal(h.network.length,6);
 });
 await test("collection retains fixed initial deadline across continuation blocks",async()=>{
  const h=await createHarness(runtime),first=await h.execute(h.block([fixture.pages[0],fixture.pages[3]]));
  await h.ackFixture();h.advance(10000);
  const second=await h.execute(h.block([fixture.pages[1],fixture.pages[4]],first.cap19_collection.collectionId));
  assert.equal(second.cap19_collection.deadline,first.cap19_collection.deadline);
 });
 await test("foreign sender cannot read derived metadata or bytes",async()=>{
  const h=await ready();await committed(h);const owner=await h.getOwner(),ref=derived(h,owner);
  const r=await h.port("OZ_ATTACHMENT_ARTIFACT_CHUNK",{artifact_key:ref.artifact_key},{tab:{id:99,url:"https://chatgpt.com/c/foreign"},url:"https://chatgpt.com/c/foreign"});
  assert.equal(r.ok,false);assert.equal(r.chunk_base64,undefined);
 });

 for(const route of ["store","read","commit","chunk","copy"])await test("exact credential veto protects legacy unsafe derived artifact at "+route,async()=>{
  const h=await ready(),owner=await h.getOwner(),old=derived(h,owner),oldRecord=h.db.records.get(old.artifact_key);
  const report=JSON.parse(new TextDecoder().decode(oldRecord.bytes));report.finance[0].docTypeName="PUBLIC_SYNTHETIC_CAP19_TOKEN";
  const bytes=new TextEncoder().encode(JSON.stringify(report,null,2)+"\n"),digest=hash(bytes);
  const ref={...plain(old),sha256:digest,result_sha256:digest,byte_length:bytes.byteLength},api=h.realm.SellerAgentsWBSalesFinanceManual;
  const identity=await api.hash(api.canonical(["cap19-derived-v1",ref.collection_id,ref.scope_sha256,ref.chain_sha256,ref.result_sha256,"json-utf8-txt"]));
  ref.artifact_key="derived:cap19:"+identity;ref.filename="wb-sales-finance-"+identity+".txt";
  const record={...plain(oldRecord),...ref,bytes:bytes.buffer};h.db.records.delete(old.artifact_key);
  await h.mutateOwner(o=>({...o,cap19_artifact_intent:ref,delivery:{...o.delivery,derived_file_refs:[ref]}}));
  const current=await h.getOwner(),puts=h.db.puts;
  if(route==="store"){
   await assert.rejects(()=>h.realm.OzonFileDeliveryWorker.storeApplicationArtifact(storeRecord(ref,bytes),{owner:current,assertCurrent:()=>h.realm.saAssertDeliveryOwner(current),admit:()=>{}}),e=>e.code==="CAP19_CREDENTIAL_ECHO");
   assert.equal(h.db.puts,puts);assert.equal(h.db.records.has(ref.artifact_key),false);
  }else{
   h.db.records.set(ref.artifact_key,record); // exact pre-fix legacy stored bytes, synthetic only
   if(route==="read")await assert.rejects(()=>h.realm.OzonFileDeliveryWorker.readApplicationArtifact(ref,{owner:current,assertCurrent:()=>h.realm.saAssertDeliveryOwner(current)}),e=>e.code==="CAP19_CREDENTIAL_ECHO");
   else if(route==="copy") {
    await h.mutateOwner(o=>({...o,delivery:{...o.delivery,artifact_descriptors:[ref]}}));
    await assert.rejects(async()=>h.realm.OzonFileDeliveryWorker.copyManifest((await h.getOwner()).delivery),e=>e.code==="CAP19_CREDENTIAL_ECHO");
   } else {
    if(route!=="commit")await h.mutateOwner(o=>({...o,delivery:{...o.delivery,artifact_descriptors:[ref]}}));
    const response=await h.port(route==="commit"?"OZ_ATTACHMENT_COMMIT":"OZ_ATTACHMENT_ARTIFACT_CHUNK",{artifact_key:ref.artifact_key});
    assert.equal(response.ok,false);assert.equal(response.code,"CAP19_CREDENTIAL_ECHO");assert.equal(response.chunk_base64,undefined);
    assert.ok(!JSON.stringify(response).includes("PUBLIC_SYNTHETIC_CAP19_TOKEN"));
   }
  }
  assert.equal(h.network.length,6,"veto never fetches again");
 });

 console.log(JSON.stringify({status:"PASS_SOURCE_SYNTHETIC_CAP19_DERIVED_ATTACHMENT",runtime:runtime||"source",cases:cases.length,results:cases,installed:false,liveProviderCalls:0,independentGold:"Python Decimal/zoneinfo + explicit four-group semantic oracle"}));
}finally{fs.rmSync(temp,{recursive:true,force:true});}
