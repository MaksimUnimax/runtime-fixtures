"""Finite R15 activation contract. Importing this file performs no I/O.

The product, its builder, and this tool have separate identities. A fixture or
an activation plan is never an installed-readiness or owner-acceptance proof.
"""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
import json
import re

PRODUCT = 'cafb743c94672104d4afa2c471398e5c81d904f5'
PRODUCT_PLAN = '733a2d1ded5702f4233524263946a41e14bf26428f8adc7519d4ab5432501616'
SOURCE_INDEX = '7342caa174709952744104dd156e38441c0caf15a01bc7442043dca100623562'
BUILD_TOOLS = {
    'baseline_20261115.json': '86fba9b040912c9a6b35b8ac116d7b6634c0c321c3471bc72dc7656fc1c5cdce',
    'build_candidate.py': 'efbcba35fc182af58ca68accfaae9bc43152316f4092fc5305ccf6e3ec80aca0',
    'compatibility_review.json': 'a6f8eecbb603b82afa578de626df4f1e9af02250434df9a19b58efbbab3dc97a',
    'inspect_native.py': 'e310616f618ee63ca27372404e0f6639d01e4235975d0ae35f1aec5921d5a3e7',
    'release_contract.py': 'b070a29b1bc27edb159875c67c48781b9ede3d9f0dd8ee26884be71674fa2020',
}
VERSION_SYNC_FILE = 'runtime_versions_sync.py'
VERSION_SYNC_SHA = '10421a4ec0000a5e26ecc92e5fbeed0a31f48133698a84b92935b04700615dd4'
TOOL_FILES = ('activation_contract.py', 'activate.py', 'readiness.py', VERSION_SYNC_FILE,
              'program_pair.py')
ROLES = ('platform', 'authority', 'native')
UNITS = {'web': 'alisa-web@stage.service', 'platform': 'alisa-platform@stage.service',
         'authority': 'alisa-runtime-authority-stage.service', 'native': 'alice-market.service'}
STOP_ORDER = ('web', 'platform', 'authority', 'native')
START_ORDER = ('native', 'authority', 'platform', 'web')
OTHER_UNITS = ('alisa-admin@stage.service', 'alisa-identity@stage.service',
               'alisa-station.service', 'alisa-smtp-sandbox-stage.service')
CHECKER_UNIT = 'alisa-store-check.service'
CLEANUP_UNIT = 'alisa-account-cleanup@stage.service'
LOCK = Path('/run/lock/alisa-stage-rollout.lock')
FENCE_ROOT = Path('/run/systemd/system.control')
UNIT_PATHS = ('/etc/systemd/system.control', '/run/systemd/system.control',
              '/run/systemd/transient', '/run/systemd/generator.early', '/etc/systemd/system',
              '/etc/systemd/system.attached', '/run/systemd/system', '/run/systemd/system.attached',
              '/run/systemd/generator', '/usr/local/lib/systemd/system',
              '/usr/lib/systemd/system', '/run/systemd/generator.late')
