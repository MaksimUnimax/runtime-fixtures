"""Synthetic exact-byte OTHER sources; no provider, account, database or model."""
from copy import deepcopy
from dataclasses import replace
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, localcontext
from hashlib import sha256
from unittest import TestCase
import hmac, json
from alisa_platform.owner_data import economics_orders as orders
from alisa_platform.owner_data import economics_other as other
from alisa_platform.owner_data import economics_cohort as cohort
from alisa_platform.owner_data import parameter_contract as c

TARGET={'tenant_id':'synthetic-other-tenant','store_id':'synthetic-other-store','provider':'OZON','currency':'RUB'}
PERIOD={'from':'2026-11-13','to':'2026-11-13'}
AS_OF='2026-11-14T03:05:00Z'
POST='PRIVATE-OTHER-POSTING'


def encode(kind,value):return hmac.new(b'synthetic-other-job',(kind+'\0'+str(value)).encode(),'sha256').hexdigest()


def money(value):return {'amount':value,'currency':'RUB'}


def packet(operation,request,data,receipt,stamp='2026-11-14T03:00:00Z'):
    body=json.dumps(data,ensure_ascii=False).encode()
    return {'operation':operation,'scope':deepcopy(TARGET),'request':deepcopy(request),'body':body,
            'received_at':stamp,'receipt_id':receipt,'response_sha256':sha256(body).hexdigest(),'http':200}


def edit(item,change):
    data=json.loads(item['body']);change(data);item['body']=json.dumps(data).encode()
    item['response_sha256']=sha256(item['body']).hexdigest()


def verifier(packets):
    known=deepcopy(packets)
    return lambda item:any(item==original for original in known)


def order_post(ident=POST,scheme='fbo',products=None):
    return {'posting_number':ident,'status':'cancelled','created_at':'2026-11-13T00:00:00Z',
            'in_process_at':'2026-11-13T00:00:00Z','products':products or [
                {'sku':101,'quantity':2,'price':'1000','currency_code':'RUB'}]}


def qualified(fbo=None,fbs=None,stamps=None):
    first=[order_post()]if fbo is None else fbo;second=[]if fbs is None else fbs
    stamps=stamps or {'fbo':'2026-11-14T02:00:00Z','fbs':'2026-11-14T02:00:00Z'}
    packets=[packet(orders.CATALOG['schemes'][scheme]['operation'],orders.expected_request(scheme,PERIOD,''),
               {'postings':items,'cursor':'','has_next':False},'order-'+scheme,stamps[scheme])
             for scheme,items in [('fbo',first),('fbs',second)]]
    return orders.normalize([packets[0]],[packets[1]],TARGET,PERIOD,verify=verifier(packets),encode=encode)


def entry(amount='-10',day='2026-11-13',kind=93,sku=None,quantity=None):
    value={'type_id':kind,'accrual_date':day,'accrued':money(amount),
           'seller_price':{'uninterpreted':'PRIVATE SELLER INFORMATION'}}
    if sku is not None:value.update(sku=sku,quantity=quantity)
    return value


def record(ident='PRIVATE-ACCRUAL-1',amount='-10',day='2026-11-13',kind=93,posting=POST,sku=None,quantity=None,scheme=None):
    value={'accrual_id':ident,'date':day,'total_amount':money(amount),'accrued_category':'NON_ITEM',
           'posting':None,'item_fees':None,'non_item_fee':None,'container_fees':None}
    if posting is not None:value['unit_number']=posting
    fee={'type_id':kind,'accrued':money(amount)}
    if scheme is not None:
        value['accrued_category']='POSTING'
        value['posting']={'delivery_schema':scheme,'products':[{'sku':sku,'quantity':quantity,'commission':None,
                'delivery':{'total_accrued':money(amount),'services':[fee]}}]}
    elif sku is not None:
        value['accrued_category']='ITEM';value['item_fees']={'fees':[{'sku':sku,'quantity':quantity,'fees':[fee]}]}
    else:value['non_item_fee']=fee
    return value


def posting_packet(rows=None,requested=None,receipt='posting-receipt',stamp='2026-11-14T03:00:00Z'):
    return packet(other.CATALOG['posting_operation'],{'posting_numbers':[POST]if requested is None else requested},
                  {'posting_accruals':[{'posting_number':POST,'accruals':[entry()]}]if rows is None else rows},receipt,stamp)


