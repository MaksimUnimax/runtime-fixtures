"""Full cohort forecast inside the existing template Worker and Query.

Source facts stay in the existing job as independently protected leaf packets.
Owner values are read only in memory for final calculation; existing coefficient
producers fill missing slots and the existing answer-generation fence prevents
publication of an answer prepared against superseded current inputs.
"""
from copy import deepcopy
from dataclasses import asdict
from datetime import date
from calendar import monthrange
from hashlib import sha256
from pathlib import Path

from semantics import Rejected, Store, canonical_json, fingerprint
from parameter_support import parameter_report_contract as spec
from parameter_support import parameter_dependencies as dependencies
from parameter_support import parameter_contract as pc
from parameter_support import economics_cohort as economics
from parameter_support import economics_orders as orders_support
import order_source_runtime as orders_source
import tariff_source_runtime as tariff_source
import other_source_runtime as other_source
import period_cost_source_runtime as period_source
import realization_source_runtime as realization_source
import read_surface

TEMPLATE='economics.unit_forecast.v1'
SCHEMA='alice-economics-composite/v1'
CACHE='_economics_sources'
BATCH_SIZE=64
OWNER_FIELDS=['unit_cost','tax_amount','own_cost_amount']
READ_OPERATIONS=(*tariff_source.OPERATIONS,*other_source.OPERATIONS,
                 *(step['operation']for step in realization_source.STEPS))
PIN=fingerprint({'code':sha256(Path(__file__).read_bytes()).hexdigest(),
    'catalog':spec.HASH,'formula':economics.HASH,
    'formula_code':sha256(Path(economics.__file__).read_bytes()).hexdigest(),
    'realization_code':sha256(Path(__import__('parameter_support.economics_realization',fromlist=['']).__file__).read_bytes()).hexdigest(),
    'sources':{name:module.PIN for name,module in (
        ('orders',orders_source),('tariffs',tariff_source),('other',other_source),
        ('period_costs',period_source),('realization',realization_source))},
    'owner_batch_size':BATCH_SIZE})


def need(ok,code):
    if not ok:raise Rejected(code)


def _report():
    import parameter_report_runtime
    return parameter_report_runtime


def enabled(engine):
    policy=getattr(engine,'economics_composite_policy',None)
    if callable(policy):policy=policy()
    return (type(policy)is dict and policy.get('enabled')is True
            and policy=={'enabled':True,'pin':PIN}and _report().enabled(engine))


def _rule():
    rule=spec.definition(TEMPLATE)
    need(rule.get('source_mode')=='cohort_forecast'and rule.get('provider')=='OZON'
         and rule.get('scope')=='store'and rule.get('profile')=='unit_economics.ozon.v1'
         and rule.get('owner_fields')==OWNER_FIELDS and rule.get('orders_catalog_hash')==orders_support.HASH,
         'ECONOMICS_COMPOSITE_CONTRACT')
    expected={
        'orders_fbo':('ds_ozon_fbo_postings','dataset_sources',{'period':'input.period','windows':'registered_posting_metadata_boundary','pagination':'complete'}),
        'orders_fbs':('ds_ozon_fbs_postings','dataset_sources',{'period':'input.period','windows':'registered_posting_metadata_boundary','pagination':'complete'}),
        'tariff_prices':('product_prices_bulk','read_surface',{'visibility':'ALL','pagination':'complete'}),
        'tariff_skus':('seller_product_info_list','read_surface',{'product_id':'verified_price_products'}),
        'posting_fees':('finance_accrual_postings','read_surface',{'posting_numbers':'verified_original_orders'}),
        'fee_identities':('finance_accrual_by_day','read_surface',{'financial_period':'posting_accrual_dates_through_observation','pagination':'complete'}),
        'storage':('ozon_finance','scalar_source_catalog',{'period':'input.period','component':'storage'}),
        'advertising':('ozon_ads_daily','scalar_source_catalog',{'period':'input.period','campaigns':'ALL'}),
        'posting_commission':('finance_realization_posting','read_surface',{'months':'closed_order_months'}),
        'monthly_commission':('finance_realization_v2','read_surface',{'months':'closed_order_months'})}
    actual=rule.get('source_steps')
    need(type(actual)is list and len(actual)==len(expected),'ECONOMICS_COMPOSITE_CONTRACT')
    need(actual==[{'id':name,'operation':operation,'source_registry':registry,'params':params}
                  for name,(operation,registry,params)in expected.items()],'ECONOMICS_COMPOSITE_CONTRACT')
    return rule


