"""Installed two-profile credential-transfer acceptance for A04.

Uses only synthetic credentials, the ordinary local API/portal and a disposable DB.
The result persists package identity and bounded booleans/counts, never raw secrets.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.parse import urlparse

os.environ.setdefault("SA_Q1A_API_PORT", "43120")
os.environ.setdefault("SA_Q1A_PORTAL_PORT", "43121")

import browser_d3s2_2b_adversarial as adversarial
import browser_d3s2_r1_transfer as base
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
NODE = "/root/.nvm/versions/node/v24.20.0/bin/node"
PNPM = "/root/.nvm/versions/node/v24.20.0/bin/pnpm"
NODE_BIN = "/root/.nvm/versions/node/v24.20.0/bin"
API_PORT = int(os.environ["SA_Q1A_API_PORT"])
PORTAL_PORT = int(os.environ["SA_Q1A_PORTAL_PORT"])
API = f"http://127.0.0.1:{API_PORT}"
PORTAL = f"http://127.0.0.1:{PORTAL_PORT}"


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def wait_until(fn, label: str, timeout: float = 15.0):
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        try:
            value = fn()
            if value:
                return value
        except Exception as error:
            last = error
        time.sleep(0.1)
    raise RuntimeError(f"{label}: {last or 'timeout'}")


def launch_context(playwright, profile: str, runtime: Path, counters: dict):
    options = {
        "headless": True,
        "args": [
            "--no-sandbox",
            f"--disable-extensions-except={runtime}",
            f"--load-extension={runtime}",
        ],
    }
    if os.environ.get("SA_TEST_CHROMIUM"):
        options["executable_path"] = os.environ["SA_TEST_CHROMIUM"]
    else:
        options["channel"] = "chromium"
    context = playwright.chromium.launch_persistent_context(profile, **options)

    def observe(request):
        url = request.url
        path = urlparse(url).path
        if "/v1/credential-transfers/" in path:
            if request.method == "GET" and path.endswith("/packet"):
                counters["packet_get"] += 1
            if request.method == "POST" and path.endswith("/ack"):
                counters["ack_post"] += 1
        if "ozon.ru" in url or "wildberries.ru" in url:
            counters["provider"] += 1
        host = (urlparse(url).hostname or "").lower()
        if request.method == "POST" and host in {
            "chatgpt.com",
            "chat.openai.com",
            "alice.yandex.ru",
        }:
            counters["supported_ai_post"] += 1

    context.on("request", observe)
    worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker")
    popup = context.new_page()
    popup.goto(worker.url.rsplit("/", 1)[0] + "/popup.html")
    return context, worker, popup


def identity(worker) -> dict:
    return worker.evaluate(
        """async()=> {
          const authority = await SellerAgentsControlClient.getAuthority();
          const status = await SellerAgentsControlClient.status();
          return {
            accountId: authority?.payload?.account?.id || null,
            deviceId: authority?.deviceId || null,
            sessionId: authority?.sessionId || null,
            authenticated: status.authenticated === true
          };
        }"""
    )


def recipient_records(worker) -> list[dict]:
    return worker.evaluate("async()=>SellerAgentsControlClient.listCredentialTransferRecipients()")


def store_revision(worker, store_id: str) -> str | None:
    return worker.evaluate(
        "async id => (await SellerAgentsActiveStoreCatalog.get(id)).credentialRevision || null",
        store_id,
    )


def store_secret_present(worker, store_id: str) -> bool:
    return bool(
        worker.evaluate(
            """async id => {
              const store = await SellerAgentsActiveStoreCatalog.get(id);
              return Boolean(store?.credentials?.seller?.apiKey);
            }""",
            store_id,
        )
    )


def expire_request_in_disposable_db(request_id: str, env: dict) -> None:
    script = """import pg from 'pg';
