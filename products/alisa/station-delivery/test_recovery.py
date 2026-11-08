import unittest
from unittest.mock import patch,Mock
import station_client as client
from test_delivery import DeliveryTests as F
from transport import Fault

class ClientRecovery(unittest.TestCase):
 def run_turn(self,command,side):
  market=Mock();market.request_result.return_value={'text':'Принято','state':'QUEUED','job_id':'job'}
  with patch.object(client,'call',side_effect=side):
   result=client.handle_turn(market,'A',command,'rid','hash','conversation1',1,'app','token')
  return result,market
 def test_callback_failure_never_enters_planner(self):
  for command in ['доставка 12345678','спроси октопорт маркет доставка 12345678']:
   result,market=self.run_turn(command,OSError('offline'));market.request_result.assert_not_called()
 def test_retry_callback_keeps_receipt(self):
  result,market=self.run_turn('доставка 12345678',[TimeoutError(),{'reply':'Ответ'}]);self.assertEqual(result[0],'Ответ');market.request_result.assert_not_called()
 def test_after_lost_response_retried_then_session_closes(self):
  result,market=self.run_turn('акции',[{'command':'акции'},TimeoutError(),{'text':'Принято','end_session':True}]);self.assertTrue(result[1]);self.assertEqual(market.request_result.call_count,1)
 def test_error_object_never_enters_planner_for_callback(self):
  _,market=self.run_turn('доставка 12345678',[{'error':'delivery_unavailable'}]*2);market.request_result.assert_not_called()

class DeliveryRecovery(unittest.TestCase):
 setUp=F.setUp;after=F.after;launches=F.launches
 def test_existing_scenario_update_timeout_recovers(self):
  self.core.state['scenario']='own-scenario';self.after();self.now+=10;self.client.failure=True;self.core.tick()
  self.assertFalse(self.core.state['uncertain']);self.assertEqual(self.core.state['job']['delivery'],'waiting');self.assertFalse(self.launches())
  self.client.failure=False;self.now+=11;self.core.tick();self.assertEqual(len(self.launches()),1)
 def test_action_429_recovers_without_reconnect(self):
  self.core.state['scenario']='own-scenario';self.after();self.now+=10
  def hook(m,p):
   if p.endswith('/actions'):raise Fault('yandex_http_429')
  self.client.hook=hook;self.core.tick();self.assertFalse(self.core.state['uncertain']);self.assertEqual(self.core.state['job']['delivery'],'waiting')
  self.client.hook=None;self.now+=11;self.core.tick();self.assertEqual(self.core.state['job']['delivery'],'waiting')
 def test_final_send_waits_after_temporary_failure(self):
  self.core.state['scenario']='own-scenario';self.after();self.result={'state':'READY','text':'Ответ'};self.client.failure=True;self.core.tick();n=len(self.client.calls)
  self.core.tick();self.assertEqual(len(self.client.calls),n);self.client.failure=False;self.now+=11;self.core.tick();self.assertEqual(self.core.state['job']['delivery'],'accepted_waiting_skill')
 def test_second_status_timeout_keeps_automatic_delivery(self):
  self.after();self.result={'state':'READY','text':'Ответ'}
  with patch.object(self.core,'status_job',side_effect=[self.result,TimeoutError()]):self.core.tick()
  self.assertEqual(self.core.state['job']['delivery'],'waiting');self.now+=11;self.core.tick()
  self.assertEqual(self.core.state['job']['delivery'],'accepted_waiting_skill')
 def test_late_after_cannot_replace_newer_job(self):
  old=self.core.ingress(dict(self.identity,op='before',command='акции',rid='old'))
  new=self.core.ingress(dict(self.identity,op='before',command='заказы',rid='new'))
  def after(jid,ticket):return self.core.ingress(dict(self.identity,op='after',conversation='conversation1',ticket=ticket,result={'state':'QUEUED','job_id':jid,'text':'Принято'}))
  after('new-job',new['ticket']);retry=self.core.ingress(dict(self.identity,op='before',command='акции',rid='old'));self.assertEqual(retry['ticket'],old['ticket']);after('old-job',old['ticket']);self.assertEqual(self.core.state['job']['jid'],'new-job')
  generation=self.core.state['generation'];after('new-job',new['ticket']);self.assertEqual(self.core.state['generation'],generation)
 def test_missing_callback_retries_same_nonce_then_stops_after_delivery(self):
  self.after();self.result={'state':'READY','text':'Ответ'};self.core.tick();nonce=self.core.state['job']['nonce']
  self.now+=16;self.core.tick();self.assertEqual(len(self.launches()),2);self.assertEqual(self.core.state['job']['nonce'],nonce)
  self.core.state['job'].update(delivery='responded_to_skill',callback_rid='receipt')
  self.now+=100;self.core.tick();self.assertEqual(len(self.launches()),2)
 def test_missing_callback_revoked_never_relaunches(self):
  self.after();self.result={'state':'READY','text':'Ответ'};self.core.tick();self.authorized=False;self.now+=16
  with patch('service.token_refresh_possible',return_value=False):self.core.tick()
  self.assertEqual(len(self.launches()),1)
 def test_unseen_older_turn_cannot_invalidate_new_ticket(self):
  new=self.core.ingress(dict(self.identity,op='before',command='заказы',rid='new',conversation='conversation1',message_id=2))
  old=self.core.ingress(dict(self.identity,op='before',command='акции',rid='old',conversation='conversation1',message_id=1))
  self.assertIn('reply',old);self.assertEqual(self.core.state['latest_turn']['ticket'],new['ticket'])
  self.core.ingress(dict(self.identity,op='after',conversation='conversation1',ticket=new['ticket'],result={'state':'QUEUED','job_id':'new-job','text':'Принято'}))
  self.assertEqual(self.core.state['job']['jid'],'new-job')
del F
