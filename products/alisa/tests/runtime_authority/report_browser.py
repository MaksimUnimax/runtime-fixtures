"""Actual packaged Next/BFF + Django account views + PG/Unix authority fixture."""
import base64
from dataclasses import asdict
import hashlib
import http.server
import json
import os
import importlib.util
import shutil
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import urllib.request
from django.conf import settings
from django.db import connections
from django.test import RequestFactory
from alisa_platform.accounts import views as accounts
from alisa_platform.stores import views as stores
from alisa_platform.queries.reports import reports
from alisa_platform.queries.views import queries
from semantics import canonical_json
import template_catalog

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tests/integration'))
from identity_tls import certificates,start_proxy
from identity_network import OwnedNetwork
from run_postgres import clean_environment


def browser_runtime(root):
    """Readable disposable runtime for the firewall uid; checkout stays private."""
    prefix=Path(sys.base_prefix).resolve()
    if prefix==Path('/') or not (prefix/'lib').is_dir():raise RuntimeError('Invalid test Python prefix')
    pyroot=root/'python'
    shutil.copytree(prefix,pyroot,symlinks=False,
        ignore=shutil.ignore_patterns('site-packages','__pycache__','tests','test','include','share','libpython*.a'))
    py=pyroot/'bin'/Path(sys._base_executable).name
    site=root/'python-site';site.mkdir()
    for name in ['playwright','pyee','greenlet','typing_extensions']:
        spec=importlib.util.find_spec(name)
        if spec is None:raise RuntimeError('Missing owned browser dependency: '+name)
        if spec.submodule_search_locations:
            shutil.copytree(next(iter(spec.submodule_search_locations)),site/name,ignore=shutil.ignore_patterns('__pycache__'))
        else:shutil.copy2(spec.origin,site/Path(spec.origin).name)
    browsers=root/'browsers'
    shutil.copytree(os.environ['PLAYWRIGHT_BROWSERS_PATH'],browsers,ignore=shutil.ignore_patterns('__pycache__'))
    node=root/'node';shutil.copy2(shutil.which('node'),node)
    script=root/'browser-client.py';shutil.copy2(ROOT/'tests/runtime_authority/report_browser_client.py',script)
    for tree in [pyroot,site,browsers]:
        for path in [tree,*tree.rglob('*')]:
            if path.is_symlink():continue
            path.chmod(path.stat().st_mode | (0o055 if path.is_dir() else 0o044))
    node.chmod(0o755);script.chmod(0o644)
    return py,node,script,{'PYTHONHOME':str(pyroot),'PYTHONPATH':str(site),'PLAYWRIGHT_BROWSERS_PATH':str(browsers)}


