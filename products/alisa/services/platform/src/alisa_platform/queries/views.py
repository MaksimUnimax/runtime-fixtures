from django.conf import settings
from alisa_platform.accounts.views import boundary, exact
from alisa_platform.foundation.views import reply
from alisa_platform.runtime_adapter.authority import SessionPrincipal
from alisa_platform.runtime_adapter.job_client import RuntimeFailure
from . import service


@boundary
def queries(request, data):
    if not getattr(settings, 'QUERIES_ENABLED', False):
        return reply({'code': 'NOT_FOUND'}, 404)
    exact(data, {'session_token', 'command'})
    command = data['command']
    if not isinstance(command, dict): raise ValueError()
    try:
        principal = SessionPrincipal(data['session_token'])
        action = command.get('action')
        if action == 'list':
            exact(command, {'action'}); return reply(service.list_queries(principal))
        if action == 'submit':
            exact(command, {'action', 'id', 'store_ids', 'utterance'}, {'recover'})
            value, status = service.submit(principal, command['id'], command['store_ids'], command['utterance'],
                                           recover=command.get('recover', False))
            return reply(value, status)
        if action in {'status', 'result'}:
            exact(command, {'action', 'id'})
            return reply(service.read(principal, command['id'], result=action == 'result'))
        if action == 'clarify':
            exact(command, {'action', 'id', 'request_id', 'expected_revision', 'answer'}, {'recover'})
            value, status = service.clarify(principal, command['id'], command['request_id'],
                command['expected_revision'], command['answer'], recover=command.get('recover', False))
            return reply(value, status)
        if action == 'cancel':
            exact(command, {'action', 'id', 'request_id'})
            return reply(service.cancel(principal, command['id'], command['request_id']))
        if action=='feedback':
            exact(command,{'action','id'})
            from alisa_platform.query_insights.service import wrong_semantics
            return reply(wrong_semantics(principal,command['id']))
        raise ValueError()
    except RuntimeFailure as error:
        return reply({'code': error.code, 'outcome': error.outcome}, error.http_status)
