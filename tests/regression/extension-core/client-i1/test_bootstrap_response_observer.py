"""Offline checks for bounded, completed signed bootstrap HTTP observation."""
import importlib.util
from pathlib import Path
import unittest

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError


spec = importlib.util.spec_from_file_location(
    "installed_local_integration",
    Path(__file__).with_name("installed_local_integration.py"),
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FakeRequest:
    def __init__(self, url="http://127.0.0.1:43100/v1/bootstrap", failure=None):
        self.url = url
        self.method = "POST"
        self._failure = failure

    @property
    def failure(self):
        return self._failure


class FakeResponse:
    def __init__(self, payload=None, request=None, parse_error=None):
        self.payload = payload
        self.request = request or FakeRequest()
        self.parse_error = parse_error
        self.calls = []

    def finished(self):
        raise AssertionError("unbounded Response.finished() must not be called")

    def json(self):
        self.calls.append("json")
        if self.parse_error is not None:
            raise self.parse_error
        return self.payload


class FakeContext:
    def __init__(self, finishing_request=None, error=None):
        self.finishing_request = finishing_request
        self.error = error
        self.waits = []

    def wait_for_event(self, event, predicate, timeout):
        self.waits.append((event, timeout))
        if self.error is not None:
            raise self.error
        if self.finishing_request is None or not predicate(self.finishing_request):
            raise PlaywrightTimeoutError("SECRET_SYNTHETIC_REQUEST_URL")
        return self.finishing_request


class BootstrapObserverTest(unittest.TestCase):
    def read(self, response, context=None, completed=None):
        return module.read_completed_bootstrap_response(
            response, context or FakeContext(), completed if completed is not None else []
        )

    def test_already_finished_response_does_not_wait_or_call_finished(self):
        response = FakeResponse({"keyId": "fixture", "payload": "fixture"})
        context = FakeContext()
        self.assertEqual(self.read(response, context, [response.request]), response.payload)
        self.assertEqual(context.waits, [])
        self.assertEqual(response.calls, ["json"])

    def test_waits_for_matching_requestfinished_with_bounded_timeout(self):
        response = FakeResponse({"keyId": "fixture", "payload": "fixture"})
        context = FakeContext(finishing_request=response.request)
        self.assertEqual(self.read(response, context), response.payload)
        self.assertEqual(context.waits, [("requestfinished", 30000)])
        self.assertEqual(response.calls, ["json"])

    def test_rejects_unfinished_headers_without_parsing_or_leaking_error(self):
        response = FakeResponse({"keyId": "fixture"})
        context = FakeContext(error=PlaywrightTimeoutError("SECRET_SYNTHETIC_REQUEST_URL"))
        with self.assertRaisesRegex(RuntimeError, "did not complete") as raised:
            self.read(response, context)
        self.assertNotIn("SECRET_SYNTHETIC_REQUEST_URL", str(raised.exception))
        self.assertEqual(context.waits, [("requestfinished", 30000)])
        self.assertEqual(response.calls, [])

    def test_rejects_unrelated_request_even_at_same_url(self):
        response = FakeResponse({"keyId": "fixture"})
        unrelated = FakeRequest(url=response.request.url)
        context = FakeContext(finishing_request=unrelated)
        with self.assertRaisesRegex(RuntimeError, "did not complete"):
            self.read(response, context, [unrelated])
        self.assertEqual(context.waits, [("requestfinished", 30000)])
        self.assertEqual(response.calls, [])

    def test_rejects_unreadable_body_without_exposing_exception(self):
        response = FakeResponse(parse_error=ValueError("SECRET_FIXTURE_BODY"))
        with self.assertRaisesRegex(RuntimeError, "unreadable") as raised:
            self.read(response, FakeContext(), [response.request])
        self.assertNotIn("SECRET_FIXTURE_BODY", str(raised.exception))
        self.assertEqual(response.calls, ["json"])

    def test_rejects_missing_signed_envelope_after_finished(self):
        for payload in (None, "", [], {}):
            with self.subTest(payload=repr(payload)):
                response = FakeResponse(payload=payload)
                with self.assertRaisesRegex(RuntimeError, "invalid shape"):
                    self.read(response, FakeContext(), [response.request])

    def test_missing_request_completion_fails_closed(self):
        response = FakeResponse({"keyId": "fixture"})
        context = FakeContext()
        with self.assertRaisesRegex(RuntimeError, "did not complete"):
            self.read(response, context)
        self.assertEqual(context.waits, [("requestfinished", 30000)])
        self.assertEqual(response.calls, [])

    def test_safe_phase_counts_distinguish_latest_extra_pending_response(self):
        first, second, latest = [
            FakeResponse(request=FakeRequest(url="http://127.0.0.1:43100/v1/bootstrap?SECRET_PRIVATE_VALUE"))
            for _ in range(3)
        ]
        observed = module.safe_bootstrap_event_counts(
            [first, second, latest],
            [first.request, second.request],
            [], [(first.request, "first_activation_window"),
                 (second.request, "second_activation_window"),
                 (latest.request, "second_activation_window")],
            1, 2, latest,
        )
        self.assertEqual(observed, {
            "schema_version": 1,
            "http_200_count": 3,
            "requestfinished_200_count": 2,
            "requestfailed_200_count": 0,
            "selected_request_finished": False,
            "selected_request_failed": False,
            "selected_response_observed_window": "after_work_start_marker",
            "selected_request_event_window": "second_activation_window",
            "selected_failure_class": "NONE",
            "selected_failure_ms_after_work_start": None,
        })
        self.assertNotIn("SECRET_PRIVATE_VALUE", str(observed))

    def test_work_start_selects_exact_request_even_when_older_header_arrives_late(self):
        prior = FakeResponse(request=FakeRequest(
            url="http://127.0.0.1:43100/v1/bootstrap?PRIVATE_PRIOR"))
        work_start = FakeResponse(request=FakeRequest(
            url="http://127.0.0.1:43100/v1/bootstrap?PRIVATE_WORK"))
        delayed_old = FakeResponse(request=FakeRequest(
            url="http://127.0.0.1:43100/v1/bootstrap?PRIVATE_DELAYED"))
        responses = [prior, work_start, delayed_old]
        started = [(prior.request, "first_activation_window"),
                   (delayed_old.request, "second_activation_window"),
                   (work_start.request, "work_start_window")]
        # A post-marker response is not necessarily a post-marker request.
        selected = module.select_unique_work_start_bootstrap_response(
            responses, started, prior_header_count=1)
        self.assertIs(selected, work_start)
        self.assertIsNot(selected, responses[-1])

    def test_work_start_selector_fails_closed_on_ambiguity_and_stale_headers(self):
        before = FakeResponse()
        selected = FakeResponse()
        concurrent = FakeResponse()
        recorded = [(before.request, "second_activation_window"),
                    (selected.request, "work_start_window")]
        pick = module.select_unique_work_start_bootstrap_response
        self.assertIs(pick([before, selected], recorded, 1), selected)
        self.assertIsNone(pick([before], recorded, 1))
        self.assertIsNone(pick([before, selected], recorded, 2))
        self.assertIsNone(pick([before, selected], recorded, True))
        self.assertIsNone(pick([before, selected], recorded, -1))
        self.assertIsNone(pick([before, selected], recorded, 3))
        self.assertIsNone(pick([before, selected],
                               recorded + [(concurrent.request, "work_start_window")], 1))
        self.assertIsNone(pick([before, selected, concurrent],
                               recorded + [(concurrent.request, "work_start_window")], 1))
        self.assertIsNone(pick([before, selected, FakeResponse(request=selected.request)],
                               recorded, 1))
        same_url_different_request = FakeResponse(
            request=FakeRequest(url=selected.request.url))
        self.assertIsNone(pick([before, same_url_different_request], recorded, 1))

    def test_work_start_request_failed_before_headers_fails_immediately(self):
        # Prior activation has an old HTTP200, but the selected Work Start
        # Request is terminally aborted before any headers arrive.
        prior = FakeResponse(request=FakeRequest(
            url="http://127.0.0.1:43100/v1/bootstrap?SECRET_PRIOR"))
        request = FakeRequest(
            url="http://127.0.0.1:43100/v1/bootstrap?SECRET_CURRENT",
            failure="net::ERR_ABORTED")
        responses = [prior]
        started = [(prior.request, "second_activation_window"),
                   (request, "work_start_window")]
        with self.assertRaisesRegex(
            RuntimeError, "Work Start bootstrap HTTP request failed before response"
        ) as raised:
            module.wait_until(
                lambda: module.select_work_start_bootstrap_response_or_fail(
                    responses, started, 1, [request]),
                "unique Work Start response", timeout=30,
            )
        self.assertNotIn("SECRET_CURRENT", str(raised.exception))
        self.assertNotIn("SECRET_PRIOR", str(raised.exception))

    def test_old_request_failure_never_blocks_new_work_start_response(self):
        old = FakeResponse(request=FakeRequest(
            url="http://127.0.0.1:43100/v1/bootstrap?SECRET_OLD",
            failure="net::ERR_ABORTED"))
        active = FakeResponse(request=FakeRequest(
            url="http://127.0.0.1:43100/v1/bootstrap?SECRET_ACTIVE"))
        previous_failure = [old.request]
        started = [(old.request, "second_activation_window"),
                   (active.request, "work_start_window")]
        picked = module.select_work_start_bootstrap_response_or_fail(
            [old, active], started, 1, previous_failure)
        self.assertIs(picked, active)

    def test_second_failed_work_start_request_prevents_stale_success(self):
        previous = FakeResponse()
        first = FakeResponse()
        failed_second = FakeRequest(failure="net::ERR_FAILED")
        started = [(previous.request, "second_activation_window"),
                   (first.request, "work_start_window"),
                   (failed_second, "work_start_window")]
        with self.assertRaisesRegex(RuntimeError, "failed before response"):
            module.select_work_start_bootstrap_response_or_fail(
                [previous, first], started, 1, [failed_second])

    def test_work_start_selected_identity_must_survive_body_read_race(self):
        # One response is initially unique; a second Work Start request appears
        # while the selected response body is read. No acceptance is possible.
        previous = FakeResponse()
        later = FakeResponse()
        observed = [(previous.request, "second_activation_window")]
        responses = [previous]

        class RacingResponse(FakeResponse):
            def json(self):
                observed.append((later.request, "work_start_window"))
                responses.append(later)
                return {"synthetic": True}

        selected = RacingResponse(request=FakeRequest())
        observed.append((selected.request, "work_start_window"))
        responses.append(selected)
        self.assertIs(
            module.select_unique_work_start_bootstrap_response(
                responses, observed, 1),
            selected,
        )
        with self.assertRaisesRegex(RuntimeError, "identity changed"):
            module.read_completed_unique_work_start_bootstrap_response(
                selected, responses, observed, 1,
                FakeContext(), [selected.request], [],
            )

    def test_work_start_body_recheck_does_not_confuse_late_prior_response(self):
        old = FakeResponse()
        delayed_old = FakeResponse()
        observed = [(old.request, "second_activation_window"),
                    (delayed_old.request, "second_activation_window")]
        responses = [old]

        class LateOldHeader(FakeResponse):
            def json(self):
                responses.append(delayed_old)
                return {"synthetic": True}

        selected = LateOldHeader(request=FakeRequest())
        observed.append((selected.request, "work_start_window"))
        responses.append(selected)
        result = module.read_completed_unique_work_start_bootstrap_response(
            selected, responses, observed, 1,
            FakeContext(), [selected.request], [],
        )
        self.assertEqual(result, {"synthetic": True})

    def test_event_identity_not_merely_same_request_url(self):
        selected = FakeResponse()
        other = FakeRequest(url=selected.request.url)
        counts = module.safe_bootstrap_event_counts(
            [selected], [other], [other], [(other, "work_start_window")], 0, 1, selected
        )
        self.assertEqual(counts["requestfinished_200_count"], 0)
        self.assertEqual(counts["requestfailed_200_count"], 0)
        self.assertFalse(counts["selected_request_finished"])
        self.assertFalse(counts["selected_request_failed"])
        self.assertEqual(counts["selected_response_observed_window"], "after_second_activation_marker")
        self.assertEqual(counts["selected_request_event_window"], "unobserved")

    def test_safe_counts_show_failure_without_leaking_request_errors(self):
        selected = FakeResponse(request=FakeRequest(url="http://127.0.0.1:43100/v1/bootstrap?PRIVATE_DATA"))
        counts = module.safe_bootstrap_event_counts(
            [selected], [], [selected.request],
            [(selected.request, "work_start_window")], None, 0, selected,
        )
        self.assertEqual(counts["requestfailed_200_count"], 1)
        self.assertTrue(counts["selected_request_failed"])
        self.assertFalse(counts["selected_request_finished"])
        self.assertNotIn("PRIVATE_DATA", str(counts))

    def test_unknown_request_window_label_is_not_logged(self):
        selected = FakeResponse(request=FakeRequest(url="http://127.0.0.1:43100/v1/bootstrap?SECRET_PHASE"))
        counts = module.safe_bootstrap_event_counts(
            [selected], [], [], [(selected.request, "SECRET_USER_PHASE")], None, None, selected,
        )
        self.assertEqual(counts["selected_request_event_window"], "unobserved")
        self.assertNotIn("SECRET", str(counts))

    def test_missing_header_snapshots_report_unobserved_not_earlier_phase(self):
        response = FakeResponse()
        counts = module.safe_bootstrap_event_counts(
            [response], [], [],
            [(response.request, "second_activation_window")],
            None, None, response,
        )
        self.assertEqual(counts["selected_response_observed_window"], "unobserved")
        self.assertEqual(counts["selected_request_event_window"], "second_activation_window")
        self.assertEqual(counts["http_200_count"], 1)

    def test_selected_response_does_not_shift_to_later_http_200(self):
        early = FakeResponse()
        chosen = FakeResponse(request=FakeRequest(url="http://127.0.0.1:43100/v1/bootstrap?SECRET_CHOSEN"))
        later = FakeResponse(request=FakeRequest(url="http://127.0.0.1:43100/v1/bootstrap?SECRET_LATER"))
        counts = module.safe_bootstrap_event_counts(
            [early, chosen, later],
            [early.request, chosen.request], [later.request],
            [(early.request, "first_activation_window"),
             (chosen.request, "work_start_window"),
             (later.request, "work_start_window")],
            1, 1, chosen,
        )
        self.assertEqual(counts["http_200_count"], 3)
        self.assertEqual(counts["requestfinished_200_count"], 2)
        self.assertEqual(counts["requestfailed_200_count"], 1)
        self.assertTrue(counts["selected_request_finished"])
        self.assertFalse(counts["selected_request_failed"])
        self.assertEqual(counts["selected_request_event_window"], "work_start_window")
        self.assertEqual(counts["selected_response_observed_window"], "after_work_start_marker")
        self.assertNotIn("SECRET_CHOSEN", str(counts))
        self.assertNotIn("SECRET_LATER", str(counts))

    def test_unobserved_selected_response_is_never_replaced_by_latest(self):
        observed = FakeResponse()
        selected = FakeResponse()
        counts = module.safe_bootstrap_event_counts(
            [observed], [observed.request], [],
            [(selected.request, "work_start_window")],
            0, 0, selected,
        )
        self.assertEqual(counts["http_200_count"], 1)
        self.assertFalse(counts["selected_request_finished"])
        self.assertEqual(counts["selected_request_event_window"], "work_start_window")
        self.assertEqual(counts["selected_response_observed_window"], "unobserved")

    def test_selected_abort_class_and_exact_failure_age_are_allowlisted(self):
        selected = FakeResponse(request=FakeRequest(
            url="http://127.0.0.1:43100/v1/bootstrap?SECRET_FAILURE_QUERY",
            failure="net::ERR_ABORTED",
        ))
        counts = module.safe_bootstrap_event_counts(
            [selected], [], [selected.request],
            [(selected.request, "work_start_window")],
            0, 0, selected, [(selected.request, 50.0)], 20.0,
        )
        self.assertEqual(counts["selected_failure_class"], "ABORTED")
        self.assertEqual(counts["selected_failure_ms_after_work_start"], 30000)
        self.assertTrue(counts["selected_request_failed"])
        self.assertFalse(counts["selected_request_finished"])
        self.assertNotIn("SECRET_FAILURE_QUERY", str(counts))
        self.assertNotIn("net::", str(counts))

    def test_network_failure_classes_are_strict_allowlist(self):
        known = {
            "net::ERR_CONNECTION_RESET": "CONNECTION_RESET",
            "net::ERR_CONNECTION_CLOSED": "CONNECTION_CLOSED",
            "net::ERR_TIMED_OUT": "NETWORK_TIMEOUT",
            "net::ERR_EMPTY_RESPONSE": "EMPTY_RESPONSE",
            "net::ERR_CONNECTION_REFUSED": "CONNECTION_REFUSED",
            "net::ERR_HTTP2_PROTOCOL_ERROR": "PROTOCOL_ERROR",
            "net::ERR_FAILED": "GENERIC_NETWORK_FAILURE",
            "NS_BINDING_ABORTED": "ABORTED",
        }
        for raw, expected in known.items():
            with self.subTest(expected=expected):
                self.assertEqual(
                    module.safe_bootstrap_failure_class(FakeRequest(failure=raw)),
                    expected,
                )

    def test_untrusted_failure_reason_is_never_serialized(self):
        secret = "net::ERR_ABORTED SYNTHETIC_TOKEN_PRIVATE"
        selected = FakeResponse(request=FakeRequest(failure=secret))
        counts = module.safe_bootstrap_event_counts(
            [selected], [], [selected.request],
            [(selected.request, "work_start_window")],
            0, 0, selected, [(selected.request, 30.0)], 0.0,
        )
        self.assertEqual(counts["selected_failure_class"], "OTHER")
        self.assertEqual(counts["selected_failure_ms_after_work_start"], 30000)
        self.assertNotIn("SYNTHETIC_TOKEN_PRIVATE", str(counts))
        self.assertNotIn("net::", str(counts))

    def test_unrelated_same_url_failure_does_not_change_selected_diagnostic(self):
        selected = FakeResponse()
        unrelated = FakeRequest(url=selected.request.url, failure="net::ERR_ABORTED")
        counts = module.safe_bootstrap_event_counts(
            [selected], [], [unrelated], [(selected.request, "work_start_window")],
            0, 0, selected, [(unrelated, 30.0)], 0.0,
        )
        self.assertFalse(counts["selected_request_failed"])
        self.assertEqual(counts["selected_failure_class"], "NONE")
        self.assertIsNone(counts["selected_failure_ms_after_work_start"])

    def test_untrusted_or_invalid_failure_clock_is_unobserved(self):
        selected = FakeResponse(request=FakeRequest(failure="net::ERR_ABORTED"))
        for event_time, start_time in [(10.0, 20.0), (float("nan"), 0.0),
                                       (float("inf"), 0.0), (200.0, 0.0)]:
            with self.subTest(event_time=event_time):
                counts = module.safe_bootstrap_event_counts(
                    [selected], [], [selected.request],
                    [(selected.request, "work_start_window")],
                    0, 0, selected, [(selected.request, event_time)], start_time,
                )
                self.assertTrue(counts["selected_request_failed"])
                self.assertIsNone(counts["selected_failure_ms_after_work_start"])
                self.assertEqual(counts["selected_failure_class"], "ABORTED")

    def test_request_failure_property_exceptions_are_not_exposed(self):
        class RaisingRequest(FakeRequest):
            @property
            def failure(self):
                raise RuntimeError("SYNTHETIC_SENSITIVE_ERROR")
        selected = FakeResponse(request=RaisingRequest())
        counts = module.safe_bootstrap_event_counts(
            [selected], [], [selected.request],
            [(selected.request, "work_start_window")],
            0, 0, selected, [(selected.request, 35.0)], 5.0,
        )
        self.assertEqual(counts["selected_failure_class"], "UNOBSERVABLE")
        self.assertEqual(counts["selected_failure_ms_after_work_start"], 30000)
        self.assertNotIn("SYNTHETIC_SENSITIVE_ERROR", str(counts))

    def test_safe_counts_no_http_response_does_not_guess_phase(self):
        counts = module.safe_bootstrap_event_counts([], [], [], [], None, None, None)
        self.assertEqual(counts["selected_response_observed_window"], "none")
        self.assertEqual(counts["selected_request_event_window"], "unobserved")
        self.assertEqual(counts["http_200_count"], 0)
        self.assertFalse(counts["selected_request_finished"])

    def test_selected_failed_before_read_short_circuits_without_body_or_wait(self):
        response = FakeResponse({"keyId": "fixture"}, request=FakeRequest(failure="net::ERR_ABORTED"))
        context = FakeContext(error=PlaywrightTimeoutError("PRIVATE_ABORT_REASON"))
        with self.assertRaisesRegex(RuntimeError, "HTTP request failed before completion") as raised:
            module.read_completed_bootstrap_response(
                response, context, [], [response.request]
            )
        self.assertNotIn("PRIVATE_ABORT_REASON", str(raised.exception))
        self.assertEqual(context.waits, [])
        self.assertEqual(response.calls, [])

    def test_unrelated_failed_request_at_same_url_does_not_block_signed_read(self):
        response = FakeResponse({"keyId": "synthetic", "payload": "synthetic"})
        unrelated = FakeRequest(url=response.request.url, failure="net::ERR_ABORTED")
        context = FakeContext()
        self.assertEqual(module.read_completed_bootstrap_response(
            response, context, [response.request], [unrelated]
        ), response.payload)
        self.assertEqual(context.waits, [])
        self.assertEqual(response.calls, ["json"])

    def test_observed_failure_after_bounded_wait_rejects_without_body_leak(self):
        response = FakeResponse({"keyId": "fixture"})
        failed_requests = []
        class LateFailContext(FakeContext):
            def wait_for_event(self, event, predicate, timeout):
                self.waits.append((event, timeout))
                failed_requests.append(response.request)
                raise PlaywrightTimeoutError("SYNTHETIC_SECRET_URL")
        context = LateFailContext()
        with self.assertRaisesRegex(RuntimeError, "HTTP request failed before completion") as raised:
            module.read_completed_bootstrap_response(
                response, context, [], failed_requests
            )
        self.assertNotIn("SYNTHETIC_SECRET_URL", str(raised.exception))
        self.assertEqual(context.waits, [("requestfinished", 30000)])
        self.assertEqual(response.calls, [])

    def test_finished_and_failed_same_selected_request_is_never_accepted(self):
        response = FakeResponse({"keyId": "fixture"})
        context = FakeContext()
        with self.assertRaisesRegex(RuntimeError, "HTTP request failed before completion"):
            module.read_completed_bootstrap_response(
                response, context, [response.request], [response.request]
            )
        self.assertEqual(response.calls, [])
        self.assertEqual(context.waits, [])




class BootstrapResponseLifecycleTest(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "lifecycle.json"
        self.run_id = "a" * 32

    def row(self, ordinal, finished=True):
        events = [{"phase": "RECEIVED", "elapsed_ms": 0, "status": None, "writable_finished": None}]
        if finished:
            events.append({"phase": "FINISH", "elapsed_ms": 1, "status": 200, "writable_finished": True})
        events.append({"phase": "CLOSE", "elapsed_ms": 2, "status": 200, "writable_finished": finished})
        return {"ordinal": ordinal, "events": events}

    def save(self, rows, **extra):
        import json
        self.path.write_text(json.dumps({"schema_version": 1, "run_id": self.run_id, "complete": True, "records": rows, **extra}))

    def response(self, ordinal, run_id=None, failure=None):
        response = FakeResponse(request=FakeRequest(failure=failure))
        response.headers = {module._BOOTSTRAP_ORDINAL_HEADER: (run_id or self.run_id) + ":" + str(ordinal)}
        def unavailable_raw_headers(name):
            response.calls.append("raw_headers")
            raise AssertionError("diagnostics must not request raw headers without a deadline")
        response.header_value = unavailable_raw_headers
        return response

    def test_exact_selected_header_survives_different_arrival_order(self):
        self.save([self.row(1), self.row(2, False), self.row(3)])
        one, two, three = [self.response(i) for i in (1, 2, 3)]
        result = module.safe_bootstrap_response_lifecycle(two, [three, one, two], self.path)
        self.assertEqual(result["correlation"], "EXACT_RESPONSE_HEADER")
        self.assertEqual(result["selected_server_ordinal"], 2)
        self.assertFalse(result["server_finished"])
        self.assertFalse(result["server_close_writable_finished"])
        self.assertEqual(result["browser_code_family"], "NONE")

    def test_unrelated_success_cannot_replace_selected_premature_response(self):
        self.save([self.row(1, False), self.row(2)])
        selected, other = self.response(1, failure="net::ERR_ABORTED"), self.response(2)
        result = module.safe_bootstrap_response_lifecycle(selected, [other, selected], self.path)
        self.assertEqual(result["browser_code_family"], "NET_ERR_ABORTED")
        self.assertFalse(result["server_finished"])

    def test_duplicate_missing_foreign_or_restarted_server_identity_is_unconfirmed(self):
        self.save([self.row(1), self.row(2)])
        selected = self.response(1)
        for responses in ([selected, self.response(1)], [selected, self.response(2, "b" * 32)], [self.response(1)], [selected, selected]):
            self.assertEqual(module.safe_bootstrap_response_lifecycle(selected, responses, self.path)["correlation"], "UNCONFIRMED")
        selected.headers = {module._BOOTSTRAP_ORDINAL_HEADER: "SECRET"}
        self.assertEqual(module.safe_bootstrap_response_lifecycle(selected, [selected], self.path)["correlation"], "UNCONFIRMED")

    def test_malformed_overflow_extra_fields_and_incomplete_evidence_fail_closed(self):
        import json
        response = self.response(1)
        variants = [
            {"complete": False},
            {"secret": "SECRET"},
            {"records": [self.row(1), self.row(1)]},
            {"records": [{"ordinal": 1, "events": [{**self.row(1)["events"][0], "body": "SECRET"}]}]},
            {"records": [self.row(i) for i in range(1, 66)]},
            {"records": [{"ordinal": True, "events": self.row(1)["events"]}]},
        ]
        for extra in variants:
            self.save([self.row(1)], **extra)
            result = module.safe_bootstrap_response_lifecycle(response, [response], self.path)
            self.assertEqual(result["correlation"], "UNCONFIRMED")
            self.assertNotIn("SECRET", json.dumps(result))
        self.path.write_text("{" + " " * 65536)
        self.assertEqual(module.safe_bootstrap_response_lifecycle(response, [response], self.path)["correlation"], "UNCONFIRMED")

    def test_code_family_is_fixed_and_does_not_change_old_class(self):
        for raw, expected in [("net::ERR_ABORTED", "NET_ERR_ABORTED"), ("NS_BINDING_ABORTED", "NS_BINDING_ABORTED"), ("SECRET_URL_TOKEN", "OTHER"), (None, "NONE")]:
            request = FakeRequest(failure=raw)
            self.assertEqual(module.safe_bootstrap_failure_code_family(request), expected)
        self.assertEqual(module.safe_bootstrap_failure_class(FakeRequest(failure="net::ERR_ABORTED")), "ABORTED")

    def test_failed_selected_or_unselected_response_uses_cached_headers_without_rpc(self):
        for failed_ordinal in (1, 2):
            with self.subTest(failed_ordinal=failed_ordinal):
                self.save([self.row(1, False), self.row(2)])
                selected = self.response(1, failure="net::ERR_ABORTED" if failed_ordinal == 1 else None)
                other = self.response(2, failure="net::ERR_ABORTED" if failed_ordinal == 2 else None)
                result = module.safe_bootstrap_response_lifecycle(selected, [other, selected], self.path)
                self.assertEqual(result["correlation"], "EXACT_RESPONSE_HEADER")
                self.assertEqual(result["selected_server_ordinal"], 1)
                self.assertFalse(result["server_finished"])
                self.assertEqual(selected.calls, [])
                self.assertEqual(other.calls, [])

    def test_missing_or_ambiguous_cached_headers_are_unconfirmed_without_rpc(self):
        import json
        for selected_missing in (True, False):
            for headers in (None, {}, {module._BOOTSTRAP_ORDINAL_HEADER: None},
                            {module._BOOTSTRAP_ORDINAL_HEADER: "SECRET"},
                            {module._BOOTSTRAP_ORDINAL_HEADER: self.run_id + ":1\n" + self.run_id + ":1"}):
                with self.subTest(selected_missing=selected_missing, headers_type=type(headers).__name__):
                    self.save([self.row(1), self.row(2)])
                    selected, other = self.response(1), self.response(2)
                    (selected if selected_missing else other).headers = headers
                    result = module.safe_bootstrap_response_lifecycle(selected, [other, selected], self.path)
                    self.assertEqual(result, {"schema_version": 1, "correlation": "UNCONFIRMED"})
                    self.assertNotIn("SECRET", json.dumps(result))
                    self.assertEqual(selected.calls, [])
                    self.assertEqual(other.calls, [])

    def test_only_fixed_cached_header_is_read_and_unrelated_secrets_are_not_exported(self):
        import json
        class ObservedHeaders(dict):
            def __init__(self, values):
                super().__init__(values)
                self.lookups = []
            def get(self, name, default=None):
                self.lookups.append(name)
                return super().get(name, default)
        self.save([self.row(1)])
        selected = self.response(1)
        selected.headers = ObservedHeaders({
            module._BOOTSTRAP_ORDINAL_HEADER: self.run_id + ":1",
            "set-cookie": "SECRET_COOKIE",
            "authorization": "SECRET_AUTH",
        })
        result = module.safe_bootstrap_response_lifecycle(selected, [selected], self.path)
        self.assertEqual(result["correlation"], "EXACT_RESPONSE_HEADER")
        self.assertEqual(selected.headers.lookups, [module._BOOTSTRAP_ORDINAL_HEADER])
        self.assertNotIn("SECRET", json.dumps(result))
        self.assertEqual(selected.calls, [])

    def test_node_response_lifecycle_and_real_loopback_controls(self):
        import subprocess
        result = subprocess.run(
            ["node", "--test", str(Path(__file__).with_name("bootstrap-response-lifecycle.test.mjs"))],
            capture_output=True, text=True, timeout=15,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


class FailureCleanupDiagnosticTest(unittest.TestCase):
    def exercise_failure_handler(self, *, envelope=None, profile=None, worker_error=False):
        import ast
        import contextlib
        import copy
        import io
        import json
        import tempfile
        from types import SimpleNamespace

        # Execute the real run() exception handler and its cleanup, without
        # starting a browser or replacing them with a mirrored implementation.
        tree = ast.parse(Path(module.__file__).read_text())
        matches = [node for node in ast.walk(tree) if isinstance(node, ast.Try)
                   and any(isinstance(item, ast.Constant)
                           and item.value == "I1_SAFE_BOOTSTRAP_EVENTS "
                           for handler in node.handlers for item in ast.walk(handler))]
        self.assertEqual(len(matches), 1)
        observed = copy.deepcopy(matches[0])
        observed.body = [ast.Raise(exc=ast.Name(id="original_failure", ctx=ast.Load()))]
        observed.orelse = []
        executable = ast.fix_missing_locations(ast.Module(body=[observed], type_ignores=[]))
        original = RuntimeError("ORIGINAL_INSTALLED_FAILURE")
        calls, closed, stages = [], [], []

        def evaluate(*args):
            calls.append("worker_evaluate")
            if worker_error:
                raise RuntimeError("PRIVATE_WORKER_FAILURE")
            return {}

        def inspect_profile(*args):
            calls.append("profile_evaluate")
            raise RuntimeError("PRIVATE_PROFILE_FAILURE")

        namespace = dict(vars(module))
        with tempfile.TemporaryDirectory() as directory:
            namespace.update(
                original_failure=original, result={}, stage="work_start_bootstrap_body_begin",
                started=0, bootstrap_http_responses=[], completed_bootstrap_requests=[],
                failed_bootstrap_requests=[], observed_bootstrap_request_windows=[],
                second_activation_header_count=None, work_start_header_count=None,
                failed_bootstrap_times=[], work_start_started_at=None,
                bootstrap_envelope=envelope, output=Path(directory),
                worker=SimpleNamespace(evaluate=evaluate),
                inspect_signed_profile=inspect_profile,
                context=SimpleNamespace(close=lambda: closed.append(True)),
                _mark_stage=lambda output, name, started: stages.append(name),
            )
            if profile is not None:
                namespace["signed_profile"] = profile
            with contextlib.redirect_stdout(io.StringIO()) as stdout:
                with self.assertRaises(RuntimeError) as raised:
                    exec(compile(executable, module.__file__, "exec"), namespace)
            self.assertIs(raised.exception, original)
        self.assertEqual(closed, [True])
        self.assertEqual(stages, ["browser_context_close"])
        self.assertEqual(calls, [], "failure diagnostics must not start worker RPCs")
        result = namespace["result"]
        self.assertEqual(result["bootstrap_response_lifecycle"]["correlation"], "UNCONFIRMED")
        self.assertNotIn("PRIVATE", json.dumps(result) + stdout.getvalue())
        self.assertNotIn("status", result)  # The outer handler retains FAIL authority.
        return result

    def test_unavailable_worker_does_not_delay_failure_cleanup(self):
        result = self.exercise_failure_handler(worker_error=True)
        self.assertEqual(result["failure_diagnostic"]["worker_state"], "UNCONFIRMED")
        self.assertEqual(result["failure_profile_diagnostic"], {"source": "UNCONFIRMED"})

    def test_parsed_envelope_does_not_trigger_another_profile_rpc(self):
        result = self.exercise_failure_handler(envelope={"payload": "PRIVATE_ENVELOPE"})
        self.assertTrue(result["failure_observation"]["bootstrap_body_parsed"])
        self.assertEqual(result["failure_profile_diagnostic"], {"source": "UNCONFIRMED"})

    def test_completed_profile_checks_are_cached_and_explicitly_pre_failure(self):
        result = self.exercise_failure_handler(
            envelope={"payload": "PRIVATE_ENVELOPE"},
            profile={"verified": True, "accountMatches": False, "materialShapeValid": True,
                     "materialValid": False, "raw": "PRIVATE_PROFILE"},
        )
        self.assertEqual(result["failure_profile_diagnostic"], {
            "source": "PRE_FAILURE_EVALUATION",
            "checks": {"verified": True, "accountMatches": False,
                       "materialShapeValid": True, "materialValid": False},
        })

    def test_unreadable_cached_checks_cannot_become_positive_evidence(self):
        for profile in ("PRIVATE_VALUE", {"verified": "PRIVATE_VALUE", "accountMatches": 1}):
            with self.subTest(kind=type(profile).__name__):
                result = self.exercise_failure_handler(profile=profile)
                diagnostic = result["failure_profile_diagnostic"]
                if type(profile) is dict:
                    self.assertTrue(all(value is None for value in diagnostic["checks"].values()))
                else:
                    self.assertEqual(diagnostic, {"source": "UNCONFIRMED"})


if __name__ == "__main__":
    unittest.main()
