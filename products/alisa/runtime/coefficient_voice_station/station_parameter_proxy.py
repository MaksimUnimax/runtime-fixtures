"""Native read-only proof proxy on the EXISTING RuntimePort peer boundary.

No owner database, coefficient write, runtime submit or external endpoint here.
The platform retains its existing peer; native retains the existing Station uid.
"""
from pathlib import Path
import os,pwd,re,socket,stat,struct,time
from semantics import Rejected,strict_json,canonical_json
PATH='/run/alisa-station/authorization.sock'


def proof(port,peer,payload):
    port._peer(peer)
    if type(payload)is not dict or set(payload)!={'guard','turn_hash'}:
        raise Rejected('VALIDATION_FAILED')
    if type(payload['guard'])is not dict or type(payload['turn_hash'])is not str or re.fullmatch('[a-f0-9]{64}',payload['turn_hash'])is None:
        raise Rejected('VALIDATION_FAILED')
    request=(canonical_json({'op':'parameter_current',**payload})+'\n').encode()
    if len(request)>4000:raise Rejected('VALIDATION_FAILED')
    try:
        uid=pwd.getpwnam('alice-lab').pw_uid
        path=Path(PATH);a=path.lstat();parent=path.parent.lstat()
        if not(stat.S_ISSOCK(a.st_mode) and a.st_uid==uid and not a.st_mode&0o002
               and stat.S_ISDIR(parent.st_mode) and parent.st_uid in (0,uid) and not parent.st_mode&0o022):
            raise Rejected('AUTH_REQUIRED')
        deadline=time.monotonic()+.6
        def remaining():
            left=deadline-time.monotonic()
            if left<=0:raise TimeoutError()
            return left
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as stream:
            stream.settimeout(remaining());stream.connect(str(path))
            if struct.unpack('3i',stream.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))[1]!=uid:
                raise Rejected('AUTH_REQUIRED')
            stream.settimeout(remaining());stream.sendall(request);raw=bytearray()
            while not raw.endswith(b'\n'):
                stream.settimeout(remaining());part=stream.recv(min(4096,8193-len(raw)))
                if not part or len(raw)+len(part)>8192:raise ValueError()
                raw.extend(part)
            remaining()
        value=strict_json(bytes(raw));fields={'schema','allowed','owner','native_tenant','binding','permission_revision','grant','conversation','message_id','turn_hash'}
        if (type(value)is not dict or set(value)!=fields or value['schema']!='alisa-station-parameter-authority/v1'
            or value['allowed'] is not True or value['turn_hash']!=payload['turn_hash']):
            raise Rejected('PERMISSION_DENIED')
        after=path.lstat()
        if (a.st_dev,a.st_ino,a.st_uid,a.st_mode)!=(after.st_dev,after.st_ino,after.st_uid,after.st_mode):
            raise Rejected('AUTH_REQUIRED')
        return value
    except Rejected:raise
    except (OSError,ValueError,KeyError,TimeoutError,struct.error):raise Rejected('DEPENDENCY_UNAVAILABLE')from None
