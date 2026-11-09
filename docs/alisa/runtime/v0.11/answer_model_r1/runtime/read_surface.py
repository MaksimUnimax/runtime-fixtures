"""Method-first read catalogue imported from Octoport, independent of reports.

The exact donor request validators execute in a network-free Node VM. Provider IO
continues through the existing HTTPTransport and the existing calls/rates ledger.
"""
from pathlib import Path
from urllib.parse import urlsplit
from decimal import Decimal
from copy import deepcopy
import hashlib,json,re,subprocess,gzip
from semantics import Rejected,canonical_json,fingerprint

ROOT=Path(__file__).resolve().parent
DATA=ROOT/'read_surface_data'
CATALOG=json.loads(gzip.decompress((DATA/'catalog.json.gz').read_bytes()))
CATALOG_HASH=fingerprint(CATALOG)
BRIDGE_HASH=hashlib.sha256((DATA/'contract_bridge.mjs').read_bytes()).hexdigest()
SOURCE_HASH=hashlib.sha256(gzip.decompress((DATA/'donor.json.gz').read_bytes())).hexdigest()
PIN=fingerprint({'catalog':CATALOG_HASH,'builder':BRIDGE_HASH,'donor':SOURCE_HASH,'binding_code':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'planner_code':hashlib.sha256((ROOT/'universal_reads.py').read_bytes()).hexdigest(),'protected_code':{n:hashlib.sha256((ROOT/n).read_bytes()).hexdigest()for n in ['read_contracts.py','protected_reads.py','report_tables.py','subscription_access.py','subscription_access.json.gz']}})


def need(ok,code):
    if not ok:raise Rejected(code)


def method(platform,operation):
    need(platform in ('ozon','wb')and type(operation)is str,'READ_METHOD_SCHEMA')
    row=CATALOG['providers'][platform]['operations'].get(operation)
    need(row is not None,'READ_METHOD_UNKNOWN')
    return row


def projected_read_contract(row):
    return (row.get('projected_request')=='empty-params-get-v1'and row.get('effect')=='READ'
        and row.get('execution_enabled')is False and row.get('blocked_reason')=='DIRECT_PII_SURFACE'
        and row.get('privacy')=='blocked_pii'and row.get('current')is True and row.get('source_readonly')is True
        and row.get('method')=='GET'and row.get('query_keys')==[]and row.get('required_query_keys')==[]
        and row.get('body_required')is False and '{'not in row.get('path',''))


def execution_allowed(row):
    return row.get('execution_enabled')is True or projected_read_contract(row)and projection_for(row)is not None


def projection_for(row):
    name=row.get('response_projection')
    if name is None:return None
    profile=CATALOG.get('response_projections',{}).get(name)
    need(type(profile)is dict and profile.get('schema')=='alice-business-response/v1'and profile.get('default')=='DROP'and type(profile.get('fields'))is dict,'READ_PROJECTION_POLICY')
    need(row.get('effect')=='READ'and ((row.get('execution_enabled')is True and row.get('privacy_policy')=='operator_personal_data_gate')or projected_read_contract(row)),'READ_PROJECTION_SCOPE')
    return profile


def available(row):
    if row.get('completion'):
        return row['completion']['mode']!='replaced'and row.get('effect')=='READ'
    return (row.get('effect')=='READ'and execution_allowed(row)
        and (row.get('privacy_policy')not in('operator_personal_data_gate','opaque_ref_provenance_gate')or projection_for(row)is not None)
        and (row.get('privacy')!='blocked_pii'or projection_for(row)is not None))


