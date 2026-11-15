from copy import deepcopy
from hashlib import sha256
from unittest import TestCase
import json,hmac
from alisa_platform.owner_data import economics_tariffs as t,economics_cohort as e
from economics_cohort import fixtures as f
TARGET=deepcopy(f.TARGET)

def encode(kind,v):return hmac.new(b'synthetic-tariff-encoding',(kind+'\0'+v).encode(),'sha256').hexdigest()
def price(pid=1001,acquiring='17.4'):
 return {'product_id':pid,'offer_id':'PRIVATE-OFFER','price':{'currency_code':'RUB','price':'1740'},'acquiring':acquiring,
  'commissions':{'sales_percent_fbo':'50','sales_percent_fbs':'45','fbo_return_flow_amount':'99','fbs_return_flow_amount':'282',
                 'fbs_first_mile_min_amount':'0','fbs_first_mile_max_amount':'10'}}
def packet(op,data,req,rid,scope=None):
 raw=json.dumps(data).encode();return {'operation':op,'scope':deepcopy(scope or TARGET),'request':req,'body':raw,'received_at':'2026-11-15T00:00:00Z','receipt_id':rid,'response_sha256':sha256(raw).hexdigest(),'http':200}
def fixtures():
 p=packet('product_prices_bulk',{'items':[price()],'cursor':'','total':1,'total_items':1},{'filter':{'visibility':'ALL'},'cursor':'','limit':1000},'price-receipt')
 m=packet('seller_product_info_list',{'items':[{'id':1001,'sku':101,'name':'PRIVATE ITEM NAME'}]},{'product_id':['1001']},'mapping-receipt')
 return [p],[m]
def change(p,fn):
 v=json.loads(p['body']);fn(v);p['body']=json.dumps(v).encode();p['response_sha256']=sha256(p['body']).hexdigest()
def normalize(p=None,m=None):
 a,b=fixtures();p=a if p is None else p;m=b if m is None else m;known={x['receipt_id']:deepcopy(x)for x in p+m}
 return t.normalize(p,m,TARGET,verify=lambda x:x==known[x['receipt_id']],encode=encode)

