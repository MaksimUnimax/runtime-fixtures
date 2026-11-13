"""Adversarial lifecycle proofs, synthetic I/O only."""
import json,socket,ssl,threading,time,tempfile,unittest,urllib.request,urllib.error
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from engine import CallError,Worker
from repository import Repository,Deferred
from semantics import canonical_json,strict_json,Rejected
from model_program_wire import execute
from model_program_stream import Stream
from model_program import run
from shared_http import read_response
from model_usage import RECEIPT_OBSERVER,job_attempts
import test_program_answers as routing
import test_template_only as templates

USAGE={'input_tokens':100,'cache_read_input_tokens':200,'cache_creation_input_tokens':0,'output_tokens':30}
def sse(stop=True):
    events=[{'type':'message_start','message':{'model':'deepseek-flash'}},
      {'type':'message_delta','usage':USAGE,'delta':{'stop_reason':'end_turn'}}]
    if stop:events.append({'type':'message_stop'})
    return ''.join('data: '+json.dumps(e)+'\n\n'for e in events).encode()
def transport():return SimpleNamespace(enabled=True,model_source='model:deepseek-flash',max_request_seconds=.2,stream_idle_seconds=.12,_credential=lambda _:'synthetic')
def request():return SimpleNamespace(operation='model_answer_program',body={'payload':{'model':'deepseek-flash','stream':True,'messages':[]}})

class Wire(unittest.TestCase):
    def test_undeclared_provider_tools_blocked_before_dispatch(self):
        for tool in [{'type':'web_search_20250305','name':'web_search'}, {'type':'web_fetch_20250910','name':'web_fetch'}, {'name':'shell','input_schema':{}}]:
            req=request();req.body['payload']['tools']=[tool]
            with patch('model_program_wire.read_response')as send:
                with self.assertRaises(CallError)as e:execute(transport(),req,None)
                self.assertEqual(e.exception.code,'MODEL_POLICY_CHANGED');send.assert_not_called()
    def test_local_run_code_profile_allowed(self):
        req=request();req.body['payload']['tools']=[{'name':'run_code','description':'local','input_schema':{'type':'object'}}]
        with patch('model_program_wire.read_response',return_value=(sse(),200)):
            _,meta=execute(transport(),req,None)
        self.assertEqual(meta['model_usage']['usage']['total_tokens'],330)
    def test_exact_network_codes_and_receipt(self):
        for error,code in [(socket.gaierror(-2,'dns'),'NETWORK_DNS'),(ssl.SSLError('tls'),'NETWORK_TLS'),(TimeoutError(),'NETWORK_TIMEOUT'),(ConnectionResetError(),'NETWORK_RESET')]:
            def exchange(*a,**kw):kw['on_chunk'](sse(False));raise urllib.error.URLError(error)
            with patch('model_program_wire.read_response',exchange):
                with self.assertRaises(CallError)as e:execute(transport(),request(),None)
            self.assertEqual(e.exception.code,code);self.assertTrue(e.exception.unknown)
            self.assertEqual(e.exception.model_usage['usage']['total_tokens'],330)
    def test_server_tool_receipt_not_silently_priced(self):
        raw=sse().replace(b'"output_tokens": 30',b'"output_tokens": 30, "server_tool_use": {"web_search_requests":1}')
        with patch('model_program_wire.read_response',return_value=(raw,200)):
            with self.assertRaises(CallError)as e:execute(transport(),request(),None)
        self.assertEqual(e.exception.code,'MODEL_CAPABILITY_VIOLATION')
        self.assertTrue(e.exception.model_usage['cost_incomplete'])
        self.assertEqual(e.exception.model_usage['server_tool_use']['web_search_requests'],1)
    def test_incremental_utf8_crlf_and_trailing_partial(self):
        seen=[];stream=Stream('deepseek-flash',seen.append)
        raw=(b': '+ 'тест'.encode()+b'\r\n\r\n'+sse(False).replace(b'\n',b'\r\n'))
        for b in raw:stream.feed(bytes([b]))
        self.assertEqual(stream.billing['usage']['total_tokens'],330);self.assertFalse(stream.complete)
        stream.feed(b'data: {"type":"message_stop"}\n');self.assertFalse(stream.complete)
        stream.feed(b'\n');self.assertTrue(stream.complete)
    def local_exchange(self,chunks):
        class Handler(BaseHTTPRequestHandler):
            protocol_version='HTTP/1.1'
            def log_message(self,*a):pass
            def do_POST(self):
                self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
                for delay,chunk in chunks:
                    time.sleep(delay)
                    try:self.wfile.write(chunk);self.wfile.flush()
                    except OSError:break
                self.close_connection=True
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.daemon_threads=True
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        def exchange(req,**kw):return read_response(urllib.request.Request('http://127.0.0.1:'+str(server.server_port),data=b'{}'),**kw)
        self.addCleanup(server.server_close);self.addCleanup(server.shutdown)
        return exchange
    def test_receipt_persisted_before_real_idle_timeout(self):
        observed=[];token=RECEIPT_OBSERVER.set(lambda value:observed.append(value))
        try:
            with patch('model_program_wire.read_response',self.local_exchange([(0,sse(False)),(.4,b'')])):
                with self.assertRaises(CallError)as e:execute(transport(),request(),None)
        finally:RECEIPT_OBSERVER.reset(token)
        self.assertEqual(e.exception.code,'NETWORK_TIMEOUT');self.assertEqual(observed[-1]['usage']['total_tokens'],330)
    def test_progressing_stream_can_exceed_connect_budget(self):
        chunks=[(.07,b': progress\n\n')for _ in range(5)]+[(.01,sse())]
        with patch('model_program_wire.read_response',self.local_exchange(chunks)):
            _,meta=execute(transport(),request(),None)
        self.assertGreater(meta['elapsed_ms'],300)

