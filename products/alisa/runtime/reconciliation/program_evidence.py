"""Observe the existing program outbox without recovery, ACK, mkdir or sweep.

This is PROGRAM-scoped corroboration, never proof that a whole native report
finished. ACK may follow a durable stale-generation discard. Caller must first
resolve/authorize current native state, then recheck it after observation; a
ProgramBinding is data, not a staff capability. No live path/default listener,
secret, permissive verifier or new producer format is supplied here.
"""
from dataclasses import dataclass, asdict
from hashlib import sha256
import json
import math
import os
from pathlib import Path
import re
import stat
import time

SCHEMA = 'alisa-retained-program-observation/v1'
TTL = 3600  # Existing program_results TTL; not a new retention policy.
MAX_FILE_BYTES = 4 * 1024 * 1024
CODES = frozenset({'PROGRAM_BINDING_UNAVAILABLE','PROGRAM_BINDING_MISMATCH',
    'PROGRAM_STORE_UNAVAILABLE','PROGRAM_STORE_IDENTITY','PROGRAM_RECORD_INVALID',
    'PROGRAM_RECORD_TOO_LARGE','PROGRAM_RECORD_CHANGED','PROGRAM_OBSERVATION_TIMEOUT',
    'PROGRAM_CLOCK_INVALID'})


class EvidenceUnavailable(Exception):
    def __init__(self, code='PROGRAM_STORE_UNAVAILABLE'):
        self.code = code if code in CODES else 'PROGRAM_STORE_UNAVAILABLE'
        super().__init__(self.code)


def need(condition, code='PROGRAM_RECORD_INVALID'):
    if not condition:
        raise EvidenceUnavailable(code)


def stamp(value):
    need(type(value) in (int,float) and math.isfinite(value) and 0 <= value <= 253402300799,
         'PROGRAM_CLOCK_INVALID')
    return value


def hash_shape(value):
    return type(value) is str and re.fullmatch('[a-f0-9]{64}',value) is not None


def encoded(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True,
                      allow_nan=False).encode('ascii')


@dataclass(frozen=True, repr=False)
class ProgramBinding:
    operation_sha256: str
    job_id: str
    fingerprint: str
    started_at: int | float

    def __repr__(self):
        return '<ProgramBinding; private server-resolved reference, not authority>'

    def validate(self):
        need(all(hash_shape(v) for v in (self.operation_sha256,self.job_id,self.fingerprint)),
             'PROGRAM_BINDING_UNAVAILABLE')
        stamp(self.started_at)
        return self

    @property
    def digest(self):
        self.validate()
        return sha256(encoded(asdict(self))).hexdigest()


def from_progress(operation_sha256, native_tenant, native_job_id, progress, *, created_at, observed_at):
    """Project authenticated native progress; no DB read or guessed legacy key.

    The caller must obtain these values from the SAME authorized native row.
    Hashing a browser-supplied progress dictionary does not satisfy that rule.
    Only the original saved fingerprint is accepted, never today's inputs.
    """
    try:
        need(hash_shape(operation_sha256), 'PROGRAM_BINDING_UNAVAILABLE')
        need(type(native_tenant) is str and 1 <= len(native_tenant) <= 128
             and all(32 <= ord(c) <= 126 for c in native_tenant), 'PROGRAM_BINDING_UNAVAILABLE')
        need(type(native_job_id) is str and re.fullmatch('[a-f0-9]{32}',native_job_id),
             'PROGRAM_BINDING_UNAVAILABLE')
        need(type(progress) is dict and progress.get('_program_started') is True,
             'PROGRAM_BINDING_UNAVAILABLE')
        saved = progress.get('_program_request_binding')
        need(type(saved) is dict and set(saved)=={'job_id','fingerprint'}
             and hash_shape(saved['job_id']) and hash_shape(saved['fingerprint']),
             'PROGRAM_BINDING_UNAVAILABLE')
        generation = progress.get('_compound_answer_generation')
        if generation is not None:
            need(hash_shape(generation), 'PROGRAM_BINDING_UNAVAILABLE')
        else:
            need('_compound_answer_generation' not in progress
                 and '_compound_answer_fences' not in progress, 'PROGRAM_BINDING_UNAVAILABLE')
        suffix = '' if generation is None else '\0parameter-revision:'+generation
        key = sha256((native_tenant+'\0'+native_job_id+suffix).encode()).hexdigest()
        need(key==saved['job_id'], 'PROGRAM_BINDING_MISMATCH')
        started = stamp(progress.get('_program_started_at'))
        need(stamp(created_at) <= started <= stamp(observed_at), 'PROGRAM_BINDING_MISMATCH')
        return ProgramBinding(operation_sha256,key,saved['fingerprint'],started).validate()
    except EvidenceUnavailable:
        raise
    except (ValueError,TypeError,KeyError,UnicodeError):
        raise EvidenceUnavailable('PROGRAM_BINDING_UNAVAILABLE') from None


