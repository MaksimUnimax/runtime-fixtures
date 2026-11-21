"""Root one-shot: refresh only the process generation of an unchanged qualified pair."""
import copy
import fcntl
import hmac
import json
import os
from pathlib import Path
import pwd
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
sys.path.insert(0, '/opt/alice-market/checker-releases/native-pair-8e1a695d71f1004b')
from native_store_binding import native_context, mac, process_generation, require, root_json

SCOPE = Path('/etc/alisa-store-check/native-pair/scope.json')
CONFIG = Path('/etc/alice-market/market-runtime.json')
CREDENTIALS = Path('/run/alisa-native-pair-refresh/source')


def renewed(data, config, materials, generation):
    require(type(data) is dict and set(data) == {'schema_version', 'environment', 'product_id', 'mac_key', 'bindings', 'native_generation'}
            and data['schema_version'] == 'native_owner_store_binding_v1' and data['product_id'] == 'alisa_market')
    key = bytes.fromhex(data['mac_key'])
    require(len(key) == 32 and type(data['bindings']) is list and 0 < len(data['bindings']) <= 128)
    require(generation['uid'] == data['native_generation']['uid'])
    result = copy.deepcopy(data)
    result['native_generation'] = generation
    scopes = set()
    for old, new in zip(data['bindings'], result['bindings']):
        scope = old['tenant_id'], old['store_id']
        require(scope not in scopes and old['credential_name'] == 'ozon')
        scopes.add(scope)
        options = {'environment': data['environment'], 'product_id': data['product_id']}
        material = materials[old['credential_name']]
        context = native_context(config, material, old, generation=data['native_generation'], **options)
        require(hmac.compare_digest(mac(key, 'native-owner-source-v1', context), old['source_hmac']))
        new['source_hmac'] = mac(key, 'native-owner-source-v1', native_context(config, material, new, generation=generation, **options))
    return result


def generation():
    pid = int(subprocess.check_output(['systemctl', 'show', 'alice-market.service', '-p', 'MainPID', '--value'], text=True, timeout=2))
    value = process_generation(pid)
    require(value['uid'] == pwd.getpwnam('alice-market').pw_uid)
    return value


def refresh():
    require(os.geteuid() == 0)
    with open('/run/alisa-native-pair-refresh/refresh.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        data = root_json(SCOPE, 65536)
        current = generation()
        config = root_json(CONFIG, 1048576)
        material = root_json(CREDENTIALS/'ozon', 32768, readonly=True)
        result = renewed(data, config, {'ozon': material}, current)
        require(generation() == current and root_json(CONFIG, 1048576) == config
                and root_json(CREDENTIALS/'ozon', 32768, readonly=True) == material
                and root_json(SCOPE, 65536) == data)
        if result == data:
            return 'NATIVE_BINDING_UNCHANGED'
        gid = SCOPE.stat().st_gid
        fd, name = tempfile.mkstemp(prefix='.scope-refresh-', dir=SCOPE.parent)
        try:
            with os.fdopen(fd, 'wb') as target:
                target.write(json.dumps(result).encode()); target.flush()
                os.fchmod(target.fileno(), 0o640); os.fchown(target.fileno(), 0, gid); os.fsync(target.fileno())
            require(generation() == current)
            os.replace(name, SCOPE)
            directory = os.open(SCOPE.parent, os.O_RDONLY | os.O_DIRECTORY)
            try: os.fsync(directory)
            finally: os.close(directory)
        finally:
            if os.path.exists(name): os.unlink(name)
        return 'NATIVE_BINDING_REFRESHED'


if __name__ == '__main__':
    try: print(refresh())
    except Exception:
        # Keep Seller/checker available; the unchanged stale proof cannot qualify
        # Performance. Never print private input, exception text or a MAC.
        print('NATIVE_BINDING_NOT_REQUALIFIED')
