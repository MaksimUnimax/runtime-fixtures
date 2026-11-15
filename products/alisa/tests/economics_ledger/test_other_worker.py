"""Same native Worker/job/receipts; all marketplace and model IO is synthetic."""
from copy import deepcopy
from dataclasses import replace
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch
import json, tempfile, unittest
from engine import Engine, Worker, CallError
from repository import Repository, Deferred
from semantics import Rejected, fingerprint, strict_json
from model_answer import Settings
from test_runtime import Clock, SCOPE
from economics_ledger.test_order_sources import posting, page, PERIOD
from economics_ledger.test_order_worker import Transport as OrderTransport, capabilities
from economics_ledger.test_other_sources import entry, record
import order_source_runtime as orders
import other_source_runtime as leaf

POST='PRIVATE-POSTING-fbo'


class Transport(OrderTransport):
    def __init__(self):
        super().__init__()
        self.post_entries={POST:[entry()]}
        self.days={'2026-11-13':[{'accruals':[record(posting=POST)],'last_id':''}]}
        self.other_revoke=None;self.other_mutate=None;self.other_fail_once=False;self.other_after=None
    def execute(self,request,store):
        operation=request.operation.rsplit('.',1)[-1]
        if operation not in leaf.OPERATIONS:return super().execute(request,store)
        self.calls.append(request)
        if self.other_revoke:self.other_revoke()
        if self.other_fail_once:
            self.other_fail_once=False;raise CallError('HTTP_429',status=429,retry_at=0)
        params=request.body['params']
        if operation==leaf.OPERATIONS[0]:
            answer={'posting_accruals':[{'posting_number':number,'accruals':deepcopy(self.post_entries.get(number,[]))}
                                       for number in params['posting_numbers']]}
        else:
            index=0 if not params['last_id']else int(params['last_id'].split('-')[1])
            pages=self.days.get(params['date'],[{'accruals':[],'last_id':''}]);answer=deepcopy(pages[index])
        if self.other_mutate:self.other_mutate(request,answer)
        if self.other_after:self.other_after(request,answer)
        return answer,{'status':200,'bytes':1000,'elapsed_ms':1}


