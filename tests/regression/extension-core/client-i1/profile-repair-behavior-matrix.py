"""Fixture-only ChatGPT repair behavior matrix for the accepted signed-profile consumer.

This test does not mint monitoring incident/baseline UUIDs. It proves bounded browser behavior
and validates fresh regression outputs that C can later bind to authoritative repair-case identity.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
FIXTURE = ROOT / "tests/regression/extension-core/fixtures/application-chat.html"
CONVERSATION = "44444444-4444-4444-8444-444444444444"
MARKER = "BRIDGE_BUTTON_TEST — это тест, сообщение не будет отправлено."


def load_c1():
    path = Path(__file__).with_name("browser_c1_acceptance.py")
    spec = importlib.util.spec_from_file_location("repair_matrix_c1", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


C1 = load_c1()
def wait_for(fn, label: str, timeout: float = 15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = fn()
        if value:
            return value
        time.sleep(0.05)
    raise AssertionError("TIMEOUT:" + label)


def get_worker(context):
    return context.service_workers[0] if context.service_workers else context.wait_for_event(
        "serviceworker", timeout=30000
    )


def tab_message(worker, tab_id: int, message: dict):
    return worker.evaluate(
        """async ({tabId,message})=>await new Promise((resolve,reject)=>{
          chrome.tabs.sendMessage(tabId,message,response=>{
            const e=chrome.runtime.lastError;
            if(e) reject(new Error(e.message)); else resolve(response);
          });
        })""",
        {"tabId": tab_id, "message": message},
    )


def bind_tab(worker, page):
    marker = f"repair-matrix-{time.monotonic_ns()}"
    page.evaluate("(value)=>{document.title=value}", marker)

    def current():
        return worker.evaluate(
            """async ({url,marker})=>{
              const rows=(await chrome.tabs.query({})).filter(t=>t.url===url&&t.title===marker);
              return rows.length===1?rows[0].id:null;
            }""",
            {"url": page.url, "marker": marker},
        )

    return wait_for(current, "chat_tab")


def expected(worker):
    return worker.evaluate(
        """async()=>{const s=await saSignedProfileSnapshot(),p=s.authority.payload.ai.profile;
        return {authority:{authGeneration:s.generation,
                           bootstrapSnapshotSha256:s.snapshot.bootstrapSnapshotSha256},
                profile:{profileKey:p.profileKey,revision:p.revision,
                         scopeVariant:p.scopeVariant,contentSha256:p.contentSha256}}}"""
    )


def options(runtime: Path):
    value = {
        "headless": True,
        "args": [
            "--no-sandbox",
            "--disable-dev-shm-usage",
            f"--disable-extensions-except={runtime}",
            f"--load-extension={runtime}",
        ],
    }
    if os.environ.get("SA_TEST_CHROMIUM"):
        value["executable_path"] = os.environ["SA_TEST_CHROMIUM"]
    else:
        value["channel"] = "chromium"
    return value


def run_dom_case(playwright, runtime: Path, private_key: Path, *, revision: int,
                 role: str, mutation: str, expected_picker: bool, case_id: str,
                 delivery_kind: str):
    with tempfile.TemporaryDirectory(prefix=f"octoport-repair-{case_id}-") as profile:
        launch = options(runtime)
        first = playwright.chromium.launch_persistent_context(profile, **launch)
        worker = get_worker(first)
        seeded = C1.seed_authority(
            worker,
            private_key,
            profile_revision=revision,
            composer_reference="composer-root",
            composer_kind="accessibility_role_name",
            composer_role=role,
        )
        worker_url = worker.url
        first.close()

        context = playwright.chromium.launch_persistent_context(profile, **launch)
        try:
            worker = get_worker(context)
            assert worker.url == worker_url
            status = worker.evaluate("async()=>SellerAgentsControlClient.status()")
            assert status["authenticated"] is True and status["workAllowed"] is True
            browser = worker.evaluate("()=>SellerAgentsBrowserIdentity.current()")
            assert browser.get("family") and browser.get("version")
            context.route(
                "https://chatgpt.com/**",
                lambda route: route.fulfill(
                    body=FIXTURE.read_text(encoding="utf-8"),
                    content_type="text/html",
                ),
            )
            page = context.new_page()
            page.goto(
                f"https://chatgpt.com/c/{CONVERSATION}",
                wait_until="domcontentloaded",
            )
            tab_id = bind_tab(worker, page)
            page_context = wait_for(
                lambda: tab_message(worker, tab_id, {"type": "OZ_PAGE_CONTEXT"}),
                "page_context",
            )
            assert page_context["ok"] is True and page_context["adapter_id"] == "chatgpt"
            current = expected(worker)
            ensured = tab_message(
                worker,
                tab_id,
                {"type": "OZ_SIGNED_AI_PROFILE_ENSURE", "expected": current},
            )
            assert ensured.get("ok") is True and ensured.get("applied") is True
            if mutation:
                page.evaluate(mutation)
            picker = tab_message(
                worker,
                tab_id,
                {"type": "OZ_START_SEND_BUTTON_PICKER"},
            )
            composer = page.locator("#prompt-textarea")
            composer_text = composer.inner_text() if composer.count() else ""
            sent_count = page.evaluate("Number(window.sent?.length||0)")
            if expected_picker:
                assert picker.get("ok") is True, picker
                assert composer_text == MARKER
                assert sent_count == 0
            else:
                assert picker.get("ok") is False, picker
                assert picker.get("code") == "CONTENT_ADAPTER_ERROR", picker
                assert sent_count == 0
            return {
                "id": case_id,
                "status": "PASS",
                "profile": {
                    "profileKey": current["profile"]["profileKey"],
                    "revision": revision,
                    "scopeVariant": current["profile"]["scopeVariant"],
                    "contentSha256": seeded["contentSha256"],
                    "composerRole": role,
                },
                "pickerOk": picker.get("ok") is True,
                "pickerCode": picker.get("code"),
                "deliveryKind": delivery_kind,
                "browser": {
                    "family": browser["family"],
                    "version": browser["version"],
                },
            }
        finally:
            context.close()
def load_json(path: Path):
    text = path.read_text(encoding="utf-8")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        rows = [line for line in text.splitlines() if line.strip()]
        return json.loads(rows[-1])


def sha256(path: Path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require_case_ids(value: dict, expected: set[str], label: str):
    assert value.get("status") == "PASS", (label, value)
    rows = value.get("results")
    assert isinstance(rows, list), (label, value)
    seen = {row.get("id") for row in rows if row.get("status") == "PASS"}
    missing = expected - seen
    assert not missing, (label, sorted(missing))


def require_dom_copy(value: dict):
    assert value.get("status") == "PASS", value
    cases = value.get("cases") or {}
    for name in [
        "response_copy_only_plain",
        "response_copy_data_state_plain",
        "localized_response_copy",
    ]:
        assert cases.get(name, [{}])[0].get("blocks") == [], (name, cases.get(name))
def require_native(value: dict):
    assert value.get("status") == "PASS", value
    checks = set(value.get("checks") or [])
    required = {
        "no replay",
        "Finish",
        "response-actions Copy excluded from code ownership",
        "user/editor/ambiguous/unrelated action rejection",
    }
    assert required <= checks, sorted(required - checks)


def evidence(path: Path, kind: str):
    return {
        "kind": kind,
        "path": str(path),
        "sha256": sha256(path),
    }


def main(args):
    args.output.mkdir(parents=True, exist_ok=False)
    consumer = load_json(args.consumer_result)
    runtime_result = load_json(args.runtime_result)
    dom = load_json(args.dom_result)
    native = load_json(args.native_result)

    require_case_ids(
        consumer,
        {"PROFILE-01-strict-mirror-and-cross-field-rejects",
         "PROFILE-02-worker-current-authority-request-receipt-and-Alice-hold",
         "PROFILE-08-failed-ensure-blocks-Start-and-Resume-before-legacy-action"},
        "consumer",
    )
    require_case_ids(
        runtime_result,
        {
            "RUNTIME-01-same-generation-update-defer-rollback-clear",
            "RUNTIME-02-out-of-order-stale-response-cannot-restore-old-profile",
            "RUNTIME-03-invalid-profile-rejected-and-ensure-fence-fails-closed",
            "RUNTIME-05-scope-change-stops-old-ChatGPT-profile-before-response",
        },
        "runtime",
    )
    require_dom_copy(dom)
    require_native(native)

    mutations = {
        "none": "",
        "cosmetic": """()=>{const c=document.querySelector('#prompt-textarea');
          c.classList.add('cosmetic-shell-v2');c.closest('form').dataset.theme='new';}""",
        "role_status": """()=>document.querySelector('#prompt-textarea')
          .setAttribute('role','status')""",
        "anchor_removed": """()=>{const c=document.querySelector('#prompt-textarea');
          c.removeAttribute('id');c.removeAttribute('data-testid');
          c.removeAttribute('contenteditable');c.setAttribute('role','status');}""",
    }

    with sync_playwright() as playwright:
        baseline = run_dom_case(
            playwright, args.runtime, args.fixture_private_key,
            revision=11, role="textbox", mutation=mutations["none"],
            expected_picker=True, case_id="UNCHANGED_BASELINE",
            delivery_kind="NO_CHANGE",
        )
        cosmetic = run_dom_case(
            playwright, args.runtime, args.fixture_private_key,
            revision=12, role="textbox", mutation=mutations["cosmetic"],
            expected_picker=True, case_id="COSMETIC_DOM_CHANGE",
            delivery_kind="NO_CHANGE",
        )
        broken_old = run_dom_case(
            playwright, args.runtime, args.fixture_private_key,
            revision=13, role="textbox", mutation=mutations["role_status"],
            expected_picker=False, case_id="IMPORTANT_ROLE_BREAK_OLD_PROFILE",
            delivery_kind="PROFILE_CANDIDATE_REQUIRED",
        )
        repaired = run_dom_case(
            playwright, args.runtime, args.fixture_private_key,
            revision=14, role="status", mutation=mutations["role_status"],
            expected_picker=True, case_id="VALID_PROFILE_REPAIR",
            delivery_kind="PROFILE_ONLY",
        )
        unrepairable = run_dom_case(
            playwright, args.runtime, args.fixture_private_key,
            revision=15, role="status", mutation=mutations["anchor_removed"],
            expected_picker=False, case_id="PACKAGED_ANCHOR_REMOVED",
            delivery_kind="PACKAGE_UPDATE",
        )

    assert baseline["pickerOk"] and cosmetic["pickerOk"]
    assert not broken_old["pickerOk"] and repaired["pickerOk"]
    assert not unrepairable["pickerOk"]
    assert broken_old["profile"]["composerRole"] == "textbox"
    assert repaired["profile"]["composerRole"] == "status"
    refs = [
        evidence(args.consumer_result, "SIGNED_PROFILE_CONSUMER"),
        evidence(args.runtime_result, "SIGNED_PROFILE_RUNTIME"),
        evidence(args.dom_result, "CHATGPT_DOM_COPY_OWNERSHIP"),
        evidence(args.native_result, "NATIVE_NO_REPLAY_FINISH"),
    ]
    result = {
        "schemaVersion": "chatgpt_profile_repair_fixture_matrix_v1",
        "status": "PASS",
        "evidenceClass": "FIXTURE_MATRIX",
        "authorityBoundary": {
            "incidentId": None,
            "acceptedBaselineId": None,
            "baselineProfileRevisionId": None,
            "candidateProfileRevisionId": None,
            "cBindingRequired": [
                "incidentId",
                "acceptedBaselineId",
                "baselineProfileRevisionId",
                "candidateProfileRevisionId",
                "currentAssignmentRevision",
            ],
            "note": (
                "Fixture evidence only. Authoritative repair-case UUIDs, acceptedBaselineId "
                "and current assignment revision must be supplied by C; this test never derives them."
            ),
        },
        "scope": {
            "provider": "chatgpt",
            "surface": "web",
            "target": "standard_composer",
            "variant": None,
            "monitoringLayer": "AUTHENTICATED_DEEP",
            "phase": "H4_CANDIDATE",
            "browserFamily": baseline["browser"]["family"],
            "browserVersion": baseline["browser"]["version"],
            "environmentClass": "LOCAL_DEVELOPMENT_SYNTHETIC",
        },
        "suite": {
            "machineKey": "chatgpt_standard_profile_repair_behavior",
            "revision": 1,
        },
        "matrix": [
            baseline,
            cosmetic,
            broken_old,
            repaired,
            unrepairable,
            {
                "id": "INVALID_PROFILE_FAILS_CLOSED",
                "status": "PASS",
                "deliveryKind": "REJECT_CANDIDATE",
                "sourceCase": "RUNTIME-03 / PROFILE-01",
            },
            {
                "id": "STALE_PROFILE_FAILS_CLOSED",
                "status": "PASS",
                "deliveryKind": "REJECT_CANDIDATE",
                "sourceCase": "RUNTIME-02",
            },
            {
                "id": "SCOPE_MISMATCH_CLEARS_OLD_PROFILE",
                "status": "PASS",
                "deliveryKind": "REJECT_CANDIDATE",
                "sourceCase": "RUNTIME-05",
            },
            {
                "id": "SIGNED_ROLLBACK_RESTORES_BASELINE",
                "status": "PASS",
                "deliveryKind": "PROFILE_ONLY",
                "sourceCase": "RUNTIME-01",
            },
            {
                "id": "WHOLE_RESPONSE_COPY_IS_NOT_CODE_COPY",
                "status": "PASS",
                "deliveryKind": "NO_CHANGE",
                "sourceCase": (
                    "response_copy_only_plain / response_copy_data_state_plain / "
                    "localized_response_copy"
                ),
            },
            {
                "id": "NO_REPLAY_AND_EXPLICIT_FINISH_PRESERVED",
                "status": "PASS",
                "deliveryKind": "NO_CHANGE",
                "sourceCase": "browser_application.py",
            },
        ],
        "deliveryRules": {
            "PROFILE_ONLY": (
                "Allowed only when the current packaged baseline still resolves the target "
                "element and an existing adapter_profile_v1 primitive can filter it correctly."
            ),
            "PACKAGE_UPDATE": (
                "Required when packaged DOM discovery no longer returns the target or a new "
                "detector/primitive/permission/client behavior would be needed."
            ),
        },
        "evidence": refs,
        "liveProviderCalls": 0,
        "productionApplyAuthority": False,
    }
    result["matrixSha256"] = hashlib.sha256(
        json.dumps(result["matrix"], ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    output = args.output / "matrix.json"
    output.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--fixture-private-key", type=Path, required=True)
    parser.add_argument("--consumer-result", type=Path, required=True)
    parser.add_argument("--runtime-result", type=Path, required=True)
    parser.add_argument("--dom-result", type=Path, required=True)
    parser.add_argument("--native-result", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.runtime = args.runtime.resolve()
    args.fixture_private_key = args.fixture_private_key.resolve()
    for key in ("consumer_result", "runtime_result", "dom_result", "native_result", "output"):
        setattr(args, key, getattr(args, key).resolve())
    raise SystemExit(main(args))
