"""Original Station ingress + two actual Unix sockets + real platform PG.

Only site HTTP carriage is an in-process RequestFactory; identity validation,
consent signing, native peer dispatch and Station token database are concrete.
No owner credentials, installed listener or provider are accessed.
"""
from copy import deepcopy
import hashlib,importlib.util,io,json,os,shutil,socket,sqlite3,sys,tempfile,threading,time,uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from cryptography.fernet import Fernet
from django.conf import settings
from django.test import TestCase,RequestFactory,override_settings
from alisa_platform.owner_data import station_parameters as api,parameter_voice as voice
from alisa_platform.owner_data.models import CurrentParameter,OwnerCommand
from alisa_platform.stores.models import RuntimeTenantBinding
from alisa_platform.runtime_adapter.job_client import CONTRACT,TASK_SHA256,RuntimeClient
from .test_parameters import Fixture

ROOT=Path(__file__).resolve().parents[2]
REPO=ROOT.parents[1]
CORE=REPO/'docs/alisa/runtime/v0.11/rt_job_r02'
LEGACY=ROOT/'runtime/legacy_voice_clarification'
EXT=ROOT/'runtime/coefficient_voice_station'

def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

@override_settings(OWNER_PARAMETER_VOICE_ENABLED=True,ALICE_LINK_ENABLED=True,ALISA_ENV='synthetic')
class StationParameters(Fixture,TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source_tmp=tempfile.TemporaryDirectory(prefix='station-source-')
        cls.addClassCleanup(cls.source_tmp.cleanup)
        cls.source=Path(cls.source_tmp.name)
        base=module('station_accepted_overlay',LEGACY/'build_overlay.py')
        ext=module('station_manual_overlay',EXT/'build_overlay.py');cls.overlay=ext
        # Reproduce the accepted installed Station generation first, then add
        # this source-only overlay without mutating the accepted baseline.
        accepted=cls.source/'accepted';accepted.mkdir()
        for name,text in base.station_sources(LEGACY/'station_base').items():(accepted/name).write_text(text)
        for p in (LEGACY/'station_base').glob('*.py'):
            if p.name!='service.py':shutil.copyfile(p,cls.source/p.name)
        for name,text in ext.station_sources(accepted,ROOT/'services/platform/src/alisa_platform/owner_data/parameter_voice_catalog.json').items():
            (cls.source/name).write_text(text)
        for name,text in ext.native_sources(CORE).items():(cls.source/name).write_text(text)
        cls.original_path=list(sys.path);sys.path[:0]=[str(cls.source),str(CORE)]
        import station_parameters,station_authority,station_parameter_proxy,runtime_port_ipc
        cls.station_parameters=station_parameters;cls.sa=station_authority
        cls.proxy=station_parameter_proxy;cls.ipc=runtime_port_ipc
        cls.station=module('coefficient_station_service',cls.source/'service.py')
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        sys.path[:]=cls.original_path
        for name in ('station_parameters','station_authority','station_parameter_proxy','runtime_port_ipc'):
            sys.modules.pop(name,None)
        cls.source_tmp.cleanup();super().tearDownClass()

    def setUp(self):
        self.create();RuntimeTenantBinding.objects.create(tenant=self.tenant,native_tenant='fixture-native')
        self.tmp=tempfile.TemporaryDirectory(prefix='station-case-');self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.clock_offset=0
        self.env=patch.dict(os.environ,{'ALISA_OWNER_PARAMETER_VOICE_ENABLED':'1'});self.env.start();self.addCleanup(self.env.stop)
        self.token_hash=hashlib.sha256(b'fixture-legacy-only').hexdigest();self.token_db=self.root/'oauth.sqlite3'
        self.token_path=patch.object(self.station,'TOKEN_DB',str(self.token_db));self.token_path.start();self.addCleanup(self.token_path.stop)
        with sqlite3.connect(self.token_db) as c:
            c.execute('CREATE TABLE tokens(hash TEXT,account TEXT,kind TEXT,revoked INTEGER,expires REAL)')
            c.execute('INSERT INTO tokens VALUES(?,?,?,?,?)',(self.token_hash,'fixture-native','access',0,time.time()+3600))
        self.delivery=self.station.Delivery(self.root,Fernet(Fernet.generate_key()),client=SimpleNamespace(),
            clock=lambda:time.time()+self.clock_offset,auth=self.station.token_active)
        self.delivery.state.update(owner=str(self.customer.pk),connected=True,voice_binding_revision=1,
            binding={'tenant':'fixture-native','application':'fixture-app'},selected={'id':'existing-device'})
        self.delivery.save()
        self.registry=self.station.Registry.__new__(self.station.Registry)
        self.registry.lock=threading.RLock();self.registry.users={str(self.customer.pk):self.delivery}
        self.registry.policy=SimpleNamespace(state={'settings':deepcopy(self.station.DEFAULTS)});self.registry.pair_fail={}
        self.sa_server=self.sa.Server(str(self.root/'authority.sock'),self.sa.Handler)
        self.sa_server.registry=self.registry;self.sa_server.allowed_uid=os.getuid()
        self.threads=[];self.servers=[];self.start_server(self.sa_server)
        self.proxy_path=patch.object(self.proxy,'PATH',str(self.root/'authority.sock'));self.proxy_path.start();self.addCleanup(self.proxy_path.stop)
        self.proxy_pwd=patch.object(self.proxy.pwd,'getpwnam',return_value=SimpleNamespace(pw_uid=os.getuid()))
        self.proxy_pwd.start();self.addCleanup(self.proxy_pwd.stop)
        versions={'runtime_contract_version':CONTRACT,'task_schema_version':'runtime_task_v1','task_schema_sha256':TASK_SHA256,
            'registry_hash':'a'*64,'catalog_bundle_hash':'b'*64,'query_language':'fixture','projection':'fixture',
            'port_build':'fixture','catalog_release_id':'fixture'}
        class Port:
            service_id='fixture-service'
            def _peer(self,peer):
                from semantics import Rejected
                if peer.service_id!=self.service_id:raise Rejected('AUTH_REQUIRED')
            def versions_for(self,peer):self._peer(peer);return versions
        self.native=self.ipc.Gateway(str(self.root/'runtime.sock'),Port(),allowed_uid=os.getuid(),service_id='fixture-service')
        self.start_server(self.native)
        self.client=RuntimeClient(str(self.root/'runtime.sock'),os.getuid(),versions,api._NoRuntimeMutation())
        self.client_factory=patch.object(api,'configured_client',return_value=self.client);self.client_factory.start();self.addCleanup(self.client_factory.stop)
        self.calls=[];self.lose_reply=False;self.tamper=None
        self.http=patch.object(self.station_parameters,'platform',side_effect=self.platform)
        self.http.start();self.addCleanup(self.http.stop)
        self.addCleanup(self.close_servers)

    def start_server(self,server):
        thread=threading.Thread(target=server.serve_forever,kwargs={'poll_interval':.01})
        thread.start();self.threads.append(thread);self.servers.append(server)

    def close_servers(self):
        for server in reversed(self.servers):server.shutdown();server.server_close()
        for thread in self.threads:thread.join(2);self.assertFalse(thread.is_alive())

    def platform(self,data):
        self.calls.append(data['action'])
        if self.tamper:data=self.tamper(deepcopy(data))
        req=RequestFactory().post('/api/v1/account/station-parameters',data=json.dumps(data),content_type='application/json',
            HTTP_AUTHORIZATION='Bearer '+settings.AUTH_SERVICE_TOKEN)
        result=api.handle(req)
        if self.lose_reply and data['action']=='turn':raise OSError('simulated reply loss AFTER commit')
        if 400<=result.status_code<500:return {'rejected':True}
        if result.status_code!=200:raise OSError('private HTTP source unavailable')
        return json.loads(result.content)

    def enable(self,enabled=True,revision=0):
        return self.station_parameters.set_permission(self.delivery,
            {'enabled':enabled,'expected_revision':revision,'confirmed':True},str(self.customer.pk),self.token)

    def say(self,text='установи коэффициент потерь 12 процентов',seq=1,rid=None,conversation='fixture-conversation'):
        return self.registry.ingress({'op':'before','tenant':'fixture-native','application':'fixture-app','token_hash':self.token_hash,
            'command':text,'rid':rid or 'turn-'+str(seq),'conversation':conversation,'message_id':seq})

    def test_default_read_binding_has_no_write_permission(self):
        response=self.say();self.assertIn('выключена',response['reply'])
        self.assertEqual(CurrentParameter.objects.count(),0);self.assertEqual(self.calls,[])

    def test_existing_binding_no_relink_full_propose_confirm_cabinet_read(self):
        before=deepcopy({k:self.delivery.state[k] for k in ('owner','binding','selected','trigger','voice_binding_revision')})
        self.enable();proposal=self.say();self.assertIn('Сохранить',proposal['reply'])
        self.assertEqual(CurrentParameter.objects.count(),0)
        answer=self.say('подтверждаю',2);self.assertIn('сохранён',answer['reply'])
        self.assertEqual(self.read()['effective']['value'],'0.12')
        self.assertEqual({k:self.delivery.state[k] for k in before},before)
        self.assertNotIn('parameter_pending',self.delivery.state);self.assertEqual(OwnerCommand.objects.count(),1)

    def test_manual_zero_survives_shared_writer(self):
        self.enable();self.say('установи коэффициент потерь 0 процентов');self.say('подтверждаю',2)
        self.assertEqual(self.read()['effective']['value'],'0')

    def test_read_callback_does_not_acquire_held_station_lock(self):
        self.enable()
        with self.delivery.lock:
            proposal=self.say();self.assertIn('Сохранить',proposal['reply'])
            result=self.say('подтверждаю',2);self.assertIn('сохранён',result['reply'])

    def test_duplicate_confirmation_no_new_mutation_or_report(self):
        self.enable();self.say();self.say('подтверждаю',2)
        result=self.say('подтверждаю',2)
        self.assertIn('уже обработана',result['reply']);self.assertEqual(CurrentParameter.objects.get().revision,1)

    def test_reply_loss_after_commit_recovers_same_signed_confirmation(self):
        self.enable();self.say();self.lose_reply=True
        result=self.say('подтверждаю',2);self.assertIn('Автоматического повтора нет',result['reply'])
        self.assertEqual(CurrentParameter.objects.get().revision,1);self.assertIn('parameter_pending',self.delivery.state)
        self.lose_reply=False;result=self.say('подтверждаю',3)
        self.assertIn('сохранён',result['reply']);self.assertEqual(CurrentParameter.objects.get().revision,1)
        self.assertEqual(OwnerCommand.objects.count(),1)

    def test_cabinet_change_wins_over_old_voice_proposal(self):
        self.enable();self.say();self.save('0.3');result=self.say('подтверждаю',2)
        self.assertIn('не подтверждено',result['reply']);self.assertEqual(self.read()['effective']['value'],'0.3')

    def test_service_credential_cannot_change_proved_utterance(self):
        self.enable()
        def tamper(value):
            if value['action']=='turn':value['turn']['text']='установи коэффициент потерь 90 процентов'
            return value
        self.tamper=tamper;answer=self.say()
        self.assertIn('не подтверждено',answer['reply']);self.assertEqual(CurrentParameter.objects.count(),0)

    def test_owner_security_change_invalidates_stored_station_consent(self):
        self.enable();self.say();self.customer.security_revision+=1;self.customer.save()
        result=self.say('подтверждаю',2);self.assertIn('не подтверждено',result['reply'])
        self.assertEqual(CurrentParameter.objects.count(),0)

    def test_native_tenant_mapping_must_already_exist(self):
        self.enable();RuntimeTenantBinding.objects.filter(tenant=self.tenant).delete()
        result=self.say();self.assertIn('не подтверждено',result['reply']);self.assertEqual(CurrentParameter.objects.count(),0)

    def test_no_permission_grant_from_wrong_cabinet_session(self):
        self.token='invalid-session-token'
        with self.assertRaises(ValueError):self.enable()
        self.assertFalse(self.station_parameters.permission(self.delivery)['enabled'])

    def test_disable_removes_pending_and_does_not_rebind_station(self):
        self.enable();self.say();self.enable(False,1)
        self.assertNotIn('parameter_pending',self.delivery.state)
        result=self.say('установи коэффициент потерь 5 процентов',2)
        self.assertIn('выключена',result['reply']);self.assertEqual(CurrentParameter.objects.count(),0)

    def test_rebind_invalidates_old_consent_without_new_oauth(self):
        self.enable();self.say();self.delivery.state['voice_binding_revision']+=1;self.delivery.save()
        result=self.say('подтверждаю',2);self.assertIn('выключена',result['reply'])
        self.assertEqual(CurrentParameter.objects.count(),0)

    def test_legacy_token_revoked_before_confirmation(self):
        self.enable();self.say()
        with sqlite3.connect(self.token_db) as c:c.execute('UPDATE tokens SET revoked=1')
        with self.assertRaises(self.station.Fault):self.say('подтверждаю',2)
        self.assertEqual(CurrentParameter.objects.count(),0)

    def test_pending_is_encrypted_and_expires_via_existing_tick(self):
        self.enable();self.say();pending=self.delivery.state['parameter_pending']
        self.assertNotIn('0.12',pending['cipher']);self.assertNotIn('value',pending)
        self.clock_offset=121;self.delivery.tick();self.assertNotIn('parameter_pending',self.delivery.state)
        self.assertEqual(CurrentParameter.objects.count(),0)

    def test_feature_disabled_preserves_original_report_ingress(self):
        with patch.dict(os.environ,{'ALISA_OWNER_PARAMETER_VOICE_ENABLED':'0'}):
            result=self.say();self.assertEqual(result['command'],'установи коэффициент потерь 12 процентов')
        self.assertEqual(self.calls,[])

    def test_ordinary_reports_unchanged(self):
        self.enable();before=len(self.calls);result=self.say('сколько заказов вчера')
        self.assertEqual(result['command'],'сколько заказов вчера');self.assertEqual(len(self.calls),before)

    def test_wrong_native_peer_denied_without_write(self):
        self.enable();self.native.allowed_uid=os.getuid()+12345
        result=self.say();self.assertIn('не подтверждено',result['reply']);self.assertEqual(CurrentParameter.objects.count(),0)

    def test_unknown_outcome_does_not_auto_repeat(self):
        self.enable();self.say();self.lose_reply=True;self.say('подтверждаю',2)
        calls=len(self.calls);self.delivery.tick();self.assertEqual(len(self.calls),calls)
        self.assertEqual(OwnerCommand.objects.count(),1)

    def test_last_authority_change_rolls_back_value_and_receipt(self):
        self.enable();self.say();original=api.StationProof.current;counter=[0]
        def current(checker,*args):
            counter[0]+=1
            if counter[0]==3:self.delivery.parameter_authority_view=None
            return original(checker,*args)
        with patch.object(api.StationProof,'current',current):result=self.say('подтверждаю',2)
        self.assertIn('не подтверждено',result['reply'])
        self.assertEqual(CurrentParameter.objects.count(),0);self.assertEqual(OwnerCommand.objects.count(),0)

    def test_forged_station_consent_is_not_owner_authorization(self):
        self.enable();self.delivery.state['parameter_consent']['grant']+='forged';self.delivery.save()
        result=self.say();self.assertIn('не подтверждено',result['reply'])
        self.assertEqual(CurrentParameter.objects.count(),0)

    def test_legacy_flow_never_creates_platform_oauth_families(self):
        from alisa_platform.alice_link.models import AliceLink,TokenFamily
        self.enable();self.say();self.say('подтверждаю',2)
        self.assertEqual(AliceLink.objects.count(),0);self.assertEqual(TokenFamily.objects.count(),0)
        self.assertEqual(self.read()['effective']['value'],'0.12')

    def test_ui_composition_keeps_page_and_uses_current_permission_revision(self):
        root=self.root/'ui';root.mkdir()
        (root/'index-site.html').write_text('<main><p>existing owner page</p></main>')
        (root/'app.js').write_text('function render(s){\n state=s;\n}\n')
        rendered=self.overlay.ui_sources(root)
        self.assertIn('existing owner page',rendered['index-site.html'])
        self.assertIn('parameter-permission-form',rendered['index-site.html'])
        self.assertIn('expected_revision:state.parameter_permission.revision',rendered['app.js'])
        self.assertIn('confirmed:true',rendered['app.js'])
        self.assertNotIn('grant',rendered['app.js'])
        self.assertEqual((root/'index-site.html').read_text(),'<main><p>existing owner page</p></main>')

    def site_action(self,origin='https://alisa.octoport.ru',token=None):
        raw=json.dumps({'action':'parameter_permission','enabled':True,'expected_revision':0,'confirmed':True}).encode()
        handler=self.station.AdminHandler.__new__(self.station.AdminHandler)
        handler.path=self.station.SITE_BASE+'api'
        handler.headers={'Host':'alisa.octoport.ru','Origin':origin,'Content-Type':'application/json',
                         'Content-Length':str(len(raw)),'Cookie':'__Host-alisa_session='+(token or self.token)}
        handler.rfile=io.BytesIO(raw);handler.server=SimpleNamespace(delivery=self.registry)
        result=[];handler.send=lambda status,body,*args,**kw:result.append((status,body))
        with patch.object(self.station,'site_profile',return_value={'customer_id':str(self.customer.pk)}) as profile:
            handler.do_POST()
        return result[0],profile.call_count

    def test_existing_station_site_handler_routes_explicit_consent(self):
        (status,body),called=self.site_action()
        self.assertEqual(status,200);self.assertEqual(called,1)
        self.assertTrue(json.loads(body)['parameter_permission']['enabled'])
        self.assertEqual(CurrentParameter.objects.count(),0)

    def test_station_foreign_origin_denied_before_profile_or_grant(self):
        (status,body),called=self.site_action(origin='https://untrusted.invalid')
        self.assertEqual(status,403);self.assertEqual(called,0);self.assertEqual(self.calls,[])
        self.assertFalse(self.station_parameters.permission(self.delivery)['enabled'])

    def test_site_profile_alone_cannot_replace_real_session_validation(self):
        (status,body),called=self.site_action(token='invalid-session')
        self.assertNotEqual(status,200);self.assertFalse(self.station_parameters.permission(self.delivery)['enabled'])

    def test_feature_off_hides_permission_from_existing_owner_page(self):
        with patch.dict(os.environ,{'ALISA_OWNER_PARAMETER_VOICE_ENABLED':'0'}):
            self.assertIsNone(self.delivery.view()['parameter_permission'])

    def test_plain_authority_guard_without_active_turn_is_not_a_write(self):
        self.enable();turn=self.say('обычный вопрос');guard=self.sa.claims(self.delivery,self.delivery.state['latest_turn'])
        with self.assertRaises(Exception):api.StationProof().current(guard,'a'*64)
        self.assertEqual(CurrentParameter.objects.count(),0)
