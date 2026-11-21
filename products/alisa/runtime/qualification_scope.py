"""Optional scoped source qualification, common to all declarative recipes.

Reads trusted configuration metadata only; never grants authorization on its own.
No provider identifiers, URLs, credentials, HTTP, or SQLite in this module.
"""
from __future__ import annotations
import math
from datetime import date,datetime
from zoneinfo import ZoneInfo,ZoneInfoNotFoundError
from typing import Any, Mapping


class QualificationError(ValueError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def require(condition: bool, code: str) -> None:
    if not condition:
        raise QualificationError(code)


def validate_policy(policy: Any) -> None:
    if type(policy) is dict and policy.get('schema') == 'source-contract-scope/v1':
        require(set(policy) == {'schema','period_from_field','period_to_field','max_period_days','business_timezone','completed_periods_only'}, 'SOURCE_PROOF_POLICY')
        for field in ('period_from_field','period_to_field'):
            value=policy[field]
            require(type(value) is str and value.isidentifier() and len(value)<=80,'SOURCE_PROOF_POLICY')
        require(policy['period_from_field']!=policy['period_to_field'],'SOURCE_PROOF_POLICY')
        require(type(policy['max_period_days']) is int and 1<=policy['max_period_days']<=366,'SOURCE_PROOF_POLICY')
        require(type(policy['completed_periods_only']) is bool and type(policy['business_timezone']) is str,'SOURCE_PROOF_POLICY')
        try:ZoneInfo(policy['business_timezone'])
        except (ZoneInfoNotFoundError,ValueError):raise QualificationError('SOURCE_PROOF_POLICY') from None
        return
    require(type(policy) is dict and set(policy) == {
        'schema', 'period_from_field', 'period_to_field', 'maximum_age_seconds'
    }, 'SOURCE_PROOF_POLICY')
    require(policy['schema'] == 'exact-source-scope/v1', 'SOURCE_PROOF_POLICY')
    for field in ('period_from_field', 'period_to_field'):
        value = policy[field]
        require(type(value) is str and value.isidentifier() and len(value) <= 80,
                'SOURCE_PROOF_POLICY')
    require(policy['period_from_field'] != policy['period_to_field'], 'SOURCE_PROOF_POLICY')
    require(type(policy['maximum_age_seconds']) is int and
            1 <= policy['maximum_age_seconds'] <= 86400, 'SOURCE_PROOF_POLICY')


def exact_day(value: Any) -> str:
    require(type(value) is str and len(value) == 10, 'SOURCE_PROOF_PERIOD')
    try:
        require(date.fromisoformat(value).isoformat() == value, 'SOURCE_PROOF_PERIOD')
    except ValueError:
        raise QualificationError('SOURCE_PROOF_PERIOD') from None
    return value


def check_scope(spec: Mapping, source_hash: str, proof: Mapping, store: Mapping,
                body: Mapping, now: float) -> None:
    """New scoped policies are opt-in data; legacy qualification stays unchanged.

    This is permission to use a qualified source for an exact scope/period, not
    proof that the returned data are complete. Page and dataset validation remain
    mandatory. The caller must provide protected, current qualification metadata;
    never populate it from user JSON or an unchecked provider field.
    """
    policy = spec.get('options', {}).get('qualification_scope')
    if policy is None:
        return
    validate_policy(policy)
    if policy['schema']=='source-contract-scope/v1':
        return check_contract_scope(policy,spec,source_hash,proof,store,body,now)
    require(type(proof) is dict and type(store) is dict and type(body) is dict,
            'SOURCE_PROOF_REQUIRED')
    require(type(now) in (int, float) and math.isfinite(now), 'SOURCE_PROOF_CLOCK')
    for key, expected in spec['proof_requirements'].items():
        actual = proof.get(key)
        require(type(actual) is type(expected) and actual == expected,
                'SOURCE_PROOF_REQUIREMENTS')
    scope = proof.get('scope')
    require(type(scope) is dict and set(scope) == {
        'store_id', 'identity', 'access_revision', 'source_revision', 'source_hash',
        'period', 'observed_at', 'expires_at', 'evidence_ref'
    }, 'SOURCE_PROOF_REQUIRED')
    for left, right in (('store_id', 'id'), ('identity', 'identity'),
                        ('access_revision', 'access_revision'), ('source_revision', 'source_revision')):
        require(type(scope[left]) is str and scope[left] == store.get(right),
                'SOURCE_PROOF_SCOPE')
    require(scope['source_hash'] == source_hash, 'SOURCE_PROOF_VERSION')
    require(type(scope['evidence_ref']) is str and 1 <= len(scope['evidence_ref']) <= 400,
            'SOURCE_PROOF_REQUIRED')
    period = scope['period']
    require(type(period) is dict and set(period) == {'from', 'to'}, 'SOURCE_PROOF_PERIOD')
    start, end = exact_day(period['from']), exact_day(period['to'])
    require(start <= end, 'SOURCE_PROOF_PERIOD')
    require(body.get(policy['period_from_field']) == start and
            body.get(policy['period_to_field']) == end, 'SOURCE_PROOF_PERIOD')
    begin, expires = scope['observed_at'], scope['expires_at']
    require(type(begin) in (int, float) and type(expires) in (int, float)
            and math.isfinite(begin) and math.isfinite(expires), 'SOURCE_PROOF_TIME')
    require(begin <= now < expires and 0 < expires - begin <= policy['maximum_age_seconds'],
            'SOURCE_PROOF_EXPIRED')


def check_contract_scope(policy,spec,source_hash,proof,store,body,now):
    """Protected source-contract authorization, not attestation of report totals.
    Exact-period v1 remains separate and unchanged. No endpoint names in code.
    """
    require(type(proof) is dict and type(store) is dict and type(body) is dict,'SOURCE_PROOF_REQUIRED')
    require(type(now) in (int,float) and math.isfinite(now),'SOURCE_PROOF_CLOCK')
    for key,expected in spec['proof_requirements'].items():
        actual=proof.get(key)
        require(type(actual) is type(expected) and actual==expected,'SOURCE_PROOF_REQUIREMENTS')
    scopes=proof.get('contract_scopes')
    require(type(scopes) is list and 1<=len(scopes)<=128,'SOURCE_PROOF_REQUIRED')
    seen=set();selected=None
    for scope in scopes:
        require(type(scope) is dict and set(scope)=={'store_id','identity','access_revision','source_revision','source_hash','observed_at','evidence_ref'},'SOURCE_PROOF_REQUIRED')
        require(type(scope['store_id']) is str and scope['store_id'] not in seen,'SOURCE_PROOF_SCOPE')
        seen.add(scope['store_id'])
        if scope['store_id']==store.get('id'):selected=scope
    require(selected is not None,'SOURCE_PROOF_SCOPE')
    for left,right in [('store_id','id'),('identity','identity'),('access_revision','access_revision'),('source_revision','source_revision')]:
        require(type(selected[left]) is str and selected[left]==store.get(right),'SOURCE_PROOF_SCOPE')
    require(type(selected['source_hash']) is str and selected['source_hash']==source_hash,'SOURCE_PROOF_VERSION')
    require(type(selected['observed_at']) in (int,float) and math.isfinite(selected['observed_at']) and selected['observed_at']<=now,'SOURCE_PROOF_TIME')
    require(type(selected['evidence_ref']) is str and 1<=len(selected['evidence_ref'])<=400,'SOURCE_PROOF_REQUIRED')
    start=exact_day(body.get(policy['period_from_field']));end=exact_day(body.get(policy['period_to_field']))
    days=(date.fromisoformat(end)-date.fromisoformat(start)).days+1
    require(1<=days<=policy['max_period_days'],'SOURCE_PROOF_PERIOD')
    if policy['completed_periods_only']:
        today=datetime.fromtimestamp(now,ZoneInfo(policy['business_timezone'])).date().isoformat()
        require(end<today,'SOURCE_PERIOD_NOT_COMPLETED')
