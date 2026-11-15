"""Qualified original-order inputs and declarative forecast arithmetic.

Pure module: no API/LLM/DB, arbitrary expression execution or saved coefficients.
Source normalization/ledger attestation must come from a trusted existing job;
client JSON flags, current-day net balances and aggregate posting fees are not proof.
"""
from copy import deepcopy
from decimal import Decimal, localcontext
from pathlib import Path
from hashlib import sha256
from dataclasses import dataclass
import json,re
from . import parameter_contract as c
CATALOG=json.loads(Path(__file__).with_name('economics_cohort_catalog.json').read_text())
HASH=sha256(c.CANON(CATALOG).encode()).hexdigest()

class EconomicsError(ValueError):
    def __init__(self,code):self.code=code;super().__init__(code)

def need(ok,code):
    if not ok:raise EconomicsError(code)

def exact(value,keys):need(type(value)is dict and set(value)==set(keys),'ECONOMICS_SCHEMA')
def number(value):
    try:return c.number(value)
    except c.ParameterError as e:raise EconomicsError('ECONOMICS_'+e.code)from None

def integer(value):
    n=number(value);need(n>=0 and n==n.to_integral_value(),'ECONOMICS_QUANTITY');return n

def ident(value):need(type(value)is str and bool(value)and not any(ord(x)<32 for x in value),'ECONOMICS_ID');return value

def key(row):return(row['posting'],row['sku'],row['scheme'])

def expression(tree,values):
    need(type(tree)is dict and len(tree)==1,'ECONOMICS_FORMULA');op,arg=next(iter(tree.items()))
    if op=='input':need(arg in values,'ECONOMICS_MISSING_INPUT:'+str(arg));return values[arg]
    if op=='constant':return number(arg)
    need(op in ('add','subtract','multiply','divide','ratio')and type(arg)is list and len(arg)==2,'ECONOMICS_FORMULA')
    left,right=(expression(x,values)for x in arg)
    need(left is not None and right is not None,'ECONOMICS_UNDEFINED_FORMULA_INPUT')
    if op=='add':return left+right
    if op=='subtract':return left-right
    if op=='multiply':return left*right
    if right==0:
        need(op=='ratio','ECONOMICS_ZERO_DENOMINATOR');return None
    return left/right

def _checked_source(name,data,target,period,verify):
    exact(data,('rows','receipt_hash','complete','scope','period','observed_at'))
    need(data['scope']==target and data['period']==period,'ECONOMICS_SOURCE_SCOPE')
    need(data['complete']is True and type(data['rows'])is list,'ECONOMICS_SOURCE_INCOMPLETE')
    need(type(data['receipt_hash'])is str and re.fullmatch('[a-f0-9]{64}',data['receipt_hash']),'ECONOMICS_RECEIPT')
    try:c.stamp(data['observed_at'])
    except c.ParameterError:raise EconomicsError('ECONOMICS_SOURCE_CLOCK')from None
    need(callable(verify),'ECONOMICS_SOURCE_VERIFIER_REQUIRED')
    try:valid=verify(name,deepcopy(data),deepcopy(target),deepcopy(period))
    except Exception:raise EconomicsError('ECONOMICS_SOURCE_VERIFIER_UNAVAILABLE')from None
    need(valid is True,'ECONOMICS_SOURCE_NOT_QUALIFIED')

@dataclass(frozen=True,repr=False)
class QualifiedCohort:
    scope_json:str
    period_json:str
    rows_json:str
    evidence_json:str
    definition_hash:str
    def __repr__(self):return '<QualifiedCohort request-local; not a persisted value history>'
    @property
    def rows(self):return json.loads(self.rows_json)
    @property
    def scope(self):return json.loads(self.scope_json)
    @property
    def period(self):return json.loads(self.period_json)
    def checkpoint(self):
        return {'definition_hash':self.definition_hash,'scope':self.scope,'period':self.period,
                'source_receipts':json.loads(self.evidence_json)['receipts'],'persist_values':False}


