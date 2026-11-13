"""Real pinned Harness + candidate broker; synthetic network and disposable DB."""
import os,sys,json,socket,subprocess,tempfile,pwd,threading,shutil,time
from pathlib import Path
ROOT=Path(__file__).resolve().parent
sys.path[:0]=[str(ROOT/'core'),str(ROOT/'executor')]
MATH={
 'zero':({'rows':[{'amount':0}]},{'sum':0,'missing':0,'complete':True,'rows':1}),
 'missing':({'rows':[{}]},{'sum':0,'missing':1,'complete':True,'rows':1}),
 'returns':({'rows':[{'amount':-7},{'amount':10}]},{'sum':3,'missing':0,'complete':True,'rows':2}),
 'pages':({'pages':[{'id':1,'rows':[{'amount':2}]},{'id':2,'rows':[{'amount':3}]},{'id':1,'rows':[{'amount':2}]}]}, {'sum':5,'missing':0,'complete':True,'rows':2}),
 'periods':({'periods':{'current':[{'amount':5}],'previous':[{'amount':-2}]}},{'periods':{'current':5,'previous':-2}}),
 'incomplete':({'rows':[{'amount':7}],'complete':False},{'sum':7,'missing':0,'complete':False,'rows':1}),
}
MATH_CODE="""const fs=await import('node:fs/promises');const d=JSON.parse(await fs.readFile('/workspace/input.json','utf8'));
if(d.periods)return {periods:Object.fromEntries(Object.entries(d.periods).map(([k,v])=>[k,v.reduce((s,r)=>s+r.amount,0)]))};
let rows=d.rows;if(d.pages){const seen=new Set();rows=d.pages.filter(p=>{if(seen.has(p.id))return false;seen.add(p.id);return true;}).flatMap(p=>p.rows);}
return {sum:rows.reduce((s,r)=>s+(typeof r.amount==='number'?r.amount:0),0),missing:rows.filter(r=>typeof r.amount!=='number').length,complete:d.complete!==false,rows:rows.length};"""

def client(mode,path):
    from types import SimpleNamespace
    from unittest.mock import patch
    from repository import Repository
    from engine import Worker,CallError
    from http_transport import HTTPTransport
    from model_program import run
    from model_usage import job_attempts
    from semantics import canonical_json,Rejected
    from qa_program_smoke_baseline import synthetic
    import urllib.error,io,uuid
    with tempfile.TemporaryDirectory(prefix='alisa-reliability-client-')as temp:
        p=Path(temp);repo=Repository(p/'db',lease=4);jid=uuid.uuid4().hex
        with repo.connection(True)as c:c.execute("INSERT INTO jobs(id,tenant,key,state,draft,plan,created,updated,due,owner,lease)VALUES(?,?,?,'RUNNING',?,'{}',?,?,?,'owner',?)",(jid,'synthetic',jid,canonical_json({'original_question':'Сложи числа','runtime_guard':None}),repo.clock(),repo.clock(),repo.clock(),repo.clock()+repo.lease))
        row=repo.get('synthetic',jid);eng=SimpleNamespace(repo=repo,authorize_job=lambda r:None,report_archive=None)
        (p/'deepseek').write_text('synthetic-not-a-key')
        worker=Worker(eng,HTTPTransport(p,{}, {},enabled=True));attempts=[];success=0;retry=[]
        expected_result=MATH.get(mode,(None,None))[1]
        final=json.dumps(expected_result,sort_keys=True)if expected_result is not None else 'Двадцать один.'
        def exchange(request,**kw):
            nonlocal success
            payload=json.loads(request.data);assert 'max_tokens'not in payload
            kw['on_dispatch']();attempts.append(payload)
            if mode=='429'and len(attempts)==1:
                retry.append(time.monotonic());raise urllib.error.HTTPError(request.full_url,429,'rate',{'Retry-After':'0'},io.BytesIO())
            if mode=='unknown':raise TimeoutError('synthetic')
            if mode=='429'and len(attempts)==2:retry.append(time.monotonic())
            success+=1
            if success==2:
                if expected_result is None:
                    result=json.dumps(payload['messages'][-1]);assert '21'in result and 'disk_bounded'in result and 'true'in result and 'writable'in result and 'false'in result
                else:
                    texts=[x['text']for block in payload['messages'][-1]['content']for x in block.get('content',[])if x.get('type')=='text']
                    result=next(json.loads(t)for t in texts if t.startswith('{'))
                    assert result==expected_result,(mode,result,expected_result)
            if mode=='cancel':
                with repo.connection(True)as c:c.execute("UPDATE jobs SET state='CANCELLED' WHERE id=?",(jid,))
            raw=synthetic(success,code=MATH_CODE if expected_result is not None else None,text=final);kw['on_chunk'](raw);return raw,200
        data=MATH[mode][0]if expected_result is not None else {'rows':[{'value':n,'padding':'x'*5000}for n in (3,7,11)]}
        def received(response):repo.complete_answer(jid,'owner',{'complete':True,'pages':[response['content']]})
        with patch('model_program_wire.read_response',exchange):
            try:
                try:result=run(worker,row,[{'role':'user','content':'Сложи числа.'}],data,socket_path=path,on_complete=received)
                except __import__('repository').Deferred:
                    assert mode=='outbox_failure'
                    result=run(worker,row,[{'role':'user','content':'Сложи числа.'}],data,socket_path=path,on_complete=received)
            except (CallError,Rejected)as error:
                if mode not in ('unknown','cancel'):raise
                if mode=='unknown':assert error.code=='NETWORK_TIMEOUT',error.code
            else:
                assert mode not in ('unknown','cancel');assert result['content']==final
                assert repo.get('synthetic',jid)['state']=='READY'
        expected=3 if mode=='429'else 1 if mode in ('unknown','cancel')else 2
        assert len(attempts)==expected,(mode,len(attempts),expected)
        assert len(job_attempts(repo,jid))==expected
        if mode=='429':assert retry[1]-retry[0]>=19.9
        print(json.dumps({'mode':mode,'passed':True,'paid_calls':0,'synthetic_dispatches':expected,'retry_seconds':retry[1]-retry[0]if retry else None}),flush=True)

