"""Opt-in, dedicated RuntimePort Unix IPC. No production listener on import.
Service identity is configured from the authenticated OS peer, not request JSON.
No token issuer or mTLS implementation; remote hosts are not supported here.
"""
from __future__ import annotations
import os,socket,socketserver,struct,threading,time
from uuid import uuid4
from semantics import Rejected,strict_json,canonical_json
from runtime_port_contract import CONTRACT,PRODUCT
from runtime_port import Peer
MAX_REQUEST=262144
MAX_RESPONSE=524288
ERRORS={'AUTH_REQUIRED','PERMISSION_DENIED','NOT_FOUND','VALIDATION_FAILED',
        'IDEMPOTENCY_CONFLICT','ACCESS_REQUIRED','ACCOUNT_BLOCKED','CREDENTIAL_REVOKED',
        'CAPABILITY_UNAVAILABLE','PROVIDER_PLAN_REQUIRED','UNKNOWN_OUTCOME','RESULT_EXPIRED',
        'RESULT_NOT_READY','CATALOG_INCOMPATIBLE','DEPENDENCY_UNAVAILABLE','STORAGE_CAPACITY',
        'METRIC_AMBIGUOUS','COHORT_REQUIRED','PERIOD_REQUIRED'}


def dispatch(port,peer,value):
    if type(value)is not dict or set(value)!={'schema_version','operation','payload'}:
        raise Rejected('VALIDATION_FAILED')
    if value['schema_version']!=CONTRACT:raise Rejected('CATALOG_INCOMPATIBLE')
    op,payload=value['operation'],value['payload']
    if not isinstance(op,str) or type(payload)is not dict:raise Rejected('VALIDATION_FAILED')
    port._peer(peer)
    if op=='current_versions':
        if payload:raise Rejected('VALIDATION_FAILED')
        return port.versions_for(peer)
    if op=='submit':return port.submit(payload,peer)
    expected={'capabilities':{'context'},'status':{'job_ref','context'},
              'read_result':{'job_ref','context'},'cancel':{'job_ref','context','request_id'},
              'list_reports':{'context','cursor'},'read_report':{'context','file_id','offset'}}
    if op not in expected:raise Rejected('CAPABILITY_UNAVAILABLE')
    if set(payload)!=expected[op]:raise Rejected('VALIDATION_FAILED')
    if op=='list_reports':return port.list_reports(payload['context'],peer,payload['cursor'])
    if op=='read_report':return port.read_report(payload['file_id'],payload['offset'],payload['context'],peer)
    if op=='capabilities':return port.capabilities(payload['context'],peer)
    if op=='status':return port.status(payload['job_ref'],payload['context'],peer)
    if op=='read_result':return port.read_result(payload['job_ref'],payload['context'],peer)
    return port.cancel(payload['job_ref'],payload['context'],payload['request_id'],peer)


def error_response(code):
    safe=code if code in ERRORS else 'VALIDATION_FAILED'
    return {'ok':False,'error':{'code':safe,'message':safe,'trace_id':str(uuid4()),'retryable':False}}


class Gateway(socketserver.ThreadingUnixStreamServer):
    daemon_threads=True
    allow_reuse_address=False
    def __init__(self,path,port,*,allowed_uid,service_id,max_inflight=8):
        if type(allowed_uid)is not int or allowed_uid<0:raise ValueError('explicit uid required')
        if type(max_inflight)is not int or not 1<=max_inflight<=32:raise ValueError('bounded concurrency required')
        if not hasattr(socket,'SO_PEERCRED'):raise RuntimeError('peer credentials unavailable; no fallback')
        if service_id!=port.service_id:raise ValueError('service identity mismatch')
        if os.path.lexists(path):raise RuntimeError('existing path requires review; never unlink on startup')
        self.port=port;self.allowed_uid=allowed_uid;self.peer=Peer(service_id,PRODUCT)
        self.capacity=threading.BoundedSemaphore(max_inflight)
        super().__init__(path,Handler)
        os.chmod(path,0o660)
    def process_request(self,request,client_address):
        if not self.capacity.acquire(blocking=False):
            try:request.sendall((canonical_json(error_response('DEPENDENCY_UNAVAILABLE'))+'\n').encode())
            except OSError:pass
            finally:self.shutdown_request(request)
            return
        try:super().process_request(request,client_address)
        except BaseException:self.capacity.release();raise
    def process_request_thread(self,request,client_address):
        try:super().process_request_thread(request,client_address)
        finally:self.capacity.release()


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        self.request.settimeout(2)
        try:
            _,uid,_=struct.unpack('3i',self.request.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))
            if uid!=self.server.allowed_uid:raise Rejected('AUTH_REQUIRED')
            deadline=time.monotonic()+2
            raw=bytearray()
            while b'\n' not in raw:
                remaining=deadline-time.monotonic()
                if remaining<=0:raise TimeoutError()
                self.request.settimeout(remaining)
                chunk=self.request.recv(min(16384,MAX_REQUEST+1-len(raw)))
                if not chunk:raise Rejected('VALIDATION_FAILED')
                raw.extend(chunk)
                if len(raw)>MAX_REQUEST:raise Rejected('VALIDATION_FAILED')
            if not raw.endswith(b'\n') or raw.count(b'\n')!=1:raise Rejected('VALIDATION_FAILED')
            raw=bytes(raw)
            value=strict_json(raw)
            answer={'ok':True,'data':dispatch(self.server.port,self.server.peer,value)}
            encoded=(canonical_json(answer)+'\n').encode()
            if len(encoded)>MAX_RESPONSE:raise Rejected('CAPABILITY_UNAVAILABLE')
        except Rejected as exc:encoded=(canonical_json(error_response(exc.code))+'\n').encode()
        except Exception:encoded=(canonical_json(error_response('DEPENDENCY_UNAVAILABLE'))+'\n').encode()
        try:self.wfile.write(encoded)
        except (OSError,TimeoutError):pass # durable accept may already exist: same request ID only


def request(path,operation,payload,timeout=2):
    raw=(canonical_json({'schema_version':CONTRACT,'operation':operation,'payload':payload})+'\n').encode()
    if len(raw)>MAX_REQUEST:raise Rejected('VALIDATION_FAILED')
    try:
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as sock:
            sock.settimeout(timeout);sock.connect(path);sock.sendall(raw)
            with sock.makefile('rb') as stream:reply=stream.readline(MAX_RESPONSE+1)
    except (OSError,TimeoutError):raise Rejected('DEPENDENCY_UNAVAILABLE') from None
    if len(reply)>MAX_RESPONSE or not reply.endswith(b'\n'):raise Rejected('DEPENDENCY_UNAVAILABLE')
    result=strict_json(reply)
    if type(result)is not dict or type(result.get('ok'))is not bool:raise Rejected('DEPENDENCY_UNAVAILABLE')
    if result['ok'] and set(result)=={'ok','data'}:return result['data']
    if result['ok'] is False and set(result)=={'ok','error'} and type(result['error'])is dict:
        code=result['error'].get('code')
        if code in ERRORS:raise Rejected(code)
    raise Rejected('DEPENDENCY_UNAVAILABLE')