def qualify(bundle,target,period,*,verify):
    """Normalize only explicitly classified original debits; never guess direction.

    A matched original amount covers its complete original product line or whole
    posting. Partial/overlapping financial coverage requires better source proof,
    not original-amount-plus-full-tariff double counting.
    """
    bundle,target,period=deepcopy(bundle),deepcopy(target),deepcopy(period)
    exact(target,('tenant_id','store_id','provider','currency'))
    need(target['provider']==CATALOG['provider']and target['currency']=='RUB','ECONOMICS_PLATFORM_CURRENCY')
    ident(target['tenant_id']);ident(target['store_id'])
    try:c.dates(period)
    except c.ParameterError:raise EconomicsError('ECONOMICS_PERIOD')from None
    exact(bundle,CATALOG['sources'])
    for name,data in bundle.items():_checked_source(name,data,target,period,verify)
    with localcontext()as ctx:
        ctx.prec=60
        orders={};postings={}
        for row in bundle['orders']['rows']:
            exact(row,('posting','sku','scheme','day','quantity','seller_price'))
            ident(row['posting']);c.scope({'kind':'sku','sku':row['sku']})
            need(row['scheme']in CATALOG['schemes'],'ECONOMICS_SCHEME')
            try:c.dates({'from':row['day'],'to':row['day']})
            except c.ParameterError:raise EconomicsError('ECONOMICS_ORDER_DAY')from None
            need(period['from']<=row['day']<=period['to'],'ECONOMICS_WRONG_COHORT_DAY')
            need(integer(row['quantity'])>0 and number(row['seller_price'])>=0,'ECONOMICS_ORDER_VALUE')
            need(key(row)not in orders,'ECONOMICS_DUPLICATE_ORDER_LINE')
            orders[key(row)]=deepcopy(row);postings.setdefault((row['posting'],row['scheme']),[]).append(key(row))
        # Posting identifiers must identify one scheme in this cohort.
        need(len({p for p,s in postings})==len(postings),'ECONOMICS_POSTING_SCHEME_CONFLICT')
        tariffs={}
        for row in bundle['tariffs']['rows']:
            exact(row,('sku','scheme','quote_id','fields'))
            c.scope({'kind':'sku','sku':row['sku']});need(row['scheme']in CATALOG['schemes'],'ECONOMICS_SCHEME');ident(row['quote_id'])
            need(type(row['fields'])is dict and set(row['fields'])<=set(CATALOG['tariff_fields']),'ECONOMICS_TARIFF_FIELDS')
            for field,value in row['fields'].items():
                n=number(value);need(n>=0,'ECONOMICS_TARIFF_RANGE')
                if CATALOG['tariff_fields'][field].get('maximum')is not None:need(n<=number(CATALOG['tariff_fields'][field]['maximum']),'ECONOMICS_TARIFF_RANGE')
            if {'processing_min','processing_max'}<=set(row['fields']):
                need(number(row['fields']['processing_min'])<=number(row['fields']['processing_max']),'ECONOMICS_TARIFF_INTERVAL')
            k=(row['sku'],row['scheme']);need(k not in tariffs,'ECONOMICS_AMBIGUOUS_TARIFF');tariffs[k]=deepcopy(row)
        events={};duplicates=0
        for event in bundle['fees']['rows']:
            exact(event,('event_id','posting','sku','scheme','type_id','nature','parent_id','quantity','amount','currency','accrual_day'))
            ident(event['event_id']);ident(event['posting']);need(type(event['type_id'])is int,'ECONOMICS_FEE_TYPE')
            need(type(event['scheme'])is str and event['scheme']in CATALOG['schemes'],'ECONOMICS_SCHEME')
            need(event['currency']=='RUB','ECONOMICS_SOURCE_CURRENCY');number(event['amount'])
            need(event['nature']in ('ORIGINAL','CORRECTION','SALE_REVERSAL'),'ECONOMICS_FEE_NATURE')
            need((event['nature']=='ORIGINAL')==(event['parent_id']is None),'ECONOMICS_FEE_PARENT')
            if event['parent_id']is not None:ident(event['parent_id'])
            if event['sku']is not None:c.scope({'kind':'sku','sku':event['sku']});integer(event['quantity'])
            else:need(event['quantity']is None,'ECONOMICS_POSTING_COVERAGE')
            try:c.dates({'from':event['accrual_day'],'to':event['accrual_day']})
            except c.ParameterError:raise EconomicsError('ECONOMICS_ACCRUAL_DAY')from None
            old=events.setdefault(event['event_id'],deepcopy(event))
            need(old==event,'ECONOMICS_CONFLICTING_EVENT_VERSION')
        duplicates=len(bundle['fees']['rows'])-len(events)
        corrections={}
        # Validate every declared edge BEFORE applying any correction or dropping
        # out-of-cohort rows. A wrong-scope child must not influence an in-scope
        # original via parent_id, or escape validation through the cohort filter.
        for entry in events.values():
            if entry['nature']!='ORIGINAL':
                parent=events.get(entry['parent_id'])
                need(parent is not None and parent['nature']=='ORIGINAL','ECONOMICS_ORPHAN_CORRECTION')
                need(all(entry[x]==parent[x]for x in ('posting','sku','scheme','type_id','currency','quantity')),
                     'ECONOMICS_CORRECTION_SCOPE')
            if entry['nature']=='CORRECTION':corrections.setdefault(entry['parent_id'],[]).append(entry)
        posting_ids={p for p,scheme in postings}
        actual={k:{}for k in orders};ignored={};selected_ids=[];allocated_totals={}
        classes=CATALOG['fee_groups'];included={i:g for g,v in classes.items()for i in v['types']}
        excluded=set(CATALOG['excluded_fee_types']);known=set(included)|excluded
        for event in events.values():
            pk=(event['posting'],event['scheme'])
            if event['posting']in posting_ids:need(pk in postings,'ECONOMICS_FEE_SCHEME_CONFLICT')
            if pk not in postings:
                ignored['outside_cohort']=ignored.get('outside_cohort',0)+1;continue
            need(event['type_id']in known,'ECONOMICS_UNCLASSIFIED_FEE')
            if event['nature']!='ORIGINAL':
                if event['nature']=='SALE_REVERSAL':ignored['sale_reversal']=ignored.get('sale_reversal',0)+1
                continue
            if event['type_id']in excluded:
                ignored['excluded_delivery']=ignored.get('excluded_delivery',0)+1;continue
            group=included[event['type_id']]
            allocation=None
            if event['sku']is None:
                allocation=CATALOG['posting_allocations'].get(group)
                need(allocation=='ORIGINAL_PHYSICAL_UNITS','ECONOMICS_ITEM_ATTRIBUTION_REQUIRED')
            affected=postings[pk]if event['sku']is None else[key(event)]
            need(all(k in orders for k in affected),'ECONOMICS_FEE_SKU_NOT_IN_POSTING')
            if event['sku']is not None:need(integer(event['quantity'])==integer(orders[affected[0]]['quantity']),'ECONOMICS_PARTIAL_FEE_COVERAGE')
            if classes[group]['original_nonnegative']:need(number(event['amount'])<=0,'ECONOMICS_ORIGINAL_DEBIT_SIGN')
            related=corrections.get(event['event_id'],[])
            cost=-sum((number(e['amount'])for e in [event,*related]),Decimal(0))
            if classes[group]['original_nonnegative']:need(cost>=0,'ECONOMICS_ORIGINAL_DEBIT_SIGN')
            total_units=sum((integer(orders[k]['quantity'])for k in affected),Decimal(0));left=cost
            for index,k in enumerate(sorted(affected)):
                item=actual[k].setdefault(group,{'amount':Decimal(0),'types':set(),'events':[],'allocation':None})
                need(event['type_id']not in item['types'],'ECONOMICS_OVERLAPPING_ORIGINAL_FEE')
                part=left if index==len(affected)-1 else cost*integer(orders[k]['quantity'])/total_units;left-=part
                if allocation is not None:item['allocation']=allocation
                item['amount']+=part;item['types'].add(event['type_id']);item['events']+=[e['event_id']for e in [event,*related]]
            need(left==0,'ECONOMICS_ALLOCATION_NOT_CONSERVED');allocated_totals[event['event_id']]=c.decimal_text(cost)
            selected_ids+=[e['event_id']for e in [event,*related]]
        result=[]
        for k,row in sorted(orders.items()):
            quantity=integer(row['quantity']);vals={'quantity':quantity,'seller_price':number(row['seller_price'])};vals['turnover']=quantity*vals['seller_price']
            tariff=tariffs.get((row['sku'],row['scheme']));basis={}
            for output,rule in CATALOG['line_inputs'].items():
                group=rule.get('fee_group');matched=actual[k].get(group)
                if matched is not None:
                    vals[output]=matched['amount']
                    basis[output]={'kind':'QUALIFIED_POSTING_ALLOCATION'if matched['allocation']else'QUALIFIED_ORIGINAL_DEBIT',
                                   'allocation':matched['allocation'],'events':matched['events']}
                    continue
                fallback=rule['fallback'][row['scheme']]
                inputs=deepcopy(vals)
                if tariff:inputs.update({name:number(v)for name,v in tariff['fields'].items()})
                vals[output]=expression(fallback,inputs)
                basis[output]={'kind':rule['fallback_kind'][row['scheme']],'quote_id':tariff['quote_id']if tariff else None}
            result.append({'order':row,'inputs':{name:c.decimal_text(v)for name,v in vals.items()},'basis':basis})
        # Period expenses are qualified as period-wide allocations, never claimed
        # to be order-level original debits. Unknown is not a numeric zero.
        period_costs={}
        for row in bundle['period_costs']['rows']:
            exact(row,('component','amount','basis'))
            need(row['component']in CATALOG['period_costs']and row['component']not in period_costs,'ECONOMICS_PERIOD_COST')
            need(row['basis']=='FULL_PERIOD','ECONOMICS_PERIOD_ALLOCATION_UNQUALIFIED');need(number(row['amount'])>=0,'ECONOMICS_PERIOD_COST')
            period_costs[row['component']]=row['amount']
        need(set(period_costs)==set(CATALOG['period_costs']),'ECONOMICS_MISSING_PERIOD_COST')
        evidence={'receipts':{n:bundle[n]['receipt_hash']for n in bundle},'period_costs':period_costs,
                  'duplicates_removed':duplicates,'ignored':ignored,'selected_event_ids':sorted(selected_ids),
                  'posting_allocation_totals':allocated_totals,'observed_at':{n:bundle[n]['observed_at']for n in bundle}}
        return QualifiedCohort(c.CANON(target),c.CANON(period),c.CANON(result),c.CANON(evidence),HASH)


