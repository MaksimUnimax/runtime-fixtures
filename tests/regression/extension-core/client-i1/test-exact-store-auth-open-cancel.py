"""Small isolated tests; never start a browser or contact an API."""
import argparse
import importlib.util
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import Mock, patch
import warnings
import zipfile

spec = importlib.util.spec_from_file_location("auth_cancel", Path(__file__).with_name("exact-store-auth-open-cancel.py"))
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


class ProofTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "test.zip"

    def tearDown(self):
        self.tmp.cleanup()

    def archive(self, entries):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            with zipfile.ZipFile(self.path, "w") as z:
                for name, content in entries:
                    z.writestr(name, content)
        return check.sha(self.path.read_bytes())

    def test_exact_bytes_are_extracted(self):
        digest = self.archive([("manifest.json", b"{}"), ("sub/source.js", b"exact")])
        self.assertEqual(check.archive_files(self.path, digest),
                         {"manifest.json": b"{}", "sub/source.js": b"exact"})

    def test_wrong_hash_rejects_before_browser(self):
        self.archive([("manifest.json", b"{}")])
        with patch.object(check.subprocess, "check_output") as launch:
            with self.assertRaisesRegex(AssertionError, "PACKAGE_HASH_MISMATCH"):
                check.run(argparse.Namespace(carrier=self.path, browser=Path("/not-used")))
            launch.assert_not_called()

    def test_no_traversal_or_absolute_or_backslash(self):
        for name in ("../outside", "/outside", "a/../../outside", "a\\outside"):
            with self.subTest(name=name):
                digest = self.archive([(name, b"x")])
                with self.assertRaisesRegex(AssertionError, "UNSAFE_ARCHIVE_PATH"):
                    check.archive_files(self.path, digest)

    def test_duplicate_member_rejected(self):
        digest = self.archive([("file", b"one"), ("file", b"two")])
        with self.assertRaisesRegex(AssertionError, "DUPLICATE_ARCHIVE_ENTRY"):
            check.archive_files(self.path, digest)

    def test_symlink_member_rejected(self):
        info = zipfile.ZipInfo("link")
        info.create_system = 3
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        digest = self.archive([(info, b"/outside")])
        with self.assertRaisesRegex(AssertionError, "ARCHIVE_SYMLINK"):
            check.archive_files(self.path, digest)

    def test_verified_bytes_not_second_path_read(self):
        digest = self.archive([("file", b"original")])
        original = self.path.read_bytes()
        real = check.zipfile.ZipFile
        def change_then_open(stream):
            self.path.write_bytes(b"changed-after-read")
            return real(stream)
        with patch.object(check.zipfile, "ZipFile", side_effect=change_then_open):
            self.assertEqual(check.archive_files(self.path, digest), {"file": b"original"})
        self.assertNotEqual(self.path.read_bytes(), original)

    def test_portal_observation_uses_new_tab_ids(self):
        worker = Mock()
        worker.evaluate.return_value = [10, 11, 11]
        self.assertEqual(check.new_portal_ids(worker, [10]), [11])
        worker.evaluate.assert_called_once_with(check.PORTAL_TABS)
        self.assertNotIn("context.pages", check.PORTAL_TABS)

    def test_existing_portal_not_a_new_open(self):
        worker = Mock()
        worker.evaluate.return_value = [10]
        self.assertEqual(check.new_portal_ids(worker, [10]), [])

    def test_untrusted_exception_text_not_logged(self):
        self.assertEqual(check.safe_error(RuntimeError("secret=private")), "RuntimeError")
        self.assertEqual(check.safe_error(AssertionError("token=private")), "AssertionError")
        self.assertEqual(check.safe_error(AssertionError("SAFE_FAILURE")), "SAFE_FAILURE")

    def test_browser_build_token_is_exact(self):
        for good in ("136.0.6008.22", "Opera 136.0.6008.22"):
            self.assertTrue(check.exact_browser_product(good))
        for bad in ("Opera 136.0.6008.220", "Chrome 136.0.6008.22", "x136.0.6008.22", "136.0.6008.22.1", "Opera 136.0.6008.22 extra"):
            with self.subTest(value=bad):
                self.assertFalse(check.exact_browser_product(bad))

    def test_no_auth_injection_or_direct_start_call(self):
        text = Path(check.__file__).read_text()
        self.assertNotIn("startActivation()", text)
        self.assertNotIn("chrome.storage", text)
        self.assertIn('locator("#auth-start").click()', text)
        self.assertIn('locator("#auth-open").click()', text)
        self.assertIn('locator("#auth-cancel").click()', text)


if __name__ == "__main__":
    unittest.main()
