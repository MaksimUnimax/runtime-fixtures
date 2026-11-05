"""Matrix-only split of homogeneous cost bases into the existing scenario layer.
No provider access; live use still requires attestation of the produced envelope.
"""
from copy import deepcopy
from cost_source_selector import digest,need,clone,auth,CostSourceSelector,SUFFIX
from pathlib import Path
import hashlib

def expand_catalogs(scenario_catalog,gate_catalog,selection_catalog):
    c,g=deepcopy(scenario_catalog),deepcopy(gate_catalog)
    names={name:[name+'_'+SUFFIX[b] for b in rule['priority']]
           for name,rule in selection_catalog['components'].items()}
    generated=[value for values in names.values()for value in values]
    need(len(generated)==len(set(generated)) and not (set(generated)&(set(c['sources'])-set(names))),'SELECTION_COMPONENT_COLLISION')
    need(set(names)<=set(c['sources']),'SELECTION_COMPONENT_MISSING')
    for name,split in names.items():
        source=c['sources'].pop(name)
        for basis,newname in zip(selection_catalog['components'][name]['priority'],split):
            c['sources'][newname]={'label':source['label']+' / '+basis,'bases':[basis]}
    c['output']['cost_components']=[new for old in c['output']['cost_components']
                                  for new in names.get(old,[old])]
    def rewrite(x):
        if isinstance(x,dict):
            if set(x)=={'$path'} and len(x['$path'])==2 and x['$path'][0]=='source' and x['$path'][1] in names:
                return {'$fn':['sum_values',[{'$path':['source',n]} for n in names[x['$path'][1]]]]}
            return {k:rewrite(v) for k,v in x.items()}
        if isinstance(x,list):return [rewrite(v) for v in x]
        return x
    for scenario in c['scenarios'].values():scenario['source_guards']=rewrite(scenario['source_guards'])
    for policy in g['policies'].values():
        for name,split in names.items():
            original=policy['components'].pop(name)
            for newname in split:policy['components'][newname]=deepcopy(original)
    c['version']='20261105-selector-bound-r1';g['version']='20261105-selector-bound-r1'
    return c,g

def expense_envelope(selection,evidence,cohort,context,retained_expenses,*,selector=None,verify=None,now=None):
    # This execute-time boundary never treats caller-supplied totals as proof.
    need(isinstance(selector,CostSourceSelector),'SELECTION_VERIFIER_REQUIRED')
    selection,evidence,cohort,context,retained_expenses=map(clone,(selection,evidence,cohort,context,retained_expenses))
    need(type(selection)is dict and type(selection.get('pin'))is dict,'SELECTION_RESULT_MISMATCH')
    expected=selector.select(cohort,evidence,context,verify=verify,now=now,pin=selection['pin'])
    need(selection==expected,'SELECTION_RESULT_MISMATCH')
    auth(verify,'retained_expenses',retained_expenses,context,'execute')
    need(selection['status']=='SELECTED' and selection['pin']['evidence_hash']==evidence['sha256']
         and selection['pin']['cohort_hash']==cohort['sha256']
         and selection['pin']['context_hash']==digest(context),'SELECTION_PIN_CHANGED')
    need(evidence['sha256']==digest(evidence['payload']) and cohort['sha256']==digest(cohort['payload']),'SELECTION_HASH')
    ep=evidence['payload'];cp=cohort['payload'];old=retained_expenses['payload']
    need(retained_expenses['sha256']==digest(old),'SELECTION_HASH')
    for k in ('scope_hash','currency','store_entity','period'):need(old[k]==context[k],'SELECTION_SCOPE')
    out={k:deepcopy(ep[k]) for k in ('revision','scope_hash','store_entity','currency','period')}
    out.update(schema='alice-scenario-expenses/v1',issued_at=min(ep['issued_at'],cp['issued_at'],old['issued_at']),
               expires_at=min(ep['expires_at'],cp['expires_at'],old['expires_at']),
               normalization_hash=digest({'selection':selection,'retained_expenses_hash':retained_expenses['sha256'],'adapter_hash':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}),scenarios={})
    records={r['id']:r for r in ep['records']}
    for sid,selected in selection['scenarios'].items():
        replaced={v['component'] for v in selected['components'].values()}
        keep=[deepcopy(r) for r in old['scenarios'][sid] if r['observation']['id']not in replaced]
        for name,part in selected['components'].items():
            used=[records[cid] for cid in part['candidate_ids']]
            expiry=min([out['expires_at']]+[r['expires_at']for r in used])
            observed=min([out['issued_at']]+[r['observed_at']for r in used])
            receipt=digest({'selection_pin':selection['pin'],'component':name,'records':used})
            observation={'id':name,'state':'KNOWN','coverage':'COMPLETE','value':part['value'],
              'currency':context['currency'],'period':deepcopy(context['period']),'scope_hash':context['scope_hash'],
              'axis':'scenario_cost','unit':'currency','source_hash':selection['pin']['policy_hash'],
              'receipt_hash':receipt,'observed_at':observed,'expires_at':expiry,
              'zero_proof':__import__('decimal').Decimal(part['value'])==0,'expense_keys':part['expense_keys']}
            keep.append({'observation':observation,'basis':part['basis'],'allocation':None})
        out['scenarios'][sid]=keep
    return {'payload':out,'sha256':digest(out)}
