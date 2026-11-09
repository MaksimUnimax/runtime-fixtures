"""Data-driven, full-utterance informational route. No HTTP, model or financial job.
The finite phrase grammar does not consume a real request containing extra words.
"""
from __future__ import annotations
from pathlib import Path
import json,re

def _load():
    raw=Path(__file__).with_name('information_catalog.json').read_text()
    if len(raw.encode())>64000:raise ValueError('INFORMATION_CATALOG_SIZE')
    def pairs(items):
        out={}
        for k,v in items:
            if k in out:raise ValueError('INFORMATION_DUPLICATE_KEY')
            out[k]=v
        return out
    c=json.loads(raw,object_pairs_hook=pairs)
    if c.get('schema')!='alice-information/v1' or c.get('id')!='H00':raise ValueError('INFORMATION_SCHEMA')
    for key,limit in [('prefixes',32),('questions',128),('suffixes',16)]:
        if not isinstance(c[key],list) or not 1<=len(c[key])<=limit:raise ValueError('INFORMATION_SCHEMA')
        if any(not isinstance(x,str) or len(x)>200 or any(ord(ch)<32 for ch in x) for x in c[key]):raise ValueError('INFORMATION_TEXT')
    if not isinstance(c['features'],list) or not 1<=len(c['features'])<=12:raise ValueError('INFORMATION_FEATURES')
    for feature in c['features']:
        if not isinstance(feature,dict) or set(feature) not in ({'label','metrics'},{'label','dataset'}):raise ValueError('INFORMATION_FEATURES')
        if not isinstance(feature['label'],str) or not 0<len(feature['label'])<=80 or any(ord(ch)<32 for ch in feature['label']):raise ValueError('INFORMATION_FEATURES')
        if 'metrics' in feature:
            if not isinstance(feature['metrics'],list) or not feature['metrics'] or any(not isinstance(m,str) or not re.fullmatch(r'[a-z][a-z0-9_]{0,79}',m) for m in feature['metrics']):raise ValueError('INFORMATION_FEATURES')
        elif not isinstance(feature['dataset'],str) or not re.fullmatch(r'[a-z][a-z0-9_]{0,79}',feature['dataset']):raise ValueError('INFORMATION_FEATURES')
    for key in ('answer_prefix','answer_end','planned_sentence','no_access'):
        if not isinstance(c[key],str) or not 0<len(c[key])<=400:raise ValueError('INFORMATION_TEXT')
    for topic in c.get('unavailable_topics',[]):
        if type(topic)is not dict or set(topic)!={'id','terms','error_code'}:raise ValueError('INFORMATION_TOPIC')
        if re.fullmatch(r'[a-z][a-z0-9_]{0,79}',topic['id'])is None or re.fullmatch(r'[A-Z][A-Z0-9_]{0,79}',topic['error_code'])is None:raise ValueError('INFORMATION_TOPIC')
        if type(topic['terms'])is not list or not 1<=len(topic['terms'])<=64 or any(type(t)is not str or not 1<=len(t)<=80 for t in topic['terms']):raise ValueError('INFORMATION_TOPIC')
    return c

CATALOG=_load()

def normalized(text):
    if not isinstance(text,str) or len(text)>1200:return None
    text=re.sub(r'\s+',' ',text.casefold().replace('ё','е')).strip(' \t\n?!.,')
    # Introductory comma is nonsemantic; internal punctuation/clauses are not removed.
    text=re.sub(r'^(алиса|скажи|подскажи|расскажи|пожалуйста),\s*',r'\1 ',text)
    return text

PHRASES=frozenset(normalized(a+b+c) for a in CATALOG['prefixes'] for b in CATALOG['questions'] for c in CATALOG['suffixes'])

def is_help(text):
    return normalized(text) in PHRASES

def help_text(engine,tenant):
    from dataclasses import asdict
    from datetime import datetime
    from zoneinfo import ZoneInfo
    from semantics import Scope,Rejected
    from query_program import make_composed_plan
    from registry import DEFINITIONS
    scope=engine.scope_for(tenant)
    if scope.tenant!=tenant:raise Rejected('TENANT_DENIED')
    today=datetime.fromtimestamp(engine.repo.clock(),ZoneInfo('Europe/Moscow')).date()
    labels=[]
    for feature in CATALOG['features']:
        if 'dataset' in feature:
            if _dataset_available(engine,scope,feature['dataset'],today):labels.append(feature['label'])
            continue
        metrics=feature['metrics']
        if not all(m in DEFINITIONS for m in metrics):continue
        for store in scope.stores:
            if not all(store.platform in DEFINITIONS[m]['platforms'] for m in metrics):continue
            snapshot=all(DEFINITIONS[m].get('temporal')=='snapshot' for m in metrics)
            draft={'question':'справка о возможностях','period':{'from':today.isoformat(),'to':today.isoformat()},
                   'calendar_date':today.isoformat(),'platforms':[store.platform],'timezone':'Europe/Moscow',
                   'group_by':'marketplace','filters':{},'comparison':None,'snapshot':snapshot,
                   'snapshot_slot':int(engine.repo.clock()//300) if snapshot else None}
            try:
                plan=make_composed_plan(Scope(scope.tenant,scope.revision,(store,)),draft,metrics=metrics)
                if engine.authorized(plan):labels.append(feature['label']);break
            except (Rejected,KeyError,TypeError,ValueError):continue
    if not labels:return CATALOG['no_access']+' '+CATALOG['planned_sentence']
    text=CATALOG['answer_prefix']+', '.join(labels)+CATALOG['answer_end']+' '+CATALOG['planned_sentence']
    if len(text)>800:raise Rejected('INFORMATION_SIZE')
    return text


def _dataset_available(engine,scope,query_id,today):
    """Pure plan authorization for a declared query; never executes provider work.
    It tests each eligible store separately, like existing scalar information.
    All operation IDs and stages remain in the dataset matrix.
    """
    if engine.dataset_capabilities is None:return False
    from datetime import timedelta
    from semantics import Scope,Rejected
    from dataset_pipeline import CATALOG as datasets,make_dataset_plan
    query=datasets['queries'].get(query_id)
    if query is None:return False
    for store in scope.stores:
        if store.platform not in query['flows']:continue
        snapshot=query['snapshot'];day=today if snapshot else today-timedelta(days=1)
        draft={'question':'справка о возможностях','period':{'from':day.isoformat(),'to':day.isoformat()},
               'calendar_date':today.isoformat(),'platforms':[store.platform],'timezone':'Europe/Moscow',
               'group_by':'marketplace','filters':{},'comparison':None,'snapshot':snapshot,
               'snapshot_slot':int(engine.repo.clock()//300) if snapshot else None,
               'dataset_request':{'id':query_id}}
        try:
            plan=make_dataset_plan(Scope(scope.tenant,scope.revision,(store,)),draft,engine.dataset_capabilities())
            if engine.authorized(plan):return True
        except (Rejected,KeyError,TypeError,ValueError):continue
    return False


def unavailable_topic(text):
    """Known unavailable domains are diagnosed before irrelevant period prompts.

    Whole tokens only; a quoted product/brand name is not the requested subject.
    This table never makes a provider call or fabricates a zero-result report.
    """
    value=normalized(text)
    if value is None:return None
    value=re.sub(r'"[^"\n]*"|«[^»\n]*»',' ',value)
    for topic in CATALOG.get('unavailable_topics',[]):
        if any(re.search(r'(?<!\w)'+re.escape(term)+r'(?!\w)',value)for term in topic['terms']):return topic['error_code']
    return None
