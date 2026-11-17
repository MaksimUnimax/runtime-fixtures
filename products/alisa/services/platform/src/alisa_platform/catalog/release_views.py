"""Existing staff/BFF authentication with an explicit bounded editor body."""
from functools import partial
from django.conf import settings
from django.core.exceptions import ObjectDoesNotExist
from django.db import transaction
from alisa_platform.foundation.views import reply
from alisa_platform.staff.views import boundary
from alisa_platform.runtime_adapter.job_client import RuntimeFailure
from . import changes
from .bridge import NativeCatalog
from .package_rules import ReleaseFailure,exact,need


@partial(boundary,body_limit=32768)
def handle(request,data):
 if not getattr(settings,'CATALOG_RELEASE_ENABLED',False):return reply({'code':'NOT_FOUND'},404)
 try:
  exact(data,{'session_token','action','filters'})
  action=data['action'];need(type(action)is str and type(data['filters'])is dict,'CATALOG_INPUT_INVALID')
  token=data['session_token'];filters=data['filters']
  if action in {'info','templates'}:
   if action=='info':exact(filters,set())
   with transaction.atomic():who=changes.actor(token,action)
   native=NativeCatalog();result=native.info()if action=='info'else native.templates(filters)
   with transaction.atomic():changes.final(token,action,who)
  elif action in {'list','draft.read','release.read','draft.create','draft.edit','approve'}:
   result=changes.fast(action,filters,token)
  elif action=='validate':result=changes.validate(filters,token)
  elif action in {'publish','rollback','retry'}:result=changes.publish(action,filters,token)
  else:raise ReleaseFailure('CATALOG_ACTION_INVALID')
  state=result.get('state')
  return reply(result,422 if result.get('valid')is False else
    202 if state=='PENDING'else 409 if state in {'CONFLICT','SUPERSEDED'}else 200)
 except ObjectDoesNotExist:return reply({'code':'NOT_FOUND'},404)
 except RuntimeFailure as error:return reply({'code':error.code},error.http_status)
 except ReleaseFailure as error:
  status=(403 if error.code=='CATALOG_FORBIDDEN'else
          409 if any(x in error.code for x in ['CONFLICT','PENDING'])else
          503 if error.code=='CATALOG_RELEASE_UNAVAILABLE'else 422)
  return reply({'code':error.code},status)
