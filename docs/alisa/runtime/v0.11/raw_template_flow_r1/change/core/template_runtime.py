"""Temporary template-only mode, with full-composition admission before any API.

Uses the existing queue, authority, source handlers, ledger and final-answer model.
Absent templates and invalid execution decisions are archived and reported separately.
"""
from pathlib import Path
from dataclasses import asdict
from datetime import date,datetime,timezone
from copy import deepcopy
import re,json,hashlib
from semantics import Scope,Store,Rejected,canonical_json,strict_json,fingerprint,normalize
from template_catalog import CATALOG,TEMPLATES,HASH,MODE,TEXT,CODE,TemplateGap,discovery,compile_selection,INPUT_CONTRACT
from template_protocol import SELECT_SYSTEM,payload as model_payload
from model_answer import API_DATA,PENDING,ORIGINAL_QUESTION

SCHEMA='alice-template-execution/v1'
TRACE='_template_trace';STATE='_template_state'
CONTROL={'результат','результат отчета','статус отчета','дальше','отмени отчет','план запроса','диагностика аналитики','выход'}

def authorized(engine,plan):
    try:
        if plan.get('schema')!=SCHEMA or plan['template_execution']!={'catalog_hash':HASH,'mode':MODE}:return False
        scope=Scope(plan['tenant'],plan['access_revision'],tuple(Store(**s)for s in plan['stores']))
        if not engine.scope_current(scope,plan.get('runtime_guard')):return False
        fragments=plan.get('fragments',[])
        if type(fragments)is not list:return False
        if fragments:
            if not plan.get('selection_verified'):return False
            if plan.get('execution_digest')!=fingerprint({'selection':plan['selection'],'fragments':fragments,'catalog':HASH}):return False
            for f in fragments:
                if f['plan'] is not None:
                    if f['plan'].get('runtime_guard')!=plan.get('runtime_guard')or not engine.authorized(f['plan']):return False
        return True
    except Rejected as e:
        if e.code=='DEPENDENCY_UNAVAILABLE':raise
        return False
    except (KeyError,TypeError,ValueError):return False

def submit(engine,tenant,command,rid,body_hash,today,clarification=None,execution_context=None):
    if execution_context is None and normalize(command)in CONTROL:
        return engine.control_once(tenant,normalize(command),rid,body_hash)
    scope=engine.execution_scope(execution_context,tenant)
    if scope.tenant!=tenant:raise Rejected('TENANT_DENIED')
    # Security input checks, not topic selection or speech-template matching.
    if re.search(r'(sk-[\w-]{12,}|eyJ[\w-]{25,}\.|api.?key|authorization|bearer|парол|токен|секрет)',command,re.I):raise Rejected('SENSITIVE_INPUT','Не передавайте ключи или пароли.')
    original=ORIGINAL_QUESTION.get()or command
    context=original if type(original)is dict else{'question':original}
    plan={'schema':SCHEMA,'tenant':tenant,'access_revision':scope.revision,'stores':[asdict(s)for s in scope.stores],
          'question':context['question'],'timezone':'Europe/Moscow','calendar_date':today.isoformat(),
          'template_execution':{'catalog_hash':HASH,'mode':MODE},'selection_verified':False,
          'freshness_seconds':300,'request_identity':fingerprint([rid,body_hash]),'fragments':[]}
    draft={'route':'TEMPLATE_ONLY','question':command,'original_question':context['question'],'question_clarifications':context.get('clarifications',[]),'calendar_date':today.isoformat(),'refresh':False}
    if clarification is not None:draft['clarification']=clarification
    engine.pin_execution(plan,execution_context);engine.pin_execution(draft,execution_context)
    if not authorized(engine,plan):raise Rejected('SOURCE_ACCESS')
    row,outcome=engine.repo.enqueue(tenant,rid,body_hash,draft,plan,fingerprint(asdict(scope)),update_pointer=execution_context is None)
    if execution_context is not None:return {'job_id':row['id'],'state':row['state'],'cache':outcome}
    text=engine.describe(tenant,row,deliver=True)
    return {'text':text,'tts':text,'job_id':row['id'],'state':row['state'],'cache':outcome}

def _current_progress(repo,row):
    with repo.connection()as c:
        current=c.execute('SELECT progress FROM jobs WHERE id=?AND owner=?',(row['id'],row['owner'])).fetchone()
    if current is None:raise Rejected('JOB_LEASE_LOST')
    return strict_json(current['progress'])if current['progress']else{}

def _save(repo,row,progress,until=None):
    # Provider capture may have added full API data inside the same step.
    current=_current_progress(repo,row)
    if API_DATA in current:progress[API_DATA]=current[API_DATA]
    repo.reschedule(row['id'],row['owner'],progress,until=until)

def _snapshot(repo,row,progress,operation,body):
    full=model_payload(operation,body)
    entry={'operation':operation,'prepared_at':datetime.fromtimestamp(repo.clock(),timezone.utc).isoformat(),
           'request_payload':full,'request_payload_sha256':hashlib.sha256(json.dumps(full,ensure_ascii=False,allow_nan=False).encode()).hexdigest()}
    progress.setdefault(TRACE,[]).append(entry)
    with repo.connection(True)as c:
        repo._owned(c,row['id'],row['owner'])
        c.execute('UPDATE jobs SET progress=?WHERE id=?',(canonical_json(progress),row['id']))
    return len(progress[TRACE])-1

