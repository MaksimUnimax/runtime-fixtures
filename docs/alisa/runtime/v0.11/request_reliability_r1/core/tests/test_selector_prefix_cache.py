"""Prefix layout is not a response/permission cache. No external I/O in tests."""
from copy import deepcopy
from pathlib import Path
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import patch
import json,hashlib,os,unittest,sqlite3
import template_catalog as tc
import template_protocol as protocol
import selector_policy as policy
import model_usage
from semantics import strict_json,canonical_json,Rejected,fingerprint
from engine import Engine,Worker,CallError
from repository import Repository
from providers import Request
from model_answer import Settings
from test_runtime import SCOPE,TODAY
import test_template_only as pilot_fixture
from test_template_only import selection
import retention

RULE={'layout':policy.PREFIX,'isolation':'tenant_v1'}

def body(question='Сумма заказов за вчера',templates=None):
    eng=SimpleNamespace(dataset_capabilities=None,table_capabilities=None)
    return {'system':protocol.SELECT_SYSTEM,'instruction':'Сохрани условия исходного вопроса.',
       'context':{'original_question':question,'clarifications':[],'server_date':'2026-11-03','timezone':'Europe/Moscow',
       'allowed_stores':[{'id':s.id,'platform':s.platform}for s in SCOPE.stores],
       'templates':tc.discovery(eng,SCOPE)if templates is None else templates,
       'input_contract':deepcopy(tc.INPUT_CONTRACT),'temporary_mode':tc.MODE}}

def wire(raw,rule=RULE,tenant='fixture-tenant'):
    b=policy.apply(raw,rule,tenant);return protocol.payload('template_select',b)

def decode_v2(payload):
    text=payload['messages'][-1]['content'];static,dynamic=text[len('CATALOG_DATA\n'):].split('\nREQUEST_DATA\n',1)
    return json.loads(static),json.loads(dynamic)

