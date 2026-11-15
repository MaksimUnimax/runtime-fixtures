"""Reconcile observed OTHER sources within the parent's existing Worker job.

The source checkpoint retains encrypted provider packets and a frozen as-of
time. Current report authority is checked independently on every restore. It
does not classify ORIGINAL fees, refresh a completed financial snapshot, grant
report authority, or invoke a second client or job.
"""
from collections import defaultdict
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from pathlib import Path
import base64, secrets
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from semantics import Rejected, canonical_json, strict_json, fingerprint
from protected_reads import key as encryption_key
from parameter_source_runtime import _token
from period_cost_source_runtime import _transport_body
from parameter_support import economics_other as source
import order_source_runtime as order_source
import read_surface

OPERATIONS=(source.CATALOG['posting_operation'],source.CATALOG['day_operation'])
POSTING_LIMIT=source.CATALOG['maximum_postings_per_request']
PIN=fingerprint({'code':sha256(Path(__file__).read_bytes()).hexdigest(),
    'normalizer':sha256(Path(source.__file__).read_bytes()).hexdigest(),'catalog':source.HASH,
    'accruals':sha256(Path(source.accruals.__file__).read_bytes()).hexdigest(),
    'orders':order_source.PIN,'read_surface':read_surface.PIN,
    'wire_encoder':sha256(Path(__import__('period_cost_source_runtime').__file__).read_bytes()).hexdigest()})


def need(ok,code):
    if not ok:raise Rejected(code)


def descriptor(root,store_id,period,order_checkpoint):
    try:source._dates(period)
    except source.OtherError as error:raise Rejected(error.code)from None
    stores=[store for store in root['stores']if store['id']==store_id]
    need(len(stores)==1 and stores[0]['platform']=='ozon'and stores[0].get('currency')=='RUB'
         and root.get('timezone')==source.CATALOG['timezone'],'OTHER_SOURCE_SCOPE')
    scope={'tenant_id':root['tenant'],'store_id':store_id,'provider':'OZON','currency':'RUB'}
    need(type(order_checkpoint)is dict and order_checkpoint.get('scope')==scope
         and order_checkpoint.get('period')==period
         and order_checkpoint.get('definition_hash')==source.order_source.HASH,'OTHER_ORDERS_CHANGED')
    orders_hash=fingerprint(order_checkpoint)
    return {'id':'other:'+fingerprint([root['tenant'],store_id,period,orders_hash]),'pin':PIN,
            'store_id':store_id,'scope':scope,'period':deepcopy(period),'orders_checkpoint_hash':orders_hash,
            'source_contracts':{operation:fingerprint(read_surface.method('ozon',operation))for operation in OPERATIONS}}


def _guard(worker,row,root,desc,order_desc,order_packed,authorize):
    need(callable(authorize),'OTHER_REPORT_AUTHORITY_REQUIRED')
    need(worker.engine.authorized(root)and authorize()is True,'OTHER_REPORT_REVOKED')
    need(row['tenant']==root['tenant'],'OTHER_SOURCE_SCOPE')
    # A public QualifiedOrders constructor or caller-supplied raw posting list
    # cannot supply evidence. Reopen the same-job native order source instead.
    orders,numbers=order_source.restore_with_posting_numbers(worker,row,root,order_desc,order_packed,authorize=authorize)
    need(desc==descriptor(root,desc['store_id'],desc['period'],orders.checkpoint()),'OTHER_ORDERS_CHANGED')
    store=next(store for store in root['stores']if store['id']==desc['store_id'])
    for operation in OPERATIONS:
        method=read_surface.method('ozon',operation)
        need(method.get('effect')=='READ'and read_surface.available(method),'OTHER_SOURCE_UNAVAILABLE')
        quota,_,_=read_surface.quota(store['platform'],operation)
        need(not worker.repo.denied(store['platform']+':'+store['identity']+':'+quota,store['access_revision']),'OTHER_SOURCE_ACCESS')
    need({_token(worker.repo,row,'posting',number)for number in numbers}==
         {item['posting']for item in orders.data['rows']},'OTHER_POSTING_SET_INCOMPLETE')
    return store,orders,numbers


