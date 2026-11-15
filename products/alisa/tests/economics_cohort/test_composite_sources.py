"""Independent synthetic oracle across attested sources and the cohort formula.

Every input source is normalized through its real packet adapter. Expected
financial totals below are fixed hand-calculated constants, not outputs copied
from the implementation. No marketplace, model, database or saved owner values.
"""
from calendar import monthrange
from copy import deepcopy
from dataclasses import replace
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, Inexact, localcontext
from fractions import Fraction
from hashlib import sha256
from itertools import permutations
from unittest import TestCase
import hmac, json
from alisa_platform.owner_data import economics_orders as orders
from alisa_platform.owner_data import economics_other as other
from alisa_platform.owner_data import economics_tariffs as tariffs
from alisa_platform.owner_data import economics_periods as periods
from alisa_platform.owner_data import economics_realization as realization
from alisa_platform.owner_data import economics_cohort as economics
from economics_ledger.test_other_sources import order_post,entry,record
from economics_ledger.test_tariffs import price
from economics_ledger.test_realization import row as document_row,source as document_source,packet as document_packet
from economics_cohort import fixtures as legacy

TARGET={'tenant_id':'synthetic-composite','store_id':'synthetic-shop','provider':'OZON','currency':'RUB'}
PERIOD={'from':'2026-11-13','to':'2026-11-13'}
AS_OF='2027-01-06T03:00:00Z'
FIRST='PRIVATE-COMPOSITE-FBO';SECOND='PRIVATE-COMPOSITE-FBS'
OWNER={'tax_amount':{'state':'VALUE','value':'20'},'own_cost_amount':{'state':'VALUE','value':'50'}}

# Six physical original units in three SKU lines and two postings.
# Signed OTHER: posting FBO (-30 + 6), direct SKU101 (-5), FBS credit (+9)
# gives expense 24 + 5 - 9 = 20, independently of either scenario's loss rate.
ORACLE={
 'with_loss':{
  'original_units':'6','expected_retained_units':'4.8','original_turnover':'3100',
  'revenue':'2390','commission':'253.5','acquiring':'130','forward_last':'460',
  'reverse':'130','processing':'18','other':'20','cogs':'666','storage':'30','advertising':'100',
  'all_selected_costs':'1807.5','remainder_before_owner_inputs':'582.5','remainder_after_cogs_and_ads':'1624'},
 'without_loss':{
  'original_units':'6','expected_retained_units':'6','original_turnover':'3100',
  'revenue':'3100','commission':'315','acquiring':'130','forward_last':'460',
  'reverse':'0','processing':'18','other':'20','cogs':'840','storage':'30','advertising':'100',
  'all_selected_costs':'1913','remainder_before_owner_inputs':'1187','remainder_after_cogs_and_ads':'2160'}}


def encode(kind,value):return hmac.new(b'synthetic-composite-job',(kind+'\0'+str(value)).encode(),'sha256').hexdigest()


def packet(operation,request,data,receipt,stamp='2027-01-06T00:30:00Z',scope=None):
    raw=json.dumps(data,ensure_ascii=False,allow_nan=False).encode()
    return {'operation':operation,'scope':deepcopy(TARGET if scope is None else scope),'request':deepcopy(request),
            'body':raw,'received_at':stamp,'receipt_id':receipt,'response_sha256':sha256(raw).hexdigest(),'http':200}


def verifier(packets):
    expected=deepcopy(packets)
    return lambda value:any(value==original for original in expected)


def qualified_orders(zero=False,first_price='1000',scope=None):
    scope=TARGET if scope is None else scope
    content={'fbo':[]if zero else[order_post(FIRST,products=[
        {'sku':101,'quantity':2,'price':first_price,'currency_code':'RUB'},
        {'sku':102,'quantity':1,'price':'500','currency_code':'RUB'}])],
        'fbs':[]if zero else[order_post(SECOND,'fbs',[{'sku':103,'quantity':3,'price':'200','currency_code':'RUB'}])]}
    packets=[packet(orders.CATALOG['schemes'][scheme]['operation'],orders.expected_request(scheme,PERIOD,''),
        {'postings':content[scheme],'cursor':'','has_next':False},'orders-'+scheme,
        '2027-01-06T01:0'+str(index)+':00Z',scope)for index,scheme in enumerate(('fbo','fbs'))]
    return orders.normalize([packets[0]],[packets[1]],scope,PERIOD,verify=verifier(packets),encode=encode)


