from unittest import TestCase
from copy import deepcopy
from decimal import Decimal
from hashlib import sha256
import json,hmac
from alisa_platform.owner_data import economics_realization as r,economics_cohort as e
from economics_cohort import fixtures as f
TARGET=deepcopy(f.TARGET)

def encode(kind,value):return hmac.new(b'only-synthetic-test-secret',(kind+'\0'+value).encode(),'sha256').hexdigest()
def side(q=2,fee='150',price='1000'):
 return {'quantity':q,'price_per_instance':price,'amount':str(Decimal(price)*q),'compensation':0,
         'commission':0,'bonus':0,'standard_fee':fee,'total':str(Decimal(price)*q-Decimal(fee)),
         'stars':0,'bank_coinvestment':0,'pick_up_point_coinvestment':0}
def row(posting='p1',sku=101,num=1,sale=True,returned=False,q=2,price='1000',ratio='0.075'):
 fee=str(Decimal(price)*q*Decimal(ratio));b=side(q,fee,price)
 return {'row_number':num,'item':{'name':'Synthetic item','offer_id':'Synthetic offer','barcode':'SYNTHETIC','sku':sku},
  'seller_price_per_instance':price,'delivery_commission':deepcopy(b)if sale else None,'return_commission':deepcopy(b)if returned else None,
  'commission_ratio':ratio,'order':{'posting_number':posting,'created_date':'2026-11-13'},'legal_entity_document':None}
def source(rows=None):
 header={k:'synthetic-redacted-header'for k in r.HEADER}
 header.update(number='synthetic-doc-1',doc_date='2026-11-30',start_date='2026-11-01',stop_date='2026-11-30',currency_sys_name='RUB')
 return {'header':header,'rows':deepcopy([row()]if rows is None else rows)}
def packet(data=None,kind='POSTING',scope=None):
 data=deepcopy(data or source())
 if kind=='MONTHLY':
  for x in data['rows']:
   x['rowNumber']=x.pop('row_number');x.pop('order');x.pop('legal_entity_document')
  data={'result':data}
 body=json.dumps(data,ensure_ascii=False,allow_nan=False).encode()
 return {'operation':'finance_realization_posting'if kind=='POSTING'else'finance_realization_v2',
  'scope':deepcopy(scope or TARGET),'request':{'month':11,'year':2026},'body':body,'received_at':'2026-12-06T10:00:00Z',
  'receipt_id':'receipt-'+kind,'response_sha256':sha256(body).hexdigest(),'http':200}
def normalized(data=None,kind='POSTING',scope=None):
 p=packet(data,kind,scope);expected=deepcopy(p);return r.normalize(p,verify=lambda x:x==expected,encode=encode)
def pair(data=None):return r.reconcile(normalized(data),normalized(data,'MONTHLY'))
def order(posting='p1',**kw):return f.order(posting=encode('posting',posting),**kw)