def _aad(row,desc):return canonical_json({'job':row['id'],'tenant':row['tenant'],'descriptor':desc,'pin':PIN}).encode()


def _seal(repo,row,desc,state):
    nonce=secrets.token_bytes(12)
    return {'nonce':base64.b64encode(nonce).decode(),
        'cipher':base64.b64encode(AESGCM(encryption_key(repo)).encrypt(nonce,canonical_json(state).encode(),_aad(row,desc))).decode()}


def _open(repo,row,desc,packed):
    try:
        need(type(packed)is dict and set(packed)=={'nonce','cipher'},'OTHER_PROGRESS_INTEGRITY')
        state=strict_json(AESGCM(encryption_key(repo)).decrypt(base64.b64decode(packed['nonce'],validate=True),
            base64.b64decode(packed['cipher'],validate=True),_aad(row,desc)))
        need(type(state)is dict and set(state)=={'posting_packets','day_packets','receipts','captured_as_of'}
             and type(state['posting_packets'])is list and type(state['day_packets'])is list
             and type(state['receipts'])is dict
             and(state['captured_as_of']is None or type(state['captured_as_of'])is str),'OTHER_PROGRESS_INTEGRITY')
        return state
    except Exception:raise Rejected('OTHER_PROGRESS_INTEGRITY')from None


def _packet(value):
    try:
        result=deepcopy(value);result['body']=base64.b64decode(result.pop('body_b64'),validate=True);return result
    except (KeyError,TypeError,ValueError):raise Rejected('OTHER_PROGRESS_INTEGRITY')from None


def _request(store,operation,params):
    need(operation in OPERATIONS,'OTHER_SOURCE_UNAVAILABLE')
    request=read_surface.request_for(store,operation,params)
    need(request.body=={'params':params},'OTHER_SOURCE_REQUEST_CHANGED')
    return request


def _verifier(worker,row,root,desc,state,order_desc,order_packed,authorize):
    # _inspect/_normalize surround this synchronous proof pass with fresh full
    # guards. A receipt verifier checks data and ledger identity; it must not
    # recursively restore every order again for each financial packet.
    store=next(store for store in root['stores']if store['id']==desc['store_id'])
    def verify(packet):
        if packet['operation']not in OPERATIONS or packet['scope']!=desc['scope']:return False
        request=_request(store,packet['operation'],packet['request'])
        expected={'source':request.source,'operation':request.operation,'request_hash':fingerprint(packet['request']),
                  'response_hash':packet['response_sha256'],'received_at':packet['received_at']}
        if state['receipts'].get(packet['receipt_id'])!=expected:return False
        with worker.repo.connection()as connection:
            event=connection.execute('SELECT jid,source,state,http FROM calls WHERE id=?',(packet['receipt_id'],)).fetchone()
        return event is not None and event['jid']==row['id']and event['source']==request.source and event['state']=='RECEIVED'and event['http']==200
    return verify