class Tariffs(TestCase):
 def test_acquiring_is_rubles_not_percentage(self):
  rows=normalize().data['rows'];self.assertEqual(len(rows),2);self.assertEqual({x['fields']['acquiring_per_unit']for x in rows},{'17.4'})
 def test_fbo_and_fbs_fields_are_independent(self):
  r={x['scheme']:x['fields']for x in normalize().data['rows']};self.assertEqual(r['fbo']['commission_percent'],'50');self.assertEqual(r['fbs']['commission_percent'],'45');self.assertEqual(r['fbs']['processing_max'],'10');self.assertEqual(r['fbo']['processing_max'],'0')
 def test_zero_acquiring_is_known_zero(self):
  p,m=fixtures();change(p[0],lambda x:x['items'][0].update(acquiring=0));self.assertEqual(normalize(p,m).data['rows'][0]['fields']['acquiring_per_unit'],'0')
 def test_absent_acquiring_not_zero(self):
  p,m=fixtures();change(p[0],lambda x:x['items'][0].pop('acquiring'))
  with self.assertRaises(t.TariffError):normalize(p,m)
 def test_null_acquiring_not_zero(self):
  p,m=fixtures();change(p[0],lambda x:x['items'][0].update(acquiring=None))
  with self.assertRaises(t.TariffError):normalize(p,m)
 def test_product_id_not_misrepresented_as_sku(self):
  self.assertEqual({x['sku']for x in normalize().data['rows']},{'101'})
 def test_price_without_mapping_denied(self):
  with self.assertRaises(t.TariffError):normalize(m=[])
 def test_missing_requested_product_denied(self):
  p,m=fixtures();change(m[0],lambda x:x.update(items=[]))
  with self.assertRaises(t.TariffError):normalize(p,m)
 def test_returned_unrequested_product_denied(self):
  p,m=fixtures();change(m[0],lambda x:x['items'][0].update(id=1002))
  with self.assertRaises(t.TariffError):normalize(p,m)
 def test_duplicate_price_not_silently_latest(self):
  p,m=fixtures();change(p[0],lambda x:x['items'].append(deepcopy(x['items'][0])))
  with self.assertRaises(t.TariffError):normalize(p,m)
 def test_two_products_same_sku_is_not_arbitrary_quote(self):
  p,m=fixtures();change(p[0],lambda x:(x['items'].append(price(1002)),x.update(total=2,total_items=2)));m[0]['request']['product_id'].append('1002');change(m[0],lambda x:x['items'].append({'id':1002,'sku':101}))
  with self.assertRaises(t.TariffError):normalize(p,m)
 def test_terminated_multi_page_chain(self):
  p,m=fixtures();change(p[0],lambda x:x.update(cursor='next'));p.append(packet('product_prices_bulk',{'items':[],'cursor':'','total':1,'total_items':1},{'filter':{'visibility':'ALL'},'cursor':'next','limit':1000},'price-last'))
  self.assertEqual(len(normalize(p,m).data['rows']),2)
 def test_nonterminal_final_page_not_complete(self):
  p,m=fixtures();change(p[0],lambda x:x.update(cursor='next'))
  with self.assertRaises(t.TariffError):normalize(p,m)
 def test_wrong_start_cursor_denied(self):
  p,m=fixtures();p[0]['request']['cursor']='skip-first'
  with self.assertRaises(t.TariffError):normalize(p,m)
 def test_total_not_silently_truncated(self):
  p,m=fixtures();change(p[0],lambda x:x.update(total=2,total_items=2))
  with self.assertRaises(t.TariffError):normalize(p,m)
 def test_response_json_numbers_exact(self):
  p,m=fixtures();raw=p[0]['body'].replace(b'"17.4"',b'17.4');p[0]['body']=raw;p[0]['response_sha256']=sha256(raw).hexdigest();self.assertEqual(normalize(p,m).data['rows'][0]['fields']['acquiring_per_unit'],'17.4')
 def test_boolean_not_numeric_acquiring(self):
  p,m=fixtures();change(p[0],lambda x:x['items'][0].update(acquiring=True))
  with self.assertRaises(t.TariffError):normalize(p,m)
 def test_negative_acquiring_denied(self):
  p,m=fixtures();change(p[0],lambda x:x['items'][0].update(acquiring='-1'))
  with self.assertRaises(t.TariffError):normalize(p,m)
 def test_wrong_currency_denied(self):
  p,m=fixtures();change(p[0],lambda x:x['items'][0]['price'].update(currency_code='USD'))
  with self.assertRaises(t.TariffError):normalize(p,m)
 def test_range_inverted_denied(self):
  p,m=fixtures();change(p[0],lambda x:x['items'][0]['commissions'].update(fbs_first_mile_min_amount='12'))
  with self.assertRaises(t.TariffError):normalize(p,m)
 def test_percent_above100_denied(self):
  p,m=fixtures();change(p[0],lambda x:x['items'][0]['commissions'].update(sales_percent_fbo='101'))
  with self.assertRaises(t.TariffError):normalize(p,m)
 def test_wrong_scope_denied(self):
  p,m=fixtures();p[0]['scope']['store_id']='foreign'
  with self.assertRaises(t.TariffError):normalize(p,m)
 def test_receipt_refusal_denies_source(self):
  p,m=fixtures()
  with self.assertRaises(t.TariffError):t.normalize(p,m,TARGET,verify=lambda x:False,encode=encode)
 def test_content_hash_mismatch_denied(self):
  p,m=fixtures();p[0]['body']+=b' '
  with self.assertRaises(t.TariffError):normalize(p,m)
 def test_raw_receipt_not_leaked_in_checkpoint(self):
  p,m=fixtures();p[0]['receipt_id']='person@example.invalid';q=normalize(p,m);s=json.dumps(q.checkpoint());self.assertNotIn('person@example.invalid',s);self.assertNotIn('17.4',s);self.assertNotIn('PRIVATE',s)
 def test_constructor_without_seal_not_a_source(self):
  with self.assertRaises(t.TariffError):t.CurrentTariffs(normalize().payload_json).checkpoint()
 def test_revised_quote_snapshot_is_not_added_to_old(self):
  p,m=fixtures();first=normalize(p,m);change(p[0],lambda x:x['items'][0].update(acquiring='19'));second=normalize(p,m)
  self.assertNotEqual(first.checkpoint(),second.checkpoint());self.assertEqual(second.data['rows'][0]['fields']['acquiring_per_unit'],'19')
 def test_old_order_period_does_not_make_quote_historical_actual(self):
  q=normalize();out=q.for_cohort([f.order()],f.PERIOD,TARGET);self.assertEqual(out['observed_at'],'2026-11-15T00:00:00Z');self.assertEqual(out['period'],f.PERIOD);self.assertFalse(q.data['historical_actual']);self.assertEqual(q.data['basis'],'CURRENT_QUOTE_NOT_HISTORICAL_ACTUAL')
 def test_cohort_missing_sku_not_filled_by_other_price(self):
  with self.assertRaises(t.TariffError):normalize().for_cohort([f.order(sku='999')],f.PERIOD,TARGET)
 def test_quote_inputs_reach_existing_formula_without_loss_discount(self):
  q=normalize();b=f.bundle();b['tariffs']=q.for_cohort(b['orders']['rows'],f.PERIOD,TARGET);out=f.calculated(b)
  self.assertEqual(out['scenarios']['with_loss']['totals']['acquiring'],'34.8');self.assertEqual(out['scenarios']['without_loss']['totals']['acquiring'],'34.8')
 def test_actual_qualified_acquiring_still_wins_estimate(self):
  q=normalize();b=f.bundle(fees=[f.event(typ=1,amount='-12')]);b['tariffs']=q.for_cohort(b['orders']['rows'],f.PERIOD,TARGET);qualified=f.qualify(b);self.assertEqual(qualified.rows[0]['inputs']['acquiring'],'12')
 def test_source_input_unchanged(self):
  p,m=fixtures();before=deepcopy((p,m));normalize(p,m);self.assertEqual((p,m),before)
