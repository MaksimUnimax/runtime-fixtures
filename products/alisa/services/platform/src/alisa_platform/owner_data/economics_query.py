"""Current owner inputs for the admitted full forecast on the existing Query.

Only the existing service-authenticated private authority RPC may call these
entry points. Its native peer attests the already verified order receipts; this
bounded read subset is neither a QualifiedCohort nor evidence of complete fees.
No session token, new permission, public route or historical value is created.
"""
from copy import deepcopy
from datetime import date
from hashlib import sha256
from pathlib import Path
from uuid import uuid5
import re

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from . import economics_current as current_owner
from . import economics_orders as orders
from . import parameter_contract as pc
from . import parameter_dependencies as dependencies
from . import parameter_report_contract as reports
from . import parameter_report_rpc as report_rpc
from . import parameter_service as parameters
from .source import DjangoOwnerSource
from .service import RESOLVER, need
from .owner_inputs import digest

TEMPLATE = 'economics.unit_forecast.v1'
PROFILE = 'unit_economics.ozon.v1'
OWNER_FIELDS = ['unit_cost', 'tax_amount', 'own_cost_amount']
READSET_SCHEMA = 'alisa-economics-owner-readset/v1'
DESCRIPTOR_SCHEMA = 'alisa-economics-query/v1'
CHECKPOINT_SCHEMA = 'alisa-economics-query-fence/v1'
BATCH_SIZE = 64  # Per private-RPC message, never a report row/day/batch quota.
ORDER_NORMALIZER_SHA256 = sha256(Path(orders.__file__).read_bytes()).hexdigest()
HEX = re.compile(r'[a-f0-9]{64}')


def _enabled():
    need(getattr(settings, 'OWNER_ECONOMICS_COMPOSITES_ENABLED', False) is True
         and getattr(settings, 'OWNER_PARAMETER_COMPOUNDS_ENABLED', False) is True,
         'ECONOMICS_QUERY_DISABLED', 403)
    parameters._enabled()


def _rule():
    _enabled()
    rule = reports.definition(TEMPLATE)
    need(rule.get('provider') == 'OZON' and rule.get('scope') == 'store' and rule.get('profile') == PROFILE
         and rule.get('owner_fields') == OWNER_FIELDS
         and rule.get('orders_catalog_hash') == orders.HASH
         and rule.get('source_mode') == 'cohort_forecast',
         'ECONOMICS_QUERY_CONTRACT', 409)
    return rule


def _text(value):
    return type(value) is str and bool(value) and len(value) <= 256 and not any(ord(c) < 32 for c in value)


def _input(value, anchor):
    normalized = reports.normalized_input(value)
    pc.dates({'from': anchor, 'to': anchor})
    today = date.fromisoformat(anchor)
    slots = {binding['slot'] for binding in dependencies.profile(PROFILE)['bindings']}
    requests = normalized['parameter_periods']
    need(set(requests) <= slots, 'ECONOMICS_PARAMETER_PERIOD', 422)
    for request in requests.values():
        # Omit a slot for its default year. An explicit request is a period,
        # never a number/value payload hidden in supposedly metadata-only state.
        need(type(request) is dict, 'ECONOMICS_PARAMETER_PERIOD', 422)
        pc.resolve_period(today, request)
    return normalized


