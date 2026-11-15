"""Lossless observed fee identities from the registered Ozon by-day source.

An accrual ID identifies a source record, not the original/correction role of a
fee. This module deliberately does not manufacture that role from an amount.
Only a trusted existing-job receipt verifier admits pages; no HTTP/DB/model IO.
"""
from copy import deepcopy
from dataclasses import dataclass
from datetime import timedelta
from hashlib import sha256
import json,re
from . import parameter_contract as c

OPERATION='finance_accrual_by_day'
SCHEMA='alisa-observed-accrual-stream/v1'
REASON='ECONOMICS_ORIGINAL_EVENT_RELATION_UNPROVEN'

class AccrualError(ValueError):
 def __init__(self,code):self.code=code;super().__init__(code)

def need(ok,code):
 if not ok:raise AccrualError(code)

def canonical(value):return c.CANON(value)
def digest(value):return sha256(canonical(value).encode()).hexdigest()
def exact(value,keys):need(type(value)is dict and set(value)==set(keys),'ACCRUAL_SCHEMA')

def _id(value):
 need(type(value)in(str,int)and type(value)is not bool,'ACCRUAL_IDENTIFIER')
 text=str(value);need(bool(text)and not any(ord(x)<32 for x in text),'ACCRUAL_IDENTIFIER');return text

def _money(value):
 exact(value,('amount','currency'));need(value['currency']=='RUB','ACCRUAL_CURRENCY')
 return c.decimal_text(c.number(value['amount']))

def _quantity(value):
 need(type(value)is int and value!=0,'ACCRUAL_QUANTITY')
 return str(value)

def _sku(value):
 text=_id(value);c.scope({'kind':'sku','sku':text});return text


def extract(record,encode):
 """Stable component identity = actual accrual ID + unique semantic slot.

 List position and money are never identity. Repeated indistinguishable semantic
 slots are rejected rather than silently collapsed or numbered by array index.
 """
 need(type(record)is dict,'ACCRUAL_SCHEMA')
 required={'accrual_id','date','total_amount','accrued_category','posting','item_fees','non_item_fee','container_fees'}
 need(required<=set(record)<=required|{'unit_number'},'ACCRUAL_RECORD_SCHEMA')
 c.dates({'from':record['date'],'to':record['date']})
 parent=encode('accrual',_id(record['accrual_id']));need(type(parent)is str and re.fullmatch('[a-f0-9]{64}',parent),'ACCRUAL_ID_ENCODER')
 unit=record.get('unit_number');unit=None if unit in(None,'')else encode('posting',_id(unit))
 need(unit is None or type(unit)is str and re.fullmatch('[a-f0-9]{64}',unit),'ACCRUAL_ID_ENCODER')
 category=record['accrued_category'];need(category in('POSTING','ITEM','NON_ITEM'),'ACCRUAL_CATEGORY_UNSUPPORTED')
 active={'POSTING':'posting','ITEM':'item_fees','NON_ITEM':'non_item_fee'}[category]
 need(record[active]is not None and all(record[k]is None for k in('posting','item_fees','non_item_fee','container_fees')if k!=active),'ACCRUAL_CATEGORY_STRUCTURE')
 total=_money(record['total_amount']);atoms=[];slots=set();scheme=None
 def add(path,sku,kind,amount,quantity):
  need(type(kind)is int and kind>0,'ACCRUAL_FEE_TYPE')
  slot=(path,sku,kind);need(slot not in slots,'ACCRUAL_COMPONENT_ID_AMBIGUOUS');slots.add(slot)
  atoms.append({'id':digest([parent,*slot]),'accrual_key':parent,'unit_key':unit,'category':category,
                'scheme':scheme,'sku':sku,'type_id':kind,'amount':_money(amount),'quantity':quantity,
                'currency':'RUB','accrual_day':record['date'],'origin':'UNCLASSIFIED','parent_event_id':None})
 if category=='POSTING':
  value=record['posting'];exact(value,('delivery_schema','products'))
  need(value['delivery_schema']in('Fbo','Fbs'),'ACCRUAL_SCHEME');scheme=value['delivery_schema'].upper()
  need(unit is not None and type(value['products'])is list,'ACCRUAL_POSTING')
  skus=set()
  for product in value['products']:
   exact(product,('sku','quantity','delivery','commission'));sku=_sku(product['sku']);q=_quantity(product['quantity'])
   need(sku not in skus,'ACCRUAL_COMPONENT_ID_AMBIGUOUS');skus.add(sku)
   commission=product['commission']
   if commission is not None:
    need(type(commission)is dict and 'sale_commission'in commission,'ACCRUAL_COMMISSION_SCHEMA')
    if commission['sale_commission']is not None:add('posting.commission.sale_commission',sku,69,commission['sale_commission'],q)
   delivery=product['delivery']
   if delivery is not None:
    exact(delivery,('total_accrued','services'));_money(delivery['total_accrued'])
    need(type(delivery['services'])is list,'ACCRUAL_DELIVERY_SCHEMA')
    for fee in delivery['services']:
     exact(fee,('type_id','accrued'));add('posting.delivery.services',sku,fee['type_id'],fee['accrued'],q)
 elif category=='ITEM':
  value=record['item_fees'];exact(value,('fees',));need(type(value['fees'])is list,'ACCRUAL_ITEM_SCHEMA')
  skus=set()
  for item in value['fees']:
   exact(item,('sku','quantity','fees'));sku=_sku(item['sku']);q=_quantity(item['quantity']);need(sku not in skus,'ACCRUAL_COMPONENT_ID_AMBIGUOUS');skus.add(sku)
   need(type(item['fees'])is list,'ACCRUAL_ITEM_SCHEMA')
   for fee in item['fees']:
    exact(fee,('type_id','accrued'));add('item_fees.fees',sku,fee['type_id'],fee['accrued'],q)
 else:
  fee=record['non_item_fee'];exact(fee,('type_id','accrued'));add('non_item_fee',None,fee['type_id'],fee['accrued'],None)
 # Parent content is also pinned. A changed nested price/reward field cannot be
 # hidden by unchanged extracted expenses. Identical retrieval duplicates only.
 body=deepcopy(record);body['accrual_id']=parent
 if 'unit_number'in body:body['unit_number']=unit
 return {'id':parent,'content_hash':digest(body),'day':record['date'],'total_amount':total,
         'category':category,'atoms':sorted(atoms,key=lambda a:a['id'])}


