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
        self.root = Path(temp.name)
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
