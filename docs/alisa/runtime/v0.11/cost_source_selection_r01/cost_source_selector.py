"""Bounded selection over qualified source observations; no HTTP, SQL or issuer.

SourceMatrix remains responsible for API shape/pagination. This layer does not
invent absent charges or signs. All scope and provenance claims require an
injected trusted verifier. A successful selection is not a saved voice report.
"""
from __future__ import annotations
from copy import deepcopy
from datetime import date, datetime, timezone
from decimal import Decimal, localcontext
import hashlib
import json
import re
from pathlib import Path
from typing import Any, Callable

import matrix_core
from matrix_core import evaluate, validate_expression, MatrixError

BASES = ('ACTUAL_MATCHED', 'API_TARIFF_ESTIMATE', 'OFFICIAL_TARIFF_ESTIMATE')
SUFFIX = {'ACTUAL_MATCHED': 'actual', 'API_TARIFF_ESTIMATE': 'api_estimate',
          'OFFICIAL_TARIFF_ESTIMATE': 'official_estimate'}
NAME = re.compile(r'[a-z][a-z0-9_]{0,59}\Z')
ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}\Z')
HEX = re.compile(r'[a-f0-9]{64}\Z')

class SelectionError(ValueError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)

def need(ok: Any, code='SELECTION_SCHEMA') -> None:
    if not ok:
        raise SelectionError(code)

def canonical(value: Any) -> bytes:
    try:
        raw = json.dumps(value, ensure_ascii=False, sort_keys=True,
                         separators=(',', ':'), allow_nan=False).encode()
    except (ValueError, TypeError, RecursionError):
        raise SelectionError('SELECTION_JSON') from None
    need(len(raw) <= 1_048_576, 'SELECTION_CAPACITY')
    return raw

def digest(value: Any) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()

def clone(value: Any) -> Any:
    return json.loads(canonical(value))

def exact(value, keys, code='SELECTION_SCHEMA'):
    need(type(value) is dict and set(value) == set(keys), code)

def day(value):
    need(type(value) is str and len(value) == 10, 'SELECTION_DATE')
    try:
        need(date.fromisoformat(value).isoformat() == value, 'SELECTION_DATE')
    except ValueError:
        raise SelectionError('SELECTION_DATE') from None
    return value

def number(value, integral=False):
    need(type(value) is str and len(value) <= 70 and
         re.fullmatch(r'-?\d{1,19}(?:\.\d{1,32})?', value), 'SELECTION_NUMBER')
    n = Decimal(value)
    need(abs(n) <= Decimal('1e18'), 'SELECTION_NUMBER')
    need(not integral or n == n.to_integral_value(), 'SELECTION_QUANTITY')
    return n

def text(n: Decimal) -> str:
    need(n.is_finite() and abs(n) <= Decimal('1e18'), 'SELECTION_NUMBER')
    # Coefficients are calculated only from bounded numbers inside local precision.
    s = format(n, 'f')
    need(len(s) <= 100, 'SELECTION_NUMBER')
    return s

def auth(verifier, kind, value, context, action):
    need(callable(verifier), 'SELECTION_AUTH_REQUIRED')
    try:
        result = verifier(kind, deepcopy(value), deepcopy(context), action)
    except Exception:
        raise SelectionError('SELECTION_AUTH_UNAVAILABLE') from None
    need(result is True, 'SELECTION_AUTH_DENIED')

