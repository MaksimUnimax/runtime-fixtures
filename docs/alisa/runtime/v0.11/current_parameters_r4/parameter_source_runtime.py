"""Registered coefficient source fragments in the existing Worker/job/ledger.

The model chooses a registered template, never methods, URLs, evidence or write
permission. One provider request per Worker step. No new queue or provider client.
Partial normalized sources live encrypted in the CURRENT job only, and are removed
from progress at successful fragment completion. Nothing becomes value history.
"""
from copy import deepcopy
from dataclasses import asdict
from datetime import datetime,date,timedelta,timezone
from decimal import Decimal
from pathlib import Path
import base64,csv,hashlib,hmac,io,json,secrets,re
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from semantics import Scope,Store,Rejected,canonical_json,strict_json,fingerprint
import read_surface as surface
from parameter_support import parameter_contract as pc,parameter_producers as pp
from protected_reads import ProtectedPayload,key as payload_key

SCHEMA='alice-parameter-source/v1'
KIND='parameter'
OPERATIONS={'report_postings_create','report_info','report_file_get','returns_list','finance_balance','posting_fbo_get','posting_fbs_get'}
SOURCE_CODE_HASH=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
PIN=fingerprint({'producer':pp.HASH,'definition':pc.CATALOG_HASH,'read_surface':surface.PIN,'code':SOURCE_CODE_HASH,'support_code':{m.__name__:hashlib.sha256(Path(m.__file__).read_bytes()).hexdigest()for m in (pc,pp)}})


def need(ok,code='PARAMETER_WORKFLOW_SCHEMA'):
    if not ok:raise Rejected(code)


def _intent_call(fn,*args):
    # Typed platform denials remain typed at the runtime boundary. A foreign
    # Rejected class must not be misreported as WORKER_INTERNAL_UNKNOWN.
    try:return fn(*args)
    except Rejected:raise
    except Exception as exc:
        code=getattr(exc,'code',None)
        if type(code)is str and re.fullmatch(r'[A-Z][A-Z0-9_]{0,99}',code):raise Rejected(code)from None
        raise Rejected('PARAMETER_AUTHORITY_UNAVAILABLE')from None


def enabled(engine):
    policy=getattr(engine,'parameter_source_policy',None)
    if callable(policy):policy=policy()
    return type(policy)is dict and policy.get('enabled')is True and policy=={'enabled':True,'pin':PIN}


def required_operations(key):
    recipe=pp.CATALOG['templates'][pc.definition(key)['producer_template']]
    operations=set()
    for name in recipe['sources']:
        source=pp.CATALOG['sources'][name]
        operations.update(source['operations'])
        operations.update(source.get('boundary_operations',{}).values())
    need(operations<=OPERATIONS,'PARAMETER_OPERATION_NOT_REGISTERED')
    return operations


def available(engine,template,store):
    return enabled(engine)and store.platform=='ozon'and template.get('parameter_key')in pc.CATALOG['parameters'] and all(surface.available(surface.method('ozon',op))for op in required_operations(template['parameter_key']))


def input_value(call,t,today,now):
    value=call['input'];allowed={'period','comparison','filters','group_by','parameter_mode'}
    need(type(value)is dict and set(value)<=allowed,'PARAMETER_INPUT_SCHEMA')
    need(value.get('comparison')is None and value.get('group_by','marketplace')=='marketplace','PARAMETER_INPUT_UNSUPPORTED')
    filters=value.get('filters',{});need(type(filters)is dict and set(filters)<={'sku'},'PARAMETER_INPUT_UNSUPPORTED')
    area={'kind':'store','sku':''}if not filters else{'kind':'sku','sku':filters['sku']}
    try:
        pc.scope(area);period=pc.resolve_period(date.fromisoformat(today),value.get('period'))
    except pc.ParameterError as exc:raise Rejected(exc.code)from None
    mode=value.get('parameter_mode','preview');need(mode in('preview','fill_missing','replace_calculated'),'PARAMETER_INTENT')
    return {'period':period['actual'],'parameter_period':period,'scope':area,'parameter_mode':mode,
            'comparison':None,'filters':filters,'group_by':'marketplace','timezone':'Europe/Moscow','calendar_date':today,'snapshot':False}


