"""Speech-free acquisition recipes compiled into existing qualified handlers.

There is no model-supplied operation/URL/SQL/Python. Formula/source arithmetic,
source qualification, currency and date semantics remain in existing compilers.
"""
from pathlib import Path
from dataclasses import asdict
from copy import deepcopy
from datetime import date
import json,hashlib
from semantics import Rejected,Scope,Store,canonical_json,fingerprint,strict_json
from query_program import make_composed_plan
ROOT=Path(__file__).parent
CATALOG=strict_json((ROOT/'template_catalog.json').read_text())
TEMPLATES=CATALOG['templates']
HASH=fingerprint({'catalog':CATALOG,'source_pins':{n:hashlib.sha256((ROOT/n).read_bytes()).hexdigest()for n in ['scalar_catalog.json','scalar_source_catalog.json','dataset_queries.json','dataset_sources.json','source_matrix.json','table_catalog.json','expression_catalog.json','registry.json']}})
MODE=CATALOG['mode']['name'];TEXT=CATALOG['mode']['unsupported_text'];CODE=CATALOG['mode']['unsupported_code']
INPUT_CONTRACT={'period':{'type':'object_or_null','fields':['from','to'],'format':'YYYY-MM-DD','null_only_for_snapshot_or_information':True},'comparison':{'type':'object_or_null','default':None},'filters':{'type':'object','default':{}},'group_by':{'type':'string','enum':['marketplace','total'],'default':'marketplace','null_allowed':False,'meaning':'marketplace — каждый магазин отдельно; total — явно запрошенный совместимый итог'}}

class TemplateGap(Rejected):
    def __init__(self,reason,details=None):
        super().__init__(CODE,TEXT);self.reason=reason;self.details=details or{}

def need(ok,reason,details=None):
    if not ok:raise TemplateGap(reason,details)

def validate_catalog():
    forbidden={'phrase','phrases','voice','voice_question','utterance','answer_prompt','answer_extra_instruction','tts','regex','credentials','authorization'}
    def walk(x):
        if type(x)is dict:
            if set(x)&forbidden:raise ValueError('SPEECH_OR_SECRET_IN_TEMPLATE')
            for v in x.values():walk(v)
        elif type(x)is list:
            for v in x:walk(v)
    walk(TEMPLATES)
    if CATALOG['schema']!='alisa-template-catalog/v1'or not CATALOG['mode']['temporary']or CATALOG['mode']['universal_fallback']:raise ValueError('TEMPLATE_MODE')
    visiting=set();done=set()
    def visit(tid):
        if tid in visiting:raise ValueError('TEMPLATE_CYCLE')
        if tid in done:return
        t=TEMPLATES[tid]
        if t['id']!=tid or type(t['version'])is not int or not t['purpose']or not t['steps']:raise ValueError('TEMPLATE_SCHEMA')
        visiting.add(tid)
        for step in t['steps']:
            if 'template'in step:
                if set(step)!={'id','template'}or step['template']not in TEMPLATES:raise ValueError('TEMPLATE_DEPENDENCY')
                visit(step['template'])
            elif not all(k in step for k in ('operation','source_registry','params')):raise ValueError('TEMPLATE_COMMAND')
        visiting.remove(tid);done.add(tid)
    for tid in TEMPLATES:visit(tid)
    # Commands are bound to the shared source contract, not decorative copies.
    # Changing a template to another source without a qualified handler must fail
    # publication rather than silently execute the old metric mapping.
    scalar=strict_json((ROOT/'scalar_catalog.json').read_text())['recipes']
    scalar_sources=strict_json((ROOT/'scalar_source_catalog.json').read_text())['sources']
    datasets=strict_json((ROOT/'dataset_queries.json').read_text())['queries']
    formulas=strict_json((ROOT/'expression_catalog.json').read_text())['formulas']
    for t in TEMPLATES.values():
        if t['kind']not in('scalar','compound','formula','dataset','event','information'):raise ValueError('TEMPLATE_KIND')
        if t['kind']=='scalar':
            if len(t['metrics'])!=1 or set(x['platform']for x in t['steps'])!=set(t['platforms']):raise ValueError('TEMPLATE_SCALAR_SCHEMA')
            for step in t['steps']:
                recipe=scalar[step['recipe']];source=scalar_sources[recipe['operation']]
                if step['operation']!=recipe['operation']or step['platform']!=recipe['platform']or step['source_registry']!='scalar_source_catalog' or step['params']!=source['request']or step['workflow']!=recipe['workflow']:raise ValueError('TEMPLATE_SOURCE_CONTRACT_DRIFT')
                if step['bind']['metrics']!=t['metrics']or step['bind']['fields']!={m:recipe['fields'][m]for m in t['metrics']}:raise ValueError('TEMPLATE_METRIC_BINDING')
        if t['kind']=='compound':
            if any('template'not in step for step in t['steps']):raise ValueError('TEMPLATE_COMPOUND_STEP')
        if t['kind']=='formula'and t['calculation_contract']!=formulas[t['id']]:raise ValueError('TEMPLATE_FORMULA_DRIFT')
        if t['kind']=='dataset':
            q=datasets[t['dataset_query']]
            expected=[{'id':platform+'_'+stage['id'],'platform':platform,'operation':stage['source'],'source_registry':'dataset_sources','params':stage['foreach'],'period_mode':stage['period_mode'],**({'window':stage['window']}if'window'in stage else{})}for platform,stages in q['flows'].items()for stage in stages]
            if t['steps']!=expected:raise ValueError('TEMPLATE_DATASET_SOURCE_DRIFT')
            if any(t[k]!=q[k]for k in ['columns','group_by','aggregates','output_stage']):raise ValueError('TEMPLATE_DATASET_SEMANTICS')
