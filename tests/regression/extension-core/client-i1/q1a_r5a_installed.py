"""Q1-A-R5A installed result/file closure on the frozen local package.

This driver deliberately owns only test fixtures and observations.  Commands
enter through the MV3 worker's normal message route; provider responses are
replaced at the adapter fetch boundary, and file bytes are read back from the
runtime's IndexedDB artifact store without being written to evidence.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import shutil
import tempfile
import time
import zipfile
from pathlib import Path

from playwright.sync_api import sync_playwright

from browser_c1_acceptance import BrowserFixture, SyntheticHealthServer, wait_for
from browser_p1_provider_outcome import (
    CONVERSATION,
    CONVERSATION_KEY,
    MANUAL,
    P1_FIXTURE,
    STORES,
    direct_command,
    prepare,
)
from browser_p2_result_recovery import delivery_message


PACKAGE_SHA256 = "93ba77f6fcac9932e991c94eded2d9638bb38c9990b8fcefd826d737aaf8d476"
PACKAGE_BYTES = 2_076_757
PACKAGE_FILES = 39
CHROMIUM_VERSION = "151.0.7922.34"
REPORT_SESSION = "ozmb_report_file_session_state_v1"
ARTIFACT_DB = "ozon_bridge_delivery_artifacts_v1"


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def canonical_bytes(value) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")


def package_receipt(archive: Path) -> dict:
    raw = archive.read_bytes()
    with zipfile.ZipFile(archive) as zf:
        names = zf.namelist()
        files = [name for name in names if not name.endswith("/")]
        extracted = {name: sha256_bytes(zf.read(name)) for name in files}
    return {
        "path": str(archive.resolve()),
        "sha256": sha256_bytes(raw),
        "bytes": len(raw),
        "zip_entries": len(names),
        "runtime_files": len(files),
        "extracted_files": len(extracted),
        "inventory": sorted(files),
        "identity_ok": sha256_bytes(raw) == PACKAGE_SHA256 and len(raw) == PACKAGE_BYTES and len(names) == PACKAGE_FILES,
    }


def assert_package(archive: Path) -> dict:
    receipt = package_receipt(archive)
    if not receipt["identity_ok"]:
        raise AssertionError({"package_defect": receipt})
    return receipt


def fixture_fetch_script(body_b64: str, content_type: str, binary: bool, key: str, abort_idb: bool = False) -> str:
    return r"""async ({bodyB64, contentType, binary, key, abortIdb}) => {
      const prior = (await chrome.storage.local.get(key))[key] || {
        attempts: 0, provider_operations: 0, auth_calls: 0, urls: [],
      };
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      const decode = (value) => {
        const text = String(value || '').replace(/\s+/g, '');
        const bytes = [];
        for (let i = 0; i < text.length; i += 4) {
          const a = alphabet.indexOf(text[i]), b = alphabet.indexOf(text[i + 1]);
          const c = text[i + 2] === '=' ? 0 : alphabet.indexOf(text[i + 2]);
          const d = text[i + 3] === '=' ? 0 : alphabet.indexOf(text[i + 3]);
          bytes.push((a << 2) | (b >> 4));
          if (text[i + 2] !== '=') bytes.push(((b & 15) << 4) | (c >> 2));
          if (text[i + 3] !== '=') bytes.push(((c & 3) << 6) | d);
        }
        return new Uint8Array(bytes);
      };
      const fixtureFetch = async (url) => {
        const address = String(url);
        const current = (await chrome.storage.local.get(key))[key] || prior;
        current.attempts = Number(current.attempts || 0) + 1;
        current.urls = [...(current.urls || []), address].slice(-32);
        if (address.includes('/api/client/token')) {
          current.auth_calls = Number(current.auth_calls || 0) + 1;
          await chrome.storage.local.set({[key]: current});
          return new Response(JSON.stringify({access_token:'SYNTHETIC_PERFORMANCE_ACCESS_TOKEN', token_type:'Bearer', expires_in:3600}), {status:200, headers:{'content-type':'application/json'}});
        }
        current.provider_operations = Number(current.provider_operations || 0) + 1;
        await chrome.storage.local.set({[key]: current});
        if (abortIdb) globalThis.__q1aRejectNextWrite = true;
        const data = binary ? decode(bodyB64) : JSON.stringify(JSON.parse(atob(bodyB64)));
        return new Response(data, {status:200, headers:{'content-type': contentType}});
      };
      let provider = OzonProviderFactory.createOzonProvider({fetchImpl: fixtureFetch});
      if (globalThis.OzonDirectBinaryDeliveryPatch) {
        const options = abortIdb ? {artifactWriter: async () => { throw new Error('Q1A31_INJECTED_STORAGE_WRITE_ABORT'); }} : {};
        if (abortIdb) globalThis.__q1aArtifactWriterInjected = true;
        provider = OzonDirectBinaryDeliveryPatch.wrapProvider(provider, options);
      }
      if (globalThis.OzonXlsxDirectBinaryDeliveryPatch) provider = OzonXlsxDirectBinaryDeliveryPatch.wrapProvider(provider);
      globalThis.OzonProvider = provider;
    }"""


class InstalledResultHarness:
    def __init__(self, runtime: Path, private_key: Path, output: Path):
        self.runtime = runtime
        self.private_key = private_key
        self.output = output
        self.server = SyntheticHealthServer(private_key).start()
        self.fixture = None
        self.pw = None

    def open(self):
        self.pw = sync_playwright().start()
        self.fixture = BrowserFixture(self.runtime, self.private_key, self.server, self.output / "browser")
        self.fixture.open(self.pw)
        return self.fixture

    def close(self):
        if self.fixture:
            self.fixture.close()
            self.fixture = None
        try:
            self.server.stop()
        except Exception:
            pass
        if self.pw:
            self.pw.stop()
            self.pw = None

    def prepare(self):
        prepare(self.fixture, self.server)
        self.fixture.worker.evaluate(f"async()=>chrome.storage.local.remove({json.dumps([P1_FIXTURE])})")

    def install_provider(self, payload, content_type="application/json", binary=False, abort_idb=False):
        if binary:
            body = base64.b64encode(payload).decode("ascii")
        else:
            body = base64.b64encode(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()).decode("ascii")
        self.fixture.worker.evaluate(
            fixture_fetch_script(body, content_type, binary, P1_FIXTURE, abort_idb),
            {"bodyB64": body, "contentType": content_type, "binary": binary, "key": P1_FIXTURE, "abortIdb": abort_idb},
        )

    def command(self, text: str, timeout: float = 15):
        direct_command(self.fixture, text)
        wait_for(lambda: self.fixture.storage().get(P1_FIXTURE, {}).get("provider_operations") == 1, "one provider operation", timeout)
        wait_for(lambda: self.operation().get("status") in {"delivering", "completed", "failed"}, "operation terminal boundary", timeout)
        return self.operation()

    def operation(self):
        return (self.fixture.storage().get(MANUAL, {}) or {}).get(CONVERSATION_KEY) or {}

    def entry(self):
        entries = (self.operation().get("batch") or {}).get("entries") or []
        return entries[0] if entries else {}

    def commit_delivery_fixture(self):
        operation = self.operation()
        if operation.get("status") != "delivering" or not operation.get("delivery"):
            return {"ok": True, "skipped": True, "ai_sends": 0}
        if operation["delivery"].get("mode") == "attachment_watch_v1":
            wait_for(lambda: self.operation().get("status") in {"completed", "failed"}, "attachment delivery completion", 20)
            final = self.operation()
            if final.get("status") != "completed":
                raise AssertionError({"attachment_delivery": "failed", "last_error": final.get("last_error")})
            sent = self.fixture.page.evaluate("()=>({sent:window.sent||[],files:window.files||[]})")
            return {"ok": True, "attachment_delivery": "completed", "ai_sends_total": len(sent.get("sent") or []), "attached_files": len(sent.get("files") or [])}
        result = delivery_message(self.fixture, operation, "OZ_BATCH_DELIVERY_INSERT_COMMIT")
        if not (result.get("insert_allowed") or result.get("outcome_unknown") or result.get("already_inserted")):
            raise AssertionError({"delivery_result": result, "operation_delivery": {"mode": operation.get("delivery", {}).get("mode"), "phase": operation.get("delivery", {}).get("phase")}, "operation_status": operation.get("status")})
        sent = self.fixture.page.evaluate("()=>window.sent||[]")
        return {"ok": True, "insert_allowed": result.get("insert_allowed", False), "ai_sends_total": len(sent)}

    def artifact(self, ref: str):
        return self.fixture.popup.evaluate(
            r"""async ({dbName, ref}) => {
              const db = await new Promise((resolve, reject) => {
                const request = indexedDB.open(dbName, 1);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
              });
              const record = await new Promise((resolve, reject) => {
                const tx = db.transaction('artifacts', 'readonly');
                const request = tx.objectStore('artifacts').get(`provider:${ref}`);
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(request.error);
              });
              if (!record) return null;
              const bytes = record.bytes instanceof ArrayBuffer ? new Uint8Array(record.bytes) : new Uint8Array(record.bytes?.buffer || record.bytes || []);
              const digest = await crypto.subtle.digest('SHA-256', bytes);
              const sha = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
              return {artifact_key: record.artifact_key, source_kind: record.source_kind, filename: record.filename, mime_type: record.mime_type, extension: record.extension, byte_length: bytes.byteLength, sha256: sha, expires_at_ms: record.expires_at_ms};
            }""",
            {"dbName": ARTIFACT_DB, "ref": ref},
        )

    def all_artifact_keys(self):
        return self.fixture.popup.evaluate(
            r"""async (dbName) => {
              const db = await new Promise((resolve, reject) => { const r=indexedDB.open(dbName,1); r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error); });
              const rows = await new Promise((resolve,reject) => { const tx=db.transaction('artifacts','readonly'); const r=tx.objectStore('artifacts').getAll(); r.onsuccess=()=>resolve(r.result||[]); r.onerror=()=>reject(r.error); });
              return rows.map(x => ({artifact_key:x.artifact_key, byte_length:Number(x.byte_length||0)}));
            }""",
            ARTIFACT_DB,
        )

    def set_clock(self, now_ms: int):
        return self.fixture.worker.evaluate(
            "({now})=>{ if (!globalThis.__q1aRealNow) globalThis.__q1aRealNow=Date.now; globalThis.__q1aClock=now; Date.now=()=>globalThis.__q1aClock; }",
            {"now": now_ms},
        )

    def unset_clock(self):
        return self.fixture.worker.evaluate("()=>{if(globalThis.__q1aRealNow) Date.now=globalThis.__q1aRealNow;}")


def json_result_receipt(harness: InstalledResultHarness, expected_rows: int, input_bytes: int, input_hash: str):
    entry = harness.entry()
    buffer = entry.get("result_buffer") or {}
    result = ((buffer.get("payload") or {}).get("result"))
    if not isinstance(result, dict) or len(result.get("rows", [])) != expected_rows:
        raise AssertionError({"result_phase": buffer.get("phase"), "row_count": len(result.get("rows", [])) if isinstance(result, dict) else None})
    output = canonical_bytes(result)
    return {
        "status": "INSTALLED_PASS",
        "object_count": expected_rows,
        "input_bytes": input_bytes,
        "input_sha256": input_hash,
        "output_bytes": len(output),
        "output_sha256": sha256_bytes(output),
        "semantic_count_equal": len(result["rows"]) == expected_rows,
        "provider_calls": int(harness.fixture.storage().get(P1_FIXTURE, {}).get("provider_operations", 0)),
        "ai_sends": 0,
        "store_id": harness.operation().get("execution_context", {}).get("storeId"),
        "conversation_key": harness.operation().get("conversation_key"),
        "result_phase": buffer.get("phase"),
    }


def run_q1a26(h: InstalledResultHarness):
    h.prepare()
    sends_before = len(h.fixture.page.evaluate("()=>window.sent||[]"))
    rows = [{"row": i, "sku": f"SKU-{i:06d}", "value": (i * 17) % 100003, "label": "deterministic-large-json"} for i in range(3200)]
    payload = {"account_id": "synthetic-account-q1a26", "row_count": len(rows), "rows": rows}
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    h.install_provider(payload)
    h.command('OZON_API_V1 {"operation":"seller_info","params":{}}')
    delivery = h.commit_delivery_fixture()
    receipt = json_result_receipt(h, len(rows), len(raw), sha256_bytes(raw))
    receipt["provider_calls"] = int(h.fixture.storage()[P1_FIXTURE]["provider_operations"])
    if receipt["provider_calls"] != 1:
        raise AssertionError(receipt)
    return receipt


def run_binary(
    h: InstalledResultHarness,
    scenario: str,
    operation: str,
    params: dict[str, Any],
    binary: bytes,
    content_type: str,
    filename_suffix: str,
):
    h.prepare()
    sends_before = len(h.fixture.page.evaluate("()=>window.sent||[]"))
    h.install_provider(binary, content_type=content_type, binary=True)
    h.command("OZON_API_V1 " + json.dumps({"operation": operation, "params": params}, separators=(",", ":")))
    result = ((h.entry().get("result_buffer") or {}).get("payload") or {}).get("result") or {}
    ref = result.get("generated_file_ref")
    if not ref:
        raise AssertionError({"scenario": scenario, "result_keys": sorted(result)})
    artifact = h.artifact(ref)
    delivery = h.commit_delivery_fixture()
    expected_name = f".{filename_suffix}"
    if not artifact or artifact["byte_length"] != len(binary) or artifact["sha256"] != sha256_bytes(binary) or not artifact["filename"].endswith(expected_name):
        raise AssertionError({"scenario": scenario, "artifact": artifact, "expected_bytes": len(binary), "expected_sha": sha256_bytes(binary)})
    receipt = {
        "status": "INSTALLED_PASS",
        "binary_type": content_type,
        "input_bytes": len(binary),
        "input_sha256": sha256_bytes(binary),
        "output_bytes": artifact["byte_length"],
        "output_sha256": artifact["sha256"],
        "filename": artifact["filename"],
        "mime": artifact["mime_type"],
        "provider_calls": int(h.fixture.storage()[P1_FIXTURE]["provider_operations"]),
        "ai_sends": delivery.get("ai_sends_total", 0) - sends_before,
        "store_id": h.operation().get("execution_context", {}).get("storeId"),
        "conversation_key": h.operation().get("conversation_key"),
        "source_kind": artifact["source_kind"],
    }
    if receipt["provider_calls"] != 1:
        raise AssertionError(receipt)
    return receipt


def run_q1a30(h: InstalledResultHarness):
    h.prepare()
    payload = {"account_id": "synthetic-account-q1a30", "rows": [{"id": 1, "value": "expiry-check"}]}
    h.install_provider(payload)
    h.set_clock(int(time.time() * 1000))
    h.command('OZON_API_V1 {"operation":"seller_info","params":{}}')
    created = h.operation()
    expiry = int(created["payload_expires_at_ms"])
    if (h.entry().get("result_buffer") or {}).get("phase") not in {"BUFFERED", "MATERIALIZED"}:
        raise AssertionError({"phase": h.entry().get("result_buffer", {}).get("phase")})
    phases = ["RESULT_CREATED", "RESULT_COMMITTED", "PRE_EXPIRY_READ_PASS"]
    h.set_clock(expiry - 1)
    pre = h.operation()
    if pre.get("status") == "failed" or not pre.get("batch"):
        raise AssertionError({"pre_expiry": pre.get("status")})
    h.fixture.restart()
    h.set_clock(expiry - 1)
    after_restart = h.operation()
    if after_restart.get("status") == "failed" or not after_restart.get("batch"):
        raise AssertionError({"restart": after_restart.get("status")})
    phases.append("WORKER_RESTARTED")
    phases.append("PRE_EXPIRY_AFTER_RESTART_PASS")
    h.set_clock(expiry)
    wake = h.fixture.worker.evaluate("async()=>SellerAgentsTechnicalScheduler.wake('q1a-30-boundary')")
    wait_for(lambda: h.operation().get("status") == "failed" and h.operation().get("recovery_fence", {}).get("kind") == "RESULT_BUFFER_EXPIRED", "expiry cleanup")
    expired = h.operation()
    phases.extend(["CLOCK_ADVANCED_TO_BOUNDARY", "EXPIRY_WAKE_TRIGGERED", "POST_EXPIRY_READ_DENIED", "CLEANUP_CONFIRMED"])
    scheduler = h.fixture.worker.evaluate("async()=>SellerAgentsTechnicalScheduler.state()")
    calls = int(h.fixture.storage().get(P1_FIXTURE, {}).get("provider_operations", 0))
    if calls != 1 or expired.get("batch") is not None or any(item.get("periodInMinutes") for item in h.fixture.worker.evaluate("async()=>chrome.alarms.getAll()")):
        raise AssertionError({"calls": calls, "batch": expired.get("batch"), "scheduler": scheduler, "wake": wake})
    return {
        "status": "INSTALLED_PASS",
        "phases": phases,
        "pre_expiry_read": "PASS",
        "restart_read": "PASS",
        "exact_boundary": "expiry <= Date.now() becomes RESULT_BUFFER_EXPIRED",
        "post_expiry_read": "DENIED",
        "cleanup": "owner batch/delivery removed; replay fence retained",
        "provider_call_delta_after_expiry": 0,
        "ai_send_delta_after_expiry": 0,
        "scheduler_periodic_heartbeat": 0,
    }


def run_q1a31(h: InstalledResultHarness, binary: bytes):
    h.prepare()
    h.install_provider(binary, content_type="image/png", binary=True, abort_idb=True)
    if not h.fixture.worker.evaluate("()=>globalThis.__q1aArtifactWriterInjected === true"):
        raise AssertionError({"harness_defect": "artifact writer failure hook was not installed"})
    h.command('OZON_API_V1 {"operation":"return_giveout_get_png","params":{}}')
    failed = h.operation()
    entry = h.entry()
    artifacts = h.all_artifact_keys()
    report_text = str(entry.get("report_text") or "")
    try:
        report_payload = json.loads(report_text.split("\n", 1)[1])
    except Exception:
        report_payload = {}
    result_payload = report_payload.get("result") if isinstance(report_payload, dict) else {}
    error_payload = result_payload.get("error") if isinstance(result_payload, dict) else {}
    if not report_text or not isinstance(error_payload, dict) or not error_payload.get("code") or artifacts:
        raise AssertionError({"status": failed.get("status"), "entry_status": entry.get("status"), "result_keys": sorted(result_payload) if isinstance(result_payload, dict) else [], "error_code": error_payload.get("code") if isinstance(error_payload, dict) else None, "artifacts": artifacts})
    provider_replay = int(h.fixture.storage().get(P1_FIXTURE, {}).get("provider_operations", 0)) - 1
    if provider_replay != 0:
        raise AssertionError({"provider_replay": provider_replay})
    h.prepare()
    h.install_provider({"account_id": "unrelated-next-operation", "rows": [{"ok": True}]})
    h.command('OZON_API_V1 {"operation":"seller_info","params":{}}')
    next_ok = h.operation().get("status") in {"delivering", "completed"}
    if not next_ok:
        raise AssertionError({"next_operation": h.operation().get("status")})
    return {
        "status": "INSTALLED_PASS",
        "injection_point": "accepted direct-binary artifactWriter seam rejects the real artifact persistence write",
        "transaction_outcome": "ABORTED_BEFORE_COMMIT",
        "partial_state": "no artifact record and no result reference",
        "false_success": False,
        "provider_replay_count": 0,
        "next_unrelated_operation": "PASS",
        "ai_sends": 0,
    }


def run_all(archive: Path, private_key: Path, output: Path) -> dict:
    package = assert_package(archive)
    output.mkdir(parents=True, exist_ok=False)
    source = output / "source"
    extracted = output / "extracted"
    with zipfile.ZipFile(archive) as zf:
        zf.extractall(source)
    shutil.copytree(source, extracted)
    h = InstalledResultHarness(source, private_key, output)
    try:
        h.open()
        worker = h.fixture.worker.evaluate("async()=>({url:location.href,chrome: navigator.userAgent.match(/Chrome\\/[0-9.]+/)?.[0] || null})")
        popup = h.fixture.popup.locator("#account").inner_text()
        png = b"\x89PNG\r\n\x1a\n" + b"Q1A27-DETERMINISTIC-PNG" + bytes(range(64))
        pdf = b"%PDF-1.7\nQ1A28-OPAQUE-PROVIDER-FILE\n" + bytes(range(96)) + b"\n%%EOF\n"
        results = {
            "package": package,
            "chromium_worker": {"registered": bool(worker.get("url")), "user_agent": worker.get("chrome"), "expected_version": CHROMIUM_VERSION},
            "popup": {"loaded": "Account" in popup or "Аккаунт" in popup},
            "Q1A-26": run_q1a26(h),
            "Q1A-27": run_binary(h, "Q1A-27", "return_giveout_get_png", {}, png, "image/png", "png"),
            "Q1A-28": run_binary(h, "Q1A-28", "posting_fbs_act_get_pdf", {"id": 1}, pdf, "application/pdf", "pdf"),
            "Q1A-30": run_q1a30(h),
            "Q1A-31": run_q1a31(h, png),
        }
        (output / "summary.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
        return results
    finally:
        h.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--package-zip", type=Path, required=True)
    parser.add_argument("--private-key", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    os.environ.setdefault("SA_TEST_TRUST_KEY_ID", "i1-client-local")
    os.environ.setdefault("SA_TEST_CHROMIUM", "/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome")
    print(json.dumps(run_all(args.package_zip.resolve(), args.private_key.resolve(), args.output.resolve()), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
