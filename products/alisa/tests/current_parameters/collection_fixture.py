"""Real platform signer/rights, Unix HTTP authority RPC and RuntimePort/Worker.

Only identities, stored credentials and provider/model answers are synthetic.
No test permissive authorizer or production access/config is used.
"""
from pathlib import Path
from datetime import timedelta
from dataclasses import asdict
from copy import deepcopy
from http.server import BaseHTTPRequestHandler
from socketserver import ThreadingMixIn,UnixStreamServer
from unittest.mock import patch
import tempfile,threading,os,json,uuid,time,subprocess
from django.conf import settings
from django.test import RequestFactory,override_settings
from django.db import connections
from django.utils import timezone
from alisa_platform.entitlements.models import AccessLedger,AccessGrant
from alisa_platform.stores.models import CredentialRevision,VaultSecret
from alisa_platform.owner_data import parameter_collection as collection
from alisa_platform.runtime_adapter import authority_rpc
from current_parameters.test_parameters import Fixture
from engine import Engine,Worker
from repository import Repository
from model_answer import Settings
from platform_authority_client import PlatformAuthorityClient
from runtime_port import RuntimePort,Peer
from runtime_port_ipc import Gateway
from test_parameter_worker import Transport,Clock
import parameter_source_runtime

class PrivateHTTP(UnixStreamServer):
    pass
class ThreadedPrivateHTTP(ThreadingMixIn,PrivateHTTP):daemon_threads=True
class AuthorityHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length=int(self.headers.get('Content-Length','0'));raw=self.rfile.read(length)
            req=RequestFactory().post(self.path,data=raw,content_type=self.headers.get('Content-Type'),HTTP_AUTHORIZATION=self.headers.get('Authorization',''),CONTENT_LENGTH=str(length))
            response=authority_rpc.check(req);body=bytes(response.content)
            self.send_response(response.status_code);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        finally:connections.close_all()
    def log_message(self,*a):pass
class ClosingGateway(Gateway):
    def process_request_thread(self,*args):
        try:return super().process_request_thread(*args)
        finally:connections.close_all()