class OtherWorker(unittest.TestCase):
    def setUp(self):
        self.net=patch('socket.socket.connect',side_effect=AssertionError('EXTERNAL_NETWORK_FORBIDDEN'));self.net.start();self.addCleanup(self.net.stop)
        self.tmp=tempfile.TemporaryDirectory();self.clock=Clock();self.clock.now=datetime(2026,11,15,6,tzinfo=timezone.utc).timestamp()
        self.scope=SCOPE;self.caps=capabilities(self.scope);self.repo=Repository(Path(self.tmp.name)/'state.sqlite3',self.clock)
        self.engine=Engine(self.repo,lambda tenant:self.scope,dataset_capabilities=lambda:self.caps,
                           answer_settings=Settings(Path(self.tmp.name)/'answer.json'),template_mode=True)
        self.transport=Transport();self.worker=Worker(self.engine,self.transport)
        self.permission=True;self.order_value=None;self.order_saved=None;self.desc=None
        self.saved=None;self.output=None;self.crash=False
        query='Расчёт экономики Ozon за выбранный день'
        reply=self.engine.safe_submit('A',query,'r15-other',fingerprint(query),date(2026,11,15),conversation_id='r15-other-fixture',message_id=1)
        self.jid=reply['job_id'];self.worker.step();self.root=strict_json(self.repo.get('A',self.jid)['plan'])
        self.order_desc=orders.descriptor(self.engine,self.root,'oz1',PERIOD)
    def tearDown(self):self.tmp.cleanup()
    def claim(self):
        before=self.repo.get('A',self.jid);self.clock.advance(max(2,before['due']-self.clock()+1))
        row=self.repo.claim();self.assertIsNotNone(row);return row
    def prepare_orders(self):
        for _ in range(100):
            if self.order_value is not None:return
            row=self.claim();progress=strict_json(row['progress'])if row['progress']else{}
            def save(packed):
                self.order_saved=packed;progress['_orders']=packed;self.repo.reschedule(row['id'],row['owner'],progress)
            def complete(value,packed):
                self.order_value=value;self.order_saved=packed;self.desc=leaf.descriptor(self.root,'oz1',PERIOD,value.checkpoint())
                progress['_orders']=packed;self.repo.reschedule(row['id'],row['owner'],progress)
            try:orders.step(self.worker,row,self.root,self.order_desc,progress.get('_orders'),authorize=lambda:self.permission,
                            save_progress=save,on_complete=complete)
            except Deferred as error:self.repo.reschedule(row['id'],row['owner'],until=error.until)
        self.fail('unfinished order source')
    def once(self):
        self.prepare_orders();row=self.claim();progress=strict_json(row['progress'])if row['progress']else{}
        def save(packed):self.saved=packed;progress['_other']=packed;self.repo.reschedule(row['id'],row['owner'],progress)
        def complete(value,packed):
            if self.crash:raise SystemExit('SYNTHETIC_PARENT_CRASH')
            self.output=value;self.saved=packed
            self.repo.complete_answer(row['id'],row['owner'],{'complete':True,'pages':['Verified observed OTHER only'],'data':value.checkpoint()})
        try:leaf.step(self.worker,row,self.root,self.desc,progress.get('_other'),order_desc=self.order_desc,order_packed=self.order_saved,
                      authorize=lambda:self.permission,save_progress=save,on_complete=complete)
        except Deferred as error:self.repo.reschedule(row['id'],row['owner'],until=error.until)
    def finish(self):
        for _ in range(100):
            if self.output is not None:return self.output
            self.once()
        self.fail('unfinished OTHER source')
    def calls(self):return [request for request in self.transport.calls if request.operation.rsplit('.',1)[-1]in leaf.OPERATIONS]
    def restore(self,**kwargs):
        return leaf.restore(self.worker,self.repo.get('A',self.jid),self.root,self.desc,self.saved,
                            order_desc=self.order_desc,order_packed=self.order_saved,authorize=lambda:self.permission,**kwargs)
    def amount(self,value=None):
        value=self.finish()if value is None else value
        return sum((Decimal(item['amount'])for item in value.line_inputs(self.order_value).values()),Decimal(0))
    def rewrite(self,mutate):
        row=self.repo.get('A',self.jid);state=leaf._open(self.repo,row,self.desc,self.saved);mutate(state)
        self.saved=leaf._seal(self.repo,row,self.desc,state)

    def test_native_read_order_same_job_and_exact_posting_set(self):
        value=self.finish();self.assertEqual(self.amount(value),Decimal('10'))
        self.assertEqual([request.operation for request in self.calls()],[
            'read.ozon.finance_accrual_postings',*['read.ozon.finance_accrual_by_day']*3])
        self.assertEqual(self.calls()[0].body,{'params':{'posting_numbers':sorted([POST,'PRIVATE-POSTING-fbs'])}})
        self.assertEqual([request.body['params']for request in self.calls()[1:]],
                         [{'date':day,'last_id':''}for day in ('2026-11-13','2026-11-14','2026-11-15')])
        with self.repo.connection()as connection:
            self.assertEqual(connection.execute('SELECT COUNT(*)FROM jobs').fetchone()[0],1)
            events=connection.execute("SELECT jid,state,http FROM calls WHERE source NOT LIKE 'model:%'").fetchall()
        self.assertEqual(len(events),6);self.assertTrue(all(event['jid']==self.jid and event['state']=='RECEIVED'and event['http']==200 for event in events))
        self.assertEqual(value.checkpoint()['matched_components'],1);self.assertFalse(value.data['original_cohort_debits_classified'])

    def test_native_signed_credit_and_debit_keep_net_once(self):
        self.transport.post_entries[POST]=[entry('-100'),entry('25')]
        self.transport.days['2026-11-13'][0]['accruals']=[record(amount='-100',posting=POST),record('PRIVATE-CREDIT',amount='25',posting=POST)]
        self.assertEqual(self.amount(),Decimal('75'));self.assertEqual(self.output.checkpoint()['matched_components'],2)

    def test_exact_decimal_unapplied_seller_price_is_not_float_rounded(self):
        self.transport.post_entries[POST][0]['seller_price']=Decimal('9876543210.12345678901234567890123456789')
        self.assertEqual(self.amount(),Decimal('10'))

    def test_zero_orders_skips_illegal_posting_call_but_scans_all_days(self):
        self.transport.pages={scheme:[page([])]for scheme in ('fbo','fbs')}
        self.transport.days={};value=self.finish()
        self.assertEqual(value.line_inputs(self.order_value),{});self.assertTrue(value.checkpoint()['zero_cohort'])
        self.assertEqual([request.operation for request in self.calls()],['read.ozon.finance_accrual_by_day']*3)
        self.assertEqual(value.checkpoint()['source_pages'],{'posting_batches':0,'day_pages':3})

    def test_explicit_empty_postings_and_complete_days_prove_scoped_zero(self):
        self.transport.post_entries={};self.transport.days={};value=self.finish()
        self.assertEqual(self.amount(value),0);self.assertEqual(len(value.line_inputs(self.order_value)),2)
        self.assertTrue(all(item['basis']['zero_proof']for item in value.line_inputs(self.order_value).values()))

    def test_request_batches_are_exact_and_no_more_than_200(self):
        values=[posting(ident='PRIVATE-BATCH-'+str(index),sku=101+index)for index in range(201)]
        self.transport.pages={'fbo':[page(values[:100],True,'page-1'),page(values[100:200],True,'page-2'),page(values[200:])],
                              'fbs':[page([])]};self.transport.post_entries={};self.transport.days={}
        value=self.finish();requests=[request.body['params']['posting_numbers']for request in self.calls()if request.operation.endswith(leaf.OPERATIONS[0])]
        self.assertEqual([len(batch)for batch in requests],[200,1]);self.assertEqual(len({number for batch in requests for number in batch}),201)
        self.assertEqual(value.checkpoint()['cohort_postings'],201)

    def test_full_cursor_chain_uses_actual_id_deduplication(self):
        item=record(posting=POST)
        self.transport.days['2026-11-13']=[{'accruals':[item],'last_id':'page-1'},{'accruals':[deepcopy(item)],'last_id':''}]
        value=self.finish();self.assertEqual(self.amount(value),10);self.assertEqual(value.checkpoint()['duplicate_day_records'],1)
        self.assertEqual([request.body['params']['last_id']for request in self.calls()[1:]],['','page-1','',''])

    def test_equal_components_from_distinct_real_ids_retain_multiplicity(self):
        self.transport.post_entries[POST]=[entry(),entry()]
        self.transport.days['2026-11-13'][0]['accruals'].append(record('PRIVATE-SECOND-ID',posting=POST))
        value=self.finish();self.assertEqual(self.amount(value),20);self.assertEqual(value.checkpoint()['matched_accruals'],2)

    def test_non_other_early_accrual_extends_full_by_day_window(self):
        self.transport.post_entries[POST].append(entry('-30','2026-11-11',69,101,2))
        value=self.finish();self.assertEqual(value.checkpoint()['financial_period'],{'from':'2026-11-11','to':'2026-11-15'})
        self.assertEqual([request.body['params']['date']for request in self.calls()[1:]],
                         ['2026-11-11','2026-11-12','2026-11-13','2026-11-14','2026-11-15'])

    def test_restart_after_by_postings_does_not_refetch_that_surface(self):
        self.once();self.worker=Worker(self.engine,self.transport);self.finish()
        self.assertEqual(len(self.calls()),4)

    def test_restart_after_nonterminal_day_continues_exact_cursor(self):
        self.transport.days['2026-11-13']=[{'accruals':[record(posting=POST)],'last_id':'page-1'},{'accruals':[],'last_id':''}]
        self.once();self.once();self.worker=Worker(self.engine,self.transport);self.finish()
        self.assertEqual([request.body['params'].get('last_id')for request in self.calls()],[None,'','page-1','',''])

    def test_parent_crash_after_frozen_collection_never_refetches(self):
        for _ in range(4):self.once()
        self.crash=True
        with self.assertRaises(SystemExit):self.once()
        self.crash=False;self.clock.advance(125);self.worker=Worker(self.engine,self.transport);self.finish()
        self.assertEqual(len(self.calls()),4)

    def test_completed_snapshot_rebind_next_day_uses_frozen_asof_without_io(self):
        value=self.finish();checkpoint=value.checkpoint();self.clock.advance(2*86400)
        self.worker=Worker(self.engine,self.transport)
        restored=self.restore();self.assertEqual(restored.checkpoint(),checkpoint);self.assertEqual(len(self.calls()),4)
        self.assertEqual(restored.checkpoint()['financial_period']['to'],'2026-11-15')
        self.assertNotIn('loss_rate',json.dumps(restored.checkpoint()));self.assertNotIn('delivery_mean',json.dumps(restored.checkpoint()))

    def test_incomplete_collection_extends_across_moscow_midnight(self):
        self.once();self.once();self.once()
        self.clock.now=datetime(2026,11,15,20,59,58,tzinfo=timezone.utc).timestamp()
        self.transport.other_after=lambda request,answer:self.clock.advance(4)
        self.finish()
        self.assertEqual([request.body['params'].get('date')for request in self.calls()],
                         [None,'2026-11-13','2026-11-14','2026-11-15','2026-11-16'])
        self.assertEqual(self.output.checkpoint()['financial_period']['to'],'2026-11-16')

    def test_incomplete_restore_never_returns_qualified_zero(self):
        self.once()
        with self.assertRaisesRegex(Rejected,'OTHER_SOURCE_INCOMPLETE'):self.restore()
        self.assertEqual(len(self.calls()),1)

    def test_forged_completed_timestamp_does_not_replace_full_chain(self):
        self.once();self.rewrite(lambda state:state.update(captured_as_of=datetime.fromtimestamp(self.clock(),timezone.utc).isoformat()))
        with self.assertRaisesRegex(Rejected,'OTHER_SOURCE_INCOMPLETE'):self.restore()

    def test_unexpected_complete_flag_is_not_accepted_as_state(self):
        self.once();self.rewrite(lambda state:state.update(complete=True))
        with self.assertRaisesRegex(Rejected,'OTHER_PROGRESS_INTEGRITY'):self.restore()

    def test_receipt_moved_to_another_job_blocks_before_next_read(self):
        self.once()
        with self.repo.connection(True)as connection:connection.execute("UPDATE calls SET jid='foreign'WHERE source LIKE '%:read:%'")
        with self.assertRaises(Rejected):self.once()
        self.assertEqual(len(self.calls()),1)

    def test_changed_order_receipt_invalidates_other_restore(self):
        self.finish()
        with self.repo.connection(True)as connection:connection.execute("UPDATE calls SET http=500 WHERE source NOT LIKE '%:read:%'AND source NOT LIKE 'model:%'")
        with self.assertRaises(Rejected):self.restore()

    def test_failed_other_receipt_is_not_replaced_by_encrypted_state(self):
        self.finish()
        with self.repo.connection(True)as connection:connection.execute("UPDATE calls SET state='FAILED',http=500 WHERE source LIKE '%:read:%'")
        with self.assertRaises(Rejected):self.restore()

    def test_report_revocation_before_first_other_send(self):
        self.prepare_orders();self.permission=False
        with self.assertRaisesRegex(Rejected,'OTHER_REPORT_REVOKED'):self.once()
        self.assertEqual(self.calls(),[])

    def test_report_revocation_after_response_does_not_persist_packet(self):
        self.prepare_orders();self.transport.other_revoke=lambda:setattr(self,'permission',False)
        with self.assertRaisesRegex(Rejected,'OTHER_REPORT_REVOKED'):self.once()
        self.assertIsNone(self.saved);self.assertEqual(len(self.calls()),1)

    def test_revocation_during_actual_receipt_verification_prevents_packet_save(self):
        self.prepare_orders();original=leaf._verifier;verified=[]
        def verifier(*args,**kwargs):
            check=original(*args,**kwargs)
            def verify(packet):
                accepted=check(packet)
                self.assertTrue(accepted);verified.append(packet['receipt_id'])
                self.permission=False
                return accepted
            return verify
        with patch.object(leaf,'_verifier',side_effect=verifier):
            with self.assertRaisesRegex(Rejected,'OTHER_REPORT_REVOKED'):self.once()
        self.assertTrue(verified);self.assertEqual(len(self.calls()),1)
        self.assertIsNone(self.saved);self.assertIsNone(self.output)
        self.assertIsNone(self.repo.get('A',self.jid)['result'])

    def test_revocation_during_normalization_prevents_completion_and_restore(self):
        for _ in range(4):self.once()
        saved=deepcopy(self.saved);original=leaf.source.normalize;normalized=[]
        def normalize_then_revoke(*args,**kwargs):
            value=original(*args,**kwargs);normalized.append(True);self.permission=False
            return value
        with patch.object(leaf.source,'normalize',side_effect=normalize_then_revoke):
            with self.assertRaisesRegex(Rejected,'OTHER_REPORT_REVOKED'):self.once()
            self.permission=True
            with self.assertRaisesRegex(Rejected,'OTHER_REPORT_REVOKED'):self.restore()
        self.assertEqual(normalized,[True,True]);self.assertEqual(len(self.calls()),4)
        self.assertEqual(self.saved,saved);self.assertIsNone(self.output)
        self.assertIsNone(self.repo.get('A',self.jid)['result'])

    def test_restore_requires_fresh_authority_even_next_day(self):
        self.finish();self.clock.advance(86400);self.permission=False
        with self.assertRaisesRegex(Rejected,'OTHER_REPORT_REVOKED'):self.restore()

    def test_exact_true_authority_is_required(self):
        self.prepare_orders();self.permission=1
        with self.assertRaisesRegex(Rejected,'OTHER_REPORT_REVOKED'):self.once()
        self.assertEqual(self.calls(),[])

    def test_scope_revision_change_stops_collection(self):
        self.once();self.scope=replace(self.scope,revision='revoked')
        with self.assertRaises(Rejected):self.once()
        self.assertEqual(len(self.calls()),1)

    def test_financial_source_denial_blocks_even_with_root_authority(self):
        self.prepare_orders();store=next(item for item in self.root['stores']if item['id']=='oz1')
        quota,_,_=leaf.read_surface.quota('ozon',leaf.OPERATIONS[1])
        self.repo.deny('ozon:'+store['identity']+':'+quota,store['access_revision'])
        self.assertTrue(self.engine.authorized(self.root))
        with self.assertRaisesRegex(Rejected,'OTHER_SOURCE_ACCESS'):self.once()
        self.assertEqual(self.calls(),[])

    def test_tampered_protected_state_rejected(self):
        self.once();self.saved['cipher']=self.saved['cipher'][:-4]+'AAAA'
        with self.assertRaisesRegex(Rejected,'OTHER_PROGRESS_INTEGRITY'):self.restore()

    def test_cross_job_replay_is_rejected(self):
        self.finish();row=dict(self.repo.get('A',self.jid));row['id']='foreign-job'
        with self.assertRaises(Rejected):leaf.restore(self.worker,row,self.root,self.desc,self.saved,
            order_desc=self.order_desc,order_packed=self.order_saved,authorize=lambda:True)

    def test_same_worker_429_retry_uses_shared_call_ledger(self):
        self.transport.other_fail_once=True;self.finish();self.assertEqual(len(self.calls()),5)
        with self.repo.connection()as connection:
            self.assertEqual(connection.execute('SELECT COUNT(*)FROM calls WHERE http=429').fetchone()[0],1)

    def test_unknown_selected_by_posting_type_is_terminal_error(self):
        self.transport.post_entries[POST].append(entry('-1',kind=38))
        with self.assertRaisesRegex(Rejected,'OTHER_UNCLASSIFIED_FEE'):self.once()
        self.assertIsNone(self.saved);self.assertEqual(len(self.calls()),1)

    def test_unknown_selected_by_day_type_is_terminal_error(self):
        self.transport.days['2026-11-13'][0]['accruals'].append(record('PRIVATE-UNKNOWN',kind=39,posting=POST))
        self.once()
        with self.assertRaisesRegex(Rejected,'OTHER_UNCLASSIFIED_FEE'):self.once()
        self.assertEqual(len(self.calls()),2)

    def test_outside_and_unallocated_observations_never_enter_cohort_other(self):
        self.transport.days['2026-11-13'][0]['accruals'].extend([
            record('PRIVATE-OUTSIDE',amount='-99',kind=38,posting='PRIVATE-OUTSIDE-POST'),
            record('PRIVATE-UNALLOCATED',amount='-88',posting=None)])
        value=self.finish();self.assertEqual(self.amount(value),10)
        self.assertEqual(value.checkpoint()['outside_cohort_components'],{'38':1})
        self.assertEqual(value.checkpoint()['unallocated_components'],{'93':1})

    def test_missing_by_posting_response_row_is_not_empty_accruals(self):
        self.transport.other_mutate=lambda request,answer:answer['posting_accruals'].pop()if request.operation.endswith(leaf.OPERATIONS[0])else None
        with self.assertRaisesRegex(Rejected,'OTHER_POSTING_SET_INCOMPLETE'):self.once()

    def test_unexpected_by_posting_response_shape_rejected(self):
        self.transport.other_mutate=lambda request,answer:answer.update(unapproved=[])if request.operation.endswith(leaf.OPERATIONS[0])else None
        with self.assertRaisesRegex(Rejected,'OTHER_POSTING_RESPONSE'):self.once()

    def test_response_snapshot_mismatch_never_qualifies(self):
        self.transport.days['2026-11-13'][0]['accruals'][0]['non_item_fee']['accrued']['amount']='-11'
        with self.assertRaisesRegex(Rejected,'OTHER_SNAPSHOT_MISMATCH'):self.finish()
        self.assertIsNone(self.output)

    def test_omitted_actual_id_is_not_synthesized(self):
        self.transport.days['2026-11-13'][0]['accruals'][0].pop('accrual_id')
        self.once()
        with self.assertRaisesRegex(Rejected,'ACCRUAL_RECORD_SCHEMA'):self.once()

    def test_cursor_no_progress_fails_before_repeat_send(self):
        self.transport.days['2026-11-13']=[{'accruals':[record(posting=POST)],'last_id':'page-1'},
            {'accruals':[record(posting=POST)],'last_id':'page-1'}]
        self.once();self.once()
        with self.assertRaisesRegex(Rejected,'ACCRUAL_CURSOR_NO_PROGRESS'):self.once()
        self.assertEqual(len(self.calls()),3)

    def test_empty_nonterminal_page_is_not_silently_skipped(self):
        self.transport.days['2026-11-13']=[{'accruals':[],'last_id':'page-1'}]
        self.once()
        with self.assertRaisesRegex(Rejected,'ACCRUAL_CURSOR_NO_PROGRESS'):self.once()

    def test_unknown_day_shape_is_rejected_on_receipt(self):
        self.transport.days['2026-11-13'][0]['extra']=True;self.once()
        with self.assertRaisesRegex(Rejected,'ACCRUAL_SCHEMA'):self.once()

    def test_future_accrual_rejected_on_by_posting_receipt(self):
        self.transport.post_entries[POST]=[entry(day='2026-11-16')]
        with self.assertRaisesRegex(Rejected,'OTHER_FUTURE_ACCRUAL'):self.once()

    def test_progress_and_result_do_not_capture_raw_ids_or_financial_answers(self):
        # Public template definitions can legitimately name seller_price in the
        # existing selector trace. Test retained source values and private IDs,
        # not whether a registered formula's field name is mentioned anywhere.
        amount='918273645.1234567890123'
        self.transport.post_entries[POST]=[entry('-'+amount)]
        self.transport.days['2026-11-13'][0]['accruals']=[record(amount='-'+amount,posting=POST)]
        for _ in range(4):self.once()
        progress=self.repo.get('A',self.jid)['progress'];self.assertEqual(set(self.saved),{'nonce','cipher'})
        for private in ('PRIVATE','private@example.invalid','_answer_api_data',amount,'1000.12345678901234567890123456789'):
            self.assertNotIn(private,progress)
        self.finish();result=self.repo.get('A',self.jid)['result']
        for private in ('PRIVATE',amount,'1000.12345678901234567890123456789','accrual_id','non_item_fee'):self.assertNotIn(private,result)
        self.assertFalse(self.output.checkpoint()['persist_values'])
