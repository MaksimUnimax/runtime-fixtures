"""Generic pinned owner-fact bindings and scenario composition.

No marketplace clients, issuer, SQL, dynamic Python, or implicit tariff selection.
A protected adapter attests the normalized cohort and expense observations. The
matrix selects quantities, owner fields, costs, bases and output arithmetic.
"""
from __future__ import annotations
from copy import deepcopy
from datetime import date
from decimal import Decimal, localcontext
from typing import Callable
import re
import hashlib
from pathlib import Path
import owner_inputs as owner_module
import matrix_core as matrix_module
import report_contracts as gate_module
from owner_inputs import OwnerInputs, InputError, digest, canonical, period, amount
from matrix_core import evaluate, validate_expression, MatrixError
from report_contracts import ReportContracts, ContractError

HEX = re.compile(r'[a-f0-9]{64}\Z')
IDENT = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}\Z')
NAME = re.compile(r'[a-z][a-z0-9_]{0,79}\Z')
OBS_KEYS = {'id','state','coverage','value','currency','period','scope_hash','axis','unit',
            'source_hash','receipt_hash','observed_at','expires_at','zero_proof','expense_keys'}
BASES = {'ACTUAL_MATCHED','ACTUAL_PERIOD_ALLOCATION','API_TARIFF_ESTIMATE',
         'OFFICIAL_TARIFF_ESTIMATE','VERIFIED_CONTROL'}

class BindingError(ValueError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)

def need(ok, code='SCENARIO_SCHEMA'):
    if not ok:
        raise BindingError(code)

def exact(obj, keys, code='SCENARIO_SCHEMA'):
    need(type(obj) is dict and set(obj) == set(keys), code)

def safe_text(value, limit=300):
    return type(value) is str and 1 <= len(value) <= limit and all(ord(c) >= 32 for c in value)

def clone(value):
    # Uses the existing 1 MiB, finite JSON boundary; avoids sharing mutable input.
    import json
    return json.loads(canonical(value))

def numeric(value, *, integral=False, nonnegative=False):
    try:
        number = amount(value)
    except InputError:
        raise BindingError('SCENARIO_NUMBER') from None
    need(abs(number) <= Decimal('1e18'), 'SCENARIO_NUMBER')
    need(not nonnegative or number >= 0, 'SCENARIO_NUMBER')
    need(not integral or number == number.to_integral_value(), 'SCENARIO_QUANTITY')
    return number

def call_auth(callback, kind, metadata, context, action):
    need(callable(callback), 'SCENARIO_AUTH_REQUIRED')
    try:
        allowed = callback(kind, deepcopy(metadata), deepcopy(context), action)
    except Exception:
        raise BindingError('SCENARIO_AUTH_UNAVAILABLE') from None
    need(allowed is True, 'SCENARIO_AUTH_DENIED')

def expr(tree, environment):
    try:
        with localcontext() as precision:
            precision.prec = 40
            return evaluate(tree, environment)
    except MatrixError as exc:
        raise BindingError(exc.code) from None

def path(*keys):
    return {'$path': list(keys)}

def fn(name, *args):
    return {'$fn': [name, *args]}

