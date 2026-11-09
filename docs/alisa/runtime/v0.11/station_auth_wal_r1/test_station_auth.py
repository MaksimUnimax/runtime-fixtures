"""Real read-only SQLite/WAL regression and complete offline voice delivery."""
import gc
import importlib.util
import os
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import service
from service import Delivery, Fault


class Cipher:
    def encrypt(self, value): return value
    def decrypt(self, value): return value


class TokenAuthority(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.path = self.root / 'auth.sqlite3'
        with sqlite3.connect(self.path) as c:
            c.execute('PRAGMA journal_mode=WAL')
            c.execute('CREATE TABLE tokens(hash TEXT,account TEXT,kind TEXT,expires REAL,revoked INTEGER)')
            c.execute('INSERT INTO tokens VALUES(?,?,?,?,0)', ('fixture', 'owner', 'access', time.time()+600))
        c.close()
        self.patch = patch.object(service, 'TOKEN_DB', str(self.path))
        self.patch.start(); self.addCleanup(self.patch.stop)

    def protect(self):
        for p in self.root.glob('auth.sqlite3*'): p.chmod(0o444)
        self.root.chmod(0o555)

    def restore(self):
        self.root.chmod(0o700)
        for p in self.root.glob('auth.sqlite3*'): p.chmod(0o600)

    def test_missing_wal_sidecars_are_unavailable_not_revoked(self):
        if os.geteuid() == 0: self.skipTest('Read-only regression must run as the service user')
        self.protect()
        try:
            with self.assertRaises(Fault) as caught:
                service.token_active('owner', 'fixture')
            self.assertEqual(caught.exception.code, 'voice_auth_unavailable')
        finally: self.restore()

    def test_valid_expired_revoked_and_wrong_owner_remain_distinct(self):
        self.assertTrue(service.token_active('owner', 'fixture'))
        self.assertFalse(service.token_active('another-owner', 'fixture'))
        self.assertFalse(service.token_active('owner', 'missing'))
        with sqlite3.connect(self.path) as c:
            c.execute('UPDATE tokens SET revoked=1')
        self.assertFalse(service.token_active('owner', 'fixture'))
        with sqlite3.connect(self.path) as c:
            c.execute('UPDATE tokens SET revoked=0,expires=?', (time.time()-1,))
        self.assertFalse(service.token_active('owner', 'fixture'))

    def test_sqlite_failure_does_not_become_false_revocation(self):
        with patch.object(service.sqlite3, 'connect', side_effect=sqlite3.OperationalError('fixture unavailable')):
            with self.assertRaises(Fault) as caught:
                service.token_active('owner', 'fixture')
        self.assertEqual(caught.exception.code, 'voice_auth_unavailable')

    def test_fresh_token_webhook_background_poll_and_callback(self):
        if os.geteuid() == 0: self.skipTest('Read-only regression must run as the service user')
        os.environ.update(LAB_LOG_KEY='x'*40, LAB_OAUTH_CLIENT_SECRET='s'*40, LAB_TEST_PASSWORD='p'*20)
        spec = importlib.util.spec_from_file_location('auth_regression_lab', Path(__file__).with_name('alice_lab.py'))
        lab = importlib.util.module_from_spec(spec); spec.loader.exec_module(lab)
        lab.DB = str(self.path)
        with sqlite3.connect(self.path) as c:
            c.execute('DELETE FROM tokens')
            c.execute('INSERT INTO tokens VALUES(?,?,?,?,0)', (lab.digest('fresh-token'), 'owner', 'access', time.time()+600))
        c.close()
        clock = [time.time()]; state = ['QUEUED']; speech = []; analytics = []
        with tempfile.TemporaryDirectory() as station:
            d = Delivery(station, Cipher(), clock=lambda:clock[0],
                         peek=lambda request:{'state':state[0], 'text':'Готовый ответ.' if state[0]=='READY' else ''})
            d.state.update(connected=True, selected={'id':'speaker'},
                           binding={'tenant':'owner','application':lab.hp('fixture-device')})
            d.save()
            d.speak = lambda text,generation,guard=None,mode='text': speech.append((text,mode))
            def body(session, command):
                return {'version':'1.0','meta':{},
                        'session':{'skill_id':lab.SKILL,'session_id':session,'message_id':0,
                                   'user':{'access_token':'fresh-token'},'application':{'application_id':'fixture-device'}},
                        'request':{'type':'SimpleUtterance','command':command,'original_utterance':command}}
            def request_result(*args, **kwargs):
                analytics.append(1)
                return {'state':'QUEUED','job_id':'job1','text':'Задание принято. Скажите: результат.'}
            with lab.authority_database():
                # The primary service owns sidecars for its lifetime. The
                # separate delivery reader cannot write anywhere in this DB.
                self.protect(); gc.collect()
                try:
                    with patch.object(lab.marketplace,'handles',return_value=True), \
                         patch.object(lab.marketplace,'request_result',side_effect=request_result), \
                         patch.object(lab.station_client,'call',side_effect=d.ingress):
                        code, initial, _ = lab.skill(body('first-session','сколько заказов'))
                        self.assertEqual(code,200); self.assertTrue(initial['response']['end_session'])
                        self.assertNotIn('Скажите: результат',initial['response']['text'])
                        self.assertEqual(d.state['job']['delivery'],'waiting')
                        # Explicitly includes background polling after the first
                        # webhook returns; request-scoped ownership is too short.
                        state[0]='READY'; clock[0]+=1; gc.collect(); d.tick()
                        self.assertEqual(len(speech),1)
                        nonce=d.state['job']['nonce']
                        code, final, _=lab.skill(body('callback-session','доставка '+nonce))
                        self.assertEqual(code,200); self.assertEqual(final['response']['text'],'Готовый ответ.')
                        self.assertEqual(d.state['job']['delivery'],'responded_to_skill')
                        self.assertEqual(len(analytics),1)
                        # The keeper owns files, not an authorization snapshot.
                        # A later revocation must be visible immediately.
                        self.restore()
                        with sqlite3.connect(self.path) as c:
                            c.execute('UPDATE tokens SET revoked=1')
                        c.close(); self.protect()
                        self.assertFalse(service.token_active('owner',lab.digest('fresh-token')))
                finally: self.restore()


if __name__ == '__main__': unittest.main()
