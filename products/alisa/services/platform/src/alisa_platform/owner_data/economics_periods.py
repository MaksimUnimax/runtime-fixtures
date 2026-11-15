"""Qualified period advertising/storage, not original fees of an order cohort.

Raw source packets must be checked against the SAME existing job's receipts and
current permission. Scope flags or this process seal alone grant no API/DB access.
Unknown/missing data are refused, never silently replaced by zero.
"""
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal, localcontext, InvalidOperation, Inexact
from hashlib import sha256
from pathlib import Path
from zoneinfo import ZoneInfo
import hmac, json, re, secrets
from . import parameter_contract as c

CATALOG = json.loads(Path(__file__).with_name('economics_period_catalog.json').read_text())
HASH = sha256(c.CANON(CATALOG).encode()).hexdigest()
_KEY = secrets.token_bytes(32)

class PeriodCostError(ValueError):
    def __init__(self, code): self.code=code; super().__init__(code)

def need(ok, code):
    if not ok: raise PeriodCostError(code)

def digest(value): return sha256(c.CANON(value).encode()).hexdigest()

def exact(value, keys):
    need(type(value) is dict and set(value)==set(keys),'PERIOD_COST_SCHEMA')

def _seal(value): return hmac.new(_KEY,value.encode(),'sha256').hexdigest()

def _proof(value):
    need(type(value) is PeriodCosts and type(value.payload_json) is str and type(value.seal) is str
         and hmac.compare_digest(value.seal,_seal(value.payload_json)),'PERIOD_COST_UNQUALIFIED_OBJECT')

def _pairs(items):
    result={}
    for k,v in items:
        need(k not in result,'PERIOD_COST_DUPLICATE_JSON_KEY'); result[k]=v
    return result

def _body(raw):
    need(type(raw) is bytes,'PERIOD_COST_EXACT_BODY_REQUIRED')
    try: return json.loads(raw,parse_float=Decimal,parse_int=Decimal,object_pairs_hook=_pairs,
                           parse_constant=lambda value: (_ for _ in ()).throw(PeriodCostError('PERIOD_COST_NONFINITE')))
    except PeriodCostError: raise
    except (ValueError,TypeError,UnicodeError): raise PeriodCostError('PERIOD_COST_JSON') from None

def _money(value, comma=False):
    need(type(value) in (str,int,Decimal) and type(value) is not bool,'PERIOD_COST_MONEY')
    s=str(value)
    if comma:
        s=s.replace('\u00a0','').replace(' ','')
        need(not (',' in s and '.' in s),'PERIOD_COST_MONEY'); s=s.replace(',','.')
    need(re.fullmatch(r'-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?',s) is not None,'PERIOD_COST_MONEY')
    try: number=Decimal(s)
    except InvalidOperation: raise PeriodCostError('PERIOD_COST_MONEY') from None
    need(number.is_finite(),'PERIOD_COST_MONEY')
    # Reuse the existing financial NUMBER representation, not a new business
    # quota. Never accept a source amount that downstream formulas cannot retain.
    try: return c.number(s)
    except c.ParameterError as error:
        raise PeriodCostError('PERIOD_COST_MONEY_PRECISION'if error.code=='PARAMETER_DECIMAL_PRECISION'else'PERIOD_COST_MONEY')from None


def _add_exact(left,right):
    # Addition is exact even when magnitudes/scales differ. Fixed-context += may
    # silently discard a small nonzero amount. Do not round source money first.
    exponent=min(left.as_tuple().exponent,right.as_tuple().exponent)
    precision=max(1,max(left.adjusted(),right.adjusted())-exponent+2)
    with localcontext()as context:
        context.prec=precision;context.traps[Inexact]=True
        return left+right


def _amount_text(value):
    text=c.decimal_text(value)
    # Check the aggregate as well as each input. If it cannot be represented by
    # the unchanged 60-digit financial contract, fail rather than seal a rounded
    # or incompatible "verified" total. No bound on days/campaigns/calls added.
    _money(text)
    return text

