"""Real native Worker, dataset registry and receipts; synthetic transport only."""
from copy import deepcopy
from dataclasses import replace
from datetime import datetime, timezone, date
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch
import json, tempfile, unittest
from engine import Engine, Worker, CallError
from repository import Repository, Deferred
from semantics import fingerprint, strict_json, Rejected
from model_answer import Settings
from test_runtime import Clock, SCOPE
from test_template_only import Transport as BaseTransport, selection
from economics_ledger.test_order_sources import posting, posting_on, page, PERIOD, LONG_PERIOD
import order_source_runtime as leaf


def capabilities(scope):
    return {store.id:{operation:{'status':'READ_ONLY_CANARY','dataset_source_hash':leaf.datasets.SOURCES.hash,
            'dataset_query_hash':leaf.datasets.HASH,'evidence_ref':'synthetic-order-source',
            **leaf.datasets.SOURCES.recipe(operation)['proof_requirements']}for operation in leaf.OPERATIONS}
            for store in scope.stores if store.platform=='ozon'}


class Transport(BaseTransport):
    def __init__(self):
        super().__init__();self.selection=selection(['B01.ordered_units'],inputs={'period':deepcopy(PERIOD)})
        self.pages={scheme:[page([posting(scheme)])]for scheme in ('fbo','fbs')}
        self.pages['fbo'][0]['postings'][0]['products'][0]['price']=Decimal('1000.12345678901234567890123456789')
        self.revoke=None;self.fail_once=False;self.mutate=None;self.window_pages=None
    def execute(self,request,store):
        if request.operation not in leaf.OPERATIONS:return super().execute(request,store)
        self.calls.append(request)
        if self.revoke:self.revoke()
        if self.fail_once:self.fail_once=False;raise CallError('HTTP_429',status=429,retry_at=0)
        scheme=next(name for name in leaf.source.SCHEMES if leaf.source.CATALOG['schemes'][name]['operation']==request.operation)
        cursor=request.body['cursor'];index=0 if not cursor else int(cursor.split('-')[1])
        pages=self.pages[scheme]if self.window_pages is None else self.window_pages[(scheme,request.body['filter']['since'])]
        value=deepcopy(pages[index])
        if self.mutate:self.mutate(request,value)
        return value,{'status':200,'bytes':1000,'elapsed_ms':1}


