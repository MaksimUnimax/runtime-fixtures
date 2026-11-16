"""Attach the catalog to a verified current core without changing frozen inputs."""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('catalog_overlay_base', ROOT.parent / 'platform_stores/build_overlay.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


def activity_sources(root):
    """Publish action-time metadata without modifying the admitted frozen base."""
    root = Path(root)
    catalog = json.loads((root / 'template_catalog.json').read_text())
    blocks = json.loads((root / 'base_blocks.json').read_text())
    for tid, metric, field in [('B14.card_views', 'card_views', 'openCount'),
                               ('B14.cart_additions', 'cart_additions', 'cartCount')]:
        template = catalog['templates'][tid]
        rows = [row for row in blocks['entries'] if row.get('id') == tid]
        if len(rows) != 1 or template['version'] not in (1, 2):
            raise ValueError('ACTIVITY_CONTEXT_MOVED')
        policy = template['input_policy']
        steps = template['steps']
        if (template['id'] != tid or template['platforms'] != ['wb']
                or template['kind'] != 'scalar' or template['metrics'] != [metric]
                or len(steps) != 1 or steps[0].get('operation') != 'wb_orders'
                or steps[0].get('source_registry') != 'scalar_source_catalog'
                or steps[0].get('recipe') != 'wb'
                or steps[0].get('bind', {}).get('fields') != {metric: field}
                or policy.get('time_axis') not in ('order_period', 'analytics_period')
                or not policy.get('period_required') or policy.get('snapshot')):
            raise ValueError('ACTIVITY_CONTEXT_MOVED')
        params = steps[0].get('params', {}).get('$fn', [])
        period = {'start': {'$path': ['period', 'from']}, 'end': {'$path': ['period', 'to']}}
        if (len(params) < 2 or params[0] != 'merge' or params[1].get('selectedPeriod') != period
                or rows[0].get('metrics') != [metric] or rows[0].get('platforms') != ['wb']
                or rows[0].get('time_axis') not in ('order_period', 'analytics_period')):
            raise ValueError('ACTIVITY_CONTEXT_MOVED')
        template['version'] = 2
        policy['time_axis'] = 'analytics_period'
        rows[0]['time_axis'] = 'analytics_period'
    return {name: json.dumps(value, ensure_ascii=False, indent=2) + '\n'
            for name, value in [('template_catalog.json', catalog), ('base_blocks.json', blocks)]}


def sources(root):
    extension = ROOT.parents[3] / 'docs/alisa/runtime/v0.11/question_catalog_r1/question_catalog_extension.py'
    service = base.replace_once((root / 'runtime_port_service.py').read_text(),
        '    try:\n        gateway = Gateway(',
        '    from question_catalog_extension import install\n    install()\n'
        '    try:\n        gateway = Gateway(')
    result = {'question_catalog_extension.py': extension.read_text(), 'runtime_port_service.py': service}
    for name, text in result.items():
        compile(text, name, 'exec')
    result.update(activity_sources(root))
    return result


def build(source, destination):
    return base.build(source, destination, transform=sources,
                      marker=('question_catalog_overlay', 'question-catalog-v1'))
