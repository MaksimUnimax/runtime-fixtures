"""Native Chromium D3S2 store metadata/state acceptance matrix.

This is test infrastructure only. Store mutations go through the extension
popup and runtime message boundary. The loopback sync endpoint returns only
synthetic metadata and never receives credential-bearing payloads.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

from browser_c1_acceptance import (
    BINDINGS,
    CONVERSATION_KEY,
    MANUAL,
    SESSIONS,
    STORES,
    SYNC_JOURNAL,
    BrowserFixture,
    SyntheticHealthServer,
    wait_for,
)


def store_named(fixture: BrowserFixture, name: str):
    return next(store for store in fixture.state()["stores"] if store["name"] == name)


def ui_add_ozon(fixture: BrowserFixture, name: str, key: str):
    fixture.popup.click("#ozon")
    fixture.popup.click("#add")
    fixture.popup.locator("#name").fill(name)
    fixture.popup.locator("#seller-id").fill("100001")
    fixture.popup.locator("#seller-key").fill(key)
    fixture.popup.click("#save")
    wait_for(lambda: any(row["name"] == name for row in fixture.state()["stores"]), f"store {name}")
    return store_named(fixture, name)


def ui_rename(fixture: BrowserFixture, store, name: str):
    fixture.popup.select_option("#stores", store["id"])
    fixture.popup.click("#edit")
    fixture.popup.locator("#name").fill(name)
    fixture.popup.click("#save")
    wait_for(lambda: any(row["id"] == store["id"] and row["name"] == name for row in fixture.state()["stores"]), f"rename {name}")
    return next(row for row in fixture.state()["stores"] if row["id"] == store["id"])


def ui_delete(fixture: BrowserFixture, store_id: str):
    fixture.popup.select_option("#stores", store_id)
    fixture.popup.click("#remove")
    fixture.popup.locator("#confirmation").wait_for(state="visible")
    fixture.popup.click("#confirm")
    wait_for(lambda: all(row["id"] != store_id for row in fixture.state()["stores"]), "deleted store hidden")


def raw_store(fixture: BrowserFixture, store_id: str):
    return fixture.worker.evaluate(
        """async ({accountId, storeId}) => {
          const value = (await chrome.storage.local.get('seller_agents_stores_v1')).seller_agents_stores_v1;
          return value?.accounts?.[accountId]?.stores?.[storeId] || null;
        }""",
        {"accountId": "11111111-1111-4222-8111-111111111111", "storeId": store_id},
    )


def journal(fixture: BrowserFixture):
    return fixture.storage().get(SYNC_JOURNAL) or {}


def latest_store_entry(fixture: BrowserFixture):
    entries = [entry for entry in journal(fixture).get("entries", {}).values() if entry.get("kind") in {"STORE_UPSERT", "STORE_TOMBSTONE"}]
    return max(entries, key=lambda entry: entry.get("localSequence", 0)) if entries else None


def apply_remote_metadata(fixture: BrowserFixture, metadata):
    return fixture.worker.evaluate(
        """async (metadata) => SellerAgentsActiveStoreCatalog.applyRemoteMetadata(metadata)""",
        metadata,
    )


def popup_rpc(fixture: BrowserFixture, message_type: str, **fields):
    return fixture.rpc(message_type, **fields)


def no_provider_calls(fixture: BrowserFixture):
    return not any("api-seller.ozon.ru" in event["url"] or "wildberries.ru" in event["url"] for event in fixture.events)


def drain_due_sync(fixture: BrowserFixture):
    future = int(time.time() * 1000) + 120_000
    fixture.worker.evaluate(
        """({future}) => {
          const realNow = Date.now;
          globalThis.__saTestClock = future;
          globalThis.__saRestoreTestClock = () => { Date.now = realNow; };
          Date.now = () => globalThis.__saTestClock;
        }""",
        {"future": future},
    )
    try:
        fixture.worker.evaluate("async()=>SellerAgentsTechnicalScheduler.wake('metadata-fixture-clock')")
        fixture.worker.evaluate("()=>{globalThis.__saTestClock += 5000}")
        fixture.worker.evaluate("async()=>SellerAgentsTechnicalScheduler.wake('metadata-fixture-clock-due')")
    finally:
        fixture.worker.evaluate("()=>globalThis.__saRestoreTestClock?.()")
    time.sleep(0.25)


def privacy_receipt(server: SyntheticHealthServer):
    encoded = json.dumps([row.get("body", {}) for row in server.requests], ensure_ascii=False).lower()
    forbidden = ["browser-seller-key", "browser-performance-secret", "browser-wb-personal-token", "access_token", "refresh_token", "credentials"]
    return {"sync_payload_secret_free": not any(value in encoded for value in forbidden), "forbidden_matches": [value for value in forbidden if value in encoded]}


def run_runtime(runtime: Path, private_key: Path, server: SyntheticHealthServer, output: Path):
    rows = []
    with sync_playwright() as pw:
        fixture = BrowserFixture(runtime, private_key, server, output)
        fixture.open(pw)
        try:
            fixture.reset()

            def case(case_id, description, fn):
                selected = {value for value in os.environ.get("SA_BROWSER_ONLY", "").split(",") if value}
                if selected and case_id not in selected:
                    return
                try:
                    fn()
                    rows.append({"id": case_id, "status": "PASS", "description": description})
                    print(f"[{runtime.name}] {case_id} PASS", flush=True)
                except Exception as error:
                    rows.append({"id": case_id, "status": "FAIL", "description": description, "error": f"{type(error).__name__}: {error!r}"})
                    print(f"[{runtime.name}] {case_id} FAIL: {error}", flush=True)

            stores = {}

            def br01():
                fixture.reset()
                stores["a"] = ui_add_ozon(fixture, "Browser Store A", "BROWSER-SELLER-KEY-A")
                stores["b"] = ui_add_ozon(fixture, "Browser Store B", "BROWSER-SELLER-KEY-B")
                assert stores["a"]["id"] != stores["b"]["id"]
                assert {row["id"] for row in fixture.state()["stores"]} == {stores["a"]["id"], stores["b"]["id"]}

            case("BR-STORE-01", "two popup-created stores retain distinct stable identities and isolation", br01)

            old_revision = {"value": None}

            def br02():
                old_revision["value"] = stores["a"]["credentialRevision"]
                renamed = ui_rename(fixture, stores["a"], "Browser Store A Renamed")
                stores["a"] = renamed
                assert renamed["id"] == stores["a"]["id"]
                assert renamed["credentialRevision"] == old_revision["value"]
                other = store_named(fixture, "Browser Store B")
                assert other["id"] == stores["b"]["id"] and other["name"] == "Browser Store B"

            case("BR-STORE-02", "popup rename changes label only and preserves storeId, credentialRevision, and other store", br02)

            def br03():
                server.configure("pass")
                server.configure_sync("unavailable")
                renamed = ui_rename(fixture, stores["a"], "Browser Store A Offline")
                stores["a"] = renamed
                time.sleep(0.25)
                entry = latest_store_entry(fixture)
                assert renamed["name"] == "Browser Store A Offline"
                assert entry and entry["status"] in {"PENDING", "RETRY_WAIT", "IN_FLIGHT"}
                before = len([row for row in server.requests if row["path"] == "/v1/health-authority"])
                fixture.popup.select_option("#stores", stores["a"]["id"])
                fixture.popup.click("#start")
                wait_for(fixture.active, "offline-rename Work")
                assert len([row for row in server.requests if row["path"] == "/v1/health-authority"]) == before + 1
                fixture.finish()

            case("BR-STORE-03", "offline popup rename is locally usable and ordinary Work does not wait for metadata sync", br03)

            def br04():
                before_name = stores["a"]["name"]
                fixture.restart()
                assert store_named(fixture, before_name)["id"] == stores["a"]["id"]
                assert latest_store_entry(fixture) is not None

            case("BR-STORE-04", "restart preserves renamed local metadata and pending C3E journal state", br04)

            deleted = {}

            def br05():
                fixture.reset()
                stores["a"] = ui_add_ozon(fixture, "Browser Active Delete", "BROWSER-SELLER-KEY-DELETE")
                stores["b"] = ui_add_ozon(fixture, "Browser Survives Delete", "BROWSER-SELLER-KEY-SURVIVES")
                server.configure("pass")
                server.configure_sync("pass")
                fixture.popup.select_option("#stores", stores["a"]["id"])
                fixture.popup.click("#start")
                wait_for(fixture.active, "active store before delete")
                time.sleep(0.5)
                drain_due_sync(fixture)
                server.configure_sync("unavailable")
                deleted["id"] = stores["a"]["id"]
                ui_delete(fixture, deleted["id"])
                assert not fixture.active(), {"work": fixture.storage().get(SESSIONS, {}).get(CONVERSATION_KEY)}
                binding = fixture.storage().get(BINDINGS, {}).get(CONVERSATION_KEY)
                assert binding and binding.get("store_context", {}).get("storeId") == deleted["id"], {"binding": binding}
                assert fixture.storage().get(SESSIONS, {}).get(CONVERSATION_KEY) is None or fixture.storage().get(SESSIONS, {}).get(CONVERSATION_KEY, {}).get("state") == "inactive", {"work": fixture.storage().get(SESSIONS, {}).get(CONVERSATION_KEY)}
                stale_start = popup_rpc(fixture, "SA_WORK_START", store_id=deleted["id"], confirm_change=False, start_intent_id="stale-delete-start")
                assert stale_start.get("ok") is False, {"stale_start": stale_start}

            case("BR-STORE-05", "active store delete through popup is immediate, fences Work, and leaves unrelated store", br05)

            def br06():
                tombstone = raw_store(fixture, deleted["id"])
                entry = latest_store_entry(fixture)
                assert tombstone["lifecycleState"] == "TOMBSTONED"
                assert tombstone["credentials"] == {}
                assert entry["kind"] == "STORE_TOMBSTONE"
                assert "credentials" not in entry["payload"]

            case("BR-STORE-06", "delete persists a compact metadata-only tombstone and pending sync entry", br06)

            def br07():
                fixture.restart()
                fixture.worker.evaluate("async()=>SellerAgentsTechnicalScheduler.cancel('sync:pending')")
                assert raw_store(fixture, deleted["id"])["lifecycleState"] == "TOMBSTONED"
                assert all(row["id"] != deleted["id"] for row in fixture.state()["stores"])

            case("BR-STORE-07", "restart keeps deleted identity tombstoned without silent recreation", br07)

            def br08():
                result = apply_remote_metadata(fixture, {"kind": "STORE_UPSERT", "storeId": deleted["id"], "marketplace": "ozon", "name": "stale-server-name", "credentialRevision": "old-revision", "providerAccountId": None, "providerIdentityState": "UNCONFIRMED", "metadataRevision": 0, "lifecycleState": "ACTIVE"})
                assert result["lifecycleState"] == "TOMBSTONED"
                assert raw_store(fixture, deleted["id"])["lifecycleState"] == "TOMBSTONED"

            case("BR-STORE-08", "reconciliation fixture stale upsert cannot resurrect tombstoned identity", br08)

            def br09():
                result = apply_remote_metadata(fixture, {"kind": "STORE_UPSERT", "storeId": deleted["id"], "marketplace": "ozon", "name": "late-ack-stale", "credentialRevision": "old-revision", "providerAccountId": None, "providerIdentityState": "UNCONFIRMED", "metadataRevision": 0, "lifecycleState": "ACTIVE"})
                assert result["lifecycleState"] == "TOMBSTONED"
                assert raw_store(fixture, deleted["id"])["lifecycleState"] == "TOMBSTONED"

            case("BR-STORE-09", "late ACK carrying stale active metadata cannot roll tombstone back", br09)

            def br10():
                remote_tombstone = raw_store(fixture, deleted["id"])
                second = BrowserFixture(runtime, private_key, server, output / "second")
                second.open(pw)
                try:
                    second.reset()
                    unrelated = ui_add_ozon(second, "Second Installation Unrelated", "BROWSER-SELLER-KEY-SECOND")
                    result = apply_remote_metadata(second, {"kind": "STORE_TOMBSTONE", "storeId": deleted["id"], "marketplace": "ozon", "name": remote_tombstone["name"], "credentialRevision": remote_tombstone["credentialRevision"], "providerAccountId": None, "providerIdentityState": "UNCONFIRMED", "metadataRevision": remote_tombstone["metadataRevision"], "lifecycleState": "TOMBSTONED"})
                    assert result["lifecycleState"] == "TOMBSTONED"
                    assert raw_store(second, deleted["id"])["lifecycleState"] == "TOMBSTONED"
                    assert store_named(second, "Second Installation Unrelated")["id"] == unrelated["id"]
                    assert second.rpc("SA_WORK_START", store_id=deleted["id"], confirm_change=False, start_intent_id="second-stale-work").get("ok") is False
                finally:
                    second.close()

            case("BR-STORE-10", "second persistent Chromium context converges remote tombstone and preserves unrelated store", br10)

            def br11():
                fixture.reset()
                store = ui_add_ozon(fixture, "Credential Revision Fence", "BROWSER-SELLER-KEY-OLD")
                server.configure("pass")
                server.configure_sync("unavailable")
                fixture.popup.select_option("#stores", store["id"])
                fixture.popup.click("#start")
                wait_for(fixture.active, "credential-fence active Work")
                old_binding = fixture.storage()[BINDINGS][CONVERSATION_KEY]["store_context"]["credentialRevision"]
                revision_popup = fixture.context.new_page()
                revision_popup.add_init_script(f"const originalQuery=chrome.tabs.query.bind(chrome.tabs);chrome.tabs.query=(query)=>query.active?Promise.resolve([{{id:{fixture.tab_id}}}]):originalQuery(query);")
                revision_popup.goto(fixture.worker.url.rsplit("/", 1)[0] + "/popup.html")
                wait_for(lambda: "Аккаунт · 11111111" in revision_popup.locator("#account").inner_text(), "revision popup")
                revision_popup.select_option("#stores", store["id"])
                revision_popup.click("#edit")
                revision_popup.locator("#seller-key").fill("BROWSER-SELLER-KEY-NEW")
                revision_popup.click("#save")
                wait_for(lambda: raw_store(fixture, store["id"])["credentialRevision"] != old_binding, "credential revision change")
                stale = popup_rpc(fixture, "SA_WORK_RESUME", conversation_key=CONVERSATION_KEY)
                assert stale.get("ok") is False
                revision_popup.close()

            case("BR-STORE-11", "real credential edit changes opaque revision and fences old bound Work", br11)

            def br12():
                before = len([event for event in fixture.events if "api-seller.ozon.ru" in event["url"] or "wildberries.ru" in event["url"]])
                fixture.restart()
                time.sleep(0.3)
                after = len([event for event in fixture.events if "api-seller.ozon.ru" in event["url"] or "wildberries.ru" in event["url"]])
                assert before == after

            case("BR-STORE-12", "restart/recovery performs no historical marketplace command autorun", br12)

            def br13():
                before_health = len([row for row in server.requests if row["path"] == "/v1/health-authority"])
                apply_remote_metadata(fixture, {"kind": "STORE_TOMBSTONE", "storeId": "metadata-only-probe", "marketplace": "ozon", "name": "metadata-only-probe", "credentialRevision": "opaque-fixture-revision", "providerAccountId": None, "providerIdentityState": "UNCONFIRMED", "metadataRevision": 1, "lifecycleState": "TOMBSTONED"})
                after_health = len([row for row in server.requests if row["path"] == "/v1/health-authority"])
                assert after_health == before_health
                assert no_provider_calls(fixture)
                assert not any("chatgpt.com" in event["url"] and event["method"] == "POST" for event in fixture.events)

            case("BR-STORE-13", "metadata reconciliation has zero provider calls, AI resend, and ordinary mandatory authority calls", br13)

            rows.extend([])
            result = {
                "status": "PASS" if all(row["status"] == "PASS" for row in rows) else "FAIL",
                "browser": "native Chromium",
                "chromium_version": fixture.context.browser.version,
                "runtime": str(runtime),
                "results": rows,
                "provider_requests": 0 if no_provider_calls(fixture) else None,
                "sync_requests": len([row for row in server.requests if row["path"] == "/v1/sync"]),
                "privacy": privacy_receipt(server),
            }
            output.mkdir(parents=True, exist_ok=True)
            (output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
            return result
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
    summary = {"status": "PASS" if all(result["status"] == "PASS" for result in results.values()) else "FAIL", "candidates": results}
    (args.output / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if summary["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
