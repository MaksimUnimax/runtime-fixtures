"""Registered, data-defined producers on qualified source batches.

No HTTP, model, database, new queue, user-controlled URL or parameter-name branch.
The existing worker supplies source receipts and a trusted verifier. This reducer
never treats JSON complete=true as a permission or completeness proof by itself.
"""
from pathlib import Path
from copy import deepcopy
from collections import defaultdict
from datetime import date,datetime,timedelta,timezone
from calendar import monthrange
from decimal import Decimal,localcontext
from zoneinfo import ZoneInfo
from dataclasses import dataclass
import hashlib,json,re
from .parameter_contract import (CATALOG_HASH,CANON,ParameterError,need,exact,definition,
    number,decimal_text,checked_period,stamp,scope,validate_calculation)

CATALOG=json.loads(Path(__file__).with_name('parameter_producers.json').read_text())
HASH=hashlib.sha256(CANON(CATALOG).encode()).hexdigest()
TZ=ZoneInfo(CATALOG['timezone'])

def digest(value):return hashlib.sha256(CANON(value).encode()).hexdigest()

def integer(value):
    need(type(value)in(str,int)and type(value)is not bool,'PARAMETER_PHYSICAL_UNITS')
    text=str(value);need(re.fullmatch(r'(?:0|[1-9][0-9]*)',text)is not None,'PARAMETER_PHYSICAL_UNITS')
    return int(text)

def text(value):
    need(type(value)is str and value and not any(ord(c)<32 for c in value),'PARAMETER_SOURCE_ID')
    return value

def processed(value):
    # The exported postings CSV explicitly contains UTC values without a suffix.
    # This normalization is specific to that qualified source, not a global date guess.
    text(value)
    try:v=datetime.fromisoformat(value.replace('Z','+00:00'))
    except ValueError:raise ParameterError('PARAMETER_SOURCE_DATE')from None
    if v.tzinfo is None:v=v.replace(tzinfo=timezone.utc)
    return v.astimezone(TZ).date().isoformat()

def normalize_orders(packet):
    need(type(packet)is dict and packet.get('schema')=='ozon-postings-report-sanitized/v1','PARAMETER_SOURCE_SCHEMA')
    need(packet.get('http')==200 and packet.get('scheme')in CATALOG['sources']['orders']['schemes'],'PARAMETER_SOURCE_SCHEMA')
    fields=CATALOG['sources']['orders']['fields'];states=CATALOG['sources']['orders']['status_map'];rows=[]
    need(type(packet.get('rows'))is list and packet.get('rows_count')==len(packet['rows']),'PARAMETER_SOURCE_ROWS')
    for raw in packet['rows']:
        need(type(raw)is dict and set(fields.values())<=set(raw),'PARAMETER_SOURCE_SCHEMA')
        need(raw[fields['status']]in states,'PARAMETER_ORDER_STATUS_UNKNOWN')
        quantity=integer(raw[fields['units']]);need(quantity>0,'PARAMETER_PHYSICAL_UNITS')
        rows.append({'scheme':packet['scheme'],'posting':text(raw[fields['posting']]),
          'sku':str(integer(raw[fields['sku']])),'day':processed(raw[fields['processed_at']]),
          'units':quantity,'state':states[raw[fields['status']]]})
    return rows

def normalize_returns(packet):
    need(type(packet)is dict and packet.get('http')==200,'PARAMETER_SOURCE_SCHEMA')
    data=packet.get('data');need(type(data)is dict and type(data.get('returns'))is list and type(data.get('has_next'))is bool,'PARAMETER_SOURCE_SCHEMA')
    rows=[]
    for raw in data['returns']:
        need(raw.get('type')in CATALOG['sources']['returns']['types'],'PARAMETER_RETURN_TYPE_UNKNOWN')
        product=raw.get('product');need(type(product)is dict and type(raw.get('exemplars'))is list,'PARAMETER_SOURCE_SCHEMA')
        units=integer(product['quantity']);need(units>0,'PARAMETER_PHYSICAL_UNITS')
        examples=[str(integer(v['exemplar_id']))for v in raw['exemplars']]
        need(len(examples)==len(set(examples))==units and '0'not in examples,'PARAMETER_EXEMPLAR_COVERAGE')
        scheme=raw['schema'].upper();need(scheme in('FBO','FBS'),'PARAMETER_SOURCE_SCHEMA')
        rows.append({'scheme':scheme,'posting':text(raw['posting_number_key']),'sku':str(integer(product['sku'])),
                     'exemplars':sorted(examples),'type':raw['type']})
    return rows