class Layout(unittest.TestCase):
    def test_legacy_without_options_exact_previous_bytes(self):
        b=body();expected={'model':'deepseek-flash','thinking':{'type':'disabled'},'temperature':0,'response_format':{'type':'json_object'},'messages':[{'role':'system','content':protocol.SELECT_SYSTEM},{'role':'system','content':b['instruction']},{'role':'user','content':json.dumps(b['context'],ensure_ascii=False,allow_nan=False)}]}
        self.assertEqual(json.dumps(protocol.payload('template_select',b),ensure_ascii=False),json.dumps(expected,ensure_ascii=False))
    def test_explicit_legacy_unchanged(self):
        b=body();self.assertEqual(protocol.payload('template_select',b),wire(b,policy.DEFAULT))
    def test_original_question_is_exact_and_only_in_tail(self):
        q='Исходный вопрос: «Заказы»?\nНе изменяй текст.';w=wire(body(q));s,d=decode_v2(w);self.assertEqual(d['original_question'],q);self.assertNotIn(q,json.dumps(s,ensure_ascii=False))
    def test_all_descriptions_and_access_losslessly_reconstruct(self):
        b=body();s,d=decode_v2(wire(b));restored=[]
        for t in s['templates']:restored.append({**t,'available_stores':d['template_availability'][t['id']]})
        self.assertEqual(sorted(restored,key=lambda t:t['id']),sorted(b['context']['templates'],key=lambda t:t['id']))
    def test_system_roles_and_options_unchanged(self):
        b=body();v1=wire(b,policy.DEFAULT);v2=wire(b);self.assertEqual(v1['messages'][:-1],v2['messages'][:-1]);self.assertEqual([m['role']for m in v1['messages']],[m['role']for m in v2['messages']]);self.assertEqual({k:v for k,v in v1.items()if k!='messages'},{k:v for k,v in v2.items()if k not in('messages','user_id')})
    def test_common_part_identical_for_different_questions(self):
        a=wire(body('Заказы?'))['messages'][-1]['content'];b=wire(body('Комиссия?'))['messages'][-1]['content'];self.assertEqual(a.split('REQUEST_DATA')[0],b.split('REQUEST_DATA')[0]);self.assertGreater(len(os.path.commonprefix([a,b])),10000)
    def test_store_ids_and_availability_outside_prefix(self):
        b=body();s,d=decode_v2(wire(b));raw=json.dumps(s,ensure_ascii=False);self.assertNotIn('available_stores',raw)
        for store in b['context']['allowed_stores']:self.assertNotIn('"'+store['id']+'"',raw)
        self.assertIn('allowed_stores',d);self.assertIn('template_availability',d)
    def test_access_change_does_not_invalidate_static(self):
        a=body();b=deepcopy(a);b['context']['templates'][0]['available_stores']=[];sa,da=decode_v2(wire(a));sb,db=decode_v2(wire(b));self.assertEqual(sa,sb);self.assertNotEqual(da,db)
    def test_notes_and_notes_only_version_not_in_view(self):
        before=wire(body());t=tc.TEMPLATES['B08.finance_sales']
        with patch.dict(t,{'notes':['PRIVATE_NOTE_NOT_FOR_SELECTOR'],'version':t['version']+100}):self.assertEqual(before,wire(body()))
        self.assertNotIn('PRIVATE_NOTE',json.dumps(before));self.assertTrue(all('notes'not in r and'version'not in r for r in decode_v2(before)[0]['templates']))
    def test_purpose_change_immediately_visible_and_keeps_prior_prefix(self):
        before=wire(body());t=tc.TEMPLATES['B08.finance_sales'];old=before['messages'][-1]['content']
        with patch.dict(t,{'purpose':t['purpose']+' NEW_SEMANTIC_MARKER'}):after=wire(body())
        new=after['messages'][-1]['content'];self.assertIn('NEW_SEMANTIC_MARKER',new);self.assertNotEqual(new,old);self.assertGreater(len(os.path.commonprefix([old,new])),1000)
    def test_no_changing_hash_or_version_in_model_content(self):
        b=policy.apply(body(),RULE,'tenant');m=protocol.request_metadata('template_select',b);content=protocol.payload('template_select',b)['messages'][-1]['content']
        for k,v in m.items():
            if k.endswith('_sha256'):self.assertNotIn(v,content)
        self.assertNotIn(tc.HASH,content);self.assertNotIn('prompt_layout',content)
    def test_semantic_hash_changes_only_with_selector_fields(self):
        a=policy.apply(body(),RULE,'tenant');base=protocol.request_metadata('template_select',a);b=deepcopy(a);b['context']['original_question']='Other';b['context']['templates'][0]['available_stores']=[]
        newer=protocol.request_metadata('template_select',b);self.assertEqual(base['selector_view_sha256'],newer['selector_view_sha256']);self.assertEqual(base['prefix_sha256'],newer['prefix_sha256']);self.assertNotEqual(base['request_payload_sha256'],newer['request_payload_sha256'])
    def test_dictionary_and_definition_order_do_not_change_v2(self):
        a=body();b=deepcopy(a);b['context']['templates']=[dict(reversed(list(t.items())))for t in reversed(a['context']['templates'])];self.assertEqual(wire(a),wire(b))
    def test_dependency_order_not_rewritten(self):
        b=body();t=next(r for r in b['context']['templates']if len(r['dependencies'])>1);t['dependencies']=list(reversed(t['dependencies']));s,_=decode_v2(wire(b));self.assertEqual(next(r for r in s['templates']if r['id']==t['id'])['dependencies'],t['dependencies'])
    def test_unknown_field_not_silently_lost(self):
        b=body();b['context']['templates'][0]['future_semantics']='new'
        with self.assertRaises(ValueError):wire(b)
    def test_duplicate_id_rejected(self):
        b=body();b['context']['templates'].append(deepcopy(b['context']['templates'][0]))
        with self.assertRaises(ValueError):wire(b)
    def test_unknown_layout_rejected(self):
        b=body();b['_prompt_layout']='universal'
        with self.assertRaises(ValueError):protocol.payload('template_select',b)
    def test_user_id_derived_from_server_scope_only(self):
        a=wire(body(),tenant='tenant-A');b=wire(body('Другой вопрос'),tenant='tenant-A');c=wire(body(),tenant='tenant-B');self.assertEqual(a['user_id'],b['user_id']);self.assertNotEqual(a['user_id'],c['user_id']);self.assertNotIn('tenant-A',a['user_id']);self.assertNotIn(a['user_id'],json.dumps(a['messages']))
    def test_user_id_same_in_both_ab_layouts(self):
        b=body();a=wire(b,{'layout':policy.LEGACY,'isolation':'tenant_v1'});c=wire(b);self.assertEqual(a['user_id'],c['user_id'])
    def test_arbitrary_user_id_cannot_pass(self):
        b=policy.apply(body(),RULE,'tenant');b['_selector_user_id']='user@example.com'
        with self.assertRaises(ValueError):protocol.payload('template_select',b)
    def test_policy_has_no_quota_or_budget(self):
        self.assertEqual(policy.validate(),{'layout':'legacy_v1','isolation':'legacy_none'})
        with self.assertRaises(Rejected):policy.validate({**RULE,'budget':100})

