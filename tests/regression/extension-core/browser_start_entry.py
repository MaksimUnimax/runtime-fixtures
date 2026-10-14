"""Native installation after an already open new chat, then popup Start/Finish.
Only the AI page, tab selection and signed loopback authority are synthetic.
The installed receiver, popup handlers, worker, sending and binding are real.
"""
from pathlib import Path
from contextlib import ExitStack
import argparse
import base64
import hashlib
import json
import os
import shutil
import sys
import subprocess
import tempfile
import traceback

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "client-i1"))
from browser_c1_acceptance import BrowserFixture, CHAT_FIXTURE, seed_authority, wait_for
from synthetic_health_server import SyntheticHealthServer


class FirstBootstrapServer(SyntheticHealthServer):
    """Supply the signed first AI profile; keep normal client verification."""
    bootstrap_envelope = None

    def __init__(self, private_key_path):
        super().__init__(private_key_path)
        # ThreadingHTTPServer normally detaches daemon request-handler threads.
        # For this isolated signer fixture, server_close() must wait until
        # every request handler has finished using the ephemeral private key.
        self._server.daemon_threads = False
        self._server.block_on_close = True

    def _handler(self):
        parent = super()._handler()
        fixture = self

        class Handler(parent):
            def do_POST(self):
                if self.path != "/v1/bootstrap":
                    return super().do_POST()
                body = json.loads(self.rfile.read(int(self.headers.get("content-length", "0"))))
                assert body.get("detectedAi", {}).get("family") == "chatgpt"
                encoded = json.dumps(fixture.bootstrap_envelope).encode()
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

        return Handler



