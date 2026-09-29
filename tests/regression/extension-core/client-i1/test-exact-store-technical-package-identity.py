from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
import zipfile
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


class InventoryHelper(HashHelper):
    @staticmethod
    def carrier_inventory(path: Path) -> dict[str, str]:
        with zipfile.ZipFile(path) as archive:
            return {
                name: hashlib.sha256(archive.read(name)).hexdigest()
                for name in archive.namelist()
                if not name.endswith("/")
            }

    @staticmethod
    def runtime_inventory(path: Path) -> dict[str, str]:
        return {
            item.relative_to(path).as_posix(): hashlib.sha256(item.read_bytes()).hexdigest()
            for item in sorted(path.rglob("*"))
            if item.is_file()
        }


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
                json.dumps({"version": "0.2.9"}), encoding="utf-8"
            )
            expected_sha = hashlib.sha256(carrier.read_bytes()).hexdigest()

            for name, module in self.modules:
                with self.subTest(module=name):
                    actual_sha, actual_version = module.validate_package_identity(
                        HashHelper, carrier, runtime, expected_sha, "0.2.9"
                    )
                    self.assertEqual(actual_sha, expected_sha)
                    self.assertEqual(actual_version, "0.2.9")

    def test_rejects_sha_mismatch_before_browser_run(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            carrier = root / "candidate.zip"
            carrier.write_bytes(b"candidate-bytes")

            runtime = root / "runtime"
            runtime.mkdir()
            (runtime / "manifest.json").write_text(
                json.dumps({"version": "0.2.9"}), encoding="utf-8"
            )

            for name, module in self.modules:
                with self.subTest(module=name):
                    with self.assertRaises(Exception) as caught:
                        module.validate_package_identity(
                            HashHelper, carrier, runtime, "0" * 64, "0.2.9"
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
                json.dumps({"version": "0.2.8"}), encoding="utf-8"
            )
            expected_sha = hashlib.sha256(carrier.read_bytes()).hexdigest()

            for name, module in self.modules:
                with self.subTest(module=name):
                    with self.assertRaises(Exception) as caught:
                        module.validate_package_identity(
                            HashHelper, carrier, runtime, expected_sha, "0.2.9"
                        )
                    self.assertEqual(
                        str(caught.exception), "PACKAGE_MANIFEST_VERSION_MISMATCH"
                    )


    def test_reset_preserved_main_accepts_exact_independent_identity(self) -> None:
        reset = dict(self.modules)["reset"]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            carrier = root / "main.zip"
            runtime = root / "main-runtime"
            runtime.mkdir()
            manifest = json.dumps({"version": "0.2.6"}).encode()
            popup = b"preserved-popup"
            with zipfile.ZipFile(carrier, "w") as archive:
                archive.writestr("manifest.json", manifest)
                archive.writestr("popup.js", popup)
            (runtime / "manifest.json").write_bytes(manifest)
            (runtime / "popup.js").write_bytes(popup)
            expected_sha = hashlib.sha256(carrier.read_bytes()).hexdigest()

            actual = reset.validate_preserved_main_identity(
                InventoryHelper, carrier, runtime, expected_sha, "0.2.6"
            )
            self.assertEqual(actual, (expected_sha, "0.2.6", 2))

    def test_reset_preserved_main_rejects_changed_or_missing_runtime_bytes(self) -> None:
        reset = dict(self.modules)["reset"]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            carrier = root / "main.zip"
            runtime = root / "main-runtime"
            runtime.mkdir()
            manifest = json.dumps({"version": "0.2.6"}).encode()
            with zipfile.ZipFile(carrier, "w") as archive:
                archive.writestr("manifest.json", manifest)
                archive.writestr("popup.js", b"expected")
            (runtime / "manifest.json").write_bytes(manifest)
            (runtime / "popup.js").write_bytes(b"tampered")
            expected_sha = hashlib.sha256(carrier.read_bytes()).hexdigest()

            with self.assertRaises(Exception) as changed:
                reset.validate_preserved_main_identity(
                    InventoryHelper, carrier, runtime, expected_sha, "0.2.6"
                )
            self.assertEqual(str(changed.exception), "MAIN_RUNTIME_BYTES_MISMATCH")

            (runtime / "popup.js").unlink()
            with self.assertRaises(Exception) as missing:
                reset.validate_preserved_main_identity(
                    InventoryHelper, carrier, runtime, expected_sha, "0.2.6"
                )
            self.assertEqual(str(missing.exception), "MAIN_RUNTIME_BYTES_MISMATCH")

    def test_reset_preserved_main_rejects_wrong_carrier_hash(self) -> None:
        reset = dict(self.modules)["reset"]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            carrier = root / "main.zip"
            runtime = root / "main-runtime"
            runtime.mkdir()
            manifest = json.dumps({"version": "0.2.6"}).encode()
            with zipfile.ZipFile(carrier, "w") as archive:
                archive.writestr("manifest.json", manifest)
            (runtime / "manifest.json").write_bytes(manifest)

            with self.assertRaises(Exception) as caught:
                reset.validate_preserved_main_identity(
                    InventoryHelper, carrier, runtime, "0" * 64, "0.2.6"
                )
            self.assertEqual(str(caught.exception), "MAIN_STORE_ZIP_SHA256_MISMATCH")


    def test_cli_preserves_string_identity_arguments(self) -> None:
        required = {
            "lifecycle": (
                "carrier", "source-runtime", "recipient-runtime", "source-profile",
                "recipient-profile", "browser-executable", "technical-session-file", "output",
            ),
            "reset": (
                "carrier", "source-runtime", "recipient-runtime", "source-profile",
                "recipient-profile", "main-carrier", "main-runtime", "main-profile",
                "browser-executable", "technical-session-file", "output",
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
                    if name == "reset":
                        argv.extend([
                            "--expected-main-package-sha256", "def456",
                            "--expected-main-manifest-version", "8.8.8",
                        ])

                    def fake_run(args):
                        self.assertEqual(args.expected_package_sha256, "abc123")
                        self.assertEqual(args.expected_manifest_version, "9.9.9")
                        if name == "reset":
                            self.assertEqual(args.expected_main_package_sha256, "def456")
                            self.assertEqual(args.expected_main_manifest_version, "8.8.8")
                            self.assertIsInstance(args.main_carrier, Path)
                        self.assertIsInstance(args.carrier, Path)
                        return {"status": "PASS"}

                    with patch.object(module, "run", fake_run), patch.object(sys, "argv", argv):
                        self.assertEqual(module.main(), 0)


if __name__ == "__main__":
    unittest.main()
