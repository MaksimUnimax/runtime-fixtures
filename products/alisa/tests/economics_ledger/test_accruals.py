from copy import deepcopy
from hashlib import sha256
from unittest import TestCase
import json
from alisa_platform.owner_data import economics_accruals as a

SCOPE={'tenant_id':'synthetic-tenant','store_id':'synthetic-store','provider':'OZON','currency':'RUB'}
PERIOD={'from':'2026-11-13','to':'2026-11-13'}
STAMP='2026-11-14T06:00:00+00:00'
NOW='2026-11-14T06:01:00+00:00'
def encode(kind,value):return sha256((kind+':'+str(value)).encode()).hexdigest()
def money(amount):return {'amount':amount,'currency':'RUB'}
def fee(t=1,amount='-17.4'):return {'type_id':t,'accrued':money(amount)}
def record(id=1,category='POSTING',day='2026-11-13'):
 r={'accrual_id':id,'date':day,'unit_number':'PRIVATE-POSTING-901','total_amount':money('650'),
    'accrued_category':category,'posting':None,'item_fees':None,'non_item_fee':None,'container_fees':None}
 if category=='POSTING':r['posting']={'delivery_schema':'Fbo','products':[{'sku':123,'quantity':1,'delivery':{'total_accrued':money('-100'),'services':[fee(32,'-100')]},'commission':{'sale_commission':money('-850'),'commission':money('-850'),'seller_price':money('1700')}}]}
 if category=='ITEM':r['item_fees']={'fees':[{'sku':123,'quantity':1,'fees':[fee()]}]}
 if category=='NON_ITEM':r['non_item_fee']=fee(93,'-35')
 return r

def page(rows=None,day='2026-11-13',cursor='',next_cursor='',rid='1'):
 return {'operation':a.OPERATION,'scope':deepcopy(SCOPE),'request':{'date':day,'last_id':cursor},'data':{'accruals':[record(day=day)]if rows is None else rows,'last_id':next_cursor},'received_at':STAMP,'receipt_id':rid}

def normalize(pages,period=None,**kwargs):
 admitted={p['receipt_id']:a.digest(p)for p in pages}
 return a.normalize(pages,SCOPE,period or PERIOD,verify=lambda p:admitted.get(p['receipt_id'])==a.digest(p),encode=encode,as_of=NOW,**kwargs)