class Session(unittest.TestCase):
    def test_disconnect_during_retry_never_dispatches_again(self):
        with tempfile.TemporaryDirectory()as temp:
            path=str(Path(temp)/'broker.sock');server=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);server.bind(path);server.listen()
            first=threading.Event();closed=threading.Event();attempts=[]
            def broker():
                peer,_=server.accept();stream=peer.makefile('rwb');stream.readline()
                stream.write(b'{"kind":"call","payload":{}}\n');stream.flush();first.wait(2)
                stream.close();peer.close();closed.set()
            thread=threading.Thread(target=broker,daemon=True);thread.start()
            repo=Repository(Path(temp)/'db');now=repo.clock()
            with repo.connection(True)as c:c.execute("INSERT INTO jobs(id,tenant,key,state,draft,plan,created,updated,due,owner,lease)VALUES('j','t','k','RUNNING','{}','{}',?,?,?,'o',?)",(now,now,now,now+120))
            def call(row,req,**kw):
                kw['before_dispatch']();attempts.append(1);first.set();closed.wait(2);raise Deferred(repo.clock()+.3)
            worker=SimpleNamespace(repo=repo,engine=SimpleNamespace(authorize_job=lambda r:None),transport=transport(),_call=call)
            try:
                with self.assertRaises(CallError)as e:run(worker,repo.get('t','j'),[],{},socket_path=path)
                self.assertEqual(e.exception.code,'PROGRAM_EXECUTOR_DISCONNECTED');self.assertEqual(len(attempts),1)
            finally:server.close();thread.join(2)
    def test_durable_outbox_binding_ack_and_no_content_after_ack(self):
        import sys
        sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'executor'))
        from program_results import Results
        with tempfile.TemporaryDirectory()as temp:
            key='a'*64;r=Results(temp);r.start(key,'binding');r.complete(key,'binding','Готовый ответ')
            again=Results(temp);saved=again.read(key,'binding');self.assertEqual(saved['content'],'Готовый ответ')
            with self.assertRaises(ValueError):again.read(key,'another-tenant')
            with self.assertRaises(ValueError):again.ack(key,'binding','bad')
            again.ack(key,'binding',saved['digest']);self.assertNotIn('content',again.read(key,'binding'))

