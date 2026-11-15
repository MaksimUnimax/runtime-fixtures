"""One accepted owner's metadata only. No grants, sessions, facts or writes.

The reviewed invocation supplies normal runtime settings through systemd's
EnvironmentFile mechanism. This module never parses or prints environment files.
Importing it reads no receipts/configuration, starts no process and initializes
neither Django nor a database connection.
"""
from hashlib import sha256
from pathlib import Path
from types import SimpleNamespace
from uuid import UUID
import json
import os
import stat
import subprocess
import sys

HERE = Path(__file__).resolve().parent
SOURCE_SHA256 = '04cc28b9b0ef93a3c7aea07f6c1b6b571a66ce0235e5e4114d38b335b6b3385f'
ANCHOR = Path('/root/alisa-user-acceptance-gap-fix-20261115/LIVE_OWNER.json')
ANCHOR_SHA256 = 'b272f4da25040970b84ca817881f8dd915c3918dafdf76aeb4a298fdaee24a9b'
PRODUCT = 'alisa_market'
DB_ROLE = 'alisa_stage_platform_runtime'
DB_NAME = 'alisa_stage_platform'
PGOPTIONS = ('-c default_transaction_read_only=on -c statement_timeout=1500 '
             '-c lock_timeout=250 -c idle_in_transaction_session_timeout=5000')
OWNER_FIELDS = ('unit_cost', 'tax_amount', 'own_cost_amount')
PROJECTIONS = {
    'Query': ('tenant_id', 'customer_id', 'store_ids'),
    'Store': ('status',),
    'VerifiedStore': ('id',),
    'Customer': ('is_active', 'security_revision'),
    'Membership': ('role',),
    'CredentialRevision': ('check_code',),
    'OwnerDataset': ('status', 'approval_id', 'approved_by_id',
                     'approved_security_revision', 'approved_at', 'catalog_hash'),
}


class Blocked(Exception):
    pass


def need(condition, code):
    if not condition:
        raise Blocked(code)


def _canonical_uuid(value):
    need(type(value) is str, 'TARGET_SCHEMA')
    try:
        need(str(UUID(value)) == value, 'TARGET_SCHEMA')
    except (ValueError, AttributeError):
        raise Blocked('TARGET_SCHEMA') from None
    return value


def _regular(path, expected=None, *, owner_uid=0, maximum=262144):
    """Read a pinned ordinary file, without following its final symlink."""
    need(type(maximum) is int and maximum in (262144, 1048576), 'SOURCE_FILE_LIMIT')
    info = path.lstat()
    need(stat.S_ISREG(info.st_mode) and info.st_uid == owner_uid
         and not info.st_mode & 0o022 and info.st_size <= maximum, 'SOURCE_FILE_UNSAFE')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        current = os.fstat(fd)
        need((current.st_dev, current.st_ino) == (info.st_dev, info.st_ino), 'SOURCE_MOVED')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            raw = stream.read(maximum+1)
        need(len(raw) <= maximum, 'SOURCE_FILE_SIZE')
        if expected is not None:
            need(sha256(raw).hexdigest() == expected, 'SOURCE_MOVED')
        return raw
    finally:
        os.close(fd)


def _anchor(path=ANCHOR, expected=ANCHOR_SHA256, *, owner_uid=0):
    value = json.loads(_regular(path, expected, owner_uid=owner_uid))
    need(type(value) is dict and type(value.get('finance')) is dict, 'TARGET_SCHEMA')
    return _canonical_uuid(value['finance'].get('query_id'))


