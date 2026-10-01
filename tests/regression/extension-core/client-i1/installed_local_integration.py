"""Installed local API/portal/PostgreSQL acceptance for the extension client.

The database URL must point at a disposable loopback database. The API harness
generates its signing key at process start and exports only the public bundle;
the private key remains in that API process and is never copied to the package.
"""
from pathlib import Path
import argparse, hashlib, json, os, re, subprocess, tempfile, time, urllib.request, uuid
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
NODE = os.environ.get("SA_NODE_BIN", "node")
PNPM = os.environ.get("SA_PNPM_BIN", "pnpm")

def fixture_email(name: str, namespace: str) -> str:
    namespace = re.sub(r"[^a-z0-9]", "", namespace.lower())[:24] or "fixture"
    return f"q1a-{namespace}-{name}@example.test"

class SafeStageError(RuntimeError):
    def __init__(self, stage, status, code):
        super().__init__(f"{stage}: status={status} error_code={code}")
        self.stage, self.status, self.code = stage, status, code

def response_code(response):
    try:
        value = response.json()
    except Exception:
        value = None
    code = value.get("error", {}).get("code") if isinstance(value, dict) else None
    return code if isinstance(code, str) and re.fullmatch(r"[A-Z0-9_]{1,80}", code) else "UNALLOWLISTED_ERROR"

def expect_portal_post(page, portal_port, endpoint, action, expected, stage):
    with page.expect_response(lambda r: r.request.method == "POST" and r.url == f"http://127.0.0.1:{portal_port}/api/control-plane{endpoint}") as pending:
        action()
    response = pending.value
    if response.status != expected:
        raise SafeStageError(stage, response.status, response_code(response))
    return response

def wait_for(url, timeout=60):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status < 500:
                    return
        except Exception:
            pass
        time.sleep(.25)
    raise RuntimeError(f"timed out waiting for {url}")

def wait_until(check, label, timeout=30):
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        last = check()
        if last:
            return last
        time.sleep(.1)
    raise RuntimeError(f"timed out waiting for {label}; last={last!r}")

def file_sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()

