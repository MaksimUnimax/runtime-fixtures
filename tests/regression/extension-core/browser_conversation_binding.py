"""Native MV3 conversation binding acceptance on synthetic provider pages.
The popup, content scripts, worker and signed authority verifier are real.
Only provider DOM and loopback control-plane responses are fixtures.
"""
from pathlib import Path
import argparse
import json
import sys
import traceback

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "client-i1"))
from browser_c1_acceptance import BrowserFixture, CHAT_FIXTURE, SESSIONS, wait_for
from synthetic_health_server import SyntheticHealthServer
from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--private-key", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    report = {"level": "INSTALLED_SYNTHETIC", "cases": [], "status": "RUNNING"}
    server = SyntheticHealthServer(args.private_key).start()
    fixture = None

    def passed(name):
        report["cases"].append({"name": name, "status": "PASS"})
        print(name + ": PASS", flush=True)

    try:
        with sync_playwright() as pw:
            fixture = BrowserFixture(args.runtime, args.private_key, server, args.output)
            fixture.open(pw)
            fixture.reset()
            original_state = fixture.state
            def observed_state():
                value = original_state()
                report["last_state"] = value
                return value
            fixture.state = observed_state
            fixture.worker.evaluate("""()=>{
              const original=globalThis.fetch;
              globalThis.bindingExternalRequests=[];
              globalThis.fetch=(input,...args)=>{
                const url=String(typeof input==='string'?input:input.url);
                if(!url.startsWith('http://127.0.0.1:')&&!url.startsWith('chrome-extension://')){
                  bindingExternalRequests.push(url);
                  throw new Error('FIXTURE_EXTERNAL_NETWORK_FORBIDDEN');
                }
                return original(input,...args);
              };
            }""")
            html = CHAT_FIXTURE.read_text()
            pages = {}
            fixture.context.unroute("https://chatgpt.com/**")
            fixture.context.route("https://chatgpt.com/**", lambda route: route.fulfill(
                body=pages.get(route.request.url, html), content_type="text/html"))
            # Deliberately no /c prefix or route-derived identity.
            a = "https://chatgpt.com/workspace/arbitrary-thread?mode=guest"
            b = "https://chatgpt.com/unrelated/new-thread?mode=guest"
            fixture.page.goto(a, wait_until="domcontentloaded")
            fixture.reload_popup()
            store = fixture.add_ozon("Synthetic binding store")
            initial = wait_for(lambda: (s if (s := fixture.state())["identity"]["status"] == "confirmed" else None), "surface")
            assert initial["identity"]["identity_scope"] == "document", initial["identity"]
            fixture.click_start()
            active = wait_for(lambda: (s if ((s := fixture.state()).get("work") or {}).get("state") == "active_visible" else None), "active local work", 20)
            key = active["conversation_key"]
            assert key and "|local:" in key
            assert fixture.page.evaluate("sent.length") == 1
            assert fixture.page.locator(".ozon-bridge-block-action").count() == 0
            passed("arbitrary-guest-address-start-once-history-not-executable")

            fixture.page.evaluate("""()=>fixtureCommand('OZON_HELP_V2 {"cluster":"catalog_products"}','binding-help')""")
            fixture.page.locator("section[data-turn=assistant] .code").last.scroll_into_view_if_needed()
            button = fixture.page.locator(".ozon-bridge-block-action").last
            button.wait_for(timeout=10000)
            assert button.inner_text() == "Ozon"
            button.click()
            fixture.page.wait_for_function("sent.length === 2", timeout=30000)
            assert fixture.page.evaluate("sent[1].startsWith('OZON_')")
            assert fixture.worker.evaluate("bindingExternalRequests.length") == 0
            fixture.page.screenshot(path=str(args.output / "guest-command-result.png"))
            passed("manual-button-and-help-result-in-same-dialogue")

            fixture.popup.click("#visibility")
            wait_for(lambda: fixture.page.locator(".ozon-bridge-block-action").count() == 0, "hidden")
            fixture.popup.click("#visibility")
            wait_for(lambda: fixture.page.locator(".ozon-bridge-block-action").count() == 1, "shown")
            assert fixture.page.evaluate("sent.length") == 2
            passed("hide-show-does-not-resend")

            # Preserve only synthetic conversation history across a new document.
            turns = fixture.page.locator("#turns").inner_html()
            import re
            pages[a] = re.sub(r'(<main id="turns">).*?(</main>)', lambda m: m[1] + turns + m[2], html, count=1, flags=re.S)
            pages[a] = re.sub(r'<button[^>]*class="[^"]*ozon-bridge-block-action[^"]*"[^>]*>.*?</button>', '', pages[a], flags=re.S)
            fixture.page.reload(wait_until="domcontentloaded")
            restored = wait_for(lambda: (s if (s := fixture.state()).get("conversation_key") == key else None), "reload identity", 15)
            assert restored["work"]["state"] == "active_visible", restored
            assert fixture.page.evaluate("sent.length") == 0
            passed("reload-restores-matching-history-without-send")

            pages[b] = pages[a]  # A copied history under another address is not A.
            fixture.page.goto(b, wait_until="domcontentloaded")
            other = wait_for(lambda: (s if (s := fixture.state()).get("conversation_key") not in (None, key) else None), "other surface", 15)
            assert (other.get("work") or {}).get("state", "inactive") == "inactive"
            assert other["conversation_key"] not in fixture.storage().get("ozmb_conversation_bindings", {})
            assert fixture.page.locator(".ozon-bridge-block-action").count() == 0
            fixture.page.goto(a, wait_until="domcontentloaded")
            wait_for(lambda: fixture.state().get("conversation_key") == key, "return to A", 15)
            assert fixture.page.evaluate("sent.length") == 0
            passed("copied-history-at-other-address-does-not-inherit-binding")

            fixture.popup.click("#finish")
            wait_for(lambda: fixture.storage().get(SESSIONS, {}).get(key, {}).get("state") == "inactive", "Finish")
            fixture.page.reload(wait_until="domcontentloaded")
            wait_for(lambda: fixture.state().get("conversation_key") == key, "finished identity")
            assert fixture.state()["work"]["state"] == "inactive"
            assert fixture.page.locator(".ozon-bridge-block-action").count() == 0
            assert fixture.page.evaluate("sent.length") == 0
            passed("finish-survives-reload-without-resurrection")

            empty_html = re.sub(r'(<main id="turns">).*?(</main>)', r'\1\2', html, count=1, flags=re.S)
            pages["https://chatgpt.com/"] = empty_html
            fixture.page.goto("https://chatgpt.com/", wait_until="domcontentloaded")
            fixture.reload_popup()
            wait_for(lambda: fixture.state()["identity"]["status"] == "unknown", "empty surface")
            fixture.page.evaluate("""()=>{
              document.querySelector('[data-testid="send-button"]').addEventListener('click',()=>{
                history.pushState({},'', '/a-new-route/promoted?presentation=guest');
              },{once:true,capture:true});
            }""")
            fixture.click_start()
            promoted = wait_for(lambda: (s if ((s := fixture.state()).get("work") or {}).get("state") == "active_visible" else None), "empty Start promotion", 20)
            promoted_key = promoted["conversation_key"]
            assert promoted_key != key
            assert fixture.page.evaluate("sent.length") == 1
            assert fixture.page.url.endswith("/a-new-route/promoted?presentation=guest")
            passed("empty-start-survives-url-assignment-with-owned-message")
            fixture.popup.click("#finish")
            wait_for(lambda: fixture.storage().get(SESSIONS, {}).get(promoted_key, {}).get("state") == "inactive", "promoted Finish")

            pending_url = "https://chatgpt.com/pending/new"
            pages[pending_url] = empty_html
            fixture.page.goto(pending_url, wait_until="domcontentloaded")
            fixture.reload_popup()
            fixture.page.evaluate("""()=>{
              const timer=window.setTimeout;
              window.fixtureLateReplies=[];
              window.setTimeout=(fn,delay,...args)=>delay===150
                ? (fixtureLateReplies.push(()=>fn(...args)),0)
                : timer(fn,delay,...args);
            }""")
            fixture.click_start()
            wait_for(lambda: fixture.page.evaluate("sent.length") == 1, "pending prompt")
            wait_for(lambda: fixture.state().get("pending"), "pending Start")
            fixture.popup.click("#finish")
            wait_for(lambda: fixture.state().get("pending") is None, "cancel pending")
            fixture.page.evaluate("()=>fixtureLateReplies.splice(0).forEach(fn=>fn())")
            fixture.page.wait_for_timeout(1200)
            ended = fixture.state()
            assert not ended.get("pending")
            assert (ended.get("work") or {}).get("state", "inactive") == "inactive"
            assert fixture.page.evaluate("sent.length") == 1
            assert fixture.page.locator(".ozon-bridge-block-action").count() == 0
            passed("finish-cancels-pending-and-late-reply-cannot-resurrect")
            assert not fixture.errors, fixture.errors
            report["status"] = "PASS"
    except Exception as error:
        report.update(status="FAIL", error=str(error), traceback=traceback.format_exc())
        report["page_errors"] = fixture.errors if fixture else []
        if fixture and fixture.popup:
            try:
                report["state"] = fixture.state()
                fixture.page.screenshot(path=str(args.output / "failure.png"))
            except Exception:
                pass
    finally:
        if fixture:
            try:
                fixture.close()
            except Exception:
                pass
        server.stop()
        (args.output / "result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps({k: v for k, v in report.items() if k in ("level", "status", "cases", "error")}, ensure_ascii=False))
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
