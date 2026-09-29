from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


HERE = Path(__file__).resolve().parent
MODULES = (
    ("lifecycle", HERE / "exact-store-technical-lifecycle.py"),
    ("reset", HERE / "exact-store-technical-reset.py"),
)


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location("exact_" + name, path)
    if spec is None or spec.loader is None:
        raise AssertionError("MODULE_IMPORT_FAILED")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class HashHelper:
    @staticmethod
    def sha256(path: Path) -> str:
        return hashlib.sha256(path.read_bytes()).hexdigest()


class PackageIdentityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.modules = [(name, load_module(name, path)) for name, path in MODULES]

    def test_accepts_explicit_candidate_sha_and_version(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            carrier = root / "candidate.zip"
            carrier.write_bytes(b"candidate-bytes")
            runtime = root / "runtime"
            runtime.mkdir()
            (runtime / "manifest.json").write_text(
                json.dumps({"version": "0.2.8"}), encoding="utf-8"
            )
            expected_sha = hashlib.sha256(carrier.read_bytes()).hexdigest()

            for name, module in self.modules:
                with self.subTest(module=name):
                    actual_sha, actual_version = module.validate_package_identity(
                        HashHelper, carrier, runtime, expected_sha, "0.2.8"
                    )
                    self.assertEqual(actual_sha, expected_sha)
                    self.assertEqual(actual_version, "0.2.8")

    def test_rejects_sha_mismatch_before_browser_run(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            carrier = root / "candidate.zip"
            carrier.write_bytes(b"candidate-bytes")

            runtime = root / "runtime"
            runtime.mkdir()
            (runtime / "manifest.json").write_text(
                json.dumps({"version": "0.2.8"}), encoding="utf-8"
            )

            for name, module in self.modules:
                with self.subTest(module=name):
                    with self.assertRaises(Exception) as caught:
                        module.validate_package_identity(
                            HashHelper, carrier, runtime, "0" * 64, "0.2.8"
                        )
                    self.assertEqual(str(caught.exception), "STORE_ZIP_SHA256_MISMATCH")

    def test_rejects_manifest_version_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            carrier = root / "candidate.zip"
            carrier.write_bytes(b"candidate-bytes")
            runtime = root / "runtime"
            runtime.mkdir()
            (runtime / "manifest.json").write_text(
                json.dumps({"version": "0.2.7"}), encoding="utf-8"
            )
            expected_sha = hashlib.sha256(carrier.read_bytes()).hexdigest()

            for name, module in self.modules:
                with self.subTest(module=name):
                    with self.assertRaises(Exception) as caught:
                        module.validate_package_identity(
                            HashHelper, carrier, runtime, expected_sha, "0.2.8"
                        )
                    self.assertEqual(
                        str(caught.exception), "PACKAGE_MANIFEST_VERSION_MISMATCH"
                    )


    def test_cli_preserves_string_identity_arguments(self) -> None:
        required = {
            "lifecycle": (
                "carrier", "source-runtime", "recipient-runtime", "source-profile",
                "recipient-profile", "browser-executable", "technical-session-file", "output",
            ),
            "reset": (
                "carrier", "source-runtime", "recipient-runtime", "source-profile",
                "recipient-profile", "main-runtime", "main-profile", "browser-executable",
                "technical-session-file", "output",
            ),
        }
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name, module in self.modules:
                with self.subTest(module=name):
                    argv = ["prog"]
                    for field in required[name]:
                        argv.extend(["--" + field, str(root / (field + ".tmp"))])
                    argv.extend([
                        "--expected-package-sha256", "abc123",
                        "--expected-manifest-version", "9.9.9",
                    ])

                    def fake_run(args):
                        self.assertEqual(args.expected_package_sha256, "abc123")
                        self.assertEqual(args.expected_manifest_version, "9.9.9")
                        self.assertIsInstance(args.carrier, Path)
                        return {"status": "PASS"}

                    with patch.object(module, "run", fake_run), patch.object(sys, "argv", argv):
                        self.assertEqual(module.main(), 0)


if __name__ == "__main__":
    unittest.main()
