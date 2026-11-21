"""Finite full current-core suite in the actual new version directory, offline."""
import json,pathlib,socket,sys,unittest
from unittest.mock import patch
ROOT=pathlib.Path('/opt/alice-market/releases/20261106-store-check-6098-r1');sys.path.insert(0,str(ROOT))
attempts=[];connect=socket.socket.connect;connect_ex=socket.socket.connect_ex
def bounded_connect(sock,address):
 if sock.family in (socket.AF_INET,socket.AF_INET6):attempts.append('TCP');raise AssertionError('External network forbidden')
 return connect(sock,address)
def bounded_connect_ex(sock,address):
 if sock.family in (socket.AF_INET,socket.AF_INET6):attempts.append('TCP');raise AssertionError('External network forbidden')
 return connect_ex(sock,address)
def no_dns(*args,**kwargs):attempts.append('DNS');raise AssertionError('DNS forbidden')
with patch.object(socket.socket,'connect',bounded_connect),patch.object(socket.socket,'connect_ex',bounded_connect_ex),patch.object(socket,'getaddrinfo',no_dns):
 suite=unittest.TestSuite([unittest.defaultTestLoader.discover(str(ROOT/'tests')),unittest.defaultTestLoader.loadTestsFromNames(['test_dataset_pipeline','test_dataset_json_only'])])
 result=unittest.TextTestRunner(verbosity=2).run(suite)
record={'scope':'EXACT_PREPARED_INTEGRATED_CORE_NOT_ACTIVE','tests_run':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'skipped':len(result.skipped),'forbidden_network_attempts':len(attempts),'external_api_calls':0}
print(json.dumps(record));sys.exit(0 if result.wasSuccessful() and not attempts and not result.skipped and result.testsRun==1035 else 1)
