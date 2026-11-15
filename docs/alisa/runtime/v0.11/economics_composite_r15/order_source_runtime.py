"""Attest complete native FBO/FBS order pages inside the existing parent job.

Uses registered requests, page decoding, Worker pacing/retries and its receipt
ledger. The parent remains responsible for admission, current report authority
and publication. Raw provider pages survive only in an authenticated encrypted
checkpoint; no coefficient values or unprotected answer capture are retained.
"""
from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal
from hashlib import sha256
from pathlib import Path
import base64, secrets
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from semantics import Rejected, canonical_json, strict_json, fingerprint
from protected_reads import key as encryption_key
from parameter_source_runtime import _token
from period_cost_source_runtime import _transport_body
from parameter_support import economics_orders as source
from matrix_core import MatrixError
import dataset_pipeline as datasets
import matrix_sources

OPERATIONS=tuple(source.CATALOG['schemes'][scheme]['operation']for scheme in source.SCHEMES)
PIN=fingerprint({'code':sha256(Path(__file__).read_bytes()).hexdigest(),
    'normalizer':sha256(Path(source.__file__).read_bytes()).hexdigest(),'catalog':source.HASH,
    'datasets':datasets.HASH,'dataset_code':sha256(Path(datasets.__file__).read_bytes()).hexdigest(),
    'decoder_code':sha256(Path(matrix_sources.__file__).read_bytes()).hexdigest(),
    'wire_encoder':sha256(Path(__import__('period_cost_source_runtime').__file__).read_bytes()).hexdigest()})


def need(ok,code):
    if not ok:raise Rejected(code)


def _window_contract():
    rule=source.CATALOG['request_window'];query=datasets.CATALOG['queries'].get(rule['query'])
    need(type(query)is dict and type(query.get('max_days'))is int and query['max_days']==rule['max_days']
         and fingerprint(query)==rule['query_sha256'],'ORDERS_WINDOW_CONTRACT_CHANGED')
    return deepcopy(rule)


def _proofs(engine,store,period,calendar_date):
    need(callable(engine.dataset_capabilities),'ORDERS_SOURCE_UNAVAILABLE')
    try:capabilities=engine.dataset_capabilities()
    except Exception:raise Rejected('ORDERS_SOURCE_UNAVAILABLE')from None
    need(type(capabilities)is dict and type(capabilities.get(store['id']))is dict,'ORDERS_SOURCE_UNAVAILABLE')
    result={}
    for scheme in source.SCHEMES:
        rule=source.CATALOG['schemes'][scheme];operation=rule['operation']
        need(datasets.SOURCES.fingerprint(operation)==rule['source_recipe_sha256'],'ORDERS_SOURCE_DEFINITION_CHANGED')
        spec=datasets.SOURCES.recipe(operation);proof=capabilities[store['id']].get(operation)
        need(spec['platform']==store['platform']and spec['method']in('GET','POST'),'ORDERS_SOURCE_DEFINITION_CHANGED')
        need(type(proof)is dict and proof.get('status')=='READ_ONLY_CANARY'
             and proof.get('dataset_source_hash')==datasets.SOURCES.hash
             and proof.get('dataset_query_hash')==datasets.HASH,'ORDERS_SOURCE_UNAVAILABLE')
        need(all(type(proof.get(k))is type(v)and proof.get(k)==v for k,v in spec['proof_requirements'].items()),'ORDERS_SOURCE_UNAVAILABLE')
        try:
            for window in source.windows(period):datasets.SOURCES.available(operation,window,calendar_date)
        except MatrixError as error:raise Rejected(error.code)from None
        result[operation]=fingerprint(proof)
    return result