class Realization(TestCase):
 def reject(self,data,code=None):
  with self.assertRaises(r.RealizationError)as error:normalized(data)
  if code:self.assertEqual(error.exception.code,code)
 def test_direct_snapshot_uses_source_standard_fee_not_zero_commission(self):
  d=normalized().data['rows'][0]['sides']['SALE'];self.assertEqual(d['standard_fee'],'150');self.assertEqual(d['commission'],'0')
 def test_snapshot_does_not_claim_accrual_parent_or_acquiring(self):
  d=normalized().summary();self.assertFalse(d['original_accrual_relations_proven']);self.assertFalse(d['acquiring_present']);self.assertEqual(d['date_axis'],'REALIZATION_MONTH_NOT_ORDER_COHORT')
 def test_no_names_posting_numbers_tax_ids_in_normalized_data(self):
  d=normalized().payload_json
  for value in ['Synthetic item','Synthetic offer','SYNTHETIC','synthetic-redacted-header','synthetic-doc-1','"p1"']:self.assertNotIn(value,d)
 def test_original_body_and_request_not_mutated(self):
  p=packet();before=deepcopy(p);r.normalize(p,verify=lambda x:x==before,encode=encode);self.assertEqual(p,before)
 def test_malformed_schema_not_guessed(self):
  d=source();del d['rows'][0]['delivery_commission']['standard_fee'];self.reject(d,'REALIZATION_SCHEMA')
 def test_unknown_money_field_not_ignored(self):
  d=source();d['rows'][0]['delivery_commission']['additional_fee']='999';self.reject(d,'REALIZATION_SCHEMA')
 def test_wrong_period_refused(self):
  d=source();d['header']['stop_date']='2026-10-31';self.reject(d,'REALIZATION_PERIOD_MISMATCH')
 def test_wrong_currency_refused(self):
  d=source();d['header']['currency_sys_name']='USD';self.reject(d,'REALIZATION_CURRENCY')
 def test_current_month_not_mature_snapshot(self):
  p=packet();p['received_at']='2026-11-30T12:00:00Z'
  with self.assertRaises(r.RealizationError):r.normalize(p,verify=lambda x:True,encode=encode)
 def test_zero_padded_and_non_padded_order_dates_equivalent(self):
  d=source();d['rows'][0]['order']['created_date']='2026-9-3';self.assertEqual(normalized(d).data['rows'][0]['order_day'],'2026-09-03')
 def test_old_order_date_is_not_forced_into_month(self):
  d=source();d['rows'][0]['order']['created_date']='2026-09-30';self.assertEqual(normalized(d).data['rows'][0]['order_day'],'2026-09-30')
 def test_invalid_calendar_date_rejected(self):
  d=source();d['rows'][0]['order']['created_date']='2026-11-31';self.reject(d,'REALIZATION_DATE')
 def test_order_after_realization_month_rejected(self):
  d=source();d['rows'][0]['order']['created_date']='2026-12-01';self.reject(d,'REALIZATION_ORDER_AFTER_PERIOD')
 def test_duplicate_row_reference_rejected_not_sum(self):self.reject(source([row(),row()]),'REALIZATION_ROW_ID')
 def test_boolean_row_number_is_not_one(self):
  d=source();d['rows'][0]['row_number']=True;self.reject(d,'REALIZATION_ROW_ID')
 def test_boolean_quantity_is_not_one(self):
  d=source();d['rows'][0]['delivery_commission']['quantity']=True;self.reject(d,'REALIZATION_QUANTITY_UNCLASSIFIED')
 def test_zero_quantity_is_not_unknown_zero_cost(self):
  d=source();d['rows'][0]['delivery_commission']['quantity']=0;self.reject(d,'REALIZATION_QUANTITY_UNCLASSIFIED')
 def test_negative_fee_is_not_guessed_correction(self):
  d=source();d['rows'][0]['delivery_commission']['standard_fee']='-150';self.reject(d,'REALIZATION_SIGN_UNCLASSIFIED')
 def test_mismatching_base_commission_denied(self):
  d=source();d['rows'][0]['delivery_commission']['standard_fee']='151';self.reject(d,'REALIZATION_BASE_COMMISSION_UNRECONCILED')
 def test_amount_is_not_repeated_as_unit_price(self):
  d=source();d['rows'][0]['delivery_commission']['amount']='1000';self.reject(d,'REALIZATION_AMOUNT_UNRECONCILED')
 def test_zero_base_commission_is_known_zero(self):
  d=source([row(ratio='0')]);matched,_=r.commission_matches(pair(d),[order()],TARGET);self.assertEqual(next(iter(matched.values()))['sale_base_commission']['amount'],'0')
 def test_separate_sale_and_return_never_netted(self):
  d=source([row(returned=True)]);matched,_=r.commission_matches(pair(d),[order()],TARGET);self.assertEqual(next(iter(matched.values()))['sale_base_commission']['amount'],'150')
 def test_return_only_has_no_original_commission(self):
  matched,missing=r.commission_matches(pair(source([row(sale=False,returned=True)])),[order()],TARGET);self.assertEqual(matched,{});self.assertEqual(list(missing.values()),['RETURN_ONLY_NO_ORIGINAL_SALE'])
 def test_empty_report_is_not_zero_commission(self):
  matched,missing=r.commission_matches(pair(source([])),[order()],TARGET);self.assertEqual(matched,{});self.assertEqual(list(missing.values()),['NOT_IN_REALIZATION_SNAPSHOT'])
 def test_no_branches_is_not_empty_completed_sale(self):self.reject(source([row(sale=False)]),'REALIZATION_EMPTY_ROW')
 def test_receipt_boolean_claim_not_sufficient(self):
  with self.assertRaises(r.RealizationError):r.normalize(packet(),verify=lambda x:False,encode=encode)
 def test_receipt_unavailable_has_typed_error(self):
  def broken(x):raise RuntimeError('temporary')
  with self.assertRaises(r.RealizationError)as error:r.normalize(packet(),verify=broken,encode=encode)
  self.assertEqual(error.exception.code,'REALIZATION_RECEIPT_UNAVAILABLE')
 def test_missing_verifier_denied(self):
  with self.assertRaises(r.RealizationError):r.normalize(packet(),verify=None,encode=encode)
 def test_private_id_encoder_not_plaintext(self):
  with self.assertRaises(r.RealizationError):r.normalize(packet(),verify=lambda x:True,encode=lambda a,b:b)
 def test_hash_tamper_before_verifier_denied(self):
  p=packet();p['response_sha256']='a'*64;called=[]
  with self.assertRaises(r.RealizationError):r.normalize(p,verify=lambda x:called.append(x),encode=encode)
  self.assertEqual(called,[])
 def test_duplicate_json_key_rejected(self):
  p=packet();p['body']=b'{"header":{},"header":{},"rows":[]}';p['response_sha256']=sha256(p['body']).hexdigest()
  with self.assertRaises(r.RealizationError)as error:r.normalize(p,verify=lambda x:True,encode=encode)
  self.assertEqual(error.exception.code,'REALIZATION_DUPLICATE_JSON_KEY')
 def test_nan_json_refused(self):
  p=packet();p['body']=b'{"header":NaN,"rows":[]}';p['response_sha256']=sha256(p['body']).hexdigest()
  with self.assertRaises(r.RealizationError):r.normalize(p,verify=lambda x:True,encode=encode)
 def test_different_partition_can_reconcile(self):
  left=source([row(num=1,q=1),row(num=2,q=1)]);right=source([row(q=2)]);p=r.reconcile(normalized(left),normalized(right,'MONTHLY'));self.assertIsInstance(p,r.ReconciledRealization)
 def test_reconciliation_preserves_sku_not_only_total_money(self):
  a=source();b=source([row(sku=999)])
  with self.assertRaises(r.RealizationError):r.reconcile(normalized(a),normalized(b,'MONTHLY'))
 def test_reconciliation_preserves_sale_return_split(self):
  with self.assertRaises(r.RealizationError):r.reconcile(normalized(),normalized(source([row(sale=False,returned=True)]),'MONTHLY'))
 def test_mismatched_document_number_cannot_reconcile(self):
  b=source();b['header']['number']='other'
  with self.assertRaises(r.RealizationError):r.reconcile(normalized(),normalized(b,'MONTHLY'))
 def test_same_receipt_cannot_attest_both_documents(self):
  p=packet(kind='MONTHLY');p['receipt_id']='receipt-POSTING';monthly=r.normalize(p,verify=lambda x:True,encode=encode)
  with self.assertRaises(r.RealizationError):r.reconcile(normalized(),monthly)
 def test_foreign_store_cannot_reconcile(self):
  with self.assertRaises(r.RealizationError):r.reconcile(normalized(),normalized(kind='MONTHLY',scope={**TARGET,'store_id':'other'}))
 def test_unreconciled_single_report_not_accepted_as_pair(self):
  with self.assertRaises(r.RealizationError):r.commission_matches(normalized(),[order()],TARGET)
 def test_matching_needs_exact_original_quantity(self):
  matched,missing=r.commission_matches(pair(source([row(q=1)])),[order()],TARGET);self.assertEqual(matched,{});self.assertEqual(list(missing.values()),['PARTIAL_REALIZATION_NOT_FULL_ORIGINAL_QUANTITY'])
 def test_overlapping_report_quantity_rejected(self):
  with self.assertRaises(r.RealizationError):r.commission_matches(pair(source([row(q=3)])),[order()],TARGET)
 def test_wrong_order_price_rejected(self):
  with self.assertRaises(r.RealizationError):r.commission_matches(pair(),[order(price='999')],TARGET)
 def test_wrong_created_day_rejected(self):
  o=order();o['day']='2026-11-12'
  with self.assertRaises(r.RealizationError):r.commission_matches(pair(),[o],TARGET)
 def test_unscoped_posting_not_matchable(self):
  with self.assertRaises(r.RealizationError):r.commission_matches(pair(),[f.order()],TARGET)
 def test_distinct_order_missing_not_borrowed_by_sku_price(self):
  matched,missing=r.commission_matches(pair(),[order('another')],TARGET);self.assertEqual(matched,{});self.assertEqual(len(missing),1)
 def test_revised_document_is_snapshot_not_extra_event(self):
  old=normalized();changed=source();changed['rows'][0]['item']['offer_id']='new alias';new=normalized(changed)
  self.assertEqual(old.data['document_key'],new.data['document_key']);self.assertNotEqual(old.data['source_sha256'],new.data['source_sha256'])
 def test_no_arithmetic_values_in_checkpoint(self):
  text=json.dumps(pair().checkpoint());self.assertNotIn('standard_fee',text);self.assertNotIn('seller_price',text);self.assertNotIn('"150"',text)
 def test_snapshot_and_pair_not_json_serializable(self):
  for value in [normalized(),pair()]:
   with self.assertRaises(TypeError):json.dumps(value)
 def test_json_numeric_decimals_are_exact(self):
  p=packet(source([row(price='0.1',q=1,ratio='0.1')]))
  p['body']=p['body'].replace(b'"0.01"',b'0.01').replace(b'"0.1"',b'0.1');p['response_sha256']=sha256(p['body']).hexdigest()
  snap=r.normalize(p,verify=lambda x:True,encode=encode);self.assertEqual(snap.data['rows'][0]['sides']['SALE']['standard_fee'],'0.01')
 def test_moscow_date_not_utc_document_date(self):
  p=packet();p['received_at']='2026-11-30T21:05:00Z';body=json.loads(p['body']);body['header']['doc_date']='2026-12-1';p['body']=json.dumps(body).encode();p['response_sha256']=sha256(p['body']).hexdigest();self.assertEqual(r.normalize(p,verify=lambda x:True,encode=encode).data['document_date'],'2026-12-01')

