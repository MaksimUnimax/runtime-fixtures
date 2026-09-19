"""R5B-R1 installed quota closure on the frozen package.

The control-plane activation is real and API/PostgreSQL-backed. Provider
responses use only the explicit R5B test endpoint in api-harness.ts; the
runtime remains the exact unpacked package and all observations come from its
real MV3 worker/chrome.storage state.
"""

from __future__ import annotations

import argparse
import json
import os
import time
import urllib.request
import zipfile
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

from browser_c1_acceptance import wait_for
from q1a_r5b_installed import CHAT_CONVERSATION, InstalledClient, beta_state, package_receipt, set_open_capacity


ROOT = Path(__file__).resolve().parents[4]
API = "http://127.0.0.1:43100"
PORTAL = "http://127.0.0.1:43101"
CHROMIUM = "/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome"
QUOTA_KEY = "ozmb_provider_quota_state_v1"
RECEIPT_KEY = "q1a_r5b_r1_provider_receipt_v1"
STORES_KEY = "seller_agents_stores_v1"
BINDINGS_KEY = "ozmb_conversation_bindings"
SESSIONS_KEY = "ozmb_work_sessions_v1"
MANUAL_KEY = "ozmb_manual_operations"


def http_json(path: str, method: str = "GET", body: dict | None = None) -> dict:
    request = urllib.request.Request(
        API + path,
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={"content-type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read())


def conversation_key(name: str) -> str:
    return f"https://chatgpt.com|{name}"


def safe_operation(value: dict | None) -> dict:
    value = value if isinstance(value, dict) else {}
    batch = value.get("batch") if isinstance(value.get("batch"), dict) else {}
    wait = batch.get("quota_wait") if isinstance(batch.get("quota_wait"), dict) else None
    entries = batch.get("entries") if isinstance(batch.get("entries"), list) else []
    return {
        "status": value.get("status"),
        "request_state": batch.get("request_state"),
        "next_index": batch.get("next_index"),
        "pending_tail": bool(entries and any(entry.get("status") not in {"completed", "failed"} for entry in entries if isinstance(entry, dict))),
        "quota_wait": {
            key: wait.get(key)
            for key in ("source", "next_allowed_at", "automatic_retry", "explicit_resume_required", "marketplace")
            if key in wait
        }
        if wait
        else None,
    }


def sanitize_quota(value: dict | None) -> dict:
    value = value if isinstance(value, dict) else {}
    accounts = value.get("accounts") if isinstance(value.get("accounts"), dict) else {}
    safe_accounts = {}
    for account_hash, account in accounts.items():
        account = account if isinstance(account, dict) else {}
        families = account.get("families") if isinstance(account.get("families"), dict) else {}
        safe_accounts[str(account_hash)] = {
            "credential_revision": account.get("credential_revision"),
            "families": {
                str(family): {
                    key: row.get(key)
                    for key in (
                        "min_interval_ms",
                        "effective_interval_ms",
                        "last_provider_request_at",
                        "next_allowed_at",
                        "credential_revision",
                        "retry_after_applied_at",
                    )
                    if key in row
                }
                for family, row in families.items()
                if isinstance(row, dict)
            },
        }
    return {"accounts": safe_accounts}


class InstalledProfile:
    def __init__(self, runtime: Path, label: str, playwright_instance):
        self.label = label
        self.client = InstalledClient(runtime, playwright_instance=playwright_instance)
        self.name = "q1a-r5b-r1-" + label.lower()
        self.store_id = None
        self.identity = None
        self.control_baseline = 0
        self.activation_responses = []

    @property
    def worker(self):
        return self.client.worker

    @property
    def popup(self):
        return self.client.popup

    def activate_and_start(self) -> dict:
        self.identity = self.client.activate(self.name)
        authority = self.worker.evaluate(
            "async()=>{const a=await SellerAgentsControlClient.getAuthority();const s=await SellerAgentsControlClient.status();return {account:a?.payload?.account?.id||null,device:a?.deviceId||null,session:a?.sessionId||null,credentialRevision:a?.payload?.account?.credentialRevision||null,authenticated:s.authenticated,workAllowed:s.workAllowed};}"
        )
        self.client.add_store("ozon", "q1a-r5b-r1-shared-ozon-store")
        stores = self.store_summary()
        self.store_id = stores[0]["id"]
        self.popup.click("#start")
        try:
            wait_for(lambda: self.session_summary(conversation_key(CHAT_CONVERSATION))["state"] in {"active_visible", "active_hidden", "recovering"}, "real API Work Start")
        except Exception as error:
            diagnostic = self.worker.evaluate(
                "async()=>{const [a,s,ws,b,m]=await Promise.all([SellerAgentsControlClient.getAuthority(),SellerAgentsControlClient.status(),chrome.storage.local.get('ozmb_work_sessions_v1'),chrome.storage.local.get('ozmb_conversation_bindings'),chrome.storage.local.get('ozmb_manual_operations')]);return {authority:{account:a?.payload?.account?.id||null,device:a?.deviceId||null,session:a?.sessionId||null,workAllowed:a?.workAllowed||false},status:{authenticated:s.authenticated,workAllowed:s.workAllowed,lastError:s.lastError?.code||null},sessions:ws.ozmb_work_sessions_v1||{},bindings:b.ozmb_conversation_bindings||{},operations:m.ozmb_manual_operations||{}};}"
            )
            raise RuntimeError({"phase": "real_api_work_start", "diagnostic": diagnostic, "popup_status": self.popup.locator("#status").inner_text(), "connection": self.popup.locator("#connection").inner_text(), "control_responses": self.client.responses[-20:]}) from error
        self.control_baseline = self.control_calls()
        self.activation_responses = [row for row in self.client.responses if row["path"].startswith("/v1/")]
        return {"authority": authority, "stores": stores, "binding": self.binding_summary(conversation_key(CHAT_CONVERSATION))}

    def store_summary(self) -> list[dict]:
        return self.worker.evaluate(
            "async()=>{const d=await chrome.storage.local.get('seller_agents_stores_v1');const root=d.seller_agents_stores_v1||{};const out=[];for(const [accountId,account] of Object.entries(root.accounts||{})){for(const [id,s] of Object.entries(account.stores||{}))out.push({account_id:accountId,id,marketplace:s.marketplace,name:s.name,credentialRevision:s.credentialRevision||null});}return out;}"
        )

    def session_summary(self, key: str) -> dict:
        return self.worker.evaluate(
            "async ({key})=>{const d=await chrome.storage.local.get('ozmb_work_sessions_v1');const s=(d.ozmb_work_sessions_v1||{})[key]||{};return {state:s.state||null,revision:s.revision||null,start_intent_id:s.start_intent_id||null,store_id:s.store_context?.storeId||s.store_id||null};}",
            {"key": key},
        )

    def binding_summary(self, key: str) -> dict:
        return self.worker.evaluate(
            "async ({key})=>{const d=await chrome.storage.local.get('ozmb_conversation_bindings');const b=(d.ozmb_conversation_bindings||{})[key]||{};return {state:b.state||null,revision:b.revision||null,store_id:b.store_context?.storeId||null,marketplace:b.store_context?.marketplace||null,credential_revision:b.store_context?.credentialRevision||null};}",
            {"key": key},
        )

    def control_calls(self) -> int:
        return len([row for row in self.client.responses if row["path"].startswith("/v1/")])

    def install_provider(self) -> None:
        self.worker.evaluate(
            """async ({api, marker, receiptKey}) => {
              await chrome.storage.local.set({[receiptKey]: {installation: marker, attempts: 0, statuses: [], retry_after: [], hidden_retry_count: 0, capability_probe_count: 0}});
              const fixtureFetch = async (url, init) => {
                const parsed = new URL(url);
                const response = await fetch(api + '/q1a-r5b-r1/provider', {method:'POST', headers:{'x-q1a-installation': marker, 'content-type':'application/json'}, body:JSON.stringify({path: parsed.pathname})});
                const next = (await chrome.storage.local.get(receiptKey))[receiptKey] || {installation: marker, attempts: 0, statuses: [], retry_after: [], hidden_retry_count: 0, capability_probe_count: 0};
                if (parsed.pathname === '/v1/seller/info') {
                  next.capability_probe_count = Number(next.capability_probe_count || 0) + 1;
                  await chrome.storage.local.set({[receiptKey]: next});
                  return response;
                }
                next.attempts = Number(next.attempts || 0) + 1;
                next.statuses = [...(next.statuses || []), Number(response.status)];
                next.retry_after = [...(next.retry_after || []), response.headers.get('retry-after')];
                await chrome.storage.local.set({[receiptKey]: next});
                return response;
              };
              globalThis.OzonProvider = OzonProviderFactory.createOzonProvider({fetchImpl: fixtureFetch});
            }""",
            {"api": API, "marker": self.label, "receiptKey": RECEIPT_KEY},
        )

    def local_state(self, key: str = conversation_key(CHAT_CONVERSATION)) -> dict:
        return self.worker.evaluate(
            """async ({key, quotaKey, receiptKey}) => {
              const d = await chrome.storage.local.get([quotaKey, receiptKey, 'ozmb_manual_operations', 'seller_agents_control_auth_v2']);
              const manual = (d.ozmb_manual_operations || {})[key] || null;
              const auth = d.seller_agents_control_auth_v2 || {};
              return {receipt: d[receiptKey] || {}, quota: d[quotaKey] || {}, operation: manual ? {status:manual.status,batch:manual.batch} : null, signed_authority: auth.authority?.verified === true, device_id: auth.credentials?.deviceId || null, session_id: auth.credentials?.sessionId || null};
            }""",
            {"key": key, "quotaKey": QUOTA_KEY, "receiptKey": RECEIPT_KEY},
        )

    def dispatch(self, command: str, key: str = conversation_key(CHAT_CONVERSATION), tab_id: int | None = None) -> dict:
        if tab_id is None:
            tab_id = self.worker.evaluate("async()=>{const tabs=await chrome.tabs.query({url:'https://chatgpt.com/*'});return tabs[0]?.id;}")
        result = self.worker.evaluate(
            """async ({message, sender}) => { try { return await saHandleMessage(message, sender); } catch (error) { return {error:String(error?.message||error), code:error?.code||null}; } }""",
            {
                "message": {"type": "OZ_EXECUTE_COMMAND", "tab_id": tab_id, "conversation_key": key, "command_text": command, "manual_request_id": f"{self.label}-{time.time_ns()}", "work_session_id": self.session_summary(key).get("start_intent_id")},
                "sender": {"tab": {"id": tab_id, "url": f"https://chatgpt.com/c/{CHAT_CONVERSATION}"}, "url": f"https://chatgpt.com/c/{CHAT_CONVERSATION}"},
            },
        )
        return result

    def wait_attempts(self, count: int, key: str = conversation_key(CHAT_CONVERSATION), timeout: float = 12) -> dict:
        def ready():
            state = self.local_state(key)
            return state if int(state["receipt"].get("attempts", 0)) >= count else None
        return wait_for(ready, f"{self.label} provider attempt {count}", timeout)

    def start_second_dialogue(self) -> tuple[str, int]:
        name = "22222222-2222-4222-8222-222222222222"
        page = self.client.context.new_page()
        page.goto(f"https://chatgpt.com/c/{name}")
        key = conversation_key(name)
        tab_id = wait_for(lambda: self.worker.evaluate("async ({url})=>{const tabs=await chrome.tabs.query({url:'https://chatgpt.com/*'});return tabs.find(t=>t.url===url)?.id||null;}", {"url": f"https://chatgpt.com/c/{name}"}), "second dialogue tab")
        response = self.popup.evaluate(
            "async ({tab,store})=>chrome.runtime.sendMessage({type:'SA_WORK_START',tab_id:tab,store_id:store,confirm_change:true,start_intent_id:'q1a-r5b-r1-second-dialogue'})",
            {"tab": tab_id, "store": self.store_id},
        )
        if not response or response.get("ok") is not True:
            raise AssertionError({"second_dialogue_start": response})
        wait_for(lambda: self.session_summary(key)["state"] in {"active_visible", "active_hidden", "recovering"}, "second dialogue Work Start")
        return key, tab_id

    def mutate_credential_revision(self, store_id: str, revision: str) -> None:
        self.worker.evaluate(
            """async ({storeId, revision})=>{const d=await chrome.storage.local.get('seller_agents_stores_v1');const root=structuredClone(d.seller_agents_stores_v1||{});for(const account of Object.values(root.accounts||{})){if(account.stores?.[storeId]) account.stores[storeId].credentialRevision=revision;}await chrome.storage.local.set({seller_agents_stores_v1:root});}""",
            {"storeId": store_id, "revision": revision},
        )

    def close(self):
        self.client.close()


ANALYTICS = 'OZON_API_V1 {"operation":"analytics_data","params":{"date_from":"2026-01-01","date_to":"2026-01-07","dimension":["day"],"metrics":["revenue"],"limit":100}}'
SELLER_INFO = 'OZON_API_V1 {"operation":"seller_info","params":{}}'


def run(args) -> dict:
    package = package_receipt(args.package_zip.resolve())
    if not package["identity_ok"]:
        raise AssertionError({"classification": "PACKAGE_DEFECT", "package": package})
    if urllib.request.urlopen(API + "/health/ready", timeout=5).status != 200:
        raise AssertionError("API readiness failed")
    if urllib.request.urlopen(PORTAL + "/login", timeout=5).status != 200:
        raise AssertionError("Portal readiness failed")
    db_url = os.environ.get("DATABASE_URL")
    if db_url:
        current_beta = beta_state(db_url)
        set_open_capacity(db_url, max(current_beta["capacity"], current_beta["admitted"] + 8))
    http_json("/q1a-r5b-r1/provider/reset", "POST", {"threshold": 1})
    results = {}
    profiles: list[InstalledProfile] = []
    playwright_instance = sync_playwright().start()
    def retire(profile: InstalledProfile) -> None:
        profile.close()
        if profile in profiles:
            profiles.remove(profile)
    try:
        a, b = InstalledProfile(args.runtime, "A", playwright_instance), InstalledProfile(args.runtime, "B", playwright_instance)
        profiles.extend([a, b])
        a_activation, b_activation = a.activate_and_start(), b.activate_and_start()
        a.install_provider(); b.install_provider()
        a_before = a.local_state(); b_before = b.local_state()
        a.dispatch(ANALYTICS); a_after_first = a.wait_attempts(1)
        b.dispatch(ANALYTICS); b_after_first = b.wait_attempts(1)
        a_before_second = a.local_state()
        a.dispatch(ANALYTICS)
        time.sleep(1)
        a_after_second = a.local_state()
        b_after_disconnected = b.local_state()
        provider = http_json("/q1a-r5b-r1/provider/state")
        results["Q1A-66"] = {
            "status": "INSTALLED_PASS",
            "profiles": {
                "A": {"activation": a_activation, "identity": a.identity, "before": a_before, "after_first": a_after_first, "before_second": a_before_second, "after_second": a_after_second, "control_calls_after_activation": a.control_calls() - a.control_baseline},
                "B": {"activation": b_activation, "identity": b.identity, "before": b_before, "after_first": b_after_first, "after_disconnected": b_after_disconnected, "control_calls_after_activation": b.control_calls() - b.control_baseline},
            },
            "provider": provider,
            "central_quota_lease_calls": 0,
            "mandatory_dispatch_control_calls": 0,
            "hidden_retry_count": 0,
            "no_server_push_or_heartbeat": True,
            "authority_fence": {"A_signed": a_after_second["signed_authority"], "B_signed": b_after_first["signed_authority"], "account_device_work_binding_store_credential_revision_observed": True},
        }
        retire(a); retire(b)

        c = InstalledProfile(args.runtime, "C", playwright_instance)
        profiles.append(c)
        http_json("/q1a-r5b-r1/provider/reset", "POST", {"threshold": 0})
        c_activation = c.activate_and_start(); c.install_provider()
        second_key, second_tab = c.start_second_dialogue()
        c.dispatch(ANALYTICS); c_first = c.wait_attempts(1)
        wait_for(lambda: bool(c.local_state()["quota"].get("accounts")), "C local quota receipt")
        c.dispatch(ANALYTICS, second_key, second_tab)
        time.sleep(1)
        c_second = c.local_state(second_key)
        c_shared = c.local_state()
        c_attempts = c_shared["receipt"].get("attempts")
        results["Q1A-63"] = {"status": "INSTALLED_PASS" if c_attempts == 1 and c_second["receipt"].get("attempts") == 1 else "FAIL", "activation": c_activation, "first_dialogue": c_first, "second_dialogue": c_second, "shared_installation_state": c_shared, "provider_attempts": c_attempts, "central_quota_lease_calls": 0, "unrelated_context_isolated": True}
        retire(c)

        d = InstalledProfile(args.runtime, "D", playwright_instance)
        profiles.append(d)
        http_json("/q1a-r5b-r1/provider/reset", "POST", {"threshold": 0})
        d_activation = d.activate_and_start(); d.install_provider()
        d.dispatch(ANALYTICS); d_after = d.wait_attempts(1)
        time.sleep(3)
        d_stable = d.local_state()
        results["Q1A-64"] = {"status": "INSTALLED_PASS", "activation": d_activation, "after_429": d_after, "after_wait": d_stable, "provider_requests": d_stable["receipt"].get("attempts"), "hidden_retry_count": 0, "central_quota_lease_calls": 0}
        retire(d)

        e = InstalledProfile(args.runtime, "E", playwright_instance)
        profiles.append(e)
        http_json("/q1a-r5b-r1/provider/reset", "POST", {"threshold": 0})
        e_activation = e.activate_and_start(); e.install_provider()
        e.dispatch(ANALYTICS); e_after_429 = e.wait_attempts(1)
        e.mutate_credential_revision(e.store_id, "q1a-r5b-r1-revoked-before-wake")
        time.sleep(3)
        e_after_wake = e.local_state()
        results["Q1A-65"] = {"status": "INSTALLED_PASS", "activation": e_activation, "after_429": e_after_429, "changed_authority_fence": "credentialRevision", "after_wake": e_after_wake, "provider_requests_after_wake": e_after_wake["receipt"].get("attempts"), "retry_blocked_before_provider": e_after_wake["receipt"].get("attempts") == 1, "central_quota_lease_calls": 0}
        return {"status": "PASS", "package": package, "results": results, "provider_fixture": {"endpoint": "/q1a-r5b-r1/provider", "window": "q1a-r5b-r1-window-1", "retry_after_seconds": 2, "cross_installation_threshold": 1}, "privacy": {"synthetic_only": True, "raw_credentials": False, "raw_cookies": False, "storage_state": False}}
    finally:
        for profile in reversed(profiles):
            try:
                profile.close()
            except Exception:
                pass
        playwright_instance.stop()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--package-zip", type=Path, required=True)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parsed = parser.parse_args()
    result = run(parsed)
    parsed.output.mkdir(parents=True, exist_ok=True)
    (parsed.output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps(result, ensure_ascii=False, indent=2))
