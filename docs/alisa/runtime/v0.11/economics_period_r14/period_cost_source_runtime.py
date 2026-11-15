"""Use existing storage/ad templates in the existing parent job, not a new API.

The source delivers only qualified period costs. It does NOT grant a report,
classify original order fees or turn missing owner data into profit.
"""
from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal
from hashlib import sha256
from pathlib import Path
import base64,secrets,json
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from semantics import Rejected,canonical_json,strict_json,fingerprint
from protected_reads import key as encryption_key,ProtectedPayload
from parameter_support import economics_periods as costs
import providers
from scalar_runtime import MATRIX,SOURCES

DECLARATIONS={'storage':{'template':'B06.finance_storage_cost','metric':'finance_storage_cost','recipe':'ozon_finance'},
              'advertising':{'template':'B12.ad_spend','metric':'ad_spend','recipe':'ozon_ads_daily'}}
PIN=fingerprint({'code':sha256(Path(__file__).read_bytes()).hexdigest(),'normalizer':sha256(Path(costs.__file__).read_bytes()).hexdigest(),
                 'policy':costs.HASH,'sources':MATRIX.hash,'declarations':DECLARATIONS})

def need(ok,code):
    if not ok:raise Rejected(code)

def descriptor(engine,root,store_id,period):
    costs._dates(period)
    from template_catalog import compile_selection
    tasks=[]
    for component,rule in DECLARATIONS.items():
        invocation={'id':'period-'+component,'template_id':rule['template'],'store_id':store_id,'input':{'period':deepcopy(period)}}
        selection={'action':'plan','complete':True,'missing':[],
                   'requirements':[{'id':component,'description':'Declared period expense','invocations':[invocation['id']]}],
                   'invocations':[invocation]}
        fragments=compile_selection(engine,root,selection)
        need(len(fragments)==1 and fragments[0]['kind']=='scalar','PERIOD_COST_SOURCE_PLAN')
        child=fragments[0]['plan'];need(len(child['stores'])==1 and child['stores'][0]['id']==store_id and child['stores'][0]['platform']=='ozon','PERIOD_COST_SCOPE')
        for task in providers.tasks(child,child['stores'][0]):
            need(task['recipe']==rule['recipe']and task['metrics']==[rule['metric']]and task['role']=='current','PERIOD_COST_SOURCE_PLAN')
            tasks.append({'component':component,'child':deepcopy(child),'task':task})
    need(bool(tasks),'PERIOD_COST_SOURCE_PLAN')
    return {'id':'period-costs:'+fingerprint([store_id,period]),'pin':PIN,'store_id':store_id,'period':deepcopy(period),
            'scope':{'tenant_id':root['tenant'],'store_id':store_id,'provider':'OZON','currency':'RUB'},'tasks':tasks}

def _guard(worker,row,root,desc,authorize):
    need(callable(authorize),'PERIOD_COST_REPORT_AUTHORITY_REQUIRED')
    need(worker.engine.authorized(root) and authorize()is True,'PERIOD_COST_REPORT_REVOKED')
    need(desc==descriptor(worker.engine,root,desc['store_id'],desc['period']),'PERIOD_COST_PLAN_CHANGED')
    need(row['tenant']==root['tenant'],'PERIOD_COST_SCOPE')
    for item in desc['tasks']:need(worker.engine.authorized(item['child']),'PERIOD_COST_SOURCE_ACCESS')
    return next(s for s in root['stores']if s['id']==desc['store_id'])

def _aad(row,desc):return canonical_json({'tenant':row['tenant'],'job':row['id'],'desc':desc,'pin':PIN}).encode()

def _seal(repo,row,desc,state):
    nonce=secrets.token_bytes(12);return {'nonce':base64.b64encode(nonce).decode(),
       'cipher':base64.b64encode(AESGCM(encryption_key(repo)).encrypt(nonce,canonical_json(state).encode(),_aad(row,desc))).decode()}

