"""Complete active-contract routing and secure original output, all fixtures synthetic."""
from copy import deepcopy
from dataclasses import asdict,replace
from pathlib import Path
from unittest.mock import patch
from datetime import date
import base64,io,json,os,stat,unittest,zipfile,gzip
import read_surface as rs
from semantics import Rejected,strict_json
from engine import Worker,CallError
from providers import Request
import protected_reads as pr
import report_tables
import test_read_transport as tf
import test_read_surface as wf

WB_PARAMS={'seller_users':{'query':{'limit':10,'offset':0,'isInviteOnly':False}},'dbw_warehouse_contacts':{'path':{'warehouseId':123}},'fbs_orders_client':{'body':{'orders':[123]}},'dbw_orders_client':{'body':{'orders':[123]}},'dbw_orders_courier':{'body':{'orders':[123]}},'dbs_orders_client':{'body':{'orders':[123]}},'dbs_orders_b2b_info':{'body':{'orders':[123]}},'pickup_orders_client':{'body':{'orders':[123]}},'buyer_chats':{},'buyer_chat_events':{'query':{'next':123}},'buyer_chat_download':{'path':{'id':'file-test-123'}},'subscriptions':{},'seller_rating':{},'tariff_constructor_options':{'query':{'locale':'ru'}}}

def example(schema):
 if 'enum'in schema:return schema['enum'][0]
 if '$ref'in schema:raise AssertionError('UNRESOLVED_REF')
 t=schema.get('type','object'if'properties'in schema else None)
 if t=='object':return {k:example(schema['properties'][k])for k in schema.get('required',[])}
 if t=='array':return [example(schema['items'])for _ in range(max(1,schema.get('minItems',0)))]
 if t in('integer','number'):return max(123,schema.get('minimum',1))
 if t=='boolean':return True
 return '123456'
WB_PARAMS['pickup_orders_client_identity']=example(rs.method('wb','pickup_orders_client_identity')['completion']['request_schema'])
WB_PARAMS['dbs_orders_b2b_info']=example(rs.method('wb','dbs_orders_b2b_info')['completion']['request_schema'])
class Contracts(unittest.TestCase):
 def test_total487_active_and3_retired(self):
  rows=[m for p in rs.CATALOG['providers'].values()for m in p['operations'].values()];self.assertEqual(len(rows),490);self.assertEqual(sum(rs.available(m)for m in rows),487);self.assertEqual(sum(m.get('completion',{}).get('mode')=='replaced'for m in rows),3)
 def test_retired_all_have_current_replacements(self):
  for a,m in rs.CATALOG['providers']['ozon']['operations'].items():
   if m.get('completion',{}).get('mode')!='replaced':continue
   with self.assertRaises(Rejected)as e:rs.build('ozon',a,{})
   self.assertEqual(e.exception.code,'READ_METHOD_REPLACED');self.assertTrue(all(rs.available(rs.method('ozon',x))for x in m['completion']['alternatives']))
 def test_wb_wrong_order_type(self):
  for value in ['123',[True],['123'],[9007199254740993]]:
   with self.assertRaises(Rejected):rs.build('wb','fbs_orders_client',{'body':{'orders':value}})
 def test_wb_unknown_body_not_ignored(self):
  with self.assertRaises(Rejected):rs.build('wb','fbs_orders_client',{'body':{'orders':[123],'write':True}})
 def test_wb_path_cannot_traverse(self):
  for value in ['../123','https://invalid.example','/..//',True]:
   with self.assertRaises(Rejected):rs.build('wb','dbw_warehouse_contacts',{'path':{'warehouseId':value}})
 def test_wb_unknown_headers_cannot_be_injected(self):
  for op in WB_PARAMS:
   with self.assertRaises(Rejected):rs.build('wb',op,{**WB_PARAMS[op],'headers':{'Authorization':'PRIVATE'}})
 def test_report_file_ref_not_url_or_cross_store_path(self):
  for ref in ['https://cdn1.ozone.ru/x','../../secret','raf_'+'a'*32,'rpf_short']:
   with self.assertRaises(Rejected):rs.build('ozon','report_file_get',{'file_ref':ref})
 def test_report_params_limits_are_documented_provider_slice(self):
  for p in [{'offset':-1},{'limit':0},{'limit':501},{'sheet':1},{'host':'evil'}]:
   with self.assertRaises(Rejected):rs.build('ozon','report_file_get',{'file_ref':'rpf_'+'a'*32,**p})
 def test_no_write_method_registered_by_completion(self):
  for p,a in [('ozon','chat_send_message'),('ozon','fbs_posting_product_exemplar_set'),('wb','create_invite'),('wb','orders_cancel')]:
   with self.assertRaises(Rejected):rs.build(p,a,{})
 def test_discovery_announces_protected_scope(self):
  d=next(x for x in rs.discover('wb','buyer_chats')['items']if x['operation']=='buyer_chats');self.assertEqual(d['completion']['response_scope'],'OWNER_ARTIFACT')