def broker(base,fault=''):
    import program_broker
    program_broker.BASE=Path(base)
    if fault=='outbox_failure':
        import program_results
        def fail(*args,**kwargs):raise OSError('synthetic outbox unavailable')
        program_results.Results.complete=fail
    program_broker.serve()

def parent():
    assert os.geteuid()==0
    user=pwd.getpwnam('alice-market')
    with tempfile.TemporaryDirectory(prefix='alisa-program-qa-',dir='/var/lib')as temp:
        base=Path(temp);base.chmod(0o755);(base/'jobs').mkdir();shutil.copytree('/var/lib/alisa-program/rootfs',base/'rootfs',symlinks=True)
        (base/'rootfs'/str(ROOT/'executor').lstrip('/')).mkdir(parents=True,exist_ok=True)
        path=str(base/'runner.sock');server=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);server.bind(path);server.listen();server.settimeout(30)
        os.chown(path,0,user.pw_gid);os.chmod(path,0o660)
        try:
            for mode in ('normal','429','unknown','cancel','outbox_failure',*MATH):
                command=['/usr/sbin/runuser','-u','alice-market','--','/usr/bin/env','-i','PATH=/usr/bin:/bin','PYTHONDONTWRITEBYTECODE=1','/usr/bin/python3','-B',str(__file__),'--client',mode,path]
                process=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
                attempts=2 if mode=='outbox_failure'else 1
                for attempt in range(attempts):
                    peer,_=server.accept()
                    worker=subprocess.Popen(['/usr/bin/python3','-B',str(__file__),'--broker',str(base),mode if mode=='outbox_failure'and attempt==0 else ''],stdin=peer,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
                    peer.close()
                    if attempts==2 and attempt==0:
                        bo,be=worker.communicate(timeout=45)
                        assert worker.returncode!=0 and 'synthetic outbox unavailable'in be
                stdout,stderr=process.communicate(timeout=100);print(stdout,flush=True)
                try:bo,be=worker.communicate(timeout=20)
                except subprocess.TimeoutExpired:worker.terminate();bo,be=worker.communicate(timeout=10);raise
                if process.returncode:raise RuntimeError('client failed '+mode+' '+stderr[-4000:]+' broker '+be[-4000:])
                if mode not in ('unknown','cancel')and worker.returncode:raise RuntimeError('broker failed '+be[-4000:])
                assert not list((base/'jobs').iterdir()),'unclean jobs'
            print('PASS: real broker/Harness; ACK, retry, unknown, cancel, outbox failure recovery, six deterministic math fixtures; no paid calls',flush=True)
        finally:server.close()

if __name__=='__main__':
    if sys.argv[1:2]==['--client']:client(*sys.argv[2:])
    elif sys.argv[1:2]==['--broker']:broker(*sys.argv[2:])
    else:parent()
