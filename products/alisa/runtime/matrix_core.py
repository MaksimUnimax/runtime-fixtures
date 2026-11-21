"""Finite data-binding interpreter. No provider/endpoint names or executable configuration.

The matrix supplies only JSON trees over declared operators. Each stage validates
all branches before execution. Missing fields fail closed; zero is never null.
No HTTP, credentials, files, imports, callbacks, eval, or SQL are available here.
"""
from __future__ import annotations
import copy
import hashlib
import json
import math
import re
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo
from contextvars import ContextVar
import uuid

LANGUAGE = 'alice-data-bindings/v1'
MAX_AST_NODES = 4096
MAX_DEPTH = 32
MAX_TEXT = 4096

class MatrixError(ValueError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def fail(code='MATRIX_SCHEMA'):
    raise MatrixError(code)


def canonical(value):
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True,
                          separators=(',', ':'), allow_nan=False)
    except (TypeError,ValueError,OverflowError,RecursionError):
        fail('MATRIX_SERIALIZATION')


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


# Explicit resource bounds, not rounding rules or hidden defaults.
MAX_COEFFICIENT_DIGITS = 80
MAX_SOURCE_SCALE = 32
MAX_INTERMEDIATE_SCALE = 64
MAX_FIXED_TEXT = 100


def money(value, *, max_scale=MAX_INTERMEDIATE_SCALE):
    if isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
        fail('NUMBER_TYPE')
    if isinstance(value,str) and len(value)>100:
        fail('NUMBER_RANGE')
    if type(value)is int and value.bit_length()>256:
        fail('NUMBER_RANGE')
    try:
        number = value if isinstance(value,Decimal) else Decimal(str(value))
    except (InvalidOperation, ValueError):
        fail('NUMBER_FORMAT')
    if not number.is_finite():
        fail('NUMBER_RANGE')
    parts=number.as_tuple();exponent=parts.exponent;digits=len(parts.digits)
    scale=max(0,-exponent)
    # Check before fixed-point formatting, including zero with a huge exponent.
    fixed_length=parts.sign+max(1,digits+exponent)+(1+scale if scale else 0)
    if (digits>MAX_COEFFICIENT_DIGITS or scale>max_scale or exponent>18
            or fixed_length>MAX_FIXED_TEXT or number.copy_abs()>Decimal('1e18')):
        fail('NUMBER_RANGE')
    return number


def decimal_text(value):
    return format(money(value), 'f')


def source_decimal_text(value):
    return format(money(value,max_scale=MAX_SOURCE_SCALE),'f')


def natural(value):
    number = money(value)
    if number < 0 or number != number.to_integral_value():
        fail('NUMBER_RANGE')
    return format(number, 'f')


def nonnegative(value):
    if money(value) < 0:
        fail('NUMBER_RANGE')
    return decimal_text(value)


def text(value):
    if not isinstance(value, str) or len(value) > MAX_TEXT:
        fail('STRING_TYPE')
    return value


def identifier(value):
    if type(value) is not int or not 0 < value < 10**19:
        fail('ROW_ID')
    return str(value)


def string_identifier(value):
    value = text(value)
    if not re.fullmatch(r'[1-9][0-9]{0,18}', value):
        fail('ROW_ID')
    return value


def label(value):
    value = text(value)
    if len(value) > 2000:
        fail('ROW_LABEL')
    return re.sub(r'[\x00-\x1f<>]', ' ', value)[:120]


def day(value):
    value = text(value)
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        fail('DATE_FORMAT')
    return date.fromisoformat(value).isoformat()


def event_day(value, zone):
    value = text(value)
    if len(value) > 40:
        fail('DATETIME_FORMAT')
    stamp = datetime.fromisoformat(value)
    return (stamp.astimezone(ZoneInfo(zone)) if stamp.tzinfo else stamp).date().isoformat()


def naive_stamp(value):
    value = text(value)
    if len(value) > 40:
        fail('DATETIME_FORMAT')
    stamp = datetime.fromisoformat(value)
    if stamp.tzinfo:
        fail('CURSOR_TIMEZONE')
    return stamp


def strict_equal(left, right):
    if isinstance(left, bool) or isinstance(right, bool):
        return type(left) is type(right) and left == right
    return left == right


def _sum(rows, field):
    if not isinstance(rows, list) or len(rows) > 20000:
        fail('ROW_CAPACITY')
    return decimal_text(sum((money(row[field]) for row in rows), Decimal(0)))