class ScenarioBindings:
    """All source, owner, and policy hashes are immutable for one accepted plan.

    authorize(kind, metadata, context, action) attests policy/cohort/expenses;
    owner_authorize follows OwnerInputs' existing signature. Hashes alone grant
    no access. The caller must provide trusted current time and approved mapping.
    """
    def __init__(self, catalog: dict, owner_catalog: dict, gate_catalog: dict):
        catalog = clone(catalog)
        exact(catalog, {'schema','version','max_rows','row_schema','row_guards',
                        'identity_field','entity_field','date_field','original_quantity',
                        'owner_bindings','sources','output','scenarios'})
        need(catalog['schema'] == 'alice-scenario-bindings/v1' and safe_text(catalog['version'],80))
        need(type(catalog['max_rows']) is int and 1 <= catalog['max_rows'] <= 2000)
        self.owner = OwnerInputs(owner_catalog)
        self.gate = ReportContracts(gate_catalog)
        self._gate_catalog = clone(gate_catalog)
        fields = catalog['row_schema']
        need(type(fields) is dict and 1 <= len(fields) <= 32)
        for name, rule in fields.items():
            need(type(name) is str and NAME.fullmatch(name))
            exact(rule, {'kind','minimum','maximum'})
            need(rule['kind'] in ('id','date','quantity','money_per_unit'))
            if rule['kind'] in ('quantity','money_per_unit'):
                need(numeric(rule['minimum']) <= numeric(rule['maximum']))
            else:
                need(rule['minimum'] is None and rule['maximum'] is None)
        for role, kind in [('identity_field','id'),('entity_field','id'),('date_field','date')]:
            need(catalog[role] in fields and fields[catalog[role]]['kind'] == kind)
        need(type(catalog['row_guards']) is list and len(catalog['row_guards']) <= 32)
        for tree in catalog['row_guards'] + [catalog['original_quantity']]:
            validate_expression(tree, {'row'})
        bindings = catalog['owner_bindings']
        need(type(bindings) is dict and len(bindings) <= 32)
        for component, rule in bindings.items():
            need(type(component) is str and NAME.fullmatch(component))
            exact(rule, {'field','mode','axis','label'})
            need(rule['field'] in owner_catalog['fields'] and safe_text(rule['label']))
            need(rule['mode'] in ('unit_times_quantity','exact_period'))
            definition = owner_catalog['fields'][rule['field']]
            need((rule['mode'] == 'unit_times_quantity' and definition['mode'] == 'effective_date'
                  and definition['unit'] == 'currency_per_physical_unit') or
                 (rule['mode'] == 'exact_period' and definition['mode'] == 'exact_period'
                  and definition['unit'] == 'currency'), 'SCENARIO_INPUT_DIMENSION')
        sources = catalog['sources']
        need(type(sources) is dict and len(sources) <= 32 and not set(sources) & set(bindings))
        for component, rule in sources.items():
            need(type(component) is str and NAME.fullmatch(component))
            exact(rule, {'label','bases'})
            need(safe_text(rule['label']) and type(rule['bases']) is list and rule['bases']
                 and len(rule['bases']) == len(set(rule['bases'])) and set(rule['bases']) <= BASES)
        exact(catalog['output'], {'revenue_component','unit_component','original_unit_component','cost_components'})
        output = catalog['output']
        need(type(output['cost_components']) is list and output['cost_components']
             and len(output['cost_components']) == len(set(output['cost_components'])))
        need(set(output['cost_components']) <= set(bindings) | set(sources))
        need(len(set(output[k] for k in ('revenue_component','unit_component','original_unit_component'))) == 3)
        scenarios = catalog['scenarios']
        need(type(scenarios) is dict and 1 <= len(scenarios) <= 8)
        for sid, scenario in scenarios.items():
            need(type(sid) is str and NAME.fullmatch(sid))
            exact(scenario, {'label','gate_policy','quantity','revenue','unit_label','original_unit_label','source_guards'})
            need(all(safe_text(scenario[k]) for k in ('label','unit_label','original_unit_label')))
            need(scenario['gate_policy'] in gate_catalog['policies'])
            validate_expression(scenario['quantity'], {'row'})
            validate_expression(scenario['revenue'], {'row','quantity'})
            need(type(scenario['source_guards']) is list and len(scenario['source_guards']) <= 32)
            for guard in scenario['source_guards']:
                validate_expression(guard, {'source','context'})
            policy = gate_catalog['policies'][scenario['gate_policy']]
            expected = set(sources) | set(bindings) | {output[k] for k in ('revenue_component','unit_component','original_unit_component')}
            need(set(policy['components']) == expected, 'SCENARIO_GATE_COMPONENTS')
            for key in output['cost_components']:
                need(policy['components'][key]['role'] == 'contribution', 'SCENARIO_COST_ROLE')
            need({k for k,v in policy['components'].items() if v['role']=='contribution'} == set(output['cost_components']), 'SCENARIO_COST_ROLE')
            for key in bindings:
                need(not policy['components'][key]['required'], 'SCENARIO_OWNER_OPTIONAL')
        self._catalog = catalog
        self.hash = digest(catalog)
        self.code_hash = digest({name:hashlib.sha256(Path(file).read_bytes()).hexdigest() for name,file in
            [('bindings',__file__),('owner',owner_module.__file__),('matrix',matrix_module.__file__),('gate',gate_module.__file__)]})

    @property
    def catalog(self):
        return deepcopy(self._catalog)

    def _envelope(self, envelope, schema, context, now):
        envelope = clone(envelope)
        exact(envelope, {'payload','sha256'}, 'SCENARIO_ENVELOPE')
        need(type(envelope['sha256']) is str and HEX.fullmatch(envelope['sha256'])
             and digest(envelope['payload']) == envelope['sha256'], 'SCENARIO_SOURCE_HASH')
        payload = envelope['payload']
        need(type(payload) is dict and payload.get('schema') == schema, 'SCENARIO_ENVELOPE')
        for key in ('scope_hash','currency','period','store_entity'):
            need(payload.get(key) == context[key], 'SCENARIO_SCOPE')
        need(type(now) is int and type(payload.get('issued_at')) is int and type(payload.get('expires_at')) is int
             and 0 <= context['as_of'] <= payload['issued_at'] <= now < payload['expires_at']
             and 0 < payload['expires_at']-payload['issued_at'] <= 86400, 'SCENARIO_EXPIRED')
        need(type(payload.get('revision')) is str and IDENT.fullmatch(payload['revision']), 'SCENARIO_REVISION')
        need(type(payload.get('normalization_hash')) is str and HEX.fullmatch(payload['normalization_hash']), 'SCENARIO_NORMALIZATION')
        return payload

    def _collect(self, cohort, expenses, owner_envelope, context, authorize,
                 owner_authorize, now, action, expected_pin=None):
        c = self._catalog
        cohort,expenses,owner_envelope = clone(cohort),clone(expenses),clone(owner_envelope)
        exact(owner_envelope, {'payload','sha256'}, 'SCENARIO_OWNER_ENVELOPE')
        context = clone(context)
        exact(context, {'scope_hash','store_entity','currency','period','as_of'}, 'SCENARIO_CONTEXT')
        need(type(context['scope_hash']) is str and HEX.fullmatch(context['scope_hash']), 'SCENARIO_SCOPE')
        need(type(context['store_entity']) is str and IDENT.fullmatch(context['store_entity']), 'SCENARIO_SCOPE')
        need(type(context['currency']) is str and re.fullmatch('[A-Z]{3}',context['currency']), 'SCENARIO_CURRENCY')
        need(type(context['as_of']) is int and context['as_of'] >= 0, 'SCENARIO_CLOCK')
        try:
            a,b = period(context['period'])
        except InputError:
            raise BindingError('SCENARIO_PERIOD') from None
        need(b-a < 366, 'SCENARIO_PERIOD')
        need(action in ('resolve','execute','read'), 'SCENARIO_ACTION')
        cp = self._envelope(cohort,'alice-qualified-cohort/v1',context,now)
        ep = self._envelope(expenses,'alice-scenario-expenses/v1',context,now)
        common = {'schema','revision','scope_hash','store_entity','currency','period','issued_at','expires_at','normalization_hash'}
        exact(cp, common|{'coverage','rows'}, 'SCENARIO_COHORT')
        exact(ep, common|{'scenarios'}, 'SCENARIO_EXPENSES')
        need(cp['coverage'] == 'COMPLETE', 'SCENARIO_COHORT_INCOMPLETE')
        need(type(cp['rows']) is list and len(cp['rows']) <= c['max_rows'], 'SCENARIO_CAPACITY')
        seen = set()
        for row in cp['rows']:
            exact(row, c['row_schema'], 'SCENARIO_ROW')
            for name, rule in c['row_schema'].items():
                value = row[name]
                if rule['kind'] == 'id':
                    need(type(value) is str and IDENT.fullmatch(value), 'SCENARIO_ROW_ID')
                elif rule['kind'] == 'date':
                    try:
                        ordinal = period({'from':value,'to':value})[0]
                    except InputError:
                        raise BindingError('SCENARIO_ROW_DATE') from None
                    need(a <= ordinal <= b, 'SCENARIO_ROW_DATE')
                else:
                    v = numeric(value,integral=rule['kind']=='quantity')
                    need(numeric(rule['minimum']) <= v <= numeric(rule['maximum']), 'SCENARIO_ROW_BOUND')
            key = row[c['identity_field']]
            need(key not in seen, 'SCENARIO_DUPLICATE_LINE')
            seen.add(key)
        need(type(ep['scenarios']) is dict and set(ep['scenarios']) == set(c['scenarios']), 'SCENARIO_SCOPES_MISSING')
        for sid, records in ep['scenarios'].items():
            need(type(records) is list and len(records) <= 32, 'SCENARIO_CAPACITY')
            names = set()
            for record in records:
                exact(record, {'observation','basis','allocation'}, 'SCENARIO_SOURCE_RECORD')
                obs = record['observation']
                exact(obs, OBS_KEYS, 'SCENARIO_SOURCE_RECORD')
                name = obs['id']
                need(type(name) is str and name in c['sources'] and name not in names, 'SCENARIO_SOURCE_COMPONENT')
                names.add(name)
                need(record['basis'] in c['sources'][name]['bases'], 'SCENARIO_SOURCE_BASIS')
                if obs['state']=='KNOWN' and record['basis'] in ('API_TARIFF_ESTIMATE','OFFICIAL_TARIFF_ESTIMATE'):
                    numeric(obs['value'],nonnegative=True)
                if record['basis'] == 'ACTUAL_PERIOD_ALLOCATION':
                    exact(record['allocation'], {'mode','scope_hash','period','cohort_hash'}, 'SCENARIO_ALLOCATION')
                    need(record['allocation'] == {'mode':'whole_store_cohort_period','scope_hash':context['scope_hash'],
                                                  'period':context['period'],'cohort_hash':cohort['sha256']}, 'SCENARIO_ALLOCATION')
                else:
                    need(record['allocation'] is None, 'SCENARIO_ALLOCATION')
        pins = {'schema':'alice-scenario-plan-pin/v1','scenario_catalog_hash':self.hash,'runtime_code_hash':self.code_hash,
                'owner_catalog_hash':self.owner.hash,'gate_catalog_hash':self.gate.hash,
                'context_hash':digest(context),'cohort_hash':cohort['sha256'],'expenses_hash':expenses['sha256'],
                'owner_facts_hash':owner_envelope.get('sha256'),'owner_pins':{}}
        metadata = {k:v for k,v in pins.items() if k!='owner_pins'}
        for kind,payload,content_hash in (('policy',None,self.hash),('cohort',cp,cohort['sha256']),('expenses',ep,expenses['sha256'])):
            detail = {**metadata,'content_hash':content_hash}
            if payload is not None:
                detail.update(revision=payload['revision'],normalization_hash=payload['normalization_hash'],
                              issued_at=payload['issued_at'],expires_at=payload['expires_at'])
            call_auth(authorize,kind,detail,context,action)
        # Resolve only fields requested by the matrix, once per exact entity.
        requests = {}
        for rule in c['owner_bindings'].values():
            entities = {r[c['entity_field']] for r in cp['rows']} if rule['mode']=='unit_times_quantity' else {context['store_entity']}
            for entity in entities:
                requests.setdefault(entity,set()).add(rule['field'])
        resolutions = {}
        # An empty cohort still validates the owner envelope with a store field.
        need(bool(requests), 'SCENARIO_NO_OWNER_REQUEST')
        for entity,fields in sorted(requests.items()):
            request = {'scope_hash':context['scope_hash'],'entity':entity,'currency':context['currency'],
                       'period':context['period'],'fields':sorted(fields)}
            prior = expected_pin.get('owner_pins',{}).get(entity) if type(expected_pin) is dict else None
            resolved = self.owner.resolve(owner_envelope,request,authorize=owner_authorize,now=now,action=action,pin=prior)
            pins['owner_pins'][entity] = resolved['pin']
            resolutions[entity] = resolved
        if expected_pin is not None:
            need(pins == expected_pin, 'SCENARIO_PIN_CHANGED')
        return cp,ep,resolutions,context,owner_envelope['payload']['expires_at'],pins

    def prepare(self, cohort, expenses, owner_envelope, context, *, authorize,
                owner_authorize, now):
        return self._collect(cohort,expenses,owner_envelope,context,authorize,owner_authorize,now,'resolve')[-1]

    def check_pin(self, pin, cohort, expenses, owner_envelope, context, *, authorize,
                  owner_authorize, now, action='read'):
        need(type(pin) is dict and pin.get('schema')=='alice-scenario-plan-pin/v1', 'SCENARIO_PIN_REQUIRED')
        self._collect(cohort,expenses,owner_envelope,context,authorize,owner_authorize,now,action,pin)
        return True

    def execute(self, pin, cohort, expenses, owner_envelope, context, *, authorize,
                owner_authorize, now):
        need(type(pin) is dict and pin.get('schema')=='alice-scenario-plan-pin/v1', 'SCENARIO_PIN_REQUIRED')
        cp,ep,resolutions,context,owner_expiry,pin = self._collect(cohort,expenses,owner_envelope,context,
                                                   authorize,owner_authorize,now,'execute',pin)
        c = self._catalog
        # All branches were validated at catalog load; all rows are validated
        # before any cost is presented. Read-time checking never evaluates math.
        for row in cp['rows']:
            need(all(expr(g,{'row':row}) is True for g in c['row_guards']), 'SCENARIO_ROW_GUARD')
        result = {'schema':'alice-scenario-calculation/v1','pin':pin,'scenarios':{},'network_calls':0,
                  'financial_report_saved':False,'production_ready':False}
        for sid,definition in c['scenarios'].items():
            policy = self._gate_catalog['policies'][definition['gate_policy']]
            gate_context = {'scope_hash':context['scope_hash'],'period':context['period'],'currency':context['currency'],
                            'mode':policy['mode'],'as_of':context['as_of'],'catalog_hash':self.hash}
            observed_at = min(cp['issued_at'],ep['issued_at'])
            expires_at = min(cp['expires_at'],ep['expires_at'],owner_expiry)
            def observation(name,value,axis,unit='currency',state='KNOWN',keys=None,receipt=None):
                return {'id':name,'state':state,'coverage':'COMPLETE','value':value,'currency':context['currency'],
                        'period':context['period'],'scope_hash':context['scope_hash'],'axis':axis,'unit':unit,
                        'source_hash':self.hash,'receipt_hash':receipt or digest(pin),'observed_at':observed_at,
                        'expires_at':expires_at,'zero_proof':state=='KNOWN' and Decimal(value)==0,
                        'expense_keys':keys or []}
            quantities, originals, revenues = [],[],[]
            lines = []
            for row in cp['rows']:
                q = expr(definition['quantity'],{'row':row})
                oq = expr(c['original_quantity'],{'row':row})
                need(0 <= numeric(q,integral=True) <= numeric(oq,integral=True), 'SCENARIO_QUANTITY')
                rev = expr(definition['revenue'],{'row':row,'quantity':q})
                numeric(rev,nonnegative=True)
                quantities.append(q);originals.append(oq);revenues.append(rev)
                lines.append({'line_hash':digest(row[c['identity_field']]),'entity':row[c['entity_field']],
                              'day':row[c['date_field']],'quantity':q,'original_quantity':oq,'owner_inputs':{}})
            summed = lambda values: expr(fn('sum_values',path('values')),{'values':values})
            total_q,total_o,total_r = summed(quantities),summed(originals),summed(revenues)
            o = c['output']
            records = [observation(o['unit_component'],total_q,'ordered_cohort','item'),
                       observation(o['original_unit_component'],total_o,'ordered_cohort','item'),
                       observation(o['revenue_component'],total_r,'ordered_cohort')]
            provenance = {}
            owner_detail = {}
            for component,rule in c['owner_bindings'].items():
                costs, missing, keys, refs = [], [], [], []
                if rule['mode']=='unit_times_quantity':
                    for row,line in zip(cp['rows'],lines):
                        resolved = resolutions[line['entity']]
                        field = resolved['fields'][rule['field']]
                        segment = next(s for s in field['segments'] if s['period']['from']<=line['day']<=s['period']['to'])
                        q = line['quantity']
                        if numeric(q)==0:
                            value='0';state='NOT_APPLICABLE';reason='ZERO_SCENARIO_QUANTITY'
                        elif segment['state']=='VALUE':
                            value=expr(fn('multiply_numbers',q,segment['value']),{});state='VALUE';reason=None
                            keys.append('owner:'+digest([context['scope_hash'],rule['field'],line['line_hash']]))
                        else:
                            value=None;state=segment['state'];reason=segment['reason']
                            missing.append({'line_hash':line['line_hash'],'quantity':q,'reason':reason})
                        line['owner_inputs'][component]={'unit_value':segment['value'],'unit':segment['unit'],
                            'quantity':q,'amount':value,'state':state,'reason':reason,'entry_id':segment['entry_id']}
                        if value is not None:costs.append(value)
                        refs.append(resolved['resolution_sha256'])
                    state='NOT_PROVIDED' if missing else 'KNOWN'
                    value=None if missing else summed(costs)
                    details={'known_amount':summed(costs),'missing_lines':missing,'omission_label':self.owner.catalog['fields'][rule['field']]['omission_label']}
                else:
                    resolved=resolutions[context['store_entity']]
                    field=resolved['fields'][rule['field']];segment=field['segments'][0]
                    need(len(field['segments'])==1 and segment['period']==context['period'], 'SCENARIO_PERIOD_BINDING')
                    value=segment['value']
                    state={'VALUE':'KNOWN','EXCLUDED_BY_OWNER':'EXCLUDED_BY_USER','NOT_PROVIDED':'NOT_PROVIDED'}[segment['state']]
                    if state=='KNOWN':keys=['owner:'+digest([context['scope_hash'],rule['field'],context['period']])]
                    refs=[resolved['resolution_sha256']]
                    details={'known_amount':value,'reason':segment['reason'],'omission_label':field['omission_label']}
                if state!='KNOWN':keys=[]
                rec=observation(component,value,rule['axis'],state=state,keys=keys,receipt=digest(sorted(set(refs))))
                records.append(rec);owner_detail[component]=details;provenance[component]={'basis':'USER_INPUT','label':rule['label']}
            for supplied in ep['scenarios'][sid]:
                records.append(deepcopy(supplied['observation']))
                provenance[supplied['observation']['id']]={'basis':supplied['basis'],'allocation':deepcopy(supplied['allocation']),
                                                       'label':c['sources'][supplied['observation']['id']]['label']}
            # Safe only because _collect has freshly attested BOTH envelopes and
            # every owner resolution. This verifier is not exposed as a trust shortcut.
            allowed = {digest(x) for x in records}
            checked = self.gate.evaluate(definition['gate_policy'],gate_context,records,
                         verify=lambda record,ctx: ctx==gate_context and digest(record) in allowed, now=now)
            entry={'label':definition['label'],'eligibility':checked,'unit_label':definition['unit_label'],
                   'original_unit_label':definition['original_unit_label'],'owner_details':owner_detail,
                   'line_inputs':lines,'rows':[],'subtotal':None,'net_profit':None}
            if checked['usable']:
                values=checked['values']
                need(all(expr(g,{'source':values,'context':context}) is True for g in definition['source_guards']), 'SCENARIO_SOURCE_GUARD')
                included_costs=[name for name in o['cost_components'] if name in values]
                total_cost=summed([values[name] for name in included_costs])
                subtotal=expr(fn('add_numbers',values[o['revenue_component']],fn('negate',total_cost)),{})
                def output_row(name,value,source):
                    per=expr(fn('divide_or_null',value,total_q),{})
                    original=expr(fn('divide_or_null',value,total_o),{})
                    ratio=expr(fn('divide_or_null',value,total_r),{})
                    percent=None if ratio is None else expr(fn('multiply_numbers',ratio,'100'),{})
                    return {'component':name,'total':value,'per_scenario_unit':per,'per_original_unit':original,
                            'percent_of_scenario_seller_value':percent,'provenance':source,
                            'unit_denominator':total_q,'original_unit_denominator':total_o,'seller_value_denominator':total_r,
                            'undefined_ratios':{'scenario_unit':numeric(total_q)==0,'original_unit':numeric(total_o)==0,'seller_value':numeric(total_r)==0}}
                entry['rows']=[output_row(name,values[name],provenance.get(name,{'basis':'ORDER_PRICE_SCENARIO'}))
                               for name in [o['revenue_component']]+included_costs]
                entry['subtotal']=output_row('included_components_subtotal',subtotal,{'basis':'MIXED_SCENARIO_SUBTOTAL',
                    'label':'Сценарный остаток после перечисленных затрат; пропуски указаны отдельно, это не чистая прибыль.'})
            result['scenarios'][sid]=entry
        result['status']='CALCULATED' if all(s['eligibility']['usable'] for s in result['scenarios'].values()) else 'BLOCKED'
        # If any scenario cannot be completed, do not publish the other as a
        # complete two-scenario report. Diagnostic eligibility remains available.
        if result['status']=='BLOCKED':
            for entry in result['scenarios'].values():entry['rows']=[];entry['subtotal']=None
        return {**result,'result_sha256':digest(result)}