for platform,p in rs.CATALOG['providers'].items():
 for alias,meta in p['operations'].items():
  mode=meta.get('completion',{}).get('mode')
  if not mode or mode=='replaced':continue
  params=WB_PARAMS[alias]if platform=='wb'else{'file_ref':'rpf_'+'a'*32}if mode=='opaque-file'else meta['template']['params']
  def contract(self,p=platform,a=alias,params=params):
   b=rs.build(p,a,params);self.assertIn(b['method'],('GET','POST'));self.assertTrue(b['url'].startswith('https://'));self.assertEqual(b['headers'],{})
  setattr(Contracts,'test_contract_'+platform+'_'+alias,contract)

class Transport(unittest.TestCase):
 setUp=tf.ReadTransport.setUp;tearDown=tf.ReadTransport.tearDown
 def test_private_json_is_not_plain_result(self):
  req=rs.request_for(asdict(tf.WB),'buyer_chats',{})
  with patch('http_transport.read_response',return_value=(b'{"chats":[{"clientName":"PRIVATE_PERSON","text":"PRIVATE_TEXT"}]}',200)):
   value,meta=self.t.execute(req,asdict(tf.WB));self.assertIsInstance(value,pr.ProtectedPayload);self.assertNotIn('PRIVATE',repr(value));self.assertNotIn('PRIVATE',json.dumps(value.safe));self.assertIn(b'PRIVATE',value.raw)
 def test_document_binary_is_not_replaced_with_only_hash(self):
  req=rs.request_for(asdict(tf.OZ),'posting_fbs_package_label',{'posting_number':['123-1']})
  raw=b'%PDF-1.4\nPRIVATE_DOCUMENT\n%%EOF'
  with patch('http_transport.read_response',return_value=(raw,200)):
   value,_=self.t.execute(req,asdict(tf.OZ));self.assertIsInstance(value,pr.ProtectedPayload);self.assertEqual(value.raw,raw);self.assertEqual(value.mime,'application/pdf')
 def test_wb_service_never_falls_back_to_personal_token(self):
  for a in ['subscriptions','seller_rating','tariff_constructor_options']:
   req=rs.request_for(asdict(tf.WB),a,{})
   with patch('http_transport.read_response')as http:
    with self.assertRaises(CallError)as e:self.t.prepare(req,asdict(tf.WB))
    self.assertEqual(e.exception.code,'WB_SERVICE_CREDENTIAL_REQUIRED');http.assert_not_called()
 def service(self,identity=None,revision=None):
  d={'seller_token':'PRIVATE_PERSONAL','wb_service_token':'SYNTHETIC_SERVICE','wb_service_verified_identity':identity or tf.WB.identity,'wb_service_verified_access_revision':revision or tf.WB.access_revision};(self.root/'wb').write_text(json.dumps(d))
 def test_matching_service_is_used_without_keys_in_plan(self):
  self.service();req=rs.request_for(asdict(tf.WB),'subscriptions',{})
  with patch('http_transport.read_response',return_value=(b'{"active":true}',200))as http:
   self.t.prepare(req,asdict(tf.WB));value,_=self.t.execute(req,asdict(tf.WB));self.assertEqual(http.call_args.args[0].get_header('Authorization'),'SYNTHETIC_SERVICE');self.assertNotIn('SYNTHETIC',json.dumps(req.body))
 def test_service_other_store_identity_denied(self):
  self.service(identity='wrong');req=rs.request_for(asdict(tf.WB),'seller_rating',{})
  with self.assertRaises(CallError):self.t.prepare(req,asdict(tf.WB))
 def test_service_old_access_revision_denied(self):
  self.service(revision='old');req=rs.request_for(asdict(tf.WB),'seller_rating',{})
  with self.assertRaises(CallError):self.t.prepare(req,asdict(tf.WB))
 def test_wrong_store_still_denied(self):
  req=rs.request_for(asdict(tf.OZ),'chat_history_v3',{'chat_id':'123'})
  with patch('http_transport.read_response')as http:
   with self.assertRaises(CallError):self.t.execute(req,asdict(tf.WB))
   http.assert_not_called()
 def test_raw_url_never_allowed_from_direct_params(self):
  with self.assertRaises(Rejected):rs.request_for(asdict(tf.OZ),'report_file_get',{'file_ref':'https://localhost/private'})
 def test_no_resolved_ref_no_http(self):
  req=rs.request_for(asdict(tf.OZ),'report_file_get',{'file_ref':'rpf_'+'a'*32})
  with patch('http_transport.read_response')as http:
   with self.assertRaises(CallError):self.t.execute(req,asdict(tf.OZ))
   http.assert_not_called()
 def test_same_resource_rejection_not_evaded_by_new_reference(self):
  a=rs.request_for(asdict(tf.OZ),'report_file_get',{'file_ref':'rpf_'+'a'*32});b=rs.request_for(asdict(tf.OZ),'report_file_get',{'file_ref':'rpf_'+'b'*32})
  url='https://cdn1.ozone.ru/a.csv?signature=same'
  self.assertEqual(pr.bind_resource_request(a,url).source,pr.bind_resource_request(b,url).source)
 def test_different_files_not_denied_as_whole_store(self):
  a=rs.request_for(asdict(tf.OZ),'report_file_get',{'file_ref':'rpf_'+'a'*32})
  self.assertNotEqual(pr.bind_resource_request(a,'https://cdn1.ozone.ru/a').source,pr.bind_resource_request(a,'https://cdn1.ozone.ru/b').source)
 def test_signed_file_denial_not_classified_as_subscription(self):
  import urllib.error,email.message
  a=rs.request_for(asdict(tf.OZ),'report_file_get',{'file_ref':'rpf_'+'a'*32});a=pr.bind_resource_request(a,'https://cdn1.ozone.ru/a')
  error=urllib.error.HTTPError('https://cdn1.ozone.ru/a',403,'Forbidden',email.message.Message(),io.BytesIO(b'PRIVATE_ERROR'))
  with patch('http_transport.read_response',side_effect=error):
   with self.assertRaises(CallError)as caught:self.t.execute(a,asdict(tf.OZ))
  self.assertEqual(caught.exception.code,'HTTP_403_READ_RESOURCE_DENIED');self.assertEqual(caught.exception.status,403);self.assertFalse(caught.exception.unknown)
 def test_prior_aggregate_file_denial_is_not_bypassed(self):
  from unittest.mock import Mock
  a=rs.request_for(asdict(tf.OZ),'report_file_get',{'file_ref':'rpf_'+'a'*32});repo=Mock();repo.denied.return_value=True
  with self.assertRaises(Rejected)as error:pr.bind_resource_request(a,'https://cdn1.ozone.ru/a',repository=repo,access_revision='revision')
  self.assertEqual(error.exception.code,'SOURCE_ACCESS');repo.denied.assert_called_once_with(a.source,'revision')
 def test_scoped_binding_preserves_legacy_permission_check(self):
  from unittest.mock import Mock
  a=rs.request_for(asdict(tf.OZ),'report_file_get',{'file_ref':'rpf_'+'a'*32});repo=Mock();repo.denied.return_value=False
  bound=pr.bind_resource_request(a,'https://cdn1.ozone.ru/a?signature=PRIVATE_SIGNATURE',repository=repo,access_revision='revision')
  repo.denied.assert_called_once_with(a.source,'revision');self.assertNotIn('PRIVATE_SIGNATURE',bound.source);self.assertNotEqual(a.source,bound.source)
 def test_file_transfer_has_no_marketplace_credentials(self):
  req=rs.request_for(asdict(tf.OZ),'report_file_get',{'file_ref':'rpf_'+'a'*32});req=replace(req,body={**req.body,'resolved_resource':'https://cdn1.ozone.ru/report.csv'})
  with patch('http_transport.read_response',return_value=(b'id;amount\n1;2.25\n',200))as http:
   self.t.execute(req,asdict(tf.OZ));self.assertIsNone(http.call_args.args[0].get_header('Api-key'));self.assertIsNone(http.call_args.args[0].get_header('Authorization'))
 def test_original_donor_domain_boundary_is_preserved(self):
  self.assertEqual(pr.validate_url('https://seller-analytics-api.ozon.ru/report.csv?signature=not-shared'),'https://seller-analytics-api.ozon.ru/report.csv?signature=not-shared')
 def test_provider_names_inside_attacker_domain_do_not_pass(self):
  for url in ['https://ozon.ru.evil.example/x','https://evilozon.ru/x','https://ozone.ru.evil.example/x','https://ozon.ru:bad/x']:
   with self.assertRaises(Rejected):pr.validate_url(url)
 def test_report_private_origin_denied(self):
  for url in ['http://cdn1.ozone.ru/x','https://127.0.0.1/x','https://api-seller.ozon.ru@evil.test/x','https://cdn1.ozone.ru.evil.test/x','https://cdn1.ozone.ru:444/x','https://cdn1.ozone.ru/x#fragment']:
   with self.assertRaises(Rejected):pr.validate_url(url)

