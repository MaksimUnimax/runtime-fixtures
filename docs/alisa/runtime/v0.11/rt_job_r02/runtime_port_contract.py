"""Strict v0.5 task shape, not an authentication mechanism.
The task schema is copied unchanged from the user's implementation package.
"""
from __future__ import annotations
import copy,json,re
from datetime import datetime,date,timezone
from pathlib import Path
from uuid import UUID
from zoneinfo import ZoneInfo,ZoneInfoNotFoundError
from semantics import Rejected
CONTRACT='runtime_port_v1'
PRODUCT='alisa_market'
TASK_SCHEMA=json.loads(Path(__file__).with_name('runtime_task_v1.schema.json').read_text())
CONTEXT_SCHEMA=TASK_SCHEMA['properties']['context']

def reject(code='VALIDATION_FAILED'):
    raise Rejected(code,code)

def uuid_text(value):
    if not isinstance(value,str) or not re.fullmatch(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}',value):reject()
    try:return str(UUID(value))
    except (ValueError,TypeError):reject()

def timestamp(value):
    if not isinstance(value,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})',value):reject()
    try:
        dt=datetime.fromisoformat(value.replace('Z','+00:00'))
        if dt.utcoffset().total_seconds()!=0:reject()
        return dt.timestamp()
    except (ValueError,TypeError,OverflowError):reject()

def validate(value,schema,depth=0):
    if depth>20:reject()
    if 'oneOf' in schema:
        count=0
        for option in schema['oneOf']:
            try:validate(value,option,depth+1);count+=1
            except Rejected:pass
        if count!=1:reject()
        return
    kind=schema.get('type')
    if kind=='object':
        if type(value)is not dict or not set(schema.get('required',[]))<=set(value):reject()
        props=schema.get('properties',{})
        if schema.get('additionalProperties') is False and set(value)-set(props):reject()
        for k,v in value.items():
            if k in props:validate(v,props[k],depth+1)
    elif kind=='array':
        if type(value)is not list or not schema.get('minItems',0)<=len(value)<=schema.get('maxItems',1000):reject()
        for item in value:validate(item,schema['items'],depth+1)
    elif kind=='integer':
        if type(value)is not int or not schema.get('minimum',-2**63)<=value<=schema.get('maximum',2**63):reject()
    elif kind=='string':
        if not isinstance(value,str) or not schema.get('minLength',0)<=len(value)<=schema.get('maxLength',4096):reject()
        try:value.encode('utf-8')
        except UnicodeError:reject()
        if 'pattern' in schema and not re.fullmatch(schema['pattern'],value):reject()
        fmt=schema.get('format')
        if fmt=='uuid':uuid_text(value)
        elif fmt=='date-time':timestamp(value)
        elif fmt=='date':
            try:
                if date.fromisoformat(value).isoformat()!=value:reject()
            except ValueError:reject()
    elif kind is not None:reject('CATALOG_INCOMPATIBLE')
    if 'const' in schema and value!=schema['const']:reject('CATALOG_INCOMPATIBLE')

def context_shape(value):
    validate(value,CONTEXT_SCHEMA)
    result=copy.deepcopy(value)
    try:ZoneInfo(result['business_timezone'])
    except (ZoneInfoNotFoundError,ValueError):reject()
    for key in ('tenant_id','actor_id'):result[key]=uuid_text(result[key])
    for store in result['store_scope']:store['store_id']=uuid_text(store['store_id'])
    ids=[x['store_id'] for x in result['store_scope']]
    if len(ids)!=len(set(ids)):reject()
    result['store_scope'].sort(key=lambda x:x['store_id'])
    if any(ord(c)<32 for c in result['execution_ticket']):reject()
    return result

def task_shape(value):
    validate(value,TASK_SCHEMA)
    result=copy.deepcopy(value);result['context']=context_shape(result['context'])
    for k in ('request_id','logical_query_id','trace_id'):result[k]=uuid_text(result[k])
    if result['query_input']['kind']=='utterance' and not result['query_input']['text'].strip():reject()
    return result

def claims_shape(value):
    if type(value)is not dict or value.get('product_id')!=PRODUCT or 'execution_ticket' in value:reject('AUTH_REQUIRED')
    raw={k:v for k,v in value.items() if k!='product_id'}
    raw['execution_ticket']='shape-only-not-authorization'
    result=context_shape(raw);result.pop('execution_ticket')
    return {'product_id':PRODUCT,**result}

def utc(ts):return datetime.fromtimestamp(ts,timezone.utc).isoformat().replace('+00:00','Z')
