"""Request accounting from dispatched native ledger entries, never UI estimates."""
from decimal import Decimal, localcontext
import json


def count(value):
    return value if type(value) is int and 0 <= value < 2**53 else None


def tokens(receipt):
    usage = receipt.get('usage') if isinstance(receipt, dict) else {}
    usage = usage if isinstance(usage, dict) else {}
    prompt, output = count(usage.get('prompt_tokens')), count(usage.get('completion_tokens'))
    details = usage.get('prompt_tokens_details') or {}
    details = details if isinstance(details, dict) else {}
    contradiction = False
    hit = count(usage.get('prompt_cache_hit_tokens', details.get('cached_tokens')))
    miss = count(usage.get('prompt_cache_miss_tokens'))
    if ((('prompt_cache_hit_tokens' in usage or 'cached_tokens' in details) and hit is None)
            or ('prompt_cache_miss_tokens' in usage and miss is None)):
        contradiction = True
        hit = miss = None
    if ('prompt_cache_hit_tokens' in usage and 'cached_tokens' in details
            and usage['prompt_cache_hit_tokens'] != details['cached_tokens']):
        contradiction = True
        hit = miss = None
    if prompt is not None:
        if not contradiction and hit is not None and miss is None and hit <= prompt:
            miss = prompt - hit
        elif not contradiction and miss is not None and hit is None and miss <= prompt:
            hit = prompt - miss
        if hit is not None and miss is not None and hit + miss != prompt:
            contradiction = True
            hit = miss = None
    total = prompt + output if prompt is not None and output is not None else None
    if 'total_tokens' in usage and (count(usage['total_tokens']) is None or usage['total_tokens'] != total):
        contradiction = True
    if contradiction:
        total = None
    return {'prompt': prompt, 'completion': output, 'cache_hit': hit, 'cache_miss': miss,
            'total': total}


def object_value(raw):
    try:
        value = json.loads(raw) if isinstance(raw, str) else raw
        return value if isinstance(value, dict) else {}
    except (ValueError, TypeError):
        return {}


def measure(calls, request_id=None):
    from model_pricing import price
    models = [call for call in calls if call['source'].startswith('model:') and call['dispatched'] is not None]
    totals = {name: 0 for name in ('prompt', 'completion', 'cache_hit', 'cache_miss', 'total')}
    attempts, quotes, priced, known_rub = [], {}, 0, Decimal('0')
    for call in models:
        receipt = object_value(call['model_usage'])
        context = object_value(call['model_context'])
        usage = tokens(receipt)
        for name, value in usage.items():
            totals[name] = None if totals[name] is None or value is None else totals[name] + value
        quote = context.get('pricing_quote')
        try:
            estimated = price(receipt, quote) if isinstance(quote, dict) else None
        except (ValueError, TypeError, KeyError, ArithmeticError):
            estimated = None
        amount = estimated.get('rub') if estimated else None
        if amount is not None:
            with localcontext() as arithmetic:
                arithmetic.prec = 80
                known_rub += Decimal(amount)
            priced += 1
        if isinstance(quote, dict) and isinstance(quote.get('id'), str):
            allowed = {'id', 'as_of', 'fx_as_of', 'fx_age_days', 'period', 'currency', 'rates',
                       'tariff_source', 'fx_source', 'tariff_verified_on'}
            quotes[quote['id']] = {key: value for key, value in quote.items() if key in allowed}
        attempts.append({'stage': context.get('stage', 'unknown'),
            'model': receipt.get('model') or receipt.get('requested_model') or call['source'].removeprefix('model:'),
            'state': call['state'], 'prompt_tokens': usage['prompt'], 'completion_tokens': usage['completion'],
            'cache_hit_tokens': usage['cache_hit'], 'cache_miss_tokens': usage['cache_miss'],
            'rub': amount, 'quote_id': quote.get('id') if isinstance(quote, dict) else None})
    complete = priced == len(models)
    return {'schema': 'octoport-request-meter/v1', 'request_id': request_id,
        'calls': {'model': len(models), 'selector': sum(item['stage'] == 'template_select' for item in attempts),
                  'final': sum(item['stage'] in ('model_answer', 'model_answer_program') for item in attempts)},
        'tokens': totals,
        'rub': {'estimated': str(known_rub) if complete else None, 'known': str(known_rub), 'complete': complete,
                'currency': 'RUB', 'basis': 'published_tariff_at_dispatch_with_dated_fx_estimate_not_invoice',
                'priced_attempts': priced, 'unpriced_attempts': len(models) - priced},
        'quotes': list(quotes.values()), 'attempts': attempts}