def build(platform,operation,params):
    row=method(platform,operation)
    need(row.get('effect')=='READ','READ_ONLY')
    completion=row.get('completion',{})
    mode=completion.get('mode')
    if mode=='replaced':raise Rejected('READ_METHOD_REPLACED','Метод отключён площадкой. Актуальные методы: '+', '.join(completion['alternatives'])+'.')
    if mode in('wb-protected','wb-service'):
        from read_contracts import build_wb
        return build_wb(row,params)
    if mode=='opaque-file':
        need(type(params)is dict and set(params)<={'file_ref','sheet','offset','limit'}and 'file_ref'in params,'READ_PARAMS_SCHEMA')
        need(type(params['file_ref'])is str and re.fullmatch(r'rpf_[A-Za-z0-9_-]{24,80}',params['file_ref'])is not None,'READ_FILE_PROVENANCE_REQUIRED')
        need('sheet'not in params or type(params['sheet'])is str,'READ_TABLE_SHEET')
        need(type(params.get('offset',0))is int and params.get('offset',0)>=0,'READ_PARAMS_SCHEMA')
        need(type(params.get('limit',200))is int and 1<=params.get('limit',200)<=500,'PROVIDER_REQUEST_SIZE')
        return {'method':'GET','url':'https://api-seller.ozon.ru/__opaque_report_file__','headers':{},'resource_ref':params['file_ref']}
    need(execution_allowed(row),'READ_METHOD_DISABLED')
    need((mode=='ozon-protected'or row.get('privacy_policy')!='operator_personal_data_gate'or projection_for(row)is not None)and (row.get('privacy')!='blocked_pii'or projection_for(row)is not None),'READ_PERSONAL_DATA_PERMISSION')
    need(row.get('privacy_policy')!='opaque_ref_provenance_gate','READ_FILE_PROVENANCE_REQUIRED')
    params=normalize_params(platform,operation,params)
    def safe_numbers(v):
        if type(v)is dict:
            for x in v.values():safe_numbers(x)
        elif type(v)is list:
            for x in v:safe_numbers(x)
        elif type(v)is int:need(abs(v)<=9007199254740991,'READ_INTEGER_USE_STRING')
    safe_numbers(params)
    payload=canonical_json({'platform':platform,'operation':operation,'params':params})
    need(len(payload.encode())<=32000,'READ_PARAMS_SIZE')
    try:
        proc=subprocess.run(['/usr/local/bin/node',str(DATA/'contract_bridge.mjs')],input=payload,capture_output=True,text=True,timeout=5)
        response=json.loads(proc.stdout)
    except (OSError,ValueError,subprocess.TimeoutExpired):raise Rejected('READ_BUILDER_UNAVAILABLE')from None
    if response.get('ok')is not True:
        code=response.get('error','READ_REQUEST_INVALID')
        error=Rejected(code if re.fullmatch(r'[A-Z][A-Z0-9_]{0,90}',str(code))else'READ_REQUEST_INVALID')
        field=response.get('field');kind=response.get('expected_type')
        if type(field)is str and re.fullmatch(r'params(?:\.[A-Za-z_][A-Za-z0-9_]*|\[[0-9]+\]){1,12}',field)and kind in('string','integer','boolean','array','object'):
            error.contract_feedback={'field':field,'expected_json_type':kind,'source':'original_request_validator','request_executed':False}
        raise error
    request=response['request'];url=urlsplit(request['url'])
    allowed=CATALOG['providers'][platform]['hosts']
    need(url.scheme=='https'and not url.username and not url.password and not url.fragment and 'https://'+url.netloc in allowed,'READ_FIXED_ORIGIN')
    need(request['method'] in ('GET','POST')and not request.get('headers'),'READ_FIXED_TRANSPORT')
    return request


def quota(platform,operation):
    row=method(platform,operation)
    endpoint=row['wire_url']or'opaque-report-file';verb=row['method']
    # Same physical method keeps its rate key and provider pacing, not an
    # application daily budget. New methods rely on actual provider feedback.
    from http_transport import MATRICES
    matches=[m.recipe(k)for k,m in MATRICES.items()if m.recipe(k)['url']==endpoint and m.recipe(k)['method']==verb]
    if matches:
        keys={m['quota_operation']for m in matches}
        need(len(keys)==1,'READ_QUOTA_ALIAS_CONFLICT')
        return next(iter(keys)),max(m['interval']for m in matches),None
    return 'read:'+hashlib.sha256((verb+' '+endpoint).encode()).hexdigest()[:20],0,None


