"""Pure unit regressions for isolated CDP-installed extension worker selection."""

import json
import tempfile
import unittest
from pathlib import Path

from browser_worker_activation import (
    require_loaded_extension_id, require_manifest_worker_entry, select_owned_worker,
)

HERE = Path(__file__).resolve().parent


class Worker:
    def __init__(self, url):
        self.url = url


class BrowserWorkerActivationTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix="octo-i1-cdp-worker-")
        self.addCleanup(temp.cleanup)
        # All fixture siblings (outside-worker, manifest and symlink) must
        # remain inside this test's own TemporaryDirectory, never /tmp itself.
        self.root = Path(temp.name) / "runtime"
        self.root.mkdir()
        (self.root / "service_worker_entry.js").write_text("/* local fixture */")
        (self.root / "manifest.json").write_text(json.dumps({
            "manifest_version": 3,
            "background": {"service_worker": "service_worker_entry.js"},
        }))
        self.extension_id = "a" * 32
        self.expected = f"chrome-extension://{self.extension_id}/service_worker_entry.js"

    def test_cdp_loaded_extension_id_accepts_valid(self):
        self.assertEqual(require_loaded_extension_id({"id": self.extension_id}),
                         self.extension_id)

    def test_cdp_loaded_extension_id_rejects_missing_or_invalid(self):
        with self.assertRaisesRegex(RuntimeError, "not an object"):
            require_loaded_extension_id(None)
        for value in ({}, {"id": None}, {"id": "A" * 32},
                      {"id": "z" * 32}, {"id": self.extension_id[:-1]},
                      {"id": self.extension_id + "x"}):
            with self.subTest(value=str(value)[:48]):
                with self.assertRaisesRegex(RuntimeError, "valid extension ID"):
                    require_loaded_extension_id(value)

    def test_manifest_worker_entry_positive(self):
        self.assertEqual(require_manifest_worker_entry(self.root),
                         "service_worker_entry.js")

    def test_manifest_worker_rejects_missing_file(self):
        (self.root / "service_worker_entry.js").unlink()
        with self.assertRaisesRegex(RuntimeError, "missing"):
            require_manifest_worker_entry(self.root)

    def test_manifest_worker_rejects_unsafe_traversal(self):
        for entry in ("../escape.js", "/absolute.js", "shared//worker.js",
                      "shared/./worker.js", "shared/../worker.js",
                      "shared\\worker.js", "not-javascript"):
            with self.subTest(entry=entry):
                (self.root / "manifest.json").write_text(json.dumps({
                    "background": {"service_worker": entry},
                }))
                with self.assertRaises(RuntimeError):
                    require_manifest_worker_entry(self.root)

    def test_nested_regular_manifest_worker_accepts_canonical_path(self):
        nested = self.root / "assets" / "workers"
        nested.mkdir(parents=True)
        (nested / "main.js").write_text("/* harmless fixture */")
        (self.root / "manifest.json").write_text(json.dumps({
            "manifest_version": 3,
            "background": {"service_worker": "assets/workers/main.js"},
        }))
        self.assertEqual(require_manifest_worker_entry(self.root),
                         "assets/workers/main.js")

    def test_external_worker_file_symlink_is_rejected(self):
        outside = self.root.parent / "outside-worker.js"
        outside.write_text("/* external fixture */")
        worker = self.root / "service_worker_entry.js"
        worker.unlink()
        worker.symlink_to(outside)
        with self.assertRaisesRegex(RuntimeError, "symlink"):
            require_manifest_worker_entry(self.root)

    def test_internal_worker_symlink_is_also_rejected(self):
        (self.root / "internal.js").write_text("/* canonical internal file */")
        worker = self.root / "service_worker_entry.js"
        worker.unlink()
        worker.symlink_to(self.root / "internal.js")
        with self.assertRaisesRegex(RuntimeError, "symlink"):
            require_manifest_worker_entry(self.root)

    def test_intermediate_directory_symlink_is_rejected(self):
        nested = self.root / "shared"
        nested.mkdir()
        (nested / "worker.js").write_text("/* nested harmless file */")
        (self.root / "alias").symlink_to(nested, target_is_directory=True)
        (self.root / "manifest.json").write_text(json.dumps({
            "background": {"service_worker": "alias/worker.js"},
        }))
        with self.assertRaisesRegex(RuntimeError, "symlink"):
            require_manifest_worker_entry(self.root)

    def test_manifest_symlink_is_rejected(self):
        manifest = self.root / "manifest.json"
        outside = self.root.parent / "outside-manifest.json"
        outside.write_text(manifest.read_text())
        manifest.unlink()
        manifest.symlink_to(outside)
        with self.assertRaisesRegex(RuntimeError, "symlink"):
            require_manifest_worker_entry(self.root)

    def test_symlink_runtime_root_is_rejected(self):
        shortcut = self.root.parent / "runtime-link"
        shortcut.symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, "root"):
            require_manifest_worker_entry(shortcut)

    def test_preflight_must_precede_chrome_and_cdp_load(self):
        source = (HERE / "browser_verifier.py").read_text()
        preflight = source.find("worker_entry = require_manifest_worker_entry(runtime)")
        cdp = source.find('cdp.send("Extensions.loadUnpacked"')
        launch = source.find("playwright.chromium.launch_persistent_context(")
        self.assertTrue(preflight >= 0 and launch >= 0 and cdp >= 0)
        self.assertLess(preflight, launch)
        self.assertLess(preflight, cdp)
        self.assertIn('"PREFLIGHT_UNPACKED_ROOT"', source)

    def test_real_verifier_rejects_symlink_before_browser_launch(self):
        """Invoke the actual verifier's preflight, not only its helper."""
        import importlib.util
        import sys
        import types
        from unittest.mock import patch

        outside = self.root.parent / "external-worker.js"
        outside.write_text("/* external test data */")
        worker = self.root / "service_worker_entry.js"
        worker.unlink()
        worker.symlink_to(outside)

        fake_playwright = types.ModuleType("playwright")
        fake_playwright.__path__ = []
        fake_sync_api = types.ModuleType("playwright.sync_api")
        calls = []

        def forbidden_browser_start():
            calls.append("called")
            raise AssertionError("Unsafe extension launched before preflight")

        fake_sync_api.sync_playwright = forbidden_browser_start
        fake_playwright.sync_api = fake_sync_api
        path = HERE / "browser_verifier.py"
        spec = importlib.util.spec_from_file_location(
            "octo_i1_preflight_test_verifier", path
        )
        self.assertIsNotNone(spec)
        module = importlib.util.module_from_spec(spec)
        result_dir = self.root.parent / "preflight-result"
        with patch.dict(sys.modules, {
            "playwright": fake_playwright,
            "playwright.sync_api": fake_sync_api,
        }):
            spec.loader.exec_module(module)
            with self.assertRaisesRegex(RuntimeError, "symlink"):
                module.run(self.root, result_dir)
        self.assertEqual(calls, [])
        receipt = json.loads((result_dir / "failure.json").read_text())
        self.assertEqual(receipt["stage"], "PREFLIGHT_UNPACKED_ROOT")
        self.assertEqual(receipt["boundary"], "before_cdp_extension_load")

    def test_actual_cli_rejects_symlink_root_before_browser(self):
        """Exercise __main__ argv as invoked in CI; .resolve() must not bypass preflight."""
        import runpy
        import sys
        import types
        from unittest.mock import patch

        link = self.root.parent / "runtime-link"
        link.symlink_to(self.root, target_is_directory=True)
        output = self.root.parent / "cli-symlink-receipt"
        verifier = HERE / "browser_verifier.py"
        calls = []
        fake_pkg = types.ModuleType("playwright")
        fake_pkg.__path__ = []
        fake_sync = types.ModuleType("playwright.sync_api")

        def must_never_start_browser():
            calls.append("started")
            raise AssertionError("Playwright started before symlink root preflight")

        fake_sync.sync_playwright = must_never_start_browser
        fake_pkg.sync_api = fake_sync
        with patch.dict(sys.modules, {
            "playwright": fake_pkg, "playwright.sync_api": fake_sync,
        }), patch.object(sys, "argv", [
            str(verifier), "--runtime", str(link), "--output", str(output),
        ]):
            with self.assertRaisesRegex(RuntimeError, "root"):
                runpy.run_path(str(verifier), run_name="__main__")
        self.assertEqual(calls, [])
        receipt = json.loads((output / "failure.json").read_text())
        self.assertEqual(receipt["stage"], "PREFLIGHT_UNPACKED_ROOT")
        self.assertEqual(receipt["boundary"], "before_cdp_extension_load")

    def test_exact_worker_selected_among_unrelated_workers(self):
        expected = Worker(self.expected)
        others = [Worker(f"chrome-extension://{'b'*32}/service_worker_entry.js"),
                  Worker(f"chrome-extension://{self.extension_id}/other.js")]
        self.assertIs(select_owned_worker([*others, expected], self.extension_id,
                                           "service_worker_entry.js"), expected)

    def test_wrong_id_or_path_is_never_accepted(self):
        workers = [Worker(self.expected)]
        self.assertIsNone(select_owned_worker(workers, "b"*32,
                                              "service_worker_entry.js"))
        self.assertIsNone(select_owned_worker(workers, self.extension_id,
                                              "different_worker.js"))
        self.assertIsNone(select_owned_worker([], self.extension_id,
                                              "service_worker_entry.js"))

    def test_duplicate_worker_identity_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, "Ambiguous"):
            select_owned_worker([Worker(self.expected), Worker(self.expected)],
                                self.extension_id, "service_worker_entry.js")

    def test_verifier_uses_verified_cdp_loading_not_cli_load_flags(self):
        source = (HERE / "browser_verifier.py").read_text()
        self.assertIn('Extensions.loadUnpacked', source)
        self.assertIn('require_loaded_extension_id(', source)
        self.assertIn('select_owned_worker(', source)
        self.assertIn('"--enable-unsafe-extension-debugging"', source)
        self.assertNotIn('--load-extension=', source)


if __name__ == "__main__":
    unittest.main()