def _directory(st, owner_uid, *, leaf=False):
    need(stat.S_ISDIR(st.st_mode) and st.st_uid in ({owner_uid} if leaf else {0,owner_uid})
         and not st.st_mode & (0o077 if leaf else 0o022), 'PROGRAM_STORE_IDENTITY')
    return st.st_dev,st.st_ino,st.st_uid,st.st_gid,stat.S_IMODE(st.st_mode)


def _file(st, owner_uid):
    need(stat.S_ISREG(st.st_mode) and st.st_uid==owner_uid and st.st_nlink==1
         and not st.st_mode & 0o077, 'PROGRAM_STORE_IDENTITY')
    need(0 < st.st_size <= MAX_FILE_BYTES, 'PROGRAM_RECORD_TOO_LARGE')
    return (st.st_dev,st.st_ino,st.st_uid,st.st_gid,st.st_mode,st.st_nlink,
            st.st_size,st.st_mtime_ns,st.st_ctime_ns)


def _stable_file(fd, directory_fd, name, owner_uid, identity):
    # A record valid on first open that is replaced/unlinked/chmodded while
    # being observed is a CHANGED source, not a different initial permission.
    try:
        same=(_file(os.fstat(fd),owner_uid)==identity and
              _file(os.stat(name,dir_fd=directory_fd,follow_symlinks=False),owner_uid)==identity)
    except (EvidenceUnavailable,OSError):
        raise EvidenceUnavailable('PROGRAM_RECORD_CHANGED') from None
    need(same,'PROGRAM_RECORD_CHANGED')


def _decode(raw):
    def pairs(items):
        value={}
        for key,item in items:
            need(key not in value)
            value[key]=item
        return value
    def invalid(_):
        raise EvidenceUnavailable('PROGRAM_RECORD_INVALID')
    value=json.loads(raw.decode('utf-8'),object_pairs_hook=pairs,parse_constant=invalid)
    need(type(value) is dict)
    return value


def _projection(raw, binding, observed):
    state='NOT_RETAINED';at=None;primary=None;content=None;verified=False
    if raw is not None:
        value=_decode(raw)
        state=value.get('state')
        fields={'started':{'state','fingerprint','at','workspace'},
                'complete':{'state','fingerprint','at','content','digest'},
                'acknowledged':{'state','fingerprint','at','digest'}}
        need(type(state) is str and state in fields and set(value)==fields[state])
        need(hash_shape(value['fingerprint']) and value['fingerprint']==binding.fingerprint,
             'PROGRAM_BINDING_MISMATCH')
        at=stamp(value['at'])
        need(binding.started_at <= at <= observed,'PROGRAM_BINDING_MISMATCH')
        if state=='started':
            workspace=value['workspace']
            need(workspace is None or type(workspace) is str and re.fullmatch('[a-f0-9]{32}',workspace))
        else:
            need(hash_shape(value['digest']))
            content=value['digest']
            if state=='complete':
                text=value['content']
                need(type(text) is str and bool(text.strip()))
                need(sha256(text.encode('utf-8')).hexdigest()==content)
                verified=True
        primary=sha256(raw).hexdigest()
        if state!='started' and observed-at>TTL:
            state='EXPIRED';content=None;verified=False
        else:
            state={'started':'INCOMPLETE','complete':'COMPLETE','acknowledged':'ACKNOWLEDGED'}[state]
    return {'schema':SCHEMA,'reference_sha256':binding.digest,'operation_sha256':binding.operation_sha256,
            'status':state,'scope':'PROGRAM','observed_at':observed,'recorded_at':at,
            'primary_sha256':primary,'content_sha256':content,'content_verified':verified,
            'program_completion_recorded':state in {'COMPLETE','ACKNOWLEDGED'},
            'whole_job_outcome':'UNPROVEN','not_retained_means_not_executed':False,
            'payload_returned':False,'native_state_changed':False,'replay_permitted':False}


