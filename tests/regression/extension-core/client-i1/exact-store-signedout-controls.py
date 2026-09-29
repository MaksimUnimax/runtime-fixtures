"""Exact Chromium-family STORE ZIP signed-out popup acceptance.

Loads the actual ZIP bytes into a real Chromium-family browser via development flags.
This is installed-synthetic evidence, not browser-store catalog installation.
No auth intent, provider request, marketplace credential, or live owner action is used.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import tempfile
import time
import zipfile
from pathlib import Path

from playwright.sync_api import sync_playwright


CONTROL_IDS = [
    "auth-start", "auth-open", "auth-cancel", "auth-reset",
    "firefox-technical-grant", "firefox-technical-revoke",
    "ozon", "wildberries", "stores", "add", "edit", "remove",
    "name", "seller-id", "seller-key", "performance-id", "performance-key",
    "clear-performance", "token", "personal", "save", "cancel",
    "check-seller", "check-performance", "check-token",
    "start", "work-resume", "visibility", "finish", "resume",
    "transfer-consent", "transfer-create", "transfer-discover", "transfer-receive",
    "backup-password", "backup-password-confirm", "backup-export", "backup-file",
    "backup-import-password", "backup-preview", "backup-import",
    "support-generate", "support-snapshot", "confirm", "reject",
]

def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def element_states(page):
    return page.evaluate(
        """ids => Object.fromEntries(ids.map(id => {
          const element = document.getElementById(id);
          if (!element) return [id, {missing: true}];
          const rect = element.getBoundingClientRect();
          return [id, {
            hidden: element.hidden,
            disabled: Boolean(element.disabled),
            visible: Boolean(rect.width || rect.height),
            text: (element.innerText || element.value || "").trim(),
          }];
        }))""",
        CONTROL_IDS,
    )


def resolve_install_method(browser_product: str, requested: str) -> str:
    if requested != "auto":
        return requested
    normalized = browser_product.casefold()
    if "google chrome" in normalized or "yandex" in normalized:
        return "cdp"
    return "cli"


def load_unpacked_via_cdp(context, runtime: Path) -> str:
    session = context.browser.new_browser_cdp_session()
    reply = session.send("Extensions.loadUnpacked", {"path": str(runtime)})
    extension_id = reply.get("id")
    if not extension_id:
        raise AssertionError("CDP_EXTENSION_ID_MISSING")
    return extension_id


def wait_for_exact_extension_worker(context, expected_version: str, timeout_ms=30000):
    deadline = time.monotonic() + timeout_ms / 1000
    while time.monotonic() < deadline:
        for worker in context.service_workers:
            try:
                manifest = worker.evaluate("()=>chrome.runtime.getManifest()")
            except Exception:
                continue
            if (
                manifest.get("version") == expected_version
                and manifest.get("name") == "Octoport — Ozon + Wildberries"
            ):
                return worker
        time.sleep(0.1)
    raise AssertionError("EXTENSION_SERVICE_WORKER_NOT_OBSERVED")


def run(args):
    if sha256(args.carrier) != args.expected_sha256:
        raise AssertionError("STORE_ZIP_SHA256_MISMATCH")
    browser_product = subprocess.check_output(
        [str(args.browser_executable), "--version"], text=True
    ).strip()
    if args.expected_browser_product not in browser_product:
        raise AssertionError("BROWSER_PRODUCT_VERSION_MISMATCH")
    install_method = resolve_install_method(browser_product, args.install_method)
    external_requests = []
    page_errors = []
    with tempfile.TemporaryDirectory(prefix="octoport-store-signedout-") as temporary:
        runtime = Path(temporary) / "runtime"
        runtime.mkdir()
        with zipfile.ZipFile(args.carrier) as archive:
            archive.extractall(runtime)

        with sync_playwright() as playwright:
            with tempfile.TemporaryDirectory(prefix="octoport-browser-profile-") as profile:
                launch_args = ["--no-sandbox"]
                launch_kwargs = {}
                if install_method == "cdp":
                    launch_args.append("--enable-unsafe-extension-debugging")
                    launch_kwargs["ignore_default_args"] = ["--disable-extensions"]
                else:
                    launch_args.extend([
                        f"--disable-extensions-except={runtime}",
                        f"--load-extension={runtime}",
                    ])
                context = playwright.chromium.launch_persistent_context(
                    profile,
                    executable_path=str(args.browser_executable),
                    headless=False,
                    args=launch_args,
                    **launch_kwargs,
                )
                try:
                    context.on(
                        "request",
                        lambda request: external_requests.append(request.url)
                        if request.url.startswith(("http://", "https://"))
                        else None,
                    )
                    if install_method == "cdp":
                        extension_id = load_unpacked_via_cdp(context, runtime)
                        popup_url = f"chrome-extension://{extension_id}/popup.html"
                    else:
                        worker = wait_for_exact_extension_worker(
                            context, args.expected_version
                        )
                        extension_id = worker.url.split("://", 1)[1].split("/", 1)[0]
                        popup_url = worker.url.rsplit("/", 1)[0] + "/popup.html"
                    popup = context.new_page()
                    popup.on("pageerror", lambda error: page_errors.append(str(error)))
                    popup.goto(popup_url, wait_until="load")
                    popup.wait_for_function(
                        """() => {
                          const catalog = document.getElementById("catalog");
                          const account = document.getElementById("account");
                          return Boolean(
                            catalog && account && catalog.hidden === true &&
                            /Вход не выполнен/.test(account.textContent || "")
                          );
                        }"""
                    )
                    states = element_states(popup)
                    assert states["auth-start"]["visible"]
                    assert not states["auth-start"]["disabled"]
                    assert states["support-generate"]["visible"]
                    assert not states["support-generate"]["disabled"]
                    for control_id in ("ozon", "start", "backup-export"):
                        assert not states[control_id]["visible"], (control_id, states[control_id])
                    assert not states["firefox-technical-grant"]["visible"]

                    popup.click("#support-generate")
                    popup.wait_for_function(
                        """() =>
                          !document.getElementById("support-snapshot").hidden &&
                          document.getElementById("support-snapshot").value.length > 0"""
                    )
                    snapshot = json.loads(
                        popup.locator("#support-snapshot").input_value()
                    )
                    manifest = popup.evaluate("()=>chrome.runtime.getManifest()")
                    assert manifest["version"] == args.expected_version
                    deadline = time.monotonic() + 5
                    while time.monotonic() < deadline:
                        if any(
                            item.url.startswith(f"chrome-extension://{extension_id}/")
                            for item in context.service_workers
                        ):
                            break
                        popup.wait_for_timeout(100)
                    extension_workers = [
                        item.url for item in context.service_workers
                        if item.url.startswith(f"chrome-extension://{extension_id}/")
                    ]
                    assert extension_workers, "EXTENSION_SERVICE_WORKER_NOT_OBSERVED"
                    assert snapshot["extension"]["version"] == args.expected_version
                    assert snapshot["auth"]["authenticated"] is False
                    assert snapshot["auth"]["workAllowed"] is False
                    assert snapshot["privacy"]["credentialsIncluded"] is False
                    assert snapshot["privacy"]["conversationIdentifiersIncluded"] is False
                    assert snapshot["privacy"]["marketplacePayloadIncluded"] is False
                    popup.wait_for_timeout(200)
                    assert external_requests == [], external_requests
                    assert page_errors == [], page_errors

                    result = {
                        "status": "PASS",
                        "evidenceLevel": "INSTALLED_SYNTHETIC_EXACT_STORE_SIGNED_OUT",
                        "carrier": args.carrier.name,
                        "packageSha256": args.expected_sha256,
                        "browserProduct": browser_product,
                        "browserEngine": context.browser.version,
                        "installMethod": install_method,
                        "extensionId": extension_id,
                        "serviceWorkerUrl": extension_workers[0],
                        "manifest": {
                            "name": manifest["name"],
                            "version": manifest["version"],
                            "manifestVersion": manifest["manifest_version"],
                        },
                        "states": states,
                        "supportSnapshot": snapshot,
                        "externalRequests": external_requests,
                        "pageErrors": page_errors,
                        "limits": [
                            "auth-start is not clicked; live auth intent is outside this boundary",
                            "authenticated catalog/work/transfer/backup controls stay hidden until ordinary signed login",
                            "development-flag load of exact ZIP is not browser-store catalog installation",
                        ],
                    }
                    args.output.parent.mkdir(parents=True, exist_ok=True)
                    args.output.write_text(
                        json.dumps(result, ensure_ascii=False, indent=2),
                        encoding="utf-8",
                    )
                    print(json.dumps(result, ensure_ascii=False))
                    return result
                finally:
                    context.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--carrier", type=Path, required=True)
    parser.add_argument("--browser-executable", type=Path, required=True)
    parser.add_argument("--expected-browser-product", required=True)
    parser.add_argument("--expected-version", required=True)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--install-method", choices=("auto", "cli", "cdp"), default="auto")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    run(args)

if __name__ == "__main__":
    main()
