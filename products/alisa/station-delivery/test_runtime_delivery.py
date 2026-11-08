import sys, os, tempfile, unittest
from pathlib import Path
sys.path.insert(0, os.environ.get('ALISA_TEST_RUNTIME', str(Path(__file__).resolve().parents[1]/'audit-runtime')))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from repository import Repository
from engine import Engine, Worker
from tests.test_runtime import Clock, SCOPE, TODAY, FakeTransport
from station_status import status
from semantics import Rejected

class RuntimeDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.clock=Clock();self.repo=Repository(str(Path(self.tmp.name)/'db'),clock=self.clock)
        self.engine=Engine(self.repo,lambda tenant:SCOPE)
        self.transport=FakeTransport();self.worker=Worker(self.engine,self.transport)
        reply=self.engine.safe_submit('A','сводка заказов за октябрь 2026 на озоне','request1','a'*64,TODAY,conversation_id='source-conversation',message_id=0)
        self.jid=reply['job_id']
        self.query=dict(op='station_status',tenant='A',conversation_id='source-conversation',job_id=self.jid)
    def complete(self):
        for _ in range(4):self.worker.step();self.clock.advance(3)
    def test_poll_no_provider_call_or_receipt(self):
        n=self.repo.call_count()
        with self.repo.connection() as c: before=c.execute('SELECT COUNT(*) FROM dialogue_receipts').fetchone()[0]
        for _ in range(20):self.assertIn(status(self.engine,self.query)['state'],('QUEUED','RUNNING'))
        self.assertEqual(self.repo.call_count(),n)
        with self.repo.connection() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM dialogue_receipts').fetchone()[0],before)
    def test_deliver_attaches_exact_reader_and_next_page(self):
        self.complete()
        with self.repo.connection(True) as c:
            import json
            c.execute('UPDATE jobs SET result=? WHERE id=?',(json.dumps({'pages':['Первый','Второй']}),self.jid))
        query=dict(self.query,op='station_deliver',target_conversation='target-conversation',message_id=0)
        self.assertEqual(status(self.engine,query)['text'],'Первый')
        self.assertEqual(status(self.engine,query)['text'],'Первый')
        reply=self.engine.safe_submit('A','дальше','request2','b'*64,TODAY,conversation_id='target-conversation',message_id=1)
        self.assertEqual(reply['text'],'Второй')
        self.assertEqual(status(self.engine,query)['state'],'SUPERSEDED')
    def test_foreign_conversation_and_job(self):
        self.complete()
        self.assertEqual(status(self.engine,dict(self.query,conversation_id='other-conversation'))['state'],'SUPERSEDED')
        self.assertEqual(status(self.engine,dict(self.query,job_id='other-job'))['state'],'SUPERSEDED')
        with self.assertRaises(Rejected):status(self.engine,dict(self.query,tenant='B'))
    def test_source_revoked(self):
        self.complete();self.engine.authorized=lambda plan:False
        with self.assertRaises(Rejected):status(self.engine,self.query)
    def test_cancelled_no_ready(self):
        self.engine.safe_submit('A','отмени отчет','request3','c'*64,TODAY,conversation_id='source-conversation',message_id=1)
        self.assertEqual(status(self.engine,self.query)['state'],'CANCELLED')
    def test_expired_no_reply(self):
        self.complete();self.clock.advance(1000)
        self.assertNotEqual(status(self.engine,self.query)['state'],'READY')
if __name__=='__main__':unittest.main()
