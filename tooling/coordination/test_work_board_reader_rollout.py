import copy
import hashlib
import json
import os
import shutil
import stat
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import work_board_reader_rollout as rollout
import work_queue
import test_work_queue as work_queue_tests
import test_work_board_v2 as work_board_v2_tests


class ReaderRolloutTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "control"
        (self.root / "controllers").mkdir(parents=True)
        (self.root / "logs").mkdir()
        for role in "ABC":
            (self.root / f"{role}.json").write_text('{"status":"RUNNING"}')
            (self.root / f"{role}.lock").touch()
        (self.root / "controllers/coordination.lock").touch()
        board = {"version": 1, "revision": 1, "updated_at": "2026-10-02T00:00:00+00:00", "tasks": [
            {"id": "task-a", "role": "A", "plan": "A04", "state": "READY", "requires": [],
             "result": "Task", "paths": ["apps/extension/a.js"]}
        ]}
        (self.root / "controllers/work-board.json").write_text(json.dumps(board))
        self.candidate_queue = Path(work_queue.__file__).resolve()
        self.candidate_v2 = self.candidate_queue.with_name("work_board_v2.py")
        self.dirs = {}
        self.old_queue = subprocess.run(["git", "-C", str(self.candidate_queue.parents[2]), "show", "HEAD:tooling/coordination/work_queue.py"], check=True, capture_output=True).stdout
        self.old_queue_sha = hashlib.sha256(self.old_queue).hexdigest()
        self.repo_roots = {}
        for role in rollout.ROLES:
            repo = Path(self.tmp.name) / ("repo-" + role)
            directory = repo / "tooling/coordination"
            directory.mkdir(parents=True)
            subprocess.run(["git", "init", "-q", str(repo)], check=True)
            (directory / "work_queue.py").write_bytes(self.old_queue)
            self.dirs[role] = directory
            self.repo_roots[role] = repo
        self.candidates = {"work_queue": self.candidate_queue, "work_board_v2": self.candidate_v2}
        self.queue_hashes = {role: self.old_queue_sha for role in rollout.ROLES}
        self.module_prior = {role: None for role in rollout.ROLES}

    def tearDown(self):
        self.tmp.cleanup()

    def _run(self, rid="r1", transition=None):
        kwargs = {}
        if transition is not None:
            kwargs = {
                "semantic_transition_proof_path": transition[0],
                "semantic_transition_proof_sha256": transition[1],
            }
        return rollout.rollout(
            self.root, self.candidates, self.dirs,
            self.queue_hashes, self.module_prior,
            rollout_id=rid, **kwargs,
        )

    def _legacy_semantic_readers(self):
        legacy = self.old_queue + (
            b"\n# semantic transition fixture\n"
            b"def blocker_attention(board):\n"
            b"    return [{'task_id': 'legacy-alert', 'resolution_status': 'UNRESOLVED'}]\n"
        )
        for directory in self.dirs.values():
            (directory / "work_queue.py").write_bytes(legacy)
        digest = hashlib.sha256(legacy).hexdigest()
        self.queue_hashes = {role: digest for role in rollout.ROLES}
        return legacy

    def _transition(self, rid):
        value = rollout.semantic_transition_proof(
            self.root, self.candidates, self.dirs,
            self.queue_hashes, self.module_prior,
            rollout_id=rid,
        )
        path = self.root / "logs" / (rid + ".json")
        raw = rollout.v2._canonical_bytes(value)
        path.write_bytes(raw)
        return path, hashlib.sha256(raw).hexdigest(), value

    def _contract_fixture(self, rid="contract-pass"):
        fixture = work_board_v2_tests.WorkBoardV2Tests()
        fixture.setUp()
        self.addCleanup(fixture.tearDown)
        fixture._resolve_blocker_fixture()
        policy_repo = fixture.root / "policy-repo"
        policy_dir = policy_repo / "docs/development/coordination"
        policy_dir.mkdir(parents=True)
        (policy_dir / "OWNERSHIP.json").write_text(json.dumps({
            "roles": {
                "A": {"allow": ["**"], "deny": []},
            }
        }))
        (policy_dir / "PLAN.md").write_text(
            "| C00 | Coordination fixture | Preserve structural transition safety |\n"
        )
        work_queue.add_task(
            fixture.root,
            "A",
            {
                "id": "active-ready",
                "role": "A",
                "plan": "C00",
                "state": "READY",
                "requires": [],
                "result": "Active row must survive hydration unchanged",
                "paths": ["tooling/active.py"],
                "acceptance": ["Preserve this exact active row through transition."],
                "basis": "Fixture for approved C00 structural transition coverage.",
            },
            repo_root=policy_repo,
        )
        candidate_queue_raw = self.candidate_queue.read_bytes()
        candidate_v2_raw = self.candidate_v2.read_bytes()
        prior_queue_raw = candidate_queue_raw + b"\n# reviewed prior queue fixture\n"
        prior_org_v2_raw = candidate_v2_raw + b"\n# reviewed prior ORG v2 fixture\n"
        dirs = {}
        repo_roots = {}
        for role in rollout.ROLES:
            repo = fixture.root / ("reader-repo-" + role)
            directory = repo / "tooling/coordination"
            directory.mkdir(parents=True)
            subprocess.run(["git", "init", "-q", str(repo)], check=True)
            (directory / "work_queue.py").write_bytes(prior_queue_raw)
            (directory / "work_board_v2.py").write_bytes(
                prior_org_v2_raw if role == "ORG" else candidate_v2_raw
            )
            dirs[role] = directory
            repo_roots[role] = repo
        candidates = {
            "work_queue": self.candidate_queue,
            "work_board_v2": self.candidate_v2,
        }
        candidate_sha = {
            name: hashlib.sha256(path.read_bytes()).hexdigest()
            for name, path in candidates.items()
        }
        queue_sha = hashlib.sha256(prior_queue_raw).hexdigest()
        expected_queue = {role: queue_sha for role in rollout.ROLES}
        expected_module = {
            role: hashlib.sha256(
                prior_org_v2_raw if role == "ORG" else candidate_v2_raw
            ).hexdigest()
            for role in rollout.ROLES
        }
        prior = {
            role: {
                "work_queue": expected_queue[role],
                "work_board_v2": expected_module[role],
            }
            for role in rollout.ROLES
        }
        contract = rollout.build_transition_contract(rid, prior, candidate_sha)
        contract_path = fixture.root / "logs" / (rid + "-contract.json")
        raw = rollout.v2._canonical_bytes(contract)
        contract_path.write_bytes(raw)
        return {
            "fixture": fixture,
            "root": fixture.root,
            "dirs": dirs,
            "repo_roots": repo_roots,
            "candidates": candidates,
            "candidate_sha": candidate_sha,
            "expected_queue": expected_queue,
            "expected_module": expected_module,
            "prior": prior,
            "contract": contract,
            "contract_path": contract_path,
            "contract_sha": hashlib.sha256(raw).hexdigest(),
            "prior_bytes": {
                role: {
                    "work_queue": prior_queue_raw,
                    "work_board_v2": (
                        prior_org_v2_raw if role == "ORG" else candidate_v2_raw
                    ),
                }
                for role in rollout.ROLES
            },
        }

    def _rewrite_contract(self, context, value):
        raw = rollout.v2._canonical_bytes(value)
        context["contract_path"].write_bytes(raw)
        return hashlib.sha256(raw).hexdigest()

    def _run_contract(self, context, *, digest=None):
        return rollout.rollout(
            context["root"],
            context["candidates"],
            context["dirs"],
            context["expected_queue"],
            context["expected_module"],
            rollout_id=context["contract"]["rollout_id"],
            transition_contract_path=context["contract_path"],
            transition_contract_sha256=digest or context["contract_sha"],
        )

    def test_transition_contract_builder_has_fixed_strict_policy_shape(self):
        prior = {role: {"work_queue": "1" * 64,
                        "work_board_v2": ("2" * 64 if role == "ORG" else "3" * 64)}
                 for role in rollout.ROLES}
        candidate = {"work_queue": "4" * 64, "work_board_v2": "3" * 64}
        contract = rollout.build_transition_contract("contract-test", prior, candidate)
        self.assertEqual(contract["kind"], rollout.TRANSITION_CONTRACT_KIND)
        self.assertEqual(contract["schema_version"], rollout.TRANSITION_CONTRACT_VERSION)
        self.assertEqual(contract["policy"], rollout.TRANSITION_CONTRACT_POLICY)
        self.assertEqual(set(contract), {"kind", "schema_version", "rollout_id", "policy", "readers"})
        with self.assertRaisesRegex(RuntimeError, "CONTRACT_INVALID"):
            rollout.build_transition_contract("contract-test", prior, dict(candidate, arbitrary="5" * 64))

    def test_contract_loader_rejects_wrong_kind_even_with_matching_hash(self):
        prior = {role: {"work_queue": "1" * 64,
                        "work_board_v2": ("2" * 64 if role == "ORG" else "3" * 64)}
                 for role in rollout.ROLES}
        candidate = {"work_queue": "4" * 64, "work_board_v2": "3" * 64}
        contract = rollout.build_transition_contract("contract-test", prior, candidate)
        contract["kind"] = "wrong"
        path = self.root / "logs/contract.json"
        raw = json.dumps(contract).encode()
        path.write_bytes(raw)
        with self.assertRaisesRegex(RuntimeError, "CONTRACT_MISMATCH"):
            rollout._load_transition_contract(self.root, path, hashlib.sha256(raw).hexdigest(),
                "contract-test", candidate,
                {role: prior[role]["work_queue"] for role in rollout.ROLES},
                {role: prior[role]["work_board_v2"] for role in rollout.ROLES})

    def test_transition_contract_builder_rejects_invalid_policy_relationships(self):
        prior = {
            role: {
                "work_queue": "1" * 64,
                "work_board_v2": ("2" * 64 if role == "ORG" else "3" * 64),
            }
            for role in rollout.ROLES
        }
        candidate = {"work_queue": "4" * 64, "work_board_v2": "3" * 64}
        cases = []
        broken = copy.deepcopy(prior)
        broken["B"]["work_queue"] = "5" * 64
        cases.append(("non-common-prior-queue", broken, candidate))
        cases.append(("queue-no-transition", prior, dict(candidate, work_queue="1" * 64)))
        broken = copy.deepcopy(prior)
        broken["B"]["work_board_v2"] = "5" * 64
        cases.append(("abc-v2-not-candidate", broken, candidate))
        broken = copy.deepcopy(prior)
        broken["ORG"]["work_board_v2"] = candidate["work_board_v2"]
        cases.append(("org-v2-not-distinct", broken, candidate))
        for name, prior_value, candidate_value in cases:
            with self.subTest(name=name):
                with self.assertRaisesRegex(RuntimeError, "CONTRACT_INVALID"):
                    rollout.build_transition_contract(
                        "policy-test", prior_value, candidate_value
                    )

    def test_contract_loader_rejects_wrong_version_rollout_and_duplicate_keys(self):
        context = self._contract_fixture("contract-loader-shape")
        for name, mutate in (
            ("version", lambda value: value.__setitem__("schema_version", 2)),
            ("rollout", lambda value: value.__setitem__("rollout_id", "other")),
        ):
            with self.subTest(name=name):
                value = copy.deepcopy(context["contract"])
                mutate(value)
                digest = self._rewrite_contract(context, value)
                with self.assertRaisesRegex(RuntimeError, "CONTRACT_MISMATCH"):
                    rollout._load_transition_contract(
                        context["root"],
                        context["contract_path"],
                        digest,
                        context["contract"]["rollout_id"],
                        context["candidate_sha"],
                        context["expected_queue"],
                        context["expected_module"],
                    )
        raw = (
            b'{"kind":"octoport.work-board-reader-transition-contract",'
            b'"kind":"duplicate","schema_version":1,"rollout_id":"contract-loader-shape",'
            b'"policy":"resolved-blocker-tombstone-hydration-v1","readers":{}}'
        )
        context["contract_path"].write_bytes(raw)
        with self.assertRaisesRegex(RuntimeError, "CONTRACT_INVALID"):
            rollout._load_transition_contract(
                context["root"],
                context["contract_path"],
                hashlib.sha256(raw).hexdigest(),
                context["contract"]["rollout_id"],
                context["candidate_sha"],
                context["expected_queue"],
                context["expected_module"],
            )

    def test_contract_loader_rejects_mapping_and_policy_drift(self):
        context = self._contract_fixture("contract-loader-policy")
        cases = []

        value = copy.deepcopy(context["contract"])
        value["readers"]["A"]["candidate_sha256"]["work_queue"] = "9" * 64
        cases.append(("candidate-map", value, context["expected_queue"], context["expected_module"]))

        value = copy.deepcopy(context["contract"])
        value["readers"]["B"]["prior_sha256"]["work_board_v2"] = "9" * 64
        modules = dict(context["expected_module"], B="9" * 64)
        cases.append(("abc-v2", value, context["expected_queue"], modules))

        value = copy.deepcopy(context["contract"])
        value["readers"]["B"]["prior_sha256"]["work_queue"] = "8" * 64
        queues = dict(context["expected_queue"], B="8" * 64)
        cases.append(("common-queue", value, queues, context["expected_module"]))

        value = copy.deepcopy(context["contract"])
        value["readers"]["ORG"]["prior_sha256"]["work_board_v2"] = context["candidate_sha"]["work_board_v2"]
        modules = dict(
            context["expected_module"],
            ORG=context["candidate_sha"]["work_board_v2"],
        )
        cases.append(("org-v2-distinct", value, context["expected_queue"], modules))

        value = copy.deepcopy(context["contract"])
        value["readers"]["A"]["prior_sha256"] = []
        cases.append(("nested-shape", value, context["expected_queue"], context["expected_module"]))

        for name, value, queues, modules in cases:
            with self.subTest(name=name):
                digest = self._rewrite_contract(context, value)
                with self.assertRaisesRegex(RuntimeError, "CONTRACT_(MISMATCH|INVALID)"):
                    rollout._load_transition_contract(
                        context["root"],
                        context["contract_path"],
                        digest,
                        context["contract"]["rollout_id"],
                        context["candidate_sha"],
                        queues,
                        modules,
                    )

    def test_transition_contract_rollout_uses_structural_verifier_and_preserves_completed_rows(self):
        context = self._contract_fixture("contract-pass")
        state = rollout.v2.load_state(context["root"])
        self.assertTrue(state["completed_rows"])
        self.assertTrue(any(
            "resolved_archive_sha256" in row for row in state["hot"]["tasks"]
        ))
        with patch.object(
            rollout,
            "_semantic",
            side_effect=AssertionError("contract mode must not run full semantic projection"),
        ):
            result = self._run_contract(context)
        self.assertEqual(result["result"], "COMMITTED")
        self.assertIsNone(result["reader_semantics_before"])
        self.assertIsNone(result["reader_semantic_sha256_before"])
        self.assertIsNone(result["reader_semantic_sha256_after"])
        transition = result["transition_contract"]
        self.assertEqual(
            transition["sha256"],
            context["contract_sha"],
        )
        self.assertEqual(transition["structural_transition"]["tombstone_count"], 1)
        self.assertRegex(
            transition["structural_transition"]["hydrated_tombstones_sha256"],
            r"^[0-9a-f]{64}$",
        )
        self.assertEqual(result["board_sha256_before"], result["board_sha256_after"])
        self.assertEqual(result["events_sha256_before"], result["events_sha256_after"])
        self.assertEqual(
            result["role_state_sha256_before"], result["role_state_sha256_after"]
        )
        for role, directory in context["dirs"].items():
            self.assertEqual(
                hashlib.sha256((directory / "work_queue.py").read_bytes()).hexdigest(),
                context["candidate_sha"]["work_queue"],
            )
            self.assertEqual(
                hashlib.sha256((directory / "work_board_v2.py").read_bytes()).hexdigest(),
                context["candidate_sha"]["work_board_v2"],
            )

    def test_structural_transition_rejects_unresolved_tombstone_and_active_row_drift(self):
        context = self._contract_fixture("contract-structural")
        module = rollout._module(self.candidate_v2, "contract_structural_test")
        state = module._load_state(context["root"], None, require_committed=True)
        summary = rollout._structural_transition(context["root"], module)
        self.assertEqual(summary["tombstone_count"], 1)

        unresolved = copy.deepcopy(state)
        tombstone = next(
            row for row in unresolved["hot"]["tasks"]
            if "resolved_archive_sha256" in row
        )
        tombstone["blocker_resolution"]["status"] = "UNRESOLVED"
        with patch.object(module, "_load_state", return_value=unresolved):
            with self.assertRaisesRegex(RuntimeError, "TOMBSTONE_INVALID"):
                rollout._structural_transition(context["root"], module)

        changed = copy.deepcopy(state)
        active = next(
            row for row in changed["logical"]["tasks"] if row["id"] == "active-ready"
        )
        active["result"] = "unexpected semantic change"
        with patch.object(module, "_load_state", return_value=changed):
            with self.assertRaisesRegex(RuntimeError, "HYDRATION_MISMATCH"):
                rollout._structural_transition(context["root"], module)

    def test_structural_transition_rejects_corrupt_resolved_archive(self):
        context = self._contract_fixture("contract-archive-corrupt")
        module = rollout._module(self.candidate_v2, "contract_archive_test")
        state = module._load_state(context["root"], None, require_committed=True)
        tombstone = next(
            row for row in state["hot"]["tasks"] if "resolved_archive_sha256" in row
        )
        archive = (
            context["root"]
            / "controllers/work-board-done/rows"
            / (tombstone["resolved_archive_sha256"] + ".json")
        )
        archive.write_bytes(b"{}")
        with self.assertRaisesRegex(RuntimeError, "HASH_MISMATCH|ARCHIVE|IMMUTABLE|RESOLVED_BLOCKER"):
            rollout._structural_transition(context["root"], module)

    def test_transition_contract_tamper_rejects_before_install(self):
        context = self._contract_fixture("contract-tamper")
        before = {
            role: {
                name: (directory / (name + ".py")).read_bytes()
                for name in ("work_queue", "work_board_v2")
            }
            for role, directory in context["dirs"].items()
        }
        context["contract_path"].write_bytes(
            context["contract_path"].read_bytes() + b" "
        )
        with self.assertRaisesRegex(RuntimeError, "CONTRACT_HASH_MISMATCH"):
            self._run_contract(context)
        for role, directory in context["dirs"].items():
            for name in ("work_queue", "work_board_v2"):
                self.assertEqual(
                    (directory / (name + ".py")).read_bytes(),
                    before[role][name],
                )

    def test_transition_contract_and_semantic_proof_modes_conflict(self):
        context = self._contract_fixture("contract-mode-conflict")
        with self.assertRaisesRegex(RuntimeError, "TRANSITION_MODE_CONFLICT"):
            rollout.rollout(
                context["root"],
                context["candidates"],
                context["dirs"],
                context["expected_queue"],
                context["expected_module"],
                rollout_id=context["contract"]["rollout_id"],
                semantic_transition_proof_path=context["contract_path"],
                semantic_transition_proof_sha256=context["contract_sha"],
                transition_contract_path=context["contract_path"],
                transition_contract_sha256=context["contract_sha"],
            )

    def test_contract_source_and_candidate_drift_while_waiting_for_locks_reject(self):
        context = self._contract_fixture("contract-source-drift")
        original_flock = rollout.fcntl.flock
        calls = {"n": 0}
        target = context["dirs"]["B"] / "work_queue.py"

        def inject_source(fd, operation):
            original_flock(fd, operation)
            if operation == rollout.fcntl.LOCK_EX:
                calls["n"] += 1
                if calls["n"] == 4:
                    target.write_bytes(target.read_bytes() + b"\n# external drift\n")

        with patch.object(rollout.fcntl, "flock", inject_source):
            with self.assertRaisesRegex(RuntimeError, "QUEUE_SOURCE_MISMATCH"):
                self._run_contract(context)

        context = self._contract_fixture("contract-candidate-drift")
        candidate = context["root"] / "logs/candidate-queue.py"
        candidate.write_bytes(self.candidate_queue.read_bytes())
        context["candidates"] = dict(context["candidates"], work_queue=candidate)
        original_flock = rollout.fcntl.flock
        calls = {"n": 0}

        def inject_candidate(fd, operation):
            original_flock(fd, operation)
            if operation == rollout.fcntl.LOCK_EX:
                calls["n"] += 1
                if calls["n"] == 4:
                    candidate.write_bytes(candidate.read_bytes() + b"\n# candidate drift\n")

        with patch.object(rollout.fcntl, "flock", inject_candidate):
            with self.assertRaisesRegex(RuntimeError, "CANDIDATE_DRIFT"):
                self._run_contract(context)

    def test_contract_board_drift_while_waiting_for_locks_rejects_before_install(self):
        context = self._contract_fixture("contract-board-drift")
        board = context["root"] / "controllers/work-board.json"
        original_flock = rollout.fcntl.flock
        calls = {"n": 0}

        def inject(fd, operation):
            original_flock(fd, operation)
            if operation == rollout.fcntl.LOCK_EX:
                calls["n"] += 1
                if calls["n"] == 4:
                    board.write_bytes(board.read_bytes() + b" ")

        with patch.object(rollout.fcntl, "flock", inject):
            with self.assertRaisesRegex(RuntimeError, "BOARD_OR_EVENT_CHANGED"):
                self._run_contract(context)
        for role, directory in context["dirs"].items():
            self.assertEqual(
                (directory / "work_queue.py").read_bytes(),
                context["prior_bytes"][role]["work_queue"],
            )
            self.assertEqual(
                (directory / "work_board_v2.py").read_bytes(),
                context["prior_bytes"][role]["work_board_v2"],
            )

    def test_contract_mid_rollout_failure_restores_exact_prior_pair_and_modes(self):
        context = self._contract_fixture("contract-rollback")
        a_queue = context["dirs"]["A"] / "work_queue.py"
        a_queue.chmod(0o640)
        prior = {
            role: {
                name: (
                    (directory / (name + ".py")).read_bytes(),
                    stat.S_IMODE((directory / (name + ".py")).stat().st_mode),
                )
                for name in ("work_queue", "work_board_v2")
            }
            for role, directory in context["dirs"].items()
        }
        real_atomic = rollout._atomic
        calls = {"n": 0}

        def fail_third(path, raw, mode, *, scratch_dir=None):
            calls["n"] += 1
            if calls["n"] == 3:
                raise OSError("injected contract rollout failure")
            return real_atomic(path, raw, mode, scratch_dir=scratch_dir)

        with patch.object(rollout, "_atomic", fail_third):
            with self.assertRaisesRegex(RuntimeError, "rollback verified"):
                self._run_contract(context)

        for role, directory in context["dirs"].items():
            for name in ("work_queue", "work_board_v2"):
                path = directory / (name + ".py")
                self.assertEqual(path.read_bytes(), prior[role][name][0])
                self.assertEqual(
                    stat.S_IMODE(path.stat().st_mode), prior[role][name][1]
                )
        self.assertFalse(
            (
                context["root"]
                / "controllers/work-board-reader-rollouts/contract-rollback.json"
            ).exists()
        )

    def test_contract_mid_rollout_shared_state_drift_fails_closed_and_restores_readers(self):
        for kind in ("board", "event", "role"):
            with self.subTest(kind=kind):
                context = self._contract_fixture("contract-shared-drift-" + kind)
                prior = {
                    role: {
                        name: (directory / (name + ".py")).read_bytes()
                        for name in ("work_queue", "work_board_v2")
                    }
                    for role, directory in context["dirs"].items()
                }
                real_atomic = rollout._atomic
                calls = {"n": 0}

                def mutate(path, raw, mode, *, scratch_dir=None):
                    result = real_atomic(path, raw, mode, scratch_dir=scratch_dir)
                    calls["n"] += 1
                    if calls["n"] == 1:
                        if kind == "board":
                            board = context["root"] / "controllers/work-board.json"
                            board.write_bytes(board.read_bytes() + b" ")
                        elif kind == "event":
                            event = context["root"] / "controllers/work-board-events.jsonl"
                            event.write_bytes(
                                (event.read_bytes() if event.exists() else b"") + b"\n"
                            )
                        else:
                            role_state = context["root"] / "C.json"
                            value = json.loads(role_state.read_text())
                            value["external_change"] = True
                            role_state.write_text(json.dumps(value))
                    return result

                with patch.object(rollout, "_atomic", mutate):
                    with self.assertRaisesRegex(
                        RuntimeError, "ROLLBACK_FAILED|rollback verified"
                    ):
                        self._run_contract(context)
                for role, directory in context["dirs"].items():
                    for name in ("work_queue", "work_board_v2"):
                        self.assertEqual(
                            (directory / (name + ".py")).read_bytes(),
                            prior[role][name],
                        )

    def test_atomic_failure_does_not_unlink_replaced_temp_path(self):
        target = Path(self.tmp.name) / "atomic-target.py"
        target.write_bytes(b"prior")
        target.chmod(0o640)
        real_open = rollout.os.open
        real_write = rollout.os.write
        captured = {}
        sabotaged = {"done": False}

        def capture_open(path, flags, mode=0o777, *args, **kwargs):
            fd = real_open(path, flags, mode, *args, **kwargs)
            captured["path"] = Path(path)
            return fd

        def replace_then_fail(fd, data):
            if not sabotaged["done"]:
                sabotaged["done"] = True
                temp = captured["path"]
                temp.unlink()
                temp.write_bytes(b"replacement-owned-elsewhere")
                raise OSError("injected write failure after temp replacement")
            return real_write(fd, data)

        with (
            patch.object(rollout.os, "open", capture_open),
            patch.object(rollout.os, "write", replace_then_fail),
        ):
            with self.assertRaisesRegex(OSError, "injected write failure"):
                rollout._atomic(target, b"candidate", 0o640)

        self.assertEqual(target.read_bytes(), b"prior")
        replacement = captured["path"]
        self.assertTrue(replacement.is_file())
        self.assertEqual(replacement.read_bytes(), b"replacement-owned-elsewhere")

    def test_atomic_replace_failure_retains_owned_scratch_without_unlink(self):
        target = Path(self.tmp.name) / "atomic-retained-target.py"
        target.write_bytes(b"prior")
        target.chmod(0o640)
        scratch = self.root / "controllers/work-board-reader-rollouts"
        scratch.mkdir(parents=True, exist_ok=True)

        with (
            patch.object(
                rollout.os, "replace",
                side_effect=OSError("injected replace failure after identity check"),
            ),
            patch.object(
                Path, "unlink",
                side_effect=AssertionError("failure cleanup must not unlink a pathname"),
            ),
        ):
            with self.assertRaisesRegex(OSError, "injected replace failure"):
                rollout._atomic(
                    target, b"candidate", 0o640, scratch_dir=scratch,
                )

        self.assertEqual(target.read_bytes(), b"prior")
        retained = list(scratch.glob(".atomic-retained-target.py.rollout.*.tmp"))
        self.assertEqual(len(retained), 1)
        self.assertEqual(retained[0].read_bytes(), b"candidate")
        self.assertEqual(stat.S_IMODE(retained[0].stat().st_mode), 0o640)

    def test_semantic_snapshot_accepts_v2_logical_board(self):
        class V2Reader:
            @staticmethod
            def load_board(_root):
                return {
                    "version": 2, "revision": 7,
                    "updated_at": "2026-10-03T00:00:00+00:00",
                    "tasks": [],
                }

            @staticmethod
            def task_view(_board, task):
                return task

            @staticmethod
            def role_work(_root, role):
                return {"role": role, "tasks": [], "owner_attention": []}

            @staticmethod
            def blocker_attention(_board):
                return []

            @staticmethod
            def board_snapshot(_root):
                return {"exists": True, "sha256": "a" * 64}

            @staticmethod
            def status_work(_root, role):
                return {"role": role, "tasks": [], "action_required": False}

        value = rollout._semantic(V2Reader, self.root)
        self.assertEqual(value["board"]["version"], 2)
        self.assertEqual(value["blocker_attention"], [])
        self.assertEqual(set(value["role_work"]), set("ABC"))

    def test_semantic_validation_reads_scale_with_distinct_task_evidence_and_restore(self):
        rows = []
        for index in range(12):
            rows.append({
                "id": f"tampered-{index}", "role": "B", "plan": "B04", "state": "DONE",
                "requires": [], "result": "result", "paths": [f"tooling/{index}.py"],
                "completion_receipt_format": work_queue.COMPLETION_VERSION,
                "completion_receipt": str(self.root / "logs/tampered.json"),
                "completion_candidate_sha": "a" * 40,
            })
        (self.root / "logs/tampered.json").write_text('{"verdict":"PASS"}')
        board_path = self.root / "controllers/work-board.json"
        board_path.write_text(json.dumps({"version": 1, "revision": 2, "tasks": rows}))
        original_receipt = work_queue._completion_receipt
        original_publication = work_queue._publication_snapshot_valid
        with (
            patch.object(work_queue, "_completion_receipt", wraps=original_receipt) as receipt,
            patch.object(work_queue, "_publication_snapshot_valid", wraps=original_publication) as publication,
        ):
            value = rollout._semantic(work_queue, self.root)
        self.assertEqual(receipt.call_count, 2 * len(rows))
        # Receipt failure short-circuits publication validation, as it must.
        self.assertEqual(publication.call_count, 0)
        self.assertTrue(all(row["state"] == "BLOCKED" for row in value["task_views"]))
        self.assertIs(work_queue._completion_receipt, original_receipt)
        self.assertIs(work_queue._publication_snapshot_valid, original_publication)

    def test_semantic_validation_cache_misses_changed_task_identity_and_restores_on_error(self):
        first = {"id": "same", "role": "B", "plan": "B04", "state": "DONE", "requires": [],
                 "result": "r", "paths": ["tooling/a.py"],
                 "completion_receipt_format": work_queue.COMPLETION_VERSION,
                 "completion_receipt": str(self.root / "logs/tampered.json"),
                 "completion_candidate_sha": "a" * 40}
        second = dict(first, id="same-other", completion_candidate_sha="b" * 40)
        (self.root / "logs/tampered.json").write_text('{"verdict":"PASS"}')
        board_path = self.root / "controllers/work-board.json"
        board_path.write_text(json.dumps({"version": 1, "revision": 3, "tasks": [first, second]}))
        original = work_queue._completion_receipt
        with patch.object(work_queue, "_completion_receipt", wraps=original) as receipt:
            rollout._semantic(work_queue, self.root)
        self.assertEqual(receipt.call_count, 4)
        self.assertIs(work_queue._completion_receipt, original)

        class RaisingReader:
            _BoardEvaluation = work_queue._BoardEvaluation
            load_board = staticmethod(lambda _root: {"version": 1, "tasks": []})
            task_view = staticmethod(lambda _board, _task, evaluation=None: None)
            role_work = staticmethod(lambda _root, _role: {})
            blocker_attention = staticmethod(lambda _board: [])
            board_snapshot = staticmethod(lambda _root: {})
            status_work = staticmethod(lambda _root, _role: (_ for _ in ()).throw(ValueError("boom")))

        with self.assertRaisesRegex(ValueError, "boom"):
            rollout._semantic(RaisingReader, self.root)
        self.assertIs(work_queue._completion_receipt, original)

    def test_semantic_direct_projection_shares_board_evaluation(self):
        seen = []

        class Evaluation:
            def __init__(self, board):
                self.board = board

        class EvaluatedReader:
            _BoardEvaluation = Evaluation
            load_board = staticmethod(lambda _root: {"version": 1, "tasks": [{"id": "one"}, {"id": "two"}]})

            @staticmethod
            def task_view(_board, task, evaluation=None):
                seen.append(evaluation)
                return {"id": task["id"]}

            @staticmethod
            def role_work(_root, _role):
                return {}

            @staticmethod
            def blocker_attention(_board):
                return []

            @staticmethod
            def board_snapshot(_root):
                return {}

            @staticmethod
            def status_work(_root, _role):
                return {}

        value = rollout._semantic(EvaluatedReader, self.root)
        self.assertEqual(value["task_views"], [{"id": "one"}, {"id": "two"}])
        self.assertEqual(len(seen), 2)
        self.assertIs(seen[0], seen[1])

    def test_manual_evidence_consumer_set_up_error_cleans_global_patch(self):
        # Reproduce the actual three consumer methods as a nested unittest
        # runner. If EvidenceProvenanceTests.setUp raises only AFTER its
        # process-global patch starts, the parent must still run its cleanup.
        original_resolver = work_queue._evidence_source_repo
        original_init = work_queue_tests.EvidenceProvenanceTests.__init__
        consumer_tests = (
            "test_semantic_evidence_done_parity_with_role_work_and_tamper",
            "test_semantic_revalidates_operational_evidence_after_projection",
            "test_semantic_evidence_forged_control_root_fails_closed",
        )
        for consumer in consumer_tests:
            with self.subTest(consumer=consumer):
                captured = []

                def tracking_init(fixture, *args, **kwargs):
                    original_init(fixture, *args, **kwargs)
                    captured.append(fixture)

                child = ReaderRolloutTests(consumer)
                outcome = unittest.TestResult()
                try:
                    with patch.object(
                        work_queue_tests.EvidenceProvenanceTests,
                        "__init__", tracking_init,
                    ), patch.object(
                        work_queue_tests.EvidenceProvenanceTests,
                        "update_manifest",
                        side_effect=RuntimeError("injected setup after patch start"),
                    ):
                        child.run(outcome)
                    self.assertEqual(len(outcome.errors), 1)
                    self.assertIn("injected setup after patch start",
                                  outcome.errors[0][1])
                    self.assertEqual(outcome.failures, [])
                    self.assertIs(work_queue._evidence_source_repo,
                                  original_resolver)
                finally:
                    # Emergency RED-test isolation only. The assertion above
                    # must pass BEFORE this safety cleanup on a fixed consumer.
                    for fixture in captured:
                        fixture.doCleanups()
                    self.assertIs(work_queue._evidence_source_repo,
                                  original_resolver)

    def test_semantic_evidence_done_parity_with_role_work_and_tamper(self):
        # The external role-work and direct task-view projections must agree
        # on exact evidence-only DONE on this board's trusted control root.
        fixture = work_queue_tests.EvidenceProvenanceTests()
        # Manually constructed TestCase.setUp does not receive unittest's
        # automatic doCleanups on failure. Register cleanup in the owning
        # consumer BEFORE setup; a partly initialized Git source fixture must
        # never leave process-global provenance resolver monkeypatched.
        self.addCleanup(fixture.doCleanups)
        fixture.setUp()
        self.addCleanup(fixture.tearDown)
        fixture.start()
        fixture.finish()
        task = fixture.done()
        self.assertTrue(work_queue._strict_completion_valid(
            task, root=fixture.root))
        # Accepted DONE is intentionally omitted from role_work's actionable
        # list; direct views and rollout views must still validate as DONE.
        direct_board = work_queue.load_board(fixture.root)
        self.assertEqual(work_queue.task_view(
            direct_board, direct_board["tasks"][0], root=fixture.root)["state"], "DONE")
        self.assertEqual(work_queue.role_work(fixture.root, "B")["tasks"], [])
        value = rollout._semantic(work_queue, fixture.root)
        self.assertEqual(value["task_views"][0]["state"], "DONE")
        self.assertEqual(value["role_work"]["B"]["tasks"], [])
        self.assertEqual(value["status"]["B"]["tasks"], [])
        self.assertEqual(value["blocker_attention"], [])
        # Independent evidence drift affects one card, not the whole board.
        original = fixture.review.read_bytes()
        fixture.review.write_bytes(original + b"\nTAMPER")
        tampered = rollout._semantic(work_queue, fixture.root)
        self.assertEqual(tampered["task_views"][0]["state"], "BLOCKED")
        self.assertTrue(tampered["task_views"][0]["completion_invalidated"])
        self.assertEqual(tampered["role_work"]["B"]["tasks"][0]["state"], "BLOCKED")
        self.assertEqual(tampered["status"]["B"]["tasks"][0]["state"], "BLOCKED")
        fixture.review.write_bytes(original)
        restored = rollout._semantic(work_queue, fixture.root)
        self.assertEqual(restored["task_views"][0]["state"], "DONE")

    def test_semantic_revalidates_operational_evidence_after_projection(self):
        fixture = work_queue_tests.EvidenceProvenanceTests()
        # Manually constructed TestCase.setUp does not receive unittest's
        # automatic doCleanups on failure. Register cleanup in the owning
        # consumer BEFORE setup; a partly initialized Git source fixture must
        # never leave process-global provenance resolver monkeypatched.
        self.addCleanup(fixture.doCleanups)
        fixture.setUp()
        self.addCleanup(fixture.tearDown)
        fixture.start()
        fixture.finish()
        original = work_queue._evidence_snapshot_valid
        with patch.object(
            work_queue, "_evidence_snapshot_valid",
            side_effect=[True, False],
        ) as validator:
            with self.assertRaisesRegex(
                RuntimeError, "WORK_BOARD_V2_ROLLOUT_VALIDATION_EVIDENCE_CHANGED",
            ):
                rollout._semantic(work_queue, fixture.root)
            self.assertEqual(validator.call_count, 2)
        self.assertIs(work_queue._evidence_snapshot_valid, original)

    def test_semantic_evidence_forged_control_root_fails_closed(self):
        fixture = work_queue_tests.EvidenceProvenanceTests()
        # Manually constructed TestCase.setUp does not receive unittest's
        # automatic doCleanups on failure. Register cleanup in the owning
        # consumer BEFORE setup; a partly initialized Git source fixture must
        # never leave process-global provenance resolver monkeypatched.
        self.addCleanup(fixture.doCleanups)
        fixture.setUp()
        self.addCleanup(fixture.tearDown)
        fixture.start()
        fixture.finish()
        task = fixture.done()
        with tempfile.TemporaryDirectory() as alt:
            other = Path(alt)
            shutil.copytree(fixture.dir, other / "logs/B/observed-runtime")
            snapshot = task["completion_evidence_snapshot"]
            snapshot["control_root"] = str(other.resolve())
            snapshot["manifest_path"] = str(
                other / "logs/B/observed-runtime/MANIFEST.json")
            fixture.boardfile.write_text(json.dumps({
                "version": 1, "revision": 7, "tasks": [task]}))
            direct = work_queue.role_work(fixture.root, "B")["tasks"][0]
            self.assertEqual(direct["state"], "BLOCKED")
            optimized = rollout._semantic(work_queue, fixture.root)
            self.assertEqual(optimized["task_views"][0]["state"], "BLOCKED")
            self.assertTrue(optimized["task_views"][0]["completion_invalidated"])
            self.assertEqual(optimized["role_work"]["B"]["tasks"][0]["state"], "BLOCKED")

    def test_semantic_matches_uncached_reference_for_resolved_tombstone(self):
        fixture = work_queue_tests.WorkQueueTests()
        fixture.setUp()
        try:
            blocked_receipt = fixture.root / "logs/old-blocked.json"
            blocked_receipt.write_text('{"reason":"superseded"}')
            fixture.receipt = fixture.root / "logs/successor.json"
            fixture.board = {"version": 1, "revision": 12, "tasks": [
                {"id": "old-attempt", "role": "B", "plan": "C00", "state": "BLOCKED", "requires": [],
                 "result": "Historical failed attempt", "paths": ["tooling/old.py"],
                 "blocked_reason": "Superseded", "blocked_receipt": str(blocked_receipt),
                 "blocker_resolution": {"owner": "CONTROLLER", "next_action": "Find corrected successor",
                                         "unblock_when": "Accepted successor exists", "status": "UNRESOLVED"}},
                {"id": "accepted-successor", "role": "B", "plan": "C00", "state": "IN_PROGRESS", "requires": [],
                 "result": "Accepted corrected successor", "paths": ["tooling/new.py"]},
                {"id": "consumer", "role": "A", "plan": "C00", "state": "READY", "requires": ["old-attempt"],
                 "result": "Must remain blocked by tombstone", "paths": ["tooling/consumer.py"]},
            ]}
            fixture.save()
            fixture.completion("accepted-successor")
            work_queue.advance_task(fixture.root, "B", "accepted-successor", "DONE", str(fixture.receipt))
            work_queue.resolve_blocker(fixture.root, "B", "old-attempt", "accepted-successor", str(fixture.receipt))
            board = work_queue.load_board(fixture.root)
            reference = {
                "board": board,
                "task_views": [work_queue.task_view(board, task) for task in board["tasks"]],
                "role_work": {role: work_queue.role_work(fixture.root, role) for role in "ABC"},
                "blocker_attention": work_queue.blocker_attention(board),
                "snapshots": {role: work_queue.board_snapshot(fixture.root) for role in "ABC"},
                "status": {role: work_queue.status_work(fixture.root, role) for role in "ABC"},
            }
            original_publication = work_queue._publication_snapshot_valid
            with patch.object(work_queue, "_publication_snapshot_valid", wraps=original_publication) as publication:
                optimized = rollout._semantic(work_queue, fixture.root)
            self.assertEqual(publication.call_count, 2)
            self.assertEqual(optimized, reference)
            old_view = next(row for row in optimized["task_views"] if row["id"] == "old-attempt")
            consumer = next(row for row in optimized["task_views"] if row["id"] == "consumer")
            self.assertEqual(old_view["resolution_status"], "RESOLVED")
            self.assertEqual(old_view["state"], "BLOCKED")
            self.assertEqual(consumer["state"], "BLOCKED")
        finally:
            fixture.tearDown()

    def test_semantic_revalidates_cached_completion_evidence_before_return(self):
        task = {
            "id": "evidence-task", "role": "B", "plan": "B04", "state": "DONE",
            "requires": [], "result": "result", "paths": ["tooling/evidence.py"],
            "completion_receipt_format": work_queue.COMPLETION_VERSION,
            "completion_receipt": str(self.root / "logs/evidence.json"),
            "completion_candidate_sha": "a" * 40,
        }
        (self.root / "controllers/work-board.json").write_text(
            json.dumps({"version": 1, "revision": 4, "tasks": [task]})
        )
        valid_receipt = {
            "kind": work_queue.COMPLETION_KIND,
            "version": work_queue.COMPLETION_VERSION,
            "task_id": task["id"],
            "candidate_sha": task["completion_candidate_sha"],
            "verdict": "PASS",
            "review": {"verdict": "PASS", "evidence": ["review"]},
            "checks": [{"name": "focused", "verdict": "PASS", "evidence": ["test"]}],
        }
        original = work_queue._completion_receipt
        with patch.object(
            work_queue, "_completion_receipt", side_effect=[valid_receipt, None]
        ) as receipt:
            with self.assertRaisesRegex(
                RuntimeError, "WORK_BOARD_V2_ROLLOUT_VALIDATION_EVIDENCE_CHANGED"
            ):
                rollout._semantic(work_queue, self.root)
        self.assertEqual(receipt.call_count, 2)
        self.assertIs(work_queue._completion_receipt, original)

    def test_semantic_rejects_in_memory_board_mutation(self):
        board = {
            "version": 1,
            "revision": 5,
            "tasks": [{
                "id": "mutable", "role": "C", "plan": "C00",
                "state": "IN_PROGRESS", "requires": [], "result": "before",
                "paths": ["tooling/mutable.py"],
            }],
        }
        (self.root / "controllers/work-board.json").write_text(json.dumps(board))

        class MutatingReader:
            _BoardEvaluation = work_queue._BoardEvaluation
            load_board = staticmethod(lambda _root: board)
            task_view = staticmethod(work_queue.task_view)

            @staticmethod
            def role_work(_root, role):
                if role == "A":
                    board["tasks"][0]["result"] = "after"
                return {}

            blocker_attention = staticmethod(lambda _board: [])
            board_snapshot = staticmethod(lambda _root: {})
            status_work = staticmethod(lambda _root, _role: {})

        with self.assertRaisesRegex(
            RuntimeError, "WORK_BOARD_V2_ROLLOUT_IN_MEMORY_BOARD_CHANGED"
        ):
            rollout._semantic(MutatingReader, self.root)

    def test_rollout_installs_exact_pair_and_preserves_v1_semantics(self):
        result = self._run()
        self.assertEqual(result["result"], "COMMITTED")
        self.assertEqual(set(result["candidate_sha256"]), {"work_queue", "work_board_v2"})
        self.assertEqual(result["board_sha256_before"], result["board_sha256_after"])
        self.assertEqual(result["events_sha256_before"], result["events_sha256_after"])
        for directory in self.dirs.values():
            self.assertEqual(hashlib.sha256((directory / "work_queue.py").read_bytes()).hexdigest(), result["candidate_sha256"]["work_queue"])
            self.assertEqual(hashlib.sha256((directory / "work_board_v2.py").read_bytes()).hexdigest(), result["candidate_sha256"]["work_board_v2"])
        self.assertEqual(json.loads((self.root / "controllers/work-board.json").read_text())["version"], 1)
        for repo in self.repo_roots.values():
            self.assertFalse((repo / "tooling/coordination/__pycache__").exists())

    def test_reviewed_semantic_transition_installs_exact_expected_semantics(self):
        legacy = self._legacy_semantic_readers()
        path, digest, proof = self._transition("semantic-pass")
        self.assertTrue(any(
            row["before_semantic_sha256"] != row["after_semantic_sha256"]
            for row in proof["readers"].values()
        ))
        result = self._run("semantic-pass", (path, digest))
        self.assertEqual(result["result"], "COMMITTED")
        self.assertEqual(
            result["semantic_transition_proof"],
            {"path": str(path.resolve()), "sha256": digest},
        )
        self.assertEqual(
            result["role_state_sha256_before"],
            result["role_state_sha256_after"],
        )
        self.assertEqual(
            result["board_sha256_before"],
            result["board_sha256_after"],
        )
        self.assertEqual(
            result["events_sha256_before"],
            result["events_sha256_after"],
        )
        for role, directory in self.dirs.items():
            self.assertNotEqual((directory / "work_queue.py").read_bytes(), legacy)
            self.assertEqual(
                hashlib.sha256((directory / "work_queue.py").read_bytes()).hexdigest(),
                result["candidate_sha256"]["work_queue"],
            )
            self.assertEqual(
                result["reader_semantic_sha256_after"][role],
                proof["readers"][role]["after_semantic_sha256"],
            )

    def test_stale_board_semantic_transition_proof_rejects_before_install(self):
        legacy = self._legacy_semantic_readers()
        path, digest, _proof = self._transition("semantic-stale")
        board_path = self.root / "controllers/work-board.json"
        board = json.loads(board_path.read_text())
        board["revision"] += 1
        board["updated_at"] = "2026-10-02T00:00:01+00:00"
        board_path.write_text(json.dumps(board))
        before_states = {
            role: (self.root / f"{role}.json").read_bytes() for role in "ABC"
        }
        with self.assertRaisesRegex(RuntimeError, "TRANSITION_PROOF_MISMATCH"):
            self._run("semantic-stale", (path, digest))
        for directory in self.dirs.values():
            self.assertEqual((directory / "work_queue.py").read_bytes(), legacy)
            self.assertFalse((directory / "work_board_v2.py").exists())
        self.assertEqual(
            before_states,
            {role: (self.root / f"{role}.json").read_bytes() for role in "ABC"},
        )

    def test_tampered_semantic_transition_proof_rejects_before_install(self):
        legacy = self._legacy_semantic_readers()
        path, digest, _proof = self._transition("semantic-tamper")
        path.write_bytes(path.read_bytes() + b" ")
        with self.assertRaisesRegex(RuntimeError, "TRANSITION_PROOF_HASH_MISMATCH"):
            self._run("semantic-tamper", (path, digest))
        for directory in self.dirs.values():
            self.assertEqual((directory / "work_queue.py").read_bytes(), legacy)
            self.assertFalse((directory / "work_board_v2.py").exists())

    def test_unexpected_semantic_delta_rolls_back_exact_prior_readers(self):
        legacy = self._legacy_semantic_readers()
        a_queue = self.dirs["A"] / "work_queue.py"
        a_queue.chmod(0o640)
        self.assertEqual(stat.S_IMODE(a_queue.stat().st_mode), 0o640)
        path, digest, _proof = self._transition("semantic-rollback")
        board_path = self.root / "controllers/work-board.json"
        before_board = board_path.read_bytes()
        event_path = self.root / "controllers/work-board-events.jsonl"
        before_event = event_path.read_bytes() if event_path.exists() else None
        before_states = {
            role: (self.root / f"{role}.json").read_bytes() for role in "ABC"
        }
        original = rollout._semantic
        calls = {"n": 0}

        def inject(module, root):
            value = original(module, root)
            calls["n"] += 1
            # 4 baseline readers + 1 candidate proof check precede the first
            # installed-reader readback. Inject only after writes have begun.
            if calls["n"] == 6:
                value = copy.deepcopy(value)
                value["task_views"] = [{"unexpected": "task-view-delta"}]
                value["blocker_attention"] = [
                    {"task_id": "unexpected-after-install"}
                ]
            return value

        prior_umask = os.umask(0o077)
        try:
            with patch.object(rollout, "_semantic", inject):
                with self.assertRaisesRegex(RuntimeError, "rollback verified"):
                    self._run("semantic-rollback", (path, digest))
        finally:
            os.umask(prior_umask)
        self.assertEqual(stat.S_IMODE(a_queue.stat().st_mode), 0o640)
        for directory in self.dirs.values():
            self.assertEqual((directory / "work_queue.py").read_bytes(), legacy)
            self.assertFalse((directory / "work_board_v2.py").exists())
        self.assertEqual(board_path.read_bytes(), before_board)
        self.assertEqual(
            event_path.read_bytes() if event_path.exists() else None,
            before_event,
        )
        self.assertEqual(
            before_states,
            {role: (self.root / f"{role}.json").read_bytes() for role in "ABC"},
        )
        self.assertFalse(
            (self.root / "controllers/work-board-reader-rollouts/semantic-rollback.json").exists()
        )

    def test_queue_hash_mismatch_rejects_before_any_install(self):
        hashes = dict(self.queue_hashes, B="0" * 64)
        with self.assertRaisesRegex(RuntimeError, "QUEUE_SOURCE_MISMATCH"):
            rollout.rollout(self.root, self.candidates, self.dirs, hashes, self.module_prior, rollout_id="bad")
        self.assertTrue(all((directory / "work_queue.py").read_bytes() == self.old_queue for directory in self.dirs.values()))
        self.assertFalse(any((directory / "work_board_v2.py").exists() for directory in self.dirs.values()))

    def test_operational_org_reader_outside_git_is_supported_explicitly(self):
        shutil.rmtree(self.repo_roots["ORG"] / ".git")
        # These fixtures also run from a managed task-local TMPDIR nested
        # inside the developer's source Git worktree. Recreate the true
        # production ORG condition (no Git ancestor), not the incidental
        # parent repository of the test runner. The reader's production
        # _git_status guard is unchanged.
        fixture = Path(self.tmp.name).resolve()
        original_lexists = os.path.lexists

        def only_fixture_git_files(path):
            candidate = Path(path)
            if (candidate.name == ".git"
                    and not candidate.parent.resolve().is_relative_to(fixture)):
                return False
            return original_lexists(path)

        with patch.dict(os.environ, {
                "GIT_CEILING_DIRECTORIES": str(fixture.parent)}), \
             patch.object(rollout.os.path, "lexists",
                          side_effect=only_fixture_git_files):
            result = self._run("org-nonrepo")
        self.assertEqual(result["result"], "COMMITTED")
        self.assertEqual(result["git_status_before"]["ORG"], "ORG_OPERATIONAL_READER_OUTSIDE_GIT")
        self.assertEqual(result["git_status_before"]["ORG"], result["git_status_after"]["ORG"])

    def test_non_git_canonical_role_still_rejected(self):
        shutil.rmtree(self.repo_roots["A"] / ".git")
        # An unrelated Git repository above the task-local fixture must
        # not silently replace the intentionally missing A repository.
        with patch.dict(os.environ, {
                "GIT_CEILING_DIRECTORIES": str(Path(self.tmp.name).resolve().parent)}):
            with self.assertRaisesRegex(RuntimeError, "GIT_STATUS_UNAVAILABLE"):
                self._run("a-nonrepo")
        self.assertFalse(any((directory / "work_board_v2.py").exists() for directory in self.dirs.values()))

    def test_source_drift_while_waiting_for_locks_is_preserved(self):
        original_flock = rollout.fcntl.flock
        calls = {"n": 0}
        target = self.dirs["B"] / "work_queue.py"
        changed = self.old_queue + b"\n# intervening source change\n"
        def inject(fd, operation):
            original_flock(fd, operation)
            if operation == rollout.fcntl.LOCK_EX:
                calls["n"] += 1
                if calls["n"] == 4:
                    target.write_bytes(changed)
        with patch.object(rollout.fcntl, "flock", inject):
            with self.assertRaisesRegex(RuntimeError, "QUEUE_SOURCE_MISMATCH"):
                self._run("source-drift")
        self.assertEqual(target.read_bytes(), changed)
        self.assertFalse(any((directory / "work_board_v2.py").exists() for directory in self.dirs.values()))

    def test_candidate_drift_while_waiting_for_locks_rejected_before_install(self):
        candidate = Path(self.tmp.name) / "candidate_queue.py"
        candidate.write_bytes(self.candidate_queue.read_bytes())
        self.candidates["work_queue"] = candidate
        original_flock = rollout.fcntl.flock
        calls = {"n": 0}
        def inject(fd, operation):
            original_flock(fd, operation)
            if operation == rollout.fcntl.LOCK_EX:
                calls["n"] += 1
                if calls["n"] == 4:
                    candidate.write_bytes(candidate.read_bytes() + b"\n# changed candidate\n")
        with patch.object(rollout.fcntl, "flock", inject):
            with self.assertRaisesRegex(RuntimeError, "CANDIDATE_DRIFT"):
                self._run("candidate-drift")
        self.assertTrue(all((directory / "work_queue.py").read_bytes() == self.old_queue for directory in self.dirs.values()))
        self.assertFalse(any((directory / "work_board_v2.py").exists() for directory in self.dirs.values()))

    def test_mid_rollout_failure_restores_both_exact_prior_files(self):
        status_before = {
            role: subprocess.run(
                ["git", "-C", str(repo), "status", "--porcelain=v1", "--untracked-files=all"],
                check=True, capture_output=True, text=True,
            ).stdout
            for role, repo in self.repo_roots.items()
        }
        real_replace = os.replace
        calls = {"n": 0}

        def fail_third(src, dst):
            calls["n"] += 1
            if calls["n"] == 3:
                raise OSError("injected second-target failure")
            return real_replace(src, dst)

        with patch.object(rollout.os, "replace", fail_third):
            with self.assertRaisesRegex(RuntimeError, "rollback verified"):
                self._run("fail")

        for directory in self.dirs.values():
            self.assertEqual((directory / "work_queue.py").read_bytes(), self.old_queue)
            self.assertFalse((directory / "work_board_v2.py").exists())
        self.assertFalse((self.root / "controllers/work-board-reader-rollouts/fail.json").exists())
        self.assertEqual(json.loads((self.root / "controllers/work-board.json").read_text())["version"], 1)
        status_after = {
            role: subprocess.run(
                ["git", "-C", str(repo), "status", "--porcelain=v1", "--untracked-files=all"],
                check=True, capture_output=True, text=True,
            ).stdout
            for role, repo in self.repo_roots.items()
        }
        self.assertEqual(status_after, status_before)
        scratch = self.root / "controllers/work-board-reader-rollouts"
        self.assertTrue(
            any(scratch.glob(".*.rollout.*.tmp")),
            "failed atomic write must retain evidence in control-root scratch",
        )

    def test_prior_missing_rollback_preserves_replacement_inode(self):
        victim = self.dirs["A"] / "work_board_v2.py"
        replacement_bytes = b"# external replacement must survive rollback\n"
        replacement_identity = {}
        board_before = (self.root / "controllers/work-board.json").read_bytes()
        event_path = self.root / "controllers/work-board-events.jsonl"
        events_before = event_path.read_bytes() if event_path.exists() else None
        role_state_before = {
            role: (self.root / f"{role}.json").read_bytes()
            for role in "ABC"
        }
        real_atomic = rollout._atomic
        calls = {"n": 0}

        def replace_then_fail(path, raw, mode, *, scratch_dir=None):
            calls["n"] += 1
            if calls["n"] == 3:
                replacement = self.root / "external-replacement.py"
                replacement.write_bytes(replacement_bytes)
                os.replace(replacement, victim)
                info = victim.stat()
                replacement_identity["value"] = (info.st_dev, info.st_ino)
                raise OSError("injected failure after replacement")
            return real_atomic(path, raw, mode, scratch_dir=scratch_dir)

        with patch.object(rollout, "_atomic", replace_then_fail):
            with self.assertRaisesRegex(
                RuntimeError,
                "WORK_BOARD_V2_ROLLOUT_ROLLBACK_FAILED",
            ):
                self._run("replacement-survives")

        self.assertTrue(victim.is_file())
        self.assertEqual(victim.read_bytes(), replacement_bytes)
        current = victim.stat()
        self.assertEqual(
            (current.st_dev, current.st_ino),
            replacement_identity["value"],
            "rollback must preserve the exact replacement inode",
        )
        self.assertEqual(
            (self.dirs["A"] / "work_queue.py").read_bytes(),
            self.old_queue,
        )
        self.assertEqual(
            (self.root / "controllers/work-board.json").read_bytes(),
            board_before,
        )
        self.assertEqual(
            event_path.read_bytes() if event_path.exists() else None,
            events_before,
        )
        self.assertEqual(
            {role: (self.root / f"{role}.json").read_bytes() for role in "ABC"},
            role_state_before,
        )

    def test_unexpected_existing_helper_refuses_before_any_target_change(self):
        old_helper = b"# unreviewed old helper\n"
        (self.dirs["A"] / "work_board_v2.py").write_bytes(old_helper)
        prior = dict(self.module_prior)
        prior["A"] = "f" * 64
        with self.assertRaisesRegex(RuntimeError, "PRIOR_MODULE_MISMATCH"):
            rollout.rollout(self.root, self.candidates, self.dirs, self.queue_hashes, prior, rollout_id="prior")
        self.assertEqual((self.dirs["A"] / "work_board_v2.py").read_bytes(), old_helper)
        for role in ("B", "C", "ORG"):
            self.assertEqual((self.dirs[role] / "work_queue.py").read_bytes(), self.old_queue)

    def test_only_executing_role_stop_blocks_rollout(self):
        (self.root / "A.json").write_text('{"status":"STOPPED"}')
        (self.root / "B.json").write_text('{"status":"STOPPED"}')
        (self.root / "C.json").write_text('{"status":"STOPPED"}')
        with self.assertRaisesRegex(RuntimeError, "STOPPED"):
            self._run("stop-c")
        self.assertFalse(any((directory / "work_board_v2.py").exists() for directory in self.dirs.values()))


if __name__ == "__main__":
    unittest.main()
