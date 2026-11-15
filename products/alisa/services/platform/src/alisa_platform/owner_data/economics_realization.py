"""Attested Ozon realization DOCUMENT snapshots, never inferred accrual events.

The current sale branch's standard_fee is base commission, not the unrelated
commission field and not sale minus return. The source does not establish cash
acquiring, an original-accrual ID, or absence of later adjustments. No IO here.
"""
from copy import deepcopy
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, localcontext
from hashlib import sha256
from calendar import monthrange
from collections import defaultdict
import json,re
from zoneinfo import ZoneInfo
from . import parameter_contract as c

OPERATIONS={'finance_realization_posting':'POSTING','finance_realization_v2':'MONTHLY'}
BRANCHES={'delivery_commission':'SALE','return_commission':'RETURN'}
MONEY=('price_per_instance','amount','compensation','commission','bonus','standard_fee',
       'total','stars','bank_coinvestment','pick_up_point_coinvestment')
ADDITIVE=('quantity',)+MONEY[1:]
HEADER={'number','doc_date','start_date','stop_date','contract_date','contract_number',
        'payer_name','payer_inn','payer_kpp','receiver_name','receiver_inn','receiver_kpp','currency_sys_name'}
HEX=re.compile(r'[a-f0-9]{64}')

class RealizationError(ValueError):
    def __init__(self,code):self.code=code;super().__init__(code)

def need(ok,code):
    if not ok:raise RealizationError(code)

def exact(value,keys):need(type(value)is dict and set(value)==set(keys),'REALIZATION_SCHEMA')
def digest(value):return sha256(c.CANON(value).encode()).hexdigest()
def number(value):
    # JSON is parsed with Decimal; normalize int/Decimal exactly at this source
    # boundary, never coerce float/bool or weaken the saved-value contract.
    if type(value)is int:value=str(value)
    elif type(value)is Decimal:value=format(value,'f')
    try:return c.number(value)
    except c.ParameterError:raise RealizationError('REALIZATION_NUMBER')from None

def day(value):
    # The actual source returned both 2026-10-01 and 2026-10-1. This normalizes
    # calendar syntax, not the economic period or a timezone inferred from text.
    need(type(value)is str and re.fullmatch(r'\d{4}-\d{1,2}-\d{1,2}',value),'REALIZATION_DATE')
    try:return date(*map(int,value.split('-')))
    except ValueError:raise RealizationError('REALIZATION_DATE')from None

def identifier(value):
    need(type(value)in(str,int)and type(value)is not bool,'REALIZATION_ID')
    text=str(value);need(bool(text)and not any(ord(ch)<32 for ch in text),'REALIZATION_ID');return text

def _encoded(encode,kind,value):
    result=encode(kind,identifier(value))
    need(type(result)is str and HEX.fullmatch(result),'REALIZATION_ID_ENCODER');return result

def _pairs(pairs):
    result={}
    for key,value in pairs:
        need(key not in result,'REALIZATION_DUPLICATE_JSON_KEY');result[key]=value
    return result

def _constant(value):raise RealizationError('REALIZATION_NUMBER')

@dataclass(frozen=True,repr=False)
class RealizationSnapshot:
    payload_json:str
    def __repr__(self):return '<RealizationSnapshot; document, not event stream>'
    @property
    def data(self):return json.loads(self.payload_json)
    def summary(self):
        data=self.data
        return {k:deepcopy(data[k])for k in ('kind','scope','report_period','document_key','document_date',
                'source_receipt','source_sha256','observed_at','row_count','branch_counts',
                'date_axis','original_accrual_relations_proven','acquiring_present')}


