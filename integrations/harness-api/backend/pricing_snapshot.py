"""Process-local dated FX updates for future native dispatch receipts only."""
from copy import deepcopy
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
import json


def install(path=None):
    """Freeze one validated configuration for this gateway process lifetime.

    The installed Alisa files/settings are untouched. Existing receipt quotes
    remain immutable and are priced with their own recorded rates.
    """
    import model_pricing
    config = json.loads(Path(path or Path(__file__).with_name('pricing.json')).read_text())
    if set(config) != {'schema', 'verified_on', 'fx', 'tariff_source'} or config['schema'] != 'octoport-pricing-snapshot/v1':
        raise ValueError('PRICING_CONFIGURATION')
    verified = date.fromisoformat(config['verified_on']).isoformat()
    if config['tariff_source'] != 'https://api-docs.deepseek.com/quick_start/pricing/':
        raise ValueError('PRICING_CONFIGURATION')
    fixes = {}
    for day, value in config['fx'].items():
        canonical = date.fromisoformat(day).isoformat()
        if not isinstance(value, str) or not Decimal(value).is_finite() or not Decimal('0') < Decimal(value) < Decimal('10000'):
            raise ValueError('PRICING_CONFIGURATION')
        fixes[canonical] = value
    original = getattr(model_pricing.snapshot, '_octoport_original', model_pricing.snapshot)
    def snapshot(model, at=None):
        quote = original(model, at)
        if quote is None:
            return None
        day = datetime.fromtimestamp(quote['dispatch_at'], timezone.utc).date().isoformat()
        available = [key for key in fixes if quote['fx_as_of'] < key <= day]
        if not available:
            return quote
        fx_day = max(available)
        value = deepcopy(quote)
        value['id'] = 'octoport-' + quote['id'].split('-fx-')[0] + '-fx-' + fx_day
        value['rates']['rub_per_currency'] = fixes[fx_day]
        value['fx_as_of'] = fx_day
        value['fx_age_days'] = (date.fromisoformat(day) - date.fromisoformat(fx_day)).days
        value['fx_source'] = 'https://www.cbr.ru/currency_base/daily/?UniDbQuery.Posted=True&UniDbQuery.To=' + date.fromisoformat(fx_day).strftime('%d.%m.%Y')
        value['tariff_verified_on'] = verified
        return value
    snapshot._octoport_original = original
    model_pricing.snapshot = snapshot
    return config
