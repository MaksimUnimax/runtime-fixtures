"""Real-browser parity acceptance for a RESOLVED control_plane_v2 profile.

Uses only the role-A disposable PostgreSQL database, loopback API/portal, fixture
accounts and locally generated signing material. No live/provider credentials.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import subprocess
import tempfile
import time
import urllib.request
import uuid
from pathlib import Path

from playwright.sync_api import sync_playwright
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.support.ui import Select, WebDriverWait

ROOT = Path(__file__).resolve().parents[4]
PRODUCT_ROOT = Path(os.environ.get("SA_PARITY_PRODUCT_ROOT", str(ROOT))).resolve()
NODE = os.environ.get("SA_NODE_BIN", "/root/.nvm/versions/node/v24.20.0/bin/node")
PNPM = os.environ.get("SA_PNPM_BIN", "pnpm")
API_PORT = os.environ.get("SA_I1_API_PORT", "18101")
PORTAL_PORT = os.environ.get("SA_I1_PORTAL_PORT", "18111")
OPERA = os.environ.get("SA_TEST_OPERA", "/usr/bin/opera")
FIREFOX = os.environ.get("SA_TEST_FIREFOX", "/root/octoport-control/browsers/A/firefox-155.0.1/unpack/firefox/firefox")
GECKO = os.environ.get("SA_TEST_GECKO", "/root/.cache/selenium/geckodriver/linux64/0.37.1/geckodriver")
TECH = "technicalAndInteraction"
def fixture_email(name: str, namespace: str) -> str:
    safe = re.sub(r"[^a-z0-9]", "", namespace.lower())[:24] or "fixture"
    return f"q1a-{safe}-{name}@example.test"


def canonical(value):
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return json.dumps(value, separators=(",", ":"))
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, list):
        return "[" + ",".join(canonical(item) for item in value) + "]"
    return "{" + ",".join(
        json.dumps(key, separators=(",", ":")) + ":" + canonical(value[key])
        for key in sorted(value)
    ) + "}"


def safe_bootstrap_meta(envelope):
    try:
        raw = envelope["payload"]
        raw += "=" * ((4 - len(raw) % 4) % 4)
        payload = json.loads(base64.urlsafe_b64decode(raw.encode()).decode())
        profile = payload.get("ai", {}).get("profile") or {}
        compatibility = profile.get("compatibility") or {}
        content = profile.get("content")
        calculated = hashlib.sha256(
            canonical({"content": content, "compatibility": compatibility}).encode()
        ).hexdigest() if content is not None else None
        return {
            "outerContract": payload.get("contractVersion"),
            "aiStatus": payload.get("ai", {}).get("status"),
            "detectedAi": payload.get("ai", {}).get("detected"),
            "profileContract": compatibility.get("contractVersion"),
            "profileFamilies": compatibility.get("browserFamilies"),
            "profileHashMatches": calculated == profile.get("contentSha256"),
            "extensionCompatibility": payload.get("compatibility", {}).get("extension", {}).get("status"),
            "browserCompatibility": payload.get("compatibility", {}).get("browser", {}).get("status"),
        }
    except Exception:
        return {"decodeError": True}


def wait_http(url: str, timeout: float = 90) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status < 500:
                    return
        except Exception:
            pass
        time.sleep(0.25)
    raise RuntimeError("HTTP_READY_TIMEOUT")


def run_checked(command, *, cwd=ROOT, env=None):
    return subprocess.run(
        command, cwd=cwd, env=env, check=True,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )


def activate_playwright(context, popup, portal_port: str, email: str):
    with context.expect_page() as page_info:
        popup.click("#auth-start")
    portal = page_info.value
    portal.wait_for_load_state()
    portal.wait_for_url("**/login?returnTo=*")
    portal.locator('input[type="email"]').fill(email)
    portal.get_by_role("button", name="Send code").click()
    portal.locator('input[inputmode="numeric"]').wait_for(state="visible")
    portal.locator('input[inputmode="numeric"]').fill("424242")
    portal.get_by_role("button", name="Verify").click()
    portal.wait_for_url("**/activate?authorizationId=*")
    active = portal.locator('select option:not([value=""]):not([disabled])').first
    active.wait_for(state="attached")
    value = active.get_attribute("value")
    if not value:
        raise RuntimeError("NO_ACTIVE_ACCOUNT_OPTION")
    popup.locator("#auth-code").wait_for(state="visible")
    popup.wait_for_function(
        "() => /[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}/.test(document.querySelector('#auth-code')?.textContent||'')"
    )
    match = re.search(
        r"([ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4})",
        popup.locator("#auth-code").inner_text(),
    )
    if not match:
        raise RuntimeError("USER_CODE_MISSING")
    portal.locator("select").select_option(value)
    portal.locator("//label[contains(.,'User code')]//input").fill(match.group(1))
    portal.get_by_role("button", name="Approve").click()
    portal.locator('[role="status"]').filter(has_text="Device approved").wait_for()
    portal.close()


def opera_case(runtime: Path, email: str, network_evidence: Path) -> dict:
    result = {"status": "FAIL", "browser": "opera", "stage": "start"}
    with sync_playwright() as pw, tempfile.TemporaryDirectory(prefix="octoport-a-v2-opera-") as profile:
        ctx = pw.chromium.launch_persistent_context(
            profile, headless=True, executable_path=OPERA,
            args=["--no-sandbox", "--disable-dev-shm-usage",
                  f"--disable-extensions-except={runtime}", f"--load-extension={runtime}"],
        )
        bootstrap_meta = []
        def capture_bootstrap(response):
            if response.url.endswith("/v1/bootstrap") and response.status == 200:
                try:
                    bootstrap_meta.append(safe_bootstrap_meta(response.json()))
                except Exception:
                    bootstrap_meta.append({"decodeError": True})
        ctx.on("response", capture_bootstrap)
        try:
            worker = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker", timeout=20000)
            base = worker.url.rsplit("/", 1)[0]
            popup = ctx.new_page()
            popup.goto(base + "/popup.html", wait_until="domcontentloaded")
            result["stage"] = "activation"
            activate_playwright(ctx, popup, PORTAL_PORT, email)
            result["stage"] = "bootstrap"
            popup.wait_for_function("() => (document.querySelector('#account')?.textContent||'').includes('Аккаунт ·')", timeout=30000)
            status = worker.evaluate("async()=>SellerAgentsControlClient.status()")
            result["browserIdentityBeforeBootstrap"] = worker.evaluate("()=>SellerAgentsBrowserIdentity.current()")
            resolved = worker.evaluate("""async()=> {
              const payload=await SellerAgentsControlClient.bootstrap({
                detectedAi:{family:'chatgpt',surface:'web',variant:null}
              });
              return {
                aiStatus: payload?.ai?.status || null,
                profileContract: payload?.ai?.profile?.compatibility?.contractVersion || null,
                profileFamilies: payload?.ai?.profile?.compatibility?.browserFamilies || [],
                canWork: await SellerAgentsControlClient.canWork(),
                browser: SellerAgentsBrowserIdentity.current()
              };
            }""")
            assert status.get("authenticated") is True
            assert resolved["canWork"] is True
            assert resolved["aiStatus"] == "RESOLVED"
            assert resolved["profileContract"] == "control_plane_v2"
            assert "opera" in resolved["profileFamilies"]
            assert resolved["browser"].get("family") == "opera"
            opera_rows = json.loads(network_evidence.read_text()) if network_evidence.exists() else []
            opera_bootstrap = [row for row in opera_rows if row["path"] == "/v1/bootstrap"]
            expected_identified_keys = [
                "browser", "contractVersion", "detectedAi", "deviceId",
                "extensionVersion", "lastConfigVersion",
            ]
            if not opera_bootstrap or opera_bootstrap[-1].get("bodyKeys") != expected_identified_keys:
                raise RuntimeError("OPERA_BOOTSTRAP_REQUEST_SHAPE_MISMATCH")
            result.update({
                "status": "PASS",
                "stage": "complete",
                "browserVersion": ctx.browser.version,
                "controlStatus": {
                    "authenticated": status.get("authenticated"),
                    "lastError": (status.get("lastError") or {}).get("code") if isinstance(status.get("lastError"), dict) else None,
                },
                "resolvedBootstrap": resolved,
            })
        except Exception as error:
            result["errorType"] = type(error).__name__
            result["bootstrapResponseMeta"] = bootstrap_meta
            try:
                status = worker.evaluate("async()=>SellerAgentsControlClient.status()")
                result["safeErrorCode"] = str((status.get("lastError") or {}).get("code") or "")
            except Exception:
                result["safeErrorCode"] = "DIAGNOSTIC_UNAVAILABLE"
        finally:
            ctx.close()
    return result
def ff_async(driver, script: str, *args):
    return driver.execute_async_script(script, *args)


def ff_permissions(driver):
    return ff_async(driver, """
      const done=arguments[arguments.length-1];
      browser.permissions.getAll().then(x=>done(x.data_collection||[]),e=>done({error:String(e)}));
    """)


def require_permission_list(value, phase: str):
    if not isinstance(value, list):
        raise RuntimeError(f"PERMISSION_QUERY_FAILED_{phase.upper()}")
    return value


def ff_technical_absent(driver):
    value = ff_permissions(driver)
    return isinstance(value, list) and TECH not in value


def ff_technical_present(driver):
    value = ff_permissions(driver)
    return isinstance(value, list) and TECH in value


def bootstrap_body_keys(network_evidence: Path):
    rows = json.loads(network_evidence.read_text()) if network_evidence.exists() else []
    return [row.get("bodyKeys") for row in rows if row.get("path") == "/v1/bootstrap"]


def ff_click_prompt(driver, wait, selector: str):
    with driver.context(driver.CONTEXT_CHROME):
        wait.until(lambda d: d.find_element(By.CSS_SELECTOR, selector).is_displayed())
        ok = driver.execute_script(
            "const n=document.querySelector(arguments[0]); if(!n) return false; n.click(); return true;",
            selector,
        )
        if not ok:
            raise RuntimeError("PERMISSION_PROMPT_CLICK_FAILED")


def ff_rpc(driver, payload):
    return ff_async(driver, """
      const payload=arguments[0],done=arguments[arguments.length-1];
      browser.runtime.sendMessage(payload).then(v=>done({ok:true,value:v}),e=>done({ok:false,error:String(e)}));
    """, payload)


def ff_status(driver):
    return ff_async(driver, """
      const done=arguments[arguments.length-1];
      browser.runtime.getBackgroundPage().then(bg=>bg.SellerAgentsControlClient.status())
        .then(v=>done({authenticated:v?.authenticated===true,
                       workAllowed:v?.workAllowed===true,
                       lastError:String(v?.lastError?.code||'')}),
              e=>done({authenticated:false,workAllowed:false,lastError:String(e?.code||e?.message||'UNAVAILABLE')}));
    """)


def ff_metadata_clear_acknowledged(driver):
    return ff_async(driver, """
      const done=arguments[arguments.length-1];
      browser.storage.local.get('seller_agents_metadata_clear_receipt_v1')
        .then(v=>done(v?.seller_agents_metadata_clear_receipt_v1?.version==='client_metadata_cleared_v1'),
              ()=>done(false));
    """)


def ff_bootstrap(driver):
    return ff_async(driver, """
      const done=arguments[arguments.length-1];
      browser.runtime.getBackgroundPage().then(bg=>
        bg.SellerAgentsControlClient.bootstrap({detectedAi:{family:'chatgpt',surface:'web',variant:null}})
      ).then(v=>done({ok:true,aiStatus:v?.ai?.status||null,
                     profileContract:v?.ai?.profile?.compatibility?.contractVersion||null,
                     profileFamilies:v?.ai?.profile?.compatibility?.browserFamilies||[]}),
              e=>done({ok:false,code:String(e?.code||e?.message||'UNAVAILABLE')}))
       .catch(e=>done({ok:false,code:String(e?.code||e?.message||'UNAVAILABLE')}));
    """)
def activate_firefox(driver, wait, popup_url: str, email: str):
    popup_handle = driver.current_window_handle
    before = set(driver.window_handles)
    driver.find_element(By.ID, "auth-start").click()
    wait.until(lambda d: len(d.window_handles) > len(before))
    portal_handle = next(h for h in driver.window_handles if h not in before)
    driver.switch_to.window(portal_handle)
    wait.until(lambda d: "/login?returnTo=" in d.current_url)
    driver.find_element(By.CSS_SELECTOR, 'input[type="email"]').send_keys(email)
    driver.find_element(By.XPATH, "//button[normalize-space()='Send code']").click()
    wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, 'input[inputmode="numeric"]'))
    driver.find_element(By.CSS_SELECTOR, 'input[inputmode="numeric"]').send_keys("424242")
    driver.find_element(By.XPATH, "//button[normalize-space()='Verify']").click()
    wait.until(lambda d: "/activate?authorizationId=" in d.current_url)
    select = Select(driver.find_element(By.TAG_NAME, "select"))
    active = next((o for o in select.options if o.get_attribute("value") and o.is_enabled()), None)
    if active is None:
        raise RuntimeError("NO_ACTIVE_ACCOUNT_OPTION")
    active_value = active.get_attribute("value")
    driver.switch_to.window(popup_handle)
    code_text = wait.until(lambda d: (
        d.find_element(By.ID, "auth-code").text
        if re.search(r"[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}",
                     d.find_element(By.ID, "auth-code").text or "") else False
    ))
    code = re.search(r"([ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4})", code_text).group(1)
    driver.switch_to.window(portal_handle)
    Select(driver.find_element(By.TAG_NAME, "select")).select_by_value(active_value)
    driver.find_element(By.XPATH, "//label[contains(.,'User code')]//input").send_keys(code)
    driver.find_element(By.XPATH, "//button[normalize-space()='Approve']").click()
    wait.until(lambda d: "Device approved" in d.find_element(By.CSS_SELECTOR, '[role="status"]').text)
    driver.switch_to.window(popup_handle)
    driver.get(popup_url)
    wait.until(lambda d: ff_status(d).get("authenticated") is True)
    return popup_handle
def firefox_case(addon: Path, email: str, network_evidence: Path) -> dict:
    result = {"status": "FAIL", "browser": "firefox", "stages": {}}
    options = Options()
    options.binary_location = FIREFOX
    options.add_argument("-headless")
    driver = webdriver.Firefox(
        options=options,
        service=Service(executable_path=GECKO, service_args=["--allow-system-access"]),
    )
    wait = WebDriverWait(driver, 30)
    try:
        result["browserVersion"] = driver.capabilities.get("browserVersion")
        addon_id = driver.install_addon(str(addon), temporary=True)
        if addon_id != "seller-agents@example.test":
            raise RuntimeError("UNEXPECTED_ADDON_ID")
        with driver.context(driver.CONTEXT_CHROME):
            popup_url = driver.execute_script(
                "const p=WebExtensionPolicy.getByID('seller-agents@example.test');"
                "if(!p) throw new Error('policy'); return p.getURL('popup.html');"
            )
        driver.get(popup_url)
        wait.until(lambda d: d.find_element(By.ID, "firefox-technical-consent").is_displayed())
        initial_permissions = require_permission_list(ff_permissions(driver), "initial")
        result["stages"]["initialPermissions"] = initial_permissions
        if TECH in initial_permissions:
            raise RuntimeError("TECH_PERMISSION_UNEXPECTEDLY_PRESENT")

        # Real deny doorhanger.
        driver.find_element(By.ID, "firefox-technical-grant").click()
        time.sleep(0.4)
        ff_click_prompt(driver, wait, ".popup-notification-secondary-button")
        wait.until(ff_technical_absent)
        denied_permissions = require_permission_list(ff_permissions(driver), "denied")
        result["stages"]["deniedPermissions"] = denied_permissions
        if TECH in denied_permissions:
            raise RuntimeError("TECH_PERMISSION_DENY_FAILED")

        result["stages"]["activation"] = "STARTED"
        activate_firefox(driver, wait, popup_url, email)
        neutral = ff_bootstrap(driver)
        result["stages"]["denyNeutralBootstrap"] = neutral
        neutral_keys = bootstrap_body_keys(network_evidence)
        expected_neutral_keys = ["contractVersion", "detectedAi", "deviceId", "lastConfigVersion"]
        if not neutral_keys or neutral_keys[-1] != expected_neutral_keys:
            raise RuntimeError("DENY_BOOTSTRAP_REQUEST_NOT_NEUTRAL")
        # Real grant doorhanger, then identified bootstrap.
        wait.until(lambda d: d.find_element(By.ID, "firefox-technical-grant").is_displayed())
        driver.find_element(By.ID, "firefox-technical-grant").click()
        time.sleep(0.4)
        ff_click_prompt(driver, wait, ".popup-notification-primary-button")
        wait.until(ff_technical_present)
        granted_permissions = require_permission_list(ff_permissions(driver), "granted")
        result["stages"]["grantedPermissions"] = granted_permissions
        if TECH not in granted_permissions:
            raise RuntimeError("TECH_PERMISSION_GRANT_FAILED")
        granted = ff_bootstrap(driver)
        result["stages"]["grantIdentifiedBootstrap"] = granted
        grant_keys = bootstrap_body_keys(network_evidence)
        expected_identified_keys = [
            "browser", "contractVersion", "detectedAi", "deviceId",
            "extensionVersion", "lastConfigVersion",
        ]
        if not grant_keys or grant_keys[-1] != expected_identified_keys:
            raise RuntimeError("GRANT_BOOTSTRAP_REQUEST_NOT_IDENTIFIED")

        # Real revoke, then neutral bootstrap again.
        wait.until(lambda d: d.find_element(By.ID, "firefox-technical-revoke").is_displayed())
        driver.find_element(By.ID, "firefox-technical-revoke").click()
        wait.until(ff_technical_absent)
        revoked_permissions = require_permission_list(ff_permissions(driver), "revoked")
        result["stages"]["revokedPermissions"] = revoked_permissions
        if TECH in revoked_permissions:
            raise RuntimeError("TECH_PERMISSION_REVOKE_FAILED")
        revoked = ff_bootstrap(driver)
        result["stages"]["revokeNeutralBootstrap"] = revoked
        revoke_keys = bootstrap_body_keys(network_evidence)
        if not revoke_keys or revoke_keys[-1] != expected_neutral_keys:
            raise RuntimeError("REVOKE_BOOTSTRAP_REQUEST_NOT_NEUTRAL")
        wait.until(ff_metadata_clear_acknowledged)
        result["stages"]["revokeMetadataClearAcknowledged"] = True

        before = json.loads(network_evidence.read_text()) if network_evidence.exists() else []
        before_forget = sum(1 for row in before if row["path"].endswith("/v1/devices/current/client-metadata/forget"))
        health_results = []
        for _ in range(5):
            health_results.append(ff_async(driver, """
              const done=arguments[arguments.length-1];
              browser.runtime.getBackgroundPage()
                .then(bg=>bg.SellerAgentsControlClient.acquireSignedHealthAuthority({
                  detectedAi:{family:'chatgpt',surface:'web',variant:null}
                }))
                .then(v=>done({ok:true,isNull:v===null}))
                .catch(e=>done({ok:false,code:String(e?.code||e?.message||'UNAVAILABLE')}));
            """))
        time.sleep(0.5)
        after = json.loads(network_evidence.read_text()) if network_evidence.exists() else []
        after_forget = sum(1 for row in after if row["path"].endswith("/v1/devices/current/client-metadata/forget"))
        result["stages"]["repeatedOptOutHealth"] = {
            "calls": len(health_results),
            "allNull": all(row.get("ok") and row.get("isNull") for row in health_results),
            "forgetDelta": after_forget - before_forget,
        }
        expected = [neutral, granted, revoked]
        if not all(row.get("ok") for row in expected):
            raise RuntimeError("RESOLVED_V2_BOOTSTRAP_REJECTED")
        if not all(row.get("aiStatus") == "RESOLVED" and row.get("profileContract") == "control_plane_v2" for row in expected):
            raise RuntimeError("RESOLVED_V2_PROFILE_MISMATCH")
        if not all("firefox" in row.get("profileFamilies", []) for row in expected):
            raise RuntimeError("FIREFOX_PROFILE_FAMILY_MISMATCH")
        if not result["stages"]["repeatedOptOutHealth"]["allNull"]:
            raise RuntimeError("OPT_OUT_HEALTH_NOT_LOCAL_NULL")
        if result["stages"]["repeatedOptOutHealth"]["forgetDelta"] != 0:
            raise RuntimeError("METADATA_FORGET_NOT_DEDUPED")
        result["status"] = "PASS"
    except Exception as error:
        result["errorType"] = type(error).__name__
        result["safeErrorCode"] = str(error) if re.fullmatch(r"[A-Z0-9_]+", str(error) or "") else "UNAVAILABLE"
    finally:
        try:
            driver.quit()
        except Exception:
            pass
    return result
def main(output: Path):
    if os.environ.get("PRODUCT_CONTROL_PLANE_E2E") != "1":
        raise RuntimeError("PRODUCT_CONTROL_PLANE_E2E=1 required")
    if not os.environ.get("DATABASE_URL"):
        raise RuntimeError("disposable DATABASE_URL required")
    output.mkdir(parents=True, exist_ok=False)
    namespace = uuid.uuid4().hex
    trust = output / "public-trust-bundle.json"
    fixture_evidence = output / "fixture-evidence.json"
    network_evidence = output / "safe-network-evidence.json"
    private_placeholder = output / "unused-private-key.der"
    common = output / "common"
    firefox_runtime = output / "firefox-runtime"
    env = {
        **os.environ,
        "PRODUCT_CONTROL_PLANE_E2E": "1",
        "SA_I1_API_PORT": API_PORT,
        "SA_I1_PORTAL_PORT": PORTAL_PORT,
        "SA_I1_FIXTURE_NAMESPACE": namespace,
        "SA_I1_PUBLIC_TRUST_BUNDLE_PATH": str(trust),
        "SA_I1_FIXTURE_EVIDENCE_PATH": str(fixture_evidence),
        "SA_I1_NETWORK_EVIDENCE_PATH": str(network_evidence),
        "SA_I1_PROFILE_CONTRACT_VERSION": "control_plane_v2",
        "SA_I1_PROFILE_BROWSER_FAMILIES": "opera,firefox",
        "SA_I1_FORCE_BETA_BOOTSTRAP": "1",
        "SA_I1_ENABLE_LOCAL_CLIENT_AUTHORITY": "1",
        "SA_I1_REDACT_FIXTURE_IDENTITIES": "1",
    }
    processes = []
    logs = []
    product_head = subprocess.check_output(["git", "-C", str(PRODUCT_ROOT), "rev-parse", "HEAD"], text=True).strip()
    result = {
        "status": "FAIL",
        "acceptanceClass": "REAL_BROWSER_DISPOSABLE_API",
        "liveProviderCalls": 0,
        "productHead": product_head,
        "productRoot": str(PRODUCT_ROOT),
    }
    try:
        run_checked([PNPM, "db:migrate"], env=env)
        api_log = (output / "api.log").open("w", encoding="utf-8")
        logs.append(api_log)
        api = subprocess.Popen(
            [PNPM, "--filter", "@product/api", "exec", "tsx",
             "../../tests/regression/extension-core/client-i1/api-harness.ts"],
            cwd=ROOT, env=env, stdout=api_log, stderr=subprocess.STDOUT, text=True,
        )
        processes.append(api)
        wait_http(f"http://127.0.0.1:{API_PORT}/health/ready")
        evidence = json.loads(fixture_evidence.read_text())
        if evidence.get("profile_contract_version") != "control_plane_v2":
            raise RuntimeError("FIXTURE_PROFILE_CONTRACT_MISMATCH")
        if evidence.get("profile_browser_families") != ["opera", "firefox"]:
            raise RuntimeError("FIXTURE_PROFILE_BROWSER_MISMATCH")
        config = subprocess.check_output(
            [NODE, str(ROOT / "tests/regression/extension-core/client-i1/make-browser-config.mjs"),
             str(private_placeholder), str(trust)],
            cwd=ROOT, env=env, text=True,
        )
        build_env = {**env, "SA_PACKAGED_CONFIG_JSON": config}
        run_checked(
            ["python3", "tooling/build/extension_composed.py", "--output", str(common)],
            cwd=PRODUCT_ROOT, env=build_env,
        )
        run_checked([
            "python3", "tooling/build/extension_firefox.py",
            "--input-runtime", str(common / "runtime"), "--output", str(firefox_runtime),
        ], cwd=PRODUCT_ROOT, env=env)
        firefox_zip = output / "SELLER_AGENTS_I1_C1_v0.2.4_FIREFOX_LOCAL_DEVELOPMENT.zip"
        if not firefox_zip.is_file():
            raise RuntimeError("FIREFOX_PACKAGE_MISSING")

        portal_log = (output / "portal.log").open("w", encoding="utf-8")
        logs.append(portal_log)
        portal_env = {**env, "CONTROL_PLANE_API_ORIGIN": f"http://127.0.0.1:{API_PORT}"}
        portal = subprocess.Popen(
            [PNPM, "--filter", "@product/portal", "exec", "next", "dev",
             "--hostname", "127.0.0.1", "--port", PORTAL_PORT],
            cwd=ROOT, env=portal_env, stdout=portal_log, stderr=subprocess.STDOUT, text=True,
        )
        processes.append(portal)
        wait_http(f"http://127.0.0.1:{PORTAL_PORT}/login")

        selected = os.environ.get("SA_PARITY_BROWSER", "all")
        if selected not in {"all", "opera", "firefox"}:
            raise RuntimeError("INVALID_PARITY_BROWSER")
        if selected in {"all", "opera"}:
            result["opera"] = opera_case(common / "runtime", fixture_email("one", namespace), network_evidence)
        if selected in {"all", "firefox"}:
            result["firefox"] = firefox_case(firefox_zip, fixture_email("two", namespace), network_evidence)
        result["fixture"] = {
            "profileContractVersion": evidence.get("profile_contract_version"),
            "profileBrowserFamilies": evidence.get("profile_browser_families"),
            "accountsPrepared": evidence.get("existing_fixture_accounts"),
            "betaUnchanged": evidence.get("beta_unchanged"),
        }
        safe_events = json.loads(network_evidence.read_text()) if network_evidence.exists() else []
        result["network"] = {
            "bootstrapStatuses": [row["status"] for row in safe_events if row["path"] == "/v1/bootstrap"],
            "bootstrapBodyKeys": [row["bodyKeys"] for row in safe_events if row["path"] == "/v1/bootstrap"],
            "forgetCount": sum(1 for row in safe_events if row["path"] == "/v1/devices/current/client-metadata/forget"),
        }
        expected = [result[name]["status"] for name in ("opera", "firefox") if name in result]
        result["status"] = "PASS" if expected and all(status == "PASS" for status in expected) else "FAIL"
    finally:
        for process in reversed(processes):
            if process.poll() is None:
                process.terminate()
        for process in reversed(processes):
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        for handle in logs:
            try:
                handle.close()
            except Exception:
                pass
        (output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result, ensure_ascii=False))
    raise SystemExit(0 if result["status"] == "PASS" else 1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    main(args.output.resolve())
