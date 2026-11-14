"""Current-only parameter rules. Pure, no network/DB and no per-name dispatch.

Only registered declarative formulas may produce a value. A trusted source verifier
must approve the evidence before a calculated value can be sent to the store.
"""
from pathlib import Path
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, localcontext
from calendar import monthrange
from copy import deepcopy
import hashlib,json,re

CATALOG=json.loads(Path(__file__).with_name('parameter_catalog.json').read_text())
CANON=lambda x:json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)
CATALOG_HASH=hashlib.sha256(CANON(CATALOG).encode()).hexdigest()

class ParameterError(ValueError):
    def __init__(self,code):self.code=code;super().__init__(code)
def need(condition,code):
    if not condition:raise ParameterError(code)
def exact(value,fields):need(type(value)is dict and set(value)==set(fields),'PARAMETER_SCHEMA')
def number(value):
    need(type(value)is str and re.fullmatch(r'-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?',value) is not None,'PARAMETER_DECIMAL')
    # Representation bound, not a quota on user operations or data collection.
    need(len(value.replace('-','').replace('.',''))<=60,'PARAMETER_DECIMAL_PRECISION')
    try:result=Decimal(value)
    except InvalidOperation:raise ParameterError('PARAMETER_DECIMAL')from None
    need(result.is_finite(),'PARAMETER_DECIMAL');return result

def decimal_text(value):
    text=format(value,'f')
    if '.'in text:text=text.rstrip('0').rstrip('.')
    return '0'if text in ('-0','')else text

def definition(key):
    need(type(key)is str and key in CATALOG['parameters'],'PARAMETER_UNKNOWN')
    return deepcopy(CATALOG['parameters'][key])
def validate_value(rule,value,unit):
    need(unit==rule['unit'],'PARAMETER_UNIT')
    n=number(value);need(n>=number(rule['minimum']),'PARAMETER_RANGE')
    if rule['maximum']is not None:need(n<=number(rule['maximum']),'PARAMETER_RANGE')
    return decimal_text(n)

def scope(value):
    exact(value,('kind','sku'));need(value['kind']in('store','sku'),'PARAMETER_SCOPE')
    if value['kind']=='store':need(value['sku']=='','PARAMETER_SCOPE')
    else:need(type(value['sku'])is str and re.fullmatch(r'[1-9][0-9]{0,19}',value['sku'])is not None,'PARAMETER_SKU')
    return deepcopy(value)

def dates(value):
    exact(value,('from','to'))
    try:
        need(all(type(value[k])is str and re.fullmatch(r'\d{4}-\d{2}-\d{2}',value[k])for k in value),'PARAMETER_PERIOD')
        a,b=date.fromisoformat(value['from']),date.fromisoformat(value['to'])
    except (TypeError,ValueError):raise ParameterError('PARAMETER_PERIOD')from None
    need(a<=b,'PARAMETER_PERIOD');return a,b

def resolve_period(today,request=None,available_from=None,short_history_confirmed=False):
    """Default is a calendar year ending yesterday. Explicit ranges never shrink."""
    need(type(today)is date,'PARAMETER_PERIOD');end=today-timedelta(days=1)
    if request is None:months=CATALOG['default_period_months'];explicit=False
    else:
        need(type(request)is dict,'PARAMETER_PERIOD')
        if set(request)=={'from','to'}:a,b=dates(request);need(b<=end,'PARAMETER_UNFINISHED_DAY');months=None;explicit=True
        else:
            exact(request,('months',));months=request['months'];need(type(months)is int and months>0,'PARAMETER_PERIOD');explicit=True
    if months is not None:
        idx=today.year*12+today.month-1-months;y,m=divmod(idx,12);m+=1
        need(1<=y<=9999,'PARAMETER_PERIOD');a=date(y,m,min(today.day,monthrange(y,m)[1]));b=end
    requested={'from':a.isoformat(),'to':b.isoformat()};actual=deepcopy(requested);short=False
    if available_from is not None:
        need(type(available_from)is date and available_from<=b,'PARAMETER_NO_HISTORY')
        if available_from>a:
            need(short_history_confirmed is True,'PARAMETER_HISTORY_UNCONFIRMED')
            need(not explicit,'PARAMETER_EXPLICIT_PERIOD_UNAVAILABLE')
            actual['from']=available_from.isoformat();short=True
    return {'requested':requested,'actual':actual,'explicit':explicit,'short_history':short}

def checked_period(value):
    exact(value,('requested','actual','explicit','short_history'))
    need(type(value['explicit'])is bool and type(value['short_history'])is bool,'PARAMETER_PERIOD')
    a,b=dates(value['requested']);x,y=dates(value['actual'])
    need(a<=x<=y<=b,'PARAMETER_PERIOD_MISMATCH')
    shortened=(x,y)!=(a,b)
    need(value['short_history']==shortened,'PARAMETER_PERIOD_MISMATCH')
    need(not(value['explicit']and shortened),'PARAMETER_EXPLICIT_PERIOD_UNAVAILABLE')
    return x,y

def stamp(value):
    need(type(value)is str,'PARAMETER_TIMESTAMP')
    try:d=datetime.fromisoformat(value.replace('Z','+00:00'))
    except ValueError:raise ParameterError('PARAMETER_TIMESTAMP')from None
    need(d.tzinfo is not None and d.utcoffset()is not None,'PARAMETER_TIMESTAMP')
    return d.astimezone(timezone.utc)