def _open(repo,row,desc,packed):
    try:
        need(type(packed)is dict and set(packed)=={'nonce','cipher'},'PERIOD_COST_PROGRESS_INTEGRITY')
        data=AESGCM(encryption_key(repo)).decrypt(base64.b64decode(packed['nonce'],validate=True),base64.b64decode(packed['cipher'],validate=True),_aad(row,desc))
        state=strict_json(data);need(set(state)=={'packets','receipts','event_ids','first_observed'},'PERIOD_COST_PROGRESS_INTEGRITY');return state
    except Exception:raise Rejected('PERIOD_COST_PROGRESS_INTEGRITY')from None

def _packet(packed):
    result=deepcopy(packed);result['body']=base64.b64decode(result.pop('body_b64'),validate=True);return result

def _scope_proof():
    actual=SOURCES.recipe('ozon_ads_daily')['proof_requirements']
    need(actual==costs.CATALOG['sources']['advertising']['scope_requirements'],'PERIOD_COST_CAMPAIGN_SCOPE')
    return deepcopy(actual)

def _verify(worker,row,root,desc,state,authorize):
    def verifier(packet,proof):
        store=_guard(worker,row,root,desc,authorize)
        if proof!=_scope_proof():return False
        matches=[]
        for item in desc['tasks']:
            request=providers.build_task(item['child'],store,item['task'])
            operation=costs.CATALOG['sources'][item['component']]['operation']
            if operation==packet['operation']and request.body==packet['request']:matches.append(request)
        if len(matches)!=1:return False
        request=matches[0];observed=state['receipts'].get(str(packet['receipt_id']))
        if observed is None or observed!={'source':request.source,'operation':request.operation,
             'request_hash':fingerprint(request.body),'response_hash':packet['response_sha256'],'received_at':packet['received_at']}:return False
        with worker.repo.connection()as connection:
            event=connection.execute('SELECT jid,source,state,http FROM calls WHERE id=?',(packet['receipt_id'],)).fetchone()
            return event is not None and event['jid']==row['id']and event['source']==request.source and event['state']=='RECEIVED'and event['http']==200
    return verifier

def restore(worker,row,root,desc,packed,*,authorize):
    _guard(worker,row,root,desc,authorize);state=_open(worker.repo,row,desc,packed)
    need(len(state['packets'])==len(desc['tasks']),'PERIOD_COST_SOURCE_INCOMPLETE')
    try:
        result=costs.normalize([_packet(p)for p in state['packets']],desc['scope'],desc['period'],
             verify=_verify(worker,row,root,desc,state,authorize),scope_proof=_scope_proof(),
             as_of=datetime.fromtimestamp(worker.repo.clock(),timezone.utc).isoformat())
        _guard(worker,row,root,desc,authorize);return result
    except (costs.PeriodCostError,costs.c.ParameterError)as error:raise Rejected(error.code)from None

def _transport_body(value):
    """Encode the transport's exact Decimal numbers as JSON numbers.

    HTTPTransport parses JSON fractions as Decimal. A float round-trip would
    corrupt source money; converting every number to a string would change the
    provider schema. This encoding retains all JSON types, including unused
    numeric provider fields, and is explicitly not the original HTTP byte body.
    """
    def encode(item):
        if type(item)is Decimal:
            need(item.is_finite(),'PERIOD_COST_NONFINITE')
            return str(item)
        if item is None or type(item)in(str,int,bool):
            return json.dumps(item,ensure_ascii=False,allow_nan=False)
        if type(item)is list:return '['+','.join(encode(v)for v in item)+']'
        if type(item)is dict:
            need(all(type(k)is str for k in item),'PERIOD_COST_TRANSPORT_JSON_REQUIRED')
            return '{'+','.join(json.dumps(k,ensure_ascii=False)+':'+encode(item[k])for k in sorted(item))+'}'
        # The real transport does not produce binary floats or arbitrary objects.
        # Refuse them instead of changing their precision or calling __str__.
        raise Rejected('PERIOD_COST_TRANSPORT_JSON_REQUIRED')
    return encode(value).encode('utf-8')


