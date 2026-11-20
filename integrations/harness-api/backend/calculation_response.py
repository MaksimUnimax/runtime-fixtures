"""Deterministic summaries of already validated template-handler results.

Call ``supplement`` only after the original provider renderer has accepted the
same fragment and data. Source decoding, pagination, currency validation and
formula evaluation stay in the installed Alisa handlers. This module adds the
few catalogue summaries formerly left to the final answer model; it never reads
raw API payloads, parses a user's question, fetches data, or calls a model.
"""
from collections import defaultdict
from decimal import Decimal, InvalidOperation, localcontext
import re


class CalculationError(ValueError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def need(condition, code='DIRECT_CALCULATION_SCHEMA'):
    if not condition:
        raise CalculationError(code)


def number(value, *, nonnegative=False, natural=False):
    # Canonical handler numbers are finite fixed-point strings, never floats.
    need(type(value) in (str, int, Decimal), 'DIRECT_CALCULATION_NUMBER')
    text = str(value)
    need(len(text) <= 160 and re.fullmatch(r'-?\d+(?:\.\d+)?', text) is not None,
         'DIRECT_CALCULATION_NUMBER')
    try:
        result = Decimal(text)
    except InvalidOperation:
        raise CalculationError('DIRECT_CALCULATION_NUMBER') from None
    need(result.is_finite(), 'DIRECT_CALCULATION_NUMBER')
    if nonnegative or natural:
        need(result >= 0, 'DIRECT_CALCULATION_NUMBER')
    if natural:
        need(result == result.to_integral_value(), 'DIRECT_CALCULATION_NUMBER')
    return result


def shown(value):
    value = format(value, 'f')
    if '.' in value:
        value = value.rstrip('0').rstrip('.')
    return ('0' if value in ('', '-0') else value).replace('.', ',')


def currency(value):
    need(type(value) is str and re.fullmatch(r'[A-Z]{3}', value) is not None,
         'DIRECT_CALCULATION_CURRENCY')
    return value


def rows(block, stages):
    data = block.get('datasets')
    need(type(data) is dict, 'DIRECT_CALCULATION_DATASET')
    result = []
    for stage in stages:
        values = data.get(stage)
        need(type(values) is list, 'DIRECT_CALCULATION_DATASET')
        need(all(type(row) is dict for row in values), 'DIRECT_CALCULATION_ROW')
        keys = [row.get('key') for row in values]
        need(all(type(key) is str and key for key in keys)
             and len(keys) == len(set(keys)), 'DIRECT_CALCULATION_DUPLICATE')
        result.extend(values)
    return result


def identity(row, field='product_id'):
    value = row.get(field)
    need(type(value) is str and re.fullmatch(r'[1-9]\d{0,30}', value) is not None,
         'DIRECT_CALCULATION_IDENTITY')
    return value


def product_count(block, _store, _contract):
    values = rows(block, ['rows'])
    products = [identity(row) for row in values]
    need(len(products) == len(set(products)), 'DIRECT_CALCULATION_DUPLICATE')
    return [f'Карточек товаров в полном доступном справочнике Ozon: {len(products)}. '
            'Справочник включает все доступные статусы; это не число активных карточек.']


def price_groups(block, _store, _contract):
    values = rows(block, ['rows'])
    products = [identity(row) for row in values]
    need(len(products) == len(set(products)), 'DIRECT_CALCULATION_DUPLICATE')
    if not values:
        return ['В полном снимке цен Ozon нет товаров. Цена не подменена нулём.']
    lines = []
    for field, label in [('price', 'Цена продавца Ozon'),
                         ('marketing_seller_price', 'Маркетинговая цена продавца Ozon')]:
        grouped = defaultdict(set)
        missing = 0
        for row in values:
            if row.get(field) is None:
                missing += 1
                continue
            key = (currency(row.get('currency')), number(row[field], nonnegative=True))
            grouped[key].add(identity(row))
        for (unit, amount), ids in sorted(grouped.items()):
            lines.append(f'{label} {shown(amount)} {unit}: товаров {len(ids)}.')
        if missing:
            lines.append(f'{label}: значение не указано у {missing} товаров; пропуски не заменены нулём.')
    return lines


def posting_counts(block, _store, contract):
    data = block.get('datasets')
    need(type(data) is dict, 'DIRECT_CALCULATION_DATASET')
    lines = []
    for stage, scheme in [('fbo', 'fbo'), ('rows', 'fbs')]:
        values = rows(block, [stage])
        need(all(row.get('scheme') == scheme for row in values),
             'DIRECT_CALCULATION_POSTING_SCHEME')
        # The source decoder already rejects repeated posting identities. Do not
        # silently deduplicate them here and declare an invalid page complete.
        postings = [row.get('posting_number') for row in values]
        need(all(type(item) is str and item for item in postings)
             and len(postings) == len(set(postings)), 'DIRECT_CALCULATION_DUPLICATE')
        label = contract['scheme_labels'][scheme]
        lines.append(f'Отправлений {label}: {len(postings)}.')
    return lines


def accrual_distinct(block, _store, _contract):
    values = rows(block, ['rows'])
    products = {identity(row) for row in values}
    return [f'Разных SKU с товарными начислениями за весь период: {len(products)}. '
            'Учтены реализации и обратные начисления; один SKU посчитан один раз за период.']


def accrual_extrema(block, _store, _contract):
    values = rows(block, ['rows'])
    grouped = defaultdict(list)
    for row in values:
        direction = row.get('direction')
        need(direction in ('реализация', 'обратное начисление'),
             'DIRECT_CALCULATION_DIRECTION')
        units = number(row.get('line_units'), natural=True)
        need(units > 0, 'DIRECT_CALCULATION_NUMBER')
        value = number(row.get('buyer_unit_average'), nonnegative=True)
        grouped[(direction, currency(row.get('currency')))].append((value, units))
    if not grouped:
        return ['В полной выборке нет товарных начислений; диапазон покупательских цен не определён.']
    lines = []
    for (direction, unit), entries in sorted(grouped.items()):
        amounts = [entry[0] for entry in entries]
        averages = any(entry[1] != 1 for entry in entries)
        label = 'средних покупательских цен товарных строк' if averages else 'покупательских цен товаров по строкам начислений'
        lines.append(f'Диапазон {label} ({direction}): '
                     f'от {shown(min(amounts))} до {shown(max(amounts))} {unit}.')
        if averages:
            lines.append('Есть строки с несколькими товарами: диапазон средних строк не доказывает '
                         'минимум и максимум цены каждой отдельной покупки.')
    if not any(direction == 'реализация' for direction, _ in grouped):
        lines.append('Положительных реализаций нет; диапазон цен новых покупок не рассчитан.')
    return lines


def expense_sum(block, store, contract, plan):
    need(contract.get('result') == 'sum_components'
         and set(contract.get('components', {})) == {
             'finance_commission_cost', 'finance_acquiring_cost'},
         'DIRECT_CALCULATION_CONTRACT')
    unit = currency(block.get('currency'))
    if store.get('currency') is not None:
        need(unit == store['currency'], 'DIRECT_CALCULATION_CURRENCY')
    lines = []
    for field, prefix in [('values', ''), ('previous_values', 'В периоде сравнения: ')]:
        if field == 'previous_values' and not plan.get('comparison'):
            continue
        source = block.get(field)
        need(type(source) is dict, 'DIRECT_CALCULATION_COMPONENT')
        parts = [number(source.get(key)) for key in contract['components']]
        with localcontext() as context:
            context.prec = 160
            total = sum(parts, Decimal(0))
        lines.append(f'{prefix}Комиссия и эквайринг вместе: {shown(total)} {unit}. '
                     'Возвраты и корректировки сохранены со своим знаком.')
    return lines


DATASET_SUMMARIES = {
    'alisa-product-registry-cardinality/v1': product_count,
    'alisa-offer-price-snapshot-calculation/v1': price_groups,
    'alisa-posting-metadata-cardinality/v1': posting_counts,
    'alisa-accrual-items-cardinality/v1': accrual_distinct,
    'alisa-accrual-price-lines/v1': accrual_extrema,
}


def supplement(fragment, completed, *, template_catalog=None):
    """Return supplementary pages for one successfully rendered core fragment.

    Scalar/formula source contracts are already implemented by the native
    matrix and compiled program evaluator. Payment joins and weighted averages
    are already implemented by ``dataset_pipeline.projected_rows``. Recomputing
    those from raw responses would duplicate authority and source semantics.
    """
    if template_catalog is None:
        from template_catalog import TEMPLATES as template_catalog
    plan = fragment['plan']
    if fragment['kind'] not in ('scalar', 'dataset'):
        return []
    need(type(completed) is list and len(completed) == len(plan['stores']),
         'DIRECT_CALCULATION_COVERAGE')
    for store, block in zip(plan['stores'], completed):
        need(type(block) is dict and block.get('complete') is True
             and block.get('store_id') == store['id'], 'DIRECT_CALCULATION_COVERAGE')
    pages, seen = [], set()
    for tid in fragment['template_ids']:
        template = template_catalog[tid]
        contract = template.get('calculation_contract') or {}
        schema = contract.get('schema')
        if not schema or schema in seen:
            continue
        seen.add(schema)
        for store, block in zip(plan['stores'], completed):
            # The catalogue states that these two cardinality/price mappings
            # are Ozon-only. The WB native report remains unchanged.
            if schema in ('alisa-product-registry-cardinality/v1',
                          'alisa-offer-price-snapshot-calculation/v1') \
                    and store['platform'] not in contract['by_platform']:
                continue
            if schema == 'alisa-ozon-expense-summary-calculation/v1':
                need(fragment['kind'] == 'scalar', 'DIRECT_CALCULATION_KIND')
                pages.extend(expense_sum(block, store, contract, plan))
            elif schema in DATASET_SUMMARIES:
                need(fragment['kind'] == 'dataset', 'DIRECT_CALCULATION_KIND')
                pages.extend(DATASET_SUMMARIES[schema](block, store, contract))
    return pages
