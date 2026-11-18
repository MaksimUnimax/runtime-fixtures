import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
import uuid
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from developer_access import DeveloperAccess


class DeveloperAccessTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / 'principals.json'
        self.actor, self.tenant, self.other = [str(uuid.uuid4()) for _ in range(3)]
        self.profile = {'customer_id': self.actor, 'tenant_id': self.tenant, 'role': 'OWNER_CLIENT'}
        self.write([{'actor_id': self.actor, 'tenant_id': self.tenant, 'permissions': ['developer_meter']}])

    def write(self, principals):
        self.path.write_text(json.dumps({'schema': 'octoport-developer-principals/v1', 'principals': principals}))
        self.path.chmod(0o600)

    def test_exact_pair_and_live_revocation(self):
        policy = DeveloperAccess(self.path)
        self.assertEqual(policy.capabilities(self.profile), ['developer_meter'])
        self.assertEqual(policy.capabilities(dict(self.profile, customer_id=self.other)), [])
        self.assertEqual(policy.capabilities(dict(self.profile, tenant_id=self.other)), [])
        self.write([])
        self.assertEqual(policy.capabilities(self.profile), [])

    def test_ordinary_owner_role_and_client_flags_are_not_authority(self):
        self.write([])
        profile = dict(self.profile, permissions=['developer_meter'], developer_meter=True)
        self.assertEqual(DeveloperAccess(self.path).capabilities(profile), [])

    def test_unsafe_file_symlink_and_bad_policy_fail_closed(self):
        policy = DeveloperAccess(self.path)
        self.path.chmod(0o622)
        self.assertEqual(policy.capabilities(self.profile), [])
        self.path.chmod(0o600)
        link = self.path.with_name('link')
        link.symlink_to(self.path)
        self.assertEqual(DeveloperAccess(link).capabilities(self.profile), [])
        self.path.write_text('{malformed')
        self.assertEqual(policy.capabilities(self.profile), [])
        self.write([{'actor_id': self.actor, 'tenant_id': self.tenant, 'permissions': [['developer_meter']]}])
        self.assertEqual(policy.capabilities(self.profile), [])

    def test_systemd_credential_is_supported(self):
        credential = self.path.with_name('developer_principals')
        self.path.rename(credential)
        with patch.dict(os.environ, {'CREDENTIALS_DIRECTORY': self.directory.name}):
            self.assertEqual(DeveloperAccess().capabilities(self.profile), ['developer_meter'])
