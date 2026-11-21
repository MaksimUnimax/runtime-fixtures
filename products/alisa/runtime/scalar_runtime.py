"""General scalar planning, reduction and bounded report-state transitions.
All API identifiers, fields, thresholds and stage conditions come from JSON.
"""
from __future__ import annotations
import copy,json,re
from pathlib import Path
from datetime import date,timedelta
from matrix_core import MatrixError,fail,digest,canonical,validate_expression,_evaluate
from matrix_sources import SourceMatrix,_guard,_read

ROOT=Path(__file__).parent

def load_data(path):
    def pairs(items):
        out={}
        for k,v in items:
            if k in out:fail('DUPLICATE_MATRIX_KEY')
            out[k]=v
        return out
    raw=Path(path).read_text()
    if len(raw.encode())>1048576:fail('MATRIX_SIZE')
    return json.loads(raw,object_pairs_hook=pairs,parse_constant=lambda _:fail('MATRIX_NONFINITE'))

SOURCES=SourceMatrix(load_data(ROOT/'scalar_source_catalog.json'))

class ScalarMatrix:
    def __init__(self,definition,sources):
        try:self._load(definition,sources)
        except MatrixError:raise
        except (KeyError,TypeError,ValueError,RecursionError):fail('SCALAR_CATALOG_SCHEMA')

    def _load(self,definition,sources):
        if (not isinstance(definition,dict) or set(definition)!={'schema','version','recipes','auth_profiles'} or definition['schema']!='alice-scalar-catalog/v1'
            or not isinstance(definition['version'],str) or not 1<=len(definition['version'])<=100 or not isinstance(definition['auth_profiles'],dict) or len(definition['auth_profiles'])>32 or not isinstance(definition['recipes'],dict) or not 1<=len(definition['recipes'])<=128):fail('SCALAR_CATALOG_SCHEMA')
        self.definition=copy.deepcopy(definition);self.sources=sources;self.recipes=self.definition['recipes'];self.auth=self.definition['auth_profiles']
        for name,r in self.recipes.items():
            required={'platform','family','operation','max_days','paired_periods','fields','output','error_code','workflow','auth_profile','priority','comparison_error'}
            if not isinstance(name,str) or not re.fullmatch(r'[a-z][a-z0-9_]{0,79}',name) or not isinstance(r,dict) or set(r)!=required:fail('SCALAR_RECIPE_SCHEMA')
            if r['operation'] not in sources.sources or sources.recipe(r['operation'])['platform']!=r['platform']:fail('SCALAR_SOURCE_REFERENCE')
            if type(r['priority'])is not int or not 0<=r['priority']<=1000:fail('SCALAR_PRIORITY')
            if not isinstance(r['family'],str) or not r['family'] or type(r['max_days'])is not int or not 1<=r['max_days']<=366 or type(r['paired_periods'])is not bool:fail('SCALAR_PERIOD_RULE')
            if not isinstance(r['fields'],dict) or not 1<=len(r['fields'])<=512 or any(not isinstance(k,str) or not re.fullmatch(r'[a-z][a-z0-9_]{0,79}',k) or not isinstance(v,str) or not 0<len(v)<=160 for k,v in r['fields'].items()):fail('SCALAR_METRIC_MAPPING')
            if any(not isinstance(r[k],str) or not 0<len(r[k])<=100 for k in ('error_code','comparison_error')):fail('SCALAR_ERROR_CODE')
            validate_expression(r['output'],{'rows','params','store','period'})
            w=r['workflow']
            if w is not None:
                if not isinstance(w,dict) or set(w)!={'initial','steps','max_steps','limit_error'} or not isinstance(w['steps'],dict) or not 1<=len(w['steps'])<=16 or w['initial'] not in w['steps']:fail('WORKFLOW_SCHEMA')
                if type(w['max_steps'])is not int or not 1<=w['max_steps']<=1000 or not isinstance(w['limit_error'],str):fail('WORKFLOW_LIMIT_SCHEMA')
                for phase,step in w['steps'].items():
                    if not isinstance(phase,str) or not re.fullmatch(r'[a-z][a-z0-9_]{0,79}',phase) or not isinstance(step,dict) or set(step)!={'operation','capture','guards','error','final'} or type(step['final'])is not bool:fail('WORKFLOW_SCHEMA')
                    if step['operation'] not in sources.sources or sources.recipe(step['operation'])['platform']!=r['platform']:fail('WORKFLOW_SOURCE')
                    validate_expression(step['capture'],{'response','progress'})
                    if not isinstance(step['guards'],list) or len(step['guards'])>32:fail('WORKFLOW_GUARDS')
                    for guard in step['guards']:
                        if not isinstance(guard,dict) or set(guard)!={'test','code'} or not isinstance(guard['code'],str) or not 0<len(guard['code'])<=100:fail('WORKFLOW_GUARDS')
                        validate_expression(guard['test'],{'response','progress'})
                    if not isinstance(step['error'],str) or not step['error']:fail('WORKFLOW_SCHEMA')
                if not any(s['final'] for s in w['steps'].values()):fail('WORKFLOW_NO_FINAL')
            if r['auth_profile'] is not None and (not isinstance(r['auth_profile'],str) or r['auth_profile'] not in self.auth):fail('AUTH_PROFILE_REFERENCE')
        for name,a in self.auth.items():
            if not isinstance(name,str) or not re.fullmatch(r'[a-z][a-z0-9_]{0,79}',name):fail('AUTH_PROFILE_SCHEMA')
            if not isinstance(a,dict) or set(a)!={'operation','token_path','expires_path','min_ttl','max_ttl','refresh_margin','schema_error','missing_error'} or a['operation'] not in sources.sources:fail('AUTH_PROFILE_SCHEMA')
            if any(not isinstance(a[k],str) or not 0<len(a[k])<=100 for k in ('schema_error','missing_error')):fail('AUTH_PROFILE_SCHEMA')
            for p in ('token_path','expires_path'):
                if not isinstance(a[p],list) or not 1<=len(a[p])<=8 or any(not isinstance(x,str) or not x or len(x)>100 for x in a[p]):fail('AUTH_PROFILE_SCHEMA')
            if any(type(a[k])is not int for k in ('min_ttl','max_ttl','refresh_margin')) or not 0<=a['refresh_margin']<=a['min_ttl']<a['max_ttl']<=86400:fail('AUTH_PROFILE_TTL')
        secret_operations={p['operation'] for p in self.auth.values()}
        for r in self.recipes.values():
            if r['operation'] in secret_operations:fail('REPORT_SECRET_OPERATION')
            if r['auth_profile'] is not None and sources.recipe(self.auth[r['auth_profile']]['operation'])['platform']!=r['platform']:fail('AUTH_PROFILE_PLATFORM')
            if r['workflow'] and any(s['operation'] in secret_operations for s in r['workflow']['steps'].values()):fail('WORKFLOW_SECRET_OPERATION')
        self.hash=digest({'catalog':self.definition,'sources':sources.definition})

    def recipe(self,name):
        if name not in self.recipes:fail('SCALAR_RECIPE_UNKNOWN')
        return copy.deepcopy(self.recipes[name])

    def tasks(self,plan,store):
        from registry import DEFINITIONS,base_metrics
        metrics=base_metrics(plan['metrics']);result=[]
        periods=[('current',plan['period'])]+([('previous',plan['comparison'])] if plan.get('comparison') else [])
        # One route per metric/platform; ambiguity is a configuration error.
        groups={}
        for metric in metrics:
            choices=[key for key,r in self.recipes.items() if r['platform']==store['platform'] and metric in r['fields'] and r['family']==DEFINITIONS[metric]['source']]
            if len(choices)!=1:fail('SCALAR_ROUTE_AMBIGUOUS')
            groups.setdefault(choices[0],[]).append(metric)
        for role,period in periods:
            for name in sorted(groups,key=lambda n:(self.recipes[n]['priority'],n)):
                wanted=groups[name]
                recipe=self.recipes[name]
                if role=='previous' and recipe['paired_periods']:continue
                a,b=map(date.fromisoformat,(period['from'],period['to']))
                while a<=b:
                    end=min(b,a+timedelta(days=recipe['max_days']-1))
                    task={'recipe':name,'role':role,'metrics':wanted,'period':{'from':a.isoformat(),'to':end.isoformat()}}
                    if recipe['paired_periods'] and plan.get('comparison'):task['comparison']=plan['comparison']
                    result.append(task);a=end+timedelta(days=1)
        return result

    def phase(self,recipe,progress):
        w=recipe['workflow']
        if not w:return recipe['operation'],None
        phase=(progress or {}).get('phase',w['initial'])
        if phase not in w['steps']:fail('PROVIDER_TASK_PHASE')
        return w['steps'][phase]['operation'],w['steps'][phase]

    def context(self,plan,store,task):
        from registry import DEFINITIONS
        r=self.recipe(task['recipe'])
        if r['platform']!=store['platform'] or not set(task['metrics'])<=set(r['fields']):fail('SCALAR_SOURCE_SCOPE')
        params={'metrics':task['metrics'],'fields':r['fields'],'integer':{m:DEFINITIONS[m]['unit'] in ('item','count') for m in task['metrics']},
                'signed':{m:bool(DEFINITIONS[m].get('signed',False)) for m in task['metrics']},'comparison':task.get('comparison')}
        normalized={**plan,'table':{'view':'scalar'},'table_params':params}
        return normalized,r

    def workflow_scope(self,plan,store,task):
        return digest({'store':store,'plan':plan,'task':task})

    def validate_progress(self,plan,store,task,progress):
        r=self.recipe(task['recipe'])
        if not r['workflow'] or progress is None:return
        if not isinstance(progress,dict) or progress.get('_workflow_hash')!=self.hash:fail('WORKFLOW_PROGRESS_VERSION')
        if progress.get('_workflow_scope')!=self.workflow_scope(plan,store,task):fail('WORKFLOW_PROGRESS_SCOPE')
        n=progress.get('_workflow_steps')
        if type(n)is not int or not 0<=n<r['workflow']['max_steps']:fail(r['workflow']['limit_error'])

    def compatibility_progress(self,plan,store,task,progress):
        if progress is None or not self.recipe(task['recipe'])['workflow'] or '_workflow_hash' in progress:return progress
        return {**progress,'_workflow_hash':self.hash,'_workflow_scope':self.workflow_scope(plan,store,task),'_workflow_steps':0}

    def build(self,plan,store,task,progress=None):
        self.validate_progress(plan,store,task,progress)
        norm,r=self.context(plan,store,task);operation,_=self.phase(r,progress)
        return self.sources.request(operation,norm,store,task,progress)

    def decode(self,data,plan,store,task,progress=None):
        self.validate_progress(plan,store,task,progress)
        norm,r=self.context(plan,store,task);operation,step=self.phase(r,progress)
        try:
            env={'response':data,'progress':progress or {}}
            if step:
                for guard in step['guards']:_guard(guard,env)
            if step and not step['final']:
                capture=_read(step['capture'],env,step['error'])
                if not isinstance(capture,dict) or capture.get('phase') not in r['workflow']['steps'] or len(canonical(capture))>8192:fail('WORKFLOW_CAPTURE_SCHEMA')
                # No arbitrary nested payload or sensitive key may enter persistent workflow state.
                if any(type(v) not in (str,int,bool) for v in capture.values()):fail('WORKFLOW_CAPTURE_SCHEMA')
                capture.update(_workflow_hash=self.hash,_workflow_scope=self.workflow_scope(plan,store,task),_workflow_steps=(progress or {}).get('_workflow_steps',0)+1)
                return {'values':{},'rows':0,'currency':None,'complete':False,'progress':capture}
            # A download stage checkpoint is not a page checkpoint.
            page=(progress or {}).get('page') if step else progress
            decoded=self.sources.decode(operation,data,norm,store,task,page)
            rows=decoded['rows'] if decoded['complete'] else decoded['progress']['rows']
            output=_read(r['output'],{'rows':rows,'params':norm['table_params'],'store':store,'period':task['period']},r['error_code'])
            if not isinstance(output,dict) or set(output)-{'values','previous_values','rows'} or not {'values','rows'}<=set(output) or type(output['rows'])is not int or output['rows']<0:fail('SCALAR_OUTPUT_SCHEMA')
            if set(output['values'])!=set(task['metrics']):fail('SCALAR_OUTPUT_METRICS')
            if task.get('comparison') and set(output.get('previous_values',{}))!=set(task['metrics']):fail(r['comparison_error'])
            result={**output,'currency':decoded['currency'],'complete':decoded['complete'],'progress':decoded['progress']}
            if step and not decoded['complete']:result['progress']={**progress,'page':decoded['progress'],'_workflow_steps':progress['_workflow_steps']+1}
            return result
        except MatrixError as exc:
            if exc.code in ('TABLE_RESPONSE_SCHEMA','BINDING_MISSING','BINDING_TYPE','BINDING_VALUE'):fail(r['error_code'])
            raise

    def operations_for(self,task):
        r=self.recipe(task['recipe']);w=r['workflow']
        ops={s['operation'] for s in w['steps'].values()} if w else {r['operation']}
        if r['auth_profile']:ops.add(self.auth[r['auth_profile']]['operation'])
        return ops

    def profile_for(self,operation):
        profiles={r['auth_profile'] for r in self.recipes.values() if r['auth_profile'] is not None and (r['operation']==operation or r['workflow'] is not None and any(step['operation']==operation for step in r['workflow']['steps'].values()))}
        if len(profiles)>1:fail('AUTH_PROFILE_AMBIGUOUS')
        return next(iter(profiles)) if profiles else None

MATRIX=ScalarMatrix(load_data(ROOT/'scalar_catalog.json'),SOURCES)