CONFIG = Path('/etc/alice-market/market-runtime.json')
VERSIONS = Path('/etc/alisa-platform/stage/runtime-versions.json')
PROJECTION = Path('/etc/alisa-store-check/native-pair/scope.json')
NATIVE_LINK = Path('/opt/alice-market/releases/current')
WEB_LINK = Path('/opt/alisa-platform/stage/web-current')
STATION = Path('/var/lib/alisa-station/users')
SYNC = Path('/usr/local/libexec/alisa/runtime_versions_sync.py')
PAIR = Path('/root/alisa-s09-clarification-install-20261113-d11a9f2a/pair_helpers.py')
CORE = PAIR.with_name('install.py')
CHECKER = Path('/opt/alice-market/checker-releases/native-pair-8e1a695d71f1004b/native_store_binding.py')
SHARED_HTTP = CHECKER.with_name('shared_http.py')
STORE_CHECKER = CHECKER.with_name('store_checker.py')
HELPERS = {
    str(PAIR): '194b45ba797b053544bff9db84a1e933da62db34dba6e55835121f66eb2f8fb9',
    str(CORE): 'f8e68d5e0ad7502c8bd31f7c859a44921ba904f3265f8607e0f4091d2e596307',
    str(CHECKER): '30664db61e047927c9dafd2b16fd70d3d1ba662ee3ea59ce539d4e1e32045347',
    # Existing shared startup helper, observed byte-for-byte at commit 8257aaac.
    # This baseline is preserved; the separate tool uses VERSION_SYNC_FILE.
    str(SYNC): 'b57ebf6be29b05d08955b043cc3036592cf768016d4fcf18ac6ff67b1d63cee0',
    str(SHARED_HTTP): '0a7657ff13ea4e34bb553294dd0bec09e094cdb6ab25dbb65050d04735d8d7f8',
    str(STORE_CHECKER): 'a9b8abe8ac37d43c35eae19ab9b3114feaf158b72e80e7485d982add9cfc77a1',
}
SOURCE_SELECTORS = {
    'platform': Path('/etc/systemd/system/alisa-platform@stage.service.d') / ('z'*80+'-customer-catalog.conf'),
    'authority': Path('/etc/systemd/system/alisa-runtime-authority-stage.service.d') / ('z'*72+'-parameters-r5-release.conf'),
}
SELECTOR_ENV_FILES = {
    'platform': (),
    'authority': ('/etc/alisa-platform/stage/query-insights.env',
                  '/etc/alisa-platform/stage/question-catalog.env'),
}
SELECTORS = {role: path.parent / ('z'*88+'-economics-r15-release.conf')
             for role, path in SOURCE_SELECTORS.items()}
FLAGS = ('ALISA_OWNER_PARAMETER_COMPOUNDS_ENABLED', 'ALISA_OWNER_ECONOMICS_COMPOSITES_ENABLED')
FLAG_FILE = Path('/etc/alisa-platform/stage/economics-r15-flags.env')
FLAG_BYTES = ''.join(flag+'=1\n' for flag in FLAGS).encode()
POLICIES = {'parameter_sources': 'parameter_sources_pin',
            'parameter_compounds': 'parameter_compounds_pin',
            'economics_composites': 'economics_composites_pin'}
ENV_FILES = tuple('/etc/alisa-platform/stage/'+n for n in (
    'platform.env', 'runtime-link.env', 'alice-link.env', 'query-insights.env',
    'question-catalog.env', 'question-catalog.env'))
SAMPLER_IDENTITIES = {'native': ('alice-market', 'alice-lab'),
                      'postgres': ('alisa-platform-stage', 'alisa-platform-stage'),
                      'voice': ('alice-lab', 'alice-lab')}
PGOPTIONS = ('-c default_transaction_read_only=on -c statement_timeout=1500 '
             '-c lock_timeout=250 -c idle_in_transaction_session_timeout=5000')
MIN_FREE_BYTES = 3 * 1024**3
MIN_FREE_INODES = 200000
MIN_MEMORY_HEADROOM = 1024**3


class Blocked(Exception):
    def __init__(self, code):
        # Only authored fixed codes cross the public error boundary.
        self.code = code
        super().__init__(code)


def need(ok, code):
    if not ok:
        raise Blocked(code)


def digest(raw):
    return sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False,
                       allow_nan=False)+'\n').encode()


def canonical_hash(value):
    # Exact frozen builder release_contract.encoded, including indent and LF.
    return digest((json.dumps(value, sort_keys=True, indent=2,
                              ensure_ascii=False, allow_nan=False)+'\n').encode())


def is_hash(value):
    return type(value) is str and re.fullmatch('[0-9a-f]{64}', value) is not None


def strict_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            need(key not in result, 'JSON_DUPLICATE_KEY')
            result[key] = value
        return result
    try:
        return json.loads(raw, object_pairs_hook=pairs,
                          parse_constant=lambda _: need(False, 'JSON_NONFINITE'))
    except (ValueError, UnicodeError, TypeError):
        raise Blocked('JSON_SHAPE') from None


def absolute(value):
    return (type(value) is str and value.startswith('/') and str(Path(value)) == value
            and '..' not in Path(value).parts and '\x00' not in value)


