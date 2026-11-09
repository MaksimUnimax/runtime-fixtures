"""A received403 denies data, not the fixed reason shown to its current owner."""
from datetime import date
from dataclasses import replace
from unittest.mock import patch
import io,json,unittest,urllib.error
import test_read_surface as wf
import test_read_transport as tf
from engine import Worker
from station_status import status
from semantics import Rejected
CASES=[('question_count',{},'Premium Plus subscription required','HTTP_403_OZON_PREMIUM_PLUS_REQUIRED','Premium Plus'),('product_price_details',{'skus':['123']},'Premium Pro subscription required','HTTP_403_OZON_PREMIUM_PRO_REQUIRED','Premium Pro'),('review_count',{},'Требуется подписка Управление отзывами','HTTP_403_OZON_REVIEWS_REQUIRED','Управление отзывами'),('review_count',{},'Premium Plus subscription required','HTTP_403_OZON_ACCESS_POLICY_CONFLICT','расходится'),('product_price_details',{'skus':['123']},'access denied','HTTP_403',None)]
class Delivery(unittest.TestCase):
 setUp=wf.Universal.setUp;tearDown=wf.Universal.tearDown;finish=wf.Universal.finish
 def failed(self,case=0):
  alias,params,message,code,label=CASES[case];holder=tf.ReadTransport();holder.setUp()
  try:
   self.worker=Worker(self.engine,holder.t);self.conv='tier-delivery-test';a=self.engine.submit_method('A','oz1',alias,params,'tier-job',date(2026,11,9),self.conv)
   body=io.BytesIO(json.dumps({'code':7,'message':message+' PRIVATE'}).encode());error=urllib.error.HTTPError('https://api-seller.ozon.ru/fixed',403,'Forbidden',{},body)
   with patch('http_transport.read_response',side_effect=error)as http,patch('builtins.print'):row=self.finish(a)
   self.assertEqual(row['state'],'FAILED');self.assertEqual(row['error'],code);self.assertEqual(http.call_count,1)
   self.value={'op':'station_status','tenant':'A','conversation_id':self.conv,'job_id':a['job_id']};return row,label
  finally:holder.tearDown()
 def test_scope_revocation_still_blocks_failure(self):
  self.failed();self.scope=replace(self.scope,revision='revoked')
  with self.assertRaises(Rejected):status(self.engine,self.value)
 def test_changed_store_revision_still_blocks_failure(self):
  self.failed();self.scope=replace(self.scope,stores=tuple(replace(x,access_revision='revoked')for x in self.scope.stores))
  with self.assertRaises(Rejected):status(self.engine,self.value)
 def test_other_conversation_does_not_receive_failure(self):
  self.failed();answer=status(self.engine,{**self.value,'conversation_id':'another-conversation'});self.assertEqual(answer['state'],'SUPERSEDED');self.assertEqual(answer['text'],'')
 def test_ready_and_artifacts_still_use_denied_source_check(self):
  row,_=self.failed();self.assertFalse(self.engine.authorized(json.loads(row['plan'])))
  changed=dict(row);changed['state']='READY';self.assertIsNone(self.engine.access_failure_notice(changed))
 def test_diagnostics_do_not_clear_denial_or_repeat_http(self):
  row,_=self.failed();plan=json.loads(row['plan']);before=self.repo.call_count()
  for _ in range(3):answer=status(self.engine,self.value);self.assertEqual(answer['state'],'FAILED')
  self.assertEqual(self.repo.call_count(),before);self.assertFalse(self.engine.authorized(plan));self.assertNotIn('PRIVATE',answer['text'])
 def test_failed_delivery_does_not_attach_new_reader(self):
  row,_=self.failed();value={**self.value,'op':'station_deliver','target_conversation':'target-unsubscribed','message_id':1}
  with self.repo.connection()as c:before=c.execute('SELECT COUNT(*)FROM reader_cursors').fetchone()[0]
  answer=status(self.engine,value);self.assertEqual(answer['state'],'FAILED')
  with self.repo.connection()as c:self.assertEqual(c.execute('SELECT COUNT(*)FROM reader_cursors').fetchone()[0],before)
 def test_arbitrary_failure_code_is_never_echoed(self):
  row,_=self.failed();changed=dict(row);changed['error']='PRIVATE_TOKEN arbitrary';self.assertIsNone(self.engine.access_failure_notice(changed))
 def test_engine_failure_reply_and_station_use_same_text(self):
  row,_=self.failed();answer=status(self.engine,self.value);self.assertEqual(answer['text'],self.engine.describe('A',row));self.assertEqual(answer['text'],answer['tts'])
for number,case in enumerate(CASES):
 def check(self,number=number):
  row,label=self.failed(number);reply=status(self.engine,self.value);self.assertEqual(reply['state'],'FAILED');self.assertEqual(reply['text'],reply['tts'])
  if label:self.assertIn(label,reply['text'])
  else:self.assertNotIn('Premium',reply['text'])
 setattr(Delivery,'test_full_pipeline_tier_case_'+str(number),check)
if __name__=='__main__':unittest.main()
