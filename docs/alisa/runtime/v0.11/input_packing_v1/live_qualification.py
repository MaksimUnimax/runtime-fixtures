"""Two authorized DeepSeek qualification calls on synthetic data; no station IO."""
import json
import time
from pathlib import Path
from http_transport import HTTPTransport
from providers import Request
from model_answer import messages
from model_input_encoding import V1_INSTRUCTION

ROOT = Path('/dev/shm/alisa-input-packing-v1-20261110')
rows = []
def add(platform, date, kind, count, amount, units):
    for _ in range(count):
        rows.append({'platform': platform, 'event_date': date, 'operation_kind': kind,
                     'amount_rub': amount, 'quantity_units': units, 'sku': '00017',
                     'details': {'warehouse_address': 'Контрольный склад, улица Проверочная, дом семнадцать',
                                 'description': 'Синтетический товар для проверки сохранения всех полей. ' * 3,
                                 'optional': None, 'active': True}})
add('WB', '2026-11-08', 'sale', 10, 100, 2)
add('WB', '2026-11-08', 'return', 2, -40, -1)
add('WB', '2026-11-09', 'sale', 4, 900, 9)
add('Ozon', '2026-11-08', 'sale', 8, 50, 1)
add('Ozon', '2026-11-08', 'return', 1, -25, -1)
rows.append(dict(rows[0]))  # Equal records are distinct occurrences.
data = {'records': rows, 'notes': 'Каждая запись — отдельное событие, даже если все её поля совпадают.'}
question = ('За восьмое ноября 2026 отдельно для WB и Ozon укажи число записей продаж, '
            'количество проданных единиц и сумму продаж. Возвраты покажи отдельно: число записей, '
            'количество возвращённых единиц и сумму возвратов положительными величинами. '
            'Не вычитай возвраты из продаж. Используй цифры, ответь кратко.')
transport = HTTPTransport('/run/credentials/alice-market.service', {}, {}, enabled=True)
report = {'scope': 'SYNTHETIC_DATA_REAL_DEEPSEEK_NO_STATION', 'expected': {
    'WB': {'sales_records': 11, 'sales_units': 22, 'sales_amount': 1100,
           'return_records': 2, 'return_units': 2, 'return_amount': 80},
    'Ozon': {'sales_records': 8, 'sales_units': 8, 'sales_amount': 400,
             'return_records': 1, 'return_units': 1, 'return_amount': 25}}, 'calls': []}
for version in (0, 1):
    body = {'messages': messages(question, data, input_encoding=version)}
    text = body['messages'][-1]['content']
    if version == 1:assert V1_INSTRUCTION in text, 'PACKING_NOT_EXERCISED'
    call = {'input_encoding': version, 'data_message_chars': len(text), 'dispatched': False}
    report['calls'].append(call)
    started = time.monotonic()
    def dispatched():
        call['dispatched'] = True
        (ROOT/'live_results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    try:
        response, meta = transport.execute_observed(Request('model_answer', transport.model_source, '', body, 0, None), None, dispatched)
        call.update(response=response['content'], usage=meta.get('model_usage'), elapsed_seconds=round(time.monotonic()-started, 2))
    except Exception as error:
        call.update(error_type=type(error).__name__, code=getattr(error, 'code', 'UNKNOWN'))
        (ROOT/'live_results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
        raise
    (ROOT/'live_results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps(call, ensure_ascii=False), flush=True)