def _days_cover(rows, field, start, end):
    a, b = date.fromisoformat(start), date.fromisoformat(end)
    if not 0 <= (b-a).days < 366:
        fail('PERIOD_LIMIT')
    return {day(row[field]) for row in rows} == {
        (a+timedelta(days=n)).isoformat() for n in range((b-a).days+1)
    }


def array(value):
    if not isinstance(value,list) or len(value)>20000:fail('ROW_CAPACITY')
    return value


def nonempty(value):
    value=text(value)
    if not value:fail('STRING_EMPTY')
    return value


def count_integer(value):
    number=money(value)
    if number<0 or number!=number.to_integral_value():fail('NUMBER_RANGE')
    return int(number)


def positive_integer(value):
    if type(value)is not int or value<=0 or value>10**30:fail('NUMBER_RANGE')
    return str(value)


def uuid_text(value):
    value=text(value)
    if not re.fullmatch(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}',value):fail('UUID_FORMAT')
    return value


def month(value):
    value=text(value)
    if not re.fullmatch(r'\d{4}-\d{2}(?:-01)?',value):fail('MONTH_FORMAT')
    date.fromisoformat(value[:7]+'-01')
    return value[:7]


def decimal_comma(value):
    if isinstance(value,str):
        if not re.fullmatch(r'\d+(?:[.,]\d{1,8})?',value):fail('NUMBER_FORMAT')
        value=value.replace(',','.')
    return nonnegative(value)


def at(obj,key):
    if isinstance(obj,dict) and isinstance(key,str):return obj[key]
    if isinstance(obj,list) and type(key)is int and 0<=key<len(obj):return obj[key]
    fail('BINDING_TYPE')


def object_pairs(pairs):
    result={}
    for pair in array(pairs):
        if not isinstance(pair,list) or len(pair)!=2 or not isinstance(pair[0],str) or len(pair[0])>160:fail('OBJECT_PAIRS')
        if pair[0] in result:fail('OBJECT_DUPLICATE_KEY')
        result[pair[0]]=pair[1]
    return result


def checked(value,condition,code):
    if type(condition)is not bool or not isinstance(code,str) or not 0<len(code)<=100:fail('MATRIX_GUARDS')
    if not condition:fail(code)
    return value


def distinct(values):
    values=array(values)
    return len(values)==len({canonical(x) for x in values})


def optional_event_day(value,zone):
    if value is None:return None
    stamp=datetime.fromisoformat(text(value).replace('Z','+00:00'))
    if stamp.tzinfo is None:fail('DATETIME_TIMEZONE')
    return stamp.astimezone(ZoneInfo(zone)).date().isoformat()


# Exact operator names and arities are part of the versioned engine, never read
# as callable names from the configuration. There is no arbitrary regex engine.
FUNCTIONS = {
    'count_integer': (1,count_integer),
    'eq': (2, strict_equal), 'ne': (2, lambda a,b: not strict_equal(a,b)),
    'in': (2, lambda a,b: a in b),
    'and': (2, lambda a,b: type(a) is bool and type(b) is bool and a and b),
    'or': (2, lambda a,b: type(a) is bool and type(b) is bool and (a or b)),
    'not': (1, lambda a: not a if type(a) is bool else fail('BOOLEAN_TYPE')),
    'lt': (2, lambda a,b: a < b), 'le': (2, lambda a,b: a <= b),
    'gt': (2, lambda a,b: a > b), 'ge': (2, lambda a,b: a >= b),
    'len': (1, len), 'text': (1, text), 'label': (1, label),
    'brand': (1, lambda a: label(a).casefold().replace('ё', 'е')),
    'decimal': (1, source_decimal_text), 'natural': (1, natural),
    'nonnegative': (1, nonnegative), 'integer_id': (1, identifier),
    'string_id': (1, string_identifier), 'day': (1, day),
    'event_day': (2, event_day), 'hash': (1, digest),
    'prefix': (2, lambda a,n: text(a)[:n] if type(n) is int and 0<=n<=100 else fail()),
    'negate': (1, lambda a: decimal_text(-money(a))),
    'null_if_zero': (1, lambda a: None if money(a)==0 else decimal_text(a)),
    'nonnegative_test': (1, lambda a: money(a) >= 0),
    'type_is': (2, lambda a,b: {'integer':type(a) is int, 'string':isinstance(a,str),
        'array':isinstance(a,list), 'object':isinstance(a,dict),
        'boolean':type(a) is bool, 'null':a is None}.get(b, False)),
    'sum': (2, _sum), 'days_cover': (4, _days_cover),
    'days_between': (2, lambda a,b: (date.fromisoformat(b)-date.fromisoformat(a)).days),
    'same_numbers': (2, lambda a,b: len(a)==len(b) and all(money(x)==money(y) for x,y in zip(a,b))),
}

