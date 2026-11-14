"""Migration qualification on an explicitly owned disposable PostgreSQL only."""
from pathlib import Path
from datetime import datetime,timezone
from unittest.mock import patch
import os,sys,json,unittest,socket
ROOT=Path(__file__).resolve().parents[6]
PLATFORM=ROOT/'products/alisa/services/platform/src';TESTS=ROOT/'products/alisa/tests'
sys.path[:0]=[str(PLATFORM),str(TESTS),str(Path(__file__).resolve().parents[1])]
os.environ['DJANGO_SETTINGS_MODULE']='current_parameters.settings'
assert os.environ.get('PARAMETER_TEST_SOCKET','').startswith('/dev/shm/alisa-current-parameters-pg-20261114-r6/')
import django
django.setup()
from django.conf import settings
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.db.migrations.recorder import MigrationRecorder
from django.core.management import call_command
from django.utils import timezone as djtime
from alisa_platform.owner_data.models import OwnerDataset,CurrentParameter
from current_parameters.test_parameters import Fixture
import migration_guard as g
ROLE='parameter_test_runtime'
assert connection.settings_dict['NAME']=='parameter_test'
assert connection.settings_dict['HOST']==os.environ['PARAMETER_TEST_SOCKET']


def fresh_old_schema():
    executor=MigrationExecutor(connection)
    targets=[t for t in executor.loader.graph.leaf_nodes()if t[0]!='owner_data']+[('owner_data','0001_initial')]
    executor.migrate(targets)
    if g._table(connection,g.TABLE)is not None:
        # Only a deliberately colliding table in the isolated test DB.
        assert g.TARGET not in MigrationRecorder(connection).applied_migrations()
        with connection.cursor()as c:c.execute('DROP TABLE owner_data_currentparameter')
    call_command('flush',interactive=False,verbosity=0)
    with connection.cursor()as c:
        c.execute('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO parameter_test_runtime')
        c.execute('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE,REFERENCES,TRIGGER ON TABLES FROM parameter_test_runtime')
        for name in g.EXISTING:
            c.execute('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE '+connection.ops.quote_name(name)+' TO parameter_test_runtime')