def _check_descriptor(value):
    """Extra policy check AFTER the existing _node has authenticated a reference.

    Existing report_dependency_current/fill must apply this check too for this
    template. Otherwise an old producer reference would outlive its feature gate.
    This helper by itself never grants authority.
    """
    rule = _rule()
    pc.exact(value, ('schema', 'invocation_id', 'template_id', 'profile', 'profile_hash',
                     'input', 'anchor', 'platform_store_id', 'runtime_store_id',
                     'runtime_tenant', 'job_id', 'owner_fields', 'owner_catalog_hash',
                     'orders_catalog_hash', 'order_normalizer_sha256',
                     'parameter_catalog_hash', 'report_rule_hash', 'source_mode'))
    need(value['schema'] == DESCRIPTOR_SCHEMA and value['template_id'] == TEMPLATE
         and value['profile'] == PROFILE and value['profile_hash'] == dependencies.profile_hash(PROFILE)
         and value['owner_fields'] == OWNER_FIELDS and value['owner_catalog_hash'] == RESOLVER.hash
         and value['orders_catalog_hash'] == orders.HASH
         and value['order_normalizer_sha256'] == ORDER_NORMALIZER_SHA256
         and value['parameter_catalog_hash'] == pc.CATALOG_HASH
         and value['report_rule_hash'] == digest(rule) and value['source_mode'] == 'cohort_forecast',
         'ECONOMICS_QUERY_CONTRACT', 409)
    need(all(_text(value[k]) for k in ('invocation_id', 'platform_store_id', 'runtime_store_id',
                                      'runtime_tenant', 'job_id')), 'ECONOMICS_QUERY_DESCRIPTOR', 422)
    need(value['input'] == _input(value['input'], value['anchor']), 'ECONOMICS_QUERY_DESCRIPTOR', 422)


def _node(authority, reference):
    _enabled()
    ref, row, info, actor, store, node = report_rpc._node(authority, reference)
    need(ref['dependency_id'] is None, 'ECONOMICS_QUERY_REFERENCE', 403)
    _check_descriptor(node['descriptor'])
    need(store.provider == 'OZON' and str(store.pk) == node['descriptor']['platform_store_id'],
         'ECONOMICS_OWNER_SCOPE', 403)
    return ref, row, info, actor, store, node


class _QueryOwnerSource(DjangoOwnerSource):
    """Private adapter: a signed Query reference, never a captured actor or token."""
    def __init__(self, authority, reference):
        self._authority = authority
        self._reference = reference
        self.required_credentials = ('SELLER', 'PERFORMANCE')
        self.bound = self.bound_period = None

    def _actor_store(self):
        _, _, _, actor, store, _ = _node(self._authority, self._reference)
        return actor, store

    @transaction.atomic
    def current(self):
        value = super().current()
        _, query, _, _, _, _ = _node(self._authority, self._reference)
        value['authority_expires_at'] = min(value['authority_expires_at'], int(query.expires_at.timestamp()))
        return value


@transaction.atomic
def bind(authority, payload):
    rule = _rule()
    pc.exact(payload, ('method', 'query_id', 'pins', 'template_id', 'invocation_id',
                       'runtime_store_id', 'input', 'question_hash', 'job_id'))
    need(payload['method'] == 'report_bind' and payload['template_id'] == TEMPLATE,
         'ECONOMICS_QUERY_REFERENCE', 403)
    need(_text(payload['invocation_id']) and _text(payload['job_id']), 'ECONOMICS_QUERY_DESCRIPTOR', 422)
    row, info, actor, scope = report_rpc._load(authority, payload['query_id'], payload['pins'])
    need(info['question_hash'] == payload['question_hash'], 'PARAMETER_INTENT_MISMATCH', 403)
    normalized = _input(payload['input'], info['anchor'])
    # The native peer proves the actual job-to-Query mapping. Pin its first full
    # report job across every owner batch/store in this locked Query as well;
    # runtime_job_ref is a different public identifier and is not compared here.
    nodes = row.continuation.get(report_rpc.KEY, {})
    need(type(nodes) is dict, 'ECONOMICS_QUERY_DESCRIPTOR', 409)
    for existing in nodes.values():
        need(type(existing) is dict and type(existing.get('descriptor')) is dict,
             'ECONOMICS_QUERY_DESCRIPTOR', 409)
        if existing['descriptor'].get('template_id') == TEMPLATE:
            need(existing['descriptor'].get('job_id') == payload['job_id'], 'PARAMETER_JOB_MISMATCH', 403)
    targets = [pin['store_id'] for pin, native in zip(payload['pins']['store_scope'], scope['stores'])
               if native['id'] == payload['runtime_store_id']]
    need(len(targets) == 1, 'PERMISSION_DENIED', 403)
    from alisa_platform.stores.models import Store
    store = Store.objects.select_for_update().get(pk=targets[0], tenant_id=actor.tenant_id)
    need(store.provider == rule['provider'], 'PARAMETER_PLATFORM', 422)
    descriptor = {'schema': DESCRIPTOR_SCHEMA, 'invocation_id': payload['invocation_id'],
                  'template_id': TEMPLATE, 'profile': PROFILE, 'profile_hash': dependencies.profile_hash(PROFILE),
                  'input': normalized, 'anchor': info['anchor'], 'platform_store_id': str(store.pk),
                  'runtime_store_id': payload['runtime_store_id'], 'runtime_tenant': scope['tenant'],
                  'job_id': payload['job_id'], 'owner_fields': deepcopy(OWNER_FIELDS),
                  'owner_catalog_hash': RESOLVER.hash, 'orders_catalog_hash': orders.HASH,
                  'order_normalizer_sha256': ORDER_NORMALIZER_SHA256, 'parameter_catalog_hash': pc.CATALOG_HASH,
                  'report_rule_hash': digest(rule), 'source_mode': 'cohort_forecast'}
    _check_descriptor(descriptor)
    node_id = digest({'invocation': payload['invocation_id'], 'template': TEMPLATE, 'store': str(store.pk)})
    node = row.continuation.get(report_rpc.KEY, {}).get(node_id)
    if node is None:
        node = {'descriptor': descriptor, 'dependencies': {}}
        row.continuation.setdefault(report_rpc.KEY, {})[node_id] = node
        row.save(update_fields=['continuation'])
    else:
        need(node['descriptor'] == descriptor, 'IDEMPOTENCY_CONFLICT', 409)
    reference = report_rpc._sign({'query_id': str(row.pk), 'pins': payload['pins'], 'node_id': node_id,
                                  'descriptor_hash': digest(descriptor), 'dependency_id': None})
    return {'reference': reference}


