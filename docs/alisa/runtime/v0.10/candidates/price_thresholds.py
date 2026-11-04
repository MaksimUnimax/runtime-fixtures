"""Exploratory price bands and out-of-sample checks; no network or causality claims."""
from __future__ import annotations
import json, math, statistics, sys
from collections import Counter
from pathlib import Path
from datetime import date
import numpy as np


def band_summary(rows, step=50):
    result=[]
    low=math.floor(min(float(r['mean_price']) for r in rows)/step)*step
    high=(math.floor(max(float(r['mean_price']) for r in rows)/step)+1)*step
    for a in range(low,high,step):
        items=[r for r in rows if a<=float(r['mean_price'])<a+step]
        if not items:continue
        qty=[r['quantity'] for r in items]
        result.append({'from_inclusive':a,'to_exclusive':a+step,'days':len(items),
          'mean_daily_units':statistics.mean(qty),'median_daily_units':statistics.median(qty),
          'min_daily_units':min(qty),'max_daily_units':max(qty),'units_total':sum(qty),
          'mean_day_price':statistics.mean(float(r['mean_price']) for r in items)})
    assert sum(r['days'] for r in result)==len(rows)
    assert sum(r['units_total'] for r in result)==sum(r['quantity'] for r in rows)
    return result


def best_split(x,y,t,min_side=7,controls=False):
    unique=np.unique(x);candidates=(unique[:-1]+unique[1:])/2
    best=None
    for cut in candidates:
        g=x>=cut
        if min(g.sum(),(~g).sum())<min_side:continue
        X=np.column_stack([np.ones(len(x)),t,x,g]) if controls else np.column_stack([np.ones(len(x)),g])
        if np.linalg.matrix_rank(X)<X.shape[1]:continue
        beta=np.linalg.lstsq(X,y,rcond=None)[0];res=y-X@beta;sse=float(res@res)
        if best is None or sse<best['sse']:
            best={'cut':float(cut),'sse':sse,'coefficients':beta.tolist(),
                  'lower_days':int((~g).sum()),'upper_days':int(g.sum()),
                  'lower_mean_units':float(y[~g].mean()),'upper_mean_units':float(y[g].mean()),
                  'jump':float(beta[-1])}
    return best


def check_models(rows):
    x=np.array([float(r['mean_price']) for r in rows]);y=np.array([r['quantity'] for r in rows],dtype=float)
    t=np.array([date.fromisoformat(r['date']).toordinal() for r in rows],dtype=float)
    t-=t[0]
    models=['constant','linear_price','linear_date','linear_date_price','price_step','date_price_step']
    errors={m:[] for m in models};cuts={m:[] for m in models if m.endswith('step')}
    for i in range(len(x)):
        keep=np.arange(len(x))!=i;xx,yy,tt=x[keep],y[keep],t[keep]
        designs={
          'constant':(np.ones((len(xx),1)),np.array([1.])),
          'linear_price':(np.column_stack([np.ones(len(xx)),xx]),np.array([1.,x[i]])),
          'linear_date':(np.column_stack([np.ones(len(xx)),tt]),np.array([1.,t[i]])),
          'linear_date_price':(np.column_stack([np.ones(len(xx)),tt,xx]),np.array([1.,t[i],x[i]]))}
        for name,(X,row) in designs.items():
            prediction=float(row@np.linalg.lstsq(X,yy,rcond=None)[0]);errors[name].append((prediction-y[i])**2)
        for name,control in [('price_step',False),('date_price_step',True)]:
            fitted=best_split(xx,yy,tt,7,control);cuts[name].append(fitted['cut'])
            row=np.array([1.,t[i],x[i],float(x[i]>=fitted['cut'])]) if control else np.array([1.,float(x[i]>=fitted['cut'])])
            prediction=float(row@np.array(fitted['coefficients']));errors[name].append((prediction-y[i])**2)
    return {'best_price_step':best_split(x,y,t),
            'best_step_with_linear_date_and_price':best_split(x,y,t,controls=True),
            'leave_one_day_out_rmse':{k:math.sqrt(statistics.mean(v)) for k,v in errors.items()},
            'leave_one_day_out_cut_range':{k:[min(v),max(v)] for k,v in cuts.items()},
            'leave_one_day_out_cut_counts':{k:dict(Counter(round(a,2) for a in v)) for k,v in cuts.items()}}


def run(data):
    days=data['daily'];active=[r for r in data['sku_daily'] if r['quantity']]
    leader=data['sku_stats'][0]['sku'];lead=[r for r in active if r['sku']==leader]
    models=[]
    for item in data['sku_stats']:
        rows=[r for r in active if r['sku']==item['sku']]
        if len(rows)<15 or len({r['quantity'] for r in rows})<2:continue
        models.append({'sku':item['sku'],'title':data['sku_labels'][item['sku']],
                       'active_days':len(rows),'units':item['units'],'bands_50':band_summary(rows),
                       'models':check_models(rows)})
    return {'schema':'ozon-price-threshold-exploration/v1','period':data['period'],
       'time_axis':data['time_axis'],'price_definition':'quantity-weighted daily realization price',
       'new_marketplace_api_calls':0,'new_deepseek_calls':0,
       'store_daily_bands_50':band_summary(days),'store_daily_bands_100':band_summary(days,100),
       'store_models':check_models(days),'leader_sku':leader,'leader_title':data['sku_labels'][leader],
       'leader_bands_50':band_summary(lead),'leader_bands_100':band_summary(lead,100),
       'leader_models':check_models(lead),'eligible_sku_models':models,
       'sku_count':len(data['sku_stats']),'sku_at_least_10_active_days':sum(r['active_days']>=10 for r in data['sku_stats']),
       'notes':['Bands are exploratory, not equal-sales equivalence tests.',
                'A selected split is validated by leaving each day out and selecting the split again within training data.',
                'No formal confidence level or causal price boundary is claimed.',
                'Prices on days with no realized units are unobserved. Accrual date is not order date.']}


if __name__=='__main__':
    data=json.loads(Path(sys.argv[1]).read_text());result=run(data)
    Path(sys.argv[2]).write_text(json.dumps(result,ensure_ascii=False,indent=2))
    print(json.dumps({k:result[k] for k in ['store_daily_bands_50','store_models','leader_sku','leader_title','leader_bands_50','leader_models','sku_at_least_10_active_days','eligible_sku_models']},ensure_ascii=False))
