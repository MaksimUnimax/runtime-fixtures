"""Data-defined completeness/nonoverlap gate for composed reports.
No financial formulas, provider clients, database writes or implicit approvals.
A trusted in-process verifier must bind observations to their provenance. JSON
fields are claims, not authorization. Output is eligibility, never a saved report.
"""
from __future__ import annotations
from copy import deepcopy
from datetime import date
from decimal import Decimal,InvalidOperation
import hashlib,json,math,re
from typing import Callable
HEX=re.compile(r'[a-f0-9]{64}\Z')
ID=re.compile(r'[a-z][a-z0-9_]{0,79}\Z')

class ContractError(ValueError):
    def __init__(self,code):self.code=code;super().__init__(code)

def need(ok,code='REPORT_CONTRACT_SCHEMA'):
    if not ok:raise ContractError(code)

def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode()).hexdigest()

def timestamp(v):return type(v) in (int,float) and math.isfinite(v)

def period(p):
    need(type(p)is dict and set(p)=={'from','to'},'REPORT_SCOPE_MISMATCH')
    for v in p.values():
        need(type(v)is str and len(v)==10,'REPORT_SCOPE_MISMATCH')
        try:need(date.fromisoformat(v).isoformat()==v,'REPORT_SCOPE_MISMATCH')
        except ValueError:raise ContractError('REPORT_SCOPE_MISMATCH') from None
    need(p['from']<=p['to'],'REPORT_SCOPE_MISMATCH')

def number(v):
    need(type(v)is str and len(v)<=80 and re.fullmatch(r'-?\d{1,30}(?:\.\d{1,18})?',v) is not None,'REPORT_VALUE_INVALID')
    try:d=Decimal(v)
    except InvalidOperation:raise ContractError('REPORT_VALUE_INVALID') from None
    need(d.is_finite(),'REPORT_VALUE_INVALID');return d

