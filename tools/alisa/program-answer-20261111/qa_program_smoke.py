"""Paid calls=0: exercise real broker/native execution with the production ledger."""
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import base64,io,json,os,tempfile,time,urllib.error,uuid,subprocess,sys
from repository import Repository
from engine import Worker,CallError
from http_transport import HTTPTransport
from model_program import run,selected
from model_usage import job_attempts
from semantics import canonical_json,Rejected

def synthetic(step):
    code="""const fs=await import('node:fs/promises');
const d=JSON.parse(await fs.readFile('/workspace/input.json','utf8'));
let writable=false;try{await fs.appendFile('/workspace/input.json','x');writable=true;}catch{}
let keys=false;try{await fs.access('/run/credentials/alice-market.service');keys=true;}catch{}
let disk_bounded=false;const h=await fs.open('/workspace/spill','w');
try{const b=Buffer.alloc(8*1024*1024);for(let i=0;i<80;i++)await h.write(b);}catch(e){if(e.code==='ENOSPC')disk_bounded=true;else throw e;}
finally{await h.close();await fs.rm('/workspace/spill');}
return {sum:d.rows.reduce((a,b)=>a+b.value,0),writable,keys,disk_bounded};"""
    events=[{'type':'message_start','message':{'id':'mock_'+str(step),'type':'message','role':'assistant','model':'deepseek-flash','content':[], 'usage':{'input_tokens':100,'output_tokens':0}}}]
    block={'type':'tool_use','id':'calc','name':'run_code','input':{}}if step==1 else{'type':'text','text':''}
    delta={'type':'input_json_delta','partial_json':json.dumps({'code':code,'description':'Synthetic isolation calculation'})}if step==1 else{'type':'text_delta','text':'Двадцать один.'}
    events +=[{'type':'content_block_start','index':0,'content_block':block},{'type':'content_block_delta','index':0,'delta':delta},
        {'type':'content_block_stop','index':0},{'type':'message_delta','delta':{'stop_reason':'tool_use'if step==1 else'end_turn','stop_sequence':None},
         'usage':{'input_tokens':100,'cache_creation_input_tokens':0,'cache_read_input_tokens':0,'output_tokens':10}}, {'type':'message_stop'}]
    return ''.join('event: '+e['type']+'\ndata: '+json.dumps(e)+'\n\n'for e in events).encode()

def case(mode):
    with tempfile.TemporaryDirectory(prefix='program-qa-',dir='/var/lib/alice-market') as temp:
        p=Path(temp);repo=Repository(p/'qa.sqlite',lease=4)
        jid=uuid.uuid4().hex;owner=uuid.uuid4().hex;tenant='synthetic-program-qa'
        with repo.connection(True) as c:
            c.execute('INSERT INTO jobs(id,tenant,key,state,draft,plan,created,updated,due,owner,lease)VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                      (jid,tenant,jid,'RUNNING',canonical_json({'original_question':'Сложи данные','runtime_guard':None}),'{}',repo.clock(),repo.clock(),repo.clock(),owner,repo.clock()+repo.lease))
        row=repo.get(tenant,jid);eng=SimpleNamespace(repo=repo,authorize_job=lambda r:None,report_archive=None)
        (p/'deepseek').write_text('synthetic_not_a_real_key')
        transport=HTTPTransport(p,{}, {},enabled=True);worker=Worker(eng,transport)
        attempts=[];success=0;first429=None;second=None
        def io_call(request,**kwargs):
            nonlocal success,first429,second
            payload=json.loads(request.data);assert 'max_tokens'not in payload
            kwargs['on_dispatch']();attempts.append(payload)
            if mode=='429'and len(attempts)==1:
                first429=time.monotonic()
                raise urllib.error.HTTPError(request.full_url,429,'Rate limit',{'Retry-After':'0'},io.BytesIO(b''))
            if mode=='unknown':raise TimeoutError('synthetic unknown')
            if mode=='429'and len(attempts)==2:second=time.monotonic()
            success+=1
            if success==2:
                last=payload['messages'][-1];text=json.dumps(last,ensure_ascii=False)
                assert '21'in text and 'false'in text and 'writable'in text and 'keys'in text
                assert 'disk_bounded'in text and 'true'in text
            if mode=='cancel':
                with repo.connection(True)as c:c.execute("UPDATE jobs SET state='CANCELLED'WHERE id=?",(jid,))
            return synthetic(success),200
        data={'rows':[{'value':x,'padding':'X'*5000}for x in [3,7,11]]}
        messages=[{'role':'system','content':'Вычисли точную сумму.'},{'role':'user','content':'Сложи значения.'},{'role':'user','content':'placeholder'}]
        with patch('model_program_wire.read_response',io_call):
            if mode in {'unknown','cancel'}:
                try:run(worker,row,messages,data)
                except (CallError,Rejected):pass
                else:raise AssertionError('Expected terminal result')
            else:assert run(worker,row,messages,data)['content']=='Двадцать один.'
        receipts=job_attempts(repo,jid)
        expected=3 if mode=='429'else 1 if mode in {'unknown','cancel'}else 2
        assert len(attempts)==expected and len(receipts)==expected,(mode,len(attempts),len(receipts),expected)
        if mode=='429':assert first429 is not None and second-first429>=19.9 and attempts[0]==attempts[1]
        if mode=='unknown':assert receipts[0]['state']=='UNKNOWN'
        else:
            assert all(r['receipt']['usage']['total_tokens']==110 for r in receipts if r['state']=='RECEIVED')
        with repo.connection()as c:assert c.execute('SELECT resume_safe FROM jobs WHERE id=?',(jid,)).fetchone()[0]==0
        print(json.dumps({'mode':mode,'passed':True,'synthetic_dispatches':len(receipts),'paid_calls':0,'retry_seconds':None if second is None else round(second-first429,3)}),flush=True)
        deadline=time.monotonic()+10
        def active():return bool(subprocess.check_output(['systemctl','list-units','--all','--state=active,activating,deactivating','--plain','--no-legend','alisa-program-run-*','alisa-program@*'],text=True).strip())
        while active() and time.monotonic()<deadline:time.sleep(.1)
        assert not active()

if __name__=='__main__':
    assert not selected('x'*9997) and selected('x'*9998) # JSON quotes count, exactly9999/10000
    for mode in (sys.argv[1:]or ['normal','429','unknown','cancel']):case(mode)