def normalize(packet,*,verify,encode):
    """Admit raw bytes only through the existing job's trusted receipt verifier."""
    packet=deepcopy(packet)
    exact(packet,('operation','scope','request','body','received_at','receipt_id','response_sha256','http'))
    need(type(packet['operation'])is str and packet['operation']in OPERATIONS,'REALIZATION_OPERATION')
    target=packet['scope'];exact(target,('tenant_id','store_id','provider','currency'))
    identifier(target['tenant_id']);identifier(target['store_id'])
    need(target['provider']=='OZON'and target['currency']=='RUB','REALIZATION_SCOPE')
    exact(packet['request'],('month','year'));month=packet['request']['month'];year=packet['request']['year']
    need(type(month)is int and type(year)is int and 1<=month<=12 and 1<=year<=9999,'REALIZATION_MONTH')
    first=date(year,month,1);last=date(year,month,monthrange(year,month)[1]);period={'from':first.isoformat(),'to':last.isoformat()}
    try:observed=c.stamp(packet['received_at'])
    except c.ParameterError:raise RealizationError('REALIZATION_OBSERVATION_CLOCK')from None
    need(observed.astimezone(ZoneInfo('Europe/Moscow')).date()>last,'REALIZATION_MONTH_NOT_CLOSED')
    need(packet['http']==200 and type(packet['body'])is bytes,'REALIZATION_RESPONSE')
    need(type(packet['response_sha256'])is str and HEX.fullmatch(packet['response_sha256'])
         and sha256(packet['body']).hexdigest()==packet['response_sha256'],'REALIZATION_RESPONSE_HASH')
    identifier(packet['receipt_id']);need(callable(verify)and callable(encode),'REALIZATION_VERIFIER_REQUIRED')
    try:valid=verify(deepcopy(packet))
    except Exception:raise RealizationError('REALIZATION_RECEIPT_UNAVAILABLE')from None
    need(valid is True,'REALIZATION_RECEIPT_REJECTED')
    try:source=json.loads(packet['body'],parse_float=Decimal,parse_constant=_constant,object_pairs_hook=_pairs)
    except (ValueError,UnicodeError)as error:
        if isinstance(error,RealizationError):raise
        raise RealizationError('REALIZATION_JSON')from None
    kind=OPERATIONS[packet['operation']]
    if kind=='MONTHLY':exact(source,('result',));source=source['result']
    exact(source,('header','rows'));header=source['header']
    need(type(header)is dict and HEADER<=set(header)<=HEADER|{'doc_amount','vat_amount'},'REALIZATION_HEADER')
    need(header['currency_sys_name']=='RUB','REALIZATION_CURRENCY')
    need(day(header['start_date'])==first and day(header['stop_date'])==last,'REALIZATION_PERIOD_MISMATCH')
    document_date=day(header['doc_date']);need(last<=document_date<=observed.astimezone(ZoneInfo('Europe/Moscow')).date(),'REALIZATION_DOCUMENT_DATE')
    document_key=_encoded(encode,'realization-document',c.CANON([target,period,identifier(header['number'])]))
    need(type(source['rows'])is list,'REALIZATION_ROWS')
    rows=[];numbers=set();branches=defaultdict(int)
    with localcontext()as context:
        context.prec=60
        for raw in source['rows']:
            row_field='row_number'if kind=='POSTING'else'rowNumber'
            fields={'item','seller_price_per_instance','delivery_commission','return_commission','commission_ratio',row_field}
            if kind=='POSTING':fields|={'order','legal_entity_document'}
            exact(raw,fields);ordinal=raw[row_field]
            need(type(ordinal)is int and ordinal>0 and ordinal not in numbers,'REALIZATION_ROW_ID');numbers.add(ordinal)
            exact(raw['item'],('name','offer_id','barcode','sku'));sku=identifier(raw['item']['sku'])
            try:c.scope({'kind':'sku','sku':sku})
            except c.ParameterError:raise RealizationError('REALIZATION_SKU')from None
            price=number(raw['seller_price_per_instance']);ratio=number(raw['commission_ratio'])
            need(price>=0 and 0<=ratio<=1,'REALIZATION_PRICE_OR_RATIO')
            posting=None;created=None
            if kind=='POSTING':
                exact(raw['order'],('posting_number','created_date'))
                posting=_encoded(encode,'posting',raw['order']['posting_number']);created=day(raw['order']['created_date'])
                need(created<=last,'REALIZATION_ORDER_AFTER_PERIOD')
                if raw['legal_entity_document']is not None:
                    exact(raw['legal_entity_document'],('number','sale_date'))
                    identifier(raw['legal_entity_document']['number']);day(raw['legal_entity_document']['sale_date'])
            row={'row_ref':digest([document_key,packet['response_sha256'],ordinal]),'sku':sku,
                 'posting':posting,'order_day':created.isoformat()if created else None,
                 'seller_price':c.decimal_text(price),'commission_ratio':c.decimal_text(ratio),'sides':{}}
            for field,role in BRANCHES.items():
                branch=raw[field]
                if branch is None:continue
                exact(branch,('quantity',*MONEY));quantity=branch['quantity']
                need(type(quantity)is int and quantity>0,'REALIZATION_QUANTITY_UNCLASSIFIED')
                money={k:number(branch[k])for k in MONEY}
                need(all(v>=0 for v in money.values()),'REALIZATION_SIGN_UNCLASSIFIED')
                # A mismatching fee is not silently coerced to seller-price tariff.
                need(abs(money['standard_fee']-price*quantity*ratio)<=Decimal('.01')*quantity,
                     'REALIZATION_BASE_COMMISSION_UNRECONCILED')
                need(abs(money['amount']-money['price_per_instance']*quantity)<=Decimal('.01')*quantity,
                     'REALIZATION_AMOUNT_UNRECONCILED')
                row['sides'][role]={'quantity':str(quantity),**{k:c.decimal_text(v)for k,v in money.items()}}
                branches[role]+=1
            need(bool(row['sides']),'REALIZATION_EMPTY_ROW')
            rows.append(row)
    data={'kind':kind,'scope':target,'report_period':period,'document_key':document_key,
          'document_date':document_date.isoformat(),'source_receipt':str(packet['receipt_id']),
          'source_sha256':packet['response_sha256'],'observed_at':observed.isoformat(),
          'row_count':len(rows),'branch_counts':dict(branches),'rows':rows,
          'date_axis':'REALIZATION_MONTH_NOT_ORDER_COHORT','original_accrual_relations_proven':False,
          'acquiring_present':False,'snapshot_versions_are_not_additive':True}
    return RealizationSnapshot(c.CANON(data))