class Queue(unittest.TestCase):
    setUp=pilot_fixture.Pilot.setUp;tearDown=pilot_fixture.Pilot.tearDown;ask=pilot_fixture.Pilot.ask;finish=pilot_fixture.Pilot.finish;gap=pilot_fixture.Pilot.gap
    def enable(self):self.engine.selector_policy=lambda:dict(RULE)
    def test_simple_question_two_calls_and_one_source(self):
        self.enable();r=self.finish(self.ask());self.assertEqual(r['state'],'READY',r['error']);self.assertEqual([x.operation for x in self.transport.calls],['template_select','ozon_orders','model_answer']);self.assertEqual(model_usage.summary(self.repo)['attempts'],2)
    def test_snapshot_exactly_matches_sent_http_bytes_and_attempt_metadata(self):
        from http_transport import HTTPTransport
        self.enable();a=self.ask();sent=[]
        envelope={'model':'deepseek-flash','choices':[{'message':{'content':json.dumps(selection())},'finish_reason':'stop'}],
            'usage':{'prompt_tokens':1000,'prompt_cache_hit_tokens':800,'prompt_cache_miss_tokens':200,'completion_tokens':50,'total_tokens':1050}}
        def received(request,**kwargs):
            sent.append(request.data)
            if kwargs.get('on_dispatch'):kwargs['on_dispatch']()
            return json.dumps(envelope).encode(),200
        transport=HTTPTransport('/no-real-credentials',{}, {},enabled=True)
        with patch.object(transport,'_credential',return_value='synthetic-only'),patch('http_transport.read_response',side_effect=received):Worker(self.engine,transport).step()
        row=self.repo.get('A',a['job_id']);trace=strict_json(row['progress'])['_template_trace'][0]
        self.assertEqual(len(sent),1);self.assertEqual(trace['request_payload'],json.loads(sent[0]));self.assertEqual(trace['request_payload_sha256'],hashlib.sha256(sent[0]).hexdigest());self.assertEqual(model_usage.job_attempts(self.repo,row['id'])[0]['context']['request_payload_sha256'],trace['request_payload_sha256'])
    def test_catalogue_notes_and_plain_answer_unchanged(self):
        self.enable();r=self.finish(self.ask());self.assertEqual(r['state'],'READY');self.assertEqual(strict_json(r['result'])['pages'],[self.transport.answer]);self.assertNotIn('CATALOG_DATA',str(self.transport.calls[-1].body))
    def test_zero_cache_hit_does_not_trigger_retry(self):
        self.enable();original=self.transport.execute
        def response(request,store):
            data,meta=original(request,store);meta['model_usage']={'model':'deepseek-flash','requested_model':'deepseek-flash','usage':{'prompt_tokens':100,'prompt_cache_hit_tokens':0,'prompt_cache_miss_tokens':100,'completion_tokens':20,'total_tokens':120}};return data,meta
        self.transport.execute=response;self.finish(self.ask());self.assertEqual(len([x for x in self.transport.calls if x.operation=='template_select']),1)
    def test_new_jobs_pin_policy_not_global_later(self):
        self.engine.selector_policy=lambda:dict(policy.DEFAULT);a=self.ask();self.enable();r=self.finish(a);first=self.transport.calls[0];self.assertEqual(first.body['_prompt_layout'],policy.LEGACY);self.assertNotIn('user_id',protocol.payload('template_select',first.body))
    def test_existing_jobs_missing_policy_remain_legacy(self):
        a=self.ask();row=self.repo.get('A',a['job_id']);draft=strict_json(row['draft']);draft.pop('selector_prompt')
        with self.repo.connection(True)as c:c.execute('UPDATE jobs SET draft=?WHERE id=?',(canonical_json(draft),row['id']))
        self.enable();r=self.finish(a);self.assertEqual(r['state'],'READY',r['error']);self.assertEqual(self.transport.calls[0].body['_prompt_layout'],policy.LEGACY)
    def test_retry_bytes_same_after_restart_and_instruction_change(self):
        self.enable();a=self.ask();self.transport.network_failure=CallError('HTTP_503',status=503);self.worker.step();first=protocol.payload('template_select',self.transport.calls[0].body);row=self.repo.get('A',a['job_id']);p=strict_json(row['progress']);self.assertIn('_selector_prepared',p)
        current=self.settings.read();self.settings.save(current['revision'],request_planning_prompt='Changed after acceptance',answer_prompt=current['answer_prompt'],answer_extra_instruction=current['answer_extra_instruction'])
        self.repo=Repository(self.root/'state.sqlite3',self.clock);self.engine=Engine(self.repo,lambda t:self.scope,answer_settings=self.settings,template_mode=True,selector_policy=lambda:dict(policy.DEFAULT));self.worker=Worker(self.engine,self.transport);r=self.finish(a)
        self.assertEqual(r['state'],'READY',r['error']);second=protocol.payload('template_select',self.transport.calls[1].body);self.assertEqual(json.dumps(first,ensure_ascii=False),json.dumps(second,ensure_ascii=False));self.assertEqual(sum(bool(x.store_id)for x in self.transport.calls),1)
    def test_gap_archive_exact_wire_payload_including_isolation(self):
        self.enable();self.transport.selection={'action':'unsupported','reason':'missing','missing':['x'],'reply':tc.TEXT};_,_,saved=self.gap();trace=saved['model_calls'][0];actual=protocol.payload('template_select',self.transport.calls[0].body);self.assertEqual(trace['request_payload'],actual);self.assertEqual(trace['request_payload_sha256'],hashlib.sha256(json.dumps(actual,ensure_ascii=False,allow_nan=False).encode()).hexdigest());self.assertEqual(trace['request_metadata']['prompt_layout'],policy.PREFIX)
    def test_scope_revocation_before_retry_no_second_dispatch(self):
        self.enable();a=self.ask();self.transport.network_failure=CallError('HTTP_503',status=503);self.worker.step();self.scope=replace(self.scope,revision='revoked');r=self.finish(a);self.assertEqual(r['state'],'FAILED');self.assertEqual(len(self.transport.calls),1)
    def test_source_access_is_rechecked_after_selection(self):
        self.enable();a=self.ask();self.worker.step();self.scope=replace(self.scope,revision='revoked');r=self.finish(a);self.assertEqual(r['state'],'FAILED');self.assertEqual(sum(bool(x.store_id)for x in self.transport.calls),0)
    def test_no_second_validator_added(self):
        self.enable();self.finish(self.ask());self.assertNotIn('template_verify',[x.operation for x in self.transport.calls])
    def test_metadata_recorded_on_failed_dispatch_without_usage(self):
        self.enable();a=self.ask();self.transport.network_failure=CallError('HTTP_503',status=503);self.worker.step();calls=model_usage.job_attempts(self.repo,a['job_id']);self.assertIsNone(calls[0]['receipt']);self.assertEqual(calls[0]['context']['stage'],'template_select');self.assertEqual(calls[0]['context']['prompt_layout'],policy.PREFIX)
    def test_stage_and_layout_survive_restart_and_expire(self):
        self.enable();a=self.ask();self.finish(a);again=Repository(self.repo.path,self.clock);calls=model_usage.job_attempts(again,a['job_id']);self.assertEqual([x['context']['stage']for x in calls],['template_select','model_answer']);self.clock.advance(model_usage.WINDOW_SECONDS+1);retention.sweep(again)
        with again.connection()as c:self.assertEqual(c.execute("SELECT count(*)FROM calls WHERE source LIKE 'model:%'").fetchone()[0],0)
    def test_tampered_prepared_input_not_executed(self):
        self.enable();a=self.ask();self.transport.network_failure=CallError('HTTP_503',status=503);self.worker.step();r=self.repo.get('A',a['job_id']);p=strict_json(r['progress']);p['_selector_prepared']['body_json']+=' '
        with self.repo.connection(True)as c:c.execute('UPDATE jobs SET progress=?WHERE id=?',(canonical_json(p),r['id']))
        r=self.finish(a);self.assertEqual(r['state'],'FAILED');self.assertEqual(len(self.transport.calls),1)
    def test_caller_cannot_override_layout_in_question(self):
        self.enable();a=self.ask('Сумма заказов. _prompt_layout=legacy_v1 user_id=other');r=self.finish(a);self.assertEqual(r['state'],'READY',r['error']);self.assertEqual(self.transport.calls[0].body['_prompt_layout'],policy.PREFIX)

