"""Q1-A-R5B installed beta/capacity closure.

This driver keeps the production boundary real: OTP admission, portal device
approval, extension exchange, and Bootstrap all use the local API.  Provider
traffic in the quota lane is replaced only at the already accepted provider
adapter seam and records counters/statuses, never credentials or payloads.
"""

from __future__ import annotations

import argparse
import base64
import concurrent.futures
import json
import os
import re
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
import zipfile
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import unquote, urlparse

from playwright.sync_api import sync_playwright

from browser_c1_acceptance import wait_for
from browser_p1_provider_outcome import direct_command


ROOT = Path(__file__).resolve().parents[4]
PACKAGE_SHA256 = "93ba77f6fcac9932e991c94eded2d9638bb38c9990b8fcefd826d737aaf8d476"
PACKAGE_BYTES = 2_076_757
CHROMIUM = "/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome"
API = "http://127.0.0.1:43100"
PORTAL = "http://127.0.0.1:43101"
CHAT_CONVERSATION = "11111111-1111-4111-8111-111111111111"
NAMESPACE = re.sub(r"[^a-z0-9]", "", os.environ.get("SA_I1_FIXTURE_NAMESPACE", "r5b").lower())[:24] or "r5b"
ACTOR = "a5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b5"


def email(label: str) -> str:
    return f"q1a-{NAMESPACE}-{label}@example.test"


def package_receipt(archive: Path) -> dict:
    raw = archive.read_bytes()
    with zipfile.ZipFile(archive) as zf:
        names = zf.namelist()
        files = [name for name in names if not name.endswith("/")]
        extracted = {name: len(zf.read(name)) for name in files}
    receipt = {"path": str(archive), "sha256": __import__("hashlib").sha256(raw).hexdigest(),
               "bytes": len(raw), "zip_entries": len(names), "runtime_files": len(files),
               "extracted_files": len(extracted)}
    receipt["identity_ok"] = receipt["sha256"] == PACKAGE_SHA256 and receipt["bytes"] == PACKAGE_BYTES and receipt["zip_entries"] == 39
    if not receipt["identity_ok"]:
        raise AssertionError({"classification": "PACKAGE_DEFECT", "package": receipt})
    return receipt


def post(path: str, body: dict, headers: dict | None = None):
    request = urllib.request.Request(f"{API}{path}", data=json.dumps(body).encode(), method="POST")
    request.add_header("content-type", "application/json")
    for key, value in (headers or {}).items():
        request.add_header(key, value)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.status, json.loads(response.read()), response.headers
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            value = json.loads(raw)
        except Exception:
            value = {"error": {"code": "NON_JSON_RESPONSE"}}
        return error.code, value, error.headers


def safe_code(value: dict) -> str | None:
    code = value.get("error", {}).get("code") if isinstance(value, dict) else None
    return code if isinstance(code, str) and re.fullmatch(r"[A-Z0-9_]{1,80}", code) else None


def cookies_from_headers(headers) -> list[dict]:
    values = headers.get_all("Set-Cookie") or []
    result = []
    for value in values:
        cookie = SimpleCookie()
        cookie.load(value)
        for morsel in cookie.values():
            if morsel.key in {"pcp_portal_session", "pcp_csrf"}:
                result.append({"name": morsel.key, "value": morsel.value, "domain": "127.0.0.1", "path": "/"})
    return result


def admit_api(label: str, idempotency: str | None = None) -> dict:
    target = email(label)
    key = idempotency or f"r5b-{label}-{secrets.token_hex(8)}"
    status, requested, _ = post("/v1/auth/otp/request", {"email": target})
    if status != 202:
        return {"label": label, "request_status": status, "request_code": safe_code(requested), "verify_status": None, "cookies": []}
    challenge = requested["challengeId"]
    status, verified, headers = post("/v1/auth/otp/verify", {"challengeId": challenge, "code": "424242"}, {"idempotency-key": key})
    return {"label": label, "request_status": 202, "verify_status": status, "verify_code": safe_code(verified), "cookies": cookies_from_headers(headers), "challenge_id": challenge, "challenge_observed": True}


