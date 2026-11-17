"""Read-only program protocol4 over the EXISTING broker peer boundary.

No listener, key, chmod, process or default endpoint. The broker's native peer
check remains before dispatch. Native callers must independently obtain and
revalidate current staff/operation/progress authority; OS identity is not staff
identity. This protocol observes PROGRAM records, never proves a whole report.
"""
from dataclasses import asdict, fields
from hashlib import sha256
import math
import os
from pathlib import Path
import secrets
import socket
import stat
import struct
import time

from . import program_evidence as evidence

BROKER_SHA256='70f50e3345c2408e039dd7811ecf1282f8b606990d2ec96e931291708ac41423'
PROTOCOL=4
MAX_REQUEST=4096
MAX_RESPONSE=16384
CODES=evidence.CODES|frozenset({'PROBE_INVALID','PROBE_UNAVAILABLE','PROBE_TIMEOUT',
    'PROBE_PEER_REJECTED','PROBE_REPLY_MISMATCH','PROBE_PRODUCER_MISMATCH'})
OBSERVATION_FIELDS=frozenset({'schema','reference_sha256','operation_sha256','status','scope',
    'observed_at','recorded_at','primary_sha256','content_sha256','content_verified',
    'program_completion_recorded','whole_job_outcome','not_retained_means_not_executed',
    'payload_returned','native_state_changed','replay_permitted'})


class ProbeUnavailable(Exception):
    def __init__(self,code='PROBE_UNAVAILABLE'):
        self.code=code if code in CODES else 'PROBE_UNAVAILABLE'
        super().__init__(self.code)


def need(value,code='PROBE_INVALID'):
    if not value:raise ProbeUnavailable(code)


class Budget:
    def __init__(self,seconds):
        need(type(seconds) in (int,float) and math.isfinite(seconds) and .05<=seconds<=2)
        self.end=time.monotonic()+seconds

    def remaining(self):
        left=self.end-time.monotonic()
        need(left>0,'PROBE_TIMEOUT')
        return left


def producer_pin():
    # Compatibility only; authenticity is the existing protected peer channel.
    return sha256(evidence.encoded({p.name:sha256(p.read_bytes()).hexdigest()
                                   for p in (Path(__file__),Path(evidence.__file__))})).hexdigest()


def peer(stream,uid):
    need(type(uid) is int and uid>=0 and stream.family==socket.AF_UNIX
         and hasattr(socket,'SO_PEERCRED'),'PROBE_PEER_REJECTED')
    pid,actual,_=struct.unpack('3i',stream.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))
    need(pid>0 and actual==uid,'PROBE_PEER_REJECTED')


def serve_request(stream,value,send,*,root,owner_uid,native_uid,timeout=1.,clock=time.time):
    """Called AFTER original broker receive/peer check, before Results or lock.

    Rechecks the OS peer. Uses only configured producer storage, not a path or
    reader from request JSON. Errors close safely; no recovery/ACK/work queue.
    The caller retains the broker's existing bounded line receive.
    """
    budget=Budget(timeout);nonce=reference=None
    try:
        peer(stream,native_uid)
        need(type(value) is dict and set(value)=={'protocol','request_id','binding'})
        need(type(value['protocol']) is int and value['protocol']==PROTOCOL)
        need(len(evidence.encoded(value))<=MAX_REQUEST)
        candidate_nonce=value['request_id'];need(evidence.hash_shape(candidate_nonce))
        nonce=candidate_nonce
        b=value['binding'];need(type(b) is dict and set(b)=={f.name for f in fields(evidence.ProgramBinding)})
        binding=evidence.ProgramBinding(**b).validate();reference=binding.digest
        remaining=budget.remaining();need(remaining>=.05,'PROBE_TIMEOUT')
        observation=evidence.observe(root,binding,owner_uid=owner_uid,
                                     timeout=min(remaining,1.),clock=clock)
        budget.remaining()
        result={'protocol':PROTOCOL,'request_id':nonce,'reference_sha256':reference,
                'producer_sha256':producer_pin(),'ok':True,'observation':observation}
        need(len(evidence.encoded(result))<=MAX_RESPONSE)
        stream.settimeout(budget.remaining());send(result)
        return 'SENT'
    except Exception as error:
        code=error.code if isinstance(error,(ProbeUnavailable,evidence.EvidenceUnavailable)) else (
             'PROBE_TIMEOUT' if isinstance(error,(TimeoutError,socket.timeout)) else 'PROBE_UNAVAILABLE')
        try:
            stream.settimeout(budget.remaining())
            send({'protocol':PROTOCOL,'request_id':nonce,'reference_sha256':reference,'ok':False,'code':code})
        except Exception:pass
        return code