def available(engine,template,store):
    if not enabled(engine)or template.get('parameter_report')!=TEMPLATE or store.platform!='ozon':return False
    if not isinstance(getattr(engine,'parameter_intent_authority',None),_report().Authority):return False
    try:
        _rule()
        return (_producers_available(engine,store)and
                all(read_surface.available(read_surface.method('ozon',operation))for operation in READ_OPERATIONS))
    except (Rejected,pc.ParameterError,KeyError,ValueError):return False


def _producers_available(engine,store):
    return all(_report().sources.available(engine,{'parameter_key':binding['parameter']},store)
               for binding in dependencies.profile(_rule()['profile'])['bindings'])


def _input(value,anchor):
    value=spec.normalized_input(value)
    slots={binding['slot']for binding in dependencies.profile(_rule()['profile'])['bindings']}
    need(set(value['parameter_periods'])<=slots,'PARAMETER_DEPENDENCY_PERIOD_SLOT')
    for request in value['parameter_periods'].values():
        need(type(request)is dict,'PARAMETER_PERIOD')
        pc.resolve_period(date.fromisoformat(anchor),request)
    need(value['period']['to']<anchor,'PERIOD_COST_UNFINISHED_PERIOD')
    return value


def _descriptors(engine,root,inputs):
    store=root['stores'][0]['id'];period=inputs['period']
    need(_producers_available(engine,Store(**root['stores'][0])),'ECONOMICS_COEFFICIENT_SOURCE_UNAVAILABLE')
    need(all(read_surface.available(read_surface.method('ozon',operation))for operation in READ_OPERATIONS),
         'ECONOMICS_SOURCE_UNAVAILABLE')
    return {'orders':orders_source.descriptor(engine,root,store,period),
            'tariffs':tariff_source.descriptor(root,store),
            'period_costs':period_source.descriptor(engine,root,store,period),
            'realization_policy':{'months':'closed_order_months','anchor':root['calendar_date'],
                                  'source_pin':realization_source.PIN},
            'other_policy':{'source_pin':other_source.PIN,'basis':'OBSERVED_SIGNED_POSTING_ACCRUAL_SNAPSHOT'}}


def compile_plan(engine,scope,draft,template,root,invocation_id):
    need(len(scope.stores)==1 and available(engine,template,scope.stores[0]),'ECONOMICS_COMPOSITE_DISABLED')
    need(type(root.get('runtime_guard'))is dict,'PARAMETER_REPORT_AUTHORITY_REQUIRED')
    inputs=_input({'period':draft['period'],'parameter_periods':draft['parameter_periods']},root['calendar_date'])
    plan={'schema':SCHEMA,'tenant':scope.tenant,'access_revision':scope.revision,
          'stores':[asdict(store)for store in scope.stores],'question':root['question'],
          'calendar_date':root['calendar_date'],'timezone':'Europe/Moscow','freshness_seconds':0,
          'runtime_guard':deepcopy(root['runtime_guard'])}
    plan['parameter_report']={'pin':PIN,'template_id':TEMPLATE,'invocation_id':invocation_id,
                              'input':inputs,'sources':_descriptors(engine,plan,inputs)}
    return plan


def authorized(engine,plan):
    try:
        if not enabled(engine)or plan.get('schema')!=SCHEMA:return False
        info=plan['parameter_report']
        if set(info)!={'pin','template_id','invocation_id','input','sources'}or info['pin']!=PIN or info['template_id']!=TEMPLATE:return False
        if type(info['invocation_id'])is not str or not info['invocation_id']:return False
        if info['input']!=_input(info['input'],plan['calendar_date']):return False
        scope=engine.execution_scope(plan.get('runtime_guard'),plan['tenant'])
        actual={store.id:asdict(store)for store in scope.stores}
        if plan['access_revision']!=scope.revision or len(plan['stores'])!=1 or any(actual.get(store['id'])!=store for store in plan['stores']):return False
        return info['sources']==_descriptors(engine,plan,info['input'])
    except Rejected as error:
        if error.code=='DEPENDENCY_UNAVAILABLE':raise
        return False
    except (pc.ParameterError,KeyError,TypeError,ValueError):return False


