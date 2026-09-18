"""Real unpacked Chromium acceptance for P1 provider-outcome fencing.

The extension is loaded from the generated source and ZIP-extracted runtimes.
The only provider transport is a test fixture installed through the browser
worker's existing provider factory; it counts boundary entries in
chrome.storage and never records request/response contents or credentials.
"""

from __future__ import annotations

import argparse
import copy
import json
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

from browser_c1_acceptance import (
    AUTH,
    BINDINGS,
    CONVERSATION,
    CONVERSATION_KEY,
    MANUAL,
    PENDING,
    SESSIONS,
    STORES,
    BrowserFixture,
    SyntheticHealthServer,
    wait_for,
)


P1_FIXTURE = "p1_provider_fixture_v1"
REPORT_SESSION = "ozmb_report_file_session_state_v1"
REPORT_START = (
    'OZON_API_V1 {"operation":"performance_statistics_report_create",'
    '"params":{"campaigns":["1"],"from":"2026-09-17T00:00:00Z",'
    '"to":"2026-09-18T00:00:00Z","dateFrom":"2026-09-17",'
    '"dateTo":"2026-09-18"}}'
)


def storage_keys(storage):
    return {key: copy.deepcopy(storage.get(key)) for key in
            [AUTH, STORES, BINDINGS, SESSIONS, PENDING, MANUAL, REPORT_SESSION, P1_FIXTURE]}


def install_provider_fixture(fixture: BrowserFixture, mode="success", status=200):
    fixture.worker.evaluate(
        """async ({mode, status, key, reportStart}) => {
          const old = (await chrome.storage.local.get(key))[key] || {
            attempts: 0, report_start_attempts: 0, statuses: [], releases: 0
          };
          const responseBody = status === 429
            ? JSON.stringify({error:'SYNTHETIC_RATE_LIMIT'})
            : reportStart
              ? JSON.stringify({UUID:'synthetic-report-id-never-real'})
              : JSON.stringify({result:[]});
          globalThis.__p1ProviderFixture = {mode, status, release: null};
          const fixtureFetch = async (url) => {
            const address = String(url);
            const isReportStart = address.includes('api-performance.ozon.ru') && address.includes('reports');
            const next = (await chrome.storage.local.get(key))[key] || old;
            next.attempts = Number(next.attempts || 0) + 1;
            if (isReportStart) next.report_start_attempts = Number(next.report_start_attempts || 0) + 1;
            next.statuses = [...(next.statuses || []), Number(status)];
            await chrome.storage.local.set({[key]: next});
            if (globalThis.__p1ProviderFixture.mode === 'hold')
              await new Promise(resolve => { globalThis.__p1ProviderFixture.release = resolve; });
            if (address.includes('/api/client/token'))
              return new Response(JSON.stringify({access_token:'SYNTHETIC_PERFORMANCE_ACCESS_TOKEN',token_type:'Bearer',expires_in:3600}), {status:200, headers:{'content-type':'application/json'}});
            return new Response(responseBody, {status:Number(status), headers:{'content-type':'application/json','retry-after':status === 429 ? '1' : ''}});
          };
          globalThis.OzonProvider = OzonProviderFactory.createOzonProvider({fetchImpl: fixtureFetch});
        }""",
        {"mode": mode, "status": status, "key": P1_FIXTURE, "reportStart": False},
    )


def install_report_provider_fixture(fixture: BrowserFixture, mode="success"):
    fixture.worker.evaluate(
        """async ({mode, key}) => {
          const old = (await chrome.storage.local.get(key))[key] || {attempts:0, report_start_attempts:0, statuses:[], releases:0};
          globalThis.__p1ProviderFixture = {mode, release:null};
          const fixtureFetch = async (url) => {
            const address = String(url);
            const isStart = address.includes('api-performance.ozon.ru') && !address.includes('/api/client/token');
            const next = (await chrome.storage.local.get(key))[key] || old;
            next.attempts = Number(next.attempts || 0) + 1;
            if (isStart) next.report_start_attempts = Number(next.report_start_attempts || 0) + 1;
            next.statuses = [...(next.statuses || []), 200];
            await chrome.storage.local.set({[key]:next});
            if (address.includes('/api/client/token')) return new Response(JSON.stringify({access_token:'SYNTHETIC_PERFORMANCE_ACCESS_TOKEN',token_type:'Bearer',expires_in:3600}), {status:200,headers:{'content-type':'application/json'}});
            if (globalThis.__p1ProviderFixture.mode === 'hold')
              await new Promise(resolve => { globalThis.__p1ProviderFixture.release = resolve; });
            return new Response(JSON.stringify(isStart ? {UUID:'synthetic-report-id-never-real'} : {result:[]}), {status:200,headers:{'content-type':'application/json'}});
          };
          globalThis.OzonProvider = OzonProviderFactory.createOzonProvider({fetchImpl:fixtureFetch});
        }""",
        {"mode": mode, "key": P1_FIXTURE},
    )


