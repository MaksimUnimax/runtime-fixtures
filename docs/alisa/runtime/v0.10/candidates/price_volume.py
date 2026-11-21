"""Network-free accrual price/volume qualification and deterministic rollup.

Candidate for a shared source adapter; not installed in the Alice runtime.
sale_price is a LINE amount in the qualified source, seller_price is per unit.
"""
from __future__ import annotations
from collections import Counter, defaultdict
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import hashlib
import math
import statistics


class SourceError(ValueError):
    pass


def money(value):
    if not isinstance(value, dict) or value.get('currency') != 'RUB':
        raise SourceError('MONEY_CURRENCY')
    raw = value.get('amount')
    if not isinstance(raw, str):
        raise SourceError('MONEY_TYPE')
    try:
        result = Decimal(raw)
    except InvalidOperation:
        raise SourceError('MONEY_FORMAT') from None
    if not result.is_finite() or abs(result) > Decimal('1e15'):
        raise SourceError('MONEY_RANGE')
    return result


def decode_page(data, day, seen):
    if (not isinstance(data, dict) or not isinstance(data.get('accruals'), list)
            or not isinstance(data.get('last_id'), str)):
        raise SourceError('PAGE_SCHEMA')
    result = []
    controls = Counter()
    for entry in data['accruals']:
        if entry.get('date') != day:
            raise SourceError('DATE_AXIS')
        identity = entry.get('accrual_id')
        if type(identity) is not int or identity <= 0:
            raise SourceError('ACCRUAL_ID')
        if identity in seen:
            raise SourceError('DUPLICATE_ACCRUAL')
        seen.add(identity)
        controls['records'] += 1
        posting = entry.get('posting')
        if posting is None:
            continue
        products = posting.get('products')
        if not isinstance(products, list):
            raise SourceError('PRODUCTS_SCHEMA')
        posting_total = Decimal(0)
        for index, product in enumerate(products):
            delivery = product.get('delivery')
            if delivery is not None:
                posting_total += money(delivery['total_accrued'])
                if sum((money(x['accrued']) for x in delivery['services']), Decimal(0)) != money(delivery['total_accrued']):
                    raise SourceError('DELIVERY_COMPONENTS')
            commission = product.get('commission')
            if commission is None:
                continue
            quantity, sku = product.get('quantity'), product.get('sku')
            if type(quantity) is not int or not 1 <= quantity <= 10000:
                raise SourceError('QUANTITY_OR_RETURN_NOT_QUALIFIED')
            if type(sku) is not int or sku <= 0:
                raise SourceError('SKU_SCHEMA')
            fields = {key: money(commission[key]) for key in
                      ('seller_price', 'sale_price', 'sale_amount', 'bonus', 'coinvestment', 'sale_commission')}
            if fields['sale_price'] < 0 or fields['seller_price'] < 0:
                raise SourceError('RETURN_NOT_QUALIFIED')
            if fields['seller_price'] * quantity != fields['sale_amount']:
                raise SourceError('SELLER_UNIT_RECONCILIATION')
            if fields['sale_price'] + fields['bonus'] + fields['coinvestment'] != fields['sale_amount']:
                raise SourceError('PRICE_LINE_RECONCILIATION')
            posting_total += (fields['sale_price'] + fields['bonus']
                              + fields['coinvestment'] + fields['sale_commission'])
            controls['sale_rows'] += 1
            controls['multi_unit_rows'] += quantity > 1
            controls['opaque_ratio_rows'] += str(commission.get('commission_ratio', '')).startswith('value:')
            result.append({'date': day, 'sku': str(sku), 'quantity': quantity, 'currency': 'RUB',
                           **{key: str(value) for key, value in fields.items()}})
        if products:
            controls['posting_rows'] += 1
            if posting_total != money(entry['total_amount']):
                raise SourceError('POSTING_RECONCILIATION')
    return result, controls


def pearson(x, y):
    if len(x) != len(y) or len(x) < 3:
        return None
    x, y = list(map(float, x)), list(map(float, y))
    mx, my = statistics.mean(x), statistics.mean(y)
    vx, vy = sum((v-mx)**2 for v in x), sum((v-my)**2 for v in y)
    return sum((a-mx)*(b-my) for a,b in zip(x,y))/math.sqrt(vx*vy) if vx and vy else None


def detrend(values, time):
    mv, mt = statistics.mean(values), statistics.mean(time)
    slope = sum((t-mt)*(v-mv) for t,v in zip(time,values))/sum((t-mt)**2 for t in time)
    return [v-mv-slope*(t-mt) for t,v in zip(time,values)]


