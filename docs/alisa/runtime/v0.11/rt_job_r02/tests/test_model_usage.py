"""Accounting is checked against a real loopback HTTP send, never a paid API."""
import json, tempfile, threading, unittest
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from repository import Repository, Deferred
from engine import Engine, Worker, CallError
from http_transport import HTTPTransport, ENDPOINTS
from semantics import fingerprint
from test_runtime import Clock, SCOPE, FakeTransport
import model_usage, providers, retention, shared_http


class UsageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.clock = Clock()
        self.repo = Repository(str(Path(self.tmp.name)/'state.sqlite3'), clock=self.clock)
        self.engine = Engine(self.repo, lambda tenant: SCOPE)
        self.question = 'сводка заказов за октябрь 2026 на озоне'

    def tearDown(self):
        self.tmp.cleanup()

    def submit(self, rid='one'):
        return self.engine.submit('A', self.question, rid, fingerprint(self.question), date(2026,11,3))

    def request(self):
        return providers.Request('deepseek_parse','model:deepseek-flash','',{'question':'test','slots':{}},0,None)

    def test_zero_model_cache_hit_replay_and_control(self):
        self.submit()
        Worker(self.engine, FakeTransport()).step()
        self.assertEqual(self.submit('two')['cache'], 'HIT')
        self.submit('two')
        self.engine.submit('A','результат','control',fingerprint('результат'),date(2026,11,3))
        summary = model_usage.summary(self.repo)
        self.assertEqual((summary['requests'],summary['attempts'],summary['average']),(2,0,0))

    def test_real_http_503_and_retry_are_two_attempts(self):
        self.submit(); row = self.repo.claim(); observed = []
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length'])); observed.append(1)
                status=503 if len(observed)==1 else 200
                raw=json.dumps({'model':'deepseek-flash','choices':[{'message':{'content':'{}'},'finish_reason':'stop'}],'usage':{'prompt_tokens':1000,'completion_tokens':100,'total_tokens':1100,'prompt_cache_hit_tokens':800,'prompt_cache_miss_tokens':200}}).encode()
                self.send_response(status); self.send_header('Content-Length',str(len(raw))); self.end_headers(); self.wfile.write(raw)
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        transport=HTTPTransport('/unused',{}, {},enabled=True)
        try:
            with patch.dict(ENDPOINTS,{'deepseek_parse':'http://127.0.0.1:'+str(server.server_port)}), patch.object(transport,'_credential',return_value='synthetic-fixture'):
                worker=Worker(self.engine,transport)
                with self.assertRaises(Deferred):worker._call(row,self.request())
                self.clock.advance(3)
                worker._call(row,self.request())
            stats=model_usage.summary(self.repo)
            self.assertEqual((len(observed),stats['attempts'],stats['failed'],stats['received'],stats['average']),(2,2,1,1,2))
            attempts=model_usage.job_attempts(self.repo,row['id'])
            self.assertIsNone(attempts[0]['receipt'])
            self.assertEqual(attempts[1]['receipt']['usage']['prompt_tokens'],1000)
        finally:
            server.shutdown();server.server_close();thread.join()

    def test_local_credential_failure_does_not_count_dispatch(self):
        self.submit();row=self.repo.claim();transport=HTTPTransport('/unused',{}, {},enabled=True)
        with patch.object(transport,'_credential',side_effect=CallError('CREDENTIAL_MISSING')):
            with self.assertRaises(CallError):Worker(self.engine,transport)._call(row,self.request())
        self.assertEqual(model_usage.summary(self.repo)['attempts'],0)

    def test_saturated_http_pool_does_not_count_dispatch(self):
        self.submit();row=self.repo.claim();transport=HTTPTransport('/unused',{}, {},enabled=True)
        original=shared_http.read_response
        def bounded(request, **kwargs):
            kwargs['timeout']=.01
            return original(request, **kwargs)
        for _ in range(shared_http._MAX_IO):shared_http._IO_SLOTS.acquire()
        try:
            with patch.object(transport,'_credential',return_value='synthetic-fixture'),patch('http_transport.read_response',side_effect=bounded):
                with self.assertRaises(Deferred):Worker(self.engine,transport)._call(row,self.request())
            self.assertEqual(model_usage.summary(self.repo)['attempts'],0)
        finally:
            for _ in range(shared_http._MAX_IO):shared_http._IO_SLOTS.release()

    def test_expiry_clears_large_backlog_even_for_active_job(self):
        self.submit();row=self.repo.claim();old=self.clock()-model_usage.WINDOW_SECONDS
        with self.repo.connection(True) as c:
            c.executemany('INSERT INTO model_usage_requests VALUES(?,?)',[(str(i),old)for i in range(2501)])
            c.executemany("INSERT INTO calls(jid,source,at,state,dispatched) VALUES(?,'model:deepseek-flash',?,'UNKNOWN',?)",[(row['id'],old,old)]*2501)
            c.execute("INSERT INTO calls(jid,source,at,state) VALUES(?,'ozon:source',?,'SENDING')",(row['id'],old))
        self.assertEqual(model_usage.summary(self.repo)['attempts'],0)
        retention.sweep(self.repo)
        with self.repo.connection() as c:
            self.assertEqual(c.execute("SELECT COUNT(*) FROM calls WHERE source LIKE 'model:%'").fetchone()[0],0)
            self.assertEqual(c.execute('SELECT COUNT(*) FROM model_usage_requests WHERE at<=?',(old,)).fetchone()[0],0)
            self.assertEqual(c.execute("SELECT COUNT(*) FROM calls WHERE source='ozon:source'").fetchone()[0],1)

    def test_restart_requalifies_coverage_without_erasing_counts(self):
        self.submit();self.clock.advance(model_usage.WINDOW_SECONDS+1)
        self.assertTrue(model_usage.summary(self.repo)['full_window'])
        model_usage.begin_run(self.repo)
        self.assertFalse(model_usage.summary(self.repo)['full_window'])

    def test_old_schema_upgrade_and_rollback_reads(self):
        self.submit();again=Repository(self.repo.path,clock=self.clock)
        self.assertEqual(model_usage.summary(again)['requests'],1)
        with again.connection() as c:
            self.assertEqual(c.execute('SELECT id,state FROM jobs').fetchone()['state'],'QUEUED')
            self.assertEqual(c.execute('SELECT COUNT(*) FROM calls').fetchone()[0],0)


    def test_usage_receipt_contains_only_whitelisted_counters(self):
        value=model_usage.receipt({'model':'deepseek-flash','created':123,
            'choices':[{'message':{'content':'private answer','reasoning_content':'private reasoning'}}],
            'usage':{'prompt_tokens':1000,'completion_tokens':100,'total_tokens':1100,
                     'prompt_cache_hit_tokens':800,'prompt_cache_miss_tokens':200,
                     'completion_tokens_details':{'reasoning_tokens':30,'private':'secret'},
                     'private':'secret'}},'deepseek-flash')
        self.assertEqual(value['usage']['completion_tokens_details'],{'reasoning_tokens':30})
        self.assertNotIn('private',json.dumps(value))
        self.assertNotIn('choices',value)
        invalid=model_usage.receipt({'model':'model/secret','usage':{'prompt_tokens':True,'completion_tokens':-1}},'deepseek-flash')
        self.assertNotIn('model',invalid);self.assertEqual(invalid['usage'],{})

    def test_quote_cache_output_reasoning_and_incomplete_usage(self):
        value={'usage':{'prompt_tokens':1000,'completion_tokens':100,'total_tokens':1100,
                       'prompt_cache_hit_tokens':800,'prompt_cache_miss_tokens':200,
                       'completion_tokens_details':{'reasoning_tokens':30}}}
        rates=dict(input_cached='1',input_uncached='2',output='3',rub_per_currency='100')
        quote=model_usage.price_attempt(value,**rates)
        self.assertEqual(quote,{'currency_amount':'0.0015','rub':'0.1500'})
        self.assertIsNone(model_usage.price_attempt(None,**rates))
        value['usage']['prompt_cache_miss_tokens']=201
        self.assertIsNone(model_usage.price_attempt(value,**rates))
        value['usage'].pop('prompt_cache_miss_tokens');value['usage'].pop('prompt_cache_hit_tokens')
        value['usage']['prompt_tokens_details']={'cached_tokens':800}
        self.assertEqual(model_usage.price_attempt(value,**rates),quote)
        value['usage']['total_tokens']=1200
        self.assertIsNone(model_usage.price_attempt(value,**rates))

    def test_usage_persists_after_restart_and_expires_with_attempt(self):
        self.submit();row=self.repo.claim();event=self.repo.reserve(row['id'],row['owner'],'model:deepseek-flash',0,None)
        model_usage.dispatched(self.repo,event)
        receipt=model_usage.receipt({'usage':{'prompt_tokens':5}},'deepseek-flash')
        model_usage.record(self.repo,event,receipt)
        model_usage.record(self.repo,event,{'usage':{'prompt_tokens':999}})
        again=Repository(self.repo.path,clock=self.clock)
        self.assertEqual(model_usage.job_attempts(again,row['id'])[0]['receipt'],receipt)
        self.clock.advance(model_usage.WINDOW_SECONDS+1)
        self.assertEqual(model_usage.job_attempts(again,row['id']),[])
        retention.sweep(again)
        with again.connection()as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM calls WHERE id=?',(event,)).fetchone()[0],0)

    def test_real_http_invalid_envelope_keeps_billed_tokens(self):
        self.submit();row=self.repo.claim()
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']))
                raw=json.dumps({'model':'deepseek-flash','choices':[],
                                'usage':{'prompt_tokens':10,'completion_tokens':5,'prompt_cache_hit_tokens':0,'prompt_cache_miss_tokens':10,'total_tokens':15}}).encode()
                self.send_response(200);self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        transport=HTTPTransport('/unused',{}, {},enabled=True)
        try:
            with patch.dict(ENDPOINTS,{'deepseek_parse':'http://127.0.0.1:'+str(server.server_port)}),patch.object(transport,'_credential',return_value='synthetic-fixture'):
                with self.assertRaises(Deferred):Worker(self.engine,transport)._call(row,self.request())
            attempts=model_usage.job_attempts(self.repo,row['id'])
            self.assertEqual(len(attempts),1)
            self.assertEqual(attempts[0]['state'],'HTTP_ERROR')
            self.assertEqual(attempts[0]['receipt']['usage']['completion_tokens'],5)
        finally:server.shutdown();server.server_close();thread.join()

    def test_usage_survives_local_answer_rejection(self):
        self.submit();row=self.repo.claim()
        class Transport:
            def execute_observed(self,request,store,on_dispatch):
                on_dispatch()
                return {'content':'{}'},{'status':200,'model_usage':{'requested_model':'deepseek-flash','usage':{'prompt_tokens':7}}}
        from semantics import Rejected
        def rejected(value):raise Rejected('TEST_LOCAL_REJECT')
        with self.assertRaises(Rejected):Worker(self.engine,Transport())._call(row,self.request(),on_received=rejected)
        self.assertEqual(model_usage.job_attempts(self.repo,row['id'])[0]['receipt']['usage']['prompt_tokens'],7)


if __name__=='__main__':unittest.main()
