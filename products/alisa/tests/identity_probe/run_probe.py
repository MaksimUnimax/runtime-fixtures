"""Exercise the unmodified candidate through Django HTTP views on disposable PG.

Reports capabilities and missing policies separately. No live configuration,
credentials, real recipients, product grants, or remote HTTP requests are used.
"""
import base64
import datetime
import hashlib
import html
import importlib.metadata
import json
import os
import multiprocessing
from pathlib import Path
import re
import secrets
import sys
import time
import urllib.parse
import uuid
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
PRODUCT = HERE.parents[1]
sys.path[:0] = [str(HERE.parent), str(PRODUCT/'services/identity/src')]
os.environ['DJANGO_SETTINGS_MODULE'] = 'identity_probe.settings'
import django
django.setup()

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import make_password
from django.core import mail
from django.core.management import call_command
from django.db import connection, connections
from django.test import Client as Browser, override_settings
from django.urls import reverse
from allauth.account.models import EmailAddress
from allauth.idp.oidc.models import Client
from allauth.mfa.totp.internal.auth import TOTP, generate_totp_secret, hotp_value, format_hotp_value
from identity_probe.settings import test_key
import jwt

ORIGIN = 'https://id-probe.example.invalid'
OBSERVATIONS = []

def record(name, passed, kind='capability'):
    OBSERVATIONS.append({'check': name, 'passed': bool(passed), 'kind': kind})

def browser():
    return Browser(enforce_csrf_checks=True, HTTP_HOST='id-probe.example.invalid')

def post(b, path, data):
    return b.post(path, data, secure=True, HTTP_ORIGIN=ORIGIN,
                  HTTP_X_CSRFTOKEN=b.cookies.get('csrftoken').value if 'csrftoken' in b.cookies else '')

def request_email_code(b, email):
    path=reverse('account_request_login_code')
    b.get(path,secure=True)
    previous=len(getattr(mail,'outbox',[]))
    response=post(b,path,{'email':email})
    if response.status_code!=302 or len(mail.outbox)!=previous+1:
        raise RuntimeError('Probe expected exactly one private verification message')
    match=re.search(r'(?m)^\s*([A-Z0-9]{4}-[A-Z0-9]{4})\s*$',mail.outbox[-1].body)
    if not match:raise RuntimeError('Probe login-code format does not match the pinned candidate')
    return match.group(1)

def new_client(label, public=True):
    secret = secrets.token_urlsafe(40)
    c = Client.objects.create(id='probe-'+label, name=label, secret=make_password(secret),
        type=Client.Type.PUBLIC if public else Client.Type.CONFIDENTIAL,
        scopes='openid\nemail\nprofile', default_scopes='openid', skip_consent=True,
        response_types='code', grant_types='authorization_code',
        redirect_uris='https://'+label+'.example.invalid/auth/callback')
    return c, secret

def authorize(b, metadata, client, method='S256', challenge=True, nonce=None):
    verifier = secrets.token_urlsafe(48)
    nonce = nonce or secrets.token_urlsafe(24)
    state = secrets.token_urlsafe(24)
    params = {'client_id':client.pk, 'response_type':'code', 'scope':'openid email',
              'redirect_uri':client.redirect_uris, 'state':state, 'nonce':nonce}
    if challenge:
        params['code_challenge'] = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode() if method=='S256' else verifier
        params['code_challenge_method'] = method
    result=b.get(urllib.parse.urlsplit(metadata['authorization_endpoint']).path,params,secure=True)
    values=urllib.parse.parse_qs(urllib.parse.urlsplit(result.get('Location','')).query)
    return {'response':result, 'values':values, 'verifier':verifier, 'nonce':nonce, 'state':state}

def redeem(b, metadata, client, flow, verifier=None, secret=None):
    data={'grant_type':'authorization_code','client_id':client.pk,
          'redirect_uri':client.redirect_uris,'code':flow['values'].get('code',[''])[0],
          'code_verifier':flow['verifier'] if verifier is None else verifier}
    headers={}
    if secret:
        headers['HTTP_AUTHORIZATION']='Basic '+base64.b64encode((client.pk+':'+secret).encode()).decode()
    return b.post(urllib.parse.urlsplit(metadata['token_endpoint']).path,data,secure=True,**headers)

def claims(token, keys, audience, issuer=ORIGIN):
    kid=jwt.get_unverified_header(token)['kid']
    key=next(k for k in keys['keys'] if k['kid']==kid)
    return jwt.decode(token,jwt.PyJWK.from_dict(key).key,algorithms=['RS256'],
                      audience=audience,issuer=issuer,options={'require':['exp','iat','iss','aud','sub']})

