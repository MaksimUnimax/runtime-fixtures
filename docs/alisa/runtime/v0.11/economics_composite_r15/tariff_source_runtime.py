"""Current tariff pages and verified SKU mapping in the parent's existing job.

The parent owns the report, queue and publication fence. This leaf grants no
permission, creates no second job and never calls a provider outside Worker.
Only AEAD source packets, not previous coefficient values, survive recovery.
"""
from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import base64, json, secrets
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from semantics import Rejected, canonical_json, strict_json, fingerprint
from protected_reads import key as encryption_key
from parameter_source_runtime import _token
from period_cost_source_runtime import _transport_body
from parameter_support import economics_tariffs as source
import read_surface

# These are the documented per-request capacities, not total report quotas.
PRICE_LIMIT=1000
PRODUCT_LIMIT=1000
FILTER={'visibility':'ALL'}
OPERATIONS=(source.CATALOG['price_operation'],source.CATALOG['product_operation'])
PIN=fingerprint({'code':sha256(Path(__file__).read_bytes()).hexdigest(),
    'normalizer':sha256(Path(source.__file__).read_bytes()).hexdigest(),
    'catalog':source.HASH,'read_surface':read_surface.PIN,
    'wire_encoder':sha256(Path(__import__('period_cost_source_runtime').__file__).read_bytes()).hexdigest(),
    'limits':[PRICE_LIMIT,PRODUCT_LIMIT],'filter':FILTER})

def need(ok,code):
    if not ok:raise Rejected(code)

def descriptor(root,store_id):
    stores=[s for s in root['stores']if s['id']==store_id]
    need(len(stores)==1 and stores[0]['platform']=='ozon','TARIFF_SOURCE_SCOPE')
    return {'id':'tariffs:'+fingerprint([root['tenant'],store_id]),'pin':PIN,
        'store_id':store_id,'scope':{'tenant_id':root['tenant'],'store_id':store_id,
                                  'provider':'OZON','currency':'RUB'}}

def _guard(worker,row,root,desc,authorize):
    need(callable(authorize),'TARIFF_REPORT_AUTHORITY_REQUIRED')
    need(worker.engine.authorized(root)and authorize()is True,'TARIFF_REPORT_REVOKED')
    need(row['tenant']==root['tenant']and desc==descriptor(root,desc['store_id']),'TARIFF_SOURCE_SCOPE')
    need(all(read_surface.available(read_surface.method('ozon',op))for op in OPERATIONS),'TARIFF_SOURCE_UNAVAILABLE')
    return next(s for s in root['stores']if s['id']==desc['store_id'])

def _aad(row,desc):return canonical_json({'job':row['id'],'tenant':row['tenant'],'descriptor':desc,'pin':PIN}).encode()

def _seal(repo,row,desc,state):
    nonce=secrets.token_bytes(12)
    return {'nonce':base64.b64encode(nonce).decode(),
        'cipher':base64.b64encode(AESGCM(encryption_key(repo)).encrypt(nonce,canonical_json(state).encode(),_aad(row,desc))).decode()}

def _open(repo,row,desc,packed):
    try:
        need(type(packed)is dict and set(packed)=={'nonce','cipher'},'TARIFF_PROGRESS_INTEGRITY')
        state=strict_json(AESGCM(encryption_key(repo)).decrypt(base64.b64decode(packed['nonce'],validate=True),
            base64.b64decode(packed['cipher'],validate=True),_aad(row,desc)))
        need(type(state)is dict and set(state)=={'phase','cursor','seen_cursors','total','product_ids','mapped',
            'price_pages','product_pages','receipts'},'TARIFF_PROGRESS_INTEGRITY')
        need(state['phase']in('prices','products','ready'),'TARIFF_PROGRESS_INTEGRITY')
        return state
    except Exception:raise Rejected('TARIFF_PROGRESS_INTEGRITY')from None

