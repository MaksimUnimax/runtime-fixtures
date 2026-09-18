"""Installed D3S2-2A R1 transfer proof.

This intentionally drives the popup, two real MV3 service workers, the local
API/portal, and the production transfer routes.  Credentials and envelopes
are synthetic and are reduced to presence/hash evidence in the receipt.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
NODE = "/root/.nvm/versions/node/v24.20.0/bin/node"
PNPM = "/root/.nvm/versions/node/v24.20.0/bin/pnpm"
API_PORT, PORTAL_PORT = 43102, 43103
EMAIL = "i1-client-one@example.test"
OTP = "424242"
ACCOUNT_STORE = "seller_agents_stores_v1"


def wait_url(url: str, timeout: float = 45) -> None:
    import urllib.request

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status < 500:
                    return
        except Exception:
            pass
        time.sleep(0.2)
    raise RuntimeError(f"timeout waiting for {url}")


def post_code(page, url: str, action, expected: int) -> None:
    with page.expect_response(lambda r: r.request.method == "POST" and r.url == url) as pending:
        action()
    response = pending.value
    if response.status != expected:
        raise AssertionError(f"{url}: {response.status}")


def activate(context, popup):
    with context.expect_page() as opened:
        popup.click("#auth-start")
    portal = opened.value
    portal.wait_for_url("**/login?returnTo=*")
    portal.locator('input[type="email"]').fill(EMAIL)
    post_code(portal, f"http://127.0.0.1:{PORTAL_PORT}/api/control-plane/v1/auth/otp/request", lambda: portal.get_by_role("button", name="Send code").click(), 202)
    portal.locator('input[inputmode="numeric"]').fill(OTP)
    post_code(portal, f"http://127.0.0.1:{PORTAL_PORT}/api/control-plane/v1/auth/otp/verify", lambda: portal.get_by_role("button", name="Verify").click(), 200)
    portal.wait_for_url("**/activate?authorizationId=*")
    auth_id = re.search(r"authorizationId=([0-9a-f-]{36})", portal.url, re.I).group(1)
    portal.locator("select option:not([value='']):not([disabled])").first.wait_for(state="attached")
    popup.wait_for_function("() => /[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/.test((document.querySelector('#auth-code')?.textContent || '').trim())")
    code = re.search(r"([ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4})$", popup.locator("#auth-code").inner_text().strip()).group(1)
    active = portal.locator("select option:not([value='']):not([disabled])").first
    active_value = active.get_attribute("value")
    if not active_value:
        raise RuntimeError("activation account selector has no active account")
    portal.locator("select").select_option(value=active_value)
    portal.get_by_label("User code").fill(code)
    post_code(portal, f"http://127.0.0.1:{PORTAL_PORT}/api/control-plane/v1/device-authorizations/{auth_id}/approve", lambda: portal.get_by_role("button", name="Approve").click(), 200)
    portal.close()
    try:
        popup.wait_for_function("() => document.querySelector('#account')?.innerText.includes('Аккаунт ·')")
    except Exception as error:
        worker_status = None
        try:
            worker = context.service_workers[0]
            worker_status = worker.evaluate("async()=>SellerAgentsControlClient.status()")
        except Exception as diagnostic_error:
            worker_status = {"diagnostic_error": str(diagnostic_error)}
        print(json.dumps({"activation_popup_account": popup.locator("#account").inner_text(), "activation_status": popup.locator("#status").inner_text(), "auth_status": popup.locator("#auth-status").inner_text(), "worker_status": worker_status, "error": str(error)}), flush=True)
        raise


def seed_store(worker, store_id: str, credentials: dict, revision: str | None) -> None:
    worker.evaluate(
        """async ({storeId, credentials, revision}) => {
          const auth = await chrome.storage.local.get('seller_agents_control_auth_v2');
          const accountId = auth.seller_agents_control_auth_v2.authority.payload.account.id;
          const existing = (await chrome.storage.local.get('seller_agents_stores_v1')).seller_agents_stores_v1 || {version:1,accounts:{}};
          const account = existing.accounts[accountId] || {next:{ozon:1,wildberries:1},stores:{}};
          account.stores[storeId] = {id:storeId,accountId,marketplace:'ozon',name:'R1 transfer store',credentials,credentialRevision:revision,metadataRevision:0,lifecycleState:'ACTIVE',providerAccountId:null,providerIdentityState:'UNCONFIRMED',credentialsStale:!revision,personalDataEnabled:false,verification:{},createdAt:1700000000000};
          await chrome.storage.local.set({seller_agents_stores_v1:{...existing,accounts:{...existing.accounts,[accountId]:account}}});
        }""",
        {"storeId": store_id, "credentials": credentials, "revision": revision},
    )


def selected_popup(popup, store_id: str) -> None:
    popup.reload()
    popup.wait_for_function("() => document.querySelector('#account')?.innerText.includes('Аккаунт ·')")
    popup.click("#ozon")
    popup.wait_for_function("({id}) => [...document.querySelectorAll('#stores option')].some(x => x.value === id)", arg={"id": store_id})
    popup.select_option("#stores", store_id)


def run_runtime(runtime: Path, label: str, package_root: Path, api_log: list[str]) -> dict:
    store_id = f"r1-{label}-ozon"
    marker = f"D3S2_R1_{label.upper()}_SELLER_MARKER_20260918"
    source_profile = tempfile.TemporaryDirectory(prefix=f"d3s2-r1-{label}-source-")
    recipient_profile = tempfile.TemporaryDirectory(prefix=f"d3s2-r1-{label}-recipient-")
    captures = []
    transfer_responses = []
    with sync_playwright() as pw:
        options = {"headless": True, "channel": "chromium", "args": ["--no-sandbox", f"--disable-extensions-except={runtime}", f"--load-extension={runtime}"]}
        source = pw.chromium.launch_persistent_context(source_profile.name, **options)
        recipient = pw.chromium.launch_persistent_context(recipient_profile.name, **options)
        for context in (source, recipient):
            context.on("request", lambda request: captures.append({"method": request.method, "url": request.url, "body_sha256": hashlib.sha256((request.post_data or "").encode()).hexdigest() if request.post_data else None, "body_has_ciphertext": "ciphertext" in (request.post_data or "")}))
        recipient.on("response", lambda response: transfer_responses.append(response) if response.request.method == "POST" and response.url.endswith("/v1/credential-transfers") else None)
        try:
            source_worker = source.service_workers[0] if source.service_workers else source.wait_for_event("serviceworker")
            recipient_worker = recipient.service_workers[0] if recipient.service_workers else recipient.wait_for_event("serviceworker")
            source_popup = source.new_page(); source_popup.goto(source_worker.url.rsplit("/", 1)[0] + "/popup.html")
            recipient_popup = recipient.new_page(); recipient_popup.goto(recipient_worker.url.rsplit("/", 1)[0] + "/popup.html")
            activate(source, source_popup)
            activate(recipient, recipient_popup)
            seed_store(source_worker, store_id, {"seller": {"clientId": "100001", "apiKey": marker}, "performance": {"clientId": "perf-client", "clientSecret": "D3S2_R1_PERFORMANCE_MARKER_20260918"}}, "r1-source-revision")
            seed_store(recipient_worker, store_id, {}, None)
            selected_popup(source_popup, store_id)
            selected_popup(recipient_popup, store_id)
            recipient_popup.locator("#transfer-consent").check()
            recipient_popup.click("#transfer-create")
            recipient_popup.wait_for_function("() => /Запрос создан/.test(document.querySelector('#transfer-status')?.textContent || '')")
            created = next((response for response in reversed(transfer_responses) if response.status == 201), None)
            if created is None:
                raise AssertionError({"transfer_responses": [(response.status, response.url) for response in transfer_responses]})
            request_body = json.loads(created.request.post_data)
            request_record = created.json()
            assert request_body["consent"] is True and request_body["recipientDeviceId"] != request_record.get("sourceDeviceId")
            assert "ciphertext" not in json.dumps(request_record)
            source_popup.click("#transfer-discover")
            source_popup.wait_for_function("() => /Найдено запросов: 1/.test(document.querySelector('#transfer-status')?.textContent || '')")
            source_popup.wait_for_timeout(250)
            recipient_popup.click("#transfer-receive")
            try:
                recipient_popup.wait_for_function("() => /Передача принята/.test(document.querySelector('#transfer-status')?.textContent || '')", timeout=15000)
            except Exception as error:
                retry = recipient_popup.evaluate("async()=>chrome.runtime.sendMessage({type:'SA_TRANSFER_RECEIVE_PENDING'})")
                local = recipient_worker.evaluate("async ({id}) => { try { return await SellerAgentsActiveStoreCatalog.get(id); } catch (error) { return {error: error.code}; } }", {"id": store_id})
                print(json.dumps({"receive_error": str(error), "retry": retry, "local": local, "transfer_status": recipient_popup.locator("#transfer-status").inner_text(), "popup_status": recipient_popup.locator("#status").inner_text(), "worker": recipient_worker.evaluate("async()=>SellerAgentsControlClient.status()")}), flush=True)
                raise
            target = recipient_worker.evaluate("async ({id}) => { const s = await SellerAgentsActiveStoreCatalog.get(id); return {marketplace:s.marketplace, seller:s.credentials.seller, performance:s.credentials.performance, revision:s.credentialRevision}; }", {"id": store_id})
            assert target["seller"]["apiKey"] == marker
            assert target["performance"]["clientSecret"] == "D3S2_R1_PERFORMANCE_MARKER_20260918"
            return {"status": "PASS", "browser": recipient.browser.version, "request_id": request_record["requestId"], "store_id": store_id, "source_device": request_record.get("sourceDeviceId"), "recipient_device": request_record["recipientDeviceId"], "ciphertext_request_hashes": [x["body_sha256"] for x in captures if x["body_has_ciphertext"]], "provider_requests": [x for x in captures if "ozon.ru" in x["url"] or "wildberries.ru" in x["url"]], "ai_requests": [x for x in captures if "chatgpt.com" in x["url"] and x["method"] == "POST"]}
        finally:
            source.close(); recipient.close(); source_profile.cleanup(); recipient_profile.cleanup()


def main() -> int:
    database_url = os.environ["DATABASE_URL"]
    output = Path(os.environ.get("D3S2_R1_OUTPUT", tempfile.mkdtemp(prefix="d3s2-r1-transfer-receipt-")))
    output.mkdir(parents=True, exist_ok=True)
    processes = []
    try:
        with tempfile.TemporaryDirectory(prefix="d3s2-r1-transfer-server-") as temp:
            temp = Path(temp); trust = temp / "trust.json"; fixture = temp / "fixture.json"; key = temp / "placeholder"
            env = {**os.environ, "SA_I1_API_PORT": str(API_PORT), "SA_I1_PUBLIC_TRUST_BUNDLE_PATH": str(trust), "SA_I1_FIXTURE_EVIDENCE_PATH": str(fixture), "PRODUCT_CONTROL_PLANE_E2E": "1", "SA_I1_ALLOW_TWO_DEVICES": "1"}
            api = subprocess.Popen([PNPM, "--filter", "@product/api", "exec", "tsx", "../../tests/regression/extension-core/client-i1/api-harness.ts"], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            processes.append(api); wait_url(f"http://127.0.0.1:{API_PORT}/health/ready")
            config = subprocess.check_output([NODE, str(ROOT / "tests/regression/extension-core/client-i1/make-browser-config.mjs"), str(key), str(trust)], cwd=ROOT, env=env, text=True)
            config = json.loads(config); config["controlApiOrigin"] = f"http://127.0.0.1:{API_PORT}"; config["portalOrigin"] = f"http://127.0.0.1:{PORTAL_PORT}"
            build = temp / "package"; build_env = {**env, "SA_PACKAGED_CONFIG_JSON": json.dumps(config, separators=(",", ":"))}
            subprocess.run(["python3", "tooling/build/extension_composed.py", "--output", str(build)], cwd=ROOT, env=build_env, check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            portal_env = {**env, "CONTROL_PLANE_API_ORIGIN": f"http://127.0.0.1:{API_PORT}"}
            portal = subprocess.Popen([PNPM, "--filter", "@product/portal", "exec", "next", "dev", "--hostname", "127.0.0.1", "--port", str(PORTAL_PORT)], cwd=ROOT, env=portal_env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            processes.append(portal); wait_url(f"http://127.0.0.1:{PORTAL_PORT}/login")
            results = {}
            for label, runtime in (("source-generated", build / "runtime"), ("extracted-package", build / "extracted")):
                if os.environ.get("D3S2_R1_ONLY_LABEL") and os.environ["D3S2_R1_ONLY_LABEL"] != label:
                    continue
                results[label] = run_runtime(runtime, label, build, [])
            (output / "result.json").write_text(json.dumps({"status": "PASS", "results": results}, indent=2))
            print(json.dumps({"status": "PASS", "results": results}, indent=2))
    finally:
        for process in reversed(processes):
            if process.poll() is None: process.terminate()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
