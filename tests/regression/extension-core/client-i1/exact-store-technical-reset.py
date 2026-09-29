"""Exact frozen STORE 0.2.6 one-device reset/re-auth technical acceptance."""
from __future__ import annotations

import argparse
import importlib.util
import json
import time
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

EXPECTED_SHA256 = "579dc15aaf692fc9e96ad650e660ac0190bb7e136c949b7ad401e5bc82a909b5"
EXPECTED_BROWSER = "136.0.6008.22"


class ResetFailure(Exception):
    pass


def require(value, code):
    if not value:
        raise ResetFailure(code)


def wait_for(fn, code, timeout=20.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            result = fn()
            if result:
                return result
        except Exception:
            pass
        time.sleep(0.1)
    raise ResetFailure(code)


def load_helper(root):
    helper_path = root / "tests/regression/extension-core/client-i1/exact-store-authenticated-controls.py"
    spec = importlib.util.spec_from_file_location("exact_store_authenticated_controls", helper_path)
    require(spec and spec.loader, "HELPER_IMPORT_FAILED")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def status(worker):
    return worker.evaluate(
        """async()=>{const s=await SellerAgentsControlClient.status();
        const a=await SellerAgentsControlClient.getAuthority();
        return {
          authenticated:s?.authenticated===true,
          workAllowed:s?.workAllowed===true,
          accountId:await SellerAgentsControlClient.currentAccount(),
          deviceId:a?.deviceId||null
        };}"""
    )


def bootstrap(worker):
    return worker.evaluate(
        """async()=>{const p=await SellerAgentsControlClient.ensureForIdentity({ai_id:'chatgpt'});
        const s=await SellerAgentsControlClient.status();
        const a=await SellerAgentsControlClient.getAuthority();
        return {
          authenticated:s?.authenticated===true,
          workAllowed:s?.workAllowed===true,
          profilePresent:Boolean(p?.ai?.profile),
          accountId:await SellerAgentsControlClient.currentAccount(),
          deviceId:a?.deviceId||null
        };}"""
    )


def launch(pw, executable, runtime, profile, tracker):
    context = pw.chromium.launch_persistent_context(
        str(profile),
        executable_path=str(executable),
        headless=False,
        args=[
            "--no-sandbox",
            "--disable-extensions-except=" + str(runtime),
            "--load-extension=" + str(runtime),
        ],
    )
    context.on("request", tracker)
    worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker", timeout=30000)
    popup = context.new_page()
    popup.goto(worker.url.rsplit("/", 1)[0] + "/popup.html", wait_until="load")
    return context, worker, popup


def reauthorize(helper, worker, session_path):
    session = helper.load_technical_session(session_path)
    activation = worker.evaluate(
        """async()=>{const s=await SellerAgentsControlClient.startActivation();
        return {pending:s?.pending||null,authenticated:s?.authenticated===true};}"""
    )
    require(not activation["authenticated"], "RESET_DID_NOT_CLEAR_AUTH")
    helper.approve_technical_activation(session, activation["pending"])
    wait_for(lambda: status(worker)["authenticated"], "REAUTH_TIMEOUT", 120)
    return bootstrap(worker)


def run(args):
    root = Path(__file__).resolve().parents[4]
    helper = load_helper(root)
    require(helper.sha256(args.carrier) == EXPECTED_SHA256, "STORE_ZIP_SHA256_MISMATCH")
    require(EXPECTED_BROWSER in helper.browser_product(args.browser_executable), "BROWSER_PRODUCT_VERSION_MISMATCH")
    expected = helper.carrier_inventory(args.carrier)
    for runtime, label in (
        (args.source_runtime, "SOURCE"),
        (args.recipient_runtime, "RECIPIENT"),
        (args.main_runtime, "MAIN"),
    ):
        require(helper.runtime_inventory(runtime) == expected, label + "_RUNTIME_BYTES_MISMATCH")
    for profile, label in (
        (args.source_profile, "SOURCE"),
        (args.recipient_profile, "RECIPIENT"),
        (args.main_profile, "MAIN"),
    ):
        require(not helper.profile_in_use(profile), label + "_PROFILE_IN_USE")

    counts = Counter()
    page_errors = Counter()

    def tracker(request):
        try:
            host = (urlparse(request.url).hostname or "").lower()
            if helper.provider_host(host):
                counts["provider"] += 1
            if host == "chatgpt.com" and request.method.upper() == "POST":
                counts["ai_post"] += 1
        except Exception:
            counts["tracker_error"] += 1

    source = recipient = main = None
    with sync_playwright() as pw:
        source, source_worker, source_popup = launch(
            pw, args.browser_executable, args.source_runtime, args.source_profile, tracker
        )
        recipient, recipient_worker, recipient_popup = launch(
            pw, args.browser_executable, args.recipient_runtime, args.recipient_profile, tracker
        )
        source_popup.on("pageerror", lambda _error: page_errors.update(["source"]))
        recipient_popup.on("pageerror", lambda _error: page_errors.update(["recipient"]))
        try:
            source_before = status(source_worker)
            recipient_before = status(recipient_worker)
            source_store_count = int(source_worker.evaluate("async()=> (await SellerAgentsActiveStoreCatalog.list()).length"))
            recipient_store_count = int(recipient_worker.evaluate("async()=> (await SellerAgentsActiveStoreCatalog.list()).length"))
            require(source_before["authenticated"] and recipient_before["authenticated"], "AUTH_NOT_RESTORED")
            require(source_before["accountId"] == recipient_before["accountId"], "ACCOUNT_MISMATCH")
            require(source_before["deviceId"] != recipient_before["deviceId"], "DEVICE_NOT_DISTINCT")
            require(source_store_count == 0 and recipient_store_count == 0, "TEMP_STORE_RESIDUE_PRESENT")
            source_ready = bootstrap(source_worker)
            recipient_ready = bootstrap(recipient_worker)
            require(source_ready["workAllowed"] and recipient_ready["workAllowed"], "SIGNED_WORK_ADMISSION_FAILED")
            require(source_ready["profilePresent"] and recipient_ready["profilePresent"], "SIGNED_PROFILE_MISSING")

            recipient_popup.click("#auth-reset")
            wait_for(lambda: recipient_popup.locator("#confirmation").is_visible(), "RESET_CONFIRMATION_NOT_VISIBLE")
            recipient_popup.click("#confirm")
            wait_for(lambda: not status(recipient_worker)["authenticated"], "RESET_SIGNOUT_FAILED")
            source_during = status(source_worker)
            require(source_during["authenticated"] and source_during["workAllowed"], "RESET_AFFECTED_OTHER_INSTALLATION")
            require(source_during["deviceId"] == source_before["deviceId"], "OTHER_DEVICE_CHANGED")

            recipient_after = reauthorize(helper, recipient_worker, args.technical_session_file)
            source_after = status(source_worker)
            require(recipient_after["authenticated"] and recipient_after["workAllowed"], "REAUTH_ADMISSION_FAILED")
            require(recipient_after["profilePresent"], "REAUTH_SIGNED_PROFILE_MISSING")
            require(recipient_after["accountId"] == source_after["accountId"], "REAUTH_ACCOUNT_CHANGED")
            require(recipient_after["deviceId"] != recipient_before["deviceId"], "REAUTH_DEVICE_NOT_ROTATED")
            require(recipient_after["deviceId"] != source_after["deviceId"], "REAUTH_DEVICE_COLLISION")
            require(source_after["authenticated"] and source_after["workAllowed"], "REAUTH_AFFECTED_OTHER_INSTALLATION")

            source.close()
            source = None
            recipient.close()
            recipient = None

            main, main_worker, main_popup = launch(
                pw, args.browser_executable, args.main_runtime, args.main_profile, tracker
            )
            main_popup.on("pageerror", lambda _error: page_errors.update(["main"]))
            main_state = status(main_worker)
            main_store_count = int(
                main_worker.evaluate("async()=> (await SellerAgentsActiveStoreCatalog.list()).length")
            )
            require(main_state["authenticated"] and main_state["workAllowed"], "MAIN_TECHNICAL_PROFILE_REVOKED")
            require(main_store_count == 2, "MAIN_TECHNICAL_PROFILE_STORE_COUNT_CHANGED")
            require(counts["provider"] == 0, "RESET_RUN_EXECUTED_PROVIDER_REQUEST")
            require(counts["ai_post"] == 0, "RESET_RUN_EXECUTED_AI_SEND")
            require(not page_errors, "POPUP_PAGE_ERROR")

            return {
                "status": "PASS",
                "evidenceLevel": "EXACT_FROZEN_STORE_BYTES_DEVELOPMENT_FLAG_TECHNICAL_RESET_REAUTH",
                "packageSha256": EXPECTED_SHA256,
                "browserProduct": helper.browser_product(args.browser_executable),
                "runtimeFileCount": len(expected),
                "twoFreshInstallationsAuthenticatedNormally": True,
                "freshProfileStoreCountBeforeReset": 0,
                "signedWorkAdmissionBeforeReset": True,
                "recipientLocalResetSignedOut": True,
                "otherFreshInstallationStayedAuthenticated": True,
                "otherFreshInstallationStayedWorkAllowed": True,
                "recipientReauthorizedNormally": True,
                "recipientDeviceRotated": True,
                "mainTechnicalProfileStillAuthenticated": True,
                "mainTechnicalProfileStillWorkAllowed": True,
                "mainTechnicalProfileStoreCountPreserved": 2,
                "providerRequests": counts["provider"],
                "aiPostRequests": counts["ai_post"],
                "pageErrors": sum(page_errors.values()),
                "notClaimed": [
                    "STORE_CATALOG_INSTALLATION",
                    "LIVE_OWNER",
                    "HUMAN_EMAIL_LOGIN",
                    "HUMAN_PORTAL_LOGIN",
                    "LIVE_AI_WORK",
                    "ACCOUNT_WIDE_DEVICE_REVOCATION",
                ],
            }
        finally:
            for context in (main, recipient, source):
                if context:
                    context.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in (
        "carrier",
        "source-runtime",
        "recipient-runtime",
        "source-profile",
        "recipient-profile",
        "main-runtime",
        "main-profile",
        "browser-executable",
        "technical-session-file",
        "output",
    ):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    for key, value in vars(args).items():
        setattr(args, key, value.resolve())
    try:
        result = run(args)
        code = 0
    except ResetFailure as failure:
        result = {"status": "FAILED", "evidenceLevel": "NOT_ACCEPTED", "failureCode": str(failure)}
        code = 1
    except Exception:
        result = {"status": "FAILED", "evidenceLevel": "NOT_ACCEPTED", "failureCode": "UNEXPECTED_RESET_FAILURE"}
        code = 1
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
