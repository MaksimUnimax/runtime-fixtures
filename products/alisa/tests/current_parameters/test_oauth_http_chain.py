"""Actual HTTP -> PostgreSQL -> native Unix -> Station reverse proof.
Synthetic accounts only; actual accepted source composition, not mock authority.
Run in a private network namespace with its own PostgreSQL unix socket.
"""
from copy import deepcopy
from datetime import timedelta
import hashlib,http.server,importlib.util,json,os,shutil,sys,tempfile,threading,time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from cryptography.fernet import Fernet
from django.conf import settings
from django.db import connections,close_old_connections
from django.test import TransactionTestCase,RequestFactory,override_settings
from django.utils import timezone
from alisa_platform.alice_link import views as alice_api
from alisa_platform.owner_data import station_parameters as parameters_api
from alisa_platform.owner_data.models import CurrentParameter,OwnerCommand
from alisa_platform.stores.models import RuntimeTenantBinding
from alisa_platform.runtime_adapter.job_client import RuntimeClient,CONTRACT,TASK_SHA256
from .test_voice_parameters import VoiceFixture,OPTIONS

ROOT=Path(__file__).resolve().parents[2]
REPO=ROOT.parents[1]
CORE=REPO/'docs/alisa/runtime/v0.11/rt_job_r02'
LEGACY=ROOT/'runtime/legacy_voice_clarification'
COEFF=ROOT/'runtime/coefficient_voice_station'
OAUTH=ROOT/'runtime/owner_oauth_dialogs'

def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result

