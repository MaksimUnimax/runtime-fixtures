"""Conservative demand grouping. No model, customer lookup or source API call."""
import hashlib
import re
from .wire import canonical, text_is_projection

DEFAULT_POLICY = {
    'window_days': 30, 'min_contributions': 20, 'min_clients': 5,
    'paid_window_days': 14, 'paid_min_contributions': 5, 'paid_min_clients': 3,
    'tenant_daily_cap': 1,
}
COUNTED_REASONS = frozenset({
    'SEMANTIC_UNSUPPORTED', 'OPERATOR_UNSUPPORTED', 'P1_MISS_P2_SUCCESS',
    'WRONG_SEMANTICS', 'PARSER_OR_RUNTIME_BUG',
})
STATES = frozenset({'CANDIDATE', 'IN_REVIEW', 'WAITING_FOR_PROVIDER', 'ACCEPTED', 'REJECTED'})
DECISIONS = frozenset({'CONFIRMED_FINANCIAL_ERROR', 'CONFIRMED_DEFECT',
                       'PROVIDER_DEPENDENCY', 'ASSIGNMENT', 'REVIEW_COMPLETE'})
# Only explicit lexical equivalents are collapsed. Scope, exclusions, units,
# unknown/redacted fragments and the date axis remain part of compatibility.
EQUIVALENTS = {
    'заказ': 'заказы', 'заказов': 'заказы', 'заказам': 'заказы',
    'выкуп': 'выкупы', 'выкупов': 'выкупы', 'выкупам': 'выкупы',
    'продаж': 'продажи', 'продажам': 'продажи',
}


def validate_policy(value):
    if type(value) is not dict or set(value) != set(DEFAULT_POLICY):
        raise ValueError('DEMAND_POLICY_INVALID')
    for name, number in value.items():
        maximum = 365 if name.endswith('days') else 5 if name == 'tenant_daily_cap' else 100000
        if type(number) is not int or not 1 <= number <= maximum:
            raise ValueError('DEMAND_POLICY_INVALID')
    if (value['min_clients'] > value['min_contributions'] or
            value['paid_min_clients'] > value['paid_min_contributions']):
        raise ValueError('DEMAND_POLICY_INVALID')
    return dict(value)


def grouping(event):
    text = event.get('safe_utterance')
    if event.get('redaction_state') != 'TEXT_SAFE' or not text_is_projection(text):
        return None
    exact = ' '.join(text.lower().split())
    words = re.findall(r'<[^>]+>|[\w]+|[^\w\s]', exact)
    compatible_words = [EQUIVALENTS.get(word, word) for word in words
                        if word not in {'покажи', 'покажите'}]
    # Key rotations cannot turn one client into several apparent clients in a
    # single demand pool. Cross-version merging is refused, not guessed.
    context = {'platform': event['platform'], 'date_axis': event['semantic_axis'],
               'slot_types': sorted(set(event['slot_types'])),
               'pseudonym_key_version': event['pseudonym_key_version']}
    profile = {**context, 'meaning': compatible_words}
    key = hashlib.sha256(canonical(profile).encode()).hexdigest()
    return key, profile, text


def counted(event):
    return (event['reason_code'] in COUNTED_REASONS and
            event['final_outcome'] in {'READY', 'UNSUPPORTED', 'FAILED'})


def threshold(policy, general, paid):
    general_met = (general['contributions'] >= policy['min_contributions'] and
                   general['clients'] >= policy['min_clients'])
    paid_met = (paid['contributions'] >= policy['paid_min_contributions'] and
                paid['clients'] >= policy['paid_min_clients'])
    return 'GENERAL' if general_met else 'PAID_AT_EVENT' if paid_met else None