def _source():
    value = json.loads(_regular(HERE/'source_context.json', SOURCE_SHA256))
    need(value['schema'] == 'alisa-owner-metadata-source/v1', 'SOURCE_SCHEMA')
    for key, expected in value['properties'].items():
        actual = subprocess.run(['systemctl', 'show', value['unit'], '-p', key, '--value'],
                                check=True, capture_output=True, text=True, timeout=3).stdout.strip()
        need(actual == expected, 'SOURCE_MOVED')
    for name, expected in value['source_stats'].items():
        info = Path(name).lstat()
        actual = [str(item) for item in (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid,
                                        info.st_size, info.st_mtime_ns, info.st_ctime_ns)]
        need(actual == expected, 'ENVIRONMENT_SOURCE_MOVED')
    root = Path(value['release_root'])
    manifest = json.loads(_regular(root/'manifest.json', value['manifest_sha256'], maximum=1048576))
    need(manifest['artifact_id'] == value['artifact_id'], 'SOURCE_MOVED')
    for name, expected in {**value['source_files'], **value['setup_source_files']}.items():
        need(manifest['files'].get(name) == expected, 'SOURCE_MOVED')
        _regular(root/name, expected)
    for name in value['setup_absent_paths']:
        need(not os.path.lexists(root/name), 'SETUP_SOURCE_MOVED')
    need((root/'.venv').resolve() == Path(value['venv_root']), 'ENVIRONMENT_SOURCE_MOVED')
    return value


def _rows(model, projection, filters, *, exclude=None):
    query = model.objects.filter(**filters)
    if exclude:
        query = query.exclude(**exclude)
    return list(query.values(*PROJECTIONS[projection])[:2])


def _credential(rows):
    if not rows:
        return 'MISSING'
    if len(rows) != 1:
        return 'AMBIGUOUS'
    code = rows[0]['check_code']
    # Never reflect arbitrary persisted text as a diagnostic code.
    return code if code in ('CONNECTED', 'CONNECTED_NATIVE_OWNER') else 'UNQUALIFIED'


def _metadata(models, anchor, catalog):
    queries = _rows(models.Query, 'Query', {'pk': anchor, 'channel': 'WEB'})
    need(len(queries) == 1, 'ACCEPTED_QUERY_UNAVAILABLE')
    row = queries[0]
    tenant = _canonical_uuid(str(row['tenant_id']))
    customer = _canonical_uuid(str(row['customer_id']))
    selected = row['store_ids']
    need(type(selected) is list and len(selected) == 1, 'SINGLE_STORE_REQUIRED')
    store = _canonical_uuid(selected[0])
    target = {'pk': store, 'tenant_id': tenant, 'product_id': PRODUCT, 'provider': 'OZON'}
    stores = _rows(models.Store, 'Store', target)
    need(len(stores) == 1, 'ACCEPTED_STORE_UNAVAILABLE')
    customers = _rows(models.Customer, 'Customer', {'pk': customer})
    need(len(customers) == 1, 'ACCEPTED_OWNER_UNAVAILABLE')
    member = _rows(models.Membership, 'Membership',
                   {'customer_id': customer, 'tenant_id': tenant, 'role': 'OWNER_CLIENT'})
    need(customers[0]['is_active'] is True and stores[0]['status'] == 'ACTIVE'
         and len(member) == 1, 'CURRENT_OWNER_SCOPE_CHANGED')
    verified = _rows(models.Store, 'VerifiedStore', {**target, 'verified_identity__isnull': False},
                     exclude={'verified_identity': ''})
    scope = {'product_id': PRODUCT, 'tenant_id': tenant, 'store_id': store}
    credentials = {kind: _credential(_rows(models.CredentialRevision, 'CredentialRevision',
                    {**scope, 'kind': kind, 'status': 'ACTIVE'})) for kind in ('SELLER', 'PERFORMANCE')}
    datasets = _rows(models.OwnerDataset, 'OwnerDataset', scope)
    need(len(datasets) <= 1, 'OWNER_DATASET_AMBIGUOUS')
    dataset = datasets[0] if datasets else {}
    digest = sha256(json.dumps(catalog, ensure_ascii=False, sort_keys=True,
                              separators=(',', ':'), allow_nan=False).encode()).hexdigest()
    checks = {
        'customer_active': customers[0]['is_active'] is True,
        'owner_membership': len(member) == 1,
        'store_active': stores[0]['status'] == 'ACTIVE',
        'store_identity_verified': len(verified) == 1,
        'seller_strict_compatible': credentials['SELLER'] == 'CONNECTED',
        'performance_strict_compatible': credentials['PERFORMANCE'] == 'CONNECTED',
        'dataset_approved': dataset.get('status') == 'APPROVED' and dataset.get('approval_id') is not None
                            and dataset.get('approved_at') is not None,
        'approver_matches': str(dataset.get('approved_by_id')) == customer,
        'approval_security_matches': dataset.get('approved_security_revision') == customers[0]['security_revision'],
        'owner_catalog_current': dataset.get('catalog_hash') == digest,
        **{field+'_registered': field in catalog.get('fields', {}) for field in OWNER_FIELDS},
    }
    return {'status': 'METADATA_COMPATIBLE' if all(checks.values()) else 'METADATA_BLOCKED',
            'metadata_compatible': all(checks.values()), 'checks': checks,
            'credentials': credentials, 'profile_coverage': 'NOT_CHECKED', 'execution_authorized': False}