def _inspect(worker,row,root,desc,state,order_desc,order_packed,authorize):
    """Derive the next registered request from the protected packet history.

    This is a prefix validator, not a replacement for final R11 normalization.
    No total days/pages quota or caller-controlled completion flag is used.
    """
    _,orders,numbers=_guard(worker,row,root,desc,order_desc,order_packed,authorize)
    verify=_verifier(worker,row,root,desc,state,order_desc,order_packed,authorize)
    encode=lambda kind,value:_token(worker.repo,row,kind,value)
    try:
        now=datetime.fromtimestamp(worker.repo.clock(),timezone.utc)
        clock=now if state['captured_as_of']is None else source._stamp(state['captured_as_of'])
        need(clock<=now,'OTHER_FUTURE_OBSERVATION')
        begin,end=source._dates(desc['period']);last=clock.astimezone(source.ZONE).date()
        prior=source._stamp(orders.data['observation_to'])
        need(end<=last and prior<=clock,'OTHER_FUTURE_PERIOD')
        postings=defaultdict(list)
        for item in orders.data['rows']:postings[item['posting']].append(item)
        batches=[numbers[start:start+POSTING_LIMIT]for start in range(0,len(numbers),POSTING_LIMIT)]
        need(len(state['posting_packets'])<=len(batches),'OTHER_POSTING_SET_INCOMPLETE')
        used=set();order_receipts=set(orders.checkpoint()['receipts'])
        def read(saved,operation,request):
            nonlocal prior
            packet=_packet(saved)
            need(packet['request']==request,'OTHER_SOURCE_REQUEST_CHANGED')
            data=source._read(packet,operation,desc['scope'],verify,clock)
            stamp=source._stamp(packet['received_at'])
            need(stamp>=prior,'OTHER_SOURCE_SEQUENCE');prior=stamp
            ident=packet['receipt_id']
            need(ident not in used and encode('source-receipt',ident)not in order_receipts,'OTHER_RECEIPT_REUSED');used.add(ident)
            return data,stamp
        for index,saved in enumerate(state['posting_packets']):
            batch=batches[index];data,received=read(saved,OPERATIONS[0],{'posting_numbers':batch})
            need(type(data)is dict and set(data)=={'posting_accruals'}and type(data['posting_accruals'])is list,'OTHER_POSTING_RESPONSE')
            returned=set()
            for value in data['posting_accruals']:
                need(type(value)is dict and set(value)=={'posting_number','accruals'}and type(value['accruals'])is list,'OTHER_POSTING_RESPONSE')
                number=source._identifier(value['posting_number'])
                need(number in batch and number not in returned,'OTHER_POSTING_RESPONSE_SET');returned.add(number)
                posting=encode('posting',number)
                for entry in value['accruals']:
                    parsed=source._entry(entry,posting,received);source._line_scope(parsed,postings)
                    begin=min(begin,source._dates({'from':parsed['accrual_day'],'to':parsed['accrual_day']})[0])
            need(returned==set(batch),'OTHER_POSTING_SET_INCOMPLETE')
        pending=None
        if len(state['posting_packets'])<len(batches):
            need(not state['day_packets'],'OTHER_SOURCE_PHASE')
            pending={'operation':OPERATIONS[0],'params':{'posting_numbers':batches[len(state['posting_packets'])]}}
        else:
            day=begin;cursor='';seen=set();records={}
            for saved in state['day_packets']:
                need(day<=last,'ACCRUAL_EXTRA_PAGE')
                data,received=read(saved,OPERATIONS[1],{'date':day.isoformat(),'last_id':cursor})
                need(received.astimezone(source.ZONE).date()>=day,'ACCRUAL_OBSERVATION_CLOCK')
                source.accruals.exact(data,('accruals','last_id'))
                need(type(data['accruals'])is list and type(data['last_id'])is str,'ACCRUAL_RESPONSE_SCHEMA')
                for record in data['accruals']:
                    need(type(record)is dict and record.get('date')==day.isoformat(),'ACCRUAL_DATE_MISMATCH')
                    parsed=source.accruals.extract(record,encode)
                    previous=records.setdefault(parsed['id'],parsed)
                    need(previous==parsed,'ACCRUAL_ID_CONTENT_CHANGED')
                    for atom in parsed['atoms']:
                        posting=atom['unit_key']
                        if posting not in postings:continue
                        need(atom['type_id']in source.KNOWN,'OTHER_UNCLASSIFIED_FEE')
                        source._line_scope({'posting':posting,'sku':atom['sku']},postings)
                        need(atom['scheme']is None or atom['scheme'].lower()==postings[posting][0]['scheme'],'OTHER_SCHEME_MISMATCH')
                following=data['last_id']
                if following:
                    need(bool(data['accruals'])and following!=cursor and following not in seen,'ACCRUAL_CURSOR_NO_PROGRESS')
                    seen.add(following);cursor=following
                else:day+=timedelta(days=1);cursor='';seen=set()
            if day<=last:pending={'operation':OPERATIONS[1],'params':{'date':day.isoformat(),'last_id':cursor}}
        need(used==set(state['receipts']),'OTHER_RECEIPT_SET')
        need(state['captured_as_of']is None or pending is None,'OTHER_SOURCE_INCOMPLETE')
        _guard(worker,row,root,desc,order_desc,order_packed,authorize)
        return pending,orders,clock.isoformat()
    except (source.OtherError,source.accruals.AccrualError,source.c.ParameterError)as error:raise Rejected(error.code)from None