def observed_other(order_source,empty=False,line_expenses=None):
    zero=not order_source.data['rows'];scope=order_source.data['scope']
    entries=[];records=[]
    if line_expenses is not None:
        rows=sorted(order_source.data['rows'],key=economics.key)
        assert len(rows)==len(line_expenses)
        raw_by_token={encode('posting',raw):raw for raw in (FIRST,SECOND)}
        by_posting={FIRST:[],SECOND:[]}
        for index,(row,expense)in enumerate(zip(rows,line_expenses)):
            raw=raw_by_token[row['posting']];amount=expense[1:]if expense.startswith('-')else'-'+expense
            by_posting[raw].append(entry(amount,sku=int(row['sku']),quantity=int(row['quantity'])))
            records.append(record('PRIVATE-EXACT-'+str(index),amount=amount,posting=raw,
                                  sku=int(row['sku']),quantity=int(row['quantity'])))
        entries=[{'posting_number':raw,'accruals':items}for raw,items in by_posting.items()]
    elif not zero and not empty:
        first=[entry('-30'),entry('6'),entry('-5',sku=101,quantity=2),
               entry('-9999',kind=69,sku=101,quantity=2),entry('-888',kind=1,sku=101,quantity=2),
               entry('-1000',kind=32,sku=101,quantity=2)]
        second=[entry('9'),entry('-777',kind=16,sku=103,quantity=3)]
        entries=[{'posting_number':FIRST,'accruals':first},{'posting_number':SECOND,'accruals':second}]
        specifications=[('pool-debit','-30',93,FIRST,None,None),('pool-credit','6',93,FIRST,None,None),
          ('sku-other','-5',93,FIRST,101,2),('unclassified-original-commission','-9999',69,FIRST,101,2),
          ('unclassified-original-acquiring','-888',1,FIRST,101,2),('excluded-delivery','-1000',32,FIRST,101,2),
          ('credit-other','9',93,SECOND,None,None),('unclassified-original-processing','-777',16,SECOND,103,3)]
        records=[record('PRIVATE-'+name,amount=amount,kind=kind,posting=posting,sku=sku,quantity=quantity)
                 for name,amount,kind,posting,sku,quantity in specifications]
        records.append(deepcopy(records[0])) # R11 retrieval duplicate, same actual ID.
    elif not zero:entries=[{'posting_number':number,'accruals':[]}for number in (FIRST,SECOND)]
    posting_packets=[]if zero else[packet(other.CATALOG['posting_operation'],{'posting_numbers':[FIRST,SECOND]},
        {'posting_accruals':entries},'other-postings','2027-01-06T01:02:00Z',scope)]
    day_packets=[];day=date.fromisoformat(PERIOD['from']);last=date(2027,1,6)
    while day<=last:
        stamp=(datetime(2027,1,6,2,tzinfo=timezone.utc)+timedelta(seconds=len(day_packets))).isoformat()
        day_packets.append(packet(other.CATALOG['day_operation'],{'date':day.isoformat(),'last_id':''},
            {'accruals':[value for value in records if value['date']==day.isoformat()],'last_id':''},
            'other-day-'+day.isoformat(),stamp,scope));day+=timedelta(days=1)
    return other.normalize(posting_packets,day_packets,order_source,verify=verifier(posting_packets+day_packets),encode=encode,as_of=AS_OF)