def evaluate(expr,inputs):
    need(type(expr)is dict and len(expr)==1,'PARAMETER_FORMULA')
    if 'input'in expr:
        need(expr['input']in inputs,'PARAMETER_FORMULA');return number(inputs[expr['input']])
    key=next(iter(expr));need(key in('add','divide'),'PARAMETER_FORMULA');args=expr[key];need(type(args)is list and args,'PARAMETER_FORMULA')
    vals=[evaluate(v,inputs)for v in args]
    if key=='add':return sum(vals,Decimal(0))
    need(len(vals)==2 and vals[1]!=0,'PARAMETER_ZERO_DENOMINATOR');return vals[0]/vals[1]

@dataclass(frozen=True)
class CheckedCalculation:
    key: str
    target_json: str
    value: str
    unit: str
    collected_at: datetime
    calculated_at: datetime
    requested_json: str
    actual_json: str
    evidence_json: str
    definition_hash: str


def validate_calculation(key,envelope,target,period,now,verify_sources):
    """Internal boundary, never callable by arbitrary client-provided 'approved=true'.

    verify_sources belongs to the existing qualified-source/job adapter. Returning
    True certifies scope, pagination, units, cohort and observation receipts, not
    merely the arithmetic. No verifier/no proof means no calculated write.
    """
    rule=definition(key);scope(target['scope'])
    need(type(envelope)is dict,'PARAMETER_SCHEMA')
    required={'producer_template','inputs','coverage','source_collected_at','observed_until'}
    need(required<=set(envelope)<=required|{'provenance'},'PARAMETER_SCHEMA')
    if 'provenance'in envelope:
        provenance=envelope['provenance'];exact(provenance,('recipe_hash','definition_hash','receipts','controls','note'))
        need(all(type(provenance[k])is str and re.fullmatch(r'[a-f0-9]{64}',provenance[k])for k in('recipe_hash','definition_hash')),'PARAMETER_PROVENANCE')
        need(type(provenance['receipts'])is list and type(provenance['controls'])is dict and type(provenance['note'])is str,'PARAMETER_PROVENANCE')
        for r in provenance['receipts']:
            exact(r,('source','receipt_hash','period'));dates(r['period'])
            need(type(r['source'])is str and type(r['receipt_hash'])is str and re.fullmatch(r'[a-f0-9]{64}',r['receipt_hash']),'PARAMETER_PROVENANCE')
        for value in provenance['controls'].values():number(value)

    need(envelope['producer_template']==rule['producer_template'],'PARAMETER_PRODUCER')
    exact(envelope['inputs'],rule['input_names']);exact(envelope['source_collected_at'],rule['required_sources'])
    exact(envelope['coverage'],('complete','actual_period','short_history','scope'))
    need(envelope['coverage']['complete']is True,'PARAMETER_INCOMPLETE')
    need(envelope['coverage']['scope']==target['scope'],'PARAMETER_SCOPE_MISMATCH')
    need(envelope['coverage']['actual_period']==period['actual'],'PARAMETER_PERIOD_MISMATCH')
    need(envelope['coverage']['short_history']is period['short_history'],'PARAMETER_PERIOD_MISMATCH')
    actual_from,actual_to=checked_period(period)
    need(callable(verify_sources),'PARAMETER_SOURCE_VERIFIER_REQUIRED')
    need(verify_sources(deepcopy(target),deepcopy(period),deepcopy(envelope))is True,'PARAMETER_SOURCE_UNQUALIFIED')
    need(now.tzinfo is not None,'PARAMETER_TIMESTAMP')
    observed={k:stamp(v)for k,v in envelope['source_collected_at'].items()}
    need(all(v<=now for v in observed.values()),'PARAMETER_FUTURE_COLLECTION')
    observed_until=stamp(envelope['observed_until']);need(observed_until<=now,'PARAMETER_FUTURE_COLLECTION')
    from zoneinfo import ZoneInfo
    need(actual_to<=observed_until.astimezone(ZoneInfo('Europe/Moscow')).date(),'PARAMETER_OBSERVATION_BEFORE_PERIOD_END')
    for name in rule['integer_inputs']:need(number(envelope['inputs'][name])%1==0,'PARAMETER_PHYSICAL_UNITS')
    for check in rule['checks']:
        k,v=next(iter(check.items()))
        if k=='positive':need(number(envelope['inputs'][v])>0,'PARAMETER_ZERO_DENOMINATOR')
        elif k=='nonnegative':need(number(envelope['inputs'][v])>=0,'PARAMETER_RANGE')
        elif k=='less_equal':need(number(envelope['inputs'][v[0]])<=number(envelope['inputs'][v[1]]),'PARAMETER_RANGE')
        else:raise ParameterError('PARAMETER_FORMULA')
    with localcontext()as ctx:
        ctx.prec=50;value=decimal_text(evaluate(rule['formula'],envelope['inputs']))
    value=validate_value(rule,value,rule['unit'])
    # Conservative date: all components are at least this old. Keep component
    # dates in the CURRENT passport; reusing data does not pretend a fresh fetch.
    collected_at=min(observed.values())
    evidence={'producer_template':rule['producer_template'],'inputs':deepcopy(envelope['inputs']),
              'source_collected_at':deepcopy(envelope['source_collected_at']),
              'observed_until':envelope['observed_until'],'coverage':deepcopy(envelope['coverage'])}
    if 'provenance'in envelope:evidence['provenance']=deepcopy(envelope['provenance'])
    return CheckedCalculation(key,CANON(target),value,rule['unit'],collected_at,now,
          CANON(period['requested']),CANON(period['actual']),CANON(evidence),CATALOG_HASH)
