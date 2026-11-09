"""One executor for declared HTTP/JSON-row recipes. No endpoint-specific branches.

Network I/O stays in the existing audited transport. This module creates a
request specification and normalizes bounded pages using only matrix data.
"""
from __future__ import annotations
import base64
import copy
import ipaddress
import json
from urllib.parse import urlsplit, urlencode
from matrix_core import (MatrixError, canonical, digest, fail, validate_expression,
                         _evaluate, strict_equal, naive_stamp)

BASE_ROOTS={'period','view','filters','store','progress','params'}
RESPONSE_ROOTS=BASE_ROOTS|{'calendar_date'}|{'response','records','row','v','rows','totals'}


def validate_type_schema(schema,depth=0):
    if depth>16 or not isinstance(schema,dict):fail('MATRIX_TYPE_SCHEMA')
    kind=schema.get('type')
    fields={'object':{'properties','required'},'array':{'items','max_length','min_length'},
            'integer':{'minimum','maximum'},'string':{'max_length','min_length','format'},'boolean':set()}
    if kind not in fields or set(schema)-({'type','enum'}|fields[kind]):fail('MATRIX_TYPE_SCHEMA')
    if 'enum' in schema and (not isinstance(schema['enum'],list) or not 1<=len(schema['enum'])<=100):fail('MATRIX_TYPE_SCHEMA')
    if kind=='object':
        props=schema.get('properties')
        if not isinstance(props,dict) or len(props)>100 or any(not isinstance(k,str) or len(k)>100 for k in props):fail('MATRIX_TYPE_SCHEMA')
        req=schema.get('required',list(props))
        if not isinstance(req,list) or any(not isinstance(k,str) for k in req) or set(req)-set(props):fail('MATRIX_TYPE_SCHEMA')
        for child in props.values():validate_type_schema(child,depth+1)
    if kind=='array':
        if 'items' not in schema:fail('MATRIX_TYPE_SCHEMA')
        validate_type_schema(schema['items'],depth+1)
    if kind in ('array','string'):
        low,high=schema.get('min_length',0),schema.get('max_length',4096 if kind=='string' else 1000)
        if type(low)is not int or type(high)is not int or not 0<=low<=high<=20000:fail('MATRIX_TYPE_SCHEMA')
    if kind=='string' and schema.get('format') not in (None,'iso_date','naive_datetime_or_date'):fail('MATRIX_TYPE_SCHEMA')
    if kind=='integer' and (any(type(schema[k]) is not int for k in ('minimum','maximum') if k in schema) or schema.get('minimum',-10**18)>schema.get('maximum',10**18)):fail('MATRIX_TYPE_SCHEMA')


def assert_schema(value, schema):
    """Small closed JSON type schema; not JSON Schema and not labelled as one."""
    if not isinstance(schema,dict) or 'type' not in schema:fail('MATRIX_TYPE_SCHEMA')
    kind=schema['type']
    allowed={'type','enum','minimum','maximum','max_length','min_length','items','properties','required','format'}
    if set(schema)-allowed:fail('MATRIX_TYPE_SCHEMA')
    if kind=='object':
        if not isinstance(value,dict):fail('QUERY_SCHEMA')
        properties=schema.get('properties',{})
        if set(value)-set(properties) or set(schema.get('required',properties))-set(value):fail('QUERY_SCHEMA')
        for key,val in value.items():assert_schema(val,properties[key])
    elif kind=='array':
        if not isinstance(value,list) or not schema.get('min_length',0)<=len(value)<=schema.get('max_length',1000):fail('QUERY_SCHEMA')
        for item in value:assert_schema(item,schema['items'])
    elif kind=='integer':
        if type(value) is not int or not schema.get('minimum',-10**18)<=value<=schema.get('maximum',10**18):fail('QUERY_SCHEMA')
    elif kind=='boolean':
        if type(value) is not bool:fail('QUERY_SCHEMA')
    elif kind=='string':
        if not isinstance(value,str) or not schema.get('min_length',0)<=len(value)<=schema.get('max_length',4096):fail('QUERY_SCHEMA')
        if schema.get('format')=='iso_date':
            from matrix_core import day
            day(value)
        elif schema.get('format')=='naive_datetime_or_date':naive_stamp(value)
        elif schema.get('format') is not None:fail('MATRIX_TYPE_SCHEMA')
    else:fail('MATRIX_TYPE_SCHEMA')
    if 'enum' in schema and not any(strict_equal(value,x) for x in schema['enum']):fail('QUERY_SCHEMA')