FUNCTIONS.update({
 'integer_add':(2,lambda a,b:a+b if type(a)is int and type(b)is int and 0<=a+b<=20000 else fail('NUMBER_RANGE')),
 'array':(1,array),'get':(2,at),
 'get_default':(3,lambda obj,key,default:obj.get(key,default) if isinstance(obj,dict) and isinstance(key,str) else fail('BINDING_TYPE')),
 'keys':(1,lambda obj:list(obj) if isinstance(obj,dict) else fail('BINDING_TYPE')),
 'pairs_object':(1,object_pairs),'checked':(3,checked),'distinct':(1,distinct),
 'nonempty':(1,nonempty),'positive_integer':(1,positive_integer),
 'uuid':(1,uuid_text),'month':(1,month),'decimal_comma':(1,decimal_comma),
 'add_numbers':(2,lambda a,b:decimal_text(money(a)+money(b))),
 'decimal_compare':(2,lambda a,b:(money(a)>money(b))-(money(a)<money(b))),
 'multiply_numbers':(2,lambda a,b:decimal_text(money(a)*money(b))),
 'sum_values':(1,lambda a:decimal_text(sum((money(x) for x in array(a)),Decimal(0)))),
 'all':(1,lambda a:all(x is True for x in array(a))),
 'any':(1,lambda a:any(x is True for x in array(a))),
 'concat':(2,lambda a,b:text(text(a)+text(b))),
 'optional_event_day':(2,optional_event_day),
 'index':(2,lambda a,v:array(a).index(v)),
 'merge':(2,lambda a,b:{**a,**b} if isinstance(a,dict) and isinstance(b,dict) else fail('BINDING_TYPE')),
})


def flatten_rows(values):
    out=[]
    for values_part in array(values):
        out.extend(array(values_part))
        if len(out)>20000:fail('ROW_CAPACITY')
    return out


def chunk_rows(values,size):
    values=array(values)
    if type(size)is not int or not 1<=size<=1000:fail('CHUNK_SIZE')
    return [values[i:i+size] for i in range(0,len(values),size)]


def csv_ids(values):
    values=array(values)
    if len(values)>1000:fail('ID_CAPACITY')
    out=[]
    for value in values:
        # Strings must be canonical numeric IDs, not endpoint/query fragments.
        out.append(identifier(value) if type(value)is int else string_identifier(value))
    return ','.join(out)


def utc_day_boundary(value,zone,end):
    if type(end)is not bool:fail('BOOLEAN_TYPE')
    from datetime import timezone,time as daytime
    start=date.fromisoformat(day(value))
    stamp=datetime.combine(start,daytime(23,59,59,999999) if end else daytime(0),ZoneInfo(zone))
    return stamp.astimezone(timezone.utc).isoformat().replace('+00:00','Z')


FUNCTIONS.update({
    'flatten':(1,flatten_rows),'chunks':(2,chunk_rows),'csv_ids':(1,csv_ids),
    'utc_day_boundary':(3,utc_day_boundary),
    'divide_or_null':(2,lambda a,b:None if money(b)==0 else decimal_text(money(a)/money(b))),
})


