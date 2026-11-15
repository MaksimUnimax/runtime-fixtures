"""Finite R15 package contract. No service, database, network or config writes."""
from copy import deepcopy
from hashlib import sha256
from pathlib import PurePosixPath
import ast
import json
import posixpath
import re

PLATFORM = 'services/platform/src/alisa_platform/'
SOURCE_PLATFORM = 'products/alisa/' + PLATFORM
RUNTIME = 'docs/alisa/runtime/v0.11/'
ROLES = ('platform', 'authority', 'native', 'web')
BUILD_ROLES = ('platform', 'authority', 'native')
EXISTING_PLATFORM = ('config/settings.py', 'queries/service.py',
                     'owner_data/parameter_collection.py', 'owner_data/service.py',
                     'owner_data/source.py')
NEW_OWNER = (
    'parameter_dependencies.py', 'parameter_dependency_catalog.json',
    'parameter_dependency_service.py', 'parameter_report_catalog.json',
    'parameter_report_contract.py', 'parameter_report_rpc.py',
    'economics_accruals.py', 'economics_cohort.py', 'economics_cohort_catalog.json',
    'economics_current.py', 'economics_query.py', 'economics_realization.py',
    'economics_periods.py', 'economics_period_catalog.json',
    'economics_orders.py', 'economics_order_catalog.json',
    'economics_other.py', 'economics_other_catalog.json',
    'economics_tariffs.py', 'economics_tariff_catalog.json',
)
PLATFORM_OVERLAY = (*EXISTING_PLATFORM, *('owner_data/' + n for n in NEW_OWNER))
# Transitive platform imports of the R7-R15 overlay. Preserve these files from
# each actual base only after comparing them with the exact final source.
COMPATIBILITY_PY = (
    'accounts/models.py', 'accounts/views.py', 'alice_link/models.py',
    'alice_link/oauth.py', 'alice_link/vault.py', 'entitlements/models.py',
    'entitlements/policy.py', 'entitlements/service.py', 'foundation/models.py',
    'foundation/views.py', 'funnel/models.py', 'leads/models.py', 'leads/policy.py',
    'leads/views.py', 'owner_data/__init__.py', 'owner_data/models.py',
    'owner_data/owner_inputs.py', 'owner_data/parameter_contract.py',
    'owner_data/parameter_producers.py', 'owner_data/parameter_readset.py',
    'owner_data/parameter_resolution.py', 'owner_data/parameter_service.py',
    'queries/__init__.py', 'queries/models.py',
    'queries/voice_dialogue.py', 'query_insights/models.py',
    'query_insights/service.py', 'query_insights/wire.py',
    'runtime_adapter/authority.py', 'runtime_adapter/authority_rpc.py',
    'runtime_adapter/bindings.py', 'runtime_adapter/client.py',
    'runtime_adapter/job_client.py', 'runtime_adapter/store_check.py',
    'runtime_adapter/store_registry.py', 'staff/models.py', 'staff/policy.py',
    'staff/service.py', 'stores/__init__.py', 'stores/models.py',
    'stores/policy.py', 'stores/service.py', 'stores/vault.py',
)
PACKAGE_INITS = frozenset(('__init__.py', *(str(PurePosixPath(n).parent / '__init__.py')
    for n in (*PLATFORM_OVERLAY, *COMPATIBILITY_PY))))
COMPATIBILITY_FILES = frozenset((*COMPATIBILITY_PY, *PACKAGE_INITS,
    'owner_data/owner_input_catalog.json', 'owner_data/owner_binding_policy.json',
    'owner_data/parameter_catalog.json', 'owner_data/parameter_producers.json'))
NATIVE_COMPATIBILITY = ('__init__.py', 'parameter_contract.py',
                        'parameter_catalog.json', 'parameter_producers.py',
                        'parameter_producers.json')
R8_SUPPORT = ('parameter_dependencies.py', 'parameter_dependency_catalog.json',
              'parameter_resolution.py', 'parameter_report_catalog.json',
              'parameter_report_contract.py')
LATER_SUPPORT = ('economics_accruals.py', 'economics_realization.py',
                 'economics_cohort.py', 'economics_cohort_catalog.json',
                 'economics_periods.py', 'economics_period_catalog.json',
                 'economics_tariffs.py', 'economics_tariff_catalog.json',
                 'economics_orders.py', 'economics_order_catalog.json',
                 'economics_other.py', 'economics_other_catalog.json')
