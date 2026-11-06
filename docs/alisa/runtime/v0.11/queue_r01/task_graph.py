"""Opt-in bounded graph executed by the existing Worker and quota ledger.

No second scheduler, HTTP client, tables or executable configuration. Source
recipes are SourceMatrix objects; pure adapters are injected trusted objects.
Checkpoints protect against corruption, not a hostile database administrator.
"""
from __future__ import annotations
from copy import deepcopy
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import re

from semantics import (Rejected, Scope, Store, make_plan, canonical_json,
                       strict_json, fingerprint)
from matrix_core import MatrixError, evaluate, validate_expression
from providers import Request

NAME = re.compile(r'[a-z][a-z0-9_]{0,79}\Z')
HEX = re.compile(r'[a-f0-9]{64}\Z')


def require(condition, code='GRAPH_SCHEMA'):
    if not condition:
        raise Rejected(code)


def clone(value):
    return strict_json(canonical_json(value))


def size(value):
    return len(canonical_json(value).encode())


class TaskGraphRuntime:
    def __init__(self, catalog, sources, adapters, authorize):
        self.catalog = clone(catalog)
        self.sources = dict(sources)
        self.adapters = dict(adapters)
        self.authority = authorize
        self._validate()
        self.catalog_hash = fingerprint(self.catalog)
        self.code_hash = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()

    def _validate(self):
        c = self.catalog
        require(type(c) is dict and set(c) == {'schema', 'version', 'limits', 'graphs'})
        require(c['schema'] == 'alice-task-graphs/v1')
        require(type(c['version']) is str and 0 < len(c['version']) <= 100)
        limits = c['limits']
        bounds = {'max_nodes': (1, 32), 'max_calls': (1, 200),
                  'max_rows': (1, 20000), 'max_bytes': (1000, 6000000),
                  'max_input_bytes': (1000, 262144), 'max_pages': (1, 200),
                  'lifetime_seconds': (10, 3600), 'freshness_seconds': (1, 900)}
        require(type(limits) is dict and set(limits) == set(bounds), 'GRAPH_LIMITS')
        for key, (lo, hi) in bounds.items():
            require(type(limits[key]) is int and lo <= limits[key] <= hi, 'GRAPH_LIMITS')
        require(type(c['graphs']) is dict and 1 <= len(c['graphs']) <= 100)
        for gid, graph in c['graphs'].items():
            require(type(gid) is str and NAME.fullmatch(gid), 'GRAPH_ID')
            require(type(graph) is dict and set(graph) == {'label', 'platforms', 'nodes', 'output'})
            require(type(graph['label']) is str and 1 <= len(graph['label']) <= 120)
            require(type(graph['platforms']) is list and graph['platforms'] and
                    all(type(p) is str for p in graph['platforms']), 'GRAPH_PLATFORMS')
            nodes = graph['nodes']
            require(type(nodes) is list and 1 <= len(nodes) <= limits['max_nodes'], 'GRAPH_NODES')
            seen = set()
            for node in nodes:
                require(type(node) is dict and type(node.get('id')) is str and
                        NAME.fullmatch(node['id']) and node['id'] not in seen, 'GRAPH_NODE_ID')
                if node.get('kind') == 'source':
                    required={'id','kind','operation','period','params'}
                    require(required<=set(node) and set(node)-required<={'capture'})
                    if 'capture' in node:
                        validate_expression(node['capture'], {'response'})
                    require(node['operation'] in self.sources, 'GRAPH_SOURCE_NOT_REGISTERED')
                    matrix = self.sources[node['operation']]
                    spec = matrix.recipe(node['operation'])
                    require(set(graph['platforms']) == {spec['platform']}, 'GRAPH_SOURCE_PLATFORM')
                    for field in ('period', 'params'):
                        validate_expression(node[field], {'period', 'inputs', 'outputs'})
                        def references(value):
                            if type(value) is dict:
                                path=value.get('$path')
                                if type(path) is list and path and path[0]=='outputs':
                                    require(len(path)>1 and path[1] in seen, 'GRAPH_FORWARD_REFERENCE')
                                for child in value.values(): references(child)
                            elif type(value) is list:
                                for child in value: references(child)
                        references(node[field])
                elif node.get('kind') == 'compute':
                    require(set(node) == {'id', 'kind', 'adapter', 'dependencies'})
                    deps = node['dependencies']
                    require(type(deps) is list and deps and all(type(x) is str for x in deps)
                            and len(set(deps)) == len(deps) and set(deps) <= seen,
                            'GRAPH_DEPENDENCIES')
                    require(node['adapter'] in self.adapters, 'GRAPH_ADAPTER_NOT_REGISTERED')
                    adapter = self.adapters[node['adapter']]
                    require(type(adapter.pin) is str and HEX.fullmatch(adapter.pin), 'GRAPH_ADAPTER_PIN')
                    require(all(callable(getattr(adapter, m, None)) for m in
                                ('execute', 'check', 'render', 'authorize_plan', 'expiry')), 'GRAPH_ADAPTER_CONTRACT')
                else:
                    raise Rejected('GRAPH_NODE_KIND')
                seen.add(node['id'])
            require(nodes[-1]['id'] == graph['output'] and nodes[-1]['kind'] == 'compute',
                    'GRAPH_OUTPUT')

    def _input(self, inputs, now):
        require(type(inputs) is dict and set(inputs) ==
                {'schema', 'revision', 'issued_at', 'expires_at', 'payload'}, 'GRAPH_INPUT_SCHEMA')
        require(inputs['schema'] == 'alice-graph-inputs/v1' and
                type(inputs['revision']) is str and 0 < len(inputs['revision']) <= 100,
                'GRAPH_INPUT_SCHEMA')
        a, b = inputs['issued_at'], inputs['expires_at']
        require(type(a) is int and type(b) is int and a <= now < b and
                0 < b - a <= self.catalog['limits']['lifetime_seconds'], 'GRAPH_INPUT_EXPIRED')
        require(type(inputs['payload']) is dict and
                size(inputs) <= self.catalog['limits']['max_input_bytes'], 'GRAPH_INPUT_CAPACITY')

    def make_plan(self, scope, draft, graph_id, inputs, now):
        require(fingerprint(self.catalog) == self.catalog_hash, 'GRAPH_CATALOG_CHANGED')
        require(type(draft) is dict and type(graph_id) is str, 'GRAPH_QUERY_SCHEMA')
        inputs = clone(inputs)
        self._input(inputs, now)
        graph = self.catalog['graphs'].get(graph_id)
        require(graph is not None, 'GRAPH_UNKNOWN')
        require(set(draft['platforms']) <= set(graph['platforms']) and
                not draft.get('filters') and not draft.get('comparison') and
                not draft.get('snapshot'), 'GRAPH_QUERY_CONDITION')
        base = make_plan(scope, draft, ['ordered_units'])
        require(len(base['stores']) == 1, 'GRAPH_SINGLE_STORE_REQUIRED')
        source_hashes = {n['operation']: self.sources[n['operation']].fingerprint(n['operation'])
                         for n in graph['nodes'] if n['kind'] == 'source'}
        adapter_pins = {n['adapter']: self.adapters[n['adapter']].pin
                        for n in graph['nodes'] if n['kind'] == 'compute'}
        base.update(metrics=['graph:' + graph_id], definition='declared-task-graph-v1',
                    freshness_seconds=self.catalog['limits']['freshness_seconds'],
                    graph_inputs=inputs,
                    task_graph={'id': graph_id, 'catalog_hash': self.catalog_hash,
                                'code_hash': self.code_hash, 'source_hashes': source_hashes,
                                'adapter_pins': adapter_pins, 'input_hash': fingerprint(inputs),
                                'calendar_date': draft['calendar_date'],
                                'deadline': inputs['expires_at']})
        require(size(base) <= self.catalog['limits']['max_input_bytes'] + 10000, 'GRAPH_PLAN_CAPACITY')
        return base

    def valid(self, plan, now):
        try:
            require(type(plan) is dict and not any(k in plan for k in ('table', 'dataset', 'program')))
            g = plan['task_graph']
            require(g['catalog_hash'] == self.catalog_hash and g['code_hash'] == self.code_hash)
            scope = Scope(plan['tenant'], plan['access_revision'], tuple(Store(**s) for s in plan['stores']))
            draft = {k: plan[k] for k in ('period', 'comparison', 'timezone', 'group_by',
                                         'filters', 'snapshot', 'snapshot_slot')}
            draft.update(platforms=sorted({s['platform'] for s in plan['stores']}),
                         calendar_date=g['calendar_date'])
            return self.make_plan(scope, draft, g['id'], plan['graph_inputs'], now) == plan
        except (Rejected, MatrixError, KeyError, TypeError, ValueError, AttributeError):
            return False

    def permitted(self, plan, now, action):
        if not self.valid(plan, now) or not callable(self.authority):
            return False
        try:
            if self.authority(action, clone(plan)) is not True:
                return False
            graph = self.catalog['graphs'][plan['task_graph']['id']]
            return all(self.adapters[n['adapter']].authorize_plan(clone(plan), now, action) is True
                       for n in graph['nodes'] if n['kind'] == 'compute')
        except Exception:
            return False

    def source_names(self, plan):
        store = plan['stores'][0]
        return {store['platform'] + ':' + store['identity'] + ':' +
                self.sources[op].recipe(op)['quota_operation']
                for op in plan['task_graph']['source_hashes']}

    def _seal(self, state):
        state = clone(state)
        state.pop('sha256', None)
        require(size(state) <= self.catalog['limits']['max_bytes'], 'GRAPH_PROGRESS_CAPACITY')
        state['sha256'] = fingerprint(state)
        return state

    def _progress(self, repo, row, plan):
        nodes = self.catalog['graphs'][plan['task_graph']['id']]['nodes']
        if row['progress']:
            state = strict_json(row['progress'])
            require(type(state) is dict and set(state) ==
                    {'schema', 'plan_hash', 'index', 'outputs', 'page', 'capture_pages', 'receipts', 'sha256'},
                    'GRAPH_PROGRESS_SCHEMA')
            check = {k: v for k, v in state.items() if k != 'sha256'}
            require(state['sha256'] == fingerprint(check) and
                    state['plan_hash'] == fingerprint(plan), 'GRAPH_PROGRESS_CHANGED')
        else:
            state = self._seal({'schema': 'alice-task-progress/v1', 'plan_hash': fingerprint(plan),
                                'index': 0, 'outputs': {}, 'page': None, 'capture_pages': [], 'receipts': []})
        require(state['schema'] == 'alice-task-progress/v1' and type(state['index']) is int and
                0 <= state['index'] <= len(nodes), 'GRAPH_PROGRESS_INDEX')
        require(type(state['outputs']) is dict and set(state['outputs']) ==
                {n['id'] for n in nodes[:state['index']]}, 'GRAPH_PROGRESS_OUTPUTS')
        require(type(state['capture_pages']) is list and len(state['capture_pages'])<=self.catalog['limits']['max_calls'],
                'GRAPH_CAPTURE_CAPACITY')
        require(state['page'] is not None or state['capture_pages']==[], 'GRAPH_CAPTURE_STATE')
        require(type(state['receipts']) is list and
                len(state['receipts']) <= self.catalog['limits']['max_calls'], 'GRAPH_CALL_BUDGET')
        require(state['page'] is None or (state['index'] < len(nodes) and
                nodes[state['index']]['kind'] == 'source'), 'GRAPH_PROGRESS_PAGE')
        require(size(state) <= self.catalog['limits']['max_bytes'], 'GRAPH_PROGRESS_CAPACITY')
        with repo.connection() as c:
            calls = [dict(x) for x in c.execute('SELECT * FROM calls WHERE jid=? ORDER BY id', (row['id'],))]
        unresolved = [x for x in calls if x['state'] in ('SENDING', 'UNKNOWN')]
        received = {x['id']: x for x in calls if x['state'] == 'RECEIVED'}
        ids = [x.get('id') for x in state['receipts']]
        if unresolved or set(received) != set(ids):
            from engine import CallError
            raise CallError('GRAPH_UNCHECKPOINTED_CALL', unknown=True)
        require(len(ids) == len(set(ids)), 'GRAPH_RECEIPT_DUPLICATE')
        for proof in state['receipts']:
            require(set(proof) == {'id', 'source', 'operation', 'request_hash', 'grant'},
                    'GRAPH_RECEIPT_SCHEMA')
            require(proof['source'] == received[proof['id']]['source'] and
                    type(proof['grant']) is bool and HEX.fullmatch(proof['request_hash']),
                    'GRAPH_RECEIPT_MISMATCH')
        return state

    def _record(self, worker, row, state, request, grant):
        with worker.repo.connection() as c:
            call = c.execute("SELECT * FROM calls WHERE jid=? AND state='RECEIVED' ORDER BY id DESC LIMIT 1",
                             (row['id'],)).fetchone()
        require(call is not None and call['source'] == request.source and
                call['id'] not in {x['id'] for x in state['receipts']}, 'GRAPH_RECEIPT_MISMATCH')
        state['receipts'].append({'id': call['id'], 'source': request.source,
                                  'operation': request.operation, 'request_hash': fingerprint(request.body),
                                  'grant': grant})

    def _budget(self, repo, row):
        with repo.connection() as c:
            count = c.execute('SELECT count(*) FROM calls WHERE jid=?', (row['id'],)).fetchone()[0]
        require(count < self.catalog['limits']['max_calls'], 'GRAPH_CALL_BUDGET')

    def worker_step(self, worker, row, plan):
        repo = worker.repo
        require(worker.engine.authorized(plan) and self.permitted(plan, repo.clock(), 'execute'),
                'GRAPH_ACCESS_CHANGED')
        state = self._progress(repo, row, plan)
        graph = self.catalog['graphs'][plan['task_graph']['id']]
        if state['index'] == len(graph['nodes']):
            stamp = datetime.fromtimestamp(repo.clock(), timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
            value = state['outputs'][graph['output']]
            repo.complete(row['id'], row['owner'], self.report(plan, value, stamp, repo.clock()))
            return
        node = graph['nodes'][state['index']]
        if node['kind'] == 'source':
            self._budget(repo, row)
            op = node['operation']
            matrix = self.sources[op]
            environment = {'period': plan['period'], 'inputs': plan['graph_inputs']['payload'],
                           'outputs': state['outputs']}
            period = evaluate(node['period'], environment)
            params = evaluate(node['params'], environment)
            require(type(period) is dict and set(period) == {'from', 'to'} and type(params) is dict,
                    'GRAPH_SOURCE_ARGUMENTS')
            matrix.available(op, period, plan['task_graph']['calendar_date'])
            source_plan = {**plan, 'table': {'view': 'dataset'}, 'table_params': params}
            store = plan['stores'][0]
            task = {'source': op, 'period': period}
            request = Request(**matrix.request(op, source_plan, store, task, state['page']))
            prerequisite = worker.transport.prepare(request, store) if hasattr(worker.transport, 'prepare') else None
            if prerequisite:
                # Grant response is ephemeral; never persist tokens in checkpoints.
                worker._call(row, prerequisite, store)
                self._record(worker, row, state, prerequisite, True)
            else:
                response = worker._call(row, request, store)
                self._record(worker, row, state, request, False)
                result = matrix.decode(op, response, source_plan, store, task, state['page'],
                                       {'max_rows': self.catalog['limits']['max_rows'],
                                        'max_bytes': self.catalog['limits']['max_bytes']})
                require(type(result.get('complete')) is bool, 'GRAPH_SOURCE_COMPLETENESS')
                if 'capture' in node:
                    captured=evaluate(node['capture'],{'response':response})
                    require(type(captured) is dict and size(captured)<=self.catalog['limits']['max_bytes'],
                            'GRAPH_CAPTURE_CAPACITY')
                    state['capture_pages'].append({'data':clone(captured),
                        'body_hash':fingerprint(captured),'recipe_hash':matrix.fingerprint(op),
                        'period':clone(period),'observed_at':int(repo.clock()),
                        'call_id':state['receipts'][-1]['id']})
                if result['complete']:
                    state['outputs'][node['id']] = {'complete': True, 'rows': result['rows'],
                                                    'currency': result['currency']}
                    if 'capture' in node:
                        state['outputs'][node['id']]['captures']=state['capture_pages']
                    state['page'] = None
                    state['capture_pages']=[]
                    state['index'] += 1
                else:
                    state['page'] = result['progress']
        else:
            dependencies = {key: deepcopy(state['outputs'][key]) for key in node['dependencies']}
            adapter = self.adapters[node['adapter']]
            value = adapter.execute(clone(plan), clone(plan['graph_inputs']['payload']),
                                    dependencies, repo.clock())
            require(adapter.check(clone(value), clone(plan), repo.clock()) is True,
                    'GRAPH_COMPUTATION_INVALID')
            state['outputs'][node['id']] = clone(value)
            state['index'] += 1
        require(worker.engine.authorized(plan) and self.permitted(plan, repo.clock(), 'execute'),
                'GRAPH_ACCESS_CHANGED')
        repo.reschedule(row['id'], row['owner'], self._seal(state))

    def report(self, plan, value, stamp, now):
        graph = self.catalog['graphs'][plan['task_graph']['id']]
        adapter = self.adapters[graph['nodes'][-1]['adapter']]
        require(adapter.check(clone(value), clone(plan), now) is True, 'GRAPH_COMPUTATION_INVALID')
        pages = adapter.render(clone(value), stamp)
        require(type(pages) is list and 1 <= len(pages) <= self.catalog['limits']['max_pages'] and
                all(type(x) is str and 0 < len(x) <= 900 for x in pages), 'GRAPH_RESULT_PAGES')
        result = {'complete': True, 'pages': pages,
                  'data': {'schema': 'alice-graph-result/v1', 'plan_hash': fingerprint(plan),
                           'value': clone(value),
                           'valid_until': adapter.expiry(clone(value), clone(plan)),
                           'projection_hash': fingerprint({'pages':pages,'fetched_at':stamp})},
                  'fetched_at': stamp}
        require(type(result['data']['valid_until']) is int and
                now < result['data']['valid_until'] <= plan['task_graph']['deadline'],
                'GRAPH_RESULT_EXPIRED')
        require(size(result) <= self.catalog['limits']['max_bytes'], 'GRAPH_RESULT_CAPACITY')
        return result

    def readable(self, plan, result, now):
        try:
            require(self.permitted(plan, now, 'read'), 'GRAPH_ACCESS_CHANGED')
            require(type(result) is dict and set(result)=={'complete','pages','data','fetched_at'}
                    and result['complete'] is True, 'GRAPH_RESULT_SCHEMA')
            data=result['data']
            require(type(data) is dict and set(data)=={'schema','plan_hash','value','valid_until','projection_hash'}
                    and data['schema']=='alice-graph-result/v1'
                    and data['plan_hash']==fingerprint(plan), 'GRAPH_RESULT_SCHEMA')
            graph=self.catalog['graphs'][plan['task_graph']['id']]
            adapter=self.adapters[graph['nodes'][-1]['adapter']]
            require(type(data['valid_until']) is int and now < data['valid_until']
                    and data['valid_until']==adapter.expiry(clone(data['value']),clone(plan)),
                    'GRAPH_RESULT_EXPIRED')
            require(data['projection_hash']==fingerprint({'pages':result['pages'],'fetched_at':result['fetched_at']}),
                    'GRAPH_RESULT_CHANGED')
            return adapter.check(clone(data['value']),clone(plan),now) is True
        except (Rejected,MatrixError,ValueError,TypeError,KeyError):
            return False

    def verify_result(self, repo, row, plan, result):
        require(self.permitted(plan, repo.clock(), 'commit'), 'GRAPH_ACCESS_CHANGED')
        state = self._progress(repo, row, plan)
        graph = self.catalog['graphs'][plan['task_graph']['id']]
        require(state['index'] == len(graph['nodes']), 'GRAPH_RESULT_PREMATURE')
        expected = self.report(plan, state['outputs'][graph['output']], result['fetched_at'], repo.clock())
        require(canonical_json(expected) == canonical_json(result), 'RESULT_PROJECTION_MISMATCH')
        return True
