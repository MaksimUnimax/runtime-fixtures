"""Strict runtime_task_v1 shape; schema validity is never authorization.
The schema is byte-identical to implementation documentation v0.5.
No external resolver, permissive defaults, executable expressions, or I/O in validation.
"""
from __future__ import annotations
import copy
import json
import re
from datetime import datetime, date, timezone
from pathlib import Path
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from semantics import Rejected

CONTRACT = 'runtime_port_v1'
PRODUCT = 'alisa_market'
TASK_SCHEMA = json.loads(Path(__file__).with_name('runtime_task_v1.schema.json').read_text())
CONTEXT_SCHEMA = TASK_SCHEMA['properties']['context']

def reject(code='VALIDATION_FAILED'):
    raise Rejected(code, code)

def uuid_text(value):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}', value):
        reject()
    try:
        return str(UUID(value))
    except (ValueError, TypeError):
        reject()

def timestamp(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})', value):
        reject()
    try:
        dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if dt.utcoffset().total_seconds() != 0:
            reject()
        return dt.timestamp()
    except (ValueError, TypeError, OverflowError):
        reject()

def validate(value, schema, depth=0):
    if depth > 20:
        reject()
    if 'oneOf' in schema:
        matches = 0
        for option in schema['oneOf']:
            try:
                validate(value, option, depth + 1)
                matches += 1
            except Rejected:
                pass
        if matches != 1:
            reject()
        return
    kind = schema.get('type')
    if kind == 'object':
        if type(value) is not dict or not set(schema.get('required', [])) <= set(value):
            reject()
        props = schema.get('properties', {})
        if schema.get('additionalProperties') is False and set(value) - set(props):
            reject()
        for key, item in value.items():
            if key in props:
                validate(item, props[key], depth + 1)
    elif kind == 'array':
        if type(value) is not list or not schema.get('minItems', 0) <= len(value) <= schema.get('maxItems', 1000):
            reject()
        for item in value:
            validate(item, schema['items'], depth + 1)
    elif kind == 'integer':
        if type(value) is not int or not schema.get('minimum', -2**63) <= value <= schema.get('maximum', 2**63):
            reject()
    elif kind == 'string':
        if not isinstance(value, str) or not schema.get('minLength', 0) <= len(value) <= schema.get('maxLength', 4096):
            reject()
        try:
            value.encode('utf-8')
        except UnicodeError:
            reject()
        if 'pattern' in schema and not re.fullmatch(schema['pattern'], value):
            reject()
        fmt = schema.get('format')
        if fmt == 'uuid':
            uuid_text(value)
        elif fmt == 'date-time':
            timestamp(value)
        elif fmt == 'date':
            try:
                if date.fromisoformat(value).isoformat() != value:
                    reject()
            except ValueError:
                reject()
    elif kind is not None:
        reject('CATALOG_INCOMPATIBLE')
    if 'const' in schema and value != schema['const']:
        reject('CATALOG_INCOMPATIBLE')

def context_shape(context):
    validate(context, CONTEXT_SCHEMA)
    try:
        ZoneInfo(context['business_timezone'])
    except (ZoneInfoNotFoundError, ValueError):
        reject()
    ids = [uuid_text(s['store_id']) for s in context['store_scope']]
    if len(ids) != len(set(ids)):
        reject()
    if any(ord(c) < 32 for c in context['execution_ticket']):
        reject()
    return copy.deepcopy(context)

def task_shape(task):
    validate(task, TASK_SCHEMA)
    context_shape(task['context'])
    if task['query_input']['kind'] == 'utterance' and not task['query_input']['text'].strip():
        reject()
    return copy.deepcopy(task)

def claims_shape(claims):
    if type(claims) is not dict or claims.get('product_id') != PRODUCT or 'execution_ticket' in claims:
        reject('AUTH_REQUIRED')
    raw = {k: v for k, v in claims.items() if k != 'product_id'}
    raw['execution_ticket'] = 'shape-only-not-an-authorization'
    context_shape(raw)
    return copy.deepcopy(claims)

def utc(ts):
    return datetime.fromtimestamp(ts, timezone.utc).isoformat().replace('+00:00', 'Z')
