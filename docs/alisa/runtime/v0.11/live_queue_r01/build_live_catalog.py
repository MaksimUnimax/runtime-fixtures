"""Bind existing reviewed SourceMatrix recipes to the common graph; no requests."""
from pathlib import Path
from copy import deepcopy
import hashlib,json,sys
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'runtime'),str(ROOT/'adapters')]
from matrix_sources import SourceMatrix
from semantics import fingerprint
import http_transport

def build():
    template=json.loads((ROOT/'matrix_examples/raw_graph.synthetic.json').read_text())
    captures={n['id']:n['capture']for n in template['graphs']['fresh_pair']['nodes']if n['kind']=='source'}
    ds=json.loads((ROOT/'runtime/dataset_sources.json').read_text())
    spec=deepcopy(ds['sources']['ds_ozon_products'])
    spec.update(url='https://api-seller.ozon.ru/v1/finance/accrual/types',
                quota_operation='ozon_accrual_by_day',interval=2,daily_limit=100,request={},
                payload_schema={'type':'object','properties':{}},axis='type_dictionary')
    spec['response'].update(items={'$path':['response','accrual_types']},root_asserts=[],lets=[],
        row_asserts=[],map={'type_id':{'$fn':['positive_integer',{'$path':['row','id']}]},
                           'type_name':{'$fn':['nonempty',{'$path':['row','name']}]}},
        include=True,currency=None,identity={'$fn':['positive_integer',{'$path':['row','id']}]},totals=None,
        pagination={'mode':'single','size':20000,'cursor':None,'initial':'','order_code':'CURSOR_ORDER','stalled_code':'CURSOR_STALLED'},dataset_asserts=[])
    ds['version']='20261106-live-queue-types-r1';ds['sources']={'cue01_ozon_accrual_types':spec}
    roles=[('orders_fbo','ds_ozon_fbo_postings'),('orders_fbs','ds_ozon_fbs_postings'),
           ('products','ds_ozon_products'),('prices','ds_ozon_prices'),('fee_types','cue01_ozon_accrual_types'),
           ('accruals','ozon_accrual_by_day'),('accruals_asof','ozon_accrual_by_day'),
           ('advertising','ozon_ads_daily'),('finance','ozon_finance')]
    nodes=[]
    for role,operation in roles:
        period={'from':{'$path':['inputs','lookup_day']},'to':{'$path':['inputs','lookup_day']}} if role=='accruals_asof' else {'$path':['period']}
        params={} if operation.startswith('ds_')or role=='fee_types' else {'metrics':[],'fields':{},'integer':{},'signed':{}}
        if role=='advertising':params={'metrics':['ads_spend'],'fields':{'ads_spend':'moneySpent'}}
        nodes.append({'id':role,'kind':'source','operation':operation,'period':period,'params':params,'capture':captures[role]})
    nodes.append({'id':'calculation','kind':'compute','adapter':'fresh_scenario','dependencies':[r for r,_ in roles]})
    graph={'schema':'alice-task-graphs/v1','version':'20261106-cue01-live-queue-r1',
        'limits':{'max_nodes':16,'max_calls':14,'max_rows':20000,'max_bytes':4000000,
                  'max_input_bytes':262144,'max_pages':100,'lifetime_seconds':3600,'freshness_seconds':300},
        'graphs':{'cue01_ozon_day':{'label':'Юнит-экономика заказанной группы','platforms':['ozon'],
                                'nodes':nodes,'output':'calculation'}}}
    custom=SourceMatrix(ds)
    sources={op:(custom if role=='fee_types' else http_transport.MATRICES[op]) for role,op in roles}
    identities={op:{'recipe_hash':m.fingerprint(op),'quota_operation':m.recipe(op)['quota_operation'],
                    'url':m.recipe(op)['url'],'method':m.recipe(op)['method'],
                    'interval':m.recipe(op)['interval'],'daily_limit':m.recipe(op)['daily_limit']}for op,m in sources.items()}
    policy=json.loads((ROOT/'fresh_source/normalization_catalog.json').read_text())
    output={'graph':graph,'dictionary':ds,'source_identities':identities,'owner_profile':policy['owner_profile'],
            'policy_sha256':hashlib.sha256((ROOT/'fresh_source/normalization_catalog.json').read_bytes()).hexdigest()}
    return output

if __name__=='__main__':
    output=build()
    for name,key in [('live_graph.json','graph'),('live_types_source.json','dictionary'),('live_source_pins.json','source_identities')]:
        (ROOT/'live'/name).write_text(json.dumps(output[key],ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'source_count':len(output['source_identities']),'data_stages':9,'max_http':14,'network_calls':0,'graph_hash':fingerprint(output['graph'])}))
