import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {createHash,webcrypto} from "node:crypto";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const output=path.resolve(process.argv[2]), packetPath=path.resolve(process.argv[3]);
const fixturePath=path.join(repo,"tests/regression/extension-core/fixtures/wb-sales-finance-six-pages-v1.json");
const fixture=JSON.parse(fs.readFileSync(fixturePath,"utf8"));
const packet=JSON.parse(fs.readFileSync(packetPath,"utf8"));
const hash=x=>createHash("sha256").update(x).digest("hex"),clone=x=>JSON.parse(JSON.stringify(x));
const sourcePath="packages/marketplaces/wildberries/src/sales-finance-reconciliation.js";
const source=fs.readFileSync(path.join(repo,sourcePath),"utf8");
const sourceIdentities=[];
const recipe=JSON.parse(fs.readFileSync(path.join(repo,"apps/extension/composition.json"),"utf8"));
const references=recipe.isolated_bundles["shared/wb_adapter.js"].reference_sources.map(p=>{
 const text=fs.readFileSync(path.join(repo,p),"utf8");sourceIdentities.push({path:p,bytes:Buffer.byteLength(text),sha256:hash(text),origin:"own pinned c5 tracked reference source"});return text;
});
const adapter=packet.all10_actual_source_contexts.find(x=>x.path==="packages/marketplaces/wildberries/src/adapter.js");
assert.equal(hash(adapter.text_utf8),adapter.sha256);
sourceIdentities.push({path:adapter.path,bytes:adapter.bytes,sha256:adapter.sha256,origin:"exact C saved R5 adapter source, no file write"});
let forbiddenNetworkCalls=0;
const realm=vm.createContext({console,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,Uint8Array,crypto:webcrypto,setTimeout,clearTimeout,structuredClone,fetch:()=>{forbiddenNetworkCalls++;throw new Error("NO_NETWORK");}});
const assembly="(() => {const scope=Object.create(null);(function(globalThis){\n"+references.join("\n;\n")+"\n})(scope);globalThis.SellerAgentsWBReference=Object.freeze({contract:scope.WBContract,credentials:scope.WBCredentials,guidance:scope.WBGuidance,transport:scope.ProviderTransportCore});})();\n"+adapter.text_utf8;
vm.runInContext(assembly,realm,{filename:"exact-saved-WB-provider-with-c5-reference-sources.js",timeout:5000});
vm.runInContext(source,realm,{filename:sourcePath,timeout:5000});
const api=realm.SellerAgentsWBSalesFinance,C=realm.SellerAgentsWBReference.contract;
const cases=[];
async function test(name,fn){await fn();cases.push({name,status:"PASS"});fs.writeFileSync(path.join(output,"case-progress.json"),JSON.stringify(cases,null,2)+"\n");}
function fresh(mutator=()=>{}){const f=clone(fixture);mutator(f);f.scopeSha256=hash(JSON.stringify(f.scope));const prev={};for(const p of f.pages){p.scopeSha256=f.scopeSha256;p.previousPageId=prev[p.stream]?.pageId??null;p.previousResponseSha256=prev[p.stream]?.response.sha256??null;p.response.bytes=Buffer.byteLength(p.response.rawText);p.response.sha256=hash(p.response.rawText);prev[p.stream]=p;}return f;}
function frames(f) {return f.pages.map(p=>{
 const command=C.parseCommand("WB_API_V1\n"+JSON.stringify(p.command)), request=C.buildRequest(command);
 return {scope:f.scope,scopeSha256:f.scopeSha256,stream:p.stream,pageId:p.pageId,ordinal:p.ordinal,previousPageId:p.previousPageId,previousResponseSha256:p.previousResponseSha256,
 command:clone(command),request:{method:request.method,url:request.url,...(request.body===undefined?{}:{body:request.body})},
 response:{httpStatus:p.response.httpStatus,rawText:p.response.rawText,byteLength:p.response.bytes,responseMeta:{content_type:p.response.contentType}}};
});}
async function run(f,mutateFrames=()=>{}){const collection=await api.createCollection({scope:f.scope});const values=frames(f);mutateFrames(values);for(const v of values)await collection.observe(v);return clone(collection.finish());}
function edit(f,page,index,fn) {
 const p=f.pages.find(p=>p.pageId===page),raw=p.response.rawText,rows=JSON.parse(raw),tokens=[];
 let depth=0,quoted=false,escape=false,start=0;
 for(let i=0;i<raw.length;i++) {
   const c=raw[i];
   if(quoted){if(escape)escape=false;else if(c==="\\")escape=true;else if(c==='"')quoted=false;continue;}
   if(c==='"'){quoted=true;continue;}
   if(c==="{"){if(depth++===0)start=i;}
   else if(c==="}" && --depth===0)tokens.push(raw.slice(start,i+1));
 }
 assert.equal(tokens.length,rows.length);
 const originals=new Map(rows.map((r,i)=>[r,{raw:tokens[i],json:JSON.stringify(r)}]));
 fn(rows[index],rows);
 p.response.rawText="["+rows.map(r=>{const old=originals.get(r);return old && JSON.stringify(r)===old.json?old.raw:JSON.stringify(r);}).join(",")+"]";
}
async function rejects(name,mutator,code,mutateFrames) {await test(name,async()=>{const f=fresh(mutator);await assert.rejects(()=>run(f,mutateFrames),e=>e.code===code);});}
const baseline=await run(fixture);
await test("complete paired normalization and exact money lexemes",async()=>{
 assert.equal(baseline.streams.sales.rawRows,6);assert.equal(baseline.streams.sales.uniqueRows,5);
 assert.equal(baseline.streams.finance.rawRows,6);assert.equal(baseline.streams.finance.uniqueRows,5);
 assert.equal(baseline.sales.find(r=>r.saleID==="S-CAP19-1001").finishedPrice,"100.10");
 assert.equal(baseline.sales.find(r=>r.saleID==="S-CAP19-1003").forPay,"0.00");
 assert.equal(baseline.sales.find(r=>r.saleID==="S-CAP19-1004").forPay,null);
 assert.equal(baseline.sales.find(r=>r.saleID==="S-CAP19-1004").srid,null);
 assert.equal(baseline.finance.find(r=>r.rrdId==="103").provenance.length,2);
 assert.equal(baseline.sales.find(r=>r.saleID==="S-CAP19-1002").provenance.length,2);
});
execFileSync("/usr/bin/python3",[path.join(repo,"tests/regression/extension-core/wb-sales-finance-gold.py"),fixturePath,path.join(output,"independent-gold.json")],{stdio:"pipe"});
const gold=JSON.parse(fs.readFileSync(path.join(output,"independent-gold.json"),"utf8"));
await test("independent Python Decimal and explicit semantic gold",async()=>{
 assert.deepEqual(baseline.financeTotals.map(({missingRetailAmount,missingForPay,...r})=>r),gold.financeTotals);
 assert.deepEqual(baseline.links.map(r=>[r.saleID,r.rrdId]),gold.pairs);
 assert.deepEqual(baseline.unmatchedSales.map(r=>r.saleID),gold.unmatchedSales);
 assert.deepEqual(baseline.unmatchedFinance.map(r=>r.rrdId),gold.unmatchedFinance);
 assert.deepEqual(baseline.sales.filter(r=>r.inBusinessEventPeriod).map(r=>r.saleID),gold.eventPeriodSales);
 assert.deepEqual(baseline.sales.filter(r=>!r.inBusinessEventPeriod).map(r=>r.saleID),gold.outsideEventPeriodSales);
 assert.equal(baseline.coverage.operationalCurrency,null);assert.equal(baseline.coverage.FX,null);
 assert.equal(baseline.coverage.finalRevenue,null);assert.equal(baseline.coverage.businessCoverageProved,false);
 assert.equal(baseline.coverage.atomicSnapshotProved,false);
});
let fetchCalls=0,callbacks=0;const observations=[],events=[];
const collection=await api.createCollection({scope:fixture.scope});
for(const p of fixture.pages){
 const context={snapshot:{...fixture.scope,policyRevision:"personal-enabled"},assertCurrent:async()=>events.push(p.pageId+":guard"),assertDispatchAuthority:async()=>events.push(p.pageId+":dispatch"),credentials:async()=>({token:"PUBLIC_SYNTHETIC_PLACEHOLDER_NOT_A_CREDENTIAL"})};
 const provider=realm.SellerAgentsWBAdapter.createProvider({timeoutMs:1000,uuid:()=>p.pageId,fetchImpl:async(url,init)=>{
   fetchCalls++;assert.equal(init.credentials,"omit");assert.equal(init.redirect,"error");const u=new URL(url);
   assert.equal(u.hostname,p.expectedRequest.hostname);assert.equal(u.pathname,p.expectedRequest.pathname);assert.equal(init.method,p.expectedRequest.method);
   return new Response(p.response.httpStatus===204?null:p.response.rawText,{status:p.response.httpStatus,headers:{"content-type":"application/json"}});
 }});
 const result=await provider.execute("WB_API_V1\n"+JSON.stringify(p.command),{context,onProviderResponse:async e=>{
   events.push(p.pageId+":raw");callbacks++;
   assert.equal(e.response.rawText,p.response.rawText);assert.equal(hash(e.response.rawText),p.response.sha256);
   const frame={scope:fixture.scope,scopeSha256:fixture.scopeSha256,stream:p.stream,pageId:p.pageId,ordinal:p.ordinal,previousPageId:p.previousPageId,previousResponseSha256:p.previousResponseSha256,
    command:clone(e.command),request:{method:e.request.method,url:e.request.url,...(e.request.body===undefined?{}:{body:e.request.body})},
    response:{httpStatus:e.response.httpStatus,rawText:e.response.rawText,byteLength:e.response.byteLength,responseMeta:{content_type:e.response.responseMeta.content_type}}};
   await collection.observe(frame);const {scope,...saved}=frame;observations.push(saved);
 },onProviderResult:async()=>{events.push(p.pageId+":sanitized");assert.equal(callbacks,observations.length);}});
 assert.equal(result.ok,true,JSON.stringify(result));assert.ok(events.indexOf(p.pageId+":raw")<events.indexOf(p.pageId+":sanitized"));
}
const actual=clone(collection.finish());
await test("six existing adapter raw callbacks feed actual standalone consumer",async()=>{
 assert.equal(fetchCalls,6);assert.equal(callbacks,6);assert.equal(forbiddenNetworkCalls,0);assert.deepEqual(actual,baseline);
 const text=JSON.stringify(observations);assert.ok(!text.includes("Authorization"));assert.ok(!text.includes("PUBLIC_SYNTHETIC_PLACEHOLDER"));assert.ok(!text.includes("headers"));
});
const obsPath=path.join(output,"synthetic-callback-observations.json"),prefix=path.join(output,"wb-sales-finance-full-result");
fs.writeFileSync(obsPath,JSON.stringify({schema:"CAP19_SYNTHETIC_CALLBACK_OBSERVATIONS_V1",synthetic:true,scope:fixture.scope,pages:observations},null,2)+"\n");
const cli=execFileSync(process.execPath,[path.join(repo,"tooling/build/wb_sales_finance_offline.mjs"),obsPath,prefix],{encoding:"utf8"});
await test("offline command consumes actual observations and writes complete JSON CSV",async()=>{
 assert.deepEqual(JSON.parse(fs.readFileSync(prefix+".json","utf8")),actual);
 const csv=fs.readFileSync(prefix+".csv","utf8");assert.equal(csv.split("\r\n").length,12);
 assert.ok(csv.includes('"finishedPrice","retailAmount","forPay"'));assert.ok(csv.includes('"finance","105","1999"'));
 assert.ok(csv.includes('"sales","S-CAP19-1004"'));assert.ok(!csv.includes("undefined"));
});
await rejects("missing middle page",f=>{f.pages.splice(1,1);},"PAGE_CHAIN_MISMATCH");
await rejects("missing sales terminal",f=>{f.pages=f.pages.filter(p=>p.pageId!=="sales-3");},"TRANSPORT_INCOMPLETE");
await rejects("missing finance terminal",f=>{f.pages.pop();},"TRANSPORT_INCOMPLETE");
await rejects("finance empty200 is not204",f=>{const p=f.pages.at(-1);p.response.httpStatus=200;p.response.rawText="[]";},"FINANCE_EMPTY_200_NOT_TERMINAL");
await rejects("page after real terminus",f=>{const p=clone(f.pages[2]);p.pageId="sales-4";p.ordinal=4;f.pages.splice(3,0,p);},"PAGE_CHAIN_MISMATCH");
await rejects("exact byte length mismatch",()=>{},"RESPONSE_SIZE_LIMIT_OR_MISMATCH",v=>v[0].response.byteLength++);
await rejects("custody hash mismatch",()=>{},"PAGE_CHAIN_MISMATCH",v=>v[1].previousResponseSha256="0".repeat(64));
await rejects("scope store fencing",()=>{},"CONTEXT_FENCE_MISMATCH",v=>{v[0].scope=clone(v[0].scope);v[0].scope.storeId="OTHER";});
await rejects("scope work session fencing",()=>{},"CONTEXT_FENCE_MISMATCH",v=>{v[0].scope=clone(v[0].scope);v[0].scope.workSessionId="OTHER";});
await rejects("sales cursor mismatch",f=>{f.pages[1].command.params.query.dateFrom="2026-09-26T12:00:01";},"SALES_CURSOR_MISMATCH");
await rejects("finance cursor mismatch",f=>{f.pages[4].command.params.body.rrdId=104;},"FINANCE_CURSOR_OR_FIELDS_MISMATCH");
await rejects("finance selected currency absent",f=>{f.pages[3].command.params.body.fields=f.pages[3].command.params.body.fields.filter(k=>k!=="currency");},"FINANCE_CURSOR_OR_FIELDS_MISMATCH");
await rejects("foreign host",()=>{},"REQUEST_MISMATCH",v=>{v[0].request.url=v[0].request.url.replace("statistics-api.wildberries.ru","example.test");});
await rejects("finance request body binding",()=>{},"REQUEST_BODY_MISMATCH",v=>{v[3].request.body="{}";});
await rejects("content type",()=>{},"CONTENT_TYPE_MISMATCH",v=>{v[0].response.responseMeta.content_type="text/plain";});
await rejects("HTTP error cannot finish",f=>{f.pages[0].response.httpStatus=429;},"UNSUPPORTED_HTTP_RESPONSE");
await rejects("truncated JSON",f=>{f.pages[0].response.rawText=f.pages[0].response.rawText.slice(0,-1);},"INVALID_JSON");
await rejects("duplicate JSON field",f=>{f.pages[0].response.rawText=f.pages[0].response.rawText.replace('"nmId":1001','"nmId":1001,"nmId":1002');},"UNSAFE_OR_DUPLICATE_JSON_KEY");
await rejects("prototype field",f=>{f.pages[0].response.rawText=f.pages[0].response.rawText.replace('"nmId":1001','"__proto__":{},"nmId":1001');},"UNSAFE_OR_DUPLICATE_JSON_KEY");
await rejects("ID numeric string not coerced",f=>edit(f,"sales-1",0,r=>r.nmId="1001"),"INVALID_ID_WIRE_TYPE");
await rejects("fractional ID not truncated",f=>edit(f,"sales-1",0,r=>r.nmId=1001.5),"INVALID_ID_WIRE_TYPE");
await rejects("conflicting duplicate never overwrites",f=>edit(f,"sales-2",0,r=>r.forPay=1),"CONFLICTING_DUPLICATE");
await rejects("report currency conflict",f=>edit(f,"finance-1",0,r=>r.currency="RUB"),"REPORT_CURRENCY_CONFLICT");
await rejects("currency missing not defaulted",f=>edit(f,"finance-1",0,r=>delete r.currency),"INVALID_TEXT_FIELD");
await rejects("row report period mismatch",f=>edit(f,"finance-1",0,r=>r.dateFrom="2026-09-25T00:00:00+03:00"),"ROW_REPORT_PERIOD_MISMATCH");
await rejects("invalid calendar date",f=>edit(f,"sales-1",0,r=>r.date="2026-02-30T10:00:00"),"INVALID_DATETIME");
await rejects("money string exponent no hidden conversion",f=>edit(f,"finance-1",0,r=>r.forPay="1e2"),"INVALID_MONEY_LEXEME");
await rejects("operational numeric money type",f=>edit(f,"sales-1",0,r=>r.forPay="70.05"),"INVALID_MONEY_LEXEME");
await rejects("scope timezone offset contradiction",f=>{f.scope.businessPeriod.timezone="UTC";},"PERIOD_TIMEZONE_MISMATCH");
await rejects("no inferred operational currency",f=>{f.scope.sellerCurrency="RUB";},"OPERATIONAL_CURRENCY_PROVENANCE_NOT_SUPPORTED");
await rejects("no hidden extra scope",f=>{f.scope.credentials="DO_NOT_COPY";},"UNEXPECTED_SCOPE_FIELD");
await rejects("blank sale ID never becomes a usable event",f=>edit(f,"sales-1",0,r=>r.saleID="   "),"INVALID_TEXT_FIELD");
await rejects("blank srid never joins two absent order identities",f=>edit(f,"sales-1",0,r=>r.srid="   "),"INVALID_TEXT_FIELD");
await rejects("blank context ID rejected",f=>{f.scope.storeId="   ";},"INVALID_TEXT_FIELD");
await rejects("malformed request body produces only bounded code",()=>{},"REQUEST_BODY_MISMATCH",v=>{v[3].request.body='{"secret":"PRIVATE_UNSELECTED_CANARY';});
await test("same selected finance field set works in another order",async()=>{
 const r=await run(fresh(f=>{for(const p of f.pages)if(p.stream==="finance")p.command.params.body.fields.reverse();}));
 assert.deepEqual(r.financeTotals,baseline.financeTotals);assert.deepEqual(r.links,baseline.links);
});
await test("64 bit product IDs survive wire normalization and joins",async()=>{
 const f=fresh(f=>{for(const p of f.pages)p.response.rawText=p.response.rawText.replace(/"nmId":1001/g,'"nmId":9223372036854775807');});
 const r=await run(f);assert.equal(r.sales[0].nmId,"9223372036854775807");assert.equal(r.links[0].nmId,"9223372036854775807");assert.equal(r.finance[0].nmId,"9223372036854775807");
});
await test("report ID above JS safe range remains exact",async()=>{
 const r=await run(fresh(f=>{for(const p of f.pages)p.response.rawText=p.response.rawText.replace(/"reportId":901/g,'"reportId":9007199254740993');}));
 assert.equal(r.financeTotals[0].reportId,"9007199254740993");
});
await rejects("unrepresentable continuation cursor fails without rounding",f=>edit(f,"finance-2",2,r=>r.rrdId=9007199254740992),"CURSOR_UNREPRESENTABLE_BY_EXISTING_COMMAND");
await test("missing finance payout yields unknown sum not zero",async()=>{
 const r=await run(fresh(f=>edit(f,"finance-2",2,r=>delete r.forPay)));const t=r.financeTotals.find(r=>r.reportId==="902");
 assert.equal(t.forPaySourceSignedSum,null);assert.equal(t.missingForPay,1);assert.equal(r.finance.find(r=>r.rrdId==="104").forPay,"0.00");
});
await test("nonunique event does not multiply money or invent links",async()=>{
 const r=await run(fresh(f=>edit(f,"sales-1",0,(r,rows)=>{rows.splice(1,0,{...r,saleID:"SECOND_EVENT"});})));
 assert.equal(r.ambiguous.length,1);assert.equal(r.links.length,3);assert.equal(r.financeTotals.length,4);
 assert.equal(r.financeTotals[0].retailAmountSourceSignedSum,"100.10");
});
await test("unknown source fields never persist in projected result",async()=>{
 const r=await run(fresh(f=>edit(f,"sales-1",0,r=>{r.customerName="PRIVATE_UNSELECTED_CANARY";})));
 assert.ok(!JSON.stringify(r).includes("PRIVATE_UNSELECTED_CANARY"));assert.ok(!JSON.stringify(r).includes("customerName"));
});
await test("CSV spreadsheet formula escaping retains exact canonical ID in JSON",async()=>{
 const r=await run(fresh(f=>edit(f,"sales-1",0,r=>{r.saleID="=1+1";})));
 const report=api.renderReport(r);assert.equal(JSON.parse(report.json).sales[0].saleID,"=1+1");assert.ok(report.csv.includes('"' + "'=1+1" + '"'));
});
await test("finite lease expiration clears and rejects collection",async()=>{
 let clock=10;const c=await api.createCollection({scope:fixture.scope,now:()=>clock,ttlMs:50});clock=60;
 await assert.rejects(()=>c.observe(frames(fixture)[0]),e=>e.code==="COLLECTION_EXPIRED");
});
await test("clock rollback cannot prolong lease",async()=>{
 let clock=10;const c=await api.createCollection({scope:fixture.scope,now:()=>clock});clock=9;
 await assert.rejects(()=>c.observe(frames(fixture)[0]),e=>e.code==="COLLECTION_EXPIRED");
});
await test("invalidate in-flight hash prevents stale success",async()=>{
 const c=await api.createCollection({scope:fixture.scope});const pending=c.observe(frames(fixture)[0]);c.invalidate();
 await assert.rejects(()=>pending,e=>e.code==="COLLECTION_INVALIDATED");
});
await test("callback metadata snapshot survives mutation during asynchronous hash",async()=>{
 const c=await api.createCollection({scope:fixture.scope}),all=frames(fixture),frame=all[0];
 const expectedBytes=frame.response.byteLength;
 const pending=c.observe(frame);
 frame.response.byteLength=0;frame.command.query.dateFrom="CHANGED_AFTER_OBSERVATION";
 const receipt=await pending;assert.equal(receipt.bytes,expectedBytes);
 for(const other of all.slice(1))await c.observe(other);
 assert.deepEqual(clone(c.finish()),baseline);
});
await test("lease expiry while projection runs prevents observation success",async()=>{
 let enabled=false,count=0;
 const c=await api.createCollection({scope:fixture.scope,ttlMs:100,now:()=>enabled && ++count>3?1000:0});enabled=true;
 await assert.rejects(()=>c.observe(frames(fixture)[0]),e=>e.code==="COLLECTION_EXPIRED");
});
await test("lease expiry during final result construction prevents delivery",async()=>{
 let enabled=false,count=0;
 const c=await api.createCollection({scope:fixture.scope,ttlMs:100,now:()=>enabled && ++count>1?1000:0});
 for(const f of frames(fixture))await c.observe(f);enabled=true;
 assert.throws(()=>c.finish(),e=>e.code==="COLLECTION_EXPIRED");
});
await test("finished collection cannot replay",async()=>{
 const c=await api.createCollection({scope:fixture.scope});for(const f of frames(fixture))await c.observe(f);c.finish();
 assert.throws(()=>c.finish(),e=>e.code==="COLLECTION_CLOSED");
 await assert.rejects(()=>c.observe(frames(fixture)[0]),e=>e.code==="COLLECTION_CLOSED");
});
await test("invalid input poisons collection",async()=>{
 const c=await api.createCollection({scope:fixture.scope});const frame=frames(fixture)[0];frame.request.method="POST";
 await assert.rejects(()=>c.observe(frame),e=>e.code==="REQUEST_MISMATCH");
 await assert.rejects(()=>c.observe(frames(fixture)[0]),e=>e.code==="COLLECTION_INVALID");
});
await test("page size bounded before parsing",async()=>{
 const c=await api.createCollection({scope:fixture.scope});const frame=frames(fixture)[0];frame.response.rawText=" ".repeat(3000001);frame.response.byteLength=3000001;
 await assert.rejects(()=>c.observe(frame),e=>e.code==="RESPONSE_SIZE_LIMIT_OR_MISMATCH");
});
await test("depth bounded without native recursion overflow",async()=>{
 await assert.rejects(()=>run(fresh(f=>{f.pages[0].response.rawText="[".repeat(40)+"0"+"]".repeat(40);})),e=>e.code==="JSON_LIMIT");
});
for(const type of ["","text/plain","application/octet-stream"])await test("empty finance 204 has no JSON representation requirement: "+type,async()=>{
 const r=await run(fresh(),values=>{values.at(-1).response.responseMeta.content_type=type;});assert.deepEqual(r,baseline);
});
await rejects("nonempty finance 204 is not a terminal",f=>{f.pages.at(-1).response.rawText="[]";},"UNSUPPORTED_HTTP_RESPONSE");
await rejects("sales 204 is not a terminal",f=>{f.pages[2].response.httpStatus=204;f.pages[2].response.rawText="";},"UNSUPPORTED_HTTP_RESPONSE");
await rejects("finance 205 is not a terminal",f=>{f.pages.at(-1).response.httpStatus=205;},"UNSUPPORTED_HTTP_RESPONSE");
await test("application value veto precedes retained page/cursor state and poisons collection",async()=>{
 const c=await api.createCollection({scope:fixture.scope});let seen;
 await assert.rejects(()=>c.observe(frames(fixture)[0],{assertSafeValues:async projected=>{
  seen=clone(projected);throw Object.assign(new Error("CAP19_CREDENTIAL_ECHO"),{code:"CAP19_CREDENTIAL_ECHO"});
 }}),e=>e.code==="CAP19_CREDENTIAL_ECHO");
 assert.equal(seen[0].finishedPrice,"100.10");assert.equal(seen[0].saleID,"S-CAP19-1001");
 await assert.rejects(()=>c.observe(frames(fixture)[0]),e=>e.code==="COLLECTION_INVALID");
 assert.throws(()=>c.finish(),e=>e.code==="COLLECTION_INVALID");
});
await test("cancellation during awaited value safety prevents observation success",async()=>{
 const c=await api.createCollection({scope:fixture.scope});
 await assert.rejects(()=>c.observe(frames(fixture)[0],{assertSafeValues:async()=>c.invalidate()}),e=>e.code==="COLLECTION_INVALIDATED");
});