def _receipt(worker,row,request,state,raw):
    with worker.repo.connection()as connection:
        event=connection.execute('SELECT id,jid,source,state,http FROM calls WHERE jid=? AND source=? ORDER BY id DESC LIMIT 1',
                                 (row['id'],request.source)).fetchone()
    need(event is not None and event['state']=='RECEIVED'and event['http']==200,'PERIOD_COST_RECEIPT_MISSING')
    ident=str(event['id']);need(ident not in state['receipts'],'PERIOD_COST_RECEIPT_REUSED')
    state['receipts'][ident]={'source':request.source,'operation':request.operation,'request_hash':fingerprint(request.body),
       'response_hash':sha256(raw).hexdigest(),
       'received_at':datetime.fromtimestamp(worker.repo.clock(),timezone.utc).isoformat()}
    state['event_ids'].append(event['id'])


def step(worker,row,root,desc,packed,*,authorize,save_progress,on_complete):
    store=_guard(worker,row,root,desc,authorize)
    state={'packets':[],'receipts':{},'event_ids':[],'first_observed':None}if packed is None else _open(worker.repo,row,desc,packed)
    need(len(state['packets'])<=len(desc['tasks']),'PERIOD_COST_PROGRESS_INTEGRITY')
    if len(state['packets'])==len(desc['tasks']):on_complete(restore(worker,row,root,desc,packed,authorize=authorize),packed);return
    item=desc['tasks'][len(state['packets'])];request=providers.build_task(item['child'],store,item['task'])
    prerequisite=worker.transport.prepare(request,store)if hasattr(worker.transport,'prepare')else None
    def before_dispatch():_guard(worker,row,root,desc,authorize)
    if prerequisite:
        worker._call(row,prerequisite,store,before_dispatch=before_dispatch)
        save_progress(_seal(worker.repo,row,desc,state));return
    def received(answer):
        _guard(worker,row,root,desc,authorize)
        need(type(answer)is dict,'PERIOD_COST_TRANSPORT_JSON_REQUIRED')
        # Existing scalar contract is applied unchanged (including campaign-scope,
        # duplicate/truncation/period/units checks). Original transport JSON is kept
        # encrypted; we do not assert byte identity with an HTTP whitespace layout.
        raw=_transport_body(answer)
        # The qualified Performance source permits both DD.MM.YYYY and ISO.
        # Reuse its strict date parser only for the scalar decoder's view; the
        # retained packet and receipt still contain the provider's original date.
        validation_answer=deepcopy(answer)
        if item['component']=='advertising':
            try:
                need(type(validation_answer.get('rows'))is list,'PERIOD_COST_TRANSPORT_JSON_REQUIRED')
                for record in validation_answer['rows']:
                    need(type(record)is dict,'PERIOD_COST_TRANSPORT_JSON_REQUIRED')
                    record['date']=costs._day(record.get('date')).isoformat()
            except costs.PeriodCostError as error:raise Rejected(error.code)from None
        decoded=providers.decode_task(validation_answer,item['child'],store,item['task'])
        need(decoded.get('complete')is True,'PERIOD_COST_SOURCE_INCOMPLETE')
        _receipt(worker,row,request,state,raw)
        ident=str(state['event_ids'][-1]);proof=state['receipts'][ident]
        packet={'operation':costs.CATALOG['sources'][item['component']]['operation'],'scope':deepcopy(desc['scope']),
                'request':deepcopy(request.body),'body_b64':base64.b64encode(raw).decode(),
                'received_at':proof['received_at'],'receipt_id':ident,'response_sha256':sha256(raw).hexdigest(),'http':200}
        # Scalar shape validation precedes checkpoint. The stricter agreed
        # economics storage presence/full-day coverage is checked on restore.
        state['packets'].append(packet);save_progress(_seal(worker.repo,row,desc,state))
    worker._call(row,request,store,before_dispatch=before_dispatch,on_received=received,capture_answer_data=False)