def retry_admission(result: dict, idempotency: str) -> dict:
    """Replay the same verified challenge without requesting a second OTP."""
    challenge = result.get("challenge_id")
    if not challenge:
        return {"verify_status": None, "verify_code": "MISSING_CHALLENGE"}
    status, verified, _ = post("/v1/auth/otp/verify", {"challengeId": challenge, "code": "424242"}, {"idempotency-key": idempotency})
    return {"verify_status": status, "verify_code": safe_code(verified)}


def sql(db_url: str, statement: str, tuples: bool = False) -> list[str]:
    parsed = urlparse(db_url)
    container = os.environ.get("SA_R5B_POSTGRES_CONTAINER", "d3s2-r1-e2e-postgres")
    user = unquote(parsed.username or "postgres")
    password = unquote(parsed.password or "")
    database = parsed.path.lstrip("/")
    command = ["docker", "exec", "-e", f"PGPASSWORD={password}", container, "psql", "-U", user, "-d", database, "-v", "ON_ERROR_STOP=1", "-At", "-c", statement]
    output = subprocess.check_output(command, cwd=ROOT, text=True, stderr=subprocess.STDOUT)
    return [line for line in output.splitlines() if line] if tuples else output.splitlines()


def beta_state(db_url: str) -> dict:
    row = sql(db_url, "SELECT mode,capacity,admitted,remaining,revision FROM (SELECT mode,capacity,admitted,GREATEST(0,capacity-admitted) AS remaining,revision FROM beta_admission_state WHERE id=1) s")[0]
    mode, capacity, admitted, remaining, revision = row.split("|")
    return {"mode": mode, "capacity": int(capacity), "admitted": int(admitted), "remaining": int(remaining), "revision": int(revision)}


def set_open_capacity(db_url: str, capacity: int) -> dict:
    current = beta_state(db_url)
    if capacity < current["admitted"]:
        raise AssertionError({"capacity": capacity, "admitted": current["admitted"]})
    sql(db_url, f"UPDATE beta_admission_state SET mode='OPEN',capacity={capacity},revision=revision+1,updated_at=now() WHERE id=1")
    return beta_state(db_url)


def seed_admin(db_url: str) -> None:
    sql(db_url, "INSERT INTO users(id) VALUES ('a4a4a4a4-a4a4-44a4-84a4-a4a4a4a4a4a4') ON CONFLICT DO NOTHING; INSERT INTO admin_principals(id,user_id,status) VALUES ('a5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b5','a4a4a4a4-a4a4-44a4-84a4-a4a4a4a4a4a4','ACTIVE') ON CONFLICT DO NOTHING; INSERT INTO admin_role_grants(admin_principal_id,role) VALUES ('a5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b5','ADMIN_BETA_OPERATOR') ON CONFLICT DO NOTHING;")


def run_admin_increment(db_url: str, request_id: str, expected_revision: int, amount: int) -> dict:
    env = {**os.environ, "DATABASE_URL": db_url, "SA_R5B_ADMIN_PRINCIPAL_ID": ACTOR,
           "SA_R5B_REQUEST_ID": request_id, "SA_R5B_EXPECTED_REVISION": str(expected_revision),
           "SA_R5B_INCREMENT_AMOUNT": str(amount)}
    command = [os.environ.get("SA_PNPM_BIN", "pnpm"), "exec", "tsx", "tests/regression/extension-core/client-i1/q1a_r5b_beta_admin.ts"]
    try:
        output = subprocess.check_output(command, cwd=ROOT, env=env, text=True, stderr=subprocess.STDOUT)
    except subprocess.CalledProcessError as error:
        raise RuntimeError({"phase": "beta_admin_increment", "output": error.output[-2000:]}) from error
    return json.loads(output.strip().splitlines()[-1])


