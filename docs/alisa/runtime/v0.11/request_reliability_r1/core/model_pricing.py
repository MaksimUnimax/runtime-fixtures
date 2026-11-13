"""Published tariff estimate with immutable dated FX and dispatch-time schedule."""
from datetime import datetime,timezone,date,timedelta
from decimal import Decimal
import time

MODELS={'deepseek-flash','deepseek-v4-flash','deepseek-v4.1-flash','DeepSeek-V4.1-Flash-1017'}
FX={'2026-11-06':'81.7947','2026-11-07':'82.1386','2026-11-10':'82.7536',
    '2026-11-11':'82.5486','2026-11-12':'82.6617','2026-11-13':'82.9803'}
HOLIDAYS=set()
for first,last in [('2026-01-01','2026-01-03'),('2026-02-15','2026-02-23'),('2026-04-04','2026-04-06'),
                   ('2026-05-01','2026-05-05'),('2026-06-19','2026-06-21'),('2026-09-25','2026-09-27'),('2026-10-01','2026-10-07')]:
    day=date.fromisoformat(first)
    while day<=date.fromisoformat(last):HOLIDAYS.add(day.isoformat());day+=timedelta(days=1)

def snapshot(model,at=None):
    if model not in MODELS:return None
    at=time.time()if at is None else at
    dt=datetime.fromtimestamp(at,timezone.utc);day=dt.date().isoformat()
    if dt.year!=2026 or at<datetime(2026,9,10,4,tzinfo=timezone.utc).timestamp():return None
    available=[key for key in FX if key<=day]
    if not available:return None
    fx_date=max(available);peak=dt.weekday()<5 and day not in HOLIDAYS and (1<=dt.hour<4 or 6<=dt.hour<10)
    rates=dict(zip(('input_cached','input_uncached','output'),('0.006','0.30','1.20')if peak else('0.003','0.15','0.60')))
    rates['rub_per_currency']=FX[fx_date]
    return {'id':'deepseek-flash-20261113-'+('peak'if peak else'offpeak')+'-fx-'+fx_date,
      'as_of':'2026-11-13','effective_from':'2026-09-10T04:00:00Z','currency':'USD',
      'dispatch_at':at,'period':'peak'if peak else'offpeak','fx_as_of':fx_date,
      'fx_age_days':(dt.date()-date.fromisoformat(fx_date)).days,
      'basis':'published_tariff_at_dispatch_with_dated_fx_estimate_not_invoice',
      'tariff_source':'https://api-docs.deepseek.com/quick_start/pricing/',
      'calendar_source':'https://www.beijing.gov.cn/zhengce/zhengcefagui/202511/t20251104_4258873.html',
      'fx_source':'https://www.cbr.ru/currency_base/daily/?UniDbQuery.Posted=True&UniDbQuery.To='+date.fromisoformat(fx_date).strftime('%d.%m.%Y'),
      'rates':rates}

def price(receipt,quote):
    from model_usage import price_attempt
    if quote is None or not receipt:return None
    served=receipt.get('model',receipt.get('requested_model'))
    if served not in MODELS:return None
    return price_attempt(receipt,**quote['rates'])
