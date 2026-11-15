"""Receipt-attested, signed OTHER observations for one qualified order cohort.

The two native surfaces are reconciled, never added together. By-day supplies
actual accrual/component identities; by-postings supplies the exact cohort set.
Neither this source nor its process-local seal classifies ORIGINAL debits or
proves lifetime financial closure. No provider, database, model or owner IO.
"""
from collections import Counter, defaultdict
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, DecimalException, ROUND_DOWN, localcontext
from hashlib import sha256
from pathlib import Path
from zoneinfo import ZoneInfo
import hmac, json, math, re, secrets
from . import parameter_contract as c
from . import economics_accruals as accruals
from . import economics_orders as order_source

CATALOG=json.loads(Path(__file__).with_name('economics_other_catalog.json').read_text())
HASH=sha256(c.CANON(CATALOG).encode()).hexdigest()
_KEY=secrets.token_bytes(32)
HEX=re.compile(r'[a-f0-9]{64}')
ZONE=ZoneInfo(CATALOG['timezone'])
OTHER=set(CATALOG['approved_other_types'])
KNOWN=OTHER|set(CATALOG['excluded_delivery_types'])|set().union(*map(set,CATALOG['other_formula_groups'].values()))


class OtherError(ValueError):
    def __init__(self,code):self.code=code;super().__init__(code)


def need(ok,code):
    if not ok:raise OtherError(code)


def _digest(value):return sha256(c.CANON(value).encode()).hexdigest()
def _seal(value):return hmac.new(_KEY,value.encode(),'sha256').hexdigest()
def _key(row):return c.CANON([row['posting'],row['sku'],row['scheme']])


def _stamp(value):
    try:return c.stamp(value)
    except c.ParameterError:raise OtherError('OTHER_OBSERVATION')from None


def _dates(value):
    try:return c.dates(value)
    except c.ParameterError:raise OtherError('OTHER_PERIOD')from None


def _number(value):
    try:return c.number(value)
    except c.ParameterError:raise OtherError('OTHER_NUMBER')from None


def _text(value):
    text=c.decimal_text(value);_number(text);return text


def _identifier(value):
    need(type(value)is str and 0<len(value)<=4096 and not any(ord(ch)<32 for ch in value),'OTHER_IDENTIFIER')
    return value


def _encoded(encode,kind,value):
    try:result=encode(kind,value)
    except Exception:raise OtherError('OTHER_SCOPED_ID')from None
    need(type(result)is str and HEX.fullmatch(result)is not None,'OTHER_SCOPED_ID')
    return result


def _pairs(pairs):
    result={}
    for key,value in pairs:
        need(key not in result,'OTHER_DUPLICATE_JSON_KEY');result[key]=value
    return result


def _constant(value):raise OtherError('OTHER_JSON_NUMBER')


def _fraction(value):
    # Monetary fields must remain source strings, as required by R11. Other
    # JSON numbers may reach R11's canonical encoder only without decimal loss.
    try:
        number=Decimal(value);native=float(value)
        need(math.isfinite(native)and Decimal(str(native))==number,'OTHER_JSON_NUMBER')
        return native
    except (DecimalException,OverflowError,ValueError):raise OtherError('OTHER_JSON_NUMBER')from None


def _verified(verify,packet):
    try:valid=verify(deepcopy(packet))
    except Exception:raise OtherError('OTHER_RECEIPT_UNAVAILABLE')from None
    need(valid is True,'OTHER_RECEIPT_REJECTED')


def _read(packet,operation,target,verify,clock):
    need(type(packet)is dict and set(packet)=={'operation','scope','request','body','received_at','receipt_id','response_sha256','http'},'OTHER_PACKET_SCHEMA')
    need(packet['operation']==operation and packet['scope']==target and type(packet['http'])is int and packet['http']==200,'OTHER_SOURCE_SCOPE')
    need(type(packet['body'])is bytes and type(packet['response_sha256'])is str
         and HEX.fullmatch(packet['response_sha256'])is not None
         and sha256(packet['body']).hexdigest()==packet['response_sha256'],'OTHER_BODY_HASH')
    need(type(packet['request'])is dict,'OTHER_REQUEST_SCHEMA');_identifier(packet['receipt_id'])
    need(_stamp(packet['received_at'])<=clock,'OTHER_FUTURE_OBSERVATION')
    _verified(verify,packet)
    # By-postings contains informational seller_price values which are not a
    # financial input here. Preserve their numeric JSON representation without
    # sending them through the R11 canonical encoder or a binary float.
    fraction=Decimal if operation==CATALOG['posting_operation']else _fraction
    try:return json.loads(packet['body'],parse_float=fraction,parse_constant=_constant,object_pairs_hook=_pairs)
    except (ValueError,UnicodeError,TypeError)as error:
        if isinstance(error,OtherError):raise
        raise OtherError('OTHER_JSON')from None


