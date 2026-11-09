"""Read one authorized conversation's current job, without enqueue or delivery mutation."""
import re
from semantics import Rejected, strict_json


def status(engine, value):
    deliver = value.get('op') == 'station_deliver'
    expected = {'op', 'tenant', 'conversation_id', 'job_id'}
    if deliver: expected |= {'target_conversation', 'message_id'}
    if set(value) != expected:
        raise Rejected('IPC_SCHEMA')
    tenant, conversation, jid = (value[k] for k in ('tenant', 'conversation_id', 'job_id'))
    if not all(isinstance(x, str) and re.fullmatch(r'[A-Za-z0-9_:-]{1,128}', x) for x in (tenant, conversation, jid)):
        raise Rejected('IPC_SCHEMA')
    scope = engine.scope_for(tenant)
    if scope.tenant != tenant:
        raise Rejected('TENANT_DENIED')
    with engine.repo.reader_scope(tenant, conversation):
        row = engine.repo.get(tenant)
        if not row or row['id'] != jid:
            return {'state': 'SUPERSEDED', 'text': '', 'tts': ''}
        failure_notice=engine.access_failure_notice(row)
        if failure_notice is None and not engine.output_authorized(row):
            raise Rejected('SOURCE_ACCESS')
        state = row['state']
        if state == 'READY' and (row['expires'] or 0) <= engine.repo.clock():
            state = 'EXPIRED'
        text = ''
        if state == 'READY':
            pages = strict_json(row['result'])['pages']
            text = pages[0]
            if not isinstance(text, str) or len(text) > 900:
                raise Rejected('IPC_RESPONSE_SCHEMA')
        elif state not in ('QUEUED', 'RUNNING'):
            text = failure_notice if failure_notice is not None else engine.describe(tenant, row, deliver=False)
    if deliver and state == 'READY':
        target, seq = value['target_conversation'], value['message_id']
        if not isinstance(target, str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,128}', target) or type(seq) is not int or not 0 <= seq <= 99999999:
            raise Rejected('IPC_SCHEMA')
        from reader_state import _attach
        with engine.repo.connection(True) as c:
            with engine.repo.reader_scope(tenant, conversation):
                latest = engine.repo.get(tenant)
                if not latest or latest['id'] != jid or latest['state'] != 'READY' or (latest['expires'] or 0) <= engine.repo.clock():
                    return {'state': 'SUPERSEDED', 'text': '', 'tts': ''}
                if not engine.output_authorized(latest):
                    raise Rejected('SOURCE_ACCESS')
            # Never replace a report selected by a newer utterance in this session.
            previous = c.execute('SELECT last_seq FROM dialogue_context WHERE tenant=? AND conversation=?', (tenant, target)).fetchone()
            if previous and previous['last_seq'] >= seq:
                return {'state': 'SUPERSEDED', 'text': '', 'tts': ''}
            pointer = c.execute('SELECT jid FROM reader_pointers WHERE tenant=? AND conversation=?', (tenant, target)).fetchone()
            if pointer and pointer['jid'] != jid:
                return {'state': 'SUPERSEDED', 'text': '', 'tts': ''}
            if not pointer:
                _attach(engine.repo, c, tenant, target, jid, engine.repo.clock())
                c.execute('UPDATE reader_cursors SET delivered=? WHERE tenant=? AND conversation=? AND jid=?',
                          (int(len(pages) == 1), tenant, target, jid))
            # A retry returns page zero without resetting a reader that already advanced.
    result={'state':state,'text':text,'tts':text}
    if state in ('FAILED','READY'):
        model_result=engine.access_failure_result(row)
        if model_result is not None:result['model_result']=model_result
    return result
