"""Pure synthetic order-source evidence; no provider, database or credentials."""
from copy import deepcopy
from dataclasses import replace
from datetime import date, timedelta
from hashlib import sha256
from unittest import TestCase
import hmac, json
from alisa_platform.owner_data import economics_orders as orders
from alisa_platform.owner_data import economics_cohort as cohort

TARGET={'tenant_id':'test-tenant','store_id':'test-store','provider':'OZON','currency':'RUB'}
PERIOD={'from':'2026-11-13','to':'2026-11-13'}
LONG_PERIOD={'from':'2026-08-16','to':'2026-11-13'}


def encode(kind,value):return hmac.new(b'synthetic-order-job',(kind+'\0'+value).encode(),'sha256').hexdigest()


def posting(scheme='fbo',ident=None,sku=101,price='1000.123456789',quantity=2):
    return {'posting_number':ident or 'PRIVATE-POSTING-'+scheme,'status':'delivered',
        'created_at':'2026-11-12T21:00:00Z'if scheme=='fbo'else'2026-10-01T00:00:00Z',
        'in_process_at':'2026-11-14T00:00:00Z'if scheme=='fbo'else'2026-11-13T20:59:59.999999Z',
        'customer':{'name':'PRIVATE CUSTOMER NAME','email':'private@example.invalid'},
        'analytics_data':{'payment_type_group_name':'PRIVATE PAYMENT LABEL'},
        'products':[{'sku':sku,'quantity':quantity,'price':price,'name':'PRIVATE PRODUCT NAME',
                     'offer_id':'PRIVATE OFFER','currency_code':'RUB'}]}


def page(items,has_next=False,cursor='terminal-token'):
    return {'postings':deepcopy(items),'has_next':has_next,'cursor':cursor}


def posting_on(scheme,day,ident):
    value=posting(scheme,ident)
    value[orders.CATALOG['schemes'][scheme]['day_field']]=day+'T09:00:00Z'
    return value


def packet(scheme,data,receipt=None,cursor='',period=None):
    body=json.dumps(data,ensure_ascii=False).encode()
    return {'operation':orders.CATALOG['schemes'][scheme]['operation'],'scope':deepcopy(TARGET),
            'request':orders.expected_request(scheme,period or PERIOD,cursor),'body':body,
            'received_at':'2026-11-15T00:00:00Z','receipt_id':receipt or scheme+'-receipt',
            'response_sha256':sha256(body).hexdigest(),'http':200}


def fixtures():return [packet('fbo',page([posting()]))],[packet('fbs',page([posting('fbs')]))]


def window_fixtures(period=None,empty=False):
    result=[]
    for scheme in orders.SCHEMES:
        pages=[]
        for index,window in enumerate(orders.windows(period or LONG_PERIOD)):
            ident=scheme+'-window-'+str(index)
            pages.append(packet(scheme,page([]if empty else[posting_on(scheme,window['from'],ident)]),ident,period=window))
        result.append(pages)
    return tuple(result)


def change(packet,fn):
    data=json.loads(packet['body']);fn(data);packet['body']=json.dumps(data).encode();packet['response_sha256']=sha256(packet['body']).hexdigest()


def normalize(fbo=None,fbs=None,period=None):
    a,b=fixtures();a=a if fbo is None else fbo;b=b if fbs is None else fbs
    known={}
    for item in a+b:known.setdefault(item['receipt_id'],[]).append(deepcopy(item))
    return orders.normalize(a,b,TARGET,period or PERIOD,verify=lambda value:value in known.get(value['receipt_id'],[]),encode=encode)


