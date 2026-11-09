"""Common HTTPS transport observes actual API bytes before business decoding."""
from dataclasses import asdict
import json
import unittest
import shutil
from pathlib import Path
from unittest.mock import patch
from providers import Request
from test_runtime import OZ
import test_read_transport as fixture
import read_surface
from report_archive import DOCUMENT_SINK
from engine import CallError


class ArchiveHTTP(unittest.TestCase):
    def setUp(self):
        self.io=fixture.ReadTransport();self.io.setUp();self.addCleanup(self.io.tearDown)
        self.seen=[];token=DOCUMENT_SINK.set(lambda *args:self.seen.append(args))
        self.addCleanup(DOCUMENT_SINK.reset,token)
        # The production source fixes its Node path. In the author container use
        # the same real qualified Node from PATH without modifying a global bin.
        if not Path('/usr/local/bin/node').exists():
            run=read_surface.subprocess.run;node=shutil.which('node')
            def execute(args,*a,**kw):
                return run([node,*args[1:]] if args[0]=='/usr/local/bin/node' else args,*a,**kw)
            change=patch.object(read_surface.subprocess,'run',side_effect=execute)
            change.start();self.addCleanup(change.stop)

    def test_generic_json_captured_before_model_projection(self):
        raw=json.dumps({'result':[],'buyer_name':'private-owner-only'},ensure_ascii=False).encode()
        def reply(request,**kw):
            kw['response_headers']['Content-Type']='application/json';return raw,200
        req=read_surface.request_for(asdict(OZ),'ozon_actions_list',{})
        with patch('http_transport.read_response',side_effect=reply)as call:
            value,_=self.io.t.execute(req,asdict(OZ))
        self.assertEqual(call.call_count,1);self.assertEqual(self.seen,[(raw,'application/json',False)])
        self.assertNotIn('private-owner-only',str(value))

    def test_marketplace_file_retained_even_if_downstream_json_decoder_rejects(self):
        raw=b'%PDF-1.7\nactual provider document'
        def reply(request,**kw):
            kw['response_headers'].update({'Content-Type':'application/pdf','Content-Disposition':'attachment; filename=report.pdf'});return raw,200
        req=read_surface.request_for(asdict(OZ),'ozon_actions_list',{})
        with patch('http_transport.read_response',side_effect=reply)as call:
            with self.assertRaises(CallError):self.io.t.execute(req,asdict(OZ))
        self.assertEqual(call.call_count,1);self.assertEqual(self.seen,[(raw,'application/pdf',True)])

    def test_model_response_is_never_archived(self):
        raw=json.dumps({'choices':[{'message':{'content':'model only'},'finish_reason':'stop'}]}).encode()
        req=Request('model_answer','model:deepseek-flash','',{'messages':[]},0,None)
        with patch('http_transport.read_response',return_value=(raw,200))as call:
            self.io.t.execute(req,None)
        self.assertEqual(self.seen,[]);self.assertNotIn('response_headers',call.call_args.kwargs)

    def test_http_denial_never_becomes_document(self):
        import urllib.error,io
        error=urllib.error.HTTPError('https://api-seller.ozon.ru',403,'Forbidden',{},io.BytesIO(b'{}'))
        req=read_surface.request_for(asdict(OZ),'ozon_actions_list',{})
        with patch('http_transport.read_response',side_effect=error):
            with self.assertRaises(CallError):self.io.t.execute(req,asdict(OZ))
        self.assertEqual(self.seen,[])
