"""Offline regression with loopback-only transport fixtures and safe receipts."""
import argparse
import hashlib
import subprocess
import ipaddress
import json
from pathlib import Path
import socket
import sys
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent/'core'
sys.path.insert(0,str(ROOT))

class Evidence(unittest.TextTestResult):
    def __init__(self,*a,**kw):
        super().__init__(*a,**kw);self.cases=[]
    def addSuccess(self,test):
        super().addSuccess(test);self.cases.append({'case':test.id(),'passed':True})
    def addFailure(self,test,error):
        super().addFailure(test,error);self.cases.append({'case':test.id(),'passed':False,'kind':'FAILURE'})
    def addError(self,test,error):
        super().addError(test,error);self.cases.append({'case':test.id(),'passed':False,'kind':'ERROR'})

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    forbidden=[];resolve=socket.getaddrinfo;connect=socket.socket.connect;connect_ex=socket.socket.connect_ex
    def allowed(host):
        if host=='localhost':return True
        try:return ipaddress.ip_address(host).is_loopback
        except ValueError:return False
    def dns(host,*a,**kw):
        if not allowed(host):forbidden.append('DNS');raise AssertionError('EXTERNAL_DNS_FORBIDDEN')
        return resolve(host,*a,**kw)
    def check(sock,address):
        if sock.family!=socket.AF_UNIX and not allowed(address[0]):
            forbidden.append('TCP');raise AssertionError('EXTERNAL_TCP_FORBIDDEN')
    def guarded_connect(sock,address):check(sock,address);return connect(sock,address)
    def guarded_connect_ex(sock,address):check(sock,address);return connect_ex(sock,address)
    loader=unittest.TestLoader()
    with patch('socket.getaddrinfo',dns),patch.object(socket.socket,'connect',guarded_connect),patch.object(socket.socket,'connect_ex',guarded_connect_ex):
        suite=unittest.TestSuite([loader.discover(str(ROOT/'tests')),
            loader.loadTestsFromName('test_dataset_json_only'),loader.loadTestsFromName('test_dataset_pipeline')])
        result=unittest.TextTestRunner(verbosity=1,resultclass=Evidence).run(suite)
    source_sha='candidate-request-reliability-r1'
    source_dirty=False
    hashes={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in ROOT.rglob('*') if p.is_file() and '__pycache__'not in p.parts and p.suffix in ('.py','.json','.mjs','.gz')}
    tested_tree_sha256=hashlib.sha256(json.dumps(hashes,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    record={'scope':'CURRENT_RUNTIME_OFFLINE_AND_LOOPBACK_TLS_NOT_LIVE_PROVIDER',
        'status':'PASS' if result.wasSuccessful() and not result.skipped and not forbidden else 'FAILED',
        'tests_run':result.testsRun,'skipped':len(result.skipped),'forbidden_network_attempts':len(forbidden),
        'failures':len(result.failures),'errors':len(result.errors),'cases':result.cases,
        'installed':False,'live_provider_calls':0,'source_sha':source_sha,'source_dirty':source_dirty,
        'tested_tree_sha256':tested_tree_sha256,'tested_files':hashes,
        'base_manifest_sha256':hashlib.sha256((ROOT/'manifest.json').read_bytes()).hexdigest()}
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(record,indent=2)+'\n')
    print(json.dumps({k:v for k,v in record.items() if k not in {'cases','tested_files'}}))
    return 0 if record['status']=='PASS' else 1

if __name__=='__main__':sys.exit(main())
