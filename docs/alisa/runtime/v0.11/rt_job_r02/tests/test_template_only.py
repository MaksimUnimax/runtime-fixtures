"""Temporary template-only pilot: real existing worker with fake IO, no provider net."""
from pathlib import Path
from copy import deepcopy
from datetime import date
from dataclasses import replace
from unittest.mock import patch
import tempfile,json,sqlite3,unittest,os
from engine import Engine,Worker,CallError
from repository import Repository
from semantics import fingerprint,strict_json,Rejected
from model_answer import Settings,API_DATA
from station_status import status
from test_runtime import Clock,SCOPE,TODAY,FakeTransport
import template_catalog as tc
import template_runtime as tr
from template_gaps import GapStore
from template_protocol import payload
import retention

TEXT='Извините, данный запрос не поддерживается'
INPUT={'period':{'from':'2026-11-02','to':'2026-11-02'},'comparison':None,'filters':{},'group_by':'marketplace'}
def selection(ids=('SUMMARY.43',),store='oz1',inputs=None):
 calls=[{'id':'i'+str(i),'template_id':tid,'store_id':store,'input':deepcopy(INPUT if inputs is None else inputs)}for i,tid in enumerate(ids)]
 return {'action':'plan','complete':True,'missing':[],'requirements':[{'id':'r'+str(i),'description':'Полностью запрошенная часть '+str(i),'invocations':[c['id']]}for i,c in enumerate(calls)],'invocations':calls}
class Transport(FakeTransport):
 model_source='model:template-fixture'
 def __init__(self):super().__init__();self.selection=selection();self.verification=None;self.network_failure=None;self.answer='Данные получены.'
 def prepare(self,*args):return None
 def execute_observed(self,request,store,on_dispatch):on_dispatch();return self.execute(request,store)
 def execute(self,request,store):
  if request.operation in('template_select','template_verify','model_answer'):
   self.calls.append(request)
   if self.on_call:self.on_call(request)
   if self.network_failure:
    e=self.network_failure;self.network_failure=None;raise e
   if request.operation=='template_select':value=self.selection
   elif request.operation=='template_verify':value=self.verification if self.verification is not None else{'approved':True,'missing':[],'requirement_ids':[x['id']for x in self.selection['requirements']]}
   else:return {'content':self.answer,'finish_reason':'stop'},{'status':200}
   return {'content':value if type(value)is str else json.dumps(value,ensure_ascii=False),'finish_reason':'stop'},{'status':200,'elapsed_ms':1}
  if request.operation.startswith('ds_'):
   from test_dataset_pipeline import fixture
   self.calls.append(request);return fixture(request.operation,request.body),{'status':200}
  return super().execute(request,store)