class Routing(routing.ProgramRouting):
    def test_program_lane_does_not_hold_regular_dispatcher(self):
        a,_=self.pending(11000);f=self.flow
        f.worker.step(lane='regular');row=f.repo.get('A',a['job_id']);self.assertEqual(row['state'],'QUEUED')
        # Separate lane selection leaves the heavy job available and the normal
        # dispatcher can claim a distinct short question immediately.
        with patch('model_program.run')as program:
            self.assertFalse(f.worker.step(lane='regular'));program.assert_not_called()
        claimed=f.repo.claim(lane='program');self.assertEqual(claimed['id'],a['job_id'])
    def test_program_does_not_pack_document(self):
        self.pending(11000)
        with patch('model_input_encoding.content',side_effect=lambda data,v:canonical_json(data))as pack,patch('model_program.run',side_effect=lambda *a,**kw:kw['on_complete']({'content':'ok'})):
            self.flow.worker.step()
        self.assertEqual(pack.call_args.args,({},0))

class Selection(templates.Pilot):
    def test_truncated_selection_recovers_before_any_api(self):
        original=self.transport.execute;count=0
        def exchange(req,store):
            nonlocal count
            value,meta=original(req,store)
            if req.operation=='template_select':
                count+=1
                if count==1:value={'content':'{"action":','finish_reason':'length'}
            return value,meta
        self.transport.execute=exchange;row=self.finish(self.ask())
        self.assertEqual(row['state'],'READY');self.assertIsNone(row['error'])
        self.assertEqual([x.operation for x in self.transport.calls],['template_select','template_select','ozon_orders','model_answer'])
        self.assertEqual(self.transport.calls[0].body['context']['original_question'],self.transport.calls[1].body['context']['original_question'])
    def test_repeated_identical_truncation_stops_without_api(self):
        original=self.transport.execute
        def exchange(req,store):
            _,meta=original(req,store);return {'content':'{"action":','finish_reason':'length'},meta
        self.transport.execute=exchange;row=self.finish(self.ask())
        self.assertEqual([x.operation for x in self.transport.calls],['template_select','template_select'])
        self.assertEqual(row['error'],'TEMPLATE_EXECUTION_FAILED')

class Economics(unittest.TestCase):
    def test_peak_offpeak_weekend_and_holiday_tariff(self):
        from datetime import datetime,timezone
        from model_pricing import snapshot
        def stamp(day):return datetime.fromisoformat(day).replace(tzinfo=timezone.utc).timestamp()
        peak=snapshot('deepseek-flash',stamp('2026-11-13T02:00:00'))
        off=snapshot('deepseek-flash',stamp('2026-11-13T04:00:00'))
        weekend=snapshot('deepseek-flash',stamp('2026-11-08T02:00:00'))
        self.assertEqual(peak['rates']['output'],'1.20');self.assertEqual(off['rates']['output'],'0.60')
        self.assertEqual(weekend['period'],'offpeak');self.assertEqual(weekend['fx_as_of'],'2026-11-07')
        self.assertIsNone(snapshot('unknown',stamp('2026-11-13T02:00:00')))
        self.assertIsNone(snapshot('deepseek-flash',stamp('2027-01-01T02:00:00')))
    def test_request_ledger_keeps_unknown_part_and_quote(self):
        from datetime import datetime,timezone
        from model_usage import dispatched,record,summary
        from model_pricing import snapshot
        at=datetime(2026,11,13,2,tzinfo=timezone.utc).timestamp()
        with tempfile.TemporaryDirectory()as temp:
            repo=Repository(Path(temp)/'db',clock=lambda:at)
            with repo.connection(True)as c:
                for i in (1,2):c.execute("INSERT INTO calls(id,jid,source,at,state)VALUES(?,'same','model:deepseek-flash',?,'UNKNOWN')",(i,at))
            for i in (1,2):dispatched(repo,i,context={'schema':'alisa-model-attempt-context/v1','stage':'model_answer_program','requested_model':'deepseek-flash','pricing_quote':snapshot('deepseek-flash',at)})
            record(repo,1,{'requested_model':'deepseek-flash','model':'deepseek-flash','usage':{'prompt_tokens':300,'prompt_cache_hit_tokens':200,'prompt_cache_miss_tokens':100,'completion_tokens':30,'total_tokens':330}})
            result=summary(repo);g=result['economics']['requests'][0]
            self.assertEqual(g['attempts'],2);self.assertEqual(g['complete_receipts'],1);self.assertFalse(g['cost_complete'])
            self.assertEqual(g['route'],'program');self.assertEqual(g['known_rub'],'0.00557627616')
            self.assertEqual(g['quotes'][0]['fx_as_of'],'2026-11-13')
            self.assertTrue(any(x['known_rub_at_supplied_rates'] is not None for x in result['cache_by_stage']))

