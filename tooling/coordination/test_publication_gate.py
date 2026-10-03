import io
import json
import unittest
import urllib.error
from pathlib import Path

from publication_gate import (
    EXPECTED_REPOSITORY,
    GateError,
    RetryableGateError,
    evaluate_runs,
    fetch_runs_once,
    run_gate,
)


HEAD = "a" * 40
BRANCH = "controller/task-publication/a/example/0123456789abcdef"
TOKEN = "test-token"
REQUIRED = {
    "Server CI": ".github/workflows/server-ci.yml",
    "Extension CI": ".github/workflows/extension-ci.yml",
    "Extension I1-C1 client": ".github/workflows/extension-i1-ci.yml",
    "Documentation CI": ".github/workflows/documentation.yml",
}


def successful_runs():
    return [
        {
            "name": name,
            "path": path,
            "repository": {"full_name": EXPECTED_REPOSITORY},
            "head_repository": {"full_name": EXPECTED_REPOSITORY},
            "id": index + 10,
            "run_attempt": 1,
            "head_sha": HEAD,
            "head_branch": BRANCH,
            "event": "push",
            "status": "completed",
            "conclusion": "success",
        }
        for index, (name, path) in enumerate(REQUIRED.items())
    ]


class FakeResponse:
    def __init__(self, payload):
        self.payload = json.dumps(payload).encode()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self, limit=-1):
        return self.payload[:limit] if limit >= 0 else self.payload


class FakeClock:
    def __init__(self):
        self.value = 0.0

    def now(self):
        return self.value

    def sleep(self, seconds):
        self.value += seconds


