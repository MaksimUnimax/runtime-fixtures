"""Bounded program lane; retrieval keeps the original job and request binding."""
import hashlib,json,select,socket,threading
from providers import Request
from repository import Deferred
from semantics import Rejected,canonical_json,strict_json

MIN_CHARACTERS=10_000
SOCKET='/run/alisa-program/runner.sock'
RESULT_TTL=3600
BINDING='_program_request_binding'

def selected(api_data):return len(canonical_json(api_data))>=MIN_CHARACTERS

def request_binding(value):
    """Match the producer's binding; persist this hash, never old input values."""
    fields={k:value[k]for k in ('job_id','user_id','messages','document','model')}
    return hashlib.sha256(json.dumps(fields,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()

def digest_shape(value):
    return type(value)is str and len(value)==64 and all(c in '0123456789abcdef'for c in value)

def run(worker,row,messages,api_data,*,socket_path=SOCKET,on_complete=None,generation=None):
    from engine import CallError
    sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
    stopped=threading.Event();lost=[];thread=None;stream=None
    def current():
        ready=getattr(worker,'execution_ready',None)
        if ready is not None:ready()
        with worker.repo.connection(True) as c:
            latest=worker.repo._owned(c,row['id'],row['owner'])
            c.execute('UPDATE jobs SET lease=? WHERE id=?',(worker.repo.clock()+worker.repo.lease,row['id']))
        worker.engine.authorize_job(latest)
        # The legacy queue has no runtime_guard; its store revision must still
        # be checked before every further model send, not only final delivery.
        if callable(getattr(worker.engine,'output_authorized',None)):
            if not worker.engine.output_authorized(latest):raise Rejected('SOURCE_ACCESS')
        return latest
    def live():
        current()
        if stopped.is_set():raise Rejected('CLAIM_INVALID')
        if select.select([sock],[],[],0)[0] and not sock.recv(1,socket.MSG_PEEK|socket.MSG_DONTWAIT):
            raise CallError('PROGRAM_EXECUTOR_DISCONNECTED',unknown=True)
    def heartbeat():
        while not stopped.wait(1):
            try:current()
            except Exception as exc:
                lost.append(exc)
                try:sock.shutdown(socket.SHUT_RDWR)
                except OSError:pass
                return
    try:
        latest=current()
        progress=strict_json(latest['progress'])if latest['progress']else{}
        resume=progress.get('_program_started',False)
        job_id=hashlib.sha256((row['tenant']+'\0'+row['id']+(''if generation is None else'\0parameter-revision:'+generation)).encode()).hexdigest()
        retrieval=resume and BINDING in progress
        if BINDING in progress:
            saved=progress[BINDING]
            if (not resume or type(saved)is not dict or set(saved)!={'job_id','fingerprint'}
                or saved.get('job_id')!=job_id or not digest_shape(saved.get('fingerprint'))):
                raise CallError('PROGRAM_RECOVERY_BINDING',unknown=True)
        if retrieval:
            # Current coefficient values may differ from the original request.
            # Only the original binding can identify its retained paid result.
            envelope={'protocol':3,'job_id':job_id,'fingerprint':saved['fingerprint'],'resume_only':True}
        else:
            envelope={'protocol':2,'job_id':job_id,'resume_only':resume,
                     'messages':messages,'document':canonical_json(api_data),
                     'model':worker.transport.model_source.removeprefix('model:'),
                     'user_id':'alisa_p_'+hashlib.sha256(('alisa-program-tenant-v1\0'+row['tenant']).encode()).hexdigest()}
            # Legacy started jobs have no original hash to recover. Preserve
            # their existing v2 resume-only path; do not pin today's inputs.
            if not resume:progress[BINDING]={'job_id':job_id,'fingerprint':request_binding(envelope)}
        if resume:
            # A healthy computation may take longer than outbox retention.
            # Bound failed retrieval, not total calculation duration.
            progress.setdefault('_program_recovery_at',worker.repo.clock())
            if worker.repo.clock()-progress['_program_recovery_at']>=RESULT_TTL:
                raise CallError('PROGRAM_RESULT_UNAVAILABLE',unknown=True)
            with worker.repo.connection(True)as c:
                worker.repo._owned(c,row['id'],row['owner'])
                c.execute('UPDATE jobs SET progress=? WHERE id=?',(canonical_json(progress),row['id']))
        try:sock.connect(socket_path)
        except OSError:
            if resume:raise Deferred(worker.repo.clock()+1)from None
            raise Rejected('DEPENDENCY_UNAVAILABLE','Исполнитель расчётов временно недоступен.')from None
        progress['_program_started']=True
        progress.setdefault('_program_started_at',worker.repo.clock())
        with worker.repo.connection(True)as c:
            worker.repo._owned(c,row['id'],row['owner'])
            c.execute('UPDATE jobs SET progress=?,resume_safe=1 WHERE id=?',(canonical_json(progress),row['id']))
        stream=sock.makefile('rwb')
        def send(value):stream.write((json.dumps(value,ensure_ascii=False)+'\n').encode());stream.flush()
        send(envelope)
        thread=threading.Thread(target=heartbeat,daemon=True);thread.start()
        while True:
            line=stream.readline(32*1024*1024+1)
            if not line or len(line)>32*1024*1024:
                if lost:raise lost[0]
                raise Deferred(worker.repo.clock()+1) # retrieve only; never restart paid work
            value=json.loads(line)
            if retrieval and type(value)is not dict:raise CallError('PROGRAM_RECOVERY_RESPONSE',unknown=True)
            if value.get('kind')=='call':
                if resume:raise CallError('PROGRAM_REPLAY_FORBIDDEN',unknown=True)
                request=Request('model_answer_program',worker.transport.model_source,'',{'payload':value['payload']},0,None)
                while True:
                    live()
                    try:
                        response=worker._call(row,request,before_dispatch=live)
                        break
                    except Deferred as exc:
                        while worker.repo.clock()<exc.until:
                            if stopped.wait(min(.2,max(0,exc.until-worker.repo.clock()))):raise Rejected('CLAIM_INVALID')
                            live()
                send({'kind':'response',**response})
            elif value.get('kind')=='complete':
                if retrieval:
                    valid=(set(value)=={'kind','job_id','fingerprint','content','digest'}
                           and value['job_id']==job_id and value['fingerprint']==envelope['fingerprint']
                           and type(value['content'])is str and bool(value['content'].strip())
                           and digest_shape(value['digest']))
                    if valid:
                        try:valid=hashlib.sha256(value['content'].encode()).hexdigest()==value['digest']
                        except UnicodeError:valid=False
                    if not valid:raise CallError('PROGRAM_RECOVERY_RESPONSE',unknown=True)
                current();text=value.get('content')
                if type(text)is not str or not text.strip():raise CallError('MODEL_ENVELOPE')
                response={'content':text,'finish_reason':'stop'}
                if on_complete is None:return response # unacknowledged, retained for retrieval
                try:on_complete(response)
                except Rejected:raise
                except Exception:raise Deferred(worker.repo.clock()+1)from None
                # The callback committed READY or a fenced stale-result discard.
                # Neither result may be acknowledged before that durable action.
                try:send({'kind':'ack','digest':value['digest']})
                except OSError:pass
                return response
            elif value.get('kind')=='busy':
                # Broker has not accepted this session; a fresh attempt is safe.
                if not resume:
                    with worker.repo.connection(True)as c:
                        saved=worker.repo._owned(c,row['id'],row['owner'])
                        p=strict_json(saved['progress']);p.pop('_program_started',None);p.pop('_program_started_at',None)
                        p.pop(BINDING,None)
                        c.execute('UPDATE jobs SET progress=? WHERE id=?',(canonical_json(p),row['id']))
                raise Deferred(worker.repo.clock()+1)
            elif value.get('kind')=='unknown':raise CallError('PROGRAM_RESULT_UNAVAILABLE',unknown=True)
            elif value.get('kind')=='error':
                # A broker error can follow a completed result whose durable
                # write failed. Ask only for recovery; never re-run paid work.
                raise Deferred(worker.repo.clock()+1)
            else:raise CallError('PROGRAM_EXECUTOR_FAILED')
    except OSError:
        # A broken channel after acceptance can hide a completed result.
        # The persisted start flag makes the next connection retrieval-only.
        raise Deferred(worker.repo.clock()+1)from None
    finally:
        stopped.set()
        if stream is not None:stream.close()
        sock.close()
        if thread is not None:thread.join(timeout=3)
