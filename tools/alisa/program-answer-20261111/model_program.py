"""Run the official isolated executor; the existing Worker owns every HTTP call."""
import hashlib,json,socket,threading,time
from providers import Request
from repository import Deferred
from semantics import Rejected,canonical_json

MIN_CHARACTERS=10_000
SOCKET='/run/alisa-program/runner.sock'

def selected(api_data):
    return len(canonical_json(api_data))>=MIN_CHARACTERS

def run(worker,row,messages,api_data,*,socket_path=SOCKET):
    from engine import CallError
    sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
    stopped=threading.Event();lost=[]
    def current():
        with worker.repo.connection(True) as c:
            latest=worker.repo._owned(c,row['id'],row['owner'])
            c.execute('UPDATE jobs SET lease=? WHERE id=?',(worker.repo.clock()+worker.repo.lease,row['id']))
        return latest
    def heartbeat():
        while not stopped.wait(1):
            try:current()
            except Exception as exc:
                lost.append(exc)
                try:sock.shutdown(socket.SHUT_RDWR)
                except OSError:pass
                return
    try:
        current();worker.repo.mark_resume_safe(row['id'],row['owner'],False)
        try:sock.connect(socket_path)
        except OSError:raise Rejected('DEPENDENCY_UNAVAILABLE','Исполнитель расчётов временно недоступен.')from None
        stream=sock.makefile('rwb')
        def send(value):stream.write((json.dumps(value,ensure_ascii=False)+'\n').encode());stream.flush()
        # Only the full document is moved to a file; question/instructions/notes
        # keep their original order. No business fields are extracted here.
        send({'messages':messages[:-1],'document':canonical_json(api_data),
              'model':worker.transport.model_source.removeprefix('model:'),
              'user_id':'alisa_p_'+hashlib.sha256(('alisa-program-tenant-v1\0'+row['tenant']).encode()).hexdigest()})
        thread=threading.Thread(target=heartbeat,daemon=True);thread.start()
        try:
            while True:
                line=stream.readline(32*1024*1024+1)
                if not line or len(line)>32*1024*1024:
                    if lost:raise lost[0]
                    raise CallError('PROGRAM_EXECUTOR_DISCONNECTED',unknown=True)
                value=json.loads(line)
                if value.get('kind')=='call':
                    request=Request('model_answer_program',worker.transport.model_source,'',{'payload':value['payload']},0,None)
                    while True:
                        current()
                        try:
                            response=worker._call(row,request)
                            break
                        except Deferred as exc:
                            # Same received 429/503, same payload and central
                            # Retry-After policy. Unknown outcomes are terminal.
                            while worker.repo.clock()<exc.until:
                                if stopped.wait(min(1,max(0,exc.until-worker.repo.clock()))):raise Rejected('CLAIM_INVALID')
                                current()
                    send({'kind':'response',**response})
                elif value.get('kind')=='complete':
                    current()
                    text=value.get('content')
                    if type(text)is not str or not text.strip():raise CallError('MODEL_ENVELOPE')
                    return {'content':text,'finish_reason':'stop'}
                elif value.get('kind')=='busy':raise Deferred(worker.repo.clock()+1)
                else:raise CallError('PROGRAM_EXECUTOR_FAILED')
        finally:
            stopped.set();stream.close();thread.join(timeout=3)
    finally:
        stopped.set();sock.close()