def _current(worker,reference):
    _report()._current_report(worker,reference)
    return True


def _bind(worker,row,root,fragment,index=0):
    item=deepcopy(fragment)
    # Every batch, including zero, uses the server namespace. A selector's
    # explicit invocation ID can never alias another invocation's extra batch.
    item['plan']['parameter_report']['invocation_id']='economics-batch:'+fingerprint({
        'fragment':fragment['id'],'invocation':fragment['plan']['parameter_report']['invocation_id'],
        'input':fragment['plan']['parameter_report']['input'],'index':index})
    return _report()._bind(worker,row,root,item)['reference']


def _documents(root,store,orders,anchor):
    months=sorted({(int(row['day'][:4]),int(row['day'][5:7]))for row in orders.data['rows']})
    return [realization_source.descriptor(root,store,month,year)for year,month in months
            if date(year,month,monthrange(year,month)[1])<date.fromisoformat(anchor)]


def step(worker,row,root,progress,fragment):
    from template_runtime import _save,_finish_fragment
    need(authorized(worker.engine,fragment['plan'])and worker.engine.authorized(root),'SOURCE_ACCESS')
    info=fragment['plan']['parameter_report'];sources=info['sources']
    state=progress.get('fragment_progress')or{'phase':'bind','reference':None,'orders':None,'other':None,
        'tariffs':None,'period_costs':None,'documents':{},'owner_refs':[]}
    if state['reference']is not None:_current(worker,state['reference'])
    def save():
        progress['fragment_progress']=state
        return _save(worker.repo,row,progress)
    if state['phase']=='bind':
        state['reference']=_bind(worker,row,root,fragment)
        state['owner_refs']=[state['reference']];state['phase']='orders';save();return
    authorize=lambda:_current(worker,state['reference'])
    def leaf_progress(name):
        def saved(packed):state[name]=packed;save()
        return saved
    def advance(phase):
        def completed(value,packed):
            state['phase']=phase;save()
        return completed
    if state['phase']=='orders':
        orders_source.step(worker,row,root,sources['orders'],state['orders'],authorize=authorize,
            save_progress=leaf_progress('orders'),on_complete=advance('other'));return
    orders=orders_source.restore(worker,row,root,sources['orders'],state['orders'],authorize=authorize)
    other_desc=other_source.descriptor(root,sources['orders']['store_id'],info['input']['period'],orders.checkpoint())
    if state['phase']=='other':
        other_source.step(worker,row,root,other_desc,state['other'],order_desc=sources['orders'],
            order_packed=state['orders'],authorize=authorize,save_progress=leaf_progress('other'),
            on_complete=advance('tariffs'if orders.data['rows']else'period_costs'));return
    if state['phase']=='tariffs':
        tariff_source.step(worker,row,root,sources['tariffs'],state['tariffs'],authorize=authorize,
            save_progress=leaf_progress('tariffs'),on_complete=advance('period_costs'));return
    if state['phase']=='period_costs':
        period_source.step(worker,row,root,sources['period_costs'],state['period_costs'],authorize=authorize,
            save_progress=leaf_progress('period_costs'),on_complete=advance('documents'));return
    documents=_documents(root,sources['orders']['store_id'],orders,fragment['plan']['calendar_date'])
    if state['phase']=='documents':
        for desc in documents:
            if desc['id']not in state['documents']or not state['documents'][desc['id']].get('done'):
                packed=state['documents'].get(desc['id'],{}).get('packed')
                def saved(value):state['documents'][desc['id']]={'packed':value,'done':False};save()
                def completed(value,packet):state['documents'][desc['id']]={'packed':packet,'done':True};save()
                realization_source.step(worker,row,root,desc,packed,authorize=authorize,
                    save_progress=saved,on_complete=completed);return
        state['phase']='ready';save();return
    need(state['phase']=='ready','ECONOMICS_COMPOSITE_STATE')
    # The cache is progress-only; the result marker contains no packets or old
    # inputs. Complete_answer clears this existing job's progress normally.
    progress.setdefault(CACHE,{})[fragment['id']]=deepcopy(state)
    # Collection is ready, not yet a published calculation. Mandatory
    # prepare_marker restores and qualifies the complete source set immediately
    # before owner arithmetic/model dispatch, including after a restart.
    marker={'schema':_report().SCHEMA,'template_id':TEMPLATE,'fragment_id':fragment['id']}
    _finish_fragment(worker,row,root,progress,{'compound_parameter_report':marker})


