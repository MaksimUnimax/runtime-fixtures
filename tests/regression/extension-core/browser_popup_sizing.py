#!/usr/bin/env python3
"""Exercise native action sizing with packaged markup/CSS and an inert script.

This is isolated browser-layout evidence, not authenticated product acceptance.
Run under xvfb-run on Linux and the role supervisor on the shared server.
"""
import argparse
import hashlib
import json
from pathlib import Path
import tempfile
import time

from playwright.sync_api import sync_playwright

MEASURE = """() => {
  const box = document.body.getBoundingClientRect();
  return {body: box.width, root: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth, inner: innerWidth};
}"""
STUB = """
const auth = document.getElementById('auth');
if (auth) auth.hidden = true;
const connection = document.getElementById('connection');
if (connection) connection.textContent = 'Диалог не подключён';
const samples = [];
const timer = setInterval(() => {
  const box = document.body.getBoundingClientRect();
  samples.push({body: box.width, root: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth, inner: innerWidth});
  if (samples.length > 40) samples.shift();
  chrome.storage.local.set({layoutSamples: samples});
}, 50);
setTimeout(() => clearInterval(timer), 5000);
"""


def fits(row):
    # innerWidth includes the scrollbar; comparing against it misses clipping.
    return row["body"] <= row["root"] + 1 and row["scroll"] <= row["root"] + 1


def run(runtime, output, executable=None):
    output.mkdir(parents=True, exist_ok=False)
    html = (runtime / "popup.html").read_bytes()
    css = (runtime / "popup.css").read_bytes()
    result = {
        "status": "FAIL",
        "evidence": "ISOLATED_NATIVE_ACTION_LAYOUT",
        "authenticatedProductAcceptance": False,
        "realAiAcceptance": False,
        "popupHtmlSha256": hashlib.sha256(html).hexdigest(),
        "popupCssSha256": hashlib.sha256(css).hexdigest(),
        "native": [],
        "tabLayouts": [],
    }
    try:
        with tempfile.TemporaryDirectory(prefix="octoport-popup-layout-") as tmp:
            temporary = Path(tmp)
            extension = temporary / "extension"
            extension.mkdir()
            (extension / "popup.html").write_bytes(html)
            (extension / "popup.css").write_bytes(css)
            (extension / "popup.js").write_text(STUB)
            (extension / "background.js").write_text(
                "chrome.runtime.onInstalled.addListener(() => {});"
            )
            (extension / "manifest.json").write_text(json.dumps({
                "manifest_version": 3, "name": "Octoport layout fixture",
                "version": "1.0", "permissions": ["storage"],
                "action": {"default_popup": "popup.html"},
                "background": {"service_worker": "background.js"},
            }))
            with sync_playwright() as playwright:
                context = playwright.chromium.launch_persistent_context(
                    str(temporary / "profile"),
                    executable_path=executable or playwright.chromium.executable_path,
                    headless=False, viewport=None,
                    args=[
                        "--no-sandbox", "--no-first-run",
                        "--no-default-browser-check", "--disable-background-networking",
                        "--disable-component-update", "--host-resolver-rules=MAP * ~NOTFOUND",
                        "--disable-extensions-except=" + str(extension),
                        "--load-extension=" + str(extension),
                    ],
                )
                try:
                    context.set_offline(True)
                    worker = (context.service_workers[0] if context.service_workers else
                              context.wait_for_event("serviceworker", timeout=10000))
                    context.pages[0].goto("about:blank")
                    worker.evaluate("chrome.action.openPopup()")
                    deadline = time.monotonic() + 5
                    samples = []
                    while time.monotonic() < deadline:
                        samples = worker.evaluate(
                            "chrome.storage.local.get('layoutSamples').then(x => x.layoutSamples || [])"
                        )
                        if len(samples) >= 24:
                            break
                        time.sleep(0.05)
                    # Discard initial auto-size transitions, retain ten settled samples.
                    result["native"] = samples[-10:]
                    assert len(samples) >= 24, "Native popup samples unavailable"
                    assert all(
                        360 <= row["inner"] <= 410 and 340 <= row["body"] <= 400
                        and 340 <= row["root"] <= 400 and fits(row)
                        for row in result["native"]
                    ), "Native popup collapsed, oversized, or clipped"
                    assert (max(row["body"] for row in result["native"]) -
                            min(row["body"] for row in result["native"]) <= 1), (
                        "Native popup size did not settle"
                    )
                    extension_id = worker.url.split("/")[2]
                    page = context.new_page()
                    page.goto("chrome-extension://" + extension_id + "/popup.html")
                    for width in (320, 380):
                        page.set_viewport_size({"width": width, "height": 700})
                        for font in (14, 21):
                            page.evaluate(
                                "(size) => document.documentElement.style.fontSize = size + 'px'",
                                font,
                            )
                            for card_open in (False, True):
                                page.locator("#card").evaluate(
                                    "(node, visible) => node.hidden = !visible", card_open
                                )
                                row = {"viewport": width, "font": font, "cardOpen": card_open,
                                       **page.evaluate(MEASURE)}
                                result["tabLayouts"].append(row)
                                assert fits(row), "Popup contents overflow the usable viewport"
                    result["status"] = "PASS"
                finally:
                    context.close()
    except Exception as error:
        result["error"] = str(error)
    finally:
        (output / "result.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2) + "\n"
        )
    print(json.dumps({key: value for key, value in result.items()
                      if key not in ("native", "tabLayouts")}, ensure_ascii=False))
    if result["status"] != "PASS":
        raise SystemExit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--browser-executable")
    args = parser.parse_args()
    run(args.runtime.resolve(), args.output.resolve(), args.browser_executable)

