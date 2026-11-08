"""Bounded read-only product picker on the existing peer-checked reference IPC.

No reports, finance, queue, credentials on disk or automatic retries. Uses the
same shared bounded HTTP implementation as existing store checks. Catalogue
calls are rate limited by the authenticated platform before dispatch.
"""
import json,re,time,urllib.request,urllib.error
from store_checker import validate as check_validate, loads, error_code
from shared_http import read_response
VERSION='rt_catalog_v1'
PAGE=20
LIMIT=2**20
CODES={'OK','AUTH_DENIED','SCOPE_MISSING','RATE_LIMITED','TIMEOUT','CHECK_UNAVAILABLE','CATALOG_INCOMPLETE','PROVIDER_UNAVAILABLE','PROVIDER_PLAN_REQUIRED'}

def need(ok):
 if not ok:raise ValueError('CATALOG_SCHEMA')

def positive(v):
 need(type(v)in(int,str)and re.fullmatch(r'[1-9][0-9]{0,19}',str(v)));return str(v)

def text(v,size=250):
 need(type(v)is str and len(v)<=size and all(ord(x)>=32 for x in v));return v

def validate(message,environment):
 need(type(message)is dict and set(message)=={'schema_version','operation','pins','credential','cursor'}and message['schema_version']==VERSION and message['operation']=='product_catalog')
 old={k:v for k,v in message.items()if k!='cursor'};old.update(schema_version='rt_check_v1',operation='check_store')
 pins,credential=check_validate(old,environment);need(pins['kind']in('SELLER','WB'))
 cursor=message['cursor'];need(type(cursor)is dict)
 if cursor:
  if pins['kind']=='SELLER':
   need(set(cursor)=={'last_id','offset','total'});text(cursor['last_id'],1024);need(cursor['last_id']!='')
   need(type(cursor['offset'])is int and type(cursor['total'])is int and 0<cursor['offset']<cursor['total']<=1000000)
  else:
   need(set(cursor)=={'updatedAt','nmID'});text(cursor['updatedAt'],100);positive(cursor['nmID']);need(cursor['updatedAt']!='')
 return pins,credential,cursor

def safe_result(result,pins=None):
 try:
  need(type(result)is dict and result.get('code')in CODES)
  if result['code']!='OK':return set(result)=={'code'}
  need(set(result)=={'code','items','cursor','complete'}and type(result['complete'])is bool and type(result['cursor'])is dict)
  need(type(result['items'])is list and len(result['items'])<=PAGE*3)
  seen=set()
  for item in result['items']:
   need(type(item)is dict and set(item)=={'sku','name','offer_id'})
   sku=positive(item['sku']);need(sku not in seen);seen.add(sku);text(item['name']);text(item['offer_id']);need(item['name']!='')
  need(result['complete']==(not result['cursor']))
  need(len(json.dumps(result,ensure_ascii=False).encode())<30000)
  return True
 except (ValueError,KeyError,TypeError):return False

class CatalogReader:
 def __init__(self,exchange=read_response):self.exchange=exchange
 def page(self,message,environment):
  pins,credentials,cursor=validate(message,environment);kind=pins['kind'];deadline=time.monotonic()+3.4
  headers={'Content-Type':'application/json','Accept':'application/json'}
  if kind=='SELLER':headers.update({'Client-Id':credentials['client_id'],'Api-Key':credentials['api_key']})
  else:headers['Authorization']=credentials['token']
  def post(url,body):
   request=urllib.request.Request(url,data=json.dumps(body,separators=(',',':')).encode(),headers=headers,method='POST')
   raw,status=self.exchange(request,timeout=max(.01,deadline-time.monotonic()),limit=LIMIT,deadline=deadline)
   need(status==200 and len(raw)<=LIMIT);return loads(raw)
  try:
   if kind=='SELLER':
    data=post('https://api-seller.ozon.ru/v3/product/list',{'filter':{'visibility':'ALL'},'last_id':cursor.get('last_id',''),'limit':PAGE})['result']
    rows=data['items'];total=data.get('total',data.get('total_items'));need(type(total)is int and 0<=total<=1000000 and type(rows)is list and len(rows)<=PAGE)
    if 'total'in data and 'total_items'in data:need(data['total']==data['total_items'])
    if cursor:need(total==cursor['total'])
    offset=cursor.get('offset',0)+len(rows);need(offset<=total and (rows or offset==total))
    ids=[positive(x['product_id'])for x in rows];need(len(set(ids))==len(ids))
    items=[]
    if rows:
     info=post('https://api-seller.ozon.ru/v3/product/info/list',{'product_id':ids})['items'];need(type(info)is list and len(info)==len(ids));seen=set()
     for row in info:
      pid=positive(row['id']);need(pid in ids and pid not in seen);seen.add(pid)
      name=text(row['name']);offer=text(row['offer_id'])
      skus={positive(row['sku'])}if row.get('sku')else set()
      for source in row.get('sources',[]):
       if source.get('sku'):skus.add(positive(source['sku']))
      need(skus and len(skus)<=3)
      for sku in sorted(skus):items.append({'sku':sku,'name':name,'offer_id':offer})
    next_cursor={}
    if offset<total:
     last=text(data['last_id'],1024);need(last and last!=cursor.get('last_id'));next_cursor={'last_id':last,'offset':offset,'total':total}
   else:
    data=post('https://content-api.wildberries.ru/content/v2/get/cards/list',{'settings':{'sort':{'ascending':True},'cursor':{'limit':PAGE,**cursor},'filter':{'withPhoto':-1}}})
    rows=data['cards'];cur=data['cursor'];need(type(rows)is list and len(rows)<=PAGE and type(cur['total'])is int and cur['total']==len(rows))
    items=[{'sku':positive(x['nmID']),'name':text(x['title']),'offer_id':text(x['vendorCode'])}for x in rows]
    next_cursor={}if len(rows)<PAGE else {'updatedAt':text(cur['updatedAt'],100),'nmID':int(positive(cur['nmID']))}
    if next_cursor:need(next_cursor!=cursor)
   result={'code':'OK','items':items,'cursor':next_cursor,'complete':not next_cursor};need(safe_result(result,pins));return result
  except urllib.error.HTTPError as exc:
   status=exc.code;exc.close();return {'code':error_code(kind,status)}
  except (TimeoutError,):return {'code':'TIMEOUT'}
  except (OSError,urllib.error.URLError):return {'code':'PROVIDER_UNAVAILABLE'}
  except (ValueError,KeyError,TypeError):return {'code':'CATALOG_INCOMPLETE'}
