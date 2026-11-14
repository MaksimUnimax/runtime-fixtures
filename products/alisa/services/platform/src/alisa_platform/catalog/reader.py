"""Strict projection of native metadata, with the usual pinned runtime identity."""
from copy import deepcopy
import re
from alisa_platform.runtime_adapter.job_client import VERSION_FIELDS, exact, need, text

SCHEMA = 'alisa-question-catalog/v1'


def validate(value, versions, scoped):
    exact(value, {'schema', 'versions', 'template_hash', 'items'} |
          ({'template_ids', 'total', 'page_offset', 'next_offset'} if scoped else set()))
    need(value['schema'] == SCHEMA and value['versions'] == versions, 'CATALOG_INCOMPATIBLE')
    need(type(value['template_hash']) is str and re.fullmatch('[a-f0-9]{64}', value['template_hash']), 'CATALOG_INCOMPATIBLE')
    exact(value['versions'], VERSION_FIELDS)
    rows = value['items']; need(type(rows) is list and len(rows) <= (10 if scoped else 1000), 'CATALOG_INCOMPATIBLE')
    if scoped:
        need(type(value['template_ids']) is list and len(value['template_ids']) <= 1000, 'CATALOG_INCOMPATIBLE')
        for key in value['template_ids']: text(key, 128)
        need(type(value['total']) is int and 0 <= value['total'] <= 1000 and
             type(value['page_offset']) is int and 0 <= value['page_offset'] <= 1000 and
             (value['next_offset'] is None or type(value['next_offset']) is int and
              value['next_offset'] == value['page_offset'] + 10 < value['total']), 'CATALOG_INCOMPATIBLE')
    seen = set()
    for row in rows:
        fields = {'id', 'version', 'kind', 'description', 'platforms', 'input_policy', 'units', 'dependencies'}
        fields |= {'availability'} if scoped else {'metrics', 'sources'}
        need(type(row) is dict and set(row) in (fields, fields | {'columns'}), 'CATALOG_INCOMPATIBLE')
        text(row['id'], 128); need(row['id'] not in seen, 'CATALOG_INCOMPATIBLE'); seen.add(row['id'])
        need(type(row['version']) is int and row['version'] > 0, 'CATALOG_INCOMPATIBLE')
        need(row['kind'] in {'scalar', 'compound', 'dataset', 'formula', 'event', 'information'}, 'CATALOG_INCOMPATIBLE')
        text(row['description'], 12000, multiline=True)
        for key in ('platforms', 'units', 'dependencies'):
            need(type(row[key]) is list and len(row[key]) <= 1000, 'CATALOG_INCOMPATIBLE')
            for item in row[key]: text(item, 256)
        need(set(row['platforms']) <= {'ozon', 'wb'}, 'CATALOG_INCOMPATIBLE')
        policy = row['input_policy']
        need(type(policy) is dict and set(policy) == {'time_axis', 'snapshot', 'period_required', 'comparison_supported', 'filters_supported'}, 'CATALOG_INCOMPATIBLE')
        text(policy['time_axis'], 128)
        need(all(type(policy[k]) is bool for k in policy if k != 'time_axis'), 'CATALOG_INCOMPATIBLE')
        if scoped:
            need(type(row['availability']) is list and len(row['availability']) <= 1000, 'CATALOG_INCOMPATIBLE')
            for item in row['availability']:
                exact(item, {'store_id', 'status'}); text(item['store_id'], 128)
                need(item['status'] in {'ELIGIBLE', 'UNAVAILABLE'}, 'CATALOG_INCOMPATIBLE')
        else:
            need(type(row['metrics']) is list and type(row['sources']) is list, 'CATALOG_INCOMPATIBLE')
            for metric in row['metrics']: text(metric, 128)
            for source in row['sources']:
                need(type(source) is dict and set(source) <= {'platform', 'operation', 'source', 'recipe'}, 'CATALOG_INCOMPATIBLE')
                for part in source.values(): text(part, 256)
        if 'columns' in row:
            need(type(row['columns']) is list and len(row['columns']) <= 256, 'CATALOG_INCOMPATIBLE')
            for column in row['columns']:
                exact(column, {'field', 'label', 'kind'})
                for part in column.values(): text(part, 256)
    references = set(value['template_ids']) if scoped else seen
    need(all(set(row['dependencies']) <= references for row in rows), 'CATALOG_INCOMPATIBLE')
    return deepcopy(value)


def read(api, *, scoped, query=None):
    if api._pid is None:
        api.current_versions()
    context = api._context('capabilities') if scoped else None
    result = api._exchange('question_catalog' if scoped else 'question_catalog_metadata',
                           {'context': context, 'query': query or {'search': '', 'kind': '', 'offset': 0}} if scoped else {},
                           lambda value: validate(value, api.versions, scoped))
    if scoped:
        need(result['page_offset'] == (query or {}).get('offset', 0), 'CATALOG_INCOMPATIBLE')
        need(api.authorizer.current(context, 'capabilities') is True, 'PERMISSION_DENIED')
    return result
