"""Structured feedback for model decisions; no raw provider errors or replay IO."""
import json
import re
from semantics import fingerprint

FORBIDDEN_READ_FUNCTIONS=frozenset({'get_default'})

class DecisionRepaired(Exception):
    """The rejection and the next decision were committed atomically."""
    pass

def request_key(item):
    return fingerprint({key:item[key] for key in ('store_id','operation','params')})

def compiler_declines(response):
    from semantics import strict_json,Rejected
    raw=response.get('content')
    if response.get('finish_reason')!='stop'or type(raw)is not str or len(raw)>24000:return False
    try:value=strict_json(raw)
    except (Rejected,RecursionError):return False
    return (type(value)is dict and set(value)=={'expressions','fully_understood','unsupported'}
        and value['expressions']==[] and value['fully_understood']is True and value['unsupported']is True)

def catalog_parameter_names(platform):
    import read_surface
    names=set()
    def visit(value):
        if type(value)is dict:
            for key,child in value.items():
                if type(key)is str and re.fullmatch('[A-Za-z_][A-Za-z0-9_]{0,79}',key) and not re.search('token|password|secret|authorization|cookie',key,re.I):names.add(key)
                visit(child)
        elif type(value)is list:
            for child in value[:1]:visit(child)
    for meta in read_surface.CATALOG['providers'][platform]['operations'].values():visit(meta.get('template'))
    return names

def provider_feedback(raw, params, operation_schema=None, known_parameters=()):
    """Expose categories and known parameter NAMES, never echoed values/text."""
    text=raw[:16384].decode('utf-8',errors='replace').lower()
    names={name for name in known_parameters if type(name)is str and re.fullmatch('[A-Za-z_][A-Za-z0-9_]{0,79}',name) and not re.search('token|password|secret|authorization|cookie',name,re.I)}
    def walk(value,depth=0):
        if depth>5 or len(names)>=64:return
        if type(value)is dict:
            for key,child in value.items():
                if type(key)is str and re.fullmatch('[A-Za-z_][A-Za-z0-9_]{0,79}',key):names.add(key)
                walk(child,depth+1)
        elif type(value)is list:
            for child in value[:8]:walk(child,depth+1)
    walk(params)
    if type(operation_schema)is dict:
        walk(operation_schema.get('template'))
        for name in operation_schema.get('required_parameters',[]):
            if type(name)is str:
                for part in name.split('.'):
                    if re.fullmatch('[A-Za-z_][A-Za-z0-9_]{0,79}',part):names.add(part)
    hints=[]
    for label,words in [('required',['required','missing','empty','обязатель']),('format',['format','unmarshal','invalid','incorrect','формат']),('range',['range','too large','too small','диапазон'])]:
        if any(word in text for word in words):hints.append(label)
    result={'reason_hints':hints,'mentioned_parameters':sorted(name for name in names if re.search(r'\b'+re.escape(name.lower())+r'\b',text)),
            'body_truncated':len(raw)>16384,
            'parameter_hint_scope':'provider_catalog_vocabulary_only; operation schema and request validator remain authoritative'}
    try:
        body=json.loads(raw)
        code=body.get('code')if type(body)is dict else None
        if type(code)is int and 0<=code<=65535 or code in ('INVALID_ARGUMENT','INVALID_PARAMS','VALIDATION_ERROR','BAD_REQUEST','UNPROCESSABLE_ENTITY'):result['provider_code']=code
    except (ValueError,UnicodeError):pass
    return result

def expression_contract():
    # One registry is used by both execution and the model-facing contract.
    from matrix_core import FUNCTIONS
    return {'functions':{name:value[0]for name,value in sorted(FUNCTIONS.items())if name not in FORBIDDEN_READ_FUNCTIONS},
      'function_form':{'$fn':['EXACT_FUNCTION_NAME','argument1','argument2_if_required']},
      'path_form':{'$path':['calls',0,'data','EXACT_FIELD_FROM_DATA']},
      'map_form':{'$map':[{'$path':['calls',0,'data','rows']},'row',{'$fn':['get',{'$path':['row']},'EXACT_FIELD_FROM_DATA']}]},
      'sum_form':{'$fn':['sum_values',{'$map':[{'$path':['calls',0,'data','rows']},'row',{'$fn':['decimal_comma',{'$fn':['get',{'$path':['row']},'EXACT_FIELD_FROM_DATA']}]}]}]},
      'missing_values':'Never invent defaults for absent source values.',
      'instruction':'Use exact function names and exact arity from functions. These are expression forms, not source values or field names. Arithmetic is computed by the server over all saved rows.'}

def template_shape(value,depth=0,budget=None):
    if budget is None:budget=[0]
    budget[0]+=1
    if depth>10 or budget[0]>256:return {'type':'structure_limit'}
    if type(value)is dict:
        result={'type':'object','properties':{}}
        for key,child in value.items():
            if budget[0]>=256:
                result['properties_truncated']=True;break
            if type(key)is str and len(key)<=160:result['properties'][key]=template_shape(child,depth+1,budget)
        return result
    if type(value)is list:return {'type':'array','items':template_shape(value[0],depth+1,budget)if value else None}
    return {'type':'null'if value is None else 'boolean'if type(value)is bool else 'integer'if type(value)is int else 'number'if type(value)is float else 'string'}

def repair_provider_rejection(worker,row,progress,item,store,error):
    import read_surface
    key=request_key(item)
    rejected=progress.setdefault('rejected_reads',[])
    if key not in rejected:rejected.append(key)
    feedback={'code':'READ_PROVIDER_ARGUMENTS_REJECTED','http':error.status,'operation':item['operation'],
       'provider_request_executed':True,'response_received':True,
       'safe_details':getattr(error,'feedback',None)or{},
       'retained_successful_reads':len(progress['calls']),
       'repair_instruction':'The read API rejected these arguments. Correct them using the operation schema or select an appropriate permitted read. Do not resend the identical rejected request. Keep the original question, period and successful data. Never change credentials, fabricate IDs or substitute another metric. If no valid read exists, explain the limitation.'}
    meta=read_surface.method(store['platform'],item['operation'])
    feedback['operation_schema']={'required_parameters':meta.get('required_parameters',[]),'request_style':meta.get('request_style'),'parameter_shape':template_shape(meta.get('template')),'template_is_not_source_data':True}
    try:feedback['operation_help']=read_surface.context_feedback(store['platform'],item['operation'],'HTTP_'+str(error.status))
    except Exception:pass
    progress.update(pending=None,feedback=feedback)
    # Keep the rejected decision and safe diagnostics visible after discovery or
    # another local validation error; otherwise the model loses the repair input.
    progress.setdefault('read_rejections',[]).append({'request':read_surface.sanitize(item),'feedback':feedback})
    progress.setdefault('events',[]).append({'decision':{'action':'read','operation':item['operation']},'validation':'PROVIDER_REJECTED','http':error.status,'request_hash':key})
    worker.repo.reschedule(row['id'],row['owner'],progress)