LEAVES = {
    'parameter_report_runtime.py': 'current_parameters_r8/parameter_report_runtime.py',
    'accrual_source_runtime.py': 'economics_ledger_r11/accrual_source_runtime.py',
    'realization_source_runtime.py': 'economics_flow_r13/realization_source_runtime.py',
    'realization_source_catalog.json': 'economics_flow_r13/realization_source_catalog.json',
    'period_cost_source_runtime.py': 'economics_period_r14/period_cost_source_runtime.py',
    **{n: 'economics_composite_r15/' + n for n in (
        'tariff_source_runtime.py', 'order_source_runtime.py',
        'other_source_runtime.py', 'economics_report_runtime.py')},
}
PREPARES = ('current_parameters_r8', 'economics_period_r14', 'economics_composite_r15')
NATIVE_EXISTING = (
    'template_catalog.py', 'template_catalog.json', 'template_runtime.py', 'engine.py',
    'parameter_source_runtime.py', 'parameter_collection_runtime.py',
    'model_answer.py', 'model_program.py', 'runtime.py', 'repository.py',
)
NATIVE_OVERLAY = frozenset((*NATIVE_EXISTING, *LEAVES,
                          *('parameter_support/' + n for n in (*R8_SUPPORT, *LATER_SUPPORT))))
SOURCE_FILES = frozenset((
    *(SOURCE_PLATFORM + n for n in PLATFORM_OVERLAY),
    *(SOURCE_PLATFORM + n for n in COMPATIBILITY_FILES),
    *(SOURCE_PLATFORM + 'owner_data/' + n for n in (*R8_SUPPORT, *LATER_SUPPORT)),
    *(RUNTIME + n for n in LEAVES.values()),
    *(RUNTIME + n + '/prepare_candidate.py' for n in PREPARES),
    RUNTIME + 'current_parameters_r8/BASELINE.json',
))
TOOL_FILES = ('baseline_20261115.json', 'release_contract.py',
              'build_candidate.py', 'inspect_native.py', 'compatibility_review.json')
REPORT_IDS = frozenset(('economics.delivery_projection.v1', 'economics.unit_forecast.v1'))


class ReleaseError(RuntimeError):
    """Only a bounded code/path is exposed; never file content or configuration."""


def need(ok, code):
    if not ok:
        raise ReleaseError(code)


def digest(data):
    return sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=False, indent=2) + '\n').encode()


def strict_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            need(key not in result, 'DUPLICATE_JSON_KEY')
            result[key] = value
        return result
    try:
        return json.loads(raw, object_pairs_hook=pairs,
                          parse_constant=lambda _: need(False, 'NONFINITE_JSON'))
    except (ValueError, UnicodeError):
        raise ReleaseError('INVALID_JSON') from None


def sha(value):
    return type(value) is str and re.fullmatch('[a-f0-9]{64}', value) is not None


def safe_path(value):
    return (type(value) is str and bool(value) and value != '.'
            and str(PurePosixPath(value)) == value and not value.startswith('/')
            and '..' not in PurePosixPath(value).parts and '\\' not in value
            and not any(ord(c) < 32 for c in value))


def manifest_shape(value):
    need(type(value) is dict and type(value.get('files')) is dict
         and type(value.get('links', {})) is dict, 'MANIFEST_SCHEMA')
    files, links = value['files'], value.get('links', {})
    need(files and not set(files) & set(links), 'MANIFEST_OVERLAP')
    for name, h in files.items():
        need(safe_path(name) and name not in ('manifest.json', '.venv') and sha(h),
             'MANIFEST_FILE_SHAPE')
    for name, target in links.items():
        need(safe_path(name) and name != '.venv' and type(target) is str and target
             and not target.startswith('/') and '\\' not in target, 'MANIFEST_LINK_SHAPE')
        resolved = posixpath.normpath(posixpath.join(posixpath.dirname(name), target))
        need(safe_path(resolved), 'MANIFEST_LINK_ESCAPE')
    names = set(files) | set(links)
    for name in names:
        need(not any(str(parent) in names for parent in PurePosixPath(name).parents
                     if str(parent) != '.'), 'MANIFEST_PARENT_COLLISION')
    return value


def check_plan(plan, baseline, tools):
    need(type(plan) is dict and set(plan) == {
        'schema', 'source_commit', 'source_files', 'tool_files', 'baseline',
        'before', 'production_deployed', 'status'}, 'PLAN_SCHEMA')
    need(plan['schema'] == 'alisa-economics-candidate-plan/v1'
         and plan['status'] == 'PLAN_NOT_BUILT'
         and plan['production_deployed'] is False, 'PLAN_STAGE')
    need(type(plan['source_commit']) is str
         and re.fullmatch('[a-f0-9]{40}', plan['source_commit']), 'SOURCE_COMMIT')
    need(type(plan['source_files']) is dict and set(plan['source_files']) == SOURCE_FILES
         and all(sha(x) for x in plan['source_files'].values()), 'SOURCE_SCOPE')
    need(plan['baseline'] == baseline and plan['tool_files'] == tools, 'PLAN_BASE_OR_TOOL_CHANGED')
    need(type(plan['before']) is dict and set(plan['before']) == {'bases', 'publisher', 'environment', 'live_references'},
         'PLAN_BEFORE_SCOPE')