def day_packet(rows=None,day='2026-11-13',cursor='',next_cursor='',receipt=None,stamp='2026-11-14T03:01:00Z'):
    return packet(other.CATALOG['day_operation'],{'date':day,'last_id':cursor},
                  {'accruals':[record(day=day)]if rows is None else rows,'last_id':next_cursor},receipt or 'day-'+day,stamp)


def scan(records=None,first='2026-11-13',last='2026-11-14'):
    records=[record()]if records is None else records;result=[];day=date.fromisoformat(first)
    while day<=date.fromisoformat(last):
        result.append(day_packet([row for row in records if row['date']==day.isoformat()],day.isoformat(),
                    stamp=(datetime(2026,11,14,3,1,tzinfo=timezone.utc)+timedelta(seconds=len(result))).isoformat()))
        day+=timedelta(days=1)
    return result


def normalize(posts=None,days=None,order=None,**kwargs):
    posts=[posting_packet()]if posts is None else posts;days=scan()if days is None else days
    return other.normalize(posts,days,qualified()if order is None else order,
        verify=kwargs.pop('verify',verifier(posts+days)),encode=kwargs.pop('encode',encode),as_of=kwargs.pop('as_of',AS_OF),**kwargs)


def amounts(value,order=None):return [Decimal(row['amount'])for row in value.line_inputs(qualified()if order is None else order).values()]