def validate_observation(value,binding,now):
    need(type(value) is dict and set(value)==OBSERVATION_FIELDS,'PROBE_REPLY_MISMATCH')
    need(value['schema']==evidence.SCHEMA and value['reference_sha256']==binding.digest
         and value['operation_sha256']==binding.operation_sha256 and value['scope']=='PROGRAM',
         'PROBE_REPLY_MISMATCH')
    state=value['status'];need(type(state) is str and state in {
        'COMPLETE','ACKNOWLEDGED','INCOMPLETE','NOT_RETAINED','EXPIRED'},'PROBE_REPLY_MISMATCH')
    observed=evidence.stamp(value['observed_at']);need(binding.started_at<=observed<=now
         and now-observed<=2,'PROBE_REPLY_MISMATCH')
    need(value['whole_job_outcome']=='UNPROVEN' and value['not_retained_means_not_executed'] is False
         and value['payload_returned'] is False and value['native_state_changed'] is False
         and value['replay_permitted'] is False,'PROBE_REPLY_MISMATCH')
    need(type(value['content_verified']) is bool and type(value['program_completion_recorded']) is bool
         and value['content_verified']==(state=='COMPLETE')
         and value['program_completion_recorded']==(state in {'COMPLETE','ACKNOWLEDGED'}),'PROBE_REPLY_MISMATCH')
    if state=='NOT_RETAINED':
        need(all(value[k] is None for k in ('recorded_at','primary_sha256','content_sha256')),'PROBE_REPLY_MISMATCH')
    else:
        recorded=evidence.stamp(value['recorded_at'])
        need(binding.started_at<=recorded<=observed and evidence.hash_shape(value['primary_sha256']),
             'PROBE_REPLY_MISMATCH')
        if state in {'COMPLETE','ACKNOWLEDGED'}:
            need(evidence.hash_shape(value['content_sha256']) and now-recorded<=evidence.TTL,
                 'PROBE_REPLY_MISMATCH')
        else:need(value['content_sha256'] is None,'PROBE_REPLY_MISMATCH')
        if state=='EXPIRED':need(observed-recorded>evidence.TTL,'PROBE_REPLY_MISMATCH')
    return value


def endpoint(path,uid):
    need(type(path) is str and Path(path).is_absolute() and '..' not in Path(path).parts,
         'PROBE_PEER_REJECTED')
    p=Path(path);need(p.resolve(strict=True)==p,'PROBE_PEER_REJECTED')
    s=p.lstat();parent=p.parent.lstat()
    need(stat.S_ISSOCK(s.st_mode) and s.st_uid==uid and not s.st_mode&0o077
         and stat.S_ISDIR(parent.st_mode) and parent.st_uid in {0,uid} and not parent.st_mode&0o022,
         'PROBE_PEER_REJECTED')
    return tuple((v.st_dev,v.st_ino,v.st_uid,v.st_gid,stat.S_IMODE(v.st_mode)) for v in (s,parent))


