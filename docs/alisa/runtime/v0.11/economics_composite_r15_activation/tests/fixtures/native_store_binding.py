"""Reuse an owner's existing native pair, never infer a provider crosswalk.

The root-owned scope projection is an explicit opt-in. Native configuration and
the live systemd credential are revalidated on every check; no secret is copied
to a result, log, database or new credential store.
"""
import hashlib
import hmac
import json
import os
from pathlib import Path
import stat

from store_checker import loads

PROVENANCE = 'NATIVE_OWNER_CONFIGURED_PAIR'
PROJECTION = Path('/run/alisa-native-binding/bindings/scope.json')
CONFIG = Path('/run/alisa-native-binding/source/market-runtime.json')
CREDENTIALS = Path('/run/alisa-native-binding/credentials')
FIELDS = {'seller_client_id', 'seller_api_key', 'performance_client_id', 'performance_client_secret'}


def require(value):
    if not value:
        raise ValueError('NATIVE_BINDING_UNAVAILABLE')


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()


def mac(key, domain, value):
    return hmac.new(key, domain.encode()+b'\0'+canonical(value), hashlib.sha256).hexdigest()


def root_json(path, limit, *, readonly=False):
    path = Path(path)
    for parent in path.parents:
        s = parent.lstat()
        require(stat.S_ISDIR(s.st_mode) and s.st_uid == 0 and not s.st_mode & 0o022)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        s = os.fstat(fd)
        require(stat.S_ISREG(s.st_mode) and s.st_uid == 0 and not s.st_mode & 0o027
                and 0 < s.st_size <= limit)
        if readonly:
            require(os.fstatvfs(fd).f_flag & os.ST_RDONLY)
        raw = b''
        while len(raw) <= limit:
            part = os.read(fd, min(65536, limit+1-len(raw)))
            if not part:
                break
            raw += part
        require(len(raw) == s.st_size and len(raw) <= limit)
        return loads(raw)
    finally:
        os.close(fd)


def process_generation(pid):
    require(type(pid) is int and pid > 1)
    proc = Path('/proc')/str(pid)
    fields = (proc/'stat').read_text().rsplit(')', 1)[1].split()
    require(fields[0] not in {'Z', 'X'})
    return {'pid': pid, 'start_ticks': int(fields[19]), 'uid': proc.stat().st_uid,
            'boot_id': Path('/proc/sys/kernel/random/boot_id').read_text().strip()}


def native_context(config, material, row, *, environment, product_id, generation):
    require(type(config) is dict and config.get('execution_enabled') is True)
    account = config['accounts'][row['native_account']]
    require(type(account) is dict and account.get('active') is True)
    stores = [s for s in account['stores'] if s.get('id') == row['native_store']]
    require(len(stores) == 1)
    store = stores[0]
    require(store.get('platform') == 'ozon'
            and config['credential_bindings'][store['id']] == row['credential_name'])
    require(type(material) is dict and set(material) == FIELDS
            and all(type(v) is str and 1 <= len(v) <= 8192 for v in material.values()))
    require(material['seller_client_id'].isdigit() and int(material['seller_client_id']) > 0)
    identity = 'ozon:client:'+str(int(material['seller_client_id']))
    require(row['identity'] == identity)
    proofs = {}
    for operation in ['ozon_ads_token', 'ozon_ads_daily']:
        proof = config['qualifications'][operation]
        require(type(proof) is dict and proof.get('status') in {'READ_ONLY_CANARY', 'LIVE_LAB_VERIFIED'}
                and type(proof.get('evidence_ref')) is str and 1 <= len(proof['evidence_ref']) <= 400)
        proofs[operation] = {k: proof.get(k) for k in ['status', 'registry_hash', 'scalar_hash', 'evidence_ref']}
    return {'environment': environment, 'product_id': product_id, 'native_generation': generation,
            'tenant_id': row['tenant_id'], 'store_id': row['store_id'],
            'account': row['native_account'], 'store': store, 'credential_name': row['credential_name'],
            'material': material, 'proofs': proofs}


def resolve(pins, credential, *, projection=PROJECTION, config_path=CONFIG, credentials_path=CREDENTIALS):
    """Return only qualified identity; any absent, changed or ambiguous input fails closed."""
    try:
        data = root_json(projection, 65536)
        require(type(data) is dict and set(data) == {'schema_version', 'environment', 'product_id', 'mac_key', 'bindings', 'native_generation'}
                and data['schema_version'] == 'native_owner_store_binding_v1'
                and data['environment'] == pins['environment']
                and data['product_id'] == pins['product_id'] == 'alisa_market'
                and pins['provider'] == 'OZON' and pins['kind'] == 'PERFORMANCE')
        key = bytes.fromhex(data['mac_key'])
        require(len(key) == 32 and type(data['bindings']) is list and 0 < len(data['bindings']) <= 128)
        generation = data['native_generation']
        require(type(generation) is dict and set(generation) == {'pid', 'start_ticks', 'uid', 'boot_id'}
                and generation['uid'] == os.geteuid()
                and process_generation(generation['pid']) == generation)
        rows = [r for r in data['bindings'] if type(r) is dict
                and r.get('tenant_id') == pins['tenant_id'] and r.get('store_id') == pins['store_id']]
        require(len(rows) == 1)
        row = rows[0]
        require(set(row) == {'tenant_id', 'store_id', 'native_account', 'native_store', 'credential_name', 'identity', 'source_hmac'}
                and all(type(v) is str and 0 < len(v) <= 400 for v in row.values()))
        name = row['credential_name']
        require(Path(name).name == name and name not in {'.', '..'})
        config = root_json(config_path, 1048576)
        material = root_json(Path(credentials_path)/name, 32768, readonly=True)
        current = native_context(config, material, row, environment=data['environment'], product_id=data['product_id'], generation=generation)
        require(hmac.compare_digest(mac(key, 'native-owner-source-v1', current), row['source_hmac']))
        expected = {'client_id': material['performance_client_id'], 'client_secret': material['performance_client_secret']}
        require(hmac.compare_digest(mac(key, 'native-owner-performance-v1', credential),
                                    mac(key, 'native-owner-performance-v1', expected)))
        return row['identity']
    except (OSError, ValueError, TypeError, KeyError, OverflowError, UnicodeError, IndexError, AttributeError):
        return None
