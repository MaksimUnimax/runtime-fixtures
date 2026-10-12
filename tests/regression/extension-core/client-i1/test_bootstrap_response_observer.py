"""Offline checks for completed signed bootstrap HTTP body observation."""
import importlib.util
from pathlib import Path
import unittest


spec = importlib.util.spec_from_file_location(
    "installed_local_integration",
    Path(__file__).with_name("installed_local_integration.py"),
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FakeResponse:
    def __init__(self, payload=None, finished=None, parse_error=None):
        self.payload = payload
        self.finish_error = finished
        self.parse_error = parse_error
        self.calls = []

    def finished(self):
        self.calls.append("finished")
        return self.finish_error

    def json(self):
        self.calls.append("json")
        if self.parse_error is not None:
            raise self.parse_error
        return self.payload


class BootstrapObserverTest(unittest.TestCase):
    def test_reads_body_only_after_finished(self):
        response = FakeResponse({"keyId": "fixture", "payload": "fixture"})
        self.assertEqual(
            module.read_completed_bootstrap_response(response),
            response.payload,
        )
        self.assertEqual(response.calls, ["finished", "json"])

    def test_rejects_incomplete_body_without_parsing(self):
        response = FakeResponse({"payload": "fixture"}, finished="closed early")
        with self.assertRaisesRegex(RuntimeError, "did not complete"):
            module.read_completed_bootstrap_response(response)
        self.assertEqual(response.calls, ["finished"])

    def test_rejects_unreadable_body_without_exposing_exception(self):
        response = FakeResponse(parse_error=ValueError("SECRET_FIXTURE_BODY"))
        with self.assertRaisesRegex(RuntimeError, "unreadable") as raised:
            module.read_completed_bootstrap_response(response)
        self.assertNotIn("SECRET_FIXTURE_BODY", str(raised.exception))
        self.assertEqual(response.calls, ["finished", "json"])

    def test_rejects_missing_signed_envelope(self):
        for payload in (None, "", [], {}):
            with self.subTest(payload=repr(payload)):
                with self.assertRaisesRegex(RuntimeError, "invalid shape"):
                    module.read_completed_bootstrap_response(
                        FakeResponse(payload=payload)
                    )


if __name__ == "__main__":
    unittest.main()
