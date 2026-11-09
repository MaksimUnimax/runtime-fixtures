"""Bounded housekeeping of the original OAuth/demo database only.
Active tokens and active work are untouched. No secrets are fetched or printed.
"""
from __future__ import annotations
import argparse,json,time
from datetime import datetime,timezone,timedelta
from pathlib import Path
from retention import MaintenanceRepository,compact,BATCH,PAYLOAD_TTL,REPLAY_TTL


def sweep(repo,batch=BATCH):
    if type(batch)is not int or not 1<=batch<=1000:raise ValueError('batch')
    now=repo.clock();out={}
    with repo.connection(True) as c:
        tables={r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        def run(name,sql,args):out[name]=c.execute(sql,args).rowcount
        for table in ('forms','codes','tokens'):
            if table in tables:
                run('expired_'+table,'DELETE FROM '+table+' WHERE rowid IN (SELECT rowid FROM '+table+' WHERE expires<=? LIMIT ?)',(now,batch))
        if 'replies' in tables:
            run('old_web_replies','DELETE FROM replies WHERE rowid IN (SELECT rowid FROM replies WHERE created<=? ORDER BY created LIMIT ?)',(now-REPLAY_TTL,batch))
            # Keep key/request_hash so repeat delivery is recognized, not re-executed.
            stub=json.dumps({'response':{'text':'Срок хранения учебного ответа истёк. Повторите вопрос новым сообщением.','tts':'Срок хранения учебного ответа истёк. Повторите вопрос новым сообщением.','end_session':False},'version':'1.0'},ensure_ascii=False)
            run('old_web_payloads','UPDATE replies SET response=? WHERE rowid IN (SELECT rowid FROM replies WHERE created<=? AND response!=? LIMIT ?)',(stub,now-PAYLOAD_TTL,stub,batch))
        if 'jobs' in tables:
            run('old_demo_jobs',"DELETE FROM jobs WHERE id IN (SELECT id FROM jobs WHERE status NOT IN ('queued','running','unknown') AND created<=? LIMIT ?)",(now-REPLAY_TTL,batch))
        if 'llm_jobs' in tables:
            run('old_llm_payloads',"UPDATE llm_jobs SET question='',result=NULL,status=CASE WHEN status='ready' THEN 'expired' ELSE status END WHERE id IN (SELECT id FROM llm_jobs WHERE status NOT IN ('queued','running') AND COALESCE(finished,created)<=? AND (question!='' OR result IS NOT NULL) LIMIT ?)",(now-PAYLOAD_TTL,batch))
            run('old_llm_jobs',"DELETE FROM llm_jobs WHERE id IN (SELECT id FROM llm_jobs WHERE status NOT IN ('queued','running','unknown') AND COALESCE(finished,created)<=? LIMIT ?)",(now-REPLAY_TTL,batch))
        if 'llm_daily' in tables:
            cutoff=(datetime.fromtimestamp(now,timezone.utc)-timedelta(days=7)).date().isoformat()
            run('old_model_counters','DELETE FROM llm_daily WHERE date<?',(cutoff,))
    return out


def maintain(path):
    repo=MaintenanceRepository(path);start=time.monotonic();counts={};passes=0
    while passes<10 and time.monotonic()-start<2:
        changed=sweep(repo);passes+=1
        for k,v in changed.items():counts[k]=counts.get(k,0)+v
        if not any(changed.values()):break
    stats,checkpoint=compact(repo)
    return {'utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'removed_or_redacted':counts,'passes':passes,'database':stats,'checkpoint':checkpoint,'elapsed_ms':round((time.monotonic()-start)*1000),'active_tokens_revoked':False,'credentials_read':False,'network_calls':0}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--database',required=True);p.add_argument('--status-file');a=p.parse_args();r=maintain(a.database)
    if a.status_file:
        dest=Path(a.status_file);tmp=dest.with_suffix('.tmp');tmp.write_text(json.dumps(r,indent=2));tmp.chmod(0o600);tmp.replace(dest)
    print(json.dumps(r))