def _money(value):
    need(type(value)is dict and set(value)=={'amount','currency'}and value['currency']=='RUB','OTHER_CURRENCY')
    return _text(_number(value['amount']))


def _entry(entry,posting,received):
    required={'type_id','accrual_date','accrued'};optional={'seller_price','sku','quantity'}
    need(type(entry)is dict and required<=set(entry)<=required|optional,'OTHER_ACCRUAL_SCHEMA')
    kind=entry['type_id'];need(type(kind)is int and kind>0,'OTHER_FEE_TYPE')
    need(kind in KNOWN,'OTHER_UNCLASSIFIED_FEE')
    day,_=_dates({'from':entry['accrual_date'],'to':entry['accrual_date']})
    need(day<=received.astimezone(ZONE).date(),'OTHER_FUTURE_ACCRUAL')
    need(('sku'in entry)==('quantity'in entry),'OTHER_ITEM_SCHEMA')
    sku=quantity=None
    if 'sku'in entry:
        sku=entry['sku'];need(type(sku)in(str,int)and re.fullmatch(r'[1-9][0-9]{0,19}',str(sku))is not None,'OTHER_SKU')
        sku=str(sku);quantity=entry['quantity']
        need(type(quantity)is int and quantity!=0,'OTHER_QUANTITY');quantity=_text(_number(str(quantity)))
    return {'posting':posting,'accrual_day':day.isoformat(),'type_id':kind,'sku':sku,
            'quantity':quantity,'currency':'RUB','amount':_money(entry['accrued'])}


def _match_key(entry):
    return tuple(entry[key]for key in ('posting','accrual_day','type_id','sku','quantity','currency','amount'))


def _checked_orders(orders):
    need(type(orders)is order_source.QualifiedOrders,'OTHER_QUALIFIED_ORDERS_REQUIRED')
    try:
        value=orders.data;checkpoint=orders.checkpoint()
        block=orders.for_cohort(value['period'],value['scope'])
    except order_source.OrderError:raise OtherError('OTHER_QUALIFIED_ORDERS_REQUIRED')from None
    return value,checkpoint,block


def _line_scope(entry,postings):
    lines=postings[entry['posting']]
    need(entry['sku']is None or any(row['sku']==entry['sku']for row in lines),'OTHER_SKU_NOT_IN_POSTING')


def _inputs(rows,observations):
    by_posting=defaultdict(list);direct=defaultdict(list);pooled=defaultdict(list)
    for row in rows:by_posting[row['posting']].append(row)
    for entry in observations:
        if entry['sku']is None:pooled[entry['posting']].append(entry)
        else:direct[(entry['posting'],entry['sku'])].append(entry)
    output={}
    # Exact sums/products have enough headroom for both 60-digit input scales
    # and arbitrary row counts. Only nonterminating proportional allocations
    # are represented finitely; the last line carries the exact residual.
    with localcontext()as context:
        context.prec=180+len(str(len(rows)+len(observations)+1))
        for posting,lines in sorted(by_posting.items()):
            lines=sorted(lines,key=_key);pool=pooled[posting]
            cost=-sum((_number(entry['amount'])for entry in pool),Decimal(0));_text(cost)
            units=sum((_number(row['quantity'])for row in lines),Decimal(0));left=cost
            integer_digits=max(1,cost.copy_abs().adjusted()+1)
            places=CATALOG['allocation_decimal_digits']-integer_digits
            need(places>=0,'OTHER_ALLOCATION_PRECISION')
            quantum=Decimal(1).scaleb(-places)
            for index,row in enumerate(lines):
                part=left if index==len(lines)-1 else (cost*_number(row['quantity'])/units).quantize(quantum,rounding=ROUND_DOWN)
                left-=part;own=direct[(posting,row['sku'])]
                amount=part-sum((_number(entry['amount'])for entry in own),Decimal(0))
                events=sorted(entry['id']for entry in [*pool,*own])
                output[_key(row)]={'amount':_text(amount),'basis':{
                    'kind':CATALOG['basis'],'events':events,
                    'allocation':CATALOG['posting_allocation']if pool else None,
                    'zero_proof':CATALOG['zero_basis']if not events else None,
                    'financial_history_final':False,'original_cohort_debits_classified':False}}
            need(left==0,'OTHER_ALLOCATION_NOT_CONSERVED')
        expected=-sum((_number(entry['amount'])for entry in observations),Decimal(0))
        need(sum((_number(row['amount'])for row in output.values()),Decimal(0))==expected,'OTHER_ALLOCATION_NOT_CONSERVED')
    return output