def _packet(value):
    result=deepcopy(value);result['body']=base64.b64decode(result.pop('body_b64'),validate=True);return result

def _request(store,state):
    if state['phase']=='prices':
        return read_surface.request_for(store,OPERATIONS[0],{'filter':deepcopy(FILTER),'cursor':state['cursor'],'limit':PRICE_LIMIT})
    need(state['phase']=='products'and state['mapped']<len(state['product_ids']),'TARIFF_SOURCE_STATE')
    ids=state['product_ids'][state['mapped']:state['mapped']+PRODUCT_LIMIT]
    return read_surface.request_for(store,OPERATIONS[1],{'product_id':ids})

def _verifier(worker,row,root,desc,state,authorize):
    def verify(packet):
        store=_guard(worker,row,root,desc,authorize)
        record=state['receipts'].get(packet['receipt_id'])
        if record is None or packet['scope']!=desc['scope']or packet['operation']not in OPERATIONS:return False
        request=read_surface.request_for(store,packet['operation'],packet['request'])
        if record!={'source':request.source,'operation':request.operation,'request_hash':fingerprint(packet['request']),
            'response_hash':packet['response_sha256'],'received_at':packet['received_at']}:return False
        with worker.repo.connection()as connection:
            event=connection.execute('SELECT jid,source,state,http FROM calls WHERE id=?',(packet['receipt_id'],)).fetchone()
        return event is not None and event['jid']==row['id']and event['source']==request.source and event['state']=='RECEIVED'and event['http']==200
    return verify

def _normalize(worker,row,root,desc,state,authorize):
    need(state['phase']=='ready'and state['mapped']==len(state['product_ids']),'TARIFF_SOURCE_INCOMPLETE')
    need(state['price_pages']and state['product_pages'],'TARIFF_SOURCE_INCOMPLETE')
    prices=[_packet(p)for p in state['price_pages']];products=[_packet(p)for p in state['product_pages']]
    need(all(p['request'].get('filter')==FILTER and p['request'].get('limit')==PRICE_LIMIT for p in prices),'TARIFF_SOURCE_REQUEST_CHANGED')
    expected=[state['product_ids'][i:i+PRODUCT_LIMIT]for i in range(0,len(state['product_ids']),PRODUCT_LIMIT)]
    need([p['request']for p in products]==[{'product_id':ids}for ids in expected],'TARIFF_MAPPING_REQUEST_CHANGED')
    try:
        result=source.normalize(prices,products,desc['scope'],verify=_verifier(worker,row,root,desc,state,authorize),
            encode=lambda kind,value:_token(worker.repo,row,kind,value))
        _guard(worker,row,root,desc,authorize);return result
    except (source.TariffError,source.c.ParameterError)as error:raise Rejected(error.code)from None

def restore(worker,row,root,desc,packed,*,authorize):
    _guard(worker,row,root,desc,authorize)
    return _normalize(worker,row,root,desc,_open(worker.repo,row,desc,packed),authorize)