class ResultRecovery(unittest.TestCase):
    def test_commit_failure_recovers_same_result_without_a_call(self):
        with tempfile.TemporaryDirectory()as temp:
            path=str(Path(temp)/'broker.sock');server=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);server.bind(path);server.listen()
            received=[];acks=[]
            def broker():
                for _ in range(2):
                    peer,_=server.accept();stream=peer.makefile('rwb');received.append(json.loads(stream.readline()))
                    stream.write(b'{"kind":"complete","content":"paid answer","digest":"digest"}\n');stream.flush()
                    line=stream.readline()
                    if line:acks.append(json.loads(line))
                    stream.close();peer.close()
            thread=threading.Thread(target=broker,daemon=True);thread.start()
            repo=Repository(Path(temp)/'db');now=repo.clock()
            with repo.connection(True)as c:c.execute("INSERT INTO jobs(id,tenant,key,state,draft,plan,created,updated,due,owner,lease)VALUES('j','t','k','RUNNING','{}','{}',?,?,?,'o',?)",(now,now,now,now+120))
            calls=[];worker=SimpleNamespace(repo=repo,engine=SimpleNamespace(authorize_job=lambda r:None),transport=transport(),_call=lambda *a,**kw:calls.append(1))
            def fail(value):raise OSError('disk busy')
            try:
                with self.assertRaises(Deferred):run(worker,repo.get('t','j'),[],{},socket_path=path,on_complete=fail)
                def complete(value):repo.complete_answer('j','o',{'complete':True,'pages':[value['content']]})
                run(worker,repo.get('t','j'),[],{},socket_path=path,on_complete=complete)
            finally:server.close();thread.join(3)
            self.assertEqual(calls,[]);self.assertFalse(received[0]['resume_only']);self.assertTrue(received[1]['resume_only'])
            self.assertEqual(received[0]['job_id'],received[1]['job_id']);self.assertEqual(len(acks),1)
            self.assertEqual(repo.get('t','j')['state'],'READY')

class ContextContract(unittest.TestCase):
    def test_calculation_is_separate_even_when_notes_empty(self):
        from copy import deepcopy
        import template_runtime as tr,template_catalog as tc
        result=[];repo=SimpleNamespace(clock=lambda:0,stage_answer=lambda *args:result.append(args[-1]))
        worker=SimpleNamespace(repo=repo)
        invocation={'id':'selected','template_id':'drr_ordered','store_id':'oz1','input':deepcopy(templates.INPUT)}
        plan={'fragments':[{'template_ids':['drr_ordered']}],'selection':{'invocations':[invocation]}}
        progress={'completed_fragments':[],'fragment_index':0}
        with patch.dict(tc.TEMPLATES['drr_ordered'],{'notes':[]}):tr._finish_fragment(worker,{'id':'j','owner':'o'},plan,progress,{})
        data=result[0]['data'];self.assertNotIn('template_context',data)
        calc=data['calculation_context'][0];self.assertEqual(calc['contract'],tc.TEMPLATES['drr_ordered']['calculation_contract'])
        self.assertEqual(calc['input'],templates.INPUT);self.assertNotIn('purpose',json.dumps(data))