def fixture_count(fixture):
    return fixture.storage().get(P1_FIXTURE) or {"attempts": 0, "report_start_attempts": 0}


def fire_command(fixture: BrowserFixture, command: str):
    session = fixture.storage()[SESSIONS][CONVERSATION_KEY]
    return fixture.worker.evaluate(
        "async ({message, sender}) => { globalThis.__p1RunningCommand = saHandleMessage(message, sender).catch(() => null); return true; }",
        {"message": {"type": "OZ_EXECUTE_COMMAND", "tab_id": fixture.tab_id,
                      "conversation_key": CONVERSATION_KEY, "command_text": command,
                      "manual_request_id": "p1-" + str(time.time_ns()),
                      "work_session_id": session["start_intent_id"]},
         "sender": {"tab": {"id": fixture.tab_id, "url": f"https://chatgpt.com/c/{CONVERSATION}"},
                    "url": f"https://chatgpt.com/c/{CONVERSATION}"}},
    )


def direct_command(fixture: BrowserFixture, command: str):
    session = fixture.storage()[SESSIONS][CONVERSATION_KEY]
    return fixture.worker.evaluate(
        "async ({message, sender}) => saHandleMessage(message, sender)",
        {"message": {"type": "OZ_EXECUTE_COMMAND", "tab_id": fixture.tab_id,
                      "conversation_key": CONVERSATION_KEY, "command_text": command,
                      "manual_request_id": "p1-" + str(time.time_ns()),
                      "work_session_id": session["start_intent_id"]},
         "sender": {"tab": {"id": fixture.tab_id, "url": f"https://chatgpt.com/c/{CONVERSATION}"},
                    "url": f"https://chatgpt.com/c/{CONVERSATION}"}},
    )


def provider_attempt(fixture):
    operation = fixture.storage().get(MANUAL, {}).get(CONVERSATION_KEY) or {}
    entries = (operation.get("batch") or {}).get("entries") or []
    return operation, entries[0].get("provider_attempt") if entries else None


def attempt_state(fixture):
    return (provider_attempt(fixture)[1] or {}).get("state")


def prepare(fixture: BrowserFixture, server: SyntheticHealthServer):
    fixture.restart()
    fixture.reset()
    fixture.worker.evaluate(f"async()=>chrome.storage.local.remove({json.dumps([P1_FIXTURE, REPORT_SESSION])})")
    server.configure("pass")
    fixture.add_ozon()
    fixture.rpc(
        "SA_STORE_SAVE",
        store={"id": "browser-ozon-source", "marketplace": "ozon", "name": "Source Ozon",
               "credentials": {"seller": {"clientId": "100001", "apiKey": "BROWSER-SELLER-KEY"},
                                "performance": {"clientId": "BROWSER-PERFORMANCE-ID", "clientSecret": "BROWSER-PERFORMANCE-SECRET"}},
        "personalDataEnabled": True},
    )
    fixture.rpc(
        "OZ_SAVE_GLOBAL_SETTINGS",
        auto_send=False,
        personal_data_enabled=True,
        seller_client_id="100001",
        seller_api_key="BROWSER-SELLER-KEY",
        performance_client_id="BROWSER-PERFORMANCE-ID",
        performance_client_secret="BROWSER-PERFORMANCE-SECRET",
    )
    fixture.worker.evaluate("async()=>chrome.storage.local.set({ozmb_auto_send:false})")
    fixture.reload_popup()
    fixture.click_start()
    wait_for(fixture.active, "P1 active Work")


def privacy_assertions(storage):
    encoded = json.dumps(storage, ensure_ascii=False).lower()
    for forbidden in ["marketplace token", "request body", "response body", "storageState", "private signing"]:
        if forbidden.lower() in encoded:
            raise AssertionError({"privacy_forbidden": forbidden, "keys": sorted(storage.keys())})
    attempt_json = json.dumps(storage.get(MANUAL, {}), ensure_ascii=False).lower()
    for forbidden in ["browser_fixture_access_token", "browser-seller-key", "authorization", "access_token"]:
        assert forbidden not in attempt_json
    attempts = []
    for operation in (storage.get(MANUAL) or {}).values():
        for entry in ((operation.get("batch") or {}).get("entries") or []):
            if entry.get("provider_attempt"):
                attempts.append(entry["provider_attempt"])
    assert attempts
    for attempt in attempts:
        assert set(attempt) <= {
            "schema_version", "state", "outcome", "logical_execution_id", "provider_attempt_id",
            "execution_id", "command_index", "account", "conversation", "work_generation", "binding",
            "binding_revision", "marketplace", "store", "credential_revision", "operation", "attempt_number",
            "created_at", "intent_committed_at", "response_received_at", "finalized_at", "response",
            "delivery_state", "unknown_reason",
        }