def check_catalog(before, after):
    need(type(before) is dict and type(after) is dict
         and type(before.get('templates')) is dict and type(after.get('templates')) is dict,
         'CATALOG_SCHEMA')
    a, b = before['templates'], after['templates']
    need({k: v for k, v in before.items() if k != 'templates'} ==
         {k: v for k, v in after.items() if k != 'templates'}, 'CATALOG_METADATA_CHANGED')
    need(all(key in b and b[key] == value for key, value in a.items()), 'EXISTING_TEMPLATE_CHANGED')
    need(set(b) - set(a) == REPORT_IDS, 'NEW_TEMPLATE_SCOPE')


def check_source_imports(blobs):
    """New transitive project imports require explicit review of the closure."""
    declared = set(PLATFORM_OVERLAY) | set(COMPATIBILITY_FILES)
    for name in declared:
        if not name.endswith('.py'):
            continue
        try:
            tree = ast.parse(blobs[SOURCE_PLATFORM + name])
        except (SyntaxError, ValueError):
            raise ReleaseError('SOURCE_SYNTAX:' + name) from None
        package = PurePosixPath(name).parts[:-1]
        for node in ast.walk(tree):
            modules = []
            if isinstance(node, ast.Import):
                modules = [x.name[len('alisa_platform.'):] for x in node.names
                           if x.name.startswith('alisa_platform.')]
            elif isinstance(node, ast.ImportFrom):
                if node.level:
                    need(node.level <= len(package) + 1, 'SOURCE_IMPORT_ESCAPE')
                    module = '.'.join((*package[:len(package) - node.level + 1],
                                       *([node.module] if node.module else [])))
                elif (node.module or '').startswith('alisa_platform.'):
                    module = node.module[len('alisa_platform.'):]
                elif node.module == 'alisa_platform':
                    module = ''
                else:
                    continue
                modules = [module]
                prefix = module.replace('.', '/')
                is_package = ((prefix + '/' if prefix else '') + '__init__.py') in declared
                if node.module is None or node.module == 'alisa_platform' or is_package:
                    need(all(x.name != '*' for x in node.names), 'SOURCE_PACKAGE_STAR_IMPORT')
                    modules.extend((module + '.' if module else '') + x.name for x in node.names)
            for module in modules:
                prefix = module.replace('.', '/')
                candidates = {prefix + '.py', (prefix + '/' if prefix else '') + '__init__.py'}
                need(bool(candidates & declared), 'SOURCE_DEPENDENCY_UNDECLARED:' + module)


def check_compatibility(source, bases, review):
    need(type(review) is dict and set(review) == {'schema', 'preserved_differences', 'replacement_deltas'}
         and review['schema'] == 'alisa-economics-release-compatibility/v1', 'COMPATIBILITY_REVIEW_SCHEMA')
    exceptions = review['preserved_differences']
    need(type(exceptions) is list, 'COMPATIBILITY_REVIEW_SCHEMA')
    indexed = {}
    for item in exceptions:
        need(type(item) is dict and set(item) == {'role', 'path', 'source_sha256', 'base_sha256', 'reason'}
             and item['role'] in ('platform', 'authority') and item['path'] in COMPATIBILITY_FILES
             and sha(item['source_sha256']) and sha(item['base_sha256'])
             and type(item['reason']) is str and bool(item['reason']), 'COMPATIBILITY_EXCEPTION_SCHEMA')
        key = (item['role'], item['path'])
        need(key not in indexed, 'COMPATIBILITY_EXCEPTION_DUPLICATE')
        indexed[key] = item
    for role in ('platform', 'authority'):
        for name in COMPATIBILITY_FILES:
            actual, expected = bases[role]['files'].get(PLATFORM + name), source[SOURCE_PLATFORM + name]
            exception = indexed.get((role, name))
            if exception:
                need(exception['source_sha256'] == expected and exception['base_sha256'] == actual,
                     'COMPATIBILITY_EXCEPTION_CHANGED:' + role + ':' + name)
            else:
                need(actual == expected, 'SOURCE_BASE_COMPATIBILITY_REQUIRED:' + role + ':' + name)
    for name in NATIVE_COMPATIBILITY:
        need(bases['native']['files'].get('parameter_support/' + name) == source[SOURCE_PLATFORM + 'owner_data/' + name],
             'NATIVE_SUPPORT_COMPATIBILITY_REQUIRED:' + name)
    replacements = review['replacement_deltas']
    need(type(replacements) is dict and set(replacements) == set(EXISTING_PLATFORM), 'REPLACEMENT_REVIEW_REQUIRED')
    for name, item in replacements.items():
        need(type(item) is dict and set(item) == {'source_sha256', 'base_sha256', 'reason'}
             and type(item['base_sha256']) is dict and set(item['base_sha256']) == {'platform', 'authority'}
             and sha(item['source_sha256']) and all(sha(h) for h in item['base_sha256'].values())
             and type(item['reason']) is str and bool(item['reason']), 'REPLACEMENT_REVIEW_SCHEMA')
        need(source[SOURCE_PLATFORM + name] == item['source_sha256'], 'REPLACEMENT_SOURCE_CHANGED:' + name)
        for role in ('platform', 'authority'):
            need(bases[role]['files'].get(PLATFORM + name) == item['base_sha256'][role],
                 'REPLACEMENT_BASE_CHANGED:' + role + ':' + name)