validate_catalog()

def dependencies(tid):
    result=[];seen=set()
    def visit(key):
        if key in seen:return
        seen.add(key)
        for step in TEMPLATES[key]['steps']:
            if 'template'in step:visit(step['template'])
        result.append(key)
    visit(tid);return result

def _availability(engine,t,store):
    if t['kind']=='information':return True
    if store.platform not in t['platforms']:return False
    if t['kind']=='dataset':
        if engine.dataset_capabilities is None:return False
        from dataset_pipeline import CATALOG as D,HASH as DH,SOURCES
        caps=engine.dataset_capabilities().get(store.id,{})
        return all(caps.get(s['source'],{}).get('status')=='READ_ONLY_CANARY'and caps.get(s['source'],{}).get('dataset_source_hash')==SOURCES.hash and caps.get(s['source'],{}).get('dataset_query_hash')==DH for s in D['queries'][t['dataset_query']]['flows'][store.platform])
    if t['kind']=='event':
        if engine.table_capabilities is None:return False
        from table_analytics import HASH as TH
        return engine.table_capabilities().get(store.id,{}).get('wb_event_sales',{}).get('table_hash')==TH
    return True

def discovery(engine,scope):
    return [{'id':tid,'purpose':t['purpose'],'kind':t['kind'],'input_policy':t['input_policy'],
             'platforms':t['platforms'],'available_stores':[s.id for s in scope.stores if _availability(engine,t,s)],
             'dependencies':dependencies(tid)[0:-1],'metrics':t['metrics'],'notes':t['notes']}
            for tid,t in TEMPLATES.items()]

def shape(selection):
    need(type(selection)is dict,'MODEL_SELECTION_INVALID')
    if selection.get('action')=='unsupported':raise TemplateGap('MODEL_NO_TEMPLATE',deepcopy(selection))
    need(set(selection)=={'action','complete','missing','requirements','invocations'}and selection['action']=='plan','MODEL_SELECTION_INVALID')
    need(selection['complete']is True and selection['missing']==[],'COMPOSITION_INCOMPLETE',deepcopy(selection))
    req=selection['requirements'];calls=selection['invocations']
    need(type(req)is list and bool(req)and type(calls)is list and bool(calls),'EMPTY_TEMPLATE_SELECTION')
    ids=[]
    for c in calls:
        need(type(c)is dict and set(c)=={'id','template_id','store_id','input'},'INVOCATION_SCHEMA')
        need(all(type(c[k])is str and 0<len(c[k])<=160 for k in ('id','template_id','store_id'))and type(c['input'])is dict,'INVOCATION_SCHEMA')
        need(c['template_id']in TEMPLATES,'UNKNOWN_TEMPLATE',{'template_id':c['template_id']})
        ids.append(c['id'])
    need(len(ids)==len(set(ids)),'DUPLICATE_INVOCATION')
    rids=[];covered=set()
    for r in req:
        need(type(r)is dict and set(r)=={'id','description','invocations'},'REQUIREMENT_SCHEMA')
        need(type(r['id'])is str and bool(r['id'])and type(r['description'])is str and bool(r['description'].strip())and type(r['invocations'])is list and bool(r['invocations']),'REQUIREMENT_SCHEMA')
        need(all(type(x)is str for x in r['invocations'])and set(r['invocations'])<=set(ids),'UNCOVERED_REQUIREMENT')
        rids.append(r['id']);covered.update(r['invocations'])
    need(len(rids)==len(set(rids))and covered==set(ids),'COMPOSITION_INCOMPLETE')
    return selection

