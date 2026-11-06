import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('boundary_check',ROOT/'tests/architecture/check.py')
guard=importlib.util.module_from_spec(spec);spec.loader.exec_module(guard)

def environment():
    return {**os.environ,'ALISA_ENV':'stage','ALISA_RELEASE':'synthetic-test','ALISA_SECRET_KEY':'s'*48,'ALISA_SERVICE_TOKEN':'t'*48,'ALISA_ALLOWED_HOSTS':'testserver,127.0.0.1','ALISA_DB_NAME':'alisa_test_unconnected','ALISA_DB_USER':'unconnected','ALISA_DB_PASSWORD':'synthetic-only','ALISA_DB_HOST':'127.0.0.1','ALISA_DB_PORT':'1','FOUNDATION_PROBE_ENABLED':'1'}

class ArchitectureTests(unittest.TestCase):
    def test_actual_tree(self):self.assertEqual(guard.violations(),[])
    def test_forbidden_import_fails(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'services').mkdir();(root/'services/injected.py').write_text('import alice_lab\n')
            self.assertTrue(guard.violations(root))
    def test_ui_database_import_fails(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'apps').mkdir();(root/'apps/injected.ts').write_text('import {Client} from "psycopg";')
            self.assertTrue(guard.violations(root))
    def test_missing_secret_fails_without_echo(self):
        env=environment();env.pop('ALISA_SECRET_KEY')
        r=subprocess.run([sys.executable,'services/platform/manage.py','check'],cwd=ROOT,env=env,capture_output=True,text=True)
        self.assertNotEqual(r.returncode,0);self.assertIn('Missing configuration: ALISA_SECRET_KEY',r.stderr);self.assertNotIn('t'*48,r.stderr)
    def test_contract_rejects_extra_and_bad_uuid(self):
        # JSON Schema dependency belongs to dev tests, not runtime services.
        from jsonschema import Draft202012Validator, FormatChecker
        validator=Draft202012Validator(json.loads((ROOT/'contracts/foundation-probe-v1.json').read_text()),format_checker=FormatChecker())
        self.assertTrue(list(validator.iter_errors({'probe_id':'bad','kind':'foundation-v1'})))
        self.assertTrue(list(validator.iter_errors({'probe_id':'b296ea86-a83c-4f7c-b45b-c5c5d4d28cbc','kind':'foundation-v1','sql':'DROP'})))
    def test_disconnected_runtime(self):
        sys.path.insert(0,str(ROOT/'services/platform/src'))
        from alisa_platform.runtime_adapter import DisconnectedRuntime
        self.assertEqual(DisconnectedRuntime().capabilities()['status'],'RUNTIME_NOT_CONNECTED')

class PlatformNegativeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.env_patch=patch.dict(os.environ,environment());cls.env_patch.start()
        sys.path.insert(0,str(ROOT/'services/platform/src'))
        os.environ['DJANGO_SETTINGS_MODULE']='alisa_platform.config.settings'
        import django;django.setup()
        from alisa_platform.config import urls  # load enabled routes before temporary overrides
        from django.urls import clear_url_caches
        clear_url_caches()
        from django.test import Client
        cls.client=Client()
    @classmethod
    def tearDownClass(cls):cls.env_patch.stop()
    def test_live_with_db_down(self):self.assertEqual(self.client.get('/health/live').status_code,200)
    def test_ready_db_down(self):self.assertEqual(self.client.get('/health/ready').status_code,503)
    def test_unauthorized_no_db_write(self):
        self.assertEqual(self.client.post('/internal/foundation/probes',data='{}',content_type='application/json').status_code,401)
    def test_forged_user_header_not_service_identity(self):
        self.assertEqual(self.client.post('/internal/foundation/probes',data='{}',content_type='application/json',HTTP_X_USER_ID='admin',HTTP_AUTHORIZATION='Bearer wrong').status_code,401)
    def test_invalid_input_never_reaches_db(self):
        for data in [{},{'probe_id':'bad','kind':'foundation-v1'},{'probe_id':123,'kind':'foundation-v1'},{'probe_id':'b296ea86-a83c-4f7c-b45b-c5c5d4d28cbc','kind':'sql'},{'probe_id':'b296ea86-a83c-4f7c-b45b-c5c5d4d28cbc','kind':'foundation-v1','secret':'bad'}]:
            r=self.client.post('/internal/foundation/probes',data=json.dumps(data),content_type='application/json',HTTP_AUTHORIZATION='Bearer '+'t'*48)
            self.assertEqual(r.status_code,422)
    def test_future_private_routes_closed(self):
        for path in ['/app','/api/v1/me','/admin','/api/v1/staff?tenant_id=foreign']:
            self.assertEqual(self.client.get(path,HTTP_COOKIE='sessionid=forged').status_code,404)
    def test_disabled_probe(self):
        from django.test import override_settings
        with override_settings(FOUNDATION_PROBE_ENABLED=False):
            self.assertEqual(self.client.post('/internal/foundation/probes',data='{}',content_type='application/json',HTTP_AUTHORIZATION='Bearer '+'t'*48).status_code,404)
    def test_invalid_host(self):self.assertEqual(self.client.get('/health/live',HTTP_HOST='foreign.invalid').status_code,400)
    def test_identity_shell_liveness_with_unavailable_database(self):
        from django.test import override_settings, Client
        sys.path.insert(0,str(ROOT/'services/identity/src'))
        with override_settings(ROOT_URLCONF='octoport_identity.config.urls'):
            response=Client().get('/health/live')
            self.assertEqual(response.status_code,200)
            self.assertEqual(response.json()['component'],'identity')
            self.assertEqual(Client().get('/health/ready').status_code,503)

    def test_production_urlconf_has_no_probe(self):
        from django.test import override_settings
        from alisa_platform.config import urls
        import importlib
        with override_settings(FOUNDATION_PROBE_ENABLED=False,ALISA_ENV='prod'):
            importlib.reload(urls)
            self.assertFalse(any('foundation' in str(p.pattern) for p in urls.urlpatterns))
        importlib.reload(urls)

    def test_worker_retries_connection_failure_and_recovers_without_private_driver_text(self):
        from alisa_platform.foundation.management.commands import foundation_worker as worker
        from django.db import OperationalError
        sleeps=[]
        with patch.object(worker,'tick',side_effect=[OperationalError('private-driver-marker'),None]) as tick,patch.object(worker.connections,'close_all'),patch.object(worker.signal,'signal') as signal_handlers:
            def pause(delay):
                sleeps.append(delay)
                if len(sleeps)==2:signal_handlers.call_args_list[0].args[1]()
            with patch.object(worker.time,'sleep',side_effect=pause),self.assertLogs('alisa.foundation',level='INFO') as logs:
                worker.Command().handle(once=False)
            self.assertEqual(tick.call_count,2);self.assertEqual(sleeps,[0.5,0.25])
            text='\n'.join(logs.output)
            self.assertIn('worker_database_unavailable',text);self.assertIn('worker_database_recovered',text)
            self.assertNotIn('private-driver-marker',text)

    def test_once_worker_database_failure_is_non_success_and_safe(self):
        from alisa_platform.foundation.management.commands import foundation_worker as worker
        from django.core.management.base import CommandError
        from django.db import OperationalError
        with patch.object(worker,'tick',side_effect=OperationalError('private-driver-marker')),patch.object(worker.connections,'close_all'),patch.object(worker.signal,'signal'):
            with self.assertRaisesRegex(CommandError,'^Foundation database unavailable$'):
                worker.Command().handle(once=True)

class QualificationSafetyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec=importlib.util.spec_from_file_location('pg_qualification',ROOT/'tests/integration/run_postgres.py')
        cls.module=importlib.util.module_from_spec(spec);spec.loader.exec_module(cls.module)

    def test_test_admin_dsn_and_unrelated_secrets_not_inherited(self):
        with patch.dict(os.environ,{'ALISA_TEST_PG_DSN':'private-test-marker','UNRELATED_SECRET':'private-test-marker'}):
            env=self.module.clean_environment()
            self.assertNotIn('ALISA_TEST_PG_DSN',env)
            self.assertNotIn('UNRELATED_SECRET',env)

    def test_unapproved_database_target_fails_before_connection(self):
        with patch.dict(os.environ,{'ALISA_TEST_DB_ALLOW':'1','ALISA_TEST_PG_DSN':'postgresql://alisa_ci_admin:synthetic@127.0.0.1:5432/alisa_ci_admin'}), patch.object(sys,'argv',['run_postgres.py','--artifact','unused.tar.gz','--output','unused.json']), patch.object(self.module.psycopg,'connect') as connect:
            with self.assertRaisesRegex(RuntimeError,'Dedicated disposable'):
                self.module.main()
            connect.assert_not_called()

    def test_routing_override_rejected_before_connection(self):
        baseline='host=127.0.0.1 port=55480 dbname=alisa_ci_admin user=alisa_ci_admin password=synthetic'
        for extra in [' hostaddr=203.0.113.10',' service=foreign',' options=-csearch_path=public']:
            with patch.dict(os.environ,{'ALISA_TEST_DB_ALLOW':'1','ALISA_TEST_PG_DSN':baseline+extra}), patch.object(sys,'argv',['run_postgres.py','--artifact','unused.tar.gz','--output','unused.json']), patch.object(self.module.psycopg,'connect') as connect:
                with self.assertRaisesRegex(RuntimeError,'Dedicated disposable'):
                    self.module.main()
                connect.assert_not_called()

    def test_permission_denial_is_not_a_network_or_password_failure(self):
        error=self.module.psycopg.OperationalError
        self.assertTrue(self.module.expected_database_connect_denial(error('FATAL: permission denied for database "alisa_stage_identity"')))
        for message in ['connection refused','password authentication failed','permission denied for schema public']:
            self.assertFalse(self.module.expected_database_connect_denial(error(message)))

if __name__=='__main__':unittest.main()
