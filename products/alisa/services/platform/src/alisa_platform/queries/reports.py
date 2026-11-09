"""Read-only 48-hour marketplace documents, independent of short Query/job TTL."""
from django.conf import settings
from alisa_platform.accounts.views import boundary, exact
from alisa_platform.foundation.views import reply
from alisa_platform.runtime_adapter.authority import SessionPrincipal
from alisa_platform.runtime_adapter.job_client import RuntimeFailure, identifier
from .service import client


@boundary
def reports(request, data):
    if not getattr(settings,'QUERIES_ENABLED',False): return reply({'code':'NOT_FOUND'},404)
    exact(data, {'session_token','store_id','command'})
    command=data['command']
    if not isinstance(command,dict): raise ValueError()
    try:
        principal=SessionPrincipal(data['session_token'])
        api=client(principal,[identifier(data['store_id'])])
        if command.get('action')=='list':
            exact(command,{'action','cursor'})
            return reply(api.list_reports(command['cursor']))
        if command.get('action')=='read':
            exact(command,{'action','id','offset'})
            return reply(api.read_report(command['id'],command['offset']))
        raise ValueError()
    except RuntimeFailure as error:
        return reply({'code':error.code},error.http_status)
