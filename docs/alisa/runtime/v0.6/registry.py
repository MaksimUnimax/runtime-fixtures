"""Strict external matrix loader. File changes invalidate canonical report identities."""
import hashlib
import json
from pathlib import Path

ALLOWED = {
    'ozon':('ozon_orders','https://api-seller.ozon.ru/v1/analytics/data',61,50),
    'wb':('wb_orders','https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/products',21,48),
}

def load_registry(path):
    def pairs(items):
        value={}
        for key,item in items:
            if key in value:raise ValueError('duplicate registry key')
            value[key]=item
        return value
    r=json.loads(Path(path).read_text(encoding='utf-8'),object_pairs_hook=pairs)
    if (not isinstance(r,dict) or not isinstance(r.get('version'),str)
        or set(r.get('metric_definitions',{}))!={'ordered_units','ordered_revenue'}
        or set(r.get('recipes',{}))!=set(ALLOWED)
        or r.get('cache_policy')!='exact_ready_complete_authorized_nonexpired_only'
        or r.get('default_timezone')!='Europe/Moscow'):
        raise ValueError('registry schema')
    for platform,(operation,url,interval,limit) in ALLOWED.items():
        recipe=r['recipes'][platform]
        if (recipe.get('operation')!=operation or recipe.get('url')!=url or recipe.get('method')!='POST'
            or type(recipe.get('min_interval')) is not int or recipe['min_interval']<interval
            or type(recipe.get('daily_limit')) is not int or not 1<=recipe['daily_limit']<=limit):
            raise ValueError('unreviewed recipe or unsafe rate')
    encoded=json.dumps(r,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
    return r,hashlib.sha256(encoded).hexdigest()

REGISTRY, REGISTRY_HASH = load_registry(Path(__file__).with_name('registry.json'))