class Migration(unittest.TestCase,Fixture):
    def setUp(self):
        fresh_old_schema();self.create()
        self.facts={'entries':[{'field':'unit_cost','entity':'all-products','value':'250'}]}
        OwnerDataset.objects.create(store=self.store,tenant=self.tenant,revision=1,status='APPROVED',facts=self.facts)
        self.before=g._fingerprints(connection)
    def assert_old(self):
        self.assertIsNone(g._table(connection,g.TABLE));self.assertNotIn(g.TARGET,MigrationRecorder(connection).applied_migrations())
        self.assertEqual(g._fingerprints(connection),self.before)
    def test_read_only_plan_changes_nothing(self):
        r=g.run(connection,ROLE);self.assertEqual(r['status'],'MIGRATION_PREFLIGHT');self.assertEqual(r['plan'],[(*g.TARGET,False)]);self.assert_old()
    def test_one_additive_migration_preserves_cost_and_privileges(self):
        r=g.run(connection,ROLE,apply=True);self.assertEqual(r['status'],'MIGRATED');self.assertTrue(r['current_schema']['runtime_crud'])
        self.assertEqual(g._fingerprints(connection),self.before);self.assertEqual(OwnerDataset.objects.get().facts,self.facts)
    def test_repeat_does_not_create_history_or_remove_value(self):
        g.run(connection,ROLE,apply=True)
        CurrentParameter.objects.create(store=self.store,tenant=self.tenant,key='loss_rate',scope_kind='store',sku='',state='VALUE',value='0.12',unit='ratio',origin='manual',revision=1,updated_at=djtime.now(),updated_by=self.customer,definition_hash='a'*64)
        r=g.run(connection,ROLE,apply=True);self.assertTrue(r['already_applied']);self.assertEqual(CurrentParameter.objects.count(),1);self.assertEqual(CurrentParameter.objects.get().value,'0.12')
    def test_missing_default_grant_rolls_back_table_and_recorder(self):
        with connection.cursor()as c:c.execute('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE INSERT,UPDATE,DELETE ON TABLES FROM parameter_test_runtime')
        with self.assertRaises(g.GuardError)as caught:g.run(connection,ROLE,apply=True)
        self.assertEqual(str(caught.exception),'CURRENT_PARAMETER_RUNTIME_CRUD_MISSING');self.assert_old()
    def test_excess_truncate_grant_rolls_back_without_changing_role(self):
        with connection.cursor()as c:c.execute('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT TRUNCATE ON TABLES TO parameter_test_runtime')
        with self.assertRaises(g.GuardError)as caught:g.run(connection,ROLE,apply=True)
        self.assertEqual(str(caught.exception),'CURRENT_PARAMETER_RUNTIME_DDL_PRIVILEGE');self.assert_old()
    def test_preexisting_unrecorded_table_not_overwritten(self):
        with connection.cursor()as c:c.execute('CREATE TABLE owner_data_currentparameter(id integer)')
        with self.assertRaises(g.GuardError)as caught:g.run(connection,ROLE,apply=True)
        self.assertEqual(str(caught.exception),'CURRENT_PARAMETER_TABLE_COLLISION')
        self.assertNotIn(g.TARGET,MigrationRecorder(connection).applied_migrations())
        with connection.cursor()as c:self.assertEqual(len(connection.introspection.get_table_description(c,g.TABLE)),1)
    def test_post_schema_validation_failure_is_atomic(self):
        with patch.object(g,'_schema',side_effect=g.GuardError('INJECTED_SCHEMA_CHECK')):
            with self.assertRaises(g.GuardError):g.run(connection,ROLE,apply=True)
        self.assert_old()
    def test_unrelated_migration_plan_refused(self):
        original=MigrationExecutor.migration_plan
        def other(executor,*args,**kwargs):
            result=original(executor,*args,**kwargs)
            return result+[(executor.loader.get_migration('stores','0002_runtime_bindings'),False)]
        with patch.object(MigrationExecutor,'migration_plan',other):
            with self.assertRaises(g.GuardError)as caught:g.run(connection,ROLE,apply=True)
        self.assertEqual(str(caught.exception),'UNEXPECTED_MIGRATION_PLAN');self.assert_old()
    def test_privileged_runtime_role_refused(self):
        with self.assertRaises(g.GuardError)as caught:g.run(connection,'postgres',apply=True)
        self.assertEqual(str(caught.exception),'RUNTIME_ROLE_SCOPE');self.assert_old()
    def test_missing_recorded_table_not_silently_rebuilt(self):
        g.run(connection,ROLE,apply=True)
        with connection.cursor()as c:c.execute('DROP TABLE owner_data_currentparameter')
        with self.assertRaises(g.GuardError)as caught:g.run(connection,ROLE,apply=True)
        self.assertEqual(str(caught.exception),'CURRENT_PARAMETER_TABLE_COLLISION')
        # Restore only the synthetic migration record so next test starts normally.
        MigrationRecorder(connection).record_unapplied(*g.TARGET)
    def test_existing_current_constraint_drift_refused(self):
        g.run(connection,ROLE,apply=True)
        with connection.cursor()as c:c.execute('ALTER TABLE owner_data_currentparameter DROP CONSTRAINT current_parameter_one')
        with self.assertRaises(g.GuardError)as caught:g.run(connection,ROLE)
        self.assertEqual(str(caught.exception),'CURRENT_PARAMETER_CONSTRAINT_MISSING')

if __name__=='__main__':
    original=socket.socket.connect;attempts=[]
    def confined(sock,address):
        if sock.family!=socket.AF_UNIX:attempts.append('non-unix');raise AssertionError('NO_EXTERNAL_NETWORK')
        return original(sock,address)
    with patch.object(socket.socket,'connect',confined),patch('socket.getaddrinfo',side_effect=AssertionError('NO_DNS')):
        result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Migration))
    receipt={'utc':datetime.now(timezone.utc).isoformat(),'status':'PASS'if result.wasSuccessful()and not attempts else'FAIL','tests':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'skipped':len(result.skipped),'external_connection_attempts':len(attempts),'production_database_changed':False}
    Path(os.environ['MIGRATION_TEST_RECEIPT']).write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt));connection.close();raise SystemExit(0 if receipt['status']=='PASS'else 1)
