"""Read-only catalogue decoder and fixed endpoint tests; no external requests."""
from pathlib import Path
from copy import deepcopy
import json,sys,unittest,uuid
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'runtime'))
from product_catalog import CatalogReader,validate,safe_result,VERSION,PAGE
class Tests(unittest.TestCase):
 def setUp(self):
  self.message={'schema_version':VERSION,'operation':'product_catalog','pins':{'environment':'dev','product_id':'alisa_market','tenant_id':str(uuid.uuid4()),'store_id':str(uuid.uuid4()),'provider':'OZON','kind':'SELLER','credential_revision':1,'store_revision':1,'request_id':str(uuid.uuid4())},'credential':{'client_id':'123','api_key':'synthetic-api-key-12345'},'cursor':{}}
  self.responses=[{'result':{'items':[{'product_id':10,'offer_id':'ART'}],'total':1,'last_id':''}},{'items':[{'id':10,'name':'Товар','offer_id':'ART','sources':[{'sku':777}]}]}];self.calls=[]
 def exchange(self,request,**kwargs):
  self.calls.append((request.full_url,json.loads(request.data),kwargs));return json.dumps(self.responses.pop(0)).encode(),200
 def runpage(self):return CatalogReader(self.exchange).page(self.message,'dev')
 def test_ozon_name_article_sku(self):
  r=self.runpage();self.assertEqual(r['items'],[{'sku':'777','name':'Товар','offer_id':'ART'}]);self.assertTrue(r['complete']);self.assertEqual(len(self.calls),2)
 def test_fixed_two_read_only_paths(self):
  self.runpage();self.assertEqual([x[0]for x in self.calls],['https://api-seller.ozon.ru/v3/product/list','https://api-seller.ozon.ru/v3/product/info/list']);self.assertEqual(self.calls[0][1]['limit'],PAGE)
 def test_shared_total_deadline(self):
  self.runpage();self.assertEqual(self.calls[0][2]['deadline'],self.calls[1][2]['deadline']);self.assertLessEqual(self.calls[0][2]['timeout'],3.4)
 def test_empty_catalog_not_second_call(self):
  self.responses=[{'result':{'items':[],'total':0,'last_id':''}}];r=self.runpage();self.assertEqual(r['items'],[]);self.assertTrue(r['complete']);self.assertEqual(len(self.calls),1)
 def test_missing_sku_not_fake_product_id(self):
  self.responses[1]['items'][0]['sources']=[];self.assertEqual(self.runpage()['code'],'CATALOG_INCOMPLETE')
 def test_wrong_product_id_denied(self):
  self.responses[1]['items'][0]['id']=11;self.assertEqual(self.runpage()['code'],'CATALOG_INCOMPLETE')
 def test_duplicate_skus_denied(self):
  self.responses[0]['result']['items'].append({'product_id':11});self.responses[0]['result']['total']=2;self.responses[1]['items'].append({**self.responses[1]['items'][0],'id':11});self.assertEqual(self.runpage()['code'],'CATALOG_INCOMPLETE')
 def test_partial_page_is_marked(self):
  self.responses[0]['result'].update(total=21,last_id='next');r=self.runpage();self.assertFalse(r['complete']);self.assertEqual(r['cursor'],{'last_id':'next','offset':1,'total':21})
 def test_pagination_total_change_fails(self):
  self.message['cursor']={'last_id':'old','offset':20,'total':40};self.assertEqual(self.runpage()['code'],'CATALOG_INCOMPLETE')
 def test_no_arbitrary_endpoint(self):
  self.message['url']='https://bad.invalid'
  with self.assertRaises(ValueError):self.runpage()
  self.assertEqual(self.calls,[])
 def test_performance_not_a_catalog_credential(self):
  self.message['pins']['kind']='PERFORMANCE';self.message['credential']={'client_id':'123','client_secret':'synthetic-api-key-12345'}
  with self.assertRaises(ValueError):self.runpage()
  self.assertEqual(self.calls,[])
 def test_env_mismatch(self):
  with self.assertRaises(ValueError):validate(self.message,'prod')
 def test_wb_active_cards_names_and_nmid(self):
  self.message['pins'].update(provider='WB',kind='WB');self.message['credential']={'token':'synthetic-token-12345'};self.responses=[{'cards':[{'nmID':55,'title':'Карточка WB','vendorCode':'WB-1'}],'cursor':{'total':1}}];r=self.runpage();self.assertEqual(r['items'][0]['sku'],'55');self.assertEqual(len(self.calls),1)
 def test_provider_bad_shape_is_not_empty(self):self.responses=[{}];self.assertEqual(self.runpage()['code'],'CATALOG_INCOMPLETE')
 def test_unsafe_result_unknown_fields(self):self.assertFalse(safe_result({'code':'OK','items':[],'cursor':{},'complete':True,'secret':'no'}))
 def test_unsafe_result_control_characters(self):self.assertFalse(safe_result({'code':'OK','items':[{'sku':'1','name':'x\nprivate','offer_id':'a'}],'cursor':{},'complete':True}))
 def test_redirect_or_error_not_retried(self):
  import urllib.error
  def reject(*a,**k):self.calls.append('call');raise urllib.error.HTTPError('fixed',429,'',{},None)
  r=CatalogReader(reject).page(self.message,'dev');self.assertEqual(r['code'],'RATE_LIMITED');self.assertEqual(len(self.calls),1)
 def test_ambiguous403_not_guessed_scope(self):
  import urllib.error
  r=CatalogReader(lambda *a,**k:(_ for _ in ()).throw(urllib.error.HTTPError('fixed',403,'',{},None))).page(self.message,'dev');self.assertEqual(r['code'],'CHECK_UNAVAILABLE')
if __name__=='__main__':
 r=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests));print(json.dumps({'status':'PASS'if r.wasSuccessful()else'FAIL','tests':r.testsRun,'provider_http':0}));raise SystemExit(0 if r.wasSuccessful()else 1)
