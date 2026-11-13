"""Bounded RT-JOB-R01.1 client. No listener, issuer, database or implicit retry.

The caller supplies a trusted platform authorizer, never browser-provided claims.
Runtime independently verifies its ticket and rechecks current rights on dispatch.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime
import json
import base64
import hashlib
import math
import os
from pathlib import Path
import re
import socket
import stat
import struct
import time
from typing import Protocol
from uuid import UUID

CONTRACT = 'runtime_port_v1'
TASK_SHA256 = '08b4b6c708c5ae1d5387dbd593fde7ea40c9f671efdad8b9aacbcab9bd683d34'
MAX_REQUEST, MAX_RESPONSE = 262144, 524288
VERSION_FIELDS = {'runtime_contract_version', 'task_schema_version', 'task_schema_sha256',
                  'registry_hash', 'catalog_bundle_hash', 'query_language', 'projection',
                  'port_build', 'catalog_release_id'}
CONTEXT_FIELDS = {'tenant_id', 'actor_id', 'store_scope', 'security_revision', 'access_revision',
                  'business_timezone', 'execution_ticket', 'not_after', 'catalog_release_id',
                  'runtime_contract_version'}
ERRORS = {'AUTH_REQUIRED', 'PERMISSION_DENIED', 'NOT_FOUND', 'VALIDATION_FAILED',
          'IDEMPOTENCY_CONFLICT', 'ACCESS_REQUIRED', 'ACCOUNT_BLOCKED', 'CREDENTIAL_REVOKED',
          'CAPABILITY_UNAVAILABLE', 'PROVIDER_PLAN_REQUIRED', 'UNKNOWN_OUTCOME', 'RESULT_EXPIRED',
          'RESULT_NOT_READY', 'CATALOG_INCOMPATIBLE', 'DEPENDENCY_UNAVAILABLE', 'STORAGE_CAPACITY',
          'METRIC_AMBIGUOUS', 'COHORT_REQUIRED', 'PERIOD_REQUIRED'}
STATES = {'QUEUED', 'RUNNING', 'READY', 'NEEDS_INPUT', 'FAILED', 'CANCELLED', 'UNKNOWN', 'EXPIRED', 'ALIASED'}


class RuntimeFailure(Exception):
    """Safe error only. UNKNOWN must retain the original mutation request ID."""
    retryable = False

    def __init__(self, code='DEPENDENCY_UNAVAILABLE', *, outcome='NOT_SENT'):
        self.code = code if code in ERRORS else 'DEPENDENCY_UNAVAILABLE'
        self.outcome = outcome
        self.http_status = {'AUTH_REQUIRED': 401, 'PERMISSION_DENIED': 403, 'ACCESS_REQUIRED': 403,
            'ACCOUNT_BLOCKED': 403, 'CREDENTIAL_REVOKED': 403, 'NOT_FOUND': 404,
            'IDEMPOTENCY_CONFLICT': 409, 'RESULT_EXPIRED': 410, 'RESULT_NOT_READY': 409,
            'VALIDATION_FAILED': 422, 'CAPABILITY_UNAVAILABLE': 422}.get(self.code, 503)
        super().__init__(self.code)


class Authorizer(Protocol):
    def prepare(self, operation: str) -> dict:
        """Issue fresh approved claims/ticket from current platform authority."""
        ...

    def current(self, context: dict, operation: str) -> bool:
        """Recheck account/grant/store revisions; return literal True only."""
        ...


def need(condition, code='VALIDATION_FAILED'):
    if not condition:
        raise RuntimeFailure(code)


def exact(value, fields):
    need(type(value) is dict and set(value) == fields)


def text(value, limit, *, empty=False, multiline=False):
    need(type(value) is str and (0 if empty else 1) <= len(value) <= limit
         and all(ord(c) >= 32 or (multiline and c in '\n\r\t') for c in value))
    try:
        value.encode('utf-8')
    except UnicodeError:
        raise RuntimeFailure('VALIDATION_FAILED') from None
    return value


def identifier(value):
    text(value, 36)
    try:
        need(str(UUID(value)) == value)
    except ValueError:
        raise RuntimeFailure('VALIDATION_FAILED') from None
    return value


def template_gap_result(value):
    """Exact negative result of the owner-installed temporary template-only mode."""
    exact(value, {'ok', 'status', 'message', 'data', 'retryable', 'temporary_mode', 'case_id'})
    need(value['ok'] is False and value['status'] == 'TEMPLATE_NOT_FOUND' and value['data'] is None
         and value['retryable'] is False and value['temporary_mode'] is True
         and value['message'] == 'Извините, данный запрос не поддерживается')
    need(re.fullmatch(r'tgap_[a-f0-9]{32}', text(value['case_id'], 37)))


def provider_result(value):
    """Bounded negative tool metadata; never a financial dataset or a retry grant."""
    exact(value, {'schema', 'ok', 'provider', 'operation', 'status', 'http_status',
        'provider_code', 'required_subscriptions', 'subscription_relation', 'requirement_source',
        'documentation_conflict', 'data', 'retryable', 'message', 'model_instruction', 'provider_body_sha256'})
    need(value['schema'] == 'alice-provider-access-result/v1' and value['ok'] is False
         and value['provider'] == 'ozon' and value['http_status'] == 403 and value['provider_code'] == 7
         and value['data'] is None and value['retryable'] is False)
    need(value['status'] in {'SUBSCRIPTION_REQUIRED', 'METHOD_PERMISSION_REQUIRED', 'ACCESS_DENIED'}
         and value['requirement_source'] == 'provider_response'
         and type(value['documentation_conflict']) is bool
         and value['subscription_relation'] in {'SINGLE', 'ANY_OF', 'UNRESOLVED'})
    need(re.fullmatch(r'[A-Za-z0-9_]{1,120}', text(value['operation'], 120)))
    need(re.fullmatch(r'[a-f0-9]{64}', text(value['provider_body_sha256'], 64)))
    names = {'PREMIUM': 'Premium', 'PREMIUM_LITE': 'Premium Lite', 'PREMIUM_PLUS': 'Premium Plus',
             'PREMIUM_PRO': 'Premium Pro', 'REVIEWS_MANAGEMENT': 'Управление отзывами'}
    subscriptions = value['required_subscriptions']
    need(type(subscriptions) is list and len(subscriptions) <= len(names))
    seen = set()
    for item in subscriptions:
        exact(item, {'id', 'name'}); text(item['id'], 40); text(item['name'], 80)
        need(item['id'] in names and item['name'] == names[item['id']] and item['id'] not in seen)
        seen.add(item['id'])
    need(value['status'] == 'SUBSCRIPTION_REQUIRED' or not seen)
    text(value['message'], 1500); text(value['model_instruction'], 1500)
    return deepcopy(value)


def timestamp(value):
    text(value, 40)
    need(re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)', value))
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()
    except (ValueError, OverflowError):
        raise RuntimeFailure('VALIDATION_FAILED') from None


def encode(value):
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'),
                          allow_nan=False).encode('utf-8')
    except (ValueError, TypeError, UnicodeError, RecursionError):
        raise RuntimeFailure('VALIDATION_FAILED') from None


def decode(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            need(key not in result)
            result[key] = value
        return result
    def invalid(_):
        raise RuntimeFailure('VALIDATION_FAILED')
    try:
        return json.loads(raw.decode('utf-8'), object_pairs_hook=pairs, parse_constant=invalid)
    except (ValueError, UnicodeError, RecursionError):
        raise RuntimeFailure('VALIDATION_FAILED') from None


def context_shape(context, now):
    exact(context, CONTEXT_FIELDS)
    result = deepcopy(context)
    identifier(result['tenant_id']); identifier(result['actor_id'])
    for name in ('security_revision', 'access_revision'):
        need(type(result[name]) is int and 1 <= result[name] <= 2147483647)
    need(result['runtime_contract_version'] == CONTRACT, 'CATALOG_INCOMPATIBLE')
    need(result['business_timezone'] == 'Europe/Moscow', 'CAPABILITY_UNAVAILABLE')
    text(result['execution_ticket'], 4096); text(result['catalog_release_id'], 128)
    need(timestamp(result['not_after']) > now, 'AUTH_REQUIRED')
    stores = result['store_scope']
    need(type(stores) is list and 1 <= len(stores) <= 1000)
    ids = set()
    for store in stores:
        exact(store, {'store_id', 'credential_revision', 'scope_revision'})
        sid = identifier(store['store_id']); need(sid not in ids); ids.add(sid)
        for name in ('credential_revision', 'scope_revision'):
            need(type(store[name]) is int and 1 <= store[name] <= 2147483647)
    stores.sort(key=lambda row: row['store_id'])
    return result


class RuntimeClient:
    def __init__(self, path, expected_uid, versions, authorizer: Authorizer, *, timeout=2.0,
                 clock=time.time):
        need(type(path) is str and path.startswith('/') and str(Path(path)) == path
             and '..' not in Path(path).parts)
        need(type(expected_uid) is int and expected_uid >= 0)
        need(type(timeout) in (int, float) and math.isfinite(timeout) and 0 < timeout <= 3)
        exact(versions, VERSION_FIELDS)
        for value in versions.values(): text(value, 128)
        need(versions['runtime_contract_version'] == CONTRACT and
             versions['task_schema_version'] == 'runtime_task_v1' and
             versions['task_schema_sha256'] == TASK_SHA256, 'CATALOG_INCOMPATIBLE')
        for key in ('task_schema_sha256', 'registry_hash', 'catalog_bundle_hash'):
            need(re.fullmatch('[a-f0-9]{64}', versions[key]), 'CATALOG_INCOMPATIBLE')
        need(callable(getattr(authorizer, 'prepare', None)) and
             callable(getattr(authorizer, 'current', None)), 'AUTH_REQUIRED')
        self.path, self.uid, self.versions = path, expected_uid, deepcopy(versions)
        self.authorizer, self.timeout, self.clock = authorizer, timeout, clock
        self._pid = None

    def _exchange(self, operation, payload, validate):
        mutation = operation in {'submit', 'cancel', 'clarify'}
        sent = False
        deadline = time.monotonic() + self.timeout
        def remaining():
            left = deadline - time.monotonic()
            if left <= 0: raise TimeoutError()
            return left
        try:
            info, parent = os.lstat(self.path), os.lstat(str(Path(self.path).parent))
            need(hasattr(socket, 'SO_PEERCRED') and stat.S_ISSOCK(info.st_mode)
                 and info.st_uid == self.uid and not info.st_mode & 0o002
                 and stat.S_ISDIR(parent.st_mode) and parent.st_uid in {0, self.uid}
                 and not parent.st_mode & 0o022, 'AUTH_REQUIRED')
            raw = encode({'schema_version': CONTRACT, 'operation': operation, 'payload': payload}) + b'\n'
            need(len(raw) <= MAX_REQUEST)
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as peer:
                peer.settimeout(remaining()); peer.connect(self.path)
                pid, uid, _ = struct.unpack('3i', peer.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
                need(uid == self.uid, 'AUTH_REQUIRED')
                need(operation == 'current_versions' or self._pid == pid, 'CATALOG_INCOMPATIBLE')
                peer.settimeout(remaining()); sent = True; peer.sendall(raw)
                data = bytearray()
                while not data.endswith(b'\n'):
                    peer.settimeout(remaining())
                    part = peer.recv(min(4096, MAX_RESPONSE + 1 - len(data)))
                    need(part and len(data) + len(part) <= MAX_RESPONSE, 'DEPENDENCY_UNAVAILABLE')
                    data.extend(part)
                remaining()
            value = decode(bytes(data))
            need(type(value) is dict and type(value.get('ok')) is bool, 'DEPENDENCY_UNAVAILABLE')
            if value['ok'] is False:
                exact(value, {'ok', 'error'})
                error = value['error']; exact(error, {'code', 'message', 'trace_id', 'retryable'})
                need(type(error['code']) is str and error['code'] in ERRORS
                     and error['message'] == error['code'] and error['retryable'] is False)
                identifier(error['trace_id'])
                # A safe error envelope can be produced after durable dispatch
                # when serializing the success reply fails. It is not evidence
                # that submit/cancel had no effect; recover with the same ID.
                unknown = error['code'] == 'UNKNOWN_OUTCOME' or (mutation and error['code'] == 'DEPENDENCY_UNAVAILABLE')
                raise RuntimeFailure(error['code'], outcome='UNKNOWN' if unknown else 'REJECTED')
            exact(value, {'ok', 'data'})
            answer = validate(value['data'])
            if operation == 'current_versions': self._pid = pid
            return answer
        except RuntimeFailure as failure:
            if failure.outcome == 'REJECTED' or failure.outcome == 'UNKNOWN': raise
            if mutation and sent:
                raise RuntimeFailure('DEPENDENCY_UNAVAILABLE', outcome='UNKNOWN') from None
            if sent and failure.code == 'VALIDATION_FAILED':
                raise RuntimeFailure('DEPENDENCY_UNAVAILABLE') from None
            raise
        except (OSError, TimeoutError, ValueError, TypeError, KeyError, struct.error, OverflowError):
            raise RuntimeFailure('DEPENDENCY_UNAVAILABLE', outcome='UNKNOWN' if mutation and sent else 'NOT_SENT') from None

    def current_versions(self):
        def validate(value):
            need(value == self.versions and type(value) is dict, 'CATALOG_INCOMPATIBLE')
            return deepcopy(value)
        return self._exchange('current_versions', {}, validate)

    def _context(self, operation):
        try:
            result = context_shape(self.authorizer.prepare(operation), self.clock())
            need(result['catalog_release_id'] == self.versions['catalog_release_id'], 'CATALOG_INCOMPATIBLE')
            need(self.authorizer.current(deepcopy(result), operation) is True, 'PERMISSION_DENIED')
            return result
        except RuntimeFailure: raise
        except Exception:
            raise RuntimeFailure('DEPENDENCY_UNAVAILABLE') from None

    def _authorized(self, operation, context, payload, validate):
        policy_operation = 'submit' if operation == 'clarify' else operation
        mutation = operation in {'submit', 'cancel', 'clarify'}
        if self._pid is None: self.current_versions()
        if mutation:
            need(self.authorizer.current(deepcopy(context), policy_operation) is True, 'PERMISSION_DENIED')
        answer = self._exchange(operation, {**payload, 'context': context}, validate)
        try:
            current = self.authorizer.current(deepcopy(context), policy_operation) is True
        except RuntimeFailure as failure:
            if failure.code == 'DEPENDENCY_UNAVAILABLE':
                raise RuntimeFailure('DEPENDENCY_UNAVAILABLE', outcome='UNKNOWN' if mutation else 'REJECTED') from None
            current = False
        except Exception:
            raise RuntimeFailure('DEPENDENCY_UNAVAILABLE', outcome='UNKNOWN' if mutation else 'REJECTED') from None
        if not current:
            raise RuntimeFailure('PERMISSION_DENIED', outcome='UNKNOWN' if mutation else 'REJECTED')
        return answer

    def capabilities(self):
        def validate(value):
            exact(value, VERSION_FIELDS | {'operations', 'query_input_kinds', 'utterance_max_chars',
                  'business_timezones', 'unsupported', 'replay_retention_seconds', 'read_recomputes'})
            need({key: value[key] for key in VERSION_FIELDS} == self.versions, 'CATALOG_INCOMPATIBLE')
            need(value['operations'] in (['submit', 'status', 'read_result', 'cancel', 'capabilities', 'current_versions'], ['submit', 'status', 'read_result', 'cancel', 'capabilities', 'current_versions', 'list_reports', 'read_report'], ['submit', 'status', 'read_result', 'cancel', 'capabilities', 'current_versions', 'list_reports', 'read_report', 'clarify'])
                 and value['query_input_kinds'] == ['utterance'] and type(value['utterance_max_chars']) is int
                 and value['utterance_max_chars'] == 1200 and value['business_timezones'] == ['Europe/Moscow']
                 and value['unsupported'] == ['template', 'revoke_scope'] and value['read_recomputes'] is False
                 and type(value['replay_retention_seconds']) is int and value['replay_retention_seconds'] == 86400,
                 'CATALOG_INCOMPATIBLE')
            return deepcopy(value)
        return self._authorized('capabilities', self._context('capabilities'), {}, validate)

    @staticmethod
    def _report(value):
        fields = {'id','run_id','template','filename','media_type','bytes','sha256',
                  'created_at','expires_at','operation','error'}
        exact(value, fields)
        identifier(value['id']); identifier(value['run_id'])
        t = value['template']; exact(t, {'id','name','version','catalog_hash'})
        text(t['id'],160); text(t['name'],1024)
        need(type(t['version']) is int and t['version']>=1)
        for h in (t['catalog_hash'],value['sha256']): need(type(h) is str and re.fullmatch('[a-f0-9]{64}',h))
        text(value['filename'],300); need(not any(c in value['filename'] for c in '/\\'))
        text(value['media_type'],160); need(re.fullmatch(r'[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+',value['media_type']))
        text(value['operation'],160)
        need(type(value['bytes']) is int and 0<=value['bytes']<=64*1024*1024)
        need(value['error'] in (None,'STORAGE_CAPACITY'))
        for k in ('created_at','expires_at'):
            need(type(value[k]) in (int,float) and math.isfinite(value[k]) and value[k]>0)
        need(abs(value['expires_at']-value['created_at']-172800)<0.00001)
        return value

    def list_reports(self, cursor=None):
        if cursor is not None: identifier(cursor)
        def validate(value):
            exact(value, {'schema_version','items','next_cursor'})
            need(value['schema_version']=='runtime_reports_v1' and type(value['items']) is list and len(value['items'])<=50)
            seen=set()
            for item in value['items']:
                self._report(item); need(item['id'] not in seen and item['expires_at']>self.clock()); seen.add(item['id'])
            if value['next_cursor'] is not None: identifier(value['next_cursor'])
            return deepcopy(value)
        return self._authorized('list_reports',self._context('list_reports'),{'cursor':cursor},validate)

    def read_report(self, file_id, offset=0):
        identifier(file_id); need(type(offset) is int and offset>=0 and offset%65536==0)
        def validate(value):
            fields={'schema_version','offset','next_offset','eof','base64','chunk_sha256'}
            need(type(value) is dict and fields<=set(value))
            self._report({k:v for k,v in value.items() if k not in fields})
            need(value['schema_version']=='runtime_report_chunk_v1' and value['id']==file_id
                 and value['offset']==offset and type(value['offset']) is int and value['expires_at']>self.clock()
                 and value['error'] is None and type(value['eof']) is bool)
            text(value['base64'],87384,empty=True)
            try: raw=base64.b64decode(value['base64'],validate=True)
            except ValueError: raise RuntimeFailure('DEPENDENCY_UNAVAILABLE') from None
            need(len(raw)==min(65536,value['bytes']-offset) and 0<=len(raw)<=65536
                 and type(value['next_offset']) is int and value['next_offset']==offset+len(raw)
                 and value['eof']==(value['next_offset']==value['bytes'])
                 and value['chunk_sha256']==hashlib.sha256(raw).hexdigest())
            return deepcopy(value)
        return self._authorized('read_report',self._context('read_report'),{'file_id':file_id,'offset':offset},validate)

    def submit(self, utterance, *, request_id, logical_query_id, trace_id):
        text(utterance, 1200); need(utterance.strip())
        return self._submit_input({'kind': 'utterance', 'text': utterance}, request_id, logical_query_id, trace_id)

    def clarify(self, answer, *, job_ref, expected_revision, request_id, logical_query_id, trace_id):
        text(answer, 1200); need(answer.strip()); identifier(job_ref)
        need(type(expected_revision) is str and re.fullmatch(r'[a-f0-9]{64}', expected_revision))
        return self._submit_input({'kind': 'clarification', 'text': answer, 'job_ref': job_ref,
                                  'expected_revision': expected_revision}, request_id, logical_query_id, trace_id)

    def _submit_input(self, query_input, request_id, logical_query_id, trace_id):
        for value in (request_id, logical_query_id, trace_id): identifier(value)
        context = self._context('submit')
        def validate(value):
            exact(value, {'schema_version', 'job_ref', 'logical_query_id', 'state', 'accepted_at', 'trace_id'})
            need(value['schema_version'] == 'runtime_acceptance_v1' and value['state'] == 'ACCEPTED'
                 and value['logical_query_id'] == logical_query_id)
            identifier(value['job_ref']); identifier(value['trace_id']); timestamp(value['accepted_at'])
            return deepcopy(value)
        if query_input['kind'] == 'clarification':
            return self._authorized('clarify', context, {'schema_version': 'runtime_clarification_task_v1',
                'request_id': request_id, 'logical_query_id': logical_query_id, 'trace_id': trace_id,
                'job_ref': query_input['job_ref'], 'expected_revision': query_input['expected_revision'],
                'answer': query_input['text']}, validate)
        return self._authorized('submit', context, {'schema_version': 'runtime_task_v1',
            'request_id': request_id, 'logical_query_id': logical_query_id, 'trace_id': trace_id,
            'query_input': query_input}, validate)

    def _status(self, value, job_ref, *, extra=frozenset()):
        required = {'job_ref', 'state', 'updated_at', 'retryable', 'result_expires_at'} | set(extra)
        need(type(value) is dict and required <= set(value) and
             set(value) <= required | {'code', 'retry_after_seconds'})
        need(value['job_ref'] == job_ref and value['state'] in STATES and value['retryable'] is False)
        timestamp(value['updated_at'])
        if value['result_expires_at'] is not None: timestamp(value['result_expires_at'])
        expected = {'UNKNOWN': 'UNKNOWN_OUTCOME', 'EXPIRED': 'RESULT_EXPIRED', 'FAILED': 'EXECUTION_FAILED'}.get(value['state'])
        if expected: need(value.get('code') == expected)
        elif 'code' in value: need(value['state'] == 'QUEUED' and value['code'] == 'QUOTA_WAIT')
        if 'retry_after_seconds' in value:
            need(value.get('code') == 'QUOTA_WAIT' and type(value['retry_after_seconds']) is int
                 and 1 <= value['retry_after_seconds'] <= 604800)
        return deepcopy(value)

    def status(self, job_ref):
        identifier(job_ref)
        return self._authorized('status', self._context('status'), {'job_ref': job_ref},
                                lambda value: self._status(value, job_ref))

    def read_result(self, job_ref):
        identifier(job_ref)
        def validate(value):
            need(type(value) is dict)
            metadata = {'result_kind', 'model_result', 'clarification'} & set(value)
            result = self._status(value, job_ref, extra={'schema_version', 'complete', 'pages', 'fetched_at'} | metadata)
            if 'result_kind' in value:
                need(value['result_kind'] in {'DATA', 'PROVIDER_REFUSAL', 'CLARIFICATION'})
            if value.get('result_kind') == 'CLARIFICATION':
                need(value.get('state') == 'NEEDS_INPUT' and 'model_result' not in value)
                item = value.get('clarification')
                exact(item, {'schema_version', 'revision', 'question', 'missing', 'turn'})
                need(item['schema_version'] == 'runtime_clarification_v1')
                need(type(item['revision']) is str and re.fullmatch(r'[a-f0-9]{64}', item['revision']))
                text(item['question'], 400)
                need(value.get('pages') == [item['question']] and type(item['turn']) is int and 1 <= item['turn'] <= 4)
                need(type(item['missing']) is list and 1 <= len(item['missing']) <= 8)
                need(all(type(s) is str and re.fullmatch(r'[a-z][a-z0-9_]{0,63}', s) for s in item['missing']))
                need(len(set(item['missing'])) == len(item['missing']))
            else:
                need('clarification' not in value and value.get('state') != 'NEEDS_INPUT')
            if 'model_result' in value:
                need(value.get('result_kind') == 'PROVIDER_REFUSAL')
                if type(value['model_result']) is dict and value['model_result'].get('status') == 'TEMPLATE_NOT_FOUND':
                    template_gap_result(value['model_result'])
                    need(value.get('pages') == [value['model_result']['message']])
                    # The installed temporary core uses its generic failure label.
                    # Normalize only this exact bounded negative shape for consumers.
                    result['result_kind'] = 'UNSUPPORTED_QUERY'
                else:
                    provider_result(value['model_result'])
            need(value['schema_version'] == 'runtime_result_v1' and value['state'] in {'READY', 'NEEDS_INPUT'}
                 and value['complete'] is True and timestamp(value['result_expires_at']) > self.clock()
                 and type(value['pages']) is list and 1 <= len(value['pages']) <= 1000)
            for page in value['pages']: text(page, 900, multiline=True)
            # R01 preserves the core's existing minute-precision display stamp.
            # Admission/status times above use a separate RFC3339 wire format.
            stamp = text(value['fetched_at'], 20)
            need(re.fullmatch(r'\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC', stamp))
            try:
                need(datetime.strptime(stamp, '%Y-%m-%d %H:%M UTC').strftime('%Y-%m-%d %H:%M UTC') == stamp)
            except ValueError:
                raise RuntimeFailure('DEPENDENCY_UNAVAILABLE') from None
            return result
        result = self._authorized('read_result', self._context('read_result'), {'job_ref': job_ref}, validate)
        # The final DB-backed authority check can cross the result TTL boundary.
        need(timestamp(result['result_expires_at']) > self.clock(), 'RESULT_EXPIRED')
        return result

    def cancel(self, job_ref, *, request_id):
        identifier(job_ref); identifier(request_id)
        def validate(value):
            result = self._status(value, job_ref, extra={'cancelled', 'in_flight_may_complete'})
            need(type(value['cancelled']) is bool and value['in_flight_may_complete'] is True)
            return result
        return self._authorized('cancel', self._context('cancel'),
                                {'job_ref': job_ref, 'request_id': request_id}, validate)