def _normalize(worker,row,root,desc,state,order_desc,order_packed,authorize):
    need(state['captured_as_of']is not None,'OTHER_SOURCE_INCOMPLETE')
    pending,orders,_=_inspect(worker,row,root,desc,state,order_desc,order_packed,authorize)
    need(pending is None,'OTHER_SOURCE_INCOMPLETE')
    try:
        value=source.normalize([_packet(item)for item in state['posting_packets']],
            [_packet(item)for item in state['day_packets']],orders,
            verify=_verifier(worker,row,root,desc,state,order_desc,order_packed,authorize),
            encode=lambda kind,value:_token(worker.repo,row,kind,value),as_of=state['captured_as_of'])
        _guard(worker,row,root,desc,order_desc,order_packed,authorize)
        return value
    except (source.OtherError,source.c.ParameterError)as error:raise Rejected(error.code)from None


def restore(worker,row,root,desc,packed,*,order_desc,order_packed,authorize):
    _guard(worker,row,root,desc,order_desc,order_packed,authorize)
    return _normalize(worker,row,root,desc,_open(worker.repo,row,desc,packed),order_desc,order_packed,authorize)


def step(worker,row,root,desc,packed,*,order_desc,order_packed,authorize,save_progress,on_complete):
    store,_,_=_guard(worker,row,root,desc,order_desc,order_packed,authorize)
    state={'posting_packets':[],'day_packets':[],'receipts':{},'captured_as_of':None}if packed is None else _open(worker.repo,row,desc,packed)
    pending,_,captured=_inspect(worker,row,root,desc,state,order_desc,order_packed,authorize)
    if pending is None:
        if state['captured_as_of']is None:
            state['captured_as_of']=captured
            _normalize(worker,row,root,desc,state,order_desc,order_packed,authorize)
            save_progress(_seal(worker.repo,row,desc,state));return
        on_complete(_normalize(worker,row,root,desc,state,order_desc,order_packed,authorize),packed);return
    request=_request(store,pending['operation'],pending['params'])
    def before_dispatch():_guard(worker,row,root,desc,order_desc,order_packed,authorize)
    prerequisite=worker.transport.prepare(request,store)if hasattr(worker.transport,'prepare')else None
    if prerequisite:
        worker._call(row,prerequisite,store,before_dispatch=before_dispatch,
            on_received=lambda answer:_guard(worker,row,root,desc,order_desc,order_packed,authorize),capture_answer_data=False)
        save_progress(_seal(worker.repo,row,desc,state));return
    def received(answer):
        _guard(worker,row,root,desc,order_desc,order_packed,authorize)
        need(type(answer)is dict,'OTHER_RESPONSE_SCHEMA');raw=_transport_body(answer)
        with worker.repo.connection()as connection:
            event=connection.execute('SELECT id,state,http FROM calls WHERE jid=?AND source=?ORDER BY id DESC LIMIT 1',
                                     (row['id'],request.source)).fetchone()
        need(event is not None and event['state']=='RECEIVED'and event['http']==200,'OTHER_RECEIPT_MISSING')
        ident=str(event['id']);need(ident not in state['receipts'],'OTHER_RECEIPT_REUSED')
        stamp=datetime.fromtimestamp(worker.repo.clock(),timezone.utc).isoformat()
        state['receipts'][ident]={'source':request.source,'operation':request.operation,
            'request_hash':fingerprint(request.body['params']),'response_hash':sha256(raw).hexdigest(),'received_at':stamp}
        packet={'operation':pending['operation'],'scope':deepcopy(desc['scope']),'request':deepcopy(request.body['params']),
            'body_b64':base64.b64encode(raw).decode(),'received_at':stamp,'receipt_id':ident,
            'response_sha256':sha256(raw).hexdigest(),'http':200}
        state['posting_packets'if pending['operation']==OPERATIONS[0]else'day_packets'].append(packet)
        following,_,captured=_inspect(worker,row,root,desc,state,order_desc,order_packed,authorize)
        if following is None:
            state['captured_as_of']=captured
            _normalize(worker,row,root,desc,state,order_desc,order_packed,authorize)
        save_progress(_seal(worker.repo,row,desc,state))
    worker._call(row,request,store,before_dispatch=before_dispatch,on_received=received,capture_answer_data=False)
