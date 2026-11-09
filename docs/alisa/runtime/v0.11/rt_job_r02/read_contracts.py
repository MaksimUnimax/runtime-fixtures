"""Resolved primary-source request schemas for the remaining WB read surface.
No arbitrary host/method, permissive unknown-body fallback or inferred IDs.
"""
from copy import deepcopy
from urllib.parse import quote,urlencode,urlsplit
from datetime import datetime,date
import re
from semantics import Rejected,canonical_json

def need(condition,code='READ_REQUEST_INVALID'):
    if not condition:raise Rejected(code)

def validate(value,schema,path='params',depth=0):
    need(depth<=32,'READ_SCHEMA_DEPTH')
    if value is None:
        need(schema.get('nullable')is True or schema.get('type')=='null');return
    for child in schema.get('allOf',[]):validate(value,child,path,depth+1)
    if 'oneOf'in schema or 'anyOf'in schema:
        choices=schema.get('oneOf',schema.get('anyOf'));passed=0
        for choice in choices:
            try:validate(value,choice,path,depth+1);passed+=1
            except Rejected:pass
        need(passed==1 if 'oneOf'in schema else passed>0);return
    typ=schema.get('type','object'if'properties'in schema else None)
    if 'enum'in schema:need(value in schema['enum'] and not(type(value)is bool and type(schema['enum'][0])is int))
    if typ=='object':
        need(type(value)is dict);props=schema.get('properties',{});need(set(schema.get('required',[]))<=set(value))
        need(set(value)<=set(props),'READ_UNKNOWN_PARAMETER')
        for key,item in value.items():validate(item,props[key],path+'.'+key,depth+1)
    elif typ=='array':
        need(type(value)is list);need(len(value)>=schema.get('minItems',0))
        if 'maxItems'in schema:need(len(value)<=schema['maxItems'],'PROVIDER_REQUEST_SIZE')
        if schema.get('uniqueItems'):need(len(set(canonical_json(x)for x in value))==len(value))
        for item in value:validate(item,schema.get('items',{}),path,depth+1)
    elif typ in('integer','number'):
        need(type(value)is int,'READ_INTEGER_REQUIRED');need(abs(value)<=9007199254740991,'READ_INTEGER_USE_STRING')
        if 'minimum'in schema:need(value>=schema['minimum'])
        if 'maximum'in schema:need(value<=schema['maximum'])
    elif typ=='boolean':need(type(value)is bool)
    elif typ=='string':
        need(type(value)is str and not any(c in value for c in '\x00\r\n'))
        need(len(value)>=schema.get('minLength',0))
        if 'maxLength'in schema:need(len(value)<=schema['maxLength'],'PROVIDER_REQUEST_SIZE')
        if 'pattern'in schema:need(re.search(schema['pattern'],value)is not None)
        if schema.get('format')=='date':
            try:date.fromisoformat(value)
            except ValueError:raise Rejected('READ_REQUEST_DATE')from None
        if schema.get('format')=='date-time':
            try:d=datetime.fromisoformat(value.replace('Z','+00:00'));need(d.tzinfo is not None)
            except ValueError:raise Rejected('READ_REQUEST_DATE')from None
    elif typ is None:need(not value,'READ_SCHEMA_INCOMPLETE')
    else:raise Rejected('READ_SCHEMA_UNSUPPORTED')

def build_wb(row,params):
    spec=row['completion'];need(spec['mode']in('wb-protected','wb-service'))
    need(row.get('effect')=='READ'and row.get('source_readonly')is True and row.get('current')is True,'READ_CONTRACT_NOT_CURRENT')
    need(row['method']in('GET','POST')and row.get('blocked_reason')in('DIRECT_PII_SURFACE','SERVICE_TOKEN_ONLY_PERSONAL_BUILD'))
    value=deepcopy(params);validate(value,spec['request_schema'])
    path=row['path']
    for key in re.findall(r'\{([^}]+)\}',path):
        item=value.get('path',{}).get(key);need(item is not None)
        path=path.replace('{'+key+'}',quote(str(item),safe=''))
    need('{'not in path and '..'not in path,'READ_FIXED_TRANSPORT')
    host=urlsplit(row['wire_url']);url=host.scheme+'://'+host.netloc+path
    query=value.get('query',{})
    if query:url+='?'+urlencode({k:str(v).lower()if type(v)is bool else v for k,v in query.items()},doseq=True)
    request={'method':row['method'],'url':url,'path':path,'headers':{},'host_alias':row['host'],'response_mode':row.get('response_mode','json')}
    if 'body'in value:request['body']=canonical_json(value['body'])
    return request
