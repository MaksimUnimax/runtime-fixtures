import copy, http.cookiejar, json, tempfile, threading, unittest
from pathlib import Path
from unittest.mock import patch
import service
from service import Delivery, DEFAULTS, Fault, validate_settings

class Cipher:
    def encrypt(self,x): return b'encrypted:'+x
    def decrypt(self,x): return x.removeprefix(b'encrypted:')
class Client:
    def __init__(self): self.calls=[]; self.jar=http.cookiejar.CookieJar(); self.failure=False; self.hook=None
    def api(self, method,path,payload=None):
        self.calls.append((method,path,payload))
        if self.hook: self.hook(method,path)
        if self.failure: raise Fault('network_outcome_unknown')
        return {'status':'ok','scenario_id':'own-scenario'}
    def devices(self): return [{'id':'speaker','name':'Колонка'}]
class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.now=1000; self.result={'state':'RUNNING','text':''}; self.authorized=True
        self.client=Client()
        self.core=Delivery(self.tmp.name,Cipher(),self.client,clock=lambda:self.now,auth=lambda *a:self.authorized,peek=lambda v:dict(self.result))
        self.core.state.update(connected=True,selected={'id':'speaker','name':'Колонка'},binding={'tenant':'A','application':'app'})
        self.identity={'tenant':'A','application':'app','token_hash':'a'*64}
    def before(self,command,**kw):return self.core.ingress(dict(self.identity,op='before',command=command,rid='callback-123',conversation='new-conversation',message_id=0,**kw))
    def after(self,jid='job1',conversation='conversation1'):
        return self.core.ingress(dict(self.identity,op='after',conversation=conversation,result={'state':'RUNNING','job_id':jid,'text':'Задание принято. Скажите: результат.'}))
    def settings(self,**kw):
        value=copy.deepcopy(self.core.state['settings']);value.update(kw)
        return self.core.configure({'revision':self.core.state['revision'],'settings':value})
    def launches(self):return [x for x in self.client.calls if x[1].endswith('/actions')]
    def test_default_and_validation(self):
        self.assertEqual(validate_settings(DEFAULTS)['interval_seconds'],10)
        for kw in [{'interval_seconds':9},{'interval_seconds':True},{'pending_messages':[]},{'manual_command':'--'},{'manual_command':'  '},{'manual_command':'дальше'}]:
            with self.assertRaises(Fault): validate_settings(dict(DEFAULTS,**kw))
    def test_pending_at_10_not_before(self):
        self.after();self.now+=9;self.core.tick();self.assertFalse(self.launches())
        self.now+=1;self.core.tick();self.assertEqual(len(self.launches()),1)
        self.assertIn(DEFAULTS['pending_messages'][0],json.dumps(self.client.calls,ensure_ascii=False))
    def test_ready_before_10_no_result_in_scenario(self):
        self.after();self.result={'state':'READY','text':'Секретная сумма 123'};self.now+=1;self.core.tick()
        self.assertEqual(len(self.launches()),1)
        serialized=json.dumps(self.client.calls,ensure_ascii=False)
        self.assertNotIn('Секретная',serialized);self.assertIn('Спроси Октопорт маркет доставка',serialized)
        self.core.tick();self.assertEqual(len(self.launches()),1)
    def test_pending_cycle_custom_interval(self):
        self.settings(interval_seconds=20,pending_messages=['Первое.','Второе.']);self.after()
        for t in (1019,1020,1039,1040): self.now=t;self.core.tick()
        texts=[x[2] for x in self.client.calls if x[2]]
        self.assertIn('Первое.',json.dumps(texts[0],ensure_ascii=False));self.assertIn('Второе.',json.dumps(texts[1],ensure_ascii=False));self.assertEqual(len(self.launches()),2)
    def test_pending_repetitions_bounded_ready_still_automatic(self):
        self.after()
        for t in (1010,1020,1030,1040,1050,1060):self.now=t;self.core.tick()
        self.assertEqual(len(self.launches()),3)
        self.result={'state':'READY','text':'Готовый отчёт'};self.now=1061;self.core.tick()
        self.assertEqual(len(self.launches()),4)
    def test_disable_keeps_manual(self):
        self.settings(enabled=False,manual_command='покажи ответ');self.after();self.now+=11;self.result={'state':'READY','text':'Ответ'};self.core.tick()
        self.assertFalse(self.launches());self.assertEqual(self.before('покажи ответ')['reply'],'Ответ')
    def test_manual_ready_attaches_new_conversation(self):
        self.settings(enabled=False);self.after();self.result={'state':'READY','text':'Ответ'}
        seen=[]
        self.core.peek=lambda value:(seen.append(value) or dict(self.result))
        self.before('результат')
        self.assertEqual(seen[-1]['op'],'station_deliver');self.assertEqual(seen[-1]['target_conversation'],'new-conversation')
    def test_disabled_no_retroactive_send(self):
        self.after();self.settings(enabled=False);self.settings(enabled=True);self.result={'state':'READY','text':'Ответ'};self.core.tick();self.assertFalse(self.launches())
    def test_callback_exact_once_rid_and_binding(self):
        self.after();self.result={'state':'READY','text':'Ответ'};self.core.tick();code=self.core.state['job']['nonce']
        self.assertEqual(self.before('доставка '+code)['reply'],'Ответ');self.assertEqual(self.before('доставка '+code)['reply'],'Ответ')
        self.identity['application']='other';self.assertNotEqual(self.before('доставка '+code)['reply'],'Ответ')
    def test_callback_expired_and_disabled(self):
        self.after();self.result={'state':'READY','text':'Ответ'};self.core.tick();code=self.core.state['job']['nonce']
        self.now+=91;self.assertNotEqual(self.before('доставка '+code)['reply'],'Ответ')
        self.now-=91;self.settings(enabled=False);self.assertNotEqual(self.before('доставка '+code)['reply'],'Ответ')
    def test_new_job_cancels_old_callback(self):
        self.after();self.result={'state':'READY','text':'Ответ'};self.core.tick();code=self.core.state['job']['nonce'];self.after('job2');self.assertNotEqual(self.before('доставка '+code)['reply'],'Ответ')
    def test_mutation_unknown_no_retry_restart(self):
        self.after();self.now+=10;self.client.failure=True;self.core.tick();n=len(self.client.calls);self.core.tick();self.assertEqual(len(self.client.calls),n)
        recovered=Delivery(self.tmp.name,Cipher(),Client(),clock=lambda:self.now,auth=lambda *a:True,peek=lambda v:self.result)
        self.assertTrue(recovered.state['uncertain']);self.assertEqual(recovered.state['job']['delivery'],'unknown')
    def test_auth_revocation_before_launch(self):
        self.after();self.now+=10
        self.client.hook=lambda m,p:setattr(self,'authorized',False)
        self.core.tick();self.assertFalse(self.launches())
        self.assertFalse(self.core.state['uncertain'])
        self.assertEqual(self.core.state['last_delivery']['state'],'cancelled_before_launch')
    def test_expired_access_with_active_refresh_can_wake_for_fresh_callback(self):
        self.after();self.authorized=False;self.result={'state':'READY','text':'Секретный отчёт'};self.now+=1
        with patch.object(service,'token_refresh_possible',return_value=True):
            self.core.tick()
        self.assertEqual(len(self.launches()),1)
        self.assertNotIn('Секретный отчёт',json.dumps(self.client.calls,ensure_ascii=False))
    def test_manual_takeover_before_launch(self):
        self.after();self.result={'state':'READY','text':'Ответ'};self.now+=10
        def hook(m,p):self.before('результат')
        self.client.hook=hook;self.core.tick();self.assertFalse(self.launches())
        self.assertFalse(self.core.state['uncertain'])
    def test_manual_pending_keeps_automatic_delivery(self):
        self.after();self.assertEqual(self.before('результат')['reply'],'Расчёт ещё выполняется.')
        self.assertEqual(self.core.state['job']['delivery'],'waiting')
        self.result={'state':'READY','text':'Ответ'};self.now+=1;self.core.tick();self.assertEqual(len(self.launches()),1)
    def test_final_after_old_fifteen_minute_window(self):
        self.after();self.now+=901;self.core.state['job']['message']=3
        self.core.tick();self.assertEqual(self.core.state['job']['delivery'],'waiting')
        self.result={'state':'READY','text':'Ответ'};self.core.tick();self.assertEqual(len(self.launches()),1)
    def test_new_job_before_launch(self):
        self.after();self.now+=10
        self.client.hook=lambda m,p:self.after('job2')
        self.core.tick();self.assertFalse(self.launches());self.assertEqual(self.core.state['job']['jid'],'job2');self.assertFalse(self.core.state['uncertain'])
    def test_refresh_token_same_job(self):
        self.after();self.identity['token_hash']='b'*64;self.after();self.assertEqual(self.core.state['job']['token_hash'],'b'*64)
    def test_settings_conflict(self):
        with self.assertRaises(Fault):self.core.configure({'revision':0,'settings':DEFAULTS})
    def test_superseded_or_revoked_no_speech(self):
        for state in ('SUPERSEDED','REVOKED','FAILED','CANCELLED','EXPIRED'):
            self.after(state);self.result={'state':state,'text':''};self.now+=11;self.core.tick()
        self.assertFalse(self.launches())
    def test_pair_automatic_skill_challenge_and_app(self):
        self.core.state['binding']=None
        self.core.admin('pair',{},'owner');code=''.join(__import__('re').findall(r'\d',self.client.calls[0][2]['steps'][0]['parameters']['items'][0]['value']['capabilities'][0]['state']['value']))
        self.assertEqual(len(code),24);self.before('привязать колонку '+code);self.assertEqual(self.core.state['binding']['application'],'app')
    def test_staff_contract(self):
        from io import BytesIO
        value={'staff':{'id':'owner','role':'OWNER','product_id':'alisa_market'}}
        class Opener:
            def open(self,*a,**kw):return BytesIO(json.dumps(value).encode())
        with patch.dict(service.os.environ,ALISA_PLATFORM_URL='http://127.0.0.1:18102',ALISA_STAFF_SERVICE_TOKEN='a'*32),patch.object(service.urllib.request,'build_opener',return_value=Opener()):
            self.assertEqual(service.staff_profile('__Host-alisa_staff='+'a'*43)['id'],'owner')
        for cookie in ('','__Host-alisa_staff=bad','__Host-alisa_staff='+'a'*43+'; __Host-alisa_staff='+'b'*43):
            with self.assertRaises(Fault):service.staff_cookie(cookie)
    def test_disconnect_racing_poll(self):
        entered,proceed=threading.Event(),threading.Event()
        def poll():entered.set();proceed.wait(2);return True
        self.core.state['connected']=False;self.core.qr='qr';self.core.qr_until=2000;self.client.poll_qr=poll
        errors=[]
        def action():
            try:self.core.admin('poll',{},'owner')
            except Fault as e:errors.append(e.code)
        t=threading.Thread(target=action);t.start();self.assertTrue(entered.wait(1))
        d=threading.Thread(target=self.core.disconnect);d.start()
        # disconnect clears state before waiting for the occupied transport lock.
        for _ in range(1000):
            if self.core.state['generation']:break
        proceed.set();t.join(2);d.join(2)
        self.assertFalse(self.core.state['connected']);self.assertFalse((Path(self.tmp.name)/'session.enc').exists())
if __name__=='__main__':unittest.main()