class Vault(unittest.TestCase):
 setUp=wf.Universal.setUp;tearDown=wf.Universal.tearDown;finish=wf.Universal.finish
 def run_private(self,operation='buyer_chats',platform='wb',params=None,body=None):
  holder=tf.ReadTransport();holder.setUp()
  try:
   self.worker=Worker(self.engine,holder.t)
   params={}if params is None else params
   raw=body if body is not None else b'{"chats":[{"clientName":"PRIVATE_NAME","message":"PRIVATE_TEXT"}]}'
   job=self.engine.submit_method('A','wb1'if platform=='wb'else'oz1',operation,params,'vault-'+str(self.repo.clock()),date(2026,11,9),'session-read-test')
   with patch('http_transport.read_response',return_value=(raw,200)):row=self.finish(job)
   self.assertEqual(row['state'],'READY',row['error']);result=strict_json(row['result'])['data']['calls'][0]['data']
   return row,result,raw
  finally:holder.tearDown()
 def get(self,ref,**kw):
  v={'op':'read_artifact','tenant':'A','store_id':'wb1','file_ref':ref,'conversation_id':'session-read-test','offset':0,'length':4096};v.update(kw);return pr.chunk(self.engine,v)
 def test_encrypted_only_data_on_disk_not_plain_result(self):
  row,result,raw=self.run_private();self.assertNotIn('PRIVATE',row['result'])
  with self.repo.connection()as c:p=c.execute('SELECT payload FROM read_payloads').fetchone()['payload'];self.assertNotIn(b'PRIVATE',p)
  self.assertNotIn(b'PRIVATE_NAME',Path(self.repo.path).read_bytes())
 def test_owner_exact_bytes_retrievable(self):
  row,result,raw=self.run_private();r=self.get(result['protected_file']['file_ref']);self.assertEqual(base64.b64decode(r['artifact']['base64']),raw);self.assertTrue(r['artifact']['eof'])
 def test_chunks_not_extra_provider_calls(self):
  _,r,raw=self.run_private();ref=r['protected_file']['file_ref'];before=self.repo.call_count();parts=[]
  for i in range(0,len(raw),7):parts.append(base64.b64decode(self.get(ref,offset=i,length=7)['artifact']['base64']))
  self.assertEqual(b''.join(parts),raw);self.assertEqual(before,self.repo.call_count())
 def test_cross_tenant_denied(self):
  _,r,_=self.run_private()
  with self.assertRaises(Rejected):self.get(r['protected_file']['file_ref'],tenant='OTHER')
 def test_cross_store_denied(self):
  _,r,_=self.run_private()
  with self.assertRaises(Rejected):self.get(r['protected_file']['file_ref'],store_id='oz1')
 def test_cross_conversation_denied(self):
  _,r,_=self.run_private()
  with self.assertRaises(Rejected):self.get(r['protected_file']['file_ref'],conversation_id='other-conversation')
 def test_revoke_after_ready_denied(self):
  _,r,_=self.run_private();self.scope=replace(self.scope,revision='revoked')
  with self.assertRaises(Rejected):self.get(r['protected_file']['file_ref'])
 def test_source_denial_blocks_artifact(self):
  row,r,_=self.run_private();ref=json.loads(row['plan'])['read_source_refs'][0];self.repo.deny(ref['source'],ref['revision'])
  with self.assertRaises(Rejected):self.get(r['protected_file']['file_ref'])
 def test_expiry_blocks_and_sweep_removes_ciphertext(self):
  _,r,_=self.run_private();self.clock.advance(1000)
  with self.assertRaises(Rejected):self.get(r['protected_file']['file_ref'])
  import retention;retention.sweep(self.repo)
  with self.repo.connection()as c:self.assertEqual(c.execute('SELECT count(*)FROM read_payloads').fetchone()[0],0)
 def test_tampered_blob_detected(self):
  _,r,_=self.run_private()
  with self.repo.connection(True)as c:c.execute('UPDATE read_payloads SET payload=?',(b'broken',))
  with self.assertRaises(Rejected)as e:self.get(r['protected_file']['file_ref'])
  self.assertEqual(e.exception.code,'READ_RESOURCE_INTEGRITY')
 def test_key_not_world_readable(self):
  self.run_private();key=Path(self.repo.path).with_name('read-payload-key.bin');self.assertEqual(stat.S_IMODE(key.stat().st_mode),0o600)
 def test_cancelled_reader_blocks_owner_file(self):
  _,r,_=self.run_private()
  # A finished job is not cancelled by the normal active-job cancel command.
  # This case verifies the explicit revoked subscription, without changing that UX.
  with self.repo.connection(True)as c:c.execute("UPDATE reader_cursors SET cancelled=1 WHERE tenant='A'AND conversation='session-read-test'")
  with self.assertRaises(Rejected):self.get(r['protected_file']['file_ref'])
 def test_real_file_reference_from_same_source(self):
  holder=tf.ReadTransport();holder.setUp();self.worker=Worker(self.engine,holder.t)
  try:
   first=self.engine.submit_method('A','oz1','report_info',{'code':'code-123'},'report-ref',date(2026,11,9),'session-read-test')
   with patch('http_transport.read_response',return_value=(b'{"result":{"file":"https://cdn1.ozone.ru/report.csv?signature=PRIVATE_SIGNED_VALUE"}}',200)):row=self.finish(first)
   self.assertEqual(row['state'],'READY',row['error']);self.assertNotIn('PRIVATE',row['result']);ref=strict_json(row['result'])['data']['calls'][0]['data']['result']['file']['file_ref']
   second=self.engine.submit_method('A','oz1','report_file_get',{'file_ref':ref,'offset':1,'limit':1},'report-download',date(2026,11,9),'session-read-test')
   with patch('http_transport.read_response',return_value=(b'id;price\n1;2.25\n2;3.50\n',200))as http:r=self.finish(second)
   self.assertEqual(r['state'],'READY',r['error']);self.assertIsNone(http.call_args.args[0].get_header('Api-key'));v=strict_json(r['result'])['data']['calls'][0]['data'];self.assertEqual(v['table_summary'],{'offset':1,'rows_count':1,'has_more':True})
   out=self.get(v['table_page']['file_ref'],store_id='oz1');page=strict_json(base64.b64decode(out['artifact']['base64']));self.assertEqual(page['rows'],[['1','2.25']])
   origin=json.loads(row['plan'])['read_source_refs'][0];self.repo.deny(origin['source'],origin['revision'])
   with self.assertRaises(Rejected):self.get(v['protected_file']['file_ref'],store_id='oz1')
  finally:holder.tearDown()
 def test_unknown_report_url_does_not_break_metadata_or_leak(self):
  data={'result':{'code':'r','status':'success','file':'https://invalid.example/private?signature=PRIVATE'}}
  p=pr.replace_urls(self.repo,{},'oz1','report_info',data);self.assertEqual(p['result']['status'],'success');self.assertEqual(p['result']['file']['retrieval_status'],'READ_RESOURCE_ORIGIN');self.assertNotIn('PRIVATE',json.dumps(p))
 def test_other_report_url_fields_never_reach_model(self):
  data={'result':{'code':'r','unexpected_url':'https://invalid.example/?private=PRIVATE'}}
  p=pr.replace_urls(self.repo,{},'oz1','report_info',data);self.assertNotIn('PRIVATE',json.dumps(p))
 def test_untrusted_product_url_not_registered(self):
  import protected_reads
  value={'result':{'file':'https://cdn1.ozone.ru/x'}};self.assertIs(protected_reads.replace_urls(self.repo,{},'oz1','product_info',value),value)

