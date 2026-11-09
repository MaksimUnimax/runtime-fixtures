"""Unresolved, received API errors become data for the ordinary answer stage.

Retryable errors are consumed by request_recovery first. This module performs no
network calls, does not grant access, and never executes model text.
"""
from datetime import datetime, timezone
from semantics import Scope, Store, strict_json


def current_owner(engine, row, plan):
    try:
        return plan['tenant'] == row['tenant'] and engine.scope_current(
            Scope(plan['tenant'], plan['access_revision'], tuple(Store(**s) for s in plan['stores'])), plan.get('runtime_guard'))
    except (KeyError, TypeError, ValueError):
        return False


def detail(request, error):
    from provider_access_result import from_error
    access = from_error(error)
    if access is not None:
        return {k:access[k] for k in ('provider','operation','status','http_status',
                'required_subscriptions','subscription_relation','message','data','retryable')}
    reasons = {
        400:'Площадка отклонила параметры запроса.',
        401:'Площадка не приняла авторизацию запроса. Требуется проверить подключение магазина.',
        403:'Площадка отказала в доступе. Требование конкретной подписки не подтверждено.',
        404:'Площадка не нашла запрошенный ресурс.',
        409:'Площадка сообщила о конфликте состояния запроса.',
        422:'Площадка не приняла значения параметров запроса.',
    }
    if error.status==200:reasons[200]='Полученный ответ API не удалось обработать: '+error.code+'. Данные этой операции не подтверждены.'
    value = {'operation':request.operation,'http_status':error.status,'code':error.code,
             'message':reasons.get(error.status,'Площадка вернула ошибку HTTP '+str(error.status)+'. У сервера нет автоматического решения; точная причина не подтверждена.'),
             'data':None,'retryable':False}
    feedback = getattr(error,'feedback',None)
    if type(feedback) is dict:
        value['details'] = {k:feedback[k] for k in ('reason_hints','mentioned_parameters','provider_code') if k in feedback}
    return value


def stage(worker, row, request, error, receipt):
    if not request.store_id or error.status is None or not row['plan']:
        return False
    draft = strict_json(row['draft'])
    if not draft.get('answer_by_model'):
        return False
    plan = strict_json(row['plan'])
    if not current_owner(worker.engine,row,plan):return False
    from model_answer import API_DATA, PENDING
    with worker.repo.connection(True) as connection:
        current = worker.repo._owned(connection,row['id'],row['owner'])
        progress = strict_json(current['progress']) if current['progress'] else {}
        failure = detail(request,error)
        # A permission refusal can be explained to the current owner without
        # disclosing earlier source contents or attempting another source read.
        denied = error.status in (401,403)
        data = [] if denied else progress.get(API_DATA,progress.get('calls',[]))
        data = [*data, {'operation':request.operation,'store':request.store_id,'error':failure}]
        stamp=datetime.fromtimestamp(worker.repo.clock(),timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
        pending={'data':{'provider_error':failure},'provider_error':failure,
                 'fetched_at':stamp,'failure_code':error.code,'permission_notice':denied,'failure_receipt':receipt}
        # Do not retain the acquisition pending command after a terminal refusal.
        worker.repo.reschedule(row['id'],row['owner'],{API_DATA:data,PENDING:pending})
    return True


def permission_notice(row):
    from model_answer import PENDING
    result=row['result'] if 'result' in row.keys() else None
    progress=row['progress'] if 'progress' in row.keys() else None
    value = strict_json(result) if result and row['state']=='READY' else (
        strict_json(progress).get(PENDING,{}) if progress else {})
    return value if value.get('permission_notice') is True else None


def notice_authorized(engine,row):
    notice=permission_notice(row)
    if notice is None or not row['plan']:return False
    plan=strict_json(row['plan'])
    if not current_owner(engine,row,plan):return False
    with engine.repo.connection() as connection:
        receipt=connection.execute('SELECT jid,state,http,source FROM calls WHERE id=?',(notice.get('failure_receipt'),)).fetchone()
    return bool(receipt and receipt['jid']==row['id'] and receipt['state']=='HTTP_ERROR'
                and receipt['http'] in (401,403)
                and any(receipt['source'].startswith(s['platform']+':'+s['identity']+':') for s in plan['stores']))