def _day(value):
    need(type(value) is str,'PERIOD_COST_DAY')
    try:
        if re.fullmatch(r'\d{4}-\d{2}-\d{2}',value): result=datetime.strptime(value,'%Y-%m-%d').date()
        elif re.fullmatch(r'\d{2}\.\d{2}\.\d{4}',value): result=datetime.strptime(value,'%d.%m.%Y').date()
        else: raise ValueError()
        return result
    except ValueError: raise PeriodCostError('PERIOD_COST_DAY') from None

def _dates(period):
    try:return c.dates(period)
    except c.ParameterError as error:raise PeriodCostError(error.code) from None

@dataclass(frozen=True,repr=False)
class PeriodCosts:
    payload_json:str
    seal:str
    def __repr__(self):return '<PeriodCosts verified current source; not coefficient history>'
    @property
    def data(self): _proof(self); return json.loads(self.payload_json)
    def checkpoint(self):
        d=self.data
        return {k:deepcopy(d[k])for k in ('schema','scope','period','definition_hash','sources','scope_proof','basis')}
    def as_source(self):
        d=self.data
        return {'rows':deepcopy(d['rows']),'receipt_hash':digest(self.checkpoint()),'complete':True,
                'scope':deepcopy(d['scope']),'period':deepcopy(d['period']),'observed_at':d['observed_at']}
    def verifies(self,name,value,target,period):
        _proof(self)
        return name=='period_costs' and value==self.as_source() and target==self.data['scope'] and period==self.data['period']


