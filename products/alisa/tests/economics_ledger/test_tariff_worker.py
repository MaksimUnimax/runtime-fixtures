"""Real Worker/read builder/ledger; provider fixtures and no external IO."""
from copy import deepcopy
from dataclasses import replace
from datetime import datetime,timezone,date
from decimal import Decimal
from pathlib import Path
import json,tempfile,unittest
from engine import Engine,Worker,CallError
from repository import Repository,Deferred
from semantics import fingerprint,strict_json,Rejected
from model_answer import Settings
from test_runtime import Clock,SCOPE
from test_template_only import Transport as BaseTransport,selection
from economics_ledger.test_tariffs import price
import tariff_source_runtime as leaf

class Transport(BaseTransport):
 def __init__(self):
  super().__init__();self.selection=selection(['B01.ordered_units'],inputs={'period':{'from':'2026-11-13','to':'2026-11-13'}})
  self.pages=[{'items':[price(acquiring=Decimal('17.400000001'))],'cursor':'','total':1}]
  self.revoke=None;self.fail_once=False;self.mapping={1001:101};self.mutate=None
 def execute(self,request,store):
  if request.operation not in ('read.ozon.product_prices_bulk','read.ozon.seller_product_info_list'):return super().execute(request,store)
  self.calls.append(request)
  if self.revoke:self.revoke()
  if self.fail_once:self.fail_once=False;raise CallError('HTTP_429',status=429,retry_at=0)
  if request.operation.endswith('product_prices_bulk'):
   cursor=request.body['params']['cursor'];index=0 if not cursor else int(cursor.split('-')[1]);value=deepcopy(self.pages[index])
  else:value={'items':[{'id':int(pid),'sku':self.mapping[int(pid)],'name':'PRIVATE PRODUCT NAME'}for pid in request.body['params']['product_id']]}
  if self.mutate:self.mutate(request,value)
  return value,{'status':200,'bytes':500,'elapsed_ms':1}

