"""Source-level helper guard regression. No browser, login or provider request."""
import contextlib
import importlib.util
import io
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

fake_api = types.ModuleType("playwright.sync_api")
fake_api.sync_playwright = mock.Mock(side_effect=AssertionError("BROWSER_MUST_NOT_START"))
helper_path = Path(__file__).with_name("exact-store-authenticated-controls.py")
spec = importlib.util.spec_from_file_location("owner_helper", helper_path)
helper = importlib.util.module_from_spec(spec)
with mock.patch.dict(sys.modules, {
    "playwright": types.ModuleType("playwright"), "playwright.sync_api": fake_api,
}):
    spec.loader.exec_module(helper)


class HelperGuardTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="octoport-helper-guard-")
        self.root = Path(self.tmp.name)
        self.proc = self.root / "proc"
        self.proc.mkdir()
        self.profile = self.root / "profile [1].test"
        self.profile.mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def process(self, argv, pid="123"):
        directory = self.proc / pid
        directory.mkdir()
        directory.joinpath("cmdline").write_bytes(b"\0".join(arg.encode() for arg in argv) + b"\0")
        directory.joinpath("cwd").symlink_to(self.root, target_is_directory=True)
        return directory

    def test_equal_argument_detects_busy_profile_with_spaces_and_regex_characters(self):
        self.process(["opera", "--user-data-dir=" + str(self.profile)])
        self.assertTrue(helper.profile_in_use(self.profile, self.proc))

    def test_split_argument_detects_busy_profile(self):
        self.process(["opera", "--user-data-dir", str(self.profile)])
        self.assertTrue(helper.profile_in_use(self.profile, self.proc))

    def test_relative_argument_is_resolved_in_process_working_directory(self):
        self.process(["opera", "--user-data-dir=" + self.profile.name])
        self.assertTrue(helper.profile_in_use(self.profile, self.proc))

    def test_symlink_alias_detects_same_profile(self):
        alias = self.root / "alias"
        alias.symlink_to(self.profile, target_is_directory=True)
        self.process(["opera", "--user-data-dir=" + str(alias)])
        self.assertTrue(helper.profile_in_use(self.profile, self.proc))

    def test_prefix_and_embedded_text_do_not_match_a_different_profile(self):
        self.process(["opera", "--user-data-dir=" + str(self.profile) + "-other"])
        self.process(["python", "print('--user-data-dir=" + str(self.profile) + "')"], "124")
        self.assertFalse(helper.profile_in_use(self.profile, self.proc))

    def test_disappeared_process_does_not_block_scan(self):
        self.proc.joinpath("122").mkdir()
        self.process(["opera", "--user-data-dir=" + str(self.profile)])
        self.assertTrue(helper.profile_in_use(self.profile, self.proc))

    def test_missing_process_table_fails_closed(self):
        with self.assertRaisesRegex(AssertionError, "^PROFILE_USAGE_INSPECTION_FAILED$"):
            helper.profile_in_use(self.profile, self.root / "missing")

    def test_unreadable_process_fails_closed_without_error_detail(self):
        self.process(["opera"])
        with mock.patch.object(Path, "read_bytes", side_effect=PermissionError("PRIVATE_DETAIL")):
            with self.assertRaisesRegex(AssertionError, "^PROFILE_USAGE_INSPECTION_FAILED$"):
                helper.profile_in_use(self.profile, self.proc)

    def test_empty_process_table_is_unused(self):
        self.assertFalse(helper.profile_in_use(self.profile, self.proc))

    def test_busy_profile_stops_before_runtime_or_profile_mutation(self):
        args = types.SimpleNamespace(carrier=self.root / "carrier",
            expected_sha256="expected", browser_executable=Path("/unused/opera"),
            expected_browser_product="Opera", profile_dir=self.profile,
            runtime_dir=self.root / "runtime")
        with mock.patch.object(helper, "sha256", return_value="expected"), \
             mock.patch.object(helper, "browser_product", return_value="Opera 136"), \
             mock.patch.object(helper, "profile_in_use", return_value=True), \
             mock.patch.object(helper, "ensure_exact_runtime") as extract:
            with self.assertRaisesRegex(AssertionError, "^DEDICATED_PROFILE_ALREADY_IN_USE$"):
                helper.prepare(args)
            extract.assert_not_called()
            self.assertFalse(args.runtime_dir.exists())

    def test_known_failure_code_is_preserved_but_arbitrary_text_is_not(self):
        self.assertEqual(helper.safe_failure_code(AssertionError("PROFILE_USAGE_INSPECTION_FAILED")),
                         "PROFILE_USAGE_INSPECTION_FAILED")
        for failure in [RuntimeError("OTP=PRIVATE_VALUE"), AssertionError("TOKEN=PRIVATE_VALUE")]:
            self.assertEqual(helper.safe_failure_code(failure), "OWNER_CONTROL_HELPER_FAILED")

    def test_main_persists_safe_failure_and_returns_nonzero_without_traceback(self):
        output = self.root / "receipt.json"
        argv = ["helper", "--mode", "prepare", "--carrier", str(self.root / "zip"),
            "--runtime-dir", str(self.root / "runtime"), "--profile-dir", str(self.profile),
            "--browser-executable", "/unused/opera", "--output", str(output)]
        stdout, stderr = io.StringIO(), io.StringIO()
        with mock.patch.object(sys, "argv", argv), \
             mock.patch.object(helper, "prepare", side_effect=RuntimeError("https://private.test/?otp=SECRET")), \
             contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = helper.main()
        self.assertEqual(code, 1)
        receipt = json.loads(output.read_text())
        self.assertEqual(receipt["status"], "FAILED")
        self.assertEqual(receipt["evidenceLevel"], "NOT_ACCEPTED")
        self.assertEqual(receipt["failureCode"], "OWNER_CONTROL_HELPER_FAILED")
        for private in ["private.test", "SECRET", "Traceback", str(self.profile)]:
            self.assertNotIn(private, stdout.getvalue() + stderr.getvalue() + output.read_text())
        fake_api.sync_playwright.assert_not_called()


if __name__ == "__main__":
    unittest.main()
