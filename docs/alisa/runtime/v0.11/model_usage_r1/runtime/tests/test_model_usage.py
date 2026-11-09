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
                raw=json.dumps({'choices':[{'message':{'content':'{}'},'finish_reason':'stop'}]}).encode()
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

    def test_old_schema_upgrade_and_rollback_reads(self):
        self.submit();again=Repository(self.repo.path,clock=self.clock)
        self.assertEqual(model_usage.summary(again)['requests'],1)
        with again.connection() as c:
            self.assertEqual(c.execute('SELECT id,state FROM jobs').fetchone()['state'],'QUEUED')
            self.assertEqual(c.execute('SELECT COUNT(*) FROM calls').fetchone()[0],0)


if __name__=='__main__':unittest.main()
