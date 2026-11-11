"""Synthetic matched documents. Oracles stay outside all worker mounts."""
from decimal import Decimal
import json
from pathlib import Path
import random
import sys

DAY = '2026-11-08'

def rows(n, seed):
    rng = random.Random(seed)
    words = ['доставка', 'передача', 'проверка', 'маршрут', 'посылка', 'упаковка',
             'обработка', 'склад', 'приёмка', 'возврат', 'поставка', 'перевозка']
    return [{'id': str(i + 1), 'date': DAY if i % 5 else '2026-11-07',
             'service': 'storage' if i % 7 == 0 else 'logistics',
             'amount': str(Decimal(rng.randint(-500, 10000)) / 100),
             'description': ' '.join(rng.choices(words, k=12))} for i in range(n)]

def sum_case(n, seed=811):
    data = {'currency': 'RUB', 'rows': rows(n, seed)}
    total = sum((Decimal(r['amount']) for r in data['rows']
                 if r['date'] == DAY and r['service'] == 'logistics'), Decimal(0))
    return {'name': f'sum_{n}_{seed}', 'kind': 'arithmetic', 'data': data,
            'question': 'Сколько составили расходы на логистику за восьмое ноября?',
            'notes': 'Суммируй amount строк service=logistics за выбранный день. Отрицательные суммы сохраняй. Считай деньги точно, округляй только итог до копеек.',
            'expected': {'amount': str(total.quantize(Decimal('.01'))), 'currency': 'RUB'}}

def compound_case(n):
    r = rows(n, 1337)
    data = {'currency': 'RUB', 'orders': [{'date': x['date'], 'revenue': x['amount'],
              'description': x['description']} for x in r],
            'ads': [{'date': DAY, 'spend': '85.25'}, {'date': DAY, 'spend': '114.75'},
                    {'date': '2026-11-07', 'spend': '9999.99'}]}
    rev = sum((Decimal(x['revenue']) for x in data['orders'] if x['date'] == DAY), Decimal(0))
    return {'name': f'compound_{n}', 'kind': 'arithmetic', 'data': data,
            'question': 'Назови оборот заказов, расходы на рекламу и ДРР за восьмое ноября.',
            'notes': 'За выбранный день: оборот=sum(orders.revenue); реклама=sum(ads.spend); ДРР=100*реклама/оборот. При нулевом обороте ДРР не определён. Деньги до копеек, ДРР до двух знаков после запятой. Назови все три показателя.',
            'expected': {'revenue': str(rev.quantize(Decimal('.01'))), 'spend': '200.00',
                         'drr': str((Decimal(20000)/rev).quantize(Decimal('.01')))}}

def semantic_case(n):
    texts = [
      'Посылка пришла позже обещанного срока, упаковка целая.',
      'Коробка порвана при перевозке, сам товар работает.',
      'Товар доставлен вовремя, но не включается.',
      'Курьер приехал поздно, а внутри оказалась треснувшая деталь.',
      'Покупатель доволен сроком и качеством товара.',
      'Отменил покупку до отправки: передумал.']
    return {'name': f'text_{n}', 'kind': 'semantic',
            'question': 'Какие причины недовольства покупатели описали в отзывах? Кратко перечисли разные причины без подсчёта.',
            'notes': 'Перескажи смысл всех отзывов. Не считай отмену из-за смены решения жалобой на доставку или качество.',
            'data': {'reviews': [{'id': i+1, 'text': texts[i % len(texts)]} for i in range(n)]},
            'expected': {'reasons': ['задержка доставки', 'повреждённая упаковка', 'неисправный или повреждённый товар'],
                         'exclude': ['смена решения покупателя']}}

def manifest():
    lookup = sum_case(200)
    lookup.update(name='lookup_200', kind='lookup',
       question='Какая сумма логистики указана в итогах за восьмое ноября?',
       notes='Ответ возьми из totals.logistics за выбранную дату; строки — детализация, повторно суммировать их не нужно.')
    lookup['data']['totals'] = {'date': DAY, 'logistics': lookup['expected']['amount']}
    tiny = {'name':'ready_total', 'kind':'lookup',
       'question': lookup['question'], 'notes':lookup['notes'],
       'data': {'currency':'RUB','totals':{'date':DAY,'logistics':'140.37'}},
       'expected':{'amount':'140.37','currency':'RUB'}}
    return {'campaign':'boundary_20261111_r1','period':DAY,
            'cases':[tiny, sum_case(10), sum_case(50), sum_case(200), sum_case(800),
                     lookup, compound_case(50), compound_case(200), semantic_case(12), semantic_case(100)]}

def continuation_manifest():
    base = manifest()
    cases = base['cases'][4:]
    # The paid direct 800-row attempt remains in R1. Never replay it here.
    cases[0]['methods'] = ['harness']
    case = cases[-1]
    case['name'] = 'text_100_rare'
    case['data']['reviews'][-1]['text'] = 'Товар работает и пришёл вовремя, но продавец прислал другой цвет вместо заказанного.'
    case['expected']['reasons'].append('несоответствие заказанному цвету')
    return {'campaign':'boundary_20261111_r2','period':DAY,'cases':cases}

def boundary_manifest():
    return {'campaign':'boundary_20261111_r3','period':DAY,
            'cases':[sum_case(20,1938),sum_case(30,1938)]}

if __name__ == '__main__':
    Path(sys.argv[1]).write_text(json.dumps(manifest(), ensure_ascii=False, separators=(',', ':')))
