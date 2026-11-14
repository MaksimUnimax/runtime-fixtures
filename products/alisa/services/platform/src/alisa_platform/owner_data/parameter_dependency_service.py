"""Authenticated, read-only compound bindings inside existing owner_data.

No endpoint, auth scope, migration, worker, or job writer is added. The future
native integration still has to bind current report authority and producer intent.
"""
from datetime import date
from django.db import transaction
from . import parameter_dependencies as dependencies
from . import parameter_service as service
from . import parameter_readset as readset
from .parameter_contract import ParameterError, CATALOG_HASH
from .service import actor_store, need, Rejected


@transaction.atomic
def resolve_current(token, profile_id, consumers, today: date, *, report_period=None,
                    parameter_periods=None, history_proofs=None):
    service._enabled()
    try:
        definition = dependencies.profile(profile_id)
        checked = dependencies.consumers_checked(consumers)
        # Validate every supplied SKU proof before de-duplicating shared reads.
        # No forged duplicate consumer can hide behind an earlier valid proof.
        for consumer in sorted(checked, key=lambda r: (r['store_id'], r['id'])):
            actor, store = actor_store(token, consumer['store_id'])
            need(store.provider == definition['provider'], 'PARAMETER_PLATFORM', 422)
            for binding in definition['bindings']:
                service._target(actor, store, binding['parameter'], consumer['scope'], consumer['sku_reference'])
        requests = dependencies.read_requests(profile_id, checked)
        rows = readset._requests(token, requests)
        return dependencies.resolve(profile_id, checked, [view for _, view in rows], today,
                                    report_period=report_period, parameter_periods=parameter_periods,
                                    history_proofs=history_proofs)
    except ParameterError as error:
        raise Rejected(error.code, 422) from None


@transaction.atomic
def publication_check(token, result):
    need(type(result) is dependencies.ResolvedParameters, 'PARAMETER_DEPENDENCY_RESULT', 422)
    service._enabled()
    try:
        profile_changed = (result.profile_hash != dependencies.profile_hash(result.profile_id)
                           or result.definition_hash != CATALOG_HASH)
        fence = readset.publication_fence(token, result._reads, result._pins, result.definition_hash)
        current = result.ready and not profile_changed and fence['current']
        return {'current': current,
                'reason': 'CURRENT' if current else ('PARAMETER_DEPENDENCIES_PENDING' if not result.ready
                                                    else 'PARAMETERS_CHANGED'),
                'rebind_from_current': not current, 'recollect_marketplace_data': False,
                'grant_to_execute_producers': False, 'old_values_stored': False}
    except ParameterError as error:
        raise Rejected(error.code, 422) from None


def rebind_current(token, previous):
    """Re-read only values, preserving the original independent period anchor.

    No fresh year starts merely because a delayed job crossed midnight. A changed
    profile definition requires the caller's normal compatibility handling, not
    silent adoption of a different dependency graph during report execution.
    """
    need(type(previous) is dependencies.ResolvedParameters, 'PARAMETER_DEPENDENCY_RESULT', 422)
    try:
        need(previous.profile_hash == dependencies.profile_hash(previous.profile_id),
             'PARAMETER_DEPENDENCY_PROFILE_CHANGED', 409)
        return resolve_current(token, previous.profile_id, previous._consumers, previous._planning_date,
                               report_period=previous._report_period,
                               parameter_periods=previous._period_requests,
                               history_proofs=previous._history_proofs)
    except ParameterError as error:
        raise Rejected(error.code, 422) from None
