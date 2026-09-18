"""P3 real unpacked Chromium wake/restart smoke matrix.

The task is synthetic and local-only: it exercises the persisted coordinator,
MV3 context restart, duplicate wake convergence, and idle alarm behavior.
No marketplace transport is installed or contacted.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

from browser_c1_acceptance import BrowserFixture, SyntheticHealthServer, wait_for


SCHEDULER_KEY = "seller_agents_technical_wake_v1"


def run_runtime(runtime: Path, private_key: Path, server: SyntheticHealthServer, output: Path):
    with sync_playwright() as pw:
        fixture = BrowserFixture(runtime, private_key, server, output)
        fixture.open(pw)
        try:
            due = int(time.time() * 1000) + 60_000
            fixture.worker.evaluate(
                """async ({due}) => SellerAgentsTechnicalScheduler.schedule(
                  SellerAgentsTechnicalScheduler.KINDS.EXPIRY,
                  {taskId:'expiry:p3-browser', dueAt:due, identity:{artifactKey:'p3-browser-artifact', deliveryId:'p3-browser-delivery'}}
                )""",
                {"due": due},
            )
            stored = fixture.storage().get(SCHEDULER_KEY, {})
            assert stored.get("entries", {}).get("expiry:p3-browser")
            fixture.restart()
            after_restart = fixture.worker.evaluate("async()=>SellerAgentsTechnicalScheduler.state()")
            assert after_restart["entries"].get("expiry:p3-browser")
            fixture.worker.evaluate("async()=>SellerAgentsTechnicalScheduler.wake('p3-browser-alarm')")
            wait_for(
                lambda: "expiry:p3-browser" not in fixture.worker.evaluate("async()=>SellerAgentsTechnicalScheduler.state()")["entries"],
                "P3 durable wake drain",
            )
            fixture.worker.evaluate("async()=>Promise.all([SellerAgentsTechnicalScheduler.wake('late-alarm'), SellerAgentsTechnicalScheduler.wake('duplicate-alarm')])")
            alarms = fixture.worker.evaluate("async()=>chrome.alarms.getAll()")
            assert not any(item.get("periodInMinutes") for item in alarms)
            assert not any("api-seller.ozon.ru" in event["url"] or "wildberries.ru" in event["url"] for event in fixture.events)
            return {"status": "PASS", "browser": "Playwright Chromium", "restart_count": 1, "duplicate_wakes": 2, "marketplace_requests": 0, "periodic_scheduler_alarms": 0}
        finally:
            fixture.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-runtime", type=Path, required=True)
    parser.add_argument("--extracted-runtime", type=Path, required=True)
    parser.add_argument("--private-key", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    results = {}
    for label, runtime in [("source", args.source_runtime), ("extracted", args.extracted_runtime)]:
        server = SyntheticHealthServer(args.private_key).start()
        try:
            results[label] = run_runtime(runtime.resolve(), args.private_key.resolve(), server, args.output / label)
        finally:
            server.stop()
    summary = {"status": "PASS", "candidates": results}
    (args.output / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