def _restore(worker,row,root,fragment,state):
    need(authorized(worker.engine,fragment['plan'])and worker.engine.authorized(root),'SOURCE_ACCESS')
    need(state['phase']=='ready'and state['reference']==state['owner_refs'][0],'ECONOMICS_COMPOSITE_STATE')
    authorize=lambda:_current(worker,state['reference'])
    info=fragment['plan']['parameter_report'];sources=info['sources'];period=info['input']['period']
    orders=orders_source.restore(worker,row,root,sources['orders'],state['orders'],authorize=authorize)
    target=orders.data['scope'];orders_block=orders.for_cohort(period,target)
    other_desc=other_source.descriptor(root,target['store_id'],period,orders.checkpoint())
    other=other_source.restore(worker,row,root,other_desc,state['other'],order_desc=sources['orders'],
                              order_packed=state['orders'],authorize=authorize)
    costs=period_source.restore(worker,row,root,sources['period_costs'],state['period_costs'],authorize=authorize)
    if orders.data['rows']:
        tariffs=tariff_source.restore(worker,row,root,sources['tariffs'],state['tariffs'],authorize=authorize)
        tariff_block=tariffs.for_cohort(orders.data['rows'],period,target)
    else:
        need(state['tariffs']is None,'ECONOMICS_EMPTY_TARIFF_SCOPE')
        tariff_block={'rows':[],'receipt_hash':fingerprint({'not_required_for_empty_orders':orders.checkpoint()}),
                      'complete':True,'scope':deepcopy(target),'period':deepcopy(period),'observed_at':orders.data['observed_at']}
    docs=_documents(root,target['store_id'],orders,fragment['plan']['calendar_date'])
    need(set(state['documents'])=={desc['id']for desc in docs},'REALIZATION_SOURCE_INCOMPLETE')
    pairs=[]
    for desc in docs:
        value=state['documents'][desc['id']]
        need(value.get('done')is True,'REALIZATION_SOURCE_INCOMPLETE')
        pairs.append(realization_source.restore(worker,row,root,desc,value['packed'],authorize=authorize))
    bundle={'orders':orders_block,'tariffs':tariff_block,'period_costs':costs.as_source()}
    def verify(name,value,scope,requested):
        return authorize()and name in bundle and value==bundle[name]and scope==target and requested==period
    try:
        qualified=economics.qualify(bundle,target,period,verify=verify,realization=pairs,observed_other=other)
    except economics.EconomicsError as error:raise Rejected(error.code)from None
    authorize()
    return orders,qualified


