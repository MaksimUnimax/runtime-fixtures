"""Webhook -> Station -> real core -> fixture API -> model -> nonce callback."""
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

core=Path(os.environ['ALISA_RAW_FLOW_CORE'])
sys.path.insert(0,str(core/'tests'));sys.path.insert(0,str(core))
from engine import Engine,Worker
from repository import Repository
from semantics import strict_json
from model_answer import Settings
from test_runtime import Clock,SCOPE,TODAY
from test_template_only import Transport
from station_status import status
gateway_spec=importlib.util.spec_from_file_location('raw_flow_core_gateway',core/'local_gateway.py')
core_gateway=importlib.util.module_from_spec(gateway_spec);gateway_spec.loader.exec_module(core_gateway)
# Restore the Station import root; the core modules above are already loaded.
sys.path.insert(0,str(Path(__file__).parent))
from service import Delivery,internal_voice_command
import station_client
os.environ.update(LAB_LOG_KEY='x'*40,LAB_OAUTH_CLIENT_SECRET='s'*40,LAB_TEST_PASSWORD='p'*20)
spec=importlib.util.spec_from_file_location('raw_voice_webhook',Path(__file__).with_name('alice_lab.py'))
lab=importlib.util.module_from_spec(spec);spec.loader.exec_module(lab)

class Cipher:
 def encrypt(self,value):return value
 def decrypt(self,value):return value

class RawVoiceFlow(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);root=Path(self.tmp.name)
  self.clock=Clock();self.repo=Repository(root/'state.sqlite3',self.clock)
  self.engine=Engine(self.repo,lambda _:SCOPE,template_mode=True,answer_settings=Settings(root/'settings.json'))
  self.transport=Transport();self.worker=Worker(self.engine,self.transport);self.launches=[]
  self.socket_path=str(root/'core.sock')
  self.gateway=core_gateway.Gateway(self.socket_path,self.engine,os.geteuid())
  self.thread=threading.Thread(target=self.gateway.serve_forever,daemon=True);self.thread.start()
  self.addCleanup(self.gateway.server_close);self.addCleanup(self.thread.join);self.addCleanup(self.gateway.shutdown)
  (root/'station').mkdir()
  self.delivery=Delivery(root/'station',Cipher(),clock=self.clock,auth=lambda *a:True,peek=lambda value:status(self.engine,value))
  self.delivery.state.update(connected=True,selected={'id':'speaker'},binding={'tenant':'A','application':lab.hp('test-device')})
  self.delivery.save();self.delivery.speak=lambda text,*a,**kw:self.launches.append(text)
 def body(self,session,mid,command):
  return {'version':'1.0','meta':{},'session':{'skill_id':lab.SKILL,'session_id':session,'message_id':mid,'user':{'access_token':'fixture-token'},'application':{'application_id':'test-device'}},'request':{'type':'SimpleUtterance','command':command,'original_utterance':command}}
 def flow(self,question):
  with patch.object(lab,'auth_token',return_value='A'),patch.object(lab.marketplace,'SOCKET_PATH',self.socket_path),patch.object(station_client,'call',side_effect=self.delivery.ingress):
   body=self.body('initial-session',1,question);code,initial,_=lab.skill(body)
   self.assertEqual(code,200);self.assertTrue(initial['response']['end_session'],initial)
   job=self.repo.get('A',self.delivery.state['job']['jid']);self.assertEqual(strict_json(job['draft'])['question'],question)
   # Repeated Dialogs message reuses the core receipt and Station generation.
   self.assertEqual(lab.skill(body)[1],initial)
   for _ in range(30):
    job=self.repo.get('A',job['id'])
    if job['state']not in ('QUEUED','RUNNING'):break
    self.clock.advance(max(0,job['due']-self.clock())+1);self.worker.step()
   self.assertEqual(job['state'],'READY',job['error'])
   self.assertEqual([r.operation for r in self.transport.calls],['template_select','ozon_orders','model_answer'])
   self.assertEqual(self.transport.calls[0].body['context']['original_question'],question)
   self.assertTrue(any(question in x['content'] for x in self.transport.calls[-1].body['messages']))
   self.delivery.tick();self.assertEqual(len(self.launches),1)
   callback=self.body('callback-session',0,'спроси октопорт маркет доставка '+self.delivery.state['job']['nonce'])
   _,answer,_=lab.skill(callback)
   self.assertEqual(answer['response']['text'],self.transport.answer)
   self.assertEqual(lab.skill(callback)[1],answer)
   self.assertEqual(len(self.transport.calls),3)
 def test_case_yo_spacing_and_typo_are_preserved_through_delivery(self):self.flow('  Заказы «Ёж-AbC»  за вчеар  ')
 def test_business_delivery_is_not_a_callback(self):self.flow('Доставка за вчера на Озоне')
 def test_former_lab_report_command_reaches_current_runtime(self):self.flow('Проверь отчёт')
 def test_former_lab_other_question_does_not_return_synthetic_answer(self):self.flow('Другой вопрос')
 def test_callback_grammar_rejects_business_suffix_and_accepts_spaced_nonce(self):
  for q in ('Доставка за вчера на Озоне','доставка','доставка 12345678 рублей','доставка 1234567','доставка １２３４５６７８'):
   self.assertIsNone(internal_voice_command(q));self.assertFalse(station_client.internal_command(q))
  self.assertEqual(internal_voice_command('Спроси Октопорт маркет доставка 1 2 3 4 5 6 7 8'),'доставка 12345678')
 def test_exit_cancels_reader_and_closes_webhook_session_without_model(self):
  with patch.object(lab,'auth_token',return_value='A'),patch.object(lab.marketplace,'SOCKET_PATH',self.socket_path),patch.object(station_client,'call',side_effect=self.delivery.ingress):
   lab.skill(self.body('exit-session',1,'Заказы за вчера'))
   job=self.repo.get('A',self.delivery.state['job']['jid']);_,answer,_=lab.skill(self.body('exit-session',2,'Выход'))
   self.assertTrue(answer['response']['end_session'],answer)
   self.assertEqual(self.repo.get('A',job['id'])['state'],'CANCELLED');self.assertEqual(self.transport.calls,[])
 def test_ready_model_answer_is_not_rewritten_by_manual_command_setting(self):
  settings=dict(self.delivery.state['settings'],manual_command='скажи ответ')
  self.delivery.configure({'revision':self.delivery.state['revision'],'settings':settings})
  text='Скажите: результат. Для получения отчета: результат. Ёж-AbC'
  result=self.delivery.ingress({'op':'after','tenant':'A','application':lab.hp('test-device'),'token_hash':'fixture','result':{'state':'READY','text':text}})
  self.assertEqual(result['text'],text)

if __name__=='__main__':unittest.main()