def compile_plan(engine,scope,draft,template,root):
    need(enabled(engine),'PARAMETER_NOT_ENABLED');need(len(scope.stores)==1,'PARAMETER_SCOPE')
    store=scope.stores[0];need(available(engine,template,store),'PARAMETER_NOT_AVAILABLE')
    target={'tenant_id':scope.tenant,'store_id':store.id,'provider':'OZON','scope':deepcopy(draft['scope'])}
    # Compilation is side-effect free, including a catalogue dry-run.
    as_of=datetime.fromtimestamp(engine.repo.clock(),timezone.utc).isoformat()
    admission=None
    if draft['parameter_mode']!='preview':
        binder=getattr(engine,'parameter_intent_authority',None)
        need(binder is not None,'PARAMETER_WRITE_INTENT_REQUIRED')
        admission=_intent_call(binder.describe,root,template['parameter_key'],target,draft['parameter_period'],draft['parameter_mode'])
        need(type(admission)is dict and set(admission)=={'intent_ref','expected_revision','mode'}and admission['mode']==draft['parameter_mode'],'PARAMETER_WRITE_INTENT_REQUIRED')
        need(type(admission['intent_ref'])is str and admission['intent_ref']and type(admission['expected_revision'])is int,'PARAMETER_WRITE_INTENT_REQUIRED')
    try:collection=pp.source_plan(template['parameter_key'],target,draft['parameter_period'],as_of)
    except pc.ParameterError as exc:raise Rejected(exc.code)from None
    return {'schema':SCHEMA,'tenant':scope.tenant,'access_revision':scope.revision,'stores':[asdict(store)],
            'parameter_source':{'pin':PIN,'key':template['parameter_key'],'target':target,'period':deepcopy(draft['parameter_period']),
               'as_of':as_of,'collection':collection,'intent':admission},
            'question':draft['question'],'calendar_date':draft['calendar_date'],'timezone':'Europe/Moscow','freshness_seconds':0}


def authorized(engine,plan):
    try:
        need(enabled(engine)and plan['schema']==SCHEMA,'PARAMETER_NOT_ENABLED')
        scope=engine.execution_scope(plan.get('runtime_guard'),plan['tenant']);actual={s.id:asdict(s)for s in scope.stores}
        need(plan['tenant']==scope.tenant and plan['access_revision']==scope.revision and len(plan['stores'])==1,'SOURCE_ACCESS')
        store=plan['stores'][0];need(actual.get(store['id'])==store,'SOURCE_ACCESS');p=plan['parameter_source']
        need(p['pin']==PIN and p['target']['tenant_id']==scope.tenant and p['target']['store_id']==store['id']and store['platform']=='ozon','SOURCE_ACCESS')
        expected=pp.source_plan(p['key'],p['target'],p['period'],p['as_of']);need(expected==p['collection'],'PARAMETER_PLAN_CHANGED')
        for op in required_operations(p['key']):
            src,_,_=surface.quota('ozon',op)
            need(not engine.repo.denied('ozon:'+store['identity']+':'+src,store['access_revision']),'SOURCE_ACCESS')
        if p['intent']is not None:
            binder=getattr(engine,'parameter_intent_authority',None)
            need(binder is not None and _intent_call(binder.current,p['intent'],p['target'],p['period'])is True,'PARAMETER_WRITE_INTENT_REVOKED')
        return True
    except Rejected as exc:
        if exc.code=='DEPENDENCY_UNAVAILABLE':raise
        return False
    except (KeyError,ValueError,TypeError,pc.ParameterError):return False


def _aad(row,fragment):return canonical_json({'tenant':row['tenant'],'job':row['id'],'fragment':fragment['id'],'pin':PIN}).encode()


def _seal(repo,row,fragment,value):
    raw=canonical_json(value).encode();nonce=secrets.token_bytes(12)
    return {'nonce':base64.b64encode(nonce).decode(),'cipher':base64.b64encode(AESGCM(payload_key(repo)).encrypt(nonce,raw,_aad(row,fragment))).decode()}


def _unseal(repo,row,fragment,value):
    try:
        raw=AESGCM(payload_key(repo)).decrypt(base64.b64decode(value['nonce'],validate=True),base64.b64decode(value['cipher'],validate=True),_aad(row,fragment))
        return strict_json(raw)
    except Exception:raise Rejected('PARAMETER_PROGRESS_INTEGRITY')from None


def _token(repo,row,kind,value):
    need(type(value)in(str,int)and str(value),'PARAMETER_SOURCE_ID')
    return hmac.new(payload_key(repo),canonical_json([row['tenant'],row['id'],kind,str(value)]).encode(),hashlib.sha256).hexdigest()


