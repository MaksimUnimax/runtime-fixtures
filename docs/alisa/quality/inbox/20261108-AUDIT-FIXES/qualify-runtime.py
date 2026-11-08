"""Qualify exact extracted runtime with isolated fixtures, not live configuration."""
import hashlib,ipaddress,json,os,socket,sys,unittest
from pathlib import Path as P
from unittest.mock import patch
ROOT=P('/opt/alice-market/releases/alisa-runtime-06f3c053e7719290')
OUT=P('/var/lib/alisa-platform/stage/rollout-backups/audit-06f3-20261108/runtime-installed-qualification.json')
sys.dont_write_bytecode=True;sys.path.insert(0,str(ROOT))
def hashes():return {n:hashlib.sha256((ROOT/n).read_bytes()).hexdigest()for n in manifest['files']}
MANIFEST_SHA='44e3b6116ac3dd3963e734a031c297b41fa64f3b84b140339fe03c90797d757a'
assert hashlib.sha256((ROOT/'manifest.json').read_bytes()).hexdigest()==MANIFEST_SHA
manifest=json.loads((ROOT/'manifest.json').read_text())
assert manifest['source_sha']=='06f3c053e77192907821005aa4aae5cc1e8aee63' and hashes()==manifest['files']
assert not OUT.exists()
isolated=os.stat('/proc/self/ns/net').st_ino!=os.stat('/proc/1/ns/net').st_ino
live_paths_inaccessible=not any(P(n).exists()for n in ['/etc/alice-market/market-runtime.json','/var/lib/alice-market/state.sqlite3','/run/alice-market/gateway.sock','/etc/alisa-platform/stage/platform.env'])
assert isolated and live_paths_inaccessible
forbidden=[];resolve=socket.getaddrinfo;connect=socket.socket.connect;connect_ex=socket.socket.connect_ex
def allowed(host):
 if host=='localhost':return True
 try:return ipaddress.ip_address(host).is_loopback
 except ValueError:return False
def dns(host,*a,**kw):
 if not allowed(host):forbidden.append('DNS');raise AssertionError('EXTERNAL_DNS_FORBIDDEN')
 return resolve(host,*a,**kw)
def guard(sock,address):
 if sock.family!=socket.AF_UNIX and not allowed(address[0]):forbidden.append('TCP');raise AssertionError('EXTERNAL_TCP_FORBIDDEN')
def guarded_connect(sock,address):guard(sock,address);return connect(sock,address)
def guarded_connect_ex(sock,address):guard(sock,address);return connect_ex(sock,address)
with patch('socket.getaddrinfo',dns),patch.object(socket.socket,'connect',guarded_connect),patch.object(socket.socket,'connect_ex',guarded_connect_ex):
 from run_checks import Evidence
 loader=unittest.TestLoader();suite=unittest.TestSuite([loader.discover(str(ROOT/'tests')),loader.loadTestsFromName('test_dataset_json_only'),loader.loadTestsFromName('test_dataset_pipeline')])
 result=unittest.TextTestRunner(verbosity=1,resultclass=Evidence).run(suite)
unchanged=hashes()==manifest['files'] and hashlib.sha256((ROOT/'manifest.json').read_bytes()).hexdigest()==MANIFEST_SHA
record={'scope':'EXACT_INSTALLED_INACTIVE_RUNTIME_OFFLINE_LOOPBACK_NOT_LIVE_OWNER','source_sha':manifest['source_sha'],'python':sys.version,'sqlite':__import__('sqlite3').sqlite_version,'status':'PASS'if result.wasSuccessful() and result.testsRun==1076 and not result.skipped and not forbidden and unchanged else'FAIL','tests_run':result.testsRun,'skipped':len(result.skipped),'failures':len(result.failures),'errors':len(result.errors),'network_attempts':len(forbidden),'manifest_unchanged':unchanged,'manifest_sha256':MANIFEST_SHA,'private_network':isolated,'live_paths_inaccessible':live_paths_inaccessible,'live_config_used':False,'live_database_used':False,'cases':result.cases}
OUT.write_text(json.dumps(record,indent=2)+'\n');print(json.dumps({k:v for k,v in record.items()if k!='cases'}));sys.exit(0 if record['status']=='PASS'else 1)
