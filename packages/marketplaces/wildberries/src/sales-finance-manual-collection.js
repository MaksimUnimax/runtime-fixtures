(() => {
  "use strict";
  const TOKEN="WB_CAP19_V1", FORMAT="json-utf8-txt", LIMITS=Object.freeze({collections:2,workerInput:16000000,output:8000000,workerOutput:16000000,manifest:4096});
  const fail=code=>{throw Object.assign(new Error(code),{code,external_request_executed:false});};
  const clone=x=>JSON.parse(JSON.stringify(x));
  const canonical=x=>Array.isArray(x)?"["+x.map(canonical).join(",")+"]":x && typeof x==="object"?"{"+Object.keys(x).sort().map(k=>JSON.stringify(k)+":"+canonical(x[k])).join(",")+"}":JSON.stringify(x);
  const size=s=>new TextEncoder().encode(s).byteLength;
  const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text))),v=>v.toString(16).padStart(2,"0")).join("");
  const Model=()=>globalThis.SellerAgentsWBSalesFinance;
  const Contract=()=>globalThis.SellerAgentsWBReference.contract;
  function exactKeys(object,keys) {
    if(!object || typeof object!=="object" || Array.isArray(object) || Object.keys(object).length!==keys.length || keys.some(k=>!Object.hasOwn(object,k)))fail("CAP19_MANIFEST_FIELDS");
  }
  function stableScope(snapshot) {
    const result={};
    for(const key of ["accountId","storeId","marketplace","credentialRevision","conversationKey","bindingId","bindingRevision","workSessionId","policyRevision","authGeneration","scopeKey","principalEpoch","accessEpoch","grantEpoch","workGeneration","aiFamily"])
      if(snapshot[key]!==undefined)result[key]=snapshot[key];
    return result;
  }
  function jsonEnd(text,start,maxDepth=32) {
    if(text[start]!=="{")fail("CAP19_MANIFEST_JSON");
    const stack=[];let quoted=false,escaped=false;
    for(let i=start;i<text.length;i++){
      const c=text[i];
      if(quoted){if(escaped)escaped=false;else if(c==="\\")escaped=true;else if(c==='"')quoted=false;continue;}
      if(c==='"'){quoted=true;continue;}
      if(c==="{" || c==="["){stack.push(c);if(stack.length>maxDepth)fail("CAP19_MANIFEST_DEPTH");}
      if(c==="}" || c==="]"){if(stack.pop()!==(c==="}"?"{":"["))fail("CAP19_MANIFEST_JSON");if(!stack.length)return i+1;}
    }
    fail("CAP19_MANIFEST_JSON");
  }
  function objectFrameEnd(text,start) {
    // Same brace/quote extent as MixedDiscovery. This only quarantines an
    // unfinished owner; it never discovers prefixes or grants literal shelters.
    let depth=0,quoted=false,escaped=false;
    for(let i=start;i<text.length;i++){
      const c=text[i];
      if(quoted){if(escaped)escaped=false;else if(c==="\\")escaped=true;else if(c==='"')quoted=false;continue;}
      if(c==='"'){quoted=true;continue;}
      if(c==="{")depth++;
      else if(c==="}"){if(--depth===0)return i+1;if(depth<0)return -1;}
    }
    return -1;
  }
  function topLevelMetadata(text) {
    if(!text.includes("WB_CAP19"))return [];
    const discovery=globalThis.SellerAgentsMixedBatchDiscovery;
    if(typeof discovery?.discover!=="function")fail("CAP19_ENVELOPE_PROOF_UNAVAILABLE");
    // Obtain the same partition as actual ingress. These callbacks only measure
    // its frames: no command execution, help resolution or value normalization.
    const rows=discovery.discover(text,{
      commandPrefix:"WB_API_V1",helpPrefixV1:"WB_HELP_V1",helpPrefixV2:"WB_HELP_V2",
      apiDiscover:raw=>[{ok:true,marker_index:0,spanLength:raw.length}],
      parseHelp:raw=>({ok:true,spanLength:raw.length}),
    });
    const spans=[];let previousEnd=0,ambiguousEnd=0;
    for(const row of rows){
      const token=row.kind==="api"?"WB_API_V1":row.version===1?"WB_HELP_V1":"WB_HELP_V2";
      const width=(row.kind==="api"?row.discovery:row.help)?.spanLength;
      const start=row.marker_index,stop=start+width;
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(width)||width<token.length||
         start<previousEnd||stop>text.length||!text.startsWith(token,start)){
        fail("CAP19_ENVELOPE_PROOF_INVALID");
      }
      previousEnd=stop;
      if(start<ambiguousEnd)continue;
      let body=start+token.length;while(body<stop&&/[\s\u200B\u2060\u00AD]/u.test(text[body]))body++;
      if(text[body]!=="{")continue;
      const ownerEnd=objectFrameEnd(text,body);
      if(ownerEnd<0||ownerEnd>stop){ambiguousEnd=ownerEnd<0?text.length:ownerEnd;continue;}
      if(ownerEnd!==stop)continue;
      try{
        JSON.parse(text.slice(body,stop)); // syntax only; discard values, retain original raw bytes
        spans.push({start,end:stop});
      }catch{/* A complete malformed frame cannot revoke any independent span. */}
    }
    // Only actual independent, syntax-valid frames shelter literals. A complete
    // malformed neighbor is local; an unfinished object owns its ambiguous tail.
    const found=[];let spanIndex=0;
    for(let i=0;i<text.length;i++){
      while(spanIndex<spans.length&&spans[spanIndex].end<=i)spanIndex++;
      if(spans[spanIndex]?.start<=i){i=spans[spanIndex].end-1;continue;}
      if(text.startsWith("WB_CAP19",i)&&!/[\p{ID_Continue}$]/u.test(text[i-1]||"")){
        let end=i+8;while(end<text.length&&!/[\s{[]/u.test(text[end]))end++;
        found.push({index:i,depth:0,marker:text.slice(i,end)});i=end-1;
      }
    }
    return found;
  }
  function parseSelection(text,entries) {
    if(typeof text!=="string")fail("CAP19_BLOCK_INVALID");
    const found=topLevelMetadata(text);if(!found.length)return null;
    if(found.length!==1 || found[0].depth!==0 || text.slice(0,found[0].index).trim())fail("CAP19_MANIFEST_POSITION");
    if(found[0].marker!==TOKEN)fail("CAP19_MANIFEST_VERSION_UNSUPPORTED");
    let start=found[0].index+TOKEN.length;while(/\s/.test(text[start]||"\0"))start++;
    const end=jsonEnd(text,start),json=text.slice(start,end);
    if(size(text.slice(found[0].index,end))>LIMITS.manifest)fail("CAP19_MANIFEST_SIZE");
    const manifest=Model().parseControlJSON(json);
    if(/\bWB_(?:API|HELP|FILE|CAP19)_V\d\b/.test(JSON.stringify(manifest)))fail("CAP19_MANIFEST_MARKER_INJECTION");
    if(manifest?.action==="begin"){
      exactKeys(manifest,["action","businessPeriod","salesAcquisition","financePeriod","pages"]);
      exactKeys(manifest.businessPeriod,["fromInclusive","toExclusive","timezone"]);
      exactKeys(manifest.salesAcquisition,["updatedSince","flag"]);
      if(manifest.salesAcquisition.flag!==0 || !["daily","weekly"].includes(manifest.financePeriod))fail("CAP19_BEGIN_INVALID");
      for(const x of Object.values(manifest.businessPeriod))if(typeof x!=="string" || !x.trim() || x.length>128)fail("CAP19_PERIOD_INVALID");
      if(typeof manifest.salesAcquisition.updatedSince!=="string" || manifest.salesAcquisition.updatedSince.length>64)fail("CAP19_PERIOD_INVALID");
    }else if(manifest?.action==="continue"){
      exactKeys(manifest,["action","collectionId","pages"]);
      if(typeof manifest.collectionId!=="string" || !/^cap19-[a-f0-9-]{36}$/.test(manifest.collectionId))fail("CAP19_COLLECTION_ID");
    }else fail("CAP19_ACTION_INVALID");
    if(!Array.isArray(manifest.pages) || manifest.pages.length<1 || manifest.pages.length>32)fail("CAP19_PAGE_SELECTION_LIMIT");
    // Re-scan actual envelope spans. Metadata remains in the original approval text;
    // it is never replaced in blockVersion/commandHash/ledger verification.
    let cursor=end;const envelopes=[];
    while(cursor<text.length){
      while(/\s/.test(text[cursor]||"\0"))cursor++;
      if(cursor===text.length)break;
      const token=/^(WB_API_V1|WB_HELP_V1|WB_HELP_V2)(?![A-Za-z0-9_])/.exec(text.slice(cursor));
      if(!token)fail("CAP19_BLOCK_SYNTAX");
      const marker=cursor;cursor+=token[0].length;
      while(/\s/.test(text[cursor]||"\0"))cursor++;
      const stop=jsonEnd(text,cursor);
      envelopes.push({token:token[0],text:text.slice(marker,stop)});cursor=stop;
    }
    if(!Array.isArray(entries) || envelopes.length!==entries.length)fail("CAP19_ENTRY_SPANS_MISMATCH");
    for(let i=0;i<envelopes.length;i++){
      const envelope=envelopes[i],entry=entries[i];
      if(envelope.token==="WB_API_V1"){
        const parsed=Contract().parseCommand(envelope.text);
        if(entry.kind!=="command" || Contract().commandFingerprint(parsed)!==entry.command_fingerprint)fail("CAP19_ENTRY_FINGERPRINT");
      }else if(entry.kind!=="guidance")fail("CAP19_ENTRY_SPANS_MISMATCH");
    }
    const selected=new Set();
    for(const page of manifest.pages){
      exactKeys(page,["entryOrdinal","stream","ordinal"]);
      if(!Number.isSafeInteger(page.entryOrdinal) || page.entryOrdinal<0 || page.entryOrdinal>=entries.length || selected.has(page.entryOrdinal) ||
         !["sales","finance"].includes(page.stream) || !Number.isSafeInteger(page.ordinal) || page.ordinal<1 || page.ordinal>32)fail("CAP19_PAGE_SELECTION");
      selected.add(page.entryOrdinal);
      const entry=entries[page.entryOrdinal];
      if(entry?.kind!=="command" || entry.operation!==(page.stream==="sales"?"statistics_sales":"finance_sales_detail_period"))fail("CAP19_PAGE_OPERATION");
    }
    return Object.freeze({version:1,manifest:clone(manifest),fingerprints:manifest.pages.map(p=>({entryOrdinal:p.entryOrdinal,fingerprint:entries[p.entryOrdinal].command_fingerprint}))});
  }
  function createCoordinator({now=()=>Date.now(),monotonic=()=>performance.now(),uuid=()=>crypto.randomUUID(),fetchImpl=(url,init)=>fetch(url,init)}={}) {
    const collections=new Map();let inputBytes=0,outputBytes=0;
    const workerEpoch=crypto.randomUUID(),cancellations=[];let cancellationSerial=0,overflowSerial=0;
    function erase(c,code) {
      if(!c)return;
      c.invalid=code;c.status="INCOMPLETE";c.model?.invalidate();
      inputBytes-=c.inputBytes;c.inputBytes=0;outputBytes-=c.outputBytes;c.outputBytes=0;
      c.finished=null;c.block=null;
    }
    function alive(c) {
      if(globalThis.SellerAgentsWBCAP19CancellationFault) {if(c)erase(c,"CAP19_CANCELLATION_FAULT");fail("CAP19_CANCELLATION_FAULT");}
      if(!c || c.invalid)fail(c?.invalid || "CAP19_COLLECTION_INCOMPLETE");
      const t=monotonic(),calendar=now();
      if(!Number.isFinite(t) || t<c.lastMono || t-c.startedMono>=300000 || !Number.isFinite(calendar) || calendar>=c.deadline || calendar<c.startedAt) {
        erase(c,"CAP19_COLLECTION_EXPIRED");fail("CAP19_COLLECTION_EXPIRED");
      }
      c.lastMono=t;return c;
    }
    function clean() {
      for(const [id,c] of collections) {
        try{alive(c);}catch{collections.delete(id);}
      }
    }
    function contextMatches(c,snapshot) {
      if(c.stableJSON!==canonical(stableScope(snapshot))){erase(c,"CAP19_CONTEXT_CHANGED");fail("CAP19_CONTEXT_CHANGED");}
    }
    function currentBlock(c,owner,context) {
      alive(c);contextMatches(c,context.snapshot);
      const b=c.block;
      if(!b || owner?.operation_id!==b.ownerId || owner.cap19_collection?.collectionId!==c.id ||
        owner.r3_execution_id!==b.executionId || owner.r3_block_version!==b.blockVersion ||
        owner.execution_context?.commandHash!==b.commandHash || owner.execution_context?.requestId!==b.requestId)fail("CAP19_BLOCK_CHANGED");
      return b;
    }
    async function check(c,assertCurrent) {alive(c);await assertCurrent();alive(c);}
    function selectedCommand(c,page,command) {
      if(command.operation!==(page.stream==="sales"?"statistics_sales":"finance_sales_detail_period"))fail("CAP19_PAGE_OPERATION");
      const state=c.streams[page.stream];
      if(state.terminal || page.ordinal!==state.ordinal+1)fail("CAP19_PAGE_SEQUENCE");
      if(page.stream==="sales"){
        if(command.query?.dateFrom!==state.cursor || command.query?.flag!==0)fail("CAP19_SALES_CURSOR");
      }else{
        const body=command.body;
        if(!body || !Number.isSafeInteger(body.rrdId) || String(body.rrdId)!==state.cursor)fail("CAP19_FINANCE_CURSOR");
        for(const key of ["dateFrom","dateTo","period"])if(body[key]!==c.scope.financeAcquisition[key])fail("CAP19_FINANCE_PERIOD");
        if(!Array.isArray(body.fields) || canonical([...body.fields].sort())!==canonical([...Model().financeFields].sort()))fail("CAP19_FINANCE_FIELDS");
      }
    }
    async function bindApprovedOwner({owner,selection,prepared,context}) {
      const startedAt=now(),startedMono=monotonic();clean();
      if(!selection || selection.version!==1 || !context?.snapshot || typeof context.assertCurrent!=="function" ||
         !owner?.operation_id || !owner.r3_execution_id || !prepared || owner.r3_execution_id!==prepared.executionId ||
         !owner.r3_block_version || owner.r3_block_version!==prepared.blockVersion || owner.r3_block_origin_key!==prepared.blockOriginKey || context.snapshot.marketplace!=="wildberries" ||
         canonical(owner.execution_context)!==canonical(context.snapshot))fail("CAP19_APPROVED_SOURCE_REQUIRED");
      const manifest=selection.manifest,stable=stableScope(context.snapshot),conversation=canonical([stable.accountId,stable.conversationKey]);
      let c;
      if(manifest.action==="begin"){
        for(const existing of collections.values())if(existing.conversation===conversation){
          if(existing.stableJSON===canonical(stable) && existing.status!=="PUBLISHED" && !(prepared.recovery===true && existing.chain.length===0))fail("CAP19_COLLECTION_ALREADY_ACTIVE");
          erase(existing,"CAP19_NEW_EXPLICIT_BEGIN");collections.delete(existing.id);
        }
        if(collections.size>=LIMITS.collections)fail("CAP19_COLLECTION_CAPACITY");
        const p=manifest.businessPeriod;
        const scope={marketplace:"wildberries",accountId:stable.accountId,storeId:stable.storeId,bindingId:stable.bindingId,
          bindingRevision:stable.bindingRevision,workSessionId:stable.workSessionId,businessPeriod:clone(p),
          salesAcquisition:{updatedSince:manifest.salesAcquisition.updatedSince,flag:0,serverUpperBoundParameter:null,capturedAt:new Date(startedAt).toISOString()},
          financeAcquisition:{dateFrom:p.fromInclusive,dateTo:p.toExclusive,period:manifest.financePeriod,dateToInclusivity:"NOT_FORMALLY_ESTABLISHED_BY_PINNED_SDK"},
          sellerCurrency:null,sellerCurrencyProvenance:"NOT_SUPPLIED_DO_NOT_INFER",snapshotConsistency:"NO_ATOMIC_SNAPSHOT_TOKEN_PROVED"};
        c={id:"cap19-"+uuid(),initialOwnerId:owner.operation_id,scope,stableJSON:canonical(stable),conversation,storeId:stable.storeId,tabs:new Set([owner.tab_id]),startedAt,startedMono,lastMono:startedMono,
          deadline:startedAt+300000,cancellationSerial,inputBytes:0,outputBytes:0,finished:null,invalid:null,status:"COLLECTING",chain:[],
          streams:{sales:{ordinal:0,cursor:scope.salesAcquisition.updatedSince,pageId:null,sha256:null,terminal:false},
            finance:{ordinal:0,cursor:"0",pageId:null,sha256:null,terminal:false}}};
        collections.set(c.id,c);c.status="INITIALIZING";
        try{
          await check(c,context.assertCurrent);
          c.scopeHash=await hash(JSON.stringify(scope));await check(c,context.assertCurrent);
          c.stableHash=await hash(c.stableJSON);await check(c,context.assertCurrent);
          c.model=await Model().createCollection({scope,now,ttlMs:Math.max(1,Math.floor(c.deadline-now()))});
          await check(c,context.assertCurrent);
        }catch(error){erase(c,error.code||"CAP19_INIT_FAILED");collections.delete(c.id);throw error;}
      }else{
        c=collections.get(manifest.collectionId);alive(c);contextMatches(c,context.snapshot);await check(c,context.assertCurrent);
        if(c.status!=="COLLECTING")fail("CAP19_COLLECTION_NOT_COLLECTING");
      }
      try{
        const entries=owner.batch?.entries;
        if(!Array.isArray(entries))fail("CAP19_OWNER_ENTRIES");
        const selected=[];
        const simulated=clone(c.streams);
        for(const page of manifest.pages) {
          const found=entries.map((entry,index)=>({entry,index,original:entry.r3_original_ordinal??index})).filter(x=>x.original===page.entryOrdinal);
          // A recovery never replays a page already observed/unknown. Unselected filtered
          // ordinals do not silently become a different entry in this block.
          if(found.length===0 && prepared.recovery===true && c.chain.some(p=>p.stream===page.stream && p.ordinal===page.ordinal && p.entryOrdinal===page.entryOrdinal && p.blockVersion===owner.r3_block_version && p.commandFingerprint===selection.fingerprints.find(x=>x.entryOrdinal===page.entryOrdinal)?.fingerprint))continue;
          if(found.length!==1 || found[0].entry.kind!=="command")fail("CAP19_RECOVERY_PAGE_SELECTION");
          const {entry,index}=found[0];
          const expected=simulated[page.stream];
          if(page.ordinal!==expected.ordinal+1 || expected.terminal)fail("CAP19_PAGE_SEQUENCE");
          if(!selected.some(x=>x.stream===page.stream))selectedCommand(c,page,entry.command);
          else {
            if(entry.command.operation!==(page.stream==="sales"?"statistics_sales":"finance_sales_detail_period"))fail("CAP19_PAGE_OPERATION");
            if(page.stream==="finance")for(const key of ["dateFrom","dateTo","period"])if(entry.command.body?.[key]!==c.scope.financeAcquisition[key])fail("CAP19_FINANCE_PERIOD");
          }
          expected.ordinal=page.ordinal;
          selected.push({...page,index,fingerprint:entry.command_fingerprint});
        }
        c.block={ownerId:owner.operation_id,executionId:owner.r3_execution_id,blockVersion:owner.r3_block_version,
          commandHash:context.snapshot.commandHash,requestId:context.snapshot.requestId,pages:selected,assertCurrent:context.assertCurrent};
        c.tabs.add(owner.tab_id);alive(c);c.status="COLLECTING";collections.set(c.id,c);
        return {version:1,collectionId:c.id,deadline:c.deadline,scope_sha256:c.stableHash,worker_epoch:workerEpoch,cancellation_serial:c.cancellationSerial,
          blockVersion:c.block.blockVersion,executionId:c.block.executionId,pages:clone(selected)};
      }catch(error){erase(c,error.code||"CAP19_BIND_FAILED");throw error;}
    }
    function providerForApprovedOwner({owner,options,context,assertSafeValues}) {
      if(!owner?.cap19_selection)return globalThis.SellerAgentsWBAdapter.createProvider({fetchImpl});
      if(typeof assertSafeValues!=="function")fail("CAP19_VALUE_SAFETY_REQUIRED");
      return Object.freeze({async execute(text,opts) {
        let c,entry,page,attempt,dispatched=false,observed=false,collectionFailure=null;
        try{
          const live=await options.getOwner();
          c=collections.get(live?.cap19_collection?.collectionId);
          const block=currentBlock(c,live,context);await check(c,context.assertCurrent);
          const index=Number(live.batch?.next_index),active=live.batch?.entries?.[index];
          entry=active;page=block.pages.find(p=>p.index===index);
          if(!page)return await globalThis.SellerAgentsWBAdapter.createProvider({fetchImpl}).execute(text,opts);
          if(active?.status!=="requesting" || active.command_text!==text || active.command_fingerprint!==page.fingerprint ||
             !active.provider_attempt_id || active.provider_attempt?.provider_attempt_id!==active.provider_attempt_id ||
             Contract().commandFingerprint(opts.executionCommand)!==page.fingerprint)fail("CAP19_ATTEMPT_BINDING");
          attempt=active.provider_attempt_id;selectedCommand(c,page,opts.executionCommand);
          const provider=globalThis.SellerAgentsWBAdapter.createProvider({
            // Exactly the existing adapter's one guarded fetch; no extra request.
            fetchImpl:(...args)=>{dispatched=true;return fetchImpl(...args);}
          });
          const result=await provider.execute(text,{...opts,onProviderResponse:async event=>{
            if(typeof opts.onProviderResponse==="function")await opts.onProviderResponse(event);
            observed=true;
            try{
              await check(c,context.assertCurrent);
              const fresh=await options.getOwner();currentBlock(c,fresh,context);
              const current=fresh.batch?.entries?.[index];
              if(current?.provider_attempt_id!==attempt || current.status!=="requesting" ||
                 Contract().commandFingerprint(event.command)!==page.fingerprint)fail("CAP19_ATTEMPT_CHANGED");
              selectedCommand(c,page,event.command);
              const bytes=event.response?.byteLength;
              if(!Number.isSafeInteger(bytes) || bytes<0 || inputBytes+bytes>LIMITS.workerInput)fail("CAP19_WORKER_INPUT_LIMIT");
              inputBytes+=bytes;c.inputBytes+=bytes;
              const state=c.streams[page.stream],pageId=c.id+":"+page.stream+":"+page.ordinal;
              const receipt=await c.model.observe({scope:c.scope,scopeSha256:c.scopeHash,stream:page.stream,pageId,ordinal:page.ordinal,
                previousPageId:state.pageId,previousResponseSha256:state.sha256,command:event.command,
                request:{method:event.request.method,url:event.request.url,body:event.request.body},
                response:{rawText:event.response.rawText,httpStatus:event.response.httpStatus,byteLength:bytes,
                  responseMeta:{content_type:event.response.responseMeta?.content_type}}},{assertSafeValues:value=>assertSafeValues(fresh,value)});
              await check(c,context.assertCurrent);
              state.ordinal=page.ordinal;state.cursor=receipt.nextCursor;state.pageId=pageId;state.sha256=receipt.sha256;state.terminal=receipt.terminal;
              c.chain.push({ownerId:live.operation_id,entryOrdinal:active.r3_original_ordinal??index,providerAttemptId:attempt,
                commandFingerprint:page.fingerprint,blockVersion:live.r3_block_version,stream:page.stream,ordinal:page.ordinal,rawResponseSha256:receipt.sha256});
            }catch(error){collectionFailure=error.code||"CAP19_OBSERVATION_FAILED";erase(c,collectionFailure);}
          }});
          if(collectionFailure)return {...result,stop_after_result:"CAP19_COLLECTION_FAILED_NO_RETRY"};
          await check(c,context.assertCurrent);
          return result;
        }catch(error){
          if(c && (dispatched || observed))erase(c,error.code||"CAP19_PROVIDER_OUTCOME_UNKNOWN_NO_RETRY");
          if(dispatched || observed)throw Object.assign(error,{external_request_executed:true});
          return globalThis.SellerAgentsWBAdapter.localError(error,entry?.operation||null,false);
        }
      }});
    }
    function progressForOwner(owner) {
      const id=owner?.cap19_collection?.collectionId;
      if(!id)return null;
      const c=collections.get(id);
      try{alive(c);}catch(error){return {collectionId:id,state:"INCOMPLETE",reason:error.code,automatic_retry:false};}
      return {collectionId:id,state:c.status,reason:c.invalid||null,deadline:c.deadline,
        transportComplete:c.streams.sales.terminal && c.streams.finance.terminal,
        streams:clone(c.streams),businessCoverageProved:false,automatic_retry:false};
    }
    function admitPublication(owner,descriptor) {
      const c=collections.get(descriptor.collection_id);alive(c);
      if(c.block?.ownerId!==owner.operation_id || descriptor.scope_sha256!==c.stableHash || descriptor.owner_operation_id!==owner.operation_id ||
         descriptor.expires_at_ms>c.deadline || descriptor.expires_at_ms>owner.payload_expires_at_ms)fail("CAP19_PUBLICATION_CONTEXT");
      return true;
    }
    async function completeForDelivery(owner,{assertCurrent,assertSafeValues,store,read,recordIntent}) {
      if(!owner?.cap19_selection)return {refs:[],progress:null};
      if(typeof assertSafeValues!=="function")fail("CAP19_VALUE_SAFETY_REQUIRED");
      if(owner.cap19_artifact_intent){
        await assertCurrent();
        const stored=await read(owner.cap19_artifact_intent,{assertCurrent});
        await assertCurrent();
        if(!stored)fail("CAP19_ARTIFACT_STORE_UNKNOWN_NO_RETRY");
        const pending=collections.get(stored.collection_id);
        if(pending){alive(pending);pending.status="PUBLISHED";outputBytes-=pending.outputBytes;pending.outputBytes=0;pending.finished=null;inputBytes-=pending.inputBytes;pending.inputBytes=0;}
        return {refs:[stored],progress:{collectionId:stored.collection_id,state:"FILE_PREPARED",delivered:false}};
      }
      const c=collections.get(owner.cap19_collection?.collectionId);
      if(!c) return {refs:[],progress:progressForOwner(owner)};
      alive(c);
      await check(c,assertCurrent);
      if(!c.streams.sales.terminal || !c.streams.finance.terminal)return {refs:[],progress:progressForOwner(owner)};
      if(c.status!=="COLLECTING")fail("CAP19_FINISH_REUSE");
      const result=c.model.finish();alive(c);
      try { await assertSafeValues(result); await check(c,assertCurrent); }
      catch(error) { erase(c,error.code||"CAP19_VALUE_SAFETY_FAILED"); throw error; }
      const json=Model().renderReport(result,{includeCSV:false}).json;alive(c);
      const length=size(json);
      if(length>LIMITS.output || outputBytes+length>LIMITS.workerOutput){erase(c,"CAP19_OUTPUT_LIMIT");fail("CAP19_OUTPUT_LIMIT");}
      outputBytes+=length;c.outputBytes=length;c.finished=json;c.status="FINISHED";
      const resultHash=await hash(json);await check(c,assertCurrent);
      const chainHash=await hash(canonical(c.chain));await check(c,assertCurrent);
      const identity=await hash(canonical(["cap19-derived-v1",c.id,c.stableHash,chainHash,resultHash,FORMAT]));await check(c,assertCurrent);
      const expires=Math.min(c.deadline,owner.payload_expires_at_ms,now()+3600000);
      const descriptor={artifact_key:"derived:cap19:"+identity,source_kind:"derived_business_report",filename:"wb-sales-finance-"+identity+".txt",
        mime_type:"text/plain;charset=utf-8",extension:"txt",serialization:"json",serialization_version:1,identity_version:1,
        collection_id:c.id,owner_operation_id:owner.operation_id,scope_sha256:c.stableHash,chain_sha256:chainHash,result_sha256:resultHash,
        byte_length:length,sha256:resultHash,complete:true,expires_at_ms:expires};
      try { await assertSafeValues(descriptor); await check(c,assertCurrent); }
      catch(error) { erase(c,error.code||"CAP19_VALUE_SAFETY_FAILED"); throw error; }
      await recordIntent(descriptor);await check(c,assertCurrent);
      // Intent precedes this one store. A later uncertain invocation only reads it.
      c.status="STORE_INTENT";
      try{
        const saved=await store({...descriptor,bytes:new TextEncoder().encode(json)},{assertCurrent,admit:()=>admitPublication(owner,descriptor)});
        await check(c,assertCurrent);c.status="PUBLISHED";
        outputBytes-=c.outputBytes;c.outputBytes=0;c.finished=null;
        inputBytes-=c.inputBytes;c.inputBytes=0;
        return {refs:[saved],progress:{collectionId:c.id,state:"FILE_PREPARED",delivered:false}};
      }catch(error){c.status="STORE_UNKNOWN";throw error;}
    }
    const effects=new Set();
    function rememberCancellation(type,key) {
      if(!Number.isSafeInteger(++cancellationSerial)) {globalThis.SellerAgentsWBCAP19CancellationFault=true;fail("CAP19_CANCELLATION_FAULT");}
      cancellations.push({type,key,serial:cancellationSerial});
      if(cancellations.length>64)overflowSerial=cancellations.shift().serial;
    }
    function cancelledOwner(owner) {
      const binding=owner.cap19_collection,threshold=binding?.worker_epoch===workerEpoch?binding.cancellation_serial:0;
      if(!Number.isSafeInteger(threshold) || overflowSerial>threshold)return true;
      return cancellations.some(x=>x.serial>threshold &&
        (x.type==="tab" && x.key===owner.tab_id ||
         x.type==="conversation" && x.key===owner.execution_context?.conversationKey ||
         x.type==="store" && x.key===owner.execution_context?.storeId));
    }
    function beginEffect(owner,descriptor) {
      if(globalThis.SellerAgentsWBCAP19CancellationFault)fail("CAP19_CANCELLATION_FAULT");
      for(const lease of effects)if(lease.cancelled || now()>=lease.deadline)effects.delete(lease);
      if(effects.size>=32)fail("CAP19_EFFECT_CAPACITY");
      const context=owner?.execution_context;
      if(!context || cancelledOwner(owner) || owner.operation_id!==descriptor.owner_operation_id || owner.cap19_artifact_intent?.artifact_key!==descriptor.artifact_key ||
         owner.cap19_artifact_intent?.sha256!==descriptor.sha256)fail("CAP19_DERIVED_OWNER");
      const c=collections.get(descriptor.collection_id);
      if(c)alive(c);
      const lease={tab:owner.tab_id,key:context.conversationKey,store:context.storeId,
        deadline:Math.min(descriptor.expires_at_ms,owner.payload_expires_at_ms),startedAt:now(),lastMono:monotonic(),
        monotonicDeadline:c?c.startedMono+300000:monotonic()+Math.min(descriptor.expires_at_ms-now(),300000),cancelled:false};
      effects.add(lease);admitEffect(lease);return lease;
    }
    function admitEffect(lease) {
      const m=monotonic(),calendar=now();
      if(globalThis.SellerAgentsWBCAP19CancellationFault || !effects.has(lease) || lease.cancelled ||
         !Number.isFinite(m) || m<lease.lastMono || m>=lease.monotonicDeadline || !Number.isFinite(calendar) || calendar<lease.startedAt || calendar>=lease.deadline)fail("CAP19_EFFECT_STALE");
      lease.lastMono=m;return true;
    }
    function endEffect(lease){effects.delete(lease);}
    function invalidateForOwner(id){for(const c of collections.values())if(c.block?.ownerId===id || c.initialOwnerId===id)erase(c,"CAP19_ADMISSION_FAILED");}
    function invalidateForTab(tabId,conversationKey=null) {
      const tab=Number(tabId),key=conversationKey?String(conversationKey).trim().toLowerCase():null;
      rememberCancellation("tab",tab);if(key)rememberCancellation("conversation",key);
      for(const lease of effects)if(lease.tab===tab || key && lease.key===key)lease.cancelled=true;
      for(const c of collections.values())if(c.tabs.has(tab) || key && JSON.parse(c.stableJSON).conversationKey===key)erase(c,"CAP19_CANCELLED");
    }
    function invalidateForStore(storeId) {rememberCancellation("store",storeId);for(const lease of effects)if(lease.store===storeId)lease.cancelled=true;for(const c of collections.values())if(c.storeId===storeId)erase(c,"CAP19_STORE_INVALIDATED");}
    return Object.freeze({parseSelection,bindApprovedOwner,providerForApprovedOwner,progressForOwner,completeForDelivery,admitPublication,
      invalidateForOwner,invalidateForTab,invalidateForStore,beginEffect,admitEffect,endEffect,stableScope,canonical,hash,limits:LIMITS});
  }
  const coordinator=createCoordinator();
  globalThis.SellerAgentsWBSalesFinanceManual=Object.freeze({createCoordinator,...coordinator});
})();