def _table_orders(worker,row,step,answer):
    need(isinstance(answer,ProtectedPayload),'PARAMETER_DOCUMENT_REQUIRED')
    raw=answer.raw
    # No customer field survives this parser. The producer only sees required
    # business fields and scoped HMAC identifiers, not the arbitrary CSV content.
    try:
        if raw.startswith((b'\xff\xfe',b'\xfe\xff')):text=raw.decode('utf-16')
        else:text=raw.decode('utf-8-sig')
        need('\x00'not in text,'PARAMETER_DOCUMENT_FORMAT')
        dialect=csv.Sniffer().sniff(text[:16384],delimiters=';,\t')
        reader=csv.DictReader(io.StringIO(text),dialect=dialect)
        required={'Номер отправления','SKU','Принят в обработку','Количество','Статус'}
        need(reader.fieldnames is not None and len(reader.fieldnames)==len(set(reader.fieldnames))and required<=set(reader.fieldnames),'PARAMETER_DOCUMENT_COLUMNS')
        rows=[]
        for original in reader:
            need(None not in original,'PARAMETER_DOCUMENT_COLUMNS')
            clean={k:original[k]for k in required if k!='Номер отправления'}
            clean['Номер отправления_key']=_token(worker.repo,row,'posting',original['Номер отправления']);rows.append(clean)
    except (UnicodeError,csv.Error):raise Rejected('PARAMETER_DOCUMENT_FORMAT')from None
    return pp.normalize_orders({'schema':'ozon-postings-report-sanitized/v1','http':200,'scheme':step['scheme'],'rows_count':len(rows),'rows':rows})


def _return_rows(worker,row,answer):
    need(type(answer)is dict and type(answer.get('returns'))is list and type(answer.get('has_next'))is bool,'PARAMETER_RETURNS_SCHEMA')
    clean=[];originals={}
    for record in answer['returns']:
        posting=record.get('posting_number');need(type(posting)is str and posting,'PARAMETER_SOURCE_ID')
        token=_token(worker.repo,row,'posting',posting);originals[token]=posting
        clean.append({'schema':record.get('schema'),'type':record.get('type'),'posting_number_key':token,
          'product':{'sku':record.get('product',{}).get('sku'),'quantity':record.get('product',{}).get('quantity')},
          'exemplars':[{'exemplar_id':v.get('exemplar_id')}for v in record.get('exemplars',[])]})
    return pp.normalize_returns({'http':200,'data':{'returns':clean,'has_next':answer['has_next']}}),originals


def _initial(p):
    return {'i':0,'phase':'next','step':None,'rows':[], 'event_ids':[], 'first_observed':None,
            'batches':{s:[]for s in pp.CATALOG['templates'][pc.definition(p['key'])['producer_template']]['sources']},
            'receipts':{},'resources':[],'postings':{},'boundaries':[],'boundary_i':0,'boundary_queue':[],'cursor_seen':[],
            'finished':False}


def _batch(p,state,step,rows,stamp,scheme=None):
    period=deepcopy(step.get('period')or{'from':p['period']['actual']['from'],'to':pc.stamp(p['as_of']).astimezone(pp.TZ).date().isoformat()})
    events=list(state['event_ids']);need(events,'PARAMETER_RECEIPT_MISSING')
    b={'source':step['source'],'target':deepcopy(p['target']),'period':period,'scheme':scheme,'axis':pp.CATALOG['sources'][step['source']]['axis'],
       'collected_at':state['first_observed']or stamp,'observed_until':stamp,'complete':True,'terminal':True,'rows':rows,'boundaries':[],
       'receipt_hash':fingerprint({'events':events,'rows':rows,'period':period,'source':step['source'],'target':p['target']})}
    state['receipts'][b['receipt_hash']]={'events':events,'digest':fingerprint(b)};state['batches'][step['source']].append(b)
    state.update(i=state['i']+1,phase='next',rows=[],event_ids=[],first_observed=None,step=None,cursor_seen=[])