@dataclass(frozen=True,repr=False)
class ObservedOther:
    payload_json:str
    _proof:str=field(default='',repr=False)
    def __repr__(self):return '<ObservedOther: signed cohort snapshot, not original or final>'
    @property
    def data(self):
        need(type(self.payload_json)is str and type(self._proof)is str
             and hmac.compare_digest(self._proof,_seal(self.payload_json)),'OTHER_UNQUALIFIED_OBJECT')
        value=json.loads(self.payload_json)
        need(value['definition_hash']==HASH,'OTHER_DEFINITION_CHANGED');return value
    def checkpoint(self):
        value=self.data
        return {key:deepcopy(value[key])for key in (
            'schema','scope','period','financial_period','as_of','observation_from','observation_to',
            'source_receipts','source_sha256','source_pages','orders_hash','orders_checkpoint_hash',
            'definition_hash','basis','matched_components','matched_accruals','duplicate_day_records',
            'cohort_postings','zero_cohort','zero_cohort_basis','selected_component_ids',
            'outside_cohort_components','unallocated_components','selected_other_group_components',
            'observed_approved_other_complete','financial_history_final','original_cohort_debits_classified',
            'all_other_fees_complete','persist_values')}
    def line_inputs(self,orders):
        value=self.data;order_value,checkpoint,block=_checked_orders(orders)
        need(_digest(checkpoint)==value['orders_checkpoint_hash'],'OTHER_ORDERS_CHANGED')
        return self.for_cohort(order_value['period'],order_value['scope'],block)
    def for_cohort(self,period,target,orders_block):
        value=self.data;_dates(period)
        need(value['scope']==target and value['period']==period,'OTHER_SOURCE_SCOPE')
        try:matches=type(orders_block)is dict and c.CANON(orders_block)==value['orders_block_json']and _digest(orders_block)==value['orders_hash']
        except (ValueError,TypeError):matches=False
        need(matches,'OTHER_ORDERS_CHANGED')
        return deepcopy(value['line_inputs'])


