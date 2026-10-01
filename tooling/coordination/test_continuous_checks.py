"""Proof reuse and mutation regressions for bounded extension checks."""
import contextlib
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import continuous_checks as checks


class CheckProofTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.output = self.root / "checks"
        self.git("init", "-q")
        self.git("config", "user.name", "Test")
        self.git("config", "user.email", "test@example.invalid")
        (self.repo / "source.js").write_text("before")
        self.git("add", ".")
        self.git("commit", "-qm", "initial")
        self.builds = 0

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.repo)

    def build(self, repo, output):
        self.builds += 1
        extracted = output / "extracted"
        extracted.mkdir(parents=True)
        (extracted / "runtime.js").write_bytes(b"runtime")
        (output / "development.zip").write_bytes(b"zip bytes")
        composition = {
            "files": [{"path": "runtime.js", "sha256": checks.sha(b"runtime")}],
            "package": {"name": "development.zip", "bytes": 9,
                        "sha256": checks.sha(b"zip bytes")},
        }
        return extracted, extracted, composition

    def prepare(self):
        return checks.prepare_package(self.repo, self.output, self.build)

    def test_unchanged_source_reuses_one_verified_build(self):
        first, receipt = self.prepare()
        second, repeated = self.prepare()
        self.assertEqual(first, second)
        self.assertEqual(receipt, repeated)
        self.assertEqual(self.builds, 1)

    def test_tracked_edit_requires_new_package(self):
        first, _ = self.prepare()
        (self.repo / "source.js").write_text("after")
        second, _ = self.prepare()
        self.assertNotEqual(first, second)
        self.assertEqual(self.builds, 2)

    def test_untracked_input_changes_identity(self):
        before = checks.source_identity(self.repo)
        (self.repo / "new.js").write_text("new input")
        self.assertNotEqual(before, checks.source_identity(self.repo))

    def test_tracked_symlink_cannot_import_unbound_bytes(self):
        (self.repo / "source.js").unlink()
        (self.root / "outside").write_text("external")
        (self.repo / "source.js").symlink_to(self.root / "outside")
        with self.assertRaisesRegex(RuntimeError, "INPUT_SYMLINK"):
            self.prepare()

    def test_package_modified_or_extra_bytes_reject_reuse(self):
        runtime, _ = self.prepare()
        (runtime / "runtime.js").write_text("changed")
        with self.assertRaisesRegex(RuntimeError, "PACKAGE_BYTES_CHANGED"):
            self.prepare()
        (runtime / "runtime.js").write_bytes(b"runtime")
        (runtime / "injected.js").write_text("extra")
        with self.assertRaisesRegex(RuntimeError, "PACKAGE_BYTES_CHANGED"):
            self.prepare()
        self.assertEqual(self.builds, 1)

    def test_archive_modified_rejects_stale_hash(self):
        runtime, _ = self.prepare()
        (runtime.parent / "development.zip").write_bytes(b"bad bytes")
        with self.assertRaisesRegex(RuntimeError, "ARCHIVE_BYTES_CHANGED"):
            self.prepare()

    def test_receipt_cannot_point_outside_package(self):
        runtime, receipt = self.prepare()
        receipt["composition"]["package"]["name"] = "../outside.zip"
        with self.assertRaisesRegex(RuntimeError, "ARCHIVE_PATH_INVALID"):
            checks.package_identity(runtime, receipt["composition"])

    def test_builder_mutation_cannot_be_marked_verified(self):
        def mutating_builder(repo, output):
            result = self.build(repo, output)
            (repo / "source.js").write_text("mutated by build")
            return result
        with self.assertRaisesRegex(RuntimeError, "BUILDER_MUTATED_INPUTS"):
            checks.prepare_package(self.repo, self.output, mutating_builder)
        self.assertFalse(list(self.output.rglob("verified-composition.json")))

    def test_existing_partial_build_is_not_silently_rebuilt(self):
        partial = self.output / ("extension-" + checks.source_identity(self.repo))
        partial.mkdir(parents=True)
        with self.assertRaises(FileExistsError):
            self.prepare()
        self.assertEqual(self.builds, 0)

    def test_test_mutation_cannot_return_pass(self):
        original_run = subprocess.run
        def run(argv, **kwargs):
            if argv[0] == "fake-node":
                (self.repo / "source.js").write_text("test mutated source")
                return subprocess.CompletedProcess(argv, 0)
            return original_run(argv, **kwargs)
        prepared = self.prepare()
        with patch.object(checks, "prepare_package", return_value=prepared), \
             patch.object(subprocess, "run", side_effect=run):
            with self.assertRaisesRegex(RuntimeError, "MUTATED_INPUTS"):
                checks.run_check(self.repo, self.output, "extension-support", "fake-node")

    def test_exit_failure_and_boundary_preserved(self):
        original_run = subprocess.run
        def run(argv, **kwargs):
            return subprocess.CompletedProcess(argv, 7) if argv[0] == "fake-node" else original_run(argv, **kwargs)
        # Capture a prepared immutable package to avoid mocking recursion.
        prepared = self.prepare()
        out = io.StringIO()
        with patch.object(checks, "prepare_package", return_value=prepared), \
             patch.object(subprocess, "run", side_effect=run), contextlib.redirect_stdout(out):
            result = checks.run_check(self.repo, self.output, "extension-support", "fake-node")
        receipt = json.loads(out.getvalue())
        self.assertEqual(result, 7)
        self.assertEqual(receipt["boundary"], "SOURCE_PACKAGE_VM")
        self.assertFalse(receipt["installed"] or receipt["live"] or receipt["store"])


if __name__ == "__main__":
    unittest.main()