class CohortBinding(TestCase):
 def calculation(self,data=None,document=None):
  data=data or f.bundle(rows=[order()]);q=e.qualify(data,TARGET,f.PERIOD,verify=f.attested(data),realization=document or pair());return q
 def test_document_base_commission_replaces_tariff_not_added(self):
  q=self.calculation();self.assertEqual(q.rows[0]['inputs']['commission_original'],'150');self.assertEqual(q.rows[0]['basis']['commission_original']['kind'],'REALIZATION_BASE_COMMISSION_SNAPSHOT')
 def test_commission_only_loss_scaled_once_after_source_binding(self):
  q=self.calculation(document=pair(source([row(returned=True)])));cost,coeff=f.numbers(q);answer=e.calculate(q,cost,coeff,f.unknown());self.assertEqual(answer['scenarios']['with_loss']['totals']['commission'],'120');self.assertEqual(answer['scenarios']['without_loss']['totals']['commission'],'150')
 def test_acquiring_still_uses_declared_ruble_tariff_not_commission_field(self):self.assertEqual(self.calculation().rows[0]['inputs']['acquiring'],'34.8')
 def test_no_matching_snapshot_keeps_labelled_tariff(self):
  q=self.calculation(document=pair(source([])));self.assertEqual(q.rows[0]['inputs']['commission_original'],'200');self.assertEqual(q.rows[0]['basis']['commission_original']['document_status'],'NOT_IN_REALIZATION_SNAPSHOT')
 def test_partial_snapshot_not_zero_or_actual_for_entire_order(self):
  q=self.calculation(document=pair(source([row(q=1)])));self.assertEqual(q.rows[0]['inputs']['commission_original'],'200');self.assertEqual(q.rows[0]['basis']['commission_original']['document_status'],'PARTIAL_REALIZATION_NOT_FULL_ORIGINAL_QUANTITY')
 def test_zero_snapshot_fee_wins_positive_tariff(self):self.assertEqual(self.calculation(document=pair(source([row(ratio='0')]))).rows[0]['inputs']['commission_original'],'0')
 def test_conflicting_original_debit_denied(self):
  b=f.bundle(rows=[order()],fees=[f.event(posting=encode('posting','p1'),amount='-200')])
  with self.assertRaises(e.EconomicsError)as error:self.calculation(b)
  self.assertEqual(error.exception.code,'ECONOMICS_COMMISSION_SOURCES_DISAGREE')
 def test_equal_debit_and_document_not_counted_twice(self):
  q=self.calculation(f.bundle(rows=[order()],fees=[f.event(posting=encode('posting','p1'))]));self.assertEqual(q.rows[0]['inputs']['commission_original'],'150')
 def test_document_source_fingerprints_retained_in_checkpoint(self):
  cp=self.calculation().checkpoint();self.assertEqual(len(cp['realization_document']['source_sha256']),2);self.assertNotIn('standard_fee',json.dumps(cp))
 def test_other_missing_period_costs_still_block_even_with_good_commission(self):
  b=f.bundle(rows=[order()]);b['period_costs']['rows']=[]
  with self.assertRaises(e.EconomicsError):self.calculation(b)
 def test_unqualified_fee_completeness_not_forged_by_good_document(self):
  b=f.bundle(rows=[order()]);b['fees']['complete']=False
  with self.assertRaises(e.EconomicsError):self.calculation(b)
 def test_wrong_scope_denied_in_cohort(self):
  bad=r.reconcile(normalized(scope={**TARGET,'tenant_id':'other'}),normalized(kind='MONTHLY',scope={**TARGET,'tenant_id':'other'}))
  with self.assertRaises(e.EconomicsError):self.calculation(document=bad)
 def test_ordinary_R10_without_document_unchanged(self):self.assertEqual(f.qualify().rows[0]['inputs']['commission_original'],'200')