class PublicationGateTests(unittest.TestCase):
    def test_complete_exact_identity_passes(self):
        result = evaluate_runs(successful_runs(), HEAD, BRANCH)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual([row["name"] for row in result["runs"]], list(REQUIRED))

    def test_other_sha_branch_event_and_unlisted_workflow_do_not_fill_gate(self):
        mutations = (
            ("head_sha", "b" * 40),
            ("head_branch", "controller/task-publication/a/other/1234"),
            ("event", "pull_request"),
            ("name", "Coordination and release safety"),
        )
        for field, value in mutations:
            rows = successful_runs()
            rows[0][field] = value
            with self.subTest(field=field):
                result = evaluate_runs(rows, HEAD, BRANCH)
                self.assertEqual(result["status"], "WAITING")
                self.assertEqual(result["runs"][0]["status"], "missing")

    def test_same_name_wrong_workflow_path_fails_closed(self):
        for value in (".github/workflows/spoof.yml", None):
            rows = successful_runs()
            if value is None:
                rows[0].pop("path")
            else:
                rows[0]["path"] = value
            with self.subTest(path=value):
                with self.assertRaisesRegex(GateError, "WRONG_WORKFLOW_PATH_SERVER_CI"):
                    evaluate_runs(rows, HEAD, BRANCH)

    def test_run_repository_identity_mismatch_fails_closed(self):
        for value in ({"full_name": "other/repo"}, None):
            rows = successful_runs()
            if value is None:
                rows[0].pop("repository")
            else:
                rows[0]["repository"] = value
            with self.subTest(repository=value):
                with self.assertRaisesRegex(
                    GateError, "RUN_REPOSITORY_IDENTITY_MISMATCH_SERVER_CI"
                ):
                    evaluate_runs(rows, HEAD, BRANCH)

    def test_head_repository_identity_mismatch_fails_closed(self):
        for value in ({"full_name": "other/repo"}, None):
            rows = successful_runs()
            if value is None:
                rows[0].pop("head_repository")
            else:
                rows[0]["head_repository"] = value
            with self.subTest(head_repository=value):
                with self.assertRaisesRegex(
                    GateError, "HEAD_REPOSITORY_IDENTITY_MISMATCH_SERVER_CI"
                ):
                    evaluate_runs(rows, HEAD, BRANCH)

    def test_missing_failed_and_nonterminal_never_pass(self):
        rows = successful_runs()
        self.assertEqual(evaluate_runs(rows[:-1], HEAD, BRANCH)["status"], "WAITING")

        for status, conclusion in (
            ("completed", "failure"),
            ("completed", "cancelled"),
            ("completed", "skipped"),
            ("completed", "neutral"),
            ("in_progress", None),
            ("queued", None),
        ):
            changed = successful_runs()
            changed[1]["status"] = status
            changed[1]["conclusion"] = conclusion
            with self.subTest(status=status, conclusion=conclusion):
                self.assertEqual(evaluate_runs(changed, HEAD, BRANCH)["status"], "WAITING")

    def test_same_run_id_higher_attempt_is_authoritative(self):
        rows = successful_runs()
        rows[0]["status"] = "completed"
        rows[0]["conclusion"] = "failure"
        rerun = dict(rows[0], run_attempt=2, conclusion="success")
        rows.append(rerun)
        result = evaluate_runs(rows, HEAD, BRANCH)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["runs"][0]["run_attempt"], 2)

    def test_two_distinct_matching_run_ids_fail_ambiguous(self):
        rows = successful_runs()
        rows.append(dict(rows[0], id=999, run_attempt=1))
        with self.assertRaisesRegex(GateError, "AMBIGUOUS_RUNS_SERVER_CI"):
            evaluate_runs(rows, HEAD, BRANCH)

    def test_invalid_run_identity_fails_closed(self):
        for field, value, code in (
            ("id", "12", "RUN_ID_INVALID_SERVER_CI"),
            ("id", True, "RUN_ID_INVALID_SERVER_CI"),
            ("run_attempt", 0, "RUN_ATTEMPT_INVALID_SERVER_CI"),
            ("run_attempt", True, "RUN_ATTEMPT_INVALID_SERVER_CI"),
        ):
            rows = successful_runs()
            rows[0][field] = value
            with self.subTest(field=field):
                with self.assertRaisesRegex(GateError, code):
                    evaluate_runs(rows, HEAD, BRANCH)

    def test_identity_requires_repo_sha_task_branch_and_token(self):
        cases = (
            ("other/repo", HEAD, BRANCH, TOKEN, "REPOSITORY_IDENTITY_MISMATCH"),
            (EXPECTED_REPOSITORY, "x" * 40, BRANCH, TOKEN, "EXACT_SHA_REQUIRED"),
            (EXPECTED_REPOSITORY, HEAD, "main", TOKEN, "TASK_PUBLICATION_BRANCH_REQUIRED"),
            (EXPECTED_REPOSITORY, HEAD, BRANCH, "", "GITHUB_TOKEN_REQUIRED"),
        )
        for repo, head, branch, token, code in cases:
            result = run_gate(
                repo,
                head,
                branch,
                token,
                deadline_seconds=1,
                sleep_fn=lambda _seconds: None,
                fetcher=lambda *args, **kwargs: successful_runs(),
            )
            with self.subTest(code=code):
                self.assertEqual(result["status"], "BLOCKED")
                self.assertEqual(result["reason"], code)

    def test_fetch_paginates_and_fails_after_ten_full_pages(self):
        calls = []

        def opener(request, timeout):
            calls.append((request.full_url, timeout))
            return FakeResponse({"workflow_runs": successful_runs() * 25})

        with self.assertRaisesRegex(GateError, "PAGINATION_LIMIT"):
            fetch_runs_once(HEAD, TOKEN, 7, opener=opener, wall_clock=lambda: 0)
        self.assertEqual(len(calls), 10)
        self.assertIn("page=10", calls[-1][0])

    def test_pagination_caps_each_request_to_remaining_deadline(self):
        clock = FakeClock()
        timeouts = []

        def opener(request, timeout):
            timeouts.append(timeout)
            if len(timeouts) == 1:
                clock.value = 9
                return FakeResponse({"workflow_runs": successful_runs() * 25})
            return FakeResponse({"workflow_runs": []})

        result = fetch_runs_once(
            HEAD,
            TOKEN,
            20,
            opener=opener,
            wall_clock=lambda: 0,
            deadline=10,
            clock=clock.now,
        )
        self.assertEqual(len(result), 100)
        self.assertEqual(timeouts, [10, 1])

    def test_pagination_fails_if_deadline_expires_between_pages(self):
        clock = FakeClock()

        def opener(request, timeout):
            clock.value = 10
            return FakeResponse({"workflow_runs": successful_runs() * 25})

        with self.assertRaisesRegex(GateError, "DEADLINE_INCOMPLETE"):
            fetch_runs_once(
                HEAD,
                TOKEN,
                20,
                opener=opener,
                wall_clock=lambda: 0,
                deadline=10,
                clock=clock.now,
            )

    def test_http_401_and_403_fail_without_leaking_body(self):
        for status in (401, 403):
            def opener(request, timeout, status=status):
                raise urllib.error.HTTPError(
                    request.full_url,
                    status,
                    "secret body should not surface",
                    {},
                    io.BytesIO(b"VERY_SECRET_RESPONSE"),
                )

            with self.subTest(status=status):
                with self.assertRaises(GateError) as caught:
                    fetch_runs_once(HEAD, TOKEN, 10, opener=opener, wall_clock=lambda: 0)
                self.assertEqual(str(caught.exception), "AUTH_OR_PERMISSION")
                self.assertNotIn("SECRET", str(caught.exception))

    def test_http_403_primary_rate_limit_headers_are_retryable_without_leaking_body(self):
        cases = (
            (
                {"X-RateLimit-Remaining": "0", "Retry-After": "30"},
                0,
                30,
            ),
            (
                {"X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "100"},
                40,
                60,
            ),
            ({"X-RateLimit-Remaining": "0"}, 0, 60),
        )
        for headers, wall_now, expected_delay in cases:
            def opener(request, timeout, headers=headers):
                raise urllib.error.HTTPError(
                    request.full_url,
                    403,
                    "secret reason",
                    headers,
                    io.BytesIO(b'{"message":"VERY_SECRET"}'),
                )

            with self.subTest(headers=headers):
                with self.assertRaises(RetryableGateError) as caught:
                    fetch_runs_once(
                        HEAD,
                        TOKEN,
                        10,
                        opener=opener,
                        wall_clock=lambda wall_now=wall_now: wall_now,
                    )
                self.assertEqual(caught.exception.code, "RATE_LIMIT")
                self.assertEqual(caught.exception.delay_seconds, expected_delay)
                self.assertNotIn("SECRET", str(caught.exception))

    def test_http_403_secondary_message_uses_bounded_delay_headers_or_default(self):
        cases = (
            ({}, 60),
            ({"Retry-After": "30"}, 30),
            ({"X-RateLimit-Reset": "100"}, 100),
        )
        for headers, expected_delay in cases:
            def opener(request, timeout, headers=headers):
                raise urllib.error.HTTPError(
                    request.full_url,
                    403,
                    "secret reason",
                    headers,
                    io.BytesIO(
                        json.dumps(
                            {"message": "You have exceeded a secondary rate limit. VERY_SECRET"}
                        ).encode()
                    ),
                )

            with self.subTest(headers=headers):
                with self.assertRaises(RetryableGateError) as caught:
                    fetch_runs_once(HEAD, TOKEN, 10, opener=opener, wall_clock=lambda: 0)
                self.assertEqual(caught.exception.code, "RATE_LIMIT")
                self.assertEqual(caught.exception.delay_seconds, expected_delay)
                self.assertNotIn("SECRET", str(caught.exception))

    def test_http_403_retry_after_without_rate_limit_proof_remains_auth_or_permission(self):
        def opener(request, timeout):
            raise urllib.error.HTTPError(
                request.full_url,
                403,
                "permission denied",
                {"Retry-After": "30"},
                io.BytesIO(
                    json.dumps({"message": "Resource not accessible by integration"}).encode()
                ),
            )

        with self.assertRaises(GateError) as caught:
            fetch_runs_once(HEAD, TOKEN, 10, opener=opener, wall_clock=lambda: 0)
        self.assertEqual(str(caught.exception), "AUTH_OR_PERMISSION")

    def test_http_403_oversized_secondary_body_is_not_rate_limit_proof(self):
        def opener(request, timeout):
            payload = (
                b'{"message":"secondary rate limit '
                + b"x" * (16 * 1024)
                + b'"}'
            )
            raise urllib.error.HTTPError(
                request.full_url,
                403,
                "secret reason",
                {},
                io.BytesIO(payload),
            )

        with self.assertRaises(GateError) as caught:
            fetch_runs_once(HEAD, TOKEN, 10, opener=opener, wall_clock=lambda: 0)
        self.assertEqual(str(caught.exception), "AUTH_OR_PERMISSION")

    def test_http_403_non_rate_limit_remains_auth_or_permission(self):
        cases = (
            (json.dumps({"message": "Resource not accessible by integration"}).encode(), {}),
            (b"not-json VERY_SECRET", {"X-RateLimit-Remaining": "1", "X-RateLimit-Reset": "100"}),
        )
        for body, response_headers in cases:
            def opener(request, timeout, body=body, response_headers=response_headers):
                raise urllib.error.HTTPError(
                    request.full_url,
                    403,
                    "secret reason",
                    response_headers,
                    io.BytesIO(body),
                )

            with self.subTest(headers=response_headers):
                with self.assertRaises(GateError) as caught:
                    fetch_runs_once(HEAD, TOKEN, 10, opener=opener, wall_clock=lambda: 0)
                self.assertEqual(str(caught.exception), "AUTH_OR_PERMISSION")
                self.assertNotIn("SECRET", str(caught.exception))

    def test_http_403_malformed_proven_rate_limit_header_fails_closed(self):
        def opener(request, timeout):
            raise urllib.error.HTTPError(
                request.full_url,
                403,
                "secret reason",
                {"X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "invalid"},
                io.BytesIO(b'{"message":"secondary rate limit VERY_SECRET"}'),
            )

        with self.assertRaises(GateError) as caught:
            fetch_runs_once(HEAD, TOKEN, 10, opener=opener, wall_clock=lambda: 0)
        self.assertEqual(str(caught.exception), "RATE_LIMIT_HEADER_INVALID")
        self.assertNotIn("SECRET", str(caught.exception))

    def test_rate_limit_without_delay_uses_sixty_second_default(self):
        clock = FakeClock()
        attempts = {"count": 0}

        def fetcher(*args, **kwargs):
            attempts["count"] += 1
            if attempts["count"] == 1:
                raise RetryableGateError("RATE_LIMIT")
            return successful_runs()

        result = run_gate(
            EXPECTED_REPOSITORY,
            HEAD,
            BRANCH,
            TOKEN,
            deadline_seconds=120,
            clock=clock.now,
            wall_clock=lambda: 123,
            sleep_fn=clock.sleep,
            fetcher=fetcher,
        )
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(clock.value, 60)
        self.assertEqual(attempts["count"], 2)

    def test_rate_limit_without_delay_fails_with_rate_limit_deadline(self):
        clock = FakeClock()

        def fetcher(*args, **kwargs):
            raise RetryableGateError("RATE_LIMIT")

        result = run_gate(
            EXPECTED_REPOSITORY,
            HEAD,
            BRANCH,
            TOKEN,
            deadline_seconds=30,
            clock=clock.now,
            wall_clock=lambda: 456,
            sleep_fn=clock.sleep,
            fetcher=fetcher,
        )
        self.assertEqual(result["status"], "BLOCKED")
        self.assertEqual(result["reason"], "RATE_LIMIT_DEADLINE")
        self.assertEqual(clock.value, 0)

    def test_workflow_required_context_and_safety_dependency_are_fail_closed(self):
        root = Path(__file__).resolve().parents[2]
        workflow = (root / ".github/workflows/coordination.yml").read_text()

        expected_name = (
            "name: @@{{ github.event_name == 'push' && "
            "startsWith(github.ref_name, 'controller/task-publication/') "
            "&& 'octoport-publication-gate' || "
            "'octoport-publication-gate-not-applicable' }}"
        ).replace("@@", "$")
        expected_if = (
            "if: @@{{ always() && github.event_name == 'push' && "
            "startsWith(github.ref_name, 'controller/task-publication/') }}"
        ).replace("@@", "$")
        self.assertIn(expected_name, workflow)
        self.assertNotIn(
            "name: "
            + "$"
            + "{{ startsWith(github.ref_name, 'controller/task-publication/') "
            + "&& 'octoport-publication-gate'",
            workflow,
        )
        self.assertIn(expected_if, workflow)
        self.assertIn("needs: safety", workflow)
        self.assertIn("if: " + "$" + "{{ needs.safety.result != 'success' }}", workflow)
        self.assertIn("if: " + "$" + "{{ needs.safety.result == 'success' }}", workflow)
        self.assertIn('echo "local safety did not succeed"', workflow)

    def test_http_429_and_5xx_are_retryable_with_sanitized_codes(self):
        def rate_limited(request, timeout):
            raise urllib.error.HTTPError(
                request.full_url,
                429,
                "rate limit details",
                {"Retry-After": "30"},
                io.BytesIO(b"secret"),
            )

        with self.assertRaises(RetryableGateError) as caught:
            fetch_runs_once(HEAD, TOKEN, 10, opener=rate_limited, wall_clock=lambda: 0)
        self.assertEqual(caught.exception.code, "RATE_LIMIT")
        self.assertEqual(caught.exception.delay_seconds, 30)

        def unavailable(request, timeout):
            raise urllib.error.HTTPError(
                request.full_url,
                503,
                "upstream details",
                {},
                io.BytesIO(b"secret"),
            )

        with self.assertRaises(RetryableGateError) as caught:
            fetch_runs_once(HEAD, TOKEN, 10, opener=unavailable, wall_clock=lambda: 0)
        self.assertEqual(caught.exception.code, "HTTP_5XX")

    def test_malformed_response_fails_immediately(self):
        def opener(request, timeout):
            return FakeResponse({"not_workflow_runs": []})

        with self.assertRaisesRegex(GateError, "MALFORMED_RESPONSE"):
            fetch_runs_once(HEAD, TOKEN, 10, opener=opener, wall_clock=lambda: 0)

    def test_transient_error_retries_then_passes_within_deadline(self):
        clock = FakeClock()
        attempts = {"count": 0}

        def fetcher(*args, **kwargs):
            attempts["count"] += 1
            if attempts["count"] == 1:
                raise RetryableGateError("NETWORK")
            return successful_runs()

        result = run_gate(
            EXPECTED_REPOSITORY,
            HEAD,
            BRANCH,
            TOKEN,
            deadline_seconds=100,
            poll_interval_seconds=5,
            clock=clock.now,
            wall_clock=lambda: 123,
            sleep_fn=clock.sleep,
            fetcher=fetcher,
        )
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["checked_at"], 123)
        self.assertEqual(attempts["count"], 2)
        self.assertGreater(clock.value, 0)

    def test_success_arriving_after_deadline_fails_closed(self):
        clock = FakeClock()

        def fetcher(*args, **kwargs):
            clock.value = 11
            return successful_runs()

        result = run_gate(
            EXPECTED_REPOSITORY,
            HEAD,
            BRANCH,
            TOKEN,
            deadline_seconds=10,
            clock=clock.now,
            wall_clock=lambda: 444,
            sleep_fn=clock.sleep,
            fetcher=fetcher,
        )
        self.assertEqual(result["status"], "BLOCKED")
        self.assertEqual(result["reason"], "DEADLINE_INCOMPLETE")
        self.assertTrue(all(row["status"] == "completed" for row in result["runs"]))

    def test_rate_limit_wait_beyond_deadline_fails_closed(self):
        clock = FakeClock()

        def fetcher(*args, **kwargs):
            raise RetryableGateError("RATE_LIMIT", 60)

        result = run_gate(
            EXPECTED_REPOSITORY,
            HEAD,
            BRANCH,
            TOKEN,
            deadline_seconds=30,
            clock=clock.now,
            wall_clock=lambda: 456,
            sleep_fn=clock.sleep,
            fetcher=fetcher,
        )
        self.assertEqual(result["status"], "BLOCKED")
        self.assertEqual(result["reason"], "RATE_LIMIT_DEADLINE")
        self.assertEqual(clock.value, 0)

    def test_missing_runs_until_deadline_then_fails_closed(self):
        clock = FakeClock()

        result = run_gate(
            EXPECTED_REPOSITORY,
            HEAD,
            BRANCH,
            TOKEN,
            deadline_seconds=12,
            poll_interval_seconds=5,
            clock=clock.now,
            wall_clock=lambda: 789,
            sleep_fn=clock.sleep,
            fetcher=lambda *args, **kwargs: [],
        )
        self.assertEqual(result["status"], "BLOCKED")
        self.assertEqual(result["reason"], "DEADLINE_INCOMPLETE")
        self.assertTrue(all(row["status"] == "missing" for row in result["runs"]))


if __name__ == "__main__":
    unittest.main()
