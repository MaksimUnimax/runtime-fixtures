"""Read-only installed checks; never creates a session, grant, query or test event."""
import json,os,sqlite3,subprocess,sys,time,urllib.error,urllib.request
from pathlib import Path
ROOT=Path('/root/alisa-s08-install-d11a9f2a-20261110')
APP=Path('/opt/alisa-platform/stage/releases/alisa-query-insights-f4127277e9c25557')
def need(ok,code):
    if not ok:raise RuntimeError(code)
def env(unit):
    pid=subprocess.check_output(['systemctl','show',unit,'--value','-p','MainPID'],text=True).strip()
    need(pid.isdigit()and int(pid)>1,'SERVICE_NOT_RUNNING')
    return {k.decode():v.decode()for item in Path('/proc/'+pid+'/environ').read_bytes().split(b'\0')if b'='in item for k,v in[item.split(b'=',1)]}
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None
def http(port,path,*,origin=None,body=None):
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
    headers={}
    if origin:headers.update(Origin=origin,Host=origin.split('://',1)[1])
    if body is not None:headers['Content-Type']='application/json'
    request=urllib.request.Request('http://127.0.0.1:'+str(port)+path,headers=headers,data=None if body is None else json.dumps(body).encode())
    try:
        with opener.open(request,timeout=6)as r:return r.status,json.loads(r.read(8192))
    except urllib.error.HTTPError as e:return e.code,{}
def verify():
    need(os.geteuid()==0,'ROOT_REQUIRED')
    runtime=env('alisa-platform@stage');need(runtime.get('ALISA_RELEASE')==APP.name and runtime.get('ALISA_QUERY_INSIGHTS_ENABLED')=='1','WRONG_RELEASE')
    os.environ.update(runtime);sys.path.insert(0,str(APP/'services/platform/src'))
    import django
    django.setup()
    from django.db import connection
    from alisa_platform.query_insights.models import Coverage,Episode,Inbox,Feedback
    from alisa_platform.query_insights.service import journal
    from django.utils import timezone
    with connection.cursor()as c:
        c.execute('SET default_transaction_read_only=on')
        c.execute('SELECT current_user');need(c.fetchone()[0]=='alisa_stage_platform_runtime','WRONG_DB_ROLE')
        c.execute("SELECT count(*)FROM django_migrations WHERE app='query_insights'AND name='0001_initial'");need(c.fetchone()[0]==1,'MIGRATION_MISSING')
    streams=list(Coverage.objects.filter(internal_test=False));now=timezone.now()
    need({s.kind for s in streams}=={'template_misses','terminal_outcomes'},'STREAM_MISSING')
    need(all((now-s.seen_at).total_seconds()<180 for s in streams),'STREAM_STALE')
    data=journal({});need('items'in data and type(data['coverage']['complete'])is bool,'JOURNAL_READ_FAILED')
    health={}
    for port in [18100,18101,18102]:
        status,result=http(port,'/health/ready');need(status==200 and result.get('release')==APP.name,'HEALTH_FAILED');health[str(port)]=result
    gates={}
    for port,path,origin,body in [
      (18101,'/api/staff/query-insights','https://alisa-admin.octoport.ru',{'action':'list','filters':{}}),
      (18100,'/api/v1/queries/00000000-0000-4000-8000-000000000001/feedback','https://alisa.octoport.ru',{})]:
        status,_=http(port,path,origin=origin,body=body);need(status in[401,403],'UNAUTHENTICATED_ROUTE_OPEN');gates[path]=status
    status,_=http(18101,'/admin/query-insights',origin='https://alisa-admin.octoport.ru');need(status in[302,303,307,308],'STAFF_PAGE_OPEN');gates['/admin/query-insights']=status
    with sqlite3.connect('file:/var/lib/alice-market/state.sqlite3?mode=ro',uri=True,timeout=2)as c:
        c.execute('PRAGMA query_only=ON')
        need(c.execute("SELECT count(*)FROM sqlite_master WHERE type='trigger'AND name LIKE'gap_%_v1'").fetchone()[0]==9,'TERMINAL_TRIGGERS_MISSING')
        pending=c.execute('SELECT count(*)FROM gap_terminal_outbox').fetchone()[0]
        work={k:v for k,v in c.execute('SELECT state,count(*)FROM jobs GROUP BY state')}
    report={'status':'INSTALLED_TECHNICAL_CHECKS_PASS','source_sha':'f4127277e9c25557b02c25eb73e21477affd995c',
      'health':health,'unauthenticated_gates':gates,'counts':{'episodes':Episode.objects.count(),'inbox':Inbox.objects.count(),'feedback':Feedback.objects.count()},
      'streams':[{'kind':s.kind,'fresh_seconds':round((now-s.seen_at).total_seconds(),2),'dropped':s.dropped,'pending_bytes':s.pending_bytes}for s in streams],
      'journal_default_window_complete':data['coverage']['complete'],'terminal_pending':pending,'native_work_counts':work,
      'live_test_sessions_grants_queries_events_created':0,'verification_model_or_marketplace_calls':0,'live_owner_acceptance':'NOT_PERFORMED'}
    connection.close();(ROOT/'INSTALLED_VERIFIED.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
if __name__=='__main__':
    try:verify()
    except Exception as e:print(json.dumps({'status':'BLOCKED','error_type':type(e).__name__}));raise SystemExit(1)
