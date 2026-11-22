"""Kill the whole service at a known 429, then restart it against the same isolated DB."""
import base64
import json
import os
from pathlib import Path
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest

import httpx
from starlette.testclient import TestClient
from platform_core.chat_api import create_app
from platform_core.guest_registration import RegistrationStore


def serve(root, phase, image):
    root=Path(root)
    db=root/'platform.db'
    model='test/chat'
    image_wait=bool(os.getenv('IMAGE_WAIT'))
    def upstream(req):
        path=req.url.path
        if path.endswith('/models/user'):
            chat={'id':model,'architecture':{'output_modalities':['text']},'supported_parameters':['tools'],'pricing':{'prompt':'0','completion':'0'}}
            pic={'id':'test/image','architecture':{'output_modalities':['image']},'pricing':{'prompt':'0','completion':'0','image':'0.01' if image_wait else '0'}}
            return httpx.Response(200,json={'data':[chat,pic]})
        if path.endswith('/images/models'):
            return httpx.Response(200,json={'data':[{'id':'test/image'}]})
        data=json.loads(req.content)
        with (root/'requests').open('a') as f:
            f.write(json.dumps([phase,path,data])+'\n')
        usage={'cost':0,'prompt_tokens':10,'completion_tokens':4}
        if path.endswith('/images'):
            if os.getenv('INTERRUPT_IMAGE') and phase=='original':
                (root/'accepted-image').touch()
                time.sleep(90)
            if image_wait and phase=='original':
                return httpx.Response(429,headers={'Retry-After':'3'})
            if image_wait:
                usage={**usage,'cost':'0.01'}
            return httpx.Response(200,json={'usage':usage,'data':[{'b64_json':base64.b64encode(b'\x89PNG\r\n\x1a\nfixture').decode()}]})
        if phase=='original':
            if image and not any(m.get('tool_call_id')=='draw-1' for m in data['messages']):
                call={'id':'draw-1','type':'function','function':{'name':'create_illustration','arguments':'{"prompt":"circle"}'}}
                if not any(t['function']['name']=='create_illustration' for t in data['tools']):
                    call={'id':'open-draw','type':'function','function':{'name':'octoport_use','arguments':json.dumps({'action':'create_illustration','query':'circle'})}}
                return httpx.Response(200,json={'id':'gen-before-'+call['id'],'usage':usage,'choices':[{'finish_reason':'tool_calls','message':{'role':'assistant','content':'','tool_calls':[call]}}]})
            return httpx.Response(429,headers={'Retry-After':'7' if os.getenv('COMPETING') else '3'})
        return httpx.Response(200,json={'id':'gen-resumed','usage':usage,'choices':[{'finish_reason':'stop','message':{'role':'assistant','content':'Работа завершена'}}]})
    direct=bool(os.getenv('DIRECT_IMAGE'))
    if phase=='original':
        with RegistrationStore(db) as store:
            store.create_account('owner','fixture-password')
            if image_wait:
                store.set_paid('owner',True)
                store.grant_coins('owner','100','fund-fixture','fixture')
            (root/'session').write_text(store.login('owner','fixture-password'))
    gateway=None
    if direct:
        from platform_core.operation_grants import initialize_grants
        initialize_grants(db)
        gateway=subprocess.Popen(['node',str(Path(__file__).parent/'metered-chat-gateway.mjs'),str(db),str(root/'meter')],
            stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
        address=gateway.stdout.readline().strip()
        assert address.startswith('http://127.0.0.1:')
        os.environ['HARNESS_MODEL_GATEWAY_URL']=address
        import atexit
        def close_gateway():
            gateway.stdin.close()
            gateway.wait(timeout=10)
        atexit.register(close_gateway)
    question='draw fixture' if direct else 'Fixture question'
    headers={'Authorization':'Bearer '+(root/'session').read_text()}
    with TestClient(create_app(db,root/'chats')) as client:
        router=client.app.state.model_router
        router.http=httpx.AsyncClient(transport=httpx.MockTransport(upstream))
        if phase=='original':
            chat=client.post('/api/chats',headers=headers).json()['chatId']
            (root/'chat').write_text(chat)
            if not direct: client.post('/api/model-settings',headers=headers,json={'model':model,'revision':0}).raise_for_status()
            if image:
                client.post('/api/plugins',headers=headers,json={'plugin':'illustrations','installed':True}).raise_for_status()
                for path,values in [('plugins',{'plugin':'illustrations','enabled':True}),('plugins/illustrations/model',{'model':'test/image','effort':'auto'})]:
                    client.post('/api/chats/'+chat+'/'+path,headers=headers,json=values).raise_for_status()
            client.post('/api/chats/'+chat+'/turns',headers=headers,json={'requestId':'fixture','text':question}).raise_for_status()
        else:
            chat=(root/'chat').read_text()
            if phase=='uncertain':
                url='/api/chats/'+chat+'/turns'
                r=client.post(url,headers=headers,json={'requestId':'fixture','text':question})
                assert r.status_code==409 and r.json()['error']=='turn_unconfirmed', r.status_code
                return
            if phase=='competing':
                r=client.post('/api/chats/'+chat+'/turns',headers=headers,json={'requestId':'new-request','text':'Other question'})
                assert r.status_code in (409,429), (r.status_code,r.text)
                return
            if phase=='denied':
                for _ in range(80):
                    with sqlite3.connect(db) as sql:
                        if not sql.execute('SELECT count(*) FROM openrouter_waits').fetchone()[0]:
                            break
                    time.sleep(.05)
                else:
                    raise RuntimeError('The rejected wait was not cleared')
                if image:
                    with RegistrationStore(db) as store:
                        renewed={'Authorization':'Bearer '+store.login('owner','fixture-password')}
                        store.create_account('observer','observer-password')
                        foreign={'Authorization':'Bearer '+store.login('observer','observer-password')}
                    url='/api/chats/'+chat+'/events'
                    assert client.get(url,headers=headers).status_code==401
                    history=client.get(url,headers=renewed)
                    history.raise_for_status()
                    [asset]=history.json()['savedIllustrations']
                    assert client.get(asset,headers=renewed).content.startswith(b'\x89PNG')
                    assert client.get(url,headers=foreign).status_code==404
                    assert client.get(asset,headers=foreign).status_code==404
                return
            for _ in range(120):
                history=client.get('/api/chats/'+chat+'/events',headers=headers)
                if history.status_code==200 and 'Работа завершена' in history.text:
                    (root/'result').write_text(json.dumps(history.json(),ensure_ascii=False))
                    return
                time.sleep(.1)
            raise RuntimeError('Recovered response did not reach history')

@unittest.skipUnless(os.environ.get('HARNESS_NODE_MODULES'),'requires installed Harness')
class CrashRecovery(unittest.TestCase):
    def exercise(self,image,logout=False,replicas=1,competing=False,image_wait=False,direct=False,uncertain=False):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'key').write_text('fixture-only')
            env={**os.environ,'OPENROUTER_PROXY_URL':'','HARNESS_OPENROUTER_ENABLED':'1','HARNESS_OFFLINE_MODEL':'0',
                 'HARNESS_OPENROUTER_KEY_FILE':str(root/'key'),'HARNESS_MODEL_GATEWAY_URL':'http://127.0.0.1:9',
                 'PYTHONPATH':str(Path(__file__).resolve().parents[1])}
            if competing: env['COMPETING']='true'
            if image_wait: env['IMAGE_WAIT']='true'
            if direct: env['DIRECT_IMAGE']='true'
            if uncertain: env['INTERRUPT_IMAGE']='true'
            def start(phase):
                return subprocess.Popen([sys.executable,__file__,temp,phase,str(int(image))],env=env,start_new_session=True)
            def stop(p):
                if p.poll() is None:
                    os.killpg(p.pid,signal.SIGKILL)
                    p.wait(timeout=5)
            first=start('original')
            try:
                end=time.monotonic()+15
                while time.monotonic()<end:
                    if uncertain and (root/'accepted-image').exists():break
                    if (root/'platform.db').exists():
                        try:
                            with sqlite3.connect(root/'platform.db') as db:
                                if db.execute('SELECT count(*) FROM openrouter_waits').fetchone()[0]:
                                    break
                        except sqlite3.OperationalError:
                            pass
                    time.sleep(.03)
                else:self.fail('No durable 429')
                if competing:
                    with sqlite3.connect(root/'chats'/'native-chats.sqlite3') as journal:
                        journal.execute('UPDATE native_model_dispatch SET active_until=0')
                    rival=start('competing')
                    try:
                        self.assertEqual(rival.wait(timeout=20),0)
                    finally:
                        stop(rival)
            finally:stop(first)
            if logout:
                with RegistrationStore(root/'platform.db') as store:
                    store.logout((root/'session').read_text())
            if uncertain:
                with sqlite3.connect(root/'chats'/'native-chats.sqlite3') as journal:
                    journal.execute('UPDATE native_model_dispatch SET active_until=0')
            others=[start('uncertain' if uncertain else 'denied' if logout else 'restarted') for _ in range(replicas)]
            try:
                for app in others:
                    self.assertEqual(app.wait(timeout=40),0)
            finally:
                for app in others: stop(app)
            rows=[json.loads(x) for x in (root/'requests').read_text().splitlines()]
            calls=[r for r in rows if r[1].endswith('/completions')]
            if uncertain:
                self.assertEqual([(r[0],r[1].split('/')[-1]) for r in rows],[('original','completions'),('original','completions'),('original','images')])
                with sqlite3.connect(root/'platform.db') as db:
                    self.assertEqual(db.execute('SELECT count(*) FROM openrouter_waits').fetchone()[0],0)
                    self.assertEqual(db.execute("SELECT charge FROM coin_attempts WHERE period='plugin.illustrations.create_image'").fetchall(),[(None,)])
                return
            if logout:
                self.assertEqual([r[0] for r in calls],['original']*(3 if image else 1))
                self.assertEqual(sum(r[1].endswith('/images') for r in rows),int(image))
                with sqlite3.connect(root/'platform.db') as db:
                    self.assertEqual(db.execute('SELECT charge FROM coin_attempts').fetchone()[0],0)
                return
            if image_wait:
                draws=[r for r in rows if r[1].endswith('/images')]
                self.assertEqual([r[0] for r in draws],['original','restarted'])
                self.assertEqual(draws[0][2],draws[1][2])
                if direct:
                    self.assertEqual(calls,[])
                else:
                    self.assertEqual([r[0] for r in calls],['original','original','restarted'])
                    self.assertIn('draw-1',[m.get('tool_call_id') for m in calls[-1][2]['messages'] if m['role']=='tool'])
                with sqlite3.connect(root/'platform.db') as db:
                    [charged]=db.execute("SELECT charge,evidence FROM coin_attempts WHERE period='plugin.illustrations.create_image'").fetchall()
                    self.assertGreater(charged[0],0)
                    self.assertEqual(charged[1],'openrouter-usd:0.01')
            else:
                self.assertEqual(calls[-1][2],calls[-2][2])
                self.assertEqual([r[0] for r in calls],['original']*(3 if image else 1)+['restarted'])
                self.assertEqual(sum(r[1].endswith('/images') for r in rows),int(image))
            messages=json.loads((root/'result').read_text())['messages']
            self.assertEqual([(m['role'],m['text']) for m in messages],[('user','draw fixture' if direct else 'Fixture question'),('assistant','Работа завершена')])
            with sqlite3.connect(root/'platform.db') as db:
                self.assertEqual(db.execute('SELECT count(*) FROM openrouter_waits').fetchone()[0],0)
                self.assertEqual(db.execute('SELECT count(*),count(charge) FROM coin_attempts').fetchone(),(4,4) if image else (1,1))

    def test_service_killed_after_image_request_without_receipt_never_resubmits(self):
        self.exercise(True,image_wait=True,uncertain=True)

    def test_direct_deepseek_resumes_rejected_openrouter_image(self):
        self.exercise(True,image_wait=True,direct=True)

    def test_generator_rejection_recovers_once_and_charges_one_image(self):
        self.exercise(True,replicas=2,image_wait=True)

    def test_service_killed_after_first_rejection(self):
        self.exercise(False,replicas=2)

    def test_new_request_cannot_overtake_parked_turn_after_lease_expiry(self):
        self.exercise(False,competing=True)

    def test_logout_during_service_outage_revokes_restart(self):
        self.exercise(False,logout=True)

    def test_logout_after_image_preserves_output_for_owner(self):
        self.exercise(True,logout=True)

    def test_service_killed_after_completed_image_and_rejected_continuation(self):
        self.exercise(True)

if __name__=='__main__':
    serve(sys.argv[1],sys.argv[2],bool(int(sys.argv[3])))
