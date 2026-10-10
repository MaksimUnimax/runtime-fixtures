import json
import hashlib
import os
from pathlib import Path
import sys
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

    def controller_authored_source(self, task='delegated-source'):
        """Build a native-reader-valid CLOSED registration and state chain."""
        from task_publication import _canonical_bytes, _read_registration
        from work_queue import (_publication_completion_candidate,
                                _publication_task_fingerprint, PUBLICATION_REQUIRED_CI)
        item = self.begin('CONTROLLER', task=task, name='source-author', reserve=64)
        worktree = Path(item['paths'][0])
        worktree.mkdir(parents=True)
        self.reg.change(item['id'], 'CONTROLLER', 'hold',
                        'Exact published source required for independent review',
                        'Controller active exact source review consumer', 12)
        task_paths = ['packages/server/credential-transfer/src/index.ts']
        board = self.root / 'controllers' / 'work-board.json'
        board.parent.mkdir(parents=True, exist_ok=True)
        task_entry = {'id': task, 'role': 'A', 'plan': 'C00',
                      'state': 'IN_PROGRESS', 'requires': [],
                      'result': 'Delegated native CONTROLLER producer source',
                      'acceptance': ['Verified source and issuer inventory'],
                      'paths': task_paths}
        board.write_text(json.dumps({
            'version': 1, 'revision': 1,
            'updated_at': '2026-10-08T00:00:00+00:00',
            'tasks': [task_entry]}))
        evidence = self.root / 'controllers' / 'audits'
        evidence.mkdir(parents=True, exist_ok=True)
        head, tree, base = 'a' * 40, 'b' * 40, 'c' * 40
        review_file = evidence / 'review.json'
        review_file.write_text(json.dumps({'verdict': 'PASS', 'candidate_sha': head}))
        manifest_file = evidence / 'accepted.json'
        manifest_file.write_text(json.dumps({'accepted': [{
            'task_id': task, 'source_head': head, 'source_tree': tree,
            'source_base': base, 'exact_task_paths': task_paths}]}))
        def attested(path):
            return {'path': str(path),
                    'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
        task_branch = 'test/publication/delegated-source'
        core = {
            'role': 'A', 'task_id': task, 'worktree_path': str(worktree),
            'candidate_head': head, 'candidate_tree': tree,
            'base_sha': base, 'task_paths': task_paths,
            'task_ref': 'refs/heads/' + task_branch,
            'task_branch': task_branch,
            'task_fingerprint': _publication_task_fingerprint(task_entry),
            'bundle_manifest_sha256': 'd' * 64,
            'review': attested(review_file),
            'accepted_manifest': attested(manifest_file),
        }
        rid = hashlib.sha256(_canonical_bytes(core)).hexdigest()
        close_file = (self.root / 'controllers' / 'task-publication' /
                      'close' / rid / 'receipt.json')
        close_file.parent.mkdir(parents=True, exist_ok=True)
        close_file.write_text(json.dumps({
            'kind': 'octoport.task-publication-close', 'version': 1,
            'registration_id': rid, 'state_before': 'PUBLISHED'}))
        registration_file = (self.root / 'controllers' / 'task-publication' /
                             'registrations' / (rid + '.json'))
        registration_file.parent.mkdir(parents=True, exist_ok=True)
        states = (registration_file.parent.parent / 'states' / rid)
        states.mkdir(parents=True, exist_ok=True)
        ready_file = (self.root / 'controllers' / 'task-publication' /
                      'ready' / rid / '5.json')
        ready_file.parent.mkdir(parents=True, exist_ok=True)
        ready = {
            'kind': 'octoport.task-publication-ready', 'version': 1,
            'registration_id': rid, 'registration_sha256': rid,
            'registration_state_version': 5,
            'task_id': task, 'role': 'A',
            'candidate_head': head, 'candidate_tree': tree, 'base_sha': base,
            'task_fingerprint': core['task_fingerprint'],
            'task_ref': core['task_ref'], 'task_branch': task_branch,
            'review': core['review'],
            'bundle_manifest_sha256': core['bundle_manifest_sha256'],
            'ci': {'status': 'PASS', 'head': head, 'branch': task_branch,
                   'runs': [
                       {'name': name, 'id': 1000 + index, 'status': 'completed',
                        'conclusion': 'success'}
                       for index, name in enumerate(PUBLICATION_REQUIRED_CI)
                   ]},
        }
        ready_file.write_text(json.dumps(ready, ensure_ascii=False, indent=2) + '\n')
        ready_ref = attested(ready_file)
        registration = {
            'kind': 'octoport.task-publication-registration', 'version': 1,
            'registration_id': rid, 'registration_sha256': rid,
            'core': core,
        }
        # All five workflow names and IDs above are synthetic unit fixtures:
        # they validate native completion proof structure, not real GitHub CI.
        # Exercise the native publisher's actual successful staged sequence,
        # rather than assigning CLOSED to an otherwise invented v1 record.
        stages = (
            'REGISTERED', 'REGISTERED', 'PUSHING_TASK_REF',
            'TASK_REF_PUBLISHED', 'READY', 'PUBLISHING_MAIN',
            'PUBLISHED', 'CLEANING_TASK_REF', 'PUBLISHED', 'CLOSED',
        )
        preceding = None
        for n, state in enumerate(stages, 1):
            record = dict(registration, state=state, state_version=n)
            if n >= 5:
                record['ready_receipt'] = ready_ref
            if n >= 9:
                record['task_ref_cleanup_status'] = 'DELETED'
            if n == len(stages):
                record['close_receipt'] = attested(close_file)
            if preceding is not None:
                record['previous_state_sha256'] = hashlib.sha256(preceding).hexdigest()
            encoded = (json.dumps(record, ensure_ascii=False, indent=2) + '\n').encode()
            (states / f'{n}.json').write_bytes(encoded)
            preceding = encoded
        registration_file.write_bytes(preceding)
        validated, _ = _read_registration(self.root, rid)
        self.assertEqual(validated['state'], 'CLOSED')
        self.assertEqual(validated['core']['worktree_path'], str(worktree))
        source_head, proof = _publication_completion_candidate(
            self.root, 'A', task_entry, rid)
        self.assertEqual(source_head, head)
        self.assertEqual(proof['registration_id'], rid)
        return item, registration_file, board, close_file

    def test_owner_approved_three_gib_floor_exact_admission_boundary(self):
        # Policy: 2026-10-08 owner lowered the retained free-space floor.
        self.assertEqual(dl.RESERVE_MIB, 3072)
        self.capacity['available_mib'] = 3072 + 128 - 1
        with self.assertRaisesRegex(ValueError, 'DISK_CAPACITY_REQUIRED'):
            self.begin(name='below-current-owner-floor', reserve=128)
        self.assertEqual(self.reg.rows(), [])
        self.capacity['available_mib'] = 3072 + 128
        admitted = self.begin(name='at-current-owner-floor', reserve=128)
        self.assertEqual(admitted['reserve_mib'], 128)
        self.assertEqual(self.reg.status()['reserve_floor_mib'], 3072)

    def test_parallel_roles_reserve_growth_under_one_inventory(self):
        self.begin('A',reserve=2048)
        self.begin('B',reserve=2048)
        self.begin('C',reserve=2048)
        self.assertEqual(self.reg.status()['all_open_reservations_mib'],6144)
        # Owner floor 3072 + 6144 active + 2048 proposed = 11264 MiB.
        self.capacity['available_mib']=11000
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
        local = self.reg.status('A','read-only',complete=True)
        self.assertEqual(local['unresolved'],[])
        self.assertEqual(local['delegation_inventory_version'], 1)
        self.assertIs(local['delegation_inventory_attested'], True)
        self.assertEqual(local['foreign_allocation_count'], 0)
        self.assertIsNone(local['delegated_publication_registration'])
        self.assertEqual(self.reg.status()['all_open_reservations_mib'],0)
        self.begin()
        with self.assertRaisesRegex(ValueError,'TASK_ALREADY_HAS_INVENTORY'):
            self.reg.declare_none('A','test-one','Cannot hide an actual allocation')

    def test_zero_foreign_attestation_rejects_unregistered_controller_root(self):
        # A missing CONTROLLER allocation row is not positive proof that
        # no controller-produced directory exists. Zero-foreign completion
        # checks both A's managed lane and the CONTROLLER producer lane.
        self.reg.declare_none(
            'A', 'local-zero', 'Read-only A consumer with no temporary files')
        scoped = self.reg.status('A', 'local-zero', complete=True)
        self.assertIs(type(scoped['foreign_allocation_count']), int)
        self.assertEqual(scoped['foreign_allocation_count'], 0)
        hidden = self.root / 'worktrees' / 'controller' / 'unregistered-source'
        hidden.mkdir(parents=True)
        with self.assertRaisesRegex(ValueError, 'UNREGISTERED_MANAGED_PATHS'):
            self.reg.status('A', 'local-zero', complete=True)

    def test_same_role_and_global_inventory_do_not_claim_foreign_publisher(self):
        item = self.begin('A', task='local-only', name='local-owned', reserve=64)
        # OPEN is not completion inventory. A current HELD resource with an
        # exact consumer can be accounted for without falsely claiming a
        # foreign publisher; accepting the former would weaken the gate.
        with self.assertRaisesRegex(ValueError, 'CLEANUP_NOT_COMPLETE'):
            self.reg.status('A', 'local-only', complete=True)
        self.reg.change(
            item['id'], 'A', 'hold',
            'Local source retained for the exact completion reviewer',
            'Independent reviewer of local-only role-A source', 2,
        )
        scoped = self.reg.status('A', 'local-only', complete=True)
        self.assertEqual(scoped['delegation_inventory_version'], 1)
        self.assertIs(type(scoped['delegation_inventory_version']), int)
        self.assertIs(scoped['delegation_inventory_attested'], True)
        self.assertEqual(scoped['foreign_allocation_count'], 0)
        self.assertIs(type(scoped['foreign_allocation_count']), int)
        self.assertIsNone(scoped['delegated_publication_registration'])
        unscoped = self.reg.status()
        self.assertNotIn('delegation_inventory_attested', unscoped)
        self.assertNotIn('delegated_publication_registration', unscoped)

    def test_controller_authored_role_A_published_resource_counts_without_false_zero(self):
        item, registration, board, receipt = self.controller_authored_source()
        result = self.reg.status('A', 'delegated-source', complete=True)
        self.assertEqual(result['unresolved'], [])
        self.assertEqual([x['id'] for x in result['allocations']], [item['id']])
        self.assertEqual(result['allocations'][0]['role'], 'CONTROLLER')
        self.assertEqual(result['delegation_inventory_version'], 1)
        self.assertIs(type(result['delegation_inventory_version']), int)
        self.assertIs(result['delegation_inventory_attested'], True)
        self.assertEqual(result['foreign_allocation_count'], 1)
        self.assertIs(type(result['foreign_allocation_count']), int)
        self.assertEqual(result['delegated_publication_registration'], registration.stem)
        self.assertRegex(result['delegated_publication_registration'], r'^[0-9a-f]{64}$')
        self.assertEqual(result['all_open_reservations_mib'], 64)
        self.assertFalse(result['managed_guard']['unregistered_managed_paths'])
        self.assertTrue(Path(item['paths'][0]).exists())

    def test_controller_sealed_precommit_retry_cannot_auto_reopen_via_in_progress(self):
        item, registration, board, receipt = self.controller_authored_source()
        for sealed in ('SEALING', 'SEALED'):
            self.reg.record_completion_state('A', 'delegated-source', sealed)
            with self.assertRaisesRegex(
                    ValueError, 'CROSS_ROLE_REOPEN_JOURNAL_AUTHORITY_REQUIRED'):
                self.reg.reopen_if_completion_locked('A', 'delegated-source')
            # The previously unguarded direct error-handler path must not
            # bypass the same persisted transition invariant.
            with self.assertRaisesRegex(
                    ValueError, 'CROSS_ROLE_REOPEN_JOURNAL_AUTHORITY_REQUIRED'):
                self.reg.record_completion_state('A', 'delegated-source', 'REOPENED')
            self.assertEqual(
                self.reg.completion_record('A', 'delegated-source')['state'], sealed)
            with self.assertRaisesRegex(ValueError, 'TASK_DISK_LIFECYCLE_ALREADY_COMPLETED'):
                self.begin('CONTROLLER', task='delegated-source',
                           name='late-new-resource-after-ambiguous-seal', reserve=64)

    def test_closed_foreign_allocation_still_requires_journal_recovery(self):
        # A finished controller source still has a historical allocation row.
        # An ambiguous IN_PROGRESS+SEALED queue transaction must not reopen it
        # merely because the controller's temporary worktree was cleaned.
        item, _, _, _ = self.controller_authored_source()
        Path(item['paths'][0]).rmdir()
        closed = self.reg.change(item['id'], 'CONTROLLER', 'close', self.proof(item))
        self.assertEqual(closed['state'], 'CLOSED')
        for sealed in ('SEALING', 'SEALED'):
            self.reg.record_completion_state('A', 'delegated-source', sealed)
            with self.assertRaisesRegex(
                    ValueError, 'CROSS_ROLE_REOPEN_JOURNAL_AUTHORITY_REQUIRED'):
                self.reg.reopen_if_completion_locked('A', 'delegated-source')
            # The previously unguarded direct error-handler path must not
            # bypass the same persisted transition invariant.
            with self.assertRaisesRegex(
                    ValueError, 'CROSS_ROLE_REOPEN_JOURNAL_AUTHORITY_REQUIRED'):
                self.reg.record_completion_state('A', 'delegated-source', 'REOPENED')
            self.assertEqual(
                self.reg.completion_record('A', 'delegated-source')['state'], sealed)
            # Closing the original CONTROLLER allocation does not permit a
            # new producer root or a misleading no-output declaration.
            with self.assertRaisesRegex(ValueError, 'TASK_DISK_LIFECYCLE_ALREADY_COMPLETED'):
                self.begin('CONTROLLER', task='delegated-source',
                           name='late-after-clean-source', reserve=64)
            with self.assertRaisesRegex(ValueError, 'TASK_DISK_LIFECYCLE_ALREADY_COMPLETED'):
                self.reg.declare_none(
                    'CONTROLLER', 'delegated-source',
                    'No new outputs allowed after delegated source seal')

    def test_control_seal_holds_lifecycle_lock_through_delayed_queue(self):
        """The new V2 queue guard retains disk.lock through commit (mock only)."""
        import threading
        from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
        import control

        item, registration, _, _ = self.controller_authored_source()
        queue_entered = threading.Event()
        queue_release = threading.Event()
        producer_entered = threading.Event()
        attempted = self.root / "worktrees" / "controller" / "late-atomic-interleave"

        def delayed_queue(_root, role, task, state, _receipt, _summary, **kw):
            self.assertEqual((role, task, state), ("A", "delegated-source", "DONE"))
            with kw["resource_lock"]():
                with kw["completion_guard"](
                        "IN_PROGRESS", {"id": "delegated-source",
                                        "role": "A", "state": "DONE"}):
                    queue_entered.set()
                    if not queue_release.wait(timeout=4):
                        raise RuntimeError("TEST_QUEUE_BARRIER_TIMEOUT")
                    return {"state": "DONE"}

        def concurrent_producer():
            producer_entered.set()
            try:
                self.reg.begin(
                    "CONTROLLER", "delegated-source",
                    "Concurrent producer against held native DONE lock",
                    [str(attempted)], 64, 24)
            except ValueError as error:
                return str(error)
            return "UNEXPECTED_ALLOCATION_ADMITTED"

        with (
            patch.object(control, "DiskLifecycleRegistry", return_value=self.reg),
            patch.object(control, "advance_task", side_effect=delayed_queue),
            ThreadPoolExecutor(max_workers=2) as executor,
        ):
            queue_future = executor.submit(
                control.advance_queue_task, "A", "delegated-source", "DONE",
                "source-receipt", "Bounded guarded queue writer",
                publication_registration=registration.stem, control_root=self.root)
            try:
                self.assertTrue(queue_entered.wait(timeout=3))
                future = executor.submit(concurrent_producer)
                self.assertTrue(producer_entered.wait(timeout=3))
                with self.assertRaises(FutureTimeout):
                    future.result(timeout=0.06)
            finally:
                queue_release.set()
            self.assertEqual(queue_future.result(timeout=4), {"state": "DONE"})
            self.assertIn("TASK_DISK_LIFECYCLE_ALREADY_COMPLETED",
                          future.result(timeout=4))
        self.assertEqual(self.reg.completion_record(
            "A", "delegated-source")["state"], "SEALED")
        self.assertFalse(attempted.exists())
        self.assertTrue(Path(item["paths"][0]).exists())

    def test_control_entrypoint_mocked_queue_precommit_keeps_exact_sealing(self):
        """A queue error BEFORE its callback must not fabricate a disk seal."""
        import control

        item, _, board, _ = self.controller_authored_source()
        raw = board.read_bytes()
        with (
            patch.object(control, "DiskLifecycleRegistry", return_value=self.reg),
            patch.object(control, "advance_task",
                         side_effect=RuntimeError("SIMULATED_PRECOMMIT_FAILURE")),
        ):
            with self.assertRaisesRegex(RuntimeError,
                                        "SIMULATED_PRECOMMIT_FAILURE"):
                control.advance_queue_task(
                    "A", "delegated-source", "DONE", "reviewed-source-receipt",
                    "Failure before guarded queue callback", control_root=self.root)
        self.assertIsNone(self.reg.completion_record("A", "delegated-source"))
        self.assertEqual(board.read_bytes(), raw)
        self.assertTrue(Path(item["paths"][0]).exists())

    def test_control_entrypoint_mocked_queue_postcommit_keeps_exact_sealing(self):
        """After native guard seals, an event error must preserve SEALED.

        Synthetic V1 DONE written by the fake queue is not V2 acceptance.
        """
        import control

        _, registration, board, receipt = self.controller_authored_source()

        def fake_committed_error(_root, _role, _task, _state,
                                 _receipt, _summary, **kw):
            with kw["resource_lock"]():
                with kw["completion_guard"](
                        "IN_PROGRESS", {"id": "delegated-source",
                                        "role": "A", "state": "DONE"}):
                    board_value = json.loads(board.read_text())
                    board_value["tasks"][0]["state"] = "DONE"
                    board_value["tasks"][0]["completion_receipt"] = str(receipt)
                    board.write_text(json.dumps(board_value))
            raise RuntimeError("SIMULATED_EVENT_DURABILITY_FAILURE")

        with (
            patch.object(control, "DiskLifecycleRegistry", return_value=self.reg),
            patch.object(control, "advance_task", side_effect=fake_committed_error),
        ):
            with self.assertRaisesRegex(RuntimeError,
                                        "SIMULATED_EVENT_DURABILITY_FAILURE"):
                control.advance_queue_task(
                    "A", "delegated-source", "DONE", "reviewed-source-receipt",
                    "Postcommit error with guarded resource seal",
                    publication_registration=registration.stem,
                    control_root=self.root)
        current = self.reg.completion_record("A", "delegated-source")
        self.assertEqual(current["state"], "SEALED")
        self.assertEqual([x["state"] for x in current["history"]],
                         ["SEALING", "SEALED"])
        self.assertEqual(json.loads(board.read_text())["tasks"][0]["state"], "DONE")
        with self.assertRaisesRegex(
                ValueError, "CROSS_ROLE_REOPEN_JOURNAL_AUTHORITY_REQUIRED"):
            self.reg.reopen_if_completion_locked("A", "delegated-source")
        with self.assertRaisesRegex(
                ValueError, "TASK_DISK_LIFECYCLE_ALREADY_COMPLETED"):
            self.begin("CONTROLLER", task="delegated-source",
                       name="after-postcommit-error", reserve=64)

    def test_control_entrypoint_mocked_queue_same_state_keeps_closed_foreign_seal(self):
        """Same-state IN_PROGRESS must reject stale SEALED before queue write."""
        import control

        item, _, board, _ = self.controller_authored_source()
        Path(item["paths"][0]).rmdir()
        self.assertEqual(self.reg.change(
            item["id"], "CONTROLLER", "close", self.proof(item))["state"], "CLOSED")
        self.reg.record_completion_state("A", "delegated-source", "SEALED")
        raw = board.read_bytes()

        def guarded_same_state(_root, _role, _task, _state,
                               _receipt, _summary, **kw):
            with kw["resource_lock"]():
                with kw["completion_guard"](
                        "IN_PROGRESS", {"id": "delegated-source", "role": "A",
                                        "state": "IN_PROGRESS"}):
                    return {"state": "IN_PROGRESS"}

        with (
            patch.object(control, "DiskLifecycleRegistry", return_value=self.reg),
            patch.object(control, "advance_task",
                         side_effect=guarded_same_state) as queue,
        ):
            with self.assertRaisesRegex(
                    RuntimeError, "WORK_QUEUE_RESOURCE_JOURNAL_RECOVERY_REQUIRED"):
                control.advance_queue_task(
                    "A", "delegated-source", "IN_PROGRESS",
                    "synthetic-non-rework-receipt", "Same-state retry only",
                    control_root=self.root)
        queue.assert_called_once()
        current = self.reg.completion_record("A", "delegated-source")
        self.assertEqual(current["state"], "SEALED")
        self.assertEqual([x["state"] for x in current["history"]], ["SEALED"])
        self.assertEqual(board.read_bytes(), raw)
        with self.assertRaisesRegex(
                ValueError, "TASK_DISK_LIFECYCLE_ALREADY_COMPLETED"):
            self.begin("CONTROLLER", task="delegated-source",
                       name="late-after-benign-queue-retry", reserve=64)

    def test_single_role_explicit_rework_auto_reopen_semantics_remain(self):
        self.begin('A', task='same-role-rework',
                   name='original-source', reserve=64)
        self.reg.record_completion_state('A', 'same-role-rework', 'SEALED')
        reopened = self.reg.reopen_if_completion_locked('A', 'same-role-rework')
        self.assertEqual(reopened['state'], 'REOPENED')
        self.assertEqual(
            self.reg.completion_record('A', 'same-role-rework')['state'], 'REOPENED')
        # Same-role explicit rework retains the old transition behavior,
        # including the direct issuer call after another seal.
        self.reg.record_completion_state('A', 'same-role-rework', 'SEALED')
        direct = self.reg.record_completion_state('A', 'same-role-rework', 'REOPENED')
        self.assertEqual(direct['state'], 'REOPENED')

    def test_controller_authored_completion_requires_task_role_and_native_close(self):
        item, registration, board, receipt = self.controller_authored_source()
        previous_raw = registration.read_bytes()
        previous = json.loads(previous_raw)
        for field, value in [('state', 'READY'),
                             ('task_ref_cleanup_status', 'PENDING')]:
            amended = dict(previous, **{field: value})
            registration.write_text(json.dumps(amended))
            with self.assertRaisesRegex(ValueError, 'CROSS_ROLE_NATIVE_PUBLISHER_INVALID'):
                self.reg.status('A', 'delegated-source', complete=True)
        registration.write_bytes(previous_raw)
        receipt.write_text(json.dumps({'kind': 'modified'}))
        with self.assertRaisesRegex(ValueError, 'CROSS_ROLE_NATIVE_COMPLETION_PROOF_INVALID'):
            self.reg.status('A', 'delegated-source', complete=True)
        del receipt
        changed_board = json.loads(board.read_text())
        changed_board['tasks'][0]['role'] = 'C'
        board.write_text(json.dumps(changed_board))
        with self.assertRaisesRegex(ValueError, 'CROSS_ROLE_TASK_IDENTITY_MISMATCH'):
            self.reg.status('A', 'delegated-source', complete=True)

    def test_controller_authored_completion_denies_forged_source_and_ledger(self):
        item, registration, board, receipt = self.controller_authored_source()
        original_raw = registration.read_bytes()
        tampered = json.loads(original_raw)
        tampered['core']['candidate_head'] = 'e' * 40
        registration.write_text(json.dumps(tampered))
        with self.assertRaisesRegex(ValueError, 'CROSS_ROLE_NATIVE_PUBLISHER_INVALID'):
            self.reg.status('A', 'delegated-source', complete=True)
        registration.write_bytes(original_raw)
        rejected = json.loads(registration.read_text())
        rejected['core']['task_id'] = 'unrelated-task'
        registration.write_text(json.dumps(rejected))
        with self.assertRaisesRegex(ValueError, 'CROSS_ROLE_PUBLICATION_NOT_FOUND_FOR_RESOURCE'):
            self.reg.status('A', 'delegated-source', complete=True)

    def test_controller_authored_refuses_symlinked_review_receipt(self):
        item, registration, board, receipt = self.controller_authored_source()
        data = json.loads(registration.read_text())
        review = Path(data['core']['review']['path'])
        preserved = self.root / 'preserved-review.json'
        preserved.write_bytes(review.read_bytes())
        review.unlink()
        review.symlink_to(preserved)
        # A SHA-equal target is not sufficient when the exact reviewed path
        # has been replaced with a different filesystem entry.
        with self.assertRaisesRegex(ValueError, 'CROSS_ROLE_PUBLICATION_RECEIPT_INVALID'):
            self.reg.status('A', 'delegated-source', complete=True)

    def test_fabricated_closed_registration_without_native_state_chain_fails(self):
        item, registration, board, receipt = self.controller_authored_source()
        synthetic_id = 'f' * 64
        forged = json.loads(registration.read_text())
        forged['registration_id'] = synthetic_id
        forged['registration_sha256'] = synthetic_id
        (registration.parent / (synthetic_id + '.json')).write_text(json.dumps(forged))
        registration.unlink()
        # A self-hashed role/review/close JSON does not establish a native
        # publisher: no canonical core SHA or immutable states chain exists.
        with self.assertRaisesRegex(ValueError, 'CROSS_ROLE_NATIVE_PUBLISHER_INVALID'):
            self.reg.status('A', 'delegated-source', complete=True)

    def test_native_v2_archived_done_is_visible_and_ledger_tampering_fails_closed(self):
        """Exercise real V1->V2 migration/archival, not a hot-only mock."""
        import datetime as dt
        import subprocess
        import work_board_v2 as v2
        import work_board_v2_migrate as migrate
        import work_queue

        item, registration, board, receipt = self.controller_authored_source()
        migrated = json.loads(board.read_text())
        migrated['tasks'][0].update(state='DONE',
                                    completion_receipt=str(receipt))
        raw = (json.dumps(migrated, ensure_ascii=False, indent=2) + '\n').encode()
        board.write_bytes(raw)
        readers = {role: Path(work_queue.__file__).resolve()
                   for role in ('A', 'B', 'C', 'ORG')}
        origin = Path(work_queue.__file__).resolve().parents[2]
        head = subprocess.check_output(
            ['git', '-C', str(origin), 'rev-parse', 'HEAD'], text=True).strip()
        digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
        now = dt.datetime.now(dt.timezone.utc)
        authorization = {
            'id': 'a-delegated-archive-fixture',
            'status': 'GRANTED', 'authority': migrate.AUTHORITY_KIND,
            'issued_at': (now - dt.timedelta(seconds=2)).isoformat(),
            'expires_at': (now + dt.timedelta(hours=1)).isoformat(),
            'corrected_scope_sha256': migrate.SCOPE_SHA256,
            'source_candidate_sha': head,
            'work_queue_sha256': digest(Path(work_queue.__file__)),
            'work_board_v2_sha256': digest(Path(v2.__file__)),
            'migrate_sha256': digest(Path(migrate.__file__)),
            'expected_v1_revision': migrated['revision'],
            'expected_v1_sha256': hashlib.sha256(raw).hexdigest(),
            'reader_sha256': {role: digest(path) for role, path in readers.items()},
            'single_use': True,
        }
        authority = (self.root / 'authorizations' /
                     ('CONTROLLER-WORK-BOARD-V2-MIGRATION-' +
                      authorization['id'] + '.json'))
        authority.parent.mkdir(parents=True, exist_ok=True)
        authority.write_text(json.dumps(authorization, sort_keys=True) + '\n')
        authority.chmod(0o600)
        proof = migrate.migrate(
            self.root, authority, readers, migrated['revision'],
            hashlib.sha256(raw).hexdigest())
        self.assertEqual(proof['state'], 'COMMITTED')
        hot = json.loads(board.read_text())
        self.assertEqual(hot['version'], 2)
        self.assertEqual(hot['completed_count'], 1)
        self.assertEqual(hot['tasks'], [])
        logical = work_queue.load_board(self.root)
        self.assertEqual([(row['id'], row['state'])
                          for row in logical['tasks']],
                         [('delegated-source', 'DONE')])

        # A V2 archived DONE must be found but cannot be re-attested before
        # the administrative resource seal is durably SEALED.
        with self.assertRaisesRegex(
                ValueError, 'CROSS_ROLE_COMPLETION_SEAL_REQUIRED'):
            self.reg.status('A', 'delegated-source', complete=True)
        self.reg.record_completion_state('A', 'delegated-source', 'SEALED')
        accepted = self.reg.status('A', 'delegated-source', complete=True)
        self.assertEqual(accepted['foreign_allocation_count'], 1)
        self.assertEqual(accepted['delegated_publication_registration'],
                         registration.stem)
        self.assertEqual([row['id'] for row in accepted['allocations']],
                         [item['id']])

        # A corrupt V2 hot/archival source must never silently degrade to
        # 'zero tasks' or become an accepted completion attestation.
        board.write_bytes(b'{"version":2,"tasks":[]}')
        with self.assertRaisesRegex(
                ValueError, 'CROSS_ROLE_TASK_LEDGER_UNVERIFIED'):
            self.reg.status('A', 'delegated-source', complete=True)

    def test_native_delegated_resource_stays_verifiable_after_board_done(self):
        item, registration, board, receipt = self.controller_authored_source()
        from work_queue import _publication_completion_candidate
        task_entry = json.loads(board.read_text())['tasks'][0]
        registration_id = registration.stem
        with self.assertRaisesRegex(RuntimeError, 'WORK_QUEUE_PUBLICATION_TASK_BINDING_INVALID'):
            _publication_completion_candidate(
                self.root, 'A', dict(task_entry, state='DONE'), registration_id)
        accepted, proof = _publication_completion_candidate(
            self.root, 'A', dict(task_entry, state='DONE'), registration_id,
            allow_done=True)
        self.assertEqual(accepted, 'a' * 40)
        self.assertEqual(proof['registration_id'], registration_id)
        actual_board = json.loads(board.read_text())
        actual_board['tasks'] = [dict(
            task_entry, state='DONE', completion_receipt=str(receipt))]
        board.write_text(json.dumps(actual_board))
        # The queue may be durably DONE while the disk completion write has
        # not yet advanced from SEALING to SEALED. Do not return a passing
        # resource inventory proof in either no-record or partial-seal case.
        with self.assertRaisesRegex(ValueError, 'CROSS_ROLE_COMPLETION_SEAL_REQUIRED'):
            self.reg.status('A', 'delegated-source', complete=True)
        self.reg.record_completion_state('A', 'delegated-source', 'SEALING')
        with self.assertRaisesRegex(ValueError, 'CROSS_ROLE_COMPLETION_SEAL_REQUIRED'):
            self.reg.status('A', 'delegated-source', complete=True)
        self.reg.record_completion_state('A', 'delegated-source', 'SEALED')
        result = self.reg.status('A', 'delegated-source', complete=True)
        self.assertEqual([a['id'] for a in result['allocations']], [item['id']])
        self.assertEqual(result['delegated_publication_registration'], registration.stem)
        self.assertEqual(result['unresolved'], [])

    def test_administrative_sealing_forbids_controller_new_same_task_lease(self):
        item, registration, board, receipt = self.controller_authored_source()
        self.reg.record_completion_state('A', 'delegated-source', 'SEALED')
        with self.assertRaisesRegex(ValueError, 'TASK_DISK_LIFECYCLE_ALREADY_COMPLETED'):
            self.begin('CONTROLLER', task='delegated-source', name='after-A-done')
        self.assertFalse((self.root / 'worktrees' / 'controller' / 'after-A-done').exists())
        # A plain direct REOPENED call is not journal-certified recovery
        # for a task whose source was produced by CONTROLLER.
        with self.assertRaisesRegex(
                ValueError, 'CROSS_ROLE_REOPEN_JOURNAL_AUTHORITY_REQUIRED'):
            self.reg.record_completion_state('A', 'delegated-source', 'REOPENED')
        self.assertEqual(
            self.reg.completion_record('A', 'delegated-source')['state'], 'SEALED')
        with self.assertRaisesRegex(ValueError, 'TASK_DISK_LIFECYCLE_ALREADY_COMPLETED'):
            self.begin('CONTROLLER', task='delegated-source', name='after-unsafe-reopen')

    def test_sealed_controller_completion_also_forbids_role_A_new_lease(self):
        item, registration, board, receipt = self.controller_authored_source()
        self.reg.record_completion_state('CONTROLLER', 'delegated-source', 'SEALING')
        with self.assertRaisesRegex(ValueError, 'TASK_DISK_LIFECYCLE_ALREADY_COMPLETED'):
            self.begin('A', task='delegated-source', name='admin-duplicate')

    def test_controller_authored_completion_rejects_open_expired_or_false_zero(self):
        item, registration, board, receipt = self.controller_authored_source()
        self.reg.declare_none('A', 'delegated-source',
                              'No A outputs but controller created real files')
        # Caller-side zero declaration was in fact written above: the
        # sealed cross-role gate must reject it, not silently clear its data.
        with self.assertRaisesRegex(ValueError, 'CROSS_ROLE_FALSE_NO_OUTPUT_DECLARATION'):
            self.reg.status('A', 'delegated-source', complete=True)

    def test_controller_authored_completion_rejects_expired_and_open_foreign(self):
        item, registration, board, receipt = self.controller_authored_source()
        self.now += 43201
        with self.assertRaisesRegex(ValueError, 'CROSS_ROLE_HELD_RESOURCE_INVALID'):
            self.reg.status('A', 'delegated-source', complete=True)
        self.now -= 43201
        record_path = self.reg.directory / (item['id'] + '.json')
        record = json.loads(record_path.read_text())
        record['state'] = 'OPEN'
        record_path.write_text(json.dumps(record))
        with self.assertRaisesRegex(ValueError, 'CLEANUP_NOT_COMPLETE'):
            self.reg.status('A', 'delegated-source', complete=True)

    def test_controller_authored_rejects_second_active_unattested_artifact(self):
        item, registration, board, receipt = self.controller_authored_source()
        extra = self.begin('CONTROLLER', task='delegated-source',
                           name='unattested-source-output', reserve=64)
        Path(extra['paths'][0]).mkdir(parents=True)
        self.reg.change(extra['id'], 'CONTROLLER', 'hold',
                        'An unrelated output is still needed',
                        'Active unknown producer review for same task', 12)
        with self.assertRaisesRegex(ValueError, 'CROSS_ROLE_ACTIVE_ARTIFACT_UNATTESTED'):
            self.reg.status('A', 'delegated-source', complete=True)

    def test_controller_authored_counts_honestly_closed_additional_output(self):
        item, registration, board, receipt = self.controller_authored_source()
        extra = self.begin('CONTROLLER', task='delegated-source',
                           name='cleaned-temporary-output', reserve=64)
        self.reg.change(extra['id'], 'CONTROLLER', 'close', self.proof(extra))
        result = self.reg.status('A', 'delegated-source', complete=True)
        self.assertEqual(len(result['allocations']), 2)
        self.assertIn(extra['id'], [x['id'] for x in result['allocations']])
        self.assertEqual(result['all_open_reservations_mib'], 64)

    def test_controller_authored_rejects_duplicate_live_artifact_identity(self):
        item, registration, board, receipt = self.controller_authored_source()
        extra = dict(self.reg.rows()[0], id='synthetic-double-spend-lease')
        (self.reg.directory / (extra['id'] + '.json')).write_text(json.dumps(extra))
        with self.assertRaisesRegex(ValueError, 'CROSS_ROLE_DUPLICATE_ACTIVE_ARTIFACT'):
            self.reg.status('A', 'delegated-source', complete=True)

    def test_controller_authored_rejects_registration_core_path_mismatch(self):
        item, registration, board, receipt = self.controller_authored_source()
        altered = json.loads(registration.read_text())
        altered['core']['task_paths'] = ['other/role/task.ts']
        registration.write_text(json.dumps(altered))
        with self.assertRaisesRegex(ValueError, 'CROSS_ROLE_NATIVE_PUBLISHER_INVALID'):
            self.reg.status('A', 'delegated-source', complete=True)

    def test_controller_authored_completion_scans_only_participating_lanes(self):
        item, registration, board, receipt = self.controller_authored_source()
        unrelated = self.root / 'worktrees' / 'B' / 'rogue-other-role'
        unrelated.mkdir(parents=True)
        self.assertEqual(self.reg.status('A', 'delegated-source', complete=True)['unresolved'], [])
        with self.assertRaisesRegex(ValueError, 'UNREGISTERED_MANAGED_PATHS'):
            self.reg.status(None, 'delegated-source', complete=True)

    def test_controller_authored_global_role_unscoped_call_remains_compatible(self):
        item, registration, board, receipt = self.controller_authored_source()
        result = self.reg.status(None, 'delegated-source', complete=True)
        self.assertEqual(len(result['allocations']), 1)
        self.assertEqual(result['allocations'][0]['role'], 'CONTROLLER')

    def test_controller_authored_unregistered_controller_root_is_not_ignored(self):
        item, registration, board, receipt = self.controller_authored_source()
        rogue = self.root / 'temporary' / 'controller' / 'rogue-output'
        rogue.mkdir(parents=True)
        with self.assertRaisesRegex(ValueError, 'UNREGISTERED_MANAGED_PATHS'):
            self.reg.status('A', 'delegated-source', complete=True)

    def test_controller_authored_receipt_ancestor_symlink_fails_closed(self):
        item, registration, board, receipt = self.controller_authored_source()
        # The leaf review.json itself is regular, but one ancestor is a
        # symlink. No native publication can delegate this replaced path.
        audits = self.root / 'controllers' / 'audits'
        retained = self.root / 'controllers' / 'original-audits'
        audits.rename(retained)
        audits.symlink_to(retained, target_is_directory=True)
        with self.assertRaisesRegex(
                ValueError,
                'CROSS_ROLE_(PUBLICATION_RECEIPT_INVALID|NATIVE_COMPLETION_PROOF_INVALID)'):
            self.reg.status('A', 'delegated-source', complete=True)

    def test_controller_authored_receipt_pinned_parent_open_refusal(self):
        item, registration, board, receipt = self.controller_authored_source()
        real_open = os.open
        checked = []

        def invalid_ancestor(path, flags, mode=0o777, *, dir_fd=None):
            if path == 'audits' and dir_fd is not None:
                checked.append(path)
                raise OSError('simulated replaced trusted directory ancestor')
            return real_open(path, flags, mode, dir_fd=dir_fd)

        with patch.object(os, 'open', side_effect=invalid_ancestor):
            with self.assertRaisesRegex(ValueError, 'CROSS_ROLE_PUBLICATION_RECEIPT_INVALID'):
                self.reg.status('A', 'delegated-source', complete=True)
        self.assertEqual(checked, ['audits'])

    def test_controller_authored_native_registration_version_change_denied(self):
        item, registration, board, receipt = self.controller_authored_source()
        history = registration.parent.parent / 'states' / registration.stem
        previous_raw = (history / '9.json').read_bytes()
        original_read = Path.read_bytes
        reads = {'registration': 0}

        def version_changed(path):
            if path == registration:
                reads['registration'] += 1
                # The bounded initial reader uses pinned os.open/O_NOFOLLOW,
                # while the native issuer uses Path.read_bytes. Returning the
                # previously valid v9 native snapshot simulates a mutation
                # after pinned v10 identity was checked, before native read.
                return previous_raw
            return original_read(path)

        with patch.object(Path, 'read_bytes', version_changed):
            with self.assertRaisesRegex(
                    ValueError, 'CROSS_ROLE_PUBLICATION_VERSION_DRIFT'):
                self.reg.status('A', 'delegated-source', complete=True)
        self.assertGreaterEqual(reads['registration'], 1)

    def test_unrelated_corrupt_registration_fails_closed_with_bounded_error(self):
        item, registration, board, receipt = self.controller_authored_source()
        unrelated = registration.parent / ('e' * 64 + '.json')
        unrelated.write_bytes(b'{ invalid unrelated JSON')
        with self.assertRaisesRegex(
                ValueError, 'CROSS_ROLE_PUBLICATION_REGISTRATION_INVALID_JSON'):
            self.reg.status('A', 'delegated-source', complete=True)

    def test_unrelated_registration_nonmapping_core_fails_closed(self):
        # Even an unrelated registration must have a mapping core.
        # Never let core.get escape as AttributeError or silently skip None.
        item, registration, board, receipt = self.controller_authored_source()
        unrelated = registration.parent / ('e' * 64 + '.json')
        board_before = board.read_bytes()
        registration_before = registration.read_bytes()
        for core in ('foreign', ['foreign'], 42, None, []):
            with self.subTest(core_type=type(core).__name__, value=core):
                unrelated.write_text(json.dumps({'core': core}))
                with self.assertRaisesRegex(
                        ValueError, 'CROSS_ROLE_PUBLICATION_REGISTRATION_CORE_INVALID'):
                    self.reg.status('A', 'delegated-source', complete=True)
                self.assertEqual(board.read_bytes(), board_before)
                self.assertEqual(registration.read_bytes(), registration_before)
                self.assertIsNone(self.reg.completion_record(
                    'A', 'delegated-source'))

    def test_unrelated_oversized_registration_is_denied_before_json_parse(self):
        item, registration, board, receipt = self.controller_authored_source()
        unrelated = registration.parent / ('e' * 64 + '.json')
        unrelated.write_bytes(b'{' + b' ' * (64 * 1024))
        with self.assertRaisesRegex(
                ValueError, 'CROSS_ROLE_PUBLICATION_REGISTRATION_TOO_LARGE'):
            self.reg.status('A', 'delegated-source', complete=True)

    def test_registration_filename_must_be_native_64hex_identity(self):
        item, registration, board, receipt = self.controller_authored_source()
        unrelated = registration.parent / ('not-a-native-sha.json')
        unrelated.write_text('{}')
        with self.assertRaisesRegex(
                ValueError, 'CROSS_ROLE_PUBLICATION_REGISTRATION_INVALID'):
            self.reg.status('A', 'delegated-source', complete=True)

    def test_controller_authored_missing_native_verifier_fails_closed(self):
        item, registration, board, receipt = self.controller_authored_source()
        # Operational disk_lifecycle.py may be provisioned separately from
        # the trusted native publisher modules; that must not accept an
        # invented JSON-only substitute or mask an ImportError as success.
        for module in ('task_publication', 'work_queue'):
            with self.subTest(module=module):
                with patch.dict(sys.modules, {module: None}):
                    with self.assertRaisesRegex(
                            ValueError, 'CROSS_ROLE_NATIVE_VERIFIER_UNAVAILABLE'):
                        self.reg.status('A', 'delegated-source', complete=True)

    def test_controller_authored_completion_cannot_inherit_unrelated_role_task(self):
        item, registration, board, receipt = self.controller_authored_source()
        registration.unlink()
        with self.assertRaisesRegex(ValueError, 'CROSS_ROLE_PUBLICATION_NOT_FOUND_FOR_RESOURCE'):
            self.reg.status('A', 'delegated-source', complete=True)
        record_path = self.reg.directory / (item['id'] + '.json')
        record = json.loads(record_path.read_text())
        record['role'] = 'B'
        record_path.write_text(json.dumps(record))
        with self.assertRaisesRegex(ValueError, 'CROSS_ROLE_RESOURCE_AUTHORITY_REQUIRED'):
            self.reg.status('A', 'delegated-source', complete=True)

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

    def test_mandatory_three_gib_floor_exact_admission_boundary(self):
        # Direct owner decision 2026-10-08 19:10 MSK: 3 GiB free disk floor.
        self.assertEqual(dl.RESERVE_MIB, 3072)
        self.capacity['available_mib'] = 3072 + 128 - 1
        with self.assertRaisesRegex(ValueError, 'DISK_CAPACITY_REQUIRED'):
            self.begin(name='below-current-owner-floor', reserve=128)
        self.assertEqual(self.reg.rows(), [])
        self.capacity['available_mib'] = 3072 + 128
        admitted = self.begin(name='at-current-owner-floor', reserve=128)
        self.assertEqual(admitted['reserve_mib'], 128)
        self.assertEqual(self.reg.status()['reserve_floor_mib'], 3072)




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
        # TEST ONLY: exercise the remaining inventory/admission checks with
        # the unavailable authority gate substituted. This grants no accepted
        # reviewer identity and proves no production reserve reduction route.
        with patch.object(Path, 'iterdir', processes):
            with patch.object(self.reg, '_require_retained_review_authority'):
                return self.reg.reconcile_retained(item['id'], 'CONTROLLER', budget, str(proof), str(review))


    def test_forged_valid_review_without_trusted_authority_cannot_reduce_reserve(self):
        item, root, proof, review = self.retention()
        # Complete positive text fields are insufficient evidence of authorship.
        record = self.reg.directory / (item["id"] + ".json")
        before = record.read_bytes()
        archive_before = {p.name: p.read_bytes() for p in root.iterdir()}
        with self.assertRaisesRegex(ValueError, "RETAINED_REVIEW_AUTHORITY_UNAVAILABLE"):
            self.reg.reconcile_retained(item["id"], "CONTROLLER", 512, str(proof), str(review))
        self.assertEqual(record.read_bytes(), before)
        self.assertEqual({p.name: p.read_bytes() for p in root.iterdir()}, archive_before)

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

    def test_review_must_bind_budget_inventory_and_declared_role_fields(self):
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

    def test_writer_opens_between_inventory_and_admission_lock_is_rejected(self):
        # A live archive writer arriving after the initial inventory/consumer
        # observation must be detected under the final admission lock. Merely
        # opening this descriptor changes no archive bytes or inode metadata.
        from contextlib import contextmanager

        item, root, proof, review = self.retention()
        original_locked = self.reg.locked
        calls = 0
        writer_fd = None

        @contextmanager
        def writer_arrives_at_final_lock():
            nonlocal calls, writer_fd
            calls += 1
            if calls == 2:
                writer_fd = os.open(root / 'one.tar.gz', os.O_WRONLY)
            with original_locked():
                yield

        try:
            with patch.object(self.reg, 'locked',
                              side_effect=writer_arrives_at_final_lock):
                with self.assertRaisesRegex(ValueError,
                                            'RETAINED_ARCHIVE_ACTIVE_WRITER'):
                    self.reconcile(item, proof, review)
        finally:
            if writer_fd is not None:
                os.close(writer_fd)

        self.assertEqual(calls, 2)
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


class NoTemporaryFilesystemSourceTests(unittest.TestCase):
    """SOURCE-only guard checks requiring no tempfile, cache or V2 journal."""

    def test_r7_21_same_state_queue_cannot_reopen_foreign_seal(self):
        """A C51b V2 precommit guard denies a sealed same-state transition.

        The old main advanced a mocked queue and reopened afterward, which
        could leave an inconsistent IN_PROGRESS/SEALED pair. The new queue
        owns the resource callback before committing; mocking it without
        executing that callback is not a valid source-level reproducer.
        """
        import contextlib
        import copy
        import control

        task = "R7-21-SOURCE-ONLY"
        virtual_root = Path("/nonexistent-octoport-r7-inmemory-no-files")
        for producer, lease_state in (
                ("CONTROLLER", "CLOSED"), ("CONTROLLER", "HELD"),
                ("A", "CLOSED")):
            with self.subTest(producer=producer, lease_state=lease_state):
                original = {
                    "version": 1, "role": "A", "task": task,
                    "state": "SEALED",
                    "history": [{"state": "SEALED", "at": 1}],
                }
                state = {"current": copy.deepcopy(original)}
                writes = []
                registry = dl.Registry(virtual_root, clock=lambda: 2)

                def persist(_path, value):
                    writes.append(copy.deepcopy(value))
                    state["current"] = copy.deepcopy(value)

                def guarded_queue_writer(_root, role, task_id, new_state,
                                         _receipt, _summary, **kwargs):
                    # This is only the documented callback boundary. No
                    # actual V2 OS journal is written in this source test.
                    self.assertEqual((_root, role, task_id, new_state),
                                     (virtual_root, "A", task, "IN_PROGRESS"))
                    self.assertIn("resource_lock", kwargs)
                    self.assertIn("completion_guard", kwargs)
                    with kwargs["resource_lock"]():
                        with kwargs["completion_guard"](
                                "IN_PROGRESS", {
                                    "id": task, "role": "A",
                                    "state": "IN_PROGRESS",
                                }):
                            writes.append({"state": "QUEUE_COMMITTED"})
                            return {"state": "IN_PROGRESS"}

                with (
                    patch.object(registry, "locked",
                                 side_effect=lambda: contextlib.nullcontext()),
                    patch.object(registry, "rows", return_value=[
                        {"task": task, "role": producer,
                         "state": lease_state},
                    ]),
                    patch.object(registry, "completion_record",
                                 side_effect=lambda *_: copy.deepcopy(
                                     state["current"])),
                    patch.object(dl, "atomic_json", side_effect=persist),
                    patch.object(Path, "mkdir", return_value=None),
                    patch.object(control, "DiskLifecycleRegistry",
                                 return_value=registry),
                    patch.object(control, "advance_task",
                                 side_effect=guarded_queue_writer) as queue,
                ):
                    with self.assertRaisesRegex(
                            RuntimeError,
                            "WORK_QUEUE_RESOURCE_JOURNAL_RECOVERY_REQUIRED"):
                        control.advance_queue_task(
                            "A", task, "IN_PROGRESS",
                            "synthetic-same-state-receipt",
                            "No authority to reopen a sealed same-state",
                            control_root=virtual_root)
                self.assertEqual(writes, [])
                self.assertEqual(state["current"], original)
                queue.assert_called_once()

    def test_r7_05_direct_reopen_cannot_bypass_closed_foreign_seal(self):
        import copy

        task = 'R7-05-SOURCE-ONLY'
        virtual_root = Path('/nonexistent-octoport-r7-inmemory-no-files')
        for seal in ('SEALING', 'SEALED'):
            for producer, lease_state in (
                    ('CONTROLLER', 'CLOSED'), ('CONTROLLER', 'HELD'),
                    ('A', 'CLOSED')):
                with self.subTest(seal=seal, producer=producer,
                                  lease_state=lease_state):
                    original = {'version': 1, 'role': 'A', 'task': task,
                                'state': seal,
                                'history': [{'state': seal, 'at': 1}]}
                    registry = dl.Registry(virtual_root, clock=lambda: 2)
                    writes = []
                    with (
                        patch.object(registry, 'completion_record',
                                     return_value=copy.deepcopy(original)),
                        patch.object(registry, 'rows', return_value=[
                            {'task': task, 'role': producer, 'state': lease_state}]),
                        patch.object(Path, 'mkdir', return_value=None),
                        patch.object(dl, 'atomic_json',
                                     side_effect=lambda _p, rec:
                                     writes.append(copy.deepcopy(rec))),
                    ):
                        if producer == 'CONTROLLER':
                            with self.assertRaisesRegex(
                                    ValueError,
                                    'CROSS_ROLE_REOPEN_JOURNAL_AUTHORITY_REQUIRED'):
                                registry.record_completion_state(
                                    'A', task, 'REOPENED')
                            self.assertEqual(writes, [])
                        else:
                            result = registry.record_completion_state(
                                'A', task, 'REOPENED')
                            self.assertEqual(result['state'], 'REOPENED')
                            self.assertEqual([x['state'] for x in writes],
                                             ['REOPENED'])

    def test_v1_zero_foreign_inventory_has_explicit_integer_attestation(self):
        # Native status_locked is executed, but rows/guard/snapshot are mocked.
        # No missing field, boolean count or missing issuer may stand for zero.
        task = 'R7-01-SOURCE-ONLY'
        registry = dl.Registry(Path('/nonexistent-octoport-r7-inmemory-no-files'))
        own = {'id': 'own-zero', 'role': 'A', 'task': task,
               'kind': 'NO_TEMPORARY_OUTPUTS', 'state': 'CLOSED'}
        with (
            patch.object(registry, 'rows', return_value=[own]),
            patch.object(registry, 'managed_guard', return_value={
                'baseline_required': False, 'unregistered_managed_paths': []}),
            patch.object(registry, 'snapshot',
                         return_value={'available_mib': 15000, 'inodes_free': 1_000_000}),
            patch.object(registry, '_verify_controller_authored_task_inventory',
                         side_effect=AssertionError('ZERO_FOREIGN_MUST_NOT_VERIFY')) as verifier,
        ):
            result = registry.status_locked('A', task, complete=True)
        verifier.assert_not_called()
        self.assertIs(type(result['delegation_inventory_version']), int)
        self.assertEqual(result['delegation_inventory_version'], 1)
        self.assertIs(result['delegation_inventory_attested'], True)
        self.assertIs(type(result['foreign_allocation_count']), int)
        self.assertEqual(result['foreign_allocation_count'], 0)
        self.assertIsNone(result['delegated_publication_registration'])
        self.assertEqual(result['unresolved'], [])
        self.assertEqual([r['id'] for r in result['allocations']], ['own-zero'])

    def test_v1_closed_foreign_history_has_exact_one_count_and_issuer(self):
        # A synthetic accepted publisher ID mocks the separately verified
        # native registration. This is emitter-contract coverage only, not
        # evidence that a real publication registration was accepted.
        task = 'R7-CLOSED-FOREIGN-SOURCE-ONLY'
        registry = dl.Registry(Path('/nonexistent-octoport-r7-inmemory-no-files'))
        own = {'id': 'own-source', 'role': 'A', 'task': task,
               'kind': 'TEMPORARY_OUTPUTS', 'state': 'CLOSED'}
        foreign = {'id': 'controller-source', 'role': 'CONTROLLER',
                   'task': task, 'kind': 'TEMPORARY_OUTPUTS',
                   'state': 'CLOSED'}
        issuer = 'a' * 64
        with (
            patch.object(registry, 'rows', return_value=[own, foreign]),
            patch.object(registry, 'managed_guard', side_effect=lambda *_: {
                'baseline_required': False, 'unregistered_managed_paths': []}),
            patch.object(registry, 'snapshot',
                         return_value={'available_mib': 15000, 'inodes_free': 1_000_000}),
            patch.object(registry, '_verify_controller_authored_task_inventory',
                         return_value=issuer) as verifier,
        ):
            result = registry.status_locked('A', task, complete=True)
        verifier.assert_called_once_with('A', task, [foreign])
        self.assertIs(type(result['delegation_inventory_version']), int)
        self.assertEqual(result['delegation_inventory_version'], 1)
        self.assertIs(result['delegation_inventory_attested'], True)
        self.assertIs(type(result['foreign_allocation_count']), int)
        self.assertEqual(result['foreign_allocation_count'], 1)
        self.assertEqual(result['delegated_publication_registration'], issuer)
        self.assertEqual([r['id'] for r in result['allocations']],
                         ['own-source', 'controller-source'])

    def test_v1_foreign_native_verifier_refusal_is_not_false_zero(self):
        task = 'R7-UNVERIFIED-FOREIGN-SOURCE-ONLY'
        registry = dl.Registry(Path('/nonexistent-octoport-r7-inmemory-no-files'))
        own = {'id': 'own-source', 'role': 'A', 'task': task,
               'kind': 'TEMPORARY_OUTPUTS', 'state': 'CLOSED'}
        foreign = {'id': 'controller-source', 'role': 'CONTROLLER',
                   'task': task, 'kind': 'TEMPORARY_OUTPUTS',
                   'state': 'CLOSED'}
        with (
            patch.object(registry, 'rows', return_value=[own, foreign]),
            patch.object(registry, '_verify_controller_authored_task_inventory',
                         side_effect=ValueError('NATIVE_PUBLISHER_NOT_ACCEPTED')),
        ):
            with self.assertRaisesRegex(ValueError, 'NATIVE_PUBLISHER_NOT_ACCEPTED'):
                registry.status_locked('A', task, complete=True)

    def test_c00_global_seal_blocks_foreign_begin_before_budget_write(self):
        # Real Registry.begin and global task guard run with in-memory
        # coordination lock, paths and ledger. No temp filesystem roots.
        import contextlib
        import copy

        roles = dl.ROLES
        task = 'C00-GLOBAL-SEAL-NO-FILES'
        control = Path('/nonexistent-octoport-A-c00-global-seal-test')
        registry = dl.Registry(control, clock=lambda: 1000)
        denied = 0
        allowed = 0

        def check(request_role, seal_owner, state):
            nonlocal denied, allowed
            markers = {}
            if state != 'ABSENT':
                observed_task = task + '-other' if state == 'OTHER_TASK' else task
                observed_state = 'SEALED' if state == 'OTHER_TASK' else state
                markers[seal_owner] = {
                    'role': seal_owner, 'task': observed_task,
                    'state': observed_state,
                }

            def completion(owner, query_task):
                item = markers.get(owner)
                if item and item['task'] == query_task:
                    return copy.deepcopy(item)
                return None

            writes = []
            with self.subTest(request=request_role, seal_owner=seal_owner,
                              prior=state):
                with (
                    patch.object(registry, 'locked',
                                 side_effect=lambda: contextlib.nullcontext()),
                    patch.object(registry, 'check_role', return_value=None),
                    patch.object(registry, 'completion_record',
                                 side_effect=completion),
                    patch.object(registry, 'paths', return_value=[
                        str(control / 'never-created')
                    ]) as paths,
                    patch.object(registry, 'volume_names', return_value=[]),
                    patch.object(registry, 'rows', return_value=[]),
                    patch.object(registry, 'require_managed_guard',
                                 return_value=None),
                    patch.object(registry, 'snapshot', return_value={
                        'available_mib': 10000, 'inodes_free': 1000000,
                    }) as snapshot,
                    patch.object(dl, 'atomic_json',
                                 side_effect=lambda _path, data:
                                 writes.append(copy.deepcopy(data))),
                ):
                    if state in ('SEALING', 'SEALED'):
                        with self.assertRaisesRegex(
                                ValueError,
                                'TASK_DISK_LIFECYCLE_ALREADY_COMPLETED'):
                            registry.begin(request_role, task,
                                           'Source-only fixture', [], 16, 1)
                        paths.assert_not_called()
                        snapshot.assert_not_called()
                        self.assertEqual(writes, [])
                        denied += 1
                    else:
                        item = registry.begin(request_role, task,
                                              'Source-only fixture', [], 16, 1)
                        self.assertEqual(item['state'], 'OPEN')
                        self.assertEqual(item['role'], request_role)
                        self.assertEqual(item['task'], task)
                        self.assertEqual(len(writes), 1)
                        paths.assert_called_once()
                        snapshot.assert_called_once()
                        allowed += 1

        for seal_owner in roles:
            for requester in roles:
                for state in ('SEALING', 'SEALED'):
                    check(requester, seal_owner, state)
                check(requester, seal_owner, 'REOPENED')
        for requester in roles:
            check(requester, 'A', 'ABSENT')
            check(requester, 'A', 'OTHER_TASK')

        self.assertEqual((denied, allowed), (32, 24))


    def test_c00_nested_pinned_file_readers_do_not_reclose_reused_parent_fd(self):
        # True Linux memfd FDs; no managed directories, receipt files or
        # changes to the production native task-publication ledger.
        import ast
        import errno
        import re
        import stat
        import types

        source = Path(dl.__file__).read_text()
        nodes = {
            n.name: n for n in ast.walk(ast.parse(source))
            if isinstance(n, ast.FunctionDef)
            and n.name in ('verified_receipt', 'pinned_registration')
        }
        self.assertEqual(len(nodes), 2)
        control = Path('/memory-only-octoport-A-c00-pin')
        registration_dir = (
            control / 'controllers' / 'task-publication' / 'registrations'
        )

        def live(fd):
            try:
                os.fstat(fd)
                return True
            except OSError as error:
                if error.errno == errno.EBADF:
                    return False
                raise

        for method in ('verified_receipt', 'pinned_registration'):
            for fault in ('released_then_error',
                          'unreleased_then_error', 'final_open_missing'):
                with self.subTest(method=method, failure=fault):
                    events = {'owned': [], 'first': None,
                              'foreign': None, 'fault_injected': False}

                    class VirtualDirectoryFDs:
                        O_RDONLY = os.O_RDONLY
                        O_DIRECTORY = getattr(os, 'O_DIRECTORY', 0)
                        O_NOFOLLOW = getattr(os, 'O_NOFOLLOW', 0)

                        def open(self, name, _flags, **_kwargs):
                            if fault == 'final_open_missing' and str(name).endswith('.json'):
                                raise FileNotFoundError('synthetic_final_file_absent')
                            fd = os.memfd_create(
                                'octoport-A-C00-owned-reader', flags=os.MFD_CLOEXEC
                            )
                            events['owned'].append(fd)
                            if events['first'] is None:
                                events['first'] = fd
                            return fd

                        def close(self, fd):
                            if (fault != 'final_open_missing'
                                    and fd == events['first']
                                    and not events['fault_injected']):
                                events['fault_injected'] = True
                                if fault == 'released_then_error':
                                    os.close(fd)
                                    foreign = os.memfd_create(
                                        'octoport-A-C00-unrelated-reused-FD',
                                        flags=os.MFD_CLOEXEC,
                                    )
                                    events['foreign'] = foreign
                                    self_case.assertEqual(foreign, fd)
                                raise OSError(errno.EIO, 'synthetic_close_eio')
                            return os.close(fd)

                    self_case = self
                    environment = {
                        'os': VirtualDirectoryFDs(), 'Path': Path,
                        'self': types.SimpleNamespace(control=control),
                        'registration_dir': registration_dir,
                        'json': json, 'hashlib': hashlib,
                        'stat': stat, 're': re, 'sys': sys,
                        'MIB': dl.MIB, 'max_registration_bytes': 64 * 1024,
                    }
                    functions = {}
                    exec(compile(ast.unparse(nodes[method]),
                                 'A-owned-pinned-reader-source', 'exec'),
                         environment, functions)
                    argument = (
                        {'path': str(control / 'peer' / 'receipt.json')}
                        if method == 'verified_receipt'
                        else registration_dir / ('a' * 64 + '.json')
                    )
                    try:
                        with self.assertRaisesRegex(
                                ValueError, 'CROSS_ROLE_PUBLICATION_'):
                            functions[method](argument)
                        self.assertGreaterEqual(len(events['owned']), 2)
                        child = events['owned'][1]
                        self.assertFalse(live(child))
                        if fault == 'released_then_error':
                            self.assertTrue(live(events['foreign']))
                        if fault == 'unreleased_then_error':
                            # Ambiguous os.close before release: do not risk
                            # closing an unrelated fd via a numeric retry.
                            self.assertTrue(live(events['first']))
                        if fault == 'final_open_missing':
                            self.assertTrue(all(not live(fd)
                                                for fd in events['owned']))
                    finally:
                        # The mock's intentionally uncertain parent FD may be
                        # live. Always release only our process-local FDs.
                        for fd in set(events['owned']) | (
                                {events['foreign']}
                                if events['foreign'] is not None else set()):
                            if live(fd):
                                os.close(fd)


    def test_c00_nested_parent_child_double_close_error_keeps_primary_valueerror(self):
        # Test both source closures on actual process-local Linux memfds,
        # without creating temporary managed control directories.
        import ast
        import errno
        import re
        import stat
        import types

        source = Path(dl.__file__).read_text()
        nodes = {
            node.name: node for node in ast.walk(ast.parse(source))
            if isinstance(node, ast.FunctionDef)
            and node.name in ('verified_receipt', 'pinned_registration')
        }
        self.assertEqual(set(nodes), {'verified_receipt', 'pinned_registration'})
        control = Path('/memory-only-octoport-A-c00-dual-close')
        registration_dir = (
            control / 'controllers' / 'task-publication' / 'registrations'
        )

        def live(fd):
            try:
                os.fstat(fd)
                return True
            except OSError as error:
                if error.errno == errno.EBADF:
                    return False
                raise

        for method, expected_domain, expected_note in (
                ('verified_receipt',
                 'CROSS_ROLE_PUBLICATION_RECEIPT_INVALID',
                 'CROSS_ROLE_PUBLICATION_RECEIPT_DIR_CLOSE_UNCERTAIN'),
                ('pinned_registration',
                 'CROSS_ROLE_PUBLICATION_REGISTRATION_READ_INVALID',
                 'CROSS_ROLE_PUBLICATION_REGISTRATION_DIR_CLOSE_UNCERTAIN')):
            with self.subTest(source_reader=method):
                events = {'fds': [], 'parent_error': False,
                          'child_error': False, 'close_attempts': []}

                class DualCloseErrors:
                    O_RDONLY = os.O_RDONLY
                    O_DIRECTORY = getattr(os, 'O_DIRECTORY', 0)
                    O_NOFOLLOW = getattr(os, 'O_NOFOLLOW', 0)

                    def open(self, _name, _flags, **_kwargs):
                        fd = os.memfd_create(
                            'octoport-A-C00-dual-EIO-reader',
                            flags=os.MFD_CLOEXEC,
                        )
                        events['fds'].append(fd)
                        return fd

                    def close(self, fd):
                        events['close_attempts'].append(fd)
                        if (events['fds'] and fd == events['fds'][0]
                                and not events['parent_error']):
                            events['parent_error'] = True
                            # EIO before the kernel releases the parent FD.
                            raise OSError(errno.EIO, 'PARENT_PRE_RELEASE_EIO')
                        if (len(events['fds']) >= 2
                                and fd == events['fds'][1]
                                and not events['child_error']):
                            events['child_error'] = True
                            # EIO after the child was already released.
                            os.close(fd)
                            raise OSError(errno.EIO, 'CHILD_POST_RELEASE_EIO')
                        return os.close(fd)

                environment = {
                    'os': DualCloseErrors(), 'Path': Path,
                    'self': types.SimpleNamespace(control=control),
                    'registration_dir': registration_dir,
                    'json': json, 'hashlib': hashlib, 'stat': stat,
                    're': re, 'sys': sys, 'MIB': dl.MIB,
                    'max_registration_bytes': 64 * 1024,
                }
                functions = {}
                exec(compile(
                    ast.unparse(nodes[method]),
                    'A-owned-pinned-reader-dual-EIO', 'exec',
                ), environment, functions)
                argument = (
                    {'path': str(control / 'peer' / 'receipt.json')}
                    if method == 'verified_receipt'
                    else registration_dir / ('a' * 64 + '.json')
                )
                try:
                    with self.assertRaisesRegex(
                            ValueError, expected_domain) as caught:
                        functions[method](argument)
                    self.assertEqual(len(events['fds']), 2)
                    parent, child = events['fds']
                    self.assertTrue(events['parent_error'])
                    self.assertTrue(events['child_error'])
                    self.assertEqual(events['close_attempts'], [parent, child])
                    self.assertTrue(live(parent))
                    self.assertFalse(live(child))
                    self.assertIn(
                        expected_note, getattr(caught.exception, '__notes__', []),
                    )
                finally:
                    # Parent fd may remain live after pre-release EIO; this
                    # test harness owns and explicitly closes its exact FD.
                    for fd in events['fds']:
                        if live(fd):
                            os.close(fd)




if __name__=='__main__':
    unittest.main()