def normalize_finance(packet):
    need(type(packet)is dict and packet.get('http')==200,'PARAMETER_SOURCE_SCHEMA')
    data=packet.get('data');need(type(data)is dict and type(data.get('cashflows'))is dict,'PARAMETER_SOURCE_SCHEMA')
    services=data['cashflows'].get('services');need(type(services)is list,'PARAMETER_FINANCIAL_COMPONENTS_UNKNOWN')
    rows=[]
    for raw in services:
        amount=raw.get('amount');need(type(amount)is dict and amount.get('currency_code')=='RUB','PARAMETER_CURRENCY_CHANGED')
        # JSON must have been parsed with parse_float=Decimal. A raw binary float
        # is refused rather than declared exact financial evidence.
        value=amount.get('value');need(type(value)in(str,int,Decimal)and type(value)is not bool,'PARAMETER_DECIMAL')
        rows.append({'component':text(raw['name']),'amount':decimal_text(number(str(value))),'currency':'RUB'})
    return rows

NORMALIZERS={'orders':normalize_orders,'returns':normalize_returns,'finance':normalize_finance}

def normalize(source,packet):
    need(source in NORMALIZERS,'PARAMETER_SOURCE_UNKNOWN')
    try:return NORMALIZERS[source](packet)
    except ParameterError:raise
    except (ValueError,TypeError,KeyError,AttributeError):raise ParameterError('PARAMETER_SOURCE_SCHEMA')from None

def month_shift(day,n):
    idx=day.year*12+day.month-1+n;y,m=divmod(idx,12);m+=1
    return date(y,m,min(day.day,monthrange(y,m)[1]))

def windows(period,months):
    start=date.fromisoformat(period['from']);end=date.fromisoformat(period['to'])
    while start<=end:
        boundary=month_shift(start,months);last=min(end,boundary-timedelta(days=1))
        yield {'from':start.isoformat(),'to':last.isoformat()}
        start=last+timedelta(days=1)

def source_plan(key,target,period,as_of):
    """Registered operations only. The existing worker owns paging/retry/IO.

    Orders use calendar windows without an application-year/page-call quota;
    returns are read through as_of (not merely the cohort's end).
    """
    rule=definition(key);recipe=CATALOG['templates'].get(rule['producer_template'])
    need(recipe is not None,'PARAMETER_PRODUCER_UNKNOWN');checked_period(period);scope(target['scope'])
    need(target['provider']=='OZON','PARAMETER_PLATFORM');at=stamp(as_of)
    need(date.fromisoformat(period['actual']['to'])<at.astimezone(TZ).date(),'PARAMETER_UNFINISHED_DAY')
    required=[]
    for source in recipe['sources']:
        spec=CATALOG['sources'][source]
        if source=='finance':need(target['scope']['kind']in spec['scopes'],'PARAMETER_SOURCE_SCOPE_UNAVAILABLE')
        if source=='returns':
            start=datetime.fromisoformat(period['actual']['from']+'T00:00:00').replace(tzinfo=TZ).astimezone(timezone.utc)
            required.append({'source':source,'operation':'returns_list','params':{'filter':{'logistic_return_date':{'time_from':start.isoformat(),'time_to':at.isoformat()}},'limit':500,'last_id':0},
              'pagination':deepcopy(spec['pagination']),'boundary_operations':spec['boundary_operations'],'coverage_through':as_of})
        else:
            for window in windows(period['actual'],spec['window_months']):
                if source=='orders':
                    start=datetime.fromisoformat(window['from']+'T00:00:00').replace(tzinfo=TZ).astimezone(timezone.utc)
                    end=(datetime.fromisoformat(window['to']+'T00:00:00').replace(tzinfo=TZ)+timedelta(days=1)-timedelta(microseconds=1)).astimezone(timezone.utc)
                    for scheme in spec['schemes']:
                        required.append({'source':source,'operation':'report_postings_create','params':{'filter':{'processed_at_from':start.isoformat(),'processed_at_to':end.isoformat(),'delivery_schema':[scheme.lower()]},'language':'DEFAULT'},
                          'period':window,'scheme':scheme,'followups':['report_info','report_file_get']})
                else:required.append({'source':source,'operation':'finance_balance','params':{'date_from':window['from'],'date_to':window['to']},'period':window})
    return {'schema':'alisa-parameter-source-plan/v1','template_id':rule['producer_template'],'recipe_hash':HASH,
            'target':deepcopy(target),'parameter_period':deepcopy(period),'as_of':as_of,'steps':required,
            'current_value_mutated':False,'universal_fallback':False}

def coverage(intervals,start,end):
    cursor=start
    for a,b in sorted(intervals):
        need(a<=b,'PARAMETER_COVERAGE_INVALID')
        if b<cursor:continue
        need(a<=cursor,'PARAMETER_COVERAGE_INCOMPLETE')
        cursor=max(cursor,b+timedelta(days=1))
        if cursor>end:return True
    need(cursor>end,'PARAMETER_COVERAGE_INCOMPLETE');return True

