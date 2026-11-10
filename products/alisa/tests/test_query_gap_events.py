"""Privacy, atomicity and real SQLite lifecycle boundaries; no API/model calls."""
import importlib.util,json,sqlite3,sys,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch

REPO=Path(__file__).resolve().parents[3]
CORE=REPO/'docs/alisa/runtime/v0.11/rt_job_r02'
sys.path.insert(0,str(CORE))
import query_gap_events as wire
import query_gap_outbox as outbox
import query_gap_terminal as terminal
from template_gaps import GapStore

class Events(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        self.store=GapStore(self.root/'template-gaps.sqlite3',internal_test=True);self.now=time.time()
    def save(self,question='Покажи выкупы не из заказов за вчера',*,jid='job',rids=('request',),reason='MODEL_NO_TEMPLATE'):
        return self.store.save('private-tenant',jid,self.now,reason,'a'*64,{'original_question':question,
            'runtime_release':'fixture-v1','request_receipts':[{'rid':rid,'body_hash':'not-exported'}for rid in rids],
            'model_calls':[{'raw_response':'PRIVATE_MODEL_REPLY','data':{'revenue':987654321}}]})
    def packet(self):return outbox.pending(self.store)
    def main(self):
        path=self.root/'state.sqlite3';c=sqlite3.connect(path);c.row_factory=sqlite3.Row
        c.executescript('''CREATE TABLE jobs(id TEXT PRIMARY KEY,tenant TEXT,state TEXT,result TEXT,error TEXT,updated REAL,alias TEXT);
            CREATE TABLE inbox(tenant TEXT,rid TEXT,jid TEXT,body_hash TEXT,PRIMARY KEY(tenant,rid));
            CREATE TABLE inbox_age(tenant TEXT,rid TEXT,created REAL,PRIMARY KEY(tenant,rid));''')
        c.executescript('CREATE TABLE reader_cursors(tenant TEXT,conversation TEXT,jid TEXT,cancelled INTEGER);CREATE TABLE rt_job_refs(runtime_tenant TEXT,jid TEXT,ref TEXT,body_hash TEXT);')
        terminal.install(c,self.now);c.commit();return c
    def test_safe_projection_keeps_semantic_negation_without_private_packet(self):
        self.save('Покажи выкупы не из заказов за вчера по товару «PRIVATE_PRODUCT» для test@example.invalid')
        packet,_=self.packet();body=wire.canonical(packet);text=packet['events'][0]['safe_utterance']
        self.assertIn('не из заказов',text);self.assertIn('выкупы',text)
        for private in ['PRIVATE_PRODUCT','test@example.invalid','PRIVATE_MODEL_REPLY','987654321','private-tenant','not-exported']:
            self.assertNotIn(private,body)
        self.assertTrue(wire.text_is_projection(text))
    def test_declared_secret_becomes_metadata_only(self):
        self.save('Покажи продажи. Api-Key: SYNTHETIC_PRIVATE_TOKEN_DO_NOT_USE')
        packet,_=self.packet();self.assertEqual(packet['events'][0]['redaction_state'],'METADATA_ONLY');self.assertNotIn('safe_utterance',packet['events'][0])
    def test_sensitive_amount_in_words_is_not_retained(self):
        self.save('Продажи больше двух миллионов рублей');packet,_=self.packet()
        self.assertEqual(packet['events'][0]['redaction_state'],'METADATA_ONLY')
    def test_one_event_per_logical_request_not_shared_calculation(self):
        self.save(rids=('request-a','request-b'));packet,_=self.packet()
        self.assertEqual(len(packet['events']),2);self.assertEqual(len({e['logical_query_id']for e in packet['events']}),2)
    def test_replayed_case_does_not_create_another_event(self):
        first=self.save();self.assertEqual(first,self.save());self.assertEqual(len(self.packet()[0]['events']),1)
    def test_in_progress_stage_is_not_a_terminal_failure(self):
        self.save();self.assertEqual(self.packet()[0]['events'][0]['final_outcome'],'IN_PROGRESS')
    def test_network_loss_retains_exact_same_event(self):
        self.save();first,marks=self.packet();second,_=self.packet();self.assertEqual(first,second)
        outbox.acknowledge(self.store,marks);self.assertEqual(self.packet()[0]['events'],[])
        outbox.acknowledge(self.store,marks);self.assertEqual(self.packet()[0]['events'],[])
    def test_capacity_keeps_private_case_and_reports_incompleteness(self):
        with patch.object(outbox,'MAX_PENDING_BYTES',1):self.save()
        packet,_=self.packet();self.assertEqual(packet['events'],[]);self.assertEqual(packet['coverage']['dropped'],1)
        self.assertEqual(len(self.store.list()),1)
    def test_outbox_failure_does_not_abort_existing_private_backlog(self):
        with patch.object(outbox,'enqueue',side_effect=sqlite3.OperationalError('synthetic failure')):self.save()
        self.assertEqual(len(self.store.list()),1);self.assertEqual(self.packet()[0]['coverage']['dropped'],1)
    def test_private_case_and_normal_outbox_are_in_one_commit(self):
        original=outbox.enqueue
        def fail_after_insert(*args,**kwargs):original(*args,**kwargs);raise RuntimeError('synthetic transaction crash')
        with patch.object(outbox,'enqueue',side_effect=fail_after_insert),self.assertRaises(RuntimeError):self.save()
        self.assertEqual(self.store.list(),[]);self.assertEqual(self.packet()[0]['events'],[])
    def test_same_tenant_is_stable_but_different_tenants_are_unlinkable(self):
        one=wire.make_event(b'x'*32,'tenant-1','r1',self.now,'MODEL_NO_TEMPLATE','a'*64,{'runtime_release':'v1'})
        two=wire.make_event(b'x'*32,'tenant-2','r1',self.now,'MODEL_NO_TEMPLATE','a'*64,{'runtime_release':'v1'})
        self.assertNotEqual(one['tenant_pseudonym'],two['tenant_pseudonym']);self.assertNotEqual(one['event_id'],two['event_id'])
    def test_extra_raw_fields_are_rejected(self):
        self.save();event=self.packet()[0]['events'][0];event['original_question']='PRIVATE'
        with self.assertRaises(ValueError):wire.event_shape(event)
    def test_successful_fallback_is_not_a_final_failure(self):
        self.save();event=self.packet()[0]['events'][0]
        event.update(reason_code='P1_MISS_P2_SUCCESS',p1_status='MISS',p2_status='SUCCESS',final_outcome='READY');wire.event_shape(event)
        event['final_outcome']='FAILED'
        with self.assertRaises(ValueError):wire.event_shape(event)
    def test_corrupt_outbox_is_counted_without_export(self):
        self.save()
        with self.store.connection(True)as c:c.execute("UPDATE gap_event_outbox SET body='{}'")
        packet,_=self.packet();self.assertEqual(packet['events'],[]);self.assertEqual(packet['coverage']['dropped'],1)
    def test_unknown_receiver_redactor_cannot_authorize_raw_text(self):
        self.assertFalse(wire.text_is_projection('private lowercasename'))
        self.assertFalse(wire.text_is_projection('Покажи test@example.invalid'))
        self.assertFalse(wire.text_is_projection('Покажи🙂'))
    def test_producer_and_consumer_share_frozen_wire_definition(self):
        receiver=REPO/'products/alisa/services/platform/src/alisa_platform/query_insights/wire.py'
        self.assertEqual((CORE/'query_gap_events.py').read_bytes(),receiver.read_bytes())
    def test_pending_seals_cancellation_before_first_send(self):
        c=self.main();c.execute("INSERT INTO jobs VALUES('job','private-tenant','CANCELLED',NULL,NULL,?,NULL)",(self.now,));c.execute("INSERT INTO inbox(tenant,rid,jid)VALUES('private-tenant','request','job')");c.execute("INSERT INTO inbox_age VALUES('private-tenant','request',?)",(self.now,));c.commit();c.close()
        self.save();event=self.packet()[0]['events'][0];self.assertEqual(event['final_outcome'],'CANCELED')
    def test_sealed_event_does_not_change_after_failed_ack(self):
        c=self.main();c.execute("INSERT INTO jobs VALUES('job','private-tenant','RUNNING',NULL,NULL,?,NULL)",(self.now,));c.execute("INSERT INTO inbox(tenant,rid,jid)VALUES('private-tenant','request','job')");c.execute("INSERT INTO inbox_age VALUES('private-tenant','request',?)",(self.now,));c.commit()
        self.save();first,_=self.packet();c.execute("UPDATE jobs SET state='CANCELLED'WHERE id='job'");c.commit();c.close()
        second,_=self.packet();self.assertEqual(first['events'],second['events'])
    def test_terminal_capture_fans_out_across_aliases_and_ready_cache_hits(self):
        c=self.main()
        c.execute("INSERT INTO jobs VALUES('canonical','t','RUNNING',NULL,NULL,?,NULL)",(self.now,))
        c.execute("INSERT INTO jobs VALUES('alias','t','ALIASED',NULL,NULL,?,'canonical')",(self.now,))
        c.execute("INSERT INTO inbox(tenant,rid,jid)VALUES('t','r1','canonical')");c.execute("INSERT INTO inbox(tenant,rid,jid)VALUES('t','r2','alias')")
        c.execute("UPDATE jobs SET state='READY',result=?WHERE id='canonical'",(json.dumps({'provider_error':{'http_status':403},'model_result':{'status':'SUBSCRIPTION_REQUIRED'}}),))
        self.assertEqual(c.execute('SELECT count(*)FROM gap_terminal_outbox').fetchone()[0],2)
        self.assertEqual({r[0]for r in c.execute('SELECT reason FROM gap_terminal_outbox')},{'PROVIDER_PLAN_REQUIRED'})
        c.execute("INSERT INTO inbox(tenant,rid,jid)VALUES('t','r3','alias')");c.execute("INSERT INTO inbox_age VALUES('t','r3',?)",(self.now+1,))
        self.assertEqual(c.execute('SELECT count(*)FROM gap_terminal_outbox').fetchone()[0],3)
        self.assertEqual(c.execute("SELECT created FROM gap_terminal_outbox WHERE rid='r3'").fetchone()[0],self.now+1);c.close()
    def test_plain_403_is_not_a_paid_subscription(self):
        c=self.main();c.execute("INSERT INTO jobs VALUES('job','t','RUNNING',NULL,NULL,?,NULL)",(self.now,));c.execute("INSERT INTO inbox(tenant,rid,jid)VALUES('t','r','job')")
        c.execute("UPDATE jobs SET state='READY',result=?WHERE id='job'",(json.dumps({'provider_error':{'http_status':403}}),))
        self.assertEqual(c.execute('SELECT reason FROM gap_terminal_outbox').fetchone()[0],'AUTH_OR_SCOPE');c.close()
    def test_429_wait_is_not_an_unsupported_template(self):
        c=self.main();c.execute("INSERT INTO jobs VALUES('job','t','RUNNING',NULL,NULL,?,NULL)",(self.now,));c.execute("INSERT INTO inbox(tenant,rid,jid)VALUES('t','r','job')")
        c.execute("UPDATE jobs SET state='QUEUED',error='HTTP_429'WHERE id='job'");self.assertEqual(c.execute('SELECT count(*)FROM gap_terminal_outbox').fetchone()[0],0)
        c.execute("UPDATE jobs SET state='FAILED'WHERE id='job'");self.assertEqual(c.execute('SELECT reason FROM gap_terminal_outbox').fetchone()[0],'RATE_LIMIT_OR_PROVIDER_ERROR');c.close()
    def test_repeated_terminal_delivery_does_not_count_demand_again(self):
        c=self.main();c.execute("INSERT INTO jobs VALUES('job','t','RUNNING',NULL,NULL,?,NULL)",(self.now,));c.execute("INSERT INTO inbox(tenant,rid,jid)VALUES('t','r','job')");c.execute("UPDATE jobs SET state='FAILED',error='SOURCE_ACCESS'WHERE id='job'")
        c.execute('DELETE FROM gap_terminal_outbox');c.execute("UPDATE jobs SET state='FAILED',error='SOURCE_ACCESS'WHERE id='job'")
        self.assertEqual(c.execute('SELECT count(*)FROM gap_terminal_outbox').fetchone()[0],0);c.close()
    def test_metadata_capture_rolls_back_with_business_terminal_transition(self):
        c=self.main();c.execute("INSERT INTO jobs VALUES('job','t','RUNNING',NULL,NULL,?,NULL)",(self.now,));c.execute("INSERT INTO inbox(tenant,rid,jid)VALUES('t','r','job')");c.commit();c.execute("UPDATE jobs SET state='FAILED',error='SOURCE_ACCESS'WHERE id='job'");c.rollback()
        self.assertEqual(c.execute('SELECT count(*)FROM gap_terminal_outbox').fetchone()[0],0);self.assertEqual(c.execute('SELECT state FROM jobs').fetchone()[0],'RUNNING');c.close()
    def test_reused_receipt_for_new_job_is_a_new_logical_episode(self):
        self.save(jid='first');self.save(jid='second')
        events=self.packet()[0]['events'];self.assertEqual(len({e['logical_query_id']for e in events}),2)
    def test_terminal_and_detailed_event_share_identity_and_retry_is_immutable(self):
        c=self.main();c.execute("INSERT INTO jobs VALUES('job','private-tenant','RUNNING',NULL,NULL,?,NULL)",(self.now,));c.execute("INSERT INTO inbox(tenant,rid,jid)VALUES('private-tenant','request','job')");c.execute("UPDATE jobs SET state='READY',result=?",(json.dumps({'template_gap':True}),));c.commit();c.close()
        stream=terminal.TerminalStore(self.root/'state.sqlite3',self.store.key,'fixture',cases=self.store,internal_test=True)
        first=stream.pending()[0]['events'][0]
        self.save();stage=self.packet()[0]['events'][0]
        self.assertEqual(first['logical_query_id'],stage['logical_query_id'])
        self.assertEqual(first,stream.pending()[0]['events'][0])
    def test_custom_state_database_is_observed_without_creating_another_database(self):
        c=self.main();c.execute("INSERT INTO jobs VALUES('job','private-tenant','CANCELLED',NULL,NULL,?,NULL)",(self.now,));c.commit();c.close()
        (self.root/'state.sqlite3').rename(self.root/'jobs.sqlite');self.store.state_path=self.root/'jobs.sqlite'
        self.save();self.assertEqual(self.packet()[0]['events'][0]['final_outcome'],'CANCELED');self.assertFalse((self.root/'state.sqlite3').exists())
    def test_terminal_prerequisite_failure_does_not_leave_partial_capture(self):
        c=sqlite3.connect(':memory:')
        with self.assertRaises(ValueError):terminal.install(c)
        self.assertEqual(c.execute("SELECT name FROM sqlite_master WHERE name LIKE 'gap_%'").fetchall(),[]);c.close()
    def test_corrupt_sealed_terminal_event_is_counted_without_export(self):
        c=self.main();c.execute("INSERT INTO jobs VALUES('job','t','RUNNING',NULL,NULL,?,NULL)",(self.now,));c.execute("INSERT INTO inbox(tenant,rid,jid)VALUES('t','r','job')");c.execute("UPDATE jobs SET state='FAILED',error='SOURCE_ACCESS'");c.commit();c.close()
        stream=terminal.TerminalStore(self.root/'state.sqlite3',self.store.key,'fixture',internal_test=True);stream.pending()
        with stream.connection()as c:c.execute("UPDATE gap_terminal_outbox SET body='{}'")
        packet,_=stream.pending();self.assertEqual(packet['events'],[]);self.assertEqual(packet['coverage']['dropped'],1)
    def test_cleanup_does_not_reclassify_preserved_paid_failure(self):
        c=self.main();c.execute("INSERT INTO jobs VALUES('job','t','RUNNING',NULL,NULL,?,NULL)",(self.now,));c.execute("INSERT INTO inbox(tenant,rid,jid)VALUES('t','r','job')")
        c.execute("UPDATE jobs SET state='FAILED',result=?,error='HTTP_403'",(json.dumps({'model_result':{'status':'SUBSCRIPTION_REQUIRED'},'provider_error':{'http_status':403}}),))
        c.execute('UPDATE jobs SET result=NULL');self.assertEqual(c.execute('SELECT count(*)FROM gap_terminal_outbox').fetchone()[0],1)
        self.assertEqual(c.execute('SELECT reason FROM gap_terminal_outbox').fetchone()[0],'PROVIDER_PLAN_REQUIRED');c.close()
    def test_cancelled_reader_is_not_counted_as_an_unsupported_active_reader(self):
        c=self.main();c.execute("INSERT INTO jobs VALUES('job','private-tenant','RUNNING',NULL,NULL,?,NULL)",(self.now,))
        for rid in ['a','b']:
            c.execute('INSERT INTO inbox(tenant,rid,jid)VALUES(?,?,?)',('private-tenant',rid,'job'))
            c.execute('INSERT INTO reader_cursors VALUES(?,?,?,0)',('private-tenant',rid,'job'))
            c.execute('INSERT INTO gap_request_readers(tenant,rid,jid,conversation)VALUES(?,?,?,?)',('private-tenant',rid,'job',rid))
        c.execute("UPDATE reader_cursors SET cancelled=1 WHERE conversation='a'")
        c.execute("UPDATE jobs SET state='READY',result=?",(json.dumps({'template_gap':True}),));c.commit();c.close()
        self.save(rids=('a','b'));self.assertEqual({e['final_outcome']for e in self.packet()[0]['events']},{'CANCELED','UNSUPPORTED'})
        stream=terminal.TerminalStore(self.root/'state.sqlite3',self.store.key,'fixture',cases=self.store,internal_test=True)
        self.assertEqual({e['final_outcome']for e in stream.pending()[0]['events']},{'CANCELED','UNSUPPORTED'})
    def test_new_request_in_same_conversation_does_not_reopen_old_cancelled_request(self):
        c=self.main();c.execute("INSERT INTO jobs VALUES('job','t','RUNNING',NULL,NULL,?,NULL)",(self.now,));c.execute("INSERT INTO inbox(tenant,rid,jid)VALUES('t','old','job')")
        c.execute("INSERT INTO reader_cursors VALUES('t','conversation','job',0)");c.execute("INSERT INTO gap_request_readers(tenant,rid,jid,conversation)VALUES('t','old','job','conversation')")
        c.execute('UPDATE reader_cursors SET cancelled=1');c.execute('UPDATE reader_cursors SET cancelled=0');c.execute("INSERT INTO inbox(tenant,rid,jid)VALUES('t','new','job')");c.execute("INSERT INTO gap_request_readers(tenant,rid,jid,conversation)VALUES('t','new','job','conversation')")
        self.assertEqual(terminal.reader_state(c,'t','old'),'CANCELED');self.assertEqual(terminal.reader_state(c,'t','new'),'OPEN');c.close()

if __name__=='__main__':unittest.main()
