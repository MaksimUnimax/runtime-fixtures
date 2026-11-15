"""Current price quotes joined to separately verified product_id -> SKU records.

A quote is not a historical debit. No financial event direction is guessed.
The caller verifies real receipts; this pure adapter never fetches or saves data.
"""
from copy import deepcopy
from dataclasses import dataclass,field
from decimal import Decimal
from hashlib import sha256
from pathlib import Path
import hmac,json,re,secrets
from . import parameter_contract as c
from . import economics_cohort as economics
from . import economics_realization as document

CATALOG=json.loads(Path(__file__).with_name('economics_tariff_catalog.json').read_text())
HASH=sha256(c.CANON(CATALOG).encode()).hexdigest()
_KEY=secrets.token_bytes(32)

class TariffError(ValueError):
 def __init__(self,code):self.code=code;super().__init__(code)

def need(ok,code):
 if not ok:raise TariffError(code)

def identifier(value):
 need(type(value)in(str,int)and re.fullmatch(r'[1-9][0-9]{0,19}',str(value))is not None,'TARIFF_PRODUCT_ID')
 return str(value)

def _stamp(value):
 try:return c.stamp(value)
 except c.ParameterError:raise TariffError('TARIFF_OBSERVATION')from None

def _encoded(encode,kind,value):
 result=encode(kind,value)
 need(type(result)is str and re.fullmatch(r'[a-f0-9]{64}',result)is not None,'TARIFF_SCOPED_ID')
 return result

def _read(packet,operation,target,verify):
 need(type(packet)is dict and set(packet)=={'operation','scope','request','body','received_at','receipt_id','response_sha256','http'},'TARIFF_PACKET_SCHEMA')
 need(packet['operation']==operation and packet['scope']==target and packet['http']==200,'TARIFF_SOURCE_SCOPE')
 need(type(packet['body'])is bytes and sha256(packet['body']).hexdigest()==packet['response_sha256'],'TARIFF_BODY_HASH')
 _stamp(packet['received_at'])
 need(type(packet['receipt_id'])is str and packet['receipt_id'],'TARIFF_RECEIPT')
 try:valid=verify(deepcopy(packet))
 except Exception:raise TariffError('TARIFF_RECEIPT_UNAVAILABLE')from None
 need(valid is True,'TARIFF_RECEIPT_REJECTED')
 try:return json.loads(packet['body'],parse_float=Decimal,parse_constant=document._constant,object_pairs_hook=document._pairs)
 except (ValueError,UnicodeError):raise TariffError('TARIFF_JSON')from None

def _field(row,path):
 if type(path)is dict:
  need(set(path)=={'constant'},'TARIFF_MAP');return c.number(path['constant'])
 try:
  for key in path:row=row[key]
  return document.number(row)
 except (KeyError,TypeError,document.RealizationError):raise TariffError('TARIFF_FIELD_MISSING_OR_INVALID')from None

def _seal(value):return hmac.new(_KEY,value.encode(),'sha256').hexdigest()

@dataclass(frozen=True,repr=False)
class CurrentTariffs:
 payload_json:str
 _proof:str=field(default='',repr=False)
 @property
 def data(self):
  need(type(self.payload_json)is str and type(self._proof)is str and hmac.compare_digest(self._proof,_seal(self.payload_json)),'TARIFF_UNQUALIFIED_OBJECT')
  return json.loads(self.payload_json)
 def __repr__(self):return '<CurrentTariffs: observation, not historical charge>'
 def checkpoint(self):
  v=self.data;return {k:v[k]for k in ('scope','quote_observed_at','mapping_observed_at','receipts','source_sha256','definition_hash','basis')}
 def for_cohort(self,orders,period,target):
  v=self.data;need(v['scope']==target,'TARIFF_SOURCE_SCOPE');c.dates(period)
  needed={(r['sku'],r['scheme'])for r in orders};index={(r['sku'],r['scheme']):r for r in v['rows']}
  need(needed<=set(index),'TARIFF_QUOTE_OR_SKU_MISSING')
  rows=[index[k]for k in sorted(needed)]
  return {'rows':rows,'receipt_hash':sha256(c.CANON(self.checkpoint()).encode()).hexdigest(),
          'complete':True,'scope':deepcopy(target),'period':deepcopy(period),'observed_at':v['quote_observed_at']}


