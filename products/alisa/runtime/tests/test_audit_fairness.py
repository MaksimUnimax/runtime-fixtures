"""Fair dispatch across tenants, restart and additive-schema compatibility."""
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from repository import Repository

class FairDispatch(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.temp.name) / 'jobs.db')
        self.repo = Repository(self.path, clock=lambda:100)
    def tearDown(self):
        self.temp.cleanup()
    def add(self, jid, tenant, created=1, due=1):
        with self.repo.connection(True) as c:
            c.execute("INSERT INTO jobs(id,tenant,key,state,draft,created,updated,due) VALUES(?,?,?,'QUEUED','{}',?,1,?)",
                      (jid,tenant,jid,created,due))
    def turn(self):
        row = self.repo.claim()
        self.repo.reschedule(row['id'],row['owner'])
        return row
    def test_long_job_does_not_starve_new_tenant_same_clock(self):
        self.add('old','A');self.add('new','B',created=2)
        self.assertEqual([self.turn()['id'] for _ in range(6)],['old','new']*3)
    def test_many_jobs_do_not_give_one_tenant_more_turns(self):
        for i in range(5):self.add('a'+str(i),'A')
        self.add('b','B')
        turns=[self.turn() for _ in range(10)]
        self.assertEqual([r['tenant'] for r in turns],['A','B']*5)
        self.assertEqual({r['id'] for r in turns if r['tenant']=='A'}, {'a'+str(i) for i in range(5)})
    def test_order_survives_restart(self):
        self.add('a','A');self.add('b','B')
        self.assertEqual(self.turn()['id'],'a')
        self.repo=Repository(self.path,clock=lambda:100)
        self.assertEqual(self.turn()['id'],'b')
    def test_future_due_and_unknown_are_not_dispatched(self):
        self.add('a','A',due=200);self.add('b','B')
        row=self.repo.claim();self.assertEqual(row['id'],'b')
        with self.repo.connection(True) as c:c.execute("UPDATE jobs SET lease=99 WHERE id='b'")
        self.assertIsNone(self.repo.claim())
        with self.repo.connection() as c:self.assertEqual(c.execute("SELECT state FROM jobs WHERE id='b'").fetchone()[0],'UNKNOWN')
    def test_claims_are_atomic_across_connections(self):
        self.add('a','A');self.add('b','B')
        with ThreadPoolExecutor(2) as pool:rows=list(pool.map(lambda _:self.repo.claim(),range(2)))
        self.assertEqual({r['id'] for r in rows},{'a','b'})
        self.assertEqual({r['dispatch_order'] for r in rows},{1,2})
    def test_streaming_new_jobs_do_not_starve_existing_long_job(self):
        from semantics import parse
        from datetime import date
        draft=parse('заказы за вчера на озоне',date(2026,11,8))
        long,_=self.repo.enqueue('A','long','0'*64,draft,None,'scope-long')
        self.assertEqual(self.turn()['id'],long['id'])
        for i in range(8):
            new,_=self.repo.enqueue('A','new'+str(i),str(i)*64,draft,None,'scope-'+str(i))
            self.assertEqual(self.turn()['id'],long['id'])
            row=self.repo.claim()
            self.assertEqual(row['id'],new['id'])
            with self.repo.connection(True) as c:
                c.execute("UPDATE jobs SET state='FAILED',owner=NULL,lease=NULL WHERE id=?",(row['id'],))
    def test_old_schema_migrates_and_old_explicit_insert_still_works(self):
        self.add('a','A')
        with sqlite3.connect(self.path) as c:
            c.execute('DROP INDEX tenant_dispatch')
            c.execute('ALTER TABLE jobs DROP COLUMN dispatch_order')
            c.execute('ALTER TABLE jobs DROP COLUMN queue_order')
        self.repo=Repository(self.path,clock=lambda:100)
        self.add('b','B')
        self.assertEqual([self.turn()['id'] for _ in range(4)],['a','b']*2)
        with sqlite3.connect(self.path) as c:
            self.assertEqual(c.execute('PRAGMA integrity_check').fetchone()[0],'ok')
            self.assertEqual(c.execute("SELECT COUNT(*) FROM jobs WHERE state='QUEUED'").fetchone()[0],2)
