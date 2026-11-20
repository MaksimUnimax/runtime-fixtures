"""Complete, receipt-attested FBO/FBS order units for a Moscow order period.

The per-product seller price comes only from the registered posting response.
Current statuses never remove original units, including later cancellations.
No IO, account authority, coefficient values, CSV or aggregate-price fallback.
"""
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal
from hashlib import sha256
from pathlib import Path
from zoneinfo import ZoneInfo
import hmac, json, re, secrets
from . import parameter_contract as c

CATALOG=json.loads(Path(__file__).with_name('economics_order_catalog.json').read_text())
HASH=sha256(c.CANON(CATALOG).encode()).hexdigest()
SCHEMES=tuple(CATALOG['schemes'])
_KEY=secrets.token_bytes(32)
HEX=re.compile(r'[a-f0-9]{64}')


class OrderError(ValueError):
    def __init__(self,code):self.code=code;super().__init__(code)


def need(ok,code):
    if not ok:raise OrderError(code)


def _target(value):
    need(type(value)is dict and set(value)=={'tenant_id','store_id','provider','currency'}
         and value['provider']=='OZON'and value['currency']=='RUB','ORDERS_SOURCE_SCOPE')
    for key in ('tenant_id','store_id'):
        need(type(value[key])is str and bool(value[key])and not any(ord(ch)<32 for ch in value[key]),'ORDERS_SOURCE_SCOPE')


def _dates(value):
    try:return c.dates(value)
    except c.ParameterError:raise OrderError('ORDERS_PERIOD')from None


def _stamp(value,code='ORDERS_OBSERVATION'):
    try:return c.stamp(value)
    except c.ParameterError:raise OrderError(code)from None


def _encoded(encode,kind,value):
    result=encode(kind,value)
    need(type(result)is str and HEX.fullmatch(result)is not None,'ORDERS_SCOPED_ID')
    return result


def _pairs(pairs):
    result={}
    for key,value in pairs:
        need(key not in result,'ORDERS_DUPLICATE_JSON_KEY');result[key]=value
    return result


def _constant(value):raise OrderError('ORDERS_NUMBER')


def _number(value):
    # JSON fractions retain Decimal precision. Reject floats and booleans, and
    # bound fixed-point representation before expanding an exponent.
    if type(value)is int:value=str(value)
    elif type(value)is Decimal:
        need(value.is_finite(),'ORDERS_NUMBER')
        digits=value.as_tuple();exponent=digits.exponent
        need(-60<=exponent<=60 and max(1,len(digits.digits)+exponent)+max(0,-exponent)<=60,'ORDERS_NUMBER')
        value=format(value,'f')
    try:return c.number(value)
    except c.ParameterError:raise OrderError('ORDERS_NUMBER')from None


def windows(period):
    """Cover the whole report using the existing qualified query's window.

    This is a conservative registered posting_metadata request boundary, not a
    claim about the provider's maximum and not a total report-period limit.
    """
    first,last=_dates(period);limit=CATALOG['request_window']['max_days'];result=[]
    need(type(limit)is int and limit>0,'ORDERS_WINDOW_CONTRACT')
    while True:
        stop=first+timedelta(days=min(limit,(last-first).days+1)-1)
        result.append({'from':first.isoformat(),'to':stop.isoformat()})
        if stop==last:return result
        first=stop+timedelta(days=1)


def expected_request(scheme,period,cursor):
    """Business contract checked against the existing native request builder."""
    need(scheme in SCHEMES and type(cursor)is str and len(cursor)<=4096,'ORDERS_REQUEST_SCHEMA')
    first,last=_dates(period);zone=ZoneInfo(CATALOG['timezone'])
    need((last-first).days<CATALOG['request_window']['max_days'],'ORDERS_REQUEST_WINDOW')
    bounds=[datetime.combine(first,time.min,zone),datetime.combine(last,time.max,zone)]
    start,end=[value.astimezone(timezone.utc).isoformat().replace('+00:00','Z')for value in bounds]
    return {'filter':{'since':start,'to':end},'limit':CATALOG['page_size'],'cursor':cursor,
            **deepcopy(CATALOG['request']),**deepcopy(CATALOG['schemes'][scheme]['request_extra'])}


