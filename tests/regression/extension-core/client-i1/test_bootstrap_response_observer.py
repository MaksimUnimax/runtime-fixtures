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

    def test_stored_chatgpt_candidate_projection_fixed_boolean_only(self):
        raw = {
            "stored_record_present": True,
            "stored_record_ambiguous": False,
            "stored_work_allowed_claim": True,
            "stored_ai_resolved_claim": True,
            "stored_envelope_present": True,
            "stored_profile_present": True,
            "stored_same_generation_claim": True,
            "stored_same_account_claim": True,
            "read_failed": False,
        }
        self.assertEqual(module.safe_stored_chatgpt_candidate_observation(raw), raw)

    def test_stored_chatgpt_projection_rejects_secrets_and_malformed(self):
        good = {
            "stored_record_present": True,
            "stored_record_ambiguous": False,
            "stored_work_allowed_claim": True,
            "stored_ai_resolved_claim": True,
            "stored_envelope_present": True,
            "stored_profile_present": True,
            "stored_same_generation_claim": True,
            "stored_same_account_claim": True,
            "read_failed": False,
        }
        failure = {**{key: False for key in good if key != "read_failed"}, "read_failed": True}
        for bad in (
            None, "SECRET_TOKEN", {"read_failed": True},
            {**good, "access_token": "SECRET_TOKEN"},
            {**good, "stored_work_allowed_claim": "true"},
            {**good, "stored_record_present": 1},
            {key: value for key, value in good.items() if key != "stored_ai_resolved_claim"},
        ):
            with self.subTest(input_type=type(bad).__name__):
                observed = module.safe_stored_chatgpt_candidate_observation(bad)
                self.assertEqual(observed, failure)
                self.assertNotIn("SECRET_TOKEN", str(observed))

    def test_stored_candidate_hint_never_claims_accepted_grant(self):
        # These are storage hints, not verified signed or online authority.
        raw = {
            "stored_record_present": True,
            "stored_record_ambiguous": False,
            "stored_work_allowed_claim": False,
            "stored_ai_resolved_claim": False,
            "stored_envelope_present": False,
            "stored_profile_present": False,
            "stored_same_generation_claim": False,
            "stored_same_account_claim": False,
            "read_failed": False,
        }
        value = module.safe_stored_chatgpt_candidate_observation(raw)
        self.assertTrue(value["stored_record_present"])
        self.assertFalse(value["stored_work_allowed_claim"])
        self.assertNotIn("verified", value)
        self.assertNotIn("signed_work_allowed", value)


    def test_late_signed_snapshot_projection_is_fixed_boolean_only(self):
        late = {
            "post_abort_signed_envelope_verified": True,
            "post_abort_signed_account_matches_expected": True,
            "post_abort_signed_chatgpt_resolved": True,
            "post_abort_signed_profile_material_valid": True,
            "post_abort_signed_unexpired_wall_clock_only": True,
            "post_abort_probe_read_failed": False,
            "at_abort_grant_entitlement_proven": False,
        }
        self.assertEqual(module.safe_post_abort_signed_snapshot_observation(late), late)
        self.assertNotIn("signed_work_allowed", late)
        self.assertFalse(late["at_abort_grant_entitlement_proven"])

    def test_late_signed_snapshot_cannot_promote_bad_fields_or_secrets(self):
        valid = {
            "post_abort_signed_envelope_verified": True,
            "post_abort_signed_account_matches_expected": True,
            "post_abort_signed_chatgpt_resolved": True,
            "post_abort_signed_profile_material_valid": True,
            "post_abort_signed_unexpired_wall_clock_only": True,
            "post_abort_probe_read_failed": False,
            "at_abort_grant_entitlement_proven": False,
        }
        expected = {
            **{k: False for k in valid if k != "post_abort_probe_read_failed"},
            "post_abort_probe_read_failed": True,
        }
        for bad in (
            None, "SYNTHETIC_PRIVATE_TOKEN",
            {**valid, "access_token": "SYNTHETIC_PRIVATE_TOKEN"},
            {**valid, "post_abort_signed_envelope_verified": 1},
            {**valid, "post_abort_signed_account_matches_expected": "true"},
            {**valid, "at_abort_grant_entitlement_proven": True},
            {k: v for k, v in valid.items()
             if k != "post_abort_signed_profile_material_valid"},
        ):
            with self.subTest(source_type=type(bad).__name__):
                result = module.safe_post_abort_signed_snapshot_observation(bad)
                self.assertEqual(result, expected)
                self.assertNotIn("SYNTHETIC_PRIVATE_TOKEN", str(result))

    def test_late_signed_snapshot_cannot_claim_signed_grant_on_failed_probe(self):
        minimal = {
            "post_abort_signed_envelope_verified": False,
            "post_abort_signed_account_matches_expected": False,
            "post_abort_signed_chatgpt_resolved": False,
            "post_abort_signed_profile_material_valid": False,
            "post_abort_signed_unexpired_wall_clock_only": False,
            "post_abort_probe_read_failed": True,
            "at_abort_grant_entitlement_proven": False,
        }
        self.assertEqual(module.safe_post_abort_signed_snapshot_observation(minimal), minimal)
        for bad in (
            {**minimal, "post_abort_signed_account_matches_expected": True},
            {**minimal, "post_abort_probe_read_failed": True,
             "post_abort_signed_envelope_verified": True},
        ):
            result = module.safe_post_abort_signed_snapshot_observation(bad)
            self.assertEqual(result, minimal)
            self.assertFalse(result["at_abort_grant_entitlement_proven"])

    def test_embedded_post_abort_signed_probe_has_bounded_boolean_surface(self):
        # Run the exact worker.evaluate code without a browser or real signer.
        # This synthetic mock never establishes true signed Work authority.
        import json
        import os
        import subprocess

        source = Path(__file__).with_name("installed_local_integration.py").read_text()
        marker = 'diagnostic = worker.evaluate("""async ({tabId, trust, expectedAccountId}) => {'
        self.assertEqual(source.count(marker), 1)
        embedded = "async ({tabId, trust, expectedAccountId}) => {" + source.split(marker, 1)[1].split('"""', 1)[0]
        node = r"""
import vm from "node:vm";
import fs from "node:fs";
import assert from "node:assert/strict";
const {code} = JSON.parse(fs.readFileSync(0, "utf8"));
for (const mode of ["valid", "invalid", "error", "missing", "other_family"]) {
  const id = "SYNTHETIC_EXPECTED_ACCOUNT";
  const profile = {syntheticMaterial:"SOURCE_TEST_ONLY"};
  let verifications = 0;
  const saved = {seller_agents_control_auth_v2:{
    generation: 5, authority:{payload:{account:{id}}},
    grants:mode === "missing" ? {} : {scope:{authority:{
      requestedAi:"chatgpt", workAllowed:true,
      envelope:{synthetic:"NOT_REAL_SIGNED_ENVELOPE"},
      payload:{account:{id}, ai:{status:"RESOLVED", profile}}
    }}}
  }};
  const context = {
    chrome:{storage:{local:{get:async()=>saved}}},
    SellerAgentsControlClient:{status:async()=>({authenticated:true,workAllowed:true,pending:false})},
    SellerAgentsBootstrapVerifier:{verifyV2:async(e,trust)=>{
      verifications++;
      assert.equal(e.synthetic,"NOT_REAL_SIGNED_ENVELOPE");
      assert.equal(trust.kind,"SYNTHETIC_PUBLIC_TRUST");
      if(mode==="error") throw new Error("PRIVATE_SYNTHETIC_SIGNER_ERROR");
      if(mode==="invalid") return {ok:false,error:"MALFORMED"};
      return {ok:true,payload:{account:{id},ai:{
        status:"RESOLVED", detected:{family:mode==="other_family"?"alice":"chatgpt",surface:"web",variant:null},
        profile
      },expiresAt:new Date(Date.now()+3600000).toISOString()}};
    }},
    SellerAgentsSignedAiProfileConsumer:{
      validMaterialShape:p=>p===profile,
      validMaterial:async p=>p===profile
    },setTimeout,clearTimeout
  };
  const fn = vm.runInNewContext("(" + code + ")",context);
  const result = await fn({tabId:1,trust:{kind:"SYNTHETIC_PUBLIC_TRUST"},expectedAccountId:id});
  const row=result.post_abort_signed_snapshot;
  const output=JSON.stringify(result);
  assert.equal(row.at_abort_grant_entitlement_proven,false);
  assert.equal(Object.keys(row).length,7);
  assert.ok(Object.values(row).every(x=>typeof x==="boolean"));
  assert.ok(!output.includes("NOT_REAL_SIGNED_ENVELOPE"));
  assert.ok(!output.includes("PRIVATE_SYNTHETIC"));
  assert.ok(!output.includes(id));
  if(mode==="valid"){
    assert.equal(row.post_abort_signed_envelope_verified,true);
    assert.equal(row.post_abort_signed_profile_material_valid,true);
    assert.equal(row.post_abort_signed_chatgpt_resolved,true);
    assert.equal(row.post_abort_signed_unexpired_wall_clock_only,true);
  }else if(mode==="invalid"){
    assert.equal(row.post_abort_signed_envelope_verified,false);
    assert.equal(row.post_abort_probe_read_failed,false);
  }else if(mode==="error"||mode==="missing"){
    assert.equal(row.post_abort_probe_read_failed,true);
    assert.equal(row.post_abort_signed_envelope_verified,false);
  }else if(mode==="other_family"){
    assert.equal(row.post_abort_signed_envelope_verified,true);
    assert.equal(row.post_abort_signed_chatgpt_resolved,false);
    assert.equal(row.post_abort_signed_profile_material_valid,false);
  }
  assert.equal(verifications,mode==="missing"?0:1);
}
process.stdout.write("LATE_SIGNED_VM_5_PASS");
"""
        completed = subprocess.run(
            [os.environ.get("SA_NODE_BIN", "node"), "--input-type=module", "-e", node],
            input=json.dumps({"code": embedded}), text=True,
            capture_output=True, timeout=20, check=False,
        )
        self.assertEqual(completed.returncode, 0, "LATE_SIGNED_VM_REGRESSION")
        self.assertEqual(completed.stdout, "LATE_SIGNED_VM_5_PASS")

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



if __name__ == "__main__":
    unittest.main()
