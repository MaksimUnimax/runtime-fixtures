#!/usr/bin/env python3
"""Finite full AL-S02 source qualification on the guarded disposable CI cluster.

Private CA is trusted explicitly by Python/Node and an isolated browser NSS home;
certificate verification is never disabled. No live config/DB/mail is available.
"""
import argparse,base64,hashlib,json,os,re,secrets,signal,ssl,subprocess,sys,tarfile,tempfile,time,threading,uuid
from pathlib import Path
from urllib.parse import urlencode,urlsplit,parse_qs
import urllib.request,urllib.error
from email import policy
from email.parser import BytesParser
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor
import psycopg
from psycopg import sql
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from playwright.sync_api import sync_playwright,expect
import jwt
from identity_tls import certificates,start_proxy
from qualify_leads import Sink,SMTP,link as lead_link
from run_postgres import clean_environment,stop,expected_database_connect_denial

ROOT=Path(__file__).resolve().parents[2]
WEB='https://127.0.0.1:19440';ISSUER='https://localhost:19443'
NAMES=['alisa_stage_platform','alisa_stage_identity']
CASES=[];PROCESSES=[]
def check(name,condition,**safe):
    if not condition:raise RuntimeError('CHECK_FAILED:'+name)
    CASES.append({'case':name,'passed':True,**safe});print(json.dumps(CASES[-1]),flush=True)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--artifact',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    params=psycopg.conninfo.conninfo_to_dict(os.environ.get('ALISA_TEST_PG_DSN',''))
    if (os.environ.get('ALISA_TEST_DB_ALLOW')!='1' or params.get('host')!='127.0.0.1' or params.get('port')!='55480' or params.get('dbname')!='alisa_ci_admin' or params.get('user')!='alisa_ci_admin' or not params.get('password') or set(params)-{'host','port','dbname','user','password'}):
        raise RuntimeError('Guarded disposable CI database required')
    params.update(hostaddr='127.0.0.1',sslmode='disable',connect_timeout=3)
    def connect(database=None,user=None,password=None):
        config={**params}
        if database:config['dbname']=database
        if user:config['user']=user;config['password']=password
        with patch.dict(os.environ,clean_environment(),clear=True):return psycopg.connect(**config,autocommit=True)
    admin=connect();owned=False;roles=[n+'_'+r for n in NAMES for r in ['migration','runtime']]
    record={'scope':'S02_FULL_DISPOSABLE_HTTPS_BROWSER_QUALIFICATION_NOT_STAGE_ACCEPTANCE','status':'RUNNING','cases':CASES,'not_run':['live_stage_rollout','controlled_real_email','live_release_pair_rollback']}
    proxies=[];sink=None;browser=None;context=None;temporary=None;logs=None
    try:
        databases={r[0] for r in admin.execute('SELECT datname FROM pg_database WHERE NOT datistemplate')}
        if databases-{'postgres','alisa_ci_admin'}:raise RuntimeError('Disposable cluster is not empty')
        if any(admin.execute('SELECT 1 FROM pg_roles WHERE rolname=%s',[r]).fetchone() for r in roles):raise RuntimeError('Disposable role already exists')
        owned=True
        temporary=tempfile.TemporaryDirectory(prefix='alisa-s02-private-')
        if temporary:
            temp=Path(temporary.name);logs=(temp/'private-process.log').open('w+')
            with tarfile.open(args.artifact) as archive:archive.extractall(temp,filter='data')
            release=next(p for p in temp.iterdir() if p.is_dir() and p.name.startswith('alisa-'))
            manifest=json.loads((release/'manifest.json').read_text());record['source_sha']=manifest['source_sha'];record['artifact_sha256']=hashlib.sha256(args.artifact.read_bytes()).hexdigest()
            check('s02_immutable_package_hashes',all(hashlib.sha256((release/name).read_bytes()).hexdigest()==digest for name,digest in manifest['files'].items()))
            credentials={c:{r+'_password':secrets.token_urlsafe(36) for r in ['migration','runtime']} for c in ['platform','identity']}
            dsn=temp/'admin.dsn';dsn.write_text(psycopg.conninfo.make_conninfo(**params));dsn.chmod(0o600)
            inputs=temp/'credentials.json';inputs.write_text(json.dumps(credentials));inputs.chmod(0o600)
            subprocess.run([sys.executable,str(release/'infra/db/provision.py'),'--env','stage','--admin-dsn-file',str(dsn),'--credentials-file',str(inputs)],env=clean_environment(),check=True,stdout=logs,stderr=logs)
            # Verify the offline installation includes BOTH authority lockfiles.
            subprocess.run([sys.executable,'-m','venv',str(release/'.venv')],check=True,stdout=logs,stderr=logs)
            py=release/'.venv/bin/python'
            subprocess.run([str(py),'-m','pip','install','--no-index','--find-links',str(release/'wheels'),'--require-hashes','-r',str(release/'services/platform/requirements.lock'),'-r',str(release/'services/identity/requirements.lock')],check=True,stdout=logs,stderr=logs)
            check('s02_offline_identity_dependencies_installed',True)
            ca,cert,key=certificates(temp);tls=ssl.create_default_context(cafile=ca)
            home=temp/'browser-home';nss=home/'.pki/nssdb';nss.mkdir(parents=True)
            subprocess.run(['certutil','-N','-d','sql:'+str(nss),'--empty-password'],check=True,stdout=logs,stderr=logs)
            subprocess.run(['certutil','-A','-d','sql:'+str(nss),'-n','Alisa owned CI root','-t','C,,','-i',str(ca)],check=True,stdout=logs,stderr=logs)
            data_key=Fernet.generate_key().decode();bff_key=secrets.token_urlsafe(32)
            private_key=rsa.generate_private_key(public_exponent=65537,key_size=2048).private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()).decode()
            signing=base64.b64encode(json.dumps([{'pem':private_key,'issued_at':'2026-01-01T00:00:00+00:00'}]).encode()).decode()
            service=secrets.token_urlsafe(40);auth_service=secrets.token_urlsafe(40);web_secret=secrets.token_urlsafe(40);probe_secret=secrets.token_urlsafe(40)
            base={**clean_environment(),'HOME':str(home),'ALISA_ENV':'dev','ALISA_RELEASE':manifest['artifact_id'],
                  'ALISA_ALLOWED_HOSTS':'127.0.0.1,localhost','ALISA_DB_HOST':'127.0.0.1','ALISA_DB_PORT':'55480',
                  'PYTHONDONTWRITEBYTECODE':'1'}
            identity_only={'ALISA_IDENTITY_ISSUER':ISSUER,'ALISA_PRODUCT_ORIGIN':WEB,
                  'ALISA_SMTP_HOST':'127.0.0.1','ALISA_SMTP_PORT':'18226','ALISA_IDENTITY_ENABLED':'1',
                  'ALISA_IDENTITY_DATA_KEYS':data_key,'ALISA_IDENTITY_SIGNING_KEYS_B64':signing}
            platform_only={'ALISA_SERVICE_TOKEN':service,'ALISA_AUTH_SERVICE_TOKEN':auth_service,'ALISA_ACCOUNTS_ENABLED':'1',
                  'ALISA_IDENTITY_ISSUER':ISSUER,'ALISA_WEB_OIDC_CLIENT_ID':'s02_web','ALISA_LEAD_INTAKE_ENABLED':'1',
                  'ALISA_PUBLIC_BASE_URL':WEB,'ALISA_SMTP_HOST':'127.0.0.1','ALISA_SMTP_PORT':'18226'}
            client_bootstrap={'ALISA_WEB_OIDC_CLIENT_ID':'s02_web','ALISA_WEB_OIDC_CLIENT_SECRET':web_secret,
                  'ALISA_WEB_OIDC_REDIRECT_URI':WEB+'/auth/callback','ALISA_PROBE_OIDC_CLIENT_ID':'s02_probe',
                  'ALISA_PROBE_OIDC_CLIENT_SECRET':probe_secret,'ALISA_PROBE_OIDC_REDIRECT_URI':WEB+'/oidc-probe/callback'}
            component_keys={c:secrets.token_urlsafe(48) for c in ['platform','identity','web']}
            web_env={**clean_environment(),'HOME':str(home),'ALISA_ENV':'dev','ALISA_RELEASE':manifest['artifact_id'],
                  'ALISA_LEAD_INTAKE_ENABLED':'1','ALISA_SECRET_KEY':component_keys['web'],'ALISA_ACCOUNTS_ENABLED':'1','ALISA_IDENTITY_ISSUER':ISSUER,
                  'ALISA_PUBLIC_BASE_URL':WEB,'ALISA_SERVICE_TOKEN':service,'ALISA_AUTH_SERVICE_TOKEN':auth_service,
                  'ALISA_WEB_OIDC_CLIENT_ID':'s02_web','ALISA_WEB_OIDC_CLIENT_SECRET':web_secret,'NODE_EXTRA_CA_CERTS':str(ca),
                  'ALISA_WEB_SESSION_KEY':bff_key,'ALISA_PLATFORM_URL':'http://127.0.0.1:18402','ALISA_ALLOWED_HOSTS':'127.0.0.1,localhost'}
            def env(component,migration=False):
                name='alisa_stage_'+component;role='migration' if migration else 'runtime'
                return {**base,**(identity_only if component=='identity' else platform_only),'ALISA_SECRET_KEY':component_keys[component],
                        'ALISA_DB_NAME':name,'ALISA_DB_USER':name+'_'+role,'ALISA_DB_PASSWORD':credentials[component][role+'_password'],
                        'PYTHONPATH':str(release/'services'/component/'src'),'DJANGO_SETTINGS_MODULE':('alisa_platform' if component=='platform' else 'octoport_identity')+'.config.settings'}
            def manage(component,arguments,migration=False):
                return subprocess.run([str(py),str(release/'services'/component/'manage.py'),*arguments],env=env(component,migration),check=True,stdout=logs,stderr=logs,timeout=25)
            for component in ['platform','identity']:manage(component,['migrate','--noinput'],True)
            subprocess.run([str(py),str(release/'services/identity/manage.py'),'identity_clients','--apply'],env={**env('identity',True),**client_bootstrap},check=True,stdout=logs,stderr=logs,timeout=25)
            check('s02_separate_migrations_and_confidential_clients',True)
            for name,other in [('platform','identity'),('identity','platform')]:
                try:connect('alisa_stage_'+other,'alisa_stage_'+name+'_runtime',credentials[name]['runtime_password']).close();denied=False
                except psycopg.OperationalError as exc:denied=expected_database_connect_denial(exc)
                check('s02_'+name+'_foreign_database_denied',denied)
            def spawn(arguments,environment):
                p=subprocess.Popen(list(map(str,arguments)),env=environment,stdout=logs,stderr=logs,start_new_session=True);PROCESSES.append(p);return p
            def start(component):
                module='alisa_platform' if component=='platform' else 'octoport_identity';port=18402 if component=='platform' else 18403
                return spawn([py,'-m','gunicorn',module+'.config.wsgi:application','--bind','127.0.0.1:'+str(port),'--workers','2','--access-logfile','-','--access-logformat','%(m)s %(U)s %(s)s'],env(component))
            api=start('platform');authority=start('identity')
            web=spawn(['node',release/'ui/web/apps/web/server.js'],{**web_env,'PORT':'18400','HOSTNAME':'127.0.0.1'})
            proxies=[start_proxy(19440,18400,cert,key),start_proxy(19443,18403,cert,key)]
            opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPSHandler(context=tls))
            def request(url,method='GET',data=None,headers=None):
                body=json.dumps(data).encode() if data is not None else None
                req=urllib.request.Request(url,data=body,method=method,headers={'Content-Type':'application/json',**(headers or {})})
                try:
                    with opener.open(req,timeout=8) as r:raw=r.read();return r.status,json.loads(raw) if r.headers.get('Content-Type','').startswith('application/json') else raw
                except urllib.error.HTTPError as exc:
                    raw=exc.read();return exc.code,json.loads(raw) if exc.headers.get('Content-Type','').startswith('application/json') else raw
            for url in [WEB+'/health/ready',ISSUER+'/health/ready']:
                for _ in range(100):
                    try:
                        if request(url)[0]==200:break
                    except OSError:pass
                    time.sleep(.1)
                else:raise RuntimeError('Owned service readiness timeout')
            check('s02_strict_https_web_and_identity_ready',True)
            metadata=request(ISSUER+'/.well-known/openid-configuration')[1]
            check('s02_fixed_issuer_and_s256_discovery',metadata['issuer']==ISSUER and metadata['code_challenge_methods_supported']==['S256'])
            sink=Sink(('127.0.0.1',18226),SMTP);sink.messages=[];threading.Thread(target=sink.serve_forever,daemon=True).start()
            contacts=[];private_values=[service,auth_service,web_secret,probe_secret,data_key,bff_key]
            def letter(email):
                matches=[]
                for item in sink.messages:
                    msg=BytesParser(policy=policy.default).parsebytes(item)
                    if email in str(msg.get('To','')):matches.append(msg.get_body(preferencelist=('plain',)).get_content())
                if not matches:raise RuntimeError('Expected private message missing')
                match=re.search(r'(?m)^\s*([A-Z0-9]{4}-[A-Z0-9]{4})\s*$',matches[-1])
                if not match:raise RuntimeError('Expected code format missing')
                private_values.append(match.group(1));return match.group(1)
            def db(component):return connect('alisa_stage_'+component)
            with sync_playwright() as p:
                browser=p.chromium.launch(headless=True,env={**clean_environment(),'HOME':str(home)})
                context=browser.new_context(ignore_https_errors=False);page=context.new_page()
                page.goto(WEB+'/app');expect(page).to_have_url(re.compile('/login'))
                check('s02_private_home_requires_own_session',True)
                check('s02_no_service_cookie_or_data_in_anonymous_html',auth_service not in page.content())
                check('s02_start_requires_consents',request(WEB+'/auth/start','POST',{}, {'Origin':WEB})[0]==422)
                def open_identity(page):
                    page.goto(WEB+'/login');page.locator('input[name=service]').check();page.locator('input[name=privacy]').check();page.get_by_role('button',name='Войти или создать кабинет').click()
                    page.wait_for_url(re.compile(re.escape(ISSUER)+r'/accounts/'))
                def register(page,email):
                    open_identity(page)
                    page.locator('a[href*="/accounts/signup/"]').first.click()
                    page.locator('input[name=email]').fill(email);page.locator('input[name=privacy]').check();page.locator('input[name=service]').check()
                    page.locator('form').filter(has=page.locator('input[name=email]')).locator('button[type=submit]').first.click()
                    expect(page.locator('input[name=code]')).to_be_visible()
                    manage('identity',['identity_deliver'])
                    page.locator('input[name=code]').fill(letter(email));page.locator('form').filter(has=page.locator('input[name=code]')).locator('button[type=submit]').first.click()
                    expect(page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible(timeout=15000)
                email='s02-'+uuid.uuid4().hex[:10]+'@example.invalid';contacts.append(email)
                # Lead handoff is opaque and has no authentication effect itself.
                page.goto(WEB+'/join');page.locator('input[name=email]').fill(email);page.locator('input[name=service]').check();page.get_by_role('button',name='Отправить тестовую заявку').click();expect(page.get_by_role('status')).to_contain_text('Заявка сохранена')
                manage('platform',['leads_deliver']);confirmation,lead_token=lead_link(sink.messages[-1]);private_values.append(lead_token['token'])
                page.goto(confirmation);page.get_by_role('button',name='Подтвердить контакт').click();expect(page.get_by_role('status')).to_contain_text('Контакт подтверждён')
                register(page,email)
                check('s02_real_browser_identity_code_bff_postgresql_home',True)
                check('s02_callback_does_not_retain_code_or_state',page.url==WEB+'/app')
                with db('platform') as conn:
                    counts=conn.execute('SELECT (SELECT count(*) FROM accounts_customer),(SELECT count(*) FROM accounts_tenant),(SELECT count(*) FROM accounts_membership),(SELECT count(*) FROM accounts_identitylink)').fetchone()
                    check('s02_one_customer_tenant_membership_identity_link',counts==(1,1,1,1),counts=list(counts))
                    check('s02_owner_client_and_no_grants',conn.execute('SELECT role FROM accounts_membership').fetchone()[0]=='OWNER_CLIENT')
                    first=conn.execute('SELECT customer_id,tenant_id FROM accounts_membership').fetchone()
                    check('s02_confirmed_lead_linked_only_after_verified_identity',conn.execute('SELECT count(*) FROM accounts_leadlink').fetchone()[0]==1)
                    check('s02_durable_product_consents',conn.execute('SELECT count(*) FROM accounts_consentrecord').fetchone()[0]==2)
                with db('identity') as conn:
                    check('s02_stable_uuid_person_and_identity_consents',conn.execute('SELECT count(*) FROM accounts_person').fetchone()[0]==1 and conn.execute('SELECT count(*) FROM accounts_identityconsent').fetchone()[0]==2)
                    check('s02_mail_payload_cleared_after_send',all(not row[0] for row in conn.execute('SELECT encrypted_payload FROM accounts_identitymail WHERE sent_at IS NOT NULL')))
                cookies=context.cookies();session=next(c for c in cookies if c['name']=='__Host-alisa_session')
                check('s02_host_only_secure_httponly_lax_product_cookie',session['domain']=='127.0.0.1' and session['secure'] and session['httpOnly'] and session['sameSite']=='Lax')
                private_values.extend(c['value'] for c in cookies if c['name'].startswith('__Host-'))
                check('s02_no_bearer_tokens_in_browser_storage',page.evaluate('JSON.stringify(localStorage)+JSON.stringify(sessionStorage)').find('eyJ')==-1)
                page.reload();expect(page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible()
                check('s02_private_home_refresh_keeps_real_profile',page.get_by_text(email,exact=True).is_visible())
                page.locator('input[name=display_name]').fill('Тестовый пользователь');page.get_by_role('button',name='Сохранить профиль').click();expect(page.locator('input[name=display_name]')).to_have_value('Тестовый пользователь')
                check('s02_own_profile_persists',True)
                page.locator('section[aria-label=Магазины]').screenshot(path=str(args.output.with_name('s02-empty-state.png')))
                # Different person/browser must remain separated even with the same site.
                second_context=browser.new_context(ignore_https_errors=False);second_page=second_context.new_page()
                second_email='s02-'+uuid.uuid4().hex[:10]+'@example.invalid';contacts.append(second_email);register(second_page,second_email)
                with db('platform') as conn:second_id=conn.execute('SELECT id FROM accounts_tenant WHERE id<>%s',[first[1]]).fetchone()[0]
                reply=page.request.post(WEB+'/api/account/profile',data={'display_name':'bad','tenant_id':str(second_id)},headers={'Origin':WEB})
                check('s02_tenant_spoof_rejected',reply.status==422)
                reply=page.request.get(WEB+'/api/account/me?tenant_id='+str(second_id));check('s02_profile_lookup_cannot_select_other_tenant',reply.status==422)
                check('s02_second_browser_has_distinct_profile',second_page.get_by_text(second_email,exact=True).is_visible() and not second_page.get_by_text(email,exact=True).count())
                anonymous=browser.new_context(ignore_https_errors=False);anonymous.add_cookies([{'name':'octoport_session','value':'synthetic-foreign-cookie','url':WEB,'secure':True}])
                check('s02_foreign_cookie_does_not_authorize',anonymous.request.get(WEB+'/api/account/me').status==401);anonymous.close()
                # A valid identity token for the second confidential RP is not an Alisa session.
                nonce=secrets.token_urlsafe(24);state=secrets.token_urlsafe(24);verifier=secrets.token_urlsafe(48)
                challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
                authorize=metadata['authorization_endpoint']+'?'+urlencode({'client_id':'s02_probe','redirect_uri':WEB+'/oidc-probe/callback','response_type':'code','scope':'openid email','state':state,'nonce':nonce,'code_challenge':challenge,'code_challenge_method':'S256'})
                page.goto(authorize);page.locator('button[name=action][value=grant]').click();page.wait_for_url(re.compile('/oidc-probe/callback'))
                query=parse_qs(urlsplit(page.url).query);check('s02_second_confidential_rp_state_preserved',query.get('state')==[state])
                code=query['code'][0];private_values.extend([code,state,nonce])
                data=urlencode({'grant_type':'authorization_code','code':code,'redirect_uri':WEB+'/oidc-probe/callback','code_verifier':verifier}).encode()
                req=urllib.request.Request(metadata['token_endpoint'],data=data,headers={'Content-Type':'application/x-www-form-urlencoded','Authorization':'Basic '+base64.b64encode(('s02_probe:'+probe_secret).encode()).decode()})
                with opener.open(req,timeout=8) as r:tokens=json.load(r)
                keys=request(metadata['jwks_uri'])[1];kid=jwt.get_unverified_header(tokens['id_token'])['kid'];public=jwt.PyJWK.from_dict(next(k for k in keys['keys'] if k['kid']==kid)).key
                claims=jwt.decode(tokens['id_token'],public,algorithms=['RS256'],audience='s02_probe',issuer=ISSUER);private_values.extend([tokens['id_token'],tokens['access_token']])
                check('s02_second_confidential_rp_compatible',claims['nonce']==nonce and claims['email']==email)
                forged=browser.new_context(ignore_https_errors=False);forged.add_cookies([{'name':'__Host-alisa_session','value':tokens['id_token'],'url':WEB,'secure':True,'httpOnly':True}])
                check('s02_second_rp_token_has_no_product_access',forged.request.get(WEB+'/api/account/me').status==401);forged.close()
                with db('identity') as conn:check('s02_pairwise_subjects_keep_same_person',conn.execute('SELECT count(DISTINCT id) FROM accounts_subject WHERE person_id=(SELECT id FROM accounts_person WHERE email=%s)',[email]).fetchone()[0]==2)
                page.goto(WEB+'/app');expect(page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible()
                # Logout revokes the server-side product session, not just its cookie.
                saved=session['value'];page.get_by_role('button',name='Выйти из кабинета').click();expect(page).to_have_url(re.compile('/login'))
                check('s02_logout_revokes_server_session',request('http://127.0.0.1:18402/api/v1/account/me','POST',{'session_token':saved},{'Authorization':'Bearer '+auth_service})[0]==401)
                # Repeat login goes through the authority and a fresh email code.
                open_identity(page)
                if page.locator('input[name=email]').count():
                    page.locator('input[name=email]').fill(email);page.locator('form').filter(has=page.locator('input[name=email]')).locator('button[type=submit]').first.click()
                else:
                    page.locator('form').filter(has=page.locator('button')).locator('button[type=submit]').first.click()
                expect(page.locator('input[name=code]')).to_be_visible();manage('identity',['identity_deliver'])
                page.locator('input[name=code]').fill(letter(email));page.locator('form').filter(has=page.locator('input[name=code]')).locator('button[type=submit]').first.click()
                expect(page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible(timeout=15000)
                with db('platform') as conn:check('s02_repeat_login_preserves_customer_and_tenant',conn.execute('SELECT customer_id,tenant_id FROM accounts_membership WHERE customer_id=%s',[first[0]]).fetchone()==first and conn.execute('SELECT count(*) FROM accounts_customer').fetchone()[0]==2)
                # Recovery through genuine process restarts retains the same row and cookie.
                stop(api);api=start('platform');stop(authority);authority=start('identity')
                for _ in range(50):
                    try:
                        if request(WEB+'/api/account/me',headers={'Cookie':'__Host-alisa_session='+next(c['value'] for c in context.cookies() if c['name']=='__Host-alisa_session')})[0]==200:break
                    except OSError:pass
                    time.sleep(.1)
                page.reload();expect(page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible()
                check('s02_service_restart_preserves_customer_session',True)
                # Revocation decisions use the server's account and session rows.
                current_cookie=next(c['value'] for c in context.cookies() if c['name']=='__Host-alisa_session')
                def profile_status():
                    return page.request.get(WEB+'/api/account/me').status
                with db('platform') as conn:
                    conn.execute('UPDATE accounts_customer SET is_active=false WHERE id=%s',[first[0]])
                    check('s02_blocked_customer_session_denied',profile_status()==401)
                    conn.execute('UPDATE accounts_customer SET is_active=true WHERE id=%s',[first[0]])
                    conn.execute("UPDATE accounts_websession SET expires_at=now()-interval '1 second' WHERE token_hash=%s",[hashlib.sha256(current_cookie.encode()).hexdigest()])
                    check('s02_expired_product_session_denied',profile_status()==401)
                    conn.execute("UPDATE accounts_websession SET expires_at=now()+interval '10 minutes' WHERE token_hash=%s",[hashlib.sha256(current_cookie.encode()).hexdigest()])
                check('s02_own_session_restored_after_owned_fixture_change',profile_status()==200)
                policy_output=args.output.with_name('s02-runtime-policies.json')
                policy_run=subprocess.run([str(py),str(ROOT/'tests/integration/identity_policy_checks.py'),str(policy_output)],
                    env={**env('identity'),'ALISA_IDENTITY_POLICY_TEST_ALLOW':'1'},stdout=logs,stderr=logs,timeout=45)
                if policy_output.exists():
                    policy_record=json.loads(policy_output.read_text());CASES.extend(policy_record.get('cases',[]))
                check('s02_actual_runtime_negative_account_policies',policy_run.returncode==0)
                sink.shutdown();sink.server_close();sink=None
                manage('identity',['identity_deliver'])
                with db('identity') as conn:
                    check('s02_smtp_outage_retains_encrypted_pending_mail',bool(conn.execute("SELECT 1 FROM accounts_identitymail WHERE sent_at IS NULL AND error_code='DELIVERY_UNAVAILABLE' AND encrypted_payload<>''").fetchone()))
                    conn.execute('UPDATE accounts_identitymail SET lease_until=NULL WHERE sent_at IS NULL')
                sink=Sink(('127.0.0.1',18226),SMTP);sink.messages=[];threading.Thread(target=sink.serve_forever,daemon=True).start()
                manage('identity',['identity_deliver'])
                with db('identity') as conn:
                    check('s02_smtp_recovery_sends_and_erases_code',len(sink.messages)>=1 and not conn.execute("SELECT 1 FROM accounts_identitymail WHERE sent_at IS NULL AND encrypted_payload<>'' AND expires_at>now()").fetchone())
                logs.flush();text=(temp/'private-process.log').read_text()
                check('s02_private_logs_have_no_known_codes_tokens_contacts',all(v not in text for v in [*contacts,*private_values] if v))
                second_context.close();context.close();browser.close();browser=None
            record['status']='SOURCE_FLOW_QUALIFIED_NOT_STAGE_ACCEPTANCE'
            logs.close()
    except Exception as exc:
        record['status']='FAILED';record['error_type']=type(exc).__name__
        tb=exc.__traceback__
        while tb and tb.tb_next:tb=tb.tb_next
        if tb:record['error_location']={'file':Path(tb.tb_frame.f_code.co_filename).name,'line':tb.tb_lineno}
        if isinstance(exc,RuntimeError) and str(exc).startswith('CHECK_FAILED:'):record['failed_case']=str(exc).split(':',1)[1]
    finally:
        if browser:
            try:browser.close()
            except Exception:pass
        for p in reversed(PROCESSES):stop(p)
        for proxy in proxies:proxy.shutdown();proxy.server_close()
        if sink:sink.shutdown();sink.server_close()
        if logs and not logs.closed:logs.close()
        if temporary:temporary.cleanup()
        if owned:
            for name in NAMES:admin.execute(sql.SQL('DROP DATABASE IF EXISTS {} WITH (FORCE)').format(sql.Identifier(name)))
            for role in roles:admin.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(role)))
        admin.close();record['owned_database_and_process_cleanup']=True
        args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(record,indent=2)+'\n')
    return 0 if record['status']=='SOURCE_FLOW_QUALIFIED_NOT_STAGE_ACCEPTANCE' else 1

if __name__=='__main__':sys.exit(main())