class Http(http.server.BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def log_message(self,*args):pass
    def do_POST(self):
        close_old_connections()
        try:
            handlers={'/api/v1/account/alice':alice_api.handle,
                      '/api/v1/account/station-parameters':parameters_api.handle}
            if self.path not in handlers:self.send_error(404);return
            raw=self.rfile.read(int(self.headers.get('Content-Length','0')))
            data=json.loads(raw)
            self.server.observed.append((self.path,data.get('action')))
            request=RequestFactory().post(self.path,data=raw,content_type='application/json',
                HTTP_AUTHORIZATION=self.headers.get('Authorization',''))
            response=handlers[self.path](request)
            self.send_response(response.status_code)
            self.send_header('Content-Type','application/json')
            self.send_header('Content-Length',str(len(response.content)))
            self.send_header('Connection','close');self.end_headers();self.wfile.write(response.content)
        finally:connections.close_all()

@override_settings(**OPTIONS)
class ModernStationHttp(VoiceFixture,TransactionTestCase):
    @classmethod
    def setUpClass(cls):
        if os.environ.get('ALISA_ISOLATED_OAUTH_HTTP_TEST')!='1':raise RuntimeError('PRIVATE_NETWORK_REQUIRED')
        cls.source_tmp=tempfile.TemporaryDirectory(prefix='oauth-chain-source-')
        cls.addClassCleanup(cls.source_tmp.cleanup)
        cls.source=Path(cls.source_tmp.name)
        accepted=cls.source/'accepted';accepted.mkdir()
        base=module('http_accepted_overlay',LEGACY/'build_overlay.py')
        ext=module('http_coefficient_overlay',COEFF/'build_overlay.py')
        oauth=module('http_oauth_overlay',OAUTH/'compose.py')
        for p in (LEGACY/'station_base').glob('*.py'):shutil.copyfile(p,cls.source/p.name)
        for name,text in base.station_sources(LEGACY/'station_base').items():(accepted/name).write_text(text)
        for name,text in ext.station_sources(accepted,ROOT/'services/platform/src/alisa_platform/owner_data/parameter_voice_catalog.json').items():
            (cls.source/name).write_text(text)
        for name,text in oauth.station_core_sources(cls.source).items():(cls.source/name).write_text(text)
        for name,text in ext.native_sources(CORE).items():(cls.source/name).write_text(text)
        cls.path=list(sys.path);sys.path[:0]=[str(cls.source),str(CORE)]
        cls.names=('station_parameters','station_authority','station_oauth','station_parameter_proxy','runtime_port_ipc')
        cls.old_modules={n:sys.modules.pop(n,None) for n in cls.names}
        import station_parameters,station_authority,station_oauth,station_parameter_proxy,runtime_port_ipc
        cls.parameters=station_parameters;cls.authority=station_authority;cls.oauth=station_oauth
        cls.proxy=station_parameter_proxy;cls.ipc=runtime_port_ipc
        cls.station=module('http_chain_service',cls.source/'service.py')
        super().setUpClass()
    @classmethod
    def tearDownClass(cls):
        for name in cls.names:
            sys.modules.pop(name,None)
            if cls.old_modules[name] is not None:sys.modules[name]=cls.old_modules[name]
        sys.path[:]=cls.path;cls.source_tmp.cleanup();super().tearDownClass()
    def setUp(self):
        self.create_voice();RuntimeTenantBinding.objects.create(tenant=self.tenant,native_tenant='fixture-native')
        self.tmp=tempfile.TemporaryDirectory(prefix='oauth-http-chain-');self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.servers=[];self.threads=[]
        self.addCleanup(self.close_servers)
        env=patch.dict(os.environ,{'ALISA_OWNER_PARAMETER_VOICE_ENABLED':'1',
            'ALISA_PLATFORM_URL':'http://127.0.0.1:18102','ALISA_AUTH_SERVICE_TOKEN':settings.AUTH_SERVICE_TOKEN})
        env.start();self.addCleanup(env.stop)
        self.delivery=self.station.Delivery(self.root,Fernet(Fernet.generate_key()),client=SimpleNamespace(),
            auth=lambda *args:False)
        self.delivery.state.update(owner=str(self.customer.pk),connected=True,voice_binding_revision=1,
            binding={'tenant':'fixture-native','application':'fixture-app'},selected={'id':'existing-device'})
        self.delivery.save()
        self.registry=self.station.Registry.__new__(self.station.Registry)
        self.registry.lock=threading.RLock();self.registry.users={str(self.customer.pk):self.delivery}
        self.registry.policy=SimpleNamespace(state={'settings':deepcopy(self.station.DEFAULTS)});self.registry.pair_fail={}
        server=self.authority.Server(str(self.root/'authority.sock'),self.authority.Handler)
        server.registry=self.registry;server.allowed_uid=os.getuid();self.start(server)
        for name,value in [('PATH',str(self.root/'authority.sock'))]:
            fixture=patch.object(self.proxy,name,value);fixture.start();self.addCleanup(fixture.stop)
        fixture=patch.object(self.proxy.pwd,'getpwnam',return_value=SimpleNamespace(pw_uid=os.getuid()))
        fixture.start();self.addCleanup(fixture.stop)
        versions={'runtime_contract_version':CONTRACT,'task_schema_version':'runtime_task_v1','task_schema_sha256':TASK_SHA256,
            'registry_hash':'a'*64,'catalog_bundle_hash':'b'*64,'query_language':'fixture','projection':'fixture',
            'port_build':'fixture','catalog_release_id':'fixture'}
        class Port:
            service_id='fixture-service'
            def _peer(self,peer):
                if peer.service_id!=self.service_id:raise ValueError('WRONG_PEER')
            def versions_for(self,peer):self._peer(peer);return versions
        self.native=self.ipc.Gateway(str(self.root/'native.sock'),Port(),allowed_uid=os.getuid(),service_id='fixture-service')
        self.start(self.native)
        client=RuntimeClient(str(self.root/'native.sock'),os.getuid(),versions,parameters_api._NoRuntimeMutation())
        fixture=patch.object(parameters_api,'configured_client',return_value=client)
        fixture.start();self.addCleanup(fixture.stop)
        self.http=http.server.ThreadingHTTPServer(('127.0.0.1',18102),Http)
        self.http.daemon_threads=True;self.http.observed=[];self.start(self.http)
    def start(self,server):
        thread=threading.Thread(target=server.serve_forever,kwargs={'poll_interval':.01})
        thread.start();self.servers.append(server);self.threads.append(thread)
    def close_servers(self):
        for server in reversed(self.servers):server.shutdown();server.server_close()
        for thread in self.threads:thread.join(3);self.assertFalse(thread.is_alive())
    def enable(self):
        return self.parameters.set_permission(self.delivery,
            {'enabled':True,'expected_revision':0,'confirmed':True},str(self.customer.pk),self.token)
    def say(self,text='установи коэффициент потерь 12 процентов',mid=1):
        return self.registry.ingress({'op':'before','tenant':'fixture-native','application':'fixture-app',
            'token_hash':hashlib.sha256(self.access.encode()).hexdigest(),'oauth_token':self.access,
            'command':text,'rid':'request-'+str(mid),'conversation':'fixture-dialog','message_id':mid})
    def test_actual_http_authorization_and_reverse_proof_saves_exact_current_value(self):
        before=deepcopy({k:self.delivery.state[k]for k in ('owner','binding','selected','voice_binding_revision')})
        self.enable();self.assertIn('Сохранить',self.say()['reply'])
        self.assertEqual(CurrentParameter.objects.count(),0)
        self.assertIn('сохранён',self.say('подтверждаю',2)['reply'])
        self.assertEqual(self.read()['effective']['value'],'0.12')
        self.assertEqual(OwnerCommand.objects.count(),1)
        self.assertEqual(before,{k:self.delivery.state[k]for k in before})
        self.assertNotIn(self.access,(self.root/'state.json').read_text())
        self.assertIn(('/api/v1/account/alice','legacy_station_identity'),self.http.observed)
        self.assertIn(('/api/v1/account/alice','legacy_station_token_current'),self.http.observed)
        self.assertIn(('/api/v1/account/station-parameters','turn'),self.http.observed)
    def test_real_http_revocation_before_confirmation_preserves_value(self):
        self.enable();self.assertIn('Сохранить',self.say()['reply'])
        self.family.revoked_at=timezone.now();self.family.save()
        with self.assertRaises(self.oauth.InvalidOAuth):self.say('подтверждаю',2)
        self.assertEqual(CurrentParameter.objects.count(),0)
        self.assertEqual(OwnerCommand.objects.count(),0)
    def test_existing_consent_required_even_with_valid_modern_access(self):
        self.assertIn('выключена',self.say()['reply']);self.assertEqual(CurrentParameter.objects.count(),0)
    def test_current_hash_recheck_without_bearer_denies_expired_write_but_allows_refresh_wakeup(self):
        digest=hashlib.sha256(self.access.encode()).hexdigest()
        self.assertTrue(self.oauth.current(str(self.customer.pk),'fixture-native',digest))
        self.family.access_expires_at=timezone.now()-timedelta(seconds=1);self.family.save()
        self.assertFalse(self.oauth.current(str(self.customer.pk),'fixture-native',digest))
        self.assertTrue(self.oauth.refreshable(str(self.customer.pk),'fixture-native',digest))
        job={'tenant':'fixture-native','token_hash':digest,'auth_scheme':'modern','conversation':'fixture-dialog','jid':'fixture-job'}
        with patch.object(self.delivery,'peek',return_value={'state':'READY','text':'private answer'}):
            self.assertEqual(self.delivery.status_job(job),{'state':'READY','text':''})
        self.family.revoked_at=timezone.now();self.family.save()
        with patch.object(self.delivery,'peek',side_effect=AssertionError('revoked must not read job')):
            self.assertEqual(self.delivery.status_job(job)['state'],'REVOKED')

    def test_unavailable_authority_does_not_turn_existing_report_into_revoked(self):
        job={'tenant':'fixture-native','token_hash':hashlib.sha256(self.access.encode()).hexdigest(),
             'auth_scheme':'modern','conversation':'fixture-dialog','jid':'fixture-job','delivery':'waiting'}
        before=deepcopy(job)
        with patch.object(self.oauth,'platform',side_effect=TimeoutError('fixture unavailable')),patch.object(self.delivery,'peek',side_effect=AssertionError('No unverified read')):
            with self.assertRaises(TimeoutError):self.delivery.status_job(job)
        self.assertEqual(job,before)