assert.equal(forbiddenNetworkCalls,0);
const result={status:"PASS_AUTONOMOUS_SYNTHETIC_COMPONENT_NOT_ACTIVATED_PRODUCT",at_UTC:new Date().toISOString(),base:"c5d0ad95397c376928da7462d7606993e32fbbd4",candidateCommit:null,candidateTree:null,
 source:{path:sourcePath,bytes:Buffer.byteLength(source),sha256:hash(source)},fixture:{bytes:fs.statSync(fixturePath).size,sha256:hash(fs.readFileSync(fixturePath))},
 exactAdapterSource:adapter.sha256,referenceAssemblyInputs:sourceIdentities,syntheticFetchCalls:fetchCalls,actualRawCallbacks:callbacks,externalNetworkCalls:forbiddenNetworkCalls,providerLiveCalls:0,DBCalls:0,
 cases,caseCount:cases.length,cli:JSON.parse(cli),outputFiles:[prefix+".json",prefix+".csv",obsPath,path.join(output,"independent-gold.json")].map(p=>({path:p,bytes:fs.statSync(p).size,sha256:hash(fs.readFileSync(p))})),
 limits:["Standalone offline module and explicit synthetic CLI only; no extension composition/runtime/shared contracts edited.","Actual exact saved WB adapter with pinned c5 reference modules, not a claim of a rebuilt or installed whole R5 package.","Source-signed report sums separated by operation/event period/currency; no final revenue/return-sign/FX inference.","No stable snapshot/business completeness/live API certification/independent review/installed acceptance."]};
fs.writeFileSync(path.join(output,"qualification-result.json"),JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify({status:result.status,cases:cases.length,rawCallbacks:callbacks,syntheticFetchCalls:fetchCalls,externalNetworkCalls:forbiddenNetworkCalls,output}));