class CostSourceSelector:
    def __init__(self, catalog: dict):
        c = clone(catalog)
        exact(c, {'schema','version','max_rows','max_candidates','max_age_seconds',
                  'line_id_field','components','scenarios'})
        need(c['schema'] == 'alice-cost-source-selection/v1')
        need(type(c['version']) is str and ID.fullmatch(c['version']))
        for key, upper in [('max_rows',2000),('max_candidates',20000),('max_age_seconds',86400)]:
            need(type(c[key]) is int and 1 <= c[key] <= upper)
        need(type(c['line_id_field']) is str and NAME.fullmatch(c['line_id_field']))
        need(type(c['components']) is dict and 1 <= len(c['components']) <= 8)
        for name, rule in c['components'].items():
            need(type(name) is str and NAME.fullmatch(name))
            exact(rule, {'priority','methods','allow_negative_actual','percent_base'})
            need(type(rule['priority']) is list and all(type(b) is str for b in rule['priority']))
            need(rule['priority'] == [x for x in BASES if x in rule['priority']]
                 and rule['priority'] and len(set(rule['priority'])) == len(rule['priority']))
            exact(rule['methods'], rule['priority'])
            need(type(rule['allow_negative_actual']) is bool)
            try: validate_expression(rule['percent_base'], {'row'})
            except MatrixError: raise SelectionError('SELECTION_EXPRESSION') from None
            for basis, methods in rule['methods'].items():
                need(type(methods) is list and methods and len(methods) == len(set(methods)))
                need(set(methods) <= {'line_amount','unit_amount','explicit_percent','interval_unit_amount'})
                need(basis != 'ACTUAL_MATCHED' or methods == ['line_amount'])
        need(type(c['scenarios']) is dict and 1 <= len(c['scenarios']) <= 8)
        for sid, rules in c['scenarios'].items():
            need(type(sid) is str and NAME.fullmatch(sid))
            exact(rules, c['components'])
            for tree in rules.values():
                try: validate_expression(tree, {'row'})
                except MatrixError: raise SelectionError('SELECTION_EXPRESSION') from None
        self._catalog = c
        self.hash = digest(c)
        self.code_hash = digest({'selector':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                                 'matrix':hashlib.sha256(Path(matrix_core.__file__).read_bytes()).hexdigest()})

    @property
    def catalog(self):
        return deepcopy(self._catalog)

    def _inputs(self, cohort, evidence, context, verify, now, action):
        c = self._catalog
        cohort,evidence,context = clone(cohort),clone(evidence),clone(context)
        exact(context, {'scope_hash','store_entity','currency','period','as_of'})
        need(type(context['scope_hash']) is str and HEX.fullmatch(context['scope_hash']), 'SELECTION_SCOPE')
        need(type(context['store_entity']) is str and ID.fullmatch(context['store_entity']), 'SELECTION_SCOPE')
        need(type(context['currency']) is str and re.fullmatch('[A-Z]{3}',context['currency']), 'SELECTION_CURRENCY')
        exact(context['period'], {'from','to'});a,b=map(day,[context['period']['from'],context['period']['to']]);need(a<=b,'SELECTION_PERIOD')
        need(type(now) is int and type(context['as_of']) is int and 0<=context['as_of']<=now,'SELECTION_TIME')
        for envelope, schema, extra in [(cohort,'alice-qualified-cohort/v1',{'coverage','rows'}),
                                        (evidence,'alice-cost-candidates/v1',{'cohort_hash','records'})]:
            exact(envelope, {'payload','sha256'});payload=envelope['payload']
            need(envelope['sha256']==digest(payload), 'SELECTION_HASH')
            exact(payload, {'schema','revision','scope_hash','store_entity','currency','period',
                            'issued_at','expires_at','normalization_hash'}|extra)
            need(payload['schema']==schema,'SELECTION_SCHEMA')
            for key in ('scope_hash','store_entity','currency','period'):
                need(payload[key]==context[key],'SELECTION_SCOPE')
            need(type(payload['normalization_hash']) is str and HEX.fullmatch(payload['normalization_hash']),'SELECTION_HASH')
            need(type(payload['revision']) is str and ID.fullmatch(payload['revision']),'SELECTION_REVISION')
            start,end=payload['issued_at'],payload['expires_at']
            need(type(start)is int and type(end)is int and context['as_of']<=start<=now<end
                 and 0<end-start<=c['max_age_seconds'],'SELECTION_EXPIRED')
        cp,ep=cohort['payload'],evidence['payload']
        need(cp['coverage']=='COMPLETE','SELECTION_COHORT_INCOMPLETE')
        need(ep['cohort_hash']==cohort['sha256'],'SELECTION_SCOPE')
        need(type(cp['rows'])is list and 0<len(cp['rows'])<=c['max_rows'],'SELECTION_CAPACITY')
        rows={}
        for row in cp['rows']:
            need(type(row)is dict and c['line_id_field'] in row,'SELECTION_ROW')
            key=row[c['line_id_field']];need(type(key)is str and ID.fullmatch(key),'SELECTION_ROW')
            need(key not in rows,'SELECTION_DUPLICATE_LINE');rows[key]=row
        need(type(ep['records'])is list and len(ep['records'])<=c['max_candidates'],'SELECTION_CAPACITY')
        candidates={};ids=set()
        for r in ep['records']:
            exact(r, {'id','scenario','component','line_id','basis','state','method','values','covered_units',
                      'currency','source_hash','receipt_hash','observed_at','expires_at','zero_proof',
                      'expense_keys','effective_on'})
            need(type(r['id'])is str and ID.fullmatch(r['id']) and r['id']not in ids,'SELECTION_DUPLICATE_CANDIDATE');ids.add(r['id'])
            need(all(type(r[x]) is str for x in ('scenario','component','line_id','basis','state')),'SELECTION_TARGET')
            need(r['scenario'] in c['scenarios'] and r['component'] in c['components'] and r['line_id'] in rows,'SELECTION_TARGET')
            rule=c['components'][r['component']]
            need(r['basis'] in rule['priority'],'SELECTION_BASIS')
            need(r['currency']==context['currency'],'SELECTION_CURRENCY')
            need(all(type(r[x])is str and HEX.fullmatch(r[x]) for x in ('source_hash','receipt_hash')),'SELECTION_HASH')
            start,end=r['observed_at'],r['expires_at']
            need(type(start)is int and type(end)is int and context['as_of']<=start<=now<end
                 and 0<end-start<=c['max_age_seconds'],'SELECTION_EXPIRED')
            need(type(r['zero_proof'])is bool and type(r['expense_keys'])is list and
                 len(r['expense_keys'])<=1000 and all(type(k)is str and ID.fullmatch(k) for k in r['expense_keys'])
                 and len(r['expense_keys'])==len(set(r['expense_keys'])),'SELECTION_EXPENSE_KEYS')
            if r['state']=='UNAVAILABLE':
                need(r['values'] is None and r['method'] is None and r['covered_units'] is None
                     and r['effective_on'] is None and not r['zero_proof'] and not r['expense_keys'],'SELECTION_MISSING_NOT_ZERO')
            else:
                need(r['state']=='COMPLETE','SELECTION_COVERAGE')
                need(type(r['method']) is str and r['method'] in rule['methods'][r['basis']],'SELECTION_METHOD')
                need(number(r['covered_units'],True)>=0,'SELECTION_QUANTITY')
                shapes={'line_amount':{'amount'},'unit_amount':{'amount'},'explicit_percent':{'percent'},'interval_unit_amount':{'minimum','maximum'}}
                exact(r['values'],shapes[r['method']],'SELECTION_VALUE')
                vals=[number(x) for x in r['values'].values()]
                need(r['basis']=='ACTUAL_MATCHED' and rule['allow_negative_actual'] or all(x>=0 for x in vals),'SELECTION_NEGATIVE')
                if r['method']=='interval_unit_amount':need(number(r['values']['minimum'])<=number(r['values']['maximum']),'SELECTION_INTERVAL')
                if r['method']=='explicit_percent':need(number(r['values']['percent'])<=100,'SELECTION_PERCENT')
                if r['basis']=='ACTUAL_MATCHED':need(r['effective_on'] is None,'SELECTION_TARIFF_DATE')
                else:
                    day(r['effective_on'])
                    need(r['effective_on'] <= datetime.fromtimestamp(now,timezone.utc).date().isoformat(),'SELECTION_TARIFF_DATE')
            key=(r['scenario'],r['component'],r['line_id'],r['basis'])
            need(key not in candidates,'SELECTION_AMBIGUOUS_SOURCE');candidates[key]=r
        for kind,value in [('policy',{'hash':self.hash,'code_hash':self.code_hash}),('cohort',cohort),('candidates',evidence)]:
            auth(verify,kind,value,context,action)
        pin={'schema':'alice-cost-selection-pin/v1','policy_hash':self.hash,'code_hash':self.code_hash,
             'cohort_hash':cohort['sha256'],'evidence_hash':evidence['sha256'],'context_hash':digest(context)}
        return rows,candidates,context,pin

    def check_pin(self,pin,cohort,evidence,context,*,verify,now,action='read'):
        need(action in ('read','execute'),'SELECTION_ACTION')
        actual=self._inputs(cohort,evidence,context,verify,now,action)[-1]
        need(pin==actual,'SELECTION_PIN_CHANGED')
        return True

    def select(self,cohort,evidence,context,*,verify:Callable|None,now:int,pin=None):
        rows,candidates,context,actual_pin=self._inputs(cohort,evidence,context,verify,now,'execute')
        if pin is not None:need(pin==actual_pin,'SELECTION_PIN_CHANGED')
        c=self._catalog;results={};gaps=[]
        with localcontext() as precision:
            precision.prec=200
            for sid,rules in c['scenarios'].items():
                selected=[];used=set()
                for component,rule in c['components'].items():
                    for line_id,row in rows.items():
                        try:q=number(evaluate(rules[component],{'row':row}),True)
                        except MatrixError as exc:raise SelectionError(exc.code) from None
                        need(q>=0,'SELECTION_QUANTITY')
                        if q==0:
                            need(not any(candidates.get((sid,component,line_id,b),{}).get('state')=='COMPLETE' for b in rule['priority']),'SELECTION_NOT_APPLICABLE_CONFLICT')
                            selected.append({'component':component,'line_id':line_id,'basis':None,'amount':'0',
                                             'reason':'NOT_APPLICABLE_IN_SCENARIO','candidate_id':None,'expense_keys':[]})
                            continue
                        chosen=None
                        for basis in rule['priority']:
                            r=candidates.get((sid,component,line_id,basis))
                            if r is None:break  # Missing evidence is not an attested unavailable source.
                            if r['state']=='UNAVAILABLE':continue
                            need(number(r['covered_units'],True)==q,'SELECTION_QUANTITY_MISMATCH')
                            chosen=r;break
                        if chosen is None:
                            gaps.append({'scenario':sid,'component':component,'line_id':line_id,'code':'QUALIFIED_COST_SOURCE_MISSING'});continue
                        r=chosen;v=r['values'];method=r['method']
                        if method=='line_amount':n=number(v['amount'])
                        elif method=='unit_amount':n=number(v['amount'])*q
                        elif method=='interval_unit_amount':n=(number(v['minimum'])+number(v['maximum']))/2*q
                        else:
                            # Explicit base is normalized by the cohort source, never inferred from a ratio.
                            try: price = number(evaluate(rule['percent_base'], {'row': row}))
                            except MatrixError: raise SelectionError('SELECTION_PERCENT_BASE') from None
                            need(price >= 0, 'SELECTION_PERCENT_BASE')
                            n=number(v['percent'])/100*price*q
                        need(n!=0 or r['zero_proof'],'SELECTION_ZERO_UNPROVEN')
                        need(n==0 or r['expense_keys'],'SELECTION_EXPENSE_KEYS')
                        need(not used.intersection(r['expense_keys']),'SELECTION_DOUBLE_COUNT');used.update(r['expense_keys'])
                        selected.append({'component':component,'line_id':line_id,'basis':r['basis'],'amount':text(n),
                                         'reason':'QUALIFIED_SOURCE_SELECTED','candidate_id':r['id'],'expense_keys':r['expense_keys']})
                groups={}
                for component,rule in c['components'].items():
                    for basis in rule['priority']:
                        subset=[r for r in selected if r['component']==component and r['basis']==basis]
                        groups[component+'_'+SUFFIX[basis]]={'component':component,'basis':basis,
                            'value':text(sum((number(x['amount'])for x in subset),Decimal(0))),
                            'expense_keys':[k for r in subset for k in r['expense_keys']],
                            'candidate_ids':[r['candidate_id']for r in subset]}
                results[sid]={'lines':selected,'components':groups}
        return {'schema':'alice-cost-selection/v1','status':'SELECTED' if not gaps else 'BLOCKED','pin':actual_pin,
                'scenarios':results if not gaps else {},'gaps':gaps,'production_ready':False,
                'financial_report_saved':False,'network_calls':0}