class Tables(unittest.TestCase):
 def test_csv_strings_no_float_or_date_inference(self):
  p=report_tables.page(b'id;amount\n001;999.00000001\n',{'offset':1,'limit':1});self.assertEqual(p['rows'],[['001','999.00000001']])
 def test_csv_formula_is_not_executed(self):
  p=report_tables.page(b'v;a\n=1+1;2\n',{'offset':1,'limit':1});self.assertEqual(p['rows'][0][0],'=1+1')
 def test_pdf_is_not_table(self):self.assertIsNone(report_tables.page(b'%PDF-1.4\nx',{}))
 def test_csv_cannot_choose_fake_sheet(self):
  with self.assertRaises(Rejected):report_tables.page(b'a;b\n1;2\n',{'sheet':'invented'})
 def xlsx(self,xml):
  buf=io.BytesIO()
  with zipfile.ZipFile(buf,'w')as z:
   z.writestr('xl/workbook.xml','<workbook xmlns:r="urn:test"><sheets><sheet name="One" r:id="r1"/></sheets></workbook>');z.writestr('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>');z.writestr('xl/worksheets/sheet1.xml',xml)
  return buf.getvalue()
 def test_xlsx_exact_numeric_cell_not_float(self):
  p=report_tables.page(self.xlsx('<worksheet><sheetData><row><c r="A1"><v>1234567890.123456789</v></c></row></sheetData></worksheet>'),{});self.assertEqual(p['rows'],[['1234567890.123456789']])
 def test_xlsx_external_entities_never_resolved(self):
  with self.assertRaises(Rejected):report_tables.page(self.xlsx('<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><worksheet/>'),{})
 def test_xlsx_wrong_sheet_is_not_first_sheet(self):
  with self.assertRaises(Rejected):report_tables.page(self.xlsx('<worksheet/>'),{'sheet':'Wrong'})

if __name__=='__main__':
 suite=unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(c)for c in [Contracts,Transport,Vault,Tables]);r=unittest.TextTestRunner(verbosity=2).run(suite);print(json.dumps({'status':'PASS'if r.wasSuccessful()else'FAIL','tests':r.testsRun,'real_provider_calls':0}));raise SystemExit(0 if r.wasSuccessful()else 1)
