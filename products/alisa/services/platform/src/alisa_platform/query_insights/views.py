from django.db import transaction
from alisa_platform.foundation.views import reply
from alisa_platform.accounts.views import exact
from alisa_platform.staff.views import boundary
from alisa_platform.staff.service import principal,audit
from alisa_platform.runtime_adapter.job_client import RuntimeFailure
from . import service

@boundary
def staff(request,data):
    exact(data,{'session_token','action','filters'})
    if data['action']not in {'list','export'}:raise ValueError()
    try:
        service.enabled()
        permission='insights.export'if data['action']=='export'else'insights.read'
        with transaction.atomic():
            actor=principal(data['session_token'],permission)
            if actor is None:return reply({'code':'FORBIDDEN'},403)
            result=service.journal(data['filters'],export=data['action']=='export')
            # Audit counts only; never put question text or filters in staff audit.
            audit(actor,'query_insights.'+data['action'],None,'STAFF_READ','READ',after={'count':len(result['items'])})
            if principal(data['session_token'],permission)is None:return reply({'code':'FORBIDDEN'},403)
            return reply(result)
    except RuntimeFailure as error:return reply({'code':error.code},error.http_status)
