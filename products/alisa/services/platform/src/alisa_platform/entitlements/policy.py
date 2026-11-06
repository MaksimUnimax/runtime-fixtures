"""Pure interval and input rules; no identity, billing or wall-clock side effects."""
from datetime import datetime, timedelta

SOURCES = frozenset({'GIFT', 'COMPENSATION'})
REASONS = frozenset({'PILOT_ACCESS', 'SUPPORT_REQUEST', 'ACCESS_REVOCATION'})
APPEND_POLICY = 'AFTER_LAST_SCHEDULED'


def gift_input(value, limits):
    if set(value) != {'customer_ids', 'days', 'source', 'reason', 'comment', 'notify', 'policy'}:
        raise ValueError('Exact gift fields required')
    ids = value['customer_ids']
    if not isinstance(ids, list) or not 1 <= len(ids) <= limits['recipients']:
        raise ValueError('Recipient limit')
    from alisa_platform.staff.policy import identifier
    ids = [identifier(v) for v in ids]
    if len(set(ids)) != len(ids):
        raise ValueError('Duplicate recipient')
    days = value['days']
    if type(days) is not int or not 1 <= days <= limits['days'] or days * len(ids) > limits['budget']:
        raise ValueError('Day limit')
    if value['source'] not in SOURCES or value['reason'] not in REASONS - {'ACCESS_REVOCATION'}:
        raise ValueError('Gift source and predefined reason required')
    if type(value['notify']) is not bool or value['policy'] != APPEND_POLICY:
        raise ValueError('Explicit policy and notification choice required')
    comment = value['comment']
    if not isinstance(comment, str) or len(comment) > 280 or any(ord(c) < 32 for c in comment):
        raise ValueError('Comment limit')
    return {**value, 'customer_ids': sorted(ids), 'comment': comment.strip()}


def append_interval(now, intervals, days):
    start = max([now] + [end for _, end in intervals if end > now])
    return start, start + timedelta(seconds=days * 86400)


def access_state(now, intervals):
    valid = sorted((start, end) for start, end in intervals if end > start)
    active = [end for start, end in valid if start <= now < end]
    if active:
        until = max(active)
        for start, end in valid:
            if start <= until and end > until:
                until = end
        return 'ACTIVE', until
    if any(start > now for start, end in valid):
        return 'SCHEDULED', None
    return ('EXPIRED' if valid else 'NOT_PROVISIONED'), None


def parse_time(value):
    result = datetime.fromisoformat(value)
    if result.tzinfo is None:
        raise ValueError('Aware UTC time required')
    return result
