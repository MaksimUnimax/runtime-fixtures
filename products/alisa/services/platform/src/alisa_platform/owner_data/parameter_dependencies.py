"""Pure declarative coefficient binding for a compound report.

No HTTP, DB, model calls, implicit writes, or per-parameter branching. Values are
request-local objects; only checkpoint() may be retained by the existing job.
A producer request is a dependency, NOT a grant to collect or mutate a store.
"""
from copy import deepcopy
from datetime import date
from hashlib import sha256
from pathlib import Path
import json
import re
from typing import Any
from . import parameter_contract as contract
from .parameter_resolution import plan_parameter
from .parameter_producers import CATALOG as PRODUCERS

CATALOG = json.loads(Path(__file__).with_name('parameter_dependency_catalog.json').read_text())
STORE = {'kind': 'store', 'sku': ''}


def profile(profile_id: str) -> dict[str, Any]:
    contract.need(type(profile_id) is str and profile_id in CATALOG['profiles'],
                  'PARAMETER_DEPENDENCY_PROFILE_UNKNOWN')
    value = deepcopy(CATALOG['profiles'][profile_id])
    contract.exact(value, ('provider', 'description', 'bindings'))
    contract.need(type(value['bindings']) is list and bool(value['bindings']),
                  'PARAMETER_DEPENDENCY_SCHEMA')
    slots = set()
    for binding in value['bindings']:
        contract.exact(binding, ('slot', 'parameter', 'lookup', 'missing_scope'))
        slot = binding['slot']
        contract.need(type(slot) is str and re.fullmatch(r'[a-z][a-z0-9_]*', slot)
                      and slot not in slots, 'PARAMETER_DEPENDENCY_SLOT')
        slots.add(slot)
        rule = contract.definition(binding['parameter'])
        contract.need(value['provider'] in rule['platforms'], 'PARAMETER_PLATFORM')
        contract.need(binding['lookup'] in ('consumer', 'store')
                      and binding['missing_scope'] in ('consumer', 'store'),
                      'PARAMETER_DEPENDENCY_SCOPE')
    return value


def profile_hash(profile_id: str) -> str:
    return sha256(contract.CANON(profile(profile_id)).encode()).hexdigest()