class Client:
    def __init__(self,path,*,socket_owner_uid,peer_uid,expected_producer,timeout=1.):
        need(type(socket_owner_uid) is int and socket_owner_uid>=0
             and type(peer_uid) is int and peer_uid>=0,'PROBE_PEER_REJECTED')
        need(evidence.hash_shape(expected_producer));Budget(timeout)
        self.path,self.socket_uid,self.peer_uid,self.pin,self.timeout=path,socket_owner_uid,peer_uid,expected_producer,timeout

    def __repr__(self):return '<ProgramProbeClient; configured peer, no staff authority>'

    def observe(self,binding,*,clock=time.time):
        need(type(binding) is evidence.ProgramBinding);binding.validate()
        budget=Budget(self.timeout);nonce=secrets.token_hex(32)
        try:
            identity=endpoint(self.path,self.socket_uid)
            raw=evidence.encoded({'protocol':PROTOCOL,'request_id':nonce,'binding':asdict(binding)})+b'\n'
            need(len(raw)<=MAX_REQUEST)
            with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as stream:
                stream.settimeout(budget.remaining());stream.connect(self.path)
                peer(stream,self.peer_uid)
                need(endpoint(self.path,self.socket_uid)==identity,'PROBE_PEER_REJECTED')
                stream.settimeout(budget.remaining());stream.sendall(raw)
                # This is not ACK. No subsequent message or reconnection exists.
                stream.shutdown(socket.SHUT_WR)
                data=bytearray()
                while True:
                    stream.settimeout(budget.remaining())
                    part=stream.recv(min(4096,MAX_RESPONSE+1-len(data)))
                    if not part:break
                    data.extend(part);need(len(data)<=MAX_RESPONSE,'PROBE_REPLY_MISMATCH')
                budget.remaining()
            need(endpoint(self.path,self.socket_uid)==identity,'PROBE_PEER_REJECTED')
            need(data.endswith(b'\n') and data.count(b'\n')==1,'PROBE_REPLY_MISMATCH')
            value=evidence._decode(bytes(data))
            need(type(value.get('protocol')) is int and value['protocol']==PROTOCOL
                 and value.get('request_id')==nonce and value.get('reference_sha256')==binding.digest
                 and type(value.get('ok')) is bool,'PROBE_REPLY_MISMATCH')
            if not value['ok']:
                need(set(value)=={'protocol','request_id','reference_sha256','ok','code'}
                     and type(value['code']) is str and value['code'] in CODES,'PROBE_REPLY_MISMATCH')
                raise ProbeUnavailable(value['code'])
            need(set(value)=={'protocol','request_id','reference_sha256','producer_sha256','ok','observation'},
                 'PROBE_REPLY_MISMATCH')
            need(value['producer_sha256']==self.pin,'PROBE_PRODUCER_MISMATCH')
            result=validate_observation(value['observation'],binding,evidence.stamp(clock()))
            budget.remaining();return result
        except ProbeUnavailable:raise
        except evidence.EvidenceUnavailable as error:raise ProbeUnavailable(error.code) from None
        except (TimeoutError,socket.timeout):raise ProbeUnavailable('PROBE_TIMEOUT') from None
        except Exception:raise ProbeUnavailable('PROBE_UNAVAILABLE') from None


def broker_source(source):
    """Exact opt-in in-memory hook; original peer check remains BEFORE it.

    This does not install or modify the accepted broker file. A separately
    qualified package must include this module, program_evidence and imports.
    Existing protocols2/3 continue into exactly their prior implementation.
    """
    anchor="    if type(value)is not dict:raise ValueError('protocol')\n"
    need(type(source) is str and sha256(source.encode()).hexdigest()==BROKER_SHA256
         and source.count(anchor)==1)
    hook=(anchor+"    if value.get('protocol') == 4:\n"
          "        from reconciliation.program_probe import serve_request\n"
          "        return serve_request(peer,value,send,root=BASE/'results',owner_uid=os.geteuid(),\n"
          "                             native_uid=pwd.getpwnam('alice-market').pw_uid)\n")
    result=source.replace(anchor,hook);compile(result,'program_broker.py','exec');return result
