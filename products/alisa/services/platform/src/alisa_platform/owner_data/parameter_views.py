"""Same authenticated account boundary as owner costs; no public calculated write."""
from alisa_platform.accounts.views import boundary,exact
from alisa_platform.foundation.views import reply
from .owner_inputs import strict_loads
from . import parameter_service
from django.conf import settings
from .service import Rejected
from .parameter_contract import ParameterError
from alisa_platform.runtime_adapter.job_client import RuntimeFailure

@boundary
def parameters(request,data):
    data=strict_loads(request.body.decode('utf-8'));exact(data,{'session_token','command'})
    try:
        command=data['command'];action=command.get('action')if type(command)is dict else None
        if action in('start_calculation','collection_status','recover_collection','cancel_collection'):
            if not getattr(settings,'OWNER_PARAMETER_COLLECTION_ENABLED',False):return reply({'code':'PARAMETER_COLLECTION_NOT_ENABLED'},422)
            from . import parameter_collection
            result=parameter_collection.start(data['session_token'],command)if action=='start_calculation'else parameter_collection.check(data['session_token'],command)
        else:result=parameter_service.execute(data['session_token'],command)
        if action=='prepare_calculation':
            if getattr(settings,'OWNER_PARAMETER_COLLECTION_ENABLED',False):
                from .parameter_collection import readiness
                result['collection']=readiness(data['session_token'],command['store_id'],command['parameter'],command['scope'])
            else:result['collection']={'available':False,'code':'PARAMETER_COLLECTION_NOT_ENABLED'}
        return reply(result)
    except Rejected as e:return reply({'code':e.code},e.status)
    except ParameterError as e:return reply({'code':e.code},422)
    except RuntimeFailure as e:return reply({'code':e.code,'outcome':e.outcome},e.http_status)
