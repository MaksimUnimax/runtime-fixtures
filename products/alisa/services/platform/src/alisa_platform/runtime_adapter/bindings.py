"""Explicit operator-owned mappings. Never derive native IDs from public UUIDs."""
from copy import deepcopy
import os
from pathlib import Path
import stat

from .job_client import RuntimeFailure, decode, exact, identifier, need, text

MAX_BYTES = 1048576


def revision(value):
    need(type(value) is int and 1 <= value <= 2147483647)


class BindingFile:
    def __init__(self, path, *, owner_uid=0):
        need(type(path) is str and path.startswith('/') and str(Path(path)) == path
             and '..' not in Path(path).parts)
        need(type(owner_uid) is int and owner_uid >= 0)
        self.path, self.owner_uid = Path(path), owner_uid

    def load(self, *, environment, service_id, catalog_release_id):
        try:
            for parent in self.path.parents:
                info = parent.lstat()
                need(stat.S_ISDIR(info.st_mode) and info.st_uid in {0, self.owner_uid}
                     and not info.st_mode & 0o022)
            fd = os.open(self.path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            try:
                info = os.fstat(fd)
                need(stat.S_ISREG(info.st_mode) and info.st_uid == self.owner_uid
                     and not info.st_mode & 0o027 and 0 < info.st_size <= MAX_BYTES)
                raw = bytearray()
                while len(raw) <= MAX_BYTES:
                    part = os.read(fd, min(65536, MAX_BYTES + 1 - len(raw)))
                    if not part: break
                    raw.extend(part)
                after = os.fstat(fd)
                need(len(raw) == info.st_size and
                     (info.st_size, info.st_mtime_ns) == (after.st_size, after.st_mtime_ns))
            finally:
                os.close(fd)
            value = decode(bytes(raw))
            exact(value, {'schema', 'environment', 'service_id', 'catalog_release_id', 'tenants'})
            need(value['schema'] == 'alisa-runtime-bindings/v1' and value['environment'] == environment
                 and value['service_id'] == service_id and value['catalog_release_id'] == catalog_release_id)
            need(type(value['tenants']) is list and len(value['tenants']) <= 1000)
            tenants, total = {}, 0
            for tenant in value['tenants']:
                exact(tenant, {'tenant_id', 'runtime_tenant', 'revision', 'stores'})
                tid = identifier(tenant['tenant_id']); need(tid not in tenants)
                text(tenant['runtime_tenant'], 128); text(tenant['revision'], 128)
                need(type(tenant['stores']) is list and 1 <= len(tenant['stores']) <= 1000)
                stores, native_ids, identities = {}, set(), set()
                for store in tenant['stores']:
                    exact(store, {'store_id', 'provider', 'verified_identity', 'credential_revision',
                                  'credentials', 'runtime_store'})
                    sid = identifier(store['store_id']); need(sid not in stores)
                    need(store['provider'] in {'OZON', 'WB'})
                    text(store['verified_identity'], 160); revision(store['credential_revision'])
                    expected = {'SELLER', 'PERFORMANCE'} if store['provider'] == 'OZON' else {'WB'}
                    need(type(store['credentials']) is list and len(store['credentials']) == len(expected))
                    kinds, credential_ids = set(), set()
                    for credential in store['credentials']:
                        exact(credential, {'kind', 'id', 'revision'})
                        need(credential['kind'] in expected and credential['kind'] not in kinds)
                        kinds.add(credential['kind']); cid = identifier(credential['id'])
                        need(cid not in credential_ids); credential_ids.add(cid); revision(credential['revision'])
                    native = store['runtime_store']
                    exact(native, {'id', 'platform', 'identity', 'access_revision', 'source_revision', 'currency'})
                    for field in ('id', 'identity', 'access_revision', 'source_revision'): text(native[field], 160)
                    need(native['platform'] == store['provider'].lower() and native['currency'] == 'RUB')
                    marker = (native['platform'], native['identity'])
                    need(native['id'] not in native_ids and marker not in identities)
                    native_ids.add(native['id']); identities.add(marker); stores[sid] = deepcopy(store)
                total += len(stores); need(total <= 1000)
                tenants[tid] = {**deepcopy(tenant), 'stores': stores}
            return tenants
        except (RuntimeFailure, OSError, ValueError, TypeError, KeyError, RecursionError):
            raise RuntimeFailure('DEPENDENCY_UNAVAILABLE') from None
