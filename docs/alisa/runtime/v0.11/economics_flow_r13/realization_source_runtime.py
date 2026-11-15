"""Two existing READs in the caller's current Worker/job, never a second queue.

The parent pins an explicit realization month and supplies current admitted-report
permission. Raw protected bodies survive a restart only inside AEAD job progress.
Process-local normalized objects are rebuilt from exact receipts, never unpickled.
This source does not authorize economics inputs, classify accruals or save numbers.
"""
from copy import deepcopy
from datetime import date, datetime, timezone
from calendar import monthrange
from hashlib import sha256
from pathlib import Path
import base64
import json
import secrets
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from semantics import Rejected, canonical_json, strict_json, fingerprint
from protected_reads import ProtectedPayload, key as encryption_key
from parameter_source_runtime import _receipt, _token
from parameter_support import economics_realization as source
import read_surface

CATALOG = strict_json(Path(__file__).with_name('realization_source_catalog.json').read_text())
STEPS = CATALOG['steps']
if (CATALOG['schema'] != 'alisa-realization-source-plan/v1' or CATALOG['provider'] != 'ozon'
    or len(STEPS) != 2 or {x['kind'] for x in STEPS} != {'POSTING', 'MONTHLY'}
    or any(set(x) != {'kind', 'operation'} or source.OPERATIONS.get(x['operation']) != x['kind'] for x in STEPS)):
    raise ValueError('REALIZATION_SOURCE_PLAN_INVALID')
PIN = fingerprint({'code': sha256(Path(__file__).read_bytes()).hexdigest(), 'catalog': CATALOG,
                   'normalizer': sha256(Path(source.__file__).read_bytes()).hexdigest(),
                   'read_surface': read_surface.PIN})


def need(ok, code):
    if not ok:
        raise Rejected(code)


def descriptor(root, store_id, month, year):
    need(type(month) is int and type(year) is int and 1 <= month <= 12 and 1 <= year <= 9999,
         'REALIZATION_MONTH')
    stores = [s for s in root['stores'] if s['id'] == store_id]
    need(len(stores) == 1 and stores[0]['platform'] == 'ozon', 'REALIZATION_SCOPE')
    return {'id': 'realization:' + fingerprint([store_id, year, month]), 'pin': PIN,
            'store_id': store_id, 'request': {'month': month, 'year': year},
            'scope': {'tenant_id': root['tenant'], 'store_id': store_id,
                      'provider': 'OZON', 'currency': 'RUB'}}


def _guard(worker, row, root, desc, authorize):
    need(callable(authorize), 'REALIZATION_REPORT_AUTHORITY_REQUIRED')
    need(worker.engine.authorized(root), 'SOURCE_ACCESS')
    # The caller must bind authorize to the existing admitted Query/reference.
    # A descriptor or typed result is not a substitute for that live permission.
    need(authorize() is True, 'REALIZATION_REPORT_REVOKED')
    need(desc == descriptor(root, desc['store_id'], desc['request']['month'], desc['request']['year']),
         'REALIZATION_DESCRIPTOR_CHANGED')
    last = date(desc['request']['year'], desc['request']['month'],
                monthrange(desc['request']['year'], desc['request']['month'])[1])
    from zoneinfo import ZoneInfo
    need(datetime.fromtimestamp(worker.repo.clock(), timezone.utc).astimezone(ZoneInfo('Europe/Moscow')).date() > last,
         'REALIZATION_MONTH_NOT_CLOSED')
    need(row['tenant'] == root['tenant'], 'REALIZATION_SCOPE')
    return next(s for s in root['stores'] if s['id'] == desc['store_id'])


def _aad(row, desc):
    return canonical_json({'job': row['id'], 'tenant': row['tenant'], 'descriptor': desc, 'pin': PIN}).encode()


def _seal(repo, row, desc, state):
    nonce = secrets.token_bytes(12)
    encrypted = AESGCM(encryption_key(repo)).encrypt(nonce, canonical_json(state).encode(), _aad(row, desc))
    return {'nonce': base64.b64encode(nonce).decode(), 'cipher': base64.b64encode(encrypted).decode()}


def _open(repo, row, desc, packed):
    try:
        need(type(packed) is dict and set(packed) == {'nonce', 'cipher'}, 'REALIZATION_PROGRESS_INTEGRITY')
        raw = AESGCM(encryption_key(repo)).decrypt(base64.b64decode(packed['nonce'], validate=True),
                                                 base64.b64decode(packed['cipher'], validate=True), _aad(row, desc))
        state = strict_json(raw)
        need(set(state) == {'packets', 'receipts', 'event_ids', 'first_observed'}, 'REALIZATION_PROGRESS_INTEGRITY')
        need(type(state['packets']) is list and len(state['packets']) <= len(STEPS), 'REALIZATION_PROGRESS_INTEGRITY')
        return state
    except Exception:
        raise Rejected('REALIZATION_PROGRESS_INTEGRITY') from None


