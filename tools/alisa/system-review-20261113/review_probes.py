"""Adversarial review probes. Isolated fixtures and loopback only; no paid IO."""
import base64, json, socket, threading, time, tempfile, urllib.request
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import sys

CORE=Path(__file__).parent/'core'
sys.path[:0]=[str(CORE),str(CORE/'tests')]
from engine import CallError
from model_program_wire import execute
from repository import Repository, Deferred
from model_program import run
from shared_http import read_response
from semantics import canonical_json, strict_json

USAGE={'input_tokens':100,'cache_read_input_tokens':200,'cache_creation_input_tokens':0,'output_tokens':30}
def sse(stop=True,server_tools=False):
    usage=dict(USAGE)
    if server_tools:usage['server_tool_use']={'web_search_requests':1,'tool_search':1}
    events=[{'type':'message_start','message':{'model':'deepseek-flash'}},
            {'type':'message_delta','delta':{'stop_reason':'end_turn'},'usage':usage}]
    if stop:events.append({'type':'message_stop'})
    return ''.join('data: '+json.dumps(e)+'\n\n' for e in events).encode()
def transport():return SimpleNamespace(enabled=True,model_source='model:deepseek-flash',max_request_seconds=90,_credential=lambda _: 'synthetic-key-only')
def request():return SimpleNamespace(operation='model_answer_program',body={'payload':{'model':'deepseek-flash','stream':True,'messages':[]}})

def provider_tool():
    req=request();req.body['payload']['tools']=[{'type':'web_search_20250305','name':'web_search','max_uses':1}]
    sent=[]
    def wire(req,**kw):sent.append(json.loads(req.data));return sse(server_tools=True),200
    with patch('model_program_wire.read_response',wire):_,meta=execute(transport(),req,None)
    assert sent[0]['tools'][0]['type']=='web_search_20250305'
    assert 'server_tool_use' not in meta['model_usage']['usage']
    return {'unapproved_server_tool_passed_to_wire':True,'server_tool_usage_discarded':True}

def receipt_then_timeout():
    served=threading.Event()
    class Handler(BaseHTTPRequestHandler):
        protocol_version='HTTP/1.1'
        def log_message(self,*a):pass
        def do_POST(self):
            self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
            self.wfile.write(sse(False));self.wfile.flush();served.set();time.sleep(.7);self.close_connection=True
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    def wire(req,**kw):
        local=urllib.request.Request('http://127.0.0.1:'+str(server.server_port),data=b'{}',method='POST')
        return read_response(local,timeout=.25,limit=12000000,on_dispatch=kw.get('on_dispatch'))
    try:
        with patch('model_program_wire.read_response',wire):
            try:execute(transport(),request(),None)
            except AttributeError as error:
                assert served.is_set() and "client" in str(error)
                return {'terminal_usage_sent_before_timeout':True,'preserved_usage':False,
                        'actual_exception':'AttributeError','detail':str(error),
                        'cause':'local http Request shadows imported http module in exception handler'}
            raise AssertionError('timeout not reproduced')
    finally:server.shutdown();server.server_close();thread.join(2)

def dead_peer_retry():
    with tempfile.TemporaryDirectory() as tmp:
        path=str(Path(tmp)/'broker.sock');server=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);server.bind(path);server.listen()
        closed=threading.Event()
        def broker():
            peer,_=server.accept();stream=peer.makefile('rwb');stream.readline()
            stream.write(b'{"kind":"call","payload":{}}\n');stream.flush();stream.close();peer.close();closed.set()
        th=threading.Thread(target=broker,daemon=True);th.start()
        repo=Repository(Path(tmp)/'db.sqlite');now=repo.clock()
        with repo.connection(True) as c:c.execute("INSERT INTO jobs(id,tenant,key,state,draft,plan,created,updated,due,owner,lease) VALUES('j','t','k','RUNNING','{}','{}',?,?,?,'o',?)",(now,now,now,now+120))
        attempts=[]
        def call(row,req):
            attempts.append({'after_disconnect':closed.is_set()})
            if len(attempts)==1:raise Deferred(repo.clock()+.2)
            return {'body':base64.b64encode(sse()).decode()}
        worker=SimpleNamespace(repo=repo,transport=transport(),_call=call)
        try:run(worker,repo.get('t','j'),[{'role':'user','content':'sum'},{'role':'user','content':'data'}],{'x':1},socket_path=path)
        except (OSError,CallError):pass
        finally:server.close();th.join(2)
        assert len(attempts)==2 and attempts[-1]['after_disconnect']
        return {'synthetic_attempts':len(attempts),'attempt_after_peer_disconnected':True}

def template_scenarios():
    import test_template_only as fx
    results={}
    for status in [400,422,403,429]:
        f=fx.Pilot('test_simple_template_existing_source_and_normal_answer');f.setUp()
        try:
            original=f.transport.execute;failed=False
            def execute_fixture(req,store):
                nonlocal failed
                if req.store_id and not failed:
                    failed=True;f.transport.calls.append(req);raise CallError('HTTP_'+str(status),status=status)
                return original(req,store)
            f.transport.execute=execute_fixture
            row=f.finish(f.ask());ops=[r.operation for r in f.transport.calls]
            results[str(status)]={'state':row['state'],'error':row['error'],'operations':ops}
            assert row['state']=='READY',results[str(status)]
            assert ops.count('model_answer')==1,results[str(status)]
        finally:f.tearDown()
    f=fx.Pilot('test_simple_template_existing_source_and_normal_answer');f.setUp()
    try:
        f.transport.selection=fx.selection(['B08.finance_accrued'])
        # Force a known, complete fixture through normal scalar collection.
        old=f.transport.execute
        def finance(req,store):
            if req.operation!='ozon_finance':return old(req,store)
            f.transport.calls.append(req);money=lambda n:{'currency_code':'RUB','value':n}
            return {'cashflows':{'sales':{'amount':money('1000'),'fee':money('-200')},'returns':{'amount':money('0'),'fee':money('0')},'services':[]},'total':{'accrued':money('800'),'opening_balance':money('0'),'closing_balance':money('800'),'payments':[]}}, {'status':200}
        f.transport.execute=finance;row=f.finish(f.ask('Продажи до удержаний'))
        payload=f.transport.calls[-1].body['messages'][-1]['content']
        results['selection_hint_in_final_prompt']={'purpose_field_present':'"purpose":' in payload,'ready':row['state']=='READY'}
    finally:f.tearDown()
    f=fx.Pilot('test_simple_template_existing_source_and_normal_answer');f.setUp()
    try:
        original=f.transport.execute
        def cut_selection(req,store):
            data,meta=original(req,store)
            if req.operation=='template_select':data['finish_reason']='length'
            return data,meta
        f.transport.execute=cut_selection;row=f.finish(f.ask())
        results['selector_length_finish']={'state':row['state'],'error':row['error'],'operations':[r.operation for r in f.transport.calls]}
        assert results['selector_length_finish']['operations']==['template_select']
        assert row['error']=='TEMPLATE_EXECUTION_FAILED'
    finally:f.tearDown()
    return results

if __name__=='__main__':
    report={}
    for fn in [provider_tool,receipt_then_timeout,dead_peer_retry,template_scenarios]:
        try:report[fn.__name__]=fn()
        except Exception as e:report[fn.__name__]={'probe_error':type(e).__name__,'detail':str(e)}
    report['paid_calls']=0
    print(json.dumps(report,ensure_ascii=False,indent=2))