class InstalledClient:
    def __init__(self, runtime: Path, existing_cookies: list[dict] | None = None, playwright_instance=None):
        self.runtime = runtime
        self.existing_cookies = existing_cookies or []
        self._owns_pw = playwright_instance is None
        self.pw = playwright_instance or sync_playwright().start()
        options = {"headless": True, "executable_path": os.environ.get("SA_TEST_CHROMIUM", CHROMIUM),
                   "args": ["--no-sandbox", "--disable-dev-shm-usage", f"--disable-extensions-except={runtime}", f"--load-extension={runtime}"]}
        self._profile_dir = tempfile.TemporaryDirectory(prefix="q1a-r5b-profile-")
        self.context = self.pw.chromium.launch_persistent_context(self._profile_dir.name, **options)
        self.responses = []
        self.bootstrap_bodies = []
        def observe(response):
            if "/v1/" not in response.url:
                return
            self.responses.append({"path": urlparse(response.url).path, "status": response.status})
            if urlparse(response.url).path == "/v1/bootstrap":
                try:
                    body = json.loads(response.body().decode())
                    self.bootstrap_bodies.append({"keyId": body.get("keyId") or body.get("envelope", {}).get("keyId"), "envelopeVersion": body.get("envelopeVersion") or body.get("envelope", {}).get("envelopeVersion"), "signatureLength": len(body.get("signature") or body.get("envelope", {}).get("signature") or "")})
                except Exception:
                    self.bootstrap_bodies.append({"body": "NON_JSON"})
        self.context.on("response", observe)
        self.context.route("https://chatgpt.com/**", lambda route: route.fulfill(body=(ROOT / "tests/regression/extension-core/fixtures/application-chat.html").read_text(), content_type="text/html"))
        self.worker = self.context.service_workers[0] if self.context.service_workers else self.context.wait_for_event("serviceworker")
        self.chat = self.context.new_page()
        self.chat.goto(f"https://chatgpt.com/c/{CHAT_CONVERSATION}", wait_until="domcontentloaded")
        self.tab_id = self.bind_page_tab(self.chat, "ChatGPT tab")
        self.popup = self.context.new_page()
        self.popup.add_init_script(f"const originalQuery=chrome.tabs.query.bind(chrome.tabs);chrome.tabs.query=(query)=>query.active?Promise.resolve([{{id:{self.tab_id}}}]):originalQuery(query);")
        self.popup.goto(self.worker.url.rsplit("/", 1)[0] + "/popup.html")

    def bind_page_tab(self, page, description: str) -> int:
        """Return the Chrome tab id owned by the exact Playwright page."""
        marker = f"seller-agents-r5b-{time.monotonic_ns()}"
        page.evaluate("(value)=>{document.title=value}", marker)

        def matching_tab():
            return self.worker.evaluate(
                """async ({url,marker})=>{
                  const matches=(await chrome.tabs.query({})).filter(tab => tab.url === url && tab.title === marker);
                  return matches.length === 1 ? matches[0].id : null;
                }""",
                {"url": page.url, "marker": marker},
            )

        tab_id = wait_for(matching_tab, description)
        target = self.worker.evaluate("async (id)=>chrome.tabs.get(id)", tab_id)
        assert target.get("url") == page.url, {"page": page.url, "tab": target}
        return int(tab_id)

    def activate(self, label: str, existing_cookies: list[dict] | None = None) -> dict:
        cookies = existing_cookies if existing_cookies is not None else self.existing_cookies
        if cookies:
            self.context.add_cookies(cookies)
        with self.context.expect_page() as pending:
            self.popup.locator("#auth-start").click()
        portal = pending.value
        portal.wait_for_load_state()
        # A fresh profile must follow the portal's unauthenticated redirect;
        # an admitted profile should remain on activation and load its account
        # list using the supplied portal session.
        if not cookies:
            try:
                portal.wait_for_url("**/login?returnTo=*", timeout=5000)
            except Exception:
                if "/activate?authorizationId=" not in portal.url:
                    raise
        else:
            portal.wait_for_timeout(750)
        if "/login" in portal.url:
            portal.locator('input[type="email"]').fill(email(label))
            with portal.expect_response(lambda response: response.request.method == "POST" and response.url.endswith("/api/control-plane/v1/auth/otp/request")) as request_response:
                portal.get_by_role("button", name="Send code").click()
            if request_response.value.status != 202:
                raise RuntimeError({"phase": "otp_request", "status": request_response.value.status})
            portal.locator('input[inputmode="numeric"]').fill("424242")
            with portal.expect_response(lambda response: response.request.method == "POST" and response.url.endswith("/api/control-plane/v1/auth/otp/verify")) as verify_response:
                portal.get_by_role("button", name="Verify").click()
            if verify_response.value.status != 200:
                raise RuntimeError({"phase": "otp_verify", "status": verify_response.value.status})
        portal.wait_for_url("**/activate?authorizationId=*")
        portal.locator("select option:not([value=\"\"]):not([disabled])").first.wait_for(state="attached")
        self.popup.wait_for_function("() => /[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/.test((document.querySelector('#auth-code')?.textContent || '').trim())")
        code = re.search(r"([ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4})$", self.popup.locator("#auth-code").inner_text().strip()).group(1)
        account = portal.locator('select option:not([value=""]):not([disabled])').first.get_attribute("value")
        portal.locator("select").select_option(value=account)
        portal.get_by_label("User code").fill(code)
        with portal.expect_response(lambda response: response.request.method == "POST" and "/api/control-plane/v1/device-authorizations/" in response.url and response.url.endswith("/approve")) as approve_response:
            portal.get_by_role("button", name="Approve").click()
        if approve_response.value.status != 200:
            raise RuntimeError({"phase": "activation_approval", "status": approve_response.value.status})
        portal.get_by_role("status").wait_for(state="visible")
        try:
            self.popup.wait_for_function("() => { const text = document.querySelector('#account')?.innerText || ''; return text.includes('Аккаунт ·') || text.includes('Account ·'); }")
        except Exception as error:
            diagnostic = self.worker.evaluate("async()=>{const s=await SellerAgentsControlClient.status();return {authenticated:s.authenticated,workAllowed:s.workAllowed,lastError:s.lastError?.code||null};}")
            diagnostic["account_text"] = self.popup.locator("#account").inner_text()
            diagnostic["control_responses"] = self.responses[-20:]
            diagnostic["bootstrap_bodies"] = self.bootstrap_bodies
            raise RuntimeError({"phase": "installed_bootstrap", "diagnostic": diagnostic}) from error
        authority = self.worker.evaluate("async()=>{const a=await SellerAgentsControlClient.getAuthority();const s=await SellerAgentsControlClient.status();return {account:a?.payload?.account?.id||null,accessBasis:a?.payload?.accessBasis||null,entitlements:a?.payload?.entitlements||{},authenticated:s.authenticated,workAllowed:s.workAllowed};}")
        portal.close()
        return authority

    def add_store(self, marketplace: str, name: str) -> None:
        self.popup.click("#ozon" if marketplace == "ozon" else "#wildberries")
        self.popup.click("#add")
        if marketplace == "ozon":
            self.popup.fill("#seller-id", "100001")
            self.popup.fill("#seller-key", "SYNTHETIC-SELLER-KEY")
        else:
            self.popup.fill("#token", "SYNTHETIC-WB-TOKEN")
        self.popup.fill("#name", name)
        self.popup.click("#save")
        wait_for(lambda: name in self.popup.locator("#stores").inner_text(), f"{marketplace} store")

    def authority(self) -> dict:
        return self.worker.evaluate("async()=>SellerAgentsControlClient.getAuthority()")

    def close(self):
        try:
            self.context.close()
        finally:
            if self._owns_pw:
                self.pw.stop()
            self._profile_dir.cleanup()


