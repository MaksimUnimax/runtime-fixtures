"""One owner-authorized read-only canary, without a production qualification grant."""
from pathlib import Path
from collections import Counter
import hashlib,json,os,sqlite3,sys,time,urllib.request

CORE=Path('/opt/alice-market/releases/current').resolve()
ROOT=Path('/root/alice-lab-evidence/answer-model-20261109')
OUT=ROOT/'WB_CAMPAIGNS_CANARY_20261113.json'
CONFIG=Path('/etc/alice-market/market-runtime.json')
OP='ds_wb_campaigns'
sys.path.insert(0,str(CORE))
from http_transport import HTTPTransport,DATASET_SOURCES
from platform_store_credentials import dynamic
from shared_http import read_response
from semantics import strict_json
from dataset_pipeline import HASH as QUERY_HASH
from registry import REGISTRY_HASH

assert not OUT.exists(),'CANARY_ALREADY_RECORDED'
assert CORE.name=='alisa-dataset-selector-metadata-r1-20261113'
config_bytes=CONFIG.read_bytes();config=strict_json(config_bytes.decode())
receipt=json.loads((ROOT/'SIMPLE123_PRIVATE_20261113.json').read_text())
with sqlite3.connect('file:'+config['database']+'?mode=ro',uri=True)as c:
    assert c.execute("SELECT count(*)FROM jobs WHERE state IN ('QUEUED','RUNNING')").fetchone()[0]==0
    raw=c.execute('SELECT plan FROM jobs WHERE id=?AND tenant=?',(receipt['job_id'],receipt['tenant'])).fetchone()[0]
plan=strict_json(raw);stores=[s for s in plan['stores']if s['platform']=='wb'];assert len(stores)==1
store=stores[0];assert not dynamic(store),'DYNAMIC_STORE_REQUIRES_AUTHORITY_EXECUTION_SCOPE'
assert any(a.get('active')is True and a['revision']==plan['access_revision'] and store in a['stores']for a in config['accounts'].values()),'STORE_SCOPE_CHANGED'
transport=HTTPTransport('/run/credentials/alice-market.service',config['credential_bindings'],config['qualifications'],enabled=True)
method,url,headers,body=DATASET_SOURCES.http(OP,{},store,transport._store_credentials(store))
assert method=='GET'and body is None
started=time.time();dispatched=[]
request=urllib.request.Request(url,headers=headers,method=method)
raw,status=read_response(request,timeout=25,limit=6000000,on_dispatch=lambda:dispatched.append(True))
assert status==200 and dispatched,'HTTP_CANARY_NOT_SUCCESSFUL'
data=strict_json(raw.decode());period={'from':plan['calendar_date'],'to':plan['calendar_date']}
decoded=DATASET_SOURCES.decode(OP,data,{'table':{'view':'wb_campaign_inventory'},'filters':{}},store,{'period':period})
assert decoded['complete']is True and decoded['progress']is None
assert type(data)is dict and type(data.get('all'))is int and data['all']>=0
groups=data.get('adverts',[]);assert type(groups)is list
ids=[];statuses=Counter()
for group in groups:
    rows=group['advert_list'];assert type(rows)is list
    if 'count'in group:assert type(group['count'])is int and group['count']==len(rows)
    for row in rows:
        assert type(row['advertId'])is int and row['advertId']>0
        ids.append(row['advertId']);statuses[str(group['status'])]+=1
assert len(ids)==len(set(ids))==data['all']==len(decoded['rows'])
assert CONFIG.read_bytes()==config_bytes,'CONFIG_CHANGED_DURING_CANARY'
record={'schema':'alisa-read-only-source-canary/v1','operation':OP,'observed_at':started,
        'http':status,'external_dispatches':1,'paid_model_calls':0,'response_sha256':hashlib.sha256(raw).hexdigest(),
        'response_bytes':len(raw),'complete':True,'source_reported_total':data['all'],
        'decoded_rows':len(decoded['rows']),'unique_campaign_ids':len(set(ids)),'status_counts':dict(statuses),
        'store_scope':{k:store[k]for k in('id','identity','access_revision','source_revision','platform')},
        'registry_hash':REGISTRY_HASH,'dataset_source_hash':DATASET_SOURCES.hash,'dataset_query_hash':QUERY_HASH,
        'source_recipe_hash':DATASET_SOURCES.fingerprint(OP),'token_class':'personal',
        'config_sha256':hashlib.sha256(config_bytes).hexdigest(),'runtime_release':CORE.name,
        'source_payload_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
fd=os.open(OUT,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w')as f:json.dump(record,f,ensure_ascii=False,indent=2);f.write('\n')
print(json.dumps({k:record[k]for k in('http','external_dispatches','paid_model_calls','complete','source_reported_total','decoded_rows','unique_campaign_ids','status_counts')},ensure_ascii=False))