def validate_expression(expression, roots):
    """Validate *all* branches, including branches not selected by $if."""
    budget = [0]
    def walk(node, depth=0, allowed=None):
        allowed=set(roots) if allowed is None else allowed
        budget[0] += 1
        if budget[0] > MAX_AST_NODES or depth > MAX_DEPTH:
            fail('MATRIX_EXPRESSION_LIMIT')
        if isinstance(node, dict):
            if '$path' in node:
                if not set(node) <= {'$path', 'default'}:
                    fail('MATRIX_PATH_SCHEMA')
                path = node['$path']
                if (not isinstance(path, list) or not 1 <= len(path) <= 16
                    or not isinstance(path[0],str) or path[0] not in allowed or any(type(p) not in (str,int) for p in path)
                    or any(type(p) is int and not 0 <= p <= 20000 for p in path)
                    or any(isinstance(p,str) and (not p or len(p)>160) for p in path)):
                    fail('MATRIX_PATH_SCHEMA')
                if 'default' in node: walk(node['default'], depth+1,allowed)
            elif '$fn' in node:
                if set(node) != {'$fn'} or not isinstance(node['$fn'],list) or not node['$fn']:
                    fail('MATRIX_FUNCTION_SCHEMA')
                name, *args = node['$fn']
                if not isinstance(name,str) or name not in FUNCTIONS or len(args)!=FUNCTIONS[name][0]:
                    fail('MATRIX_OPERATOR_UNKNOWN')
                for arg in args: walk(arg, depth+1,allowed)
            elif '$if' in node:
                if set(node) != {'$if'} or not isinstance(node['$if'],list) or len(node['$if'])!=3:
                    fail('MATRIX_IF_SCHEMA')
                for arg in node['$if']: walk(arg, depth+1,allowed)
            elif '$map' in node or '$filter' in node:
                op='$map' if '$map' in node else '$filter'
                if set(node)!={op} or not isinstance(node[op],list) or len(node[op])!=3:fail('MATRIX_COLLECTION_SCHEMA')
                values,binding,expression=node[op]
                if not isinstance(binding,str) or not re.fullmatch(r'[a-z][a-z0-9_]{0,31}',binding) or binding in allowed or binding+'_index' in allowed:fail('MATRIX_LOCAL_BINDING')
                walk(values,depth+1,allowed)
                walk(expression,depth+1,allowed|{binding,binding+'_index'})
            else:
                if any(not isinstance(k,str) or k.startswith('$') or len(k)>160 for k in node):
                    fail('MATRIX_OBJECT_SCHEMA')
                for val in node.values(): walk(val, depth+1,allowed)
        elif isinstance(node,list):
            if len(node)>1000: fail('MATRIX_ARRAY_LIMIT')
            for val in node: walk(val, depth+1,allowed)
        elif isinstance(node,str):
            if len(node)>MAX_TEXT:fail('MATRIX_TEXT_LIMIT')
        elif node is not None and type(node) not in (bool,int,float):
            fail('MATRIX_LITERAL_TYPE')
        elif type(node) is float and not math.isfinite(node):fail('MATRIX_NONFINITE')
    walk(expression)


_EVAL_BUDGET=ContextVar('matrix_evaluation_budget',default=None)
MAX_EVAL_STEPS=2000000


def _evaluate(expression,env):
    budget=_EVAL_BUDGET.get();token=None
    if budget is None:
        budget=[0];token=_EVAL_BUDGET.set(budget)
    budget[0]+=1
    try:
        if budget[0]>MAX_EVAL_STEPS:fail('MATRIX_EVALUATION_LIMIT')
        return _evaluate_inner(expression,env)
    finally:
        if token is not None:_EVAL_BUDGET.reset(token)


def _evaluate_inner(expression, env):
    if isinstance(expression, list):
        return [_evaluate(x, env) for x in expression]
    if not isinstance(expression, dict):
        return expression
    if '$path' in expression:
        current = env
        try:
            for key in expression['$path']:
                if isinstance(current,dict) and isinstance(key,str): current=current[key]
                elif isinstance(current,list) and type(key) is int: current=current[key]
                else: fail('BINDING_TYPE')
            return copy.deepcopy(current)
        except (KeyError, IndexError):
            if 'default' in expression: return _evaluate(expression['default'],env)
            fail('BINDING_MISSING')
    if '$map' in expression or '$filter' in expression:
        op='$map' if '$map' in expression else '$filter'
        source,binding,body=expression[op]
        values=array(_evaluate(source,env));result=[]
        for index,item in enumerate(values):
            computed=_evaluate(body,{**env,binding:item,binding+'_index':index})
            if op=='$map':result.append(computed)
            elif type(computed)is not bool:fail('BOOLEAN_TYPE')
            elif computed:result.append(item)
        return result
    if '$if' in expression:
        condition, a, b = expression['$if']
        selected = _evaluate(condition, env)
        if type(selected) is not bool: fail('BOOLEAN_TYPE')
        return _evaluate(a if selected else b,env)
    if '$fn' in expression:
        name,*args=expression['$fn']
        return FUNCTIONS[name][1](*[_evaluate(x,env) for x in args])
    return {key:_evaluate(value,env) for key,value in expression.items()}


def evaluate(expression, env):
    # Boundary validating once per compiled matrix is also supported by Engine.
    validate_expression(expression,set(env))
    try: return _evaluate(expression,env)
    except MatrixError: raise
    except (TypeError,ValueError,KeyError,IndexError,OverflowError,InvalidOperation):
        fail('BINDING_VALUE')
