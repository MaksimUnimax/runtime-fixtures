"""Local IPC boundary: authenticated web user -> private queue/worker service.
Only the worker service owns marketplace credentials and report storage.
"""
from __future__ import annotations
import json
import os
import socket
import socketserver
import struct
from datetime import datetime
from zoneinfo import ZoneInfo
from semantics import Rejected, strict_json, canonical_json

MAX_MESSAGE=16000

class Gateway(socketserver.ThreadingUnixStreamServer):
    daemon_threads=True
    allow_reuse_address=False
    def __init__(self,path,engine,allowed_uid,allow_test_peer=False):
        if os.path.exists(path):
            raise RuntimeError('Existing socket requires explicit stale-socket review')
        self.engine,self.allowed_uid,self.allow_test_peer=engine,allowed_uid,allow_test_peer
        super().__init__(path,Handler)
        os.chmod(path,0o660)

class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        self.request.settimeout(1.5)
        try:
            if hasattr(socket,'SO_PEERCRED'):
                _,uid,_=struct.unpack('3i',self.request.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))
                if uid!=self.server.allowed_uid:
                    raise Rejected('IPC_PEER_DENIED')
            elif not self.server.allow_test_peer:
                raise Rejected('IPC_PEER_NOT_VERIFIABLE')
            raw=self.rfile.readline(MAX_MESSAGE+1)
            if len(raw)>MAX_MESSAGE or not raw.endswith(b'\n'):
                raise Rejected('IPC_SIZE')
            value=strict_json(raw)
            if (not isinstance(value,dict) or set(value)!={'tenant','command','request_id','body_hash'}
                or not all(isinstance(value[k],str) for k in value)
                or not value['tenant'] or len(value['tenant'])>128):
                raise Rejected('IPC_SCHEMA')
            today=datetime.now(ZoneInfo('Europe/Moscow')).date()
            result=self.server.engine.safe_submit(value['tenant'],value['command'],value['request_id'],value['body_hash'],today)
        except Rejected as exc:
            result={'text':exc.message,'tts':exc.message,'error':exc.code}
        except Exception:
            result={'text':'Сервис отчетов временно недоступен.','tts':'Сервис отчетов временно недоступен.','error':'IPC_UNAVAILABLE'}
        try:
            self.wfile.write((canonical_json(result)+'\n').encode())
        except (OSError,TimeoutError):
            # The caller retries using the same request ID; no duplicated report.
            pass

def request(path,tenant,command,request_id,body_hash,timeout=1.5):
    payload=canonical_json({'tenant':tenant,'command':command,'request_id':request_id,'body_hash':body_hash}).encode()+b'\n'
    if len(payload)>MAX_MESSAGE:raise Rejected('IPC_SIZE')
    with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as s:
        s.settimeout(timeout);s.connect(path);s.sendall(payload)
        chunks=[];length=0
        while True:
            data=s.recv(4096)
            if not data:break
            length+=len(data)
            if length>MAX_MESSAGE:raise Rejected('IPC_RESPONSE_SIZE')
            chunks.append(data)
            if data.endswith(b'\n'):break
    result=strict_json(b''.join(chunks))
    if (not isinstance(result,dict) or not isinstance(result.get('text'),str)
        or not isinstance(result.get('tts'),str) or len(result['text'])>900 or len(result['tts'])>900):
        raise Rejected('IPC_RESPONSE_SCHEMA')
    return result
