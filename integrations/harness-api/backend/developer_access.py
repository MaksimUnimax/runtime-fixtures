"""Explicit server-owned developer grants; account ownership is not a grant."""
from pathlib import Path
import json
import os
import stat

from security import identifier, Failure


class DeveloperAccess:
    def __init__(self, path=None):
        credentials = os.environ.get('CREDENTIALS_DIRECTORY')
        self.path = Path(path or (str(Path(credentials) / 'developer_principals') if credentials else
                                 '/etc/octoport-harness/developer-principals.json'))

    def capabilities(self, profile):
        try:
            descriptor = os.open(self.path, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(descriptor, 'r', encoding='utf-8') as stream:
                info = os.fstat(stream.fileno())
                if (not stat.S_ISREG(info.st_mode) or info.st_uid not in (0, os.geteuid())
                        or info.st_mode & 0o022 or info.st_size > 65536):
                    return []
                policy = json.load(stream)
            if (not isinstance(policy, dict) or set(policy) != {'schema', 'principals'}
                    or policy['schema'] != 'octoport-developer-principals/v1'
                    or not isinstance(policy['principals'], list) or len(policy['principals']) > 1000):
                return []
            granted = set()
            for principal in policy['principals']:
                if not isinstance(principal, dict) or set(principal) != {'actor_id', 'tenant_id', 'permissions'}:
                    return []
                actor, tenant = identifier(principal['actor_id']), identifier(principal['tenant_id'])
                permissions = principal['permissions']
                if (not isinstance(permissions, list) or len(permissions) != len(set(permissions))
                        or any(permission not in {'developer_meter', 'developer_meter_all'} for permission in permissions)):
                    return []
                if actor == profile['customer_id'] and tenant == profile['tenant_id']:
                    granted.update(permissions)
            # Global access is a distinct dormant grant. Ordinary meter paths
            # continue to use the caller's exact actor+tenant scope.
            return sorted(granted)
        except (OSError, ValueError, TypeError, KeyError, Failure):
            return []


class NoDeveloperAccess:
    def capabilities(self, _profile):
        return []


def public_metadata(value):
    """Whitelist the product fields; never recursively relay billing objects."""
    if not isinstance(value, dict):
        return {}
    fields = {'state', 'result_expires_at', 'clarification', 'response_mode',
              'period_label', 'source_label', 'incomplete'}
    return {key: item for key, item in value.items() if key in fields}


def public_message(value, *, developer=False):
    if not isinstance(value, dict):
        return None
    fields = {'id', 'role', 'text', 'created_at', 'presentation'}
    result = {key: item for key, item in value.items() if key in fields}
    metadata = public_metadata(value.get('metadata'))
    if developer and isinstance(value.get('metadata'), dict) and value['metadata'].get('meter'):
        metadata['meter'] = value['metadata']['meter']
    if metadata:
        result['metadata'] = metadata
    if developer and value.get('meter') is not None:
        result['meter'] = value['meter']
    return result
