"""Bounded data-driven explanations for execution failures; no raw exception echo."""
from __future__ import annotations
import copy
import hashlib
import json
import re
from pathlib import Path


def _load():
    def pairs(items):
        obj = {}
        for key, value in items:
            if key in obj:
                raise ValueError('FAILURE_CATALOG_DUPLICATE')
            obj[key] = value
        return obj
    raw = Path(__file__).with_name('failure_catalog.json').read_text(encoding='utf-8')
    if len(raw.encode()) > 65536:
        raise ValueError('FAILURE_CATALOG_SIZE')
    catalog = json.loads(raw, object_pairs_hook=pairs)
    required = {'schema', 'version', 'fallback', 'entries', 'aliases'}
    if not required <= set(catalog) or set(catalog) - required - {'subjects'} or catalog['schema'] != 'alice-failure-catalog/v1':
        raise ValueError('FAILURE_CATALOG_SCHEMA')
    subjects = catalog.get('subjects', {})
    if type(subjects) is not dict or len(subjects) > 128:
        raise ValueError('FAILURE_CATALOG_SUBJECTS')
    for ref, label in subjects.items():
        if (type(ref) is not str or re.fullmatch(r'[a-z][a-z0-9_]{0,79}', ref) is None
                or type(label) is not str or not 1 <= len(label) <= 160
                or any(ord(c) < 32 or c in '{}<>' for c in label)):
            raise ValueError('FAILURE_CATALOG_SUBJECTS')
    entries, aliases = catalog['entries'], catalog['aliases']
    if type(entries) is not dict or not 1 <= len(entries) <= 128 or type(aliases) is not dict or len(aliases) > 256:
        raise ValueError('FAILURE_CATALOG_SCHEMA')
    for code, record in entries.items():
        if not re.fullmatch(r'[A-Z][A-Z0-9_]{0,79}', code) or type(record) is not dict or set(record) != {'reason', 'next_action', 'cause_status'}:
            raise ValueError('FAILURE_CATALOG_ENTRY')
        if record['cause_status'] not in ('KNOWN_LIMITATION', 'OBSERVED_FAILURE', 'PROVIDER_CAUSE_UNKNOWN', 'UNKNOWN'):
            raise ValueError('FAILURE_CATALOG_ENTRY')
        for key in ('reason', 'next_action'):
            if type(record[key]) is not str or not 1 <= len(record[key]) <= 380 or any(ord(c) < 32 for c in record[key]):
                raise ValueError('FAILURE_CATALOG_TEXT')
            remainder = record[key].replace('{subject}', '')
            if '{' in remainder or '}' in remainder:
                raise ValueError('FAILURE_CATALOG_PLACEHOLDER')
        maximum = record['reason'].replace('{subject}', 'x' * 160) + ' ' + record['next_action'].replace('{subject}', 'x' * 160)
        if len(maximum) > 900:
            raise ValueError('FAILURE_CATALOG_TEXT')
    if catalog['fallback'] not in entries or any(not re.fullmatch(r'[A-Z][A-Z0-9_]{0,79}', k) or v not in entries for k, v in aliases.items()):
        raise ValueError('FAILURE_CATALOG_REFERENCE')
    return catalog

CATALOG = _load()
HASH = hashlib.sha256(json.dumps(CATALOG, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def explain(code, *, context=None):
    # Unknown diagnostic text/URLs/tokens/IDs are never reflected to the user.
    key = code if type(code) is str and code in CATALOG['entries'] else CATALOG['aliases'].get(code) if type(code) is str else None
    if key not in CATALOG['entries']:
        key = CATALOG['fallback']
    result = copy.deepcopy(CATALOG['entries'][key])
    subjects = CATALOG.get('subjects', {})
    subject = subjects.get('default', 'выбранные данные')
    if type(context) is dict and set(context) == {'subject_ref'}:
        ref = context['subject_ref']
        if type(ref) is str and ref in subjects:
            subject = subjects[ref]
    for field in ('reason', 'next_action'):
        result[field] = result[field].replace('{subject}', subject)
    text = result['reason'] + ' ' + result['next_action']
    return {'reason_code': key, 'cause_status': result['cause_status'],
            'reason': result['reason'], 'next_action': result['next_action'],
            'text': text, 'tts': text, 'retryable': False}


def public_code(code):
    """Retain bounded internal identifiers, never reflect arbitrary exception text."""
    return code if type(code) is str and re.fullmatch(r"[A-Z][A-Z0-9_]{0,79}", code) else CATALOG["fallback"]


def rejection_reply(code, message, context=None):
    """Catalog-backed failures share one rendering path across ingress/dialogue.
    Explicit context prompts outside the catalogue retain their original wording.
    A generic wrapper around a known code never bypasses its approved explanation.
    """
    key = public_code(code)
    known = type(code) is str and (code in CATALOG['entries'] or code in CATALOG['aliases'])
    if known or key != code or message == code or type(message) is not str or not 1 <= len(message) <= 900:
        return {**explain(code, context=context), 'error': key}
    return {'text': message, 'tts': message, 'error': key}
