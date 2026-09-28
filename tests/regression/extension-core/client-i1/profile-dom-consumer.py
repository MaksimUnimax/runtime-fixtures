"""Prove whether signed adapter_profile_v1 selector content reaches ChatGPT DOM behavior.

Controlled synthetic browser evidence only: no live AI/provider/store traffic.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
FIXTURE = ROOT / "tests/regression/extension-core/fixtures/application-chat.html"
ACCOUNT = "11111111-1111-4222-8111-111111111111"
DEVICE = "22222222-2222-4222-8222-222222222222"
SESSION = "33333333-3333-4333-8333-333333333333"
CONVERSATION = "44444444-4444-4444-8444-444444444444"


def until(fn, description: str, timeout: float = 15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = fn()
        if value:
            return value
        time.sleep(0.05)
    raise AssertionError(f"Timed out: {description}")

def load_c1_helpers():
    import importlib.util
    path = ROOT / "tests/regression/extension-core/client-i1/browser_c1_acceptance.py"
    spec = importlib.util.spec_from_file_location("profile_dom_c1_helpers", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


C1 = load_c1_helpers()


def tab_message(worker, tab_id: int, message: dict):
    return worker.evaluate(
        """async ({tabId, message}) => await new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(tabId, message, response => {
            const failure = chrome.runtime.lastError;
            if (failure) reject(new Error(failure.message));
            else resolve(response);
          });
        })""",
        {"tabId": tab_id, "message": message},
    )


def maybe_tab_message(worker, tab_id: int, message: dict):
    try:
        return tab_message(worker, tab_id, message)
    except Exception:
        return None


def run_case(playwright, runtime: Path, private_key: Path, revision: int, reference: str):
    with tempfile.TemporaryDirectory(prefix=f"octoport-profile-{revision}-") as profile:
        options = {
            "headless": True,
            "args": [
                "--no-sandbox",
                "--disable-dev-shm-usage",
                f"--disable-extensions-except={runtime}",
                f"--load-extension={runtime}",
            ],
        }
        if os.environ.get("SA_TEST_CHROMIUM"):
            options["executable_path"] = os.environ["SA_TEST_CHROMIUM"]
        else:
            options["channel"] = "chromium"
        context = playwright.chromium.launch_persistent_context(profile, **options)
        worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker")
        seeded = C1.seed_authority(
            worker,
            private_key,
            profile_revision=revision,
            composer_reference=reference,
        )
        context.close()

        context = playwright.chromium.launch_persistent_context(profile, **options)
        try:
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker")
            status = worker.evaluate("async()=>SellerAgentsControlClient.status()")
            authority = worker.evaluate("async()=>SellerAgentsControlClient.getAuthority()")
            assert status["authenticated"] is True
            assert status["workAllowed"] is True
            profile_value = authority["payload"]["ai"]["profile"]
            assert profile_value["revision"] == revision
            assert profile_value["contentSha256"] == seeded["contentSha256"]
            assert (
                profile_value["content"]["selectors"]["composer"]["primary"]["reference"]
                == reference
            )
            assert seeded["verified"] is True

            context.route(
                "https://chatgpt.com/**",
                lambda route: route.fulfill(
                    body=FIXTURE.read_text(encoding="utf-8"),
                    content_type="text/html",
                ),
            )
            page = context.new_page()
            page.goto(f"https://chatgpt.com/c/{CONVERSATION}", wait_until="domcontentloaded")

            tab_id = until(
                lambda: worker.evaluate(
                    """async()=>{const tabs=await chrome.tabs.query({url:'https://chatgpt.com/c/*'});return tabs[0]?.id||null}"""
                ),
                "ChatGPT tab id",
            )
            page_context = until(
                lambda: maybe_tab_message(worker, tab_id, {"type": "OZ_PAGE_CONTEXT"}),
                "content script page context",
            )
            assert page_context["ok"] is True
            assert page_context["adapter_id"] == "chatgpt"

            picker = tab_message(worker, tab_id, {"type": "OZ_START_SEND_BUTTON_PICKER"})
            assert picker["ok"] is True, picker
            expected = "BRIDGE_BUTTON_TEST — это тест, сообщение не будет отправлено."
            composer_text = page.locator("#prompt-textarea").inner_text()
            assert composer_text == expected
            assert page.evaluate("sent.length") == 0
            page.keyboard.press("Escape")
            until(
                lambda: page.locator("#prompt-textarea").inner_text() == "",
                "picker composer restoration",
            )

            return {
                "revision": revision,
                "composerReference": reference,
                "contentSha256": profile_value["contentSha256"],
                "signedVerified": seeded["verified"],
                "controlClientAuthenticated": status["authenticated"],
                "controlClientWorkAllowed": status["workAllowed"],
                "adapterId": page_context["adapter_id"],
                "pickerOk": picker["ok"],
                "composerText": composer_text,
                "sentCount": page.evaluate("sent.length"),
            }
        finally:
            context.close()


def run(runtime: Path, private_key: Path, output: Path):
    output.mkdir(parents=True, exist_ok=False)
    result = {
        "status": "RUNNING",
        "evidenceLevel": "CONTROLLED_SYNTHETIC_REAL_MV3_CONTENT_SCRIPT",
        "liveProviderCalls": 0,
        "installedAcceptance": False,
        "runtime": str(runtime),
    }

    with sync_playwright() as playwright:
        baseline = run_case(
            playwright,
            runtime,
            private_key,
            revision=1,
            reference="composer-root",
        )
        changed = run_case(
            playwright,
            runtime,
            private_key,
            revision=2,
            reference="page-root",
        )

    assert baseline["contentSha256"] != changed["contentSha256"]
    assert baseline["revision"] != changed["revision"]
    assert baseline["composerReference"] != changed["composerReference"]
    behavior_keys = ["adapterId", "pickerOk", "composerText", "sentCount"]
    assert {key: baseline[key] for key in behavior_keys} == {
        key: changed[key] for key in behavior_keys
    }

    result.update(
        status="PASS",
        disposition="NOT_WIRED",
        baseline=baseline,
        changed=changed,
        finding=(
            "Signed adapter_profile_v1 revision/hash/reference changed, "
            "but packaged ChatGPT composer behavior did not change."
        ),
        limits=[
            "No live AI, marketplace, provider, store, or owner credentials used.",
            "This proves current profile selector content is not consumed by this DOM path.",
            "It does not prove a future profile consumer or installed-store rollout.",
        ],
    )
    (output / "result.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(result, ensure_ascii=False))
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)

    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--fixture-private-key", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    run(
        args.runtime.resolve(),
        args.fixture_private_key.resolve(),
        args.output.resolve(),
    )
