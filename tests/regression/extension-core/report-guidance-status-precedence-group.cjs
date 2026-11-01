// Synthetic consumer qualification only. No source edit, browser, provider or DB call.
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const startedAt = new Date().toISOString();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const marker = 'OZON_LLM_INSTRUCTIONS_V1\n';
const code = 'REPORT_SYNTHETIC_CONSUMER_1001';
const ref = 'rpf_s_SYNTHETIC_CONSUMER_INERT';
const generatedRef = 'rpf_s_SYNTHETIC_GENERATED_INERT';
const entry = (operation, body, http_status = 200) => ({
  operation, http_status, status: 'complete',
  report_text: 'OZON_RESULT_V1\n' + JSON.stringify({operation, http_status, result: {result: body}}),
});
const fixtures = [];
const add = (id, entries, expected) => fixtures.push({id, entries, expected});
const expected = (operation, state, next = null, params = null) => ({operation, state, next, params});
const creates = ['report_products_create', 'report_returns_create_v2', 'report_postings_create', 'report_discounted_create', 'report_placement_by_products_create', 'report_placement_by_supplies_create', 'report_marked_products_sales_create', 'report_realization_posting_create'];
for (const op of creates) {
  add(op + ':created', [entry(op, {code})], [expected(op, 'created', 'report_info', {code})]);
  add(op + ':missing-code', [entry(op, {})], [expected(op, 'blocked_missing_fresh_code')]);
}
for (const status of ['processing', 'unknown_phase', '']) {
  add('report_info:' + (status || 'no-status'), [entry('report_info', {status, code, report_file_ref: ref})], [expected('report_info', status === 'unknown_phase' ? 'pending_unclassified_status' : 'pending', 'report_info', {code})]);
}
for (const status of ['failed', 'cancelled', 'rejected']) {
  add('report_info:' + status + ':stale-ref', [entry('report_info', {status, code, report_file_ref: ref})], [expected('report_info', 'failed')]);
}
add('report_info:ready', [entry('report_info', {status:'success', code, report_file_ref:ref})], [expected('report_info', 'file_ready', 'report_file_get', {file_ref:ref, offset:0, limit:200})]);
add('report_info:ready-two-ref-types', [entry('report_info', {status:'success', code, report_file_ref:ref, generated_file_ref:generatedRef})], [expected('report_info', 'file_ready', 'report_file_get', {file_ref:ref, offset:0, limit:200})]);
for (const [name, body] of [['no-ref', {}], ['raw-url', {file:'https://example.invalid/inert.xlsx'}], ['raw-url-in-ref', {report_file_ref:'https://example.invalid/inert.xlsx'}], ['generated-only', {generated_file_ref:generatedRef}]]) {
  add('report_info:ready:' + name, [entry('report_info', {status:'success', code, ...body})], [expected('report_info', 'blocked_missing_fresh_file_ref')]);
}
add('report_info:pending-missing-code', [entry('report_info', {status:'processing', report_file_ref:ref})], [expected('report_info', 'blocked_missing_fresh_code')]);
add('report_info:http-error', [entry('report_info', {status:'success', code, report_file_ref:ref}, 503)], []);
const generated = [
 ['cargoes_label_create','cargoes_label_get',{operation_id:'INERT_OPERATION'}],
 ['cargoes_transport_label_by_order_create','cargoes_label_transport_by_order_status',{operation_id:'INERT_OPERATION'}],
 ['cargoes_transport_label_create','cargoes_label_transport_status',{operation_id:'INERT_OPERATION'}],
 ['posting_fbs_package_label_create','posting_fbs_package_label_get_v1',{task_id:'INERT_TASK'}],
 ['fbp_act_from_create','fbp_act_from_get',{file_uuid:'INERT_UUID'}],
 ['fbp_act_to_create','fbp_act_to_get',{code:'INERT_CODE',supply_id:'INERT_SUPPLY'}],
 ['fbp_label_create','fbp_label_get',{code:'INERT_CODE',supply_id:'INERT_SUPPLY'}],
];
for (const [create, resolve, params] of generated) {
  add(create + ':created', [entry(create, params)], [expected(create, 'created', resolve, params)]);
  add(create + ':missing-dependency', [entry(create, {})], [expected(create, 'blocked_missing_fresh_dependencies')]);
  add(resolve + ':pending', [entry(resolve, {status:'processing', ...params})], [expected(resolve, 'pending', resolve, params)]);
  add(resolve + ':ready', [entry(resolve, {status:'success', ...params, generated_file_ref:generatedRef})], [expected(resolve, 'file_ready', 'report_file_get', {file_ref:generatedRef, offset:0, limit:200})]);
  add(resolve + ':failed-stale-ref', [entry(resolve, {status:'failed', ...params, generated_file_ref:generatedRef})], [expected(resolve, 'failed')]);
}
add('report_file_get:downloaded', [entry('report_file_get', {format:'xlsx', sheet:{}})], [expected('report_file_get','file_downloaded')]);
add('seller_info:command-contract', [entry('seller_info', {synthetic:true})], []);
add('mixed:created-ready-failed', [entry('report_products_create',{code}),entry('report_info',{status:'success',code,report_file_ref:ref}),entry('report_info',{status:'failed',code,report_file_ref:ref})], [expected('report_products_create','created','report_info',{code}),expected('report_info','file_ready','report_file_get',{file_ref:ref,offset:0,limit:200}),expected('report_info','failed')]);
function extract(source, name) {
  const re = new RegExp('^(?:async )?function ' + name + '\\s*\\(', 'm');
  const found = re.exec(source); assert.ok(found, name + ' exists');
  const end = source.indexOf('\n}', found.index); assert.ok(end > found.index, name + ' complete');
  const text = source.slice(found.index, end + 2);
  new vm.Script(text, {filename:name});
  return text;
}
function inspectPayload(text, exp) {
  const issues = [];
  const at = text.lastIndexOf(marker);
  if (at < 0) return ['MISSING_INSTRUCTION_TAIL'];
  if (text.split(marker).length !== 2) issues.push('TAIL_NOT_UNIQUE');
  let p; try { p = JSON.parse(text.slice(at + marker.length)); } catch { return ['INVALID_INSTRUCTION_JSON']; }
  if (p.command_output?.command_form !== 'single_text_code_block' || p.command_output?.max_command_forms_per_response !== 1 || p.command_output?.dependent_envelopes !== 'next_turn_only' || p.command_output?.use_exact_next_command_when_present !== true) issues.push('COMMAND_OUTPUT_CONTRACT');
  const rows = p.workflow_continuations;
  if (!Array.isArray(rows) || rows.length !== exp.length) issues.push('CONTINUATION_COUNT');
  for (let i=0; i<exp.length; i++) {
    const actual=rows?.[i], want=exp[i];
    if (actual?.source_operation !== want.operation || actual?.state !== want.state || (actual?.next_command?.operation ?? null) !== want.next || actual?.automatic_continuation !== false) issues.push('CONTINUATION_SEMANTICS:' + want.operation);
    if (want.params && JSON.stringify(actual?.next_command?.params) !== JSON.stringify(want.params)) issues.push('EXACT_NEXT_PARAMS:' + want.operation);
    if (actual?.next_command?.operation === 'report_file_get' && Object.hasOwn(actual.next_command.params || {},'report_file_ref')) issues.push('WRONG_REPORT_FILE_GET_PARAMETER');
  }
  return issues;
}
// Additional whole status-precedence boundary: no repeated baseline cases.
fixtures.length = 0;
for (const [, resolve, params] of generated) {
  for (const status of ['processing', 'unknown_phase', 'cancelled', 'failed', 'success']) {
    for (const representation of ['ref', 'inline']) {
      if (status === 'failed' && representation === 'ref') continue;
      if (status === 'success' && representation === 'ref') continue;
      const body = {status, ...params, ...(representation === 'ref' ? {generated_file_ref:generatedRef} : {generated_file_inline:true})};
      const terminal = ['cancelled', 'failed'].includes(status);
      const state = terminal ? 'failed' : status === 'success' ? 'file_downloaded' : 'pending';
      add(resolve + ':' + status + ':' + representation, [entry(resolve, body)], [expected(resolve, state, state === 'pending' ? resolve : null, state === 'pending' ? params : null)]);
    }
  }
}
async function main() {
  const rows=[], inputs=[], extraction=[], safety=[];
  let externalCalls=0;
  for (const artifact of input.artifacts) {
    for(const [path,text] of Object.entries(artifact.files)) inputs.push({artifact:artifact.name,path,bytes:Buffer.byteLength(text),sha256:hash(text)});
    const sw=artifact.files['service_worker.js'], app=artifact.files['shared/application.js'];
    const selected={};
    for(const name of ['finalizeManualBatch','applyPrefixToReport','formatCombinedBatchReport']) selected[name]=extract(sw,name);
    for(const name of ['saCombinedReport','saPrepareDelivery']) selected[name]=extract(app,name);
    for(const [name,text] of Object.entries(selected)) extraction.push({artifact:artifact.name,name,sha256:hash(text),bytes:Buffer.byteLength(text)});
    for(const enabled of [true,false]) {
      let current,delivered=[],contextCalls=0,rejectAt=0,diagnostics=[];
      const context={crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000001'},TextEncoder,URL,structuredClone,
        fetch:()=>{externalCalls++;throw Error('EXTERNAL_CALL_FORBIDDEN');},
        saEnabled:async()=>enabled,
        normalizeConversationKey:x=>x,
        assertManualBatchContext:async()=>{contextCalls++;if(contextCalls===rejectAt)throw Error('SYNTHETIC_STALE_CONTEXT');},
        getManualOperation:async()=>current,
        mutateManualOperation:async(_,fn)=>current=fn(current),
        getReportPrefix:async()=>null,
        diagnostic:async(...x)=>diagnostics.push(x),
        attemptManualBatchDelivery:()=>{delivered.push(structuredClone(current));return Promise.resolve();},
        MANUAL_OPERATION_STATUSES:{REQUESTING:'requesting'},
        safeBatchCapabilitySummary:()=>null,safeBatchQueryPlannerSummary:()=>null,VERSION:'0.2.42',
        OzonGuidance:{result:()=>({choices:[]})},
      };
      context.globalThis=context;vm.createContext(context);
      vm.runInContext(artifact.files['shared/bridge_autorun_model.js'],context,{timeout:1000});
      vm.runInContext(artifact.files['shared/llm_output_report_workflow_patch.js'],context,{timeout:1000});
      for(const [name,text] of Object.entries(selected)) vm.runInContext(text,context,{filename:name,timeout:1000});
      const reset=entries=>{current={operation_id:'INERT_OPERATION',status:'requesting',origin:'https://alice.yandex.ru',created_at:'2026-11-01T00:00:00Z',payload_expires_at_ms:Date.now()+60000,execution_context:enabled?{marketplace:'ozon',storeId:'INERT_STORE',bindingId:'INERT_BINDING',workSessionId:'INERT_WORK'}:null,batch:{entries:structuredClone(entries),next_index:entries.length}};delivered=[];contextCalls=0;rejectAt=0;diagnostics=[];};
      for(const f of fixtures) {
        reset(f.entries);const errors=[];let result;
        try {result=await context.finalizeManualBatch('INERT_CONVERSATION','INERT_OPERATION',structuredClone(f.entries));} catch(e){errors.push('HARNESS_OR_RUNTIME_EXCEPTION:'+String(e.message));}
        if(result?.ok!==true || delivered.length!==1) errors.push('DELIVERY_CLAIM_OR_CALL');
        if(contextCalls!==2) errors.push('CONTEXT_GUARD_COUNT');
        const outgoing=current?.outgoing_text || '';
        for(const e of f.entries) if(!outgoing.includes(e.report_text)) errors.push('RESULT_BYTES_LOST');
        errors.push(...inspectPayload(outgoing,f.expected));
        const helperText=context.OzonLlmOutputReportWorkflowPatch.appendInstructionTail(context.saCombinedReport(f.entries,{execution_context:{marketplace:'ozon',storeId:'INERT_STORE',bindingId:'INERT_BINDING',workSessionId:'INERT_WORK'},created_at:'2026-11-01T00:00:00Z',payload_expires_at_ms:Date.now()+60000}));
        const helperIssues=inspectPayload(helperText,f.expected);
        rows.push({artifact:artifact.name,mode:enabled?'SELLER_AGENTS':'LEGACY',case:f.id,status:errors.length?'FAIL':'PASS',issues:[...new Set(errors)],helperControlIssues:helperIssues,outgoingBytes:Buffer.byteLength(outgoing),outgoingSha256:hash(outgoing),deliveryCalls:delivered.length});
      }
      for(const gate of []) {
        reset([entry('report_products_create',{code})]);
        if(gate==='context-first')rejectAt=1;
        if(gate==='context-second')rejectAt=2;
        if(gate==='wrong-operation')current.operation_id='OTHER_OPERATION';
        if(gate==='already-delivering')current.status='delivering';
        if(gate==='incomplete-batch')current.batch.next_index=0;
        if(gate==='unfinished-entry')current.batch.entries[0].status='requesting';
        let err=null,res=null;
        try{res=await context.finalizeManualBatch('INERT_CONVERSATION','INERT_OPERATION',[entry('report_products_create',{code})]);}catch(e){err=String(e.message);}
        const pass=delivered.length===0 && (gate.startsWith('context-')?err==='SYNTHETIC_STALE_CONTEXT':res?.code==='BATCH_FINALIZE_RACE');
        safety.push({artifact:artifact.name,mode:enabled?'SELLER_AGENTS':'LEGACY',case:gate,status:pass?'PASS':'FAIL',deliveryCalls:delivered.length,error:err,resultCode:res?.code||null});
      }
    }
  }
  const productFails=rows.filter(r=>r.status==='FAIL');
  const byMode={};for(const r of rows){const k=r.artifact+':'+r.mode;byMode[k]??={total:0,pass:0,fail:0};byMode[k].total++;byMode[k][r.status==='PASS'?'pass':'fail']++;}
  console.log(JSON.stringify({record:'B02_REPORT_GUIDANCE_STATUS_PRECEDENCE_ADDITIONAL_GROUP',startedAt,finishedAt:new Date().toISOString(),level:'ISOLATED_ACTUAL_FINALIZER_FORMATTER_MODEL_WITH_IN_MEMORY_STORAGE_AND_DELIVERY_PORTS',notIndependentDonorAcceptance:true,sourceEdits:0,providerCalls:externalCalls,browserSends:0,databaseCalls:0,fixtureCount:fixtures.length,byMode,total:rows.length,passed:rows.length-productFails.length,failed:productFails.length,safetyTotal:safety.length,safetyPassed:safety.filter(x=>x.status==='PASS').length,inputs,extraction,rows,safety}));
  process.exitCode=productFails.length||safety.some(x=>x.status!=='PASS')||externalCalls?1:0;
}
main().catch(e=>{console.error(e.stack);process.exitCode=2;});