def normalize(packets,scope,period,*,verify,scope_proof,as_of):
    """All declared source windows exactly cover the requested completed period.

    Advertising is counted ONCE from the admitted all-campaign daily source,
    never added again from Seller balance/bonus/prepayment/attributed revenue.
    Storage uses the accepted warehouse component; no new model is introduced.
    """
    exact(scope,('tenant_id','store_id','provider','currency'))
    need(all(type(scope[k])is str and scope[k]for k in ('tenant_id','store_id')),'PERIOD_COST_SCOPE')
    need(scope['provider']==CATALOG['provider']and scope['currency']==CATALOG['currency'],'PERIOD_COST_CURRENCY')
    start,end=_dates(period);now=c.stamp(as_of)
    need(end<now.astimezone(ZoneInfo('Europe/Moscow')).date(),'PERIOD_COST_UNFINISHED_PERIOD')
    need(type(scope_proof)is dict and scope_proof==CATALOG['sources']['advertising']['scope_requirements'],'PERIOD_COST_CAMPAIGN_SCOPE')
    need(type(packets)is list and packets and callable(verify),'PERIOD_COST_VERIFIER_REQUIRED')
    source_for={r['operation']:k for k,r in CATALOG['sources'].items()}
    intervals={k:[]for k in CATALOG['sources']};sums={k:Decimal(0)for k in CATALOG['sources']}
    receipts=[];receipt_ids=set();days=set();ad_keys=set();counts={k:0 for k in CATALOG['sources']};observed=[]
    with localcontext()as context:
        context.prec=60
        for packet in packets:
            exact(packet,('operation','scope','request','body','received_at','receipt_id','response_sha256','http'))
            need(packet['operation']in source_for and packet['scope']==scope,'PERIOD_COST_SCOPE')
            component=source_for[packet['operation']];rule=CATALOG['sources'][component]
            exact(packet['request'],rule['request_keys'])
            window=dict(zip(('from','to'),(packet['request'][k]for k in rule['request_keys'])))
            a,b=_dates(window);need(start<=a<=b<=end,'PERIOD_COST_REQUEST_PERIOD')
            ident=packet['receipt_id'];need(type(ident)is str and ident and ident not in receipt_ids,'PERIOD_COST_RECEIPT_ID')
            receipt_ids.add(ident);need(type(packet['body'])is bytes and sha256(packet['body']).hexdigest()==packet['response_sha256']and packet['http']==200,'PERIOD_COST_RECEIPT_BODY')
            stamp=c.stamp(packet['received_at']);need(stamp<=now and stamp.astimezone(ZoneInfo('Europe/Moscow')).date()>b,'PERIOD_COST_OBSERVATION')
            try:valid=verify(deepcopy(packet),deepcopy(scope_proof))
            except Exception:raise PeriodCostError('PERIOD_COST_RECEIPT_UNAVAILABLE')from None
            need(valid is True,'PERIOD_COST_RECEIPT_REJECTED')
            data=_body(packet['body']);need(type(data)is dict,'PERIOD_COST_SCHEMA')
            if component=='storage':
                cashflows=data.get('cashflows');need(type(cashflows)is dict,'PERIOD_COST_STORAGE_SCHEMA')
                services=cashflows.get('services');need(type(services)is list,'PERIOD_COST_STORAGE_SCHEMA')
                names=set();found=set()
                for row in services:
                    need(type(row)is dict and type(row.get('name'))is str and row['name']not in names,'PERIOD_COST_SERVICE_DUPLICATE');names.add(row['name'])
                    if row['name']not in rule['service_names']:continue
                    money=row.get('amount');exact(money,('currency_code','value'));need(money['currency_code']==scope['currency'],'PERIOD_COST_CURRENCY')
                    sums[component]=_add_exact(sums[component],_money(money['value']).copy_negate());found.add(row['name']);counts[component]+=1
                need(found==set(rule['service_names']),'PERIOD_COST_STORAGE_ABSENT_NOT_ZERO')
            else:
                exact(data,('rows',));need(type(data['rows'])is list and data['rows'],'PERIOD_COST_ADS_EMPTY_UNCONFIRMED')
                for row in data['rows']:
                    need(type(row)is dict and {'id','date',rule['amount_field']}<=set(row),'PERIOD_COST_ADS_SCHEMA')
                    cid=row['id'];need(type(cid)in(str,Decimal,int)and type(cid)is not bool,'PERIOD_COST_CAMPAIGN_ID')
                    need(re.fullmatch(r'[1-9][0-9]*',str(cid))is not None,'PERIOD_COST_CAMPAIGN_ID')
                    day=_day(row['date']);need(a<=day<=b,'PERIOD_COST_ADS_PERIOD')
                    k=(str(cid),day.isoformat());need(k not in ad_keys,'PERIOD_COST_CAMPAIGN_DAY_DUPLICATE');ad_keys.add(k);days.add(day)
                    amount=_money(row[rule['amount_field']],comma=True);need(amount>=0,'PERIOD_COST_ADS_NEGATIVE');sums[component]=_add_exact(sums[component],amount);counts[component]+=1
            intervals[component].append((a,b));observed.append(stamp)
            receipts.append({'source':component,'operation':packet['operation'],'request':deepcopy(packet['request']),
                'receipt_hash':digest([scope,packet['operation'],ident]),'response_sha256':packet['response_sha256'],'received_at':packet['received_at']})
        for component,windows in intervals.items():
            cursor=start
            for a,b in sorted(windows):need(a==cursor,'PERIOD_COST_COVERAGE_GAP_OR_OVERLAP');cursor=b+timedelta(days=1)
            need(cursor==end+timedelta(days=1),'PERIOD_COST_COVERAGE_INCOMPLETE')
            need(sums[component]>=0,'PERIOD_COST_NET_CREDIT_NOT_EXPENSE')
        # Missing-day zero cannot be inferred from another day's paid row. A
        # separately qualified absence proof can be added later without weakening this.
        need(days=={start+timedelta(days=i)for i in range((end-start).days+1)},'PERIOD_COST_EMPTY_DAY_UNCONFIRMED')
        value={'schema':'alisa-qualified-period-costs/v1','scope':deepcopy(scope),'period':deepcopy(period),
            'definition_hash':HASH,'rows':[{'component':k,'amount':_amount_text(sums[k]),'basis':CATALOG['output_basis']}for k in sorted(sums)],
            'sources':receipts,'scope_proof':deepcopy(scope_proof),'observed_at':min(observed).isoformat(),
            'counts':counts,'basis':'FULL_PERIOD_ALLOCATION_NOT_ORDER_DEBIT','all_other_fees_complete':False,
            'original_cohort_debits_classified':False}
        raw=c.CANON(value);return PeriodCosts(raw,_seal(raw))