def _guard(spec, env):
    try: verdict=_evaluate(spec['test'],env)
    except MatrixError: fail(spec['code'])
    except (ValueError,TypeError,KeyError,IndexError):fail(spec['code'])
    if verdict is not True:fail(spec['code'])


def _read(expr,env,code='TABLE_RESPONSE_SCHEMA'):
    try:return _evaluate(expr,env)
    except (MatrixError,ValueError,TypeError,KeyError,IndexError):fail(code)


class SourceMatrix:
    def __init__(self, definition):
        if (not isinstance(definition,dict) or set(definition)!={'schema','version','origins','sources'}
            or definition['schema']!='alice-source-matrix/v1'
            or not isinstance(definition['sources'],dict) or not 1<=len(definition['sources'])<=128):
            fail('MATRIX_SCHEMA')
        if not isinstance(definition['version'],str) or not 1<=len(definition['version'])<=100:fail('MATRIX_VERSION')
        if not isinstance(definition['origins'],dict) or len(definition['origins'])>64:fail('MATRIX_ORIGINS')
        for platform,origins in definition['origins'].items():
            if not isinstance(platform,str) or not platform or not isinstance(origins,list) or not 1<=len(origins)<=32 or any(not isinstance(x,str) for x in origins):fail('MATRIX_ORIGINS')
        if len(canonical(definition).encode())>1048576:fail('MATRIX_SIZE')
        # Reject extensions before IO, including an invalid expression in a cold branch.
        self._definition=copy.deepcopy(definition)
        self._sources=self._definition['sources']
        for operation,spec in self._sources.items():
            if not isinstance(operation,str) or not operation or len(operation)>100:fail('MATRIX_OPERATION_NAME')
            self._validate(spec)
        self.hash=digest(self._definition)
        self._hashes={key:digest(spec) for key,spec in self._sources.items()}

    @property
    def definition(self):return copy.deepcopy(self._definition)

    @property
    def sources(self):return copy.deepcopy(self._sources)

    def _validate(self,s):
        required={'platform','url','method','quota_operation','interval','daily_limit','auth',
                  'request','payload_schema','response','proof_requirements','availability','axis'}
        if not isinstance(s,dict) or set(s)!=required:fail('MATRIX_RECIPE_SCHEMA')
        if any(not isinstance(s[k],str) or not s[k] or len(s[k])>2048 for k in ('url','platform','method','axis')):fail('MATRIX_RECIPE_SCHEMA')
        try:u=urlsplit(s['url']);port=u.port
        except ValueError:fail('MATRIX_ENDPOINT')
        if u.scheme!='https' or not u.hostname or u.username or u.password or u.query or u.fragment or port not in (None,443):fail('MATRIX_ENDPOINT')
        try:ipaddress.ip_address(u.hostname)
        except ValueError:pass
        else:fail('MATRIX_ENDPOINT')
        if '\\' in s['url'] or any(ord(c)<33 for c in s['url']):fail('MATRIX_ENDPOINT')
        origin='https://'+u.netloc
        if origin not in self._definition['origins'].get(s['platform'],[]):fail('MATRIX_ENDPOINT_ORIGIN')
        if s['method'] not in ('GET','POST') or type(s['interval']) is not int or not 1<=s['interval']<=86400 or type(s['daily_limit']) is not int or not 1<=s['daily_limit']<=10000:fail('MATRIX_QUOTA')
        if not isinstance(s['quota_operation'],str) or not s['quota_operation']:fail('MATRIX_QUOTA')
        validate_expression(s['request'],BASE_ROOTS)
        validate_type_schema(s['payload_schema'])
        a=s['auth']
        if not isinstance(a,dict) or set(a)!={'headers','claims'} or not isinstance(a['headers'],dict):fail('MATRIX_AUTH')
        if any(not isinstance(k,str) or not k.isascii() or not all(c.isalnum() or c=='-' for c in k) or k.lower() in ('host','content-length','connection','transfer-encoding') for k in a['headers']):fail('MATRIX_AUTH_HEADER')
        validate_expression(a['headers'],{'credentials'})
        if a['claims'] is not None and (not isinstance(a['claims'],dict) or set(a['claims'])!={'field','expected'} or not isinstance(a['claims']['field'],str) or not isinstance(a['claims']['expected'],dict)):fail('MATRIX_AUTH')
        d=s['response']
        required_d={'items','root_asserts','lets','row_asserts','map','include','currency','identity',
                    'duplicate_code','page_duplicate_code','pagination','totals','totals_changed_code','dataset_asserts'}
        if not isinstance(d,dict) or set(d)!=required_d:fail('MATRIX_RESPONSE_SCHEMA')
        for x in [d['items'],d['map'],d['include'],d['currency'],d['identity'],d['totals']]:
            validate_expression(x,RESPONSE_ROOTS)
        if not isinstance(d['lets'],list) or len(d['lets'])>32:fail('MATRIX_BINDINGS_SCHEMA')
        seen=set()
        for let in d['lets']:
            if set(let)!={'name','value','code'} or not isinstance(let['name'],str) or let['name'] in seen:fail('MATRIX_BINDINGS_SCHEMA')
            seen.add(let['name']);validate_expression(let['value'],RESPONSE_ROOTS)
        for group in (d['root_asserts'],d['row_asserts'],d['dataset_asserts'],s['availability']):
            if not isinstance(group,list) or len(group)>64:fail('MATRIX_GUARDS')
            for guard in group:
                if set(guard)-{'test','code','message'} or not {'test','code'}<=set(guard):fail('MATRIX_GUARDS')
                validate_expression(guard['test'],RESPONSE_ROOTS)
        p=d['pagination']
        if not isinstance(p,dict) or set(p)!={'mode','size','cursor','initial','order_code','stalled_code'}:fail('MATRIX_PAGINATION')
        for name in ('mode','size','cursor','initial'):validate_expression(p[name],RESPONSE_ROOTS)
        for code in [d['duplicate_code'],d['page_duplicate_code'],d['totals_changed_code'],p['order_code'],p['stalled_code']]:
            if not isinstance(code,str) or not code or len(code)>100:fail('MATRIX_ERROR_CODE')

    def recipe(self,operation):
        if operation not in self._sources:fail('MATRIX_SOURCE_UNKNOWN')
        return copy.deepcopy(self._sources[operation])

    def fingerprint(self,operation):
        if operation not in self._hashes:fail('MATRIX_SOURCE_UNKNOWN')
        return self._hashes[operation]

    def available(self,operation,period,calendar_date):
        for guard in self.recipe(operation)['availability']:
            _guard(guard,{'period':period,'calendar_date':calendar_date})

    def context(self,plan,store,task,progress=None):
        return {'period':task['period'],'view':plan['table']['view'],
                'filters':plan.get('filters',{}),'store':store,'progress':progress or {},
                'params':plan.get('table_params',{})}

    def request(self,operation,plan,store,task,progress=None):
        spec=self.recipe(operation)
        if store['platform']!=spec['platform']:fail('CREDENTIAL_PLATFORM')
        env=self.context(plan,store,task,progress)
        body=_read(spec['request'],env,'QUERY_SCHEMA')
        assert_schema(body,spec['payload_schema'])
        return {'operation':operation,'source':store['platform']+':'+store['identity']+':'+spec['quota_operation'],
                'store_id':store['id'],'body':body,'interval':spec['interval'],'daily_limit':spec['daily_limit']}

    def http(self,operation,body,store,credentials):
        """Returns only a reviewed fixed endpoint and headers; no external side effects.

        credentials enter only this boundary, never the decoder, model or dataset.
        JWT payload check qualifies a token class; the remote API authenticates it.
        """
        spec=self.recipe(operation)
        if spec['platform']!=store['platform']:fail('CREDENTIAL_PLATFORM')
        try:assert_schema(body,spec['payload_schema'])
        except MatrixError:fail('QUERY_SCHEMA')
        claims=spec['auth']['claims']
        if claims is not None:
            try:
                token=credentials[claims['field']]
                if not isinstance(token,str) or len(token)>8192:fail()
                parts=token.split('.')
                if len(parts)!=3:fail()
                obj=json.loads(base64.urlsafe_b64decode(parts[1]+'==='))
                if not isinstance(obj,dict) or any(type(obj.get(k)) is not type(v) or obj[k]!=v for k,v in claims['expected'].items()):fail()
            except (MatrixError,ValueError,TypeError,KeyError,IndexError):fail('TOKEN_CLASS_REQUALIFICATION_REQUIRED')
        headers=_read(spec['auth']['headers'],{'credentials':credentials},'CREDENTIAL_SCHEMA')
        if any(not isinstance(v,str) or not v or len(v)>8192 or '\r' in v or '\n' in v for v in headers.values()):fail('CREDENTIAL_SCHEMA')
        url=spec['url'];method=spec['method']
        if method=='GET':
            if any(type(v) not in (str,int,bool) for v in body.values()):fail('QUERY_SCHEMA')
            if body:url+='?'+urlencode(body)
        return method,url,headers,None if method=='GET' else body

    def decode(self,operation,data,plan,store,task,progress=None,limits=None):
        spec=self.recipe(operation);d=spec['response'];old=copy.deepcopy(progress or {})
        limits=limits or {'max_rows':20000,'max_bytes':6000000}
        if old and old.get('recipe_hash')!=self.fingerprint(operation):fail('MATRIX_PROGRESS_VERSION')
        env=self.context(plan,store,task,old)
        scope_hash=digest({k:v for k,v in env.items() if k!='progress'})
        if old and old.get('scope_hash')!=scope_hash:fail('MATRIX_PROGRESS_SCOPE')
        env['response']=data
        records=_read(d['items'],env)
        if not isinstance(records,list):fail('TABLE_RESPONSE_SCHEMA')
        env['records']=records
        for guard in d['root_asserts']:_guard(guard,env)
        currency=_read(d['currency'],env)
        if currency not in ('RUB','BYN','KZT','AMD','KGS','UZS','CNY','USD','EUR'):fail('TABLE_CURRENCY_UNKNOWN')
        if store.get('currency') is not None and store['currency']!=currency:fail('TABLE_CURRENCY_CHANGED')
        if old and old.get('currency')!=currency:fail('TABLE_CURRENCY_CHANGED')
        totals=_read(d['totals'],env)
        if old and totals!=old.get('totals'):fail(d['totals_changed_code'])
        pagination=d['pagination'];mode=_read(pagination['mode'],env)
        size=_read(pagination['size'],env)
        if mode not in ('single','offset','cursor') or type(size)is not int or size<=0 or len(records)>size:fail('MATRIX_PAGE_SIZE')
        complete=(mode=='single' or (len(records)<size if mode=='offset' else not records))
        rows=list(old.get('rows',[]));seen=set(old.get('seen',[]));page_ids=set()
        if len(seen)!=len(old.get('seen',[])):fail('MATRIX_PROGRESS_DUPLICATE')
        cursor=old.get('cursor') or _read(pagination['initial'],env)
        previous_cursor=None;next_cursor=None
        for record in records:
            env.update(row=record,v={})
            for binding in d['lets']:
                env['v'][binding['name']]=_read(binding['value'],env,binding['code'])
            for guard in d['row_asserts']:_guard(guard,env)
            identity=_read(d['identity'],env)
            if not isinstance(identity,str) or len(identity)>256:fail('ROW_ID')
            if identity in page_ids:fail(d['page_duplicate_code'])
            if identity in seen:fail(d['duplicate_code'])
            page_ids.add(identity);seen.add(identity)
            if mode=='cursor':
                update=_read(pagination['cursor'],env,pagination['order_code'])
                try:
                    stamp=naive_stamp(update);lower=naive_stamp(cursor)
                    if stamp<lower or (previous_cursor is not None and stamp<previous_cursor):fail(pagination['order_code'])
                except (MatrixError,TypeError,ValueError):fail(pagination['order_code'])
                previous_cursor=stamp;next_cursor=update
            include=_read(d['include'],env)
            if type(include)is not bool:fail('MATRIX_INCLUDE_TYPE')
            if include:
                mapped=_read(d['map'],env)
                if not isinstance(mapped,dict):fail('MATRIX_ROW_MAPPING')
                rows.append(mapped)
            if len(seen)>limits['max_rows'] or len(rows)>limits['max_rows']:fail('TABLE_CAPACITY')
        if mode=='cursor' and records and naive_stamp(next_cursor)<=naive_stamp(cursor):fail(pagination['stalled_code'])
        if len(canonical(rows).encode())>limits['max_bytes']:fail('TABLE_CAPACITY')
        if complete:
            env.update(rows=rows,totals=totals)
            for guard in d['dataset_asserts']:_guard(guard,env)
            return {'complete':True,'rows':rows,'currency':currency,'progress':None}
        result={'rows':rows,'seen':sorted(seen),'offset':old.get('offset',0)+len(records),
                'cursor':next_cursor,'totals':totals,'currency':currency,'recipe_hash':self.fingerprint(operation),'scope_hash':scope_hash}
        if len(canonical(result).encode())>limits['max_bytes']:fail('TABLE_CAPACITY')
        return {'complete':False,'rows':[],'currency':currency,'progress':result}