def _read(packet,scheme,target,period,cursor,verify):
    need(type(packet)is dict and set(packet)=={'operation','scope','request','body','received_at','receipt_id','response_sha256','http'},'ORDERS_PACKET_SCHEMA')
    need(packet['operation']==CATALOG['schemes'][scheme]['operation']and packet['scope']==target
         and type(packet['http'])is int and packet['http']==200,'ORDERS_SOURCE_SCOPE')
    need(type(packet['body'])is bytes and type(packet['response_sha256'])is str
         and HEX.fullmatch(packet['response_sha256'])is not None
         and sha256(packet['body']).hexdigest()==packet['response_sha256'],'ORDERS_BODY_HASH')
    _stamp(packet['received_at'])
    need(type(packet['receipt_id'])is str and bool(packet['receipt_id']),'ORDERS_RECEIPT')
    expected=expected_request(scheme,period,cursor);request=packet['request']
    need(type(request)is dict and type(request.get('filter'))is dict,'ORDERS_REQUEST_CHANGED')
    need(all(type(request['filter'].get(key))is str and request['filter'][key]==expected['filter'][key]
             for key in ('since','to')),'ORDERS_WINDOW_MISMATCH')
    try:matches=c.CANON(request)==c.CANON(expected)
    except (TypeError,ValueError):matches=False
    need(matches,'ORDERS_REQUEST_CHANGED')
    try:valid=verify(deepcopy(packet))
    except Exception:raise OrderError('ORDERS_RECEIPT_UNAVAILABLE')from None
    need(valid is True,'ORDERS_RECEIPT_REJECTED')
    try:return json.loads(packet['body'],parse_float=Decimal,parse_constant=_constant,object_pairs_hook=_pairs)
    except (ValueError,UnicodeError)as error:
        if isinstance(error,OrderError):raise
        raise OrderError('ORDERS_JSON')from None


def _page(packet,scheme,target,period,cursor,*,verify,encode):
    """Validate one captured page; cross-page completeness is checked below."""
    data=_read(packet,scheme,target,period,cursor,verify);fields=CATALOG['response']
    need(type(data)is dict and {fields['postings'],fields['has_next'],fields['cursor']}<=set(data),'ORDERS_RESPONSE_SCHEMA')
    postings=data[fields['postings']];has_next=data[fields['has_next']];next_cursor=data[fields['cursor']]
    need(type(postings)is list and len(postings)<=CATALOG['page_size']and type(has_next)is bool
         and type(next_cursor)is str and len(next_cursor)<=4096,'ORDERS_RESPONSE_SCHEMA')
    if has_next:need(bool(postings)and bool(next_cursor)and next_cursor!=cursor,'ORDERS_CURSOR_CHAIN')
    first,last=_dates(period);rows=[];seen=set()
    for posting in postings:
        need(type(posting)is dict,'ORDERS_POSTING_SCHEMA')
        ident=posting.get(fields['posting'])
        need(type(ident)is str and 0<len(ident)<=256 and not any(ord(ch)<32 for ch in ident),'ORDERS_POSTING_ID')
        token=_encoded(encode,'posting',ident);need(token not in seen,'ORDERS_DUPLICATE_POSTING');seen.add(token)
        need(type(posting.get(fields['status']))is str and bool(posting[fields['status']]),'ORDERS_STATUS_SCHEMA')
        day=_stamp(posting.get(CATALOG['schemes'][scheme]['day_field']),'ORDERS_ORDER_DAY').astimezone(ZoneInfo(CATALOG['timezone'])).date()
        need(first<=day<=last,'ORDERS_OUTSIDE_PERIOD')
        products=posting.get(fields['products']);need(type(products)is list and bool(products),'ORDERS_PRODUCTS_REQUIRED')
        skus=set()
        for product in products:
            need(type(product)is dict,'ORDERS_PRODUCT_SCHEMA')
            sku=product.get(fields['sku'])
            need(type(sku)in(str,int)and re.fullmatch(r'[1-9][0-9]{0,19}',str(sku))is not None,'ORDERS_SKU')
            sku=str(sku);need(sku not in skus,'ORDERS_DUPLICATE_LINE');skus.add(sku)
            need(fields['seller_price']in product and fields['quantity']in product,'ORDERS_ITEM_VALUE_REQUIRED')
            raw_price = product[fields['seller_price']]
            if type(raw_price) is dict:
                need(set(raw_price) == {'amount', 'currency'}, 'ORDERS_PRICE_SCHEMA')
                need(raw_price['currency'] == 'RUB', 'ORDERS_CURRENCY')
                raw_price = raw_price['amount']
            price = _number(raw_price)
            quantity = _number(product[fields['quantity']])
            need(price>=0 and quantity>0 and quantity==quantity.to_integral_value(),'ORDERS_ITEM_VALUE')
            if fields['optional_currency']in product:need(product[fields['optional_currency']]=='RUB','ORDERS_CURRENCY')
            rows.append({'posting':token,'sku':sku,'scheme':scheme,'day':day.isoformat(),
                         'quantity':c.decimal_text(quantity),'seller_price':c.decimal_text(price)})
    return {'rows':rows,'postings':seen,'has_next':has_next,'cursor':next_cursor}