def descriptor(engine,root,store_id,period):
    contract=_window_contract()
    try:coverage=source.windows(period)
    except source.OrderError as error:raise Rejected(error.code)from None
    stores=[store for store in root['stores']if store['id']==store_id]
    need(len(stores)==1 and stores[0]['platform']=='ozon'and stores[0].get('currency')=='RUB'
         and root.get('timezone')==source.CATALOG['timezone'],'ORDERS_SOURCE_SCOPE')
    return {'id':'orders:'+fingerprint([root['tenant'],store_id,period]),'pin':PIN,
        'store_id':store_id,'period':deepcopy(period),'windows':coverage,'window_contract':contract,
        'scope':{'tenant_id':root['tenant'],'store_id':store_id,'provider':'OZON','currency':'RUB'},
        'source_proofs':_proofs(engine,stores[0],period,root['calendar_date'])}


def _guard(worker,row,root,desc,authorize):
    need(callable(authorize),'ORDERS_REPORT_AUTHORITY_REQUIRED')
    need(worker.engine.authorized(root)and authorize()is True,'ORDERS_REPORT_REVOKED')
    need(row['tenant']==root['tenant']and desc==descriptor(worker.engine,root,desc['store_id'],desc['period']),'ORDERS_SOURCE_SCOPE')
    store=next(store for store in root['stores']if store['id']==desc['store_id'])
    for operation in OPERATIONS:
        name=store['platform']+':'+store['identity']+':'+datasets.SOURCES.recipe(operation)['quota_operation']
        need(not worker.repo.denied(name,store['access_revision']),'ORDERS_SOURCE_ACCESS')
    return store


def _aad(row,desc):return canonical_json({'job':row['id'],'tenant':row['tenant'],'descriptor':desc,'pin':PIN}).encode()


def _seal(repo,row,desc,state):
    nonce=secrets.token_bytes(12)
    return {'nonce':base64.b64encode(nonce).decode(),
        'cipher':base64.b64encode(AESGCM(encryption_key(repo)).encrypt(nonce,canonical_json(state).encode(),_aad(row,desc))).decode()}


def _open(repo,row,desc,packed):
    try:
        need(type(packed)is dict and set(packed)=={'nonce','cipher'},'ORDERS_PROGRESS_INTEGRITY')
        state=strict_json(AESGCM(encryption_key(repo)).decrypt(base64.b64decode(packed['nonce'],validate=True),
            base64.b64decode(packed['cipher'],validate=True),_aad(row,desc)))
        need(type(state)is dict and set(state)=={'pages','receipts'}and type(state['pages'])is dict
             and set(state['pages'])==set(source.SCHEMES)and all(type(pages)is list for pages in state['pages'].values())
             and type(state['receipts'])is dict,'ORDERS_PROGRESS_INTEGRITY')
        return state
    except Exception:raise Rejected('ORDERS_PROGRESS_INTEGRITY')from None


def _packet(value):
    try:
        result=deepcopy(value);result['body']=base64.b64decode(result.pop('body_b64'),validate=True);return result
    except (KeyError,TypeError,ValueError):raise Rejected('ORDERS_PROGRESS_INTEGRITY')from None


def _task(scheme,window):return {'source':source.CATALOG['schemes'][scheme]['operation'],'period':deepcopy(window),'params':{}}


def _request(root,store,desc,scheme,cursor,window):
    need(window in desc['windows'],'ORDERS_WINDOW_MISMATCH')
    request=datasets.build_request(root,store,_task(scheme,window),{'cursor':cursor})
    need(canonical_json(request.body)==canonical_json(source.expected_request(scheme,window,cursor)),'ORDERS_SOURCE_REQUEST_CHANGED')
    return request