def validate_batches(recipe,target,period,batches,verify,as_of,now):
    need(callable(verify),'PARAMETER_SOURCE_VERIFIER_REQUIRED')
    need(type(batches)is dict and set(batches)==set(recipe['sources']),'PARAMETER_REQUIRED_SOURCE_MISSING')
    start,end=checked_period(period);all_rows={};stamps={};proofs=[];boundaries={}
    for source,parts in batches.items():
        need(type(parts)is list and parts,'PARAMETER_REQUIRED_SOURCE_MISSING')
        spec=CATALOG['sources'][source];intervals=defaultdict(list);seen=set();rows=[];times=[];observation=[]
        for part in parts:
            exact(part,('source','target','period','scheme','axis','collected_at','observed_until','complete','terminal','rows','boundaries','receipt_hash'))
            need(part['source']==source and part['target']==target and part['axis']==spec['axis'],'PARAMETER_SOURCE_BINDING')
            need(part['complete']is True and part['terminal']is True,'PARAMETER_COVERAGE_INCOMPLETE')
            need(type(part['receipt_hash'])is str and re.fullmatch(r'[a-f0-9]{64}',part['receipt_hash'])is not None,'PARAMETER_RECEIPT')
            # Trusted verifier must bind rows, requested intervals and cursor/file
            # completion to the existing job ledger/artifact hash and live scope.
            need(verify(source,deepcopy(part),deepcopy(target))is True,'PARAMETER_SOURCE_UNQUALIFIED')
            need(part['receipt_hash']not in seen,'PARAMETER_RECEIPT_DUPLICATE');seen.add(part['receipt_hash'])
            collected=stamp(part['collected_at']);observed=stamp(part['observed_until'])
            need(collected<=now and observed<=now and observed>=as_of,'PARAMETER_SOURCE_OBSERVATION')
            from .parameter_contract import dates
            a,b=dates(part['period']);need(type(part['rows'])is list and type(part['boundaries'])is list,'PARAMETER_SOURCE_ROWS')
            if source=='orders':need(part['scheme']in spec['schemes'],'PARAMETER_SOURCE_SCHEME')
            else:need(part['scheme']is None,'PARAMETER_SOURCE_SCHEME')
            intervals[part['scheme']].append((a,b));times.append(collected);observation.append(observed)
            for row in part['boundaries']:
                exact(row,('scheme','posting','sku','day'))
                key=(row['scheme'],row['posting'],row['sku']);day=date.fromisoformat(row['day'])
                need(not(start<=day<=end),'PARAMETER_UNMATCHED_COHORT_RETURN')
                need(key not in boundaries or boundaries[key]==row['day'],'PARAMETER_BOUNDARY_CONFLICT');boundaries[key]=row['day']
            rows+=deepcopy(part['rows']);proofs.append({'source':source,'receipt_hash':part['receipt_hash'],'period':deepcopy(part['period'])})
        if source=='orders':
            for scheme in spec['schemes']:coverage(intervals.get(scheme,[]),start,end)
        elif source=='returns':coverage(intervals.get(None,[]),start,as_of.astimezone(TZ).date())
        else:
            need(target['scope']['kind']=='store','PARAMETER_SOURCE_SCOPE_UNAVAILABLE')
            # Balance totals cannot be clipped from a larger interval or overlap.
            cursor=start
            for a,b in sorted(intervals[None]):
                need(a==cursor and b<=end,'PARAMETER_FINANCE_PERIOD_MISMATCH');cursor=b+timedelta(days=1)
            need(cursor==end+timedelta(days=1),'PARAMETER_COVERAGE_INCOMPLETE')
        all_rows[source]=rows;stamps[source]={'collected_at':min(times).isoformat(),'observed_until':min(observation).isoformat()}
    return all_rows,stamps,proofs,boundaries

def physical_cohort(rows,target,period):
    index={};duplicates=0
    for row in rows:
        exact(row,('scheme','posting','sku','day','units','state'));need(row['scheme']in('FBO','FBS'),'PARAMETER_SOURCE_SCHEME')
        need(row['state']in('delivered','cancelled','pending'),'PARAMETER_ORDER_STATUS_UNKNOWN')
        k=(text(row['scheme']),text(row['posting']),str(integer(row['sku'])));need(integer(row['units'])>0,'PARAMETER_PHYSICAL_UNITS');date.fromisoformat(row['day'])
        if k in index:need(index[k]==row,'PARAMETER_DUPLICATE_ORDER_CONFLICT');duplicates+=1
        else:index[k]=deepcopy(row)
    chosen={k:v for k,v in index.items()if period['actual']['from']<=v['day']<=period['actual']['to']and(target['scope']['kind']=='store'or v['sku']==target['scope']['sku'])}
    return {'ordered_units':sum(v['units']for v in chosen.values()),'duplicate_order_rows':duplicates},index,chosen