class Pilot(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.clock=Clock();self.scope=SCOPE
  self.settings=Settings(self.root/'answer.json');self.repo=Repository(self.root/'state.sqlite3',self.clock)
  self.engine=Engine(self.repo,lambda t:self.scope,answer_settings=self.settings,template_mode=True)
  self.transport=Transport();self.worker=Worker(self.engine,self.transport);self.seq=0
 def tearDown(self):self.temp.cleanup()
 def ask(self,q='Сколько товаров заказали и на какую сумму вчера на Озоне?',rid=None):
  self.seq+=1
  return self.engine.safe_submit('A',q,rid or str(self.seq),fingerprint(q),TODAY,conversation_id='template-test-session',message_id=self.seq)
 def finish(self,a):
  self.assertIn('job_id',a,a)
  for _ in range(120):
   row=self.repo.get('A',a['job_id'])
   if row['state']not in('QUEUED','RUNNING'):return row
   self.clock.advance(max(0,row['due']-self.clock())+1);self.worker.step()
  self.fail('did not finish')
 def gap(self,a=None):
  a=a or self.ask();row=self.finish(a);self.assertEqual(row['state'],'READY',row['error']);self.assertEqual(row['error'],'TEMPLATE_NOT_FOUND')
  result=strict_json(row['result']);self.assertEqual(result['pages'],[TEXT]);self.assertIsNone(result['data']);self.assertFalse(result['model_result']['ok']);self.assertEqual(sum(bool(c.store_id)for c in self.transport.calls),0)
  saved=GapStore(self.root/'template-gaps.sqlite3').get('A',result['model_result']['case_id']);return row,result,saved
 def test_simple_template_existing_source_and_normal_answer(self):
  row=self.finish(self.ask());self.assertEqual(row['state'],'READY',row['error']);self.assertEqual(row['error'],None)
  self.assertEqual([r.operation for r in self.transport.calls],['template_select','template_verify','ozon_orders','model_answer'])
  self.assertEqual(strict_json(row['result'])['pages'],[self.transport.answer])
 def test_two_templates_same_source_coalesce(self):
  self.transport.selection=selection(['B01.ordered_units','B01.ordered_revenue']);row=self.finish(self.ask());self.assertEqual(row['state'],'READY',row['error']);self.assertEqual([r.operation for r in self.transport.calls].count('ozon_orders'),1)
 def test_two_periods_are_two_fragments_one_job(self):
  self.transport.selection=selection(['B01.ordered_units','B01.ordered_revenue']);self.transport.selection['invocations'][1]['input']['period']={'from':'2026-11-01','to':'2026-11-01'}
  row=self.finish(self.ask());self.assertEqual(row['state'],'READY',row['error']);self.assertEqual([r.operation for r in self.transport.calls].count('ozon_orders'),2)
  with self.repo.connection()as c:self.assertEqual(c.execute('SELECT COUNT(*)FROM jobs').fetchone()[0],1)
 def test_model_declared_missing_archived(self):
  self.transport.selection={'action':'unsupported','reason':'not found','missing':['weather'],'reply':TEXT};self.gap();self.assertEqual(len(self.transport.calls),1)
 def test_universal_read_action_is_rejected_before_api(self):
  self.transport.selection={'action':'read','store_id':'oz1','operation':'analytics_data','params':{}};self.gap()
 def test_discover_action_is_rejected(self):self.transport.selection={'action':'discover','platform':'ozon'};self.gap()
 def test_direct_method_ingress_disabled(self):
  with self.assertRaises(Rejected)as e:self.engine.submit_method('A','oz1','seller_info',{},'r',TODAY,'direct-session')
  self.assertEqual(e.exception.code,'TEMPLATE_DIRECT_METHOD_DISABLED');self.assertEqual(self.transport.calls,[])
 def test_unknown_template(self):self.transport.selection=selection(['invented-template']);self.gap()
 def test_empty_template_list(self):self.transport.selection['invocations']=[];self.gap()
 def test_partial_composition_not_executed(self):self.transport.selection['complete']=False;self.transport.selection['missing']=['profit'];self.gap()
 def test_independent_verifier_catches_omitted_requirement(self):
  self.transport.verification={'approved':False,'missing':['нет расходов'],'requirement_ids':[]};self.gap();self.assertEqual(len(self.transport.calls),2)
 def test_verifier_missing_id_not_accepted(self):self.transport.verification={'approved':True,'missing':[],'requirement_ids':[]};self.gap()
 def test_verifier_duplicate_id_not_accepted(self):self.transport.verification={'approved':True,'missing':[],'requirement_ids':['r0','r0']};self.gap()
 def test_planner_receives_actual_input_contract(self):
  self.transport.selection={'action':'unsupported','reason':'no','missing':['x'],'reply':TEXT};self.gap();ctx=self.transport.calls[0].body['context'];self.assertEqual(ctx['input_contract']['group_by']['enum'],['marketplace','total']);self.assertFalse(ctx['input_contract']['group_by']['null_allowed'])
 def test_null_grouping_is_not_silently_rewritten(self):
  self.transport.selection['invocations'][0]['input']['group_by']=None;_,_,saved=self.gap();self.assertEqual(saved['reason'],'GROUP_BY_NOT_SUPPORTED');self.assertIsNone(saved['selection']['invocations'][0]['input']['group_by'])
 def test_selection_prompt_is_explicit_about_default_grouping(self):
  from template_protocol import SELECT_SYSTEM
  self.assertIn('group_by="marketplace"',SELECT_SYSTEM);self.assertIn('никогда null',SELECT_SYSTEM)
 def test_unknown_parameter_not_ignored(self):self.transport.selection['invocations'][0]['input']['campaign_id']=123;self.gap()
 def test_requirement_not_bound_to_invocation(self):self.transport.selection['requirements'][0]['invocations']=[];self.gap()
 def test_partial_missing_list_overrides_complete_flag(self):self.transport.selection['missing']=['another part'];self.gap()
 def test_model_invalid_json_archived_exactly(self):self.transport.selection='{"broken"';row,result,saved=self.gap();self.assertEqual(saved['model_calls'][0]['response']['content'],'{"broken"')
 def test_disabled_wb_dataset_not_enabled_by_migration(self):self.transport.selection=selection(['wb_active_ads'],'wb1');self.gap()
 def test_wrong_marketplace_template_not_substituted(self):self.transport.selection=selection(['B11.current_balance'],'oz1',{'period':None});self.gap()
 def test_financial_incomplete_conditions_do_not_get_partial_result(self):self.transport.selection=selection(['B01.ordered_units'],inputs={**INPUT,'filters':{'sku':['1']}});self.gap()
 def test_historical_snapshot_rejected_as_gap(self):self.transport.selection=selection(['B11.current_balance'],'wb1');self.gap()
 def test_exact_original_question_and_model_payload_retained(self):
  q='Покажи заказы и НЕИЗВЕСТНОЕ: «Пример».  Не теряй условия!';self.transport.selection={'action':'unsupported','reason':'missing','missing':['НЕИЗВЕСТНОЕ'],'reply':TEXT};row,result,saved=self.gap(self.ask(q))
  self.assertEqual(saved['original_question'],q);self.assertEqual(saved['model_calls'][0]['request_payload'],payload('template_select',self.transport.calls[0].body));self.assertIn(q,saved['model_calls'][0]['request_payload']['messages'][-1]['content']);self.assertEqual(len(saved['catalog']['templates']),85)
 def test_gap_has_source_revision_and_selector_output(self):self.transport.selection={'action':'unsupported','reason':'no','missing':['x'],'reply':TEXT};_,_,s=self.gap();self.assertEqual(s['catalog_hash'],tc.HASH);self.assertEqual(s['model_calls'][0]['response']['content'],json.dumps(self.transport.selection,ensure_ascii=False))
 def test_no_free_final_answer_model_for_fixed_refusal(self):self.transport.selection={'action':'unsupported','reason':'no','missing':['x'],'reply':'WRONG'};self.gap();self.assertNotIn('model_answer',[x.operation for x in self.transport.calls])
 def test_station_exact_reply_and_object(self):
  self.transport.selection={'action':'unsupported','reason':'no','missing':['x'],'reply':TEXT};row,result,_=self.gap();answer=status(self.engine,{'op':'station_status','tenant':'A','conversation_id':'template-test-session','job_id':row['id']});self.assertEqual(answer['text'],TEXT);self.assertEqual(answer['tts'],TEXT);self.assertEqual(answer['model_result'],result['model_result'])
 def test_other_conversation_cannot_read_case_reply(self):
  self.transport.selection={'action':'unsupported','reason':'no','missing':['x'],'reply':TEXT};row,_,_=self.gap();r=status(self.engine,{'op':'station_status','tenant':'A','conversation_id':'other-session','job_id':row['id']});self.assertEqual(r['state'],'SUPERSEDED');self.assertNotIn('model_result',r)
 def test_revoked_scope_blocks_delivery(self):
  self.transport.selection={'action':'unsupported','reason':'no','missing':['x'],'reply':TEXT};row,_,_=self.gap();self.scope=replace(self.scope,revision='new')
  with self.assertRaises(Rejected):status(self.engine,{'op':'station_status','tenant':'A','conversation_id':'template-test-session','job_id':row['id']})
 def test_no_plaintext_gap_body_on_disk(self):
  q='UNIQUE_SENSITIVE_QUESTION_623738';self.transport.selection={'action':'unsupported','reason':'no','missing':['x'],'reply':TEXT};self.gap(self.ask(q))
  for f in self.root.glob('template-gaps.sqlite3*'):self.assertNotIn(q.encode(),f.read_bytes())
 def test_gap_survives_report_cleanup_and_restart(self):
  self.transport.selection={'action':'unsupported','reason':'no','missing':['x'],'reply':TEXT};row,r,s=self.gap();self.clock.advance(100000);retention.sweep(self.repo)
  again=GapStore(self.root/'template-gaps.sqlite3');self.assertEqual(again.get('A',r['model_result']['case_id']),s)
 def test_other_tenant_cannot_decrypt_by_case_id(self):
  self.transport.selection={'action':'unsupported','reason':'no','missing':['x'],'reply':TEXT};_,r,_=self.gap()
  with self.assertRaises(Rejected):GapStore(self.root/'template-gaps.sqlite3').get('B',r['model_result']['case_id'])
 def test_gap_key_private(self):self.transport.selection={'action':'unsupported','reason':'no','missing':['x'],'reply':TEXT};self.gap();self.assertEqual((self.root/'template-gaps.key').stat().st_mode&0o777,0o600)
 def test_duplicate_request_receipt_no_duplicate_model_or_gap(self):
  self.transport.selection={'action':'unsupported','reason':'no','missing':['x'],'reply':TEXT};q='Uncovered request';a=self.ask(q,rid='id1');self.gap(a);count=len(self.transport.calls)
  r=self.engine.safe_submit('A',q,'id1',fingerprint(q),TODAY,conversation_id='template-test-session',message_id=1);self.assertEqual(a['job_id'],r['job_id']);self.assertEqual(len(self.transport.calls),count);self.assertEqual(len(GapStore(self.root/'template-gaps.sqlite3').list()),1)
 def test_schema_mistake_does_not_destroy_original_question(self):self.transport.selection=[];_,_,s=self.gap();self.assertEqual(s['original_question'],'Сколько товаров заказали и на какую сумму вчера на Озоне?')
 def test_model_503_retry_uses_same_payload_and_no_provider(self):
  self.transport.selection={'action':'unsupported','reason':'no','missing':['x'],'reply':TEXT};self.transport.network_failure=CallError('HTTP_503',status=503);self.gap();self.assertEqual(self.transport.calls[0].body,self.transport.calls[1].body)
 def test_restart_between_selection_and_verification(self):
  a=self.ask();self.worker.step();self.repo=Repository(self.root/'state.sqlite3',self.clock);self.engine=Engine(self.repo,lambda t:self.scope,answer_settings=self.settings,template_mode=True);self.worker=Worker(self.engine,self.transport);r=self.finish(a);self.assertEqual(r['state'],'READY',r['error'])
 def test_final_answer_retry_does_not_repeat_source(self):
  a=self.ask()
  for _ in range(10):
   r=self.repo.get('A',a['job_id']);p=strict_json(r['progress'])if r['progress']else{}
   if '_answer_pending'in p:break
   self.clock.advance(1);self.worker.step()
  self.transport.network_failure=CallError('HTTP_503',status=503);r=self.finish(a);self.assertEqual(r['state'],'READY',r['error']);self.assertEqual(sum(x.operation=='ozon_orders'for x in self.transport.calls),1)
 def test_original_question_not_replaced_by_template_name_in_answer(self):
  q='Заказы за вчера на Ozon';r=self.finish(self.ask(q));self.assertEqual(r['state'],'READY',r['error']);answer=next(x for x in self.transport.calls if x.operation=='model_answer');self.assertEqual(answer.body['messages'][1]['content'],q)
 def test_source_rights_revoked_before_execution(self):
  a=self.ask();self.worker.step();self.scope=replace(self.scope,revision='revoked');r=self.finish(a);self.assertEqual(r['state'],'FAILED');self.assertEqual(sum(bool(x.store_id)for x in self.transport.calls),0)
 def test_gap_persistence_failure_does_not_claim_saved(self):
  self.transport.selection={'action':'unsupported','reason':'no','missing':['x'],'reply':TEXT};a=self.ask()
  with patch('template_gaps.GapStore.save',side_effect=OSError('disk full')):r=self.finish(a)
  self.assertNotEqual(r['state'],'READY')
 def test_help_is_template_and_not_network_read(self):
  self.transport.selection=selection(['H00'],inputs={'period':None});r=self.finish(self.ask('Что умеет сервис?'));self.assertEqual(r['state'],'READY',r['error']);self.assertEqual(sum(bool(x.store_id)for x in self.transport.calls),0)

class Catalogue(unittest.TestCase):
 def test_all_85_ids_migrated(self):self.assertEqual(len(tc.TEMPLATES),85)
 def test_no_speech_fields_anywhere(self):tc.validate_catalog()
 def test_no_dataset_phrase_field(self):
  d=strict_json(Path(tc.__file__).with_name('dataset_queries.json').read_text());self.assertTrue(all('phrases'not in q for q in d['queries'].values()))
 def test_no_base_phrase_field(self):
  d=strict_json(Path(tc.__file__).with_name('base_blocks.json').read_text());self.assertTrue(all('phrase'not in q for q in d['entries']))
 def test_nested_formula_is_dependency_graph(self):self.assertIn('B06.finance_storage_cost',tc.dependencies('finance_storage_logistics_share'))
 def test_all_references_are_resolved(self):
  for tid in tc.TEMPLATES:self.assertTrue(tc.dependencies(tid))
 def test_no_cycle_can_publish(self):
  with patch.dict(tc.TEMPLATES['B01.ordered_units'],{'steps':[{'id':'x','template':'B01.ordered_units'}]}):
   with self.assertRaises(ValueError):tc.validate_catalog()
 def test_temporary_mode_explicit(self):self.assertTrue(tc.CATALOG['mode']['temporary']);self.assertFalse(tc.CATALOG['mode']['universal_fallback'])
 def test_no_absolute_provider_urls_in_recipe_steps(self):
  for t in tc.TEMPLATES.values():self.assertNotIn('https://',json.dumps(t['steps']))
 def test_production_runtime_has_no_readsurface_instance(self):
  s=Path(tc.__file__).with_name('runtime.py').read_text();self.assertIn('template_mode=True',s);self.assertNotIn('reads=ReadSurface(',s)
if __name__=='__main__':unittest.main()