class TariffWorker(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.clock=Clock();self.clock.now=datetime(2026,11,15,6,tzinfo=timezone.utc).timestamp();self.scope=SCOPE
  self.repo=Repository(Path(self.tmp.name)/'state.sqlite3',self.clock)
  self.engine=Engine(self.repo,lambda t:self.scope,answer_settings=Settings(Path(self.tmp.name)/'answer.json'),template_mode=True)
  self.transport=Transport();self.worker=Worker(self.engine,self.transport);self.permission=True;self.saved=None;self.output=None;self.crash=False
  q='Расчёт экономики Ozon за вчера';reply=self.engine.safe_submit('A',q,'r15-tariffs',fingerprint(q),date(2026,11,15),conversation_id='r15-source-fixture',message_id=1)
  self.jid=reply['job_id'];self.worker.step();self.root=strict_json(self.repo.get('A',self.jid)['plan']);self.desc=leaf.descriptor(self.root,'oz1')
 def tearDown(self):self.tmp.cleanup()
 def once(self):
  before=self.repo.get('A',self.jid);self.clock.advance(max(2,before['due']-self.clock()+1));row=self.repo.claim();self.assertIsNotNone(row)
  progress=strict_json(row['progress'])if row['progress']else{}
  def save(packed):self.saved=packed;progress['_tariffs']=packed;self.repo.reschedule(row['id'],row['owner'],progress)
  def complete(value,packed):
   if self.crash:raise SystemExit('SYNTHETIC_PARENT_CRASH')
   self.output=value;self.saved=packed;self.repo.complete_answer(row['id'],row['owner'],{'complete':True,'pages':['Verified tariff source'],'data':value.checkpoint()})
  try:leaf.step(self.worker,row,self.root,self.desc,progress.get('_tariffs'),authorize=lambda:self.permission,save_progress=save,on_complete=complete)
  except Deferred as error:self.repo.reschedule(row['id'],row['owner'],until=error.until)
 def finish(self):
  for _ in range(12):
   if self.output:return self.output
   self.once()
  self.fail('unfinished source')
 def calls(self):return [r for r in self.transport.calls if r.store_id]
 def test_exact_price_and_separate_sku_mapping_same_job(self):
  value=self.finish();self.assertEqual(len(value.data['rows']),2);self.assertEqual({r['sku']for r in value.data['rows']},{'101'})
  self.assertEqual({r['fields']['acquiring_per_unit']for r in value.data['rows']},{'17.400000001'})
  self.assertEqual(len(self.calls()),2)
  with self.repo.connection()as c:self.assertEqual(c.execute('SELECT COUNT(*)FROM jobs').fetchone()[0],1)
 def test_original_finance_estimate_not_historical_debit(self):
  value=self.finish();self.assertFalse(value.data['historical_actual']);self.assertEqual(value.data['basis'],'CURRENT_QUOTE_NOT_HISTORICAL_ACTUAL')
 def test_restart_after_price_no_refetch(self):
  self.once();self.worker=Worker(self.engine,self.transport);self.finish();self.assertEqual(len(self.calls()),2)
 def test_restart_after_mapping_no_refetch(self):
  self.once();self.once();self.worker=Worker(self.engine,self.transport);self.finish();self.assertEqual(len(self.calls()),2)
 def test_parent_crash_does_not_repeat_provider(self):
  self.once();self.once();self.crash=True
  with self.assertRaises(SystemExit):self.once()
  self.crash=False;self.clock.advance(125);self.finish();self.assertEqual(len(self.calls()),2)
 def test_complete_cursor_chain_before_mapping(self):
  self.transport.pages=[{'items':[price()],'cursor':'page-1','total':2},{'items':[price(1002)],'cursor':'','total':2}];self.transport.mapping[1002]=102
  value=self.finish();self.assertEqual(len(value.data['rows']),4);self.assertEqual([x.operation for x in self.calls()],['read.ozon.product_prices_bulk']*2+['read.ozon.seller_product_info_list'])
 def test_terminal_empty_page_supported(self):
  self.transport.pages=[{'items':[price()],'cursor':'page-1','total':1},{'items':[],'cursor':'','total':1}]
  self.finish();self.assertEqual(len(self.calls()),3)
 def test_cursor_stall_rejected(self):
  self.transport.pages=[{'items':[price()],'cursor':'page-1','total':3},{'items':[price(1002)],'cursor':'page-1','total':3}]
  with self.assertRaises(Rejected)as error:self.finish()
  self.assertEqual(error.exception.code,'TARIFF_CURSOR_CHAIN')
 def test_incomplete_total_not_complete(self):
  self.transport.pages[0]['total']=2
  with self.assertRaises(Rejected)as error:self.finish()
  self.assertEqual(error.exception.code,'TARIFF_TOTAL_INCOMPLETE')
 def test_changed_total_rejected(self):
  self.transport.pages=[{'items':[price()],'cursor':'page-1','total':2},{'items':[price(1002)],'cursor':'','total':3}]
  with self.assertRaises(Rejected)as error:self.finish()
  self.assertEqual(error.exception.code,'TARIFF_TOTAL_CHANGED')
 def test_missing_mapping_not_an_inferred_sku(self):
  self.transport.mutate=lambda request,value:value.update(items=[])if request.operation.endswith('seller_product_info_list')else None
  with self.assertRaises(Rejected)as error:self.finish()
  self.assertEqual(error.exception.code,'TARIFF_PRODUCT_MAPPING_INCOMPLETE')
 def test_malformed_price_row_is_typed_response_error(self):
  self.transport.pages[0]['items']=[None]
  with self.assertRaises(Rejected)as error:self.finish()
  self.assertEqual(error.exception.code,'TARIFF_RESPONSE_SCHEMA');self.assertEqual(len(self.calls()),1)
 def test_malformed_product_row_is_typed_response_error(self):
  self.transport.mutate=lambda request,value:value.update(items=[None])if request.operation.endswith('seller_product_info_list')else None
  with self.assertRaises(Rejected)as error:self.finish()
  self.assertEqual(error.exception.code,'TARIFF_PRODUCT_RESPONSE');self.assertEqual(len(self.calls()),2)
 def test_unrequested_mapping_rejected(self):
  self.transport.mutate=lambda request,value:value['items'][0].update(id=9999)if request.operation.endswith('seller_product_info_list')else None
  with self.assertRaises(Rejected):self.finish()
 def test_duplicate_sku_mapping_rejected(self):
  self.transport.pages[0].update(items=[price(),price(1002)],total=2);self.transport.mapping[1002]=101
  with self.assertRaises(Rejected)as error:self.finish()
  self.assertEqual(error.exception.code,'TARIFF_SKU_MAPPING_AMBIGUOUS')
 def test_absent_acquiring_not_zero(self):
  self.transport.pages[0]['items'][0].pop('acquiring')
  with self.assertRaises(Rejected)as error:self.finish()
  self.assertEqual(error.exception.code,'TARIFF_FIELD_MISSING_OR_INVALID')
 def test_explicit_zero_remains_available(self):
  self.transport.pages[0]['items'][0]['acquiring']=0
  self.assertEqual(self.finish().data['rows'][0]['fields']['acquiring_per_unit'],'0')
 def test_permission_revoked_before_send(self):
  self.permission=False
  with self.assertRaises(Rejected):self.once()
  self.assertEqual(self.calls(),[])
 def test_permission_revoked_after_response(self):
  self.transport.revoke=lambda:setattr(self,'permission',False)
  with self.assertRaises(Rejected):self.once()
  self.assertIsNone(self.saved)
 def test_permission_revoked_before_restore(self):
  self.once();self.once();self.permission=False
  with self.assertRaises(Rejected):self.once()
 def test_scope_revision_changed(self):
  self.once();self.scope=replace(self.scope,revision='revoked')
  with self.assertRaises(Rejected):self.once()
  self.assertEqual(len(self.calls()),1)
 def test_receipt_moved_to_other_job_rejected(self):
  self.once();self.once()
  with self.repo.connection(True)as c:c.execute("UPDATE calls SET jid='foreign'WHERE source NOT LIKE 'model:%'")
  with self.assertRaises(Rejected):self.once()
 def test_receipt_failed_status_rejected(self):
  self.once();self.once()
  with self.repo.connection(True)as c:c.execute("UPDATE calls SET http=500 WHERE source NOT LIKE 'model:%'")
  with self.assertRaises(Rejected):self.once()
 def test_protected_progress_and_no_raw_capture(self):
  self.once();self.once();raw=self.repo.get('A',self.jid)['progress'];self.assertNotIn('PRIVATE',raw);self.assertNotIn('17.400000001',raw);self.assertNotIn('_answer_api_data',raw)
  self.finish();self.assertNotIn('PRIVATE',json.dumps(self.output.checkpoint()))
 def test_same_packets_reused_for_new_coefficients(self):
  self.once();self.once();row=self.repo.get('A',self.jid)
  a=leaf.restore(self.worker,row,self.root,self.desc,self.saved,authorize=lambda:True)
  b=leaf.restore(self.worker,row,self.root,self.desc,self.saved,authorize=lambda:True)
  self.assertEqual(a.checkpoint(),b.checkpoint());self.assertEqual(len(self.calls()),2)
 def test_existing_retry_after_429(self):
  self.transport.fail_once=True;self.finish();self.assertEqual(len(self.calls()),3)
 def test_tampered_protected_checkpoint_rejected(self):
  self.once();self.saved['cipher']=self.saved['cipher'][:-4]+'AAAA'
  with self.assertRaises(Rejected):leaf.restore(self.worker,self.repo.get('A',self.jid),self.root,self.desc,self.saved,authorize=lambda:True)
