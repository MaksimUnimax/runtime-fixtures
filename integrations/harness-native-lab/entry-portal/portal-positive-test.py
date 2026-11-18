#!/usr/bin/env python3
"""Test the real portal's positive/negative code and Origin paths in isolation.
Do not modify live code, password hash, or native Harness settings.
"""
from hashlib import sha256
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import http.client
import json
import tempfile
import threading
import urllib.parse

spec=spec_from_file_location('portal_test','/opt/harness-native-lab/entry-portal/portal.py')
portal=module_from_spec(spec)
spec.loader.exec_module(portal)

with tempfile.TemporaryDirectory(prefix='labportal-fixture-') as d:
    code='THIS-IS-ONLY-A-TEST-CODE'
    canonical=code.replace('-','').upper()
    hashfile=Path(d)/'hash'
    hashfile.write_text(sha256(canonical.encode()).hexdigest())
    portal.HASH=hashfile
    portal.ENTRY=Path(d)/'entry'
    portal.ENTRY.write_text('https://alisa.octoport.ru:18443/?token=synthetic-fixture-only')
    portal.EXPECTED_ORIGIN='http://127.0.0.1:18445'
    server=portal.ThreadingHTTPServer(('127.0.0.1',0),portal.Handler)
    t=threading.Thread(target=server.serve_forever,daemon=True)
    t.start()

    def submit(candidate,origin='http://127.0.0.1:18445'):
        conn=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=3)
        body=urllib.parse.urlencode({'code':candidate})
        conn.request('POST','/lab-login',body,{'Origin':origin,'Content-Type':'application/x-www-form-urlencoded'})
        response=conn.getresponse()
        status=response.status
        loc=response.getheader('Location','')
        response.read()
        conn.close()
        return status,loc

    wrong=submit('WRONG')
    ok=submit(code)
    disallowed=submit(code,'https://untrusted.invalid')
    result={
        'bad_code':wrong[0],
        'good_code':ok[0],
        'valid_redirect_to_native':ok[1]==portal.ENTRY.read_text(),
        'bad_origin':disallowed[0],
        'live_service_changed':False
    }
    print(json.dumps(result))
    assert wrong[0]==403 and ok[0]==303 and disallowed[0]==403 and result['valid_redirect_to_native']
    server.shutdown()
