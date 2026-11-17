"""Real handler + disposable SQLite. Synthetic credentials, no network calls."""
import importlib.util
import json
import os
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit
from html.parser import HTMLParser

SOURCE=Path(__file__).with_name('alice_lab.py')

class AuthorizationBoundary(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        folder=Path(self.temp.name)
        env={'LAB_LOG_KEY':'synthetic-log-'+'l'*40,
             'LAB_OAUTH_CLIENT_SECRET':'synthetic-client-'+'c'*40,
             'LAB_TEST_PASSWORD':'synthetic-password-only',
             'LAB_DB':str(folder/'auth.sqlite3'),'LAB_LOG':str(folder/'operational.log')}
        with patch.dict(os.environ,env),patch.dict('sys.modules',{
            'alice_bridge':SimpleNamespace(init_preview=lambda:None),
            'station_client':SimpleNamespace()}):
            spec=importlib.util.spec_from_file_location('auth_rejection_fixture',SOURCE)
            self.lab=importlib.util.module_from_spec(spec)
            spec.loader.exec_module(self.lab)
        self.lab.init()
        self.now=1000.0
        self.lab.now=lambda:self.now
        self.events=[]
        self.lab.log_event=lambda kind,data:self.events.append((kind,data))

    def form(self,nonce='synthetic-form',expires=1300):
        opts={'state':'synthetic-broker-state','client_id':self.lab.CLIENT,
              'redirect_uri':self.lab.REDIRECT,'scope':'reports:read','response_type':'code'}
        with self.lab.db()as c:
            c.execute('INSERT INTO forms VALUES(?,?,?)',(self.lab.digest(nonce),json.dumps(opts),expires))
        return nonce

    def post(self,**changes):
        form={'nonce':'synthetic-form','account':'demo-a','password':'synthetic-password-only'}
        form.update(changes)
        result=[]
        handler=object.__new__(self.lab.Handler)
        handler.path='/oauth/authorize'
        handler.parseform=lambda:form
        handler.send=lambda *args,**kwargs:result.append((args,kwargs))
        self.lab.Handler.do_POST(handler)
        self.assertEqual(len(result),1)
        return result[0][0]

    def counts(self):
        with self.lab.db()as c:
            return {t:c.execute('SELECT count(*)FROM '+t).fetchone()[0]for t in ['forms','codes','tokens']}

    def denied(self,reason,**changes):
        answer=self.post(**changes)
        self.assertEqual(answer[:2],(403,{'error':'invalid_demo_login'}))
        self.assertEqual(self.events,[('oauth_authorization_rejected',{'reason':reason})])
        self.assertEqual(self.counts()['codes'],0)
        self.assertEqual(self.counts()['tokens'],0)

    def test_missing_form_is_denied(self):
        self.denied('form_missing_or_expired')

    def test_expired_form_is_denied_even_with_correct_synthetic_password(self):
        self.form(expires=self.now-1)
        self.denied('form_missing_or_expired')

    def test_expiration_boundary_is_unchanged(self):
        self.form(expires=self.now)
        self.denied('form_missing_or_expired')

    def test_unknown_nonce_is_denied_without_consuming_other_form(self):
        self.form()
        self.denied('form_missing_or_expired',nonce='different-form')
        self.assertEqual(self.counts()['forms'],1)

    def test_account_is_denied_before_password(self):
        self.form()
        self.denied('account_invalid',account='different-account',password='wrong')

    def test_mismatched_password_is_denied_without_consuming_form(self):
        self.form()
        self.denied('password_mismatch',password='different-password')
        self.assertEqual(self.counts()['forms'],1)

    def test_empty_password_is_denied(self):
        self.form()
        self.denied('password_mismatch',password='')

    def test_private_reason_never_exposes_form_or_credentials(self):
        self.form()
        self.denied('password_mismatch',password='private-synthetic-input')
        raw=json.dumps(self.events)
        for secret in ['synthetic-form','synthetic-broker-state','demo-a','private-synthetic-input',self.lab.PASS,self.lab.SECRET]:
            self.assertNotIn(secret,raw)

    def test_logging_failure_does_not_turn_rejection_into_success_or_internal_error(self):
        self.form()
        self.lab.log_event=lambda *_:(_ for _ in ()).throw(OSError('synthetic-full-disk'))
        self.assertEqual(self.post(password='wrong')[:2],(403,{'error':'invalid_demo_login'}))
        self.assertEqual(self.counts(),{'forms':1,'codes':0,'tokens':0})

    def test_valid_request_retains_original_redirect_and_code_lifetime(self):
        self.form()
        status,body,headers=self.post()
        self.assertEqual((status,body),(302,b''))
        url=urlsplit(headers['Location'])
        self.assertEqual(url.scheme+'://'+url.netloc+url.path,self.lab.REDIRECT)
        qs=parse_qs(url.query)
        self.assertEqual(qs['state'],['synthetic-broker-state'])
        self.assertEqual(qs['client_id'],[self.lab.CLIENT])
        self.assertEqual(qs['scope'],['reports:read'])
        with self.lab.db()as c:
            row=c.execute('SELECT *FROM codes').fetchone()
            self.assertEqual(row['hash'],self.lab.digest(qs['code'][0]))
            self.assertEqual((row['account'],row['expires'],row['used']),('demo-a',self.now+120,0))
        self.assertEqual(self.counts(),{'forms':0,'codes':1,'tokens':0})
        self.assertEqual(self.events,[('oauth_authorized',{'account':self.lab.hp('demo-a')})])

    def test_demo_b_remains_supported(self):
        self.form()
        self.assertEqual(self.post(account='demo-b')[0],302)
        with self.lab.db()as c:self.assertEqual(c.execute('SELECT account FROM codes').fetchone()[0],'demo-b')

    def test_successfully_consumed_form_cannot_be_replayed(self):
        self.form()
        self.assertEqual(self.post()[0],302)
        self.events.clear()
        self.assertEqual(self.post()[:2],(403,{'error':'invalid_demo_login'}))
        self.assertEqual(self.events,[('oauth_authorization_rejected',{'reason':'form_missing_or_expired'})])
        self.assertEqual(self.counts()['codes'],1)

    def get_form(self, query=None):
        from urllib.parse import urlencode
        opts={'state':'synthetic-broker-state','client_id':self.lab.CLIENT,
              'redirect_uri':self.lab.REDIRECT,'scope':'reports:read','response_type':'code'}
        if query is not None:opts.update(query)
        result=[]
        handler=object.__new__(self.lab.Handler)
        handler.path='/oauth/authorize?'+urlencode(opts)
        handler.send=lambda *args,**kwargs:result.append((args,kwargs))
        self.lab.Handler.do_GET(handler)
        return result[0][0]

    def test_stale_form_renewal_keeps_nonce_lifetime_and_broker_binding(self):
        class NonceParser(HTMLParser):
            nonce=None
            def handle_starttag(self,tag,attrs):
                attrs=dict(attrs)
                if tag=='input'and attrs.get('name')=='nonce':self.nonce=attrs['value']
        self.form(expires=1300)
        self.now=2800 # Half an hour waiting on the original login form.
        status,page=self.get_form()
        self.assertEqual(status,200)
        parser=NonceParser();parser.feed(page.decode())
        self.assertTrue(parser.nonce)
        with self.lab.db()as c:
            row=c.execute('SELECT params,expires FROM forms WHERE nonce=?',
                          (self.lab.digest(parser.nonce),)).fetchone()
        self.assertEqual(row['expires'],self.now+300)
        self.assertEqual(json.loads(row['params'])['state'],'synthetic-broker-state')
        self.assertEqual(self.post(nonce=parser.nonce)[0],302)
        self.assertEqual(self.post(nonce=parser.nonce)[0],403)

    def test_renewal_does_not_skip_password_validation(self):
        self.form(expires=1300)
        self.now=2800
        status,page=self.get_form()
        import re
        nonce=re.search(r'name="nonce" value="([^"]+)"',page.decode()).group(1)
        self.denied('password_mismatch',nonce=nonce,password='wrong-synthetic')

    def test_invalid_broker_parameters_cannot_create_refreshed_form(self):
        self.assertEqual(self.get_form({'redirect_uri':'https://other.example/callback'})[0],400)
        self.assertEqual(self.counts(),{'forms':0,'codes':0,'tokens':0})

if __name__=='__main__':unittest.main()
