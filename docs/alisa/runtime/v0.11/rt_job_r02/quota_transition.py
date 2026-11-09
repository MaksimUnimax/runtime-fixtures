"""Explicit owner-authorized removal of quota policy for already queued work.
Run with workers stopped. No HTTP, secrets, ledger reset or failed-job replay.
"""
from copy import deepcopy
from dataclasses import asdict
from semantics import canonical_json,strict_json,fingerprint,Rejected


def migrate_waiting(repo,scope_for,old_policy,new_policy,old_daily_limit,now):
    if (new_policy.get('max_model_steps')is not None or new_policy.get('max_provider_calls')is not None
        or new_policy.get('enabled')is not True):raise Rejected('QUOTA_TRANSITION_POLICY')
    old_binding={'pin':old_policy['pin'],'policy_hash':fingerprint(old_policy)}
    new_binding={'pin':new_policy['pin'],'policy_hash':fingerprint(new_policy)}
    changes=[];skipped=[]
    with repo.connection(True)as c:
        if c.execute("SELECT 1 FROM jobs WHERE state='RUNNING'LIMIT 1").fetchone():raise Rejected('RUNNING_JOB_TRANSITION')
        recent=c.execute("SELECT at FROM calls WHERE source='model:deepseek-flash'AND at>?ORDER BY at",(now-86400,)).fetchall()
        old_daily_due=recent[-old_daily_limit]['at']+86400 if len(recent)>=old_daily_limit else None
        rate=c.execute("SELECT not_before FROM rates WHERE source='model:deepseek-flash'").fetchone()
        real_not_before=max(now,rate['not_before'])if rate else now
        for row in c.execute("SELECT *FROM jobs WHERE state='QUEUED'ORDER BY created,id").fetchall():
            if not row['plan']:continue
            plan=strict_json(row['plan']);binding=plan.get('universal_read')
            if binding!=old_binding:continue
            try:
                scope=scope_for(row['tenant']);stores={s.id:asdict(s)for s in scope.stores}
                allowed=scope.tenant==plan['tenant']and scope.revision==plan['access_revision']and all(stores.get(s['id'])==s for s in plan['stores'])
            except (Rejected,KeyError,TypeError):allowed=False
            if not allowed:skipped.append({'job_id':row['id'],'reason':'CURRENT_ACCESS_CHANGED'});continue
            upgraded=deepcopy(plan);upgraded['universal_read']=new_binding
            original_without=deepcopy(plan);original_without.pop('universal_read')
            new_without=deepcopy(upgraded);new_without.pop('universal_read')
            if original_without!=new_without:raise Rejected('REQUEST_MUTATION_FORBIDDEN')
            key='p:'+fingerprint(upgraded)
            collision=c.execute('SELECT jid FROM slots WHERE tenant=?AND key=?',(row['tenant'],key)).fetchone()
            if collision and collision['jid']!=row['id']:raise Rejected('QUOTA_TRANSITION_KEY_COLLISION')
            progress=strict_json(row['progress'])if row['progress']else{}
            was_model_wait=not progress.get('pending') and old_daily_due is not None and abs(row['due']-old_daily_due)<0.01
            due=real_not_before if was_model_wait else row['due']
            c.execute('UPDATE jobs SET plan=?,key=?,due=?,updated=?WHERE id=?AND state=\'QUEUED\'',(canonical_json(upgraded),key,due,now,row['id']))
            c.execute('DELETE FROM slots WHERE tenant=?AND key=?AND jid=?',(row['tenant'],row['key'],row['id']))
            c.execute('INSERT OR REPLACE INTO slots(tenant,key,jid)VALUES(?,?,?)',(row['tenant'],key,row['id']))
            changes.append({'job_id':row['id'],'old_plan_hash':fingerprint(plan),'new_plan_hash':fingerprint(upgraded),
                'job_identity_and_request_preserved':True,'progress_unchanged':True,'daily_wait_removed':was_model_wait,
                'old_due':row['due'],'new_due':due,'provider_backoff_preserved':due>=real_not_before if was_model_wait else True})
    return {'changed':changes,'skipped':skipped,'ledger_rows_deleted':0,'failed_or_cancelled_jobs_requeued':0}