def product_identity(plan, prepared):
    need(type(plan) is dict and type(prepared) is dict, 'PACKAGE_SHAPE')
    need(plan.get('source_commit') == PRODUCT and prepared.get('source_commit') == PRODUCT,
         'PRODUCT_CHANGED')
    need(plan.get('tool_files') == BUILD_TOOLS, 'BUILDER_CHANGED')
    need(type(plan.get('source_files')) is dict and len(plan['source_files']) == 97
         and canonical_hash(plan['source_files']) == SOURCE_INDEX, 'PRODUCT_INPUTS_CHANGED')
    need(prepared.get('plan_sha256') == PRODUCT_PLAN
         and prepared.get('schema') == 'alisa-economics-candidate/v1'
         and prepared.get('status') == 'BUILT_NOT_ACTIVATED'
         and all(prepared.get(k) is False for k in
                 ('production_deployed', 'services_changed', 'database_changed'))
         and prepared.get('installed_synthetic') == 'NOT_RUN'
         and prepared.get('live_owner') == 'NOT_RUN', 'PACKAGE_STAGE')
    need(set(prepared.get('candidates', {})) == set(ROLES), 'PACKAGE_ROLES')
    for role in ROLES:
        item = prepared['candidates'][role]
        expected = 'alisa-economics-r15-'+role+'-'+PRODUCT[:16]
        need(item.get('artifact_id') == expected and is_hash(item.get('manifest_sha256')),
             'PACKAGE_ROLE_IDENTITY')
        base = plan['baseline']['bases'][role]
        target = str(Path(base['root']).parent / expected)
        need(prepared['rollback_candidate'][role] ==
             {'root': target, 'manifest_sha256': item['manifest_sha256']}, 'PACKAGE_TARGET')
        need(prepared['rollback_before'][role] ==
             {'root': base['root'], 'manifest_sha256': base['manifest_sha256']}, 'PACKAGE_BASE')
    need(prepared['preserved']['web'] == plan['before']['bases']['web']
         and prepared['preserved']['publisher'] == plan['before']['publisher'], 'PRESERVED_CHANGED')


def policy_bytes(raw, before_probe, after_probe):
    old = strict_json(raw)
    need(type(old) is dict, 'NATIVE_CONFIG_SHAPE')
    need(old.get('parameter_sources') ==
         {'enabled': True, 'pin': before_probe['parameter_sources_pin']}, 'OLD_SOURCE_POLICY')
    for key in ('parameter_compounds', 'economics_composites'):
        need(key not in old or old[key] == {'enabled': False}, 'POLICY_ALREADY_CONFIGURED')
    new = deepcopy(old)
    for policy, pin_key in POLICIES.items():
        pin = after_probe.get(pin_key)
        need(is_hash(pin), 'POLICY_PIN_MISSING')
        new[policy] = {'enabled': True, 'pin': pin}
    need({k: v for k, v in old.items() if k not in POLICIES} ==
         {k: v for k, v in new.items() if k not in POLICIES}, 'CONFIG_SCOPE')
    return encoded(new)


def rewrite_release_command(value, base, target, *, release_env=False):
    """Rewrite only verified release paths and the existing gunicorn identity."""
    need(absolute(base) and absolute(target) and base != target
         and type(value) is str and base in value, 'UNIT_RELEASE_COMMAND')
    old, new = Path(base).name, Path(target).name
    need(all(re.fullmatch('[A-Za-z0-9][A-Za-z0-9_.-]*', name) for name in (old, new)),
         'UNIT_RELEASE_COMMAND')
    # Full paths and the one existing --env assignment account for every old
    # release occurrence. Do not rewrite a substring in an unrelated argument.
    rest = value.replace(base, '')
    result = value.replace(base, target)
    if release_env:
        pattern = re.compile(r'(?<!\S)(--env[ \t]+ALISA_RELEASE=)'+re.escape(old)+r'(?=[ \t]|$)')
        need(rest.count(old) == 1 and value.count('ALISA_RELEASE=') == 1
             and len(pattern.findall(value)) == 1, 'UNIT_RELEASE_COMMAND')
        result, count = pattern.subn(lambda match: match.group(1)+new, result)
        need(count == 1, 'UNIT_RELEASE_COMMAND')
    else:
        need(old not in rest and 'ALISA_RELEASE=' not in value, 'UNIT_RELEASE_COMMAND')
    need(base not in result, 'UNIT_RELEASE_COMMAND')
    return result


