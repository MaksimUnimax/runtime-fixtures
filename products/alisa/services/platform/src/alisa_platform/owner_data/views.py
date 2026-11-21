from alisa_platform.accounts.views import boundary,exact
from alisa_platform.foundation.views import reply
from . import service
from .owner_inputs import strict_loads

@boundary
def owner_data(request,data):
    # Preserve the existing service-authenticated POST boundary. Reject duplicate
    # keys rather than accepting a last-wins approval flag.
    data=strict_loads(request.body.decode('utf-8'))
    exact(data,{'session_token','command'})
    try:return reply(service.execute(data['session_token'],data['command']))
    except service.Rejected as error:return reply({'code':error.code},error.status)


@boundary
def owner_products(request,data):
    data=strict_loads(request.body.decode('utf-8'));exact(data,{'session_token','store_id','cursor'})
    from .products import page
    try:return reply(page(data['session_token'],data['store_id'],data['cursor']))
    except service.Rejected as error:return reply({'code':error.code},error.status)
