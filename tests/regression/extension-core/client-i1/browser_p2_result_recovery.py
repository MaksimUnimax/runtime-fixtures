"""Real unpacked Chromium P2 result-recovery matrix.

This deliberately uses the same BrowserFixture and synthetic provider boundary
as P1.  It exercises the composed source and ZIP-extracted MV3 runtimes; no
marketplace or AI service is contacted.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

from browser_c1_acceptance import SyntheticHealthServer, wait_for
from browser_p1_provider_outcome import (
    CONVERSATION_KEY,
    MANUAL,
    P1_FIXTURE,
    BrowserFixture,
    direct_command,
    fire_command,
    fixture_count,
    install_provider_fixture,
    prepare,
    provider_attempt,
)


def delivery_message(fixture, operation, kind, **extra):
    return fixture.worker.evaluate(
        "async ({message, sender}) => saHandleMessage(message, sender)",
        {
            "message": {
                "type": kind,
                "owner_kind": "manual",
                "owner_id": operation["operation_id"],
                "conversation_key": CONVERSATION_KEY,
                "delivery_id": operation["delivery"]["delivery_id"],
                "actor_id": "p2-browser-delivery",
                "assistant_baseline_ids": ["p2-browser-baseline"],
                **extra,
            },
            "sender": {"tab": {"id": fixture.tab_id, "url": f"https://chatgpt.com/c/{CONVERSATION_KEY.split('|', 1)[1]}"},
                       "url": f"https://chatgpt.com/c/{CONVERSATION_KEY.split('|', 1)[1]}"},
        },
    )


def run_runtime(runtime: Path, private_key: Path, server: SyntheticHealthServer, output: Path):
    rows = []
    with sync_playwright() as pw:
        fixture = BrowserFixture(runtime, private_key, server, output)
        fixture.open(pw)
        try:
            # P2-01/02/03/04: persist the known provider result, kill the real
            # MV3 context after that commit, and let a new worker finish locally.
            prepare(fixture, server)
            install_provider_fixture(fixture)
            fixture.worker.evaluate("""() => {
              globalThis.__SELLER_AGENTS_TEST_HOOKS = {
                afterResultBufferCommit: async () => new Promise(resolve => { globalThis.__p2Release = resolve; })
              };
            }""")
            fire_command(fixture, 'OZON_API_V1 {"operation":"seller_info","params":{}}')
            wait_for(lambda: fixture_count(fixture)["attempts"] == 1, "P2 provider response")
            wait_for(lambda: (provider_attempt(fixture)[0].get("batch") or {}).get("entries", [{}])[0].get("result_buffer", {}).get("phase") == "BUFFERED", "P2 durable result buffer")
            before = fixture_count(fixture)["attempts"]
            fixture.restart()
            wait_for(lambda: fixture.storage().get(MANUAL, {}).get(CONVERSATION_KEY, {}).get("status") != "requesting", "P2 local recovery after worker restart")
            recovered = fixture.storage()[MANUAL][CONVERSATION_KEY]
            assert fixture_count(fixture)["attempts"] == before == 1
            assert recovered["batch"]["entries"][0]["result_phase"] == "MATERIALIZED"
            assert recovered["batch"]["entries"][0]["provider_attempt"]["state"] == "COMPLETED_KNOWN"
            rows.append({"id": "BROWSER-P2-01/02/03/04", "status": "PASS", "provider_additional_calls": 0, "result_phase": "MATERIALIZED"})

            # P2-05/06: the known result path remains local when the control
            # server is unavailable; sync/restart is not a delivery trigger.
            server.stop()
            before_recovery = fixture_count(fixture)["attempts"]
            fixture.worker.evaluate("async()=>{try{await SellerAgentsSyncJournal?.syncNow?.('p2-server-outage')}catch{}}")
            fixture.reload_popup()
            assert fixture_count(fixture)["attempts"] == before_recovery
            rows.append({"id": "BROWSER-P2-05/06", "status": "PASS", "control_server": "unavailable", "provider_additional_calls": 0})

            # P2-DELIVERY-UNKNOWN: committing the irreversible insert boundary
            # and restarting must not grant a second automatic send.
            prepare(fixture, server)
            install_provider_fixture(fixture)
            direct_command(fixture, 'OZON_API_V1 {"operation":"seller_info","params":{}}')
            wait_for(lambda: fixture.storage().get(MANUAL, {}).get(CONVERSATION_KEY, {}).get("status") == "delivering", "P2 delivery state")
            operation = fixture.storage()[MANUAL][CONVERSATION_KEY]
            committed = delivery_message(fixture, operation, "OZ_BATCH_DELIVERY_INSERT_COMMIT")
            assert committed.get("insert_allowed") is True or committed.get("outcome_unknown") is True, committed
            fixture.restart()
            restored = fixture.storage()[MANUAL][CONVERSATION_KEY]
            assert restored["delivery"]["phase"] == "insert_committed"
            assert fixture_count(fixture)["attempts"] == 1
            rows.append({"id": "BROWSER-P2-DELIVERY-UNKNOWN", "status": "PASS", "automatic_additional_sends": 0, "phase": "insert_committed"})
        finally:
            fixture.close()
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
    results = {}
    for label, runtime in [("source", args.source_runtime), ("extracted", args.extracted_runtime)]:
        server = SyntheticHealthServer(args.private_key).start()
        try:
            results[label] = run_runtime(runtime.resolve(), args.private_key.resolve(), server, args.output / label)
        finally:
            server.stop()
    summary = {"status": "PASS", "browser": "Playwright Chromium", "candidates": results}
    (args.output / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