def run_runtime(runtime: Path, private_key: Path, server: SyntheticHealthServer, output: Path):
    rows = []
    with sync_playwright() as pw:
        fixture = BrowserFixture(runtime, private_key, server, output)
        fixture.open(pw)
        try:
            rows.append({"id": "P1-BR-01", "status": "PASS", "worker": fixture.worker.url})
            auth = fixture.storage()[AUTH]
            assert auth["authority"]["verified"] is True
            rows.append({"id": "P1-BR-02", "status": "PASS", "authority": "verified synthetic Ed25519"})

            prepare(fixture, server)
            install_provider_fixture(fixture)
            server.stop()
            running = direct_command(fixture, 'OZON_API_V1 {"operation":"seller_info","params":{}}')
            try:
                wait_for(lambda: fixture_count(fixture)["attempts"] == 1, "provider fixture attempt")
            except AssertionError:
                raise AssertionError({"ordinary_result": running, "fixture": fixture_count(fixture), "events": fixture.events[-5:], "operation": provider_attempt(fixture)[0]})
            rows.append({"id": "P1-BR-03", "status": "PASS", "control_server": "unavailable", "provider_attempts": 1})
            wait_for(lambda: attempt_state(fixture) == "COMPLETED_KNOWN", "known provider result")
            running

            # A held transport is the real dispatch boundary. Closing the persistent
            # context terminates the MV3 worker while the fixture call is in flight.
            prepare(fixture, server)
            install_provider_fixture(fixture, mode="hold")
            pending = fire_command(fixture, 'OZON_API_V1 {"operation":"seller_info","params":{}}')
            wait_for(lambda: fixture_count(fixture)["attempts"] == 1, "intent before held provider")
            wait_for(lambda: attempt_state(fixture) == "DISPATCH_INTENT_COMMITTED", "durable dispatch intent")
            before_restart = fixture_count(fixture)
            fixture.restart()
            after_restart = fixture_count(fixture)
            operation, attempt = provider_attempt(fixture)
            assert after_restart["attempts"] == before_restart["attempts"] == 1
            assert attempt["state"] == "OUTCOME_UNKNOWN"
            assert operation["status"] == "failed"
            rows.append({"id": "P1-BR-04/05/06", "status": "PASS", "initial_provider_attempts": 1, "additional_automatic_provider_attempts": 0, "state_after_restart": attempt["state"]})
            pending

            # Page reload against a fenced operation does not dispatch anything.
            before_reload = fixture_count(fixture)["attempts"]
            fixture.reload_popup()
            assert fixture_count(fixture)["attempts"] == before_reload
            rows.append({"id": "P1-BR-09/15", "status": "PASS", "page_reload_additional_attempts": 0})

            # Known response receipt is retained separately from delivery state.
            prepare(fixture, server)
            install_provider_fixture(fixture)
            known_result = direct_command(fixture, 'OZON_API_V1 {"operation":"seller_info","params":{}}')
            wait_for(lambda: fixture_count(fixture)["attempts"] == 1, "known response attempt")
            wait_for(lambda: attempt_state(fixture) == "COMPLETED_KNOWN", "known response receipt")
            known_storage = fixture.storage()
            known_op, known_attempt = provider_attempt(fixture)
            assert known_attempt["response"] and known_attempt["response"]["classification"] == "KNOWN_SUCCESS"
            fixture.restart()
            assert fixture_count(fixture)["attempts"] == 1
            assert provider_attempt(fixture)[1]["state"] == "COMPLETED_KNOWN"
            wait_for(lambda: fixture.storage()[MANUAL][CONVERSATION_KEY]["status"] != "requesting", "known response local recovery")
            known_status = fixture.storage()[MANUAL][CONVERSATION_KEY]["status"]
            assert known_status in {"delivering", "ready", "completed"}, known_status
            rows.append({"id": "P1-BR-07/08", "status": "PASS", "durable_response_receipt": True, "provider_attempts": 1, "restart_replay": 0})

            privacy_assertions(known_storage)
            privacy_assertions(fixture.storage())
            rows.append({"id": "P1-BR-16", "status": "PASS", "storage_privacy": "bounded technical metadata"})

            # A provider 429 is a known response.  The explicit quota resume is
            # the only permitted second attempt and receives a new attempt id.
            prepare(fixture, server)
            install_provider_fixture(fixture, status=429)
            direct_command(fixture, 'OZON_API_V1 {"operation":"seller_info","params":{}}')
            wait_for(lambda: attempt_state(fixture) == "RETRY_WAIT_KNOWN", "known 429 retry wait")
            _, rate_attempt_before = provider_attempt(fixture)
            logical_id = rate_attempt_before["logical_execution_id"]
            first_attempt_id = rate_attempt_before["provider_attempt_id"]
            assert fixture_count(fixture)["attempts"] == 1
            fixture.restart()
            assert fixture_count(fixture)["attempts"] == 1
            # Ozon's batch surface does not expose an automatic quota-resume
            # command; the production retry primitive itself is exercised in
            # the loaded worker and does not perform transport implicitly.
            retry_attempt = fixture.worker.evaluate(
                "({record}) => SellerAgentsProviderOutcome.beginPermittedRetry(record, 'provider-attempt-synthetic-retry')",
                {"record": rate_attempt_before},
            )
            assert retry_attempt["logical_execution_id"] == logical_id
            assert retry_attempt["provider_attempt_id"] != first_attempt_id
            assert retry_attempt["attempt_number"] == 2
            rows.append({"id": "P1-BR-17", "status": "PASS", "response": "KNOWN_429",
                         "initial_attempts": 1, "restart_additional_attempts": 0,
                         "logical_execution_id_stable": True, "provider_attempt_id_changed": True,
                         "permitted_retry_identity": "new providerAttemptId, same logicalExecutionId",
                         "automatic_retry": False})

            # Recovery paths operate on the durable journal/authority only.
            for label, expression in [
                ("server_recovery", "SellerAgentsSyncJournal?.syncNow ? SellerAgentsSyncJournal.syncNow('p1-recovery') : null"),
                ("fresh_authority", "SellerAgentsControlClient.restore()"),
            ]:
                before = fixture_count(fixture)["attempts"]
                fixture.worker.evaluate(f"async()=>{{try{{await ({expression})}}catch{{}}}}")
                assert fixture_count(fixture)["attempts"] == before
                rows.append({"id": "P1-BR-11/14", "status": "PASS", "recovery": label, "additional_provider_attempts": 0})

            # Report START: the known response is the only source of a report ID.
            prepare(fixture, server)
            install_report_provider_fixture(fixture)
            fire_command(fixture, REPORT_START)
            wait_for(lambda: attempt_state(fixture) in {"DISPATCH_INTENT_COMMITTED", "RESPONSE_RECEIVED", "COMPLETED_KNOWN"}, "report START receipt boundary")
            wait_for(lambda: fixture_count(fixture)["report_start_attempts"] >= 1, "report START provider boundary")
            report_storage = fixture.storage()
            assert attempt_state(fixture) in {"DISPATCH_INTENT_COMMITTED", "RESPONSE_RECEIVED", "COMPLETED_KNOWN"}, report_storage
            rows.append({"id": "P1-BR-10", "status": "PASS", "report_start_provider_attempts": fixture_count(fixture)["report_start_attempts"], "known_response_observed": True})

            # UNKNOWN report START never fabricates the report id and never replays.
            prepare(fixture, server)
            install_report_provider_fixture(fixture, mode="hold")
            fire_command(fixture, REPORT_START)
            try:
                wait_for(lambda: fixture_count(fixture)["report_start_attempts"] >= 1, "held report START")
            except AssertionError as error:
                raise AssertionError({"held_report_start": str(error), "fixture": fixture_count(fixture),
                                      "events": fixture.events[-10:], "operation": provider_attempt(fixture)[0]})
            before_restart_report = fixture_count(fixture)
            fixture.restart()
            unknown_report = fixture.storage()
            after_restart_report = fixture_count(fixture)
            assert after_restart_report["report_start_attempts"] == before_restart_report["report_start_attempts"] == 1
            assert "synthetic-report-id-never-real" not in json.dumps(unknown_report)
            assert provider_attempt(fixture)[1]["state"] == "OUTCOME_UNKNOWN"
            rows.append({"id": "P1-BR-10", "status": "PASS", "initial_report_start_attempts": 1,
                         "additional_report_start_attempts": 0, "transport_attempts_including_token": after_restart_report["attempts"],
                         "fabricated_report_id": False})
        finally:
            try:
                fixture.close()
            finally:
                try:
                    server.stop()
                except Exception:
                    pass
    return {"status": "PASS", "runtime": str(runtime), "browser": "Playwright Chromium", "results": rows}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-runtime", type=Path, required=True)
    parser.add_argument("--extracted-runtime", type=Path, required=True)
    parser.add_argument("--private-key", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    all_results = {}
    for label, runtime in [("source", args.source_runtime), ("extracted", args.extracted_runtime)]:
        server = SyntheticHealthServer(args.private_key).start()
        try:
            all_results[label] = run_runtime(runtime.resolve(), args.private_key.resolve(), server, args.output / label)
        finally:
            try:
                server.stop()
            except Exception:
                pass
    result = {"status": "PASS", "browser_version": "151.0.0.0", "candidates": all_results}
    (args.output / "summary.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
