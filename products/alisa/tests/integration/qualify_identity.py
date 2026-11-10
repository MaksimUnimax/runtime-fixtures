#!/usr/bin/env python3
"""Finite full AL-S02 source qualification on the guarded disposable CI cluster.

Private CA is trusted explicitly by Python/Node and an isolated browser NSS home;
certificate verification is never disabled. No live config/DB/mail is available.
"""
import argparse,base64,hashlib,json,os,re,secrets,signal,ssl,subprocess,sys,tarfile,tempfile,time,threading,uuid
from pathlib import Path
from urllib.parse import urlencode,urlsplit,parse_qs,unquote_plus
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
from identity_tls import certificates,start_proxy,start_plain_proxy
from identity_network import OwnedNetwork
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
    parser=argparse.ArgumentParser();parser.add_argument('--artifact',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--staff',action='store_true');parser.add_argument('--access',action='store_true');parser.add_argument('--stores',action='store_true');parser.add_argument('--alice',action='store_true');parser.add_argument('--open-registration',action='store_true');args=parser.parse_args()
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
    proxies=[];store_fixture=None;sink=None;browser=None;context=None;temporary=None;logs=None;playwright=None;network=OwnedNetwork()
    try:
        databases={r[0] for r in admin.execute('SELECT datname FROM pg_database WHERE NOT datistemplate')}
        if databases-{'postgres','alisa_ci_admin'}:raise RuntimeError('Disposable cluster is not empty')
        if any(admin.execute('SELECT 1 FROM pg_roles WHERE rolname=%s',[r]).fetchone() for r in roles):raise RuntimeError('Disposable role already exists')
        owned=True
        temporary=tempfile.TemporaryDirectory(prefix='alisa-s02-private-')
        if temporary:
            temp=Path(temporary.name);temp.chmod(0o711);logs=(temp/'private-process.log').open('w+')
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
            if args.staff:
                staff_origin='https://127.0.0.1:19441';staff_secret=secrets.token_urlsafe(40)
                staff_service=secrets.token_urlsafe(40);staff_key=secrets.token_urlsafe(32)
                identity_only.update({'ALISA_STAFF_ENABLED':'1','ALISA_STAFF_OIDC_CLIENT_ID':'s03_admin','ALISA_STAFF_OIDC_REDIRECT_URI':staff_origin+'/auth/callback'})
                platform_only.update({'ALISA_STAFF_ENABLED':'1','ALISA_STAFF_OIDC_CLIENT_ID':'s03_admin','ALISA_STAFF_SERVICE_TOKEN':staff_service,'ALISA_QUERY_INSIGHTS_ENABLED':'1'})
                client_bootstrap.update({'ALISA_STAFF_OIDC_CLIENT_ID':'s03_admin','ALISA_STAFF_OIDC_CLIENT_SECRET':staff_secret,'ALISA_STAFF_OIDC_REDIRECT_URI':staff_origin+'/auth/callback'})
            if args.access:
                if not args.staff:raise RuntimeError('Access qualification requires native staff flow')
                platform_only['ALISA_ENTITLEMENTS_ENABLED']='1'
                platform_only['ALISA_ACCESS_SINK_DELIVERY']='1'
            if args.stores:
                from store_check_fixture import Fixture
                store_fixture=Fixture(temp/'stores-check.sock',network.uid)
                platform_only.update({'ALISA_STORES_ENABLED':'1','ALISA_STORE_DATA_KEYS':Fernet.generate_key().decode(),
                    'ALISA_STORE_CHECK_SOCKET':str(temp/'stores-check.sock'),'ALISA_STORE_CHECK_UID':str(os.getuid())})
            if args.alice:
                if not args.stores:raise RuntimeError('Alice browser qualification requires the full store regression')
                skill_client='s06-browser-client';skill_secret=secrets.token_urlsafe(40)
                skill_id='e1c48501-7b1f-47fe-87d7-e6bec9c45673'
                platform_only.update({'ALISA_ALICE_LINK_ENABLED':'1','ALISA_ALICE_CLIENT_ID':skill_client,
                    'ALISA_ALICE_CLIENT_SECRET':skill_secret,'ALISA_ALICE_SKILL_ID':skill_id,'ALISA_ALICE_DATA_KEYS':Fernet.generate_key().decode()})
            component_keys={c:secrets.token_urlsafe(48) for c in ['platform','identity','web']}
            web_env={**clean_environment(),'HOME':str(home),'ALISA_ENV':'dev','ALISA_RELEASE':manifest['artifact_id'],
                  'ALISA_LEAD_INTAKE_ENABLED':'1','ALISA_SECRET_KEY':component_keys['web'],'ALISA_ACCOUNTS_ENABLED':'1','ALISA_IDENTITY_ISSUER':ISSUER,
                  'ALISA_PUBLIC_BASE_URL':WEB,'ALISA_SERVICE_TOKEN':service,'ALISA_AUTH_SERVICE_TOKEN':auth_service,
                  'ALISA_WEB_OIDC_CLIENT_ID':'s02_web','ALISA_WEB_OIDC_CLIENT_SECRET':web_secret,'NODE_EXTRA_CA_CERTS':str(ca),
                  'ALISA_WEB_SESSION_KEY':bff_key,'ALISA_PLATFORM_URL':'http://127.0.0.1:18404','ALISA_ALLOWED_HOSTS':'127.0.0.1,localhost'}
            if args.alice:web_env['ALISA_ALICE_LINK_ENABLED']='1'
            if args.open_registration:
                fixture_secret=temp/'real-smtp-fixture.private'
                fixture_secret.write_text('synthetic-owned-smtp-fixture-password-0001')
                fixture_secret.chmod(0o600);os.chown(fixture_secret,network.uid,network.uid)
                identity_only.update({'ALISA_REAL_LOGIN_OPEN':'1','ALISA_REAL_SMTP_PASSWORD_FILE':str(fixture_secret)})
                platform_only['ALISA_REAL_LOGIN_OPEN']='1'
                web_env['ALISA_REAL_LOGIN_OPEN']='1'
                record['registration_mode']='OPEN_WITH_NO_INVITATION_LIST'
            def env(component,migration=False):
                name='alisa_stage_'+component;role='migration' if migration else 'runtime'
                return {**base,**(identity_only if component=='identity' else platform_only),'ALISA_SECRET_KEY':component_keys[component],
                        'ALISA_DB_NAME':name,'ALISA_DB_USER':name+'_'+role,'ALISA_DB_PASSWORD':credentials[component][role+'_password'],
                        'PYTHONPATH':str(release/'services'/component/'src'),'DJANGO_SETTINGS_MODULE':('alisa_platform' if component=='platform' else 'octoport_identity')+'.config.settings'}
            def manage(component,arguments,migration=False):
                if args.open_registration and component=='identity' and arguments==['identity_deliver']:
                    return subprocess.run([str(py),str(ROOT/'tests/integration/deliver_fixture_real_mail.py')],env=env(component),check=True,stdout=logs,stderr=logs,timeout=25)
                return subprocess.run([str(py),str(release/'services'/component/'manage.py'),*arguments],env=env(component,migration),check=True,stdout=logs,stderr=logs,timeout=25)
            for component in ['platform','identity']:manage(component,['migrate','--noinput'],True)
            subprocess.run([str(py),str(release/'services/identity/manage.py'),'identity_clients','--apply'],env={**env('identity',True),**client_bootstrap},check=True,stdout=logs,stderr=logs,timeout=25)
            check('s02_separate_migrations_and_confidential_clients',True)
            record['postgres_version']=admin.execute('SHOW server_version').fetchone()[0]
            record['schemas']={}
            for component in ['platform','identity']:
                with connect('alisa_stage_'+component) as conn:
                    record['schemas'][component]={'migrations':[list(r) for r in conn.execute('SELECT app,name FROM django_migrations ORDER BY app,name')],
                        'tables':[r[0] for r in conn.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name")]}
            for name,other in [('platform','identity'),('identity','platform')]:
                try:connect('alisa_stage_'+other,'alisa_stage_'+name+'_runtime',credentials[name]['runtime_password']).close();denied=False
                except psycopg.OperationalError as exc:denied=expected_database_connect_denial(exc)
                check('s02_'+name+'_foreign_database_denied',denied)
            def spawn(arguments,environment):
                p=subprocess.Popen(list(map(str,arguments)),cwd=release,env=environment,stdout=logs,stderr=logs,start_new_session=True,
                    user=network.uid,group=network.uid,extra_groups=[]);PROCESSES.append(p);return p
            def start(component):
                module='alisa_platform' if component=='platform' else 'octoport_identity';port=18402 if component=='platform' else 18403
                return spawn([py,'-m','gunicorn',module+'.config.wsgi:application','--bind','127.0.0.1:'+str(port),'--workers','2','--access-logfile','-','--access-logformat','%(m)s %(U)s %(s)s'],env(component))
            network.setup()
            check('s02_runtime_nonloopback_egress_denied_by_owned_uid_firewall',network.witness(py,clean_environment()))
            for component in ['platform','identity']:
                module='alisa_platform' if component=='platform' else 'octoport_identity'
                boot=subprocess.run([str(py),'-c','import '+module+'.config.wsgi'],env=env(component),user=network.uid,group=network.uid,extra_groups=[],stdout=logs,stderr=logs,timeout=12)
                check('s02_'+component+'_owned_uid_import',boot.returncode==0)
            api=start('platform');authority=start('identity')
            web=spawn(['node',release/'ui/web/apps/web/server.js'],{**web_env,'PORT':'18400','HOSTNAME':'127.0.0.1'})
            proxies=[start_proxy(19440,18400,cert,key),start_proxy(19443,18403,cert,key),start_plain_proxy(18404,18402)]
            if args.staff:
                admin_env={**clean_environment(),'HOME':str(home),'ALISA_ENV':'dev','ALISA_RELEASE':manifest['artifact_id'],
                    'ALISA_STAFF_ENABLED':'1','ALISA_IDENTITY_ISSUER':ISSUER,'ALISA_ADMIN_BASE_URL':staff_origin,
                    'ALISA_STAFF_OIDC_CLIENT_ID':'s03_admin','ALISA_STAFF_OIDC_CLIENT_SECRET':staff_secret,
                    'ALISA_STAFF_SERVICE_TOKEN':staff_service,'ALISA_STAFF_SESSION_KEY':staff_key,
                    'ALISA_PLATFORM_URL':'http://127.0.0.1:18404','NODE_EXTRA_CA_CERTS':str(ca),'PORT':'18401','HOSTNAME':'127.0.0.1'}
                staff_process=spawn(['node',release/'ui/admin/apps/admin/server.js'],admin_env)
                proxies.append(start_proxy(19441,18401,cert,key))
            committed_response_lost=[];session_payload_hashes=[]
            def session_payload(path,body):
                if path=='/api/v1/auth/sessions':session_payload_hashes.append(hashlib.sha256(body).hexdigest())
                return body
            def lose_commit_response(path,status,body):
                if path=='/api/v1/auth/sessions' and status==201 and not committed_response_lost:
                    committed_response_lost.append(True);return 503,b'{"code":"SYNTHETIC_RESPONSE_LOST_AFTER_COMMIT"}'
                return status,body
            proxies[2].request_hook=session_payload;proxies[2].result_hook=lose_commit_response
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
            token_path=urlsplit(metadata['token_endpoint']).path
            auth_observations=[];record['safe_client_auth_observations']=auth_observations
            expected_basic='Basic '+base64.b64encode(('s02_web:'+web_secret).encode()).decode()
            def observe_client_auth(path,headers,body):
                if path!=token_path:return
                auth=next((v for k,v in headers.items() if k.lower()=='authorization'),'')
                values=parse_qs(body.decode()) if body else {}
                try:
                    scheme,_,value=auth.partition(' ');decoded=base64.b64decode(value,validate=True).decode();identifier,_,password=decoded.partition(':')
                    semantic=scheme.lower()=='basic' and secrets.compare_digest(unquote_plus(identifier),'s02_web') and secrets.compare_digest(unquote_plus(password),web_secret)
                except (ValueError,UnicodeError):semantic=False
                auth_observations.append({'raw_basic_matches_registered_fixture':secrets.compare_digest(auth,expected_basic),'decoded_basic_matches_registered_fixture':semantic,
                    'body_client_id_present':'client_id' in values,'authorization_header_present':bool(auth)})
            proxies[1].request_observer=observe_client_auth
            data=urlencode({'grant_type':'authorization_code','code':'x'*43,'code_verifier':'x'*64,'redirect_uri':WEB+'/auth/callback'}).encode()
            req=urllib.request.Request(metadata['token_endpoint'],data=data,headers={'Content-Type':'application/x-www-form-urlencoded','Authorization':expected_basic})
            try:
                with opener.open(req,timeout=8) as r:probe_status=r.status;probe_body=json.load(r)
            except urllib.error.HTTPError as exc:probe_status=exc.code;probe_body=json.load(exc)
            error=probe_body.get('error')
            record['client_auth_probe']={'http_status':probe_status,'error':error if error in ['invalid_grant','invalid_client'] else 'OTHER'}
            check('s02_confidential_basic_authentication_reaches_grant_validation',probe_status==400 and error=='invalid_grant')
            def encoded_component(value):return ''.join(c if c.isascii() and c.isalnum() else '%'+format(ord(c),'02X') for c in value)
            for kind,password in [('encoded',web_secret),('wrong_secret',web_secret+'x')]:
                header='Basic '+base64.b64encode((encoded_component('s02_web')+':'+encoded_component(password)).encode()).decode()
                req=urllib.request.Request(metadata['token_endpoint'],data=data,headers={'Content-Type':'application/x-www-form-urlencoded','Authorization':header})
                try:
                    with opener.open(req,timeout=8) as r:status=r.status;body=json.load(r)
                except urllib.error.HTTPError as exc:status=exc.code;body=json.load(exc)
                check('s02_basic_'+kind+'_validation',(status==400 and body.get('error')=='invalid_grant') if kind=='encoded' else (status==401 and body.get('error')=='invalid_client'))
            sink=Sink(('127.0.0.1',18226),SMTP);sink.messages=[];threading.Thread(target=sink.serve_forever,daemon=True).start()
            contacts=[];private_values=[service,auth_service,web_secret,probe_secret,data_key,bff_key]
            if args.alice:private_values.append(skill_secret)
            if args.staff:private_values.extend([staff_secret,staff_service,staff_key])
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
            # The browser trusts our NSS root, while APIRequestContext uses the
            # separate Node driver. Give both their explicit CA without bypass.
            with patch.dict(os.environ,{'NODE_EXTRA_CA_CERTS':str(ca)}):
                playwright=sync_playwright().start()
            p=playwright
            check('s02_disposable_chromium_binary_available',Path(p.chromium.executable_path).is_file())
            browser=p.chromium.launch(headless=True,env={**clean_environment(),'HOME':str(home)})
            context=browser.new_context(ignore_https_errors=False);page=context.new_page()
            page.goto(WEB+'/app');expect(page).to_have_url(re.compile('/login'))
            check('s02_private_home_requires_own_session',True)
            check('s02_no_service_cookie_or_data_in_anonymous_html',auth_service not in page.content())
            check('s02_start_requires_consents',request(WEB+'/auth/start','POST',{}, {'Origin':WEB})[0]==422)
            def open_identity(page):
                page.goto(WEB);page.locator('footer a[href="/login"]').click();page.locator('input[name=service]').check();page.locator('input[name=privacy]').check()
                with page.expect_response(lambda r:r.url==WEB+'/auth/start') as started:
                    page.get_by_role('button',name='Войти или создать кабинет').click()
                check('s02_bff_start_redirects_to_fixed_authority',started.value.status==303,http_status=started.value.status)
                page.wait_for_url(re.compile(re.escape(ISSUER)+r'/accounts/'))
            checked_theme_pages=set()
            def verify_identity_theme(page,label):
                if label in checked_theme_pages:return
                expect(page.locator('.stage-notice')).to_be_visible()
                page.evaluate('document.fonts.ready')
                check('s02_identity_'+label+'_theme',page.evaluate('getComputedStyle(document.body).backgroundColor')=='rgb(13, 25, 41)')
                check('s02_identity_'+label+'_test_mail_notice',page.locator('.stage-notice').is_visible() and ('логин и пароль' if args.open_registration else 'example.invalid') in page.locator('.stage-notice').inner_text().lower())
                viewport=page.viewport_size
                for width in [320,390,1440]:
                    page.set_viewport_size({'width':width,'height':900})
                    check('s02_identity_'+label+'_layout_'+str(width),page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
                    if width==390:page.screenshot(path=str(args.output.parent/('s02-identity-'+label+'-mobile.png')),full_page=True)
                page.set_viewport_size(viewport)
                page.screenshot(path=str(args.output.parent/('s02-identity-'+label+'-desktop.png')),full_page=True)
                checked_theme_pages.add(label)
            customer_password=secrets.token_urlsafe(24);private_values.append(customer_password)
            callback_proofs=[]
            def register(page,email):
                open_identity(page)
                verify_identity_theme(page,'login')
                page.locator('a[href*="/accounts/signup/"]').first.click()
                page.wait_for_url(re.compile(re.escape(ISSUER)+r'/accounts/signup/'))
                expect(page.locator('input[name=password1]')).to_be_visible()
                verify_identity_theme(page,'signup')
                page.locator('input[name=email]').fill(email);page.locator('input[name=password1]').fill(customer_password);page.locator('input[name=password2]').fill(customer_password);page.locator('input[name=privacy]').check();page.locator('input[name=service]').check()
                page.locator('form').filter(has=page.locator('input[name=email]')).locator('button[type=submit]').first.click()
                expect(page.locator('input[name=code]')).to_be_visible()
                verify_identity_theme(page,'code')
                manage('identity',['identity_deliver'])
                refs=[c['value'] for c in page.context.cookies() if c['name']=='__Host-alisa_login']
                callbacks=[]
                page.on('request',lambda r:callbacks.append(r.url) if r.url.startswith(WEB+'/auth/callback?') else None)
                page.locator('input[name=code]').fill(letter(email));page.locator('form').filter(has=page.locator('input[name=code]')).locator('button[type=submit]').first.click()
                expect(page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible(timeout=15000)
                if callbacks and refs:callback_proofs.append((callbacks[-1],refs[-1]))
            no_script=browser.new_context(ignore_https_errors=False,java_script_enabled=False);no_script_page=no_script.new_page();no_script_page.goto(WEB+'/join')
            check('s02_no_script_cannot_put_contact_in_query',no_script_page.locator('form').get_attribute('method')=='post' and no_script_page.get_by_role('button',name='Отправить тестовую заявку').is_disabled())
            no_script.close()
            email='s02-'+uuid.uuid4().hex[:10]+'@example.invalid';contacts.append(email)
            # Lead handoff is opaque and has no authentication effect itself.
            page.goto(WEB+'/join');page.locator('input[name=email]').fill(email);page.locator('input[name=service]').check();page.get_by_role('button',name='Отправить тестовую заявку').click();expect(page.get_by_role('status')).to_contain_text('Заявка сохранена')
            check('s02_handoff_lead_submitted_in_browser',True)
            manage('platform',['leads_deliver']);confirmation,lead_token=lead_link(sink.messages[-1]);private_values.append(lead_token['token'])
            page.goto(confirmation);page.get_by_role('button',name='Подтвердить контакт').click();expect(page.get_by_role('status')).to_contain_text('Контакт подтверждён')
            check('s02_handoff_contact_confirmed_in_browser',True)
            register(page,email)
            expect(page.locator('header').get_by_role('link',name='Кабинет',exact=True)).to_have_attribute('href','/app')
            check('s02_verified_customer_header_links_to_cabinet',True)
            with db('platform') as conn:
                navigation_before=conn.execute('SELECT (SELECT count(*) FROM accounts_authflow),(SELECT count(*) FROM accounts_websession)').fetchone()
            with db('identity') as conn:mail_before=conn.execute('SELECT count(*) FROM accounts_identitymail').fetchone()[0]
            cookie_before=next(c['value'] for c in context.cookies() if c['name']=='__Host-alisa_session')
            for target in ['/login','/login?error=AUTH_FAILED']:
                page.goto(WEB+target)
                expect(page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible()
                check('s02_verified_session_reuses_cabinet_'+('error' if '?' in target else 'plain'),urlsplit(page.url).path=='/app' and not page.locator('form[action="/auth/start"]').count())
            started=page.request.post(WEB+'/auth/start',form={'service':'on','privacy':'on'},headers={'Origin':WEB},max_redirects=0)
            check('s02_verified_session_post_start_reuses_cabinet_without_cookie_replacement',started.status==303 and started.headers.get('location')==WEB+'/app' and 'set-cookie' not in started.headers and next(c['value'] for c in context.cookies() if c['name']=='__Host-alisa_session')==cookie_before)
            check('s02_verified_session_start_still_rejects_foreign_origin',page.request.post(WEB+'/auth/start',form={'service':'on','privacy':'on'},headers={'Origin':'https://wrong.example.invalid'},max_redirects=0).status==403)
            check('s02_verified_session_start_still_requires_consents',page.request.post(WEB+'/auth/start',form={},headers={'Origin':WEB},max_redirects=0).status==422)
            check('s02_verified_session_start_still_rejects_query',page.request.post(WEB+'/auth/start?next=foreign',form={'service':'on','privacy':'on'},headers={'Origin':WEB},max_redirects=0).status==422)
            with db('platform') as conn:check('s02_signed_in_navigation_creates_no_flow_or_session',conn.execute('SELECT (SELECT count(*) FROM accounts_authflow),(SELECT count(*) FROM accounts_websession)').fetchone()==navigation_before)
            with db('identity') as conn:check('s02_signed_in_navigation_sends_no_new_email',conn.execute('SELECT count(*) FROM accounts_identitymail').fetchone()[0]==mail_before)
            unknown_cookie=browser.new_context(ignore_https_errors=False)
            try:
                unknown_cookie.add_cookies([{'name':'__Host-alisa_session','value':'x'*43,'url':WEB,'secure':True,'httpOnly':True}])
                unknown_page=unknown_cookie.new_page();unknown_page.goto(WEB+'/login')
                expect(unknown_page.locator('form[action="/auth/start"]')).to_be_visible()
                check('s02_unverified_cookie_cannot_reuse_another_render_session',unknown_page.locator('header').get_by_role('link',name='Войти',exact=True).count()==1)
            finally:unknown_cookie.close()
            stale_site=browser.new_context(ignore_https_errors=False,storage_state=context.storage_state())
            try:
                stale_site.clear_cookies(name='__Host-alisa_session')
                stale_page=stale_site.new_page();open_identity(stale_page)
                expect(stale_page.get_by_role('heading',name='Вход в кабинет',exact=True)).to_be_visible()
                expect(stale_page.locator('input[name=login]')).to_be_visible()
                expect(stale_page.locator('input[name=password]')).to_be_visible()
                check('s02_identity_session_without_cabinet_cookie_opens_password_form_directly',urlsplit(stale_page.url).path=='/accounts/reauthenticate/'
                    and stale_page.locator('form').filter(has=stale_page.locator('input[name=password]')).get_attribute('action')=='/accounts/reauthenticate/'
                    and not stale_page.get_by_role('button',name='Продолжить вход в кабинет',exact=True).count())
                check('s02_reentry_does_not_display_old_success_messages',not any(re.search(r'Успешный вход|Successfully signed in|Адрес .* подтверждён',text) for text in stale_page.get_by_role('status').all_inner_texts()))
            finally:stale_site.close()
            mfa_theme_page=context.new_page()
            mfa_theme_page.goto(ISSUER+'/accounts/2fa/totp/activate/')
            # Password-based accounts must satisfy the native security-settings
            # reauthentication before previewing an authenticator enrollment.
            if mfa_theme_page.locator('input[name=password]').count():
                mfa_theme_page.locator('input[name=password]').fill(customer_password)
                mfa_theme_page.locator('form').filter(has=mfa_theme_page.locator('input[name=password]')).locator('button[type=submit]').click()
            qr=mfa_theme_page.locator('main img[src^="data:image/svg"]')
            expect(qr).to_be_visible()
            check('s02_totp_qr_readable_surface',qr.evaluate('image => getComputedStyle(image).backgroundColor')=='rgb(255, 255, 255)')
            with db('identity') as connection:
                check('s02_totp_preview_does_not_activate_factor',connection.execute('SELECT count(*) FROM mfa_authenticator').fetchone()[0]==0)
            mfa_theme_page.close()
            check('s02_real_browser_identity_code_bff_postgresql_home',True)
            check('s02_lost_api_commit_response_retries_identical_session_payload',bool(committed_response_lost) and len(session_payload_hashes)==2 and len(set(session_payload_hashes))==1)
            replay_context=browser.new_context(ignore_https_errors=False)
            repeated_url,repeated_ref=callback_proofs[0]
            private_values.extend(v[0] for v in parse_qs(urlsplit(repeated_url).query).values())
            replay_context.add_cookies([{'name':'__Host-alisa_login','value':repeated_ref,'url':WEB,'httpOnly':True,'secure':True}])
            replay=replay_context.request.get(repeated_url)
            check('s02_callback_replay_safe_receipt_no_new_session','ALREADY_HANDLED_OR_EXPIRED' in replay.url and replay_context.request.get(WEB+'/api/account/me').status==401)
            replay_context.close()
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
            with db('platform') as conn:foreign_handoff=str(conn.execute('SELECT id FROM leads_submission LIMIT 1').fetchone()[0])
            second_context.add_cookies([{'name':'__Host-alisa_handoff','value':foreign_handoff,'url':WEB,'secure':True,'httpOnly':True}])
            second_email='s02-'+uuid.uuid4().hex[:10]+'@example.invalid';contacts.append(second_email);register(second_page,second_email)
            with db('platform') as conn:check('s02_foreign_lead_handoff_not_attached',conn.execute('SELECT count(*) FROM accounts_leadlink').fetchone()[0]==1)
            with db('platform') as conn:second_id=conn.execute('SELECT id FROM accounts_tenant WHERE id<>%s',[first[1]]).fetchone()[0]
            # Keep the second customer's native Identity session, removing only
            # the product cookie, and complete the direct reentry in the browser.
            second_context.clear_cookies(name='__Host-alisa_session')
            open_identity(second_page)
            expect(second_page.locator('input[name=password]')).to_be_visible()
            check('s02_direct_reentry_browser_has_no_confirmation_click',urlsplit(second_page.url).path=='/accounts/reauthenticate/'
                and not second_page.get_by_role('button',name='Продолжить вход в кабинет',exact=True).count())
            second_page.locator('input[name=login]').fill(second_email)
            second_page.locator('input[name=password]').fill(customer_password)
            second_page.locator('form').filter(has=second_page.locator('input[name=password]')).locator('button[type=submit]').click()
            expect(second_page.locator('input[name=code]')).to_be_visible();manage('identity',['identity_deliver'])
            second_page.locator('input[name=code]').fill(letter(second_email))
            second_page.locator('form').filter(has=second_page.locator('input[name=code]')).locator('button[type=submit]').first.click()
            expect(second_page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible(timeout=15000)
            with db('platform') as conn:
                check('s02_direct_reentry_browser_preserves_same_customer_tenant',second_page.get_by_text(second_email,exact=True).is_visible()
                    and conn.execute('SELECT id FROM accounts_tenant WHERE id<>%s',[first[1]]).fetchone()[0]==second_id
                    and conn.execute('SELECT count(*) FROM accounts_customer').fetchone()[0]==2)
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
            check('s02_foreign_return_to_rejected',page.request.post(WEB+'/auth/start',form={'service':'on','privacy':'on','return_to':'https://wrong.example.invalid'},headers={'Origin':WEB}).status==422)
            foreign=page.request.get(ISSUER+'/accounts/reauthenticate/?'+urlencode({'next':'https://wrong.example.invalid'}),max_redirects=0)
            check('s02_identity_reauthentication_external_target_denied',foreign.status==400)
            # Exercise the REAL BFF validator. Only the disposable TLS proxy
            # mutates its own fixture token, never a product debug endpoint.
            token_path=urlsplit(metadata['token_endpoint']).path
            bad_key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
            for mode in ['state','issuer','audience','nonce','expiry','signature','pkce','acr_missing','acr_wrong','pwd_missing','email_otp_missing','auth_time_stale']:
                negative=browser.new_context(ignore_https_errors=False)
                negative.add_cookies([c for c in context.cookies() if c['domain']=='localhost'])
                np=negative.new_page();authorizations=[];callbacks=[]
                np.on('request',lambda r:authorizations.append(r.url) if r.url.startswith(metadata['authorization_endpoint']+'?') else None)
                np.on('request',lambda r:callbacks.append(r.url) if r.url.startswith(WEB+'/auth/callback?') else None)
                open_identity(np)
                token_mutated=[]
                def alter_token(path,status,body):
                    if path!=token_path or status!=200 or mode not in ['issuer','audience','nonce','expiry','signature','acr_missing','acr_wrong','pwd_missing','email_otp_missing','auth_time_stale']:return body
                    data=json.loads(body);header=jwt.get_unverified_header(data['id_token'])
                    claims=jwt.decode(data['id_token'],options={'verify_signature':False})
                    if mode=='issuer':claims['iss']='https://wrong.example.invalid'
                    if mode=='audience':claims['aud']='s02_probe'
                    if mode=='nonce':claims['nonce']='wrong-private-fixture-nonce'
                    if mode=='expiry':claims['exp']=int(time.time())-120
                    if mode=='acr_missing':claims.pop('acr',None)
                    if mode=='acr_wrong':claims['acr']='urn:wrong:authentication'
                    if mode=='pwd_missing':claims['amr']=['email_otp']
                    if mode=='email_otp_missing':claims['amr']=['pwd']
                    if mode=='auth_time_stale':claims['auth_time']=int(time.time())-301
                    data['id_token']=jwt.encode(claims,bad_key if mode=='signature' else private_key,algorithm='RS256',headers={'kid':header['kid']})
                    token_mutated.append(True);return json.dumps(data).encode()
                def alter_request(path,body):
                    if path!=token_path or mode!='pkce':return body
                    values=parse_qs(body.decode());values['code_verifier']=['wrong-verifier-'+'x'*40]
                    token_mutated.append(True);return urlencode({k:v[0] for k,v in values.items()}).encode()
                proxies[1].response_hook=alter_token;proxies[1].request_hook=alter_request
                if mode=='state':
                    def wrong_state(path):
                        url=urlsplit(path)
                        if url.path!='/auth/callback':return path
                        query=parse_qs(url.query);query['state']=['wrong-private-fixture-state']
                        token_mutated.append(True)
                        return url._replace(query=urlencode({k:v[0] for k,v in query.items()})).geturl()
                    proxies[0].path_hook=wrong_state
                try:
                    if np.get_by_role('button',name='Продолжить вход в кабинет').count():
                        np.get_by_role('button',name='Продолжить вход в кабинет').click()
                    np.locator('input[name=login]').fill(email);np.locator('input[name=password]').fill(customer_password)
                    np.locator('form').filter(has=np.locator('input[name=login]')).locator('button[type=submit]').click()
                    expect(np.locator('input[name=code]')).to_be_visible();manage('identity',['identity_deliver'])
                    np.locator('input[name=code]').fill(letter(email))
                    np.locator('form').filter(has=np.locator('input[name=code]')).locator('button[type=submit]').first.click()
                    np.wait_for_url(re.compile('/login\\?error=AUTH_FAILED'))
                    record['negative_fixture']={'mode':mode,'mutation_applied':bool(token_mutated),'landing_path':urlsplit(np.url).path}
                    check('s02_negative_'+mode+'_fixture_applied',bool(token_mutated))
                    expect(np).to_have_url(re.compile('/login\\?error=AUTH_FAILED'))
                    check('s02_bff_rejects_'+mode,np.request.get(WEB+'/api/account/me').status==401)
                finally:
                    proxies[0].path_hook=None
                    proxies[1].response_hook=None;proxies[1].request_hook=None
                    negative.close()
            with db('platform') as conn:check('s02_rejected_callbacks_create_no_customer_or_tenant',conn.execute('SELECT count(*) FROM accounts_customer').fetchone()[0]==2 and conn.execute('SELECT count(*) FROM accounts_tenant').fetchone()[0]==2)
            page.goto(WEB+'/app');expect(page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible()
            # Logout revokes the server-side product session, not just its cookie.
            saved=session['value'];page.get_by_role('button',name='Выйти из кабинета').click();expect(page).to_have_url(re.compile('/login'))
            check('s02_logout_renders_signed_out_navigation',page.locator('header').get_by_role('link',name='Войти',exact=True).count()==1 and page.locator('form[action="/auth/start"]').count()==1)
            check('s02_logout_revokes_server_session',request('http://127.0.0.1:18402/api/v1/account/me','POST',{'session_token':saved},{'Authorization':'Bearer '+auth_service})[0]==401)
            # Repeat login goes through the authority and a fresh email code.
            open_identity(page)
            if page.get_by_role('button',name='Продолжить вход в кабинет').count():
                verify_identity_theme(page,'reauthentication')
                page.get_by_role('button',name='Продолжить вход в кабинет').click()
            login_field=page.locator('input[name=login],input[name=email]').first
            expect(login_field).to_be_visible();login_field.fill(email);page.locator('input[name=password]').fill(customer_password)
            page.locator('form').filter(has=login_field).locator('button[type=submit]').first.click()
            expect(page.locator('input[name=code]')).to_be_visible();manage('identity',['identity_deliver'])
            page.locator('input[name=code]').fill(letter(email));page.locator('form').filter(has=page.locator('input[name=code]')).locator('button[type=submit]').first.click()
            expect(page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible(timeout=15000)
            with db('platform') as conn:check('s02_repeat_login_preserves_customer_and_tenant',conn.execute('SELECT customer_id,tenant_id FROM accounts_membership WHERE customer_id=%s',[first[0]]).fetchone()==first and conn.execute('SELECT count(*) FROM accounts_customer').fetchone()[0]==2)
            # Recovery through genuine process restarts retains the same row and cookie.
            stop(api)
            try:
                unavailable_page=context.new_page();unavailable_page.goto(WEB+'/login')
                expect(unavailable_page.get_by_role('heading',name='Вход временно недоступен',exact=True)).to_be_visible()
                check('s02_session_lookup_outage_does_not_offer_another_login',not unavailable_page.locator('form[action="/auth/start"]').count() and not unavailable_page.locator('header a[href="/login"]').count())
                failed_start=page.request.post(WEB+'/auth/start',form={'service':'on','privacy':'on'},headers={'Origin':WEB},max_redirects=0)
                check('s02_session_lookup_outage_start_fails_closed',failed_start.status==503 and failed_start.json().get('code')=='AUTH_UNAVAILABLE' and 'set-cookie' not in failed_start.headers)
                unavailable_page.close()
            finally:api=start('platform')
            stop(authority);authority=start('identity')
            for _ in range(50):
                try:
                    if request(WEB+'/api/account/me',headers={'Cookie':'__Host-alisa_session='+next(c['value'] for c in context.cookies() if c['name']=='__Host-alisa_session')})[0]==200:break
                except OSError:pass
                time.sleep(.1)
            page.reload();expect(page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible()
            check('s02_service_restart_preserves_customer_session',True)
            after=parse_qs(urlsplit(authorize).query)
            after['state']=[secrets.token_urlsafe(24)];after['nonce']=[secrets.token_urlsafe(24)]
            resumed=page.request.get(metadata['authorization_endpoint']+'?'+urlencode({k:v[0] for k,v in after.items()}),max_redirects=0)
            target=urlsplit(resumed.headers.get('location',''))
            check('s02_identity_restart_preserves_authority_session',
                (resumed.status==200 and 'name="request"' in resumed.text()) or
                (resumed.status==302 and target.path=='/oidc-probe/callback' and 'code' in parse_qs(target.query)))
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
                expired=context.new_page();expired.goto(WEB+'/login')
                expect(expired.locator('form[action="/auth/start"]')).to_be_visible()
                check('s02_expired_product_session_renders_login_without_cached_authorization',expired.locator('header').get_by_role('link',name='Войти',exact=True).count()==1)
                expired.close()
                conn.execute("UPDATE accounts_websession SET expires_at=now()+interval '10 minutes' WHERE token_hash=%s",[hashlib.sha256(current_cookie.encode()).hexdigest()])
            check('s02_own_session_restored_after_owned_fixture_change',profile_status()==200)
            with db('platform') as conn:
                conn.execute("UPDATE accounts_websession SET expires_at=now()-interval '1 second' WHERE customer_id<>%s",[first[0]])
                conn.execute("UPDATE accounts_authflow SET expires_at=now()-interval '1 second' WHERE consumed_at IS NULL")
            manage('platform',['accounts_cleanup'])
            with db('platform') as conn:
                check('s02_cleanup_erases_expired_session_and_flow_blobs',not conn.execute("SELECT 1 FROM accounts_websession WHERE expires_at<=now() AND encrypted_payload<>''").fetchone() and not conn.execute("SELECT 1 FROM accounts_authflow WHERE expires_at<=now() AND encrypted_payload<>''").fetchone())
                check('s02_cleanup_preserves_active_session',profile_status()==200 and bool(conn.execute('SELECT 1 FROM accounts_websession WHERE token_hash=%s AND encrypted_payload<>\'\'',[hashlib.sha256(current_cookie.encode()).hexdigest()]).fetchone()))
            policy_output=args.output.with_name('s02-runtime-policies.json')
            policy_run=subprocess.run([str(py),str(ROOT/'tests/integration/identity_policy_checks.py'),str(policy_output),str(temp/'private-policy-values.json')],
                env={**env('identity'),'ALISA_IDENTITY_POLICY_TEST_ALLOW':'1','ALISA_TEST_CA_FILE':str(ca)},stdout=logs,stderr=logs,timeout=45)
            private_policy=temp/'private-policy-values.json'
            if private_policy.exists():private_values.extend(json.loads(private_policy.read_text()));private_policy.unlink()
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
            if args.stores:
                # S02 cleanup deliberately expired the second customer's session.
                # Reauthenticate through native email-code before testing a foreign store.
                open_identity(second_page)
                if second_page.get_by_role('button',name='Продолжить вход в кабинет').count():
                    second_page.get_by_role('button',name='Продолжить вход в кабинет').click()
                field=second_page.locator('input[name=login],input[name=email]').first
                expect(field).to_be_visible();field.fill(second_email);second_page.locator('input[name=password]').fill(customer_password)
                second_page.locator('form').filter(has=field).locator('button[type=submit]').first.click()
                expect(second_page.locator('input[name=code]')).to_be_visible();manage('identity',['identity_deliver'])
                second_page.locator('input[name=code]').fill(letter(second_email))
                second_page.locator('form').filter(has=second_page.locator('input[name=code]')).locator('button[type=submit]').first.click()
                expect(second_page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible(timeout=15000)
                other_profile=second_page.request.get(WEB+'/api/account/me')
                check('s05_other_customer_has_fresh_native_session',other_profile.status==200 and other_profile.json()['profile']['tenant_id']!=str(first[1]))
                from qualify_stores_browser import run as run_stores_browser
                def restart_actual_platform():
                    nonlocal api
                    stop(api)
                    api=start('platform')
                run_stores_browser(context=context,second_context=second_context,db=db,check=check,
                    web_origin=WEB,private_values=private_values,restart=restart_actual_platform)
            if args.alice:
                from qualify_skill_browser import run as run_skill_browser
                def native_skill_login(skill_page):
                    skill_page.locator('input[name=service]').check();skill_page.locator('input[name=privacy]').check()
                    skill_page.get_by_role('button',name='Войти или создать кабинет').click()
                    field=skill_page.locator('input[name=login]').first
                    expect(field).to_be_visible();field.fill(email);skill_page.locator('input[name=password]').fill(customer_password)
                    skill_page.locator('form').filter(has=field).locator('button[type=submit]').first.click()
                    expect(skill_page.locator('input[name=code]')).to_be_visible();manage('identity',['identity_deliver'])
                    skill_page.locator('input[name=code]').fill(letter(email))
                    skill_page.locator('form').filter(has=skill_page.locator('input[name=code]')).locator('button[type=submit]').first.click()
                run_skill_browser(context=context,second_context=second_context,db=db,check=check,web_origin=WEB,
                    client_id=skill_client,client_secret=skill_secret,skill_id=skill_id,private_values=private_values,native_login=native_skill_login)
            if args.staff:
                from qualify_staff_browser import run as run_staff_browser
                run_staff_browser(browser=browser,context=context,second_context=second_context,db=db,manage=manage,
                    check=check,origin=staff_origin,issuer=ISSUER,private_values=private_values,owner_email=email,
                    reader_email=second_email,authority_proxy=proxies[1],private_key=private_key,token_path=token_path,record=record,access_enabled=args.access,web_origin=WEB,platform_proxy=proxies[2],native_letter=letter,native_password=customer_password)
                # The same identity now has a real native admin authenticator.
                # Ordinary customer login must still use password + email only.
                customer_page=context.new_page();customer_page.goto(WEB+'/app')
                expect(customer_page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible()
                customer_page.get_by_role('button',name='Выйти из кабинета',exact=True).click()
                check('s02_enrolled_customer_explicitly_logs_out_before_testing_fresh_credentials',urlsplit(customer_page.url).path=='/login')
                open_identity(customer_page)
                if customer_page.get_by_role('button',name='Продолжить вход в кабинет').count():
                    customer_page.get_by_role('button',name='Продолжить вход в кабинет').click()
                customer_page.locator('input[name=login]').fill(email)
                customer_page.locator('input[name=password]').fill(customer_password)
                customer_page.locator('form').filter(has=customer_page.locator('input[name=login]')).locator('button[type=submit]').click()
                expect(customer_page.locator('input[name=code]')).to_be_visible();manage('identity',['identity_deliver'])
                customer_page.locator('input[name=code]').fill(letter(email))
                customer_page.locator('form').filter(has=customer_page.locator('input[name=code]')).locator('button[type=submit]').first.click()
                expect(customer_page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible(timeout=15000)
                check('customer_enrolled_admin_enters_cabinet_with_password_and_email_without_totp',True)
                customer_page.close()
            if args.open_registration:
                real_context=browser.new_context(ignore_https_errors=False)
                real_page=real_context.new_page()
                real_email='public-'+uuid.uuid4().hex[:10]+'@example.test';contacts.append(real_email)
                register(real_page,real_email)
                initial=real_page.request.get(WEB+'/api/account/me').json()['profile']
                check('s02_open_real_address_without_invitation_reaches_own_cabinet',initial['email']==real_email)
                with db('identity') as conn:
                    check('s02_open_real_contact_verified_and_consent_recorded',
                        conn.execute('SELECT verified FROM account_emailaddress WHERE email=%s',[real_email]).fetchone()==(True,)
                        and conn.execute("SELECT count(*) FROM accounts_identityconsent c JOIN accounts_person p ON p.id=c.person_id WHERE p.email=%s AND c.version='identity-s02-open-1'",[real_email]).fetchone()[0]==2)
                real_page.get_by_role('button',name='Выйти из кабинета').click()
                open_identity(real_page)
                if real_page.get_by_role('button',name='Продолжить вход в кабинет').count():
                    real_page.get_by_role('button',name='Продолжить вход в кабинет').click()
                field=real_page.locator('input[name=login],input[name=email]').first;field.fill(real_email);real_page.locator('input[name=password]').fill(customer_password)
                real_page.locator('form').filter(has=field).locator('button[type=submit]').first.click()
                expect(real_page.locator('input[name=code]')).to_be_visible()
                manage('identity',['identity_deliver'])
                fresh=letter(real_email)
                real_page.locator('input[name=code]').fill(fresh)
                real_page.locator('form').filter(has=real_page.locator('input[name=code]')).locator('button[type=submit]').first.click()
                expect(real_page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible(timeout=15000)
                repeated=real_page.request.get(WEB+'/api/account/me').json()['profile']
                check('s02_open_real_mail_repeat_login_same_customer_and_tenant',
                    all(initial[k]==repeated[k] for k in ['customer_id','tenant_id']))
                other_context=browser.new_context(ignore_https_errors=False);other_page=other_context.new_page()
                other_email='public-'+uuid.uuid4().hex[:10]+'@example.test';contacts.append(other_email)
                register(other_page,other_email)
                other=other_page.request.get(WEB+'/api/account/me').json()['profile']
                check('s02_open_second_real_address_isolated',other['email']==other_email
                    and all(other[k]!=initial[k] for k in ['customer_id','tenant_id']))
                check('s02_open_new_customer_has_no_product_or_admin_grants',other['role']=='OWNER_CLIENT'
                    and other['access_status']=='NOT_PROVISIONED' and other['stores']==[])
                other_context.close();real_context.close()
            logs.flush();text=(temp/'private-process.log').read_text()
            check('s02_private_logs_have_no_known_codes_tokens_contacts',all(v not in text for v in [*contacts,*private_values] if v) and not re.search(r'eyJ[A-Za-z0-9_-]+\.|[A-Za-z0-9_.+-]+@example\.invalid',text))
            second_context.close();context.close();browser.close();browser=None
            record['status']='SOURCE_FLOW_QUALIFIED_NOT_STAGE_ACCEPTANCE'
            logs.close()
    except Exception as exc:
        record['status']='FAILED';record['error_type']=type(exc).__name__
        if 'page' in locals():
            try:record['last_browser_path']=urlsplit(page.url).path
            except Exception:pass
        tb=exc.__traceback__
        while tb:
            if Path(tb.tb_frame.f_code.co_filename).name=='qualify_identity.py':record['qualification_line']=tb.tb_lineno
            if Path(tb.tb_frame.f_code.co_filename).name in {'qualify_identity.py','qualify_staff_browser.py','qualify_access_browser.py','qualify_stores_browser.py','qualify_skill_browser.py'}:record['source_error_location']={'file':Path(tb.tb_frame.f_code.co_filename).name,'line':tb.tb_lineno}
            if not tb.tb_next:break
            tb=tb.tb_next
        if tb:record['error_location']={'file':Path(tb.tb_frame.f_code.co_filename).name,'line':tb.tb_lineno}
        if isinstance(exc,RuntimeError) and str(exc).startswith('CHECK_FAILED:'):record['failed_case']=str(exc).split(':',1)[1]
        record['safe_http_trace']=[item for proxy in proxies for item in getattr(proxy,'safe_trace',[])][-50:]
        record['safe_http_trace_by_backend']={str(proxy.backend):getattr(proxy,'safe_trace',[])[-15:] for proxy in proxies}
        if logs:
            logs.flush();logs.seek(0);diagnostics=[]
            for line in logs:
                if not line.startswith('{'):continue
                try:item=json.loads(line)
                except ValueError:continue
                if item.get('event') in {'alisa.auth.failure','alisa.staff.auth.failure'} and set(item)=={'event','stage','code'}:diagnostics.append(item)
            record['safe_auth_diagnostics']=diagnostics[-10:]
            logs.seek(0);private_text=logs.read()
            record['safe_process_error_classes']=sorted(set(re.findall(r'(?m)^([A-Za-z_][A-Za-z0-9_]*(?:Error|Exception)):',private_text)))
            record['safe_process_exit_codes']=[process.poll() for process in PROCESSES]
            record['safe_failure_categories']=[name for name,marker in {'CWD_NOT_ACCESSIBLE':"can't chdir",'SOURCE_PERMISSION_DENIED':'Permission denied','UNREGISTERED_UID':'getpwuid','WORKER_BOOT_FAILED':'Worker failed to boot','MISSING_MODULE':'ModuleNotFoundError','CONNECTION_REFUSED':'Connection refused'}.items() if marker in private_text]
    finally:
        if browser:
            try:browser.close()
            except Exception:pass
        if playwright:
            try:playwright.stop()
            except Exception:pass
        for p in reversed(PROCESSES):stop(p)
        network.close()
        for proxy in proxies:proxy.shutdown();proxy.server_close()
        if store_fixture:store_fixture.close()
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
