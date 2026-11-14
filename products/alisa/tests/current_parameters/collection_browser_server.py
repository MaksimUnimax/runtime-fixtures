"""Actual LK backend/private RPC/Worker for isolated browser acceptance only."""
from pathlib import Path
from socketserver import ThreadingMixIn
from wsgiref.simple_server import WSGIServer,WSGIRequestHandler,make_server
import os,sys,json,threading
ROOT=Path(__file__).resolve().parents[2]
native=Path(os.environ['PARAMETER_TEST_RUNTIME_ROOT']).resolve()
assert '/opt/'not in str(native)and (native/'parameter_collection_runtime.py').is_file()
sys.path[:0]=[str(ROOT/'services/platform/src'),str(ROOT/'tests'),str(native),str(native/'tests'),str(ROOT.parents[1]/'docs/alisa/runtime/v0.11/current_parameters_r4/tests')]
os.environ['DJANGO_SETTINGS_MODULE']='current_parameters.collection_settings'
import django
django.setup()
from django.conf import settings
settings.ALLOWED_HOSTS=['127.0.0.1','localhost','testserver'];settings.ROOT_URLCONF='current_parameters.collection_browser_server'
from django.core.management import call_command
from django.core.handlers.wsgi import WSGIHandler
from django.urls import path
from django.http import JsonResponse
from django.db import transaction,connections
from alisa_platform.accounts.views import me,boundary,exact
from alisa_platform.stores.views import stores
from alisa_platform.owner_data.parameter_views import parameters
from alisa_platform.owner_data.service import actor_store
from alisa_platform.owner_data.parameter_service import sku_reference
from alisa_platform.owner_data.models import CurrentParameter,OwnerCommand
from alisa_platform.queries.models import Query
from current_parameters.collection_fixture import Environment
ENV=None
LOCK=threading.Lock()

@boundary
def products(request,data):
    exact(data,{'session_token','store_id','cursor'})
    with transaction.atomic():
        actor,store=actor_store(data['session_token'],data['store_id'])
        return JsonResponse({'items':[{'sku':'123','name':'Тестовый товар','offer_id':'SYNTHETIC-123','parameter_reference':sku_reference(actor,store,'123')}],'complete':True,'next_cursor':None,'store_id':str(store.pk),'provider':'OZON'})

@boundary
def control(request,data):
    # Never installed in the product router. Test-only driver uses genuine Worker.
    if data['action']=='finish':
        with LOCK:row=ENV.finish()
        return JsonResponse({'state':row['state'],'error':row['error']})
    if data['action']=='state':
        with ENV.repo.connection()as db:jobs=db.execute('SELECT COUNT(*)FROM jobs').fetchone()[0]
        return JsonResponse({'queries':Query.objects.count(),'jobs':jobs,'writes':OwnerCommand.objects.count(),
          'parameters':list(CurrentParameter.objects.values('key','value','origin','revision','collected_at','calculated_at','evidence')),
          'model_calls':sum(x.operation in('template_select','model_answer')for x in ENV.transport.calls),
          'selector_calls':sum(x.operation=='template_select'for x in ENV.transport.calls),'provider_calls':sum(bool(x.store_id)for x in ENV.transport.calls)})
    return JsonResponse({'code':'NOT_FOUND'},status=404)

urlpatterns=[path('api/v1/account/me',me),path('api/v1/account/stores',stores),path('api/v1/account/owner-products',products),path('api/v1/account/parameters',parameters),path('__test/control',control)]
class Server(ThreadingMixIn,WSGIServer):daemon_threads=True
class Quiet(WSGIRequestHandler):
    def log_message(self,*a):pass

def main():
    global ENV
    # Fixed isolated Unix socket and parameter_test DB are enforced in settings.
    call_command('migrate',verbosity=0,interactive=False);call_command('flush',verbosity=0,interactive=False)
    ENV=Environment();ENV.setup();srv=make_server('127.0.0.1',0,WSGIHandler(),server_class=Server,handler_class=Quiet)
    path=Path(os.environ['PARAMETER_BROWSER_FIXTURE']);path.write_text(json.dumps({'port':srv.server_port,'session_token':ENV.token,'store_id':str(ENV.store.pk),'tenant_id':str(ENV.tenant.pk),'customer_id':str(ENV.customer.pk),'service':settings.AUTH_SERVICE_TOKEN}));path.chmod(0o600)
    print('COLLECTION_BROWSER_REAL_STACK_READY',flush=True)
    try:srv.serve_forever()
    finally:ENV.close();path.unlink(missing_ok=True)
if __name__=='__main__':
    sys.modules['current_parameters.collection_browser_server']=sys.modules[__name__]
    main()
