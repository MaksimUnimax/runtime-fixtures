"""Native installation after an already open new chat, then popup Start/Finish.
Only the AI page, tab selection and signed loopback authority are synthetic.
The installed receiver, popup handlers, worker, sending and binding are real.
"""
from pathlib import Path
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
        with sync_playwright() as pw, tempfile.TemporaryDirectory(dir=args.output, prefix="p-") as profile:
            options = dict(headless=True, ignore_default_args=["--disable-extensions"], args=[
                "--enable-unsafe-extension-debugging", "--disable-background-networking"
            ])
            if os.environ.get("SA_TEST_CHROMIUM"):
                options["executable_path"] = os.environ["SA_TEST_CHROMIUM"]
            else:
                options["channel"] = "chromium"
            context = pw.chromium.launch_persistent_context(profile, **options)
            context.route("https://**/*", lambda route: route.fulfill(
                body=CHAT_FIXTURE.read_text(), content_type="text/html"
            ) if route.request.url.startswith("https://chatgpt.com/") else route.abort())
            page = context.new_page()
            page.goto("https://chatgpt.com/", wait_until="load")
            page.evaluate("document.querySelector('#turns').replaceChildren()")
            browser_session = context.browser.new_browser_cdp_session()
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
            target = "https://chatgpt.com/any-new-address/77777777-7777-4777-8777-777777777777"
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
            assert report["generation_after"] == generation_before + 1, report
            assert page.evaluate("sent.length") == 1
            assert page.url == target
            assert active["context"]["store_id"] == store["id"]
            assert not active["pending"]
            report["cases"].append({"name": "one-popup-click-one-message-then-bind-after-address-appears", "status": "PASS"})
            diagnostic = worker.evaluate("async id=>saLastStartDiagnostic(id)", tab_id)
            assert diagnostic == {"stage": "active", "code": None, "outcome": "active"}, diagnostic
            report["cases"].append({"name": "successful-binding-reported-active-not-failed", "status": "PASS"})
            page.evaluate("""()=>fixtureCurrentChatGPTBlock('OZON_HELP_V2 {"cluster":"catalog_products"}')""")
            page.locator("[data-assistant-stream-block]").last.scroll_into_view_if_needed()
            button = page.locator(".ozon-bridge-block-action").last
            button.wait_for(timeout=10000)
            assert button.inner_text() == "Ozon"
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
            report["cases"].append({"name": "finish-removes-buttons-without-resend", "status": "PASS"})
            # Restart on an existing conversation; the old HELP remains history.
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
            assert wb_button.inner_text() == "WB"
            report["cases"].append({"name": "confirmed-store-change-starts-wb-once-and-shows-wb-button", "status": "PASS"})
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
        if context:
            try:
                context.close()
            except Exception:
                pass  # Playwright context manager may already have closed it.
        if server:
            server.stop()
        (args.output / "result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