(async () => {
  const client = new pg.Client({connectionString: process.env.DATABASE_URL});
  await client.connect();
  const result = await client.query(
    "UPDATE credential_transfer_requests SET expires_at=now()-interval '1 second' WHERE request_id=$1 RETURNING request_id",
    [process.env.TRANSFER_REQUEST_ID],
  );
  await client.end();
  if (result.rowCount !== 1) process.exit(2);
})().catch(error => { console.error(error?.message || String(error)); process.exit(1); });
"""
    child_env = {
        **env,
        "TRANSFER_REQUEST_ID": request_id,
        "PATH": NODE_BIN + ":" + env.get("PATH", os.environ.get("PATH", "")),
    }
    subprocess.run(
        [PNPM, "--filter", "@product/db", "exec", "tsx", "-e", script],
        cwd=ROOT,
        env=child_env,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )


def build_local_package(temp: Path, trust: Path, env: dict) -> Path:
    placeholder = temp / "unused-private-key.der"
    raw_config = subprocess.check_output(
        [
            NODE,
            str(ROOT / "tests/regression/extension-core/client-i1/make-browser-config.mjs"),
            str(placeholder),
            str(trust),
        ],
        cwd=ROOT,
        env=env,
        text=True,
    )
    config = json.loads(raw_config)
    config["controlApiOrigin"] = API
    config["portalOrigin"] = PORTAL
    output = temp / "package"
    build_env = {
        **env,
        "SA_PACKAGED_CONFIG_JSON": json.dumps(config, separators=(",", ":")),
        "PATH": NODE_BIN + ":" + env.get("PATH", os.environ.get("PATH", "")),
    }
    subprocess.run(
        ["python3", "tooling/build/extension_composed.py", "--output", str(output)],
        cwd=ROOT,
        env=build_env,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    return output


def run(output: Path) -> dict:
    if os.environ.get("PRODUCT_CONTROL_PLANE_E2E") != "1":
        raise RuntimeError("PRODUCT_CONTROL_PLANE_E2E=1 is required")
    if not os.environ.get("DATABASE_URL"):
        raise RuntimeError("DATABASE_URL is required")

    output.mkdir(parents=True, exist_ok=False)
    stage = "prepare"
    processes: list[subprocess.Popen] = []
    result: dict = {
        "status": "RUNNING",
        "task": "A04-TWO-INSTALL-KEY-TRANSFER",
        "evidence_level": "INSTALLED_SYNTHETIC_LOCAL_DEVELOPMENT",
        "provider_requests": 0,
        "supported_ai_posts": 0,
    }
    base_env = {
        **os.environ,
        "PRODUCT_CONTROL_PLANE_E2E": "1",
        "SA_I1_API_PORT": str(API_PORT),
        "SA_I1_ALLOW_TWO_DEVICES": "1",
        "SA_I1_SAME_ACCOUNT_TWO_EMAILS": "1",
        "PATH": NODE_BIN + ":" + os.environ.get("PATH", ""),
    }
    namespace = re.sub(
        r"[^a-z0-9]",
        "",
        (os.environ.get("SA_I1_FIXTURE_NAMESPACE") or f"a04{int(time.time())}").lower(),
    )[:24]
    base_env["SA_I1_FIXTURE_NAMESPACE"] = namespace
    fixture_email = lambda name: f"q1a-{namespace}-{name}@example.test"

    with tempfile.TemporaryDirectory(prefix="octoport-a04-transfer-") as temp_name:
        temp = Path(temp_name)
        trust = temp / "public-trust-bundle.json"
        fixture_evidence = temp / "fixture-evidence.json"
        fixture_keys = temp / "fixture-keys.json"
        api_env = {
            **base_env,
            "SA_I1_PUBLIC_TRUST_BUNDLE_PATH": str(trust),
            "SA_I1_FIXTURE_EVIDENCE_PATH": str(fixture_evidence),
            "SA_I1_FIXTURE_KEYS_PATH": str(fixture_keys),
        }
        try:
            stage = "database_migrate"
            subprocess.run(
                [PNPM, "db:migrate"],
                cwd=ROOT,
                env=base_env,
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )

            stage = "api_start"
            api = subprocess.Popen(
                [
                    PNPM,
                    "--filter",
                    "@product/api",
                    "exec",
                    "tsx",
                    "../../tests/regression/extension-core/client-i1/api-harness.ts",
                ],
                cwd=ROOT,
                env=api_env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
            processes.append(api)
            base.wait_url(f"{API}/health/ready")
            if not trust.is_file() or not fixture_evidence.is_file():
                raise RuntimeError("fixture API evidence missing")
            fixture = json.loads(fixture_evidence.read_text())
            if fixture.get("existing_fixture_accounts") != 2:
                raise RuntimeError("expected two fixture accounts")

            stage = "package_build"
            package_root = build_local_package(temp, trust, base_env)
            archives = sorted(package_root.glob("*.zip"))
            if len(archives) != 1:
                raise RuntimeError("expected one local package archive")
            archive = archives[0]
            composition = json.loads((package_root / "composition-receipt.json").read_text())
            runtime = package_root / "runtime"
            if not (runtime / "manifest.json").is_file():
                raise RuntimeError("built runtime missing")
            retained_archive = output / archive.name
            shutil.copy2(archive, retained_archive)
            retained_composition = output / "composition-receipt.json"
            shutil.copy2(package_root / "composition-receipt.json", retained_composition)
            result["package"] = {
                "name": archive.name,
                "artifact_path": str(retained_archive),
                "sha256": file_sha256(retained_archive),
                "bytes": retained_archive.stat().st_size,
                "version": composition.get("version"),
                "build_mode": composition.get("build_mode"),
                "environment": composition.get("environment"),
                "source_head": subprocess.check_output(
                    ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
                ).strip(),
                "runtime_input_sha256": composition.get("inputs", {})
                .get("apps/extension/src/application/runtime.js", {})
                .get("sha256"),
                "composition_receipt": str(retained_composition),
            }

            stage = "portal_start"
            portal_env = {
                **base_env,
                "CONTROL_PLANE_API_ORIGIN": API,
            }
            portal = subprocess.Popen(
                [
                    PNPM,
                    "--filter",
                    "@product/portal",
                    "exec",
                    "next",
                    "dev",
                    "--hostname",
                    "127.0.0.1",
                    "--port",
                    str(PORTAL_PORT),
                ],
                cwd=ROOT,
                env=portal_env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
            processes.append(portal)
            base.wait_url(f"{PORTAL}/login")

            stage = "installed_profiles"
            counters = {
                "packet_get": 0,
                "ack_post": 0,
                "provider": 0,
                "supported_ai_post": 0,
            }
            with (
                sync_playwright() as playwright,
                tempfile.TemporaryDirectory(prefix="a04-source-") as source_profile,
                tempfile.TemporaryDirectory(prefix="a04-recipient-") as recipient_profile,
                tempfile.TemporaryDirectory(prefix="a04-other-account-") as other_profile,
            ):
                source = recipient = other = None
                source_worker = source_popup = None
                recipient_worker = recipient_popup = None
                other_worker = other_popup = None
                try:
                    stage = "source_profile_launch"
                    source, source_worker, source_popup = launch_context(
                        playwright, source_profile, runtime, counters
                    )
                    stage = "recipient_profile_launch"
                    recipient, recipient_worker, recipient_popup = launch_context(
                        playwright, recipient_profile, runtime, counters
                    )
                    stage = "ordinary_activation"
                    base.activate(source, source_popup, fixture_email("one"))
                    base.activate(recipient, recipient_popup, fixture_email("two"))
                    source_id = identity(source_worker)
                    recipient_id = identity(recipient_worker)
                    if not (
                        source_id["authenticated"]
                        and recipient_id["authenticated"]
                    ):
                        raise RuntimeError("ordinary activation did not authenticate")
                    if source_id["accountId"] != recipient_id["accountId"]:
                        raise RuntimeError("source and recipient are not the same account")
                    if source_id["deviceId"] == recipient_id["deviceId"]:
                        raise RuntimeError("source and recipient device ids are not isolated")

                    store_id = "a04-transfer-store"
                    synthetic_api_key = "A04_SYNTHETIC_OZON_API_KEY_NEVER_REAL"
                    base.seed_store(
                        source_worker,
                        store_id,
                        {
                            "seller": {
                                "clientId": "a04-synthetic-client",
                                "apiKey": synthetic_api_key,
                            },
                            "performance": {},
                        },
                        "a04-source-revision",
                    )
                    base.seed_store(recipient_worker, store_id, {}, None)
                    base.selected_popup(source_popup, store_id)
                    base.selected_popup(recipient_popup, store_id)

                    stage = "explicit_consent"
                    before_refusal = len(recipient_records(recipient_worker))
                    recipient_popup.locator("#transfer-consent").uncheck()
                    recipient_popup.click("#transfer-create")
                    wait_until(
                        lambda: "соглас" in recipient_popup.locator("#status").inner_text().lower(),
                        "consent refusal status",
                    )
                    if len(recipient_records(recipient_worker)) != before_refusal:
                        raise RuntimeError("refusal created a transfer request")

                    recipient_popup.locator("#transfer-consent").check()
                    recipient_popup.click("#transfer-create")
                    wait_until(
                        lambda: "Запрос создан"
                        in recipient_popup.locator("#transfer-status").inner_text(),
                        "transfer create",
                    )
                    records = recipient_records(recipient_worker)
                    if len(records) != 1:
                        raise RuntimeError("recipient vault did not contain exactly one request")
                    first_request = records[0]
                    first_request_id = first_request["requestId"]

                    stage = "recipient_restart"
                    recipient.close()
                    recipient, recipient_worker, recipient_popup = launch_context(
                        playwright, recipient_profile, runtime, counters
                    )
                    base.selected_popup(recipient_popup, store_id)
                    restored = recipient_worker.evaluate(
                        """async requestId => {
                          const row = await SellerAgentsCredentialTransferVault.get(requestId);
                          if (!row) return null;
                          let exportRejected = false;
                          try { await crypto.subtle.exportKey('jwk', row.privateKey); }
                          catch (_) { exportRejected = true; }
                          return {
                            phase: row.phase,
                            keyType: row.privateKey?.type || null,
                            keyExtractable: row.privateKey?.extractable ?? null,
                            exportRejected,
                          };
                        }""",
                        first_request_id,
                    )
                    if restored != {
                        "phase": "ACTIVE",
                        "keyType": "private",
                        "keyExtractable": False,
                        "exportRejected": True,
                    }:
                        raise RuntimeError(f"recipient vault restart mismatch: {restored}")

                    stage = "source_restart"
                    source.close()
                    source, source_worker, source_popup = launch_context(
                        playwright, source_profile, runtime, counters
                    )
                    base.selected_popup(source_popup, store_id)
                    if not store_secret_present(source_worker, store_id):
                        raise RuntimeError("source credentials did not survive source restart")

                    stage = "successful_transfer"
                    source_popup.click("#transfer-discover")
                    wait_until(
                        lambda: "Найдено запросов: 1"
                        in source_popup.locator("#transfer-status").inner_text(),
                        "source discover",
                    )
                    source_popup.wait_for_timeout(250)
                    recipient_popup.click("#transfer-receive")
                    wait_until(
                        lambda: "Передача принята"
                        in recipient_popup.locator("#transfer-status").inner_text(),
                        "recipient receive",
                    )
                    wait_until(
                        lambda: len(recipient_records(recipient_worker)) == 0,
                        "result consume",
                    )
                    imported_revision = store_revision(recipient_worker, store_id)
                    if not imported_revision:
                        raise RuntimeError("credential revision missing after import")
                    completed = adversarial.api(
                        recipient_worker,
                        f"/v1/credential-transfers/{first_request_id}",
                    )
                    if completed["status"] != 200 or completed["body"].get("state") != "COMPLETED":
                        raise RuntimeError(f"transfer did not complete: {completed}")

                    stage = "recipient_restart_no_reapply"
                    packet_before = counters["packet_get"]
                    ack_before = counters["ack_post"]
                    recipient.close()
                    recipient, recipient_worker, recipient_popup = launch_context(
                        playwright, recipient_profile, runtime, counters
                    )
                    base.selected_popup(recipient_popup, store_id)
                    if store_revision(recipient_worker, store_id) != imported_revision:
                        raise RuntimeError("credential revision changed across recipient restart")
                    recipient_popup.click("#transfer-receive")
                    wait_until(
                        lambda: "Активной передачи"
                        in recipient_popup.locator("#transfer-status").inner_text(),
                        "post-restart no pending transfer",
                    )
                    if store_revision(recipient_worker, store_id) != imported_revision:
                        raise RuntimeError("replay changed credential revision")
                    if counters["packet_get"] != packet_before or counters["ack_post"] != ack_before:
                        raise RuntimeError("restart replay repeated packet or ACK")

                    stage = "cancellation_and_account_isolation"
                    source.close()
                    source = None
                    stage = "other_account_profile_launch"
                    other, other_worker, other_popup = launch_context(
                        playwright, other_profile, runtime, counters
                    )
                    base.activate(other, other_popup, fixture_email("attacker"))
                    other_id = identity(other_worker)
                    if not other_id["authenticated"]:
                        raise RuntimeError("isolation account did not authenticate")
                    if other_id["accountId"] == recipient_id["accountId"]:
                        raise RuntimeError("isolation account was not distinct")
                    recipient_popup.locator("#transfer-consent").check()
                    recipient_popup.click("#transfer-create")
                    wait_until(
                        lambda: "Запрос создан"
                        in recipient_popup.locator("#transfer-status").inner_text(),
                        "cancellation request create",
                    )
                    cancel_records = recipient_records(recipient_worker)
                    if len(cancel_records) != 1:
                        raise RuntimeError("cancellation request not durable")
                    cancel_request_id = cancel_records[0]["requestId"]
                    foreign_read = adversarial.api(
                        other_worker,
                        f"/v1/credential-transfers/{cancel_request_id}",
                    )
                    foreign_cancel = adversarial.api(
                        other_worker,
                        f"/v1/credential-transfers/{cancel_request_id}/cancel",
                        "POST",
                        {},
                    )
                    if foreign_read["status"] not in {404, 409}:
                        raise RuntimeError(f"cross-account read was not denied: {foreign_read['status']}")
                    if foreign_cancel["status"] != 409:
                        raise RuntimeError(
                            f"cross-account cancel was not denied: {foreign_cancel['status']}"
                        )
                    cancelled = adversarial.api(
                        recipient_worker,
                        f"/v1/credential-transfers/{cancel_request_id}/cancel",
                        "POST",
                        {},
                    )
                    if cancelled["status"] != 200 or cancelled["body"].get("state") != "CANCELLED":
                        raise RuntimeError(f"recipient cancellation failed: {cancelled}")
                    cancel_pending = recipient_popup.evaluate(
                        "async()=>chrome.runtime.sendMessage({type:'SA_TRANSFER_RECEIVE_PENDING'})"
                    )
                    if cancel_pending.get("ok") is not False or cancel_pending.get("importState") != "PENDING":
                        raise RuntimeError(f"cancelled request was not cleared: {cancel_pending}")
                    if recipient_records(recipient_worker):
                        raise RuntimeError("cancelled recipient vault entry remained")
                    if store_revision(recipient_worker, store_id) != imported_revision:
                        raise RuntimeError("cancellation changed imported credentials")
                    other.close()
                    other = None

                    stage = "expiry"
                    expiring = recipient_popup.evaluate(
                        """async storeId => chrome.runtime.sendMessage({
                          type:'SA_TRANSFER_CREATE',
                          consent:true,
                          selectedStoreIds:[storeId],
                          expiresInSeconds:60
                        })""",
                        store_id,
                    )
                    if expiring.get("ok") is not True:
                        raise RuntimeError(f"expiry request create failed: {expiring}")
                    expiry_request_id = expiring["request"]["requestId"]
                    expire_request_in_disposable_db(expiry_request_id, base_env)
                    expiry_pending = recipient_popup.evaluate(
                        "async()=>chrome.runtime.sendMessage({type:'SA_TRANSFER_RECEIVE_PENDING'})"
                    )
                    if expiry_pending.get("ok") is not False or expiry_pending.get("importState") != "PENDING":
                        raise RuntimeError(f"expired request was not pruned: {expiry_pending}")
                    if recipient_records(recipient_worker):
                        raise RuntimeError("expired recipient vault entry remained")
                    expired = adversarial.api(
                        recipient_worker,
                        f"/v1/credential-transfers/{expiry_request_id}",
                    )
                    if expired["status"] != 200 or expired["body"].get("state") != "EXPIRED":
                        raise RuntimeError(f"server did not expose EXPIRED state: {expired}")
                    if store_revision(recipient_worker, store_id) != imported_revision:
                        raise RuntimeError("expiry changed imported credentials")

                    stage = "source_final_reopen"
                    source, source_worker, source_popup = launch_context(
                        playwright, source_profile, runtime, counters
                    )
                    base.selected_popup(source_popup, store_id)
                    if not store_secret_present(source_worker, store_id):
                        raise RuntimeError("source credentials missing on final reopen")
                    pending_source = adversarial.api(
                        source_worker, "/v1/credential-transfers/pending/source"
                    )
                    if pending_source["status"] != 200:
                        raise RuntimeError("source pending list failed")
                    if pending_source["body"]:
                        raise RuntimeError("terminal transfers remained discoverable by source")

                    stage = "final"
                    if counters["packet_get"] != 1 or counters["ack_post"] != 1:
                        raise RuntimeError(
                            f"successful transfer was not single packet/ACK: {counters}"
                        )
                    if counters["provider"] or counters["supported_ai_post"]:
                        raise RuntimeError("external provider/supported-AI request observed")
                    result.update(
                        status="PASS",
                        browser=recipient.browser.version,
                        checks={
                            "ordinary_two_device_auth": True,
                            "explicit_consent_refusal": True,
                            "recipient_restart_nonextractable_key": True,
                            "source_restart_credentials_available": True,
                            "single_receive_and_ack": True,
                            "recipient_restart_no_reapply": True,
                            "cross_account_read_cancel_denied": True,
                            "recipient_cancel_terminal_and_vault_pruned": True,
                            "expiry_terminal_and_vault_pruned": True,
                            "terminal_requests_not_source_discoverable": True,
                        },
                        network_counts={
                            "packet_get": counters["packet_get"],
                            "ack_post": counters["ack_post"],
                        },
                        provider_requests=counters["provider"],
                        supported_ai_posts=counters["supported_ai_post"],
                        external_credentials=False,
                    )
                finally:
                    for context in (source, recipient, other):
                        if context is None:
                            continue
                        try:
                            context.close()
                        except Exception:
                            pass

            (output / "result.json").write_text(
                json.dumps(result, ensure_ascii=False, indent=2) + "\n"
            )
            return result
        except Exception as error:
            result.update(
                status="FAIL",
                stage=stage,
                error_type=type(error).__name__,
                error=str(error)[:320],
            )
            (output / "result.json").write_text(
                json.dumps(result, ensure_ascii=False, indent=2) + "\n"
            )
            raise
        finally:
            for process in reversed(processes):
                if process.poll() is None:
                    process.terminate()
            for process in reversed(processes):
                try:
                    process.wait(timeout=10)
                except Exception:
                    if process.poll() is None:
                        process.kill()


def main() -> int:
    output = Path(
        os.environ.get(
            "A04_TRANSFER_OUTPUT",
            tempfile.mkdtemp(prefix="octoport-a04-transfer-result-"),
        )
    )
    result = run(output)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
