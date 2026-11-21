#!/usr/bin/env python3
"""Real OAuthlib + Django persistence checks; no network or live configuration."""
import base64
import hashlib
import json
import os
from pathlib import Path
import secrets
import sys
import threading
import time
import unittest
import uuid
from datetime import timedelta
from urllib.parse import parse_qs, urlencode, urlsplit
from concurrent.futures import ThreadPoolExecutor

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'services/platform/src'))
from django.conf import settings
from cryptography.fernet import Fernet

POSTGRES = os.environ.get('ALISA_SKILL_CORE_TEST_ALLOW') == '1'
if POSTGRES:
    if (os.environ.get('ALISA_DB_NAME') != 'alisa_s06_core_platform' or os.environ.get('ALISA_DB_HOST') != '127.0.0.1'
            or os.environ.get('ALISA_DB_PORT') != '55480' or os.environ.get('ALISA_DB_USER') != 'alisa_s06_core_platform_runtime'):
        raise RuntimeError('Owned disposable S06 database required')
    os.environ['DJANGO_SETTINGS_MODULE'] = 'alisa_platform.config.settings'
elif not settings.configured:
    settings.configure(
        SECRET_KEY=secrets.token_urlsafe(32), ALISA_ENV='dev', RELEASE='s06-source-checks',
        DATABASES={'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}},
        INSTALLED_APPS=['alisa_platform.' + name for name in
                        ['foundation', 'leads', 'funnel', 'accounts', 'alice_link']],
        USE_TZ=True, DEFAULT_AUTO_FIELD='django.db.models.BigAutoField',
        ACCOUNTS_ENABLED=True, AUTH_SERVICE_TOKEN=secrets.token_urlsafe(32), ALICE_LINK_ENABLED=True,
        ALICE_CLIENT_ID='s06-fixture-client', ALICE_CLIENT_SECRET=secrets.token_urlsafe(32),
        ALICE_SKILL_ID='e1c48501-7b1f-47fe-87d7-e6bec9c45673', ALICE_DATA_KEYS=[Fernet.generate_key().decode()])
import django
django.setup()
from django.core.management import call_command
from django.db import connections, transaction
from django.test import RequestFactory, override_settings
from django.utils import timezone
from alisa_platform.accounts.models import AuthFlow, Customer, Membership, Tenant, WebSession
from alisa_platform.accounts.views import digest
from alisa_platform.leads.models import RateBucket
from alisa_platform.alice_link.models import AliceLink, AuthorizationRequest, AuthorizationCode, TokenFamily
from alisa_platform.alice_link.oauth import REDIRECT, SCOPE, RETRY_SECONDS
from alisa_platform.alice_link.views import handle


class SkillChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not POSTGRES:
            call_command('migrate', verbosity=0)

    def setUp(self):
        RateBucket.objects.all().delete()  # exclusively this process's disposable database
        self.factory = RequestFactory()
        self.owner, self.token = self.actor()
        self.other, self.other_token = self.actor()

    def actor(self, tenant=None):
        customer = Customer.objects.create(email='skill-' + secrets.token_hex(8) + '@example.invalid')
        tenant = tenant or Tenant.objects.create()
        Membership.objects.create(customer=customer, tenant=tenant)
        flow = AuthFlow.objects.create(secret_hash=digest(secrets.token_urlsafe(32)), encrypted_payload='',
                                       expires_at=timezone.now() + timedelta(minutes=10))
        token = secrets.token_urlsafe(32)
        row = WebSession.objects.create(token_hash=digest(token), customer=customer, tenant=tenant, flow=flow,
                                        security_revision=customer.security_revision,
                                        expires_at=timezone.now() + timedelta(days=30), encrypted_payload='')
        return row, token

    def api(self, action, **data):
        request = self.factory.post('/api/v1/account/alice', data=json.dumps({'action': action, **data}),
                                    content_type='application/json', HTTP_AUTHORIZATION='Bearer ' + settings.AUTH_SERVICE_TOKEN)
        response = handle(request)
        return response.status_code, json.loads(response.content)

    def start(self, token=None, **changes):
        query = {'client_id': settings.ALICE_CLIENT_ID, 'redirect_uri': REDIRECT, 'response_type': 'code',
                 'scope': SCOPE, 'state': secrets.token_urlsafe(24)}
        query.update(changes)
        data = {'query': urlencode(query)}
        if token:
            data['session_token'] = token
        status, body = self.api('request', **data)
        self.assertEqual(status, 201, body)
        return body['flow_ref'], query

    def approve(self, token=None, **changes):
        token = token or self.token
        ref, query = self.start(token, **changes)
        status, body = self.api('approve', session_token=token, flow_ref=ref)
        self.assertEqual(status, 200, body)
        returned = parse_qs(urlsplit(body['redirect_uri']).query)
        self.assertEqual(returned['state'], [query['state']])
        self.assertEqual(returned['client_id'], [settings.ALICE_CLIENT_ID])
        self.assertEqual(returned['scope'], [SCOPE])
        return returned['code'][0]

    def protocol(self, **values):
        values = {'client_id': settings.ALICE_CLIENT_ID, 'client_secret': settings.ALICE_CLIENT_SECRET, **values}
        status, body = self.api('token', body=urlencode(values), authorization='')
        self.assertEqual(status, 200, body)
        return body['oauth_status'], body['oauth_body']

    def issue(self, token=None, **changes):
        code = self.approve(token, **changes)
        status, result = self.protocol(grant_type='authorization_code', code=code, redirect_uri=REDIRECT)
        self.assertEqual(status, 200, result)
        self.assertTrue(result['access_token'].startswith('as6_'))
        self.assertEqual(result['token_type'], 'Bearer')
        self.assertEqual(result['expires_in'], 600)
        self.assertLess(len(json.dumps(result)), 5000)
        return code, result

    def skill(self, token='', **changes):
        payload = {'version': '1.0', 'meta': {'interfaces': {'account_linking': {}}},
                   'session': {'skill_id': settings.ALICE_SKILL_ID, 'user': {'user_id': 'not-an-authority'}},
                   'request': {'type': 'account_linking_complete_event'}}
        payload.update(changes)
        return self.api('webhook', payload=payload, authorization='Bearer ' + token if token else '')

    def test_account_does_not_duplicate_and_connection_confirms_only_from_skill(self):
        before = Customer.objects.count(), Tenant.objects.count()
        _, tokens = self.issue()
        self.assertEqual(self.api('status', session_token=self.token)[1]['alice']['state'], 'WAITING_FOR_ALICE')
        self.assertEqual(self.skill(tokens['access_token'])[0], 200)
        self.assertEqual(self.api('status', session_token=self.token)[1]['alice']['state'], 'CONNECTED')
        self.assertEqual((Customer.objects.count(), Tenant.objects.count()), before)
        self.assertEqual(self.api('status', session_token=self.other_token)[1]['alice']['state'], 'DISCONNECTED')

    def test_code_replay_wrong_redirect_and_wrong_client(self):
        code = self.approve()
        for changes in [{'redirect_uri': REDIRECT + '/'}, {'client_secret': 'invalid'}, {'client_id': 'other'}]:
            status, _ = self.protocol(grant_type='authorization_code', code=code, redirect_uri=REDIRECT, **{
                key: value for key, value in changes.items() if key != 'redirect_uri'}) if 'redirect_uri' not in changes else self.protocol(grant_type='authorization_code', code=code, **changes)
            self.assertIn(status, {400, 401})
        self.assertEqual(self.protocol(grant_type='authorization_code', code=code, redirect_uri=REDIRECT)[0], 200)
        self.assertEqual(self.protocol(grant_type='authorization_code', code=code, redirect_uri=REDIRECT)[0], 400)

    def test_refresh_lost_response_then_rotation_keeps_same_refresh(self):
        _, tokens = self.issue()
        status, first = self.protocol(grant_type='refresh_token', refresh_token=tokens['refresh_token'])
        self.assertEqual(status, 200)
        self.assertEqual(first['access_token'], tokens['access_token'])
        row = TokenFamily.objects.get(refresh_hash=digest(tokens['refresh_token']))
        row.retry_until = timezone.now() - timedelta(seconds=1)
        row.save(update_fields=['retry_until'])
        _, rotated = self.protocol(grant_type='refresh_token', refresh_token=tokens['refresh_token'])
        self.assertNotEqual(rotated['access_token'], tokens['access_token'])
        self.assertEqual(rotated['refresh_token'], tokens['refresh_token'])
        _, retried = self.protocol(grant_type='refresh_token', refresh_token=tokens['refresh_token'])
        self.assertEqual(retried['access_token'], rotated['access_token'])
        self.assertIn('start_account_linking', self.skill(tokens['access_token'])[1]['skill_response'])
        self.assertEqual(self.skill(rotated['access_token'])[0], 200)

    def test_unlink_revokes_access_refresh_pending_code_and_consent(self):
        code, tokens = self.issue()
        pending, _ = self.start(self.token)
        self.assertEqual(self.api('unlink', session_token=self.token)[0], 200)
        self.assertIn('start_account_linking', self.skill(tokens['access_token'])[1]['skill_response'])
        self.assertEqual(self.protocol(grant_type='refresh_token', refresh_token=tokens['refresh_token'])[0], 400)
        self.assertEqual(self.api('approve', session_token=self.token, flow_ref=pending)[0], 400)
        newcode, fresh = self.issue()
        self.assertNotEqual(newcode, code)
        self.assertEqual(self.skill(fresh['access_token'])[0], 200)

    def test_flow_cannot_move_between_accounts_or_sessions(self):
        ref, _ = self.start(self.token)
        self.assertEqual(self.api('preview', session_token=self.other_token, flow_ref=ref)[0], 409)
        self.assertEqual(self.api('approve', session_token=self.other_token, flow_ref=ref)[0], 409)
        _, new_session = self.actor(self.owner.tenant)
        self.assertEqual(self.api('approve', session_token=new_session, flow_ref=ref)[0], 409)
        self.assertEqual(self.api('approve', session_token=self.token, flow_ref=ref)[0], 200)

    def test_anonymous_flow_binds_once_after_login(self):
        ref, _ = self.start()
        self.assertEqual(self.api('approve', session_token=self.token, flow_ref=ref)[0], 409)
        self.assertEqual(self.api('preview', session_token=self.token, flow_ref=ref)[0], 200)
        self.assertEqual(self.api('preview', session_token=self.other_token, flow_ref=ref)[0], 409)
        self.assertEqual(self.api('approve', session_token=self.token, flow_ref=ref)[0], 200)

    def test_expired_and_denied_flow_never_issue_code(self):
        ref, query = self.start(self.token)
        status, body = self.api('deny', session_token=self.token, flow_ref=ref)
        self.assertEqual(status, 200)
        returned = parse_qs(urlsplit(body['redirect_uri']).query)
        self.assertEqual(returned['error'], ['access_denied'])
        self.assertEqual(returned['state'], [query['state']])
        self.assertEqual(self.api('approve', session_token=self.token, flow_ref=ref)[0], 400)
        ref, _ = self.start(self.token)
        AuthorizationRequest.objects.filter(secret_hash=digest(ref)).update(expires_at=timezone.now()-timedelta(seconds=1))
        self.assertEqual(self.api('preview', session_token=self.token, flow_ref=ref)[0], 400)

    def test_pkce_enforced_and_malformed_challenge_rejected(self):
        verifier = secrets.token_urlsafe(32)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
        code = self.approve(code_challenge=challenge, code_challenge_method='S256')
        self.assertEqual(self.protocol(grant_type='authorization_code', code=code, redirect_uri=REDIRECT, code_verifier='bad')[0], 400)
        self.assertEqual(self.protocol(grant_type='authorization_code', code=code, redirect_uri=REDIRECT, code_verifier=verifier)[0], 200)
        for challenge, method in [('x'*2048,'S256'),('abc','S256'),('x'*43,'plain')]:
            query=urlencode({'client_id':settings.ALICE_CLIENT_ID,'redirect_uri':REDIRECT,'response_type':'code','state':'fixture','scope':SCOPE,'code_challenge':challenge,'code_challenge_method':method})
            self.assertEqual(self.api('request',query=query)[0],422)

    def test_security_revision_membership_and_disabled_customer_revoke(self):
        for mutation in ['revision','membership','disabled']:
            row, token = self.actor()
            _, values = self.issue(token)
            if mutation=='revision':
                row.customer.security_revision+=1;row.customer.save(update_fields=['security_revision'])
            elif mutation=='membership':
                Membership.objects.filter(customer=row.customer).update(role='REMOVED')
            else:
                row.customer.is_active=False;row.customer.save(update_fields=['is_active'])
            self.assertIn('start_account_linking',self.skill(values['access_token'])[1]['skill_response'])
            self.assertEqual(self.protocol(grant_type='refresh_token',refresh_token=values['refresh_token'])[0],400)

    def test_privacy_is_private_by_default_and_isolated(self):
        self.assertTrue(self.api('status',session_token=self.token)[1]['alice']['voice_private'])
        self.assertEqual(self.api('privacy',session_token=self.token,voice_private=False)[0],200)
        self.assertFalse(self.api('status',session_token=self.token)[1]['alice']['voice_private'])
        self.assertTrue(self.api('status',session_token=self.other_token)[1]['alice']['voice_private'])
        self.issue()
        self.api('unlink',session_token=self.token)
        self.assertFalse(self.api('status',session_token=self.token)[1]['alice']['voice_private'])
        self.assertEqual(self.api('privacy',session_token=self.token,voice_private='false')[0],422)

    def test_raw_user_id_and_legacy_token_do_not_authorize_customer(self):
        for token in ['', 'legacy-fixture-token', 'as6_'+secrets.token_urlsafe(32)]:
            result=self.skill(token)[1]['skill_response']
            self.assertEqual(result,{'version':'1.0','start_account_linking':{}})
        status,body=self.skill('',meta={'interfaces':{}})
        self.assertIn('response',body['skill_response'])
        self.assertNotIn('start_account_linking',body['skill_response'])

    def test_bearer_sources_must_agree_and_skill_is_pinned(self):
        _,values=self.issue()
        self.assertEqual(self.skill(values['access_token'],session={'skill_id':settings.ALICE_SKILL_ID,'user':{'access_token':'wrong'}})[0],401)
        self.assertEqual(self.skill(values['access_token'],session={'skill_id':'another-skill','user':{}})[0],403)

    def test_duplicate_parameters_and_unsupported_grants_fail(self):
        query=urlencode({'client_id':settings.ALICE_CLIENT_ID,'redirect_uri':REDIRECT,'response_type':'code','state':'fixture','scope':SCOPE})
        self.assertEqual(self.api('request',query=query+'&state=other')[0],422)
        self.assertEqual(self.protocol(grant_type='client_credentials')[0],400)
        self.assertEqual(self.protocol(grant_type='password',code='unused')[0],400)
        self.assertEqual(self.api('token',body='grant_type=refresh_token&grant_type=authorization_code',authorization='')[0],422)

    def test_basic_auth_and_revocation(self):
        code=self.approve()
        basic='Basic '+base64.b64encode((settings.ALICE_CLIENT_ID+':'+settings.ALICE_CLIENT_SECRET).encode()).decode()
        status,body=self.api('token',body=urlencode({'grant_type':'authorization_code','code':code,'redirect_uri':REDIRECT}),authorization=basic)
        self.assertEqual(body['oauth_status'],200,body)
        values=body['oauth_body']
        status,revoked=self.api('revoke',body=urlencode({'token':values['refresh_token']}),authorization=basic)
        self.assertEqual(revoked['oauth_status'],200,revoked)
        self.assertEqual(self.protocol(grant_type='refresh_token',refresh_token=values['refresh_token'])[0],400)

    def test_feature_disabled_is_closed(self):
        with override_settings(ALICE_LINK_ENABLED=False):
            self.assertEqual(self.api('status',session_token=self.token)[0],404)

    def test_rate_limit_bounds_anonymous_persistence(self):
        for _ in range(60):
            self.start()
        before=AuthorizationRequest.objects.count()
        query=urlencode({'client_id':settings.ALICE_CLIENT_ID,'redirect_uri':REDIRECT,'response_type':'code','state':'fixture','scope':SCOPE})
        self.assertEqual(self.api('request',query=query)[0],429)
        self.assertEqual(AuthorizationRequest.objects.count(),before)

    def test_cleanup_erases_expired_ciphertext_but_keeps_active_grants(self):
        from alisa_platform.alice_link.cleanup import cleanup
        _,values=self.issue()
        ref,_=self.start(self.token)
        AuthorizationRequest.objects.filter(secret_hash=digest(ref)).update(expires_at=timezone.now()-timedelta(seconds=1))
        TokenFamily.objects.filter(refresh_hash=digest(values['refresh_token'])).update(retry_until=timezone.now()-timedelta(seconds=1))
        cleanup()
        self.assertEqual(AuthorizationRequest.objects.get(secret_hash=digest(ref)).encrypted_payload,'')
        self.assertEqual(TokenFamily.objects.get(refresh_hash=digest(values['refresh_token'])).encrypted_response,'')
        self.assertEqual(self.skill(values['access_token'])[0],200)
        self.assertEqual(self.protocol(grant_type='refresh_token',refresh_token=values['refresh_token'])[0],200)

    def test_cross_grant_fields_cannot_select_another_customer_lock(self):
        code,values=self.issue()
        self.assertEqual(self.protocol(grant_type='refresh_token',refresh_token=values['refresh_token'],code=code)[0],400)

    @unittest.skipUnless(POSTGRES,'Row-lock concurrency requires the isolated PostgreSQL qualification')
    def test_concurrent_code_exchange_has_exactly_one_effect(self):
        code=self.approve()
        def exchange(_):
            try:return self.protocol(grant_type='authorization_code',code=code,redirect_uri=REDIRECT)[0]
            finally:connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(exchange,range(2))),[200,400])
        self.assertEqual(TokenFamily.objects.filter(link__customer=self.owner.customer).count(),1)

    @unittest.skipUnless(POSTGRES,'Row-lock concurrency requires the isolated PostgreSQL qualification')
    def test_concurrent_refresh_returns_same_retry_response(self):
        _,values=self.issue()
        TokenFamily.objects.filter(refresh_hash=digest(values['refresh_token'])).update(retry_until=timezone.now()-timedelta(seconds=1))
        def exchange(_):
            try:return self.protocol(grant_type='refresh_token',refresh_token=values['refresh_token'])
            finally:connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(exchange,range(2)))
        self.assertEqual([r[0] for r in results],[200,200])
        self.assertEqual(results[0][1]['access_token'],results[1][1]['access_token'])
        self.assertEqual(TokenFamily.objects.filter(link__customer=self.owner.customer).count(),1)

    @unittest.skipUnless(POSTGRES,'Existing access ledger and store vault require their PostgreSQL invariants')
    def test_link_refresh_unlink_leave_store_secrets_and_gift_access_unchanged(self):
        from alisa_platform.stores.models import Store, VaultSecret, CredentialRevision
        from alisa_platform.stores.vault import seal
        from alisa_platform.entitlements.models import AccessGrant
        store=Store.objects.create(tenant=self.owner.tenant,provider='OZON',name='Fixture store')
        cipher,version=seal(store,'SELLER',1,{'client_id':'fixture-only','api_key':secrets.token_urlsafe(32)})
        secret=VaultSecret.objects.create(tenant=self.owner.tenant,store=store,kind='SELLER',revision=1,key_version=version,ciphertext=cipher)
        credential=CredentialRevision.objects.create(tenant=self.owner.tenant,store=store,kind='SELLER',revision=1,secret=secret,status='ACTIVE',check_code='CONNECTED')
        grant=AccessGrant.objects.create(tenant=self.owner.tenant,source='GIFT',source_id=uuid.uuid4(),days=30,
            starts_at=timezone.now(),ends_at=timezone.now()+timedelta(days=30),actor_id=uuid.uuid4(),reason='FIXTURE')
        def snapshot():
            return [model.objects.filter(pk=pk).values().get() for model,pk in
                    [(Store,store.pk),(VaultSecret,secret.pk),(CredentialRevision,credential.pk),(AccessGrant,grant.pk)]]
        before=snapshot()
        _,values=self.issue()
        self.skill(values['access_token'])
        self.protocol(grant_type='refresh_token',refresh_token=values['refresh_token'])
        self.api('unlink',session_token=self.token)
        self.issue()
        self.assertEqual(snapshot(),before)

    @unittest.skipUnless(POSTGRES,'Row-lock concurrency requires the isolated PostgreSQL qualification')
    def test_concurrent_unlink_and_refresh_cannot_leave_a_live_grant(self):
        _,values=self.issue()
        TokenFamily.objects.filter(refresh_hash=digest(values['refresh_token'])).update(retry_until=timezone.now()-timedelta(seconds=1))
        def operation(action):
            try:
                if action=='unlink':return self.api('unlink',session_token=self.token)
                return self.protocol(grant_type='refresh_token',refresh_token=values['refresh_token'])
            finally:connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(operation,['unlink','refresh']))
        self.assertEqual(results[0][0],200)
        self.assertIn(results[1][0],{200,400})
        self.assertEqual(self.api('status',session_token=self.token)[1]['alice']['state'],'DISCONNECTED')
        self.assertEqual(self.protocol(grant_type='refresh_token',refresh_token=values['refresh_token'])[0],400)

    @unittest.skipUnless(POSTGRES,'Session row-lock serialization requires the isolated PostgreSQL qualification')
    def test_logout_committed_before_consent_lock_prevents_new_grant(self):
        ref,_=self.start(self.token)
        started=threading.Event();worker={}
        def approve():
            try:
                with connections['default'].cursor() as cursor:
                    cursor.execute('SELECT pg_backend_pid()');worker['pid']=cursor.fetchone()[0]
                started.set()
                return self.api('approve',session_token=self.token,flow_ref=ref)
            finally:connections.close_all()
        with ThreadPoolExecutor(max_workers=1) as pool:
            with transaction.atomic():
                WebSession.objects.select_for_update().get(pk=self.owner.pk)
                future=pool.submit(approve)
                self.assertTrue(started.wait(3))
                blocked=False;deadline=time.monotonic()+3
                while time.monotonic()<deadline and not future.done():
                    with connections['default'].cursor() as cursor:
                        cursor.execute('SELECT cardinality(pg_blocking_pids(%s))',[worker['pid']])
                        blocked=cursor.fetchone()[0]>0
                    if blocked:break
                    time.sleep(.01)
                self.assertTrue(blocked,'Consent must wait for the same row that logout updates')
                WebSession.objects.filter(pk=self.owner.pk).update(revoked_at=timezone.now(),encrypted_payload='')
            self.assertEqual(future.result(timeout=3)[0],401)
        self.assertFalse(AliceLink.objects.filter(customer=self.owner.customer).exists())
        self.assertFalse(AuthorizationCode.objects.filter(link__customer=self.owner.customer).exists())

    @unittest.skipUnless(POSTGRES,'Existing account cleanup timer is qualified on PostgreSQL')
    def test_disabled_feature_still_erases_expired_private_envelopes(self):
        _,values=self.issue()
        ref,_=self.start(self.token)
        AuthorizationRequest.objects.filter(secret_hash=digest(ref)).update(expires_at=timezone.now()-timedelta(seconds=1))
        TokenFamily.objects.filter(refresh_hash=digest(values['refresh_token'])).update(retry_until=timezone.now()-timedelta(seconds=1))
        with override_settings(ALICE_LINK_ENABLED=False):
            call_command('accounts_cleanup',verbosity=0)
        self.assertEqual(AuthorizationRequest.objects.get(secret_hash=digest(ref)).encrypted_payload,'')
        self.assertEqual(TokenFamily.objects.get(refresh_hash=digest(values['refresh_token'])).encrypted_response,'')


if __name__=='__main__':
    if '--output' in sys.argv:
        output=Path(sys.argv[sys.argv.index('--output')+1])
        result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(SkillChecks))
        output.write_text(json.dumps({'scope':'S06_DISPOSABLE_POSTGRES_BACKEND_NOT_INSTALLED','status':'PASS' if result.wasSuccessful() else 'FAILED',
                                     'tests':result.testsRun,'skipped':len(result.skipped),'failures':len(result.failures),'errors':len(result.errors)},indent=2)+'\n')
        raise SystemExit(0 if result.wasSuccessful() else 1)
    unittest.main(verbosity=2)
