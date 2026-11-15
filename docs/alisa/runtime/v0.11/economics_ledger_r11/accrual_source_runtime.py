"""One registered READ page per existing Worker dispatch; no new queue/client.

This source leaf returns observed identities, NOT original forecast debits. The
caller owns compile/admission and completion; no client callable route is added.
"""
from datetime import date,datetime,timedelta,timezone
from pathlib import Path
from hashlib import sha256
from copy import deepcopy
import base64,json,secrets
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from semantics import Rejected,canonical_json,strict_json,fingerprint
from protected_reads import key as encryption_key
from parameter_support import economics_accruals as source
from parameter_source_runtime import _receipt,_token
import read_surface

PIN=fingerprint({'code':sha256(Path(__file__).read_bytes()).hexdigest(),
                 'source':sha256(Path(source.__file__).read_bytes()).hexdigest(),'read_surface':read_surface.PIN})

def need(ok,code):
 if not ok:raise Rejected(code)

def descriptor(root,store_id,period):
 source.c.dates(period);stores=[s for s in root['stores']if s['id']==store_id]
 need(len(stores)==1 and stores[0]['platform']=='ozon','ACCRUAL_SCOPE')
 return {'id':'accrual:'+fingerprint([store_id,period]),'pin':PIN,'store_id':store_id,
         'period':deepcopy(period),'scope':{'tenant_id':root['tenant'],'store_id':store_id,'provider':'OZON','currency':'RUB'}}

def _aad(row,desc):return canonical_json({'job':row['id'],'tenant':row['tenant'],'descriptor':desc,'pin':PIN}).encode()
def _seal(repo,row,desc,state):
 nonce=secrets.token_bytes(12);raw=canonical_json(state).encode()
 return {'nonce':base64.b64encode(nonce).decode(),'cipher':base64.b64encode(AESGCM(encryption_key(repo)).encrypt(nonce,raw,_aad(row,desc))).decode()}

def _open(repo,row,desc,packed):
 try:return strict_json(AESGCM(encryption_key(repo)).decrypt(base64.b64decode(packed['nonce'],validate=True),base64.b64decode(packed['cipher'],validate=True),_aad(row,desc)))
 except Exception:raise Rejected('ACCRUAL_PROGRESS_INTEGRITY')from None

def _verifier(worker,row,store,state):
 def verify(page):
  ident=str(page['receipt_id']);proof=state['receipts'].get(ident)
  if proof is None:return False
  request=read_surface.request_for(store,source.OPERATION,page['request'])
  if (proof['source']!=request.source or proof['operation']!=request.operation or
      proof['request_hash']!=fingerprint(page['request'])or proof['response_hash']!=source.digest(page['data'])or
      proof['received_at']!=page['received_at']):return False
  with worker.repo.connection()as c:
   event=c.execute('SELECT jid,source,state,http FROM calls WHERE id=?',(ident,)).fetchone()
   return event is not None and event['jid']==row['id']and event['source']==request.source and event['state']=='RECEIVED'and event['http']==200
 return verify


def step(worker,row,root,desc,packed,*,save_progress,on_complete):
 """Callbacks belong to the existing parent fragment, not a second executor."""
 need(worker.engine.authorized(root),'SOURCE_ACCESS')
 need(desc==descriptor(root,desc['store_id'],desc['period']),'ACCRUAL_DESCRIPTOR_CHANGED')
 store=next(s for s in root['stores']if s['id']==desc['store_id'])
 state={'day':desc['period']['from'],'cursor':'','seen':[],'pages':[],'event_ids':[],'receipts':{},'first_observed':None}if packed is None else _open(worker.repo,row,desc,packed)
 try:
  if state['day']>desc['period']['to']:
   need(worker.engine.authorized(root),'SOURCE_ACCESS')
   output=source.normalize(state['pages'],desc['scope'],desc['period'],
       verify=_verifier(worker,row,store,state),encode=lambda kind,v:_token(worker.repo,row,kind,v),
       as_of=datetime.fromtimestamp(worker.repo.clock(),timezone.utc).isoformat())
   need(worker.engine.authorized(root),'SOURCE_ACCESS');on_complete(output);return
  request=read_surface.request_for(store,source.OPERATION,{'date':state['day'],'last_id':state['cursor']})
  def received(answer):
   need(worker.engine.authorized(root),'SOURCE_ACCESS')
   stamp=_receipt(worker,row,request,state,answer)
   need(type(answer)is dict and set(answer)=={'accruals','last_id'}and type(answer['accruals'])is list and type(answer['last_id'])is str,'ACCRUAL_RESPONSE_SCHEMA')
   # Reject invalid pages before persisting a misleading terminal checkpoint.
   for record in answer['accruals']:
    need(record.get('date')==state['day'],'ACCRUAL_DATE_MISMATCH')
    source.extract(record,lambda kind,v:_token(worker.repo,row,kind,v))
   next_cursor=answer['last_id']
   if next_cursor:
    need(answer['accruals']and next_cursor!=state['cursor']and next_cursor not in state['seen'],'ACCRUAL_CURSOR_NO_PROGRESS')
   page={'operation':source.OPERATION,'scope':deepcopy(desc['scope']),'request':deepcopy(request.body['params']),
         'data':deepcopy(answer),'received_at':stamp,'receipt_id':str(state['event_ids'][-1])}
   state['pages'].append(page)
   if next_cursor:state['seen'].append(next_cursor);state['cursor']=next_cursor
   else:state.update(day=(date.fromisoformat(state['day'])+timedelta(days=1)).isoformat(),cursor='',seen=[])
   save_progress(_seal(worker.repo,row,desc,state))
  worker._call(row,request,store,on_received=received)
 except (source.AccrualError,source.c.ParameterError)as error:raise Rejected(error.code)from None