class Environment(Fixture):
    def setup(self):
        self.folder=tempfile.TemporaryDirectory(prefix='parameter-lk-',dir='/root');self.root=Path(self.folder.name)
        self.create();now=timezone.now();self.ledger=AccessLedger.objects.create(tenant=self.tenant)
        self.grant=AccessGrant.objects.create(tenant=self.tenant,source='GIFT',source_id=uuid.uuid4(),days=7,starts_at=now-timedelta(hours=1),ends_at=now+timedelta(days=6),actor_id=uuid.uuid4(),reason='SYNTHETIC_PARAMETER_TEST')
        secret=VaultSecret.objects.create(tenant=self.tenant,store=self.store,kind='SELLER',revision=1,key_version='fixture',ciphertext='SYNTHETIC-NOT-DECRYPTED')
        self.credential=CredentialRevision.objects.create(tenant=self.tenant,store=self.store,kind='SELLER',revision=1,secret=secret,status='ACTIVE',check_code='CONNECTED')
        self.mapping={'schema':'alisa-runtime-bindings/v1','environment':'dev','service_id':settings.RUNTIME_SERVICE_ID,'catalog_release_id':settings.RUNTIME_CATALOG_RELEASE_ID,
            'tenants':[{'tenant_id':str(self.tenant.pk),'runtime_tenant':'native-tenant','revision':'fixture-map-1','stores':[{'store_id':str(self.store.pk),'provider':'OZON','verified_identity':self.store.verified_identity,'credential_revision':1,
            'credentials':[{'kind':'SELLER','id':str(self.credential.pk),'revision':1}],
            'runtime_store':{'id':'native-store','platform':'ozon','identity':'native-cabinet','access_revision':'store1','source_revision':'source1','currency':'RUB'}}]}]}
        self.bindings=self.root/'bindings.json';self.bindings.write_text(json.dumps(self.mapping));self.bindings.chmod(0o600)
        self.override=override_settings(RUNTIME_BINDINGS_PATH=str(self.bindings),RUNTIME_VERSIONS_PATH=str(self.root/'versions.json'),RUNTIME_JOB_SOCKET=str(self.root/'runtime.sock'),RUNTIME_JOB_UID=os.getuid())
        self.override.enable()
        self.http=ThreadedPrivateHTTP(str(self.root/'authority.sock'),AuthorityHandler);os.chmod(self.root/'authority.sock',0o600)
        self.http_thread=threading.Thread(target=self.http.serve_forever,kwargs={'poll_interval':.01},daemon=True);self.http_thread.start()
        self.clock=Clock();self.clock.now=time.time()-120
        self.repo=Repository(self.root/'jobs.sqlite',self.clock)
        def no_legacy(_):raise AssertionError('No legacy scope bypass')
        self.engine=Engine(self.repo,no_legacy,template_mode=True,answer_settings=Settings(self.root/'answer.json'))
        self.engine.parameter_source_policy={'enabled':True,'pin':parameter_source_runtime.PIN}
        self.native_authority=PlatformAuthorityClient(str(self.root/'authority.sock'),expected_uid=os.getuid(),service_token=settings.RUNTIME_AUTHORITY_TOKEN,service_id=settings.RUNTIME_SERVICE_ID)
        self.port=RuntimePort(self.engine,self.native_authority,service_id=settings.RUNTIME_SERVICE_ID,catalog_release_id=settings.RUNTIME_CATALOG_RELEASE_ID)
        self.peer=Peer(settings.RUNTIME_SERVICE_ID,'alisa_market')
        (self.root/'versions.json').write_text(json.dumps(self.port.versions_for(self.peer)));(self.root/'versions.json').chmod(0o600)
        self.gateway=ClosingGateway(str(self.root/'runtime.sock'),self.port,allowed_uid=os.getuid(),service_id=settings.RUNTIME_SERVICE_ID)
        self.thread=threading.Thread(target=self.gateway.serve_forever,kwargs={'poll_interval':.01},daemon=True);self.thread.start()
        self.transport=Transport();self.transport.pending_once=False;self.worker=Worker(self.engine,self.transport)
        original=subprocess.run
        def node(command,*args,**kw):
            if type(command)is list and command[0]=='/usr/local/bin/node':command=['/root/alisa-owner-toolchain/node-v24.22.1-linux-x64/bin/node',*command[1:]]
            return original(command,*args,**kw)
        self.node=patch('subprocess.run',node);self.node.start()
    def close(self):
        self.gateway.shutdown();self.gateway.server_close();self.thread.join(2)
        self.http.shutdown();self.http.server_close();self.http_thread.join(2)
        self.node.stop();self.override.disable();connections.close_all();self.folder.cleanup()
    def start_command(self,mode='replace',key='loss_rate'):
        return {'action':'start_calculation','store_id':str(self.store.pk),'parameter':key,'scope':{'kind':'store','sku':''},'sku_reference':None,
            'period':{'from':'2026-10-01','to':'2026-10-31'},'mode':mode,'command_id':str(uuid.uuid4()),'expected_revision':0,'confirmed':True,'not_after':int(time.time())+120}
    def check_command(self,cmd,action='collection_status'):
        return {k:cmd[k]for k in('store_id','parameter','scope','sku_reference','command_id')}|{'action':action}
    def row(self):
        with self.repo.connection()as c:r=c.execute('SELECT *FROM jobs ORDER BY created DESC,rowid DESC LIMIT 1').fetchone();return dict(r)if r else None
    def finish(self):
        for _ in range(120):
            row=self.row()
            if row['state']not in('QUEUED','RUNNING'):return row
            self.clock.advance(max(1,row['due']-self.clock()+1));self.worker.step()
        raise AssertionError('Worker did not finish')