class SourceIdentities(TestCase):
 def test_real_schema_parent_and_semantic_slots(self):
  out=normalize([page()]);self.assertEqual(out.data['records'],1);self.assertEqual(out.data['components'],2);self.assertFalse(out.data['original_economics_ready'])
 def test_alias_commission_not_counted_twice(self):
  out=normalize([page()]);self.assertEqual([x['amount']for x in out.data['observations']if x['type_id']==69],['-850'])
 def test_same_money_distinct_source_ids_kept(self):
  out=normalize([page([record(1),record(2)])]);self.assertEqual(out.data['records'],2);self.assertEqual(out.data['components'],4)
 def test_identical_retrieval_duplicate_deduplicated(self):
  out=normalize([page([record(),record()])]);self.assertEqual(out.data['records'],1);self.assertEqual(out.data['duplicate_records'],1)
 def test_duplicate_across_pages_not_recounted(self):
  out=normalize([page([record()],next_cursor='next'),page([record()],cursor='next',rid='2')]);self.assertEqual(out.data['records'],1);self.assertEqual(out.data['duplicate_records'],1)
 def test_same_source_id_changed_money_not_latest_wins(self):
  r=record();r['posting']['products'][0]['commission']['sale_commission']=money('-800')
  with self.assertRaises(a.AccrualError)as e:normalize([page([record(),r])])
  self.assertEqual(e.exception.code,'ACCRUAL_ID_CONTENT_CHANGED')
 def test_same_source_id_changed_nonselected_money_detected(self):
  r=record();r['posting']['products'][0]['commission']['seller_price']=money('1900')
  with self.assertRaises(a.AccrualError):normalize([page([record(),r])])
 def test_identifier_not_derived_from_amount(self):
  r=record();r['posting']['products'][0]['commission']['sale_commission']=money('-800')
  ids=lambda x:{r['type_id']:r['id']for r in normalize([page([x])]).data['observations']}
  self.assertEqual(ids(record()),ids(r))
 def test_identifier_not_derived_from_array_position(self):
  r=record();r['posting']['products'][0]['delivery']['services'].append(fee(29,'-9'));rev=deepcopy(r);rev['posting']['products'][0]['delivery']['services'].reverse()
  self.assertEqual(normalize([page([r])]).data['observations'],normalize([page([rev])]).data['observations'])
 def test_same_component_twice_in_source_is_ambiguous(self):
  r=record();r['posting']['products'][0]['delivery']['services'].append(fee(32,'-100'))
  with self.assertRaises(a.AccrualError)as e:normalize([page([r])])
  self.assertEqual(e.exception.code,'ACCRUAL_COMPONENT_ID_AMBIGUOUS')
 def test_duplicate_product_sku_ambiguous(self):
  r=record();r['posting']['products'].append(deepcopy(r['posting']['products'][0]))
  with self.assertRaises(a.AccrualError):normalize([page([r])])
 def test_acquiring_preserved_rubles_and_original_sign(self):
  obs=normalize([page([record(category='ITEM')])]).data['observations'][0];self.assertEqual(obs['amount'],'-17.4');self.assertEqual(obs['type_id'],1);self.assertIsNone(obs['scheme'])
 def test_non_item_no_sku_not_allocated_here(self):
  obs=normalize([page([record(category='NON_ITEM')])]).data['observations'][0];self.assertIsNone(obs['sku']);self.assertIsNone(obs['quantity']);self.assertEqual(obs['amount'],'-35')
 def test_item_schema_does_not_invent_fbo_from_no_scheme(self):
  obs=normalize([page([record(category='ITEM')])]).data['observations'][0];self.assertIsNone(obs['scheme'])
 def test_unbound_non_item_reference_absent_is_preserved(self):
  r=record(category='NON_ITEM');del r['unit_number'];self.assertIsNone(normalize([page([r])]).data['observations'][0]['unit_key'])
 def test_positive_zero_negative_never_assign_origin(self):
  for amount in ('10','0','-10'):
   r=record(category='ITEM');r['item_fees']['fees'][0]['fees'][0]['accrued']=money(amount)
   obs=normalize([page([r])]).data['observations'][0];self.assertEqual(obs['origin'],'UNCLASSIFIED');self.assertEqual(obs['amount'],amount)
 def test_original_fees_require_proof_not_complete_flag(self):
  with self.assertRaises(a.AccrualError)as e:normalize([page()]).qualified_original_fees()
  self.assertEqual(e.exception.code,a.REASON)
 def test_empty_complete_scan_does_not_assert_original_absence_forever(self):
  out=normalize([page([])]);self.assertTrue(out.data['pagination_complete']);self.assertEqual(out.data['records'],0);self.assertTrue(out.data['later_accruals_not_claimed_absent']);self.assertFalse(out.data['original_economics_ready'])
 def test_missing_days_rejected(self):
  with self.assertRaises(a.AccrualError):normalize([page([])],{'from':'2026-11-13','to':'2026-11-14'})
 def test_days_traversed_without_custom_day_cap(self):
  out=normalize([page([],rid='1'),page([],day='2026-11-14',rid='2')],{'from':'2026-11-13','to':'2026-11-14'});self.assertTrue(out.data['pagination_complete'])
 def test_page_gap_rejected(self):
  with self.assertRaises(a.AccrualError):normalize([page(next_cursor='a'),page(cursor='b',rid='2')])
 def test_nonempty_cursor_requires_next_page(self):
  with self.assertRaises(a.AccrualError):normalize([page(next_cursor='a')])
 def test_empty_nonterminal_page_is_not_success(self):
  with self.assertRaises(a.AccrualError):normalize([page([],next_cursor='a')])
 def test_cursor_loop_denied(self):
  with self.assertRaises(a.AccrualError):normalize([page(next_cursor='a'),page(cursor='a',next_cursor='a',rid='2')])
 def test_wrong_first_cursor_denied(self):
  with self.assertRaises(a.AccrualError):normalize([page(cursor='a')])
 def test_wrong_financial_day_denied(self):
  with self.assertRaises(a.AccrualError):normalize([page([record(day='2026-11-12')])])
 def test_extra_page_after_terminal_denied(self):
  with self.assertRaises(a.AccrualError):normalize([page(),page(rid='2')])
 def test_foreign_store_page_rejected(self):
  p=page();p['scope']['store_id']='other'
  with self.assertRaises(a.AccrualError):normalize([p])
 def test_aggregate_endpoint_not_substituted(self):
  p=page();p['operation']='finance_accrual_postings'
  with self.assertRaises(a.AccrualError):normalize([p])
 def test_boolean_identifier_not_integer(self):
  with self.assertRaises(a.AccrualError):normalize([page([record(True)])])
 def test_no_source_identifier_denied(self):
  r=record();del r['accrual_id']
  with self.assertRaises(a.AccrualError):normalize([page([r])])
 def test_container_or_unknown_category_not_silently_omitted(self):
  r=record();r['accrued_category']='CONTAINER'
  with self.assertRaises(a.AccrualError):normalize([page([r])])
 def test_wrong_currency_denied(self):
  r=record();r['total_amount']['currency']='USD'
  with self.assertRaises(a.AccrualError):normalize([page([r])])
 def test_binary_float_money_denied(self):
  r=record();r['total_amount']['amount']=1.1
  with self.assertRaises(a.c.ParameterError):normalize([page([r])])
 def test_source_future_observation_denied(self):
  p=page();p['received_at']='2026-11-15T00:00:00Z'
  with self.assertRaises(a.AccrualError):normalize([p])
 def test_verified_receipt_not_boolean_claim_in_payload(self):
  with self.assertRaises(a.AccrualError):a.normalize([page()],SCOPE,PERIOD,verify=lambda p:False,encode=encode,as_of=NOW)
 def test_receipt_exception_is_typed_denial(self):
  def failed(p):raise RuntimeError('private diagnostic')
  with self.assertRaises(a.AccrualError)as e:a.normalize([page()],SCOPE,PERIOD,verify=failed,encode=encode,as_of=NOW)
  self.assertEqual(e.exception.code,'ACCRUAL_RECEIPT_UNAVAILABLE')
 def test_id_encoder_required_to_hide_private_identifier(self):
  with self.assertRaises(a.AccrualError):a.normalize([page()],SCOPE,PERIOD,verify=lambda p:True,encode=lambda k,v:v,as_of=NOW)
 def test_private_identifiers_not_in_summary_or_observations(self):
  out=normalize([page()]);self.assertNotIn('PRIVATE-POSTING',out.payload_json);self.assertNotIn('PRIVATE-POSTING',repr(out));self.assertNotIn('observations',out.summary())
 def test_result_is_request_local_not_default_json_history(self):
  with self.assertRaises(TypeError):json.dumps(normalize([page()]))
 def test_input_not_changed(self):
  p=[page()];before=deepcopy(p);normalize(p);self.assertEqual(p,before)

 def test_receipt_cannot_back_two_pages(self):
  with self.assertRaises(a.AccrualError)as e:normalize([page(next_cursor='a'),page(cursor='a')])
  self.assertEqual(e.exception.code,'ACCRUAL_RECEIPT_REUSED')
 def test_nonobject_record_is_typed_schema_failure(self):
  with self.assertRaises(a.AccrualError)as e:normalize([page([None])])
  self.assertEqual(e.exception.code,'ACCRUAL_RECORD_SCHEMA')