def rejected(callback):
    try:callback()
    except jwt.InvalidTokenError:return True
    return False

def parallel_redeem(metadata,client_id,flow,barrier,results):
    try:
        c=Client.objects.get(pk=client_id)
        barrier.wait(timeout=8)
        result=redeem(browser(),metadata,c,flow)
        results.put(result.status_code)
    except Exception:results.put(599)
    finally:connections.close_all()

def run():
    with connection.cursor() as cursor:
        cursor.execute('SELECT current_database(),inet_server_addr()')
        database,address=cursor.fetchone()
    if database!='alisa_s02_probe' or address is not None:
        raise RuntimeError('Only the separate unix-socket probe database is admitted')
    call_command('migrate',verbosity=0,interactive=False)
    if settings.PROBE_POLICY_ENABLED:call_command('createcachetable',verbosity=0)
    person=get_user_model().objects.create_user(username='probe-person',email='person@example.invalid')
    EmailAddress.objects.create(user=person,email=person.email,primary=True,verified=True)
    record('existing_uuid_person_and_allauth_migrations',isinstance(person.pk,uuid.UUID))
    b=browser()
    code=request_email_code(b,person.email)
    record('email_login_code_generated_without_external_mail',len(mail.outbox)==1)
    confirm=reverse('account_confirm_login_code')
    b.get(confirm,secure=True)
    stranger=browser();stranger.get(reverse('account_request_login_code'),secure=True);stranger.get(confirm,secure=True)
    stranger_reply=post(stranger,confirm,{'code':code})
    record('email_code_bound_to_issuing_browser',stranger_reply.status_code in [302,409] and '_auth_user_id' not in stranger.session)
    wrong_code='AAAA-AAAA' if code!='AAAA-AAAA' else 'BBBB-BBBB'
    wrong=post(b,confirm,{'code':wrong_code})
    record('wrong_email_code_denied',wrong.status_code==200 and '_auth_user_id' not in b.session)
    accepted=post(b,confirm,{'code':code})
    record('library_email_code_creates_identity_session',accepted.status_code==302 and b.session.get('_auth_user_id')==str(person.pk))
    cookie=b.cookies[settings.SESSION_COOKIE_NAME]
    record('host_only_secure_httponly_lax_identity_cookie',not cookie['domain'] and cookie['secure'] and cookie['httponly'] and cookie['samesite']=='Lax')
    b.get(reverse('account_logout'),secure=True)
    post(b,reverse('account_logout'),{})
    replay=post(b,confirm,{'code':code})
    record('used_email_code_denied_after_logout',replay.status_code in [302,409] and '_auth_user_id' not in b.session and get_user_model().objects.count()==1)
    fresh_code=request_email_code(b,person.email);b.get(confirm,secure=True)
    post(b,confirm,{'code':fresh_code})
    record('fresh_login_preserves_same_person',b.session.get('_auth_user_id')==str(person.pk) and get_user_model().objects.count()==1)
    expired_browser=browser();expired_code=request_email_code(expired_browser,person.email);expired_browser.get(confirm,secure=True)
    with patch('time.time',return_value=time.time()+901):
        post(expired_browser,confirm,{'code':expired_code})
    record('expired_email_code_denied','_auth_user_id' not in expired_browser.session)
    limited_browser=browser();limited_code=request_email_code(limited_browser,person.email);limited_browser.get(confirm,secure=True)
    invalid_code='AAAA-AAAA' if limited_code!='AAAA-AAAA' else 'BBBB-BBBB'
    for _ in range(5):post(limited_browser,confirm,{'code':invalid_code})
    post(limited_browser,confirm,{'code':limited_code})
    record('five_wrong_email_codes_exhaust_stage','_auth_user_id' not in limited_browser.session)
    metadata=b.get('/.well-known/openid-configuration',secure=True).json()
    record('discovery_uses_expected_issuer',metadata['issuer']==ORIGIN)
    record('discovery_advertises_s256',metadata['code_challenge_methods_supported']==['S256'])
    other=b.get('/.well-known/openid-configuration',secure=True,HTTP_HOST='alternate-probe.example.invalid')
    record('noncanonical_host_cannot_change_issuer',
        (other.status_code==400 and other.json().get('error')=='invalid_host') if settings.PROBE_POLICY_ENABLED
        else other.status_code==200 and other.json()['issuer']==ORIGIN,'required_policy')
    first,_=new_client('alisa')
    second,_=new_client('isolated')
    confidential,client_secret=new_client('confidential',False)
    good=authorize(b,metadata,first)
    record('library_authorization_code_and_state_echo',bool(good['values'].get('code')) and good['values'].get('state')==[good['state']])
    token_result=redeem(b,metadata,first,good)
    record('s256_code_exchange',token_result.status_code==200)
    tokens=token_result.json();token=tokens['id_token']
    keys=b.get(urllib.parse.urlsplit(metadata['jwks_uri']).path,secure=True).json()
    verified=claims(token,keys,first.pk)
    record('signed_issuer_audience_expiry_subject_nonce',verified['sub']==str(person.pk) and verified['nonce']==good['nonce'])
    record('authorization_code_one_use',redeem(b,metadata,first,good).status_code==400)
    race_flow=authorize(b,metadata,first)
    connections.close_all()
    ctx=multiprocessing.get_context('fork');barrier=ctx.Barrier(2);results=ctx.Queue()
    workers=[ctx.Process(target=parallel_redeem,args=(metadata,first.pk,race_flow,barrier,results)) for _ in range(2)]
    statuses=[]
    try:
        for worker in workers:worker.start()
        statuses=[results.get(timeout=12) for _ in workers]
    finally:
        for worker in workers:
            worker.join(timeout=3)
            if worker.is_alive():worker.terminate();worker.join(timeout=3)
        results.close();results.join_thread()
    record('authorization_code_atomic_across_workers',sorted(statuses)==[200,400],'required_policy')
    wrong_flow=authorize(b,metadata,first)
    record('wrong_pkce_verifier_denied',redeem(b,metadata,first,wrong_flow,verifier=secrets.token_urlsafe(48)).status_code==400)
    no_pkce=authorize(b,metadata,first,challenge=False)
    record('public_client_requires_pkce',not no_pkce['values'].get('code'))
    plain=authorize(b,metadata,first,method='plain')
    record('plain_pkce_method_denied',not plain['values'].get('code'),'required_policy')
    no_pkce_confidential=authorize(b,metadata,confidential,challenge=False)
    record('confidential_client_requires_pkce',not no_pkce_confidential['values'].get('code'),'required_policy')
    if no_pkce_confidential['values'].get('code'):
        r=redeem(b,metadata,confidential,no_pkce_confidential,secret=client_secret)
        record('observed_confidential_non_pkce_exchange',r.status_code==200,'baseline_observation')
    endpoint=urllib.parse.urlsplit(metadata['authorization_endpoint']).path
    bypass=post(b,endpoint,{'client_id':first.pk,'response_type':'code','scope':'openid',
        'redirect_uri':first.redirect_uris,'state':secrets.token_urlsafe(24),'nonce':secrets.token_urlsafe(24),
        'code_challenge':secrets.token_urlsafe(48),'code_challenge_method':'plain'})
    target=urllib.parse.urlsplit(bypass.get('Location',''))
    if target.path==endpoint:bypass=b.get(target.path+'?'+target.query,secure=True)
    record('authorization_post_cannot_bypass_s256',bypass.status_code==400,'required_policy')
    consent_client,_=new_client('consent');consent_client.skip_consent=False;consent_client.save()
    consent_flow=authorize(b,metadata,consent_client)
    hidden=re.search(r'name="request"[^>]*value="([^"]+)"',consent_flow['response'].content.decode())
    if not hidden:raise RuntimeError('Probe expected the library signed consent form')
    consent_reply=post(b,endpoint,{'request':html.unescape(hidden.group(1)),'action':'grant','scopes':['openid','email']})
    consent_flow['values']=urllib.parse.parse_qs(urllib.parse.urlsplit(consent_reply.get('Location','')).query)
    record('legitimate_signed_consent_still_works',bool(consent_flow['values'].get('code')) and redeem(b,metadata,consent_client,consent_flow).status_code==200)
    second_flow=authorize(b,metadata,second)
    second_tokens=redeem(b,metadata,second,second_flow).json()
    second_claims=claims(second_tokens['id_token'],keys,second.pk)
    record('second_client_has_own_audience',second_claims['aud']==second.pk)
    record('second_client_token_rejected_by_first_client',rejected(lambda:claims(second_tokens['id_token'],keys,first.pk)))
    record('wrong_issuer_denied_by_jwt_library',rejected(lambda:claims(token,keys,first.pk,issuer='https://wrong.example.invalid')))
    parts=token.split('.');parts[2]=('A' if parts[2][0]!='A' else 'B')+parts[2][1:]
    record('tampered_signature_denied',rejected(lambda:claims('.'.join(parts),keys,first.pk)))
    with override_settings(IDP_OIDC_ID_TOKEN_EXPIRES_IN=-1):
        expired=redeem(b,metadata,first,authorize(b,metadata,first)).json()['id_token']
    record('expired_token_denied',rejected(lambda:claims(expired,keys,first.pk)))
    invalid=b.get(urllib.parse.urlsplit(metadata['authorization_endpoint']).path,
        {'client_id':first.pk,'response_type':'code','scope':'openid','redirect_uri':'https://wrong.example.invalid/callback',
         'state':secrets.token_urlsafe(24),'nonce':secrets.token_urlsafe(24),
         'code_challenge':base64.urlsafe_b64encode(hashlib.sha256(b'v'*64).digest()).rstrip(b'=').decode(),
         'code_challenge_method':'S256'},secure=True)
    record('unregistered_callback_not_followed',not invalid.get('Location','').startswith('https://wrong.example.invalid'))
    new_pem=test_key()
    with override_settings(IDP_OIDC_PRIVATE_KEY='',IDP_OIDC_PRIVATE_KEYS=[
        {'pem':settings.IDP_OIDC_PRIVATE_KEY,'issued_at':'2026-01-01T00:00:00+00:00'},
        {'pem':new_pem,'issued_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}]):
        rotated=redeem(b,metadata,first,authorize(b,metadata,first)).json()['id_token']
        rotated_keys=b.get(urllib.parse.urlsplit(metadata['jwks_uri']).path,secure=True).json()
        record('rotation_publishes_both_keys',len(rotated_keys['keys'])==2)
        record('rotation_changes_active_signing_key',jwt.get_unverified_header(rotated)['kid']!=jwt.get_unverified_header(token)['kid'])
        record('old_and_new_tokens_validate_during_rotation',claims(token,rotated_keys,first.pk)['sub']==claims(rotated,rotated_keys,first.pk)['sub'])
    secret=generate_totp_secret();totp=TOTP.activate(person,secret)
    totp_code=format_hotp_value(hotp_value(secret,int(time.time())//30))
    record('library_totp_factor_validates',totp.validate_code(totp_code))
    record('library_totp_factor_replay_denied',not totp.validate_code(totp_code))
    b.get(reverse('account_logout'),secure=True)
    logout=post(b,reverse('account_logout'),{})
    record('identity_logout_clears_session',logout.status_code==302 and '_auth_user_id' not in b.session)
    record('no_product_tables_created',not any(t.startswith(('leads_','funnel_','platform_')) for t in connection.introspection.table_names()))

def main():
    started=datetime.datetime.now(datetime.timezone.utc).isoformat()
    error=None
    error_module=None
    error_location=None
    try:run()
    except Exception as exc:
        error=type(exc).__name__
        if isinstance(exc,ModuleNotFoundError):error_module=exc.name
        frame=exc.__traceback__
        while frame and frame.tb_next:frame=frame.tb_next
        if frame:error_location={'file':Path(frame.tb_frame.f_code.co_filename).name,'line':frame.tb_lineno}
    gaps=[x['check'] for x in OBSERVATIONS if not x['passed'] and x['kind']=='required_policy']
    failures=[x['check'] for x in OBSERVATIONS if not x['passed'] and x['kind']=='capability']
    result={'record_type':'AL_S02_PROVIDER_CANDIDATE_PROBE','candidate':'django-allauth=='+importlib.metadata.version('django-allauth'),
        'django':django.get_version(),'database':'Private disposable PostgreSQL cluster; unix socket only; no stage/live database',
        'email':'Django in-memory backend, example.invalid only; not SMTP/real delivery acceptance',
        'started_at_utc':started,'finished_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'status':'FAILED' if error or failures else 'REQUIRES_POLICY_ADAPTERS' if gaps else 'PROBE_PASSED',
        'mode':'hardened_candidate' if settings.PROBE_POLICY_ENABLED else 'unmodified_candidate',
        'observations':OBSERVATIONS,'required_policy_gaps':gaps,'capability_failures':failures,'error_type':error,'error_module':error_module,'error_location':error_location,
        'not_proven':['Real browser and TLS','BFF callback state/nonce storage/consumption and product session','Separate-process networked IdP deployment and service restart','Registration/tenant idempotency and second-client product data denial','Browser MFA enrollment/login and RP-initiated logout policy','Real controlled email delivery'],
        'runtime_changed':False,'live_services_or_databases_changed':False}
    output=Path(sys.argv[1]);output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'status':result['status'],'observations':len(OBSERVATIONS),'gaps':gaps,'failures':failures,'error_type':error}))
    return 1 if error or failures else 0

if __name__=='__main__':sys.exit(main())
