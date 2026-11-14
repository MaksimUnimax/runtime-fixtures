"""Same authenticated account boundary as owner costs; no public calculated write."""
from alisa_platform.accounts.views import boundary,exact
from alisa_platform.foundation.views import reply
from .owner_inputs import strict_loads
from . import parameter_service
from .service import Rejected

@boundary
def parameters(request,data):
    data=strict_loads(request.body.decode('utf-8'));exact(data,{'session_token','command'})
    try:return reply(parameter_service.execute(data['session_token'],data['command']))
    except Rejected as e:return reply({'code':e.code},e.status)
