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
    def __init__(self, url="http://127.0.0.1:43100/v1/bootstrap"):
        self.url = url
        self.method = "POST"


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


if __name__ == "__main__":
    unittest.main()
