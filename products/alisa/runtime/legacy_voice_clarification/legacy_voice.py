"""Continuation through the existing Station binding, separate from RuntimePort.

Only the private Station authority resolves a voice receipt to an owner. No
bearer, new OAuth family or commercial entitlement is created by this adapter.
"""
from contextvars import ContextVar
import socket

from semantics import Rejected, canonical_json, strict_json, normalize

SUBMISSION = ContextVar('legacy_voice_submission', default=None)
SCHEMA = 'station-clarification-authority/v1'
FIELDS = {'schema', 'tenant', 'owner', 'application', 'conversation', 'ticket'}


class Authority:
    def __init__(self, path='/run/alisa-station/authorization.sock'):
        self.path = path

    def call(self, payload):
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as stream:
                stream.settimeout(.4)
                stream.connect(self.path)
                stream.sendall(canonical_json(payload).encode() + b'\n')
                raw = b''
                while not raw.endswith(b'\n'):
                    part = stream.recv(4096)
                    if not part or len(raw) + len(part) > 4000:
                        raise ValueError('authority_response')
                    raw += part
                result = strict_json(raw)
        except (OSError, ValueError):
            raise Rejected('DEPENDENCY_UNAVAILABLE') from None
        if type(result) is not dict or result.get('error'):
            raise Rejected('DEPENDENCY_UNAVAILABLE')
        return result

    def admit(self, tenant, conversation, rid):
        value = self.call({'op': 'admit', 'tenant': tenant,
                           'conversation': conversation, 'rid': rid}).get('guard')
        if value is not None and not shape(value, tenant):
            raise Rejected('PERMISSION_DENIED')
        return value

    def current(self, guard, tenant):
        return shape(guard, tenant) and self.call({'op': 'current', 'guard': guard}).get('allowed') is True


def shape(guard, tenant):
    return (type(guard) is dict and set(guard) == FIELDS
            and guard['schema'] == SCHEMA and guard['tenant'] == tenant
            and all(type(guard[k]) is str and 1 <= len(guard[k]) <= 128
                    for k in FIELDS - {'schema'}))


def authorized(engine, plan):
    guard = plan.get('station_guard')
    if guard is None:
        return True
    authority = getattr(engine, 'legacy_voice_authority', None)
    return authority is not None and authority.current(guard, plan['tenant'])


def supported(engine, plan):
    return shape(plan.get('station_guard'), plan['tenant']) and authorized(engine, plan)


def pin(plan, draft):
    guard = SUBMISSION.get()
    if guard is not None:
        # A legacy admission is never promoted into a Platform execution ticket.
        if plan.get('runtime_guard') is not None:
            raise Rejected('PERMISSION_DENIED')
        plan['station_guard'] = dict(guard)
        draft['station_guard'] = dict(guard)


def continue_selected(engine, c, tenant, command):
    """Called inside the existing dialogue receipt transaction and reader scope."""
    from template_clarification import pending, checked_text, prepare_resume, requeue
    guard = SUBMISSION.get()
    row = engine.repo.get(tenant)
    if not row or not row['plan']:
        return None
    plan = strict_json(row['plan'])
    old = plan.get('station_guard')
    if old is None:
        return None
    from reader_state import key
    reader = key(engine.repo, tenant)
    value = pending(row)
    if value is None:
        if strict_json(row['draft']).get('station_question_pending'):
            raise Rejected('RESULT_EXPIRED' if row['state'] == 'EXPIRED' else 'PERMISSION_DENIED')
        if (row['state'] in ('QUEUED', 'RUNNING') and old['conversation'] != reader
                and strict_json(row['draft']).get('question_clarifications')):
            raise Rejected('STALE_DIALOGUE_TURN')
        return None
    if not shape(guard, tenant) or any(old[k] != guard[k] for k in ('tenant', 'owner', 'application')):
        raise Rejected('PERMISSION_DENIED')
    if not authorized(engine, plan):
        raise Rejected('PERMISSION_DENIED')
    cursor = c.execute('SELECT cancelled FROM reader_cursors WHERE tenant=? AND conversation=? AND jid=?',
                       (tenant, reader, row['id'])).fetchone()
    if not cursor or cursor['cancelled']:
        raise Rejected('PERMISSION_DENIED')
    # Jobs of the new cabinet and other readers never become legacy jobs.
    if (c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='rt_job_refs'").fetchone()
            and c.execute('SELECT 1 FROM rt_job_refs WHERE runtime_tenant=? AND jid=?',
                          (tenant, row['id'])).fetchone()):
        raise Rejected('PERMISSION_DENIED')
    text = normalize(command)
    if text in ('отмена', 'отмени отчет', 'выход'):
        c.execute('UPDATE reader_cursors SET cancelled=1,updated=? WHERE tenant=? AND conversation=? AND jid=?',
                  (engine.repo.clock(), tenant, reader, row['id']))
        if not c.execute('SELECT 1 FROM reader_cursors WHERE tenant=? AND jid=? AND cancelled=0',
                         (tenant, row['id'])).fetchone():
            c.execute("UPDATE jobs SET state='CANCELLED',result=NULL,updated=? WHERE tenant=? AND id=?",
                      (engine.repo.clock(), tenant, row['id']))
        speech = 'Незавершённый запрос отменён.'
        return {'text': speech, 'tts': speech, 'job_id': row['id'], 'state': 'CANCELLED'}
    if text in ('результат', 'результат отчета', 'статус отчета', 'дальше'):
        speech = value['question']
        return {'text': speech, 'tts': speech, 'job_id': row['id'], 'state': 'READY'}
    from information import is_help
    if is_help(command):
        return engine.control(tenant, 'помощь')
    answer = checked_text(command, 1200)
    draft, plan, answers = prepare_resume(engine, c, row, answer, value['revision'])
    # Refresh only the existing binding's proof, after both admissions passed.
    draft['station_guard'] = dict(guard)
    draft.pop('station_question_pending', None)
    plan['station_guard'] = dict(guard)
    if not engine.authorized(plan):
        raise Rejected('PERMISSION_DENIED')
    requeue(engine, c, row, draft, plan, answers)
    c.execute('UPDATE reader_cursors SET page=0,delivered=0,updated=? WHERE tenant=? AND conversation=? AND jid=?',
              (engine.repo.clock(), tenant, reader, row['id']))
    speech = 'Уточнение принято. Продолжаю тот же запрос.'
    return {'text': speech, 'tts': speech, 'job_id': row['id'], 'state': 'QUEUED'}