class Account(http.server.BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_POST(self):
        view={'/api/v1/account/me':accounts.me,'/api/v1/account/stores':stores.stores,
              '/api/v1/account/reports':reports,'/api/v1/account/queries':queries}.get(self.path)
        size=int(self.headers.get('Content-Length','0'))
        if view is None or size>32768:self.send_error(404);return
        try:
            request=RequestFactory().post(self.path,data=self.rfile.read(size),content_type='application/json',
                HTTP_AUTHORIZATION=self.headers.get('Authorization',''))
            response=view(request);body=response.content
            self.send_response(response.status_code);self.send_header('Content-Type','application/json')
            self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        finally:connections.close_all()


def run(case, ports):
    artifact=Path(os.environ['ALISA_REPORT_BROWSER_ARTIFACT'])
    if os.geteuid()!=0 or os.environ.get('GITHUB_ACTIONS')!='true':
        raise RuntimeError('Browser qualification requires the owned isolated CI root job')
    network=OwnedNetwork();node=None;api=None;proxy=None;log=None;added=set();selection_stores=[]
    with tempfile.TemporaryDirectory(prefix='alisa-report-browser-')as folder:
        root=Path(folder);root.chmod(0o755)
        try:
            with tarfile.open(artifact)as archive:
                names=archive.getnames();prefix=next(n[:-len('/manifest.json')]for n in names if n.count('/')==1 and n.endswith('/manifest.json'))
                manifest=json.load(archive.extractfile(prefix+'/manifest.json'))
                members=[m for m in archive.getmembers()if m.name.startswith(prefix+'/ui/web/')]
                archive.extractall(root,members=members,filter='data')
            release=root/prefix
            for name,digest in manifest['files'].items():
                if name.startswith('ui/web/'):
                    case.assertEqual(hashlib.sha256((release/name).read_bytes()).hexdigest(),digest)
            ca,cert,key=certificates(root)
            home=root/'browser-home';nss=home/'.pki/nssdb';nss.mkdir(parents=True)
            log=(root/'child.private.log').open('w')
            subprocess.run(['certutil','-N','-d','sql:'+str(nss),'--empty-password'],check=True,stdout=log,stderr=log)
            subprocess.run(['certutil','-A','-d','sql:'+str(nss),'-n','Report CI CA','-t','C,,','-i',str(ca)],check=True,stdout=log,stderr=log)
            for path in [home,*home.rglob('*')]:os.chown(path,network.uid,network.uid)
            py,node_binary,client_script,browser_env=browser_runtime(root)
            network.setup();case.assertTrue(network.witness(py,{**clean_environment(),**browser_env}))
            api=http.server.ThreadingHTTPServer(('127.0.0.1',0),Account);api.daemon_threads=True
            threading.Thread(target=api.serve_forever,kwargs={'poll_interval':.01},daemon=True).start()
            with socket.socket()as reservation:
                reservation.bind(('127.0.0.1',0));node_port=reservation.getsockname()[1]
            proxy=start_proxy(0,node_port,cert,key)
            added={api.server_address[1],node_port,proxy.server_address[1]};ports.update(added)
            origin='https://127.0.0.1:'+str(proxy.server_address[1])
            env={**clean_environment(),'ALISA_ENV':'dev','ALISA_ACCOUNTS_ENABLED':'1','ALISA_QUERIES_ENABLED':'1',
                 'ALISA_PUBLIC_BASE_URL':origin,'ALISA_PLATFORM_URL':'http://127.0.0.1:'+str(api.server_address[1]),
                 'ALISA_AUTH_SERVICE_TOKEN':settings.AUTH_SERVICE_TOKEN,'NEXT_TELEMETRY_DISABLED':'1',
                 'PORT':str(node_port),'HOSTNAME':'127.0.0.1','HOME':str(home),'NODE_EXTRA_CA_CERTS':str(ca)}
            node=subprocess.Popen([str(node_binary),str(release/'ui/web/apps/web/server.js')],env=env,cwd=release,
                user=network.uid,group=network.uid,extra_groups=[],stdout=log,stderr=log,start_new_session=True)
            for _ in range(80):
                try:
                    with urllib.request.urlopen('http://127.0.0.1:'+str(node_port)+'/health/live',timeout=.5)as response:
                        if response.status==200:break
                except OSError:time.sleep(.1)
            else:raise AssertionError('Packaged Next server did not start')
            item=case.produce()
            ctx,guard,scope=case.port._auth(case.client._context('submit'),case.peer,'submit')
            raw=b'%PDF-1.7\nsynthetic original marketplace document\n'
            job={'id':'browser-original-file','tenant':scope.tenant,'plan':canonical_json({'runtime_guard':guard,'template_execution':{'catalog_hash':template_catalog.HASH}})}
            ident=case.archive.save(job,{'id':'original-file'},template_catalog.TEMPLATES['SUMMARY.43'],asdict(scope.stores[0]),
                'fixture-source','report_download',raw,'application/pdf',hashlib.sha256(raw).hexdigest(),dependencies=['fixture-source'])
            with case.archive.connection()as c:
                original=case.archive.metadata(c.execute('SELECT * FROM reports WHERE id=?',(ident,)).fetchone())
            before=len(case.transport.calls)
            child_env={**clean_environment(),**browser_env,'HOME':str(home)}
            data={'origin':origin,'session':case.web_token,'title':item['template']['name'],'files':[item,original]}
            result=subprocess.run([str(py),str(client_script)],env=child_env,
                user=network.uid,group=network.uid,extra_groups=[],input=json.dumps(data),capture_output=True,text=True,timeout=50)
            if result.returncode:raise AssertionError('Browser download qualification failed: '+result.stderr[-3000:])
            record=json.loads(result.stdout);case.assertEqual(record['status'],'PASS')
            case.assertEqual(len(case.transport.calls),before)
            from alisa_platform.query_insights.models import Feedback
            case.assertEqual(Feedback.objects.filter(query_id=case.qid).count(),1)
            # Seed unbound selection-only metadata AFTER the real report and
            # feedback checks; it must not change their authority/store scope.
            from alisa_platform.stores.models import Store
            for provider,name in [('OZON','Selection Ozon'),('WB','Selection WB')]:
                selection_stores.append(Store.objects.create(tenant=case.tenant,provider=provider,
                    name=name,verified_identity='fixture-selection:'+provider))
            selection_script=root/'selection-client.py'
            shutil.copy2(ROOT/'tests/runtime_authority/selection_browser_client.py',selection_script)
            selection_script.chmod(0o644)
            data={'origin':origin,'session':case.web_token,
                  'selection_store_ids':sorted([str(case.store.pk),*[str(s.pk)for s in selection_stores]])}
            selected=subprocess.run([str(py),str(selection_script)],env=child_env,
                user=network.uid,group=network.uid,extra_groups=[],input=json.dumps(data),capture_output=True,text=True,timeout=50)
            if selected.returncode:raise AssertionError('Browser selection qualification failed: '+selected.stderr[-3000:])
            selection_record=json.loads(selected.stdout);case.assertEqual(selection_record['status'],'PASS')
            case.assertEqual(len(case.transport.calls),before)
            case.assertEqual(Feedback.objects.filter(query_id=case.qid).count(),1)
            record['checks'].extend(selection_record['checks'])
            # A separate browser traverses three REAL signed-cursor list pages.
            # Fixed UUID extremes sort before/after every existing uuid4 card.
            import uuid
            for index in range(50):
                selection_stores.append(Store.objects.create(id=uuid.UUID('00000000-0000-0000-0000-'+format(index+1,'012x')),
                    tenant=case.tenant,provider='OZON',name='Pagination disabled '+str(index),status='DISABLED'))
            paged=[]
            for index in range(52):
                store=Store.objects.create(id=uuid.UUID('ffffffff-ffff-ffff-ffff-'+format(index+1,'012x')),
                    tenant=case.tenant,provider='OZON',name='Pagination active '+format(index,'02d'),
                    verified_identity='fixture-pagination:'+str(index))
                selection_stores.append(store);paged.append(store)
            pagination_script=root/'store-pagination-client.py'
            shutil.copy2(ROOT/'tests/runtime_authority/store_pagination_browser_client.py',pagination_script)
            pagination_script.chmod(0o644)
            data={'origin':origin,'session':case.web_token,'target_store_id':str(paged[0].pk),
                'all_store_ids':sorted([str(case.store.pk),*[str(s.pk)for s in selection_stores if s.status=='ACTIVE']])}
            paginated=subprocess.run([str(py),str(pagination_script)],env=child_env,
                user=network.uid,group=network.uid,extra_groups=[],input=json.dumps(data),capture_output=True,text=True,timeout=60)
            if paginated.returncode:raise AssertionError('Browser store pagination qualification failed: '+paginated.stderr[:3000]+'\nTAIL:\n'+paginated.stderr[-1000:])
            pagination_record=json.loads(paginated.stdout);case.assertEqual(pagination_record['status'],'PASS')
            case.assertEqual(len(case.transport.calls),before)
            record['checks'].extend(pagination_record['checks'])
            return record
        finally:
            if node is not None:
                os.killpg(node.pid,signal.SIGTERM)
                try:node.wait(timeout=5)
                except subprocess.TimeoutExpired:os.killpg(node.pid,signal.SIGKILL);node.wait(timeout=5)
            if proxy is not None:proxy.shutdown();proxy.server_close()
            if api is not None:api.shutdown();api.server_close()
            for store in selection_stores:store.delete()
            network.close();ports.difference_update(added)
            if log is not None:log.close()