def request_for(store,operation,params):
    from providers import Request
    platform=store['platform'];params=normalize_params(platform,operation,params);build(platform,operation,params)
    key,interval,daily=quota(platform,operation)
    return Request('read.'+platform+'.'+operation,platform+':'+store['identity']+':'+key,store['id'],{'params':deepcopy(params)},interval,daily)


def discover(platform,query='',cluster=None,offset=0,limit=25):
    need(platform in CATALOG['providers']and type(offset)is int and offset>=0,'READ_DISCOVERY_SCHEMA')
    words=re.findall(r'[a-zа-я0-9_]+',str(query).casefold())[:16]
    requested_cluster=cluster
    known_clusters=CATALOG['providers'][platform]['clusters']
    invalid_cluster=cluster is not None and cluster not in known_clusters
    if invalid_cluster:cluster=None
    rows=[];fallback=[]
    for alias,row in CATALOG['providers'][platform]['operations'].items():
        c=row.get('cluster',row.get('host',''))
        if cluster is not None and c!=cluster:continue
        text=' '.join([alias,row.get('purpose',''),row.get('section',''),row['path'],c]).casefold()
        score=sum(len(w)for w in words if w in text)
        required=row.get('required_parameters',[])
        if platform=='wb':required=[*row.get('required_query_keys',[]),*re.findall(r'\{([^}]+)\}',row['path']),*(['body']if row.get('body_required')else[])]
        item=(score,{'operation':alias,'cluster':c,'method':row['method'],'path':row.get('wire_path',row['path']),
          'purpose':row.get('purpose',alias),'available':available(row),'restriction':row.get('blocked_reason')or row.get('privacy_policy')if not available(row)else None,
          'example_not_real_ids':row.get('template',{}),'required':required,
          'query_keys':row.get('query_keys',[]),'body_required':row.get('body_required',False),
          'response_style':row.get('response_style',row.get('response_mode','json')),
          'subscription_access':deepcopy(row.get('subscription_access')),'completion':deepcopy(row.get('completion')),'content_scope':row.get('content_scope'),'response_projection':row.get('response_projection'), 'scope_note':row.get('scope_note'), 'related_read_methods':row.get('related_read_methods',[]),
          'response_fields':row.get('response_fields',{}), 'context_rules':deepcopy(row.get('context_rules',[])),
          'parameter_forms':deepcopy(row.get('parameter_forms',[]))})
        fallback.append(item)
        if not words or score:rows.append(item)
    no_exact_match=not rows
    if no_exact_match:rows=fallback
    rows.sort(key=lambda x:(x[1]['operation'] != query, -x[0], x[1]['operation']))
    return {'request':{'platform':platform,'query':query,'cluster':requested_cluster,'offset':offset},
        'items':[r for _,r in rows[offset:offset+limit]],'total':len(rows),'next_offset':offset+limit if offset+limit<len(rows)else None,
        'query_no_exact_match':no_exact_match,'unknown_cluster':invalid_cluster,'valid_clusters':list(known_clusters),
        'note':'Choose an exact returned alias. If words did not match, the selected cluster is shown without the text filter. Do not repeat the same search.'}


def clusters(platform):
    return deepcopy(CATALOG['providers'][platform]['clusters'])


_SECRET=re.compile(r'authorization|api.?key|client.?secret|access.?token|refresh.?token|^token$|cookie|password',re.I)
_PERSON=re.compile(r'phone|e.?mail|address|addressee|passport|first.?name|last.?name|middle.?name|full.?name|^fio$|^username$|latitude|longitude|^(?:customer|buyer|recipient)(?:_?(?:id|name|info|data))?$',re.I)
def sanitize(value,depth=0,counter=None):
    """Lossless business numbers; remove secrets and customer identifiers for AI."""
    if counter is None:counter=[0]
    counter[0]+=1;need(depth<=40 and counter[0]<=250000,'READ_RESPONSE_COMPLEXITY')
    if value is None or type(value)in(bool,int):return value
    if isinstance(value,Decimal):return str(value)
    if type(value)is float:need(False,'READ_FLOAT_NOT_ALLOWED')
    if type(value)is str:
        value=re.sub(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}','[EMAIL_REDACTED]',value)
        return value
    if type(value)is list:return [sanitize(x,depth+1,counter)for x in value]
    need(type(value)is dict,'READ_RESPONSE_SCHEMA')
    return {k:('[REDACTED]'if _SECRET.search(k)or _PERSON.search(k)else sanitize(v,depth+1,counter))for k,v in value.items()}