def step(worker,row,root,desc,packed,*,authorize,save_progress,on_complete):
    store=_guard(worker,row,root,desc,authorize)
    state={'phase':'prices','cursor':'','seen_cursors':[],'total':None,'product_ids':[],
        'mapped':0,'price_pages':[],'product_pages':[],'receipts':{}}if packed is None else _open(worker.repo,row,desc,packed)
    if state['phase']=='ready':
        on_complete(_normalize(worker,row,root,desc,state,authorize),packed);return
    request=_request(store,state)
    need(read_surface.method('ozon',request.operation.rsplit('.',1)[-1])['effect']=='READ','TARIFF_NOT_READ')
    def before_dispatch():_guard(worker,row,root,desc,authorize)
    prerequisite=worker.transport.prepare(request,store)if hasattr(worker.transport,'prepare')else None
    if prerequisite:
        worker._call(row,prerequisite,store,before_dispatch=before_dispatch)
        save_progress(_seal(worker.repo,row,desc,state));return
    def received(answer):
        _guard(worker,row,root,desc,authorize)
        need(type(answer)is dict,'TARIFF_RESPONSE_SCHEMA')
        raw=_transport_body(answer)
        with worker.repo.connection()as connection:
            event=connection.execute('SELECT id,state,http FROM calls WHERE jid=? AND source=? ORDER BY id DESC LIMIT 1',
                (row['id'],request.source)).fetchone()
        need(event is not None and event['state']=='RECEIVED'and event['http']==200,'TARIFF_RECEIPT_MISSING')
        ident=str(event['id']);need(ident not in state['receipts'],'TARIFF_RECEIPT_REUSED')
        stamp=datetime.fromtimestamp(worker.repo.clock(),timezone.utc).isoformat()
        record={'source':request.source,'operation':request.operation,'request_hash':fingerprint(request.body['params']),
            'response_hash':sha256(raw).hexdigest(),'received_at':stamp}
        packet={'operation':request.operation.rsplit('.',1)[-1],'scope':deepcopy(desc['scope']),
            'request':deepcopy(request.body['params']),'body_b64':base64.b64encode(raw).decode(),
            'received_at':stamp,'receipt_id':ident,'response_sha256':record['response_hash'],'http':200}
        try:
            if state['phase']=='prices':
                need({'items','cursor','total'}<=set(answer)<={'items','cursor','total','total_items'}and type(answer['items'])is list
                    and type(answer['cursor'])is str and type(answer['total'])is int and answer['total']>=0,'TARIFF_RESPONSE_SCHEMA')
                need(answer.get('total_items',answer['total'])==answer['total'],'TARIFF_TOTAL_CHANGED')
                if state['total']is None:state['total']=answer['total']
                need(state['total']==answer['total'],'TARIFF_TOTAL_CHANGED')
                need(all(type(p)is dict for p in answer['items']),'TARIFF_RESPONSE_SCHEMA')
                ids=[source.identifier(p.get('product_id'))for p in answer['items']]
                need(len(ids)==len(set(ids))and not set(ids)&set(state['product_ids']),'TARIFF_DUPLICATE_PRODUCT')
                state['product_ids'].extend(ids);cursor=answer['cursor']
                need(len(state['product_ids'])<=state['total'],'TARIFF_TOTAL_CHANGED')
                if cursor:
                    need(bool(ids)and cursor!=state['cursor']and cursor not in state['seen_cursors'],'TARIFF_CURSOR_CHAIN')
                    state['seen_cursors'].append(cursor);state['cursor']=cursor
                else:
                    need(len(state['product_ids'])==state['total'],'TARIFF_TOTAL_INCOMPLETE')
                    need(bool(state['product_ids']),'TARIFF_EMPTY_CATALOG')
                    state['phase']='products'
                state['price_pages'].append(packet)
            else:
                need(set(answer)=={'items'}and type(answer['items'])is list,'TARIFF_PRODUCT_RESPONSE')
                need(all(type(p)is dict for p in answer['items']),'TARIFF_PRODUCT_RESPONSE')
                ids=[source.identifier(p.get('id'))for p in answer['items']]
                need(len(ids)==len(set(ids))and set(ids)==set(request.body['params']['product_id']),'TARIFF_PRODUCT_MAPPING_INCOMPLETE')
                for item in answer['items']:source.identifier(item.get('sku'))
                state['mapped']+=len(ids);state['product_pages'].append(packet)
                if state['mapped']==len(state['product_ids']):state['phase']='ready'
            state['receipts'][ident]=record
            if state['phase']=='ready':_normalize(worker,row,root,desc,state,authorize)
        except (source.TariffError,source.c.ParameterError)as error:raise Rejected(error.code)from None
        save_progress(_seal(worker.repo,row,desc,state))
    worker._call(row,request,store,before_dispatch=before_dispatch,on_received=received,capture_answer_data=False)