def _packet(stored):
    try:
        packet = deepcopy(stored)
        packet['body'] = base64.b64decode(packet.pop('body_b64'), validate=True)
        return packet
    except (KeyError, ValueError, TypeError):
        raise Rejected('REALIZATION_PACKET_INTEGRITY') from None


def _verifier(worker, row, root, desc, store, state, authorize):
    def verify(packet):
        _guard(worker, row, root, desc, authorize)
        proof = state['receipts'].get(str(packet['receipt_id']))
        if proof is None or packet['scope'] != desc['scope'] or packet['request'] != desc['request']:
            return False
        if packet['operation'] not in source.OPERATIONS:
            return False
        request = read_surface.request_for(store, packet['operation'], packet['request'])
        if (proof['operation'] != request.operation or proof['source'] != request.source
            or proof['request_hash'] != fingerprint(packet['request'])
            or proof['response_hash'] != packet['response_sha256']
            or proof['received_at'] != packet['received_at']):
            return False
        with worker.repo.connection() as connection:
            event = connection.execute('SELECT jid,source,state,http,response_bytes FROM calls WHERE id=?',
                                       (packet['receipt_id'],)).fetchone()
            return (event is not None and event['jid'] == row['id'] and event['source'] == request.source
                    and event['state'] == 'RECEIVED' and event['http'] == 200
                    and event['response_bytes'] == len(packet['body']))
    return verify


def _normalize(worker, row, root, desc, store, state, stored, authorize):
    return source.normalize(_packet(stored),
                            verify=_verifier(worker, row, root, desc, store, state, authorize),
                            encode=lambda kind, value: _token(worker.repo, row, kind, value))


def restore(worker, row, root, desc, packed, *, authorize):
    """Read the SAME captured pair for a rebind; no network or permission cache."""
    store = _guard(worker, row, root, desc, authorize)
    state = _open(worker.repo, row, desc, packed)
    need(len(state['packets']) == len(STEPS), 'REALIZATION_SOURCE_INCOMPLETE')
    try:
        snapshots = {}
        for step, packet in zip(STEPS, state['packets']):
            need(packet['operation'] == step['operation'], 'REALIZATION_SOURCE_ORDER')
            snapshots[step['kind']] = _normalize(worker, row, root, desc, store, state, packet, authorize)
        pair = source.reconcile(snapshots['POSTING'], snapshots['MONTHLY'])
        _guard(worker, row, root, desc, authorize)
        return pair
    except (source.RealizationError, source.c.ParameterError) as error:
        raise Rejected(error.code) from None


def step(worker, row, root, desc, packed, *, authorize, save_progress, on_complete):
    """Exactly one normal Worker dispatch per step; parent owns completion/cleanup."""
    store = _guard(worker, row, root, desc, authorize)
    state = {'packets': [], 'receipts': {}, 'event_ids': [], 'first_observed': None} if packed is None else _open(worker.repo, row, desc, packed)
    if len(state['packets']) == len(STEPS):
        pair = restore(worker, row, root, desc, packed, authorize=authorize)
        on_complete(pair, packed)
        return
    item = STEPS[len(state['packets'])]
    request = read_surface.request_for(store, item['operation'], desc['request'])
    need(read_surface.method('ozon', item['operation']).get('effect') == 'READ', 'REALIZATION_NOT_READ')

    def before_dispatch():
        _guard(worker, row, root, desc, authorize)

    def received(answer):
        _guard(worker, row, root, desc, authorize)
        need(isinstance(answer, ProtectedPayload) and type(answer.raw) is bytes, 'REALIZATION_PROTECTED_BODY_REQUIRED')
        need(answer.mime == 'application/json', 'REALIZATION_RESPONSE_FORMAT')
        stamp = _receipt(worker, row, request, state, answer)
        packet = {'operation': item['operation'], 'scope': deepcopy(desc['scope']),
                  'request': deepcopy(desc['request']), 'body_b64': base64.b64encode(answer.raw).decode(),
                  'received_at': stamp, 'receipt_id': str(state['event_ids'][-1]),
                  'response_sha256': sha256(answer.raw).hexdigest(), 'http': 200}
        try:
            _normalize(worker, row, root, desc, store, state, packet, authorize)
        except (source.RealizationError, source.c.ParameterError) as error:
            raise Rejected(error.code) from None
        # Never checkpoint a bad response as a completed source or retry it blindly.
        state['packets'].append(packet)
        save_progress(_seal(worker.repo, row, desc, state))

    worker._call(row, request, store, before_dispatch=before_dispatch, on_received=received)