def current_tariffs():
    values=[]
    for sku,percent,acquiring,return_fee in [(101,'10','10','100'),(102,'5','20','60'),(103,'15','30','200')]:
        item=price(1000+sku,acquiring);item['price']['price']='99999'
        item['commissions'].update(sales_percent_fbo=percent,sales_percent_fbs=percent,
            fbo_return_flow_amount=return_fee,fbs_return_flow_amount=return_fee,
            fbs_first_mile_min_amount='4',fbs_first_mile_max_amount='8');values.append(item)
    pages=[packet('product_prices_bulk',{'filter':{'visibility':'ALL'},'cursor':'','limit':1000},
                  {'items':values,'cursor':'','total':3,'total_items':3},'tariff-prices')]
    mappings=[packet('seller_product_info_list',{'product_id':['1101','1102','1103']},
                     {'items':[{'id':1000+sku,'sku':sku}for sku in (101,102,103)]},'tariff-mapping')]
    return tariffs.normalize(pages,mappings,TARGET,verify=verifier(pages+mappings),encode=encode)


def period_costs():
    content={
      'storage':{'cashflows':{'services':[
        {'name':'product_placement_in_ozon_warehouses','amount':{'value':'-30','currency_code':'RUB'}},
        {'name':'logistics','amount':{'value':'-999','currency_code':'RUB'}}]}},
      'advertising':{'rows':[{'id':'12','date':'2026-11-13','moneySpent':'100',
                              'ordersMoney':'999999','bonusSpent':'200','prepaymentSpent':'300'}]}}
    packets=[]
    for component in ('storage','advertising'):
        rule=periods.CATALOG['sources'][component]
        request=dict(zip(rule['request_keys'],(PERIOD['from'],PERIOD['to'])))
        packets.append(packet(rule['operation'],request,content[component],'period-'+component))
    proof=deepcopy(periods.CATALOG['sources']['advertising']['scope_requirements']);known=deepcopy(packets)
    return periods.normalize(packets,TARGET,PERIOD,verify=lambda value,scope:value in known and scope==proof,
                             scope_proof=proof,as_of=AS_OF)


def sources(zero=False,empty_other=False,line_expenses=None):
    order_source=qualified_orders(zero);other_source=observed_other(order_source,empty_other,line_expenses)
    tariff_source=current_tariffs();cost_source=period_costs()
    bundle={'orders':order_source.for_cohort(PERIOD,TARGET),
            'tariffs':tariff_source.for_cohort(order_source.data['rows'],PERIOD,TARGET),
            'period_costs':cost_source.as_source()}
    return order_source,other_source,tariff_source,cost_source,bundle


def attest(bundle):
    known=deepcopy(bundle)
    return lambda name,value,target,period:target==TARGET and period==PERIOD and name in known and value==known[name]


def qualify(values=None,documents=None):
    values=sources()if values is None else values;bundle=values[-1]
    return economics.qualify(bundle,TARGET,PERIOD,verify=attest(bundle),observed_other=values[1],realization=documents)


def calculated(cohort,owner=None,uniform_loss=None):
    settings={'101':('250','0.2','100'),'102':('100','0.5','50'),'103':('80','0.1','70')}
    costs={};coefficients={}
    for row in cohort.rows:
        key=economics.c.CANON(economics.key(row['order']));cost,loss,delivery=settings[row['order']['sku']]
        costs[key]=cost;coefficients[key]={'loss_rate':loss if uniform_loss is None else uniform_loss,'delivery_mean':delivery}
    return economics.calculate(cohort,costs,coefficients,deepcopy(OWNER if owner is None else owner))


def pair(month,rows,receipt_prefix=None):
    data=document_source(rows);end=date(2026,month,monthrange(2026,month)[1]).isoformat()
    data['header'].update(number='PRIVATE-DOC-'+str(month),start_date=date(2026,month,1).isoformat(),stop_date=end,doc_date=end)
    packets=[]
    for kind in ('POSTING','MONTHLY'):
        value=document_packet(data,kind,TARGET);value['request']={'month':month,'year':2026}
        value['received_at']='2027-01-06T00:10:00Z';value['receipt_id']=(receipt_prefix or 'realization-'+str(month))+'-'+kind;packets.append(value)
    verify=verifier(packets)
    left,right=[realization.normalize(value,verify=verify,encode=encode)for value in packets]
    return realization.reconcile(left,right)


def first_sale(quantity=2,returned=False):return document_row(FIRST,101,q=quantity,price='1000',ratio='0.075',returned=returned)
def second_sale():return document_row(SECOND,103,q=3,price='200',ratio='0.1')