def calculate(qualified,unit_costs,coefficients,owner_period):
    need(type(qualified)is QualifiedCohort and qualified.definition_hash==HASH,'ECONOMICS_QUALIFIED_INPUT_REQUIRED')
    need(type(unit_costs)is dict and type(coefficients)is dict,'ECONOMICS_CURRENT_INPUTS')
    exact(owner_period,('tax_amount','own_cost_amount'))
    ids={c.CANON(key(r['order']))for r in qualified.rows}
    need(set(unit_costs)==set(coefficients)==ids,'ECONOMICS_CURRENT_INPUT_SCOPE')
    for row in owner_period.values():
        exact(row,('state','value'));need(row['state']in('VALUE','NOT_PROVIDED','EXCLUDED_BY_OWNER'),'ECONOMICS_OWNER_INPUT')
        if row['state']=='VALUE':need(number(row['value'])>=0,'ECONOMICS_OWNER_INPUT')
        else:need(row['value']is None,'ECONOMICS_UNKNOWN_NOT_ZERO')
    with localcontext()as ctx:
        ctx.prec=60;results={};evidence=json.loads(qualified.evidence_json)
        for scenario,spec in CATALOG['scenarios'].items():
            totals={name:Decimal(0)for name in CATALOG['row_outputs']}
            used=[]
            for row in qualified.rows:
                k=c.CANON(key(row['order']));values={n:number(v)for n,v in row['inputs'].items()}
                need(number(unit_costs[k])>=0,'ECONOMICS_COGS_UNKNOWN');values['unit_cost']=number(unit_costs[k])
                exact(coefficients[k],('loss_rate','delivery_mean'))
                for n,v in coefficients[k].items():c.validate_value(c.definition(n),v,c.definition(n)['unit']);values[n]=number(v)
                values['loss_rate']=values['loss_rate']if spec['use_loss']else Decimal(0)
                for name,formula in CATALOG['row_outputs'].items():totals[name]+=expression(formula,values)
                used.append({'sku':row['order']['sku'],'scheme':row['order']['scheme'],'basis':row['basis']})
            totals.update({n:number(v)for n,v in evidence['period_costs'].items()})
            for name,formula in CATALOG['report_outputs'].items():totals[name]=expression(formula,totals)
            complete_owner=all(row['state']=='VALUE'for row in owner_period.values())
            after=None
            if complete_owner:after=totals['remainder_before_owner_inputs']-sum((number(v['value'])for v in owner_period.values()),Decimal(0))
            results[scenario]={'totals':{n:c.decimal_text(v)if v is not None else None for n,v in totals.items()},
                'per_original_unit':{n:c.decimal_text(v/totals['original_units'])if totals['original_units']else None for n,v in totals.items()if n in CATALOG['money_outputs']},
                'after_declared_owner_inputs':c.decimal_text(after)if after is not None else None,
                'owner_inputs_complete':complete_owner,'unknown_owner_inputs':[n for n,v in owner_period.items()if v['state']!='VALUE'],
                'not_actual_profit':True,'source_basis':used,'period_cost_basis':'FULL_PERIOD_ALLOCATION'}
        return {'schema':'alisa-qualified-economics/v1','definition_hash':HASH,'scope':qualified.scope,'period':qualified.period,
                'scenarios':results,'owner_period':deepcopy(owner_period),'no_intermediate_rounding':True,'persisted':False}