def readsets(orders):
    """Bound each private message, never the number of source rows or batches."""
    value=orders.data;checkpoint=orders.checkpoint()
    rows=[{'sku':sku,'day':day}for sku,day in sorted({(row['sku'],row['day'])for row in value['rows']})]
    total=max(1,(len(rows)+BATCH_SIZE-1)//BATCH_SIZE)
    shared={'schema':'alisa-economics-owner-readset/v1','scope':value['scope'],'period':value['period'],
        'order_definition_hash':orders_support.HASH,
        'order_normalizer_sha256':sha256(Path(orders_support.__file__).read_bytes()).hexdigest(),
        'orders_block_sha256':fingerprint(orders.for_cohort(value['period'],value['scope'])),
        'orders_checkpoint_sha256':fingerprint(checkpoint),'receipt_set_sha256':fingerprint(sorted(checkpoint['receipts'])),
        'original_row_count':len(value['rows']),'distinct_read_count':len(rows)}
    result=[{**deepcopy(shared),'batch':{'index':index,'total':total},'rows':rows[index*BATCH_SIZE:(index+1)*BATCH_SIZE]}
            for index in range(total)]
    need([row for part in result for row in part['rows']]==rows,'ECONOMICS_READSET_COVERAGE')
    return result


def _persist(worker,row,progress):
    with worker.repo.connection(True)as connection:
        worker.repo._owned(connection,row['id'],row['owner'])
        connection.execute('UPDATE jobs SET progress=?WHERE id=?',(canonical_json(progress),row['id']))


def _fill(worker,row,root,progress,marker,reference,producer):
    report=_report()
    state=progress.get('_compound_fill')
    if state is None:
        state={'fragment':report._producer_fragment(worker,root,producer,marker['fragment_id']+':late-fill'),
               'child_progress':None,'reference':reference}
    need(state['reference']==reference,'PARAMETER_REPORT_STATE')
    report.resume_fill(worker,row,root,progress,state)


def prepare_marker(worker,row,root,progress,marker):
    candidates=[item for item in root['fragments']if item['id']==marker['fragment_id']]
    need(len(candidates)==1 and candidates[0]['plan']['parameter_report']['template_id']==TEMPLATE,'ECONOMICS_COMPOSITE_STATE')
    fragment=candidates[0];state=progress.get(CACHE,{}).get(marker['fragment_id'])
    need(type(state)is dict,'ECONOMICS_COMPOSITE_STATE')
    orders,qualified=_restore(worker,row,root,fragment,state)
    batches=readsets(orders);replies=[];fences=[];api=_report()._api(worker)
    need(len(state['owner_refs'])<=len(batches),'ECONOMICS_READSET_COVERAGE')
    for index,subset in enumerate(batches):
        if index==len(state['owner_refs']):
            state['owner_refs'].append(_bind(worker,row,root,fragment,index));_persist(worker,row,progress)
        reference=state['owner_refs'][index]
        value=api.call({'method':'report_owner_inputs','reference':reference,'job_id':row['id'],'readset':subset})
        if not value['ready']:
            need(not value['missing_owner'],'ECONOMICS_OWNER_INPUTS_MISSING')
            need(value['producers'],'PARAMETER_DEPENDENCIES_PENDING')
            _fill(worker,row,root,progress,marker,reference,value['producers'][0]);return None,None
        replies.append(value);fences.append((reference,value['checkpoint']))
    # Each chunk was coherent in its DB transaction. Refuse a mixed owner
    # revision assembled across chunks and reread without source collection.
    owner=replies[0]
    if any(value['checkpoint']['owner']!=owner['checkpoint']['owner']or value['owner_period']!=owner['owner_period']for value in replies):
        worker.repo.reschedule(row['id'],row['owner'],progress);return None,None
    coefficients={};costs={};basis=[];cost_basis=[]
    for subset,value in zip(batches,replies):
        expected={pc.CANON([item['sku'],item['day']])for item in subset['rows']}
        need(set(value['coefficients'])==set(value['unit_costs'])==expected,'ECONOMICS_CURRENT_INPUT_SCOPE')
        need(not set(coefficients).intersection(expected),'ECONOMICS_READSET_COVERAGE')
        coefficients.update(value['coefficients']);costs.update(value['unit_costs'])
        basis.extend(value['basis']['parameters_used']);cost_basis.extend(value['basis']['unit_cost_basis'])
    line_costs={};line_coefficients={}
    for item in orders.data['rows']:
        key=pc.CANON(economics.key(item));lookup=pc.CANON([item['sku'],item['day']])
        need(lookup in costs and lookup in coefficients,'ECONOMICS_READSET_COVERAGE')
        line_costs[key]=costs[lookup];line_coefficients[key]=coefficients[lookup]
    try:result=economics.calculate(qualified,line_costs,line_coefficients,owner['owner_period'])
    except economics.EconomicsError as error:raise Rejected(error.code)from None
    result.update(parameters_used=basis,unit_cost_basis=cost_basis,
                  owner_data_revision=owner['basis']['owner_data_revision'],sources=qualified.checkpoint())
    return {'template_id':TEMPLATE,'economics':result,'not_profit':True},fences
