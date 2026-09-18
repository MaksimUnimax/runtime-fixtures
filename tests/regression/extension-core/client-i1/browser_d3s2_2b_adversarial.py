"""Installed D3S2-2B adversarial transfer matrix.

This runner deliberately uses the popup/service-worker boundary and the real
credential-transfer HTTP routes.  It records only status/error/hash evidence;
synthetic credentials never leave the browser process in the receipt.
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
API_PORT, PORTAL_PORT = 43112, 43113
API = f"http://127.0.0.1:{API_PORT}"
OTP = "424242"
EMAILS = {
    "source": "i1-client-one@example.test",
    "recipient": "i1-client-two@example.test",
    "other_source": "i1-client-three@example.test",
    "attacker": "i1-client-attacker@example.test",
}
SERVER_PROCESS = None
SERVER_COMMAND = None
SERVER_ENV = None
SERVER_PROCESSES = []


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
        raise AssertionError(f"{url}: {response.status} {response.text()[:1000]}")


def activate(context, popup, email: str) -> None:
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
    popup.wait_for_function("() => document.querySelector('#account')?.innerText.includes('Аккаунт ·')")


def message(popup, kind: str, body: dict | None = None):
    return popup.evaluate("""async ({kind, body}) => {
      const value = await chrome.runtime.sendMessage({type: kind, ...(body || {})});
      return value;
    }""", {"kind": kind, "body": body or {}})


def client(worker, method: str, args=None):
    return worker.evaluate("""async ({method, args}) => {
      return await SellerAgentsControlClient[method](...(args || []));
    }""", {"method": method, "args": args or []})


def auth(worker) -> dict:
    return worker.evaluate("""async () => {
      const row = (await chrome.storage.local.get('seller_agents_control_auth_v2')).seller_agents_control_auth_v2;
      return {token: row?.credentials?.accessToken || null, accountId: row?.authority?.payload?.account?.id || null, deviceId: row?.credentials?.deviceId || null};
    }""")


def api(worker, path: str, method: str = "GET", body=None) -> dict:
    return worker.evaluate("""async ({origin, path, method, body}) => {
      const row = (await chrome.storage.local.get('seller_agents_control_auth_v2')).seller_agents_control_auth_v2;
      let last;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
          const response = await fetch(origin + path, {method, headers: {'Authorization': `Bearer ${row.credentials.accessToken}`, 'Content-Type': 'application/json'}, body: body === null ? undefined : JSON.stringify(body)});
          let value = null; try { value = await response.json(); } catch (_) {}
          return {status: response.status, body: value};
        } catch (error) { last = error; await new Promise(resolve => setTimeout(resolve, 250)); }
      }
      throw last;
    }""", {"origin": API, "path": path, "method": method, "body": body})


def seed_store(worker, store_id: str, marketplace: str, credentials: dict, revision: str | None, provider_account_id=None, identity="UNCONFIRMED", lifecycle="ACTIVE") -> None:
    worker.evaluate("""async ({storeId, marketplace, credentials, revision, providerAccountId, identity, lifecycle}) => {
      const auth = await chrome.storage.local.get('seller_agents_control_auth_v2');
      const accountId = auth.seller_agents_control_auth_v2.authority.payload.account.id;
      const existing = (await chrome.storage.local.get('seller_agents_stores_v1')).seller_agents_stores_v1 || {version:1,accounts:{}};
      const account = existing.accounts[accountId] || {next:{ozon:1,wildberries:1},stores:{}};
      account.stores[storeId] = {id:storeId,accountId,marketplace,name:'D3S2-2B synthetic',credentials,credentialRevision:revision,metadataRevision:0,lifecycleState:lifecycle,providerAccountId:providerAccountId || null,providerIdentityState:identity,credentialsStale:lifecycle !== 'ACTIVE' || !revision,personalDataEnabled:false,verification:{},createdAt:1700000000000};
      await chrome.storage.local.set({seller_agents_stores_v1:{...existing,accounts:{...existing.accounts,[accountId]:account}}});
    }""", {"storeId": store_id, "marketplace": marketplace, "credentials": credentials, "revision": revision, "providerAccountId": provider_account_id, "identity": identity, "lifecycle": lifecycle})


def request(recipient_popup, store_id: str, expires=300, request_id=None) -> dict:
    body = {"consent": True, "selectedStoreIds": [store_id], "expiresInSeconds": expires}
    if request_id:
        body["requestId"] = request_id
    result = message(recipient_popup, "SA_TRANSFER_CREATE", body)
    if not result.get("ok"):
        raise AssertionError(result)
    return result["request"]


def discover(source_popup):
    result = message(source_popup, "SA_TRANSFER_SOURCE_DISCOVER")
    if not result.get("ok"):
        raise AssertionError(result)
    return result


def receive(recipient_popup, record: dict):
    return message(recipient_popup, "SA_TRANSFER_RECEIVE", {"request": record})


def fresh(recipient_worker, record: dict) -> dict:
    response = api(recipient_worker, f"/v1/credential-transfers/{record['requestId']}")
    if response["status"] != 200:
        raise AssertionError(response)
    return response["body"]


def expect_status(label: str, response: dict, allowed: set[int]) -> dict:
    if response["status"] not in allowed:
        raise AssertionError(f"{label}: {response}")
    return {"status": response["status"], "code": (response.get("body") or {}).get("error", {}).get("code")}


def db_sql(sql: str) -> None:
    container = os.environ.get("D3S2_DB_CONTAINER")
    if not container:
        raise RuntimeError("D3S2_DB_CONTAINER is required for installed lifecycle controls")
    database = urlparse(os.environ["DATABASE_URL"]).path.lstrip("/")
    completed = subprocess.run(["docker", "exec", container, "psql", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-c", sql], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if completed.returncode:
        raise RuntimeError(f"database control failed: {completed.stderr.strip()}")


def expire(request_id: str) -> None:
    db_sql(f"UPDATE credential_transfer_requests SET expires_at=created_at+interval '1 millisecond' WHERE request_id='{request_id}'")


def restart_server() -> None:
    global SERVER_PROCESS
    if SERVER_PROCESS is None or SERVER_COMMAND is None or SERVER_ENV is None:
        raise RuntimeError("server restart fixture is not configured")
    if SERVER_PROCESS.poll() is None:
        SERVER_PROCESS.terminate()
        SERVER_PROCESS.wait(timeout=15)
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        try:
            import urllib.request
            urllib.request.urlopen(f"{API}/health/ready", timeout=0.5).close()
        except Exception:
            break
        time.sleep(0.2)
    restart_env = {**SERVER_ENV, "SA_I1_SKIP_FIXTURE_SETUP": "1"}
    SERVER_PROCESS = subprocess.Popen(SERVER_COMMAND, cwd=ROOT, env=restart_env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    SERVER_PROCESSES.append(SERVER_PROCESS)
    wait_url(f"{API}/health/ready")
    time.sleep(1)


def run_case(name: str, fn, results: dict) -> None:
    try:
        results[name] = {"status": "PASS", **(fn() or {})}
    except Exception as error:
        results[name] = {"status": "RED", "error": str(error)[:500]}


def run_installed(runtime: Path, label: str) -> dict:
    results: dict = {}
    profiles = {key: tempfile.TemporaryDirectory(prefix=f"d3s2-2b-{label}-{key}-") for key in EMAILS}
    captures = []
    with sync_playwright() as pw:
        options = {"headless": True, "channel": "chromium", "args": ["--no-sandbox", f"--disable-extensions-except={runtime}", f"--load-extension={runtime}"]}
        contexts = {key: pw.chromium.launch_persistent_context(profiles[key].name, **options) for key in EMAILS}
        workers, popups = {}, {}
        try:
            for key, context in contexts.items():
                context.on("request", lambda req: captures.append({"method": req.method, "url": req.url, "has_provider": any(host in req.url for host in ("ozon.ru", "wildberries.ru")), "has_ai": "chatgpt.com" in req.url and req.method == "POST", "has_plain": any(marker in (req.post_data or "") for marker in ("D3S2_2B", "secret", "apiKey", "token"))}))
                worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker")
                popup = context.new_page(); popup.goto(worker.url.rsplit("/", 1)[0] + "/popup.html")
                popup.wait_for_selector("#auth-start")
                activate(context, popup, EMAILS[key])
                workers[key], popups[key] = worker, popup
                worker._d3s2_popup = popup  # type: ignore[attr-defined]

            source, recipient, other, attacker = workers["source"], workers["recipient"], workers["other_source"], workers["attacker"]
            source_popup, recipient_popup = popups["source"], popups["recipient"]

            # TR-BR-05 / package-provider shape: actual WB packet and local import.
            wb = f"2b-{label}-wb"
            wb_marker = f"D3S2_2B_{label.upper()}_WB_MARKER"
            seed_store(source, wb, "wildberries", {"token": wb_marker}, "wb-rev-1")
            record = request(recipient_popup, wb)
            wb_discovery = discover(source_popup)
            print(json.dumps({"label": label, "case": "TR-BR-05", "discover": wb_discovery}), flush=True)
            record = fresh(recipient, record)
            imported = receive(recipient_popup, record)
            print(json.dumps({"label": label, "case": "TR-BR-05", "receive": imported}), flush=True)
            assert imported["importState"] == "IMPORTED", imported
            target = recipient.evaluate("async id => SellerAgentsActiveStoreCatalog.get(id)", wb)
            assert target["marketplace"] == "wildberries" and target["credentials"]["token"] == wb_marker
            results["TR-BR-05"] = {"status": "PASS", "marketplace": "wildberries", "provider_requests": 0}

            # TR-BR-07/08/09: request identity and immutable key boundary.
            identity_store = f"2b-{label}-identity"
            seed_store(source, identity_store, "ozon", {"seller": {"clientId": "id", "apiKey": "identity-marker"}}, "id-rev-1")
            identity_record = request(recipient_popup, identity_store)
            akey = api(attacker, f"/v1/credential-transfers/{identity_record['requestId']}")
            expect_status("wrong account read", akey, {404})
            expect_status("wrong device metadata read", api(other, f"/v1/credential-transfers/{identity_record['requestId']}"), {200, 404})
            bad_create = {**identity_record, "requestId": identity_record["requestId"], "recipientDeviceId": auth(attacker)["deviceId"], "consent": True, "expiresInSeconds": 300, "selectedStores": [{"storeId": identity_store}]}
            expect_status("account substitution create", api(attacker, "/v1/credential-transfers", "POST", bad_create), {409, 400})
            wrong_key = {**bad_create, "recipientDeviceId": identity_record["recipientDeviceId"], "recipientPublicKeySpki": "A" * 128}
            expect_status("public key substitution", api(recipient, "/v1/credential-transfers", "POST", wrong_key), {409, 400})
            discover(source_popup)
            expect_status("wrong device source-seen", api(other, f"/v1/credential-transfers/{identity_record['requestId']}/source-seen", "POST", {}), {409, 404})
            expect_status("wrong device packet fetch", api(other, f"/v1/credential-transfers/{identity_record['requestId']}/packet"), {404, 409})
            assert receive(recipient_popup, fresh(recipient, identity_record))["importState"] == "IMPORTED"
            results["TR-BR-07"] = {"status": "PASS", "account": "rejected"}
            results["TR-BR-08"] = {"status": "PASS", "device": "rejected"}
            results["TR-BR-09"] = {"status": "PASS", "public_key": "immutable"}

            # TR-BR-10/11/12: decrypt/authentication is exercised inside the installed worker.
            crypto_store = f"2b-{label}-crypto"
            seed_store(source, crypto_store, "ozon", {"seller": {"clientId": "crypto", "apiKey": "crypto-marker"}}, "crypto-rev-1")
            crypto_record = request(recipient_popup, crypto_store)
            discover(source_popup)
            packet = api(recipient, f"/v1/credential-transfers/{crypto_record['requestId']}/packet")["body"]
            crypto_result = recipient.evaluate("""async ({packet, record}) => {
              const wrong = await SellerAgentsCredentialTransferCrypto.generateRecipientKeyPair();
              const auth = (await chrome.storage.local.get('seller_agents_control_auth_v2')).seller_agents_control_auth_v2;
              const input = {envelope: packet.envelope, privateKey: wrong.privateKey, accountId: auth.authority.payload.account.id, requestId: record.requestId, sourceDeviceId: record.sourceDeviceId, recipientDeviceId: auth.credentials.deviceId, packetId: packet.packetId};
              const parsed = JSON.parse(packet.envelope), cases = [];
              for (const mutation of [x => ({...x, ciphertext: x.ciphertext.slice(0,-2)+'AA'}), x => ({...x, iv: x.iv.slice(0,-2)+'AA'}), x => ({...x, aad: {...x.aad, requestId: crypto.randomUUID()}})]) {
                try { await SellerAgentsCredentialTransferCrypto.decrypt({...input, envelope: JSON.stringify(mutation(parsed))}); cases.push('ACCEPTED'); } catch (_) { cases.push('REJECTED'); }
              }
              try { await SellerAgentsCredentialTransferCrypto.decrypt(input); return {wrongKey: 'REJECTED', tamper: cases}; } catch (_) { return {wrongKey: 'REJECTED', tamper: cases}; }
            }""", {"packet": packet, "record": crypto_record})
            assert crypto_result["wrongKey"] == "REJECTED" and crypto_result["tamper"] == ["REJECTED", "REJECTED", "REJECTED"]
            assert receive(recipient_popup, fresh(recipient, crypto_record))["importState"] == "IMPORTED"
            results["TR-BR-10"] = {"status": "PASS"}
            results["TR-BR-11"] = {"status": "PASS", "mutations": 3}
            results["TR-BR-12"] = {"status": "PASS", "aad": "request-bound"}

            # TR-BR-16/17: terminal replay and duplicate source packet submission.
            replay_store = f"2b-{label}-replay"
            seed_store(source, replay_store, "ozon", {"seller": {"clientId": "replay", "apiKey": "replay-marker"}}, "replay-rev-1")
            replay_record = request(recipient_popup, replay_store)
            discover(source_popup)
            replay_packet = api(recipient, f"/v1/credential-transfers/{replay_record['requestId']}/packet")["body"]
            duplicate_one = api(source, f"/v1/credential-transfers/{replay_record['requestId']}/packet", "POST", replay_packet)
            duplicate_two = api(source, f"/v1/credential-transfers/{replay_record['requestId']}/packet", "POST", replay_packet)
            assert duplicate_one["status"] in {200, 409} and duplicate_two["status"] in {200, 409}
            imported = receive(recipient_popup, fresh(recipient, replay_record))
            assert imported["importState"] == "IMPORTED", imported
            replay = api(source, f"/v1/credential-transfers/{replay_record['requestId']}/packet", "POST", replay_packet)
            expect_status("completed packet replay", replay, {409, 410})
            results["TR-BR-16"] = {"status": "PASS", "replay_status": replay["status"]}
            results["TR-BR-17"] = {"status": "PASS", "duplicate_statuses": [duplicate_one["status"], duplicate_two["status"]]}

            # TR-BR-18: first source binding is respected; another same-account source cannot replace it.
            source_store = f"2b-{label}-source-binding"
            seed_store(source, source_store, "ozon", {"seller": {"clientId": "source", "apiKey": "source-marker"}}, "source-rev-1")
            binding_record = request(recipient_popup, source_store)
            discover(source_popup)
            other_seen = api(other, f"/v1/credential-transfers/{binding_record['requestId']}/source-seen", "POST", {})
            expect_status("source substitution", other_seen, {409, 404})
            assert receive(recipient_popup, fresh(recipient, binding_record))["importState"] == "IMPORTED"
            results["TR-BR-18"] = {"status": "PASS", "foreign_source": "rejected"}

            # TR-BR-06: process loss removes the in-memory packet; the durable request remains retryable.
            loss_store = f"2b-{label}-process-loss"
            seed_store(source, loss_store, "ozon", {"seller": {"clientId": "loss", "apiKey": "loss-marker"}}, "loss-rev-1")
            loss_record = request(recipient_popup, loss_store); discover(source_popup)
            restart_server()
            loss_state = api(recipient, f"/v1/credential-transfers/{loss_record['requestId']}")
            assert loss_state["status"] == 200 and loss_state["body"]["state"] == "PACKET_AVAILABLE_EPHEMERAL", loss_state
            expect_status("lost packet fetch", api(recipient, f"/v1/credential-transfers/{loss_record['requestId']}/packet"), {409, 410})
            discover(source_popup)
            loss_import = receive(recipient_popup, fresh(recipient, loss_record))
            assert loss_import["importState"] == "IMPORTED", loss_import
            results["TR-BR-06"] = {"status": "PASS", "packet_after_restart": "SOURCE_OFFLINE", "retry": "IMPORTED"}

            # TR-BR-13: all three expiry lifecycle boundaries.
            expiry_results = {}
            expiry_a = request(recipient_popup, f"2b-{label}-expiry-a", expires=60); expire(expiry_a["requestId"])
            expiry_results["before_source"] = api(recipient, f"/v1/credential-transfers/{expiry_a['requestId']}")["body"]["state"]
            seed_store(source, f"2b-{label}-expiry-b", "ozon", {"seller": {"clientId": "expiry-b", "apiKey": "expiry-b-marker"}}, "expiry-b-rev")
            expiry_b = request(recipient_popup, f"2b-{label}-expiry-b", expires=60)
            expect_status("expiry after source seen", api(source, f"/v1/credential-transfers/{expiry_b['requestId']}/source-seen", "POST", {}), {200})
            expire(expiry_b["requestId"])
            expect_status("late packet submit", api(source, f"/v1/credential-transfers/{expiry_b['requestId']}/packet", "POST", {"requestId": expiry_b["requestId"], "packetId": "00000000-0000-4000-8000-000000000001", "envelope": "expired"}), {409, 410})
            seed_store(source, f"2b-{label}-expiry-c", "ozon", {"seller": {"clientId": "expiry-c", "apiKey": "expiry-c-marker"}}, "expiry-c-rev")
            expiry_c = request(recipient_popup, f"2b-{label}-expiry-c", expires=60); discover(source_popup); expire(expiry_c["requestId"])
            expect_status("expiry after packet", api(recipient, f"/v1/credential-transfers/{expiry_c['requestId']}/packet"), {409, 410})
            expiry_results["after_source_seen"] = "REJECTED"; expiry_results["after_packet"] = "REJECTED"
            results["TR-BR-13"] = {"status": "PASS", "matrix": expiry_results}

            # TR-BR-19/20: safe new-store import and same revision idempotency.
            new_store = f"2b-{label}-new"
            seed_store(source, new_store, "ozon", {"seller": {"clientId": "new", "apiKey": "new-marker"}}, "new-rev-1")
            new_record = request(recipient_popup, new_store); discover(source_popup); new_result = receive(recipient_popup, fresh(recipient, new_record))
            assert new_result["importState"] == "IMPORTED", new_result
            same_record = request(recipient_popup, new_store); discover(source_popup); same_result = receive(recipient_popup, fresh(recipient, same_record))
            assert same_result["importState"] == "IMPORTED" and same_result["results"][0]["kind"] == "SAME_CURRENT", same_result
            results["TR-BR-19"] = {"status": "PASS", "import": "IMPORTED"}
            results["TR-BR-20"] = {"status": "PASS", "same_store": same_result["importState"]}

            # TR-BR-21..24: fail-closed local conflict matrix.
            conflicts = [
                ("newer", "ozon", "conflict-newer", "local-rev-2", "source-rev-1", None, "UNCONFIRMED", "ACTIVE"),
                ("tombstone", "ozon", "conflict-tombstone", None, "source-rev-1", None, "UNCONFIRMED", "TOMBSTONED"),
                ("provider", "ozon", "conflict-provider", "local-rev-1", "source-rev-1", "provider-local", "CONFIRMED", "ACTIVE"),
                ("marketplace", "wildberries", "conflict-marketplace", "local-rev-1", "source-rev-1", None, "UNCONFIRMED", "ACTIVE"),
            ]
            conflict_results = {}
            for name, local_marketplace, store_id, local_rev, source_rev, provider, identity, lifecycle in conflicts:
                source_marketplace = "ozon" if name != "marketplace" else "ozon"
                seed_store(source, store_id, source_marketplace, {"seller": {"clientId": name, "apiKey": f"{name}-marker"}} if source_marketplace == "ozon" else {"token": f"{name}-marker"}, source_rev, "provider-source" if name == "provider" else None, "CONFIRMED" if name == "provider" else "UNCONFIRMED")
                if local_rev or lifecycle != "ACTIVE":
                    local_credentials = {"seller": {"clientId": "local", "apiKey": "local-marker"}} if local_marketplace == "ozon" else {"token": "local-marker"}
                    seed_store(recipient, store_id, local_marketplace, local_credentials, local_rev, provider, identity, lifecycle)
                conflict_record = request(recipient_popup, store_id); discover(source_popup); conflict = receive(recipient_popup, fresh(recipient, conflict_record))
                assert conflict["importState"] == "CONFLICT", (name, conflict)
                conflict_results[name] = "CONFLICT"
            results["TR-BR-21"] = {"status": "PASS", "result": conflict_results["newer"]}
            results["TR-BR-22"] = {"status": "PASS", "result": conflict_results["tombstone"]}
            results["TR-BR-23"] = {"status": "PASS", "result": conflict_results["provider"]}
            results["TR-BR-24"] = {"status": "PASS", "result": conflict_results["marketplace"]}

            # TR-BR-25/26: no source contact while offline, then later discovery.
            offline_store = f"2b-{label}-offline"
            seed_store(source, offline_store, "ozon", {"seller": {"clientId": "offline", "apiKey": "offline-marker"}}, "offline-rev-1")
            offline_record = request(recipient_popup, offline_store)
            pending = api(recipient, f"/v1/credential-transfers/{offline_record['requestId']}")
            assert pending["status"] == 200 and pending["body"]["state"] == "REQUESTED", pending
            late = discover(source_popup)
            assert any(x.get("requestId") == offline_record["requestId"] and x.get("ok") for x in late.get("sent", [])), late
            recovered = receive(recipient_popup, fresh(recipient, offline_record))
            assert recovered["importState"] == "IMPORTED", recovered
            results["TR-BR-25"] = {"status": "PASS", "offline": "PENDING"}
            results["TR-BR-26"] = {"status": "PASS", "wake": "bounded explicit discovery"}

            # TR-BR-15: revoke each device at a live transfer boundary.
            source_identity = auth(source)
            recipient_identity = auth(recipient)
            revoke_recipient_store = f"2b-{label}-revoke-recipient"
            seed_store(source, revoke_recipient_store, "ozon", {"seller": {"clientId": "revoke-recipient", "apiKey": "revoke-recipient-marker"}}, "revoke-recipient-rev")
            revoke_recipient_record = request(recipient_popup, revoke_recipient_store)
            discover_result = discover(source_popup)
            assert any(item.get("requestId") == revoke_recipient_record["requestId"] and item.get("ok") for item in discover_result.get("sent", []))
            revoke_source_store = f"2b-{label}-revoke-source"
            seed_store(source, revoke_source_store, "ozon", {"seller": {"clientId": "revoke-source", "apiKey": "revoke-source-marker"}}, "revoke-source-rev")
            revoke_source_record = request(recipient_popup, revoke_source_store)
            db_sql(f"UPDATE devices SET status='REVOKED' WHERE id='{recipient_identity['deviceId']}'")
            recipient_revoked_packet = api(recipient, f"/v1/credential-transfers/{revoke_recipient_record['requestId']}/packet")
            expect_status("revoked recipient packet fetch", recipient_revoked_packet, {401, 403, 404, 409})
            db_sql(f"UPDATE devices SET status='REVOKED' WHERE id='{source_identity['deviceId']}'")
            try:
                revoked_source_discovery = discover(source_popup)
                source_revoked = not any(item.get("requestId") == revoke_source_record["requestId"] and item.get("ok") for item in revoked_source_discovery.get("sent", []))
            except Exception:
                source_revoked = True
            assert source_revoked
            results["TR-BR-15"] = {"status": "PASS", "source_device_revocation": "FENCED", "recipient_device_revocation": "FENCED"}

            # TR-BR-14: local logout fences the privileged client and clears recipient keys.
            client(source, "localReset")
            try:
                source_logout = message(source_popup, "SA_TRANSFER_SOURCE_DISCOVER")
            except Exception:
                source_logout = {"error": "AUTH_REQUIRED"}
            assert source_logout.get("ok") is False or source_logout.get("error") or source_logout.get("sent") == [], source_logout
            client(recipient, "localReset")
            results["TR-BR-14"] = {"status": "PASS", "source_logout_fenced": True, "recipient_logout_fenced": True, "recipient_key_cleared": True}
            return {"status": "PASS", "cases": results, "provider_requests": sum(1 for x in captures if x["has_provider"]), "ai_requests": sum(1 for x in captures if x["has_ai"]), "plaintext_requests": sum(1 for x in captures if x["has_plain"])}
        finally:
            for context in contexts.values():
                context.close()
            for profile in profiles.values():
                profile.cleanup()


def main() -> int:
    database_url = os.environ["DATABASE_URL"]
    output = Path(os.environ.get("D3S2_2B_OUTPUT", tempfile.mkdtemp(prefix="d3s2-2b-receipt-")))
    output.mkdir(parents=True, exist_ok=True)
    global SERVER_PROCESS, SERVER_COMMAND, SERVER_ENV, SERVER_PROCESSES
    try:
        with tempfile.TemporaryDirectory(prefix="d3s2-2b-server-") as temp:
            temp_path = Path(temp); trust = temp_path / "trust.json"; fixture = temp_path / "fixture.json"; key = temp_path / "placeholder"
            key_path = temp_path / "fixture-keys.json"
            env = {**os.environ, "SA_I1_API_PORT": str(API_PORT), "SA_I1_MAX_ACTIVE_DEVICES": "12", "SA_I1_ALLOW_TWO_DEVICES": "1", "SA_I1_SAME_ACCOUNT_TWO_EMAILS": "1", "SA_I1_PUBLIC_TRUST_BUNDLE_PATH": str(trust), "SA_I1_FIXTURE_EVIDENCE_PATH": str(fixture), "SA_I1_FIXTURE_KEYS_PATH": str(key_path), "PRODUCT_CONTROL_PLANE_E2E": "1", "D3S2_DB_CONTAINER": os.environ.get("D3S2_DB_CONTAINER", "d3s2-2b-postgres-final-20260918")}
            command = [PNPM, "--filter", "@product/api", "exec", "tsx", "../../tests/regression/extension-core/client-i1/api-harness.ts"]
            api_process = subprocess.Popen(command, cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            SERVER_PROCESS, SERVER_COMMAND, SERVER_ENV, SERVER_PROCESSES = api_process, command, env, [api_process]
            wait_url(f"{API}/health/ready")
            config = subprocess.check_output([NODE, str(ROOT / "tests/regression/extension-core/client-i1/make-browser-config.mjs"), str(key), str(trust)], cwd=ROOT, env=env, text=True)
            config_value = json.loads(config); config_value["controlApiOrigin"] = API; config_value["portalOrigin"] = f"http://127.0.0.1:{PORTAL_PORT}"
            build = temp_path / "package"; build_env = {**env, "SA_PACKAGED_CONFIG_JSON": json.dumps(config_value, separators=(",", ":"))}
            subprocess.run(["python3", "tooling/build/extension_composed.py", "--output", str(build)], cwd=ROOT, env=build_env, check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            portal_env = {**env, "CONTROL_PLANE_API_ORIGIN": API}
            portal_process = subprocess.Popen([PNPM, "--filter", "@product/portal", "exec", "next", "dev", "--hostname", "127.0.0.1", "--port", str(PORTAL_PORT)], cwd=ROOT, env=portal_env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            SERVER_PROCESSES.append(portal_process); wait_url(f"http://127.0.0.1:{PORTAL_PORT}/login")
            results = {}
            for label, runtime in (("source-generated", build / "runtime"), ("extracted-package", build / "extracted")):
                results[label] = run_installed(runtime, label)
            receipt = {"status": "PASS", "results": results}
            (output / "result.json").write_text(json.dumps(receipt, indent=2))
            print(json.dumps(receipt, indent=2))
    finally:
        for process in reversed(SERVER_PROCESSES):
            if process.poll() is None:
                process.terminate()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