class InputCompleteness(routing.ProgramRouting):
    def test_zero_missing_negative_pages_periods_and_partial_remain_distinct(self):
        cases=[{'rows':[{'amount':0}]}, {'rows':[{}]}, {'rows':[{'amount':-7},{'amount':10}]},
          {'pages':[{'page':1,'rows':[{'amount':2}]},{'page':2,'rows':[{'amount':3}]}]},
          {'periods':{'current':[{'amount':5}],'previous':[{'amount':-2}]}},
          {'rows':[{'amount':7}],'complete':False,'next_page':2}]
        f=self.flow
        for i,data in enumerate(cases):
            f.seq+=100;f.save(answer_extra_instruction='fixture '+str(i));a,_=self.pending(11000);row=f.repo.get('A',a['job_id']);progress=strict_json(row['progress'])
            document={**data,'padding':'x'*11000};progress['_answer_api_data']=document
            with f.repo.connection(True)as c:c.execute('UPDATE jobs SET progress=? WHERE id=?',(canonical_json(progress),row['id']))
            observed=[]
            def program(worker,row,messages,api_data,**kw):
                observed.append(api_data);kw['on_complete']({'content':'Синтетическая проверка входных данных.'})
            with patch('model_program.run',program):f.run_job(a)
            self.assertEqual(observed,[document])

