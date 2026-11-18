"""Preparation tests use only a temporary release and inert dependency files."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


DEPLOY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DEPLOY))
try:
    spec = importlib.util.spec_from_file_location("platform_overlay", DEPLOY / "install_platform_overlay.py")
    installer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(installer)
finally:
    sys.path.pop(0)
ORIGINAL = (Path(__file__).parent / "fixtures/platform_queries_service_original.py").read_bytes()


class OverlayTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        self.source = self.root / installer.SOURCE_RELEASE
        self.source.mkdir()
        self.output = self.root / "alisa-harness-query-test-v1"
        self.plan = self.root / "prepare-plan"
        query = self.source / installer.SOURCE_RELATIVE_PATH
        query.parent.mkdir(parents=True)
        query.write_bytes(ORIGINAL)
        launcher = self.source / "infra/launch.py"
        launcher.parent.mkdir()
        launcher.write_text("# An inert test launcher; never executed.\n")
        (self.source / "other.py").write_text("UNCHANGED = True\n")
        venv = self.root / "original-dependencies"
        (venv / "bin").mkdir(parents=True)
        (venv / "bin/python").write_text("inert dependency fixture")
        (self.source / ".venv").symlink_to(venv)
        manifest = self.source / "manifest.json"
        manifest.write_text(json.dumps({"artifact_id": installer.SOURCE_RELEASE,
            "files": {installer.SOURCE_RELATIVE_PATH: installer.SOURCE_SHA256},
            "preserved_history": {"example": "unchanged"}}))
        self.manifest_bytes = manifest.read_bytes()
        self.dropins = self.root / "unit.d"
        self.dropins.mkdir()
        existing = self.dropins / ("z" * 180 + "-demand-s12.conf")
        existing.write_text("[Service]\nWorkingDirectory=" + str(self.source) + "\n")
        self.snapshot = {"properties": {"WorkingDirectory": str(self.source)},
                         "dropins": {str(existing): installer.sha256(existing)}}
        for name, value in {
            "LAUNCH_SHA256": installer.sha256(launcher),
            "MANIFEST_SHA256": installer.sha256(manifest),
            "VENV_LINK": str(venv), "DROPIN_DIRECTORY": self.dropins,
        }.items():
            patcher = patch.object(installer, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_prepares_clone_preserves_source_and_dependencies_without_activation(self):
        with patch.object(installer.subprocess, "run", wraps=subprocess.run) as commands:
            result = installer.prepare(self.source, self.output, self.plan, self.snapshot)
        self.assertEqual([call.args[0][0] for call in commands.call_args_list], ["cp"])
        self.assertEqual(result["status"], "PREPARED_NOT_ACTIVATED")
        self.assertEqual((self.source / installer.SOURCE_RELATIVE_PATH).read_bytes(), ORIGINAL)
        self.assertEqual((self.source / "manifest.json").read_bytes(), self.manifest_bytes)
        self.assertEqual((self.output / installer.SOURCE_RELATIVE_PATH).read_bytes(), installer.patch_source(ORIGINAL))
        self.assertEqual((self.output / "other.py").read_bytes(), (self.source / "other.py").read_bytes())
        self.assertNotEqual((self.output / "other.py").stat().st_ino, (self.source / "other.py").stat().st_ino)
        self.assertTrue((self.output / ".venv").is_symlink())
        self.assertEqual(os.readlink(self.output / ".venv"), os.readlink(self.source / ".venv"))
        cloned_manifest = json.loads((self.output / "manifest.json").read_text())
        self.assertEqual(cloned_manifest["artifact_id"], self.output.name)
        self.assertEqual(cloned_manifest["preserved_history"], {"example": "unchanged"})
        self.assertFalse(Path(result["installed_dropin"]).exists())
        self.assertTrue(Path(result["planned_dropin"]).read_text().endswith(f"{self.output}/infra/launch.py platform\n"))
        rollback = (self.plan / "ACTIVATION_AND_ROLLBACK.md").read_text()
        self.assertIn("zero unexpired receipts", rollback)
        self.assertIn("Do not delete or rewrite receipts", rollback)
        self.assertLess(rollback.index("zero unexpired receipts"), rollback.index("rm --"))

    def test_modified_active_dropin_stops_before_clone(self):
        Path(next(iter(self.snapshot["dropins"]))).write_text("# concurrent deployment\n")
        with self.assertRaisesRegex(ValueError, "Live drop-in changed"):
            installer.prepare(self.source, self.output, self.plan, self.snapshot)
        self.assertFalse(self.output.exists())
        self.assertFalse(self.plan.exists())

    def test_source_drift_and_reusing_existing_destination_are_refused(self):
        self.output.mkdir()
        with self.assertRaisesRegex(ValueError, "already exists"):
            installer.prepare(self.source, self.output, self.plan, self.snapshot)
        self.output.rmdir()
        query = self.source / installer.SOURCE_RELATIVE_PATH
        query.write_bytes(ORIGINAL + b"\n")
        with self.assertRaisesRegex(ValueError, "Audited source changed"):
            installer.prepare(self.source, self.output, self.plan, self.snapshot)
        self.assertFalse(self.output.exists())

    def test_dropin_sorts_after_actual_180_z_release_override(self):
        existing = next(iter(self.snapshot["dropins"]))
        name = installer.dropin_name([existing])
        self.assertEqual(name, "z" * 181 + "-harness-query.conf")
        self.assertGreater(name, Path(existing).name)
        with self.assertRaises(ValueError):
            installer.dropin_name(["z" * 250 + ".conf"])


if __name__ == "__main__":
    unittest.main()