def _input(call,t,today,now):
    value=call['input'];need(set(value)<={'period','comparison','filters','group_by'},'UNSUPPORTED_INPUT_FIELDS',{'fields':sorted(set(value)-{'period','comparison','filters','group_by'})})
    snapshot=t['input_policy']['snapshot'];period=value.get('period')
    if snapshot:
        need(period is None or period=={'from':today,'to':today},'HISTORICAL_SNAPSHOT_NOT_SUPPORTED')
        period={'from':today,'to':today}
    else:need(type(period)is dict and set(period)=={'from','to'},'PERIOD_NOT_RESOLVED')
    try:
        a,b=(date.fromisoformat(period[x])for x in ('from','to'));need(a<=b,'INVALID_PERIOD')
    except (ValueError,TypeError):raise TemplateGap('INVALID_PERIOD')from None
    comparison=value.get('comparison');filters=value.get('filters',{});group=value.get('group_by','marketplace')
    need(comparison is None or t['input_policy']['comparison_supported'],'COMPARISON_NOT_SUPPORTED')
    need(type(filters)is dict,'FILTER_SCHEMA');need(type(group)is str and group in INPUT_CONTRACT['group_by']['enum'],'GROUP_BY_NOT_SUPPORTED')
    if t['kind']in('dataset','event','information'):need(not filters and comparison is None and group=='marketplace','UNSUPPORTED_TEMPLATE_CONDITIONS')
    return {'period':deepcopy(period),'comparison':deepcopy(comparison),'filters':deepcopy(filters),'group_by':group,'timezone':'Europe/Moscow','calendar_date':today,'snapshot':snapshot,**({'snapshot_slot':int(now//300)}if snapshot else{})}

def compile_selection(engine,root,selection):
    shape(selection);scope=Scope(root['tenant'],root['access_revision'],tuple(Store(**s)for s in root['stores']));stores={s.id:s for s in scope.stores};groups={};ordered=[]
    expanded=[]
    def expand(call,ancestors=()):
        t=TEMPLATES[call['template_id']]
        if t['kind']=='compound':
            for step in t['steps']:expand({**deepcopy(call),'template_id':step['template']},ancestors+(t['id'],))
        else:expanded.append((call,ancestors))
    for call in selection['invocations']:expand(call)
    for call,ancestors in expanded:
        t=TEMPLATES[call['template_id']];store=stores.get(call['store_id'])
        if store is None:raise Rejected('SOURCE_ACCESS')
        need(_availability(engine,t,store),'TEMPLATE_NOT_AVAILABLE',{'template_id':t['id'],'platform':store.platform})
        inputs=_input(call,t,root['calendar_date'],engine.repo.clock())
        bucket='scalar'if t['kind']in('scalar','compound','formula')else t['kind']
        key=fingerprint({'bucket':bucket,'store':store.id,'input':inputs,'specific':t['id']if bucket!='scalar'else None})
        if key not in groups:groups[key]={'kind':bucket,'store':store,'input':inputs,'leaf_template':t['id'],'templates':[],'metrics':[],'invocations':[]};ordered.append(key)
        group=groups[key]
        for tid in (*ancestors,t['id']):
            if tid not in group['templates']:group['templates'].append(tid)
        if call['id']not in group['invocations']:group['invocations'].append(call['id'])
        group['metrics'].extend(t['metrics'])
    fragments=[]
    for key in ordered:
        group=groups[key];store=group['store'];subscope=Scope(scope.tenant,scope.revision,(store,));draft={**group['input'],'platforms':[store.platform],'question':root['question']}
        t=TEMPLATES[group['leaf_template']]
        try:
            if group['kind']=='scalar':
                metrics=sorted(set(group['metrics']));plan=make_composed_plan(subscope,draft,metrics=metrics)
            elif group['kind']=='dataset':
                from dataset_pipeline import make_dataset_plan
                draft['dataset_request']={'id':t['dataset_query']};plan=make_dataset_plan(subscope,draft,engine.dataset_capabilities())
            elif group['kind']=='event':
                from table_analytics import make_table_plan
                draft['table_request']=deepcopy(t['table_request']);plan=make_table_plan(subscope,draft,engine.table_capabilities())
            else:plan=None
            if plan is not None:
                from request_basis import validate_request_basis
                validate_request_basis(draft,plan)
        except (Rejected,ValueError,KeyError)as exc:
            if isinstance(exc,Rejected)and exc.code in('SOURCE_ACCESS','TENANT_DENIED','PERMISSION_DENIED','DEPENDENCY_UNAVAILABLE'):raise
            raise TemplateGap('TEMPLATE_CONDITIONS_NOT_SUPPORTED',{'template_ids':group['templates'],'code':getattr(exc,'code',type(exc).__name__)})from None
        if plan is not None:
            engine.pin_execution(plan,root.get('runtime_guard'))
            if not engine.authorized(plan):raise Rejected('SOURCE_ACCESS')
        fragments.append({'id':key,'kind':group['kind'],'template_ids':group['templates'],'invocation_ids':group['invocations'],'plan':plan,'draft':draft})
    return fragments

def verified(response,selection):
    need(type(response)is dict and set(response)=={'approved','missing','requirement_ids'},'VERIFICATION_INVALID')
    need(response['approved']is True and response['missing']==[],'COMPOSITION_INCOMPLETE',deepcopy(response))
    need(type(response['requirement_ids'])is list and all(type(x)is str for x in response['requirement_ids']),'VERIFICATION_INVALID')
    need(len(response['requirement_ids'])==len(selection['requirements'])and set(response['requirement_ids'])=={r['id']for r in selection['requirements']},'VERIFICATION_INCOMPLETE')
    return True