def selector_bytes(raw, base, target, *, role):
    """Preserve the accepted role's command; replace only its release root.

    The effective unit is separately pinned in the plan and compared after
    daemon-reload. Unexpected selector grammar fails instead of being guessed.
    """
    need(role in SELECTOR_ENV_FILES and absolute(base) and absolute(target) and base != target,
         'SELECTOR_ROOT')
    try:
        text = raw.decode('utf-8')
    except UnicodeError:
        raise Blocked('SELECTOR_GRAMMAR') from None
    need(text.endswith('\n') and not any(x in text for x in ('\r', '\x00', '\\')),
         'SELECTOR_GRAMMAR')
    lines = text[:-1].split('\n')
    entries = [line for line in lines if line and not line.startswith('#')]
    work = [line for line in entries if line.startswith('WorkingDirectory=')]
    commands = [line for line in entries if line.startswith('ExecStart=')]
    need(len(work) == 1 and work[0] in ('WorkingDirectory='+base,
                                      'WorkingDirectory='+base+'/services/platform')
         and len(commands) == 2 and commands[0] == 'ExecStart='
         and commands[1].startswith('ExecStart='+base+'/'), 'SELECTOR_GRAMMAR')
    release = 'Environment=ALISA_RELEASE='+Path(base).name
    expected = ['[Service]', work[0], *([release] if role == 'authority' else []),
                'ExecStart=', commands[1],
                *('EnvironmentFile='+path for path in SELECTOR_ENV_FILES[role])]
    need(entries == expected, 'SELECTOR_GRAMMAR')
    command = rewrite_release_command(commands[1][len('ExecStart='):], base, target,
                                      release_env=role == 'authority')
    replacements = {work[0]: work[0].replace(base, target), commands[1]: 'ExecStart='+command}
    if role == 'authority':
        replacements[release] = 'Environment=ALISA_RELEASE='+Path(target).name
    # Preserve comments, empty lines, unrelated argv and the existing env-file
    # order byte-for-byte. The later drop-in appends those files a second time.
    result = '\n'.join(replacements.get(line, line) for line in lines)+'\n'
    need(base not in result, 'SELECTOR_REPLACE')
    # A final EnvironmentFile wins over earlier EnvironmentFile assignments;
    # bare Environment= would not. This file contains exactly the two flags.
    return (result+'EnvironmentFile='+str(FLAG_FILE)+'\n').encode()


def window(record, *, plan_hash, tool_hash, prepared_hash, now):
    """External, fresh maintenance coordination; not an admission/drain proof."""
    need(type(record) is dict and set(record) == {
        'schema', 'source_commit', 'activation_plan_sha256', 'tool_sha256',
        'prepared_sha256', 'nonce', 'issued_at', 'expires_at', 'coordination'}, 'WINDOW_SHAPE')
    need(record['schema'] == 'alisa-r15-maintenance-coordination/v1'
         and record['source_commit'] == PRODUCT
         and record['activation_plan_sha256'] == plan_hash
         and record['tool_sha256'] == tool_hash
         and record['prepared_sha256'] == prepared_hash
         and type(record['nonce']) is str and re.fullmatch('[0-9a-f]{32}', record['nonce'])
         and record['coordination'] == 'OWNER_BROWSER_AND_VOICE_WINDOW_CONFIRMED', 'WINDOW_BINDING')
    issued, expires = record['issued_at'], record['expires_at']
    need(type(issued) is int and type(expires) is int and issued <= now < expires
         and 0 < expires-issued <= 300 and now-issued <= 300, 'WINDOW_EXPIRED')


def rollback_disposition(*, admission_possible, idle):
    if not admission_possible:
        return 'CONDITIONAL_RECOVERY'
    # No accepted admission-only fence exists for a running native worker.
    # Counts cannot authorize a race-prone post-admission downgrade.
    return 'RECOVERY_REQUIRES_REVIEW' if idle else 'ROLLBACK_BLOCKED_BUSY'


def public_result(status, *, code=None):
    value = {'schema': 'alisa-r15-activation-result/v1', 'status': status,
             'source_commit': PRODUCT, 'live_owner_acceptance': 'NOT_RUN',
             'direct_provider_calls': 0}
    if code is not None:
        need(type(code) is str and re.fullmatch('[A-Z][A-Z0-9_]{0,95}', code), 'ERROR_CODE')
        value['code'] = code
    return value
