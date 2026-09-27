"""Installed Firefox Work smoke against an exact-origin, no-upstream fixture.

The extension is installed as a temporary add-on by GeckoDriver.  Firefox sends
HTTPS through a loopback CONNECT proxy, except for the caller-supplied loopback
API and portal origins.  The proxy answers ChatGPT and allowlisted provider
requests itself and has no upstream connection implementation.

The disposable API and portal must already be running on loopback, and the
carrier must be configured to use those origins. Use the parent heavy runner;
this command starts Firefox and a proxy thread in its supervised process group.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import socketserver
import ssl
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.support.ui import Select, WebDriverWait

ROOT = Path(__file__).resolve().parents[4]
CHAT_FIXTURE = ROOT / "tests/regression/extension-core/fixtures/application-chat.html"
TECHNICAL_PERMISSION = "technicalAndInteraction"
WB_CONVERSATION = "44444444-4444-4444-8444-444444444444"
OZON_CONVERSATION = "55555555-5555-4555-8555-555555555555"
PROVIDER_HOSTS = {
    "api-seller.ozon.ru", "api-performance.ozon.ru",
    "content-api.wildberries.ru", "statistics-api.wildberries.ru",
    "marketplace-api.wildberries.ru", "common-api.wildberries.ru",
}
SAFE_PATH = re.compile(r"^/[A-Za-z0-9_./{}-]{0,180}$")


def make_ca(directory: Path):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Octoport ephemeral Firefox fixture CA")])
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
            .public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=1))
            .not_valid_after(dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=1))
            .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
            .add_extension(x509.KeyUsage(digital_signature=True, content_commitment=False,
                                        key_encipherment=False, data_encipherment=False,
                                        key_agreement=False, key_cert_sign=True,
                                        crl_sign=False, encipher_only=False,
                                        decipher_only=False), critical=True)
            .sign(key, hashes.SHA256()))
    cert_path, key_path = directory / "fixture-ca.pem", directory / "fixture-ca-key.pem"
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM,
                                           serialization.PrivateFormat.TraditionalOpenSSL,
                                           serialization.NoEncryption()))
    os.chmod(key_path, 0o600)
    return key, cert, cert_path


def make_leaf(host: str, ca_key, ca_cert, directory: Path):
    safe = hashlib.sha256(host.encode()).hexdigest()[:16]
    cert_path, key_path = directory / f"leaf-{safe}.pem", directory / f"leaf-{safe}-key.pem"
    if cert_path.exists():
        return cert_path, key_path
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, host)])
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(ca_cert.subject)
            .public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=1))
            .not_valid_after(dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=12))
            .add_extension(x509.SubjectAlternativeName([x509.DNSName(host)]), critical=False)
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .sign(ca_key, hashes.SHA256()))
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM,
                                           serialization.PrivateFormat.TraditionalOpenSSL,
                                           serialization.NoEncryption()))
    os.chmod(key_path, 0o600)
    return cert_path, key_path


class FixtureState:
    def __init__(self, work_dir: Path):
        self.fixture = CHAT_FIXTURE.read_bytes()
        self.ca_key, self.ca_cert, self.ca_path = make_ca(work_dir)
        self.work_dir = work_dir
        self.lock = threading.Lock()
        self.rows: list[dict] = []
        self.denied_connects = 0
        self.denied_hosts: dict[str, int] = {}
        self.tls_contexts = {}

    def tls_context(self, host: str):
        if host not in self.tls_contexts:
            cert, key = make_leaf(host, self.ca_key, self.ca_cert, self.work_dir)
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(str(cert), str(key))
            self.tls_contexts[host] = context
        return self.tls_contexts[host]

    def record(self, host: str, method: str, path: str, status: int):
        with self.lock:
            self.rows.append({"host": host, "method": method,
                              "path": path if SAFE_PATH.fullmatch(path) else "/<redacted>",
                              "status": status})


class ProxyHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        return

    def do_CONNECT(self):
        host = self.path.rsplit(":", 1)[0].lower().strip("[]")
        if host != "chatgpt.com" and host not in PROVIDER_HOSTS:
            with self.server.state.lock:
                self.server.state.denied_connects += 1
                self.server.state.denied_hosts[host] = self.server.state.denied_hosts.get(host, 0) + 1
            self.send_error(502)
            return
        self.send_response(200, "Connection Established")
        self.end_headers()
        try:
            tls = self.server.state.tls_context(host).wrap_socket(self.connection, server_side=True)
            self._serve_tls(tls, host)
        except (OSError, ssl.SSLError):
            pass

    def do_GET(self):
        # Plain HTTP egress is blocked too; only the caller's 127.0.0.1 bypass
        # reaches the disposable control plane and portal.
        with self.server.state.lock:
            self.server.state.denied_connects += 1
            self.server.state.denied_hosts["<plain-http>"] = self.server.state.denied_hosts.get("<plain-http>", 0) + 1
        self.send_error(502)

    def _serve_tls(self, tls, host):
        tls.settimeout(15)
        stream = tls.makefile("rb")
        while True:
            line = stream.readline(8192)
            if not line:
                break
            try:
                method, target, _version = line.decode("ascii").strip().split(" ", 2)
            except Exception:
                break
            headers = {}
            total = len(line)
            while True:
                header = stream.readline(8192)
                total += len(header)
                if not header or header in (b"\r\n", b"\n"):
                    break
                if total > 32768:
                    return
                if b":" in header:
                    key, value = header.decode("latin1").split(":", 1)
                    headers[key.strip().lower()] = value.strip()
            length = min(int(headers.get("content-length", "0") or 0), 1_000_000)
            if length:
                stream.read(length)
            parsed = urlparse(target)
            path = parsed.path or "/"
            if host == "chatgpt.com":
                if method == "GET" and path.startswith("/c/"):
                    body, content_type, status = self.server.state.fixture, "text/html; charset=utf-8", 200
                else:
                    body, content_type, status = b"", "text/plain", 204
            else:
                body, content_type, status = json.dumps({
                    "data": {"name": "Synthetic seller", "id": "fixture-seller"},
                    "result": {"name": "Synthetic seller", "id": "fixture-seller"},
                }).encode(), "application/json", 200
            self.server.state.record(host, method, path, status)
            response = (f"HTTP/1.1 {status} {'OK' if status == 200 else 'No Content'}\r\n"
                        f"Content-Type: {content_type}\r\nContent-Length: {len(body)}\r\n"
                        "Cache-Control: no-store\r\nConnection: keep-alive\r\n\r\n").encode() + body
            tls.sendall(response)
            if headers.get("connection", "").lower() == "close":
                break
        try:
            tls.close()
        except OSError:
            pass


class NoUpstreamProxy(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, address, state):
        self.state = state
        super().__init__(address, ProxyHandler)


def install_fixture_ca(profile: Path, state: FixtureState, certutil: Path | None):
    """Trust only the ephemeral fixture CA in this disposable Firefox profile."""
    certutil = str(certutil) if certutil else shutil.which("certutil")
    if not certutil:
        raise RuntimeError("NSS_CERTUTIL_REQUIRED_FOR_SCOPED_FIXTURE_CA_TRUST")
    subprocess.run([certutil, "-N", "--empty-password", "-d", f"sql:{profile}"],
                   check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    subprocess.run([certutil, "-A", "-n", "Octoport ephemeral Firefox fixture CA",
                    "-t", "C,,", "-i", str(state.ca_path), "-d", f"sql:{profile}"],
                   check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)


def wait_until(fn, timeout=30):
    return _wait(fn, timeout)


def action_count(driver):
    return driver.execute_script(
        "return document.querySelector('#ozon-bridge-own-button-host')?.shadowRoot?.querySelectorAll('.ozon-bridge-block-action').length||0"
    )


def action_text(driver):
    return driver.execute_script(
        "return document.querySelector('#ozon-bridge-own-button-host')?.shadowRoot?.querySelector('.ozon-bridge-block-action')?.textContent||''"
    )


def click_action(driver):
    return driver.execute_script(
        """
        const button=document.querySelector('#ozon-bridge-own-button-host')?.shadowRoot?.querySelector('.ozon-bridge-block-action');
        if(!button) return false;
        button.click();
        return true;
        """
    )


def manual_operation_status(driver, operation):
    return driver.execute_async_script(
        """
        const operation=arguments[0],done=arguments[arguments.length-1];
        browser.storage.local.get('ozmb_manual_operations').then(storage=>{
          const rows=Object.values(storage.ozmb_manual_operations||{});
          const row=rows.find(item=>item?.last_operation===operation);
          done(row?.status||null);
        },()=>done(null));
        """,
        operation,
    )


def _wait(fn, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = fn()
        if value:
            return value
        time.sleep(0.1)
    raise RuntimeError("WAIT_TIMEOUT")


def activate(driver, wait, popup_url, email):
    popup = driver.current_window_handle
    existing = set(driver.window_handles)
    driver.find_element(By.ID, "auth-start").click()
    wait.until(lambda d: len(d.window_handles) > len(existing))
    portal = next(handle for handle in driver.window_handles if handle not in existing)
    driver.switch_to.window(portal)
    wait.until(lambda d: "/login?returnTo=" in d.current_url)
    driver.find_element(By.CSS_SELECTOR, 'input[type="email"]').send_keys(email)
    driver.find_element(By.XPATH, "//button[normalize-space()='Send code']").click()
    wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, 'input[inputmode="numeric"]'))
    driver.find_element(By.CSS_SELECTOR, 'input[inputmode="numeric"]').send_keys("424242")
    driver.find_element(By.XPATH, "//button[normalize-space()='Verify']").click()
    wait.until(lambda d: "/activate?authorizationId=" in d.current_url)
    options = Select(driver.find_element(By.TAG_NAME, "select"))
    active = next((item for item in options.options if item.get_attribute("value") and item.is_enabled()), None)
    if active is None:
        raise RuntimeError("NO_DISPOSABLE_ACCOUNT")
    account_value = active.get_attribute("value")
    driver.switch_to.window(popup)
    code_text = wait.until(lambda d: d.find_element(By.ID, "auth-code").text if re.search(
        r"[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}",
        d.find_element(By.ID, "auth-code").text or "") else False)
    code = re.search(r"([ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4})", code_text).group(1)
    driver.switch_to.window(portal)
    Select(driver.find_element(By.TAG_NAME, "select")).select_by_value(account_value)
    driver.find_element(By.XPATH, "//label[contains(.,'User code')]//input").send_keys(code)
    driver.find_element(By.XPATH, "//button[normalize-space()='Approve']").click()
    driver.switch_to.window(popup)
    driver.get(popup_url)
    deadline = time.monotonic() + 30
    last_status = {}
    while time.monotonic() < deadline:
        last_status = driver.execute_async_script(
            """
            const done=arguments[arguments.length-1];
            browser.runtime.getBackgroundPage()
              .then(bg=>bg.SellerAgentsControlClient.status())
              .then(v=>done({
                authenticated:v?.authenticated===true,
                workAllowed:v?.workAllowed===true,
                lastError:String(v?.lastError?.code||'')
              }),e=>done({authenticated:false,workAllowed:false,lastError:String(e?.code||e?.message||'UNAVAILABLE')}));
            """
        )
        if last_status.get("authenticated") is True:
            break
        time.sleep(0.15)
    else:
        code = re.sub(r"[^A-Z0-9_]", "_", str(last_status.get("lastError") or "UNAVAILABLE").upper())[:60]
        raise RuntimeError("AUTH_BACKGROUND_NOT_READY_" + (code or "UNAVAILABLE"))
    wait.until(lambda d: d.find_element(By.ID, "catalog").is_displayed())


def run(args):
    if not args.carrier.is_file() or not args.carrier.name.lower().endswith(".zip"):
        raise RuntimeError("CARRIER_MUST_BE_GENERATED_FIREFOX_ZIP")
    certutil = args.certutil or (Path(shutil.which("certutil")) if shutil.which("certutil") else None)
    if certutil is None or not certutil.is_file():
        raise RuntimeError("NSS_CERTUTIL_REQUIRED_FOR_SCOPED_FIXTURE_CA_TRUST")
    args.certutil = certutil
    for label, value in (("api", args.api_origin), ("portal", args.portal_origin)):
        parsed = urlparse(value)
        if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"}:
            raise RuntimeError(f"{label.upper()}_MUST_BE_LOOPBACK_HTTP")
    args.output.mkdir(parents=True, exist_ok=False)
    result = {"status": "FAIL", "acceptanceClass": "INSTALLED_SYNTHETIC_FIREFOX",
              "browserRequirement": "155.0.1", "liveProviderCalls": 0,
              "upstreamConnections": 0, "technicalPermissionMode": "neutral"}
    state = None
    proxy = None
    thread = None
    driver = None
    popup_handle = None
    chat_handle = None
    stage = "setup"
    try:
        with tempfile.TemporaryDirectory(prefix="octoport-firefox-fixture-") as temporary:
            temp = Path(temporary)
            state = FixtureState(temp)
            proxy = NoUpstreamProxy(("127.0.0.1", 0), state)
            thread = threading.Thread(target=proxy.serve_forever, name="firefox-fixture-proxy", daemon=True)
            thread.start()
            profile_path = temp / "profile"
            profile_path.mkdir()
            install_fixture_ca(profile_path, state, args.certutil)
            options = Options()
            options.binary_location = str(args.firefox)
            options.add_argument("-headless")
            options.profile = webdriver.FirefoxProfile(str(profile_path))
            options.set_preference("network.proxy.type", 1)
            options.set_preference("network.proxy.ssl", "127.0.0.1")
            options.set_preference("network.proxy.ssl_port", proxy.server_address[1])
            options.set_preference("network.proxy.no_proxies_on", "127.0.0.1,localhost")
            options.set_preference("network.trr.mode", 5)
            driver = webdriver.Firefox(options=options, service=Service(
                executable_path=str(args.geckodriver), service_args=["--allow-system-access"]))
            version = driver.capabilities.get("browserVersion")
            result["browserVersion"] = version
            if version != "155.0.1":
                raise RuntimeError("FIREFOX_VERSION_MISMATCH")
            addon_id = driver.install_addon(str(args.carrier), temporary=True)
            if addon_id != "seller-agents@example.test":
                raise RuntimeError("ADDON_ID_MISMATCH")
            with driver.context(driver.CONTEXT_CHROME):
                popup_url = driver.execute_script(
                    "const p=WebExtensionPolicy.getByID('seller-agents@example.test');"
                    "if(!p) throw new Error('policy missing'); return p.getURL('popup.html');")
            driver.get(popup_url)
            wait = WebDriverWait(driver, 30)
            wait.until(lambda d: d.find_element(By.ID, "auth-start").is_displayed())
            permissions = driver.execute_async_script(
                "const done=arguments[arguments.length-1];browser.permissions.getAll().then(x=>done(x.data_collection||[]),()=>done(null));")
            if not isinstance(permissions, list):
                raise RuntimeError("PERMISSION_QUERY_FAILED")
            if TECHNICAL_PERMISSION in permissions:
                raise RuntimeError("OPTIONAL_TECH_PERMISSION_PREGRANTED")
            if args.allow_technical:
                driver.find_element(By.ID, "firefox-technical-grant").click()
                time.sleep(0.4)
                with driver.context(driver.CONTEXT_CHROME):
                    wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, ".popup-notification-primary-button"))
                    driver.find_element(By.CSS_SELECTOR, ".popup-notification-primary-button").click()
                wait.until(lambda d: TECHNICAL_PERMISSION in driver.execute_async_script(
                    "const done=arguments[arguments.length-1];browser.permissions.getAll().then(x=>done(x.data_collection||[]));"))
                result["technicalPermissionMode"] = "explicit_firefox_doorhanger_allow"

            stage = "activation"
            namespace = re.sub(r"[^a-z0-9]", "", args.namespace.lower())[:24] or "firefox"
            email = args.email or f"q1a-{namespace}-firefox@example.test"
            if not re.fullmatch(r"[A-Za-z0-9._+-]+@example\.test", email):
                raise RuntimeError("FIXTURE_EMAIL_INVALID")
            activate(driver, wait, popup_url, email)
            popup_handle = driver.current_window_handle
            popup_tab_id = driver.execute_async_script(
                "const done=arguments[arguments.length-1];"
                "browser.tabs.getCurrent().then(t=>done(t?.id||null),()=>done(null));"
            )
            if not isinstance(popup_tab_id, int):
                raise RuntimeError("POPUP_TAB_ID_UNAVAILABLE")

            stage = "chat_fixture"
            driver.switch_to.new_window("tab")
            chat_handle = driver.current_window_handle
            driver.get(f"https://chatgpt.com/c/{WB_CONVERSATION}")
            wait.until(lambda d: d.execute_script("return location.hostname") == "chatgpt.com")
            if driver.execute_script("return location.origin") != "https://chatgpt.com":
                raise RuntimeError("CHATGPT_ORIGIN_MISMATCH")
            wait.until(lambda d: d.execute_script(
                "return typeof fixtureCurrentChatGPTBlock==='function' && Array.isArray(sent)"
            ))

            stage = "store_add"
            driver.switch_to.window(popup_handle)
            wait.until(lambda d: d.find_element(By.ID, "catalog").is_displayed())
            driver.find_element(By.ID, "wildberries").click()
            driver.find_element(By.ID, "add").click()
            driver.find_element(By.ID, "name").clear()
            driver.find_element(By.ID, "name").send_keys("Firefox synthetic WB")
            driver.find_element(By.ID, "token").send_keys("SYNTHETIC_WB_TOKEN_NEVER_VALID")
            provider_before_store = sum(row["host"] in PROVIDER_HOSTS for row in state.rows)
            driver.find_element(By.ID, "save").click()
            wait.until(lambda d: "Firefox synthetic WB" in d.find_element(By.ID, "stores").text)
            store_id = driver.find_element(By.ID, "stores").get_attribute("value")
            if not store_id:
                raise RuntimeError("STORE_ID_UNAVAILABLE")
            provider_after_store = sum(row["host"] in PROVIDER_HOSTS for row in state.rows)

            chat_tab_id = driver.execute_async_script(
                "const done=arguments[arguments.length-1];"
                "browser.tabs.query({url:'https://chatgpt.com/c/*'}).then(rows=>done(rows[0]?.id||null),()=>done(null));"
            )
            if not isinstance(chat_tab_id, int):
                raise RuntimeError("CHATGPT_TAB_ID_UNAVAILABLE")

            stage = "real_action_popup"
            # Firefox 149+ can open the real MV3 action popup without a user
            # gesture. Keep the genuine ChatGPT tab active and verify the browser
            # chrome hosts the actual extension popup; do not spoof tabs.query.
            action_popup = driver.execute_async_script(
                """
                const chatId=arguments[0],done=arguments[arguments.length-1];
                browser.tabs.update(chatId,{active:true}).then(()=>
                  browser.action.openPopup().then(async()=>{
                    const active=await browser.tabs.query({active:true,currentWindow:true});
                    done({ok:true,activeId:active[0]?.id||null});
                  },e=>done({ok:false,error:String(e)}))
                );
                """,
                chat_tab_id,
            )
            if not action_popup.get("ok") or action_popup.get("activeId") != chat_tab_id:
                raise RuntimeError("REAL_ACTION_POPUP_DID_NOT_KEEP_CHAT_ACTIVE")
            time.sleep(0.4)
            with driver.context(driver.CONTEXT_CHROME):
                action_current_uri = driver.execute_script(
                    "return document.querySelector('browser.webextension-popup-browser')?.currentURI?.spec||null"
                )
            if action_current_uri != popup_url:
                raise RuntimeError("REAL_ACTION_POPUP_URI_MISMATCH")
            result["realActionPopup"] = {
                "opened": True,
                "activeChatTabPreserved": True,
                "uriMatchesExtensionPopup": True,
            }

            # Return focus to the ordinary extension control page. Work itself is
            # started with the production privileged message and the exact real
            # ChatGPT tab id; this avoids turning popup.html into the target tab.
            driver.switch_to.window(popup_handle)
            driver.execute_async_script(
                "const id=arguments[0],done=arguments[arguments.length-1];"
                "browser.tabs.update(id,{active:true}).then(()=>done(true),()=>done(false));",
                popup_tab_id,
            )
            stage = "work_start"
            start = driver.execute_async_script(
                """
                const tabId=arguments[0],storeId=arguments[1],done=arguments[arguments.length-1];
                browser.runtime.sendMessage({
                  type:'SA_WORK_START',tab_id:tabId,store_id:storeId,
                  confirm_change:false,start_intent_id:'firefox-functional-r2'
                }).then(v=>done({ok:true,value:v}),e=>done({ok:false,code:String(e?.code||e?.message||e)}));
                """,
                chat_tab_id,
                store_id,
            )
            if not start.get("ok") or not start.get("value", {}).get("ok"):
                raise RuntimeError("WORK_START_REJECTED")

            driver.switch_to.window(chat_handle)
            wait.until(lambda d: d.execute_script("return sent.length>=1"))
            initial_sent = driver.execute_script("return sent.length")
            wait.until(lambda d: action_count(d) == 0)

            # Wait for correlation-safe Start to become ACTIVE_VISIBLE after the
            # fixture's first assistant response.
            driver.switch_to.window(popup_handle)
            stage = "work_start_correlation"
            session = driver.execute_async_script(
                """
                const done=arguments[arguments.length-1],deadline=Date.now()+30000;
                (async function poll(){
                  const state=(await browser.storage.local.get('ozmb_work_sessions_v1')).ozmb_work_sessions_v1||{};
                  const row=Object.values(state)[0];
                  if(row?.state==='active_visible') return done({ok:true,key:Object.keys(state)[0],row});
                  if(Date.now()>deadline) return done({ok:false,state:row?.state||null});
                  setTimeout(poll,100);
                })();
                """
            )
            if not session.get("ok"):
                raise RuntimeError("WORK_START_NOT_ACTIVE_VISIBLE")
            conversation_key = session["key"]

            driver.switch_to.window(chat_handle)
            stage = "command_inject"
            command = 'WB_API_V1 {"operation":"seller_info","params":{}}'
            driver.execute_script(
                "fixtureCurrentChatGPTBlock(arguments[0], 'assistant', 'firefox-functional-command')",
                command,
            )
            stage = "command_button_wait"
            wait.until(
                lambda d: action_count(d) == 1
                and action_text(d).strip().upper() in {"WB", "WILDBERRIES"}
            )
            provider_before_command = sum(row["host"] in PROVIDER_HOSTS for row in state.rows)
            stage = "command_click"
            if click_action(driver) is not True:
                raise RuntimeError("COMMAND_ACTION_CLICK_FAILED")
            stage = "command_result_wait"
            wait.until(lambda d: d.execute_script("return sent.length") == initial_sent + 1)
            delivered = driver.execute_script("return sent[sent.length-1]")
            if not delivered.startswith("WB_BATCH_RESULT_V1"):
                raise RuntimeError("RESULT_DELIVERY_MARKER_MISMATCH")
            stage = "command_provider_wait"
            wait.until(
                lambda _d: sum(row["host"] in PROVIDER_HOSTS for row in state.rows)
                == provider_before_command + 1
            )
            provider_after_command = sum(row["host"] in PROVIDER_HOSTS for row in state.rows)

            if action_count(driver):
                click_action(driver)
                time.sleep(0.5)
            provider_after_repeat = sum(row["host"] in PROVIDER_HOSTS for row in state.rows)
            if provider_after_repeat != provider_after_command:
                raise RuntimeError("PROVIDER_COMMAND_REPLAYED")
            if driver.execute_script("return sent.length") != initial_sent + 1:
                raise RuntimeError("AI_RESULT_REPLAYED")

            driver.switch_to.window(popup_handle)
            stage = "delivery_confirmed"
            wait.until(
                lambda d: manual_operation_status(d, "seller_info") == "completed"
            )
            stage = "finish"
            finished = driver.execute_async_script(
                """
                const tabId=arguments[0],key=arguments[1],done=arguments[arguments.length-1];
                browser.runtime.sendMessage({type:'OZ_WORK_FINISH',tab_id:tabId,conversation_key:key})
                  .then(v=>done({ok:true,value:v}),e=>done({ok:false,code:String(e?.code||e?.message||e)}));
                """,
                chat_tab_id,
                conversation_key,
            )
            if not finished.get("ok") or not finished.get("value", {}).get("ok"):
                raise RuntimeError("WORK_FINISH_REJECTED")
            driver.switch_to.window(chat_handle)
            wait.until(lambda d: action_count(d) == 0)
            wb_command_calls = provider_after_command - provider_before_command

            # Run a second, independent Ozon dialogue after the WB session is
            # explicitly finished. This proves the same real Firefox runtime
            # does not borrow marketplace or dialogue state across sessions.
            driver.close()
            driver.switch_to.window(popup_handle)
            stage = "ozon_store_add"
            driver.find_element(By.ID, "ozon").click()
            driver.find_element(By.ID, "add").click()
            driver.find_element(By.ID, "name").clear()
            driver.find_element(By.ID, "name").send_keys("Firefox synthetic Ozon")
            driver.find_element(By.ID, "seller-id").send_keys("100001")
            driver.find_element(By.ID, "seller-key").send_keys(
                "SYNTHETIC_OZON_KEY_NEVER_VALID"
            )
            provider_before_ozon_store = sum(
                row["host"] in PROVIDER_HOSTS for row in state.rows
            )
            driver.find_element(By.ID, "save").click()
            wait.until(
                lambda d: "Firefox synthetic Ozon"
                in d.find_element(By.ID, "stores").text
            )
            ozon_store_id = driver.find_element(By.ID, "stores").get_attribute("value")
            if not ozon_store_id:
                raise RuntimeError("OZON_STORE_ID_UNAVAILABLE")
            provider_after_ozon_store = sum(
                row["host"] in PROVIDER_HOSTS for row in state.rows
            )

            stage = "ozon_chat_fixture"
            driver.switch_to.new_window("tab")
            chat_handle = driver.current_window_handle
            driver.get(f"https://chatgpt.com/c/{OZON_CONVERSATION}")
            wait.until(
                lambda d: d.execute_script("return location.hostname") == "chatgpt.com"
            )
            if driver.execute_script("return location.origin") != "https://chatgpt.com":
                raise RuntimeError("OZON_CHATGPT_ORIGIN_MISMATCH")
            wait.until(
                lambda d: d.execute_script(
                    "return typeof fixtureCurrentChatGPTBlock==='function' && Array.isArray(sent)"
                )
            )

            driver.switch_to.window(popup_handle)
            ozon_tab_id = driver.execute_async_script(
                """
                const done=arguments[arguments.length-1];
                browser.tabs.query({url:'https://chatgpt.com/c/*'}).then(
                  rows=>done(rows.find(row=>row.url?.includes(arguments[0]))?.id||null),
                  ()=>done(null)
                );
                """,
                OZON_CONVERSATION,
            )
            if not isinstance(ozon_tab_id, int):
                raise RuntimeError("OZON_CHATGPT_TAB_ID_UNAVAILABLE")

            stage = "ozon_work_start"
            ozon_start = driver.execute_async_script(
                """
                const tabId=arguments[0],storeId=arguments[1],done=arguments[arguments.length-1];
                browser.runtime.sendMessage({
                  type:'SA_WORK_START',tab_id:tabId,store_id:storeId,
                  confirm_change:false,start_intent_id:'firefox-functional-r2-ozon'
                }).then(v=>done({ok:true,value:v}),e=>done({ok:false,code:String(e?.code||e?.message||e)}));
                """,
                ozon_tab_id,
                ozon_store_id,
            )
            if not ozon_start.get("ok") or not ozon_start.get("value", {}).get("ok"):
                raise RuntimeError("OZON_WORK_START_REJECTED")

            driver.switch_to.window(chat_handle)
            wait.until(lambda d: d.execute_script("return sent.length>=1"))
            ozon_initial_sent = driver.execute_script("return sent.length")
            wait.until(lambda d: action_count(d) == 0)

            driver.switch_to.window(popup_handle)
            stage = "ozon_work_start_correlation"
            ozon_session = driver.execute_async_script(
                """
                const tabId=arguments[0],done=arguments[arguments.length-1],deadline=Date.now()+30000;
                (async function poll(){
                  const state=(await browser.storage.local.get('ozmb_work_sessions_v1')).ozmb_work_sessions_v1||{};
                  const entry=Object.entries(state).find(([,row])=>row?.tab_id===tabId&&row?.state==='active_visible');
                  if(entry) return done({ok:true,key:entry[0],row:entry[1]});
                  if(Date.now()>deadline) {
                    const row=Object.values(state).find(row=>row?.tab_id===tabId);
                    return done({ok:false,state:row?.state||null});
                  }
                  setTimeout(poll,100);
                })();
                """,
                ozon_tab_id,
            )
            if not ozon_session.get("ok"):
                raise RuntimeError("OZON_WORK_START_NOT_ACTIVE_VISIBLE")
            ozon_conversation_key = ozon_session["key"]

            driver.switch_to.window(chat_handle)
            stage = "ozon_command_inject"
            ozon_command = 'OZON_API_V1 {"operation":"roles","params":{}}'
            driver.execute_script(
                "fixtureCurrentChatGPTBlock(arguments[0], 'assistant', 'firefox-functional-ozon-command')",
                ozon_command,
            )
            stage = "ozon_command_button_wait"
            wait.until(
                lambda d: action_count(d) == 1
                and action_text(d).strip().upper() == "OZON"
            )
            provider_before_ozon_command = sum(
                row["host"] in PROVIDER_HOSTS for row in state.rows
            )
            stage = "ozon_command_click"
            if click_action(driver) is not True:
                raise RuntimeError("OZON_COMMAND_ACTION_CLICK_FAILED")
            stage = "ozon_command_result_wait"
            wait.until(
                lambda d: d.execute_script("return sent.length")
                == ozon_initial_sent + 1
            )
            ozon_delivered = driver.execute_script("return sent[sent.length-1]")
            if not ozon_delivered.startswith("OZON_BATCH_RESULT_V1"):
                raise RuntimeError("OZON_RESULT_DELIVERY_MARKER_MISMATCH")
            stage = "ozon_command_provider_wait"
            wait.until(
                lambda _d: sum(row["host"] in PROVIDER_HOSTS for row in state.rows)
                == provider_before_ozon_command + 1
            )
            provider_after_ozon_command = sum(
                row["host"] in PROVIDER_HOSTS for row in state.rows
            )
            if action_count(driver):
                click_action(driver)
                time.sleep(0.5)
            provider_after_ozon_repeat = sum(
                row["host"] in PROVIDER_HOSTS for row in state.rows
            )
            if provider_after_ozon_repeat != provider_after_ozon_command:
                raise RuntimeError("OZON_PROVIDER_COMMAND_REPLAYED")
            if driver.execute_script("return sent.length") != ozon_initial_sent + 1:
                raise RuntimeError("OZON_AI_RESULT_REPLAYED")

            driver.switch_to.window(popup_handle)
            stage = "ozon_delivery_confirmed"
            wait.until(
                lambda d: manual_operation_status(d, "roles") == "completed"
            )
            stage = "ozon_finish"
            ozon_finished = driver.execute_async_script(
                """
                const tabId=arguments[0],key=arguments[1],done=arguments[arguments.length-1];
                browser.runtime.sendMessage({type:'OZ_WORK_FINISH',tab_id:tabId,conversation_key:key})
                  .then(v=>done({ok:true,value:v}),e=>done({ok:false,code:String(e?.code||e?.message||e)}));
                """,
                ozon_tab_id,
                ozon_conversation_key,
            )
            if not ozon_finished.get("ok") or not ozon_finished.get("value", {}).get("ok"):
                raise RuntimeError("OZON_WORK_FINISH_REJECTED")
            driver.switch_to.window(chat_handle)
            wait.until(lambda d: action_count(d) == 0)

            ozon_command_calls = provider_after_ozon_command - provider_before_ozon_command
            provider_rows = [row for row in state.rows if row["host"] in PROVIDER_HOSTS]
            result.update(
                status="PASS",
                addonId=addon_id,
                exactChatOrigin=True,
                authenticatedThroughDisposablePortal=True,
                storeAddedThroughPopup=True,
                workStarted=True,
                commandDetected=True,
                storeVerificationProviderCalls=provider_after_store-provider_before_store,
                commandProviderCalls=wb_command_calls,
                ozonStoreVerificationProviderCalls=provider_after_ozon_store-provider_before_ozon_store,
                ozonCommandProviderCalls=ozon_command_calls,
                resultDeliveredExactlyOnce=True,
                repeatedActionDidNotReplay=True,
                ozonResultDeliveredExactlyOnce=True,
                ozonRepeatedActionDidNotReplay=True,
                explicitFinish=True,
                ozonExplicitFinish=True,
                marketplaces=["wildberries", "ozon"],
                providerRequests=provider_rows,
                blockedExternalConnectAttempts=state.denied_connects,
                proxyUpstreamConnections=0,
            )
    except Exception as error:
        result["stage"] = stage
        result["errorCode"] = str(error) if re.fullmatch(r"[A-Z0-9_]+", str(error) or "") else type(error).__name__.upper()
        if driver is not None:
            try:
                if popup_handle in driver.window_handles:
                    driver.switch_to.window(popup_handle)
                    result["failureRuntime"] = driver.execute_async_script(
                        """
                        const done=arguments[arguments.length-1];
                        Promise.all([
                          browser.runtime.getBackgroundPage().then(bg=>bg.SellerAgentsControlClient.status()),
                          browser.storage.local.get(['ozmb_work_sessions_v1','ozmb_manual_operations','ozmb_pending_work_starts_v1'])
                        ]).then(([status,storage])=>done({
                          authenticated:status?.authenticated===true,
                          workAllowed:status?.workAllowed===true,
                          controlError:String(status?.lastError?.code||''),
                          sessions:Object.values(storage.ozmb_work_sessions_v1||{}).map(r=>({state:r?.state||null,revision:r?.revision||null})),
                          manual:Object.values(storage.ozmb_manual_operations||{}).map(r=>({status:r?.status||null,lastOperation:r?.last_operation||null,error:String(r?.last_error?.code||'')})),
                          pendingCount:Object.keys(storage.ozmb_pending_work_starts_v1||{}).length
                        }),()=>done({diagnosticError:true}));
                        """
                    )
                if chat_handle in driver.window_handles:
                    driver.switch_to.window(chat_handle)
                    result["failureChat"] = {
                        "actionCount": action_count(driver),
                        "actionText": action_text(driver),
                        "sentCount": driver.execute_script("return Array.isArray(sent)?sent.length:null"),
                    }
            except Exception:
                result["failureDiagnosticUnavailable"] = True
    finally:
        if driver is not None:
            try:
                driver.quit()
            except Exception:
                pass
        if proxy is not None:
            proxy.shutdown()
            proxy.server_close()
        if thread is not None:
            thread.join(timeout=5)
        if state is not None:
            result["safeProxyEvents"] = list(state.rows)
            result["blockedExternalConnectAttempts"] = state.denied_connects
            result["blockedExternalHosts"] = dict(sorted(state.denied_hosts.items()))
        result["upstreamConnections"] = 0
        (args.output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("status") == "PASS" else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--carrier", type=Path, required=True, help="generated Firefox ZIP carrier")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--firefox", type=Path, default=Path("/root/octoport-control/browsers/A/firefox-155.0.1/unpack/firefox/firefox"))
    parser.add_argument("--geckodriver", type=Path, default=Path("/root/.cache/selenium/geckodriver/linux64/0.37.1/geckodriver"))
    parser.add_argument("--api-origin", default="http://127.0.0.1:18101")
    parser.add_argument("--portal-origin", default="http://127.0.0.1:18111")
    parser.add_argument("--namespace", default="firefoxfunctional")
    parser.add_argument("--email", help="pre-created disposable fixture email")
    parser.add_argument("--allow-technical", action="store_true", help="grant optional technical data through Firefox doorhanger")
    parser.add_argument("--certutil", type=Path, help="NSS certutil executable used to trust the local CA in the temporary Firefox profile")
    args = parser.parse_args()
    raise SystemExit(run(args))


if __name__ == "__main__":
    main()
