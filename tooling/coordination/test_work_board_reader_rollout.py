import ast
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


def _issuer_bound_migration_fixture():
    class _IssuerBoundMigrationFixture(work_board_v2_tests.WorkBoardV2Tests):
        """Real A migration issuer, exact C readers: no authority bypass.

        A's migration module checks its own source HEAD and three file hashes.
        The imported A unit fixture otherwise derives its issuer identity from
        the C work_queue module selected by this test runner. Keep source issuer
        and reader hashes separate, as the production authority schema does.
        """

        def grant(self, raw, *, authority_id="test-001", alter=None):
            authority = super().grant(raw, authority_id=authority_id)
            issuer = Path(work_board_v2_tests.migrate.__file__).resolve()
            if issuer.name != "work_board_v2_migrate.py":
                raise RuntimeError("TEST_MIGRATION_ISSUER_SOURCE_INVALID")
            directory = issuer.parent
            for name in ("work_queue.py", "work_board_v2.py",
                         "work_board_v2_migrate.py"):
                candidate = directory / name
                if not candidate.is_file() or candidate.is_symlink():
                    raise RuntimeError("TEST_MIGRATION_ISSUER_SOURCE_INVALID")
            head = subprocess.run(
                ["git", "-C", str(issuer.parents[2]), "rev-parse", "HEAD"],
                check=True, capture_output=True, text=True, timeout=7,
            ).stdout.strip()
            if len(head) != 40 or any(c not in "0123456789abcdef" for c in head):
                raise RuntimeError("TEST_MIGRATION_ISSUER_HEAD_INVALID")
            value = json.loads(authority.read_text())
            value.update({
                "source_candidate_sha": head,
                "work_queue_sha256": hashlib.sha256(
                    (directory / "work_queue.py").read_bytes()).hexdigest(),
                "work_board_v2_sha256": hashlib.sha256(
                    (directory / "work_board_v2.py").read_bytes()).hexdigest(),
                "migrate_sha256": hashlib.sha256(issuer.read_bytes()).hexdigest(),
            })
            if alter:
                value.update(alter)
            authority.write_text(json.dumps(
                value, sort_keys=True, separators=(",", ":")) + "\n")
            authority.chmod(0o600)
            return authority

    return _IssuerBoundMigrationFixture()


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
        # Retain a separate reader-only release fixture. A writer release must
        # not turn the module-only reader updater into a writer installer.
        self.writer_candidate_v2 = Path(work_queue.__file__).resolve().with_name("work_board_v2.py")
        reader_repo = Path(self.tmp.name) / "reader-only-source-fixture"
        reader_directory = reader_repo / "tooling/coordination"
        reader_directory.mkdir(parents=True)
        for name in ("work_queue.py", "work_board_v2.py", "work_board_reader_rollout.py"):
            raw = Path(work_queue.__file__).resolve().with_name(name).read_bytes()
            if name == "work_board_v2.py":
                enabled = b"COMPACT_RESOLVED_WRITES_ENABLED = True"
                self.assertEqual(raw.count(enabled), 1)
                raw = raw.replace(enabled, b"COMPACT_RESOLVED_WRITES_ENABLED = False")
            (reader_directory / name).write_bytes(raw)
        for args in (("init", "-q"), ("config", "user.name", "TEST_ONLY reader fixture"),
                     ("config", "user.email", "test-only@example.invalid"),
                     ("add", "tooling/coordination"),
                     ("commit", "-qm", "TEST_ONLY retained reader-only source")):
            subprocess.run(["git", "-C", str(reader_repo), *args], check=True,
                           capture_output=True, timeout=8)
        source_location = patch.object(rollout, "__file__", str(reader_directory / "work_board_reader_rollout.py"))
        source_location.start()
        self.addCleanup(source_location.stop)
        self.candidate_queue = reader_directory / "work_queue.py"
        self.candidate_v2 = self.candidate_queue.with_name("work_board_v2.py")
        # TEST-ONLY source authority substitute. Production trust anchor is
        # deliberately None until an independently accepted release installs
        # the immutable commit/tree/blob tuple; this fixture grants nothing.
        source_repo = self.candidate_queue.parents[2]
        def source_ref(spec):
            return subprocess.run(
                ["git", "-C", str(source_repo), "rev-parse", spec],
                check=True, capture_output=True, text=True, timeout=8,
            ).stdout.strip()
        self.synthetic_test_only_git_anchor = (
            source_ref("HEAD"),
            source_ref("HEAD^{tree}"),
            source_ref("HEAD:tooling/coordination/work_board_v2.py"),
        )
        self.synthetic_trust_patch = patch.object(
            rollout, "MODULE_ONLY_ACCEPTED_SOURCE_TRUST_ANCHOR",
            self.synthetic_test_only_git_anchor,
        )
        self.synthetic_trust_patch.start()
        self.addCleanup(self.synthetic_trust_patch.stop)
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


    def _custody(self, rid):
        path = self.root / "controllers/work-board-reader-rollouts" / (rid + ".recovery/manifest.json")
        value = json.loads(path.read_text())
        self.assertEqual(value["state"], "RECOVERY_CUSTODY_PREPARED")
        self.assertFalse(value["automatic_recovery_authorized"])
        for item in value["prior"]:
            if item["exists"]:
                prior = Path(item["preimage_path"])
                self.assertEqual(hashlib.sha256(prior.read_bytes()).hexdigest(), item["sha256"])
                self.assertEqual(stat.S_IMODE(prior.stat().st_mode), 0o600)
        return value

    def test_all_prior_wip_is_durable_before_first_public_write(self):
        prior = {}
        for role, directory in self.dirs.items():
            raw = self.old_queue + b"\n# protected role WIP " + role.encode() + b"\n"
            queue = directory / "work_queue.py"
            queue.write_bytes(raw)
            queue.chmod(0o640)
            prior[(role, "work_queue")] = raw
            self.queue_hashes[role] = hashlib.sha256(raw).hexdigest()
        real_atomic = rollout._atomic
        seen = []
        def first_public_write(path, raw, mode, **kwargs):
            custody = self._custody("durable-before-write")
            self.assertEqual(len(custody["prior"]), 8)
            for item in custody["prior"]:
                if item["exists"]:
                    self.assertEqual(Path(item["preimage_path"]).read_bytes(),
                                     prior[(item["role"], item["name"])])
                    self.assertEqual(item["mode"], 0o640)
                    self.assertEqual(len(item["prior_identity"]), 2)
            seen.append(str(path))
            return real_atomic(path, raw, mode, **kwargs)
        with patch.object(rollout, "_atomic", side_effect=first_public_write):
            result = self._run("durable-before-write")
        self.assertEqual(len(seen), 8)
        self.assertEqual(result["recovery_custody"]["sha256"],
                         hashlib.sha256(Path(result["recovery_custody"]["path"]).read_bytes()).hexdigest())

    def test_custody_fsync_failure_prevents_every_public_write(self):
        before = {str(directory / "work_queue.py"):
                  (directory / "work_queue.py").read_bytes()
                  for directory in self.dirs.values()}
        real_fsync = rollout.v2._fsync_dir
        def failed_custody_sync(path):
            if Path(path).name == "custody-fsync.recovery":
                raise OSError("custody durability failure")
            return real_fsync(path)
        with patch.object(rollout.v2, "_fsync_dir", side_effect=failed_custody_sync):
            with patch.object(rollout, "_atomic") as public_write:
                with self.assertRaisesRegex(RuntimeError, "custody durability failure"):
                    self._run("custody-fsync")
                public_write.assert_not_called()
        for path, raw in before.items():
            self.assertEqual(Path(path).read_bytes(), raw)
        self.assertTrue(all(not (directory / "work_board_v2.py").exists()
                            for directory in self.dirs.values()))

    def test_partial_rollback_write_keeps_exact_durable_prior_and_recovery_id(self):
        queue = self.dirs["A"] / "work_queue.py"
        protected = self.old_queue + b"\n# protected original WIP\n"
        queue.write_bytes(protected)
        queue.chmod(0o640)
        self.queue_hashes["A"] = hashlib.sha256(protected).hexdigest()
        real_atomic, real_write = rollout._atomic, os.write
        changed = []
        owned = None
        writes = 0
        def install_then_fail(path, raw, mode, **kwargs):
            nonlocal owned
            if changed:
                raise OSError("install interrupted")
            identity = real_atomic(path, raw, mode, **kwargs)
            owned = identity
            changed.append(str(path))
            return identity
        def partial_owned_write(fd, raw):
            nonlocal writes
            info = os.fstat(fd)
            if owned is not None and (info.st_dev, info.st_ino) == owned:
                writes += 1
                if writes == 1:
                    return real_write(fd, raw[:13])
                raise OSError("partial rollback interruption")
            return real_write(fd, raw)
        with patch.object(rollout, "_atomic", side_effect=install_then_fail):
            with patch.object(rollout.os, "write", side_effect=partial_owned_write):
                with self.assertRaisesRegex(RuntimeError, "ROLLBACK_FAILED.*partial rollback interruption"):
                    self._run("partial-restore")
        self.assertGreaterEqual(writes, 2)
        custody = self._custody("partial-restore")
        original = next(item for item in custody["prior"]
                        if item["role"] == "A" and item["name"] == "work_queue")
        self.assertEqual(Path(original["preimage_path"]).read_bytes(), protected)
        self.assertEqual(original["mode"], 0o640)
        self.assertFalse((self.root / "controllers/work-board-reader-rollouts/partial-restore.json").exists())
        # Even if an operator restores exact bytes, a used recovery id cannot
        # overwrite its original record or become an implicit retry.
        queue.write_bytes(protected)
        with self.assertRaisesRegex(RuntimeError, "RECOVERY_ALREADY_USED"):
            self._run("partial-restore")


    def test_process_exit_during_rollback_preserves_durable_wip_preimage(self):
        queue = self.dirs["A"] / "work_queue.py"
        protected = self.old_queue + b"\n# WIP surviving process death\n"
        queue.write_bytes(protected)
        queue.chmod(0o640)
        self.queue_hashes["A"] = hashlib.sha256(protected).hexdigest()
        config = {
            "root": str(self.root),
            "candidates": {key: str(value) for key, value in self.candidates.items()},
            "dirs": {key: str(value) for key, value in self.dirs.items()},
            "queues": self.queue_hashes, "modules": self.module_prior,
        }
        child = """
import json,os,sys
from pathlib import Path
from unittest.mock import patch
import work_board_reader_rollout as r
c=json.loads(sys.argv[1])
atomic,write=r._atomic,os.write
state={"calls":0,"owned":None}
def install(path,raw,mode,**kwargs):
    state["calls"]+=1
    if state["calls"]==2: raise OSError("later installation failed")
    state["owned"]=atomic(path,raw,mode,**kwargs)
    return state["owned"]
def interrupted_write(fd,raw):
    st=os.fstat(fd)
    if state["owned"] is not None and (st.st_dev,st.st_ino)==state["owned"]:
        write(fd,raw[:13])
        os._exit(73)
    return write(fd,raw)
with patch.object(r,"_atomic",side_effect=install):
    with patch.object(r.os,"write",side_effect=interrupted_write):
        r.rollout(Path(c["root"]),{k:Path(v) for k,v in c["candidates"].items()},
                  {k:Path(v) for k,v in c["dirs"].items()},c["queues"],c["modules"],
                  rollout_id="process-death")
"""
        result = subprocess.run(
            [os.sys.executable, "-B", "-c", child, json.dumps(config)],
            cwd=Path(rollout.__file__).parent, capture_output=True, timeout=15,
        )
        self.assertEqual(result.returncode, 73, result.stderr.decode(errors="replace"))
        custody = self._custody("process-death")
        item = next(row for row in custody["prior"]
                    if row["role"] == "A" and row["name"] == "work_queue")
        self.assertEqual(Path(item["preimage_path"]).read_bytes(), protected)
        self.assertEqual(item["mode"], 0o640)
        self.assertFalse((self.root / "controllers/work-board-reader-rollouts/process-death.json").exists())


    def test_rollout_parent_entry_fsync_failure_prevents_public_writes(self):
        originals = {role: (directory / "work_queue.py").read_bytes()
                     for role, directory in self.dirs.items()}
        real_fsync = rollout.v2._fsync_dir
        def fail_parent_entry(path):
            if Path(path) == self.root / "controllers":
                raise OSError("rollout parent entry not durable")
            return real_fsync(path)
        with patch.object(rollout.v2, "_fsync_dir", side_effect=fail_parent_entry):
            with patch.object(rollout, "_atomic") as install:
                with self.assertRaisesRegex(OSError, "rollout parent entry not durable"):
                    self._run("parent-entry-failure")
                install.assert_not_called()
        for role, directory in self.dirs.items():
            self.assertEqual((directory / "work_queue.py").read_bytes(), originals[role])
            self.assertFalse((directory / "work_board_v2.py").exists())
        self.assertFalse((self.root / "controllers/work-board-reader-rollouts/parent-entry-failure.json").exists())

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

    def _r7_sealed_done_changed_semantic_fixture(self):
        # An invalidated SEALED record differs genuinely between the old
        # reader (source-only completion) and the strict rooted R7 reader.
        # This only changes our disposable test board, never product checks.
        seal, _record = self._resource_seal_semantic_fixture()
        old_record = json.loads(seal.read_text())
        self.assertEqual(old_record["state"], "SEALED")
        old_record["state"] = "SEALING"
        seal.write_text(json.dumps(old_record))

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

    def test_r7_native_issuer_fixture_does_not_discover_A_heavy_tests(self):
        import sys

        suite = unittest.defaultTestLoader.loadTestsFromModule(
            sys.modules[__name__])
        reader_cases = sum(
            name.startswith("test_") for name in dir(type(self)))
        self.assertEqual(
            suite.countTestCases(), reader_cases,
            "A native V2 inherited tests must not leak into rollout discovery")

    def test_r7_migration_issuer_rejects_mismatched_source_head_and_sha(self):
        fixture = _issuer_bound_migration_fixture()
        fixture.setUp()
        self.addCleanup(fixture.tearDown)
        board, raw = fixture.v1([fixture.ready("isolated-issuer")])
        mismatch_sources = (
            ("head", {"source_candidate_sha": "0" * 40}),
            ("queue-sha", {"work_queue_sha256": "1" * 64}),
        )
        for suffix, altered in mismatch_sources:
            with self.subTest(suffix=suffix):
                grant = fixture.grant(
                    raw, authority_id="wrong-" + suffix, alter=altered)
                with self.assertRaisesRegex(
                    RuntimeError, "WORK_BOARD_V2_AUTHORITY_SOURCE_MISMATCH"):
                    work_board_v2_tests.migrate.migrate(
                        fixture.root, grant, fixture.readers,
                        board["revision"], hashlib.sha256(raw).hexdigest())

    def _contract_fixture(self, rid="contract-pass"):
        fixture = _issuer_bound_migration_fixture()
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

    def test_module_only_install_preserves_exact_divergent_role_queue_sources(self):
        candidate = {"work_board_v2": self.candidate_v2}
        c_queue = self.dirs["C"] / "work_queue.py"
        subprocess.run([
            "git", "-C", str(self.repo_roots["C"]), "add",
            "tooling/coordination/work_queue.py",
        ], check=True, capture_output=True)
        subprocess.run([
            "git", "-C", str(self.repo_roots["C"]),
            "-c", "user.name=Octoport test fixture",
            "-c", "user.email=fixture@invalid.example",
            "commit", "-qm", "fixture baseline",
        ], check=True, capture_output=True)
        changed_c = self.old_queue + b"\n# C-owned uncommitted queue source\n"
        c_queue.write_bytes(changed_c)
        self.queue_hashes["C"] = hashlib.sha256(changed_c).hexdigest()
        status_before = subprocess.check_output([
            "git", "-C", str(self.repo_roots["C"]),
            "status", "--porcelain=v1",
        ], text=True)
        self.assertIn(" M tooling/coordination/work_queue.py", status_before)
        source_by_role = {
            role: (directory / "work_queue.py").read_bytes()
            for role, directory in self.dirs.items()
        }
        board_before = (self.root / "controllers/work-board.json").read_bytes()
        status_roles_before = {
            role: (self.root / f"{role}.json").read_bytes() for role in "ABC"
        }
        result = rollout.rollout(
            self.root, candidate, self.dirs,
            self.queue_hashes, self.module_prior,
            rollout_id="module-only-heterogeneous",
            module_only=True,
        )
        self.assertEqual(result["result"], "APPLIED_PENDING_SOURCE_CURRENTITY")
        self.assertEqual(result["installed_file_scope"], ["work_board_v2"])
        self.assertEqual(
            result["source_currentity"]["level"],
            "OBSERVED_ONLY_NO_EXCLUSIVE_WRITER_AUTHORITY",
        )
        self.assertTrue(
            result["source_currentity"]["exclusive_source_revalidation_required"]
        )
        self.assertFalse(
            result["source_currentity"]["exclusive_writer_authority_verified"]
        )
        self.assertEqual(set(result["candidate_sha256"]), {"work_board_v2"})
        self.assertEqual(
            result["reader_semantic_sha256_before"],
            result["reader_semantic_sha256_after"],
        )
        helper_hash = hashlib.sha256(self.candidate_v2.read_bytes()).hexdigest()
        for role, directory in self.dirs.items():
            self.assertEqual(
                (directory / "work_queue.py").read_bytes(),
                source_by_role[role],
            )
            self.assertEqual(
                hashlib.sha256((directory / "work_board_v2.py").read_bytes()).hexdigest(),
                helper_hash,
            )
        self.assertEqual(
            (self.root / "controllers/work-board.json").read_bytes(), board_before
        )
        self.assertEqual(
            {role: (self.root / f"{role}.json").read_bytes() for role in "ABC"},
            status_roles_before,
        )
        self.assertIn(
            " M tooling/coordination/work_queue.py",
            subprocess.check_output([
                "git", "-C", str(self.repo_roots["C"]),
                "status", "--porcelain=v1",
            ], text=True),
        )

    def test_module_only_without_accepted_git_source_is_fail_closed(self):
        candidate = self.candidate_v2.read_bytes()
        self.assertTrue(rollout._module_only_writer_flags_off(candidate))
        with patch.object(rollout, "MODULE_ONLY_ACCEPTED_SOURCE_TRUST_ANCHOR", None):
            self.assertFalse(rollout._module_only_trusted_git_source(candidate))
            with self.assertRaisesRegex(RuntimeError, "MODULE_ONLY_SOURCE_NOT_TRUSTED"):
                rollout.rollout(
                    self.root, {"work_board_v2": self.candidate_v2},
                    self.dirs, self.queue_hashes, self.module_prior,
                    rollout_id="source-not-authorized", module_only=True,
                )
        self.assertFalse(
            (self.root / "controllers/work-board-reader-rollouts/source-not-authorized.json").exists()
        )
        self.assertTrue(all(
            not (directory / "work_board_v2.py").exists()
            for directory in self.dirs.values()
        ))

    def test_module_only_exact_git_commit_tree_blob_required_for_source(self):
        source = self.candidate_v2.read_bytes()
        self.assertTrue(rollout._module_only_trusted_git_source(source))
        commit, tree, blob = self.synthetic_test_only_git_anchor
        invalid = (
            ("wrong_commit", ("0" * 40, tree, blob), source),
            ("wrong_tree", (commit, "0" * 40, blob), source),
            ("wrong_blob", (commit, tree, "0" * 40), source),
            ("unexpected_blob_bytes", (commit, tree, blob),
             source + b"\n# unreviewed byte drift\n"),
            ("invalid_anchor_shape", (commit, tree), source),
        )
        for label, anchor, candidate in invalid:
            with self.subTest(label=label):
                with patch.object(
                    rollout, "MODULE_ONLY_ACCEPTED_SOURCE_TRUST_ANCHOR", anchor
                ):
                    self.assertFalse(
                        rollout._module_only_trusted_git_source(candidate)
                    )
                    path = Path(self.tmp.name) / ("module-only-" + label + ".py")
                    path.write_bytes(candidate)
                    with self.assertRaisesRegex(
                        RuntimeError, "MODULE_ONLY_SOURCE_NOT_TRUSTED"
                    ):
                        rollout.rollout(
                            self.root, {"work_board_v2": path},
                            self.dirs, self.queue_hashes, self.module_prior,
                            rollout_id="untrusted-" + label, module_only=True,
                        )
                    self.assertFalse(
                        (self.root / "controllers/work-board-reader-rollouts"
                         / ("untrusted-" + label + ".json")).exists()
                    )
        for directory in self.dirs.values():
            self.assertFalse((directory / "work_board_v2.py").exists())
    def test_module_only_writer_guard_rejects_nul_bytes_before_install(self):
        candidate = self.candidate_v2.read_bytes()
        self.assertTrue(rollout._module_only_writer_flags_off(candidate))
        board_before = (self.root / "controllers/work-board.json").read_bytes()
        for label, altered in (
            ("prefix", b"\x00" + candidate),
            ("suffix", candidate + b"\x00"),
        ):
            with self.subTest(position=label):
                self.assertFalse(rollout._module_only_writer_flags_off(altered))
                path = Path(self.tmp.name) / ("nul-" + label + ".py")
                path.write_bytes(altered)
                with self.assertRaisesRegex(
                    RuntimeError, "MODULE_ONLY_WRITER_NOT_DISABLED"
                ):
                    rollout.rollout(
                        self.root, {"work_board_v2": path}, self.dirs,
                        self.queue_hashes, self.module_prior,
                        rollout_id="nul-guard-" + label, module_only=True,
                    )
                self.assertEqual(
                    (self.root / "controllers/work-board.json").read_bytes(),
                    board_before,
                )
                self.assertFalse(
                    (self.root / "controllers/work-board-reader-rollouts"
                     / ("nul-guard-" + label + ".json")).exists()
                )
        for directory in self.dirs.values():
            self.assertFalse((directory / "work_board_v2.py").exists())

    def test_module_only_rejects_writer_flag_ast_rebindings_after_literal_false(self):
        candidate = self.candidate_v2.read_bytes()
        self.assertTrue(rollout._module_only_writer_flags_off(candidate))
        changes = {
            "nested_if": b"\nif True:\n    RESOLVED_COLD_INDEX_WRITES_ENABLED = True\n",
            "nested_function_global": (
                b"\ndef alter_writer():\n"
                b"    global RESOLVED_COLD_INDEX_WRITES_ENABLED\n"
                b"    RESOLVED_COLD_INDEX_WRITES_ENABLED = True\n"
                b"alter_writer()\n"
            ),
            "dynamic_globals": (
                b'\nglobals()["RESOLVED_COLD_INDEX_WRITES_ENABLED"] = True\n'
            ),
            "augmented_assign": b"\nRESOLVED_COLD_INDEX_WRITES_ENABLED |= True\n",
            "named_expression": b"\n(COMPACT_RESOLVED_WRITES_ENABLED := True)\n",
            "dynamic_exec": (
                b'\nexec("RESOLVED_COLD_INDEX_WRITES_ENABLED = True")\n'
            ),
            "dynamic_setattr": (
                b"\nimport sys\n"
                b'setattr(sys.modules[__name__], "COMPACT_RESOLVED_WRITES_ENABLED", True)\n'
            ),
            "deleted_writer": b"\ndel RESOLVED_COLD_INDEX_WRITES_ENABLED\n",
        }
        board_before = (self.root / "controllers/work-board.json").read_bytes()
        queue_before = {
            role: (directory / "work_queue.py").read_bytes()
            for role, directory in self.dirs.items()
        }
        for kind, extra in changes.items():
            with self.subTest(variant=kind):
                altered = self.candidate_v2.read_bytes() + extra
                # Parse only: never execute or import these untrusted modules.
                ast.parse(altered.decode("utf-8"))
                self.assertFalse(
                    rollout._module_only_writer_flags_off(altered),
                    f"unsafe writer binding accepted: {kind}",
                )
                path = Path(self.tmp.name) / ("untrusted-" + kind + ".py")
                path.write_bytes(altered)
                with self.assertRaisesRegex(
                    RuntimeError, "MODULE_ONLY_WRITER_NOT_DISABLED"
                ):
                    rollout.rollout(
                        self.root, {"work_board_v2": path},
                        self.dirs, self.queue_hashes, self.module_prior,
                        rollout_id="writer-bypass-" + kind,
                        module_only=True,
                    )
                self.assertFalse(
                    (self.root / "controllers/work-board-reader-rollouts"
                     / ("writer-bypass-" + kind + ".json")).exists()
                )
        self.assertEqual(
            (self.root / "controllers/work-board.json").read_bytes(), board_before
        )
        for role, directory in self.dirs.items():
            self.assertEqual(
                (directory / "work_queue.py").read_bytes(), queue_before[role]
            )
            self.assertFalse((directory / "work_board_v2.py").exists())

    def test_module_only_declines_enabled_writer_and_other_transition_modes(self):
        module = self.candidate_v2.read_bytes()
        self.assertTrue(rollout._module_only_writer_flags_off(module))
        bad = Path(self.tmp.name) / "unaccepted-new-writer.py"
        old = b"RESOLVED_COLD_INDEX_WRITES_ENABLED = False"
        assert module.count(old) == 1
        bad.write_bytes(module.replace(old, b"RESOLVED_COLD_INDEX_WRITES_ENABLED = True"))
        with self.assertRaisesRegex(RuntimeError, "MODULE_ONLY_WRITER_NOT_DISABLED"):
            rollout.rollout(
                self.root, {"work_board_v2": bad}, self.dirs,
                self.queue_hashes, self.module_prior,
                rollout_id="writer-active-denied", module_only=True,
            )
        with self.assertRaisesRegex(RuntimeError, "MODULE_ONLY_WRITER_NOT_DISABLED"):
            rollout.rollout(
                self.root, {"work_board_v2": self.writer_candidate_v2}, self.dirs,
                self.queue_hashes, self.module_prior,
                rollout_id="compact-writer-source-denied", module_only=True,
            )
        with self.assertRaisesRegex(RuntimeError, "MODULE_ONLY_TRANSITION_FORBIDDEN"):
            rollout.rollout(
                self.root, {"work_board_v2": self.candidate_v2}, self.dirs,
                self.queue_hashes, self.module_prior,
                rollout_id="unapproved-semantic",
                semantic_transition_proof_path=Path(self.tmp.name) / "no.json",
                semantic_transition_proof_sha256="0" * 64,
                module_only=True,
            )
        with self.assertRaisesRegex(RuntimeError, "READER_SET_INVALID"):
            rollout.rollout(
                self.root, self.candidates, self.dirs,
                self.queue_hashes, self.module_prior,
                rollout_id="pair-not-module", module_only=True,
            )
        with self.assertRaisesRegex(RuntimeError, "MODE_INVALID"):
            rollout.rollout(
                self.root, {"work_board_v2": self.candidate_v2}, self.dirs,
                self.queue_hashes, self.module_prior,
                rollout_id="mode-str-not-bool", module_only="true",
            )
        for role, directory in self.dirs.items():
            self.assertEqual((directory / "work_queue.py").read_bytes(), self.old_queue)
            self.assertFalse((directory / "work_board_v2.py").exists())

    def test_module_only_mid_install_failure_restores_four_modules_not_queues(self):
        module = self.candidate_v2.read_bytes()
        previous = module + b"\n# previously installed reader revision\n"
        hashes = {}
        modes = {}
        for role, directory in self.dirs.items():
            old = directory / "work_board_v2.py"
            old.write_bytes(previous)
            if role == "B":
                old.chmod(0o640)
            modes[role] = stat.S_IMODE(old.stat().st_mode)
            hashes[role] = hashlib.sha256(previous).hexdigest()
        c_queue = self.dirs["C"] / "work_queue.py"
        c_queue.write_bytes(self.old_queue + b"\n# C dirty unmerged\n")
        self.queue_hashes["C"] = hashlib.sha256(c_queue.read_bytes()).hexdigest()
        queued_before = {
            role: (directory / "work_queue.py").read_bytes()
            for role, directory in self.dirs.items()
        }
        board_before = (self.root / "controllers/work-board.json").read_bytes()
        old_atomic = rollout._atomic
        attempts = {"count": 0}

        def fail_on_third(*args, **kwargs):
            attempts["count"] += 1
            if attempts["count"] == 3:
                raise OSError("fixture third module publication failure")
            return old_atomic(*args, **kwargs)

        with patch.object(rollout, "_atomic", side_effect=fail_on_third):
            with self.assertRaisesRegex(RuntimeError, "rollback verified"):
                rollout.rollout(
                    self.root, {"work_board_v2": self.candidate_v2},
                    self.dirs, self.queue_hashes, hashes,
                    rollout_id="module-only-rollback", module_only=True,
                )
        for role, directory in self.dirs.items():
            self.assertEqual(
                (directory / "work_queue.py").read_bytes(), queued_before[role]
            )
            module_file = directory / "work_board_v2.py"
            self.assertEqual(module_file.read_bytes(), previous)
            self.assertEqual(stat.S_IMODE(module_file.stat().st_mode), modes[role])
        self.assertEqual(
            (self.root / "controllers/work-board.json").read_bytes(), board_before
        )
        self.assertFalse(
            (self.root / "controllers/work-board-reader-rollouts/module-only-rollback.json").exists()
        )
        self.assertEqual(attempts["count"], 3)  # initial two installs and failed third; protected restores use owned inode descriptors

    def test_module_only_rollback_preserves_foreign_helper_inode(self):
        prior = self.candidate_v2.read_bytes() + b"\n# accepted old helper\n"
        foreign = prior + b"# foreign helper replacement\n"
        prior_hash = hashlib.sha256(prior).hexdigest()
        original_queues = {
            role: (directory / "work_queue.py").read_bytes()
            for role, directory in self.dirs.items()
        }
        for directory in self.dirs.values():
            (directory / "work_board_v2.py").write_bytes(prior)
        prior_shas = {role: prior_hash for role in rollout.ROLES}
        original_atomic = rollout._atomic
        calls = {"count": 0}
        target = self.dirs["A"] / "work_board_v2.py"

        def inject(source, *args, **kwargs):
            calls["count"] += 1
            if calls["count"] == 2:
                replacement = self.root / "logs" / "foreign-helper.py"
                replacement.write_bytes(foreign)
                os.replace(replacement, target)
                raise OSError("later role's publication failed")
            return original_atomic(source, *args, **kwargs)

        with patch.object(rollout, "_atomic", side_effect=inject):
            with self.assertRaisesRegex(
                RuntimeError, "ROLLBACK_FAILED.*ROLLBACK_OWNERSHIP_DRIFT"
            ):
                rollout.rollout(
                    self.root, {"work_board_v2": self.candidate_v2},
                    self.dirs, self.queue_hashes, prior_shas,
                    rollout_id="module-only-foreign-inode", module_only=True,
                )
        self.assertEqual(target.read_bytes(), foreign)
        for role, directory in self.dirs.items():
            self.assertEqual(
                (directory / "work_queue.py").read_bytes(), original_queues[role]
            )
            if role != "A":
                self.assertEqual((directory / "work_board_v2.py").read_bytes(), prior)
        self.assertFalse(
            (self.root / "controllers/work-board-reader-rollouts/module-only-foreign-inode.json").exists()
        )

    def test_module_only_rollback_preserves_inplace_helper_mutation(self):
        prior = self.candidate_v2.read_bytes() + b"\n# accepted old helper\n"
        foreign = prior + b"# unknown actor modified rollout-owned inode\n"
        prior_hash = hashlib.sha256(prior).hexdigest()
        for directory in self.dirs.values():
            (directory / "work_board_v2.py").write_bytes(prior)
        prior_shas = {role: prior_hash for role in rollout.ROLES}
        original_atomic = rollout._atomic
        calls = {"count": 0}
        target = self.dirs["A"] / "work_board_v2.py"

        def inject(source, *args, **kwargs):
            calls["count"] += 1
            if calls["count"] == 2:
                target.write_bytes(foreign)  # identical inode, changed bytes
                raise OSError("later role's publication failed")
            return original_atomic(source, *args, **kwargs)

        with patch.object(rollout, "_atomic", side_effect=inject):
            with self.assertRaisesRegex(
                RuntimeError, "ROLLBACK_FAILED.*ROLLBACK_OWNERSHIP_DRIFT"
            ):
                rollout.rollout(
                    self.root, {"work_board_v2": self.candidate_v2},
                    self.dirs, self.queue_hashes, prior_shas,
                    rollout_id="module-only-foreign-inplace", module_only=True,
                )
        self.assertEqual(target.read_bytes(), foreign)
        for role, directory in self.dirs.items():
            if role != "A":
                self.assertEqual((directory / "work_board_v2.py").read_bytes(), prior)
        self.assertFalse(
            (self.root / "controllers/work-board-reader-rollouts/module-only-foreign-inplace.json").exists()
        )

    def test_module_only_rollback_descriptor_preserves_concurrent_foreign_claim(self):
        previous = self.candidate_v2.read_bytes() + b"\n# archived old helper\n"
        foreign = b"# external helper occupying name during rollback\n"
        previous_sha = hashlib.sha256(previous).hexdigest()
        for directory in self.dirs.values():
            (directory / "work_board_v2.py").write_bytes(previous)
        prior_shas = {role: previous_sha for role in rollout.ROLES}
        queues = {role: (directory / "work_queue.py").read_bytes()
                  for role, directory in self.dirs.items()}
        target = self.dirs["A"] / "work_board_v2.py"
        real_atomic, real_open, real_write = rollout._atomic, os.open, os.write
        real_rename = rollout._rename_noreplace
        state = {"install": 0, "fd": None, "swapped": False}

        def install_then_fail(*args, **kwargs):
            state["install"] += 1
            if state["install"] == 2:
                raise OSError("simulated B installation failure")
            return real_atomic(*args, **kwargs)

        def track_open(path, flags, *args, **kwargs):
            fd = real_open(path, flags, *args, **kwargs)
            if Path(path) == target and (flags & os.O_ACCMODE) == os.O_RDWR:
                state["fd"] = fd
            return fd

        def swap_before_bound_write(fd, raw):
            if fd == state["fd"] and not state["swapped"]:
                adversary = self.root / "logs" / "foreign-claimed-helper.py"
                adversary.write_bytes(foreign)
                os.replace(adversary, target)
                state["swapped"] = True
                state["foreign_identity"] = (target.stat().st_dev, target.stat().st_ino)
            return real_write(fd, raw)

        def private_custody_only(source, destination):
            # Durable custody uses noreplace inside control scratch. It must
            # still never move either side of any public reader pathname.
            public = {directory / "work_board_v2.py" for directory in self.dirs.values()}
            if Path(source) in public or Path(destination) in public:
                raise AssertionError("public inode moved")
            return real_rename(source, destination)

        with patch.object(rollout, "_atomic", side_effect=install_then_fail):
            with patch.object(rollout.os, "open", side_effect=track_open):
                with patch.object(rollout.os, "write", side_effect=swap_before_bound_write):
                    with patch.object(rollout, "_rename_noreplace",
                                      side_effect=private_custody_only) as rename:
                        with self.assertRaisesRegex(RuntimeError, "ROLLBACK_FAILED.*OWNERSHIP_DRIFT"):
                            rollout.rollout(
                                self.root, {"work_board_v2": self.candidate_v2},
                                self.dirs, self.queue_hashes, prior_shas,
                                rollout_id="module-only-concurrent-claim", module_only=True,
                            )
                        self.assertTrue(rename.call_count)
                        self.assertTrue(all(
                            ".recovery" in str(call.args[1])
                            for call in rename.call_args_list
                        ))
        self.assertTrue(state["swapped"])
        self.assertEqual(state["install"], 2)
        self.assertEqual(target.read_bytes(), foreign)
        self.assertEqual((target.stat().st_dev, target.stat().st_ino),
                         state["foreign_identity"])
        self.assertFalse(list(self.root.rglob("*.rollback.*.preserved")))
        for role, directory in self.dirs.items():
            self.assertEqual((directory / "work_queue.py").read_bytes(), queues[role])
            if role != "A":
                self.assertEqual((directory / "work_board_v2.py").read_bytes(), previous)
        self.assertFalse(
            (self.root / "controllers/work-board-reader-rollouts/module-only-concurrent-claim.json").exists()
        )

    def test_prior_missing_owned_inode_recovery_never_moves_public_path(self):
        target = self.root / "logs" / "owned-new-helper.py"
        raw = b"# verified installed helper\n"
        target.write_bytes(raw)
        identity = (target.stat().st_dev, target.stat().st_ino)
        with patch.object(rollout, "_rename_noreplace",
                          side_effect=AssertionError("public inode moved")) as rename:
            with self.assertRaisesRegex(RuntimeError, "ROLLBACK_RECONCILIATION_REQUIRED"):
                rollout._rollback_prior_missing(
                    target, identity, scratch_dir=self.root / "logs",
                )
            rename.assert_not_called()
        self.assertEqual(target.read_bytes(), raw)
        self.assertEqual((target.stat().st_dev, target.stat().st_ino), identity)
        self.assertFalse(list(self.root.rglob("*.rollback.*.preserved")))

    def test_prior_missing_foreign_inode_is_never_moved_even_temporarily(self):
        target = self.root / "logs" / "foreign-new-helper.py"
        raw = b"# foreign installed helper\n"
        target.write_bytes(raw)
        identity = (target.stat().st_dev, target.stat().st_ino)
        with patch.object(rollout, "_rename_noreplace",
                          side_effect=AssertionError("foreign inode moved")) as rename:
            with self.assertRaisesRegex(RuntimeError, "ROLLBACK_OWNERSHIP_DRIFT"):
                rollout._rollback_prior_missing(
                    target, (identity[0], identity[1] + 1), scratch_dir=self.root / "logs",
                )
            rename.assert_not_called()
        self.assertEqual(target.read_bytes(), raw)
        self.assertEqual((target.stat().st_dev, target.stat().st_ino), identity)

    def test_module_only_foreign_queue_edit_at_receipt_never_claims_committed(self):
        target = self.dirs["C"] / "work_queue.py"
        recorded = target.read_bytes()
        original_sha = hashlib.sha256(recorded).hexdigest()
        receipt_path = (
            self.root
            / "controllers/work-board-reader-rollouts/module-only-late-queue.json"
        )
        original_atomic_noreplace = rollout._atomic_noreplace
        injected = {"done": False}

        def edit_after_last_scan(path, data, mode, *, scratch_dir=None):
            if Path(path) == receipt_path:
                self.assertFalse(injected["done"])
                # Only the disposable fixture changes, after all role-source
                # SHA scans but before this rollout's receipt publication.
                target.write_bytes(recorded + b"\n# outside writer after check\n")
                injected["done"] = True
            return original_atomic_noreplace(
                path, data, mode, scratch_dir=scratch_dir
            )

        with patch.object(
            rollout, "_atomic_noreplace", side_effect=edit_after_last_scan
        ):
            result = rollout.rollout(
                self.root, {"work_board_v2": self.candidate_v2},
                self.dirs, self.queue_hashes, self.module_prior,
                rollout_id="module-only-late-queue",
                module_only=True,
            )
        self.assertTrue(injected["done"])
        self.assertTrue(receipt_path.is_file())
        self.assertEqual(result, json.loads(receipt_path.read_bytes()))
        self.assertEqual(result["result"], "APPLIED_PENDING_SOURCE_CURRENTITY")
        self.assertNotEqual(result["result"], "COMMITTED")
        self.assertEqual(
            result["source_currentity"]["observed_queue_sha256_by_role"]["C"],
            original_sha,
        )
        self.assertNotEqual(
            hashlib.sha256(target.read_bytes()).hexdigest(), original_sha
        )
        self.assertTrue(
            result["source_currentity"]["exclusive_source_revalidation_required"]
        )
        self.assertFalse(
            result["source_currentity"]["exclusive_writer_authority_verified"]
        )
        self.assertEqual(result["installed_file_scope"], ["work_board_v2"])
        self.assertEqual(
            result["reader_semantic_sha256_before"],
            result["reader_semantic_sha256_after"],
        )

    def test_module_only_queue_drift_before_install_never_overwrites_foreign_wip(self):
        c_queue = self.dirs["C"] / "work_queue.py"
        unrelated = self.old_queue + b"\n# external C source change under lock\n"
        old_flock = rollout.fcntl.flock
        held = {"count": 0}

        def intervening(fd, operation):
            old_flock(fd, operation)
            if operation == rollout.fcntl.LOCK_EX:
                held["count"] += 1
                if held["count"] == 4:
                    c_queue.write_bytes(unrelated)

        with patch.object(rollout.fcntl, "flock", intervening):
            with self.assertRaisesRegex(RuntimeError, "QUEUE_SOURCE_MISMATCH"):
                rollout.rollout(
                    self.root, {"work_board_v2": self.candidate_v2},
                    self.dirs, self.queue_hashes, self.module_prior,
                    rollout_id="module-only-drift", module_only=True,
                )
        self.assertEqual(c_queue.read_bytes(), unrelated)
        self.assertTrue(all(
            not (directory / "work_board_v2.py").exists()
            for directory in self.dirs.values()
        ))

    def test_module_only_postsemantic_late_dirty_queue_change_fails_and_preserves_new_modules(self):
        c_queue = self.dirs["C"] / "work_queue.py"
        diverged = self.old_queue + b"\n# original C dirty WIP\n"
        c_queue.write_bytes(diverged)
        self.queue_hashes["C"] = hashlib.sha256(diverged).hexdigest()
        after_drift = diverged + b"\n# late edit after semantic readback\n"
        original_semantic = rollout._semantic
        calls = {"n": 0}

        def late_change(module, root):
            value = original_semantic(module, root)
            calls["n"] += 1
            # Four "before" and four "after" role semantics. This edit
            # happens after the C postinstall comparison; only the final
            # byte-identity barrier can catch it.
            if calls["n"] == 8:
                c_queue.write_bytes(after_drift)
            return value

        with patch.object(rollout, "_semantic", late_change):
            with self.assertRaisesRegex(RuntimeError, "QUEUE_SOURCE_MISMATCH"):
                rollout.rollout(
                    self.root, {"work_board_v2": self.candidate_v2},
                    self.dirs, self.queue_hashes, self.module_prior,
                    rollout_id="module-only-postsemantic-drift",
                    module_only=True,
                )
        self.assertEqual(calls["n"], 8)
        self.assertEqual(c_queue.read_bytes(), after_drift)
        for role, directory in self.dirs.items():
            self.assertEqual((directory / "work_board_v2.py").read_bytes(), self.candidate_v2.read_bytes())
            if role != "C":
                self.assertEqual((directory / "work_queue.py").read_bytes(), self.old_queue)
        self.assertFalse(
            (self.root / "controllers/work-board-reader-rollouts/module-only-postsemantic-drift.json").exists()
        )

    def test_module_only_operational_org_outside_git_preserves_all_role_queues(self):
        shutil.rmtree(self.repo_roots["ORG"] / ".git")
        fixture = Path(self.tmp.name).resolve()
        old_lexists = os.path.lexists

        def only_fixture_git_files(path):
            candidate = Path(path)
            if (candidate.name == ".git"
                    and not candidate.parent.resolve().is_relative_to(fixture)):
                return False
            return old_lexists(path)

        current = {
            role: (directory / "work_queue.py").read_bytes()
            for role, directory in self.dirs.items()
        }
        with patch.dict(os.environ, {
                "GIT_CEILING_DIRECTORIES": str(fixture.parent)}), \
             patch.object(rollout.os.path, "lexists",
                          side_effect=only_fixture_git_files):
            result = rollout.rollout(
                self.root, {"work_board_v2": self.candidate_v2},
                self.dirs, self.queue_hashes, self.module_prior,
                rollout_id="module-only-real-org-topology",
                module_only=True,
            )
        self.assertEqual(result["result"], "APPLIED_PENDING_SOURCE_CURRENTITY")
        self.assertEqual(result["installed_file_scope"], ["work_board_v2"])
        self.assertEqual(
            result["source_currentity"]["level"],
            "OBSERVED_ONLY_NO_EXCLUSIVE_WRITER_AUTHORITY",
        )
        self.assertTrue(
            result["source_currentity"]["exclusive_source_revalidation_required"]
        )
        self.assertFalse(
            result["source_currentity"]["exclusive_writer_authority_verified"]
        )
        self.assertEqual(
            result["git_status_before"]["ORG"],
            "ORG_OPERATIONAL_READER_OUTSIDE_GIT",
        )
        self.assertEqual(
            result["git_status_after"]["ORG"],
            "ORG_OPERATIONAL_READER_OUTSIDE_GIT",
        )
        for role, directory in self.dirs.items():
            self.assertEqual((directory / "work_queue.py").read_bytes(), current[role])
            self.assertEqual(
                (directory / "work_board_v2.py").read_bytes(),
                self.candidate_v2.read_bytes(),
            )

    def test_rollout_installs_exact_pair_and_preserves_v1_semantics(self):
        # Generic rollout requires a provable difference from the installed
        # reader. HEAD50af already has R7's rooted seal; supply the existing
        # explicit legacy attention fixture instead of weakening the guard.
        self.old_queue = self._legacy_semantic_readers()
        # R7 intentionally strengthens the reader: installation without
        # reviewed semantic transition proof must fail closed. The original
        # rollback/source equality assertions still apply after authorization.
        self._r7_sealed_done_changed_semantic_fixture()
        path, digest, proof = self._transition("r1")
        self.assertTrue(any(
            row["before_semantic_sha256"] != row["after_semantic_sha256"]
            for row in proof["readers"].values()
        ))
        result = self._run("r1", (path, digest))
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

    def test_unexpected_semantic_delta_restores_existing_and_retains_new_readers(self):
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
                with self.assertRaisesRegex(RuntimeError, "ROLLBACK_FAILED.*ROLLBACK_RECONCILIATION_REQUIRED"):
                    self._run("semantic-rollback", (path, digest))
        finally:
            os.umask(prior_umask)
        self.assertEqual(stat.S_IMODE(a_queue.stat().st_mode), 0o640)
        for directory in self.dirs.values():
            self.assertEqual((directory / "work_queue.py").read_bytes(), legacy)
            if directory == self.dirs["A"]:
                self.assertEqual((directory / "work_board_v2.py").read_bytes(), self.candidate_v2.read_bytes())
            else:
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
        self.old_queue = self._legacy_semantic_readers()
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
            self._r7_sealed_done_changed_semantic_fixture()
            path, digest, _proof = self._transition("org-nonrepo")
            result = self._run("org-nonrepo", (path, digest))
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

    def test_mid_rollout_failure_restores_existing_and_retains_new_for_reconciliation(self):
        # Preserve the actual synthetically installed legacy reader bytes and
        # capture status only AFTER the required semantic difference is set up.
        self.old_queue = self._legacy_semantic_readers()
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

        self._r7_sealed_done_changed_semantic_fixture()
        path, digest, _proof = self._transition("fail")
        with patch.object(rollout.os, "replace", fail_third):
            with self.assertRaisesRegex(RuntimeError, "ROLLBACK_FAILED.*ROLLBACK_RECONCILIATION_REQUIRED"):
                self._run("fail", (path, digest))

        for directory in self.dirs.values():
            self.assertEqual((directory / "work_queue.py").read_bytes(), self.old_queue)
            if directory == self.dirs["A"]:
                self.assertEqual((directory / "work_board_v2.py").read_bytes(), self.candidate_v2.read_bytes())
            else:
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
        for role in self.repo_roots:
            expected = set(status_before[role].splitlines())
            if role == "A":
                expected.add("?? tooling/coordination/work_board_v2.py")
            self.assertEqual(set(status_after[role].splitlines()), expected)
        scratch = self.root / "controllers/work-board-reader-rollouts"
        self.assertTrue(
            any(scratch.glob(".*.rollout.*.tmp")),
            "failed atomic write must retain evidence in control-root scratch",
        )

    def test_prior_missing_rollback_preserves_replacement_inode(self):
        self.old_queue = self._legacy_semantic_readers()
        victim = self.dirs["A"] / "work_board_v2.py"
        replacement_bytes = b"# external replacement must survive rollback\n"
        replacement_identity = {}
        # Preserve the *actual* semantically distinct pre-rollout board,
        # not the earlier default synthetic board we deliberately replaced.
        self._r7_sealed_done_changed_semantic_fixture()
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

        path, digest, _proof = self._transition("replacement-survives")
        with patch.object(rollout, "_atomic", replace_then_fail):
            with self.assertRaisesRegex(
                RuntimeError,
                "WORK_BOARD_V2_ROLLOUT_ROLLBACK_FAILED",
            ):
                self._run("replacement-survives", (path, digest))

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

    def _run_with_second_lock_close_failure(self, action):
        # Test source only: the fixture owns all roots. Close the real FD
        # before simulating a close error, so no descriptor is leaked by test.
        original_flock = rollout.fcntl.flock
        original_close = rollout.os.close
        acquired = []
        closed = []

        def track_flock(fd, operation):
            result = original_flock(fd, operation)
            if operation == rollout.fcntl.LOCK_EX:
                acquired.append(fd)
            return result

        def close_with_failure(fd):
            result = original_close(fd)
            if fd in acquired and fd not in closed:
                closed.append(fd)
                if len(closed) == 2:
                    raise OSError("injected second lock-close failure")
            return result

        try:
            with patch.object(rollout.fcntl, "flock", side_effect=track_flock), \
                 patch.object(rollout.os, "close", side_effect=close_with_failure):
                action()
        finally:
            self.assertEqual(len(acquired), 4)
            self.assertEqual(sorted(acquired), sorted(closed))

    def test_c00_postcommit_close_error_keeps_exact_committed_receipt(self):
        self.old_queue = self._legacy_semantic_readers()
        self._r7_sealed_done_changed_semantic_fixture()
        rid = "c00-close-committed"
        source_proof, digest, _proof = self._transition(rid)
        with self.assertRaisesRegex(
            RuntimeError,
            "WORK_BOARD_V2_ROLLOUT_POSTCOMMIT_CLEANUP_UNCERTAIN_COMMITTED",
        ):
            self._run_with_second_lock_close_failure(
                lambda: self._run(rid, (source_proof, digest))
            )
        receipt = self.root / "controllers/work-board-reader-rollouts" / (rid + ".json")
        self.assertTrue(receipt.is_file())
        committed = json.loads(receipt.read_bytes())
        self.assertEqual(committed["result"], "COMMITTED")
        self.assertEqual(
            receipt.read_bytes(), rollout.v2._canonical_bytes(committed)
        )
        # Old expected source hash is intentionally stale after install.
        with self.assertRaisesRegex(RuntimeError, "QUEUE_SOURCE_MISMATCH"):
            self._run(rid, (source_proof, digest))
        installed_queue_sha = hashlib.sha256(
            self.candidate_queue.read_bytes()
        ).hexdigest()
        installed_helper_sha = hashlib.sha256(
            self.candidate_v2.read_bytes()
        ).hexdigest()
        self.queue_hashes = {
            role: installed_queue_sha for role in rollout.ROLES
        }
        self.module_prior = {
            role: installed_helper_sha for role in rollout.ROLES
        }
        # With exact current prior hashes, duplicate-id guard is now reached.
        with self.assertRaisesRegex(RuntimeError, "ROLLOUT_ALREADY_USED"):
            self._run(rid, (source_proof, digest))

    def test_c00_module_only_close_error_keeps_pending_not_committed(self):
        rid = "c00-close-pending"
        with self.assertRaisesRegex(
            RuntimeError,
            "WORK_BOARD_V2_ROLLOUT_POSTCOMMIT_CLEANUP_UNCERTAIN_APPLIED_PENDING_SOURCE_CURRENTITY",
        ):
            self._run_with_second_lock_close_failure(
                lambda: rollout.rollout(
                    self.root, {"work_board_v2": self.candidate_v2},
                    self.dirs, self.queue_hashes, self.module_prior,
                    rollout_id=rid, module_only=True,
                )
            )
        receipt = self.root / "controllers/work-board-reader-rollouts" / (rid + ".json")
        self.assertTrue(receipt.is_file())
        pending = json.loads(receipt.read_bytes())
        self.assertEqual(pending["result"], "APPLIED_PENDING_SOURCE_CURRENTITY")
        self.assertTrue(
            pending["source_currentity"]["exclusive_source_revalidation_required"]
        )
        self.assertFalse(
            pending["source_currentity"]["exclusive_writer_authority_verified"]
        )
        # The first source precondition intentionally uses the old None
        # helper identity; distinguish it from the duplicate receipt guard.
        with self.assertRaisesRegex(RuntimeError, "PRIOR_MODULE_MISMATCH"):
            rollout.rollout(
                self.root, {"work_board_v2": self.candidate_v2},
                self.dirs, self.queue_hashes, self.module_prior,
                rollout_id=rid, module_only=True,
            )
        helper_sha = hashlib.sha256(
            self.candidate_v2.read_bytes()
        ).hexdigest()
        self.module_prior = {
            role: helper_sha for role in rollout.ROLES
        }
        with self.assertRaisesRegex(RuntimeError, "ROLLOUT_ALREADY_USED"):
            rollout.rollout(
                self.root, {"work_board_v2": self.candidate_v2},
                self.dirs, self.queue_hashes, self.module_prior,
                rollout_id=rid, module_only=True,
            )

    def test_c00_each_lock_ex_failure_closes_all_owned_descriptors(self):
        original_flock = rollout.fcntl.flock
        original_close = rollout.os.close
        for failure_position in range(1, 5):
            with self.subTest(failure_position=failure_position):
                acquired = []
                closed = []

                def fail_flock(fd, operation):
                    if operation == rollout.fcntl.LOCK_EX:
                        acquired.append(fd)
                        if len(acquired) == failure_position:
                            raise OSError("injected lock acquisition failure")
                    return original_flock(fd, operation)

                def track_close(fd):
                    if fd in acquired and fd not in closed:
                        closed.append(fd)
                    return original_close(fd)

                rid = "c00-lock-ex-fail-" + str(failure_position)
                with patch.object(rollout.fcntl, "flock", side_effect=fail_flock), \
                     patch.object(rollout.os, "close", side_effect=track_close):
                    with self.assertRaisesRegex(
                        OSError, "injected lock acquisition failure"
                    ):
                        self._run(rid)
                self.assertEqual(len(acquired), failure_position)
                self.assertEqual(sorted(acquired), sorted(closed))
                self.assertFalse(
                    (self.root / "controllers/work-board-reader-rollouts"
                     / (rid + ".json")).exists()
                )

    def _verify_post_receipt_rename_fsync_failure(
        self, rollout_id, expected_status, install_names, action,
    ):
        # Entire test is confined to this owned disposable fixture.
        receipt = (
            self.root / "controllers/work-board-reader-rollouts"
            / (rollout_id + ".json")
        )
        real_fsync = rollout.v2._fsync_dir
        injected = {"called": False}

        def after_receipt_replace(directory):
            if (
                not injected["called"] and Path(directory) == receipt.parent
                and receipt.is_file()
            ):
                self.assertEqual(
                    json.loads(receipt.read_bytes())["result"], expected_status
                )
                injected["called"] = True
                raise OSError("injected receipt parent fsync after replace")
            return real_fsync(directory)

        error = None
        with patch.object(
            rollout.v2, "_fsync_dir", side_effect=after_receipt_replace,
        ):
            try:
                action()
            except RuntimeError as caught:
                error = caught
        self.assertTrue(injected["called"])
        self.assertIsNotNone(error)
        if receipt.is_file():
            self.assertEqual(
                json.loads(receipt.read_bytes())["result"], expected_status
            )
            self.assertNotIn("rollback verified", str(error))
            for directory in self.dirs.values():
                for name in install_names:
                    self.assertEqual(
                        (directory / (name + ".py")).read_bytes(),
                        self.candidates[name].read_bytes(),
                    )
        else:
            # An actual rollback is acceptable only with no visible receipt
            # and every originally absent helper restored as absent.
            for directory in self.dirs.values():
                self.assertEqual(
                    (directory / "work_queue.py").read_bytes(), self.old_queue
                )
                self.assertFalse(
                    (directory / "work_board_v2.py").exists()
                )

    def test_c00_pair_postrename_dir_fsync_not_false_rollback(self):
        self.old_queue = self._legacy_semantic_readers()
        self._r7_sealed_done_changed_semantic_fixture()
        rid = "c00-pair-postrename-fsync"
        path, digest, _proof = self._transition(rid)
        self._verify_post_receipt_rename_fsync_failure(
            rid, "COMMITTED", ("work_queue", "work_board_v2"),
            lambda: self._run(rid, (path, digest)),
        )

    def test_c00_helper_postrename_dir_fsync_not_false_rollback(self):
        rid = "c00-helper-postrename-fsync"
        self._verify_post_receipt_rename_fsync_failure(
            rid, "APPLIED_PENDING_SOURCE_CURRENTITY", ("work_board_v2",),
            lambda: rollout.rollout(
                self.root, {"work_board_v2": self.candidate_v2},
                self.dirs, self.queue_hashes, self.module_prior,
                rollout_id=rid, module_only=True,
            ),
        )


    def _c00_source_inode_snapshot(self):
        # This is the test-owned fixture namespace, not an attestation of
        # external live writer paths or of already imported Python modules.
        # Read bytes and inode metadata from ONE O_NOFOLLOW descriptor.
        result = {}
        for role in rollout.ROLES:
            for name in ("work_queue", "work_board_v2"):
                path = self.dirs[role] / (name + ".py")
                try:
                    fd = os.open(
                        path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
                    )
                except FileNotFoundError:
                    result[(role, name)] = None
                    continue
                try:
                    before = os.fstat(fd)
                    self.assertTrue(stat.S_ISREG(before.st_mode))
                    chunks = []
                    while True:
                        part = os.read(fd, 65536)
                        if not part:
                            break
                        chunks.append(part)
                    after = os.fstat(fd)
                    self.assertEqual(
                        (before.st_dev, before.st_ino, before.st_size,
                         before.st_mode, before.st_nlink),
                        (after.st_dev, after.st_ino, after.st_size,
                         after.st_mode, after.st_nlink),
                    )
                    result[(role, name)] = (
                        hashlib.sha256(b"".join(chunks)).hexdigest(),
                        after.st_dev, after.st_ino,
                        stat.S_IMODE(after.st_mode), after.st_nlink,
                    )
                finally:
                    os.close(fd)
        return result

    def test_c00_repeat_rollout_id_created_at_fourth_lock_is_denied_before_install(self):
        rid = "c00-underlock-single-use"
        receipt = (
            self.root / "controllers/work-board-reader-rollouts"
            / (rid + ".json")
        )
        external_receipt = b'{"result":"FOREIGN_RESERVATION"}\n'
        original_flock = rollout.fcntl.flock
        acquired = {"count": 0}
        board_before = (self.root / "controllers/work-board.json").read_bytes()
        events = self.root / "controllers/work-board-events.jsonl"
        events_before = events.read_bytes() if events.exists() else None
        states_before = {
            role: (self.root / (role + ".json")).read_bytes()
            for role in "ABC"
        }
        readers_before = self._c00_source_inode_snapshot()
        def insert_at_last_lock(fd, operation):
            result = original_flock(fd, operation)
            if operation == rollout.fcntl.LOCK_EX:
                acquired["count"] += 1
                if acquired["count"] == 4:
                    receipt.parent.mkdir(parents=True, exist_ok=True)
                    receipt.write_bytes(external_receipt)
            return result

        with patch.object(rollout.fcntl, "flock", side_effect=insert_at_last_lock):
            with self.assertRaisesRegex(RuntimeError, "ROLLOUT_ALREADY_USED"):
                self._run(rid)
        self.assertEqual(acquired["count"], 4)
        self.assertEqual(receipt.read_bytes(), external_receipt)
        self.assertEqual(
            (self.root / "controllers/work-board.json").read_bytes(),
            board_before,
        )
        self.assertFalse(
            any((directory / "work_board_v2.py").exists()
                for directory in self.dirs.values())
        )
        self.assertEqual(self._c00_source_inode_snapshot(), readers_before)
        self.assertEqual(
            events.read_bytes() if events.exists() else None, events_before
        )
        self.assertEqual(
            {role: (self.root / (role + ".json")).read_bytes()
             for role in "ABC"}, states_before
        )

    def test_c00_foreign_receipt_claim_at_publication_is_never_overwritten(self):
        rid = "c00-publication-foreign-receipt"
        receipt = (
            self.root / "controllers/work-board-reader-rollouts"
            / (rid + ".json")
        )
        foreign = b'{"result":"FOREIGN_INDIVIDUAL_RECEIPT"}\n'
        real_atomic_noreplace = rollout._atomic_noreplace
        injected = {"count": 0}
        foreign_receipt_identity = []
        readers_before = self._c00_source_inode_snapshot()
        board_before = (self.root / "controllers/work-board.json").read_bytes()
        events = self.root / "controllers/work-board-events.jsonl"
        events_before = events.read_bytes() if events.exists() else None
        states_before = {
            role: (self.root / (role + ".json")).read_bytes()
            for role in "ABC"
        }

        def foreign_claim_before_noreplace(path, data, mode, *, scratch_dir=None):
            if Path(path) == receipt:
                injected["count"] += 1
                receipt.write_bytes(foreign)
                foreign_fd = os.open(
                    receipt, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
                )
                try:
                    snapshot = os.fstat(foreign_fd)
                    self.assertTrue(stat.S_ISREG(snapshot.st_mode))
                    foreign_receipt_identity.append((
                        snapshot.st_dev, snapshot.st_ino, snapshot.st_mode,
                        snapshot.st_nlink, snapshot.st_size, snapshot.st_ctime_ns,
                        snapshot.st_mtime_ns,
                    ))
                finally:
                    os.close(foreign_fd)
            return real_atomic_noreplace(
                path, data, mode, scratch_dir=scratch_dir
            )

        with patch.object(
            rollout, "_atomic_noreplace", side_effect=foreign_claim_before_noreplace
        ):
            with self.assertRaisesRegex(
                RuntimeError, "WORK_BOARD_V2_ROLLOUT_RECEIPT_WRITE_RECOVERY_REQUIRED"
            ):
                self._run(rid)
        self.assertEqual(injected["count"], 1)
        self.assertEqual(len(foreign_receipt_identity), 1)
        foreign_fd = os.open(
            receipt, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
        )
        try:
            snapshot = os.fstat(foreign_fd)
            self.assertTrue(stat.S_ISREG(snapshot.st_mode))
            self.assertEqual((
                snapshot.st_dev, snapshot.st_ino, snapshot.st_mode,
                snapshot.st_nlink, snapshot.st_size, snapshot.st_ctime_ns,
                snapshot.st_mtime_ns,
            ), foreign_receipt_identity[0])
            self.assertEqual(os.read(foreign_fd, len(foreign) + 1), foreign)
        finally:
            os.close(foreign_fd)
        # A publication attempt is not proof of rolled back reader state.
        # Recovery authority must inspect the exact candidate/installed files,
        # not retry the same rollout ID or infer COMMITTED from this receipt.
        # Publication collision occurred after pair file installation.
        # Preserve FOREIGN receipt and candidate reader bytes for separately
        # governed recovery; never assert an unproven rollback to preimage.
        readers_after = self._c00_source_inode_snapshot()
        self.assertNotEqual(readers_after, readers_before)
        for role in rollout.ROLES:
            self.assertEqual(
                (self.dirs[role] / "work_queue.py").read_bytes(),
                self.candidate_queue.read_bytes(),
            )
            self.assertEqual(
                (self.dirs[role] / "work_board_v2.py").read_bytes(),
                self.candidate_v2.read_bytes(),
            )
        self.assertEqual(
            (self.root / "controllers/work-board.json").read_bytes(),
            board_before,
        )
        self.assertEqual(
            events.read_bytes() if events.exists() else None, events_before
        )
        self.assertEqual(
            {role: (self.root / (role + ".json")).read_bytes()
             for role in "ABC"}, states_before
        )

    def test_only_executing_role_stop_blocks_rollout(self):
        (self.root / "A.json").write_text('{"status":"STOPPED"}')
        (self.root / "B.json").write_text('{"status":"STOPPED"}')
        (self.root / "C.json").write_text('{"status":"STOPPED"}')
        with self.assertRaisesRegex(RuntimeError, "STOPPED"):
            self._run("stop-c")
        self.assertFalse(any((directory / "work_board_v2.py").exists() for directory in self.dirs.values()))


    def _resource_seal_semantic_fixture(self):
        candidate_sha = "c" * 40
        receipt = self.root / "logs" / "r7-done.json"
        receipt.write_text(json.dumps({
            "kind": work_queue.COMPLETION_KIND,
            "version": work_queue.COMPLETION_VERSION,
            "task_id": "b-r7-done",
            "candidate_sha": candidate_sha,
            "verdict": "PASS",
            "review": {"verdict": "PASS", "evidence": ["r7-readable"]},
            "checks": [{"name": "r7-seal", "verdict": "PASS",
                        "evidence": ["isolated-native-seal"]}],
        }))
        directory = self.root / "disk-task-completions"
        directory.mkdir(mode=0o700)
        seal = directory / "B--b-r7-done.json"
        record = {"version": 1, "role": "B", "task": "b-r7-done",
                  "state": "SEALED", "history": [
                      {"state": "SEALING"}, {"state": "SEALED"},
                  ]}
        raw_seal = json.dumps(record, ensure_ascii=False).encode("utf-8")
        seal.write_bytes(raw_seal)
        producer = {
            "id": "b-r7-done", "role": "B", "plan": "B04",
            "state": "DONE", "requires": [], "result": "Producer",
            "paths": ["apps/api/src/r7-done.ts"],
            "completion_receipt": str(receipt),
            "completion_receipt_format": 1,
            "completion_candidate_sha": candidate_sha,
            "completion_resource_required": True,
            "completion_resource_seal_snapshot": {
                "version": 1, "control_root": str(self.root.resolve()),
                "role": "B", "task_id": "b-r7-done",
                "seal_record_sha256": hashlib.sha256(raw_seal).hexdigest(),
                "delegation_inventory_version": 1,
                "delegation_inventory_attested": True,
                "foreign_allocation_count": 0,
                "delegated_publication_registration": None,
            },
        }
        dependent = {
            "id": "a-r7-dependent", "role": "A", "plan": "A04",
            "state": "BLOCKED", "requires": ["b-r7-done"],
            "result": "Consumer",
            "paths": ["apps/extension/r7-dependent.js"],
        }
        board = {"version": 1, "revision": 2,
                 "updated_at": "2026-10-08T00:00:00+00:00",
                 "tasks": [producer, dependent]}
        (self.root / "controllers/work-board.json").write_text(
            json.dumps(board, ensure_ascii=False, indent=2) + "\n")
        return seal, record

    def test_r7_unchanged_sealed_resource_semantic_accepts_dependents(self):
        self._resource_seal_semantic_fixture()
        result = rollout._semantic(work_queue, self.root)
        dependent = next(x for x in result["task_views"]
                         if x["id"] == "a-r7-dependent")
        self.assertEqual(dependent["state"], "READY")
        self.assertIn("b-r7-done", work_queue._BoardEvaluation(
            result["board"], root=self.root).done)

    def test_r7_resource_seal_changes_mid_semantic_projection_refused(self):
        seal, record = self._resource_seal_semantic_fixture()
        original = work_queue.role_work
        changed = []

        def mutate_after_first_role(root, role):
            value = original(root, role)
            if role == "A" and not changed:
                record["state"] = "SEALING"
                seal.write_text(json.dumps(record))
                changed.append(True)
            return value

        with patch.object(work_queue, "role_work",
                          side_effect=mutate_after_first_role):
            with self.assertRaisesRegex(
                RuntimeError,
                "WORK_BOARD_V2_ROLLOUT_VALIDATION_EVIDENCE_CHANGED",
            ):
                rollout._semantic(work_queue, self.root)
        self.assertEqual(changed, [True])
        self.assertNotIn("b-r7-done", work_queue._BoardEvaluation(
            work_queue.load_board(self.root), root=self.root).done)

    def test_r7_resource_seal_wrong_root_never_authorizes_done(self):
        seal, _record = self._resource_seal_semantic_fixture()
        board = work_queue.load_board(self.root)
        board["tasks"][0]["completion_resource_seal_snapshot"][
            "control_root"] = "/forged/wrong-root"
        (self.root / "controllers/work-board.json").write_text(
            json.dumps(board, ensure_ascii=False, indent=2) + "\n")
        self.assertTrue(seal.exists())
        result = rollout._semantic(work_queue, self.root)
        dependent = next(x for x in result["task_views"]
                         if x["id"] == "a-r7-dependent")
        self.assertEqual(dependent["state"], "BLOCKED")


    def test_r7_native_v2_archived_done_uses_logical_and_seal_readers(self):
        # This is an actual on-disk V2 completed archive, not a mocked
        # load_board returning version=2.
        seal, record = self._resource_seal_semantic_fixture()
        v2 = work_queue._v2()
        logical = work_queue.load_board(self.root)
        previous_raw = (self.root / "controllers/work-board.json").read_bytes()
        generated = v2.build_generation_from_v1(self.root, logical)
        v2._paths(self.root, create=True)
        v2._write_drafts(self.root, generated["drafts"])
        core = generated["core"]
        hot = dict(core, generation_id=v2._generation_id(core),
                   last_operation_id="0" * 64)
        generation = hot["generation_id"]
        prior_sha = hashlib.sha256(previous_raw).hexdigest()
        migration_id = v2._semantic_sha({
            "schema_version": 1, "pre_v1_sha256": prior_sha,
            "new_generation_id": generation,
            "authority_id": "C00-R7-SYNTHETIC-TEST-ONLY-NO-LIVE-GRANT",
        })
        _operation_id, bytes_hot, tx = v2._make_migration_tx(
            prior_sha, logical["revision"], hot,
            v2._canonical_bytes(hot), migration_id)
        tx["state"] = "COMMITTED"
        v2._write_journal(self.root, tx, initial=True)
        v2.install_hot_generation(self.root, bytes_hot)

        physical_hot = json.loads(
            (self.root / "controllers/work-board.json").read_text())
        self.assertEqual(physical_hot["version"], 2)
        self.assertNotIn("b-r7-done",
                         [row["id"] for row in physical_hot["tasks"]])
        hydrated = work_queue.load_board(self.root)
        self.assertIn("b-r7-done", [row["id"] for row in hydrated["tasks"]])
        self.assertIn("b-r7-done",
                      work_queue._BoardEvaluation(hydrated, root=self.root).done)
        accepted = rollout._semantic(work_queue, self.root)
        dependent = next(row for row in accepted["task_views"]
                         if row["id"] == "a-r7-dependent")
        self.assertEqual(dependent["state"], "READY")

        # Committed journal and archived DONE alone cannot authorize access
        # after the resource seal is no longer valid.
        record["state"] = "SEALING"
        seal.write_text(json.dumps(record))
        invalid = rollout._semantic(work_queue, self.root)
        dependent_invalid = next(row for row in invalid["task_views"]
                                 if row["id"] == "a-r7-dependent")
        self.assertEqual(dependent_invalid["state"], "BLOCKED")
        self.assertTrue(next(row for row in invalid["task_views"]
                             if row["id"] == "b-r7-done")["completion_invalidated"])


    def test_r7_legacy_reader_missing_attention_rejects_blocked_board(self):
        # Historical readers may lack blocker_attention. Do not fabricate
        # empty attention for a board that actually has a BLOCKED task.
        value = {"version": 1, "revision": 7, "tasks": [{
            "id": "b-old-block", "role": "B", "plan": "B04",
            "state": "BLOCKED", "requires": [],
            "result": "Unresolved old blocker",
            "paths": ["apps/api/src/old-block.ts"],
        }]}
        (self.root / "controllers/work-board.json").write_text(
            json.dumps(value, ensure_ascii=False, indent=2) + "\n")

        class OldReader:
            @staticmethod
            def load_board(path):
                return json.loads((path / "controllers/work-board.json").read_text())

            @staticmethod
            def task_view(_board, task):
                return task

            @staticmethod
            def role_work(_root, role):
                return {"role": role, "tasks": [], "owner_attention": []}

            @staticmethod
            def board_snapshot(_root):
                return {"exists": True, "sha256": "a" * 64}

            @staticmethod
            def status_work(_root, role):
                return {"role": role, "tasks": [], "action_required": True}

        with self.assertRaisesRegex(
            RuntimeError,
            "WORK_BOARD_V2_ROLLOUT_LEGACY_BLOCKER_ATTENTION_REQUIRED",
        ):
            rollout._semantic(OldReader, self.root)



if __name__ == "__main__":
    unittest.main()