def _gap(worker,row,plan,progress,error):
    engine=worker.engine;repo=worker.repo
    if not authorized(engine,plan):raise Rejected('SOURCE_ACCESS')
    with repo.connection()as c:
        calls=[dict(r)for r in c.execute('SELECT id,source,at,state,http,elapsed_ms,response_bytes,error_code FROM calls WHERE jid=?ORDER BY id',(row['id'],))]
        inbox=[dict(r)for r in c.execute('SELECT rid,body_hash FROM inbox WHERE jid=?',(row['id'],))]
    from template_gaps import GapStore
    store=GapStore(Path(repo.path).with_name('template-gaps.sqlite3'))
    code,text=error.code,error.message
    packet={'schema':'alisa-template-gap-evidence/v1','mode':MODE,'temporary_mode':True,'code':code,'reason':error.reason,'details':error.details,
            'original_question':strict_json(row['draft']).get('original_question',plan['question']),
            'draft':strict_json(row['draft']),'accepted_context':plan,'model_calls':progress.get(TRACE,[]),
            'selection':progress.get('selection'),'verification':progress.get('verification'),'diagnostic_progress':progress,'call_receipts':calls,'request_receipts':inbox,
            'catalog':CATALOG,'catalog_hash':HASH,'runtime_release':Path(__file__).parent.name,
            'saved_at':datetime.fromtimestamp(repo.clock(),timezone.utc).isoformat()}
    case_id=store.save(row['tenant'],row['id'],row['created'],error.reason,HASH,packet)
    result={'complete':True,'pages':[text],'fetched_at':datetime.fromtimestamp(repo.clock(),timezone.utc).strftime('%Y-%m-%d %H:%M UTC'),
            'data':None,'failure_code':code,'template_gap':True,'temporary_mode':True,
            'model_result':{'ok':False,'status':code,'message':text,'data':None,'retryable':False,'temporary_mode':True,'case_id':case_id}}
    # Preserve the exact pilot phrase only for a real missing-template decision.
    # Other execution failures use the shared safe error catalogue.
    repo.complete_answer(row['id'],row['owner'],result)

def gap_result(engine,row):
    if row['state']!='READY'or(row.get('expires')or 0)<=engine.repo.clock()or not row['result']or not row['plan']:return None
    r=strict_json(row['result'])
    code=r.get('failure_code')
    if code not in (CODE,'TEMPLATE_EXECUTION_FAILED'):return None
    from failure_explanations import explain
    text=TEXT if code==CODE else explain(code)['text']
    if r.get('template_gap')is not True or r.get('pages')!=[text]:return None
    value=r.get('model_result',{})
    if value.get('status')!=code or value.get('message')!=text or value.get('ok')is not False:return None
    if not authorized(engine,strict_json(row['plan'])):return None
    return r['model_result']

def _compile_and_save_selection(worker,row,plan,progress,decision):
    # Validate the selected registered recipes locally. No extra model call.
    progress['selection']=deepcopy(decision)
    fragments=compile_selection(worker.engine,plan,decision)
    progress['fragments']=fragments
    progress['preview']=[{'template_ids':f['template_ids'],'invocation_ids':f['invocation_ids'],'input':f['draft'],'kind':f['kind']}for f in fragments]
    progress['verification']={'method':'local_template_compilation'}
    newplan=deepcopy(plan);newplan.update(selection=decision,fragments=fragments,selection_verified=True)
    newplan['execution_digest']=fingerprint({'selection':newplan['selection'],'fragments':fragments,'catalog':HASH})
    if not authorized(worker.engine,newplan):raise Rejected('SOURCE_ACCESS')
    progress.update({STATE:'execute','fragment_index':0,'fragment_progress':None,'completed_fragments':[]})
    with worker.repo.connection(True)as c:
        worker.repo._owned(c,row['id'],row['owner'])
        c.execute('UPDATE jobs SET plan=?WHERE id=?',(canonical_json(newplan),row['id']))
        _save(worker.repo,row,progress)