def physical_outcomes(rows,returns,target,period,boundaries):
    totals,index,chosen=physical_cohort(rows,target,period);returned=defaultdict(set);duplicates=0
    for row in returns:
        exact(row,('scheme','posting','sku','exemplars','type'));need(row['type']in CATALOG['sources']['returns']['types'],'PARAMETER_RETURN_TYPE_UNKNOWN')
        k=(text(row['scheme']),text(row['posting']),str(integer(row['sku'])));need(type(row['exemplars'])is list and row['exemplars'],'PARAMETER_EXEMPLAR_COVERAGE')
        need(k in index or k in boundaries,'PARAMETER_RETURN_BOUNDARY_REQUIRED')
        ids=set(str(integer(e))for e in row['exemplars']);need(len(ids)==len(row['exemplars'])and'0'not in ids,'PARAMETER_EXEMPLAR_COVERAGE')
        duplicates+=len(returned[k]&ids);returned[k]|=ids
        if k in index:need(len(returned[k])<=index[k]['units'],'PARAMETER_RETURN_QUANTITY_EXCEEDS_ORDER')
    failed=pending=physical=0
    for k,row in chosen.items():
        n=row['units'];r=len(returned[k]);failed+=n if row['state']=='cancelled'else r;physical+=r
        if row['state']=='pending':pending+=n-r
    totals.update(failed_units=failed,pending_units=pending,returned_units=physical,duplicate_return_exemplars=duplicates)
    return totals

def expense_components(rows,components):
    known={};used=set()
    for name,names in components.items():
        need(type(names)is list and not used.intersection(names),'PARAMETER_EXPENSE_DOUBLE_COUNT');used.update(names);known[name]=Decimal(0)
    for row in rows:
        exact(row,('component','amount','currency'));need(row['currency']=='RUB','PARAMETER_CURRENCY_CHANGED')
        for name,names in components.items():
            if row['component']in names:known[name]-=number(row['amount'])
    need(all(v>=0 for v in known.values()),'PARAMETER_NET_EXPENSE_NEGATIVE')
    return {k:decimal_text(v)for k,v in known.items()}

@dataclass(frozen=True)
class Produced:
    key:str
    target_json:str
    period_json:str
    envelope_json:str
    proof_json:str
    observed_until:str

    def verify(self,target,period,envelope):
        return CANON(target)==self.target_json and CANON(period)==self.period_json and CANON(envelope)==self.envelope_json


def produce(key,target,period,batches,*,verify,as_of,now):
    """Only output a typed candidate; caller owns preview vs CAS replacement."""
    rule=definition(key);recipe=CATALOG['templates'].get(rule['producer_template']);need(recipe is not None,'PARAMETER_PRODUCER_UNKNOWN')
    scope(target['scope']);need(target['provider']=='OZON','PARAMETER_PLATFORM');at=stamp(as_of)
    need(at<=now,'PARAMETER_FUTURE_COLLECTION')
    data,times,proofs,boundaries=validate_batches(recipe,target,period,batches,verify,at,now)
    computed={}
    with localcontext()as ctx:
        ctx.prec=60
        for step in recipe['steps']:
            op=step['operation']
            if op=='physical_cohort':value=physical_cohort(data[step['orders']],target,period)[0]
            elif op=='physical_outcome_union':value=physical_outcomes(data[step['orders']],data[step['returns']],target,period,boundaries)
            elif op=='signed_expense_components':value=expense_components(data[step['source']],step['components'])
            else:raise ParameterError('PARAMETER_REDUCER_UNKNOWN')
            computed[step['id']]=value
    inputs={k:str(computed[path[0]][path[1]])for k,path in recipe['inputs'].items()}
    envelope={'producer_template':rule['producer_template'],'inputs':inputs,
      'coverage':{'complete':True,'actual_period':deepcopy(period['actual']),'short_history':period['short_history'],'scope':deepcopy(target['scope'])},
      'source_collected_at':{name:times[source]['collected_at']for name,source in recipe['observation_sources'].items()},
      'observed_until':min(stamp(v['observed_until'])for v in times.values()).isoformat()}
    evidence={'recipe_hash':HASH,'definition_hash':CATALOG_HASH,'receipts':proofs,
      'controls':{k:str(computed[path[0]][path[1]])for k,path in recipe['evidence'].items()},
      'note':recipe['note']}
    # Re-run the existing value/unit/formula contract before a candidate can be
    # offered to the existing atomic writer. This is arithmetic, not another LLM.
    envelope['provenance']=evidence
    candidate=Produced(key,CANON(target),CANON(period),CANON(envelope),CANON(evidence),envelope['observed_until'])
    validate_calculation(key,envelope,target,period,now,candidate.verify)
    return candidate