class OrderSources(TestCase):
    def test_exact_item_price_and_original_quantity(self):
        rows=normalize().data['rows'];self.assertEqual(len(rows),2)
        self.assertEqual({row['seller_price']for row in rows},{'1000.123456789'})
        self.assertEqual({row['quantity']for row in rows},{'2'})
        self.assertEqual({row['scheme']for row in rows},{'fbo','fbs'})
        self.assertEqual(rows[0]['posting'],encode('posting','PRIVATE-POSTING-fbo'))

    def test_correct_moscow_order_axes_and_inclusive_boundaries(self):
        rows=normalize().data['rows'];self.assertEqual({row['day']for row in rows},{'2026-11-13'})
        fbo,fbs=fixtures()
        for item in fbo+fbs:
            self.assertEqual(item['request']['filter'],{'since':'2026-11-12T21:00:00Z','to':'2026-11-13T20:59:59.999999Z'})

    def test_all_page_observation_bounds_are_attested_and_min_alias_remains(self):
        fbo,fbs=fixtures();change(fbo[0],lambda data:data.update(has_next=True,cursor='next'))
        fbo.append(packet('fbo',page([]),'fbo-second','next'))
        for value,stamp in zip(fbo+fbs,('2026-11-15T00:00:00Z','2026-11-15T01:00:00Z','2026-11-15T02:00:00Z')):
            value['received_at']=stamp
        result=normalize(fbo,fbs)
        for value in (result.data,result.checkpoint()):
            self.assertEqual(value['observation_from'],'2026-11-15T00:00:00Z')
            self.assertEqual(value['observation_to'],'2026-11-15T02:00:00Z')
            self.assertEqual(value['observed_at'],value['observation_from'])

    def test_observation_order_is_global_across_fbo_and_fbs(self):
        fbo,fbs=fixtures();fbo[0]['received_at']='2026-11-15T02:00:00Z';fbs[0]['received_at']='2026-11-15T01:00:00Z'
        with self.assertRaisesRegex(orders.OrderError,'ORDERS_OBSERVATION_ORDER'):normalize(fbo,fbs)

    def test_observation_bounds_compare_instants_with_different_offsets(self):
        fbo,fbs=fixtures();fbo[0]['received_at']='2026-11-15T03:00:00+03:00';fbs[0]['received_at']='2026-11-15T00:30:00Z'
        result=normalize(fbo,fbs).checkpoint()
        self.assertEqual(result['observation_from'],fbo[0]['received_at']);self.assertEqual(result['observation_to'],fbs[0]['received_at'])

    def test_later_cancelled_and_unknown_statuses_keep_all_units(self):
        fbo,fbs=fixtures();change(fbo[0],lambda data:data['postings'][0].update(status='cancelled'))
        change(fbs[0],lambda data:data['postings'][0].update(status='new_future_status'))
        value=normalize(fbo,fbs);self.assertEqual(len(value.data['rows']),2)
        self.assertEqual(value.data['statuses'],'ALL_INCLUDING_LATER_CANCELLED')

    def test_multi_sku_posting_preserves_individual_prices(self):
        fbo,fbs=fixtures()
        change(fbo[0],lambda data:data['postings'][0]['products'].append({'sku':102,'quantity':3,'price':'37.19'}))
        rows={row['sku']:row for row in normalize(fbo,fbs).data['rows']if row['scheme']=='fbo'}
        self.assertEqual(rows['102']['seller_price'],'37.19');self.assertEqual(rows['102']['quantity'],'3')
        self.assertEqual(rows['101']['seller_price'],'1000.123456789')

    def test_no_price_fallback_to_paid_or_posting_total(self):
        fbo,fbs=fixtures()
        def mutate(data):
            item=data['postings'][0];item['products'][0].pop('price')
            item.update(total_amount='2000',seller_price='1000',paid_by_customer='1800')
            item['products'][0].update(paid_by_customer='900',marketing_price='1100')
        change(fbo[0],mutate)
        with self.assertRaisesRegex(orders.OrderError,'ORDERS_ITEM_VALUE_REQUIRED'):normalize(fbo,fbs)

    def test_explicit_zero_price_is_known_zero(self):
        fbo,fbs=fixtures();change(fbo[0],lambda data:data['postings'][0]['products'][0].update(price=0))
        self.assertEqual(normalize(fbo,fbs).data['rows'][0]['seller_price'],'0')

    def test_invalid_price_and_quantities_fail(self):
        cases=[('price',None),('price',True),('price','-0.01'),('quantity',None),('quantity',True),
               ('quantity',0),('quantity',-2),('quantity','1.5'),('quantity','')]
        for field,value in cases:
            with self.subTest(field=field,value=value):
                fbo,fbs=fixtures();change(fbo[0],lambda data:data['postings'][0]['products'][0].update({field:value}))
                with self.assertRaises(orders.OrderError):normalize(fbo,fbs)

    def test_json_numeric_price_preserves_fraction_exactly(self):
        fbo,fbs=fixtures();raw=fbo[0]['body'].replace(b'"1000.123456789"',b'1000.123456789012345678901234567890123')
        fbo[0].update(body=raw,response_sha256=sha256(raw).hexdigest())
        self.assertEqual(normalize(fbo,fbs).data['rows'][0]['seller_price'],'1000.123456789012345678901234567890123')

    def test_nonfinite_and_explosive_numeric_exponents_fail(self):
        for token in (b'NaN',b'Infinity',b'1e1000000000'):
            with self.subTest(token=token):
                fbo,fbs=fixtures();raw=fbo[0]['body'].replace(b'"1000.123456789"',token)
                fbo[0].update(body=raw,response_sha256=sha256(raw).hexdigest())
                with self.assertRaises(orders.OrderError):normalize(fbo,fbs)

    def test_no_products_is_not_an_empty_order_cohort(self):
        fbo,fbs=fixtures();change(fbo[0],lambda data:data['postings'][0].update(products=[]))
        with self.assertRaisesRegex(orders.OrderError,'ORDERS_PRODUCTS_REQUIRED'):normalize(fbo,fbs)

    def test_currency_mismatch_or_unknown_is_rejected(self):
        for currency in ('USD',None):
            fbo,fbs=fixtures();change(fbo[0],lambda data:data['postings'][0]['products'][0].update(currency_code=currency))
            with self.assertRaisesRegex(orders.OrderError,'ORDERS_CURRENCY'):normalize(fbo,fbs)

    def test_timestamp_missing_naive_or_outside_period_fails(self):
        for stamp in (None,'2026-11-13T00:00:00','2026-11-12T20:59:59.999999Z','2026-11-13T21:00:00Z'):
            with self.subTest(stamp=stamp):
                fbo,fbs=fixtures();change(fbo[0],lambda data:data['postings'][0].update(created_at=stamp))
                with self.assertRaises(orders.OrderError):normalize(fbo,fbs)

    def test_fbs_created_at_cannot_replace_in_process_at(self):
        fbo,fbs=fixtures();change(fbs[0],lambda data:(data['postings'][0].update(created_at='2026-11-13T12:00:00Z'),data['postings'][0].pop('in_process_at')))
        with self.assertRaisesRegex(orders.OrderError,'ORDERS_ORDER_DAY'):normalize(fbo,fbs)

    def test_duplicate_sku_within_posting_rejected(self):
        fbo,fbs=fixtures();change(fbo[0],lambda data:data['postings'][0]['products'].append(deepcopy(data['postings'][0]['products'][0])))
        with self.assertRaisesRegex(orders.OrderError,'ORDERS_DUPLICATE_LINE'):normalize(fbo,fbs)

    def test_duplicate_posting_with_disjoint_skus_rejected(self):
        fbo,fbs=fixtures();change(fbo[0],lambda data:data['postings'].append(posting(sku=102)))
        with self.assertRaisesRegex(orders.OrderError,'ORDERS_DUPLICATE_POSTING'):normalize(fbo,fbs)

    def test_posting_cannot_appear_in_both_schemes(self):
        fbo,fbs=fixtures();change(fbs[0],lambda data:data['postings'][0].update(posting_number='PRIVATE-POSTING-fbo'))
        with self.assertRaisesRegex(orders.OrderError,'ORDERS_DUPLICATE_POSTING'):normalize(fbo,fbs)

    def test_complete_pages_keep_first_last_and_all_skus(self):
        fbo,fbs=fixtures();change(fbo[0],lambda data:data.update(has_next=True,cursor='next'))
        fbo.append(packet('fbo',page([posting(ident='another-posting',sku=102)]),'fbo-second','next'))
        value=normalize(fbo,fbs);self.assertEqual(len(value.data['rows']),3)
        self.assertEqual(value.checkpoint()['source_pages'],{'fbo':2,'fbs':1})

    def test_explicit_empty_terminal_page_supported(self):
        fbo,fbs=fixtures();change(fbo[0],lambda data:data.update(has_next=True,cursor='next'))
        fbo.append(packet('fbo',page([]),'fbo-second','next'))
        self.assertEqual(len(normalize(fbo,fbs).data['rows']),2)

    def test_empty_cohort_requires_both_terminal_source_pages(self):
        fbo=[packet('fbo',page([]))];fbs=[packet('fbs',page([]))]
        self.assertEqual(normalize(fbo,fbs).for_cohort(PERIOD,TARGET)['rows'],[])
        for a,b in (([],fbs),(fbo,[]),([],[])):
            with self.assertRaisesRegex(orders.OrderError,'ORDERS_SOURCE_INCOMPLETE'):normalize(a,b)

    def test_nonterminal_empty_page_is_not_complete(self):
        fbo,fbs=fixtures();change(fbo[0],lambda data:data.update(postings=[],has_next=True,cursor='next'))
        with self.assertRaises(orders.OrderError):normalize(fbo,fbs)

    def test_terminal_flag_not_empty_cursor_controls_completion(self):
        self.assertEqual(len(normalize().data['rows']),2)
        fbo,fbs=fixtures();change(fbo[0],lambda data:data.update(has_next=True,cursor='next'))
        with self.assertRaisesRegex(orders.OrderError,'ORDERS_SOURCE_INCOMPLETE'):normalize(fbo,fbs)

    def test_wrong_or_repeated_request_cursor_fails(self):
        fbo,fbs=fixtures();fbo[0]['request']['cursor']='skip-first'
        with self.assertRaisesRegex(orders.OrderError,'ORDERS_REQUEST_CHANGED'):normalize(fbo,fbs)
        fbo,fbs=fixtures();change(fbo[0],lambda data:data.update(has_next=True,cursor='next'))
        fbo.append(packet('fbo',page([posting(ident='second')],True,'next'),'fbo-second','next'))
        with self.assertRaisesRegex(orders.OrderError,'ORDERS_CURSOR_CHAIN'):normalize(fbo,fbs)

    def test_cursor_cycle_and_page_after_terminal_are_rejected(self):
        fbo=[packet('fbo',page([posting(ident='a')],True,'one'),'r1'),
             packet('fbo',page([posting(ident='b')],True,'two'),'r2','one'),
             packet('fbo',page([posting(ident='c')],True,'one'),'r3','two'),
             packet('fbo',page([]),'r4','one')]
        with self.assertRaisesRegex(orders.OrderError,'ORDERS_CURSOR_CHAIN'):normalize(fbo)
        fbo,fbs=fixtures();fbo.append(packet('fbo',page([]),'r2'))
        with self.assertRaisesRegex(orders.OrderError,'ORDERS_PAGE_AFTER_TERMINAL'):normalize(fbo,fbs)

    def test_duplicate_posting_across_pages_rejected(self):
        fbo,fbs=fixtures();change(fbo[0],lambda data:data.update(has_next=True,cursor='next'))
        fbo.append(packet('fbo',page([posting(sku=102)]),'fbo-second','next'))
        with self.assertRaisesRegex(orders.OrderError,'ORDERS_DUPLICATE_POSTING'):normalize(fbo,fbs)

    def test_registered_page_size_only_no_total_page_cap(self):
        pages=[]
        for index in range(1001):
            pages.append(packet('fbo',page([posting(ident='posting-'+str(index))],index<1000,'page-'+str(index+1)),
                                'receipt-'+str(index),''if index==0 else'page-'+str(index)))
        self.assertEqual(normalize(pages).checkpoint()['source_pages']['fbo'],1001)
        fbo,fbs=fixtures();change(fbo[0],lambda data:data.update(postings=[posting(ident=str(index))for index in range(101)]))
        with self.assertRaisesRegex(orders.OrderError,'ORDERS_RESPONSE_SCHEMA'):normalize(fbo,fbs)

    def test_request_period_status_and_options_cannot_change(self):
        mutations=[(lambda request:request['filter'].update(status='delivered'),'ORDERS_REQUEST_CHANGED'),
                   (lambda request:request['filter'].update(since='2026-11-13T00:00:00Z'),'ORDERS_WINDOW_MISMATCH'),
                   (lambda request:request.update(limit=99),'ORDERS_REQUEST_CHANGED'),
                   (lambda request:request['with'].update(analytics_data=1),'ORDERS_REQUEST_CHANGED'),
                   (lambda request:request.update(sort_dir='desc'),'ORDERS_REQUEST_CHANGED')]
        for mutate,code in mutations:
            fbo,fbs=fixtures();mutate(fbo[0]['request'])
            with self.assertRaisesRegex(orders.OrderError,code):normalize(fbo,fbs)

    def test_ninety_days_are_exact_consecutive_registered_query_windows(self):
        windows=orders.windows(LONG_PERIOD)
        self.assertEqual(windows,[{'from':'2026-08-16','to':'2026-09-15'},
                                  {'from':'2026-09-16','to':'2026-10-16'},
                                  {'from':'2026-10-17','to':'2026-11-13'}])
        self.assertEqual(sum((date.fromisoformat(window['to'])-date.fromisoformat(window['from'])).days+1 for window in windows),90)
        for left,right in zip(windows,windows[1:]):
            self.assertEqual(date.fromisoformat(left['to'])+timedelta(days=1),date.fromisoformat(right['from']))

    def test_full_report_period_preserved_after_all_windows_and_both_schemes(self):
        fbo,fbs=window_fixtures();value=normalize(fbo,fbs,LONG_PERIOD)
        self.assertEqual(len(value.data['rows']),6)
        self.assertEqual(value.for_cohort(LONG_PERIOD,TARGET)['period'],LONG_PERIOD)
        self.assertEqual(value.checkpoint()['source_pages'],{'fbo':3,'fbs':3})
        self.assertEqual(value.checkpoint()['window_pages'],{'fbo':[1,1,1],'fbs':[1,1,1]})
        self.assertEqual(value.checkpoint()['window_contract'],orders.CATALOG['request_window'])

    def test_no_total_report_day_cap(self):
        period={'from':'2025-10-10','to':'2026-11-13'}
        fbo,fbs=window_fixtures(period,empty=True)
        value=normalize(fbo,fbs,period);self.assertEqual(value.data['rows'],[])
        self.assertEqual(value.for_cohort(period,TARGET)['period'],period)
        self.assertEqual(len(orders.windows(period)),13)

    def test_empty_report_needs_terminal_page_for_every_window_and_scheme(self):
        fbo,fbs=window_fixtures(empty=True)
        self.assertEqual(normalize(fbo,fbs,LONG_PERIOD).data['rows'],[])
        for a,b in ((fbo[:1],fbs[:1]),(fbo,fbs[:-1]),(fbo[:-1],fbs)):
            with self.assertRaisesRegex(orders.OrderError,'ORDERS_SOURCE_INCOMPLETE'):normalize(a,b,LONG_PERIOD)

    def test_missing_first_or_middle_window_is_typed_failure(self):
        for missing in (0,1):
            fbo,fbs=window_fixtures();fbo.pop(missing)
            with self.assertRaisesRegex(orders.OrderError,'ORDERS_WINDOW_MISMATCH'):normalize(fbo,fbs,LONG_PERIOD)

    def test_duplicate_or_extra_window_is_typed_failure(self):
        fbo,fbs=window_fixtures();fbo[1]=deepcopy(fbo[0]);fbo[1]['receipt_id']='duplicate-window-receipt'
        with self.assertRaisesRegex(orders.OrderError,'ORDERS_WINDOW_MISMATCH'):normalize(fbo,fbs,LONG_PERIOD)
        fbo,fbs=window_fixtures();fbo.append(deepcopy(fbo[-1]));fbo[-1]['receipt_id']='extra-window-receipt'
        with self.assertRaisesRegex(orders.OrderError,'ORDERS_PAGE_AFTER_TERMINAL'):normalize(fbo,fbs,LONG_PERIOD)

    def test_request_window_overlap_or_gap_is_rejected(self):
        for shifted in ({'from':'2026-09-15','to':'2026-10-15'},{'from':'2026-09-17','to':'2026-10-16'}):
            fbo,fbs=window_fixtures();fbo[1]['request']=orders.expected_request('fbo',shifted,'')
            with self.assertRaisesRegex(orders.OrderError,'ORDERS_WINDOW_MISMATCH'):normalize(fbo,fbs,LONG_PERIOD)

    def test_rows_must_be_inside_their_actual_request_window(self):
        fbo,fbs=window_fixtures()
        change(fbo[0],lambda data:data['postings'][0].update(created_at='2026-09-16T09:00:00Z'))
        with self.assertRaisesRegex(orders.OrderError,'ORDERS_OUTSIDE_PERIOD'):normalize(fbo,fbs,LONG_PERIOD)

    def test_each_window_finishes_its_cursor_chain_then_restarts_cursor(self):
        fbo,fbs=window_fixtures();first=orders.windows(LONG_PERIOD)[0]
        change(fbo[0],lambda data:data.update(has_next=True,cursor='page-1'))
        fbo.insert(1,packet('fbo',page([]),'first-window-terminal','page-1',first))
        value=normalize(fbo,fbs,LONG_PERIOD);self.assertEqual(value.checkpoint()['window_pages']['fbo'],[2,1,1])
        fbo[2]['request']['cursor']='page-1'
        with self.assertRaisesRegex(orders.OrderError,'ORDERS_REQUEST_CHANGED'):normalize(fbo,fbs,LONG_PERIOD)

    def test_missing_window_terminal_cannot_start_next_window(self):
        fbo,fbs=window_fixtures();change(fbo[0],lambda data:data.update(has_next=True,cursor='page-1'))
        with self.assertRaisesRegex(orders.OrderError,'ORDERS_WINDOW_MISMATCH'):normalize(fbo,fbs,LONG_PERIOD)

    def test_wide_single_call_is_not_implicitly_qualified(self):
        with self.assertRaisesRegex(orders.OrderError,'ORDERS_REQUEST_WINDOW'):orders.expected_request('fbo',LONG_PERIOD,'')
        fbo,fbs=window_fixtures();fbo[0]['request']['filter']['to']=fbo[-1]['request']['filter']['to']
        with self.assertRaisesRegex(orders.OrderError,'ORDERS_WINDOW_MISMATCH'):normalize(fbo,fbs,LONG_PERIOD)

    def test_reused_receipt_is_rejected(self):
        fbo,fbs=fixtures();fbs[0]['receipt_id']=fbo[0]['receipt_id']
        with self.assertRaisesRegex(orders.OrderError,'ORDERS_RECEIPT_REUSED'):normalize(fbo,fbs)

    def test_wrong_scope_or_http_status_rejected(self):
        for mutate in (lambda item:item['scope'].update(store_id='foreign'),lambda item:item.update(http=206)):
            fbo,fbs=fixtures();mutate(fbo[0])
            with self.assertRaisesRegex(orders.OrderError,'ORDERS_SOURCE_SCOPE'):normalize(fbo,fbs)

    def test_receipt_verifier_required_and_exact_true(self):
        fbo,fbs=fixtures()
        for verifier in (None,lambda packet:False,lambda packet:1):
            with self.assertRaises(orders.OrderError):orders.normalize(fbo,fbs,TARGET,PERIOD,verify=verifier,encode=encode)

    def test_raw_body_hash_and_duplicate_json_key_checked(self):
        fbo,fbs=fixtures();fbo[0]['body']+=b' '
        with self.assertRaisesRegex(orders.OrderError,'ORDERS_BODY_HASH'):normalize(fbo,fbs)
        fbo,fbs=fixtures();raw=fbo[0]['body'].replace(b'"has_next": false',b'"has_next": false, "has_next": true')
        fbo[0].update(body=raw,response_sha256=sha256(raw).hexdigest())
        with self.assertRaisesRegex(orders.OrderError,'ORDERS_DUPLICATE_JSON_KEY'):normalize(fbo,fbs)

    def test_normalized_rows_and_checkpoint_discard_personal_fields(self):
        value=normalize();text=json.dumps(value.data)
        for private in ('PRIVATE','private@example.invalid','fbo-receipt','fbs-receipt'):
            self.assertNotIn(private,text)
        self.assertNotIn('1000.123456789',json.dumps(value.checkpoint()))
        for row in value.data['rows']:self.assertEqual(set(row),{'posting','sku','scheme','day','quantity','seller_price'})

    def test_object_seal_is_required_and_cannot_attest_modified_rows(self):
        value=normalize()
        with self.assertRaisesRegex(orders.OrderError,'ORDERS_UNQUALIFIED_OBJECT'):orders.QualifiedOrders(value.payload_json).checkpoint()
        with self.assertRaisesRegex(orders.OrderError,'ORDERS_UNQUALIFIED_OBJECT'):replace(value,payload_json=value.payload_json.replace('1000.123456789','1')).data

    def test_cohort_source_contract_keeps_exact_period_and_scope(self):
        value=normalize();block=value.for_cohort(PERIOD,TARGET)
        cohort._checked_source('orders',block,TARGET,PERIOD,lambda name,data,target,period:data==block)
        with self.assertRaises(orders.OrderError):value.for_cohort({'from':'2026-11-12','to':'2026-11-13'},TARGET)
        with self.assertRaises(orders.OrderError):value.for_cohort(PERIOD,{**TARGET,'store_id':'foreign'})

    def test_inputs_are_not_mutated(self):
        fbo,fbs=fixtures();before=deepcopy((fbo,fbs));normalize(fbo,fbs);self.assertEqual((fbo,fbs),before)