class CompositeSources(TestCase):
    def test_observed_signed_other_cancellation_preserves_exact_low_unit_in_all_orders(self):
        large='1'+'0'*59
        for expenses in permutations((large,'0.1','-'+large)):
            with self.subTest(expenses_order=tuple(value.startswith('-')for value in expenses)):
                values=sources(line_expenses=expenses)
                self.assertEqual(sum((Fraction(item['amount'])for item in values[1].line_inputs(values[0]).values()),Fraction(0)),Fraction(1,10))
                result=calculated(qualify(values))
                self.assertEqual(result['scenarios']['with_loss']['totals']['other'],'0.1')
                self.assertEqual(result['scenarios']['without_loss']['totals']['other'],'0.1')
                self.assertEqual(result['scenarios']['with_loss']['totals']['all_selected_costs'],'1787.6')
                self.assertEqual(result['scenarios']['with_loss']['totals']['remainder_before_owner_inputs'],'602.4')
                self.assertEqual(result['scenarios']['without_loss']['after_declared_owner_inputs'],'1136.9')

    def test_exact_source_totals_do_not_depend_on_ambient_decimal_precision(self):
        large='1'+'0'*59;values=sources(line_expenses=(large,'0.1','-'+large))
        with localcontext()as context:
            context.prec=6;context.traps[Inexact]=True
            result=calculated(qualify(values))
        self.assertEqual(result['scenarios']['with_loss']['totals']['other'],'0.1')
        self.assertEqual(result['scenarios']['with_loss']['after_declared_owner_inputs'],'532.4')

    def test_report_cost_and_owner_subtractions_preserve_signed_cancellation(self):
        large='1'+'0'*59;cohort=qualify(sources(line_expenses=('-'+large,'0.1','0')))
        owner={'tax_amount':{'state':'VALUE','value':large},'own_cost_amount':{'state':'VALUE','value':'602.3'}}
        result=calculated(cohort,owner)
        self.assertEqual(result['scenarios']['with_loss']['after_declared_owner_inputs'],'0.1')
        self.assertEqual(result['scenarios']['without_loss']['after_declared_owner_inputs'],'604.6')

    def test_finite_cogs_products_and_terminating_unit_ratio_remain_exact(self):
        cohort=qualify();cost='0.'+'1'*59;loss='0.'+'2'*59;costs={};coefficients={}
        for row in cohort.rows:
            key=economics.c.CANON(economics.key(row['order']));selected=row['order']['sku']=='103'
            costs[key]=cost if selected else'0'
            coefficients[key]={'loss_rate':loss if selected else'0','delivery_mean':'0'}
        result=economics.calculate(cohort,costs,coefficients,deepcopy(OWNER))['scenarios']['with_loss']
        expected=Fraction(cost)*3*(1-Fraction(loss))
        self.assertEqual(Fraction(result['totals']['cogs']),expected)
        self.assertEqual(Fraction(result['per_original_unit']['cogs']),expected/6)

    def test_recurring_unit_ratio_preserves_existing_sixty_digit_precision(self):
        result=calculated(qualify())['scenarios']['with_loss']
        self.assertEqual(result['per_original_unit']['other'],'3.'+'3'*59)
        self.assertEqual(result['per_original_unit']['revenue'],'398.'+'3'*57)

    def test_classified_original_and_corrections_keep_exact_signed_remainder(self):
        large='1'+'0'*59
        original=legacy.event(amount='-'+large)
        debit=legacy.event('tiny',amount='-0.1',nature='CORRECTION',parent='fee1')
        credit=legacy.event('credit',amount=large,nature='CORRECTION',parent='fee1')
        for changes in ((debit,credit),(credit,debit)):
            bundle=legacy.bundle(fees=[original,*changes]);cohort=legacy.qualify(bundle)
            self.assertEqual(cohort.rows[0]['inputs']['commission_original'],'0.1')
            costs,parameters=legacy.numbers(cohort)
            result=economics.calculate(cohort,costs,parameters,legacy.unknown())
            self.assertEqual(result['scenarios']['with_loss']['totals']['commission'],'0.08')

    def test_posting_allocation_does_not_round_product_before_exact_division(self):
        rows=[legacy.order(quantity='2',price='0'),legacy.order(sku='102',quantity='1',price='0')]
        pooled=legacy.event(typ=93,amount='-'+'9'*60);pooled['sku']=None;pooled['quantity']=None
        bundle=legacy.bundle(rows=rows,fees=[pooled],quotes=[legacy.tariff(),legacy.tariff(sku='102')])
        cohort=legacy.qualify(bundle);values={row['order']['sku']:row['inputs']['other']for row in cohort.rows}
        self.assertEqual(values,{'101':'6'*60,'102':'3'*60})

    def test_unrepresentable_derived_line_input_is_rejected_not_rounded_to_fit(self):
        bundle=legacy.bundle(rows=[legacy.order(quantity='10',price='1'+'0'*59)])
        with self.assertRaisesRegex(economics.EconomicsError,'ECONOMICS_PARAMETER_DECIMAL_PRECISION'):legacy.qualify(bundle)

    def test_external_number_precision_limit_is_unchanged(self):
        bundle=legacy.bundle(rows=[legacy.order(quantity='1',price='1'+'0'*60)])
        with self.assertRaisesRegex(economics.EconomicsError,'ECONOMICS_PARAMETER_DECIMAL_PRECISION'):legacy.qualify(bundle)

    def test_all_nine_cost_groups_and_both_scenarios_match_fixed_oracle(self):
        result=calculated(qualify())
        for scenario,expected in ORACLE.items():
            with self.subTest(scenario=scenario):
                actual=result['scenarios'][scenario]
                self.assertEqual({key:actual['totals'][key]for key in expected},expected)
                self.assertEqual(Decimal(actual['totals']['drr_percent']).quantize(Decimal('.000001')),Decimal('3.225806'))
                self.assertTrue(actual['owner_inputs_complete']);self.assertTrue(actual['not_actual_profit'])
        self.assertEqual(result['scenarios']['with_loss']['after_declared_owner_inputs'],'512.5')
        self.assertEqual(result['scenarios']['without_loss']['after_declared_owner_inputs'],'1117')

    def test_every_money_denominator_uses_six_original_physical_units(self):
        result=calculated(qualify())
        with localcontext()as context:
            context.prec=60
            for scenario,expected in ORACLE.items():
                for name in economics.CATALOG['money_outputs']:
                    self.assertEqual(Decimal(result['scenarios'][scenario]['per_original_unit'][name]),Decimal(expected[name])/6,(scenario,name))

    def test_original_quantities_keep_cancelled_orders_and_multi_sku_posting(self):
        values=sources();cohort=qualify(values);result=calculated(cohort)
        self.assertEqual(len(cohort.rows),3);self.assertEqual(values[1].checkpoint()['cohort_postings'],2)
        self.assertEqual(result['scenarios']['with_loss']['totals']['original_units'],'6')
        self.assertEqual(result['scenarios']['with_loss']['totals']['expected_retained_units'],'4.8')

    def test_pooled_component_ids_are_shared_but_amounts_count_once(self):
        values=sources();cohort=qualify(values);items={row['order']['sku']:row for row in cohort.rows}
        self.assertEqual({sku:value['inputs']['other']for sku,value in items.items()},{'101':'21','102':'8','103':'-9'})
        events=[value['basis']['other']['events']for value in items.values()]
        self.assertEqual(sum(map(len,events)),6);self.assertEqual(len(set().union(*map(set,events))),4)
        self.assertEqual(cohort.checkpoint()['observed_other']['matched_components'],4)
        self.assertEqual(cohort.checkpoint()['observed_other']['duplicate_day_records'],1)

    def test_observed_non_original_other_groups_do_not_replace_tariff_estimates(self):
        cohort=qualify();items={row['order']['sku']:row for row in cohort.rows}
        self.assertEqual(items['101']['inputs']['commission_original'],'200')
        self.assertEqual(items['101']['inputs']['acquiring'],'20')
        self.assertEqual(items['103']['inputs']['processing'],'18')
        self.assertEqual(items['101']['basis']['commission_original']['kind'],'SCHEME_TARIFF_ESTIMATE')
        self.assertEqual(items['101']['basis']['acquiring']['kind'],'RUBLE_TARIFF_ESTIMATE')
        self.assertEqual(items['103']['basis']['processing']['kind'],'SCHEME_TARIFF_ESTIMATE')
        self.assertFalse(cohort.checkpoint()['observed_other']['original_cohort_debits_classified'])

    def test_coefficient_rebind_does_not_scale_other_acquiring_processing_or_delivery(self):
        cohort=qualify();before=cohort.checkpoint();result=calculated(cohort,uniform_loss='0.5')['scenarios']['with_loss']
        self.assertEqual(result['totals']['other'],'20');self.assertEqual(result['totals']['acquiring'],'130')
        self.assertEqual(result['totals']['processing'],'18');self.assertEqual(result['totals']['forward_last'],'460')
        self.assertEqual(result['totals']['revenue'],'1550');self.assertEqual(result['totals']['reverse'],'430')
        self.assertEqual(result['totals']['original_units'],'6');self.assertEqual(result['totals']['all_selected_costs'],'1765.5')
        self.assertEqual(cohort.checkpoint(),before)

    def test_unknown_or_excluded_owner_amounts_never_become_numeric_zero(self):
        cohort=qualify()
        for state in ('NOT_PROVIDED','EXCLUDED_BY_OWNER'):
            owner=deepcopy(OWNER);owner['tax_amount']={'state':state,'value':None}
            result=calculated(cohort,owner)
            for scenario in result['scenarios'].values():
                self.assertIsNone(scenario['after_declared_owner_inputs']);self.assertFalse(scenario['owner_inputs_complete'])
                self.assertEqual(scenario['unknown_owner_inputs'],['tax_amount'])

    def test_zero_cohort_keeps_full_period_costs_and_undefined_unit_ratios(self):
        values=sources(zero=True);cohort=qualify(values);result=calculated(cohort)
        self.assertEqual(cohort.rows,[]);self.assertEqual(values[0].checkpoint()['source_pages'],{'fbo':1,'fbs':1})
        self.assertTrue(cohort.checkpoint()['observed_other']['zero_cohort'])
        self.assertEqual(cohort.checkpoint()['observed_other']['source_pages']['posting_batches'],0)
        for scenario in result['scenarios'].values():
            self.assertEqual(scenario['totals']['original_units'],'0');self.assertEqual(scenario['totals']['other'],'0')
            self.assertEqual(scenario['totals']['storage'],'30');self.assertEqual(scenario['totals']['advertising'],'100')
            self.assertEqual(scenario['totals']['all_selected_costs'],'130');self.assertEqual(scenario['totals']['remainder_before_owner_inputs'],'-130')
            self.assertEqual(scenario['after_declared_owner_inputs'],'-200');self.assertIsNone(scenario['totals']['drr_percent'])
            self.assertTrue(all(value is None for value in scenario['per_original_unit'].values()))

    def test_observed_empty_other_requires_its_separate_proven_basis(self):
        cohort=qualify(sources(empty_other=True));result=calculated(cohort)
        self.assertEqual(result['scenarios']['with_loss']['totals']['other'],'0')
        for row in cohort.rows:
            self.assertEqual(row['basis']['other']['kind'],'OBSERVED_SIGNED_POSTING_ACCRUAL_SNAPSHOT')
            self.assertEqual(row['basis']['other']['zero_proof'],'COMPLETE_POSTING_SET_AND_RECONCILED_DAY_SCAN')

    def test_forged_observed_other_object_is_rejected_even_with_trusted_bundle(self):
        values=sources();bundle=values[-1];fake=other.ObservedOther(values[1].payload_json)
        with self.assertRaisesRegex(economics.EconomicsError,'OTHER_UNQUALIFIED_OBJECT'):
            economics.qualify(bundle,TARGET,PERIOD,verify=attest(bundle),observed_other=fake)

    def test_valid_other_seal_does_not_replace_current_bundle_attestation(self):
        values=sources();bundle=values[-1]
        with self.assertRaisesRegex(economics.EconomicsError,'ECONOMICS_SOURCE_NOT_QUALIFIED'):
            economics.qualify(bundle,TARGET,PERIOD,verify=lambda *args:False,observed_other=values[1])

    def test_modified_observed_other_payload_cannot_keep_its_original_seal(self):
        values=sources();payload=values[1].data;next(iter(payload['line_inputs'].values()))['amount']='999'
        fake=replace(values[1],payload_json=economics.c.CANON(payload));bundle=values[-1]
        with self.assertRaisesRegex(economics.EconomicsError,'OTHER_UNQUALIFIED_OBJECT'):
            economics.qualify(bundle,TARGET,PERIOD,verify=attest(bundle),observed_other=fake)

    def test_public_checkpoint_dict_is_not_an_observed_source(self):
        values=sources();bundle=values[-1]
        with self.assertRaisesRegex(economics.EconomicsError,'ECONOMICS_OTHER_SOURCE_REQUIRED'):
            economics.qualify(bundle,TARGET,PERIOD,verify=attest(bundle),observed_other=values[1].checkpoint())

    def test_same_scope_but_changed_orders_are_not_rebound_to_old_other(self):
        values=sources();bundle=deepcopy(values[-1]);bundle['orders']=qualified_orders(first_price='1001').for_cohort(PERIOD,TARGET)
        with self.assertRaisesRegex(economics.EconomicsError,'OTHER_ORDERS_CHANGED'):
            economics.qualify(bundle,TARGET,PERIOD,verify=attest(bundle),observed_other=values[1])

    def test_changed_order_receipt_header_is_not_rebound_by_matching_row_values(self):
        values=sources();bundle=deepcopy(values[-1]);bundle['orders']['receipt_hash']='f'*64
        with self.assertRaisesRegex(economics.EconomicsError,'OTHER_ORDERS_CHANGED'):
            economics.qualify(bundle,TARGET,PERIOD,verify=attest(bundle),observed_other=values[1])

    def test_empty_original_fee_block_cannot_be_mixed_with_observed_other(self):
        values=sources();bundle=deepcopy(values[-1]);bundle['fees']={**deepcopy(bundle['orders']),'rows':[]}
        with self.assertRaisesRegex(economics.EconomicsError,'ECONOMICS_SCHEMA'):
            economics.qualify(bundle,TARGET,PERIOD,verify=attest(bundle),observed_other=values[1])

    def test_missing_other_source_cannot_enable_fake_qualified_fee_absence(self):
        bundle=sources()[-1]
        with self.assertRaisesRegex(economics.EconomicsError,'ECONOMICS_SCHEMA'):
            economics.qualify(bundle,TARGET,PERIOD,verify=attest(bundle))

    def test_reconciled_distinct_documents_supply_original_commission_once(self):
        documents=[pair(11,[first_sale(returned=True)]),pair(12,[second_sale()])]
        cohort=qualify(documents=documents);result=calculated(cohort);items={row['order']['sku']:row for row in cohort.rows}
        self.assertEqual(items['101']['inputs']['commission_original'],'150');self.assertEqual(items['103']['inputs']['commission_original'],'60')
        self.assertEqual(items['102']['inputs']['commission_original'],'25')
        for sku in ('101','103'):
            basis=items[sku]['basis']['commission_original'];self.assertEqual(basis['kind'],'REALIZATION_BASE_COMMISSION_SNAPSHOT')
            self.assertFalse(basis['return_netted']);self.assertFalse(basis['provider_accrual_id_claimed'])
        self.assertEqual(result['scenarios']['with_loss']['totals']['commission'],'186.5')
        self.assertEqual(result['scenarios']['without_loss']['totals']['commission'],'235')
        self.assertEqual(result['scenarios']['with_loss']['totals']['remainder_before_owner_inputs'],'649.5')
        self.assertEqual(result['scenarios']['without_loss']['totals']['remainder_before_owner_inputs'],'1267')
        self.assertEqual(len(cohort.checkpoint()['realization_document']),2)

    def test_realization_document_order_does_not_change_commission_or_remainder(self):
        documents=[pair(11,[first_sale()]),pair(12,[second_sale()])]
        left=calculated(qualify(documents=documents));right=calculated(qualify(documents=list(reversed(documents))))
        for scenario in left['scenarios']:self.assertEqual(left['scenarios'][scenario]['totals'],right['scenarios'][scenario]['totals'])

    def test_repeated_closed_month_is_rejected_without_latest_or_sum(self):
        document=pair(11,[first_sale()])
        with self.assertRaisesRegex(economics.EconomicsError,'REALIZATION_DUPLICATE_MONTH'):qualify(documents=[document,document])

    def test_same_complete_original_line_in_two_months_is_rejected(self):
        with self.assertRaisesRegex(economics.EconomicsError,'REALIZATION_MULTIPLE_DOCUMENT_COVERAGE'):
            qualify(documents=[pair(11,[first_sale()]),pair(12,[first_sale()])])

    def test_full_and_partial_sale_coverage_cannot_ignore_extra_original_units(self):
        with self.assertRaises(economics.EconomicsError):
            qualify(documents=[pair(11,[first_sale()]),pair(12,[first_sale(quantity=1)])])

    def test_partial_documents_cannot_overcover_original_line_in_aggregate(self):
        partial=document_row(SECOND,103,q=2,price='200',ratio='0.1')
        with self.assertRaisesRegex(economics.EconomicsError,'REALIZATION_MULTIPLE_DOCUMENT_COVERAGE'):
            qualify(documents=[pair(11,[partial]),pair(12,[partial])])

    def test_partial_months_are_not_fabricated_into_complete_original_commission(self):
        cohort=qualify(documents=[pair(11,[first_sale(quantity=1)]),pair(12,[first_sale(quantity=1)])])
        item=next(row for row in cohort.rows if row['order']['sku']=='101')
        self.assertEqual(item['inputs']['commission_original'],'200')
        self.assertEqual(item['basis']['commission_original']['kind'],'SCHEME_TARIFF_ESTIMATE')
        self.assertEqual(item['basis']['commission_original']['document_status'],'PARTIAL_REALIZATION_NOT_FULL_ORIGINAL_QUANTITY')

    def test_return_only_later_document_does_not_net_confirmed_sale_base(self):
        returned=first_sale(returned=True);returned['delivery_commission']=None
        cohort=qualify(documents=[pair(11,[first_sale()]),pair(12,[returned])])
        item=next(row for row in cohort.rows if row['order']['sku']=='101')
        self.assertEqual(item['inputs']['commission_original'],'150');self.assertFalse(item['basis']['commission_original']['return_netted'])

    def test_reused_realization_receipts_across_months_are_rejected(self):
        with self.assertRaisesRegex(economics.EconomicsError,'REALIZATION_RECEIPT_REUSED'):
            qualify(documents=[pair(11,[first_sale()],receipt_prefix='shared'),pair(12,[second_sale()],receipt_prefix='shared')])

    def test_unsealed_realization_pair_is_rejected_inside_composite(self):
        value=pair(11,[first_sale()]);forged=realization.ReconciledRealization(value.posting,value.monthly)
        with self.assertRaisesRegex(economics.EconomicsError,'REALIZATION_PAIR_NOT_RECONCILED'):qualify(documents=[forged])

    def test_empty_closed_document_list_keeps_commission_estimate_unknown(self):
        cohort=qualify(documents=[])
        for row in cohort.rows:
            self.assertEqual(row['basis']['commission_original']['kind'],'SCHEME_TARIFF_ESTIMATE')
            self.assertEqual(row['basis']['commission_original']['document_status'],'NO_CLOSED_REALIZATION_DOCUMENT')

    def test_composite_checkpoint_contains_no_private_source_ids_or_amounts(self):
        cohort=qualify(documents=[pair(11,[first_sale()]),pair(12,[second_sale()])]);checkpoint=json.dumps(cohort.checkpoint())
        for value in ('PRIVATE','918273645','-9999','-888','-777','realization-11','other-day-'):
            self.assertNotIn(value,checkpoint)
        self.assertFalse(cohort.checkpoint()['persist_values']);self.assertFalse(cohort.checkpoint()['observed_other']['financial_history_final'])
