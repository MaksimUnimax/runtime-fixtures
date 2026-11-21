"""All-SKU price-band exploration. No SKU filtering or new marketplace requests."""
import json, math, statistics, sys
from pathlib import Path
import numpy as np
from price_thresholds import best_split


def run(data):
    rows=[r for r in data['sku_daily'] if r['quantity']]
    assert len({r['sku'] for r in rows})==data['totals']['distinct_skus']
    assert sum(r['quantity'] for r in rows)==data['totals']['quantity']
    x=np.array([float(r['mean_price']) for r in rows])
    y=np.array([r['quantity'] for r in rows],float)
    dates=np.array([r['date'] for r in rows]);ids=np.array([r['sku'] for r in rows])
    baseline={s['sku']:s['units']/s['active_days'] for s in data['sku_stats']}
    relative=np.array([r['quantity']/baseline[r['sku']] for r in rows])
    intervals=[(None,500),(500,600),(600,700),(700,800),(800,850),(850,900),(900,1000),(1000,None)]
    bands=[]
    for a,b in intervals:
        mask=np.ones(len(x),bool)
        if a is not None:mask&=x>=a
        if b is not None:mask&=x<b
        bands.append({'from_inclusive':a,'to_exclusive':b,'observations':int(mask.sum()),
          'units':int(y[mask].sum()),'mean_units_per_active_sku_day':float(y[mask].mean()),
          'mean_relative_to_own_sku_active_day':float(relative[mask].mean()),
          'sku_count':len(set(ids[mask])),'calendar_days':len(set(dates[mask]))})
    assert sum(b['observations'] for b in bands)==len(rows)
    assert sum(b['units'] for b in bands)==data['totals']['quantity']
    models={}
    for label,target in [('raw_units',y),('relative_to_own_sku',relative)]:
        fitted=best_split(x,target,np.zeros(len(x)),min_side=25)
        fitted['lower_observations']=fitted.pop('lower_days')
        fitted['upper_observations']=fitted.pop('upper_days')
        errors_const=[];errors_step=[];boundaries=[]
        for day in np.unique(dates):
            train=dates!=day;test=~train
            fit=best_split(x[train],target[train],np.zeros(train.sum()),min_side=25)
            boundaries.append(fit['cut'])
            pred=fit['coefficients'][0]+fit['coefficients'][1]*(x[test]>=fit['cut'])
            errors_step.extend((pred-target[test])**2)
            errors_const.extend((target[train].mean()-target[test])**2)
        upper=x>=fitted['cut']
        fitted['lower_calendar_days']=len(set(dates[~upper]))
        fitted['upper_calendar_days']=len(set(dates[upper]))
        fitted['lower_skus']=len(set(ids[~upper]));fitted['upper_skus']=len(set(ids[upper]))
        models[label]={'fit':fitted,'leave_calendar_day_out_rmse':{
              'constant':float(np.mean(errors_const)**.5),'step':float(np.mean(errors_step)**.5)},
              'refitted_boundary_range':[min(boundaries),max(boundaries)]}
    return {'schema':'ozon-all-sku-price-bands/v1','scope':'all SKUs without exclusions',
      'period':data['period'],'time_axis':data['time_axis'],
      'sku_count':len(set(ids)),'observations':len(rows),'units':int(y.sum()),
      'observation_definition':'one SKU and one calendar day with a recorded positive realization',
      'price_definition':'realization amount / units for that SKU-day',
      'bands':bands,'models':models,'new_marketplace_calls':0,'new_deepseek_calls':0,
      'limitations':['No historical buyer price is observed for SKU-days without a realization.',
        'Identical seller prices do not identify identical baseline volumes; the raw pool and the standardized sensitivity are both shown.',
        'Thresholds are descriptive candidates, not causal demand effects.']}


if __name__=='__main__':
    data=json.loads(Path(sys.argv[1]).read_text());result=run(data)
    Path(sys.argv[2]).write_text(json.dumps(result,ensure_ascii=False,indent=2))
    print(json.dumps(result,ensure_ascii=False))
