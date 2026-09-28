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

    def test_technical_session_requires_owner_authority_unexpired_non_admin_and_0600(self):
        receipt = self.root / "technical-session.json"
        value = {
            "authority": "OWNER-AUTONOMOUS-OCTOPORT-TEST-AUTH-20260928-1244",
            "apiOrigin": helper.TECHNICAL_API_ORIGIN,
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

    def test_technical_session_rejects_wrong_plaintext_origin_symlink_and_malformed_json(self):
        receipt = self.root / "technical-session-negative.json"
        base = {
            "authority": "OWNER-AUTONOMOUS-OCTOPORT-TEST-AUTH-20260928-1244",
            "apiOrigin": helper.TECHNICAL_API_ORIGIN,
            "accountId": "synthetic-account",
            "expiresAt": "2099-01-01T00:00:00Z",
            "adminSessionIssued": False,
            "cookies": {"pcp_portal_session": "SYNTHETIC_SESSION", "pcp_csrf": "SYNTHETIC_CSRF"},
        }
        for origin in [
            "https://untrusted.invalid", "http://api.octoport.ru", "https://api.octoport.ru/path",
            "https://api.octoport.ru?query=1", "https://user@api.octoport.ru",
        ]:
            value = dict(base, apiOrigin=origin)
            receipt.write_text(json.dumps(value))
            receipt.chmod(0o600)
            with self.assertRaisesRegex(AssertionError, "^TECHNICAL_SESSION_RECEIPT_INVALID$"):
                helper.load_technical_session(receipt)
        receipt.write_text("{not-json")
        receipt.chmod(0o600)
        with self.assertRaisesRegex(AssertionError, "^TECHNICAL_SESSION_RECEIPT_INVALID$"):
            helper.load_technical_session(receipt)
        receipt.write_text(json.dumps(base))
        receipt.chmod(0o600)
        link = self.root / "technical-session-link.json"
        link.symlink_to(receipt)
        with self.assertRaisesRegex(AssertionError, "^TECHNICAL_SESSION_PERMISSIONS_UNSAFE$"):
            helper.load_technical_session(link)

    def test_technical_session_rejects_unprotected_parent(self):
        parent = self.root / "unsafe-parent"
        parent.mkdir(mode=0o755)
        parent.chmod(0o755)
        receipt = parent / "session.json"
        receipt.write_text(json.dumps({
            "authority": "OWNER-AUTONOMOUS-OCTOPORT-TEST-AUTH-20260928-1244",
            "apiOrigin": helper.TECHNICAL_API_ORIGIN,
            "accountId": "synthetic-account",
            "expiresAt": "2099-01-01T00:00:00Z",
            "adminSessionIssued": False,
            "cookies": {"pcp_portal_session": "SYNTHETIC_SESSION", "pcp_csrf": "SYNTHETIC_CSRF"},
        }))
        receipt.chmod(0o600)
        with self.assertRaisesRegex(AssertionError, "^TECHNICAL_SESSION_PERMISSIONS_UNSAFE$"):
            helper.load_technical_session(receipt)

    def test_technical_redirect_handler_never_forwards_cookie(self):
        request = helper.Request(
            helper.TECHNICAL_API_ORIGIN + "/v1/accounts",
            headers={"Cookie": "pcp_portal_session=SYNTHETIC_NON_SECRET"},
        )
        redirected = helper.NoTechnicalRedirect().redirect_request(
            request, None, 302, "Found", {}, "https://untrusted.invalid/collect"
        )
        self.assertIsNone(redirected)

    def test_technical_api_exact_origin_with_injected_no_network_transport(self):
        session = {
            "apiOrigin": helper.TECHNICAL_API_ORIGIN,
            "cookies": {"pcp_portal_session": "SYNTHETIC_SESSION", "pcp_csrf": "SYNTHETIC_CSRF"},
        }

        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *_args): return False
            def read(self, limit):
                self.limit = limit
                return b'{"accounts":[]}'

        class Opener:
            def __init__(self):
                self.request = None
                self.timeout = None
                self.response = Response()
            def open(self, request, timeout):
                self.request = request
                self.timeout = timeout
                return self.response

        opener = Opener()
        value = helper.technical_api(session, "GET", "/v1/accounts", opener=opener)
        self.assertEqual(value, {"accounts": []})
        self.assertEqual(opener.request.full_url, helper.TECHNICAL_API_ORIGIN + "/v1/accounts")
        self.assertIn("SYNTHETIC_SESSION", opener.request.get_header("Cookie"))
        self.assertEqual(opener.timeout, 15)
        self.assertEqual(opener.response.limit, helper.MAX_TECHNICAL_RESPONSE_BYTES + 1)

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


if __name__ == "__main__":
    unittest.main()
