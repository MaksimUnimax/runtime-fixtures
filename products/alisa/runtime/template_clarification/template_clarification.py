"""Template-driven questions and fenced continuation of one RuntimePort job.

No topic/date parser and no provider replay. A continuation is admitted only for
an unexpired, unique reader's question, before any marketplace call was sent.
"""
from datetime import datetime, timezone
import re

from semantics import Rejected, canonical_json, strict_json, fingerprint

SCHEMA = 'runtime_clarification_v1'
MAX_TURNS = 4
SENSITIVE = re.compile(r'(sk-[\w-]{12,}|eyJ[\w-]{25,}\.|api.?key|authorization|bearer|парол|токен|секрет)', re.I)


def need(ok, code='VALIDATION_FAILED'):
    if not ok:
        raise Rejected(code)


def checked_text(value, maximum):
    need(type(value) is str and 1 <= len(value.strip()) <= maximum)
    need(not any(ord(c) < 32 for c in value) and not SENSITIVE.search(value), 'SENSITIVE_INPUT')
    return value


def pending(row):
    if row['state'] != 'READY' or not row.get('result'):
        return None
    result = strict_json(row['result'])
    value = result.get('clarification')
    return value if type(value) is dict and value.get('schema_version') == SCHEMA else None


def pause(worker, row, plan, progress, decision):
    from template_catalog import TemplateGap
    try:
        need(type(decision) is dict and set(decision) == {'action', 'question', 'missing'})
        need(decision['action'] == 'clarify')
        question = checked_text(decision['question'], 400)
        missing = decision['missing']
        need(type(missing) is list and 1 <= len(missing) <= 8)
        need(all(type(v) is str and re.fullmatch(r'[a-z][a-z0-9_]{0,63}', v) for v in missing))
        need(len(set(missing)) == len(missing))
        draft = strict_json(row['draft'])
        answers = draft.get('question_clarifications', [])
        need(type(answers) is list and len(answers) < MAX_TURNS, 'CLARIFICATION_LIMIT')
    except Rejected as error:
        raise TemplateGap('CLARIFICATION_LIMIT' if error.code == 'CLARIFICATION_LIMIT'
                          else 'MODEL_CLARIFICATION_INVALID') from None
    value = {'schema_version': SCHEMA, 'question': question, 'missing': missing,
             'turn': len(answers) + 1,
             'revision': fingerprint([row['id'], answers, question, missing])}
    result = {'complete': True, 'pages': [question], 'data': None, 'clarification': value,
              'fetched_at': datetime.fromtimestamp(worker.repo.clock(), timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}
    worker.repo.complete_answer(row['id'], row['owner'], result)


def continue_task(port, task, peer):
    from runtime_port_contract import utc
    query = task['query_input']
    answer = checked_text(query['text'], 1200)
    ctx, guard, _ = port._auth(task['context'], peer, 'submit')
    digest = fingerprint({'query': query, 'logical_query_id': task['logical_query_id'], 'guard': guard})
    with port.repo.connection(True) as c:
        old = port._old(c, ctx, task['request_id'], 'clarify', digest)
        if old:
            port._lookup(c, old['job_ref'], ctx, guard)
            return old
        ref, row = port._lookup(c, query['job_ref'], ctx, guard)
        need(ref['logical_id'] == task['logical_query_id'], 'IDEMPOTENCY_CONFLICT')
        value = pending(row)
        need(value is not None and (row['expires'] or 0) > port.repo.clock(), 'RESULT_EXPIRED')
        need(value['revision'] == query['expected_revision'], 'IDEMPOTENCY_CONFLICT')
        # Never mutate another reader's shared result or a job which sent API data.
        need(c.execute('SELECT count(*) FROM rt_job_refs WHERE runtime_tenant=? AND jid=?',
                       (row['tenant'], row['id'])).fetchone()[0] == 1, 'PERMISSION_DENIED')
        need(not c.execute('SELECT 1 FROM reader_cursors WHERE tenant=? AND jid=? AND conversation!=?',
                          (row['tenant'], row['id'], port.reader(ref['ref']))).fetchone(), 'PERMISSION_DENIED')
        need(not c.execute("SELECT 1 FROM calls WHERE jid=? AND source NOT LIKE 'model:%'", (row['id'],)).fetchone(),
             'PERMISSION_DENIED')
        draft, plan = strict_json(row['draft']), strict_json(row['plan'])
        answers = draft.get('question_clarifications', [])
        need(type(answers) is list and len(answers) < MAX_TURNS and value['turn'] == len(answers) + 1)
        answers = [*answers, 'Вопрос для уточнения: ' + value['question'] + '\nОтвет пользователя: ' + answer]
        draft['question_clarifications'] = answers
        # Original question, date anchor, scope and catalog stay pinned.
        plan.update(selection_verified=False, fragments=[])
        for field in ('selection', 'execution_digest'):
            plan.pop(field, None)
        need(port.engine.authorized(plan), 'PERMISSION_DENIED')
        key = 'clarify:' + fingerprint([plan, answers])
        now = port.repo.clock()
        order = c.execute('SELECT coalesce(max(queue_order),0)+1 FROM jobs').fetchone()[0]
        c.execute('DELETE FROM slots WHERE tenant=? AND jid=?', (row['tenant'], row['id']))
        c.execute('INSERT INTO slots VALUES(?,?,?)', (row['tenant'], key, row['id']))
        c.execute("UPDATE jobs SET state='QUEUED',key=?,draft=?,plan=?,progress=NULL,result=NULL,error=NULL,"
                  'expires=NULL,updated=?,due=?,owner=NULL,lease=NULL,queue_order=? WHERE id=? AND tenant=?',
                  (key, canonical_json(draft), canonical_json(plan), now, now, order, row['id'], row['tenant']))
        c.execute('UPDATE reader_cursors SET page=0,delivered=0,updated=? WHERE tenant=? AND conversation=? AND jid=?',
                  (now, row['tenant'], port.reader(ref['ref']), row['id']))
        receipt = {'schema_version': 'runtime_acceptance_v1', 'job_ref': ref['ref'],
                   'logical_query_id': ref['logical_id'], 'state': 'ACCEPTED',
                   'accepted_at': utc(ref['created']), 'trace_id': task['trace_id']}
        port._save(c, ctx, task['request_id'], 'clarify', digest, receipt)
        return receipt


def cancel_pending(port, c, ref, row):
    c.execute('UPDATE reader_cursors SET cancelled=1,updated=? WHERE tenant=? AND conversation=? AND jid=?',
              (port.repo.clock(), row['tenant'], port.reader(ref['ref']), row['id']))
    if not c.execute('SELECT 1 FROM reader_cursors WHERE tenant=? AND jid=? AND cancelled=0',
                     (row['tenant'], row['id'])).fetchone():
        c.execute("UPDATE jobs SET state='CANCELLED',result=NULL,updated=? WHERE id=? AND tenant=?",
                  (port.repo.clock(), row['id'], row['tenant']))
    return True