def worker_step(worker,row,plan):
    if not authorized(worker.engine,plan):raise Rejected('SOURCE_ACCESS')
    progress=strict_json(row['progress'])if row['progress']else{STATE:'select',TRACE:[]}
    state=progress.get(STATE)
    try:
        if state=='verify':
            # Resume old persisted checkpoints through the same local checks.
            _compile_and_save_selection(worker,row,plan,progress,progress['selection']);return
        if state=='select':
            scope=Scope(plan['tenant'],plan['access_revision'],tuple(Store(**s)for s in plan['stores']))
            settings=progress.get('planning_settings')
            if settings is None:
                settings=worker.engine.answer_settings.read()if worker.engine.answer_settings else{'revision':0,'request_planning_prompt':''}
                progress['planning_settings']={'revision':settings['revision'],'request_planning_prompt':settings['request_planning_prompt']}
            ctx={'original_question':plan['question'],'clarifications':strict_json(row['draft']).get('question_clarifications',[]),
                 'server_date':plan['calendar_date'],'timezone':plan['timezone'],'allowed_stores':[{'id':s.id,'platform':s.platform}for s in scope.stores],
                 'templates':discovery(worker.engine,scope),'input_contract':INPUT_CONTRACT,'temporary_mode':MODE}
            op='template_select';body={'system':SELECT_SYSTEM,'instruction':progress['planning_settings']['request_planning_prompt'],'context':ctx}
            index=_snapshot(worker.repo,row,progress,op,body)
            from providers import Request
            req=Request(op,getattr(worker.transport,'model_source','model:deepseek-flash'),'',body,0,None)
            def received(response):
                progress[TRACE][index]['response']=deepcopy(response);progress[TRACE][index]['received_at']=datetime.fromtimestamp(worker.repo.clock(),timezone.utc).isoformat()
                try:
                    if response.get('finish_reason')!='stop':raise TemplateGap('MODEL_SELECTION_INCOMPLETE')
                    try:decision=strict_json(response.get('content',''))
                    except (Rejected,TypeError):raise TemplateGap('MODEL_SELECTION_INVALID')from None
                    _compile_and_save_selection(worker,row,plan,progress,decision)
                except TemplateGap as error:_gap(worker,row,plan,progress,error)
            worker._call(row,req,on_received=received)
            return
        if state!='execute'or not plan.get('selection_verified'):raise TemplateGap('TEMPLATE_STATE_INVALID')
        index=progress['fragment_index'];fragment=plan['fragments'][index]
        if fragment['kind']=='information':
            scope=Scope(plan['tenant'],plan['access_revision'],tuple(Store(**s)for s in plan['stores']))
            payload={'operation':'catalog_capabilities','data':discovery(worker.engine,scope)}
            current=_current_progress(worker.repo,row);current.setdefault(API_DATA,[]).append(payload)
            with worker.repo.connection(True)as c:c.execute('UPDATE jobs SET progress=?WHERE id=?',(canonical_json(current),row['id']))
            _finish_fragment(worker,row,plan,progress,{'capabilities':payload['data']});return
        _run_fragment(worker,row,plan,progress,fragment)
    except TemplateGap as error:_gap(worker,row,plan,progress,error)

def _finish_fragment(worker,row,plan,progress,data):
    progress['completed_fragments'].append({'template_ids':plan['fragments'][progress['fragment_index']]['template_ids'],'data':data})
    progress['fragment_index']+=1;progress['fragment_progress']=None
    if progress['fragment_index']==len(plan['fragments']):
        # Existing final-answer stage receives the original question and all full
        # captured API responses. This call performs no model/network operation.
        result_data={'templates':progress['completed_fragments']}
        context={}
        # Speech notes belong only to explicit model selections. Expanded
        # dependencies execute on the server but do not inherit speech context.
        for invocation in plan['selection']['invocations']:
            tid=invocation['template_id']
            template=TEMPLATES[tid]
            if template.get('notes'):
                context[tid]={'template_id':tid,'version':template['version'],'purpose':template['purpose'],'notes':deepcopy(template['notes'])}
        if context:result_data['template_context']=list(context.values())
        worker.repo.stage_answer(row['id'],row['owner'],{'data':result_data,'fetched_at':datetime.fromtimestamp(worker.repo.clock(),timezone.utc).strftime('%Y-%m-%d %H:%M UTC')})
    else:_save(worker.repo,row,progress)

class _FragmentRepo:
    """Adapter for existing worker handlers: one root job, never a second queue."""
    def __init__(self,worker,row,plan,progress,fragment):
        self.worker=worker;self.base=worker.repo;self.row=row;self.plan=plan;self.progress=progress;self.fragment=fragment;self.claimed=False
    def __getattr__(self,name):return getattr(self.base,name)
    def claim(self):
        if self.claimed:return None
        self.claimed=True
        draft=strict_json(self.row['draft']);draft.update(self.fragment['draft']);draft['answer_by_model']=True
        return {**dict(self.row),'plan':canonical_json(self.fragment['plan']),'draft':canonical_json(draft),'progress':canonical_json(self.progress['fragment_progress'])if self.progress['fragment_progress']is not None else None}
    def reschedule(self,jid,owner,progress=None,until=None):
        if progress is not None:self.progress['fragment_progress']=progress
        return _save(self.base,self.row,self.progress,until)
    def stage_answer(self,jid,owner,result,progress=None):
        return _finish_fragment(self.worker,self.row,self.plan,self.progress,result['data'])
    def complete(self,jid,owner,result):return self.stage_answer(jid,owner,result)

def _run_fragment(worker,row,plan,progress,fragment):
    from engine import Worker
    sub=Worker(worker.engine,worker.transport);sub.repo=_FragmentRepo(worker,row,plan,progress,fragment)
    # All actual dispatches remain in the parent worker and current root job.
    sub._call=lambda child,request,store=None,**kw:worker._call(row,request,store,**kw)
    sub.step()
