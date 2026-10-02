import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import disk_lifecycle as dl


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        for role in 'ABC':
            (self.root / (role + '.json')).write_text(json.dumps({'status':'RUNNING'}))
        self.now = 1000000
        self.reg = dl.Registry(self.root, clock=lambda:self.now)
        self.reg.seed_baseline()
        self.capacity = {'available_mib':15000,'inodes_free':1000000}
        self.stub = patch.object(self.reg, 'snapshot', side_effect=lambda:dict(self.capacity))
        self.stub.start()

    def tearDown(self):
        self.stub.stop()
        self.tmp.cleanup()

    def begin(self, role='A', task='test-one', name='fixture', reserve=1024):
        lane=role if role!='CONTROLLER' else 'controller'
        path=self.root/'worktrees'/lane/name
        return self.reg.begin(role,task,'Isolated test fixture',[str(path)],reserve,24)

    def proof(self, item):
        path=self.root/'cleanup.json'
        path.write_text(json.dumps({'cleanup_verified':True,'managed_paths':item['paths'],'managed_volumes':item['volumes']}))
        return str(path)

    def test_parallel_roles_reserve_growth_under_one_inventory(self):
        self.begin('A',reserve=2048)
        self.begin('B',reserve=2048)
        self.begin('C',reserve=2048)
        self.assertEqual(self.reg.status()['all_open_reservations_mib'],6144)
        self.capacity['available_mib']=12000
        with self.assertRaisesRegex(ValueError,'DISK_CAPACITY_REQUIRED'):
            self.begin('CONTROLLER',reserve=2048)

    def test_low_disk_rejected_before_any_path_created(self):
        self.capacity['available_mib']=dl.RESERVE_MIB+1023
        with self.assertRaisesRegex(ValueError,'DISK_CAPACITY_REQUIRED'):
            self.begin()
        self.assertEqual(self.reg.rows(),[])
        self.assertFalse((self.root/'worktrees').exists())

    def test_remaining_files_prevent_false_cleanup(self):
        item=self.begin();path=Path(item['paths'][0]);path.mkdir(parents=True)
        (path/'unique.txt').write_text('unique unfinished work')
        with self.assertRaisesRegex(ValueError,'ARTIFACTS_STILL_PRESENT'):
            self.reg.change(item['id'],'A','close',self.proof(item))
        self.assertEqual((path/'unique.txt').read_text(),'unique unfinished work')
        with self.assertRaisesRegex(ValueError,'CLEANUP_NOT_COMPLETE'):
            self.reg.status('A','test-one',complete=True)

    def test_new_task_must_account_for_previous_outputs(self):
        self.begin()
        with self.assertRaisesRegex(ValueError,'PREVIOUS_ARTIFACTS_UNACCOUNTED'):
            self.begin(task='test-two',name='second')
        self.begin(task='test-one',name='parallel-check')

    def test_concrete_hold_retains_budget_and_expires_without_deleting(self):
        item=self.begin();path=Path(item['paths'][0]);path.mkdir(parents=True)
        self.reg.change(item['id'],'A','hold','Unique patch awaiting exact review','Controller review of task test-one',1)
        self.assertEqual(self.reg.status('A','test-one',complete=True)['all_open_reservations_mib'],1024)
        self.begin(task='test-two',name='second')
        self.now+=3601
        with self.assertRaisesRegex(ValueError,'CLEANUP_NOT_COMPLETE'):
            self.reg.status('A','test-one',complete=True)
        self.assertTrue(path.exists())
        self.assertEqual(self.reg.status()['all_open_reservations_mib'],2048)

    def test_close_requires_exact_receipt_then_releases_budget(self):
        item=self.begin()
        wrong=self.root/'wrong.json';wrong.write_text(json.dumps({'cleanup_verified':True,'managed_paths':[]}))
        with self.assertRaisesRegex(ValueError,'CLEANUP_RECEIPT_PATHS'):
            self.reg.change(item['id'],'A','close',str(wrong))
        result=self.reg.change(item['id'],'A','close',self.proof(item))
        self.assertEqual(result['state'],'CLOSED')
        self.assertEqual(len(result['history'][-1]['receipt_sha256']),64)
        self.assertEqual(self.reg.status()['all_open_reservations_mib'],0)

    def test_dangling_symlink_is_still_an_artifact(self):
        item=self.begin();path=Path(item['paths'][0]);path.parent.mkdir(parents=True)
        path.symlink_to(self.root/'absent')
        with self.assertRaisesRegex(ValueError,'ARTIFACTS_STILL_PRESENT'):
            self.reg.change(item['id'],'A','close',self.proof(item))

    def test_canonical_path_role_and_overlap_checks(self):
        for path in [
            self.root/'outside',
            self.root/'worktrees'/'B'/'other',
            self.root/'worktrees'/'A',
            self.root/'worktrees'/'A'/'task'/'nested',
            self.root/'temporary'/'A'/'task'/'nested',
            self.root/'logs'/'A'/'temporary-task',
        ]:
            with self.assertRaisesRegex(ValueError,'USE_CANONICAL'):
                self.reg.begin('A','test-one','A concrete purpose',[str(path)],64,1)
        owned=self.root/'worktrees'/'A';owned.mkdir(parents=True)
        (owned/'symlink').symlink_to(self.root)
        with self.assertRaisesRegex(ValueError,'USE_CANONICAL'):
            self.reg.begin('A','test-one','A concrete purpose',[str(owned/'symlink'/'new')],64,1)
        (owned/'symlink').unlink()
        self.begin()

    def test_stop_forbids_new_allocation_but_allows_safe_closure(self):
        item=self.begin()
        (self.root/'A.json').write_text(json.dumps({'status':'STOPPED'}))
        with self.assertRaisesRegex(ValueError,'ROLE_NOT_RUNNING'):
            self.begin(name='after-stop')
        self.reg.change(item['id'],'A','close',self.proof(item))

    def test_unknown_or_corrupt_registry_fails_closed(self):
        self.begin()
        (self.reg.directory/'broken.json').write_text('{}')
        with self.assertRaisesRegex(ValueError,'INVALID_REGISTRY'):
            self.begin('B')

    def test_no_inventory_is_not_cleanup_proof(self):
        with self.assertRaisesRegex(ValueError,'ARTIFACT_INVENTORY_MISSING'):
            self.reg.status('A','never-registered',complete=True)

    def test_readonly_task_can_honestly_declare_no_outputs(self):
        item=self.reg.declare_none('A','read-only','Read existing git objects only; no files or volumes created')
        self.assertEqual(item['kind'],'NO_TEMPORARY_OUTPUTS')
        self.assertEqual(self.reg.status('A','read-only',complete=True)['unresolved'],[])
        self.assertEqual(self.reg.status()['all_open_reservations_mib'],0)
        self.begin()
        with self.assertRaisesRegex(ValueError,'TASK_ALREADY_HAS_INVENTORY'):
            self.reg.declare_none('A','test-one','Cannot hide an actual allocation')

    def test_new_unregistered_managed_root_blocks_new_work_and_readonly_claim(self):
        rogue=self.root/'worktrees'/'A'/'rogue-review';rogue.mkdir(parents=True)
        guard=self.reg.status('A')['managed_guard']
        self.assertEqual([row['path'] for row in guard['unregistered_managed_paths']],[str(rogue)])
        with self.assertRaisesRegex(ValueError,'UNREGISTERED_MANAGED_PATHS'):
            self.begin(name='registered-after-rogue')
        with self.assertRaisesRegex(ValueError,'UNREGISTERED_MANAGED_PATHS'):
            self.reg.declare_none('A','read-after-rogue','No outputs were intended but rogue output exists')

    def test_registered_managed_root_is_allowed_until_cleanup(self):
        item=self.begin();path=Path(item['paths'][0]);path.mkdir(parents=True)
        self.assertEqual(self.reg.status('A')['managed_guard']['unregistered_managed_paths'],[])
        path.rmdir();self.reg.change(item['id'],'A','close',self.proof(item))
        self.assertEqual(self.reg.status('A','test-one',complete=True)['managed_guard']['unregistered_managed_paths'],[])

    def test_legacy_registered_descendant_does_not_mask_unregistered_parent_or_siblings(self):
        parent=self.root/'worktrees'/'A'/'legacy-task';declared=parent/'declared'
        declared.mkdir(parents=True);(parent/'forgotten-cache').mkdir()
        rows=[{'state':'OPEN','paths':[str(declared)]}]
        paths=[row['path'] for row in self.reg.managed_guard(rows,'A')['unregistered_managed_paths']]
        self.assertEqual(paths,[str(parent)])

    def test_recreated_grandfathered_name_is_not_silently_trusted(self):
        other=self.root/'other';other.mkdir()
        for role in 'ABC':(other/(role+'.json')).write_text(json.dumps({'status':'RUNNING'}))
        legacy=other/'worktrees'/'A'/'legacy';legacy.mkdir(parents=True)
        reg=dl.Registry(other,clock=lambda:self.now);reg.seed_baseline()
        legacy.rmdir();legacy.mkdir()
        paths=[row['path'] for row in reg.status('A')['managed_guard']['unregistered_managed_paths']]
        self.assertEqual(paths,[str(legacy)])

    def test_baseline_is_required_and_cannot_be_resealed(self):
        other=self.root/'fresh';other.mkdir()
        for role in 'ABC':(other/(role+'.json')).write_text(json.dumps({'status':'RUNNING'}))
        reg=dl.Registry(other,clock=lambda:self.now)
        with self.assertRaisesRegex(ValueError,'BASELINE_REQUIRED'):
            reg.begin('A','first','Fresh output requires sealed baseline',[str(other/'worktrees/A/x')],64,1)
        reg.seed_baseline()
        with self.assertRaisesRegex(ValueError,'BASELINE_ALREADY_EXISTS'):
            reg.seed_baseline()

    def test_dependency_store_inside_task_root_prevents_early_close(self):
        item=self.begin();path=Path(item['paths'][0]);store=path/'task-cache'/'pnpm'
        store.mkdir(parents=True);(store/'downloaded-package').write_bytes(b'cache')
        with self.assertRaisesRegex(ValueError,'ARTIFACTS_STILL_PRESENT'):
            self.reg.change(item['id'],'A','close',self.proof(item))
        self.assertIn('TASK_LOCAL_STORES',item['cache_policy'])

    def test_inode_shortage_and_nonfinite_expiry_rejected(self):
        self.capacity['inodes_free']=100
        with self.assertRaisesRegex(ValueError,'DISK_CAPACITY_REQUIRED'):
            self.begin()
        with self.assertRaisesRegex(ValueError,'BOUNDED_HOURS'):
            self.reg.begin('A','test-one','A concrete purpose',[str(self.root/'worktrees/A/x')],64,float('nan'))

    def test_volume_is_not_forgotten_when_container_was_removed(self):
        name='octoport-a-fixture-db'
        with patch.object(self.reg,'volume_exists',return_value=False):
            item=self.reg.begin('A','test-one','Disposable integration database',[],512,1,[name])
        with patch.object(self.reg,'volume_exists',return_value=True):
            with self.assertRaisesRegex(ValueError,'DOCKER_VOLUMES_STILL_PRESENT'):
                self.reg.change(item['id'],'A','close',self.proof(item))
        with patch.object(self.reg,'volume_exists',return_value=False):
            self.reg.change(item['id'],'A','close',self.proof(item))

    def test_existing_or_unowned_volume_rejected(self):
        with self.assertRaisesRegex(ValueError,'OWNED_NAMED_VOLUME'):
            self.reg.begin('A','test-one','Disposable integration database',[],512,1,['unowned'])
        with patch.object(self.reg,'volume_exists',return_value=True):
            with self.assertRaisesRegex(ValueError,'NEW_VOLUME_ALREADY_EXISTS'):
                self.reg.begin('A','test-one','Disposable integration database',[],512,1,['octoport-a-fixture'])


if __name__=='__main__':
    unittest.main()
