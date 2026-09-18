"""Installed A24 export/import acceptance for source and extracted MV3 runtimes."""

from __future__ import annotations

import argparse
import hashlib
import json
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

from browser_c1_acceptance import (
    ACCOUNT,
    BINDINGS,
    MANUAL,
    SESSIONS,
    STORES,
    BrowserFixture,
    wait_for,
)
from synthetic_health_server import SyntheticHealthServer


PASSWORD = "A24-installed-password-2026"


def add_store(fixture: BrowserFixture, marketplace: str, name: str, seller_key: str) -> dict:
    fixture.popup.click("#ozon" if marketplace == "ozon" else "#wildberries")
    fixture.popup.click("#add")
    fixture.popup.locator("#name").fill(name)
    if marketplace == "ozon":
        fixture.popup.locator("#seller-id").fill(f"client-{name}")
        fixture.popup.locator("#seller-key").fill(seller_key)
    else:
        fixture.popup.locator("#token").fill(seller_key)
    fixture.popup.click("#save")
    wait_for(lambda: any(row["name"] == name for row in fixture.state()["stores"]), name)
    return next(row for row in fixture.state()["stores"] if row["name"] == name)


def add_ozon_performance(fixture: BrowserFixture, name: str) -> dict:
    fixture.popup.click("#ozon")
    fixture.popup.click("#add")
    fixture.popup.locator("#name").fill(name)
    fixture.popup.locator("#seller-id").fill(f"client-{name}")
    fixture.popup.locator("#seller-key").fill(f"seller-{name}")
    fixture.popup.locator("#performance-id").fill(f"performance-{name}")
    fixture.popup.locator("#performance-key").fill(f"performance-secret-{name}")
    fixture.popup.click("#save")
    wait_for(lambda: any(row["name"] == name for row in fixture.state()["stores"]), name)
    return next(row for row in fixture.state()["stores"] if row["name"] == name)


def raw_store(fixture: BrowserFixture, store_id: str, marketplace: str, lifecycle: str = "ACTIVE", provider: str | None = None):
    fixture.worker.evaluate(
        """async ({storeId, marketplace, lifecycle, provider}) => {
          const current = (await chrome.storage.local.get('seller_agents_stores_v1')).seller_agents_stores_v1 || {version:1,accounts:{}};
          const account = current.accounts["11111111-1111-4222-8111-111111111111"] || {next:{ozon:1,wildberries:1},stores:{}};
          const credentials = marketplace === 'ozon' ? {seller:{clientId:'local-client',apiKey:'local-key'},performance:{}} : {token:'local-wb-token'};
          account.stores[storeId] = {id:storeId,accountId:"11111111-1111-4222-8111-111111111111",marketplace,name:'Local conflict',credentials,credentialRevision:'credential-local-newer',metadataRevision:7,lifecycleState:lifecycle,providerAccountId:provider,providerIdentityState:provider ? 'CONFIRMED' : 'UNCONFIRMED',credentialsStale:lifecycle !== 'ACTIVE',personalDataEnabled:false,verification:{},createdAt:1700000000000};
          await chrome.storage.local.set({seller_agents_stores_v1:{...current,accounts:{...current.accounts, ["11111111-1111-4222-8111-111111111111"]:account}}});
        }""",
        {"storeId": store_id, "marketplace": marketplace, "lifecycle": lifecycle, "provider": provider},
    )
    fixture.reload_popup()


def export_via_ui(fixture: BrowserFixture, output: Path) -> Path:
    fixture.popup.locator("#backup-password").fill(PASSWORD)
    fixture.popup.locator("#backup-password-confirm").fill(PASSWORD)
    with fixture.popup.expect_download() as pending:
        fixture.popup.click("#backup-export")
    download = pending.value
    path = output / "downloaded-seller-agents-backup.json"
    download.save_as(path)
    raw = path.read_bytes()
    assert b"seller-key-seller-only" not in raw and b"performance-secret" not in raw and b"wb-token" not in raw
    envelope = json.loads(raw)
    assert envelope["magic"] == "seller_agents_store_backup" and envelope["envelopeVersion"] == 1
    assert "ciphertext" in envelope and "ozon-key" not in raw.decode("utf-8")
    return path