def _receipt(worker,row,request,state,answer):
    # Worker._call marks this exact reservation RECEIVED in the surrounding
    # transaction immediately before invoking this callback.
    with worker.repo.connection()as c:
        event=c.execute("SELECT id,source,state,http,at FROM calls WHERE jid=? AND source=? ORDER BY id DESC LIMIT 1",(row['id'],request.source)).fetchone()
        need(event is not None and event['state']=='RECEIVED'and event['http']==200,'PARAMETER_RECEIPT_MISSING')
        ident=event['id'];need(str(ident)not in state['receipts'],'PARAMETER_RECEIPT_DUPLICATE')
    raw=answer.raw if isinstance(answer,ProtectedPayload)else canonical_json(answer).encode()
    stamp=datetime.fromtimestamp(worker.repo.clock(),timezone.utc).isoformat()
    state['receipts'][str(ident)]={'source':request.source,'operation':request.operation,'request_hash':fingerprint(request.body['params']),
        'response_hash':hashlib.sha256(raw).hexdigest(),'received_at':stamp}
    state['event_ids'].append(ident)
    # Report creation/polling are control receipts, not collection of the data.
    # The coefficient passport must not label the report-create time as the time
    # of a successfully retrieved report or financial/returns payload.
    if state['first_observed']is None and request.operation.rsplit('.',1)[-1]in('report_file_get','returns_list','finance_balance'):
        state['first_observed']=stamp
    return stamp


def _verify(worker,row,plan,state):
    def verify(source,batch,target):
        if not authorized(worker.engine,plan)or target!=plan['parameter_source']['target']:return False
        proof=state['receipts'].get(batch.get('receipt_hash'))
        if not proof or fingerprint(batch)!=proof['digest']:return False
        with worker.repo.connection()as c:
            for ident in proof['events']:
                e=c.execute('SELECT jid,source,state,http FROM calls WHERE id=?',(ident,)).fetchone();r=state['receipts'].get(str(ident))
                if e is None or r is None or e['jid']!=row['id']or e['source']!=r['source']or e['state']!='RECEIVED'or e['http']!=200:return False
        return True
    return verify


def _cleanup_resources(worker,row,state):
    with worker.repo.connection(True)as c:
        for ref in state['resources']:
            c.execute('DELETE FROM read_payloads WHERE ref=? AND tenant=? AND jid=?',(ref,row['tenant'],row['id']))