def _seal(value):return hmac.new(_KEY,value.encode(),'sha256').hexdigest()


@dataclass(frozen=True,repr=False)
class QualifiedOrders:
    payload_json:str
    _proof:str=field(default='',repr=False)
    def __repr__(self):return '<QualifiedOrders: complete captured order cohort>'
    @property
    def data(self):
        need(type(self.payload_json)is str and type(self._proof)is str and
             hmac.compare_digest(self._proof,_seal(self.payload_json)),'ORDERS_UNQUALIFIED_OBJECT')
        return json.loads(self.payload_json)
    def checkpoint(self):
        value=self.data
        return {key:value[key]for key in ('scope','period','observed_at','observation_from','observation_to','receipts','source_sha256',
                 'source_pages','windows','window_pages','window_contract','definition_hash',
                 'basis','statuses','currency_basis','row_count','persist_values')}
    def for_cohort(self,period,target):
        value=self.data;_target(target);_dates(period)
        need(value['scope']==target and value['period']==period,'ORDERS_SOURCE_SCOPE')
        return {'rows':value['rows'],'receipt_hash':sha256(c.CANON(self.checkpoint()).encode()).hexdigest(),
                'complete':True,'scope':deepcopy(target),'period':deepcopy(period),'observed_at':value['observed_at']}


def normalize(fbo_pages,fbs_pages,target,period,*,verify,encode):
    """Qualify every window and full native cursor chain for both schemes.

    A process-local object seal prevents accidental forged normalized objects.
    It grants no rights: the parent must recheck current authority and the actual
    same-job receipt ledger whenever it restores or consumes this source.
    """
    fbo_pages,fbs_pages,target,period=deepcopy((fbo_pages,fbs_pages,target,period))
    _target(target);_dates(period)
    need(callable(verify)and callable(encode),'ORDERS_VERIFIER_REQUIRED')
    coverage=windows(period)
    rows=[];receipts=[];hashes=[];times=[];postings=set();page_counts={};window_counts={};prior_stamp=None
    for scheme,pages in zip(SCHEMES,(fbo_pages,fbs_pages)):
        need(type(pages)is list and bool(pages),'ORDERS_SOURCE_INCOMPLETE')
        index=0;window_counts[scheme]=[]
        for window in coverage:
            cursor='';cursors=set();count=0
            while True:
                need(index<len(pages),'ORDERS_SOURCE_INCOMPLETE')
                packet=pages[index];page=_page(packet,scheme,target,window,cursor,verify=verify,encode=encode)
                need(not postings&page['postings'],'ORDERS_DUPLICATE_POSTING');postings.update(page['postings'])
                observed=_stamp(packet['received_at'])
                need(prior_stamp is None or observed>=prior_stamp,'ORDERS_OBSERVATION_ORDER');prior_stamp=observed
                rows.extend(page['rows']);times.append(packet['received_at'])
                receipts.append(_encoded(encode,'source-receipt',packet['receipt_id']));hashes.append(packet['response_sha256'])
                index+=1;count+=1
                if not page['has_next']:break
                need(page['cursor']not in cursors,'ORDERS_CURSOR_CHAIN')
                cursors.add(page['cursor']);cursor=page['cursor']
            window_counts[scheme].append(count)
        need(index==len(pages),'ORDERS_PAGE_AFTER_TERMINAL')
        page_counts[scheme]=len(pages)
    need(len(receipts)==len(set(receipts)),'ORDERS_RECEIPT_REUSED')
    first_observation=min(times,key=_stamp);last_observation=max(times,key=_stamp)
    value={'rows':sorted(rows,key=lambda row:(row['scheme'],row['posting'],row['sku'])),
           'scope':target,'period':period,'observed_at':first_observation,
           'observation_from':first_observation,'observation_to':last_observation,'receipts':receipts,
           'source_sha256':hashes,'source_pages':page_counts,'windows':coverage,'window_pages':window_counts,
           'window_contract':deepcopy(CATALOG['request_window']),'definition_hash':HASH,'basis':CATALOG['basis'],
           'statuses':CATALOG['statuses'],'currency_basis':CATALOG['currency_basis'],
           'row_count':len(rows),'persist_values':False}
    payload=c.CANON(value);return QualifiedOrders(payload,_seal(payload))