class OtherSources(TestCase):
    def test_unapplied_seller_price_keeps_arbitrary_json_decimal_precision(self):
        p=posting_packet();data=json.loads(p['body']);data['posting_accruals'][0]['accruals'][0]['seller_price']='EXACT_NUMERIC_PRICE'
        p['body']=json.dumps(data).replace('"EXACT_NUMERIC_PRICE"','999999999999999.123456789012345678901234567890').encode()
        p['response_sha256']=sha256(p['body']).hexdigest()
        self.assertEqual(amounts(normalize([p])),[Decimal('10')])

    def test_last_order_page_not_first_page_bounds_snapshot(self):
        order=qualified(stamps={'fbo':'2026-11-14T02:00:00Z','fbs':'2026-11-14T04:00:00Z'})
        with self.assertRaisesRegex(other.OtherError,'OTHER_FUTURE_PERIOD'):normalize(order=order)

    def test_all_order_pages_precede_financial_source(self):
        order=qualified(stamps={'fbo':'2026-11-14T02:00:00Z','fbs':'2026-11-14T03:00:30Z'})
        with self.assertRaisesRegex(other.OtherError,'OTHER_ORDERS_SOURCE_SEQUENCE'):normalize(order=order)

    def test_zero_cohort_last_order_page_precedes_day_scan(self):
        order=qualified([],[],stamps={'fbo':'2026-11-14T02:00:00Z','fbs':'2026-11-14T03:02:00Z'})
        with self.assertRaisesRegex(other.OtherError,'OTHER_ORDERS_SOURCE_SEQUENCE'):normalize([],scan([]),order)

    def test_signed_expense_is_not_an_original_debit_claim(self):
        result=normalize();self.assertEqual(amounts(result),[Decimal('10')])
        inputs=result.line_inputs(qualified());key=c.CANON([encode('posting',POST),'101','fbo'])
        self.assertEqual(set(inputs),{key});basis=inputs[key]['basis']
        self.assertEqual(basis['kind'],'OBSERVED_SIGNED_POSTING_ACCRUAL_SNAPSHOT')
        self.assertEqual(basis['allocation'],'ORIGINAL_PHYSICAL_UNITS')
        self.assertEqual(len(basis['events']),1)
        self.assertFalse(result.data['financial_history_final']);self.assertFalse(result.data['original_cohort_debits_classified'])
        self.assertFalse(result.data['all_other_fees_complete']);self.assertTrue(result.data['observed_approved_other_complete'])

    def test_real_component_identity_matches_existing_r11(self):
        from alisa_platform.owner_data import economics_accruals as accruals
        expected=accruals.extract(record(),encode)['atoms'][0]['id']
        self.assertEqual(normalize().checkpoint()['selected_component_ids'],[expected])

    def test_negative_positive_and_zero_keep_financial_sign(self):
        for value,expected in [('-10','10'),('10','-10'),('0','0')]:
            with self.subTest(value=value):
                p=posting_packet([{'posting_number':POST,'accruals':[entry(value)]}])
                result=normalize([p],scan([record(amount=value)]))
                self.assertEqual(amounts(result),[Decimal(expected)])

    def test_credit_and_debit_net_without_coefficient_or_absolute_value(self):
        p=posting_packet([{'posting_number':POST,'accruals':[entry('-100'),entry('25')]}])
        value=normalize([p],scan([record(amount='-100'),record('PRIVATE-CREDIT',amount='25')]))
        self.assertEqual(amounts(value),[Decimal('75')]);self.assertEqual(value.data['matched_components'],2)

    def test_identical_amounts_with_distinct_actual_ids_keep_multiplicity(self):
        p=posting_packet([{'posting_number':POST,'accruals':[entry(),entry()]}])
        value=normalize([p],scan([record(),record('PRIVATE-ACCRUAL-2')]))
        self.assertEqual(amounts(value),[Decimal('20')]);self.assertEqual(value.data['matched_accruals'],2)

    def test_duplicate_same_actual_id_in_day_source_is_deduplicated(self):
        value=normalize(days=scan([record(),record()]))
        self.assertEqual(amounts(value),[Decimal('10')]);self.assertEqual(value.data['duplicate_day_records'],1)

    def test_duplicate_by_postings_row_is_not_silently_deduplicated(self):
        p=posting_packet([{'posting_number':POST,'accruals':[entry(),entry()]}])
        with self.assertRaisesRegex(other.OtherError,'OTHER_SNAPSHOT_MISMATCH'):normalize([p])

    def test_same_total_with_different_component_multiset_is_rejected(self):
        p=posting_packet([{'posting_number':POST,'accruals':[entry('-10'),entry('-20')]}])
        with self.assertRaisesRegex(other.OtherError,'OTHER_SNAPSHOT_MISMATCH'):
            normalize([p],scan([record(amount='-15'),record('PRIVATE-SECOND',amount='-15')]))

    def test_changed_same_actual_id_is_not_latest_wins(self):
        with self.assertRaisesRegex(other.OtherError,'ACCRUAL_ID_CONTENT_CHANGED'):
            normalize(days=scan([record(),record(amount='-11')]))

    def test_changed_unselected_parent_content_also_rejected(self):
        changed=record();changed['total_amount']=money('-12')
        with self.assertRaisesRegex(other.OtherError,'ACCRUAL_ID_CONTENT_CHANGED'):
            normalize(days=scan([record(),changed]))

    def test_late_fee_belongs_to_order_cohort(self):
        p=posting_packet([{'posting_number':POST,'accruals':[entry(day='2026-11-14')]}])
        value=normalize([p],scan([record(day='2026-11-14')]))
        self.assertEqual(amounts(value),[Decimal('10')]);self.assertEqual(value.data['period'],PERIOD)

    def test_earlier_accrual_extends_required_financial_window(self):
        p=posting_packet([{'posting_number':POST,'accruals':[entry(day='2026-11-12')]}])
        days=scan([record(day='2026-11-12')],first='2026-11-12')
        value=normalize([p],days);self.assertEqual(value.data['financial_period'],{'from':'2026-11-12','to':'2026-11-14'})
        with self.assertRaisesRegex(other.OtherError,'ACCRUAL_PAGE_CHAIN'):normalize([p],days[1:])

    def test_non_other_accrual_dates_also_extend_window(self):
        p=posting_packet([{'posting_number':POST,'accruals':[entry(),entry('-50',day='2026-11-12',kind=69,sku=101,quantity=2)]}])
        value=normalize([p],scan(first='2026-11-12'))
        self.assertEqual(value.data['financial_period']['from'],'2026-11-12')
        self.assertEqual(amounts(value),[Decimal('10')])

    def test_explicit_empty_accruals_require_complete_posting_set_and_scan(self):
        p=posting_packet([{'posting_number':POST,'accruals':[]}]);value=normalize([p],scan([]))
        self.assertEqual(amounts(value),[Decimal('0')]);self.assertEqual(value.data['matched_components'],0)
        basis=next(iter(value.line_inputs(qualified()).values()))['basis']
        self.assertEqual(basis['zero_proof'],other.CATALOG['zero_basis']);self.assertEqual(basis['events'],[])
        with self.assertRaises(other.OtherError):normalize([p],scan([])[:1])
        with self.assertRaises(other.OtherError):normalize([],scan([]))

    def test_empty_response_is_not_proven_empty_cohort(self):
        with self.assertRaisesRegex(other.OtherError,'OTHER_POSTING_SET_INCOMPLETE'):
            normalize([posting_packet([])],scan([]))

    def test_zero_orders_use_both_order_chains_no_fake_posting_request(self):
        order=qualified([],[]);value=normalize([],scan([]),order)
        self.assertEqual(value.line_inputs(order),{});self.assertTrue(value.data['zero_cohort'])
        self.assertEqual(value.checkpoint()['zero_cohort_basis'],other.CATALOG['zero_cohort_basis'])
        self.assertEqual(value.data['source_pages']['posting_batches'],0)
        with self.assertRaises(other.OtherError):normalize([],[],order)
        with self.assertRaises(other.OtherError):normalize([posting_packet([],[])],scan([]),order)

    def test_zero_cohort_preserves_unallocated_store_observations_separately(self):
        order=qualified([],[]);value=normalize([],scan([record(kind=46,posting=None),record('OTHER',kind=38,posting='outside')]),order)
        self.assertEqual(value.line_inputs(order),{});self.assertEqual(value.data['unallocated_components'],{'46':1})
        self.assertEqual(value.data['outside_cohort_components'],{'38':1})

    def test_missing_one_requested_posting_is_rejected(self):
        order=qualified([order_post(),order_post('PRIVATE-SECOND')]);p=posting_packet(requested=[POST,'PRIVATE-SECOND'])
        with self.assertRaisesRegex(other.OtherError,'OTHER_POSTING_SET_INCOMPLETE'):normalize([p],order=order)

    def test_missing_one_batch_is_rejected(self):
        order=qualified([order_post(),order_post('PRIVATE-SECOND')])
        with self.assertRaisesRegex(other.OtherError,'OTHER_POSTING_SET_INCOMPLETE'):normalize(order=order)

    def test_two_disjoint_batches_cover_the_whole_set(self):
        second='PRIVATE-SECOND';order=qualified([order_post(),order_post(second)])
        p=posting_packet([{'posting_number':second,'accruals':[]}],[second],'second-batch')
        value=normalize([posting_packet(),p],order=order)
        self.assertEqual(sorted(amounts(value,order)),[Decimal('0'),Decimal('10')])

    def test_duplicate_batch_or_request_identifier_is_rejected(self):
        p=posting_packet(receipt='another-receipt')
        with self.assertRaisesRegex(other.OtherError,'OTHER_DUPLICATE_POSTING_REQUEST'):normalize([posting_packet(),p])
        p=posting_packet(requested=[POST,POST])
        with self.assertRaisesRegex(other.OtherError,'OTHER_DUPLICATE_POSTING_REQUEST'):normalize([p])

    def test_duplicate_response_posting_is_rejected(self):
        p=posting_packet([{'posting_number':POST,'accruals':[]},{'posting_number':POST,'accruals':[]}])
        with self.assertRaisesRegex(other.OtherError,'OTHER_POSTING_RESPONSE_SET'):normalize([p])

    def test_provider_batch_limit_and_nonempty_request_are_enforced(self):
        for request in ([],[str(i)for i in range(201)]):
            with self.assertRaisesRegex(other.OtherError,'OTHER_POSTING_REQUEST'):normalize([posting_packet([],request)])

    def test_outside_cohort_requested_or_returned_posting_rejected(self):
        with self.assertRaisesRegex(other.OtherError,'OTHER_OUTSIDE_COHORT'):
            normalize([posting_packet(requested=['PRIVATE-FOREIGN'])])
        with self.assertRaisesRegex(other.OtherError,'OTHER_POSTING_RESPONSE_SET'):
            normalize([posting_packet([{'posting_number':'PRIVATE-FOREIGN','accruals':[]}])])

    def test_unknown_types_in_either_selected_surface_block(self):
        for kind in (38,39,77,9999):
            with self.subTest(kind=kind):
                p=posting_packet([{'posting_number':POST,'accruals':[entry(kind=kind)]}])
                with self.assertRaisesRegex(other.OtherError,'OTHER_UNCLASSIFIED_FEE'):normalize([p])
                with self.assertRaisesRegex(other.OtherError,'OTHER_UNCLASSIFIED_FEE'):
                    normalize(days=scan([record(),record('PRIVATE-UNKNOWN',kind=kind)]))

    def test_nonselected_or_unallocated_unknown_is_reported_not_allocated(self):
        value=normalize(days=scan([record(),record('OUTSIDE',kind=38,posting='PRIVATE-FOREIGN'),record('UNALLOCATED',kind=46,posting=None)]))
        self.assertEqual(amounts(value),[Decimal('10')])
        self.assertEqual(value.checkpoint()['outside_cohort_components'],{'38':1})
        self.assertEqual(value.checkpoint()['unallocated_components'],{'46':1})

    def test_known_other_formula_groups_are_not_added_to_other(self):
        known=other.KNOWN-other.OTHER;records=[record()];entries=[entry()]
        for kind in known:
            records.append(record('KNOWN-'+str(kind),kind=kind));entries.append(entry(kind=kind))
        p=posting_packet([{'posting_number':POST,'accruals':entries}]);value=normalize([p],scan(records))
        self.assertEqual(amounts(value),[Decimal('10')]);self.assertEqual(value.data['matched_components'],1)
        self.assertEqual(set(map(int,value.data['selected_other_group_components'])),known)

    def test_catalog_groups_are_exact_confirmed_r10_groups(self):
        self.assertEqual(other.OTHER,set(cohort.CATALOG['fee_groups']['other']['types']))
        self.assertEqual(set(other.CATALOG['excluded_delivery_types']),set(cohort.CATALOG['excluded_fee_types']))
        for name,types in other.CATALOG['other_formula_groups'].items():
            self.assertEqual(set(types),set(cohort.CATALOG['fee_groups'][name]['types']))
        self.assertNotIn(38,other.KNOWN);self.assertNotIn(39,other.KNOWN)

    def test_actual_item_quantity_is_matched_not_replaced_by_order_quantity(self):
        p=posting_packet([{'posting_number':POST,'accruals':[entry(sku=101,quantity=1)]}])
        value=normalize([p],scan([record(sku=101,quantity=1)]))
        self.assertEqual(amounts(value),[Decimal('10')])
        self.assertIsNone(next(iter(value.line_inputs(qualified()).values()))['basis']['allocation'])
        with self.assertRaisesRegex(other.OtherError,'OTHER_SNAPSHOT_MISMATCH'):
            normalize([p],scan([record(sku=101,quantity=2)]))

    def test_signed_item_quantity_and_credit_do_not_need_parent_classification(self):
        p=posting_packet([{'posting_number':POST,'accruals':[entry('4',sku=101,quantity=-1)]}])
        value=normalize([p],scan([record(amount='4',sku=101,quantity=-1)]))
        self.assertEqual(amounts(value),[Decimal('-4')])

    def test_foreign_sku_or_half_present_item_fields_rejected(self):
        for changes in ({'sku':999,'quantity':1},{'sku':101},{'quantity':1}):
            p=posting_packet();edit(p,lambda data:data['posting_accruals'][0]['accruals'][0].update(changes))
            with self.assertRaises(other.OtherError):normalize([p])
        with self.assertRaisesRegex(other.OtherError,'OTHER_SKU_NOT_IN_POSTING'):
            normalize(days=scan([record(sku=999,quantity=1)]))

    def test_item_to_posting_or_date_projection_mismatch_is_rejected(self):
        for changed in (record(sku=101,quantity=2),record(day='2026-11-14')):
            with self.assertRaisesRegex(other.OtherError,'OTHER_SNAPSHOT_MISMATCH'):normalize(days=scan([changed]))

    def test_by_day_scheme_cannot_relabel_an_order(self):
        p=posting_packet([{'posting_number':POST,'accruals':[entry(sku=101,quantity=2)]}])
        with self.assertRaisesRegex(other.OtherError,'OTHER_SCHEME_MISMATCH'):
            normalize([p],scan([record(sku=101,quantity=2,scheme='Fbs')]))

    def test_multi_sku_allocation_uses_original_quantities_and_exact_residual(self):
        order=qualified([order_post(products=[{'sku':101,'quantity':1,'price':'1'},
                       {'sku':102,'quantity':2,'price':'9000'}])])
        p=posting_packet([{'posting_number':POST,'accruals':[entry('-1')]}])
        value=normalize([p],scan([record(amount='-1')]),order);result=value.line_inputs(order)
        left=Decimal(result[c.CANON([encode('posting',POST),'101','fbo'])]['amount'])
        right=Decimal(result[c.CANON([encode('posting',POST),'102','fbo'])]['amount'])
        with localcontext()as ctx:
            ctx.prec=200;self.assertEqual(left+right,Decimal(1));self.assertLess(abs(left*2-right),Decimal('1e-58'))
        self.assertEqual(len(value.checkpoint()['selected_component_ids']),1)

    def test_mixed_posting_and_item_fees_allocate_once(self):
        order=qualified([order_post(products=[{'sku':101,'quantity':1,'price':'1'},{'sku':102,'quantity':1,'price':'2'}])])
        p=posting_packet([{'posting_number':POST,'accruals':[entry('-10'),entry('-3',sku=101,quantity=1)]}])
        value=normalize([p],scan([record(),record('ITEM',amount='-3',sku=101,quantity=1)]),order)
        self.assertEqual(sorted(amounts(value,order)),[Decimal('5'),Decimal('8')])

    def test_precision_above_default_decimal_context_is_preserved(self):
        amount='-0.12345678901234567890123456789012345678901234567890123456789'
        p=posting_packet([{'posting_number':POST,'accruals':[entry(amount)]}])
        value=normalize([p],scan([record(amount=amount)]))
        self.assertEqual(next(iter(value.line_inputs(qualified()).values()))['amount'],amount[1:])

    def test_seller_price_is_uninterpreted_and_never_a_fallback(self):
        p=posting_packet();edit(p,lambda data:data['posting_accruals'][0]['accruals'][0].update(seller_price=None))
        self.assertEqual(amounts(normalize([p])),[Decimal('10')])
        edit(p,lambda data:data['posting_accruals'][0]['accruals'][0].pop('accrued'))
        with self.assertRaisesRegex(other.OtherError,'OTHER_ACCRUAL_SCHEMA'):normalize([p])

    def test_future_response_or_accrual_is_rejected(self):
        p=posting_packet(stamp='2026-11-15T00:00:00Z')
        with self.assertRaisesRegex(other.OtherError,'OTHER_FUTURE_OBSERVATION'):normalize([p])
        p=posting_packet([{'posting_number':POST,'accruals':[entry(day='2026-11-15')]}])
        with self.assertRaisesRegex(other.OtherError,'OTHER_FUTURE_ACCRUAL'):normalize([p])
        with self.assertRaisesRegex(other.OtherError,'OTHER_FUTURE_PERIOD'):normalize(as_of='2026-11-12T01:00:00Z')

    def test_cross_surface_interleaving_is_not_the_registered_sequence(self):
        days=scan();days[0]['received_at']='2026-11-14T02:59:59Z'
        with self.assertRaisesRegex(other.OtherError,'OTHER_SOURCE_SEQUENCE'):normalize(days=days)

    def test_missing_cursor_page_and_nonterminal_empty_page_rejected(self):
        days=scan();edit(days[0],lambda data:data.update(last_id='next'))
        with self.assertRaisesRegex(other.OtherError,'ACCRUAL_PAGE_CHAIN'):normalize(days=days)
        days=scan([]);edit(days[0],lambda data:data.update(last_id='next'))
        p=posting_packet([{'posting_number':POST,'accruals':[]}])
        with self.assertRaisesRegex(other.OtherError,'ACCRUAL_CURSOR_NO_PROGRESS'):normalize([p],days)

    def test_duplicate_across_terminal_day_pages_is_deduplicated_by_real_id(self):
        days=[day_packet(next_cursor='next'),day_packet(cursor='next',receipt='day-second'),scan()[1]]
        value=normalize(days=days);self.assertEqual(amounts(value),[Decimal('10')]);self.assertEqual(value.data['duplicate_day_records'],1)

    def test_receipt_reuse_across_surfaces_or_order_source_rejected(self):
        for receipt in ('posting-receipt','order-fbo'):
            days=scan();days[0]['receipt_id']=receipt
            with self.assertRaisesRegex(other.OtherError,'OTHER_RECEIPT_REUSED'):normalize(days=days)

    def test_body_hash_and_real_verifier_are_mandatory(self):
        p=posting_packet();p['body']+=b' '
        with self.assertRaisesRegex(other.OtherError,'OTHER_BODY_HASH'):normalize([p])
        for result in (False,1,None):
            with self.assertRaisesRegex(other.OtherError,'OTHER_RECEIPT_REJECTED'):normalize(verify=lambda p:result)
        def broken(packet):raise RuntimeError('PRIVATE DIAGNOSTIC')
        with self.assertRaisesRegex(other.OtherError,'OTHER_RECEIPT_UNAVAILABLE'):normalize(verify=broken)

    def test_wrong_scope_operation_http_or_extra_packet_field_rejected(self):
        for change in ({'scope':{**TARGET,'store_id':'foreign'}},{'operation':'other_read'},{'http':True},{'approved':True}):
            p=posting_packet();p.update(change)
            with self.assertRaises(other.OtherError):normalize([p])

    def test_malformed_json_duplicate_keys_and_nonfinite_values_rejected(self):
        for raw in (b'not json',b'{"posting_accruals":[],"posting_accruals":[]}',b'{"posting_accruals":NaN}'):
            p=posting_packet();p.update(body=raw,response_sha256=sha256(raw).hexdigest())
            with self.assertRaises(other.OtherError):normalize([p])

    def test_float_or_boolean_money_and_foreign_currency_rejected(self):
        for value in (1.25,True,None,'1e2'):
            p=posting_packet();edit(p,lambda data:data['posting_accruals'][0]['accruals'][0]['accrued'].update(amount=value))
            with self.assertRaises(other.OtherError):normalize([p])
        p=posting_packet();edit(p,lambda data:data['posting_accruals'][0]['accruals'][0]['accrued'].update(currency='USD'))
        with self.assertRaisesRegex(other.OtherError,'OTHER_CURRENCY'):normalize([p])

    def test_unqualified_orders_or_public_accrual_object_not_admitted(self):
        with self.assertRaisesRegex(other.OtherError,'OTHER_QUALIFIED_ORDERS_REQUIRED'):normalize(order=orders.QualifiedOrders(qualified().payload_json))
        from alisa_platform.owner_data import economics_accruals as accruals
        with self.assertRaisesRegex(other.OtherError,'OTHER_SOURCE_INCOMPLETE'):
            other.normalize([posting_packet()],accruals.ObservedAccruals('{}'),qualified(),
                            verify=lambda packet:True,encode=encode,as_of=AS_OF)

    def test_output_seal_and_order_binding_cannot_be_relabelled(self):
        value=normalize()
        with self.assertRaisesRegex(other.OtherError,'OTHER_UNQUALIFIED_OBJECT'):other.ObservedOther(value.payload_json).checkpoint()
        with self.assertRaisesRegex(other.OtherError,'OTHER_UNQUALIFIED_OBJECT'):replace(value,payload_json=value.payload_json+' ').checkpoint()
        changed=qualified([order_post(products=[{'sku':101,'quantity':3,'price':'1000'}])])
        with self.assertRaisesRegex(other.OtherError,'OTHER_ORDERS_CHANGED'):value.line_inputs(changed)

    def test_for_cohort_requires_exact_recorded_order_block(self):
        value=normalize();order=qualified();block=order.for_cohort(PERIOD,TARGET)
        self.assertEqual(value.for_cohort(PERIOD,TARGET,block),value.line_inputs(order))
        for mutate in (lambda b:b.update(receipt_hash='a'*64),lambda b:b['rows'][0].update(seller_price='999'),lambda b:b.update(extra=True)):
            changed=deepcopy(block);mutate(changed)
            with self.assertRaisesRegex(other.OtherError,'OTHER_ORDERS_CHANGED'):value.for_cohort(PERIOD,TARGET,changed)
        with self.assertRaisesRegex(other.OtherError,'OTHER_SOURCE_SCOPE'):value.for_cohort(PERIOD,{**TARGET,'store_id':'foreign'},block)

    def test_checkpoint_has_no_raw_identity_info_or_coefficient_values(self):
        value=normalize();raw=json.dumps(value.checkpoint())
        for text in ('PRIVATE','posting-receipt','day-2026','order-fbo','seller_price','loss_rate'):
            self.assertNotIn(text,raw)
        self.assertNotIn('PRIVATE',value.payload_json);self.assertNotIn('PRIVATE',repr(value))
        with self.assertRaises(TypeError):json.dumps(value)

    def test_inputs_remain_unchanged_and_returned_inputs_are_copies(self):
        posts=[posting_packet()];days=scan();before=deepcopy((posts,days));value=normalize(posts,days)
        self.assertEqual((posts,days),before)
        result=value.line_inputs(qualified());next(iter(result.values()))['amount']='999'
        self.assertEqual(amounts(value),[Decimal('10')])
