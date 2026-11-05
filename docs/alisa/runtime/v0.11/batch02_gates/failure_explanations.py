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
    if set(catalog) != {'schema', 'version', 'fallback', 'entries', 'aliases'} or catalog['schema'] != 'alice-failure-catalog/v1':
        raise ValueError('FAILURE_CATALOG_SCHEMA')
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
    if catalog['fallback'] not in entries or any(not re.fullmatch(r'[A-Z][A-Z0-9_]{0,79}', k) or v not in entries for k, v in aliases.items()):
        raise ValueError('FAILURE_CATALOG_REFERENCE')
    return catalog

CATALOG = _load()
HASH = hashlib.sha256(json.dumps(CATALOG, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def explain(code):
    # Unknown diagnostic text/URLs/tokens/IDs are never reflected to the user.
    key = code if type(code) is str and code in CATALOG['entries'] else CATALOG['aliases'].get(code) if type(code) is str else None
    if key not in CATALOG['entries']:
        key = CATALOG['fallback']
    result = copy.deepcopy(CATALOG['entries'][key])
    text = result['reason'] + ' ' + result['next_action']
    return {'reason_code': key, 'cause_status': result['cause_status'],
            'reason': result['reason'], 'next_action': result['next_action'],
            'text': text, 'tts': text, 'retryable': False}


def public_code(code):
    """Retain bounded internal identifiers, never reflect arbitrary exception text."""
    return code if type(code) is str and re.fullmatch(r"[A-Z][A-Z0-9_]{0,79}", code) else CATALOG["fallback"]
