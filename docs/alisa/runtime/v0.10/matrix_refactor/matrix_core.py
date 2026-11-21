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


def money(value):
    if isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
        fail('NUMBER_TYPE')
    if isinstance(value, str) and len(value) > 100:
        fail('NUMBER_RANGE')
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        fail('NUMBER_FORMAT')
    if not number.is_finite() or abs(number) > Decimal('1e18'):
        fail('NUMBER_RANGE')
    return number


def decimal_text(value):
    return format(money(value), 'f')


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


# Exact operator names and arities are part of the versioned engine, never read
# as callable names from the configuration. There is no arbitrary regex engine.
FUNCTIONS = {
    'eq': (2, strict_equal), 'ne': (2, lambda a,b: not strict_equal(a,b)),
    'in': (2, lambda a,b: a in b),
    'and': (2, lambda a,b: type(a) is bool and type(b) is bool and a and b),
    'or': (2, lambda a,b: type(a) is bool and type(b) is bool and (a or b)),
    'not': (1, lambda a: not a if type(a) is bool else fail('BOOLEAN_TYPE')),
    'lt': (2, lambda a,b: a < b), 'le': (2, lambda a,b: a <= b),
    'gt': (2, lambda a,b: a > b), 'ge': (2, lambda a,b: a >= b),
    'len': (1, len), 'text': (1, text), 'label': (1, label),
    'brand': (1, lambda a: label(a).casefold().replace('ё', 'е')),
    'decimal': (1, decimal_text), 'natural': (1, natural),
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


def validate_expression(expression, roots):
    """Validate *all* branches, including branches not selected by $if."""
    budget = [0]
    def walk(node, depth=0):
        budget[0] += 1
        if budget[0] > MAX_AST_NODES or depth > MAX_DEPTH:
            fail('MATRIX_EXPRESSION_LIMIT')
        if isinstance(node, dict):
            if '$path' in node:
                if not set(node) <= {'$path', 'default'}:
                    fail('MATRIX_PATH_SCHEMA')
                path = node['$path']
                if (not isinstance(path, list) or not 1 <= len(path) <= 16
                    or path[0] not in roots or any(type(p) not in (str,int) for p in path)
                    or any(type(p) is int and not 0 <= p <= 20000 for p in path)
                    or any(isinstance(p,str) and (not p or len(p)>160) for p in path)):
                    fail('MATRIX_PATH_SCHEMA')
                if 'default' in node: walk(node['default'], depth+1)
            elif '$fn' in node:
                if set(node) != {'$fn'} or not isinstance(node['$fn'],list) or not node['$fn']:
                    fail('MATRIX_FUNCTION_SCHEMA')
                name, *args = node['$fn']
                if not isinstance(name,str) or name not in FUNCTIONS or len(args)!=FUNCTIONS[name][0]:
                    fail('MATRIX_OPERATOR_UNKNOWN')
                for arg in args: walk(arg, depth+1)
            elif '$if' in node:
                if set(node) != {'$if'} or not isinstance(node['$if'],list) or len(node['$if'])!=3:
                    fail('MATRIX_IF_SCHEMA')
                for arg in node['$if']: walk(arg, depth+1)
            else:
                if any(not isinstance(k,str) or k.startswith('$') or len(k)>160 for k in node):
                    fail('MATRIX_OBJECT_SCHEMA')
                for val in node.values(): walk(val, depth+1)
        elif isinstance(node,list):
            if len(node)>1000: fail('MATRIX_ARRAY_LIMIT')
            for val in node: walk(val, depth+1)
        elif isinstance(node,str):
            if len(node)>MAX_TEXT:fail('MATRIX_TEXT_LIMIT')
        elif node is not None and type(node) not in (bool,int,float):
            fail('MATRIX_LITERAL_TYPE')
        elif type(node) is float and not math.isfinite(node):fail('MATRIX_NONFINITE')
    walk(expression)


def _evaluate(expression, env):
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
