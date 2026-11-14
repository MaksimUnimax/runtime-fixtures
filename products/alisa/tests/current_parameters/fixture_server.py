"""Actual Django+PostgreSQL for browser qualification, synthetic identities only.

Ozon catalogue/source data below are explicit fixtures, not live marketplace IO.
This file is never in production URL configuration.
"""
from pathlib import Path
from datetime import timedelta
from wsgiref.simple_server import make_server,WSGIServer,WSGIRequestHandler
from socketserver import ThreadingMixIn
import os,sys,json,uuid,threading
ROOT=Path(__file__).resolve().parents[2];sys.path[:0]=[str(ROOT/'services/platform/src'),str(ROOT/'tests')]
os.environ['DJANGO_SETTINGS_MODULE']='current_parameters.settings'
import django
django.setup()
from django.conf import settings
settings.ALLOWED_HOSTS=['127.0.0.1','localhost','testserver'];settings.STORES_ENABLED=True
settings.ROOT_URLCONF='current_parameters.fixture_server'
from django.core.management import call_command
from django.core.handlers.wsgi import WSGIHandler
from django.urls import path
from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from alisa_platform.accounts.views import me,boundary,exact
from alisa_platform.stores.views import stores
from alisa_platform.owner_data.parameter_views import parameters
from alisa_platform.owner_data.service import actor_store
from alisa_platform.owner_data.models import CurrentParameter,OwnerCommand
from alisa_platform.owner_data import parameter_service as service
from current_parameters.test_parameters import Fixture,PERIOD
FIXTURE=None

@boundary
def products(request,data):
    exact(data,{'session_token','store_id','cursor'})
    with transaction.atomic():
        actor,store=actor_store(data['session_token'],data['store_id'])
        return JsonResponse({'items':[{'sku':'123','offer_id':'SYNTHETIC-1','name':'Тестовый оберег','parameter_reference':service.sku_reference(actor,store,'123')}],
            'complete':True,'next_cursor':None,'store_id':str(store.pk),'provider':store.provider})

@boundary
def control(request,data):
    # Synthetic test harness only. Never installed, linked or imported by prod.
    if data.get('action')=='state':
        rows=list(CurrentParameter.objects.values('key','scope_kind','sku','value','origin','collected_at','calculated_at','evidence','revision'))
        receipts=list(OwnerCommand.objects.values_list('result',flat=True))
        return JsonResponse({'rows':rows,'receipts':receipts,'writes':len(receipts)})
    if data.get('action')=='seed_calculated':
        r=service.execute(data['session_token'],{'action':'read','store_id':data['store_id'],'parameter':'loss_rate','scope':{'kind':'store','sku':''},'sku_reference':None})
        q={'action':'replace_calculated','store_id':data['store_id'],'parameter':'loss_rate','scope':{'kind':'store','sku':''},'sku_reference':None,
           'command_id':str(uuid.uuid4()),'expected_revision':r['revision'],'confirmed':True,'not_after':int(timezone.now().timestamp())+120}
        dt=(timezone.now()-timedelta(days=90)).replace(microsecond=0).isoformat()
        env={'producer_template':'parameter.loss_rate.v1','inputs':{'failed_units':'1','ordered_units':'8'},
             'coverage':{'complete':True,'actual_period':PERIOD['actual'],'short_history':False,'scope':{'kind':'store','sku':''}},
             'source_collected_at':{'ordered_physical_units':dt,'unique_failed_units':dt},'observed_until':timezone.now().replace(microsecond=0).isoformat()}
        return JsonResponse(service.commit_calculated(data['session_token'],q,env,PERIOD,verify_sources=lambda *a:True))
    return JsonResponse({'code':'NOT_FOUND'},status=404)

urlpatterns=[path('api/v1/account/me',me),path('api/v1/account/stores',stores),path('api/v1/account/owner-products',products),
             path('api/v1/account/parameters',parameters),path('__test/control',control)]
class Server(ThreadingMixIn,WSGIServer):daemon_threads=True
class Quiet(WSGIRequestHandler):
    def log_message(self,*args):pass

def main():
    global FIXTURE
    # Both the NAME and owned socket are fixed by isolated settings.
    call_command('migrate',verbosity=0,interactive=False)
    call_command('flush',verbosity=0,interactive=False)
    FIXTURE=Fixture();FIXTURE.create()
    server=make_server('127.0.0.1',0,WSGIHandler(),server_class=Server,handler_class=Quiet)
    out={'port':server.server_port,'session_token':FIXTURE.token,'store_id':str(FIXTURE.store.pk),
         'tenant_id':str(FIXTURE.tenant.pk),'customer_id':str(FIXTURE.customer.pk),'service':settings.AUTH_SERVICE_TOKEN}
    destination=Path(os.environ['PARAMETER_BROWSER_FIXTURE']);destination.write_text(json.dumps(out));destination.chmod(0o600)
    print('SYNTHETIC_FIXTURE_READY',flush=True);server.serve_forever()
if __name__=='__main__':main()