def run(runtime, output):
    if os.environ.get("PRODUCT_CONTROL_PLANE_E2E") != "1":
        raise RuntimeError("PRODUCT_CONTROL_PLANE_E2E=1 is required")
    if not os.environ.get("DATABASE_URL"):
        raise RuntimeError("DATABASE_URL is required")
    output.mkdir(parents=True, exist_ok=False)
    required = [ROOT / "package.json", ROOT / "tooling/build/extension_composed.py",
                ROOT / "tests/regression/extension-core/client-i1/api-harness.ts",
                ROOT / "tests/regression/extension-core/client-i1/make-browser-config.mjs",
                ROOT / "tests/regression/extension-core/fixtures/application-chat.html"]
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        raise RuntimeError("required installed-local inputs missing: " + ", ".join(missing))
    api_port, portal_port = "43100", "43101"
    namespace = os.environ.get("SA_I1_FIXTURE_NAMESPACE") or uuid.uuid4().hex
    extension_version = json.loads((ROOT / "apps/extension/composition.json").read_text())["version"]
    if not isinstance(extension_version, str) or not re.fullmatch(r"\d+\.\d+\.\d+", extension_version):
        raise RuntimeError("invalid installed-local composition version")
    env = {
        **os.environ,
        "SA_I1_API_PORT": api_port,
        "SA_I1_FIXTURE_NAMESPACE": namespace,
        "SA_I1_EXTENSION_VERSION": extension_version,
        "SA_I1_FORCE_BETA_BOOTSTRAP": "1",
    }
    processes = []
    result = {"status": "RUNNING", "installed_acceptance": False, "otp": "development fixed OTP; not email evidence", "live_provider_calls": 0}
    with tempfile.TemporaryDirectory(prefix="seller-agents-i1-local-") as temp:
        temp_path = Path(temp)
        trust_path = temp_path / "public-trust-bundle.json"
        fixture_evidence_path = temp_path / "fixture-evidence.json"
        private_placeholder = temp_path / "unused-private-key.der"
        try:
            try:
                subprocess.run([PNPM, "db:migrate"], cwd=ROOT, env=env, check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            except subprocess.CalledProcessError as error:
                result.update(status="FAIL", stage="database_migrate", error=type(error).__name__, safe_failure={"stage": "database_migrate", "status": None, "error_code": "DATABASE_MIGRATION_FAILED"}, safe_counts={"control_responses": 0}, migration_exit_code=error.returncode)
                raise
            api_env = {**env, "SA_I1_PUBLIC_TRUST_BUNDLE_PATH": str(trust_path), "SA_I1_FIXTURE_EVIDENCE_PATH": str(fixture_evidence_path)}
            api = subprocess.Popen([PNPM, "--filter", "@product/api", "exec", "tsx", "../../tests/regression/extension-core/client-i1/api-harness.ts"], cwd=ROOT, env=api_env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            processes.append(api)
            wait_for(f"http://127.0.0.1:{api_port}/health/ready")
            if not trust_path.exists():
                raise RuntimeError("API did not export public trust bundle")
            if not fixture_evidence_path.exists() or json.loads(fixture_evidence_path.read_text())["existing_fixture_accounts"] != 2 or json.loads(fixture_evidence_path.read_text())["beta_unchanged"] is not True:
                raise RuntimeError("API fixture preparation evidence is incomplete")
            evidence = json.loads(fixture_evidence_path.read_text())
            if evidence.get("fixture_emails") != [fixture_email("one", namespace), fixture_email("two", namespace)]:
                raise RuntimeError("API and browser fixture identities do not match")
            config = subprocess.check_output([NODE, str(ROOT / "tests/regression/extension-core/client-i1/make-browser-config.mjs"), str(private_placeholder), str(trust_path)], cwd=ROOT, env=env, text=True)
            packaged_config = json.loads(config)
            configured_package = os.environ.get("SA_Q1A_FINAL_PACKAGE_ROOT")
            if configured_package:
                package_root = Path(configured_package).resolve()
                runtime_path = package_root / "runtime"
                if not (runtime_path / "manifest.json").is_file() or not (runtime_path / "service_worker.js").is_file():
                    raise RuntimeError("SA_Q1A_FINAL_PACKAGE_ROOT is not a complete packaged runtime")
            else:
                package_root = output / "candidate-package"
                build_env = {**env, "SA_PACKAGED_CONFIG_JSON": config}
                subprocess.run(["python", "tooling/build/extension_composed.py", "--output", str(package_root)], cwd=ROOT, env=build_env, check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            package_archives = sorted(package_root.glob("*.zip"))
            if len(package_archives) != 1:
                raise RuntimeError("installed-local package must contain exactly one ZIP archive")
            package_archive = package_archives[0]
            package_sha256 = file_sha256(package_archive)
            composition_receipt = json.loads((package_root / "composition-receipt.json").read_text())
            result["package"] = {
                "name": package_archive.name,
                "sha256": package_sha256,
                "version": composition_receipt.get("version"),
                "build_mode": composition_receipt.get("build_mode"),
                "environment": composition_receipt.get("environment"),
                "runtime_input_sha256": composition_receipt.get("inputs", {}).get("apps/extension/src/application/runtime.js", {}).get("sha256"),
            }
            portal_env = {**env, "CONTROL_PLANE_API_ORIGIN": f"http://127.0.0.1:{api_port}"}
            portal = subprocess.Popen([PNPM, "--filter", "@product/portal", "exec", "next", "dev", "--hostname", "127.0.0.1", "--port", portal_port], cwd=ROOT, env=portal_env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            processes.append(portal)
            wait_for(f"http://127.0.0.1:{portal_port}/login")
            fixture = (ROOT / "tests/regression/extension-core/fixtures/application-chat.html").read_text()
            with sync_playwright() as playwright, tempfile.TemporaryDirectory(prefix="seller-agents-i1-browser-") as profile:
                options = {"headless": True, "args": ["--no-sandbox", f"--disable-extensions-except={package_root / 'runtime'}", f"--load-extension={package_root / 'runtime'}"]}
                if os.environ.get("SA_TEST_CHROMIUM"):
                    options["executable_path"] = os.environ["SA_TEST_CHROMIUM"]
                else:
                    options["channel"] = "chromium"
                context = playwright.chromium.launch_persistent_context(profile, **options)
                stage = "browser_start"
                try:
                    context.route("https://**/*", lambda route: route.fulfill(body=fixture, content_type="text/html") if route.request.url.startswith("https://chatgpt.com/c/") else route.abort())
                    control_responses = []
                    bootstrap_envelopes = []
                    authorization_ids = set()
                    def observe_control(response):
                        parsed = urlparse(response.url)
                        if parsed.netloc == f"127.0.0.1:{api_port}" and parsed.path.startswith("/v1/"):
                            control_responses.append(("direct_extension", parsed.path, response.status))
                            if parsed.path == "/v1/bootstrap" and response.status == 200:
                                try:
                                    bootstrap_envelopes.append(response.json())
                                except Exception:
                                    bootstrap_envelopes.append(None)
                        elif parsed.netloc == f"127.0.0.1:{portal_port}" and parsed.path.startswith("/api/control-plane/"):
                            control_responses.append(("portal_bff", parsed.path.removeprefix("/api/control-plane"), response.status))
                    context.on("response", observe_control)
                    worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker")
                    worker_sentinel = worker.evaluate("""() => { if (!globalThis.__saI1WorkerSentinel) globalThis.__saI1WorkerSentinel = crypto.randomUUID(); return globalThis.__saI1WorkerSentinel; }""")

                    def inspect_signed_profile(envelope):
                        return worker.evaluate("""async ({envelope, trust, extensionVersion}) => {
                          const observed = SellerAgentsBrowserIdentity.current();
                          const verified = await SellerAgentsBootstrapVerifier.verifyV2(envelope, trust);
                          if (!verified.ok) return {verified:false, error:verified.error || null, browser:observed, extensionVersion};
                          const profile = verified.payload?.ai?.profile || null;
                          return {
                            verified:true,
                            browser:observed,
                            extensionVersion,
                            aiStatus: verified.payload?.ai?.status || null,
                            detected: verified.payload?.ai?.detected || null,
                            profileContractVersion: profile?.compatibility?.contractVersion || null,
                            profileBrowserFamilies: Array.isArray(profile?.compatibility?.browserFamilies) ? profile.compatibility.browserFamilies : null,
                            minimumExtensionVersion: profile?.compatibility?.minimumExtensionVersion ?? null,
                            materialShapeValid: profile ? SellerAgentsSignedAiProfileConsumer.validMaterialShape(profile) : false,
                            materialValid: profile ? await SellerAgentsSignedAiProfileConsumer.validMaterial(profile) : false,
                          };
                        }""", {
                            "envelope": envelope,
                            "trust": packaged_config["trustBundle"],
                            "extensionVersion": packaged_config["extensionVersion"],
                        })

                    chat = context.new_page()
                    chat.goto("https://chatgpt.com/c/11111111-1111-4111-8111-111111111111")
                    chat_marker = "octoport-c05-" + uuid.uuid4().hex
                    chat.evaluate("value => { document.title = value; }", chat_marker)
                    chat_tab_id = wait_until(
                        lambda: worker.evaluate("""async ({url, marker}) => {
                          const matches = (await chrome.tabs.query({})).filter(tab => tab.url === url && tab.title === marker);
                          return matches.length === 1 ? matches[0].id : null;
                        }""", {"url": chat.url, "marker": chat_marker}),
                        "installed ChatGPT tab id",
                    )
                    popup = context.new_page()
                    popup.add_init_script(f"""
                      const __octoportOriginalTabsQuery = chrome.tabs.query.bind(chrome.tabs);
                      chrome.tabs.query = query => query?.active ? Promise.resolve([{{id:{int(chat_tab_id)}}}]) : __octoportOriginalTabsQuery(query);
                    """)
                    popup.goto(worker.url.rsplit("/", 1)[0] + "/popup.html")

                    def activate(email):
                        nonlocal worker_sentinel, stage
                        stage = "auth_start"
                        with context.expect_page() as page_info:
                            popup.click("#auth-start")
                        portal_page = page_info.value
                        stage = "portal_login_redirect"
                        portal_page.wait_for_load_state()
                        portal_page.wait_for_url("**/login?returnTo=*")
                        portal_page.locator('input[type="email"]').wait_for(state="visible")
                        portal_page.locator('input[type="email"]').fill(email)
                        expect_portal_post(portal_page, portal_port, "/v1/auth/otp/request", lambda: portal_page.get_by_role("button", name="Send code").click(), 202, "otp_request")
                        portal_page.locator('input[inputmode="numeric"]').wait_for(state="visible")
                        portal_page.locator('input[inputmode="numeric"]').fill("424242")
                        expect_portal_post(portal_page, portal_port, "/v1/auth/otp/verify", lambda: portal_page.get_by_role("button", name="Verify").click(), 200, "otp_verify")
                        stage = "activation_redirect"
                        portal_page.wait_for_url("**/activate?authorizationId=*")
                        activation_id = re.search(r"[?&]authorizationId=([0-9a-f-]{36})", portal_page.url, re.I)
                        if activation_id is None:
                            raise RuntimeError("activation redirect did not contain a bounded authorization id")
                        authorization_ids.add(activation_id.group(1).lower())
                        stage = "activation_preview"
                        portal_page.locator("dl dd").first.wait_for(state="visible")
                        portal_page.locator('select option:not([value=""]):not([disabled])').first.wait_for(state="attached")
                        popup.locator("#auth-code").wait_for(state="visible")
                        stage = "activation_approval"
                        popup.wait_for_function("""() => { const text = document.querySelector('#auth-code')?.textContent || ''; return /[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/.test(text.trim()); }""")
                        code_text = popup.locator("#auth-code").inner_text().strip()
                        code_match = re.search(r"([ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4})$", code_text)
                        if code_match is None:
                            raise RuntimeError("auth code UI did not reach a valid bounded state")
                        code = code_match.group(1)
                        active_option = portal_page.locator('select option:not([value=""]):not([disabled])').first
                        active_option.wait_for(state="attached")
                        active_value = active_option.get_attribute("value")
                        if not active_value:
                            raise RuntimeError("activation account selector has no active value")
                        portal_page.locator("select").select_option(value=active_value)
                        portal_page.get_by_label("User code").fill(code)
                        expect_portal_post(portal_page, portal_port, f"/v1/device-authorizations/{activation_id.group(1)}/approve", lambda: portal_page.get_by_role("button", name="Approve").click(), 200, "activation_approval")
                        portal_page.get_by_role("status").wait_for(state="visible")
                        if portal_page.get_by_role("status").inner_text() != "Device approved. Return to the extension to finish activation.":
                            raise RuntimeError("device approval did not reach the successful status")
                        portal_page.close()
                        popup.wait_for_function("() => document.querySelector('#account').innerText.includes('Аккаунт ·')")
                        stage = "bootstrap_observed"
                        return worker.evaluate("""async () => { const authority = await SellerAgentsControlClient.getAuthority(); const status = await SellerAgentsControlClient.status(); return { account: authority?.payload?.account?.id || null, device: authority?.deviceId || null, session: authority?.sessionId || null, accessBasis: authority?.payload?.accessBasis || null, authenticated: status.authenticated, workAllowed: status.workAllowed }; }""")

                    first_identity = activate(fixture_email("one", namespace))
                    assert first_identity["authenticated"] is True and first_identity["workAllowed"] is False and first_identity["accessBasis"] == "BETA"
                    assert popup.locator("#catalog").is_visible()
                    first_account = popup.locator("#account").inner_text()
                    popup.click("#wildberries")
                    popup.click("#add")
                    popup.fill("#token", "FIXTURE_BROWSER_PERSONAL_TOKEN")
                    popup.fill("#name", "Аккаунт A WB")
                    popup.click("#save")
                    popup.wait_for_function("() => document.querySelector('#stores').innerText.includes('Аккаунт A WB')")
                    # Portal logout only clears the portal cookie; extension D3 logout is not tested here.
                    portal_page = context.new_page()
                    portal_page.goto(f"http://127.0.0.1:{portal_port}/")
                    logout_status = portal_page.evaluate("""async () => { const csrf = document.cookie.split(';').map(x => x.trim()).find(x => x.startsWith('pcp_csrf=')); const response = await fetch('/api/control-plane/v1/auth/logout', {method:'POST', headers: csrf ? {'x-csrf-token': csrf.slice(9)} : {}}); return response.status; }""")
                    assert logout_status == 204
                    logout_cleared = not any(cookie["name"] in {"pcp_portal_session", "pcp_csrf"} for cookie in context.cookies(f"http://127.0.0.1:{portal_port}/"))
                    assert logout_cleared
                    portal_page.close()
                    popup.click("#auth-reset")
                    popup.locator("#confirmation").wait_for()
                    popup.locator("#confirmation #confirm").click()
                    popup.wait_for_function("() => document.querySelector('#auth-start').offsetParent !== null && document.querySelector('#account').innerText.includes('Вход не выполнен')")
                    second_identity = activate(fixture_email("two", namespace))
                    assert second_identity["accessBasis"] == "BETA"
                    assert popup.locator("#account").inner_text() != first_account
                    assert "Аккаунт A WB" not in popup.locator("#stores").inner_text()

                    popup.click("#wildberries")
                    popup.click("#add")
                    popup.fill("#token", "FIXTURE_BROWSER_PERSONAL_TOKEN_TWO")
                    popup.fill("#name", "Аккаунт B WB")
                    popup.click("#save")
                    popup.wait_for_function("() => document.querySelector('#stores').innerText.includes('Аккаунт B WB')")

                    stage = "work_start"
                    popup.click("#start")
                    wait_until(lambda: chat.evaluate("() => window.sent.length > 0"), "installed Work Start prompt")
                    conversation_key = "https://chatgpt.com|11111111-1111-4111-8111-111111111111"
                    work_state = wait_until(
                        lambda: worker.evaluate("""async key => {
                          const stored = await chrome.storage.local.get('ozmb_work_sessions_v1');
                          const row = (stored.ozmb_work_sessions_v1 || {})[key] || null;
                          return row && ['active_visible', 'active_hidden', 'recovering'].includes(row.state)
                            ? {state: row.state, revision: row.revision, hasIntent: Boolean(row.start_intent_id)}
                            : null;
                        }""", conversation_key),
                        "installed Work Start activation",
                    )
                    if not bootstrap_envelopes or not bootstrap_envelopes[-1]:
                        raise RuntimeError("signed AI bootstrap was not observed")
                    signed_profile = worker.evaluate("""async ({envelope, trust, extensionVersion}) => {
                      const observed = SellerAgentsBrowserIdentity.current();
                      const verified = await SellerAgentsBootstrapVerifier.verifyV2(envelope, trust);
                      if (!verified.ok) return {verified:false, error:verified.error || null};
                      const profile = verified.payload?.ai?.profile || null;
                      return {
                        verified:true,
                        aiStatus:verified.payload?.ai?.status || null,
                        detected:verified.payload?.ai?.detected || null,
                        profileContractVersion:profile?.compatibility?.contractVersion || null,
                        profileBrowserFamilies:Array.isArray(profile?.compatibility?.browserFamilies) ? profile.compatibility.browserFamilies : [],
                        minimumExtensionVersion:profile?.compatibility?.minimumExtensionVersion ?? null,
                        browser:observed,
                        extensionVersion,
                        materialShapeValid:profile ? SellerAgentsSignedAiProfileConsumer.validMaterialShape(profile) : false,
                        materialValid:profile ? await SellerAgentsSignedAiProfileConsumer.validMaterial(profile) : false,
                      };
                    }""", {
                        "envelope": bootstrap_envelopes[-1],
                        "trust": packaged_config["trustBundle"],
                        "extensionVersion": packaged_config["extensionVersion"],
                    })
                    if not (
                        signed_profile.get("verified") is True
                        and signed_profile.get("aiStatus") == "RESOLVED"
                        and signed_profile.get("detected") == {"family": "chatgpt", "surface": "web", "variant": None}
                        and signed_profile.get("materialShapeValid") is True
                        and signed_profile.get("materialValid") is True
                        and signed_profile.get("browser", {}).get("family") in signed_profile.get("profileBrowserFamilies", [])
                        and signed_profile.get("extensionVersion") == extension_version
                    ):
                        raise RuntimeError(f"signed AI profile verification failed: {signed_profile}")

                    page_private_marker = "octoport-private-page-" + uuid.uuid4().hex
                    chat.evaluate("""marker => {
                      const probe = document.createElement('div');
                      probe.id = 'octoport-private-probe';
                      probe.textContent = marker;
                      document.body.appendChild(probe);
                    }""", page_private_marker)
                    sent_prompt = chat.evaluate("() => String(window.sent?.[0] || '')")
                    private_storage = worker.evaluate("""async () => {
                      const stored = await chrome.storage.local.get('seller_agents_stores_v1');
                      const accounts = stored.seller_agents_stores_v1?.accounts || {};
                      return {storeIds:Object.values(accounts).flatMap(account => Object.keys(account?.stores || {})).sort()};
                    }""")

                    popup.click("#support-generate")
                    popup.locator("#support-snapshot").wait_for(state="visible")
                    support_snapshot = json.loads(popup.locator("#support-snapshot").input_value())
                    privacy = support_snapshot.get("privacy", {})
                    if not privacy or any(value is not False for value in privacy.values()):
                        raise RuntimeError("support snapshot privacy contract failed")
                    serialized_snapshot = json.dumps(support_snapshot, ensure_ascii=False)
                    forbidden_values = [
                        "Аккаунт A WB",
                        "Аккаунт B WB",
                        "FIXTURE_BROWSER_PERSONAL_TOKEN",
                        "FIXTURE_BROWSER_PERSONAL_TOKEN_TWO",
                        first_identity["account"],
                        first_identity["device"],
                        first_identity["session"],
                        second_identity["account"],
                        second_identity["device"],
                        second_identity["session"],
                        "11111111-1111-4111-8111-111111111111",
                        chat_marker,
                        page_private_marker,
                        sent_prompt,
                        *private_storage["storeIds"],
                    ]
                    for forbidden in forbidden_values:
                        if forbidden and forbidden in serialized_snapshot:
                            raise RuntimeError("support snapshot leaked private page, prompt, account, store, credential, device, session, or conversation data")

                    worker_sentinel_after = worker.evaluate("globalThis.__saI1WorkerSentinel")
                    same_worker = worker_sentinel == worker_sentinel_after
                    before_restart = worker.evaluate("""async key => {
                      const status = await SellerAgentsControlClient.status();
                      const authority = await SellerAgentsControlClient.getAuthority();
                      const stored = await chrome.storage.local.get(['seller_agents_stores_v1', 'ozmb_work_sessions_v1']);
                      const storesRoot = stored.seller_agents_stores_v1 || {};
                      const accountId = authority?.payload?.account?.id || null;
                      const currentStores = storesRoot.accounts?.[accountId]?.stores || {};
                      const row = (stored.ozmb_work_sessions_v1 || {})[key] || null;
                      return {
                        authenticated:status.authenticated === true,
                        workAllowed:status.workAllowed === true,
                        accountId,
                        deviceId:authority?.deviceId || null,
                        sessionId:authority?.sessionId || null,
                        storeIds:Object.keys(currentStores).sort(),
                        workState:row?.state || null,
                        workRevision:Number(row?.revision || 0),
                        workStartIntentId:row?.start_intent_id || null,
                        conversationId:row?.conversation_id || null,
                        origin:row?.origin || null,
                      };
                    }""", conversation_key)
                    assert before_restart["authenticated"] is True and before_restart["workAllowed"] is True
                    assert before_restart["accountId"] == second_identity["account"]
                    assert before_restart["deviceId"] == second_identity["device"]
                    assert before_restart["sessionId"] == second_identity["session"]
                    assert len(before_restart["storeIds"]) == 1
                    assert before_restart["workState"] == "active_visible"
                    assert before_restart["workStartIntentId"]
                    assert before_restart["conversationId"] == "11111111-1111-4111-8111-111111111111"
                    assert before_restart["origin"] == "https://chatgpt.com"

                    stage = "browser_restart"
                    context.close()
                    context = playwright.chromium.launch_persistent_context(profile, **options)
                    context.route("https://**/*", lambda route: route.fulfill(body=fixture, content_type="text/html") if route.request.url.startswith("https://chatgpt.com/c/") else route.abort())
                    context.on("response", observe_control)
                    worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker")
                    restarted_sentinel = worker.evaluate("""() => { if (!globalThis.__saI1WorkerSentinel) globalThis.__saI1WorkerSentinel = crypto.randomUUID(); return globalThis.__saI1WorkerSentinel; }""")
                    chat = context.new_page()
                    chat.goto("https://chatgpt.com/c/11111111-1111-4111-8111-111111111111")
                    chat_marker = "octoport-c05-restart-" + uuid.uuid4().hex
                    chat.evaluate("value => { document.title = value; }", chat_marker)
                    chat_tab_id = wait_until(
                        lambda: worker.evaluate("""async ({url, marker}) => {
                          const matches = (await chrome.tabs.query({})).filter(tab => tab.url === url && tab.title === marker);
                          return matches.length === 1 ? matches[0].id : null;
                        }""", {"url": chat.url, "marker": chat_marker}),
                        "restarted ChatGPT tab id",
                    )
                    popup = context.new_page()
                    popup.add_init_script(f"""
                      const __octoportOriginalTabsQuery = chrome.tabs.query.bind(chrome.tabs);
                      chrome.tabs.query = query => query?.active ? Promise.resolve([{{id:{int(chat_tab_id)}}}]) : __octoportOriginalTabsQuery(query);
                    """)
                    popup.goto(worker.url.rsplit("/", 1)[0] + "/popup.html")
                    popup.wait_for_function("() => document.querySelector('#account').innerText.includes('Аккаунт ·')")
                    after_restart = wait_until(
                        lambda: worker.evaluate("""async ({key, expected}) => {
                          const status = await SellerAgentsControlClient.status();
                          const authority = await SellerAgentsControlClient.getAuthority();
                          const stored = await chrome.storage.local.get(['seller_agents_stores_v1', 'ozmb_work_sessions_v1']);
                          const storesRoot = stored.seller_agents_stores_v1 || {};
                          const accountId = authority?.payload?.account?.id || null;
                          const currentStores = storesRoot.accounts?.[accountId]?.stores || {};
                          const row = (stored.ozmb_work_sessions_v1 || {})[key] || null;
                          const snapshot = {
                            authenticated:status.authenticated === true,
                            workAllowed:status.workAllowed === true,
                            accountId,
                            deviceId:authority?.deviceId || null,
                            sessionId:authority?.sessionId || null,
                            storeIds:Object.keys(currentStores).sort(),
                            workState:row?.state || null,
                            workRevision:Number(row?.revision || 0),
                            workStartIntentId:row?.start_intent_id || null,
                            conversationId:row?.conversation_id || null,
                            origin:row?.origin || null,
                          };
                          return snapshot.authenticated && snapshot.workAllowed &&
                            snapshot.accountId === expected.accountId &&
                            snapshot.deviceId === expected.deviceId &&
                            snapshot.sessionId === expected.sessionId &&
                            JSON.stringify(snapshot.storeIds) === JSON.stringify(expected.storeIds) &&
                            snapshot.workState === expected.workState &&
                            snapshot.workRevision === expected.workRevision &&
                            snapshot.workStartIntentId === expected.workStartIntentId &&
                            snapshot.conversationId === expected.conversationId &&
                            snapshot.origin === expected.origin ? snapshot : null;
                        }""", {"key": conversation_key, "expected": before_restart}),
                        "browser restart state restore",
                    )
                    assert restarted_sentinel != worker_sentinel_after

                    distinct_accounts = first_identity["account"] != second_identity["account"]
                    distinct_device_sessions = (first_identity["device"], first_identity["session"]) != (second_identity["device"], second_identity["session"])
                    assert same_worker and distinct_accounts and distinct_device_sessions and len(authorization_ids) == 2
                    direct = [(endpoint, status) for surface, endpoint, status in control_responses if surface == "direct_extension"]
                    bff = [(endpoint, status) for surface, endpoint, status in control_responses if surface == "portal_bff"]
                    control_counts = {"device_start": sum(1 for endpoint, status in direct if endpoint == "/v1/device-authorizations" and status == 201), "exchange": sum(1 for endpoint, status in direct if endpoint == "/v1/device-authorizations/token" and status == 200), "bootstrap": sum(1 for endpoint, status in direct if endpoint == "/v1/bootstrap" and status == 200)}
                    bff_counts = {"otp_request_202": sum(1 for endpoint, status in bff if endpoint == "/v1/auth/otp/request" and status == 202), "otp_verify_200": sum(1 for endpoint, status in bff if endpoint == "/v1/auth/otp/verify" and status == 200), "logout_204": sum(1 for endpoint, status in bff if endpoint == "/v1/auth/logout" and status == 204)}
                    assert control_counts == {"device_start": 2, "exchange": 2, "bootstrap": 3}
                    assert bff_counts == {"otp_request_202": 2, "otp_verify_200": 2, "logout_204": 1}
                    result.update(
                        status="PASS",
                        installed_acceptance=True,
                        access_basis="BETA_SYNTHETIC_FIXTURE",
                        email_delivery_tested=False,
                        browser=context.browser.version,
                        checks=[
                            "real API device start",
                            "portal OTP/approve",
                            "device exchange",
                            "browser V2 bootstrap",
                            "account-scoped WB catalog",
                            "account reset and second account isolation",
                            "installed Work Start through current signed AI profile",
                            "privacy-safe support snapshot after Start",
                            "browser restart preserves authenticated store/work state",
                        ],
                        work_start={"state": work_state["state"], "has_intent": work_state["hasIntent"]},
                        signed_profile={
                            "verified": signed_profile["verified"],
                            "browser_family": signed_profile["browser"]["family"],
                            "ai_status": signed_profile["aiStatus"],
                            "profile_contract_version": signed_profile["profileContractVersion"],
                            "material_shape_valid": signed_profile["materialShapeValid"],
                            "material_valid": signed_profile["materialValid"],
                        },
                        browser_restart={
                            "same_account": after_restart["accountId"] == before_restart["accountId"],
                            "same_device_session": (after_restart["deviceId"], after_restart["sessionId"]) == (before_restart["deviceId"], before_restart["sessionId"]),
                            "same_store_ids": after_restart["storeIds"] == before_restart["storeIds"],
                            "same_work_revision": after_restart["workRevision"] == before_restart["workRevision"],
                            "same_work_intent": after_restart["workStartIntentId"] == before_restart["workStartIntentId"],
                            "same_conversation": after_restart["conversationId"] == before_restart["conversationId"] and after_restart["origin"] == before_restart["origin"],
                            "state_before": before_restart["workState"],
                            "state_after": after_restart["workState"],
                            "revision_before": before_restart["workRevision"],
                            "revision_after": after_restart["workRevision"],
                            "new_worker": True,
                        },
                        support_snapshot_privacy=True,
                        same_worker=same_worker,
                        distinct_accounts=distinct_accounts,
                        distinct_device_sessions=distinct_device_sessions,
                        distinct_authorizations=True,
                        control_counts=control_counts,
                        bff_counts=bff_counts,
                        logout_cleared=logout_cleared,
                        fixture_accounts_prepared=2,
                        beta_unchanged=True,
                    )
                except Exception:
                    try:
                        diagnostic = worker.evaluate("""async () => {
                          const status = await SellerAgentsControlClient.status();
                          const code = String(status?.lastError?.code || "");
                          return {
                            pending: Boolean(status?.pending),
                            authenticated: status?.authenticated === true,
                            workAllowed: status?.workAllowed === true,
                            codePresent: Boolean(code),
                            errorCode: /^[A-Z0-9_]{1,80}$/.test(code) ? code : null
                          };
                        }""")
                        result["failure_diagnostic"] = {"stage": stage, **diagnostic}
                        if bootstrap_envelopes and bootstrap_envelopes[-1]:
                            result["failure_profile_diagnostic"] = inspect_signed_profile(bootstrap_envelopes[-1])
                    except Exception:
                        result["failure_diagnostic"] = {"stage": stage, "read_failed": True, "error_code": "DIAGNOSTIC_READ_FAILED"}
                    raise
                finally:
                    context.close()
        except SafeStageError as error:
            result.update(status="FAIL", stage=error.stage, error=type(error).__name__, safe_failure={"stage": error.stage, "status": error.status, "error_code": error.code}, safe_counts={"control_responses": len(locals().get("control_responses", []))})
            raise
        except Exception as error:
            if result.get("stage") == "database_migrate":
                raise
            result.update(status="FAIL", stage=locals().get("stage", "unknown"), error=type(error).__name__, safe_failure={"stage": locals().get("stage", "unknown"), "status": None, "error_code": "UNAVAILABLE"}, safe_counts={"control_responses": len(locals().get("control_responses", []))})
            raise
        finally:
            for process in reversed(processes):
                if process.poll() is None:
                    process.terminate()
            for process in reversed(processes):
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
            (output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps(result, ensure_ascii=False))

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime", type=Path, required=False)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    run(args.runtime.resolve() if args.runtime else Path("."), args.output.resolve())