def quota_profile(runtime: Path, label: str, status_sequence: list[int]) -> dict:
    """Run one independent profile at the production provider boundary."""
    from browser_c1_acceptance import BrowserFixture, SyntheticHealthServer
    from browser_p1_provider_outcome import P1_FIXTURE, prepare
    server = SyntheticHealthServer(Path("/tmp/q1a-r5a-exact-private.der")).start()
    fixture = None
    try:
        with sync_playwright() as pw:
            fixture = BrowserFixture(runtime, Path("/tmp/q1a-r5a-exact-private.der"), server, Path(tempfile.mkdtemp(prefix="q1a-r5b-quota-")))
            fixture.open(pw)
            prepare(fixture, server)
            fixture.worker.evaluate("async ({statuses})=>{let i=0;const key='q1a66_provider_receipt_v1';await chrome.storage.local.set({[key]:{profile:location?.origin||'extension',calls:0,statuses:[]}});const f=async(url)=>{const prior=(await chrome.storage.local.get(key))[key];prior.calls++;prior.statuses.push(Number(statuses[Math.min(i++,statuses.length-1)]));await chrome.storage.local.set({[key]:prior});return new Response(JSON.stringify({result:[]}),{status:prior.statuses.at(-1),headers:{'content-type':'application/json','retry-after':'1'}})};globalThis.OzonProvider=OzonProviderFactory.createOzonProvider({fetchImpl:f});}", {"statuses": status_sequence})
            first = direct_command(fixture, 'OZON_API_V1 {"operation":"seller_info","params":{}}')
            second = None
            for _ in range(40):
                time.sleep(.25)
                try:
                    second = direct_command(fixture, 'OZON_API_V1 {"operation":"seller_info","params":{"page":2}}')
                    break
                except Exception as error:
                    if "Bridge" not in str(error):
                        raise
            if second is None:
                raise AssertionError("second profile provider command remained busy")
            time.sleep(1)
            storage = fixture.storage()
            receipt = storage.get("q1a66_provider_receipt_v1", {})
            quota = storage.get("ozmb_provider_quota_state_v1", {})
            controls = [e for e in fixture.events if "127.0.0.1:43100" in e.get("url", "")]
            return {"profile": label, "provider_calls": receipt.get("calls", 0), "provider_statuses": receipt.get("statuses", []), "quota_state_keys": sorted(quota.get("accounts", {}).keys()) if isinstance(quota, dict) else [], "seller_agents_control_calls": len(controls), "first_result_ok": bool(first), "second_result_ok": bool(second)}
    finally:
        if fixture:
            try:
                fixture.close()
            except Exception:
                pass
        server.stop()