def normalize(posting_packets,day_packets,orders,*,verify,encode,as_of):
    """Qualify one posting snapshot followed by complete by-day cursor chains.

    The supplied verifier attests exact bytes to the current existing job. The
    sealed result is request-local evidence, not account or report authority.
    """
    need(callable(verify)and callable(encode),'OTHER_VERIFIER_REQUIRED')
    order_value,order_checkpoint,order_block=_checked_orders(orders)
    target=order_value['scope'];period=order_value['period'];rows=order_value['rows']
    begin,end=_dates(period);clock=_stamp(as_of);last=clock.astimezone(ZONE).date()
    order_observed=_stamp(order_value['observation_to'])
    need(end<=last and order_observed<=clock,'OTHER_FUTURE_PERIOD')
    posting_packets,day_packets=deepcopy((posting_packets,day_packets))
    need(type(posting_packets)is list and type(day_packets)is list and bool(day_packets),'OTHER_SOURCE_INCOMPLETE')
    postings=defaultdict(list)
    for row in rows:postings[row['posting']].append(row)
    need(bool(posting_packets)==bool(postings),'OTHER_POSTING_SET_INCOMPLETE')
    requests=set();entries=[];receipts=[];hashes=[];times=[];posting_times=[];day_times=[];receipt_ids=set()
    order_receipts=set(order_checkpoint['receipts'])
    def capture(packet,operation):
        data=_read(packet,operation,target,verify,clock)
        need(order_observed<=_stamp(packet['received_at']),'OTHER_ORDERS_SOURCE_SEQUENCE')
        token=_encoded(encode,'source-receipt',packet['receipt_id'])
        need(token not in receipt_ids and token not in order_receipts,'OTHER_RECEIPT_REUSED');receipt_ids.add(token)
        receipts.append(token);hashes.append(packet['response_sha256']);times.append(packet['received_at'])
        return data
    for packet in posting_packets:
        data=capture(packet,CATALOG['posting_operation']);request=packet['request']
        need(set(request)=={'posting_numbers'}and type(request['posting_numbers'])is list
             and 1<=len(request['posting_numbers'])<=CATALOG['maximum_postings_per_request'],'OTHER_POSTING_REQUEST')
        ids=[_encoded(encode,'posting',_identifier(value))for value in request['posting_numbers']]
        need(len(ids)==len(set(ids))and not requests.intersection(ids),'OTHER_DUPLICATE_POSTING_REQUEST')
        need(set(ids)<=set(postings),'OTHER_OUTSIDE_COHORT');requests.update(ids)
        need(type(data)is dict and set(data)=={'posting_accruals'}and type(data['posting_accruals'])is list,'OTHER_POSTING_RESPONSE')
        received=_stamp(packet['received_at'])
        need(not posting_times or received>=_stamp(posting_times[-1]),'OTHER_OBSERVATION_ORDER');posting_times.append(packet['received_at'])
        returned=set()
        for row in data['posting_accruals']:
            need(type(row)is dict and set(row)=={'posting_number','accruals'}and type(row['accruals'])is list,'OTHER_POSTING_RESPONSE')
            posting=_encoded(encode,'posting',_identifier(row['posting_number']))
            need(posting in ids and posting not in returned,'OTHER_POSTING_RESPONSE_SET');returned.add(posting)
            for entry in row['accruals']:
                parsed=_entry(entry,posting,received);_line_scope(parsed,postings);entries.append(parsed)
                begin=min(begin,date.fromisoformat(parsed['accrual_day']))
        need(returned==set(ids),'OTHER_POSTING_SET_INCOMPLETE')
    need(requests==set(postings),'OTHER_POSTING_SET_INCOMPLETE')
    financial_period={'from':begin.isoformat(),'to':last.isoformat()};pages=[];admitted={}
    for packet in day_packets:
        data=capture(packet,CATALOG['day_operation'])
        page={'operation':packet['operation'],'scope':deepcopy(target),'request':deepcopy(packet['request']),
              'data':data,'received_at':packet['received_at'],'receipt_id':packet['receipt_id']}
        pages.append(page);admitted[packet['receipt_id']]=(deepcopy(page),packet);day_times.append(packet['received_at'])
    need(not posting_times or max(map(_stamp,posting_times))<=min(map(_stamp,day_times)),'OTHER_SOURCE_SEQUENCE')
    def verify_day(page):
        expected,packet=admitted[page['receipt_id']]
        need(page==expected,'OTHER_DAY_PACKET_CHANGED');_verified(verify,packet);return True
    try:
        observed=accruals.normalize(pages,target,financial_period,verify=verify_day,encode=encode,as_of=as_of).data
    except (accruals.AccrualError,c.ParameterError)as error:raise OtherError(error.code)from None
    selected=[];outside=Counter();unallocated=Counter();other_groups=Counter()
    for atom in observed['observations']:
        posting=atom['unit_key'];kind=atom['type_id']
        if posting is None:unallocated[str(kind)]+=1;continue
        if posting not in postings:outside[str(kind)]+=1;continue
        need(kind in KNOWN,'OTHER_UNCLASSIFIED_FEE')
        entry={'posting':posting,**{key:atom[key]for key in ('accrual_day','type_id','sku','quantity','currency','amount')}}
        _line_scope(entry,postings)
        need(atom['scheme']is None or atom['scheme'].lower()==postings[posting][0]['scheme'],'OTHER_SCHEME_MISMATCH')
        if kind in OTHER:selected.append({**entry,'id':atom['id'],'accrual_key':atom['accrual_key']})
        else:other_groups[str(kind)]+=1
    expected=Counter(_match_key(entry)for entry in entries if entry['type_id']in OTHER)
    actual=Counter(_match_key(entry)for entry in selected)
    need(expected==actual,'OTHER_SNAPSHOT_MISMATCH')
    inputs=_inputs(rows,selected)
    value={'schema':CATALOG['schema'],'scope':target,'period':period,'financial_period':financial_period,
           'as_of':clock.isoformat(),'observation_from':min(times,key=_stamp),'observation_to':max(times,key=_stamp),
           'source_receipts':receipts,'source_sha256':hashes,
           'source_pages':{'posting_batches':len(posting_packets),'day_pages':len(day_packets)},
           'orders_hash':_digest(order_block),'orders_checkpoint_hash':_digest(order_checkpoint),
           'orders_block_json':c.CANON(order_block),'definition_hash':HASH,'basis':CATALOG['basis'],
           'line_inputs':inputs,'matched_components':len(selected),'matched_accruals':len({entry['accrual_key']for entry in selected}),
           'duplicate_day_records':observed['duplicate_records'],'cohort_postings':len(postings),
           'zero_cohort':not rows,'zero_cohort_basis':CATALOG['zero_cohort_basis']if not rows else None,
           'selected_component_ids':sorted(entry['id']for entry in selected),
           'outside_cohort_components':dict(sorted(outside.items())),'unallocated_components':dict(sorted(unallocated.items())),
           'selected_other_group_components':dict(sorted(other_groups.items())),
           'observed_approved_other_complete':True,'financial_history_final':False,
           'original_cohort_debits_classified':False,'all_other_fees_complete':False,'persist_values':False}
    payload=c.CANON(value);return ObservedOther(payload,_seal(payload))