def summarize(value,depth=0):
    """Only planner context is sampled; the stored response and expressions are not."""
    if depth>7:return {'context_omitted':True,'type':type(value).__name__}
    if type(value)is dict:return {k:summarize(v,depth+1)for k,v in list(value.items())[:60]}
    if type(value)is list:return [summarize(v,depth+1)for v in value[:15]]
    if type(value)is str and len(value)>800:return value[:800]+' [context shortened]'
    return value


def _at(value,path):
    need(type(path)is list and all(type(x)in(str,int)for x in path),'READ_CONTEXT_RULE_SCHEMA')
    for key in path:
        if type(value)is dict and key in value:value=value[key]
        elif type(value)is list and type(key)is int and 0<=key<len(value):value=value[key]
        else:raise Rejected('READ_CONTEXT_EVIDENCE_MISSING')
    return value


def validate_context(platform,operation,params,store_id,calls):
    """Apply trusted catalogue applicability to same-store observed response rows.

    No report arithmetic, no name heuristics, no API call, no invented data.
    Direct callers without previous evidence retain the original API contract.
    """
    meta=method(platform,operation)
    for rule in meta.get('context_rules',[]):
        fields={'id','source_operations','rows_path','row_id_path','parameter_path','field_path','allowed_values','code','reason','alternatives'}
        need(type(rule)is dict and set(rule)==fields,'READ_CONTEXT_RULE_SCHEMA')
        identifier=_at(params,rule['parameter_path'])
        need(type(identifier)in(str,int),'READ_CONTEXT_PARAMETER_TYPE')
        matched=[]
        for call in calls:
            if call.get('store_id')!=store_id or call.get('operation')not in rule['source_operations']:continue
            rows=_at(call['data'],rule['rows_path']);need(type(rows)is list,'READ_CONTEXT_EVIDENCE_SCHEMA')
            for row in rows:
                row_id=_at(row,rule['row_id_path'])
                if type(row_id)in(str,int)and str(row_id)==str(identifier):matched.append(row)
        for row in matched:
            observed=_at(row,rule['field_path'])
            if observed not in rule['allowed_values']:raise Rejected(rule['code'])
    return True


def context_feedback(platform,operation,code):
    meta=method(platform,operation)
    for rule in meta.get('context_rules',[]):
        if rule['code']==code:return {'reason':rule['reason'],'alternative_operations':rule['alternatives']}
    return {}


def normalize_params(platform,operation,params):
    """Normalize only explicitly declared parameter representations, not values.

    Comma-list and JSON-array IDs get the same typed request; every member still
    requires original contract and provenance checks. No IDs or defaults added.
    """
    need(type(params)is dict,'READ_PARAMS_SCHEMA');result=deepcopy(params)
    for spec in method(platform,operation).get('parameter_forms',[]):
        need(type(spec)is dict and set(spec)=={'path','kind'}and spec['kind']=='positive_integer_list','READ_PARAMETER_FORM_SCHEMA')
        path=spec['path'];need(type(path)is list and path and all(type(x)is str for x in path),'READ_PARAMETER_FORM_SCHEMA')
        parent=result
        for key in path[:-1]:
            need(type(parent)is dict and key in parent,'READ_PARAMETER_FORM_REQUIRED');parent=parent[key]
        need(type(parent)is dict and path[-1]in parent,'READ_PARAMETER_FORM_REQUIRED');v=parent[path[-1]]
        if type(v)is str:
            need(re.fullmatch(r'[0-9]+(?:\s*,\s*[0-9]+)*',v)is not None,'READ_PARAMETER_FORM_INVALID');v=v.split(',')
        need(type(v)is list and bool(v),'READ_PARAMETER_FORM_INVALID');items=[]
        for x in v:
            need(type(x)is int or(type(x)is str and re.fullmatch(r'[0-9]+',x.strip())is not None),'READ_PARAMETER_FORM_INVALID')
            number=int(x);need(0<number<=9007199254740991,'READ_INTEGER_USE_STRING');items.append(number)
        need(len(set(items))==len(items),'READ_PARAMETER_DUPLICATE_ID');parent[path[-1]]=items
    return result