def step(worker,row,root,progress,fragment):
    """Called by template_runtime before the normal sub-Worker path."""
    from template_runtime import _save,_finish_fragment
    plan=fragment['plan'];p=plan['parameter_source'];store=plan['stores'][0]
    need(authorized(worker.engine,plan)and worker.engine.authorized(root),'SOURCE_ACCESS')
    packed=progress.get('fragment_progress');state=_initial(p)if packed is None else _unseal(worker.repo,row,fragment,packed)
    def save(until=None):
        progress['fragment_progress']=_seal(worker.repo,row,fragment,state);return _save(worker.repo,row,progress,until)
    try:
        if state['phase']=='next':
            steps=p['collection']['steps']
            if state['i']==len(steps):
                orders={ (r['scheme'],r['posting'],r['sku']) for b in state['batches'].get('orders',[])for r in b['rows']}
                unknown={ (r['scheme'],r['posting'],r['sku']) for b in state['batches'].get('returns',[])for r in b['rows']} -orders
                state['boundary_queue']=[list(v)for v in sorted(unknown)];state['phase']='boundary';save();return
            state['step']=deepcopy(steps[state['i']]);state['phase']='request';save();return
        if state['phase']=='boundary'and state['boundary_i']>=len(state['boundary_queue']):
            if state['boundaries']:
                first=state['batches']['returns'][0];first['boundaries']=deepcopy(state['boundaries'])
                proof=state['receipts'][first['receipt_hash']];proof['events']+=state['event_ids'];proof['digest']=fingerprint(first)
            verify=_verify(worker,row,plan,state)
            produced=pp.produce(p['key'],p['target'],p['period'],state['batches'],verify=verify,as_of=p['as_of'],now=datetime.fromtimestamp(worker.repo.clock(),timezone.utc))
            envelope=json.loads(produced.envelope_json)
            checked=pc.validate_calculation(p['key'],envelope,p['target'],p['period'],datetime.fromtimestamp(worker.repo.clock(),timezone.utc),produced.verify)
            result={'parameter':p['key'],'value':checked.value,'unit':checked.unit,'period':json.loads(checked.actual_json),
                    'calculated_at':checked.calculated_at.isoformat(),'collected_at':checked.collected_at.isoformat(),'saved':False,'mode':'preview',
                    'controls':json.loads(produced.proof_json)['controls']}
            if p['intent']is not None:
                binder=worker.engine.parameter_intent_authority
                # Exact target/intent, and current authority again at atomic writer.
                result=_intent_call(binder.commit,p['intent'],p['target'],p['period'],envelope,produced.verify,row['id'])
                need(type(result)is dict and result.get('saved')is True,'PARAMETER_WRITE_NOT_CONFIRMED')
            need(worker.engine.authorized(root),'SOURCE_ACCESS')
            _cleanup_resources(worker,row,state)
            _finish_fragment(worker,row,root,progress,result);return
        if state['phase']=='boundary':
            scheme,posting,sku=state['boundary_queue'][state['boundary_i']]
            operation=pp.CATALOG['sources']['returns']['boundary_operations'][scheme]
            need(posting in state['postings'],'PARAMETER_RETURN_BOUNDARY_REQUIRED')
            params={'posting_number':state['postings'][posting],'with':{'analytics_data':False,'financial_data':False}}
        elif state['phase']=='poll':operation='report_info';params={'code':state['code']}
        elif state['phase']=='file':operation='report_file_get';params={'file_ref':state['file_ref']}
        else:
            need(state['phase']=='request','PARAMETER_WORKFLOW_SCHEMA');operation=state['step']['operation'];params=state['step']['params']
        need(operation in OPERATIONS,'PARAMETER_OPERATION_NOT_REGISTERED')
        request=surface.request_for(store,operation,params)
        if operation=='report_file_get':
            from protected_reads import resolve_url,bind_resource_request
            url=resolve_url(worker.engine,row,store['id'],params['file_ref'])
            request=bind_resource_request(request,url,repository=worker.repo,access_revision=store['access_revision'])
        need(not worker.repo.denied(request.source,store['access_revision']),'SOURCE_ACCESS')
        prerequisite=worker.transport.prepare(request,store)if hasattr(worker.transport,'prepare')else None
        if prerequisite:
            worker._call(row,prerequisite,store);save();return
        def received(answer):
            need(worker.engine.authorized(root)and authorized(worker.engine,plan),'SOURCE_ACCESS')
            stamp=_receipt(worker,row,request,state,answer);until=None
            if operation=='report_postings_create':
                need(type(answer)is dict and type(answer.get('result'))is dict and type(answer['result'].get('code'))is str and answer['result']['code'],'PARAMETER_REPORT_CODE')
                state['code']=answer['result']['code'];state['phase']='poll'
            elif operation=='report_info':
                r=answer.get('result',{});need(type(r)is dict,'PARAMETER_REPORT_SCHEMA')
                if r.get('status')in('waiting','processing'):
                    until=worker.repo.clock()+max(1,request.interval)
                else:
                    need(r.get('status')=='success','PARAMETER_REPORT_FAILED')
                    from protected_reads import replace_urls
                    safe=replace_urls(worker.repo,row,store['id'],operation,answer);ref=safe.get('result',{}).get('file',{})
                    need(type(ref)is dict and ref.get('source_verified')is True,'PARAMETER_REPORT_FILE_UNQUALIFIED')
                    state['file_ref']=ref['file_ref'];state['resources'].append(ref['file_ref']);state['phase']='file'
            elif operation=='report_file_get':
                values=_table_orders(worker,row,state['step'],answer)
                _batch(p,state,state['step'],values,stamp,state['step']['scheme'])
            elif operation=='returns_list':
                values,postings=_return_rows(worker,row,answer);state['rows']+=values;state['postings'].update(postings)
                if answer['has_next']:
                    need(answer['returns'],'PARAMETER_CURSOR_EMPTY');cursor=answer['returns'][-1].get('id')
                    need(type(cursor)is int and cursor>0 and cursor not in state['cursor_seen'],'PARAMETER_CURSOR_NO_PROGRESS')
                    state['cursor_seen'].append(cursor);state['step']['params']['last_id']=cursor
                else:_batch(p,state,state['step'],state['rows'],stamp)
            elif operation=='finance_balance':
                values=pp.normalize_finance({'http':200,'data':answer});_batch(p,state,state['step'],values,stamp)
            else:
                r=answer.get('result',answer);scheme,posting,sku=state['boundary_queue'][state['boundary_i']]
                need(type(r)is dict and _token(worker.repo,row,'posting',r.get('posting_number'))==posting,'PARAMETER_BOUNDARY_ID')
                need(any(str(v.get('sku'))==sku for v in r.get('products',[])),'PARAMETER_BOUNDARY_SKU')
                day=pp.processed(r['in_process_at']);need(not(p['period']['actual']['from']<=day<=p['period']['actual']['to']),'PARAMETER_UNMATCHED_COHORT_RETURN')
                state['boundaries'].append({'scheme':scheme,'posting':posting,'sku':sku,'day':day});state['boundary_i']+=1
            save(until)
        worker._call(row,request,store,on_received=received)
    except pc.ParameterError as exc:raise Rejected(exc.code)from None