class FinalReviewRegressions(unittest.TestCase):
    def test_broker_persistence_error_retrieves_without_reexecution(self):
        with tempfile.TemporaryDirectory()as temp:
            path=str(Path(temp)/'broker.sock');server=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);server.bind(path);server.listen()
            accepted=[];acks=[]
            def broker():
                for reply in ({'kind':'error','code':'PROGRAM_EXECUTOR_FAILED'}, {'kind':'complete','content':'saved answer','digest':'digest'}):
                    peer,_=server.accept();stream=peer.makefile('rwb');accepted.append(json.loads(stream.readline()))
                    stream.write((json.dumps(reply)+'\n').encode());stream.flush()
                    line=stream.readline()
                    if line:acks.append(json.loads(line))
                    stream.close();peer.close()
            thread=threading.Thread(target=broker,daemon=True);thread.start()
            repo=Repository(Path(temp)/'db');now=repo.clock()
            with repo.connection(True)as c:c.execute("INSERT INTO jobs(id,tenant,key,state,draft,plan,created,updated,due,owner,lease)VALUES('j','t','k','RUNNING','{}','{}',?,?,?,'o',?)",(now,now,now,now+120))
            calls=[];worker=SimpleNamespace(repo=repo,engine=SimpleNamespace(authorize_job=lambda r:None),transport=transport(),_call=lambda *a,**kw:calls.append(1))
            def complete(value):repo.complete_answer('j','o',{'complete':True,'pages':[value['content']]})
            try:
                with self.assertRaises(Deferred):run(worker,repo.get('t','j'),[],{},socket_path=path,on_complete=complete)
                run(worker,repo.get('t','j'),[],{},socket_path=path,on_complete=complete)
            finally:server.close();thread.join(3)
            self.assertEqual(calls,[]);self.assertFalse(accepted[0]['resume_only']);self.assertTrue(accepted[1]['resume_only'])
            self.assertEqual(len(acks),1);self.assertEqual(repo.get('t','j')['state'],'READY')

    def test_retrieval_reconnect_is_safe_and_expires(self):
        with tempfile.TemporaryDirectory()as temp:
            clock=[10000.];repo=Repository(Path(temp)/'db',clock=lambda:clock[0]);progress={'_program_started':True,'_program_started_at':10000.}
            with repo.connection(True)as c:c.execute("INSERT INTO jobs(id,tenant,key,state,draft,plan,progress,created,updated,due,owner,lease)VALUES('j','t','k','RUNNING','{}','{}',?,10000,10000,10000,'o',20000)",(canonical_json(progress),))
            worker=SimpleNamespace(repo=repo,engine=SimpleNamespace(authorize_job=lambda r:None),transport=transport())
            with self.assertRaises(Deferred):run(worker,repo.get('t','j'),[],{},socket_path=str(Path(temp)/'absent'))
            clock[0]+=3601
            with repo.connection(True)as c:c.execute('UPDATE jobs SET lease=20000')
            with self.assertRaises(CallError)as error:run(worker,repo.get('t','j'),[],{},socket_path=str(Path(temp)/'absent'))
            self.assertEqual(error.exception.code,'PROGRAM_RESULT_UNAVAILABLE');self.assertTrue(error.exception.unknown)

    def test_revocation_during_retry_blocks_second_dispatch(self):
        from semantics import Rejected
        with tempfile.TemporaryDirectory()as temp:
            path=str(Path(temp)/'broker.sock');server=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);server.bind(path);server.listen()
            enabled=[True];sent=[]
            def broker():
                peer,_=server.accept();stream=peer.makefile('rwb');stream.readline()
                stream.write(b'{"kind":"call","payload":{}}\n');stream.flush();stream.readline();stream.close();peer.close()
            thread=threading.Thread(target=broker,daemon=True);thread.start()
            repo=Repository(Path(temp)/'db');now=repo.clock()
            with repo.connection(True)as c:c.execute("INSERT INTO jobs(id,tenant,key,state,draft,plan,created,updated,due,owner,lease)VALUES('j','t','k','RUNNING','{}','{}',?,?,?,'o',?)",(now,now,now,now+120))
            def ready():
                if not enabled[0]:raise Rejected('LIVE_DISABLED')
            def call(row,req,**kw):
                kw['before_dispatch']();sent.append(1);enabled[0]=False;raise Deferred(repo.clock()+.05)
            worker=SimpleNamespace(repo=repo,engine=SimpleNamespace(authorize_job=lambda r:None),transport=transport(),_call=call,execution_ready=ready)
            try:
                with self.assertRaises(Rejected)as error:run(worker,repo.get('t','j'),[],{},socket_path=path)
            finally:server.close();thread.join(3)
            self.assertEqual(error.exception.code,'LIVE_DISABLED');self.assertEqual(sent,[1])

    def test_malformed_later_receipt_retains_known_counters(self):
        stream=Stream('deepseek-flash');stream.feed(sse(False))
        stream.feed(b'data: {"type":"message_delta","usage":{"output_tokens":"bad"}}\n\n')
        self.assertEqual(stream.billing['usage']['total_tokens'],330);self.assertTrue(stream.billing['cost_incomplete'])

    def test_nested_calculation_contracts_resolve_without_speech_inheritance(self):
        from copy import deepcopy
        import template_runtime as tr
        result=[];repo=SimpleNamespace(clock=lambda:0,stage_answer=lambda *args:result.append(args[-1]))
        invocation={'id':'selected','template_id':'finance_storage_logistics_share','store_id':'oz1','input':deepcopy(templates.INPUT)}
        plan={'fragments':[{'template_ids':['finance_storage_logistics_share']}],'selection':{'invocations':[invocation]}}
        tr._finish_fragment(SimpleNamespace(repo=repo),{'id':'j','owner':'o'},plan,{'completed_fragments':[],'fragment_index':0},{})
        data=result[0]['data'];contracts={item['template_id']:item for item in data['calculation_context']}
        self.assertEqual(set(contracts),{'finance_storage_logistics','finance_storage_logistics_share'})
        for item in contracts.values():self.assertEqual(item['invocation_id'],'selected');self.assertEqual(item['store_id'],'oz1');self.assertNotIn('purpose',item);self.assertNotIn('notes',item)
        self.assertEqual([x['template_id']for x in data['template_context']],['finance_storage_logistics_share'])

