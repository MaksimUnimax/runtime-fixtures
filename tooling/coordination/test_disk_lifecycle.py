import json
import hashlib
import os
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


class RetainedArchiveTests(unittest.TestCase):
    setUp = LifecycleTests.setUp
    tearDown = LifecycleTests.tearDown
    begin = LifecycleTests.begin
    proof = LifecycleTests.proof
    def retention(self):
        root = self.root / 'temporary' / 'controller' / 'recovery'
        item = self.reg.begin('CONTROLLER', 'archive-retention',
                              'Preserved completed recovery archives', [str(root)], 1024, 24)
        root.mkdir(parents=True)
        (root / 'one.json').write_text('{"preserved": true}')
        (root / 'one.tar.gz').write_bytes(b'preserved opaque recovery bytes')
        held = self.reg.change(item['id'], 'CONTROLLER', 'hold',
                               'Completed archives retained for recovery',
                               'Controller historical recovery review', 24)
        proof = self.root / 'inventory.json'
        review = self.root / 'independent-review.json'
        self.write_review(held, proof, review)
        return held, root, proof, review

    def write_review(self, item, proof, review, budget=512):
        proof.write_text(json.dumps(self.reg.retained_archive_inventory(item['id'], 'CONTROLLER')))
        review.write_text(json.dumps({'verdict': 'PASS', 'reviewer_role': 'A',
                                     'allocation_id': item['id'],
                                     'inventory_sha256': hashlib.sha256(proof.read_bytes()).hexdigest(),
                                     'reserve_mib': budget, 'fixed_retention_only': True,
                                     'no_active_writers_verified': True}))

    def reconcile(self, item, proof, review, budget=512):
        # Unit fixture uses real descriptors/maps in this process. Other
        # processes may be unreadable in the local CI sandbox; production
        # scanning must still reject that unknown state, tested separately.
        original = Path.iterdir
        process = self.root / 'proc-fixture' / '123'
        process.parent.mkdir(exist_ok=True)
        if not process.is_symlink():
            process.symlink_to('/proc/self', target_is_directory=True)
        def processes(path):
            return iter([process]) if path == Path('/proc') else original(path)
        with patch.object(Path, 'iterdir', processes):
            return self.reg.reconcile_retained(item['id'], 'CONTROLLER', budget, str(proof), str(review))

    def test_fixed_archive_reduction_preserves_bytes_hold_due_and_admission_floor(self):
        item, root, proof, review = self.retention()
        before = {p.name: p.read_bytes() for p in root.iterdir()}
        result = self.reconcile(item, proof, review)
        self.assertEqual(result['state'], 'HELD')
        self.assertEqual(result['due_at'], item['due_at'])
        self.assertEqual(result['consumer'], item['consumer'])
        self.assertEqual(result['reserve_mib'], 512)
        self.assertEqual(result['history'][-1]['previous_reserve_mib'], 1024)
        self.assertEqual(before, {p.name: p.read_bytes() for p in root.iterdir()})
        self.assertEqual(self.reg.status()['all_open_reservations_mib'], 512)
        self.capacity['available_mib'] = dl.RESERVE_MIB + 512 + 15
        with self.assertRaisesRegex(ValueError, 'DISK_CAPACITY_REQUIRED'):
            self.begin('B', reserve=16)
        with self.assertRaisesRegex(ValueError, 'ARTIFACTS_STILL_PRESENT'):
            self.reg.change(item['id'], 'CONTROLLER', 'close', self.proof(item))

    def test_changed_archive_or_inventory_cannot_release_budget(self):
        item, root, proof, review = self.retention()
        (root / 'one.tar.gz').write_bytes(b'new incomplete archive')
        with self.assertRaisesRegex(ValueError, 'RETAINED_INVENTORY_MISMATCH'):
            self.reconcile(item, proof, review)
        self.assertEqual(self.reg.rows()[0]['reserve_mib'], 1024)

    def test_review_must_bind_budget_inventory_and_independent_author(self):
        item, root, proof, review = self.retention()
        original = json.loads(review.read_text())
        for key, value in [('verdict', 'REWORK'), ('reviewer_role', 'CONTROLLER'),
                           ('inventory_sha256', '0' * 64), ('allocation_id', 'other'),
                           ('reserve_mib', 513), ('fixed_retention_only', False),
                           ('no_active_writers_verified', False)]:
            review.write_text(json.dumps(dict(original, **{key: value})))
            with self.assertRaisesRegex(ValueError, 'INDEPENDENT_FIXED_RETENTION_REVIEW_REQUIRED'):
                self.reconcile(item, proof, review)
        self.assertEqual(self.reg.rows()[0]['reserve_mib'], 1024)

    def test_budget_cannot_remove_margin_or_increase_reservation(self):
        item, root, proof, review = self.retention()
        for budget in (16, 256, 1024, 2048):
            self.write_review(item, proof, review, budget)
            with self.assertRaisesRegex(ValueError, 'RETAINED_RESERVE_REDUCTION_WITH_MARGIN_REQUIRED'):
                self.reconcile(item, proof, review, budget)

    def test_archive_inventory_rejects_links_unknown_files_and_missing_pairs(self):
        item, root, proof, review = self.retention()
        extra = root / 'extra.json'
        extra.symlink_to(root / 'one.json')
        with self.assertRaisesRegex(ValueError, 'ONLY_REGULAR_ARCHIVE_PAIRS_ALLOWED'):
            self.reg.retained_archive_inventory(item['id'], 'CONTROLLER')
        extra.unlink()
        (root / 'unknown.txt').write_text('unclassified')
        with self.assertRaisesRegex(ValueError, 'ONLY_REGULAR_ARCHIVE_PAIRS_ALLOWED'):
            self.reg.retained_archive_inventory(item['id'], 'CONTROLLER')
        (root / 'unknown.txt').unlink()
        (root / 'one.json').unlink()
        with self.assertRaisesRegex(ValueError, 'COMPLETE_ARCHIVE_MANIFEST_PAIRS_REQUIRED'):
            self.reg.retained_archive_inventory(item['id'], 'CONTROLLER')

    def test_current_review_does_not_allow_live_writer_or_expired_hold(self):
        item, root, proof, review = self.retention()
        with (root / 'one.tar.gz').open('ab'):
            with self.assertRaisesRegex(ValueError, 'RETAINED_ARCHIVE_ACTIVE_WRITER'):
                self.reconcile(item, proof, review)
        self.now += 86401
        with self.assertRaisesRegex(ValueError, 'CURRENT_HELD_ARCHIVE_REQUIRED'):
            self.reconcile(item, proof, review)
        self.assertEqual(self.reg.rows()[0]['reserve_mib'], 1024)

    def test_read_only_archive_directory_descriptor_blocks_reconcile(self):
        item, root, proof, review = self.retention()
        fd = os.open(root, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
        try:
            with self.assertRaisesRegex(ValueError, 'RETAINED_ARCHIVE_ACTIVE_WRITER'):
                self.reconcile(item, proof, review)
        finally:
            os.close(fd)
        self.assertEqual(self.reg.rows()[0]['reserve_mib'], 1024)

    def test_final_readback_rejects_change_during_admission(self):
        item, root, proof, review = self.retention()
        def changed(_):
            (root / 'one.json').write_text('{"changed": true}')
        with patch.object(self.reg, '_require_no_archive_writers', side_effect=changed):
            with self.assertRaisesRegex(ValueError, 'RETAINED_ARCHIVE_CHANGED'):
                self.reconcile(item, proof, review)
        self.assertEqual(self.reg.rows()[0]['reserve_mib'], 1024)

    def test_stale_inventory_rejected_without_budget_change(self):
        item, root, proof, review = self.retention()
        self.now += 3601
        with self.assertRaisesRegex(ValueError, 'FRESH_RETAINED_INVENTORY_REQUIRED'):
            self.reconcile(item, proof, review)
        self.assertEqual(self.reg.rows()[0]['reserve_mib'], 1024)

    def test_unreadable_process_inventory_fails_closed(self):
        item, root, proof, review = self.retention()
        with patch.object(self.reg, '_require_no_archive_writers', side_effect=PermissionError('unreadable process')):
            with self.assertRaises(PermissionError):
                self.reconcile(item, proof, review)
        self.assertEqual(self.reg.rows()[0]['reserve_mib'], 1024)

    def test_other_role_and_normal_worktree_ineligible(self):
        item = self.begin()
        with self.assertRaisesRegex(ValueError, 'CONTROLLER_RETAINED_ARCHIVE_REQUIRED'):
            self.reg.retained_archive_inventory(item['id'], 'A')
        item = self.begin('CONTROLLER')
        self.reg.change(item['id'], 'CONTROLLER', 'hold', 'Retain source for review', 'Independent source reviewer', 24)
        with self.assertRaisesRegex(ValueError, 'CANONICAL_CONTROLLER_ARCHIVE_REQUIRED'):
            self.reg.retained_archive_inventory(item['id'], 'CONTROLLER')


if __name__=='__main__':
    unittest.main()