def run():
    need(len(sys.argv) == 1 and os.geteuid() == 0, 'INVOCATION_SCOPE')
    source = _source()
    anchor = _anchor()
    need(os.environ.get('ALISA_ENV') == 'stage'
         and os.environ.get('ALISA_DB_USER') == DB_ROLE
         and os.environ.get('ALISA_DB_NAME') == DB_NAME, 'RUNTIME_DATABASE_SCOPE')
    need(os.environ.get('PGOPTIONS') == PGOPTIONS, 'READONLY_OPTIONS_REQUIRED')
    root = Path(source['release_root'])
    need(Path(sys.prefix).resolve() == Path(source['venv_root']), 'PYTHON_ENVIRONMENT_REQUIRED')
    os.environ['DJANGO_SETTINGS_MODULE'] = 'alisa_platform.config.settings'
    os.environ['ALISA_RELEASE'] = source['artifact_id']
    sys.path.insert(0, str(root/'services/platform/src'))
    catalog = json.loads(_regular(root/'services/platform/src/alisa_platform/owner_data/owner_input_catalog.json',
        source['source_files']['services/platform/src/alisa_platform/owner_data/owner_input_catalog.json']))
    import django
    django.setup()
    from django.db import connection, transaction
    from alisa_platform.queries.models import Query
    from alisa_platform.accounts.models import Customer, Membership
    from alisa_platform.stores.models import Store, CredentialRevision
    from alisa_platform.owner_data.models import OwnerDataset
    models = SimpleNamespace(Query=Query, Customer=Customer, Membership=Membership,
                             Store=Store, CredentialRevision=CredentialRevision, OwnerDataset=OwnerDataset)
    try:
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute('SET TRANSACTION READ ONLY')
                cursor.execute("SET LOCAL statement_timeout='1500ms'")
                cursor.execute("SET LOCAL lock_timeout='250ms'")
                cursor.execute("SET LOCAL idle_in_transaction_session_timeout='5000ms'")
                cursor.execute("""SELECT current_user=%s, session_user=%s, current_database()=%s,
                    current_setting('default_transaction_read_only')='on',
                    current_setting('transaction_read_only')='on',
                    NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls)
                    FROM pg_roles WHERE rolname=current_user""", [DB_ROLE, DB_ROLE, DB_NAME])
                need(cursor.fetchone() == (True, True, True, True, True, True), 'RUNTIME_DATABASE_SCOPE')
            result = _metadata(models, anchor, catalog)
        _source()
        need(_anchor() == anchor, 'SOURCE_MOVED')
        return result
    finally:
        connection.close()


def main():
    try:
        result = run()
    except Blocked as error:
        result = {'status': 'BLOCKED', 'code': error.args[0], 'profile_coverage': 'NOT_CHECKED'}
    except Exception:
        result = {'status': 'BLOCKED', 'code': 'PREFLIGHT_DEPENDENCY_UNAVAILABLE',
                  'profile_coverage': 'NOT_CHECKED'}
    print(json.dumps(result, sort_keys=True))
    return 0 if result.get('metadata_compatible') is True else 1


if __name__ == '__main__':
    raise SystemExit(main())
