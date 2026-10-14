import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("ops_release_inputs", Path(__file__).with_name("ops_release_inputs.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class OpsReleaseInputsTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="ops-inputs-")
        self.root = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def manifest(self, path, name, dependencies=None):
        target = self.root / path / "package.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps({"name": name, "dependencies": dependencies or {}}))
        return target.relative_to(self.root).as_posix()

    def test_transitive_closure_excludes_unrelated_apps_and_handles_cycles(self):
        tracked = [
            self.manifest("apps/telegram-operator", "@product/telegram-operator", {"@product/shared": "workspace:*", "tsx": "4.20.5"}),
            self.manifest("packages/shared", "@product/shared", {"@product/contracts": "workspace:*"}),
            self.manifest("packages/contracts", "@product/contracts", {"@product/shared": "workspace:*"}),
            self.manifest("apps/admin", "@product/admin"),
            "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json",
        ]
        with patch.object(module.subprocess, "check_output", return_value="\0".join(tracked)):
            result = module.runtime_inputs(self.root)
        self.assertIn("packages/contracts", result)
        self.assertIn("tooling/operations", result)
        self.assertNotIn("apps/admin", result)
        self.assertNotIn("docs", result)

    def test_missing_workspace_dependency_fails_closed(self):
        tracked = self.manifest("apps/telegram-operator", "@product/telegram-operator", {"@product/missing": "workspace:*"})
        with patch.object(module.subprocess, "check_output", return_value=tracked):
            with self.assertRaisesRegex(ValueError, "MISSING_WORKSPACE"):
                module.runtime_inputs(self.root)

    def test_count_limit_never_deletes_active_or_old_releases(self):
        release = self.root / ("a" * 40)
        release.mkdir()
        with self.assertRaisesRegex(ValueError, "COUNT_LIMIT"):
            module.check_budget(self.root, 1, 10**10, 1)
        self.assertTrue(release.exists())

    def test_byte_limit_rejects_before_another_copy(self):
        (self.root / "payload").write_bytes(b"x" * 8192)
        with self.assertRaisesRegex(ValueError, "BYTES_LIMIT"):
            module.check_budget(self.root, 16, 1, 1)

    def test_free_space_uses_available_blocks_and_preserves_staging_margin(self):
        class FileSystem:
            f_bavail = 10
            f_frsize = 4096
        with patch.object(module.os, "statvfs", return_value=FileSystem()):
            with self.assertRaisesRegex(ValueError, "FREE_SPACE_RESERVE"):
                module.check_budget(self.root, 16, 10**10, 1024)

    def test_node_reuses_only_verified_readonly_identical_payload(self):
        source = self.root / "node-source"
        source.write_bytes(b"fixture-node")
        source.chmod(0o755)
        release = self.root / ("a" * 40)
        donor = release / ".runtime/node"
        donor.parent.mkdir(parents=True)
        donor.write_bytes(source.read_bytes())
        donor.chmod(0o555)
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        (release / "RELEASE_MANIFEST.json").write_text(json.dumps({"sourceSha": release.name, "runtime": {"nodeSha256": digest}}))
        stage = self.root / "stage"
        self.assertEqual(module.stage_node(source, stage, self.root), "verified_immutable_hardlink")
        self.assertEqual(donor.stat().st_ino, (stage / ".runtime/node").stat().st_ino)
        self.assertNotEqual(source.stat().st_ino, donor.stat().st_ino)

    def test_writable_or_corrupted_donor_is_never_linked(self):
        source = self.root / "node-source"
        source.write_bytes(b"fixture-node")
        for mode in (0o755, 0o555):
            release = self.root / (str(mode % 10) * 40)
            donor = release / ".runtime/node"
            donor.parent.mkdir(parents=True)
            donor.write_bytes(b"corrupt" if mode == 0o555 else source.read_bytes())
            donor.chmod(mode)
            (release / "RELEASE_MANIFEST.json").write_text(json.dumps({"sourceSha": release.name, "runtime": {"nodeSha256": hashlib.sha256(source.read_bytes()).hexdigest()}}))
        stage = self.root / "stage"
        self.assertEqual(module.stage_node(source, stage, self.root), "private_copy")
        self.assertEqual((stage / ".runtime/node").read_bytes(), source.read_bytes())
        self.assertEqual((stage / ".runtime/node").stat().st_mode & 0o777, 0o555)


if __name__ == "__main__":
    unittest.main()
