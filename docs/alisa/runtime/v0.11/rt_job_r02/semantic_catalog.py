"""Versioned declarative formulas and speech accelerators; no executable config."""
from __future__ import annotations
import copy
import hashlib
import json
import re
from pathlib import Path
from registry import DEFINITIONS

SCHEMA='alice-expressions/v1'
OPERATORS={'add':(2,16),'subtract':(2,2),'divide':(2,2),'percent':(2,2),
           'per_day':(1,1),'relative_change':(2,2),'minimum':(2,16),'maximum':(2,16)}

class CatalogError(ValueError):pass

def encoded(obj):return json.dumps(obj,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)
def hash_value(obj):return hashlib.sha256(encoded(obj).encode()).hexdigest()
def load_json(path):
    def pairs(items):
        d={}
        for k,v in items:
            if k in d:raise CatalogError('DUPLICATE_CATALOG_KEY')
            d[k]=v
        return d
    def bad(_):raise CatalogError('NONFINITE_CATALOG')
    raw=Path(path).read_text(encoding='utf-8')
    if len(raw)>1000000:raise CatalogError('CATALOG_SIZE')
    return json.loads(raw,object_pairs_hook=pairs,parse_constant=bad)

def validate_catalog(catalog):
    if (not isinstance(catalog,dict) or set(catalog)!={'schema','version','formulas'}
        or catalog['schema']!=SCHEMA or not isinstance(catalog['version'],str)
        or not 0<len(catalog['version'])<=100 or not isinstance(catalog['formulas'],dict)
        or len(catalog['formulas'])>256):raise CatalogError('CATALOG_SCHEMA')
    formulas=catalog['formulas']
    for n,d in formulas.items():
        if (not isinstance(n,str) or not re.fullmatch(r'[a-z][a-z0-9_]{0,79}',n)
            or (n in DEFINITIONS and 'formula' not in DEFINITIONS[n])
            or not isinstance(d,dict) or set(d)!={'label','expr'}
            or not isinstance(d['label'],str) or not 0<len(d['label'])<=160
            or any(ord(c)<32 for c in d['label'])):raise CatalogError('FORMULA_SCHEMA')
    budget=[0]
    def walk(e,stack,depth=0):
        budget[0]+=1
        if budget[0]>2048:raise CatalogError('FORMULA_SIZE')
        if depth>16 or not isinstance(e,dict):raise CatalogError('FORMULA_DEPTH_OR_SHAPE')
        if 'metric' in e or 'template' in e:
            k='metric' if 'metric' in e else 'template'
            if not set(e)<={k,'period'} or not isinstance(e[k],str) or e.get('period','current') not in ('current','previous'):raise CatalogError('REFERENCE_SCHEMA')
            n=e[k]
            if n in formulas:
                if n in stack:raise CatalogError('FORMULA_CYCLE')
                walk(formulas[n]['expr'],stack+(n,),depth+1)
            elif k!='metric' or n not in DEFINITIONS or 'formula' in DEFINITIONS[n]:raise CatalogError('UNKNOWN_FORMULA_METRIC')
            return
        if set(e)!={'op','args'} or not isinstance(e['op'],str) or e['op'] not in OPERATORS or not isinstance(e['args'],list):raise CatalogError('OPERATOR_SCHEMA')
        low,high=OPERATORS[e['op']]
        if not low<=len(e['args'])<=high:raise CatalogError('OPERATOR_ARITY')
        for x in e['args']:walk(x,stack,depth+1)
    for n,d in formulas.items():
        budget[0]=0;walk(d['expr'],(n,))
    if not {n for n,d in DEFINITIONS.items() if 'formula' in d}<=set(formulas):raise CatalogError('BUILTIN_FORMULA_MISSING')
    return copy.deepcopy(catalog)

def formula_platforms(name,catalog):
    formulas=catalog['formulas']
    def walk(e,seen):
        if 'metric' in e or 'template' in e:
            n=e.get('metric',e.get('template'))
            if n in formulas:
                if n in seen:raise CatalogError('FORMULA_CYCLE')
                return walk(formulas[n]['expr'],seen|{n})
            if n not in DEFINITIONS:raise CatalogError('UNKNOWN_FORMULA_METRIC')
            return set(DEFINITIONS[n]['platforms'])
        return set.intersection(*(walk(x,seen) for x in e['args']))
    return sorted(walk({'metric':name},set()))

def validate_speech(speech,catalog):
    if (not isinstance(speech,dict) or set(speech)-{'legacy_dataset_phrases'}!={'schema','version','phrases','bundles'}
        or speech['schema']!='alice-speech/v1' or not isinstance(speech['version'],str)
        or not isinstance(speech['phrases'],dict) or not isinstance(speech['bundles'],dict)):raise CatalogError('SPEECH_SCHEMA')
    codes=set(DEFINITIONS)|set(catalog['formulas']);claims={}
    def register(text,metrics):
        if (not isinstance(text,str) or not 0<len(text)<=200 or any(ord(c)<32 for c in text)
            or not isinstance(metrics,list) or not metrics or not all(isinstance(m,str) and m in codes for m in metrics)):raise CatalogError('SPEECH_ENTRY')
        if text!=' '.join(text.casefold().replace('ё','е').split()).strip('?!., '):raise CatalogError('SPEECH_NOT_NORMALIZED')
        if text in claims and set(metrics)!=set(claims[text]):raise CatalogError('SPEECH_COLLISION')
        claims[text]=metrics
    for n,phrases in speech['phrases'].items():
        if n not in codes or not isinstance(phrases,list):raise CatalogError('SPEECH_METRIC')
        for text in phrases:register(text,[n])
    for text,metrics in speech['bundles'].items():register(text,metrics)
    return copy.deepcopy(speech)

EXPRESSION_CATALOG=validate_catalog(load_json(Path(__file__).with_name('expression_catalog.json')))
SPEECH_CATALOG=validate_speech(load_json(Path(__file__).with_name('speech_catalog.json')),EXPRESSION_CATALOG)
CATALOG_HASH=hash_value(EXPRESSION_CATALOG)
