"""Offline pricing from provider receipts. Never infer missing usage as zero."""
from datetime import datetime
from decimal import Decimal

RATES = {'off_peak': (Decimal('.15'), Decimal('.003'), Decimal('.6')),
         'peak': (Decimal('.3'), Decimal('.006'), Decimal('1.2'))}
FX = {'2026-11-10': Decimal('82.7536'), '2026-11-11': Decimal('82.5486')}

def band(stamp):
    time = datetime.fromisoformat(stamp)
    if time.utcoffset().total_seconds() != 0 or time.date().isoformat() not in FX:
        raise ValueError('Only verified UTC research dates are supported; supply a dated tariff for other dates')
    return 'peak' if 1 <= time.hour < 4 or 6 <= time.hour < 10 else 'off_peak'

def tokens(receipt, path):
    if not isinstance(receipt, dict) or receipt.get('model') != 'deepseek-flash': return None
    u = receipt.get('usage')
    if not isinstance(u,dict): return None
    if path.endswith('chat/completions'):
        total, out = u.get('prompt_tokens'), u.get('completion_tokens')
        hit, miss = u.get('prompt_cache_hit_tokens'), u.get('prompt_cache_miss_tokens')
        if any(type(x) is not int or x < 0 for x in (total,out,hit,miss)): return None
        if hit+miss!=total or ('total_tokens' in u and (type(u['total_tokens']) is not int or u['total_tokens']!=total+out)): return None
        details, output_details = u.get('prompt_tokens_details',{}), u.get('completion_tokens_details',{})
        if not isinstance(details,dict) or not isinstance(output_details,dict): return None
        alt = details.get('cached_tokens')
        if alt is not None and (type(alt) is not int or alt!=hit): return None
        reason = output_details.get('reasoning_tokens')
        if reason is not None and (type(reason) is not int or not 0<=reason<=out): return None
    elif path.endswith('messages'):
        miss,hit,out,created = (u.get(k) for k in ('input_tokens','cache_read_input_tokens','output_tokens','cache_creation_input_tokens'))
        if any(type(x) is not int or x < 0 for x in (miss,hit,out,created)) or created!=0:return None
    else:return None
    return {'miss':miss,'hit':hit,'out':out,'input':miss+hit}

def usd(t, rates, no_cache=False):
    miss,hit,out = rates
    return ((t['input']*miss if no_cache else t['miss']*miss+t['hit']*hit)+t['out']*out)/Decimal(1000000)

def quote(attempt):
    if not attempt.get('dispatched_utc'):return {'sent_attempt':False,'cost':None}
    t = tokens(attempt.get('receipt'), attempt['path'])
    if t is None:return {'sent_attempt':True,'cost':None,'reason':'unknown_or_inconsistent_usage'}
    start = attempt['dispatched_utc']; tariff = band(start)
    end = attempt.get('received_utc')
    crossing = None if end is None else band(end)!=tariff
    value = usd(t,RATES[tariff]); fx=FX[start[:10]]
    return {'sent_attempt':True,'tokens':t,'cost':str(value),'rub':str(value*fx),'band':tariff,
            'boundary_ambiguous':crossing,'normalized_usd':str(usd(t,RATES['off_peak'])),
            'normalized_no_cache_usd':str(usd(t,RATES['off_peak'],True))}