def check_output_sources(role, files, source):
    if role in ('platform', 'authority'):
        copies = {PLATFORM + name: SOURCE_PLATFORM + name for name in PLATFORM_OVERLAY}
    else:
        copies = {**{name: RUNTIME + path for name, path in LEAVES.items()},
                  **{'parameter_support/' + name: SOURCE_PLATFORM + 'owner_data/' + name
                     for name in (*R8_SUPPORT, *LATER_SUPPORT)}}
    for output, origin in copies.items():
        need(files.get(output) == source[origin], 'DIRECT_SOURCE_OUTPUT_CHANGED:' + role + ':' + output)


def check_delta(role, before, after):
    allowed = ({PLATFORM + n for n in PLATFORM_OVERLAY}
               if role in ('platform', 'authority') else set(NATIVE_OVERLAY))
    need(set(before) <= set(after), 'BASE_FILE_REMOVED')
    changed = {n for n, h in after.items() if before.get(n) != h}
    need(changed <= allowed, 'OVERLAY_SCOPE')
    need(allowed <= set(after), 'OVERLAY_FILE_MISSING')
    if role in ('platform', 'authority'):
        need(all(PLATFORM + 'owner_data/' + n not in before for n in NEW_OWNER), 'NEW_MODULE_ALREADY_PRESENT')
    return sorted(changed)


def candidate_manifest(role, before, files, source, base_sha, external_links):
    """Retain structural contracts; old acceptance is historical provenance only."""
    preserved = ('schema', 'toolchain', 'locks', 'contracts', 'migrations',
                 'schema_compatibility', 'runtime_port', 'components')
    result = {k: deepcopy(before[k]) for k in preserved if k in before}
    result.update(
        artifact_id='alisa-economics-r15-' + role + '-' + source[:16],
        files=deepcopy(files), links=deepcopy(before.get('links', {})),
        external_links=deepcopy(external_links),
        base_release=before['artifact_id'], base_manifest_sha256=base_sha,
        base_provenance={k: deepcopy(v) for k, v in before.items() if k not in ('files', 'links')},
        economics_source=source,
        acceptance={'status': 'CANDIDATE_BUILT_NOT_INSTALLED', 'live_owner': 'NOT_RUN'},
    )
    result['source_commit' if role == 'native' else 'source_sha'] = source
    return manifest_shape(result)


def rollback_allowed(before, ours, observed):
    """Pure future switch guard; does not restore paths, flags, versions or services."""
    keys = {*ROLES, 'publisher'}
    need(type(before) is dict and type(ours) is dict and type(observed) is dict
         and set(before) == set(ours) == set(observed) == keys, 'ROLLBACK_SCOPE')
    for state in (before, ours, observed):
        for role in ROLES:
            item = state[role]
            need(type(item) is dict and set(item) == {'root', 'manifest_sha256'}
                 and type(item['root']) is str and item['root'].startswith('/')
                 and posixpath.normpath(item['root']) == item['root']
                 and sha(item['manifest_sha256']), 'ROLLBACK_COMPONENT')
        item = state['publisher']
        need(type(item) is dict and set(item) == {'path', 'sha256'}
             and type(item['path']) is str and item['path'].startswith('/')
             and sha(item['sha256']), 'ROLLBACK_PUBLISHER')
    need(ours['web'] == before['web'] and ours['publisher'] == before['publisher'],
         'PRESERVED_COMPONENT_CHANGED')
    for key in keys:
        need(observed[key] == before[key] or observed[key] == ours[key],
             'ROLLBACK_LATER_WRITER:' + key)
    return True


def rollback_state(observed):
    return {**{k: {n: observed['bases'][k][n] for n in ('root', 'manifest_sha256')}
               for k in ROLES}, 'publisher': deepcopy(observed['publisher'])}