def import_via_ui(fixture: BrowserFixture, backup: Path, password: str = PASSWORD, expected_count: int = 4):
    fixture.popup.locator("#backup-file").set_input_files(str(backup))
    fixture.popup.locator("#backup-import-password").fill(password)
    fixture.popup.click("#backup-preview")
    wait_for(lambda: not fixture.popup.locator("#backup-preview-result").is_hidden(), "A24 preview")
    summary = fixture.popup.locator("#backup-summary").inner_text()
    fixture.popup.click("#backup-import")
    wait_for(lambda: len(fixture.state()["stores"]) >= expected_count, "A24 import")
    return summary


def run_runtime(runtime: Path, private_key: Path, output: Path) -> dict:
    output.mkdir(parents=True, exist_ok=True)
    server = SyntheticHealthServer(private_key).start()
    rows = []
    source = target = conflicts = None
    try:
        with sync_playwright() as pw:
            source = BrowserFixture(runtime, private_key, server, output / "source")
            source.open(pw)
            source.reset()
            add_store(source, "ozon", "Ozon Seller-only", "seller-key-seller-only")
            add_ozon_performance(source, "Ozon Seller+Performance")
            add_store(source, "wildberries", "WB One", "wb-token-one")
            add_store(source, "wildberries", "WB Two", "wb-token-two")
            backup = export_via_ui(source, output)
            exported_ids = {row["name"]: row["id"] for row in source.state()["stores"]}
            source_events = list(source.events)
            rows.append({"id": "installed-export", "status": "PASS", "stores": len(source.state()["stores"])})
            source.close(); source = None

            target = BrowserFixture(runtime, private_key, server, output / "same-account-clean")
            target.open(pw); target.reset()
            baseline_requests = len(server.requests)
            summary = import_via_ui(target, backup)
            state = target.state()
            assert len(state["stores"]) == 4
            assert any("Ozon Seller-only" in row["name"] for row in state["stores"])
            raw = target.storage()
            assert not raw.get(SESSIONS) and not raw.get(BINDINGS) and not raw.get(MANUAL)
            rows.append({"id": "installed-same-account", "status": "PASS", "summary": summary, "work_sessions": 0})
            target.reload_popup()
            target.popup.locator("#backup-file").set_input_files(str(backup))
            target.popup.locator("#backup-import-password").fill("wrong-password")
            target.popup.click("#backup-preview")
            wait_for(lambda: "Действие не выполнено" in target.popup.locator("#status").inner_text(), "wrong password rejection")
            rows.append({"id": "installed-wrong-password", "status": "PASS"})
            target.close(); target = None

            conflicts = BrowserFixture(runtime, private_key, server, output / "conflicts")
            conflicts.open(pw); conflicts.reset()
            raw_store(conflicts, exported_ids["Ozon Seller-only"], "ozon", provider="different-provider")
            raw_store(conflicts, exported_ids["Ozon Seller+Performance"], "ozon")
            raw_store(conflicts, exported_ids["WB One"], "ozon")
            raw_store(conflicts, exported_ids["WB Two"], "ozon", lifecycle="TOMBSTONED")
            assert {row["id"] for row in conflicts.state()["stores"]} == {exported_ids["Ozon Seller-only"], exported_ids["Ozon Seller+Performance"], exported_ids["WB One"]}, conflicts.state()
            conflict_summary = import_via_ui(conflicts, backup, expected_count=0)
            assert {row["id"] for row in conflicts.state()["stores"]} == {exported_ids["Ozon Seller-only"], exported_ids["Ozon Seller+Performance"], exported_ids["WB One"]}
            assert "Отклонено конфликтов: 4" in conflict_summary, conflict_summary
            rows.append({"id": "installed-conflicts", "status": "PASS", "summary": conflict_summary})
            conflicts.close(); conflicts = None

            mismatch = BrowserFixture(runtime, private_key, server, output / "account-mismatch")
            mismatch.open(pw); mismatch.reset()
            alternate = mismatch.worker.evaluate(
                """async () => SellerAgentsStoreBackup.encrypt(SellerAgentsStoreBackup.payloadFromStores('account-b', []), 'A24-installed-password-2026')"""
            )
            alternate_path = output / "account-b.json"; alternate_path.write_text(alternate, encoding="utf-8")
            mismatch.popup.locator("#backup-file").set_input_files(str(alternate_path))
            mismatch.popup.locator("#backup-import-password").fill(PASSWORD)
            mismatch.popup.click("#backup-preview")
            wait_for(lambda: "Действие не выполнено" in mismatch.popup.locator("#status").inner_text(), "account mismatch rejection")
            assert not mismatch.state()["stores"]
            rows.append({"id": "installed-account-mismatch", "status": "PASS"})
            mismatch.close(); mismatch = None

            legacy = BrowserFixture(runtime, private_key, server, output / "legacy")
            legacy.open(pw); legacy.reset()
            legacy_unknown = output / "unknown-old-looking.json"; legacy_unknown.write_text(json.dumps({"format": "seller-agents-old-looking", "backup_version": 0, "credentials": {"seller_client_id": "legacy-marker"}}), encoding="utf-8")
            legacy.popup.locator("#backup-file").set_input_files(str(legacy_unknown)); legacy.popup.locator("#backup-import-password").fill("unused-password"); legacy.popup.click("#backup-preview")
            wait_for(lambda: "Действие не выполнено" in legacy.popup.locator("#status").inner_text(), "unknown legacy rejection")
            old_credentials = {"seller_client_id": "legacy-client-marker", "seller_api_key": "legacy-key-marker"}
            legacy_backup = {"format": "ozon-bridge-seller-credentials-backup", "backup_version": 1, "exported_at": "2026-09-18T00:00:00.000Z", "extension_version": "0.1.22", "extension_id": None, "contains_secrets": True, "credentials_sha256": hashlib.sha256(json.dumps(old_credentials, sort_keys=True, separators=(",", ":")).encode()).hexdigest(), "credentials": old_credentials}
            legacy_path = output / "ozon-v1-legacy.json"; legacy_path.write_text(json.dumps(legacy_backup), encoding="utf-8")
            legacy.popup.locator("#backup-file").set_input_files(str(legacy_path)); legacy.popup.locator("#backup-import-password").fill("unused-password"); legacy.popup.click("#backup-preview")
            wait_for(lambda: not legacy.popup.locator("#backup-preview-result").is_hidden(), "legacy preview")
            assert "старый provider backup" in legacy.popup.locator("#backup-summary").inner_text()
            legacy.popup.click("#backup-import"); wait_for(lambda: len(legacy.state()["stores"]) == 1, "legacy import")
            legacy_raw = legacy.storage()[STORES]["accounts"][ACCOUNT]["stores"]
            assert any(row["credentials"].get("seller", {}).get("apiKey") == "legacy-key-marker" for row in legacy_raw.values())
            rows.append({"id": "installed-legacy-adapter-and-unknown-reject", "status": "PASS"}); legacy.close(); legacy = None

            tampered = output / "tampered.json"
            tampered_value = json.loads(backup.read_text(encoding="utf-8")); tampered_value["ciphertext"] = tampered_value["ciphertext"][:-2] + ("AA" if not tampered_value["ciphertext"].endswith("AA") else "BB"); tampered.write_text(json.dumps(tampered_value), encoding="utf-8")
            tamper = BrowserFixture(runtime, private_key, server, output / "tamper")
            tamper.open(pw); tamper.reset(); tamper.popup.locator("#backup-file").set_input_files(str(tampered)); tamper.popup.locator("#backup-import-password").fill(PASSWORD); tamper.popup.click("#backup-preview")
            wait_for(lambda: "Действие не выполнено" in tamper.popup.locator("#status").inner_text(), "tamper rejection")
            assert not tamper.state()["stores"]; rows.append({"id": "installed-tamper", "status": "PASS"}); tamper.close(); tamper = None

            control_after = server.requests[baseline_requests:]
            assert not any(row["path"] in {"/v1/health-authority", "/v1/bootstrap", "/v1/sync"} for row in control_after)
            assert not any("wildberries.ru" in event["url"] or "api-seller.ozon.ru" in event["url"] for event in source_events)
    finally:
        for fixture in (source, target, conflicts, locals().get("legacy"), locals().get("mismatch"), locals().get("tamper")):
            if fixture:
                try:
                    fixture.close()
                except Exception:
                    pass
        server.stop()
    result = {"status": "PASS" if all(row["status"] == "PASS" for row in rows) else "FAIL", "runtime": str(runtime), "results": rows, "provider_requests": 0, "mandatory_control_requests": 0}
    (output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-runtime", type=Path, required=True)
    parser.add_argument("--extracted-runtime", type=Path, required=True)
    parser.add_argument("--private-key", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    results = {label: run_runtime(runtime, args.private_key, args.output / label) for label, runtime in (("source", args.source_runtime), ("extracted", args.extracted_runtime))}
    summary = {"status": "PASS" if all(value["status"] == "PASS" for value in results.values()) else "FAIL", "runtimes": results}
    args.output.mkdir(parents=True, exist_ok=True); (args.output / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"); print(json.dumps(summary, ensure_ascii=False, indent=2)); return 0 if summary["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