def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    report = {"level": "INSTALLED_SYNTHETIC", "status": "RUNNING", "cases": []}
    context = None
    server = None
    private = None
    browser_shutdown_errors = []

    def close_test_context():
        nonlocal context
        if context is None:
            return
        try:
            context.close()
        except Exception as exc:
            browser_shutdown_errors.append("browser_" + type(exc).__name__)
        else:
            context = None

    try:
        runtime = args.output / "runtime"
        shutil.copytree(args.runtime, runtime)
        private = args.output / "fixture-key.pkcs8"
        private.touch(mode=0o600, exist_ok=False)
        subprocess.run(["openssl", "genpkey", "-algorithm", "ED25519", "-outform", "DER", "-out", str(private)],
                       check=True, capture_output=True)
        public = subprocess.check_output(["openssl", "pkey", "-inform", "DER", "-in", str(private),
                                          "-pubout", "-outform", "DER"])
        worker_file = runtime / "service_worker.js"
        worker_source = worker_file.read_text()
        # This test copy is never an owner/release package. Keep verification
        # enabled and pin its separately generated, synthetic-only trust root.
        replacements = {
            "config-local-development": "browser-fixture-key",
            "MCowBQYDK2VwAyEAFG3DxyJOAU0cI1T50i6+tDUonQ74Qzw1Ra6USuEWYRg=": base64.b64encode(public).decode(),
            "69e2ddf7c78d4221d06b65be0212063b923e4e827c2e271385fef0d04cce85dc": hashlib.sha256(public).hexdigest(),
        }
        for before, after in replacements.items():
            assert worker_source.count(before) == 1, "DEVELOPMENT_RUNTIME_REQUIRED"
            worker_source = worker_source.replace(before, after)
        worker_file.write_text(worker_source)
        server = FirstBootstrapServer(private).start()
        # ExitStack closes the MV3 browser BEFORE sync_playwright() exits.
        # Cleanup from the outer finally would use an already stopped driver.
        with sync_playwright() as pw, tempfile.TemporaryDirectory(dir=args.output, prefix="p-") as profile, ExitStack() as browser_cleanup:
            options = dict(headless=True, ignore_default_args=["--disable-extensions"], args=[
                "--enable-unsafe-extension-debugging", "--disable-background-networking"
            ])
            expected_brand = os.environ.get("SA_EXPECT_BRANDED_CHROME147")
            assert expected_brand is None or expected_brand == "1", (
                "BRANDED_CHROME147_EXPECTATION_FLAG_INVALID"
            )
            if os.environ.get("SA_TEST_CHROMIUM"):
                options["executable_path"] = os.environ["SA_TEST_CHROMIUM"]
            else:
                options["channel"] = "chromium"
            if expected_brand == "1":
                assert options.get("executable_path"), "BRANDED_CHROME147_BINARY_REQUIRED"
            context = pw.chromium.launch_persistent_context(profile, **options)
            browser_cleanup.callback(close_test_context)
            context.route("https://**/*", lambda route: route.fulfill(
                body=CHAT_FIXTURE.read_text(), content_type="text/html"
            ) if route.request.url.startswith("https://chatgpt.com/") else route.abort())
            page = context.new_page()
            page.goto("https://chatgpt.com/", wait_until="load")
            page.evaluate("document.querySelector('#turns').replaceChildren()")
            browser_session = context.browser.new_browser_cdp_session()
            # A branded-Chrome-specific run must prove the actual launched
            # binary and its CDP product, not merely the launch argument.
            if expected_brand == "1":
                requested_binary = options.get("executable_path")
                assert requested_binary, "BRANDED_CHROME147_BINARY_REQUIRED"
                binary_version = subprocess.check_output(
                    [requested_binary, "--version"], text=True, timeout=8,
                    stderr=subprocess.DEVNULL,
                ).strip()
                cdp_product = str(browser_session.send("Browser.getVersion").get("product") or "")
                assert binary_version.startswith("Google Chrome 147."), binary_version
                assert cdp_product.startswith("Chrome/147."), cdp_product
                report["browser_identity"] = {
                    "family": "google-chrome",
                    "binary_version": binary_version,
                    "cdp_product": cdp_product,
                    "branded_verified": True,
                }
            browser_session.send("Extensions.loadUnpacked", {"path": str(runtime)})
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker")
            # Finish client initialization before writing exactly one cache
            # snapshot. Never expose a transient RESOLVED cache to startup.
            worker.evaluate("async()=>SellerAgentsControlClient.status()")
            seeded = seed_authority(worker, private, initial_ai_unconfigured=True)
            server.bootstrap_envelope = seeded["resolvedEnvelope"]
            tab_id = worker.evaluate("async()=>(await chrome.tabs.query({url:'https://chatgpt.com/*'}))[0].id")
            extension_url = worker.url.rsplit("/", 1)[0]
            # Restart only the background worker so the real verifier restores
            # the signed test cache, preserving the already open AI document.
            targets = browser_session.send("Target.getTargets")["targetInfos"]
            target = next(t for t in targets if t.get("type") == "service_worker" and t.get("url") == worker.url)
            assert browser_session.send("Target.closeTarget", {"targetId": target["targetId"]})["success"]
            popup = context.new_page()
            popup.add_init_script(
                "const originalQuery=chrome.tabs.query.bind(chrome.tabs);"
                "chrome.tabs.query=(query)=>query.active?Promise.resolve([{id:" + str(tab_id) + "}]):originalQuery(query);"
            )
            popup.goto(extension_url + "/popup.html")
            def restored_worker():
                for candidate in context.service_workers:
                    if candidate.url != extension_url + "/service_worker_entry.js":
                        continue
                    try:
                        status = candidate.evaluate("async()=>SellerAgentsControlClient.status()")
                        report["last_auth"] = {"authenticated": status.get("authenticated"), "lastError": status.get("lastError"), "aiStatus": (status.get("authority") or {}).get("aiStatus"), "generation": status.get("generation")}
                        if status.get("authenticated"):
                            return candidate
                    except Exception:
                        pass
                page.wait_for_timeout(50)
                return None
            worker = wait_for(restored_worker, "worker restores signed synthetic authority", 10)
            assert report["last_auth"]["aiStatus"] == "UNCONFIGURED", report["last_auth"]
            initial = worker.evaluate("async id=>saPopupState(id)", tab_id)
            assert initial["identity"]["ai_id"] is None
            report["initial_page"] = initial.get("page")
            raw = worker.evaluate("async id=>tabMessage(id,{type:'OZ_GET_IDENTITY'})", tab_id)
            assert raw["transport_class"] == "NO_RECEIVER"
            fixture = BrowserFixture(runtime, private, server, args.output)
            fixture.context, fixture.worker, fixture.page, fixture.tab_id = context, worker, page, tab_id
            fixture.popup = popup
            wait_for(lambda: "Аккаунт · 11111111" in popup.locator("#account").inner_text(), "signed test authority")
            store = fixture.add_ozon("Synthetic new-dialogue store")
            assert popup.locator("#start").is_enabled(), "Start disabled on supported pre-existing new chat"
            assert page.url == "https://chatgpt.com/"
            report["cases"].append({"name": "start-enabled-without-conversation-id-or-content-receiver", "status": "PASS"})
            # The production ChatGPT identity parser requires /c/<UUID>.
            # An arbitrary path ending in UUID can display a new URL while
            # failing to establish an actual confirmed conversation identity.
            conversation_id = "77777777-7777-4777-8777-777777777777"
            target = f"https://chatgpt.com/c/{conversation_id}"
            page.evaluate("""target=>document.querySelector('[data-testid="send-button"]').addEventListener(
                'click',()=>history.replaceState({},'',target),{once:true})""", target)
            generation_before = worker.evaluate("async()=>SellerAgentsControlClient.generation()")
            report["generation_before"] = generation_before
            assert worker.evaluate("async()=>(await SellerAgentsControlClient.getAuthority()).payload.ai.status") == "UNCONFIGURED"
            fixture.click_start()
            try:
                active = wait_for(lambda: (s if ((s := fixture.state()).get("work") or {}).get("state") == "active_visible" and not s.get("pending") else None), "completed first-message binding after new address", 25)
            except Exception:
                report["start_diagnostic"] = worker.evaluate("async id=>saLastStartDiagnostic(id)", tab_id)
                report["generation_before"] = generation_before
                report["generation_after"] = worker.evaluate("async()=>SellerAgentsControlClient.generation()")
                raise
            report["generation_after"] = worker.evaluate("async()=>SellerAgentsControlClient.generation()")
            # Resolving the first AI grant does not rebase an in-flight R3 command.
            assert report["generation_after"] == generation_before, report
            assert page.evaluate("sent.length") == 1
            assert page.url == target
            assert active["context"]["store_id"] == store["id"]
            identity = active["identity"]
            assert identity["status"] == "confirmed", identity
            assert identity["origin"] == "https://chatgpt.com", identity
            assert identity["ai_id"] == "chatgpt", identity
            assert identity["chat_path"] == f"/c/{conversation_id}", identity
            scoped_id = identity["conversation_id"]
            assert isinstance(scoped_id, str) and scoped_id, identity
            # Positive surface evidence must match this exact current route
            # and both newly observed turns, not an arbitrary UUID-shaped
            # locator, stale history or two unrelated message IDs.
            proof = identity["identity_evidence"]
            assert proof["version"] == 1, proof
            assert proof["locator_digest"] == hashlib.sha256(target.encode("utf8")).hexdigest(), proof
            observed_turns = page.evaluate("""() => ({
                user: [...document.querySelectorAll('#turns section[data-turn="user"][data-turn-id]')]
                    .map(node => node.dataset.turnId),
                assistant: [...document.querySelectorAll('#turns section[data-turn="assistant"][data-turn-id]')]
                    .map(node => node.dataset.turnId)
            })""")
            assert len(observed_turns["user"]) == 1, observed_turns
            assert len(observed_turns["assistant"]) == 1, observed_turns
            proof_ids = set(proof["message_ids"])
            assert len(proof_ids) >= 2, proof
            assert set(observed_turns["user"] + observed_turns["assistant"]) <= proof_ids, proof
            if identity["identity_scope"] == "document":
                # A fresh document is deliberately assigned a local binding:
                # a URL locator is not proof that its UUID identifies the
                # active conversation. Preserve this local Work across route
                # promotion using the already witnessed assistant/user turns.
                assert identity["source"] in {"local_surface", "local_surface_continuity"}, identity
                assert scoped_id == "local:" + identity["surface_id"], identity
            else:
                # A promoted external ID needs positive conversation scope.
                assert identity["identity_scope"] == "conversation", identity
                assert scoped_id == conversation_id, identity
            bound_key = f"https://chatgpt.com|{scoped_id}"
            assert active["conversation_key"] == bound_key, active["conversation_key"]
            assert active["work"]["conversation_key"] == bound_key, active["work"]
            assert active["work"]["conversation_id"] == scoped_id, active["work"]
            assert not active["pending"]
            report["bound_identity_scope"] = identity["identity_scope"]
            report["bound_identity_source"] = identity["source"]
            report["conversation_key_consistent"] = True
            report["route_digest_and_first_two_turns_verified"] = True
            report["cases"].append({"name": "one-popup-click-one-message-then-bind-confirmed-scoped-conversation", "status": "PASS"})
            diagnostic = worker.evaluate("async id=>saLastStartDiagnostic(id)", tab_id)
            assert diagnostic == {"stage": "active", "code": None, "outcome": "active"}, diagnostic
            report["cases"].append({"name": "successful-binding-reported-active-not-failed", "status": "PASS"})
            page.evaluate("""()=>fixtureCurrentChatGPTBlock('OZON_HELP_V2 {"cluster":"catalog_products"}')""")
            page.locator("[data-assistant-stream-block]").last.scroll_into_view_if_needed()
            button = page.locator(".ozon-bridge-block-action").last
            button.wait_for(timeout=10000)
            assert button.inner_text() == "Октопорт"
            popup.click("#visibility")
            wait_for(lambda: page.locator(".ozon-bridge-block-action").count() == 0, "hidden command button")
            popup.click("#visibility")
            wait_for(lambda: page.locator(".ozon-bridge-block-action").count() == 1, "restored command button")
            assert page.evaluate("sent.length") == 1
            report["cases"].append({"name": "modern-help-button-hide-show-without-send", "status": "PASS"})
            button.click()
            page.wait_for_function("sent.length === 2", timeout=30000)
            assert page.evaluate("sent[1].startsWith('OZON_')")
            assert page.url == target
            report["cases"].append({"name": "help-button-delivers-result-in-bound-dialogue", "status": "PASS"})
            page.screenshot(path=str(args.output / "chrome-help-result.png"))
            fixture.reload_popup()
            fixture.click_start()
            assert page.evaluate("sent.length") == 2
            report["cases"].append({"name": "popup-reopen-and-repeated-start-do-not-resend", "status": "PASS"})
            popup.click("#finish")
            wait_for(lambda: not fixture.state()["context"]["work_active"], "Finish", 10)
            assert page.evaluate("sent.length") == 2
            wait_for(lambda: page.locator(".ozon-bridge-block-action").count() == 0, "finished command buttons")
            wait_for(lambda: popup.locator("#start").is_enabled(), "Start ready after Finish action completion", 10)
            report["cases"].append({"name": "finish-removes-buttons-without-resend", "status": "PASS"})
            # Restart on an existing conversation only after the popup action itself is ready.
            fixture.click_start()
            wait_for(lambda: ((fixture.state().get("work") or {}).get("state") == "active_visible" and not fixture.state().get("pending")), "existing-dialogue restart", 25)
            assert page.evaluate("sent.length") == 3
            assert page.locator(".ozon-bridge-block-action").count() == 0
            report["cases"].append({"name": "existing-dialogue-start-once-old-help-not-executable", "status": "PASS"})
            popup.click("#finish")
            wait_for(lambda: not fixture.state()["context"]["work_active"], "final Finish", 10)
            wb = fixture.add_wb("Synthetic Chrome WB store")
            fixture.click_start()
            popup.locator("#confirm").click()
            wait_for(lambda: ((s := fixture.state()).get("context", {}).get("store_id") == wb["id"] and (s.get("work") or {}).get("state") == "active_visible" and not s.get("pending")), "WB store binding", 25)
            assert page.evaluate("sent.length") == 4
            assert page.evaluate("sent[3].includes('WB_HELP_V1')")
            page.evaluate("""()=>fixtureCurrentChatGPTBlock('WB_HELP_V1 {"operation":"describe","params":{"alias":"seller_info"}}')""")
            page.locator("[data-assistant-stream-block]").last.scroll_into_view_if_needed()
            wb_button = page.locator(".ozon-bridge-block-action").last
            wb_button.wait_for(timeout=10000)
            assert wb_button.inner_text() == "Октопорт"
            report["cases"].append({"name": "confirmed-store-change-starts-wb-once-and-shows-product-button", "status": "PASS"})
            wb_button.click()
            page.wait_for_function("sent.length === 5", timeout=30000)
            assert page.evaluate("sent[4].startsWith('WB_')")
            assert page.url == target
            popup.click("#finish")
            wait_for(lambda: not fixture.state()["context"]["work_active"], "WB Finish", 10)
            wait_for(lambda: page.locator(".ozon-bridge-block-action").count() == 0, "WB buttons removed")
            assert page.evaluate("sent.length") == 5
            report["cases"].append({"name": "wb-help-result-and-finish-without-resend", "status": "PASS"})
            report["status"] = "PASS"
            context.close()
            context = None
    except Exception as exc:
        report["status"] = "FAIL"
        report["error"] = str(exc)
        report["traceback"] = traceback.format_exc()
        raise
    finally:
        # Never treat an interrupted browser/server teardown as a clean
        # stop of the synthetic signing-key consumer.
        shutdown_errors = list(browser_shutdown_errors)
        # Browser close was attempted by ExitStack before the Playwright
        # driver stopped; do not invoke context.close() after that driver exit.
        if context is not None:
            shutdown_errors.append("browser_shutdown_not_proven")
        if server:
            try:
                server.stop()
                # SyntheticHealthServer.stop() has a bounded thread.join(2s)
                # without its own liveness assertion. A normal return is not
                # proof that the test signer is no longer consuming its key.
                assert not server.thread.is_alive(), (
                    "SYNTHETIC_HEALTH_SERVER_THREAD_STILL_ACTIVE"
                )
                assert server._server.daemon_threads is False, (
                    "SYNTHETIC_HEALTH_HANDLER_JOIN_DISABLED"
                )
                assert server._server.block_on_close is True, (
                    "SYNTHETIC_HEALTH_HANDLER_CLOSE_JOIN_DISABLED"
                )
                assert not any(
                    thread.is_alive()
                    for thread in getattr(server._server, "_threads", ())
                ), "SYNTHETIC_HEALTH_REQUEST_THREAD_STILL_ACTIVE"
                server = None
            except Exception as exc:
                shutdown_errors.append("server_" + type(exc).__name__)
        if shutdown_errors:
            report["status"] = "FAIL"
            report["synthetic_shutdown_errors"] = shutdown_errors
        # The synthetic test key is disposable, but only after the
        # browser and local signing server have *confirmed* shutdown.
        key_cleanup_error = None
        if not shutdown_errors and private is not None and private.exists():
            try:
                assert private.name == "fixture-key.pkcs8"
                assert private.parent.resolve() == args.output.resolve()
                assert private.is_file() and not private.is_symlink()
                private.unlink()
            except Exception as exc:
                key_cleanup_error = type(exc).__name__
                report["status"] = "FAIL"
        report["fixture_signing_key_removed"] = bool(
            private is not None and not private.exists()
        )
        if shutdown_errors and private is not None and private.exists():
            report["fixture_signing_key_cleanup_deferred"] = "SHUTDOWN_NOT_PROVEN"
        if key_cleanup_error:
            report["fixture_signing_key_cleanup_error"] = key_cleanup_error
        (args.output / "result.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n"
        )
        print(json.dumps(report, ensure_ascii=False))
        if shutdown_errors:
            raise RuntimeError("SYNTHETIC_TEST_SHUTDOWN_NOT_PROVEN")
        if key_cleanup_error:
            raise RuntimeError("SYNTHETIC_FIXTURE_SIGNING_KEY_CLEANUP_FAILED")


if __name__ == "__main__":
    main()
