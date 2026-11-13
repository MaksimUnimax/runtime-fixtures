"""Activate exactly one source after a real complete read-only canary."""
from pathlib import Path
from copy import deepcopy
import fcntl,hashlib,json,os,sqlite3,sys,time

CORE=Path('/opt/alice-market/releases/current').resolve()
ROOT=Path('/root/alice-lab-evidence/answer-model-20261109')
PROOF=ROOT/'WB_CAMPAIGNS_CANARY_20261113.json'
CONFIG=Path('/etc/alice-market/market-runtime.json')
BACKUP=ROOT/'MARKET_CONFIG_BEFORE_WB_CAMPAIGNS_20261113.json'
RECORD=ROOT/'WB_CAMPAIGNS_ACTIVATED_20261113.json'
OP='ds_wb_campaigns'
SOURCE=sys.argv[1]
assert len(SOURCE)==40 and all(c in '0123456789abcdef'for c in SOURCE)
sys.path.insert(0,str(CORE))
from http_transport import DATASET_SOURCES
from dataset_pipeline import HASH as QUERY_HASH
from registry import REGISTRY_HASH
from semantics import strict_json

with open('/run/lock/alisa-runtime-recovery.lock','a')as lock:
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    assert Path('/opt/alice-market/releases/current').resolve()==CORE,'RUNTIME_CHANGED_BEFORE_LOCK'
    assert CORE.name=='alisa-dataset-selector-metadata-r1-20261113'
    assert json.loads((CORE/'manifest.json').read_text())['source_commit']=='5f783fcedb93dba01948de9590cd0108cd09df72'
    assert not CONFIG.is_symlink()and not RECORD.exists()and not BACKUP.exists()
    proof=strict_json(PROOF.read_text());raw=CONFIG.read_bytes();old=strict_json(raw.decode());metadata=CONFIG.stat()
    assert hashlib.sha256(raw).hexdigest()==proof['config_sha256'],'CONFIG_CHANGED'
    assert proof['schema']=='alisa-read-only-source-canary/v1'and proof['operation']==OP
    assert proof['http']==200 and proof['complete']is True and proof['external_dispatches']==1 and proof['paid_model_calls']==0
    assert proof['source_reported_total']==proof['decoded_rows']==proof['unique_campaign_ids']
    assert 0<=time.time()-proof['observed_at']<1800,'CANARY_STALE'
    assert proof['registry_hash']==REGISTRY_HASH and proof['dataset_source_hash']==DATASET_SOURCES.hash and proof['dataset_query_hash']==QUERY_HASH
    assert proof['source_recipe_hash']==DATASET_SOURCES.fingerprint(OP)and proof['token_class']=='personal'
    assert hashlib.sha256((ROOT/'qualify_wb_campaigns_20261113.py').read_bytes()).hexdigest()==proof['source_payload_sha256']
    scope=proof['store_scope'];assert scope['platform']=='wb'
    receipt=strict_json((ROOT/'SIMPLE123_PRIVATE_20261113.json').read_text())
    account=old['accounts'].get(receipt['tenant']);assert type(account)is dict and account.get('active')is True,'TENANT_SCOPE_CHANGED'
    stores=[s for s in account['stores']if all(s.get(k)==v for k,v in scope.items())]
    assert len(stores)==1,'STORE_SCOPE_CHANGED'
    matches=[(tenant,s)for tenant,a in old['accounts'].items()if a.get('active')is True for s in a['stores']if all(s.get(k)==v for k,v in scope.items())]
    assert matches==[(receipt['tenant'],stores[0])],'ACCEPTED_TENANT_NOT_UNIQUE'
    with sqlite3.connect('file:'+old['database']+'?mode=ro',uri=True)as c:
        assert c.execute("SELECT count(*)FROM jobs WHERE state IN ('QUEUED','RUNNING')").fetchone()[0]==0,'ACTIVE_JOB'
    assert OP not in old['qualifications']and OP not in old['dataset_capabilities'].get(scope['id'],{})
    new=deepcopy(old)
    transport_proof={'status':'READ_ONLY_CANARY','registry_hash':REGISTRY_HASH,'dataset_source_hash':DATASET_SOURCES.hash,
                     'evidence_ref':str(PROOF),'token_class':'personal'}
    capability={'status':'READ_ONLY_CANARY','dataset_source_hash':DATASET_SOURCES.hash,'dataset_query_hash':QUERY_HASH,
                'evidence_ref':str(PROOF),'token_class':'personal'}
    new['qualifications'][OP]=transport_proof
    new['dataset_capabilities'].setdefault(scope['id'],{})[OP]=capability
    stripped=deepcopy(new);del stripped['qualifications'][OP];del stripped['dataset_capabilities'][scope['id']][OP]
    assert stripped==old,'UNEXPECTED_CONFIG_DELTA'
    fd=os.open(BACKUP,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
    pending=CONFIG.with_name('market-runtime.wb-campaign-next.json')
    fd=os.open(pending,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
        with os.fdopen(fd,'wb')as f:f.write((json.dumps(new,ensure_ascii=False,indent=2)+'\n').encode());f.flush();os.fsync(f.fileno())
        os.chown(pending,metadata.st_uid,metadata.st_gid);os.chmod(pending,metadata.st_mode&0o777)
        assert CONFIG.read_bytes()==raw,'CONFIG_CHANGED_BEFORE_REPLACE'
        assert Path('/opt/alice-market/releases/current').resolve()==CORE,'RUNTIME_CHANGED_BEFORE_REPLACE'
        os.replace(pending,CONFIG)
    finally:pending.unlink(missing_ok=True)
    assert strict_json(CONFIG.read_text())==new
    record={'status':'ACTIVATED','source_commit':SOURCE,'operation':OP,'changed_paths':['qualifications.ds_wb_campaigns','dataset_capabilities.<verified_store>.ds_wb_campaigns'],
            'actual_complete_http_canary':True,'paid_model_calls':0,'before_sha256':hashlib.sha256(raw).hexdigest(),'after_sha256':hashlib.sha256(CONFIG.read_bytes()).hexdigest()}
    fd=os.open(RECORD,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w')as f:json.dump(record,f,indent=2);f.write('\n')
    print(json.dumps(record))
