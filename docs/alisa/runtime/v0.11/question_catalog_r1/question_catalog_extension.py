"""Read-only template discovery over the existing authenticated RuntimePort.

Install after other dispatch overlays. No business requests, model calls, jobs,
credentials, notes or executable template bodies are returned to the browser.
"""
from copy import deepcopy
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import time

SCHEMA = 'alisa-question-catalog/v1'


def metadata(port):
    from template_catalog import TEMPLATES, dependencies, HASH
    from registry import DEFINITIONS
    items = []
    for key, template in TEMPLATES.items():
        chain = dependencies(key)
        sources = []
        for dependency in chain:
            for step in TEMPLATES[dependency]['steps']:
                # Only registered identifiers, never params, notes or prompts.
                source = {k: step[k] for k in ('platform', 'operation', 'source', 'recipe') if k in step}
                if source and source not in sources:
                    sources.append(source)
        units = sorted({str(DEFINITIONS[m].get('unit', 'не указана'))
                        for m in template['metrics'] if m in DEFINITIONS})
        item = {'id': key, 'version': template['version'], 'kind': template['kind'],
                'description': template['purpose'], 'platforms': deepcopy(template['platforms']),
                'input_policy': deepcopy(template['input_policy']), 'units': units,
                'dependencies': chain[:-1], 'metrics': deepcopy(template['metrics']),
                'sources': sources}
        if template['kind'] == 'dataset':
            item['columns'] = [{k: c[k] for k in ('field', 'label', 'kind')} for c in template['columns']]
        items.append(item)
    return {'schema': SCHEMA, 'versions': port.versions_for(port._catalog_peer),
            'template_hash': HASH, 'items': items}


def read(port, peer, context=None, query=None):
    from dataclasses import asdict
    from semantics import Rejected
    port._peer(peer)
    if not port.engine.template_mode:
        raise Rejected('CAPABILITY_UNAVAILABLE')
    # Bind peer locally, not on the shared port: concurrent reads cannot alter it.
    class View:
        _catalog_peer = peer
        def versions_for(self, actual):
            return port.versions_for(actual)
    value = metadata(View())
    if context is None:
        return value
    _, guard, scope = port._auth(context, peer, 'capabilities')
    if len(scope.stores) != 1:
        raise Rejected('VALIDATION_FAILED')
    query = query if query is not None else {'search': '', 'kind': '', 'offset': 0}
    if (type(query) is not dict or set(query) != {'search', 'kind', 'offset'} or
            type(query['search']) is not str or len(query['search']) > 200 or
            type(query['kind']) is not str or query['kind'] not in {'', 'scalar', 'compound', 'dataset', 'formula', 'event', 'information'} or
            type(query['offset']) is not int or not 0 <= query['offset'] <= 1000):
        raise Rejected('VALIDATION_FAILED')
    value['template_ids'] = [item['id'] for item in value['items']]
    platform = scope.stores[0].platform
    matching = [item for item in value['items']
                if (not item['platforms'] or platform in item['platforms'])
                and (not query['kind'] or item['kind'] == query['kind'])
                and query['search'].casefold() in (item['description'] + ' ' + item['id']).casefold()]
    value['total'] = len(matching)
    value['page_offset'] = query['offset']
    end = query['offset'] + 10
    value['next_offset'] = end if end < len(matching) else None
    value['items'] = matching[query['offset']:end]
    from template_catalog import TEMPLATES, compile_selection
    day = datetime.fromtimestamp(port.repo.clock(), ZoneInfo('Europe/Moscow')).date()
    yesterday = (day - timedelta(days=1)).isoformat()
    root = {'tenant': scope.tenant, 'access_revision': scope.revision,
            'stores': [asdict(s) for s in scope.stores], 'calendar_date': day.isoformat(),
            'question': 'Просмотр каталога', 'runtime_guard': guard}
    deadline = time.monotonic() + 1.25
    for item in value['items']:
        if time.monotonic() >= deadline:
            raise Rejected('DEPENDENCY_UNAVAILABLE')
        item.pop('sources', None)
        item.pop('metrics', None)
        item['availability'] = []
        for store in scope.stores:
            if item['platforms'] and store.platform not in item['platforms']:
                continue
            template = TEMPLATES[item['id']]
            inputs = {} if template['input_policy']['snapshot'] else {'period': {'from': yesterday, 'to': yesterday}}
            selection = {'action': 'plan', 'complete': True, 'missing': [],
                         'requirements': [{'id': 'catalog', 'description': 'Просмотр допуска', 'invocations': ['catalog']}],
                         'invocations': [{'id': 'catalog', 'template_id': item['id'],
                                          'store_id': store.id, 'input': inputs}]}
            try:
                compile_selection(port.engine, root, selection)
                status = 'ELIGIBLE'
            except Rejected as error:
                if error.code in {'AUTH_REQUIRED', 'PERMISSION_DENIED', 'DEPENDENCY_UNAVAILABLE', 'ACCOUNT_BLOCKED'}:
                    raise
                status = 'UNAVAILABLE'
            item['availability'].append({'store_id': store.id, 'status': status})
    # Reject the whole response if current rights/scope changed during discovery.
    _, _, current = port._auth(context, peer, 'capabilities')
    if asdict(current) != asdict(scope):
        raise Rejected('PERMISSION_DENIED')
    return value


def install():
    import runtime_port_ipc
    from semantics import Rejected
    previous = runtime_port_ipc.dispatch
    if getattr(previous, '_question_catalog', False):
        return
    def dispatch(port, peer, value):
        if type(value) is dict and value.get('operation') in {'question_catalog', 'question_catalog_metadata'}:
            from runtime_port_contract import CONTRACT
            if set(value) != {'schema_version', 'operation', 'payload'} or value['schema_version'] != CONTRACT:
                raise Rejected('VALIDATION_FAILED')
            payload = value['payload']
            expected = {'context', 'query'} if value['operation'] == 'question_catalog' else set()
            if type(payload) is not dict or set(payload) != expected:
                raise Rejected('VALIDATION_FAILED')
            if expected and type(payload['context']) is not dict:
                raise Rejected('VALIDATION_FAILED')
            return read(port, peer, payload.get('context'), payload.get('query'))
        return previous(port, peer, value)
    dispatch._question_catalog = True
    runtime_port_ipc.dispatch = dispatch
