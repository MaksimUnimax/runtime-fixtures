import importlib.util
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('lead_policy',ROOT/'services/platform/src/alisa_platform/leads/policy.py')
policy=importlib.util.module_from_spec(spec);spec.loader.exec_module(policy)

class LeadPolicyTests(unittest.TestCase):
    def test_contact_is_synthetic_only(self):
        self.assertEqual(policy.contact('TESTER@example.invalid'),'tester@example.invalid')
        for email in ['real@example.com','person@example.invalid.attacker.com','bad\n@example.invalid','no-at-sign',None]:
            with self.assertRaises(ValueError):policy.contact(email)
    def test_attribution_does_not_retain_contacts_or_unknown_raw_values(self):
        values={'utm_source':'person@example.invalid','utm_medium':'cpc','utm_campaign':'secret-token','utm_term':'private query','referrer':'https://foreign/?code=secret'}
        self.assertEqual(policy.attribution(values),{'utm_source':'OTHER','utm_medium':'cpc','utm_campaign':'OTHER'})
    def test_nested_and_non_string_values_are_not_coerced_into_metrics(self):
        self.assertEqual(set(policy.attribution({'utm_source':{'email':'private'}}).values()),{'OTHER'})
        self.assertEqual(set(policy.attribution(None).values()),{'OTHER'})
    def test_release_gates_and_query_free_log_format(self):
        settings=(ROOT/'services/platform/src/alisa_platform/config/settings.py').read_text()
        self.assertIn("if LANDING_RELEASE_MODE != 'CLOSED'",settings)
        self.assertIn("Only private synthetic SMTP sink is admitted",settings)
        nginx=(ROOT/'infra/nginx/stage.conf.example').read_text()
        log=next(x for x in nginx.splitlines() if x.startswith('log_format alisa_platform_safe'))
        self.assertIn('$uri',log)
        for raw in ['$request_uri','$args','$request\''] :self.assertNotIn(raw,log)