def observe(root, binding, *, owner_uid, timeout=.25, clock=time.time, monotonic=time.monotonic):
    """Read one exact private record, no sockets/executors/writes or retries.

    Missing file in a verified existing store is NOT_RETAINED (never a claim of
    non-execution). Missing store, denial, corruption or changed identity raises.
    File reads are bounded before allocation; this does not modify SQLite's
    separately qualified reader or its outstanding allocation-limit issue.
    The time budget detects elapsed time but cannot interrupt kernel I/O stalls.
    """
    need(type(binding) is ProgramBinding,'PROGRAM_BINDING_UNAVAILABLE');binding.validate()
    need(type(owner_uid) is int and owner_uid>=0,'PROGRAM_STORE_IDENTITY')
    need(type(timeout) in (int,float) and math.isfinite(timeout) and .05<=timeout<=1,
         'PROGRAM_OBSERVATION_TIMEOUT')
    need(isinstance(root,(str,Path)),'PROGRAM_STORE_IDENTITY')
    root=Path(root);need(root.is_absolute() and '..' not in root.parts,'PROGRAM_STORE_IDENTITY')
    deadline=monotonic()+timeout;directory_fd=file_fd=None
    def check():need(monotonic()<deadline,'PROGRAM_OBSERVATION_TIMEOUT')
    try:
        need(root.resolve(strict=True)==root,'PROGRAM_STORE_IDENTITY')
        parent=_directory(root.parent.lstat(),owner_uid)
        directory=_directory(root.lstat(),owner_uid,leaf=True)
        directory_fd=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NONBLOCK)
        need(_directory(os.fstat(directory_fd),owner_uid,leaf=True)==directory,'PROGRAM_RECORD_CHANGED')
        before=stamp(clock());need(binding.started_at<=before,'PROGRAM_BINDING_MISMATCH');check()
        name=binding.job_id+'.json'
        missing=False;raw=None
        try:
            file_fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=directory_fd)
        except FileNotFoundError:
            missing=True
        if not missing:
            identity=_file(os.fstat(file_fd),owner_uid);size=identity[6]
            data=bytearray()
            while len(data)<=size:
                check();part=os.read(file_fd,min(65536,size+1-len(data)))
                if not part:break
                data.extend(part)
            need(len(data)==size,'PROGRAM_RECORD_CHANGED')
            _stable_file(file_fd,directory_fd,name,owner_uid,identity)
            raw=bytes(data)
        else:
            try:os.stat(name,dir_fd=directory_fd,follow_symlinks=False)
            except FileNotFoundError:pass
            else:raise EvidenceUnavailable('PROGRAM_RECORD_CHANGED')
        after=stamp(clock());need(after>=before,'PROGRAM_CLOCK_INVALID');check()
        result=_projection(raw,binding,after)
        check();final=stamp(clock());need(final>=after,'PROGRAM_CLOCK_INVALID')
        # Parsing/hash work can cross the existing retention boundary.
        if result['status'] in {'COMPLETE','ACKNOWLEDGED'} and final-result['recorded_at']>TTL:
            result.update(status='EXPIRED',content_sha256=None,content_verified=False,
                          program_completion_recorded=False)
        result['observed_at']=final
        if file_fd is not None:
            _stable_file(file_fd,directory_fd,name,owner_uid,identity)
        else:
            try:os.stat(name,dir_fd=directory_fd,follow_symlinks=False)
            except FileNotFoundError:pass
            else:raise EvidenceUnavailable('PROGRAM_RECORD_CHANGED')
        need(_directory(root.lstat(),owner_uid,leaf=True)==directory
             and _directory(root.parent.lstat(),owner_uid)==parent,'PROGRAM_RECORD_CHANGED')
        return result
    except EvidenceUnavailable:
        raise
    except (OSError,ValueError,TypeError,UnicodeError,RecursionError,OverflowError):
        raise EvidenceUnavailable('PROGRAM_STORE_UNAVAILABLE') from None
    finally:
        if file_fd is not None:os.close(file_fd)
        if directory_fd is not None:os.close(directory_fd)