def normalize(price_pages,product_pages,target,*,verify,encode):
 """Complete captured price cursor chain + explicitly requested product mapping."""
 price_pages,product_pages,target=deepcopy((price_pages,product_pages,target))
 need(type(target)is dict and set(target)=={'tenant_id','store_id','provider','currency'}
      and target['provider']=='OZON'and target['currency']=='RUB','TARIFF_SOURCE_SCOPE')
 need(callable(verify)and callable(encode),'TARIFF_VERIFIER_REQUIRED')
 need(type(price_pages)is list and price_pages and type(product_pages)is list and product_pages,'TARIFF_SOURCE_INCOMPLETE')
 prices={};products={};receipts=[];hashes=[];seen=set();expected_cursor='';filters=None;total=None;price_times=[];map_times=[]
 for i,packet in enumerate(price_pages):
  data=_read(packet,CATALOG['price_operation'],target,verify)
  request=packet['request'];need(type(request)is dict and set(request)=={'filter','cursor','limit'}
     and type(request['cursor'])is str and type(request['limit'])is int and request['limit']>0,'TARIFF_REQUEST_SCHEMA')
  if filters is None:filters=deepcopy(request['filter'])
  need(request['filter']==filters and request['cursor']==expected_cursor,'TARIFF_CURSOR_CHAIN')
  need(type(data)is dict and {'items','cursor','total'}<=set(data)<={'items','cursor','total','total_items'}
      and type(data['items'])is list and type(data['cursor'])is str and type(data['total'])is int and data['total']>=0,'TARIFF_RESPONSE_SCHEMA')
  if total is None:total=data['total']
  need(data['total']==total and data.get('total_items',total)==total,'TARIFF_TOTAL_CHANGED')
  for row in data['items']:
   pid=identifier(row.get('product_id'));need(pid not in prices,'TARIFF_DUPLICATE_PRODUCT')
   need(type(row.get('price'))is dict and row['price'].get('currency_code')=='RUB','TARIFF_CURRENCY')
   prices[pid]=row
  next_cursor=data['cursor']
  if i<len(price_pages)-1:need(bool(next_cursor)and next_cursor not in seen and bool(data['items']),'TARIFF_CURSOR_CHAIN')
  else:need(not next_cursor,'TARIFF_SOURCE_INCOMPLETE')
  seen.add(next_cursor);expected_cursor=next_cursor
  price_times.append(packet['received_at'])
  receipts.append(_encoded(encode,'source-receipt',packet['receipt_id']));hashes.append(packet['response_sha256'])
 need(len(prices)==total,'TARIFF_TOTAL_INCOMPLETE')
 for packet in product_pages:
  data=_read(packet,CATALOG['product_operation'],target,verify);request=packet['request']
  need(type(request)is dict and set(request)=={'product_id'}and type(request['product_id'])is list and request['product_id'],'TARIFF_PRODUCT_REQUEST')
  ids=[identifier(v)for v in request['product_id']];need(len(ids)==len(set(ids)),'TARIFF_PRODUCT_REQUEST')
  need(type(data)is dict and set(data)=={'items'}and type(data['items'])is list,'TARIFF_PRODUCT_RESPONSE')
  returned=set()
  for item in data['items']:
   pid=identifier(item.get('id'));sku=identifier(item.get('sku'))
   need(pid in ids and pid not in returned and pid not in products,'TARIFF_MAPPING_CONFLICT')
   returned.add(pid);products[pid]=sku
  need(returned==set(ids),'TARIFF_PRODUCT_MAPPING_INCOMPLETE')
  map_times.append(packet['received_at']);receipts.append(_encoded(encode,'source-receipt',packet['receipt_id']));hashes.append(packet['response_sha256'])
 need(len(receipts)==len(set(receipts)),'TARIFF_RECEIPT_REUSED')
 need(set(prices)<=set(products),'TARIFF_PRODUCT_MAPPING_INCOMPLETE')
 need(len({products[p]for p in prices})==len(prices),'TARIFF_SKU_MAPPING_AMBIGUOUS')
 rows=[]
 for pid,price in sorted(prices.items()):
  for scheme,mapping in CATALOG['schemes'].items():
   need(set(mapping)==set(economics.CATALOG['tariff_fields']),'TARIFF_MAP')
   fields={k:_field(price,path)for k,path in mapping.items()}
   need(all(v>=0 for v in fields.values()),'TARIFF_NEGATIVE')
   need(fields['commission_percent']<=100 and fields['processing_min']<=fields['processing_max'],'TARIFF_RANGE')
   rows.append({'sku':products[pid],'scheme':scheme,
      'quote_id':_encoded(encode,'price-quote',c.CANON([target,HASH,hashes,pid,scheme])),
      'fields':{k:c.decimal_text(v)for k,v in fields.items()}})
 data={'rows':rows,'scope':target,'quote_observed_at':min(price_times,key=_stamp),'mapping_observed_at':min(map_times,key=_stamp),
       'source_sha256':hashes,'receipts':receipts,'definition_hash':HASH,'basis':CATALOG['basis'],
       'acquiring_unit':'RUB/unit','historical_actual':False}
 text=c.CANON(data);return CurrentTariffs(text,_seal(text))