class DispatchRevocation(unittest.TestCase):
    def test_legacy_store_revocation_blocks_repeated_send(self):
        with tempfile.TemporaryDirectory()as temp:
            path=str(Path(temp)/'broker.sock');server=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);server.bind(path);server.listen()
            allowed=[True];calls=[]
            def broker():
                peer,_=server.accept();stream=peer.makefile('rwb');stream.readline()
                stream.write(b'{"kind":"call","payload":{}}\n');stream.flush();stream.readline();stream.close();peer.close()
            thread=threading.Thread(target=broker,daemon=True);thread.start()
            repo=Repository(Path(temp)/'db');now=repo.clock()
            with repo.connection(True)as c:c.execute("INSERT INTO jobs(id,tenant,key,state,draft,plan,created,updated,due,owner,lease)VALUES('j','t','k','RUNNING','{}','{}',?,?,?,'o',?)",(now,now,now,now+120))
            def call(row,req,**kw):kw['before_dispatch']();calls.append(1);allowed[0]=False;raise Deferred(repo.clock()+.05)
            engine=SimpleNamespace(authorize_job=lambda r:None,output_authorized=lambda p:allowed[0])
            worker=SimpleNamespace(repo=repo,engine=engine,transport=transport(),_call=call)
            try:
                with self.assertRaises(Exception)as error:run(worker,repo.get('t','j'),[],{},socket_path=path)
            finally:server.close();thread.join(3)
            self.assertEqual(error.exception.code,'SOURCE_ACCESS');self.assertEqual(calls,[1])

    def test_old_program_can_retrieve_fresh_result(self):
        with tempfile.TemporaryDirectory()as temp:
            path=str(Path(temp)/'broker.sock');server=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);server.bind(path);server.listen()
            received=[]
            def broker():
                peer,_=server.accept();stream=peer.makefile('rwb');received.append(json.loads(stream.readline()))
                stream.write(b'{"kind":"complete","content":"long computation","digest":"digest"}\n');stream.flush();stream.readline();stream.close();peer.close()
            thread=threading.Thread(target=broker,daemon=True);thread.start()
            repo=Repository(Path(temp)/'db',clock=lambda:10000.)
            with repo.connection(True)as c:c.execute("INSERT INTO jobs(id,tenant,key,state,draft,plan,progress,created,updated,due,owner,lease)VALUES('j','t','k','RUNNING','{}','{}',?,1,1,1,'o',20000)",(canonical_json({'_program_started':True,'_program_started_at':1}),))
            worker=SimpleNamespace(repo=repo,engine=SimpleNamespace(authorize_job=lambda r:None),transport=transport())
            def complete(value):repo.complete_answer('j','o',{'complete':True,'pages':[value['content']]})
            try:run(worker,repo.get('t','j'),[],{},socket_path=path,on_complete=complete)
            finally:server.close();thread.join(3)
            self.assertTrue(received[0]['resume_only']);self.assertEqual(repo.get('t','j')['state'],'READY')

class ShutdownRecovery(routing.ProgramRouting):
    def test_shutdown_reschedules_started_job_for_retrieval(self):
        a,_=self.pending(11000);f=self.flow
        def stopping(worker,row,*args,**kwargs):
            progress=strict_json(row['progress']);progress['_program_started']=True
            with worker.repo.connection(True)as c:c.execute('UPDATE jobs SET progress=? WHERE id=?',(canonical_json(progress),row['id']))
            raise Rejected('WORKER_STOPPING')
        with patch('model_program.run',stopping):f.worker.step()
        row=f.repo.get('A',a['job_id']);self.assertEqual(row['state'],'QUEUED');self.assertIsNone(row['error']);self.assertTrue(strict_json(row['progress'])['_program_started'])
