"""Browser smoke for the Metrika loader with every external request mocked."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlsplit
import re

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3] / "apps/site/public"
REPO = ROOT.parents[2]
PAGES = ("index.html", "seller-analytics.html", "privacy.html", "support.html", "install.html")
LOADER = (ROOT / "assets/yandex-metrika.js").read_text(encoding="utf-8")
NGINX = (REPO / "infra/production/nginx/octoport-site.conf").read_text(encoding="utf-8")
STRICT_CSP = re.search(r'add_header Content-Security-Policy "([^"]+)" always;', NGINX).group(1)
external_requests = []


class QuietHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        aliases = {
            "/seller-analytics": "/seller-analytics.html",
            "/privacy": "/privacy.html",
            "/support": "/support.html",
            "/install": "/install.html",
        }
        request = urlsplit(self.path)
        if request.path in aliases:
            self.path = aliases[request.path] + (f"?{request.query}" if request.query else "")
        super().do_GET()

    def log_message(self, *_args):
        pass


class StrictCspHandler(QuietHandler):
    def end_headers(self):
        self.send_header("Content-Security-Policy", STRICT_CSP)
        super().end_headers()


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{server.server_port}"

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                executable_path="/usr/bin/chromium",
                headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )
            try:
                page = browser.new_page()

                def intercept_external(route):
                    request_url = route.request.url
                    parsed = urlsplit(request_url)
                    if parsed.hostname == "127.0.0.1":
                        route.continue_()
                        return
                    external_requests.append(request_url)
                    if parsed.hostname == "mc.yandex.ru" and parsed.path == "/metrika/tag.js":
                        route.fulfill(status=200, content_type="application/javascript", body="window.__metrikaMockLoaded = true;")
                    elif parsed.hostname == "mc.yandex.ru" and parsed.path == "/watch/113424299":
                        route.fulfill(status=204, body="")
                    else:
                        route.fulfill(status=204, body="")

                page.route("**/*", intercept_external)

                for name in PAGES:
                    external_requests.clear()
                    response = page.goto(f"{origin}/{name}", wait_until="load")
                    assert response and response.ok, (name, response.status if response else None)
                    page.wait_for_function("window.__metrikaMockLoaded === true")
                    state = page.evaluate("""() => ({
                      queue: window.ym.a.map((args) => Array.from(args)),
                      ecommerceEvents: window.dataLayer.length,
                      tagScripts: [...document.scripts].filter((script) => script.src === "https://mc.yandex.ru/metrika/tag.js?id=113424299").length,
                      pageLoaderScripts: [...document.scripts].filter((script) => script.src === "/assets/yandex-metrika.js" || script.src.endsWith("/assets/yandex-metrika.js")).length,
                      url: location.href,
                      referrer: document.referrer
                    })""")
                    assert len(state["queue"]) == 1 and state["queue"][0][1] == "init", (name, state)
                    assert state["ecommerceEvents"] == 0, (name, state)
                    assert state["tagScripts"] == 1 and state["pageLoaderScripts"] == 1, (name, state)
                    options = state["queue"][0][2]
                    assert options == {
                        "ssr": True,
                        "clickmap": True,
                        "ecommerce": "dataLayer",
                        "referrer": state["referrer"],
                        "url": state["url"],
                        "accurateTrackBounce": True,
                        "trackLinks": True,
                    }, (name, options)
                    assert len(external_requests) == 1 and "/metrika/tag.js?id=113424299" in external_requests[0], (name, external_requests)

                    page.evaluate("""(source) => {
                      delete window.__octoportMetrika113424299Initialized;
                      window.ym.a.length = 0;
                      (0, eval)(source);
                    }""", LOADER)
                    after_existing_src = page.evaluate("""() => ({
                      queue: window.ym.a.map((args) => Array.from(args)),
                      tagScripts: [...document.scripts].filter((script) => script.src === "https://mc.yandex.ru/metrika/tag.js?id=113424299").length
                    })""")
                    assert len(after_existing_src["queue"]) == 1, (name, after_existing_src)
                    assert after_existing_src["tagScripts"] == 1, (name, after_existing_src)
                    assert len(external_requests) == 1, (name, external_requests)

                    page.evaluate("""(source) => {
                      (0, eval)(source);
                      (0, eval)(source);
                    }""", LOADER)
                    after_duplicate_eval = page.evaluate("""() => ({
                      queue: window.ym.a.map((args) => Array.from(args)),
                      ecommerceEvents: window.dataLayer.length,
                      tagScripts: [...document.scripts].filter((script) => script.src === "https://mc.yandex.ru/metrika/tag.js?id=113424299").length
                    })""")
                    assert len(after_duplicate_eval["queue"]) == 1, (name, after_duplicate_eval)
                    assert after_duplicate_eval["tagScripts"] == 1, (name, after_duplicate_eval)
                    assert after_duplicate_eval["ecommerceEvents"] == 0, (name, after_duplicate_eval)
                    assert all(call[1] != "hit" for call in after_duplicate_eval["queue"]), (name, after_duplicate_eval)

                external_requests.clear()
                response = page.goto(f"{origin}/", wait_until="load")
                assert response and response.ok
                page.wait_for_function("window.__metrikaMockLoaded === true")
                page.evaluate("location.hash = '#features'")
                same_document_state = page.evaluate("""() => ({
                  hash: location.hash,
                  queue: window.ym.a.map((args) => Array.from(args)),
                  tagScripts: [...document.scripts].filter((script) => script.src === "https://mc.yandex.ru/metrika/tag.js?id=113424299").length
                })""")
                assert same_document_state["hash"] == "#features", same_document_state
                assert len(same_document_state["queue"]) == 1 and same_document_state["queue"][0][1] == "init", same_document_state
                assert same_document_state["tagScripts"] == 1 and len(external_requests) == 1, external_requests

                with page.expect_navigation(wait_until="load"):
                    page.locator("main a[href='/seller-analytics']").click()
                page.wait_for_function("window.__metrikaMockLoaded === true")
                navigation_state = page.evaluate("""() => ({
                  queue: window.ym.a.map((args) => Array.from(args)),
                  tagScripts: [...document.scripts].filter((script) => script.src === "https://mc.yandex.ru/metrika/tag.js?id=113424299").length,
                  referrer: document.referrer
                })""")
                assert len(navigation_state["queue"]) == 1 and navigation_state["queue"][0][1] == "init", navigation_state
                assert navigation_state["tagScripts"] == 1 and navigation_state["referrer"] == f"{origin}/", navigation_state
                assert len(external_requests) == 2 and all("/metrika/tag.js?id=113424299" in item for item in external_requests), external_requests

                no_js_context = browser.new_context(java_script_enabled=False)
                no_js_page = no_js_context.new_page()
                no_js_page.route("**/*", intercept_external)
                external_requests.clear()
                response = no_js_page.goto(f"{origin}/install.html", wait_until="load")
                assert response and response.ok
                assert no_js_page.locator("noscript img[src='https://mc.yandex.ru/watch/113424299']").count() == 1
                assert external_requests == ["https://mc.yandex.ru/watch/113424299"], external_requests
                no_js_context.close()

                strict_server = ThreadingHTTPServer(("127.0.0.1", 0), StrictCspHandler)
                strict_thread = Thread(target=strict_server.serve_forever, daemon=True)
                strict_thread.start()
                try:
                    strict_origin = f"http://127.0.0.1:{strict_server.server_port}"
                    strict_page = browser.new_page()
                    strict_page.route("**/*", intercept_external)
                    external_requests.clear()
                    console_messages = []
                    strict_page.on("console", lambda message: console_messages.append(message.text))
                    response = strict_page.goto(f"{strict_origin}/", wait_until="load")
                    assert response and response.ok
                    assert strict_page.evaluate("typeof window.ym") == "undefined"
                    assert external_requests == [], external_requests
                    assert any("Content Security Policy" in message for message in console_messages), console_messages
                    strict_page.close()
                finally:
                    strict_server.shutdown()
                    strict_server.server_close()
                    strict_thread.join(timeout=5)
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

    print("SITE_METRIKA_MOCK_BROWSER_PASS pages=5 init_once_per_document=5 hash_and_page_navigation=single_init duplicate_eval=blocked noscript_pixel=mocked production_csp_blocks_loader=confirmed")


if __name__ == "__main__":
    main()