def _verifier(worker,row,root,desc,state,authorize):
    coverage={canonical_json(source.expected_request(source.SCHEMES[0],window,'')['filter']):window for window in desc['windows']}
    # The enclosing synchronous replay checks current authority before and
    # after all packet proofs. Repeating that entire replay from each receipt
    # would multiply live authority calls at every composition level.
    store=next(store for store in root['stores']if store['id']==desc['store_id'])
    def verify(packet):
        scheme=next((name for name in source.SCHEMES if source.CATALOG['schemes'][name]['operation']==packet['operation']),None)
        if scheme is None or packet['scope']!=desc['scope']:return False
        window=coverage.get(canonical_json(packet['request'].get('filter')))
        if window is None:return False
        request=_request(root,store,desc,scheme,packet['request']['cursor'],window)
        if request.body!=packet['request']:return False
        record=state['receipts'].get(packet['receipt_id'])
        if record!={'source':request.source,'operation':request.operation,'request_hash':fingerprint(request.body),
                    'response_hash':packet['response_sha256'],'received_at':packet['received_at']}:return False
        with worker.repo.connection()as connection:
            event=connection.execute('SELECT jid,source,state,http FROM calls WHERE id=?',(packet['receipt_id'],)).fetchone()
        return event is not None and event['jid']==row['id']and event['source']==request.source and event['state']=='RECEIVED'and event['http']==200
    return verify


def _inspect(worker,row,root,desc,state,authorize):
    """Replay protected evidence to derive the next request, never trust a flag.

    Native decoding is per provider page (at most the registered 100 postings).
    Each call uses the existing posting_metadata query's conservative window.
    Full cross-page identities, cursor history and all report windows are
    checked here and by the pure normalizer. No total report-day/row/page quota.
    """
    store=_guard(worker,row,root,desc,authorize);verify=_verifier(worker,row,root,desc,state,authorize)
    pending=None;postings=set();receipt_ids=set();prior_stamp=None
    try:
        for scheme in source.SCHEMES:
            pages=state['pages'][scheme];index=0
            if pending is not None:
                need(not pages,'ORDERS_SOURCE_PHASE')
                continue
            for window in desc['windows']:
                cursor='';cursors=set();terminal=False
                while index<len(pages):
                    packet=_packet(pages[index])
                    page=source._page(packet,scheme,desc['scope'],window,cursor,verify=verify,
                                     encode=lambda kind,value:_token(worker.repo,row,kind,value))
                    need(not postings&page['postings'],'ORDERS_DUPLICATE_POSTING');postings.update(page['postings'])
                    need(packet['receipt_id']not in receipt_ids,'ORDERS_RECEIPT_REUSED');receipt_ids.add(packet['receipt_id'])
                    observed=source._stamp(packet['received_at'])
                    need(prior_stamp is None or observed>=prior_stamp,'ORDERS_OBSERVATION_ORDER');prior_stamp=observed
                    native=datasets.decode(root,store,_task(scheme,window),None,strict_json(packet['body'],parse_float=Decimal))
                    need(native['complete']is(not page['has_next']),'ORDERS_PAGINATION_DISAGREEMENT')
                    index+=1
                    if not page['has_next']:terminal=True;break
                    need(page['cursor']not in cursors,'ORDERS_CURSOR_CHAIN');cursors.add(page['cursor']);cursor=page['cursor']
                if not terminal:
                    pending={'scheme':scheme,'cursor':cursor,'window':deepcopy(window)};break
            need(index==len(pages),'ORDERS_PAGE_AFTER_TERMINAL')
        need(receipt_ids==set(state['receipts']),'ORDERS_RECEIPT_SET')
        _guard(worker,row,root,desc,authorize);return pending
    except (source.OrderError,source.c.ParameterError)as error:raise Rejected(error.code)from None


def _normalize(worker,row,root,desc,state,authorize):
    need(_inspect(worker,row,root,desc,state,authorize)is None,'ORDERS_SOURCE_INCOMPLETE')
    try:
        value=source.normalize(*([_packet(packet)for packet in state['pages'][scheme]]for scheme in source.SCHEMES),
            desc['scope'],desc['period'],verify=_verifier(worker,row,root,desc,state,authorize),
            encode=lambda kind,value:_token(worker.repo,row,kind,value))
        _guard(worker,row,root,desc,authorize);return value
    except (source.OrderError,source.c.ParameterError)as error:raise Rejected(error.code)from None