@dataclass(frozen=True,repr=False)
class ObservedAccruals:
 payload_json:str
 def __repr__(self):return '<ObservedAccruals; not qualified original economics>'
 @property
 def data(self):return json.loads(self.payload_json)
 def summary(self):
  data=self.data
  return {k:deepcopy(data[k])for k in('schema','scope','financial_period','records','components','duplicate_records',
          'source_receipts','observation_from','observation_to','pagination_complete','original_economics_ready','reason')}
 def qualified_original_fees(self):
  # No endpoint-defined parent links or event-nature field were established.
  # Refuse rather than passing observed signed net entries to the forecast.
  raise AccrualError(REASON)


def normalize(pages,scope,financial_period,*,verify,encode,as_of):
 pages,scope,financial_period=deepcopy(pages),deepcopy(scope),deepcopy(financial_period)
 exact(scope,('tenant_id','store_id','provider','currency'))
 _id(scope['tenant_id']);_id(scope['store_id']);need(scope['provider']=='OZON'and scope['currency']=='RUB','ACCRUAL_SCOPE')
 begin,end=c.dates(financial_period);clock=c.stamp(as_of)
 from zoneinfo import ZoneInfo
 need(end<=clock.astimezone(ZoneInfo('Europe/Moscow')).date(),'ACCRUAL_FUTURE_PERIOD')
 need(type(pages)is list and pages,'ACCRUAL_MISSING_DAYS');need(callable(verify)and callable(encode),'ACCRUAL_RECEIPT_VERIFIER_REQUIRED')
 day=begin;cursor='';seen=set();records={};receipts=[];receipt_ids=set();duplicates=0;times=[]
 for page in pages:
  need(day<=end,'ACCRUAL_EXTRA_PAGE');exact(page,('operation','scope','request','data','received_at','receipt_id'))
  need(page['operation']==OPERATION and page['scope']==scope,'ACCRUAL_SCOPE');exact(page['request'],('date','last_id'))
  need(page['request']=={'date':day.isoformat(),'last_id':cursor},'ACCRUAL_PAGE_CHAIN')
  received=c.stamp(page['received_at']);need(received<=clock and received.astimezone(ZoneInfo('Europe/Moscow')).date()>=day,'ACCRUAL_OBSERVATION_CLOCK')
  need(not times or received>=times[-1],'ACCRUAL_OBSERVATION_ORDER');receipt_id=_id(page['receipt_id'])
  need(receipt_id not in receipt_ids,'ACCRUAL_RECEIPT_REUSED');receipt_ids.add(receipt_id)
  try:valid=verify(deepcopy(page))
  except Exception:raise AccrualError('ACCRUAL_RECEIPT_UNAVAILABLE')from None
  need(valid is True,'ACCRUAL_RECEIPT_REJECTED')
  response=page['data'];exact(response,('accruals','last_id'))
  need(type(response['accruals'])is list and type(response['last_id'])is str,'ACCRUAL_RESPONSE_SCHEMA')
  for record in response['accruals']:
   need(type(record)is dict,'ACCRUAL_RECORD_SCHEMA')
   need(record.get('date')==day.isoformat(),'ACCRUAL_DATE_MISMATCH');parsed=extract(record,encode)
   previous=records.setdefault(parsed['id'],parsed);need(previous==parsed,'ACCRUAL_ID_CONTENT_CHANGED')
   if previous is not parsed:duplicates+=1
  receipts.append({'receipt_id':str(page['receipt_id']),'request_hash':digest(page['request']),'response_hash':digest(response),'received_at':page['received_at']})
  times.append(received);next_cursor=response['last_id']
  if next_cursor:
   need(bool(response['accruals'])and next_cursor!=cursor and next_cursor not in seen,'ACCRUAL_CURSOR_NO_PROGRESS')
   seen.add(next_cursor);cursor=next_cursor
  else:day+=timedelta(days=1);cursor='';seen=set()
 need(day==end+timedelta(days=1)and cursor=='','ACCRUAL_INCOMPLETE_PAGINATION')
 atoms=[atom for key in sorted(records)for atom in records[key]['atoms']]
 payload={'schema':SCHEMA,'scope':scope,'financial_period':financial_period,'records':len(records),'components':len(atoms),
          'duplicate_records':duplicates,'source_receipts':receipts,'observation_from':min(times).isoformat(),'observation_to':max(times).isoformat(),
          'pagination_complete':True,'original_economics_ready':False,'reason':REASON,
          'observations':atoms,'parent_hashes':{k:v['content_hash']for k,v in sorted(records.items())},
          'identity_basis':'source accrual_id + unambiguous semantic component slot; not money/date/array position',
          'calendar_period_is_not_order_cohort':True,'later_accruals_not_claimed_absent':True}
 return ObservedAccruals(canonical(payload))