class OrderWorker(unittest.TestCase):
    def setUp(self):
        self.net=patch('socket.socket.connect',side_effect=AssertionError('EXTERNAL_NETWORK_FORBIDDEN'));self.net.start();self.addCleanup(self.net.stop)
        self.tmp=tempfile.TemporaryDirectory();self.clock=Clock();self.clock.now=datetime(2026,11,15,6,tzinfo=timezone.utc).timestamp()
        self.scope=SCOPE;self.caps=capabilities(self.scope);self.repo=Repository(Path(self.tmp.name)/'state.sqlite3',self.clock)
        self.engine=Engine(self.repo,lambda tenant:self.scope,dataset_capabilities=lambda:self.caps,
                           answer_settings=Settings(Path(self.tmp.name)/'answer.json'),template_mode=True)
        self.transport=Transport();self.worker=Worker(self.engine,self.transport)
        self.permission=True;self.saved=None;self.output=None;self.crash=False
        query='Расчёт экономики Ozon за выбранный день'
        reply=self.engine.safe_submit('A',query,'r15-orders',fingerprint(query),date(2026,11,15),conversation_id='r15-orders-fixture',message_id=1)
        self.jid=reply['job_id'];self.worker.step();self.root=strict_json(self.repo.get('A',self.jid)['plan'])
        self.desc=leaf.descriptor(self.engine,self.root,'oz1',PERIOD)
    def tearDown(self):self.tmp.cleanup()
    def once(self):
        before=self.repo.get('A',self.jid);self.clock.advance(max(2,before['due']-self.clock()+1));row=self.repo.claim();self.assertIsNotNone(row)
        progress=strict_json(row['progress'])if row['progress']else{}
        def save(packed):self.saved=packed;progress['_orders']=packed;self.repo.reschedule(row['id'],row['owner'],progress)
        def complete(value,packed):
            if self.crash:raise SystemExit('SYNTHETIC_PARENT_CRASH')
            self.output=value;self.saved=packed
            self.repo.complete_answer(row['id'],row['owner'],{'complete':True,'pages':['Verified order source only'],'data':value.checkpoint()})
        try:leaf.step(self.worker,row,self.root,self.desc,progress.get('_orders'),authorize=lambda:self.permission,save_progress=save,on_complete=complete)
        except Deferred as error:self.repo.reschedule(row['id'],row['owner'],until=error.until)
    def finish(self):
        for _ in range(20):
            if self.output is not None:return self.output
            self.once()
        self.fail('unfinished source')
    def calls(self):return [request for request in self.transport.calls if request.store_id]
    def restore(self,**kw):
        return leaf.restore(self.worker,self.repo.get('A',self.jid),self.root,self.desc,self.saved,authorize=lambda:self.permission,**kw)
    def configure_windows(self,period=None,empty=False):
        self.desc=leaf.descriptor(self.engine,self.root,'oz1',period or LONG_PERIOD);self.transport.window_pages={}
        for scheme in leaf.source.SCHEMES:
            for index,window in enumerate(self.desc['windows']):
                since=leaf.source.expected_request(scheme,window,'')['filter']['since']
                self.transport.window_pages[(scheme,since)]=[page([]if empty else[posting_on(scheme,window['from'],scheme+'-window-'+str(index))])]
    def numbers(self):
        return leaf.posting_numbers(self.worker,self.repo.get('A',self.jid),self.root,self.desc,self.saved,authorize=lambda:self.permission)

    def test_native_requests_exact_moscow_bounds_in_same_job(self):
        value=self.finish();self.assertEqual(len(value.data['rows']),2)
        self.assertEqual([request.operation for request in self.calls()],list(leaf.OPERATIONS))
        for request in self.calls():
            self.assertEqual(request.body['filter'],{'since':'2026-11-12T21:00:00Z','to':'2026-11-13T20:59:59.999999Z'})
            self.assertEqual(request.body['limit'],100);self.assertNotIn('status',request.body['filter'])
        with self.repo.connection()as connection:self.assertEqual(connection.execute('SELECT COUNT(*)FROM jobs').fetchone()[0],1)

    def test_exact_decimal_price_preserved_without_transport_rounding(self):
        self.assertEqual(self.finish().data['rows'][0]['seller_price'],'1000.12345678901234567890123456789')

    def test_observation_bounds_match_all_actual_captured_page_times(self):
        value=self.finish();state=leaf._open(self.repo,self.repo.get('A',self.jid),self.desc,self.saved)
        stamps=[packet['received_at']for scheme in leaf.source.SCHEMES for packet in state['pages'][scheme]]
        checkpoint=value.checkpoint()
        self.assertEqual(checkpoint['observation_from'],min(stamps,key=leaf.source._stamp))
        self.assertEqual(checkpoint['observation_to'],max(stamps,key=leaf.source._stamp))
        self.assertEqual(checkpoint['observed_at'],checkpoint['observation_from'])
        self.assertLess(leaf.source._stamp(checkpoint['observation_from']),leaf.source._stamp(checkpoint['observation_to']))

    def test_clock_regression_between_fbo_and_fbs_rejected_before_saving(self):
        self.once();saved=deepcopy(self.saved)
        self.transport.revoke=lambda:setattr(self.clock,'now',self.clock.now-60)
        with self.assertRaisesRegex(Rejected,'ORDERS_OBSERVATION_ORDER'):self.once()
        self.assertEqual(self.saved,saved);self.assertEqual(len(self.calls()),2)

    def test_job_scoped_posting_identity_matches_existing_native_token(self):
        row=self.repo.get('A',self.jid);expected=leaf._token(self.repo,row,'posting','PRIVATE-POSTING-fbo')
        self.assertEqual(self.finish().data['rows'][0]['posting'],expected)

    def test_registered_decoder_is_used_for_both_sources(self):
        with patch.object(leaf.datasets,'decode',wraps=leaf.datasets.decode)as decode:self.finish()
        self.assertEqual({call.args[2]['source']for call in decode.call_args_list},set(leaf.OPERATIONS))

    def test_native_decoder_invalid_sku_type_is_not_bypassed(self):
        self.transport.pages['fbo'][0]['postings'][0]['products'][0]['sku']='101'
        with self.assertRaises(Rejected):self.once()
        self.assertIsNone(self.saved)

    def test_cancelled_units_and_fbs_order_axis_retained(self):
        self.transport.pages['fbo'][0]['postings'][0]['status']='cancelled'
        value=self.finish();self.assertEqual({row['day']for row in value.data['rows']},{'2026-11-13'})
        self.assertEqual({row['quantity']for row in value.data['rows']},{'2'})

    def test_full_cursor_chain_before_switching_scheme(self):
        self.transport.pages['fbo']=[page([posting(ident='first')],True,'page-1'),page([posting(ident='second',sku=102)])]
        value=self.finish();self.assertEqual(len(value.data['rows']),3)
        self.assertEqual([request.operation for request in self.calls()],[leaf.OPERATIONS[0]]*2+[leaf.OPERATIONS[1]])
        self.assertEqual([request.body['cursor']for request in self.calls()],['','page-1',''])

    def test_restart_after_nonterminal_page_does_not_refetch(self):
        self.transport.pages['fbo']=[page([posting()],True,'page-1'),page([])]
        self.once();self.worker=Worker(self.engine,self.transport);self.finish();self.assertEqual(len(self.calls()),3)

    def test_restart_after_both_sources_and_parent_crash_do_not_refetch(self):
        self.once();self.once();self.worker=Worker(self.engine,self.transport);self.crash=True
        with self.assertRaises(SystemExit):self.once()
        self.crash=False;self.clock.advance(125);self.finish();self.assertEqual(len(self.calls()),2)

    def test_zero_cohort_requires_explicit_fbo_and_fbs_terminals(self):
        self.transport.pages={scheme:[page([])]for scheme in ('fbo','fbs')}
        self.once();self.assertIsNone(self.output)
        with self.assertRaisesRegex(Rejected,'ORDERS_SOURCE_INCOMPLETE'):self.restore()
        value=self.finish();self.assertEqual(value.for_cohort(PERIOD,self.desc['scope'])['rows'],[])
        self.assertEqual(len(self.calls()),2)

    def test_restore_incomplete_source_never_grants_complete(self):
        self.once()
        with self.assertRaisesRegex(Rejected,'ORDERS_SOURCE_INCOMPLETE'):self.restore()
        self.assertEqual(len(self.calls()),1)

    def test_stalled_cursor_and_cross_page_posting_rejected(self):
        self.transport.pages['fbo']=[page([posting()],True,'page-1'),page([posting(ident='other')],True,'page-1')]
        with self.assertRaisesRegex(Rejected,'ORDERS_CURSOR_CHAIN'):self.finish()
        self.assertEqual(len(self.calls()),2)

    def test_duplicate_posting_on_next_page_rejected(self):
        self.transport.pages['fbo']=[page([posting()],True,'page-1'),page([posting(sku=102)])]
        with self.assertRaisesRegex(Rejected,'ORDERS_DUPLICATE_POSTING'):self.finish()

    def test_missing_item_price_has_no_aggregate_fallback(self):
        item=self.transport.pages['fbo'][0]['postings'][0];item['products'][0].pop('price');item['paid_by_customer']='2000'
        with self.assertRaisesRegex(Rejected,'ORDERS_ITEM_VALUE_REQUIRED'):self.once()

    def test_outside_selected_order_period_is_not_silently_removed(self):
        self.transport.pages['fbs'][0]['postings'][0]['in_process_at']='2026-11-13T21:00:00Z'
        with self.assertRaisesRegex(Rejected,'ORDERS_OUTSIDE_PERIOD'):self.finish()

    def test_permission_revoked_before_send(self):
        self.permission=False
        with self.assertRaisesRegex(Rejected,'ORDERS_REPORT_REVOKED'):self.once()
        self.assertEqual(self.calls(),[])

    def test_parent_permission_requires_exact_true(self):
        self.permission=1
        with self.assertRaisesRegex(Rejected,'ORDERS_REPORT_REVOKED'):self.once()
        self.assertEqual(self.calls(),[])

    def test_permission_revoked_after_response_keeps_no_packet(self):
        self.transport.revoke=lambda:setattr(self,'permission',False)
        with self.assertRaisesRegex(Rejected,'ORDERS_REPORT_REVOKED'):self.once()
        self.assertIsNone(self.saved)

    def test_revocation_during_actual_receipt_verification_prevents_packet_save(self):
        original=leaf._verifier;verified=[]
        def verifier(*args,**kwargs):
            check=original(*args,**kwargs)
            def verify(packet):
                accepted=check(packet)
                self.assertTrue(accepted);verified.append(packet['receipt_id'])
                self.permission=False
                return accepted
            return verify
        with patch.object(leaf,'_verifier',side_effect=verifier):
            with self.assertRaisesRegex(Rejected,'ORDERS_REPORT_REVOKED'):self.once()
        self.assertTrue(verified);self.assertEqual(len(self.calls()),1)
        self.assertIsNone(self.saved);self.assertIsNone(self.output)
        self.assertIsNone(self.repo.get('A',self.jid)['result'])

    def test_revocation_during_normalization_prevents_completion_and_restore(self):
        self.once();self.once();saved=deepcopy(self.saved)
        original=leaf.source.normalize;normalized=[]
        def normalize_then_revoke(*args,**kwargs):
            value=original(*args,**kwargs);normalized.append(True);self.permission=False
            return value
        with patch.object(leaf.source,'normalize',side_effect=normalize_then_revoke):
            with self.assertRaisesRegex(Rejected,'ORDERS_REPORT_REVOKED'):self.once()
            self.permission=True
            with self.assertRaisesRegex(Rejected,'ORDERS_REPORT_REVOKED'):self.restore()
        self.assertEqual(normalized,[True,True]);self.assertEqual(len(self.calls()),2)
        self.assertEqual(self.saved,saved);self.assertIsNone(self.output)
        self.assertIsNone(self.repo.get('A',self.jid)['result'])

    def test_current_rights_rechecked_on_restore_and_not_replaced_by_seal(self):
        self.once();self.once();value=self.restore();self.assertEqual(len(value.data['rows']),2);self.permission=False
        with self.assertRaisesRegex(Rejected,'ORDERS_REPORT_REVOKED'):self.restore()
        self.assertEqual(len(self.calls()),2)

    def test_scope_revision_changed_during_collection(self):
        self.once();self.scope=replace(self.scope,revision='revoked')
        with self.assertRaises(Rejected):self.once()
        self.assertEqual(len(self.calls()),1)

    def test_missing_registered_capability_prevents_io(self):
        self.caps['oz1'].pop(leaf.OPERATIONS[1])
        with self.assertRaisesRegex(Rejected,'ORDERS_SOURCE_UNAVAILABLE'):self.once()
        self.assertEqual(self.calls(),[])

    def test_changed_capability_proof_prevents_restore(self):
        self.once();self.once();self.caps['oz1'][leaf.OPERATIONS[0]]['evidence_ref']='changed-proof'
        with self.assertRaises(Rejected):self.restore()

    def test_source_denial_checked_even_when_root_remains_authorized(self):
        store=next(store for store in self.root['stores']if store['id']=='oz1')
        source_name=leaf._request(self.root,store,self.desc,'fbo','',self.desc['windows'][0]).source
        self.repo.deny(source_name,store['access_revision'])
        self.assertTrue(self.engine.authorized(self.root))
        with self.assertRaisesRegex(Rejected,'ORDERS_SOURCE_ACCESS'):self.once()
        self.assertEqual(self.calls(),[])

    def test_receipt_moved_to_other_job_rejected_before_next_send(self):
        self.once()
        with self.repo.connection(True)as connection:connection.execute("UPDATE calls SET jid='foreign'WHERE source NOT LIKE 'model:%'")
        with self.assertRaises(Rejected):self.once()
        self.assertEqual(len(self.calls()),1)

    def test_receipt_http_or_state_changes_reject_restore(self):
        self.once();self.once()
        with self.repo.connection(True)as connection:connection.execute("UPDATE calls SET http=500,state='FAILED'WHERE source NOT LIKE 'model:%'")
        with self.assertRaises(Rejected):self.restore()

    def test_protected_progress_result_and_no_unencrypted_answer_capture(self):
        self.once();self.once();raw=self.repo.get('A',self.jid)['progress']
        for private in ('PRIVATE','private@example.invalid','1000.123456789','_answer_api_data'):
            self.assertNotIn(private,raw)
        self.assertEqual(set(self.saved),{'nonce','cipher'})
        self.finish();result=self.repo.get('A',self.jid)['result']
        self.assertNotIn('PRIVATE',result);self.assertNotIn('1000.123456789',result)
        self.assertFalse(self.output.checkpoint()['persist_values'])

    def test_same_source_packets_restore_without_saved_coefficient_values(self):
        self.once();self.once();first=self.restore();second=self.restore()
        self.assertEqual(first.checkpoint(),second.checkpoint());self.assertEqual(len(self.calls()),2)
        self.assertNotIn('loss_rate',json.dumps(self.saved));self.assertNotIn('delivery_mean',json.dumps(self.saved))

    def test_tampered_or_cross_job_protected_checkpoint_rejected(self):
        self.once();saved=deepcopy(self.saved);self.saved['cipher']=self.saved['cipher'][:-4]+'AAAA'
        with self.assertRaisesRegex(Rejected,'ORDERS_PROGRESS_INTEGRITY'):self.restore()
        row=dict(self.repo.get('A',self.jid));row['id']='foreign-job'
        with self.assertRaisesRegex(Rejected,'ORDERS_PROGRESS_INTEGRITY'):
            leaf.restore(self.worker,row,self.root,self.desc,saved,authorize=lambda:True)

    def test_changed_period_cannot_reuse_protected_packets(self):
        self.once();desc=leaf.descriptor(self.engine,self.root,'oz1',{'from':'2026-11-12','to':'2026-11-13'})
        with self.assertRaisesRegex(Rejected,'ORDERS_PROGRESS_INTEGRITY'):
            leaf.restore(self.worker,self.repo.get('A',self.jid),self.root,desc,self.saved,authorize=lambda:True)

    def test_existing_worker_retry_after_429(self):
        self.transport.fail_once=True;self.finish();self.assertEqual(len(self.calls()),3)

    def test_ninety_day_report_uses_all_six_qualified_windows(self):
        self.configure_windows()
        with patch.object(leaf.datasets,'decode',wraps=leaf.datasets.decode)as decode:value=self.finish()
        self.assertEqual(len(self.calls()),6);self.assertEqual(len(value.data['rows']),6)
        self.assertEqual(value.for_cohort(LONG_PERIOD,self.desc['scope'])['period'],LONG_PERIOD)
        self.assertEqual([request.operation for request in self.calls()],[leaf.OPERATIONS[0]]*3+[leaf.OPERATIONS[1]]*3)
        for scheme in leaf.source.SCHEMES:
            requests=[request for request in self.calls()if request.operation==leaf.source.CATALOG['schemes'][scheme]['operation']]
            self.assertEqual([request.body for request in requests],[leaf.source.expected_request(scheme,window,'')for window in self.desc['windows']])
        for call in decode.call_args_list:
            window=call.args[2]['period'];self.assertLessEqual((date.fromisoformat(window['to'])-date.fromisoformat(window['from'])).days+1,31)
        self.assertEqual(len(self.numbers()),6)

    def test_zero_long_report_requires_all_window_terminals(self):
        self.configure_windows(empty=True)
        for _ in range(5):self.once()
        with self.assertRaisesRegex(Rejected,'ORDERS_SOURCE_INCOMPLETE'):self.restore()
        value=self.finish();self.assertEqual(value.data['rows'],[]);self.assertEqual(len(self.calls()),6)
        self.assertEqual(self.numbers(),[])

    def test_cursor_history_is_complete_and_resets_for_each_window(self):
        self.configure_windows()
        for pages in self.transport.window_pages.values():
            pages[0].update(has_next=True,cursor='page-1');pages.append(page([]))
        value=self.finish();self.assertEqual(len(self.calls()),12)
        self.assertEqual([request.body['cursor']for request in self.calls()],['','page-1']*6)
        self.assertEqual(value.checkpoint()['window_pages'],{'fbo':[2,2,2],'fbs':[2,2,2]})

    def test_restart_after_window_terminal_starts_next_window_without_refetch(self):
        self.configure_windows();self.once();self.worker=Worker(self.engine,self.transport);self.finish()
        self.assertEqual(len(self.calls()),6)
        self.assertEqual(self.calls()[1].body['filter'],leaf.source.expected_request('fbo',self.desc['windows'][1],'')['filter'])

    def test_missing_middle_window_in_protected_evidence_rejected(self):
        self.configure_windows()
        for _ in range(6):self.once()
        row=self.repo.get('A',self.jid);state=leaf._open(self.repo,row,self.desc,self.saved)
        removed=state['pages']['fbo'].pop(1);state['receipts'].pop(removed['receipt_id'])
        self.saved=leaf._seal(self.repo,row,self.desc,state)
        with self.assertRaisesRegex(Rejected,'ORDERS_WINDOW_MISMATCH'):self.restore()
        self.assertEqual(len(self.calls()),6)

    def test_duplicate_window_in_protected_evidence_rejected(self):
        self.configure_windows()
        for _ in range(6):self.once()
        row=self.repo.get('A',self.jid);state=leaf._open(self.repo,row,self.desc,self.saved)
        state['pages']['fbo'][1]=deepcopy(state['pages']['fbo'][0]);self.saved=leaf._seal(self.repo,row,self.desc,state)
        with self.assertRaisesRegex(Rejected,'ORDERS_WINDOW_MISMATCH'):self.restore()

    def test_changed_registered_window_contract_prevents_io(self):
        rule=leaf.datasets.CATALOG['queries']['posting_metadata']
        with patch.dict(rule,max_days=90):
            with self.assertRaisesRegex(Rejected,'ORDERS_WINDOW_CONTRACT_CHANGED'):self.once()
        self.assertEqual(self.calls(),[])

    def test_forged_descriptor_window_list_prevents_io(self):
        self.configure_windows();self.desc['windows'].pop(1)
        with self.assertRaisesRegex(Rejected,'ORDERS_SOURCE_SCOPE'):self.once()
        self.assertEqual(self.calls(),[])

    def test_order_day_within_report_but_outside_actual_window_rejected(self):
        self.configure_windows();first=next(iter(self.transport.window_pages.values()))
        first[0]['postings'][0]['created_at']='2026-09-16T09:00:00Z'
        with self.assertRaisesRegex(Rejected,'ORDERS_OUTSIDE_PERIOD'):self.once()

    def test_raw_posting_handoff_has_exact_unique_set_and_no_persistence(self):
        self.transport.pages['fbo'][0]['postings'][0]['products'].append({'sku':102,'quantity':1,'price':'20'})
        self.once();self.once();before=self.repo.get('A',self.jid)['progress']
        identifiers=self.numbers();self.assertEqual(identifiers,['PRIVATE-POSTING-fbo','PRIVATE-POSTING-fbs'])
        identifiers.append('ONLY-IN-CALLER-MEMORY')
        self.assertEqual(self.numbers(),['PRIVATE-POSTING-fbo','PRIVATE-POSTING-fbs'])
        self.assertEqual(self.repo.get('A',self.jid)['progress'],before);self.assertEqual(len(self.calls()),2)
        self.assertNotIn('PRIVATE',json.dumps(self.restore().checkpoint()))

    def test_raw_posting_handoff_refuses_incomplete_source(self):
        self.once()
        with self.assertRaisesRegex(Rejected,'ORDERS_SOURCE_INCOMPLETE'):self.numbers()

    def test_raw_posting_handoff_rechecks_current_parent_authority(self):
        self.once();self.once();self.permission=False
        with self.assertRaisesRegex(Rejected,'ORDERS_REPORT_REVOKED'):self.numbers()

    def test_raw_posting_handoff_rechecks_actual_same_job_receipts(self):
        self.once();self.once()
        with self.repo.connection(True)as connection:connection.execute("UPDATE calls SET jid='foreign'WHERE source NOT LIKE 'model:%'")
        with self.assertRaises(Rejected):self.numbers()

    def test_raw_posting_handoff_has_final_authority_fence(self):
        self.once();self.once();original=leaf._open;count=[0]
        def open_then_revoke(*args):
            state=original(*args);count[0]+=1
            if count[0]==2:self.permission=False
            return state
        with patch.object(leaf,'_open',side_effect=open_then_revoke):
            with self.assertRaisesRegex(Rejected,'ORDERS_REPORT_REVOKED'):self.numbers()