def restore(worker,row,root,desc,packed,*,authorize):
    _guard(worker,row,root,desc,authorize)
    return _normalize(worker,row,root,desc,_open(worker.repo,row,desc,packed),authorize)


def restore_with_posting_numbers(worker,row,root,desc,packed,*,authorize):
    """Return the verified orders and exact posting set from one replay.

    This is an internal handoff, never a checkpoint, answer or log payload.
    Full restore, actual receipts and fresh current authority are mandatory.
    """
    packed=deepcopy(packed)
    restored=restore(worker,row,root,desc,packed,authorize=authorize)
    state=_open(worker.repo,row,desc,packed);fields=source.CATALOG['response'];identifiers=[]
    for scheme in source.SCHEMES:
        for saved in state['pages'][scheme]:
            body=strict_json(_packet(saved)['body'],parse_float=Decimal)
            identifiers.extend(posting[fields['posting']]for posting in body[fields['postings']])
    need(len(identifiers)==len(set(identifiers)),'ORDERS_DUPLICATE_POSTING')
    need({_token(worker.repo,row,'posting',value)for value in identifiers}==
         {item['posting']for item in restored.data['rows']},'ORDERS_POSTING_SET')
    _guard(worker,row,root,desc,authorize)
    return restored,sorted(identifiers)


def posting_numbers(worker,row,root,desc,packed,*,authorize):
    return restore_with_posting_numbers(worker,row,root,desc,packed,authorize=authorize)[1]


def step(worker,row,root,desc,packed,*,authorize,save_progress,on_complete):
    store=_guard(worker,row,root,desc,authorize)
    state={'pages':{scheme:[]for scheme in source.SCHEMES},'receipts':{}}if packed is None else _open(worker.repo,row,desc,packed)
    pending=_inspect(worker,row,root,desc,state,authorize)
    if pending is None:
        on_complete(_normalize(worker,row,root,desc,state,authorize),packed);return
    request=_request(root,store,desc,pending['scheme'],pending['cursor'],pending['window'])
    def before_dispatch():_guard(worker,row,root,desc,authorize)
    prerequisite=worker.transport.prepare(request,store)if hasattr(worker.transport,'prepare')else None
    if prerequisite:
        worker._call(row,prerequisite,store,before_dispatch=before_dispatch,
                     on_received=lambda answer:_guard(worker,row,root,desc,authorize),capture_answer_data=False)
        save_progress(_seal(worker.repo,row,desc,state));return
    def received(answer):
        _guard(worker,row,root,desc,authorize);need(type(answer)is dict,'ORDERS_RESPONSE_SCHEMA')
        raw=_transport_body(answer)
        with worker.repo.connection()as connection:
            event=connection.execute('SELECT id,state,http FROM calls WHERE jid=?AND source=?ORDER BY id DESC LIMIT 1',
                                     (row['id'],request.source)).fetchone()
        need(event is not None and event['state']=='RECEIVED'and event['http']==200,'ORDERS_RECEIPT_MISSING')
        ident=str(event['id']);need(ident not in state['receipts'],'ORDERS_RECEIPT_REUSED')
        stamp=datetime.fromtimestamp(worker.repo.clock(),timezone.utc).isoformat()
        state['receipts'][ident]={'source':request.source,'operation':request.operation,
            'request_hash':fingerprint(request.body),'response_hash':sha256(raw).hexdigest(),'received_at':stamp}
        state['pages'][pending['scheme']].append({'operation':request.operation,'scope':deepcopy(desc['scope']),
            'request':deepcopy(request.body),'body_b64':base64.b64encode(raw).decode(),
            'received_at':stamp,'receipt_id':ident,'response_sha256':sha256(raw).hexdigest(),'http':200})
        _inspect(worker,row,root,desc,state,authorize)
        save_progress(_seal(worker.repo,row,desc,state))
    worker._call(row,request,store,before_dispatch=before_dispatch,on_received=received,capture_answer_data=False)
