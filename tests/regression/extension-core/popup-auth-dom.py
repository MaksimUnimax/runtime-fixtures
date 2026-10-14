"""Actual generated popup in an offline Chromium DOM; no real auth or provider."""
from pathlib import Path
import argparse, hashlib, json, re
from playwright.sync_api import sync_playwright


def run(runtime: Path, output: Path):
    output.mkdir(parents=True, exist_ok=True)
    html = (runtime / "popup.html").read_text()
    source = (runtime / "popup.js").read_text()
    html = re.sub(r"<script\b[^>]*>.*?</script>|<link\b[^>]*>", "", html, flags=re.S)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        try:
            page = browser.new_page()
            page.route("**/*", lambda route: route.fulfill(status=200, content_type="text/html", body="<html><body></body></html>"))
            page.goto("https://fixture.invalid/")
            page.set_content(html)
            page.add_style_tag(content=(runtime / "popup.css").read_text())
            assert not page.locator("#catalog").is_visible(), "catalog must be hidden before script initialization"
            for selector in ["#add", "#edit", "#remove"]:
                assert page.locator(selector).is_disabled()
            page.evaluate("""() => {
              globalThis.fixtureMessages=[];
              globalThis.chrome={tabs:{query:async()=>[{id:1,windowId:1}]},
                storage:{onChanged:{addListener(){}}},runtime:{sendMessage(message){
                  fixtureMessages.push(message.type);
                  if(message.type==='SA_POPUP_STATE') return new Promise(resolve=>{globalThis.resolveFixtureState=resolve;});
                  throw new Error('Unexpected fixture mutation: '+message.type);
                }}};
            }""")
            page.add_script_tag(content=source)
            page.wait_for_function("typeof resolveFixtureState === 'function'")
            page.evaluate("""() => {document.getElementById('add').onclick();document.getElementById('edit').onclick();document.getElementById('remove').onclick();document.getElementById('card').onsubmit({preventDefault(){}});} """)
            assert not page.locator("#catalog").is_visible()
            assert page.locator("#card").evaluate("el=>el.hidden")
            assert page.evaluate("fixtureMessages") == ["SA_POPUP_STATE"]
            signed_in = {"ok":True,"auth":{"authenticated":True},"account":{"label":"Synthetic fixture"},"stores":[{"id":"fixture-store","name":"Fixture store","marketplace":"ozon","sellerClientId":"123","sellerPresent":True}],"context":{},"identity":{},"work":{}}
            page.evaluate("state=>resolveFixtureState(state)", signed_in)
            page.wait_for_function("!document.getElementById('catalog').hidden")
            page.locator("#add").click()
            assert page.locator("#card").is_visible()
            page.locator("#cancel").click()
            page.locator("#edit").click()
            assert page.locator("#name").input_value() == "Fixture store"
            page.locator("#seller-key").fill("SYNTHETIC_NEVER_REAL")
            page.locator("#remove").click()
            assert page.locator("#confirmation").is_visible()
            page.evaluate("() => {globalThis.resolveFixtureState=null;void refresh();}")
            page.wait_for_function("typeof resolveFixtureState === 'function'")
            guest = {"ok":True,"auth":{"authenticated":False},"account":{"label":"Synthetic guest"},"stores":[],"context":{},"identity":{},"work":{}}
            page.evaluate("state=>resolveFixtureState(state)", guest)
            page.wait_for_function("document.getElementById('catalog').hidden")
            assert page.locator("#card").evaluate("el=>el.hidden")
            assert page.locator("#seller-key").input_value() == ""
            assert page.locator("#name").input_value() == ""
            assert not page.locator("#confirmation").is_visible()
            for selector in ["#add", "#edit", "#remove"]:
                assert page.locator(selector).is_disabled()
            assert page.evaluate("fixtureMessages") == ["SA_POPUP_STATE", "SA_POPUP_STATE"]
            result={"status":"PASS","scope":"offline actual generated popup Chromium DOM; synthetic state only; no live auth, store mutation or provider", "popupSha256":hashlib.sha256(source.encode()).hexdigest(),"cases":["initial_hidden_disabled","pending_direct_handlers_blocked","authenticated_add_edit_available","auth_loss_clears_form_and_confirmation"],"providerCalls":0,"storeMutations":0}
            (output / "result.json").write_text(json.dumps(result, indent=2)+"\n")
            print(json.dumps(result))
        finally:
            browser.close()


if __name__ == "__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args=parser.parse_args()
    run(args.runtime, args.output)
