import json
from pathlib import Path
import sys
import tempfile
from threading import Thread
from urllib.request import Request, build_opener, ProxyHandler
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from qa_gateway import receipts, usage_complete, Gateway
from accounting import tokens, quote

U={'input_tokens':100,'cache_read_input_tokens':200,'cache_creation_input_tokens':0,'output_tokens':30}
def frame(obj):return 'data: '+json.dumps(obj)+'\n\n'
def stream(stop=True):
    s=frame({'type':'message_start','message':{'id':'test','model':'deepseek-flash','usage':U}})
    s+=frame({'type':'message_delta','delta':{'stop_reason':'end_turn'},'usage':U})
    return (s+(frame({'type':'message_stop'}) if stop else '')).encode()

class Accounting(unittest.TestCase):
    def test_final_usage_not_initial_plus_final(self):
        r=receipts(stream(),'/v1/messages')
        self.assertEqual(tokens(r,'/v1/messages'),{'miss':100,'hit':200,'out':30,'input':300})
        self.assertTrue(r['response_complete'])
    def test_missing_stop_still_known_cost_not_complete(self):
        r=receipts(stream(False),'/v1/messages');self.assertFalse(r['response_complete']);self.assertTrue(r['usage_complete'])
    def test_initial_only_is_unknown(self):
        raw=frame({'type':'message_start','message':{'model':'deepseek-flash','usage':U}}).encode()
        self.assertIsNone(tokens(receipts(raw,'/v1/messages'),'/v1/messages'))
    def test_multiline_data(self):
        raw='event: message_delta\ndata: {"type":"message_delta",\ndata: "usage":'+json.dumps(U)+'}\n\n'
        self.assertEqual(receipts(raw.encode(),'/v1/messages')['usage'],U)
    def test_partial_trailing_frame_ignored(self):
        self.assertEqual(receipts(stream(False)+b'data: {"type":','/v1/messages')['usage'],U)
        self.assertEqual(receipts(stream(False)+b'data: {"text":"\xd0','/v1/messages')['usage'],U)
    def test_malformed_envelopes_have_explicit_parse_failure(self):
        for raw,path in [(b'[]','/v1/chat/completions'),(b'{"choices":[null]}','/v1/chat/completions'),
                         (b'data: null\n\n','/v1/messages'),(b'data: {"message":null}\n\n','/v1/messages')]:
            with self.assertRaises(ValueError):receipts(raw,path)
    def test_missing_negative_boolean_creation(self):
        for change in [{'input_tokens':None},{'output_tokens':-1},{'cache_read_input_tokens':True},{'cache_creation_input_tokens':1}]:
            u={**U,**change};self.assertFalse(usage_complete(u,'/v1/messages'))
            self.assertIsNone(tokens({'model':'deepseek-flash','usage':u},'/v1/messages'))
    def test_chat_reasoning_already_in_output(self):
        u={'prompt_tokens':300,'prompt_cache_hit_tokens':200,'prompt_cache_miss_tokens':100,
           'completion_tokens':30,'total_tokens':330,'completion_tokens_details':{'reasoning_tokens':25}}
        r={'model':'deepseek-flash','usage':u}
        self.assertEqual(tokens(r,'/v1/chat/completions')['out'],30)
        for change in [{'prompt_cache_hit_tokens':301},{'total_tokens':355},{'prompt_tokens_details':{'cached_tokens':99}},
                       {'prompt_tokens_details':None},{'completion_tokens_details':[]},
                       {'prompt_tokens_details':{'cached_tokens':False}}]:
            self.assertIsNone(tokens({'model':'deepseek-flash','usage':{**u,**change}},'/v1/chat/completions'))
            self.assertFalse(usage_complete({**u,**change},'/v1/chat/completions'))
    def test_price_and_band(self):
        a={'path':'/v1/messages','dispatched_utc':'2026-11-11T00:55:00+00:00','receipt':receipts(stream(),'/v1/messages')}
        self.assertEqual(quote(a)['cost'],'0.0000336')
        self.assertIsNone(quote(a)['boundary_ambiguous'])
        a['received_utc']='2026-11-11T01:00:00+00:00';self.assertTrue(quote(a)['boundary_ambiguous'])
    def test_partial_network_response_saved_with_usage(self):
        class Response:
            status=200;headers={'Content-Type':'text/event-stream'}
            def __enter__(self):self.n=0;return self
            def __exit__(self,*args):pass
            def read1(self,n):
                self.n+=1
                if self.n==1:return stream(False)
                raise TimeoutError('synthetic disconnect')
        class Opener:
            def open(self,*args,**kwargs):return Response()
        with tempfile.TemporaryDirectory() as temp:
            g=Gateway('local',Path(temp)/'receipt.json',lambda:'unused',maximum=1,raw_evidence_dir=Path(temp)/'raw')
            g.opener=Opener();Thread(target=g.serve_forever,daemon=True).start()
            try:
                data=json.dumps({'model':'deepseek-flash','max_tokens':10,'output_config':{'effort':'high'},'stream':True,'messages':[]}).encode()
                req=Request('http://127.0.0.1:33191/v1/messages',data=data,headers={'x-api-key':'local'})
                with build_opener(ProxyHandler({})).open(req) as res:res.read()
                self.assertEqual(g.attempts[0]['status'],'INCOMPLETE_WITH_USAGE')
                self.assertEqual((Path(temp)/'raw/1.response.private.bin').read_bytes(),stream(False))
            finally:g.shutdown();g.server_close()

    def test_optional_archive_failure_keeps_billing_receipt(self):
        class Response:
            status=200;headers={'Content-Type':'text/event-stream'}
            def __enter__(self):self.n=0;return self
            def __exit__(self,*args):pass
            def read1(self,n):
                self.n+=1
                return stream() if self.n==1 else b''
        class Opener:
            def open(self,*args,**kwargs):return Response()
        original=Path.write_bytes
        def write(path,data):
            if path.name.endswith('.response.private.bin'):raise OSError('Synthetic archive failure')
            return original(path,data)
        with tempfile.TemporaryDirectory() as temp:
            g=Gateway('local',Path(temp)/'receipt.json',lambda:'unused',maximum=1,raw_evidence_dir=Path(temp)/'raw')
            g.opener=Opener();Thread(target=g.serve_forever,daemon=True).start()
            try:
                data=json.dumps({'model':'deepseek-flash','max_tokens':10,'output_config':{'effort':'high'},'stream':True,'messages':[]}).encode()
                with patch.object(Path,'write_bytes',write):
                    req=Request('http://127.0.0.1:33191/v1/messages',data=data,headers={'x-api-key':'local'})
                    with build_opener(ProxyHandler({})).open(req) as res:res.read()
                saved=json.loads((Path(temp)/'receipt.json').read_text())['attempts'][0]
                self.assertEqual(saved['status'],'COMPLETED')
                self.assertEqual(saved['raw_capture_error'],'OSError')
                self.assertEqual(saved['receipt']['usage'],U)
            finally:g.shutdown();g.server_close()

if __name__=='__main__':unittest.main()
