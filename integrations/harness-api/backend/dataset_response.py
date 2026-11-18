"""Chat tables over the installed, qualified Alisa dataset handlers.

The source catalogue, plan pin checks, joins and aggregate arithmetic are reused
unchanged. Only the voice channel's line/page limits are replaced by chat rows.
No source request, model call, or source-value interpretation happens here.
"""
from copy import deepcopy
import re


def cell(value):
    # Table structure stays ours; user/provider text never becomes Markdown
    # syntax or HTML. The browser also renders table cells as text nodes.
    return str(value).replace('\\', '\\\\').replace('|', '¦').replace('\r', ' ').replace('\n', ' ')


def render(plan, completed, stamp, *, full_report_url=None):
    from dataset_pipeline import CATALOG, valid, projected_rows, fail
    from dataset_relations import apply_relations
    from matrix_core import MatrixError, money
    from semantics import canonical_json
    from providers import displayed

    if not valid(plan) or type(completed) is not list or len(completed) != len(plan['stores']):
        fail('DATASET_INCOMPLETE')
    if len(canonical_json(completed).encode()) > CATALOG['max_bytes']:
        fail('DATASET_CAPACITY')
    if full_report_url is not None and (type(full_report_url) is not str
            or re.fullmatch(r'(?:https://alisa\.octoport\.ru)?/harness/api/reports/[A-Za-z0-9_/-]+',
                            full_report_url) is None):
        fail('DIRECT_REPORT_URL')

    query = CATALOG['queries'][plan['dataset']['id']]
    pages = ['Текущий снимок.' if query['snapshot'] else
             'Период ' + plan['period']['from'] + ' — ' + plan['period']['to'] + '.']
    join_coverage, row_counts, reports = [], [], []

    # Complete validation and projection for EVERY store precedes formatting.
    # A later invalid store cannot leave a partially published first store.
    for store, block in zip(plan['stores'], completed):
        if type(block) is not dict or block.get('store_id') != store['id'] or block.get('complete') is not True:
            fail('DATASET_INCOMPLETE')
        stages = {stage['id'] for stage in query['flows'][store['platform']]}
        data = block.get('datasets')
        if type(data) is not dict or set(data) != stages:
            fail('DATASET_STAGE_COVERAGE')
        for values in data.values():
            if type(values) is not list or len(values) > CATALOG['max_rows']:
                fail('DATASET_CAPACITY')
            if any(type(row) is not dict for row in values):
                fail('DATASET_ROW_ID')
            keys = [row.get('key') for row in values]
            if any(type(key) is not str or not key for key in keys) or len(set(keys)) != len(keys):
                fail('DATASET_ROW_ID')
        try:
            prepared, coverage = apply_relations(query, data,
                max_rows=CATALOG['max_rows'], max_bytes=CATALOG['max_bytes'])
            output = projected_rows(query, prepared, relations_applied=True)
        except MatrixError as error:
            fail(error.code)
        formatted = []
        for row in output:
            values = []
            for column in query['columns']:
                value = row.get(column['field'])
                if value is None:
                    values.append('неизвестно')
                    continue
                if column['kind'] in ('money', 'number'):
                    value = money(value)
                    if value < 0:
                        fail('DATASET_NEGATIVE_UNDECLARED')
                    value = displayed(value)
                elif not isinstance(value, str):
                    fail('DATASET_TEXT_TYPE')
                values.append(cell(value))
            formatted.append(values)
        reports.append((store, output, formatted, coverage))

    for store, output, formatted, coverage in reports:
        lines = []
        if coverage:
            join_coverage.append({'store_id': store['id'], 'relations': deepcopy(coverage)})
            for proof in coverage:
                lines.append('Покрытие «' + proof['label'] + '»: целевых строк '
                    + str(proof['target_rows']) + ', с известным значением '
                    + str(proof['matched_rows']) + ', с неизвестным значением '
                    + str(proof['unknown_value_rows']) + ', без соответствия '
                    + str(proof['unmatched_rows']) + '.')
                if proof['excluded_rows']:
                    lines.append('За пределами явно выбранного типа строк: '
                        + str(proof['excluded_rows']) + '. Они не включены в суммы этого отчёта.')
        count = len(output)
        limit = min(100, count) if full_report_url is not None else count
        row_counts.append({'store_id': store['id'], 'total': count, 'shown': limit})
        lines.append(store['platform'] + ': в полной выборке строк ' + str(count) + '.')
        if not count:
            lines.append('В полной выборке нет строк. Отсутствие статистики не заменено денежным нулём.')
        else:
            lines.append('| ' + ' | '.join(cell(column['label']) for column in query['columns']) + ' |')
            lines.append('| ' + ' | '.join('---' for _ in query['columns']) + ' |')
            lines.extend('| ' + ' | '.join(values) + ' |' for values in formatted[:limit])
        if limit < count:
            lines.append(f'В чате показано {limit} из {count} строк; все строки доступны в полном отчёте: '
                         f'[Скачать полный отчёт]({full_report_url}).')
        pages.append('\n'.join(lines))
    pages.extend(query['notes'])
    pages.append('Получено ' + stamp + '.')
    result = {'complete': True, 'pages': pages, 'data': completed, 'fetched_at': stamp,
              'row_counts': row_counts, 'details_omitted': any(r['shown'] < r['total'] for r in row_counts)}
    if full_report_url is not None:
        result['full_report_url'] = full_report_url
    if join_coverage:
        result['join_coverage'] = join_coverage
        result['enrichment_complete'] = all(proof['enrichment_complete']
            for block in join_coverage for proof in block['relations'])
    return result
