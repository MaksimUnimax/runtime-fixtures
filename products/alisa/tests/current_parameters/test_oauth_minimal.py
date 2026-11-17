"""Assertions specific to the installed legacy-only platform variant."""
from pathlib import Path
import json,inspect,unittest
from django.test import RequestFactory
from django.conf import settings
from alisa_platform.alice_link import views
from alisa_platform.alice_link.models import AliceLink

class MinimalPlatform(unittest.TestCase):
    def test_no_new_voice_permission_columns_or_migration(self):
        names={field.name for field in AliceLink._meta.fields}
        self.assertNotIn('parameter_write_binding_revision',names)
        self.assertNotIn('parameter_write_consent_revision',names)
        self.assertNotIn('parameter_write_consented_at',names)
        self.assertFalse((Path(inspect.getfile(AliceLink)).parent/'migrations/0002_parameter_voice_consent.py').exists())
    def test_existing_login_projection_and_unsupported_write_action_unchanged(self):
        self.assertEqual(views.projection(None),{'state':'DISCONNECTED','voice_private':True})
        self.assertNotIn('parameter_voice import dispatch',inspect.getsource(views))
        request=RequestFactory().post('/api/v1/account/alice',
            data=json.dumps({'action':'parameter_permission','session_token':'x'*43}),
            content_type='application/json',HTTP_AUTHORIZATION='Bearer '+settings.AUTH_SERVICE_TOKEN)
        with __import__('django.test',fromlist=['override_settings']).override_settings(ALICE_LINK_ENABLED=True):
            self.assertEqual(views.handle(request).status_code,422)
    def test_only_private_oauth_additions_present(self):
        for name in ('legacy_station_identity','legacy_station_token_current'):
            self.assertTrue(callable(getattr(views,name)))
        self.assertIn("action == 'legacy_station_token_refreshable'",inspect.getsource(views.handle))
