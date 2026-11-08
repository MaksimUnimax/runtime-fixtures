"""Offline webhook-to-Station session lifecycle; no Yandex or provider calls."""
import importlib.util
import os
import tempfile
from pathlib import Path
from unittest.mock import patch

from service import Delivery

os.environ.update(LAB_LOG_KEY='x'*40, LAB_OAUTH_CLIENT_SECRET='s'*40, LAB_TEST_PASSWORD='p'*20)
path = str(Path(__file__).with_name('alice_lab.py'))
spec = importlib.util.spec_from_file_location('lab_session_test', path)
lab = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lab)

class Cipher:
    def encrypt(self, value): return value
    def decrypt(self, value): return value

def body(sid, mid, command):
    return {'version':'1.0', 'meta':{},
            'session':{'skill_id':lab.SKILL, 'session_id':sid, 'message_id':mid,
                       'user':{'access_token':'test-token'},
                       'application':{'application_id':'test-device'}},
            'request':{'type':'SimpleUtterance','command':command,'original_utterance':command}}

clock = [1000.]
state = ['QUEUED']
speech = []
calls = []
with tempfile.TemporaryDirectory() as directory:
    d = Delivery(directory, Cipher(), clock=lambda:clock[0],
                 auth=lambda tenant,token:True,
                 peek=lambda request:{'state':state[0], 'text':'Готовый отчёт.' if state[0]=='READY' else ''})
    application = lab.hp('test-device')
    d.state.update(connected=True, selected={'id':'speaker'},
                   binding={'tenant':'owner','application':application})
    d.save()
    d.speak = lambda text,generation,guard=None,mode='text': speech.append((text,mode))
    def forward(value):
        return d.ingress(value)
    def request_result(*args, **kwargs):
        calls.append(args)
        return {'state':'QUEUED','job_id':'job1','text':'Расчёт запущен.'}
    with patch.object(lab,'auth_token',return_value='owner'), \
         patch.object(lab.marketplace,'handles',return_value=True), \
         patch.object(lab.marketplace,'request_result',side_effect=request_result), \
         patch.object(lab.station_client,'call',side_effect=forward):
        code, initial, _ = lab.skill(body('first-session',1,'сколько заказов'))
        assert code==200 and initial['response']['end_session'] is True, initial
        assert len(calls)==1 and d.state['job']['delivery']=='waiting'
        clock[0]=1001.;state[0]='READY';d.tick()
        nonce=d.state['job']['nonce']
        assert speech and speech[-1][1]=='skill'
        code, final, _ = lab.skill(body('second-session',0,'спроси октопорт маркет доставка '+nonce))
        assert code==200 and final['response']['text']=='Готовый отчёт.', final
        assert len(calls)==1, 'a Quasar callback reached the analytics planner'
        assert d.state['job']['delivery']=='responded_to_skill'
        assert initial['response']['end_session'] is True
        assert final['response']['end_session'] is False
print('PASS webhook -> end_session -> READY -> second-session callback -> exact report, one analytics job')