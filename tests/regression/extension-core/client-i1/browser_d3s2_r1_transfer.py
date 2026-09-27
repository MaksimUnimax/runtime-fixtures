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
API_PORT = int(os.environ.get("SA_Q1A_API_PORT", "43102"))
PORTAL_PORT = int(os.environ.get("SA_Q1A_PORTAL_PORT", "43103"))
EMAIL = "i1-client-one@example.test"
OTP = "424242"
ACCOUNT_STORE = "seller_agents_stores_v1"


def fixture_email(name: str) -> str:
    namespace = re.sub(r"[^a-z0-9]", "", os.environ.get("SA_I1_FIXTURE_NAMESPACE", "fixture").lower())[:24] or "fixture"
    return f"q1a-{namespace}-{name}@example.test"


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


def activate(context, popup, email=EMAIL):
    with context.expect_page() as opened:
        popup.click("#auth-start")
    portal = opened.value
    portal.wait_for_url("**/login?returnTo=*")
    portal.locator('input[type="email"]').fill(email)
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


def watch_transfer_responses(context, responses) -> None:
    context.on(
        "response",
        lambda response: responses.append(response)
        if response.request.method == "POST"
        and "/v1/credential-transfers" in urlparse(response.url).path
        else None,
    )


def run_runtime(runtime: Path, label: str, package_root: Path, api_log: list[str]) -> dict:
    store_id = f"r1-{label}-ozon"
    marker = f"D3S2_R1_{label.upper()}_SELLER_MARKER_20260918"
    source_profile = tempfile.TemporaryDirectory(prefix=f"d3s2-r1-{label}-source-")
    recipient_profile = tempfile.TemporaryDirectory(prefix=f"d3s2-r1-{label}-recipient-")
    captures = []
    transfer_responses = []
    with sync_playwright() as pw:
        options = {"headless": True, "args": ["--no-sandbox", f"--disable-extensions-except={runtime}", f"--load-extension={runtime}"]}
        if os.environ.get("SA_TEST_CHROMIUM"):
            options["executable_path"] = os.environ["SA_TEST_CHROMIUM"]
        else:
            options["channel"] = "chromium"
        source = pw.chromium.launch_persistent_context(source_profile.name, **options)
        recipient = pw.chromium.launch_persistent_context(recipient_profile.name, **options)
        for context in (source, recipient):
            context.on("request", lambda request: captures.append({"method": request.method, "url": request.url, "body_sha256": hashlib.sha256((request.post_data or "").encode()).hexdigest() if request.post_data else None, "body_has_ciphertext": "ciphertext" in (request.post_data or "")}))
        watch_transfer_responses(recipient, transfer_responses)
        try:
            source_worker = source.service_workers[0] if source.service_workers else source.wait_for_event("serviceworker")
            recipient_worker = recipient.service_workers[0] if recipient.service_workers else recipient.wait_for_event("serviceworker")
            source_popup = source.new_page(); source_popup.goto(source_worker.url.rsplit("/", 1)[0] + "/popup.html")
            recipient_popup = recipient.new_page(); recipient_popup.goto(recipient_worker.url.rsplit("/", 1)[0] + "/popup.html")
            # Each package variant gets its own pre-created fixture account.
            # Two simultaneous devices are sufficient; the next variant must not
            # reuse the first account and accidentally request a third device.
            account_email = fixture_email("one" if label == "source-generated" else "two")
            activate(source, source_popup, os.environ.get("D3S2_SOURCE_EMAIL", account_email))
            activate(recipient, recipient_popup, os.environ.get("D3S2_RECIPIENT_EMAIL", account_email))
            source_identity = source_worker.evaluate("async()=>({accountId:await SellerAgentsControlClient.currentAccount(),deviceId:(await SellerAgentsControlClient.getAuthority())?.deviceId})")
            recipient_identity = recipient_worker.evaluate("async()=>({accountId:await SellerAgentsControlClient.currentAccount(),deviceId:(await SellerAgentsControlClient.getAuthority())?.deviceId})")
            assert source_identity["accountId"] == recipient_identity["accountId"]
            assert source_identity["deviceId"] and recipient_identity["deviceId"] and source_identity["deviceId"] != recipient_identity["deviceId"]
            seed_store(source_worker, store_id, {"seller": {"clientId": "100001", "apiKey": marker}, "performance": {"clientId": "perf-client", "clientSecret": "D3S2_R1_PERFORMANCE_MARKER_20260918"}}, "r1-source-revision")
            seed_store(recipient_worker, store_id, {}, None)
            unselected_store_id = f"{store_id}-unselected"
            seed_store(source_worker, unselected_store_id, {"seller": {"clientId": "100002", "apiKey": f"{marker}_UNSELECTED"}}, "r1-unselected-source-revision")
            seed_store(recipient_worker, unselected_store_id, {}, None)
            unselected_before = recipient_worker.evaluate("async ({id}) => { const s=await SellerAgentsActiveStoreCatalog.get(id); return {revision:s.credentialRevision,seller:s.credentials.seller ?? null}; }", {"id": unselected_store_id})
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
            assert request_body["consent"] is True
            assert request_body["recipientDeviceId"] == recipient_identity["deviceId"]
            assert request_record["accountId"] == recipient_identity["accountId"]
            assert request_body["selectedStores"] == [{"storeId": store_id}]
            assert "ciphertext" not in json.dumps(request_record)
            restarted = os.environ.get("D3S2_R1_RESTART_RECIPIENT") == "1"
            if restarted:
                # Keep the same synthetic profile so the non-extractable key
                # must survive worker/browser shutdown through IndexedDB.
                recipient.close()
                recipient = pw.chromium.launch_persistent_context(recipient_profile.name, **options)
                recipient.on("request", lambda request: captures.append({"method": request.method, "url": request.url, "body_sha256": hashlib.sha256((request.post_data or "").encode()).hexdigest() if request.post_data else None, "body_has_ciphertext": "ciphertext" in (request.post_data or "")}))
                watch_transfer_responses(recipient, transfer_responses)
                recipient_worker = recipient.service_workers[0] if recipient.service_workers else recipient.wait_for_event("serviceworker")
                recipient_popup = recipient.new_page()
                recipient_popup.goto(recipient_worker.url.rsplit("/", 1)[0] + "/popup.html")
                selected_popup(recipient_popup, store_id)
                restored = recipient_worker.evaluate(
                    """async ({requestId}) => {
                      const record=await SellerAgentsCredentialTransferVault.get(requestId);
                      let exportRejected=false;
                      try { await crypto.subtle.exportKey('jwk',record.privateKey); } catch (_) { exportRejected=true; }
                      return {phase:record.phase,accountId:record.accountId,recipientDeviceId:record.recipientDeviceId,requestId:record.requestId,selectedStoreIds:record.selectedStoreIds,keyType:record.privateKey.type,keyExtractable:record.privateKey.extractable,exportRejected};
                    }""",
                    {"requestId": request_record["requestId"]},
                )
                assert restored == {"phase": "ACTIVE", "accountId": recipient_identity["accountId"], "recipientDeviceId": recipient_identity["deviceId"], "requestId": request_record["requestId"], "selectedStoreIds": [store_id], "keyType": "private", "keyExtractable": False, "exportRejected": True}, restored
            source_popup.click("#transfer-discover")
            source_popup.wait_for_function("() => /Найдено запросов: 1/.test(document.querySelector('#transfer-status')?.textContent || '')")
            source_popup.wait_for_timeout(250)
            if restarted:
                # Drive the production receive message without the popup's
                # immediate RESULT_CONSUME so the recovery boundary is observable.
                received = recipient_popup.evaluate("async()=>chrome.runtime.sendMessage({type:'SA_TRANSFER_RECEIVE_PENDING'})")
                assert received["ok"] is True and received["importState"] == "IMPORTED", received
            else:
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
            result = {"status": "PASS", "recipient_restarted": restarted, "browser": recipient.browser.version, "request_id": request_record["requestId"], "store_id": store_id, "source_device": source_identity["deviceId"], "recipient_device": recipient_identity["deviceId"], "ciphertext_request_hashes": [x["body_sha256"] for x in captures if x["body_has_ciphertext"]], "provider_requests": [x for x in captures if "ozon.ru" in x["url"] or "wildberries.ru" in x["url"]], "ai_requests": [x for x in captures if "chatgpt.com" in x["url"] and x["method"] == "POST"]}
            if restarted:
                unselected = recipient_worker.evaluate("async ({id}) => { const s = await SellerAgentsActiveStoreCatalog.get(id); return {revision:s.credentialRevision, seller:s.credentials.seller ?? null}; }", {"id": unselected_store_id})
                assert unselected == unselected_before, unselected
                acked = recipient_worker.evaluate("async ({id}) => { const r=await SellerAgentsCredentialTransferVault.get(id); const server=await SellerAgentsControlClient.readCredentialTransfer(id); return {phase:r.phase,privateKey:r.privateKey,result:r.result,serverState:server.state,sourceDeviceId:server.sourceDeviceId}; }", {"id": request_record["requestId"]})
                assert acked["phase"] == "ACKED_RESULT" and acked["privateKey"] is None, acked
                assert acked["serverState"] == "COMPLETED" and acked["sourceDeviceId"] == source_identity["deviceId"], acked
                selected_revision = target["revision"]
                ack_posts_before = sum(urlparse(response.url).path.endswith("/ack") for response in transfer_responses)
                packet_gets_before = sum(item["method"] == "GET" and urlparse(item["url"]).path.endswith("/packet") for item in captures)
                replay = recipient_popup.evaluate("async()=>chrome.runtime.sendMessage({type:'SA_TRANSFER_RECEIVE_PENDING'})")
                assert replay["ok"] is True and replay["recovered"] is True and replay["requestId"] == request_record["requestId"], replay
                after_replay = recipient_worker.evaluate("async ({id,storeId}) => ({record:await SellerAgentsCredentialTransferVault.get(id),store:await SellerAgentsActiveStoreCatalog.get(storeId),server:await SellerAgentsControlClient.readCredentialTransfer(id)})", {"id": request_record["requestId"], "storeId": store_id})
                assert after_replay["record"]["phase"] == "ACKED_RESULT" and after_replay["record"]["privateKey"] is None, after_replay
                assert after_replay["store"]["credentialRevision"] == selected_revision, after_replay
                assert after_replay["server"]["state"] == "COMPLETED", after_replay
                assert sum(urlparse(response.url).path.endswith("/ack") for response in transfer_responses) == ack_posts_before == 1
                assert sum(item["method"] == "GET" and urlparse(item["url"]).path.endswith("/packet") for item in captures) == packet_gets_before == 1
                consumed = recipient_popup.evaluate("async ({id})=>chrome.runtime.sendMessage({type:'SA_TRANSFER_RESULT_CONSUME',requestId:id})", {"id": request_record["requestId"]})
                assert consumed["ok"] is True, consumed
                assert recipient_worker.evaluate("async ({id})=>SellerAgentsCredentialTransferVault.get(id)", {"id": request_record["requestId"]}) is None
                after_consume = recipient_popup.evaluate("async()=>chrome.runtime.sendMessage({type:'SA_TRANSFER_RECEIVE_PENDING'})")
                assert after_consume["ok"] is False and after_consume["importState"] == "PENDING", after_consume
                assert sum(urlparse(response.url).path.endswith("/ack") for response in transfer_responses) == 1
                assert sum(item["method"] == "GET" and urlparse(item["url"]).path.endswith("/packet") for item in captures) == 1
                result["restart_recovery"] = {"nonExtractableKeyRecovered": True, "serverState": "COMPLETED", "ackPosts": 1, "packetReads": 1, "replayRecoveredCachedResult": True, "selectedStoreRevisionUnchangedOnReplay": True, "unselectedStoreUntouched": True}
            return result
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
            key_path = os.environ.get("SA_Q1A_FIXTURE_KEYS_PATH") or str(temp / "fixture-keys.json")
            env = {**os.environ, "SA_I1_API_PORT": str(API_PORT), "SA_I1_PUBLIC_TRUST_BUNDLE_PATH": str(trust), "SA_I1_FIXTURE_EVIDENCE_PATH": str(fixture), "SA_I1_FIXTURE_KEYS_PATH": key_path, "PRODUCT_CONTROL_PLANE_E2E": "1", "SA_I1_ALLOW_TWO_DEVICES": "1"}
            api = subprocess.Popen([PNPM, "--filter", "@product/api", "exec", "tsx", "../../tests/regression/extension-core/client-i1/api-harness.ts"], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            processes.append(api); wait_url(f"http://127.0.0.1:{API_PORT}/health/ready")
            configured_package = os.environ.get("SA_Q1A_FINAL_PACKAGE_ROOT")
            if configured_package:
                build = Path(configured_package).resolve()
            else:
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