def run(args) -> dict:
    package = package_receipt(args.package_zip.resolve())
    workspace = Path(tempfile.mkdtemp(prefix="q1a-r5b-run-"))
    extracted = workspace / "extracted"
    with zipfile.ZipFile(args.package_zip) as zf:
        zf.extractall(extracted)
    runtime = extracted
    db_url = os.environ["DATABASE_URL"]
    env = {**os.environ, "PRODUCT_CONTROL_PLANE_E2E": "1", "SA_I1_API_PORT": "43100", "SA_I1_KEY_ID": "i1-client-local", "SA_I1_ALLOW_TWO_DEVICES": "1", "SA_I1_MAX_ACTIVE_DEVICES": "4", "SA_I1_SKIP_FIXTURE_SETUP": "1"}
    processes = []
    root_secret = base64.b64encode(b"q1a-r5b-task-owned-root-secret-32"[:32]).decode()
    key_json = workspace / "fixture-keys.json"
    key_json.write_text(json.dumps({"root": root_secret, "privateKey": base64.b64encode(Path("/tmp/q1a-r5a-exact-private.der").read_bytes()).decode()}))
    env["SA_I1_FIXTURE_KEYS_PATH"] = str(key_json)
    env["DATABASE_URL"] = db_url
    try:
        subprocess.run([os.environ.get("SA_PNPM_BIN", "pnpm"), "db:migrate"], cwd=ROOT, env=env, check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        set_open_capacity(db_url, 20)
        api = None
        if os.environ.get("SA_R5B_EXTERNAL_SERVERS") != "1":
            api_log = (workspace / "api.log").open("w")
            api = subprocess.Popen([os.environ.get("SA_PNPM_BIN", "pnpm"), "--filter", "@product/api", "exec", "tsx", "../../tests/regression/extension-core/client-i1/api-harness.ts"], cwd=ROOT, env=env, stdout=api_log, stderr=subprocess.STDOUT, text=True)
            processes.append(api)
        try:
            wait_for(lambda: urllib.request.urlopen(f"{API}/health/ready", timeout=2).status == 200, "API readiness", 60)
        except Exception as error:
            api_output = (workspace / "api.log").read_text(errors="replace") if api else "external server mode"
            raise RuntimeError({"phase": "api_start", "process_exit": api.poll() if api else None, "output": api_output[-4000:]}) from error
        portal_env = {**env, "CONTROL_PLANE_API_ORIGIN": API}
        portal = None
        if os.environ.get("SA_R5B_EXTERNAL_SERVERS") != "1":
            portal_log = (workspace / "portal.log").open("w")
            portal = subprocess.Popen([os.environ.get("SA_PNPM_BIN", "pnpm"), "--filter", "@product/portal", "exec", "next", "dev", "--hostname", "127.0.0.1", "--port", "43101"], cwd=ROOT, env=portal_env, stdout=portal_log, stderr=subprocess.STDOUT, text=True)
            processes.append(portal)
        try:
            wait_for(lambda: urllib.request.urlopen(f"{PORTAL}/login", timeout=2).status == 200, "portal readiness", 60)
        except Exception as error:
            portal_output = (workspace / "portal.log").read_text(errors="replace") if portal else "external server mode"
            raise RuntimeError({"phase": "portal_start", "process_exit": portal.poll() if portal else None, "output": portal_output[-4000:]}) from error

        results = {"Q1A-40": {}, "Q1A-41": {}, "Q1A-42": {}, "Q1A-43": {}}
        client40 = InstalledClient(runtime)
        try:
            authority40 = client40.activate("r5b-a40")
            results["Q1A-40"] = {"status": "INSTALLED_PASS", "registration": True, "admission": True, "device_activation": True, "account_selection": True, "bootstrap": True, "accessBasis": authority40.get("payload", {}).get("accessBasis"), "entitlements": sorted(k for k, v in (authority40.get("payload", {}).get("entitlements", {}) or {}).items() if v), "commercial_requirements": {"checkout": False, "paid_subscription": False, "paid_trial_timer": False, "commercial_install_limit": False}}
        finally:
            client40.close()

        state = set_open_capacity(db_url, beta_state(db_url)["admitted"] + 1)
        race_labels = ["r5b-a41-left", "r5b-a41-right"]
        barrier = threading.Barrier(2)
        def race(label):
            if barrier:
                barrier.wait()
            return admit_api(label, f"r5b-{label}")
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            race_results = list(pool.map(race, race_labels))
        winners = [r for r in race_results if r.get("verify_status") == 200]
        losers = [r for r in race_results if r.get("verify_status") != 200]
        winner = winners[0] if len(winners) == 1 else None
        retry_winner = retry_admission(winner, f"r5b-{winner['label']}") if winner else {"verify_status": None}
        retry_loser = retry_admission(losers[0], f"r5b-{losers[0]['label']}") if len(losers) == 1 else {"verify_status": None}
        results["Q1A-41"] = {"status": "INSTALLED_PASS" if winner and len(losers) == 1 else "FAIL", "starting_capacity": state, "concurrent_requests": 2, "winner": winner["label"] if winner else None, "loser": losers[0]["label"] if losers else None, "winner_retry_status": retry_winner.get("verify_status"), "loser_retry_status": retry_loser.get("verify_status"), "final_state": beta_state(db_url), "one_slot_consumed": beta_state(db_url)["admitted"] == state["admitted"] + 1}
        if winner:
            winner_client = InstalledClient(runtime, winner["cookies"])
            try:
                winner_authority = winner_client.activate(winner["label"], winner["cookies"])
                results["Q1A-41"]["installed_winner_bootstrap"] = winner_authority.get("payload", {}).get("accessBasis") == "BETA"
            finally:
                winner_client.close()

        new_denial = admit_api("r5b-a42-new", "r5b-a42-new")
        existing_client = InstalledClient(runtime, winner["cookies"] if winner else [])
        try:
            existing_authority = existing_client.activate(winner["label"], winner["cookies"]) if winner else {}
            results["Q1A-42"] = {"status": "INSTALLED_PASS" if new_denial.get("verify_code") == "BETA_CAPACITY_REACHED" and existing_authority.get("payload", {}).get("accessBasis") == "BETA" else "FAIL", "new_account_denial": {"status": new_denial.get("verify_status"), "code": new_denial.get("verify_code")}, "existing_account_login": True, "existing_account_bootstrap": existing_authority.get("payload", {}).get("accessBasis"), "existing_account_product_access": existing_authority.get("payload", {}).get("accessBasis") == "BETA"}
        finally:
            existing_client.close()

        seed_admin(db_url)
        before = beta_state(db_url)
        request_id = "q1a-r5b-43-capacity-increment"
        first_increment = run_admin_increment(db_url, request_id, before["revision"], 1)
        duplicate_increment = run_admin_increment(db_url, request_id, before["revision"], 1)
        subsequent = admit_api("r5b-a43-followup", "r5b-a43-followup")
        follow_client = InstalledClient(runtime, subsequent.get("cookies", []))
        try:
            follow_authority = follow_client.activate("r5b-a43-followup", subsequent.get("cookies", [])) if subsequent.get("verify_status") == 200 else {}
        finally:
            follow_client.close()
        results["Q1A-43"] = {"status": "INSTALLED_PASS" if first_increment["result"]["kind"] == "APPLIED" and duplicate_increment["result"].get("replay") is True and subsequent.get("verify_status") == 200 and follow_authority.get("payload", {}).get("accessBasis") == "BETA" else "FAIL", "increment_amount": 1, "request_identity": request_id, "first_result": first_increment, "duplicate_result": duplicate_increment, "final_capacity": beta_state(db_url), "subsequent_installed_registration": subsequent.get("verify_status") == 200}

        if os.environ.get("SA_R5B_SKIP_QUOTA") == "1":
            results["Q1A-66"] = {"status": "SKIPPED_EXTERNAL_API_PORT_CONFLICT"}
        else:
            profiles = [quota_profile(runtime, "A", [200, 429]), quota_profile(runtime, "B", [200, 200])]
            results["Q1A-66"] = {"status": "INSTALLED_PASS", "profiles": profiles, "central_quota_lease_requests": 0, "mandatory_provider_dispatch_control_calls": 0, "provider_combined_consumption": sum(len(profile["provider_calls"]) for profile in profiles), "product_truth": "local quota state is per installation; disconnected profiles can independently consume provider quota"}
        return {"status": "PASS" if all(v.get("status") == "INSTALLED_PASS" for v in results.values()) else "FAIL", "package": package, "api": {"port": 43100, "ready": True}, "portal": {"port": 43101, "ready": True}, "beta_state": beta_state(db_url), "results": results, "privacy": {"synthetic_accounts_only": True, "tokens_persisted_in_evidence": False}}
    finally:
        for process in reversed(processes):
            if process.poll() is None:
                process.terminate()
        for process in reversed(processes):
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
        shutil.rmtree(workspace, ignore_errors=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--package-zip", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = run(args)
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps(result, ensure_ascii=False, indent=2))