@transaction.atomic
def current(authority, reference):
    # Preflight the inherited owner boundary before any provider IO. It checks
    # current approval/content/credentials, but exposes no facts and does not
    # resolve a unit cost, read coefficients or admit a dependency plan.
    state = _QueryOwnerSource(authority, reference).current()
    need(state['authority_expires_at'] > int(timezone.now().timestamp()), 'OWNER_SOURCE_AUTH_EXPIRED', 403)
    return {'current': True}


def _readset(descriptor, value):
    """Validate the private peer's immutable read request, not its source ledger."""
    pc.exact(value, ('schema', 'scope', 'period', 'order_definition_hash', 'order_normalizer_sha256',
                     'orders_block_sha256', 'orders_checkpoint_sha256', 'receipt_set_sha256',
                     'original_row_count', 'distinct_read_count', 'batch', 'rows'))
    need(value['schema'] == READSET_SCHEMA, 'ECONOMICS_READSET_SCHEMA', 422)
    expected_scope = {'tenant_id': descriptor['runtime_tenant'], 'store_id': descriptor['runtime_store_id'],
                      'provider': 'OZON', 'currency': 'RUB'}
    need(value['scope'] == expected_scope and value['period'] == descriptor['input']['period'],
         'ECONOMICS_READSET_SCOPE', 403)
    need(value['order_definition_hash'] == descriptor['orders_catalog_hash']
         and value['order_normalizer_sha256'] == descriptor['order_normalizer_sha256'],
         'ECONOMICS_READSET_CONTRACT', 409)
    for key in ('orders_block_sha256', 'orders_checkpoint_sha256', 'receipt_set_sha256'):
        need(type(value[key]) is str and HEX.fullmatch(value[key]) is not None,
             'ECONOMICS_READSET_SOURCE', 422)
    count, original = value['distinct_read_count'], value['original_row_count']
    need(type(count) is int and type(original) is int and 0 <= count <= original
         and (count == 0) == (original == 0), 'ECONOMICS_READSET_COUNT', 422)
    pc.exact(value['batch'], ('index', 'total'))
    index, total = value['batch']['index'], value['batch']['total']
    need(type(index) is int and type(total) is int and total == max(1, (count + BATCH_SIZE - 1) // BATCH_SIZE)
         and 0 <= index < total, 'ECONOMICS_READSET_BATCH', 422)
    expected_count = min(BATCH_SIZE, count - index * BATCH_SIZE)
    rows = value['rows']
    need(type(rows) is list and len(rows) == expected_count, 'ECONOMICS_READSET_COUNT', 422)
    keys = []
    for item in rows:
        pc.exact(item, ('sku', 'day'))
        pc.scope({'kind': 'sku', 'sku': item['sku']})
        pc.dates({'from': item['day'], 'to': item['day']})
        need(value['period']['from'] <= item['day'] <= value['period']['to'], 'ECONOMICS_READSET_DAY', 422)
        keys.append((item['sku'], item['day']))
    need(keys == sorted(set(keys)), 'ECONOMICS_READSET_DUPLICATE_OR_ORDER', 422)
    return deepcopy(value)


def _parameters(actor, store, descriptor, rows):
    if not rows:
        return None, {}
    consumers, ids = [], {}
    for item in rows:
        key = pc.CANON([item['sku'], item['day']])
        ident = 'owner-' + digest(key)
        ids[key] = ident
        consumers.append({'id': ident, 'store_id': str(store.pk), 'scope': {'kind': 'sku', 'sku': item['sku']},
                          'sku_reference': parameters.sku_reference(actor, store, item['sku'])})
    checked = dependencies.consumers_checked(consumers)
    definition = dependencies.profile(descriptor['profile'])
    need(definition['provider'] == store.provider, 'PARAMETER_PLATFORM', 422)
    # Validate EVERY consumer before shared reads are deduplicated.
    for consumer in sorted(checked, key=lambda item: item['id']):
        for binding in definition['bindings']:
            parameters._target(actor, store, binding['parameter'], consumer['scope'], consumer['sku_reference'])
    views = []
    for request in dependencies.read_requests(descriptor['profile'], checked):
        parameters._target(actor, store, request['parameter'], request['scope'], request['sku_reference'])
        views.append(parameters._read(actor, store, request['parameter'], request['scope']))
    result = dependencies.resolve(descriptor['profile'], checked, views, date.fromisoformat(descriptor['anchor']),
                                  report_period=descriptor['input']['period'],
                                  parameter_periods=descriptor['input']['parameter_periods'])
    return result, ids


def _prepare(authority, reference, ref, actor, store, node, readset):
    descriptor = node['descriptor']
    source = _QueryOwnerSource(authority, reference)
    state = source.current()
    need(state['scope']['tenant'] == str(actor.tenant_id)
         and state['scope']['stores'][0]['id'] == str(store.pk)
         and state['scope']['stores'][0]['platform'] == 'ozon', 'ECONOMICS_OWNER_SCOPE', 403)
    now = int(timezone.now().timestamp())
    expires = min(now + 300, state['authority_expires_at'])
    need(expires > now, 'OWNER_SOURCE_AUTH_EXPIRED', 403)
    bundle = source.make_bundle(state, now, expires)
    binding, ids = _parameters(actor, store, descriptor, readset['rows'])
    unit_costs, missing, cost_basis, by_sku = {}, [], [], {}
    period = descriptor['input']['period']
    for item in readset['rows']:
        sku, day = item['sku'], item['day']
        if sku not in by_sku:
            by_sku[sku] = current_owner._owner_value(source, state, bundle, 'sku:' + sku, ['unit_cost'], period)
        segments = by_sku[sku]['fields']['unit_cost']['segments']
        chosen = [segment for segment in segments if segment['period']['from'] <= day <= segment['period']['to']]
        need(len(chosen) == 1, 'ECONOMICS_COGS_PERIOD', 422)
        segment = chosen[0]
        if segment['state'] != 'VALUE':
            missing.append({'sku': sku, 'day': day, 'reason': segment['reason']})
        else:
            unit_costs[pc.CANON([sku, day])] = segment['value']
            cost_basis.append({'sku': sku, 'day': day, 'value': segment['value'],
                               'unit': segment['unit'], 'entry_id': segment['entry_id']})
    owner = current_owner._owner_value(source, state, bundle, bundle['store_entity'],
                                       ['tax_amount', 'own_cost_amount'], period)
    amounts = {}
    for field, value in owner['fields'].items():
        need(len(value['segments']) == 1, 'ECONOMICS_OWNER_PERIOD', 422)
        segment = value['segments'][0]
        amounts[field] = {'state': segment['state'], 'value': segment['value']}
    ready = not missing and (binding is None or binding.ready)
    coefficients = ({} if binding is None else
                    {key: binding.formula_inputs(ident) for key, ident in ids.items()} if binding.ready else None)
    checkpoint = {'schema': CHECKPOINT_SCHEMA, 'query_id': ref['query_id'], 'node_id': ref['node_id'],
                  'job_id': descriptor['job_id'], 'descriptor_hash': ref['descriptor_hash'],
                  'readset_hash': digest(readset), 'owner': current_owner._pin(state),
                  'parameters': binding.checkpoint() if binding is not None else None,
                  'ready': ready, 'missing_owner': deepcopy(missing),
                  'persist_values': False, 'execution_authorized': False}
    return {'ready': ready, 'missing_owner': missing, 'coefficients': coefficients, 'unit_costs': unit_costs,
            'owner_period': amounts, 'basis': {'parameters_used': binding.answer_basis() if binding and binding.ready else [],
                                              'unit_cost_basis': cost_basis, 'owner_data_revision': state['revision']},
            'checkpoint': checkpoint}, binding


def _producers(row, ref, store, node, binding):
    result = []
    for requested in binding.producers if binding is not None else []:
        ident = requested['id']
        old = node['dependencies'].get(ident)
        if old is None:
            old = {'plan': deepcopy(requested), 'command_id': str(uuid5(row.pk, ref['node_id'] + ':' + ident))}
            node['dependencies'][ident] = old
        else:
            need(old['plan']['parameter_period'] == requested['parameter_period'], 'PARAMETER_PERIOD_MISMATCH', 409)
        plan = old['plan']
        target = {'tenant_id': node['descriptor']['runtime_tenant'], 'store_id': node['descriptor']['runtime_store_id'],
                  'provider': store.provider, 'scope': plan['scope']}
        reference = report_rpc._sign({**ref, 'dependency_id': ident})
        result.append({'key': plan['parameter'], 'target': target, 'period': plan['parameter_period'],
                       'intent': {'intent_ref': reference, 'expected_revision': plan['expected_revision'], 'mode': 'fill_missing'}})
    return result


@transaction.atomic
def inputs(authority, reference, job_id, readset):
    ref, row, _, actor, store, node = _node(authority, reference)
    need(job_id == node['descriptor']['job_id'], 'PARAMETER_JOB_MISMATCH', 403)
    checked = _readset(node['descriptor'], readset)
    admitted = {'hash': digest(checked), 'readset': checked}
    if 'owner_readset' in node:
        need(node['owner_readset'] == admitted, 'ECONOMICS_READSET_CHANGED', 409)
    else:
        node['owner_readset'] = admitted
    result, binding = _prepare(authority, reference, ref, actor, store, node, checked)
    result['producers'] = _producers(row, ref, store, node, binding)
    row.continuation[report_rpc.KEY][ref['node_id']] = node
    row.save(update_fields=['continuation'])
    return result


@transaction.atomic
def fence(authority, reference, checkpoint):
    ref, _, _, actor, store, node = _node(authority, reference)
    admitted = node.get('owner_readset')
    need(type(admitted) is dict and set(admitted) == {'hash', 'readset'}, 'ECONOMICS_READSET_REQUIRED', 409)
    readset = _readset(node['descriptor'], admitted['readset'])
    need(admitted['hash'] == digest(readset), 'ECONOMICS_READSET_CHANGED', 409)
    result, _ = _prepare(authority, reference, ref, actor, store, node, readset)
    # Canonical JSON also rejects bool/int equivalence in a purported checkpoint.
    return {'current': result['ready'] and pc.CANON(result['checkpoint']) == pc.CANON(checkpoint)}