class ReviewBoundary(TestCase):
 def test_public_snapshot_constructor_is_not_receipt_proof(self):
  good=normalized();forged=r.RealizationSnapshot(good.payload_json)
  with self.assertRaises(r.RealizationError):r.reconcile(forged,normalized(kind='MONTHLY'))
 def test_public_pair_constructor_is_not_reconciliation_proof(self):
  forged=r.ReconciledRealization(normalized(),normalized(kind='MONTHLY'))
  with self.assertRaises(r.RealizationError):r.commission_matches(forged,[order()],TARGET)
 def test_forged_pair_cannot_override_R10_commission(self):
  data=normalized().data;data['rows'][0]['sides']['SALE']['standard_fee']='999'
  forged=r.ReconciledRealization(r.RealizationSnapshot(e.c.CANON(data)),normalized(kind='MONTHLY'))
  bundle=f.bundle(rows=[order()])
  with self.assertRaises(e.EconomicsError):e.qualify(bundle,TARGET,f.PERIOD,verify=f.attested(bundle),realization=forged)
 def test_snapshot_copy_with_changed_payload_is_denied(self):
  from dataclasses import replace
  good=normalized();data=good.data;data['rows'][0]['sides']['SALE']['standard_fee']='999'
  changed=replace(good,payload_json=e.c.CANON(data))
  with self.assertRaises(r.RealizationError):r.reconcile(changed,normalized(kind='MONTHLY'))
 def test_snapshot_summary_cannot_hide_forged_content(self):
  with self.assertRaises(r.RealizationError):r.RealizationSnapshot(normalized().payload_json).summary()
 def test_receipt_identifier_is_encoded_not_copied(self):
  a=packet();a['receipt_id']='name@example.com'
  p=r.normalize(a,verify=lambda x:True,encode=encode);q=r.reconcile(p,normalized(kind='MONTHLY'))
  self.assertNotIn('name@example.com',p.payload_json);self.assertNotIn('name@example.com',json.dumps(q.checkpoint()))
 def test_pair_with_substituted_snapshot_cannot_reuse_seal(self):
  from dataclasses import replace
  good=pair();other=normalized(source([row(posting='p2')]))
  changed=replace(good,posting=other)
  with self.assertRaises(r.RealizationError):r.commission_matches(changed,[order('p2')],TARGET)
