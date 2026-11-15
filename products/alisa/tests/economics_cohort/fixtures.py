from copy import deepcopy
from hashlib import sha256
from alisa_platform.owner_data import economics_cohort as e
TARGET={'tenant_id':'test-tenant','store_id':'test-store','provider':'OZON','currency':'RUB'}
PERIOD={'from':'2026-11-13','to':'2026-11-13'}

def order(posting='p1',sku='101',scheme='fbo',quantity='2',price='1000'):
 return {'posting':posting,'sku':sku,'scheme':scheme,'day':'2026-11-13','quantity':quantity,'seller_price':price}
def tariff(sku='101',scheme='fbo'):
 return {'sku':sku,'scheme':scheme,'quote_id':'quote-'+sku+'-'+scheme,'fields':{'commission_percent':'10','acquiring_per_unit':'17.4','return_per_unit':'99','processing_min':'2','processing_max':'8'}}
def event(eid='fee1',posting='p1',sku='101',scheme='fbo',typ=69,quantity='2',amount='-150',nature='ORIGINAL',parent=None):
 return {'event_id':eid,'posting':posting,'sku':sku,'scheme':scheme,'type_id':typ,'nature':nature,'parent_id':parent,'quantity':quantity,'amount':amount,'currency':'RUB','accrual_day':'2026-11-14'}
def bundle(rows=None,fees=None,quotes=None,target=None):
 target=deepcopy(target or TARGET);rows=[order()]if rows is None else rows
 data={'orders':rows,'fees':fees or[],'tariffs':[tariff()]if quotes is None else quotes,'period_costs':[{'component':'storage','amount':'30','basis':'FULL_PERIOD'},{'component':'advertising','amount':'100','basis':'FULL_PERIOD'}]}
 return {name:{'rows':deepcopy(items),'receipt_hash':sha256(name.encode()).hexdigest(),'complete':True,'scope':deepcopy(target),'period':deepcopy(PERIOD),'observed_at':'2026-11-15T00:00:00+00:00'}for name,items in data.items()}
def attested(data):
 known={name:e.c.CANON(value)for name,value in data.items()}
 return lambda name,value,target,period:known.get(name)==e.c.CANON(value)
def qualify(data=None,target=None):
 data=data or bundle(target=target);return e.qualify(data,target or TARGET,PERIOD,verify=attested(data))
def numbers(q,loss='0.2',delivery='100',cost='250'):
 ids={e.c.CANON(e.key(r['order']))for r in q.rows}
 return {k:cost for k in ids},{k:{'loss_rate':loss,'delivery_mean':delivery}for k in ids}
def unknown():return {k:{'state':'NOT_PROVIDED','value':None}for k in ['tax_amount','own_cost_amount']}
def calculated(data=None,loss='0.2',delivery='100',cost='250',owner=None):
 q=qualify(data);costs,params=numbers(q,loss,delivery,cost);return e.calculate(q,costs,params,unknown()if owner is None else owner)
