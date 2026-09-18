"""R4 installed HTTP transport closure for D3S2 store metadata.

Every mutation and reconciliation in this file goes through the unpacked MV3
popup, service worker, C3E journal, /v1/sync client, and the synthetic server.
The server is stateful and records only sanitized request bodies.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import threading
import time
from pathlib import Path
from typing import Any

from browser_c1_acceptance import (
    CONVERSATION_KEY,
    DEVICE,
    SESSION,
    BrowserFixture,
    SYNC_JOURNAL,
    SyntheticHealthServer,
    wait_for,
)
from browser_d3s2_store_metadata import raw_store, store_named, ui_add_ozon, ui_rename


OTHER_DEVICE = "33333333-3333-4333-8333-333333333333"
OTHER_SESSION = "44444444-4444-4444-8444-444444444444"


def canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


class R4Server(SyntheticHealthServer):
    """Synthetic /v1/sync with production-equivalent store state semantics."""

    def __init__(self, private_key_path: Path):
        super().__init__(private_key_path)
        self.states: dict[str, dict[str, Any]] = {}
        self.receipts: dict[str, dict[str, Any]] = {}
        self.applied_requests = 0

    def reset_model(self):
        self.states.clear()
        self.receipts.clear()
        self.applied_requests = 0
        self.configure_sync("unavailable")

    def _sync(self, body: dict[str, Any]) -> dict[str, Any]:
        results = []
        installation = body.get("installationId", "unknown-installation")
        for entry in body.get("entries", []):
            request_id = entry.get("requestId")
            receipt_key = f"{installation}:{request_id}"
            if receipt_key in self.receipts:
                results.append(dict(self.receipts[receipt_key]))
                continue

            payload = dict(entry.get("payload") or {})
            entity_id = str(entry.get("entityId"))
            current = self.states.get(entity_id)
            current_revision = int(current["serverRevision"]) if current else 0
            desired_kind = entry.get("kind")
            desired_state = {**payload, "kind": desired_kind}
            if desired_kind not in {"STORE_UPSERT", "STORE_TOMBSTONE"}:
                row = {
                    "requestId": request_id,
                    "mutationId": entry.get("mutationId"),
                    "entityId": entity_id,
                    "outcome": "ACK",
                    "serverRevision": current_revision + 1,
                    "serverState": desired_state,
                    "code": None,
                }
            elif not current:
                row = self._ack(entry, desired_state, current_revision)
            elif current["state"].get("lifecycleState") == "TOMBSTONED":
                if desired_state.get("lifecycleState") == "TOMBSTONED":
                    row = self._same(entry, current, "IN_SYNC")
                else:
                    row = self._conflict(entry, current, "STORE_TOMBSTONE_DOMINATES")
            elif int(entry.get("baseRevision", 0)) != current_revision:
                if self._same_state(desired_state, current["state"]):
                    row = self._same(entry, current, "IN_SYNC")
                else:
                    row = self._conflict(entry, current, "SYNC_CONFLICT")
            elif int(desired_state.get("metadataRevision", 0)) < int(current["state"].get("metadataRevision", 0)):
                row = self._conflict(entry, current, "STORE_STALE_REVISION")
            else:
                if current["state"].get("providerIdentityState") == "CONFIRMED":
                    desired_state["providerIdentityState"] = "CONFIRMED"
                    desired_state["providerAccountId"] = current["state"].get("providerAccountId")
                row = self._ack(entry, desired_state, current_revision)

            self.receipts[receipt_key] = dict(row)
            if row["outcome"] == "ACK" and row["serverRevision"] > current_revision:
                self.states[entity_id] = {
                    "serverRevision": row["serverRevision"],
                    "state": dict(row["serverState"] or {}),
                }
                self.applied_requests += 1
            results.append(row)
        return {"syncVersion": body.get("syncVersion", "seller_agents_sync_v1"), "results": results}

    @staticmethod
    def _same_state(left: dict[str, Any], right: dict[str, Any]) -> bool:
        return all(left.get(key) == right.get(key) for key in (
            "kind", "storeId", "marketplace", "name", "providerAccountId",
            "providerIdentityState", "credentialRevision", "metadataRevision",
            "lifecycleState",
        ))

    @staticmethod
    def _ack(entry: dict[str, Any], state: dict[str, Any], revision: int) -> dict[str, Any]:
        return {
            "requestId": entry.get("requestId"),
            "mutationId": entry.get("mutationId"),
            "entityId": entry.get("entityId"),
            "outcome": "ACK",
            "serverRevision": revision + 1,
            "serverState": state,
            "code": None,
        }

    @staticmethod
    def _same(entry: dict[str, Any], current: dict[str, Any], code: str) -> dict[str, Any]:
        return {
            "requestId": entry.get("requestId"),
            "mutationId": entry.get("mutationId"),
            "entityId": entry.get("entityId"),
            "outcome": "ACK",
            "serverRevision": current["serverRevision"],
            "serverState": current["state"],
            "code": code,
        }

    @staticmethod
    def _conflict(entry: dict[str, Any], current: dict[str, Any], code: str) -> dict[str, Any]:
        return {
            "requestId": entry.get("requestId"),
            "mutationId": entry.get("mutationId"),
            "entityId": entry.get("entityId"),
            "outcome": "CONFLICT",
            "serverRevision": current["serverRevision"],
            "serverState": current["state"],
            "code": code,
        }


def latest_entry(fixture: BrowserFixture) -> dict[str, Any] | None:
    journal = fixture.storage().get(SYNC_JOURNAL) or {}
    entries = list(journal.get("entries", {}).values())
    return max(entries, key=lambda entry: entry.get("localSequence", 0)) if entries else None


def drain_due_sync(fixture: BrowserFixture, clock_ms: int | None = None):
    future = clock_ms or int(time.time() * 1000) + 120_000
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
        fixture.worker.evaluate("async()=>SellerAgentsTechnicalScheduler.wake('r4-early')")
        fixture.worker.evaluate("()=>{globalThis.__saTestClock += 5000}")
        fixture.worker.evaluate("async()=>SellerAgentsTechnicalScheduler.wake('r4-due')")
        result = fixture.worker.evaluate("async()=>SellerAgentsSyncJournal.syncNow('r4-transport')")
    finally:
        fixture.worker.evaluate("()=>globalThis.__saRestoreTestClock?.()")
    time.sleep(0.25)
    return result


def seed_pair(fixture: BrowserFixture, prefix: str):
    token = prefix.lower().replace(" ", "-")
    x = fixture.seed_store("ozon", f"{prefix} X", f"{token}-x", f"r4-credential-{token}")
    y = fixture.seed_store("ozon", f"{prefix} Y", f"{token}-y", f"r4-credential-{token}")
    return x, y


def copy_pair(fixture: BrowserFixture, source: tuple[dict[str, Any], dict[str, Any]]):
    fixture.worker.evaluate(
        """async ({x, y}) => {
          const key = 'seller_agents_stores_v1';
          const accountId = '11111111-1111-4222-8111-111111111111';
          const current = (await chrome.storage.local.get(key))[key] || {version: 1, accounts: {}};
          const account = current.accounts[accountId] || {next: {ozon: 1, wildberries: 1}, stores: {}};
          account.stores[x.id] = structuredClone(x);
          account.stores[y.id] = structuredClone(y);
          await chrome.storage.local.set({[key]: {...current, accounts: {...current.accounts, [accountId]: account}}});
        }""",
        {"x": source[0], "y": source[1]},
    )
    fixture.reload_popup()
    fixture.popup.click("#ozon")
    wait_for(lambda: fixture.popup.locator("#stores option").count() == 2, "copied store pair")


def run_runtime(runtime: Path, private_key: Path, server: R4Server, output: Path):
    rows = []
    contexts: list[BrowserFixture] = []

    def case(case_id: str, description: str, fn):
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

    def fresh(device_id: str = DEVICE, session_id: str = SESSION):
        fixture = BrowserFixture(runtime, private_key, server, output / f"context-{len(contexts)}", device_id, session_id)
        fixture.open(pw)
        fixture.reset()
        contexts.append(fixture)
        return fixture

    with __import__("playwright.sync_api", fromlist=["sync_playwright"]).sync_playwright() as pw:
        try:
            def r401():
                server.reset_model()
                a = fresh()
                b = fresh(OTHER_DEVICE, OTHER_SESSION)
                ax, ay = seed_pair(a, "R4 Store")
                bx, by = seed_pair(b, "R4 Store")
                bx["id"], by["id"] = ax["id"], ay["id"]
                server.configure_sync("pass")
                drain_due_sync(a)
                a.popup.select_option("#stores", ax["id"])
                a.popup.click("#remove")
                a.popup.locator("#confirmation").wait_for(state="visible")
                a.popup.click("#confirm")
                drain_due_sync(a)
                stale = ui_rename(b, bx, "R4 stale disconnected rename")
                drain_due_sync(b)
                state = server.states.get(f"store:{ax['id']}", {}).get("state")
                assert state is not None, {"store": ax["id"], "journal": a.storage().get(SYNC_JOURNAL), "requests": server.requests}
                assert state["lifecycleState"] == "TOMBSTONED"
                converged = raw_store(b, bx["id"])
                assert converged and converged.get("lifecycleState") == "TOMBSTONED", {"raw": converged, "journal": b.storage().get(SYNC_JOURNAL), "requests": server.requests}
                assert store_named(b, "R4 Store Y")["id"] == by["id"]
                stale_requests = [row for row in server.requests if row["path"] == "/v1/sync" and any(entry.get("kind") == "STORE_UPSERT" and entry.get("payload", {}).get("name") == stale["name"] for entry in row["body"].get("entries", []))]
                assert stale_requests
                assert any(row.get("outcome") == "CONFLICT" for row in server.receipts.values())
                assert not any("api-seller.ozon.ru" in event["url"] or "wildberries.ru" in event["url"] for fixture in (a, b) for event in fixture.events)

            case("SYNC-R4-01", "real HTTP stale STORE_UPSERT cannot resurrect a server tombstone", r401)

            def r402():
                server.reset_model()
                a = fresh()
                b = fresh(OTHER_DEVICE, OTHER_SESSION)
                ax, ay = seed_pair(a, "R4 Converge")
                bx, by = seed_pair(b, "R4 Converge")
                server.configure_sync("pass")
                drain_due_sync(a)
                a.popup.select_option("#stores", ax["id"])
                a.popup.click("#remove")
                a.popup.locator("#confirmation").wait_for(state="visible")
                a.popup.click("#confirm")
                drain_due_sync(a)
                ui_rename(b, bx, "R4 B contacts later")
                drain_due_sync(b)
                converged = raw_store(b, bx["id"])
                assert converged and converged.get("lifecycleState") == "TOMBSTONED", {"raw": converged, "journal": b.storage().get(SYNC_JOURNAL), "requests": server.requests}
                assert all(row["id"] != bx["id"] for row in b.state()["stores"])
                assert store_named(b, "R4 Converge Y")["id"] == by["id"]
                assert raw_store(b, by["id"]).get("lifecycleState", "ACTIVE") == "ACTIVE"

            case("SYNC-R4-02", "independent later installation converges tombstone through production HTTP response handling", r402)

            def r403():
                server.reset_model()
                a = fresh()
                b = fresh(OTHER_DEVICE, OTHER_SESSION)
                ax, ay = seed_pair(a, "R4 Credential")
                bx, by = seed_pair(b, "R4 Credential")
                server.configure_sync("pass")
                drain_due_sync(a)
                old_revision = bx["credentialRevision"]
                b.set_bound(bx, state="active", revision=4)
                a.popup.select_option("#stores", ax["id"])
                a.popup.click("#edit")
                a.popup.locator("#seller-key").fill("R4-NEW-SELLER-KEY")
                a.popup.click("#save")
                wait_for(lambda: raw_store(a, ax["id"])["credentialRevision"] != old_revision, "A credential revision")
                newer_revision = raw_store(a, ax["id"])["credentialRevision"]
                assert newer_revision != old_revision, {"old": old_revision, "new": newer_revision}
                drain_due_sync(a)
                ui_rename(b, bx, "R4 stale credential binding")
                drain_due_sync(b)
                converged = raw_store(b, bx["id"])
                assert converged["credentialRevision"] == newer_revision, f"converged={converged} newer={newer_revision} server={server.states} receipts={server.receipts} journal={b.storage().get(SYNC_JOURNAL)}"
                assert converged["credentialsStale"] is True, {"converged": converged}
                resume = b.rpc("SA_WORK_RESUME", conversation_key=CONVERSATION_KEY)
                assert resume.get("ok") is False, {"resume": resume, "binding": b.storage().get(BINDINGS)}
                assert store_named(b, "R4 Credential Y")["id"] == by["id"]
                body_text = json.dumps([row["body"] for row in server.requests if row["path"] == "/v1/sync"], ensure_ascii=False).lower()
                for forbidden in ("r4-new-seller-key", "token", "secret", "access_token", "refresh_token", "credentials"):
                    assert forbidden not in body_text, {"forbidden": forbidden, "body": body_text}
                assert any(row.get("outcome") == "CONFLICT" and row.get("serverState", {}).get("credentialRevision") == newer_revision for row in server.receipts.values()), server.receipts

            case("SYNC-R4-03", "credentialRevision converges as metadata and fences stale Work without credential transfer", r403)

            def r404():
                server.reset_model()
                a = fresh()
                store = ui_add_ozon(a, "R4 Duplicate", "R4-DUPLICATE-KEY")
                server.configure_sync("drop_once")
                drain_due_sync(a)
                first = [row for row in server.requests if row["path"] == "/v1/sync"][-1]
                first_entry = first["body"]["entries"][0]
                wait_for(lambda: latest_entry(a) is not None and latest_entry(a).get("status") == "RETRY_WAIT", "duplicate retry state")
                first_retry_state = latest_entry(a)
                assert first_retry_state and first_retry_state["status"] == "RETRY_WAIT", {"entry": first_retry_state, "requests": server.requests}
                server.configure_sync("pass")
                drain_due_sync(a, int(first_retry_state["nextAttemptAt"]) + 1000)
                sync_requests = [row for row in server.requests if row["path"] == "/v1/sync"]
                retry = sync_requests[-1]["body"]["entries"][0]
                assert retry["requestId"] == first_entry["requestId"], {"first": first_entry, "retry": retry, "journal": a.storage().get(SYNC_JOURNAL)}
                assert retry["mutationId"] == first_entry["mutationId"], {"first": first_entry, "retry": retry}
                assert server.states[f"store:{store['id']}"]["serverRevision"] == 1
                assert server.applied_requests == 1
                assert latest_entry(a) is None, {"entry": latest_entry(a), "requests": server.requests}

            case("SYNC-R4-04", "duplicate requestId retry is idempotent over installed HTTP transport", r404)

            def r405():
                server.reset_model()
                a = fresh()
                store = ui_add_ozon(a, "R4 Late ACK M1", "R4-LATE-KEY")
                server.configure_sync("delay_once")
                release = threading.Timer(0.65, server.release_sync)
                release.start()
                observed = a.worker.evaluate(
                    """async (storeId) => {
                      const first = SellerAgentsSyncJournal.syncNow('r4-late-ack-m1');
                      await new Promise(resolve => setTimeout(resolve, 120));
                      const next = await SellerAgentsActiveStoreCatalog.save({id: storeId, name: 'R4 Late ACK M2', credentials: {}});
                      await SellerAgentsSyncJournal.recordStoreMetadata({store: next});
                      const firstResult = await first;
                      return {firstResult, store: await SellerAgentsActiveStoreCatalog.get(storeId), journal: await SellerAgentsSyncJournal.read()};
                    }""",
                    store["id"],
                )
                assert observed["firstResult"]["ok"] is True
                assert observed["store"]["name"] == "R4 Late ACK M2"
                pending = [entry for entry in observed["journal"]["entries"].values() if entry["kind"] == "STORE_UPSERT"]
                assert len(pending) == 1 and pending[0]["status"] in {"PENDING", "RETRY_WAIT"}
                assert pending[0]["payload"]["name"] == "R4 Late ACK M2"
                server.configure_sync("pass")
                drain_due_sync(a)
                assert raw_store(a, store["id"])["name"] == "R4 Late ACK M2"
                assert server.states[f"store:{store['id']}"]["state"]["name"] == "R4 Late ACK M2"
                assert latest_entry(a) is None
                assert [row for row in server.requests if row["path"] == "/v1/sync"][-1]["body"]["entries"][0]["payload"]["name"] == "R4 Late ACK M2"

            case("SYNC-R4-05", "delayed old ACK cannot erase a newer local metadata mutation", r405)

            body_text = json.dumps([row["body"] for row in server.requests if row["path"] == "/v1/sync"], ensure_ascii=False).lower()
            forbidden = ["seller-key", "personal-token", "browser-seller-key", "browser-wb-personal-token", "access_token", "refresh_token", "storage_state", "reporttext", "conversation_id"]
            privacy = {"sync_payload_secret_free": not any(value in body_text for value in forbidden), "forbidden_matches": [value for value in forbidden if value in body_text]}
            result = {
                "status": "PASS" if all(row["status"] == "PASS" for row in rows) else "FAIL",
                "browser": "native Chromium",
                "chromium_version": contexts[0].context.browser.version if contexts else None,
                "runtime": str(runtime),
                "results": rows,
                "sync_requests": len([row for row in server.requests if row["path"] == "/v1/sync"]),
                "server_applied_requests": server.applied_requests,
                "server_revision_changes": {key: value["serverRevision"] for key, value in server.states.items()},
                "privacy": privacy,
            }
            output.mkdir(parents=True, exist_ok=True)
            (output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
            return result
        finally:
            for fixture in contexts:
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
        server = R4Server(args.private_key).start()
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