class ReportContracts:
    def __init__(self,definition):
        try:
            need(type(definition)is dict and set(definition)=={'schema','version','policies'})
            need(definition['schema']=='alice-report-contracts/v1' and type(definition['version'])is str)
            need(type(definition['policies'])is dict and 1<=len(definition['policies'])<=64)
            need(len(json.dumps(definition,ensure_ascii=False,allow_nan=False).encode())<=262144)
            for key,p in definition['policies'].items():
                need(type(key)is str and ID.fullmatch(key) is not None)
                need(type(p)is dict and set(p)=={'mode','label','components','nonoverlap','required_controls','missing_inputs_label'})
                need(type(p['mode'])is str and 1<=len(p['mode'])<=100)
                for field in ('label','missing_inputs_label'):
                    need(type(p[field])is str and 1<=len(p[field])<=400 and not any(ord(x)<32 for x in p[field]))
                need(type(p['nonoverlap'])is bool and type(p['components'])is dict and 1<=len(p['components'])<=64)
                for cid,c in p['components'].items():
                    need(type(cid)is str and ID.fullmatch(cid) is not None)
                    need(type(c)is dict and set(c)=={'required','role','axes','unit','allow_negative','missing_label','allow_user_exclusion','require_expense_keys'})
                    need(all(type(c[x])is bool for x in ('required','allow_negative','allow_user_exclusion','require_expense_keys')))
                    need(c['role'] in ('base','contribution','control','input'))
                    need(type(c['axes'])is list and 1<=len(c['axes'])<=8 and len(c['axes'])==len(set(c['axes'])))
                    need(all(type(x)is str and 1<=len(x)<=80 for x in c['axes']))
                    need(c['unit'] in ('currency','item','ratio','count'))
                    need(type(c['missing_label'])is str and len(c['missing_label'])<=300)
                    need(not c['required'] or not c['allow_user_exclusion'])
                need(type(p['required_controls'])is list and len(p['required_controls'])==len(set(p['required_controls'])))
                need(all(x in p['components'] and p['components'][x]['role']=='control' and p['components'][x]['required'] for x in p['required_controls']))
        except ContractError:raise
        except (TypeError,KeyError,ValueError,RecursionError):raise ContractError('REPORT_CONTRACT_SCHEMA') from None
        self._definition=deepcopy(definition);self.hash=digest(definition)

    @property
    def definition(self):return deepcopy(self._definition)

    def evaluate(self,policy_id,context,observations,*,verify:Callable|None,now):
        """No evaluator can convert a missing required observation into zero.
        verify(record, context) must freshly attest exact source/store/coverage.
        User-specified omissions have no numeric value; known zero needs proof.
        """
        need(policy_id in self._definition['policies'],'REPORT_CONTRACT_UNKNOWN')
        p=deepcopy(self._definition['policies'][policy_id])
        need(type(context)is dict and set(context)=={'scope_hash','period','currency','mode','as_of','catalog_hash'},'REPORT_SCOPE_MISMATCH')
        need(all(type(context[x])is str and HEX.fullmatch(context[x]) for x in ('scope_hash','catalog_hash')),'REPORT_SCOPE_MISMATCH')
        period(context['period']);need(type(context['currency'])is str and re.fullmatch(r'[A-Z]{3}',context['currency']),'REPORT_SCOPE_MISMATCH')
        need(context['mode']==p['mode'] and timestamp(now) and timestamp(context['as_of']) and context['as_of']<=now,'REPORT_SCOPE_MISMATCH')
        need(type(observations)is list and len(observations)<=64,'REPORT_OBSERVATIONS_SCHEMA')
        index={}
        for observation in observations:
            need(type(observation)is dict and set(observation)=={'id','state','coverage','value','currency','period','scope_hash','axis','unit','source_hash','receipt_hash','observed_at','expires_at','zero_proof','expense_keys'},'REPORT_OBSERVATIONS_SCHEMA')
            cid=observation['id']
            need(type(cid)is str and cid in p['components'],'REPORT_OBSERVATION_UNKNOWN')
            need(cid not in index,'REPORT_OBSERVATION_DUPLICATE');index[cid]=deepcopy(observation)
        reasons=[];omitted=[];values={};controls=[];included=[];expense_keys={}
        def blocked(cid,code):reasons.append({'component':cid,'reason_code':code})
        for cid,rule in p['components'].items():
            row=index.get(cid)
            if row is None:
                if rule['required']:blocked(cid,'REPORT_REQUIRED_COMPONENT_MISSING')
                else:omitted.append({'component':cid,'label':rule['missing_label'],'state':'NOT_PROVIDED'})
                continue
            state=row['state']
            need(state in ('KNOWN','UNKNOWN','NOT_PROVIDED','EXCLUDED_BY_USER'),'REPORT_OBSERVATIONS_SCHEMA')
            if state!='KNOWN':
                need(row['value'] is None and row['zero_proof'] is False and row['expense_keys']==[],'REPORT_MISSING_NOT_ZERO')
                if rule['required']:blocked(cid,'REPORT_REQUIRED_COMPONENT_MISSING')
                elif state=='EXCLUDED_BY_USER':
                    if not rule['allow_user_exclusion']:blocked(cid,'REPORT_USER_EXCLUSION_FORBIDDEN');continue
                    if verify is None:blocked(cid,'REPORT_EVIDENCE_VERIFIER_REQUIRED');continue
                    try:confirmed=verify(deepcopy(row),deepcopy(context))
                    except Exception:blocked(cid,'DEPENDENCY_UNAVAILABLE');continue
                    if confirmed is not True:blocked(cid,'REPORT_EVIDENCE_UNTRUSTED');continue
                    omitted.append({'component':cid,'label':rule['missing_label'],'state':state})
                else:omitted.append({'component':cid,'label':rule['missing_label'],'state':state})
                continue
            if row['coverage']!='COMPLETE':blocked(cid,'REPORT_COVERAGE_INCOMPLETE');continue
            if (row['scope_hash']!=context['scope_hash'] or row['period']!=context['period'] or row['currency']!=context['currency'] or row['axis'] not in rule['axes'] or row['unit']!=rule['unit']):blocked(cid,'REPORT_SCOPE_MISMATCH');continue
            if not (timestamp(row['observed_at']) and timestamp(row['expires_at']) and context['as_of']<=row['observed_at']<=now<row['expires_at']):blocked(cid,'REPORT_EVIDENCE_EXPIRED');continue
            if not all(type(row[x])is str and HEX.fullmatch(row[x]) for x in ('source_hash','receipt_hash')):blocked(cid,'REPORT_EVIDENCE_INVALID');continue
            try:value=number(row['value'])
            except ContractError as exc:blocked(cid,exc.code);continue
            if value<0 and not rule['allow_negative']:blocked(cid,'REPORT_VALUE_INVALID');continue
            if rule['unit'] in ('item','count') and value!=value.to_integral_value():blocked(cid,'REPORT_VALUE_INVALID');continue
            if type(row['zero_proof'])is not bool or value==0 and row['zero_proof'] is not True:blocked(cid,'REPORT_ZERO_UNPROVEN');continue
            keys=row['expense_keys']
            if type(keys)is not list or len(keys)>20000 or any(type(x)is not str or not 1<=len(x)<=160 for x in keys) or len(keys)!=len(set(keys)):blocked(cid,'REPORT_EXPENSE_KEYS');continue
            if rule['require_expense_keys'] and value!=0 and not keys:blocked(cid,'REPORT_OVERLAP_UNRESOLVED');continue
            if verify is None:blocked(cid,'REPORT_EVIDENCE_VERIFIER_REQUIRED');continue
            try:verified=verify(deepcopy(row),deepcopy(context))
            except Exception:blocked(cid,'DEPENDENCY_UNAVAILABLE');continue
            if verified is not True:blocked(cid,'REPORT_EVIDENCE_UNTRUSTED');continue
            if rule['role']=='control':
                # An attested control may reuse contributing charge IDs; never add its value.
                controls.append(cid);continue
            if p['nonoverlap'] and rule['role']=='contribution':
                if any(k in expense_keys for k in keys):blocked(cid,'REPORT_OVERLAP_UNRESOLVED');continue
                for k in keys:expense_keys[k]=cid
            values[cid]=row['value'];included.append(cid)
        for cid in p['required_controls']:
            if cid not in controls and not any(x['component']==cid for x in reasons):blocked(cid,'REPORT_REQUIRED_COMPONENT_MISSING')
        allowed=not reasons
        return {'schema':'alice-report-eligibility/v1','policy_id':policy_id,'contract_hash':self.hash,
                'status':'READY_FOR_CALCULATION' if allowed else 'BLOCKED','usable':allowed,
                'mode':p['mode'],'label':p['label'],'scope_hash':context['scope_hash'],
                'values':values if allowed else {},'included':included if allowed else [],
                'controls':controls,'omissions':omitted,'omission_label':p['missing_inputs_label'] if omitted else None,
                'reasons':reasons,'network_calls':0,'report_saved':False}
