"""One provider-call credential context. No files, secret cache or permission cache."""
from contextlib import contextmanager
from contextvars import ContextVar
from copy import deepcopy

from semantics import Rejected, strict_json

_CURRENT = ContextVar('platform_store_credential_scope', default=None)


def dynamic(store):
    return type(store) is dict and type(store.get('source_revision')) is str and store['source_revision'].startswith('platform:')


@contextmanager
def execution(engine, row, store):
    context = None
    if dynamic(store):
        plan = strict_json(row['plan']) if row['plan'] else strict_json(row['draft'])
        guard = plan.get('runtime_guard')
        if not guard or store not in plan.get('stores', []):
            raise Rejected('PERMISSION_DENIED')
        authority = getattr(getattr(engine, 'execution_policy', None), 'authority', None)
        if authority is None or not callable(getattr(authority, 'credentials', None)):
            raise Rejected('CAPABILITY_UNAVAILABLE')
        context = {'authority': authority, 'pins': deepcopy(guard['pins']), 'store': deepcopy(store)}
    token = _CURRENT.set(context)
    try:
        yield
    finally:
        _CURRENT.reset(token)


def resolve(store):
    context = _CURRENT.get()
    if not dynamic(store) or context is None or context['store'] != store:
        raise Rejected('PERMISSION_DENIED')
    # Private authority resolves current rights and reads only this store's vault.
    # Returned bytes live only in the HTTPS call's local credential dictionary.
    return context['authority'].credentials(deepcopy(context['pins']), deepcopy(store))


def required_fields(value):
    fields = set()
    if type(value) is dict:
        path = value.get('$path')
        if type(path) is list and len(path) >= 2 and path[0] == 'credentials' and 'default' not in value:
            fields.add(path[1])
        for child in value.values():
            fields.update(required_fields(child))
    elif type(value) is list:
        for child in value:
            fields.update(required_fields(child))
    return fields