def project_response(platform,operation,value):
    """Apply a declared allow-list before any raw provider body is persisted.

    Never recursively mine an unknown/customer object for allowed-looking keys.
    A dictionary with no recognized fields fails instead of becoming fake zero.
    """
    row=method(platform,operation);profile=projection_for(row)
    if profile is None:return value
    allowed=profile['fields'];stats={'removed_fields':0,'retained_fields':0};budget=[0]
    blank_allowed=profile.get('preserve_blank_calendar_fields',[])
    need(type(blank_allowed)is list and all(allowed.get(k)=='source_calendar'for k in blank_allowed),'READ_PROJECTION_POLICY')
    blank_observed=set()
    kinds={'object','objects','object_or_objects','integer','number','identifier','enum','currency','boolean','cursor','timestamp','business_label','money','record_id','date','source_calendar'}
    need(all(type(k)is str and type(v)is str and v in kinds and not _SECRET.search(k)and not _PERSON.search(k)for k,v in allowed.items()),'READ_PROJECTION_POLICY')
    def scalar(value,kind):
        if value is None:return None
        if kind=='money':
            if type(value)is dict:
                need({'amount','currency'}<=set(value),'READ_PROJECTION_TYPE')
                need(value['amount'] is not None and value['currency'] is not None,'READ_PROJECTION_TYPE')
                return {'amount':scalar(value['amount'],'number'),'currency':scalar(value['currency'],'currency')}
            return scalar(value,'number')
        if kind=='record_id':
            need(type(value)is int and value>=0 or type(value)is str and re.fullmatch(r'[A-Za-z0-9_-]{1,180}',value)is not None,'READ_PROJECTION_TYPE');return value
        if kind=='source_calendar':
            from datetime import date,datetime
            need(type(value)is str,'READ_PROJECTION_TYPE')
            try:
                if re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}',value):date.fromisoformat(value)
                elif re.fullmatch(r'[0-9]{2}\.[0-9]{2}\.[0-9]{4}',value):datetime.strptime(value,'%d.%m.%Y')
                elif re.fullmatch(r'[0-9]{2}\.[0-9]{2}\.[0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2}',value):datetime.strptime(value,'%d.%m.%Y %H:%M:%S')
                elif re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?(?:Z|[+-][0-9]{2}:[0-9]{2})?',value):datetime.fromisoformat(value.replace('Z','+00:00'))
                else:raise ValueError('SOURCE_CALENDAR_FORMAT')
            except ValueError:raise Rejected('READ_PROJECTION_TYPE')from None
            # Preserve the original representation. In particular, never attach
            # a timezone to a zone-less provider field or shift the report day.
            return value
        if kind=='date':
            from datetime import date
            need(type(value)is str and re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}',value)is not None,'READ_PROJECTION_TYPE')
            try:date.fromisoformat(value)
            except ValueError:raise Rejected('READ_PROJECTION_TYPE')from None
            return value
        if kind=='integer':
            need(type(value)is int or type(value)is str and re.fullmatch(r'-?[0-9]{1,80}',value)is not None,'READ_PROJECTION_TYPE');return value
        if kind=='number':
            need(type(value)in(int,str,Decimal)and not isinstance(value,bool),'READ_PROJECTION_TYPE')
            try:n=Decimal(str(value))
            except Exception:raise Rejected('READ_PROJECTION_TYPE')from None
            need(n.is_finite()and len(str(value))<=100,'READ_PROJECTION_TYPE');return value
        if kind=='boolean':need(type(value)is bool,'READ_PROJECTION_TYPE');return value
        if kind=='cursor'and type(value)is int:return value
        need(type(value)is str,'READ_PROJECTION_TYPE')
        if kind=='business_label':
            import unicodedata
            need(1<=len(value)<=256 and not any(unicodedata.category(ch)in ('Cc','Cf')for ch in value)and re.search(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}',value)is None,'READ_PROJECTION_TYPE');return value
        if kind=='currency':need(re.fullmatch(r'[A-Z]{3}',value)is not None,'READ_PROJECTION_TYPE')
        elif kind=='enum':need(re.fullmatch(r'[A-Za-z][A-Za-z0-9_.:-]{0,99}',value)is not None,'READ_PROJECTION_TYPE')
        elif kind=='identifier':need(re.fullmatch(r'[\w./:-]{1,160}',value)is not None,'READ_PROJECTION_TYPE')
        elif kind=='cursor':need(len(value)<=2000 and not any(ch in value for ch in ('\n','\r','\x00')),'READ_PROJECTION_TYPE')
        elif kind=='timestamp':
            from datetime import datetime
            try:d=datetime.fromisoformat(value.replace('Z','+00:00'))
            except ValueError:raise Rejected('READ_PROJECTION_TYPE')from None
            need(d.tzinfo is not None,'READ_PROJECTION_TYPE')
        return value
    def obj(value,depth=0):
        budget[0]+=1;need(depth<=40 and budget[0]<=250000,'READ_RESPONSE_COMPLEXITY')
        need(type(value)is dict,'READ_PROJECTION_SHAPE');out={}
        for key,item in value.items():
            kind=allowed.get(key)
            if kind is None:stats['removed_fields']+=1;continue
            if kind=='source_calendar'and key in blank_allowed and item in ('',None):
                out[key]=item;blank_observed.add(key)
            elif item is None:out[key]=None
            elif kind=='object_or_objects':
                if type(item)is dict:out[key]=obj(item,depth+1)
                else:
                    need(type(item)is list,'READ_PROJECTION_TYPE');out[key]=[obj(x,depth+1)for x in item]
            elif kind=='object':out[key]=obj(item,depth+1)
            elif kind=='objects':
                need(type(item)is list,'READ_PROJECTION_TYPE');out[key]=[obj(x,depth+1)for x in item]
            else:
                try:out[key]=scalar(item,kind)
                except Rejected as error:
                    event={'event':'business_projection_validation','code':error.code,'field':key,'expected_kind':kind,'actual_type':type(item).__name__}
                    if kind=='source_calendar'and type(item)is str:
                        # Shape only: actual digits and letters never enter logs.
                        event['value_shape']=re.sub(r'[A-Za-zА-Яа-я]', 'A', re.sub(r'[0-9]', '#',item))[:80]
                        event['value_length']=len(item)
                    print(canonical_json(event),flush=True)
                    raise
            stats['retained_fields']+=1
        need(not value or bool(out),'READ_PROJECTION_UNQUALIFIED')
        return out
    root_array=type(value)is list
    if root_array:
        need(profile.get('root_array_as_items')is True,'READ_PROJECTION_SHAPE')
        answer={'items':[obj(item)for item in value]}
    else:answer=obj(value)
    answer['_read_projection']={'profile':row['response_projection'],'business_only':True,'unknown_fields_excluded':True,'counts':stats}
    if profile.get('content_scope'):answer['_read_projection']['content_scope']=profile['content_scope']
    if root_array:answer['_read_projection']['root_array_wrapped_as']='items'
    if blank_observed:
        answer['_read_projection']['source_period_status']='MISSING'
        answer['_read_projection']['blank_calendar_fields']=sorted(blank_observed)
    return answer