def _totals(snapshot):
    values=defaultdict(lambda:defaultdict(Decimal))
    with localcontext()as context:
        context.prec=60
        for row in snapshot.data['rows']:
            for role,money in row['sides'].items():
                for name in ADDITIVE:values[(row['sku'],role)][name]+=number(money[name])
                values[(row['sku'],role)]['seller_turnover']+=number(row['seller_price'])*number(money['quantity'])
    return {key:dict(value)for key,value in values.items()}

@dataclass(frozen=True,repr=False)
class ReconciledRealization:
    posting:RealizationSnapshot
    monthly:RealizationSnapshot
    def __repr__(self):return '<ReconciledRealization; one current document pair>'
    def checkpoint(self):
        return {'document_key':self.posting.data['document_key'],'report_period':self.posting.data['report_period'],
                'source_sha256':[self.posting.data['source_sha256'],self.monthly.data['source_sha256']],
                'receipts':[self.posting.data['source_receipt'],self.monthly.data['source_receipt']],
                'snapshot_not_event_stream':True,'old_values_stored':False}


def reconcile(posting,monthly):
    need(type(posting)is RealizationSnapshot and type(monthly)is RealizationSnapshot,'REALIZATION_TYPED_SNAPSHOT_REQUIRED')
    left,right=posting.data,monthly.data
    need(left['kind']=='POSTING'and right['kind']=='MONTHLY','REALIZATION_SOURCE_PAIR')
    need(all(left[k]==right[k]for k in ('scope','report_period','document_key','document_date')),'REALIZATION_DOCUMENT_MISMATCH')
    need(left['source_receipt']!=right['source_receipt'],'REALIZATION_RECEIPT_REUSED')
    need(_totals(posting)==_totals(monthly),'REALIZATION_TOTALS_MISMATCH')
    return ReconciledRealization(posting,monthly)


def commission_matches(reconciled,orders,target):
    """For already authenticated ORIGINAL order rows, not inferred from report.

    Matching is posting+SKU, exact created day/price/whole original quantity.
    Missing/partial/return-only realization is explicit unknown, never zero.
    Returns remain separate: no sale-return netting or fabricated parent events.
    """
    need(type(reconciled)is ReconciledRealization,'REALIZATION_RECONCILED_REQUIRED')
    document=reconciled.posting.data
    need(document['scope']==target,'REALIZATION_SCOPE')
    need(type(orders)is list,'REALIZATION_ORDERS')
    group=defaultdict(list)
    for row in document['rows']:group[(row['posting'],row['sku'])].append(row)
    matched={};unmatched={};seen=set()
    with localcontext()as context:
        context.prec=60
        for order in orders:
            exact(order,('posting','sku','scheme','day','quantity','seller_price'))
            k=(order['posting'],order['sku'],order['scheme']);need(k not in seen,'REALIZATION_DUPLICATE_ORDER');seen.add(k)
            need(type(order['posting'])is str and HEX.fullmatch(order['posting']),'REALIZATION_ORDER_ID_NOT_SCOPED')
            quantity=number(order['quantity']);price=number(order['seller_price'])
            need(quantity>0 and quantity==quantity.to_integral_value()and price>=0,'REALIZATION_ORDER_VALUE')
            created=day(order['day']);need(order['scheme']in('fbo','fbs'),'REALIZATION_ORDER_SCHEME')
            candidates=group.get(k[:2],[])
            if not candidates:unmatched[k]='NOT_IN_REALIZATION_SNAPSHOT';continue
            need(all(day(row['order_day'])==created for row in candidates),'REALIZATION_ORDER_DATE_MISMATCH')
            sales=[row for row in candidates if 'SALE'in row['sides']]
            if not sales:unmatched[k]='RETURN_ONLY_NO_ORIGINAL_SALE';continue
            need(all(number(row['seller_price'])==price for row in sales),'REALIZATION_ORDER_PRICE_MISMATCH')
            realized=sum((number(row['sides']['SALE']['quantity'])for row in sales),Decimal(0))
            need(realized<=quantity,'REALIZATION_OVERLAPPING_SALE_COVERAGE')
            if realized<quantity:unmatched[k]='PARTIAL_REALIZATION_NOT_FULL_ORIGINAL_QUANTITY';continue
            amount=sum((number(row['sides']['SALE']['standard_fee'])for row in sales),Decimal(0))
            matched[k]={'sale_base_commission':{'amount':c.decimal_text(amount),
                       'basis':{'kind':'REALIZATION_BASE_COMMISSION_SNAPSHOT','document_key':document['document_key'],
                                'snapshot_sha256':document['source_sha256'],'row_refs':[row['row_ref']for row in sales],
                                'source_field':'delivery_commission.standard_fee','return_netted':False,
                                'provider_accrual_id_claimed':False}}}
    return matched,unmatched
