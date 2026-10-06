"""Source-level helper guard regression. No browser, login or provider request."""
import contextlib
import importlib.util
import io
import json
import sys
import tempfile
import types
import unittest
import warnings
import zipfile
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
        self.carrier = self.root / "carrier"
        with zipfile.ZipFile(self.carrier, "w") as archive:
            archive.writestr("manifest.json", json.dumps({"version": "0.2.11"}))
            archive.writestr("payload.txt", "fixture")

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
            expected_sha256="expected", expected_version="0.2.11", browser_executable=Path("/unused/opera"),
            expected_browser_product="136.0.6008.22", profile_dir=self.profile,
            runtime_dir=self.root / "runtime")
        with mock.patch.object(helper, "sha256", return_value="expected"), \
             mock.patch.object(helper, "browser_product", return_value="136.0.6008.22"), \
             mock.patch.object(helper, "profile_in_use", return_value=True), \
             mock.patch.object(helper, "ensure_exact_runtime") as extract:
            with self.assertRaisesRegex(AssertionError, "^DEDICATED_PROFILE_ALREADY_IN_USE$"):
                helper.prepare(args)
            extract.assert_not_called()
            self.assertFalse(args.runtime_dir.exists())

    def test_prepare_rejects_wrong_manifest_version_before_browser_or_mutation(self):
        runtime = self.root / "version-runtime"
        profile = self.root / "version-profile"
        args = types.SimpleNamespace(
            carrier=self.carrier,
            expected_sha256="expected",
            expected_version="0.2.13",
            browser_executable=Path("/unused/chrome"),
            expected_browser_product="Google Chrome 147.0.7727.116",
            profile_dir=profile,
            runtime_dir=runtime,
        )
        with (
            mock.patch.object(helper, "sha256", return_value="expected"),
            mock.patch.object(helper, "browser_product") as browser,
            mock.patch.object(helper, "ensure_exact_runtime") as extract,
        ):
            with self.assertRaisesRegex(AssertionError, "^EXTENSION_VERSION_MISMATCH$"):
                helper.prepare(args)
            browser.assert_not_called()
            extract.assert_not_called()
        self.assertFalse(runtime.exists())
        self.assertFalse(profile.exists())

    def test_prepare_reports_exact_manifest_version_on_success(self):
        runtime = self.root / "exact-runtime"
        profile = self.root / "exact-profile"
        args = types.SimpleNamespace(
            carrier=self.carrier,
            expected_sha256="expected",
            expected_version="0.2.11",
            browser_executable=Path("/unused/chrome"),
            expected_browser_product="Google Chrome 147.0.7727.116",
            profile_dir=profile,
            runtime_dir=runtime,
        )
        with (
            mock.patch.object(helper, "sha256", return_value="expected"),
            mock.patch.object(
                helper,
                "browser_product",
                return_value="Google Chrome 147.0.7727.116",
            ),
            mock.patch.object(helper, "profile_in_use", return_value=False),
            mock.patch.object(
                helper,
                "ensure_exact_runtime",
                return_value={"created": False, "fileCount": 2},
            ),
        ):
            result = helper.prepare(args)
        self.assertEqual(result["status"], "PREPARED")
        self.assertEqual(result["manifestVersion"], "0.2.11")
        self.assertEqual(result["browserProduct"], "Google Chrome 147.0.7727.116")
        self.assertTrue(profile.is_dir())
        self.assertEqual(profile.stat().st_mode & 0o077, 0)

    def test_carrier_manifest_version_rejects_missing_malformed_and_duplicate(self):
        missing = self.root / "missing-manifest.zip"
        malformed = self.root / "malformed-manifest.zip"
        no_version = self.root / "missing-version.zip"
        duplicate = self.root / "duplicate-manifest.zip"
        with zipfile.ZipFile(missing, "w") as archive:
            archive.writestr("payload.txt", "fixture")
        with zipfile.ZipFile(malformed, "w") as archive:
            archive.writestr("manifest.json", "{not-json")
        with zipfile.ZipFile(no_version, "w") as archive:
            archive.writestr("manifest.json", "{}")
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            with zipfile.ZipFile(duplicate, "w") as archive:
                archive.writestr("manifest.json", json.dumps({"version": "0.2.11"}))
                archive.writestr("manifest.json", json.dumps({"version": "0.2.12"}))
        for path in (missing, malformed, no_version, duplicate):
            with self.subTest(path=path.name):
                with self.assertRaisesRegex(AssertionError, "^PACKAGE_MANIFEST_INVALID$"):
                    helper.carrier_manifest_version(path)

    def test_exact_google_chrome_product_is_supported_without_broadening_identity(self):
        expected = "Google Chrome 147.0.7727.116"
        helper.require_exact_browser_product(expected, expected)
        for observed in (
            "Chromium 147.0.7727.116",
            "FakeBrowser 147.0.7727.116",
            "Google Chrome 147.0.7727.116 extra",
            "Google Chrome 147.0.7727.1160",
        ):
            with self.subTest(observed=observed):
                with self.assertRaisesRegex(
                    AssertionError, "^BROWSER_PRODUCT_VERSION_MISMATCH$"
                ):
                    helper.require_exact_browser_product(observed, expected)

    def test_prepare_rejects_browser_version_substring_and_wrong_product(self):
        self.profile.chmod(0o700)
        args = types.SimpleNamespace(
            carrier=self.root / "carrier",
            expected_sha256="expected", expected_version="0.2.11",
            browser_executable=Path("/unused/opera"),
            expected_browser_product="136.0.6008.22",
            profile_dir=self.profile,
            runtime_dir=self.root / "runtime",
        )
        for observed in [
            "Opera 136.0.6008.220",
            "FakeBrowser 136.0.6008.22",
            "Opera 136.0.6008.22 extra",
        ]:
            with self.subTest(observed=observed):
                with (
                    mock.patch.object(helper, "sha256", return_value="expected"),
                    mock.patch.object(helper, "browser_product", return_value=observed),
                    mock.patch.object(helper, "profile_in_use", return_value=False),
                    mock.patch.object(
                        helper,
                        "ensure_exact_runtime",
                        return_value={"created": False, "fileCount": 1},
                    ),
                ):
                    with self.assertRaisesRegex(
                        AssertionError, "^BROWSER_PRODUCT_VERSION_MISMATCH$"
                    ):
                        helper.prepare(args)

    def test_prepare_rejects_runtime_and_profile_root_symlinks_before_use(self):
        self.profile.chmod(0o700)
        real_runtime = self.root / "real-runtime"
        real_runtime.mkdir()
        runtime_link = self.root / "runtime-link"
        runtime_link.symlink_to(real_runtime, target_is_directory=True)
        real_profile = self.root / "real-profile"
        real_profile.mkdir()
        real_profile.chmod(0o700)
        profile_link = self.root / "profile-link"
        profile_link.symlink_to(real_profile, target_is_directory=True)

        base = dict(
            carrier=self.root / "carrier",
            expected_sha256="expected", expected_version="0.2.11",
            browser_executable=Path("/unused/opera"),
            expected_browser_product="136.0.6008.22",
        )
        with (
            mock.patch.object(helper, "sha256", return_value="expected"),
            mock.patch.object(
                helper, "browser_product", return_value="136.0.6008.22"
            ),
            mock.patch.object(helper, "profile_in_use", return_value=False),
            mock.patch.object(
                helper,
                "ensure_exact_runtime",
                return_value={"created": False, "fileCount": 1},
            ) as extract,
        ):
            with self.assertRaisesRegex(
                AssertionError, "^RUNTIME_ROOT_SYMLINK_REJECTED$"
            ):
                helper.prepare(
                    types.SimpleNamespace(
                        **base, profile_dir=self.profile, runtime_dir=runtime_link
                    )
                )
            extract.assert_not_called()

        with (
            mock.patch.object(helper, "sha256", return_value="expected"),
            mock.patch.object(
                helper, "browser_product", return_value="136.0.6008.22"
            ),
            mock.patch.object(helper, "profile_in_use", return_value=False),
            mock.patch.object(
                helper,
                "ensure_exact_runtime",
                return_value={"created": False, "fileCount": 1},
            ) as extract,
        ):
            with self.assertRaisesRegex(
                AssertionError, "^PROFILE_ROOT_SYMLINK_REJECTED$"
            ):
                helper.prepare(
                    types.SimpleNamespace(
                        **base,
                        profile_dir=profile_link,
                        runtime_dir=self.root / "runtime-clean",
                    )
                )
            extract.assert_not_called()

    def test_prepare_rejects_symlink_in_existing_parent_component(self):
        self.profile.chmod(0o700)
        real_parent = self.root / "real-parent"
        real_parent.mkdir()
        parent_link = self.root / "parent-link"
        parent_link.symlink_to(real_parent, target_is_directory=True)
        args = types.SimpleNamespace(
            carrier=self.root / "carrier",
            expected_sha256="expected", expected_version="0.2.11",
            browser_executable=Path("/unused/opera"),
            expected_browser_product="136.0.6008.22",
            profile_dir=self.profile,
            runtime_dir=parent_link / "runtime",
        )
        with (
            mock.patch.object(helper, "sha256", return_value="expected"),
            mock.patch.object(
                helper, "browser_product", return_value="136.0.6008.22"
            ),
            mock.patch.object(helper, "profile_in_use", return_value=False),
            mock.patch.object(helper, "ensure_exact_runtime") as extract,
        ):
            with self.assertRaisesRegex(
                AssertionError, "^RUNTIME_ROOT_SYMLINK_REJECTED$"
            ):
                helper.prepare(args)
            extract.assert_not_called()

    def test_prepare_rejects_externally_writable_existing_parent(self):
        self.profile.chmod(0o700)
        unsafe_parent = self.root / "unsafe-parent"
        unsafe_parent.mkdir()
        unsafe_parent.chmod(0o777)
        args = types.SimpleNamespace(
            carrier=self.root / "carrier",
            expected_sha256="expected", expected_version="0.2.11",
            browser_executable=Path("/unused/opera"),
            expected_browser_product="136.0.6008.22",
            profile_dir=self.profile,
            runtime_dir=unsafe_parent / "runtime",
        )
        with (
            mock.patch.object(helper, "sha256", return_value="expected"),
            mock.patch.object(
                helper, "browser_product", return_value="136.0.6008.22"
            ),
            mock.patch.object(helper, "profile_in_use", return_value=False),
            mock.patch.object(helper, "ensure_exact_runtime") as extract,
        ):
            with self.assertRaisesRegex(
                AssertionError, "^RUNTIME_ROOT_PERMISSIONS_UNSAFE$"
            ):
                helper.prepare(args)
            extract.assert_not_called()

    def test_main_preserves_runtime_and_profile_paths_for_nofollow_validation(self):
        runtime_target = self.root / "runtime-target"
        runtime_target.mkdir()
        runtime_link = self.root / "runtime-link-main"
        runtime_link.symlink_to(runtime_target, target_is_directory=True)
        profile_target = self.root / "profile-target"
        profile_target.mkdir()
        profile_link = self.root / "profile-link-main"
        profile_link.symlink_to(profile_target, target_is_directory=True)
        output = self.root / "main-result.json"
        captured = {}

        def fake_prepare(args):
            captured["runtime_dir"] = args.runtime_dir
            captured["profile_dir"] = args.profile_dir
            return {
                "status": "PREPARED",
                "carrier": "carrier.zip",
                "packageSha256": "expected",
                "browserProduct": "136.0.6008.22",
                "runtimeFileCount": 1,
                "runtimeCreated": False,
                "profileInUse": False,
                "manifestKeyPresent": False,
                "stablePathRequired": True,
            }

        argv = [
            "helper",
            "--mode",
            "prepare",
            "--carrier",
            str(self.root / "carrier.zip"),
            "--runtime-dir",
            str(runtime_link),
            "--profile-dir",
            str(profile_link),
            "--browser-executable",
            "/unused/opera",
            "--expected-browser-product",
            "136.0.6008.22",
            "--expected-version",
            "0.2.11",
            "--expected-sha256",
            "expected",
            "--output",
            str(output),
        ]
        with (
            mock.patch.object(sys, "argv", argv),
            mock.patch.object(helper, "prepare", side_effect=fake_prepare),
            contextlib.redirect_stdout(io.StringIO()),
            contextlib.redirect_stderr(io.StringIO()),
        ):
            self.assertEqual(helper.main(), 0)
        self.assertEqual(captured["runtime_dir"], runtime_link.absolute())
        self.assertEqual(captured["profile_dir"], profile_link.absolute())
        self.assertTrue(captured["runtime_dir"].is_symlink())
        self.assertTrue(captured["profile_dir"].is_symlink())

    def test_known_failure_code_is_preserved_but_arbitrary_text_is_not(self):
        self.assertEqual(helper.safe_failure_code(AssertionError("PROFILE_USAGE_INSPECTION_FAILED")),
                         "PROFILE_USAGE_INSPECTION_FAILED")
        self.assertEqual(helper.safe_failure_code(AssertionError("RUNTIME_ROOT_SYMLINK_REJECTED")),
                         "RUNTIME_ROOT_SYMLINK_REJECTED")
        self.assertEqual(helper.safe_failure_code(AssertionError("PROFILE_ROOT_SYMLINK_REJECTED")),
                         "PROFILE_ROOT_SYMLINK_REJECTED")
        self.assertEqual(helper.safe_failure_code(AssertionError("RUNTIME_ROOT_PERMISSIONS_UNSAFE")),
                         "RUNTIME_ROOT_PERMISSIONS_UNSAFE")
        self.assertEqual(helper.safe_failure_code(AssertionError("PROFILE_ROOT_PERMISSIONS_UNSAFE")),
                         "PROFILE_ROOT_PERMISSIONS_UNSAFE")
        self.assertEqual(helper.safe_failure_code(AssertionError("PACKAGE_MANIFEST_INVALID")),
                         "PACKAGE_MANIFEST_INVALID")
        self.assertEqual(helper.safe_failure_code(AssertionError("EXTENSION_VERSION_MISMATCH")),
                         "EXTENSION_VERSION_MISMATCH")
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

    def test_technical_session_requires_owner_authority_unexpired_non_admin_and_0600(self):
        receipt = self.root / "technical-session.json"
        value = {
            "authority": "OWNER-AUTONOMOUS-OCTOPORT-TEST-AUTH-20260928-1244",
            "apiOrigin": "https://api.octoport.ru",
            "accountId": "account-private",
            "expiresAt": "2099-01-01T00:00:00Z",
            "adminSessionIssued": False,
            "cookies": {"pcp_portal_session": "PRIVATE_SESSION", "pcp_csrf": "PRIVATE_CSRF"},
        }
        receipt.write_text(json.dumps(value))
        receipt.chmod(0o600)
        loaded = helper.load_technical_session(receipt)
        self.assertEqual(loaded["authority"], value["authority"])
        receipt.chmod(0o644)
        with self.assertRaisesRegex(AssertionError, "^TECHNICAL_SESSION_PERMISSIONS_UNSAFE$"):
            helper.load_technical_session(receipt)
        receipt.chmod(0o600)
        value["adminSessionIssued"] = True
        receipt.write_text(json.dumps(value))
        with self.assertRaisesRegex(AssertionError, "^TECHNICAL_SESSION_RECEIPT_INVALID$"):
            helper.load_technical_session(receipt)

    def test_technical_approval_verifies_active_membership_and_normal_approve_contract(self):
        session = {"accountId": "private-account"}
        pending = {"authorizationId": "123e4567-e89b-42d3-a456-426614174001", "userCode": "ABCD-EFGH"}
        calls = [
            {"accounts": [{"id": "private-account", "status": "ACTIVE"}]},
            {"status": "approved", "authorizationId": pending["authorizationId"], "expiresAt": "2099-01-01T00:00:00Z"},
        ]
        with mock.patch.object(helper, "technical_api", side_effect=calls) as api:
            result = helper.approve_technical_activation(session, pending)
        self.assertTrue(result["technicalSessionAuthorityVerified"])
        self.assertTrue(result["accountMembershipVerified"])
        self.assertTrue(result["deviceApprovalSubmitted"])
        self.assertFalse(result["authStateInjected"])
        self.assertFalse(result["manualEmailLoginTested"])
        self.assertEqual(api.call_count, 2)

    def test_technical_approval_rejects_wrong_account_before_approve(self):
        session = {"accountId": "expected-private-account"}
        pending = {"authorizationId": "123e4567-e89b-42d3-a456-426614174001", "userCode": "ABCD-EFGH"}
        with mock.patch.object(
            helper, "technical_api",
            return_value={"accounts": [{"id": "other-private-account", "status": "ACTIVE"}]},
        ) as api:
            with self.assertRaisesRegex(AssertionError, "^TECHNICAL_AUTH_ACCOUNT_MEMBERSHIP_MISMATCH$"):
                helper.approve_technical_activation(session, pending)
        api.assert_called_once()


    def valid_technical_receipt(self):
        return {
            "authority": "OWNER-AUTONOMOUS-OCTOPORT-TEST-AUTH-20260928-1244",
            "apiOrigin": "https://api.octoport.ru", "accountId": "synthetic-account",
            "expiresAt": "2099-01-01T00:00:00Z", "adminSessionIssued": False,
            "cookies": {"pcp_portal_session": "SYNTHETIC_SESSION", "pcp_csrf": "SYNTHETIC_CSRF"},
        }

    def write_technical_receipt(self, value):
        path = self.root / "technical.json"
        path.write_text(json.dumps(value))
        path.chmod(0o600)
        return path

    def test_technical_session_rejects_untrusted_origins_before_transport(self):
        for origin in ["http://api.octoport.ru", "https://untrusted.invalid",
                       "https://api.octoport.ru.evil.invalid", "https://api.octoport.ru/",
                       "https://api.octoport.ru?next=elsewhere", "https://user@api.octoport.ru",
                       "https://api.octoport.ru#fragment", "http://127.0.0.1:4100"]:
            with self.subTest(origin=origin):
                value = self.valid_technical_receipt()
                value["apiOrigin"] = origin
                with self.assertRaisesRegex(AssertionError, "^TECHNICAL_SESSION_RECEIPT_INVALID$"):
                    helper.load_technical_session(self.write_technical_receipt(value))
                with mock.patch.object(helper, "build_opener") as opener:
                    with self.assertRaisesRegex(AssertionError, "^TECHNICAL_AUTH_ORIGIN_REJECTED$"):
                        helper.technical_api(value, "GET", "/v1/accounts")
                    opener.assert_not_called()

    def test_technical_session_rejects_symlink_file_and_parent(self):
        path = self.write_technical_receipt(self.valid_technical_receipt())
        link = self.root / "linked.json"
        link.symlink_to(path)
        with self.assertRaisesRegex(AssertionError, "^TECHNICAL_SESSION_PERMISSIONS_UNSAFE$"):
            helper.load_technical_session(link)
        directory_link = self.root / "linked-directory"
        directory_link.symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(AssertionError, "^TECHNICAL_SESSION_PERMISSIONS_UNSAFE$"):
            helper.load_technical_session(directory_link / path.name)

    def test_technical_session_rejects_exposed_parent_and_wrong_owner(self):
        path = self.write_technical_receipt(self.valid_technical_receipt())
        self.root.chmod(0o755)
        with self.assertRaisesRegex(AssertionError, "^TECHNICAL_SESSION_PERMISSIONS_UNSAFE$"):
            helper.load_technical_session(path)
        self.root.chmod(0o700)
        with mock.patch.object(helper.os, "geteuid", return_value=path.stat().st_uid + 1):
            with self.assertRaisesRegex(AssertionError, "^TECHNICAL_SESSION_PERMISSIONS_UNSAFE$"):
                helper.load_technical_session(path)

    def test_technical_session_rejects_malformed_large_and_expired_receipts(self):
        for value in [[], None, "text", {}, {**self.valid_technical_receipt(), "expiresAt": "2000-01-01T00:00:00Z"},
                      {**self.valid_technical_receipt(), "cookies": {"pcp_portal_session": "line\r\ninjection", "pcp_csrf": "test"}}]:
            with self.subTest(kind=type(value).__name__):
                with self.assertRaisesRegex(AssertionError, "^TECHNICAL_SESSION_RECEIPT_INVALID$"):
                    helper.load_technical_session(self.write_technical_receipt(value))
        path = self.write_technical_receipt(self.valid_technical_receipt())
        path.write_bytes(b" " * (helper.TECHNICAL_SESSION_MAX_BYTES + 1))
        with self.assertRaisesRegex(AssertionError, "^TECHNICAL_SESSION_RECEIPT_INVALID$"):
            helper.load_technical_session(path)

    def test_technical_transport_rejects_every_redirect_before_forwarding_cookie(self):
        request = helper.Request("https://api.octoport.ru/v1/accounts", headers={"Cookie": "SYNTHETIC_SESSION"})
        for code in [301, 302, 303, 307, 308]:
            with self.subTest(code=code):
                with self.assertRaisesRegex(AssertionError, "^TECHNICAL_AUTH_REDIRECT_REJECTED$"):
                    helper.RejectTechnicalRedirects().redirect_request(
                        request, None, code, "redirect", {}, "https://untrusted.invalid/collect")

    def test_technical_transport_uses_exact_origin_no_redirect_handler_and_bounded_read(self):
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.status = 200
        response.read.return_value = b'{"accounts":[]}'
        opener = mock.Mock()
        opener.open.return_value = response
        with mock.patch.object(helper, "build_opener", return_value=opener) as factory:
            result = helper.technical_api(self.valid_technical_receipt(), "GET", "/v1/accounts")
        self.assertEqual(result, {"accounts": []})
        self.assertIsInstance(factory.call_args.args[0], helper.RejectTechnicalRedirects)
        self.assertEqual(opener.open.call_args.args[0].full_url, "https://api.octoport.ru/v1/accounts")
        response.read.assert_called_once_with(helper.TECHNICAL_RESPONSE_MAX_BYTES + 1)
        response.read.return_value = b"x" * (helper.TECHNICAL_RESPONSE_MAX_BYTES + 1)
        with mock.patch.object(helper, "build_opener", return_value=opener):
            with self.assertRaisesRegex(AssertionError, "^TECHNICAL_AUTH_API_INVALID_RESPONSE$"):
                helper.technical_api(self.valid_technical_receipt(), "GET", "/v1/accounts")

    def test_technical_transport_rejects_unassigned_endpoint_before_network(self):
        with mock.patch.object(helper, "build_opener") as opener:
            with self.assertRaisesRegex(AssertionError, "^TECHNICAL_AUTH_API_REJECTED$"):
                helper.technical_api(self.valid_technical_receipt(), "POST", "/v1/admin/session", {})
            opener.assert_not_called()


if __name__ == "__main__":
    unittest.main()