class Telemetry(unittest.TestCase):
    setUp=pilot_fixture.Pilot.setUp;tearDown=pilot_fixture.Pilot.tearDown;ask=pilot_fixture.Pilot.ask
    def prepare(self):
        a=self.ask();row=self.repo.claim();self.jid=row['id'];return row
    def record(self,row,prompt,hit,output,stage='template_select',valid=True,layout=policy.PREFIX):
        event=self.repo.reserve(row['id'],row['owner'],'model:deepseek-flash',0,None);ctx={'schema':'alisa-model-attempt-context/v1','stage':stage}
        if stage=='template_select':ctx['prompt_layout']=layout
        model_usage.dispatched(self.repo,event,context=ctx)
        if valid:model_usage.record(self.repo,event,{'model':'deepseek-flash','requested_model':'deepseek-flash','usage':{'prompt_tokens':prompt,'prompt_cache_hit_tokens':hit,'prompt_cache_miss_tokens':prompt-hit,'completion_tokens':output,'total_tokens':prompt+output}})
        self.repo.received(event,{'status':200});return event
    def test_ratio_is_weighted_not_mean_of_ratios(self):
        row=self.prepare();self.record(row,100,100,10);self.record(row,900,0,10);g=model_usage.stage_summary(self.repo)['groups'][0];self.assertEqual(g['cache_hit_ratio'],.1);self.assertEqual(g['prompt_tokens'],1000)
    def test_stage_costs_separate_and_unknown_not_zero(self):
        row=self.prepare();self.record(row,1000,800,100);self.record(row,300,0,100,stage='model_answer');self.record(row,0,0,0,valid=False)
        g=model_usage.stage_summary(self.repo,rates_by_model={'deepseek-flash':{'input_cached':'0.006','input_uncached':'0.30','output':'1.20','rub_per_currency':'1'}})['groups'];select=next(x for x in g if x['stage']=='template_select'and x['complete_receipts']);self.assertEqual(select['known_cost_at_supplied_rates'],'0.0001848');unknown=next(x for x in g if x['incomplete_receipts']);self.assertIsNone(unknown['known_cost_at_supplied_rates']);self.assertFalse(unknown['all_attempts_priced'])
    def test_context_forbids_arbitrary_prompt_or_secret(self):
        row=self.prepare();e=self.repo.reserve(row['id'],row['owner'],'model:deepseek-flash',0,None)
        with self.assertRaises(ValueError):model_usage.dispatched(self.repo,e,context={'schema':'alisa-model-attempt-context/v1','stage':'template_select','prompt':'secret'})
        self.assertEqual(model_usage.summary(self.repo)['attempts'],0)
    def test_old_rows_without_context_stay_unknown(self):
        row=self.prepare();event=self.repo.reserve(row['id'],row['owner'],'model:deepseek-flash',0,None);model_usage.dispatched(self.repo,event);g=model_usage.stage_summary(self.repo)['groups'][0];self.assertEqual(g['stage'],'unknown')
    def test_proven_abort_clears_context_stamp(self):
        row=self.prepare();event=self.repo.reserve(row['id'],row['owner'],'model:deepseek-flash',0,None);model_usage.dispatched(self.repo,event,context={'schema':'alisa-model-attempt-context/v1','stage':'template_select'});model_usage.undispatched(self.repo,event)
        with self.repo.connection()as c:r=c.execute('SELECT dispatched,model_context FROM calls WHERE id=?',(event,)).fetchone()
        self.assertIsNone(r['dispatched']);self.assertIsNone(r['model_context'])

class Port(unittest.TestCase):
    def test_native_guarded_success_under_new_layout(self):
        from test_template_integration import GuardedPilot
        f=GuardedPilot('test_port_executes_templates_without_legacy_scope');f.setUp()
        try:f.engine.selector_policy=lambda:dict(RULE);f.test_port_executes_templates_without_legacy_scope();self.assertEqual(f.transport.calls[0].body['_prompt_layout'],policy.PREFIX)
        finally:f.tearDown()
    def test_native_authority_revocation_still_blocks_new_layout(self):
        from test_template_integration import GuardedPilot
        f=GuardedPilot('test_port_revocation_after_selection_stops_next_call');f.setUp()
        try:f.engine.selector_policy=lambda:dict(RULE);f.test_port_revocation_after_selection_stops_next_call()
        finally:f.tearDown()

if __name__=='__main__':unittest.main()
