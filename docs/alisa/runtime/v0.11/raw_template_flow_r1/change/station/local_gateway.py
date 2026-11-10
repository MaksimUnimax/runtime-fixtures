"""Private IPC client for the web ingress. Business logic runs in the core service."""
import json
import socket

MAX_MESSAGE=16000

def request(path,tenant,command,request_id,body_hash,timeout=1.5,*,conversation_id=None,message_id=None):
    value={'tenant':tenant,'command':command,'request_id':request_id,'body_hash':body_hash}
    if conversation_id is not None or message_id is not None:
        value.update(conversation_id=conversation_id,message_id=message_id)
    payload=json.dumps(value,ensure_ascii=False,allow_nan=False,sort_keys=True,separators=(',',':')).encode()+b'\n'
    if len(payload)>MAX_MESSAGE:raise ValueError('IPC_SIZE')
    with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as s:
        s.settimeout(timeout);s.connect(path);s.sendall(payload)
        chunks=[];length=0
        while True:
            data=s.recv(4096)
            if not data:break
            length+=len(data)
            if length>MAX_MESSAGE:raise ValueError('IPC_RESPONSE_SIZE')
            chunks.append(data)
            if data.endswith(b'\n'):break
    def pairs(items):
        result={}
        for key,value in items:
            if key in result:raise ValueError('IPC_RESPONSE_DUPLICATE')
            result[key]=value
        return result
    def invalid(value):raise ValueError('IPC_RESPONSE_NUMBER')
    result=json.loads(b''.join(chunks),object_pairs_hook=pairs,parse_constant=invalid)
    if (not isinstance(result,dict) or not isinstance(result.get('text'),str)
        or not isinstance(result.get('tts'),str) or len(result['text'])>900 or len(result['tts'])>900):
        raise ValueError('IPC_RESPONSE_SCHEMA')
    return result