def summarize(rows, days):
    by_day = defaultdict(lambda: [0, Decimal(0)])
    by_sku_day = defaultdict(lambda: [0, Decimal(0)])
    for row in rows:
        for target, key in ((by_day, row['date']), (by_sku_day, (row['sku'], row['date']))):
            target[key][0] += row['quantity']
            target[key][1] += Decimal(row['sale_price'])
    def record(day, units, amount, sku=None):
        mean = amount/units if units else None
        return {'date': day, 'quantity': units, 'buyer_amount': str(amount),
                'mean_price': str(mean) if mean is not None else None,
                'mean_price_rounded': str(mean.quantize(Decimal('.01'), rounding=ROUND_HALF_UP)) if mean is not None else None,
                **({'sku': sku} if sku else {})}
    daily = [record(day, *by_day[day]) for day in days]
    skus = sorted({row['sku'] for row in rows})
    sku_daily = [record(day, *by_sku_day[(sku,day)], sku) for sku in skus for day in days]
    sku_stats = []
    within_x, within_y = [], []
    for sku in skus:
        values = [x for x in sku_daily if x['sku']==sku and x['quantity']]
        x = [float(v['mean_price']) for v in values]; y = [v['quantity'] for v in values]
        within_x.extend(v-statistics.mean(x) for v in x)
        within_y.extend(v-statistics.mean(y) for v in y)
        amount = sum((Decimal(v['buyer_amount']) for v in values),Decimal(0))
        units = sum(y)
        sku_stats.append({'sku': sku, 'units': units, 'buyer_amount': str(amount),
                          'mean_price': str(amount/units), 'active_days': len(values),
                          'pearson_active_days': pearson(x,y)})
    active = [v for v in daily if v['quantity']]
    x, y = [float(v['mean_price']) for v in active], [v['quantity'] for v in active]
    ordinal = [(date.fromisoformat(v['date'])-date.fromisoformat(days[0])).days for v in active]
    amount = sum((Decimal(v['buyer_amount']) for v in daily),Decimal(0))
    units = sum(v['quantity'] for v in daily)
    return {'rows': rows, 'daily': daily, 'sku_daily': sku_daily,
            'sku_stats': sorted(sku_stats,key=lambda x:(-x['units'],x['sku'])),
            'totals': {'quantity': units, 'buyer_amount': str(amount), 'mean_price': str(amount/units) if units else None, 'distinct_skus': len(skus)},
            'relationship': {'observations': len(active), 'pearson_daily': pearson(x,y),
                             'pearson_price_vs_calendar_day': pearson(x,ordinal),
                             'pearson_volume_vs_calendar_day': pearson(y,ordinal),
                             'pearson_after_linear_date_detrending': pearson(detrend(x,ordinal),detrend(y,ordinal)) if len(x)>=3 else None,
                             'pearson_within_sku_active_days': pearson(within_x,within_y)}}


def build_report(manifest, load_bytes):
    import json
    if manifest.get('state') != 'ACQUIRED':
        raise SourceError('INCOMPLETE_ACQUISITION')
    if manifest.get('endpoint') != 'https://api-seller.ozon.ru/v1/finance/accrual/by-day':
        raise SourceError('SOURCE_OPERATION')
    if any(x.get('state')!='RECEIVED' or x.get('http')!=200 for x in manifest.get('requests',[])):
        raise SourceError('HTTP_NOT_COMPLETE')
    first, last = map(date.fromisoformat,(manifest['from'],manifest['to']))
    if first > last or (last-first).days >= 366:
        raise SourceError('PERIOD_RANGE')
    days = [(first+timedelta(days=n)).isoformat() for n in range((last-first).days+1)]
    if sorted(manifest['days']) != days:
        raise SourceError('DAY_COVERAGE')
    rows, controls = [], Counter()
    for day in days:
        info = manifest['days'][day]
        if not info['complete'] or not info['pages']:
            raise SourceError('PAGE_COVERAGE')
        seen, last_id = set(), None
        for i, page in enumerate(info['pages']):
            raw = load_bytes(page['path'])
            if hashlib.sha256(raw).hexdigest() != page['sha256']:
                raise SourceError('SOURCE_HASH_CHANGED')
            data = json.loads(raw)
            if i and not last_id:
                raise SourceError('EXTRA_PAGE_AFTER_END')
            if len(data['accruals']) != page['records']:
                raise SourceError('ROW_COUNT_CHANGED')
            decoded, c = decode_page(data,day,seen)
            rows.extend(decoded); controls.update(c); last_id = data['last_id']
        if last_id:
            raise SourceError('CURSOR_NOT_EXHAUSTED')
    result = summarize(rows, days)
    result.update(schema='ozon-daily-price-volume/v1', period={'from':manifest['from'],'to':manifest['to']},
                  time_axis='accrual_date', source='POST /v1/finance/accrual/by-day', currency='RUB',
                  controls=dict(controls), manifest=manifest,
                  calculation_owner='deterministic Decimal code; no LLM arithmetic',
                  runtime_template_installed=False,
                  limitations=['Not order-date or verified buyer-receipt-date demand.',
                               'Realized price observed only on days with recorded sales.',
                               'Correlations are descriptive; assortment, time and advertising are not controlled.',
                               'No negative realization rows observed; returns not implemented in this candidate.'])
    return result
