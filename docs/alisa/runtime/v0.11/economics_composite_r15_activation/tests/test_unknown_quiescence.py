"""Real disposable SQLite: retained UNKNOWN is neither active work nor resolved."""
import json
import unittest
from unittest.mock import patch
import test_readiness as fixture

r = fixture.r
NOW = fixture.NOW

class QuiescentUnknown(unittest.TestCase):
    setUp = fixture.NativeReadiness.setUp
    database = staticmethod(fixture.NativeReadiness.database)
    job = fixture.NativeReadiness.job
    sample = fixture.NativeReadiness.sample

    def tombstone(self):
        self.job('UNKNOWN')
        self.state.execute("UPDATE jobs SET draft='{}',created=?,updated=?,error='NETWORK_OUTCOME_UNKNOWN' WHERE id=?",
                           (NOW-100000, NOW-95000, str(self.sequence)))
        self.state.commit()

    def idle(self):
        return r.check_idle(self.sample(), dict.fromkeys(r.POSTGRES_KEYS, 0))

    def test_retained_unknown_is_reported_unchanged_and_does_not_mean_resolved(self):
        self.tombstone()
        before = list(self.state.iterdump())
        counts = self.sample()
        self.assertEqual(counts['native_unknown_jobs'], 1)
        self.assertEqual(counts['native_quiescent_unknown_jobs'], 1)
        self.assertEqual(self.idle(), {'idle': True})
        self.assertEqual(before, list(self.state.iterdump()))
        self.assertEqual(self.state.execute('SELECT state,error FROM jobs').fetchone(),
                         ('UNKNOWN', 'NETWORK_OUTCOME_UNKNOWN'))

    def test_current_or_incomplete_unknown_still_blocks(self):
        self.tombstone()
        changes = [dict(updated=NOW-10), dict(created=0), dict(updated=None),
                   dict(updated=NOW+1), dict(created=NOW+1), dict(draft='{"question":"private"}'),
                   dict(plan='{}'), dict(progress='{}'), dict(result='{}'), dict(owner='worker'),
                   dict(lease=NOW-1), dict(expires=NOW-1), dict(alias='other'), dict(error=None)]
        for fields in changes:
            with self.subTest(fields=list(fields)):
                self.state.execute('SAVEPOINT mutation')
                try:
                    assignments=','.join(name+'=?' for name in fields)
                    try:
                        self.state.execute('UPDATE jobs SET '+assignments, tuple(fields.values()))
                    except Exception:
                        # Non-null schema itself rejects invalid timestamps.
                        self.assertIn('updated', fields)
                        continue
                    self.state.execute('RELEASE mutation')
                    with self.assertRaises(r.Blocked): self.idle()
                finally:
                    self.state.rollback()
                    self.state.execute('DELETE FROM jobs');self.state.commit();self.tombstone()

    def test_one_fresh_unknown_prevents_allowing_the_old_tombstone(self):
        self.tombstone();self.job('UNKNOWN')
        counts = self.sample()
        self.assertEqual((counts['native_unknown_jobs'],counts['native_quiescent_unknown_jobs']), (2,1))
        with self.assertRaisesRegex(r.Blocked, '^READINESS_BUSY$'):self.idle()

    def test_active_work_and_pending_delivery_still_block_with_tombstones(self):
        self.tombstone()
        native=self.sample();postgres=dict.fromkeys(r.POSTGRES_KEYS,0)
        for target in (native,postgres):
            for key in tuple(target):
                if key in ('native_unknown_jobs','native_quiescent_unknown_jobs'):continue
                with self.subTest(key=key):
                    target[key]=1
                    with self.assertRaisesRegex(r.Blocked,'^READINESS_BUSY$'):r.check_idle(native,postgres)
                    target[key]=0

    def test_impossible_quiescent_count_is_not_accepted(self):
        native=dict.fromkeys(r.NATIVE_KEYS,0)
        native['native_quiescent_unknown_jobs']=1
        with self.assertRaisesRegex(r.Blocked,'^READINESS_SCHEMA$'):
            r.check_idle(native,dict.fromkeys(r.POSTGRES_KEYS,0))

    def test_real_repository_keeps_unknown_across_retention_restart_and_refresh(self):
        import subprocess, sys
        from pathlib import Path
        native=Path(__file__).resolve().parents[2]/'rt_job_r02'
        script = """
import sys
sys.path.insert(0,sys.argv[1])
from pathlib import Path
from repository import Repository
import retention
now=[1700000000.0]
repo=Repository(Path(sys.argv[2])/'actual.sqlite3',clock=lambda:now[0])
draft={'refresh':False,'question':'synthetic exact key'}
row,status=repo.enqueue('tenant','first','a'*64,draft,None,'scope',update_pointer=False)
claimed=repo.claim();assert claimed is not None
repo.fail(row['id'],claimed['owner'],'NETWORK_OUTCOME_UNKNOWN',unknown=True)
with repo.connection(True) as c:c.execute('UPDATE jobs SET resume_safe=1 WHERE id=?',(row['id'],))
now[0]+=100000
retention.sweep(repo)
repo=Repository(repo.path,clock=lambda:now[0])
assert repo.claim() is None
with repo.connection() as c:
    record=c.execute('SELECT state,error,draft,plan,result,progress FROM jobs WHERE id=?',(row['id'],)).fetchone()
    assert tuple(record)==('UNKNOWN','NETWORK_OUTCOME_UNKNOWN','{}',None,None,None),tuple(record)
    assert c.execute('SELECT jid FROM slots').fetchone()[0]==row['id']
# Exact duplicate still JOINs the tombstone after ingress receipt expires.
second,status=repo.enqueue('tenant','second','a'*64,draft,None,'scope',update_pointer=False)
assert status=='JOIN' and second['id']==row['id'] and second['state']=='UNKNOWN'
# A canonical refresh cannot bypass the existing UNKNOWN identity either.
assert repo._reusable(second,True,True) is True
assert repo.claim() is None and repo.call_count()==0
print('actual repository retained UNKNOWN; no dispatch and no replay')
"""
        result=subprocess.run([sys.executable,'-I','-B','-c',script,str(native),str(self.root)],
                              capture_output=True,text=True,timeout=10)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('no dispatch and no replay',result.stdout)

if __name__=='__main__':unittest.main()