def consumers_checked(consumers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    contract.need(type(consumers) is list and bool(consumers), 'PARAMETER_DEPENDENCY_SCHEMA')
    seen = set()
    for consumer in consumers:
        contract.exact(consumer, ('id', 'store_id', 'scope', 'sku_reference'))
        contract.need(type(consumer['id']) is str and re.fullmatch(r'[A-Za-z0-9_.:-]+', consumer['id'])
                      and consumer['id'] not in seen, 'PARAMETER_DEPENDENCY_CONSUMER')
        seen.add(consumer['id'])
        contract.need(type(consumer['store_id']) is str and bool(consumer['store_id']),
                      'PARAMETER_DEPENDENCY_STORE')
        contract.scope(consumer['scope'])
        proof = consumer['sku_reference']
        contract.need(proof is None if consumer['scope']['kind'] == 'store'
                      else type(proof) is str and bool(proof), 'PARAMETER_SKU_UNVERIFIED')
    return deepcopy(consumers)


def request(consumer: dict[str, Any], key: str, area: dict[str, str]) -> dict[str, Any]:
    return {'store_id': consumer['store_id'], 'parameter': key, 'scope': deepcopy(area),
            'sku_reference': consumer['sku_reference'] if area['kind'] == 'sku' else None}


def identity(value: dict[str, Any]) -> str:
    return contract.CANON([value['store_id'], value['parameter'],
                           value['scope']['kind'], value['scope']['sku']])


def read_requests(profile_id: str, consumers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Read common targets too: their CAS revision must not be taken from a SKU."""
    definition = profile(profile_id)
    result = {}
    for consumer in consumers_checked(consumers):
        for binding in definition['bindings']:
            for mode in (binding['lookup'], binding['missing_scope']):
                area = consumer['scope'] if mode == 'consumer' else STORE
                row = request(consumer, binding['parameter'], area)
                result.setdefault(identity(row), row)
    return [result[key] for key in sorted(result)]


def _pin(view: dict[str, Any]) -> dict[str, Any]:
    value = view['effective']
    return {'store_id': view['store_id'], 'parameter': view['parameter'],
            'scope': deepcopy(view['scope']), 'slot_revision': view['revision'],
            'effective': None if value is None else {
                'scope': deepcopy(value['scope']), 'revision': value['revision'],
                'unit': value['unit'], 'definition_hash': value['definition_hash']}}


class ResolvedParameters:
    """Not JSON-serializable by design: do not persist a snapshot of old values."""
    def __init__(self, profile_id, bindings, producers, reads, pins, report_period,
                 consumers, planning_date, period_requests, history_proofs):
        self.profile_id = profile_id
        self.profile_hash = profile_hash(profile_id)
        self.definition_hash = contract.CATALOG_HASH
        self._bindings = deepcopy(bindings)
        self._producers = deepcopy(producers)
        self._reads = deepcopy(reads)
        self._pins = deepcopy(pins)
        self._report_period = deepcopy(report_period)
        self._consumers = deepcopy(consumers)
        self._planning_date = planning_date
        self._period_requests = deepcopy(period_requests)
        self._history_proofs = deepcopy(history_proofs)

    def __repr__(self):
        return '<ResolvedParameters ready=%s bindings=%d>' % (self.ready, len(self._bindings))

    @property
    def ready(self) -> bool:
        return not self._producers

    @property
    def producers(self) -> list[dict[str, Any]]:
        return deepcopy(self._producers)

    def formula_inputs(self, consumer_id: str) -> dict[str, str]:
        contract.need(self.ready, 'PARAMETER_DEPENDENCIES_PENDING')
        rows = [r for r in self._bindings if r['consumer'] == consumer_id]
        contract.need(bool(rows), 'PARAMETER_DEPENDENCY_CONSUMER')
        return {r['slot']: r['value']['value'] for r in rows}

    def answer_basis(self) -> list[dict[str, Any]]:
        contract.need(self.ready, 'PARAMETER_DEPENDENCIES_PENDING')
        fields = ('parameter', 'scope', 'value', 'unit', 'origin', 'collected_at',
                  'calculated_at', 'updated_at', 'actual_period')
        return [{'consumer': r['consumer'], 'slot': r['slot'], 'store_id': r['store_id'],
                 'inherited': r['inherited'],
                 **{k: deepcopy(r['value'].get(k)) for k in fields}} for r in self._bindings]

    def checkpoint(self) -> dict[str, Any]:
        # Periods here describe NEW dependency jobs, not past coefficient builds.
        return {'schema': 'alisa-compound-parameter-dependencies/v1', 'profile_id': self.profile_id,
                'profile_hash': self.profile_hash, 'definition_hash': self.definition_hash,
                'ready': self.ready, 'report_period': deepcopy(self._report_period),
                'coefficient_period_anchor': self._planning_date.isoformat(),
                'parameter_period_requests': deepcopy(self._period_requests),
                'pins': deepcopy(self._pins), 'producers': self.producers,
                'bindings': [{k: deepcopy(r[k]) for k in ('consumer', 'slot', 'store_id', 'parameter',
                                                         'lookup_scope', 'producer_id')} for r in self._bindings],
                'persist_values': False, 'execution_authorized': False}


def resolve(profile_id: str, consumers: list[dict[str, Any]], views: list[dict[str, Any]],
            today: date, *, report_period=None, parameter_periods=None, history_proofs=None) -> ResolvedParameters:
    """Bind an authenticated coherent readset; do not execute producers.

    parameter_periods is keyed by declared formula slot, independent of report_period.
    history_proofs is internal, backed by qualified source receipts, never UI JSON.
    """
    definition = profile(profile_id)
    consumers = consumers_checked(consumers)
    contract.need(type(today) is date, 'PARAMETER_PERIOD')
    if report_period is not None:
        contract.dates(report_period)
    periods = {} if parameter_periods is None else parameter_periods
    contract.need(type(periods) is dict and set(periods) <= {b['slot'] for b in definition['bindings']},
                  'PARAMETER_DEPENDENCY_PERIOD_SLOT')
    history = {} if history_proofs is None else history_proofs
    contract.need(type(history) is dict, 'PARAMETER_HISTORY_UNCONFIRMED')
    expected = {identity(r) for r in read_requests(profile_id, consumers)}
    contract.need(type(views) is list, 'PARAMETER_DEPENDENCY_READSET')
    index = {}
    for view in views:
        contract.need(type(view) is dict and
                      {'store_id', 'parameter', 'scope', 'revision', 'effective', 'inherited'} <= set(view),
                      'PARAMETER_DEPENDENCY_READSET')
        contract.scope(view['scope'])
        contract.need(identity(view) not in index, 'PARAMETER_DEPENDENCY_READSET')
        contract.need(type(view['revision']) is int and view['revision'] >= 0,
                      'PARAMETER_DEPENDENCY_REVISION')
        index[identity(view)] = deepcopy(view)
    contract.need(set(index) == expected, 'PARAMETER_DEPENDENCY_READSET')
    bindings, pending, used = [], {}, {}
    for consumer in consumers:
        for binding in definition['bindings']:
            key = binding['parameter']
            lookup_area = consumer['scope'] if binding['lookup'] == 'consumer' else STORE
            read = request(consumer, key, lookup_area)
            view = index[identity(read)]
            used.setdefault(identity(read), read)
            current = view['effective']
            row = {'consumer': consumer['id'], 'slot': binding['slot'], 'store_id': consumer['store_id'],
                   'parameter': key, 'lookup_scope': deepcopy(lookup_area), 'producer_id': None,
                   'inherited': view['inherited'], 'value': deepcopy(current)}
            if current is not None:
                rule = contract.definition(key)
                contract.need(current.get('parameter') == key and current.get('state') == 'VALUE'
                              and (current.get('scope') == lookup_area or
                                   lookup_area['kind'] == 'sku' and current.get('scope') == STORE),
                              'PARAMETER_DEPENDENCY_VALUE_SCOPE')
                contract.validate_value(rule, current.get('value'), current.get('unit'))
                # Reuses half-year/manual/old/zero data without period/age refresh.
                bindings.append(row)
                continue
            area = consumer['scope'] if binding['missing_scope'] == 'consumer' else STORE
            target = request(consumer, key, area)
            target_view = index[identity(target)]
            contract.need(target_view['effective'] is None, 'PARAMETER_READSET_INCOHERENT')
            proof = history.get(identity(target), {})
            contract.need(type(proof) is dict and set(proof) <= {'available_from', 'confirmed'},
                          'PARAMETER_HISTORY_UNCONFIRMED')
            plan = plan_parameter(key, target_view, today, action='use',
                                  period_request=periods.get(binding['slot']),
                                  available_from=proof.get('available_from'),
                                  short_history_confirmed=proof.get('confirmed', False))
            # plan_parameter may widen an absent SKU. Require this to be declared,
            # not silently reinterpret a consumer-specific profile.
            contract.need(plan['scope'] == area, 'PARAMETER_DEPENDENCY_SCOPE')
            recipe = PRODUCERS['templates'][plan['template_id']]
            for source in recipe['sources']:
                contract.need(area['kind'] in PRODUCERS['sources'][source].get('scopes', ['store', 'sku']),
                              'PARAMETER_SOURCE_SCOPE_UNAVAILABLE')
            producer = {'id': sha256(identity(target).encode()).hexdigest(), 'store_id': consumer['store_id'],
                        'parameter': key, 'template_id': plan['template_id'], 'scope': deepcopy(area),
                        'parameter_period': deepcopy(plan['parameter_period']),
                        'expected_revision': target_view['revision'], 'write_intent': 'fill_missing',
                        'execution_authorized': False}
            old = pending.setdefault(identity(target), producer)
            contract.need(old == producer, 'PARAMETER_DEPENDENCY_CONFLICT')
            row['producer_id'] = producer['id']
            bindings.append(row)
    ordered_reads = [used[k] for k in sorted(used)]
    return ResolvedParameters(profile_id, bindings, [pending[k] for k in sorted(pending)],
                              ordered_reads, [_pin(index[k]) for k in sorted(used)], report_period,
                              consumers, today, periods, history)
