from django.db import transaction
from alisa_platform.foundation.views import reply
from alisa_platform.accounts.views import exact
from alisa_platform.staff.views import boundary
from alisa_platform.staff.service import principal,audit
from alisa_platform.runtime_adapter.job_client import RuntimeFailure
from . import service
from . import demand

@boundary
def staff(request,data):
    exact(data,{'session_token','action','filters'})
    action=data['action']
    if type(action)is not str:raise ValueError()
    demand_action=action[7:]if type(action)is str and action.startswith('demand.')else None
    if action not in {'list','export'}and demand_action not in {'list','refresh','policy','merge','split','create','update'}:raise ValueError()
    try:
        service.enabled()
        permission=('staff.manage'if demand_action and demand_action!='list'else
                    'insights.export'if action=='export'else'insights.read')
        with transaction.atomic():
            actor=principal(data['session_token'],permission)
            if actor is None:return reply({'code':'FORBIDDEN'},403)
            if demand_action:
                result=(demand.listing(data['filters'],actor=actor)if demand_action=='list'else
                        demand.command(demand_action,data['filters'],actor))
            else:result=service.journal(data['filters'],export=action=='export')
            # Audit counts only; never put question text or filters in staff audit.
            audit(actor,'query_insights.'+action,None,'STAFF_READ',
                  'APPLIED'if demand_action and demand_action!='list'else'READ',
                  after={'count':len(result.get('items',[]))})
            if principal(data['session_token'],permission)is None:
                # A response code alone would commit an earlier mutation.
                raise demand.DemandFailure('FORBIDDEN',403)
            return reply(result)
    except RuntimeFailure as error:return reply({'code':error.code},error.http_status)
    except demand.DemandFailure as error:return reply({'code':error.code},error.status)
    except ValueError:return reply({'code':'DEMAND_VALIDATION_FAILED'},422)
