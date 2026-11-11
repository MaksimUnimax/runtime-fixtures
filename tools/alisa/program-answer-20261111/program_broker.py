"""Socket-activated execution adapter. No model keys, business rules or model loop."""
import base64,fcntl,hashlib,hmac,json,os,pwd,queue,secrets,select,shutil,socket,struct,subprocess,sys,threading,time,uuid
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer

PREFIX=Path('/opt/alisa-program/releases/20261111-r1')
SDK=Path('/opt/alisa-dsh-lab/20261110-r1')
BASE=Path('/var/lib/alisa-program');PORT=33193

def unit_name(name):return 'alisa-program-run-'+name
def active(name):
    s=subprocess.run(['systemctl','show',unit_name(name),'-p','ActiveState','--value'],capture_output=True,text=True).stdout.strip()
    return s in {'active','activating','deactivating','reloading'}
def sweep():
    for p in (BASE/'jobs').iterdir():
        if len(p.name)==32 and all(c in '0123456789abcdef'for c in p.name) and time.time()-p.stat().st_mtime>3600 and not active(p.name):shutil.rmtree(p)
def write(path,value,user):
    path.write_text(value);os.chown(path,user.pw_uid,user.pw_gid);path.chmod(0o600)
def command(job,name,parent):
    return ['systemd-run','--unit='+unit_name(name),'--wait','--pipe',
      '--property=User=alisa-program','--property=RootDirectory='+str(BASE/'rootfs'),
      '--property=WorkingDirectory=/workspace',
      '--property=BindReadOnlyPaths=/usr '+str(SDK)+' '+str(PREFIX)+' '+str(job/'input.json')+':/workspace/input.json',
      '--property=BindPaths='+str(job)+':/workspace','--property=MountAPIVFS=yes','--property=PrivateDevices=yes',
      '--property=ProtectSystem=strict','--property=TemporaryFileSystem=/tmp:rw,nodev,nosuid,size=64M,mode=1777',
      '--property=ReadWritePaths=/workspace /tmp','--property=NoNewPrivileges=yes','--property=CapabilityBoundingSet=',
      '--property=RestrictSUIDSGID=yes','--property=ProtectProc=invisible','--property=RuntimeMaxSec=infinity',
      '--property=MemoryMax=1024M','--property=MemorySwapMax=0','--property=CPUQuota=100%',
      '--property=MemoryAccounting=yes','--property=TasksMax=128','--property=KillMode=control-group',
      '--property=TimeoutStopSec=5s','--property=SendSIGKILL=yes','--property=OOMPolicy=stop',
      '--property=BindsTo='+parent,'--property=After='+parent,
      '/usr/bin/env','-i','PATH=/usr/local/bin:/usr/bin:/bin','HOME=/workspace/home','DSH_HOME=/workspace/home',
      'LANG=C.UTF-8','PYTHONDONTWRITEBYTECODE=1',str(SDK/'.venv/bin/python'),str(PREFIX/'program_worker.py')]

def serve():
    os.umask(0o077)
    peer=socket.socket(fileno=0)
    _,uid,_=struct.unpack('3i',peer.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,struct.calcsize('3i')))
    if uid!=pwd.getpwnam('alice-market').pw_uid:raise PermissionError('peer')
    stream=peer.makefile('rwb')
    def send(value):stream.write((json.dumps(value,ensure_ascii=False)+'\n').encode());stream.flush()
    def receive():
        line=stream.readline(32*1024*1024+1)
        if not line or len(line)>32*1024*1024:raise ConnectionError('peer disconnected')
        return json.loads(line)
    lock=open('/run/lock/alisa-program.lock','a')
    try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:send({'kind':'busy'});return
    value=receive()
    if set(value)!={'messages','document','model','user_id'} or type(value['document'])is not str or type(value['model'])is not str:
        raise ValueError('request')
    if not isinstance(value['messages'],list) or not all(type(m)is dict and set(m)=={'role','content'} and m['role']in {'system','user'} and type(m['content'])is str for m in value['messages']):raise ValueError('messages')
    if not value['user_id'].startswith('alisa_p_') or len(value['user_id'])!=72:raise ValueError('isolation')
    user=pwd.getpwnam('alisa-program');name=uuid.uuid4().hex;job=BASE/'jobs'/name
    job.mkdir(mode=0o700);os.chown(job,user.pw_uid,user.pw_gid)
    pending=queue.Queue();shutdown=threading.Event();token=secrets.token_hex(32)
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_POST(self):
            if self.path!='/v1/messages' or not hmac.compare_digest(self.headers.get('x-api-key',''),token):
                self.send_error(403);return
            try:
                n=int(self.headers['Content-Length'])
                if not 0<n<=12_000_000:raise ValueError('size')
                payload=json.loads(self.rfile.read(n));payload.pop('max_tokens',None)
                payload['metadata']={**payload.get('metadata',{}),'user_id':value['user_id']}
                done=threading.Event();answer={};pending.put((payload,done,answer))
                while not done.wait(.1):
                    if shutdown.is_set():raise ConnectionError('stopped')
                raw=base64.b64decode(answer['body'],validate=True)
                self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
            except Exception:
                try:self.send_error(502)
                except OSError:pass
    gateway=ThreadingHTTPServer(('127.0.0.1',PORT),Handler);gateway.daemon_threads=True
    threading.Thread(target=gateway.serve_forever,daemon=True).start();process=None
    try:
        write(job/'input.json',value['document'],user);write(job/'local-transport-token',token,user)
        system='\n\n'.join(m['content']for m in value['messages']if m['role']=='system')
        prompt='\n\n'.join(m['content']for m in value['messages']if m['role']=='user')
        prompt+='\nПолные исходные данные API и примечания выбранного шаблона находятся в /workspace/input.json. Используй run_code для чтения полного файла и необходимых вычислений. Ответь на исходный вопрос по полученным данным.'
        write(job/'request.json',json.dumps({'session_id':name,'model':value['model'],'system_prompt':system,'prompt':prompt},ensure_ascii=False),user)
        parent=os.environ['PROGRAM_PARENT_UNIT']
        if not parent.startswith('alisa-program@') or not parent.endswith('.service') or '/'in parent:raise ValueError('unit')
        process=subprocess.Popen(command(job,name,parent),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        while process.poll()is None or not pending.empty():
            try:payload,done,answer=pending.get(timeout=.1)
            except queue.Empty:
                if select.select([peer],[],[],0)[0] and not peer.recv(1,socket.MSG_PEEK):raise ConnectionError('peer closed')
                continue
            send({'kind':'call','payload':payload});response=receive()
            if response.get('kind')!='response':raise ConnectionError('aborted')
            answer.update(response);done.set()
        if process.returncode!=0:raise RuntimeError('executor failed')
        result=json.loads((job/'result.private.json').read_text())
        if result.get('finish_reason')not in {'completed','stop',None} or not result.get('final_response','').strip():raise RuntimeError('incomplete')
    finally:
        shutdown.set();gateway.shutdown();gateway.server_close()
        if active(name):subprocess.run(['systemctl','stop',unit_name(name)],check=True)
        if process is not None:process.wait()
        if not active(name):shutil.rmtree(job)
    send({'kind':'complete','content':result['final_response']})

if __name__=='__main__':
    if sys.argv[1:]==['--sweep']:sweep()
    else:
        try:serve()
        except Exception as exc:
            print(json.dumps({'kind':'error','code':'PROGRAM_EXECUTOR_FAILED'}),flush=True)
            print('PROGRAM_EXECUTOR_'+type(exc).__name__,file=sys.stderr)
            raise SystemExit(1)
