"""Exact versioned STORE technical lifecycle remainder.

This is owner-authorized technical evidence only. It uses two fresh protected Opera
profiles, an explicitly pinned package SHA/version, normal device authorization,
synthetic temporary store credentials, real popup transfer controls, and one-device
local reset/re-auth. Frozen 0.2.6 remains the default identity for historical reruns;
later candidates must pass their exact expected SHA/version explicitly. It never
exercises marketplace providers or an AI send surface.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import time
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright


DEFAULT_PACKAGE_SHA256 = "579dc15aaf692fc9e96ad650e660ac0190bb7e136c949b7ad401e5bc82a909b5"
EXPECTED_BROWSER = "136.0.6008.22"
DEFAULT_MANIFEST_VERSION = "0.2.6"


class LifecycleFailure(Exception):
    pass


def require(value, code: str):
    if not value:
        raise LifecycleFailure(code)


def validate_package_identity(helper, carrier: Path, runtime: Path, expected_sha256: str, expected_version: str):
    actual_sha256 = helper.sha256(carrier)
    require(actual_sha256 == expected_sha256, "STORE_ZIP_SHA256_MISMATCH")
    try:
        manifest = json.loads((runtime / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        raise LifecycleFailure("PACKAGE_MANIFEST_READ_FAILED") from None
    actual_version = manifest.get("version") if isinstance(manifest, dict) else None
    require(actual_version == expected_version, "PACKAGE_MANIFEST_VERSION_MISMATCH")
    return actual_sha256, actual_version


def wait_for(fn, code: str, timeout: float = 20.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            value = fn()
            if value:
                return value
        except Exception:
            pass
        time.sleep(0.1)
    raise LifecycleFailure(code)


def load_helper(root: Path):
    helper_path = root / "tests/regression/extension-core/client-i1/exact-store-authenticated-controls.py"
    spec = importlib.util.spec_from_file_location("exact_store_authenticated_controls", helper_path)
    require(spec and spec.loader, "HELPER_IMPORT_FAILED")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def worker_status(worker) -> dict:
    return worker.evaluate(
        """async()=>{const s=await SellerAgentsControlClient.status();
        const a=await SellerAgentsControlClient.getAuthority();
        return {
          authenticated:s?.authenticated===true,
          workAllowed:s?.workAllowed===true,
          pending:Boolean(s?.pending),
          accountId:await SellerAgentsControlClient.currentAccount(),
          deviceId:a?.deviceId||null,
          authorityPresent:Boolean(a)
        };}"""
    )


def bootstrap_chatgpt(worker) -> dict:
    return worker.evaluate(
        """async()=>{const payload=await SellerAgentsControlClient.ensureForIdentity({ai_id:'chatgpt'});
        const s=await SellerAgentsControlClient.status();
        const a=await SellerAgentsControlClient.getAuthority();
        return {
          authenticated:s?.authenticated===true,
          workAllowed:s?.workAllowed===true,
          pending:Boolean(s?.pending),
          accountId:await SellerAgentsControlClient.currentAccount(),
          deviceId:a?.deviceId||null,
          aiStatus:payload?.ai?.status||null,
          profilePresent:Boolean(payload?.ai?.profile)
        };}"""
    )


def catalog_count(worker) -> int:
    return int(worker.evaluate("async()=> (await SellerAgentsActiveStoreCatalog.list()).length"))


def popup_for(context, worker):
    page = context.new_page()
    page.goto(worker.url.rsplit("/", 1)[0] + "/popup.html", wait_until="load")
    return page


def select_store(page, store_id: str):
    page.click("#ozon")
    wait_for(
        lambda: page.locator("#stores option").evaluate_all(
            "(rows,id)=>rows.some(row=>row.value===id)", store_id
        ),
        "STORE_OPTION_NOT_VISIBLE",
    )
    page.locator("#stores").select_option(store_id)


def delete_store(page, store_id: str):
    select_store(page, store_id)
    page.click("#remove")
    wait_for(lambda: page.locator("#confirmation").is_visible(), "DELETE_CONFIRMATION_NOT_VISIBLE")
    page.click("#confirm")
    wait_for(
        lambda: not page.locator("#stores option").evaluate_all(
            "(rows,id)=>rows.some(row=>row.value===id)", store_id
        ),
        "STORE_DELETE_FAILED",
    )


def flush_store_metadata(worker, store_id: str):
    entity = "store:" + store_id
    worker.evaluate(
        """async entity=>{
          for(let i=0;i<8;i++){
            await new Promise(resolve=>setTimeout(resolve,150));
            await SellerAgentsSyncJournal.syncNow('exact_lifecycle_cleanup');
            const j=await SellerAgentsSyncJournal.read();
            if(!Object.values(j.entries||{}).some(row=>row.entityId===entity)) break;
          }
        }""",
        entity,
    )
    return worker.evaluate(
        """async entity=>{
          const r=await SellerAgentsControlClient.synchronizeMetadata({
            syncVersion:'seller_agents_sync_v1',entries:[],readEntityIds:[entity]
          });
          const row=(r?.snapshots||[])[0]||null;
          return {
            present:Boolean(row),
            revision:Number(row?.serverRevision||0),
            kind:row?.serverState?.kind||null,
            lifecycleState:row?.serverState?.lifecycleState||null
          };
        }""",
        entity,
    )


def safe_network_tracker(helper, counts: Counter):
    def track(request):
        try:
            parsed = urlparse(request.url)
            host = (parsed.hostname or "").lower()
            method = request.method.upper()
            if helper.provider_host(host):
                counts["provider"] += 1
            if host == "chatgpt.com" and method == "POST":
                counts["ai_post"] += 1
            if "/v1/credential-transfers" in parsed.path:
                counts["transfer_total"] += 1
                if method == "POST" and parsed.path.endswith("/ack"):
                    counts["transfer_ack_post"] += 1
                if method == "GET" and parsed.path.endswith("/packet"):
                    counts["transfer_packet_get"] += 1
                if method == "POST" and parsed.path == "/v1/credential-transfers":
                    counts["transfer_create_post"] += 1
        except Exception:
            counts["tracker_error"] += 1
    return track


def reauthorize(helper, worker, session_path: Path):
    session = helper.load_technical_session(session_path)
    activation = worker.evaluate(
        """async()=>{const s=await SellerAgentsControlClient.startActivation();
        return {pending:s?.pending||null,authenticated:s?.authenticated===true};}"""
    )
    require(not activation.get("authenticated"), "RESET_REAUTH_PROFILE_NOT_FRESH")
    helper.approve_technical_activation(session, activation.get("pending"))
    wait_for(lambda: worker_status(worker)["authenticated"], "RESET_REAUTH_TIMEOUT", 120)
    return bootstrap_chatgpt(worker)


def run(args) -> dict:
    root = Path(__file__).resolve().parents[4]
    helper = load_helper(root)
    package_sha256, manifest_version = validate_package_identity(
        helper,
        args.carrier,
        args.source_runtime,
        args.expected_package_sha256,
        args.expected_manifest_version,
    )
    require(EXPECTED_BROWSER in helper.browser_product(args.browser_executable), "BROWSER_PRODUCT_VERSION_MISMATCH")
    expected_inventory = helper.carrier_inventory(args.carrier)
    require(helper.runtime_inventory(args.source_runtime) == expected_inventory, "SOURCE_RUNTIME_BYTES_MISMATCH")
    require(helper.runtime_inventory(args.recipient_runtime) == expected_inventory, "RECIPIENT_RUNTIME_BYTES_MISMATCH")
    require(not helper.profile_in_use(args.source_profile), "SOURCE_PROFILE_IN_USE")
    require(not helper.profile_in_use(args.recipient_profile), "RECIPIENT_PROFILE_IN_USE")

    counts: Counter = Counter()
    page_errors: Counter = Counter()
    temporary = {"source": False, "recipient": False}
    cleanup = {"source": False, "recipient": False, "serverTombstone": False}
    source = recipient = None
    source_popup = recipient_popup = None
    source_worker = recipient_worker = None
    store_id = None
    evidence = {}

    with sync_playwright() as pw:
        options = lambda runtime: {
            "executable_path": str(args.browser_executable),
            "headless": False,
            "args": [
                "--no-sandbox",
                "--disable-extensions-except=" + str(runtime),
                "--load-extension=" + str(runtime),
            ],
        }
        source = pw.chromium.launch_persistent_context(str(args.source_profile), **options(args.source_runtime))
        recipient = pw.chromium.launch_persistent_context(str(args.recipient_profile), **options(args.recipient_runtime))
        tracker = safe_network_tracker(helper, counts)
        source.on("request", tracker)
        recipient.on("request", tracker)
        source_worker = source.service_workers[0] if source.service_workers else source.wait_for_event("serviceworker", timeout=30000)
        recipient_worker = recipient.service_workers[0] if recipient.service_workers else recipient.wait_for_event("serviceworker", timeout=30000)
        source_popup = popup_for(source, source_worker)
        recipient_popup = popup_for(recipient, recipient_worker)
        source_popup.on("pageerror", lambda _error: page_errors.update(["source"]))
        recipient_popup.on("pageerror", lambda _error: page_errors.update(["recipient"]))

        try:
            before_source = worker_status(source_worker)
            before_recipient = worker_status(recipient_worker)
            require(before_source["authenticated"] and before_recipient["authenticated"], "TECHNICAL_AUTH_NOT_RESTORED")
            require(before_source["accountId"] == before_recipient["accountId"], "ACCOUNT_MISMATCH")
            require(before_source["deviceId"] and before_recipient["deviceId"] and before_source["deviceId"] != before_recipient["deviceId"], "DEVICE_IDENTITY_NOT_DISTINCT")
            require(catalog_count(source_worker) == 0 and catalog_count(recipient_worker) == 0, "NEW_PROFILE_NOT_PRISTINE")

            source_bootstrap = bootstrap_chatgpt(source_worker)
            recipient_bootstrap = bootstrap_chatgpt(recipient_worker)
            require(source_bootstrap["workAllowed"] and recipient_bootstrap["workAllowed"], "SIGNED_WORK_ADMISSION_FAILED")
            require(source_bootstrap["profilePresent"] and recipient_bootstrap["profilePresent"], "SIGNED_PROFILE_MISSING")

            marker = "OCTOPORT_LIFECYCLE_SYNTHETIC_" + str(int(time.time() * 1000))
            source_popup.click("#ozon")
            source_popup.click("#add")
            source_popup.locator("#name").fill("Octoport lifecycle synthetic")
            source_popup.locator("#seller-id").fill("synthetic-client")
            source_popup.locator("#seller-key").fill(marker)
            source_popup.click("#save")
            wait_for(lambda: catalog_count(source_worker) == 1, "SOURCE_TEMP_STORE_SAVE_FAILED")
            wait_for(
                lambda: source_popup.locator("#stores option").count() == 1
                and bool(source_popup.locator("#stores").input_value()),
                "SOURCE_TEMP_STORE_UI_REFRESH_FAILED",
            )
            store_id = source_popup.locator("#stores").input_value()
            require(bool(store_id), "SOURCE_TEMP_STORE_ID_MISSING")
            temporary["source"] = True

            metadata = source_worker.evaluate("async id=>SellerAgentsActiveStoreCatalog.metadataForSync(id)", store_id)
            recipient_marker = recipient_worker.evaluate(
                """async metadata=>{const s=await SellerAgentsActiveStoreCatalog.applyRemoteMetadata(metadata);
                const full=await SellerAgentsActiveStoreCatalog.get(s.id);
                return {
                  active:full.lifecycleState==='ACTIVE',
                  credentialsEmpty:Object.keys(full.credentials||{}).length===0,
                  credentialsStale:full.credentialsStale===true,
                  revisionPresent:typeof full.credentialRevision==='string'&&full.credentialRevision.length>0
                };}""",
                metadata,
            )
            require(recipient_marker["active"] and recipient_marker["credentialsEmpty"] and recipient_marker["credentialsStale"] and recipient_marker["revisionPresent"], "RECIPIENT_METADATA_MARKER_INVALID")
            temporary["recipient"] = True
            recipient_popup.reload(wait_until="load")
            select_store(recipient_popup, store_id)

            vault_before = recipient_worker.evaluate("async()=> (await SellerAgentsControlClient.listCredentialTransferRecipients()).length")
            recipient_popup.locator("#transfer-consent").uncheck()
            recipient_popup.click("#transfer-create")
            wait_for(lambda: "соглас" in recipient_popup.locator("#status").inner_text().lower(), "TRANSFER_REFUSAL_UI_MISSING")
            vault_after_refusal = recipient_worker.evaluate("async()=> (await SellerAgentsControlClient.listCredentialTransferRecipients()).length")
            require(vault_after_refusal == vault_before, "TRANSFER_REFUSAL_CREATED_REQUEST")

            recipient_popup.locator("#transfer-consent").check()
            recipient_popup.click("#transfer-create")
            wait_for(lambda: "Запрос создан" in recipient_popup.locator("#transfer-status").inner_text(), "TRANSFER_CREATE_UI_FAILED")
            wait_for(lambda: recipient_worker.evaluate("async()=> (await SellerAgentsControlClient.listCredentialTransferRecipients()).length") == 1, "TRANSFER_RECIPIENT_VAULT_MISSING")

            select_store(source_popup, store_id)
            source_popup.click("#transfer-discover")
            wait_for(lambda: "Найдено запросов" in source_popup.locator("#transfer-status").inner_text(), "TRANSFER_DISCOVER_UI_FAILED")

            recipient_popup.click("#transfer-receive")
            wait_for(lambda: "Передача принята" in recipient_popup.locator("#transfer-status").inner_text(), "TRANSFER_RECEIVE_UI_FAILED")
            transferred = recipient_worker.evaluate(
                """async id=>{const s=await SellerAgentsActiveStoreCatalog.get(id);
                return {hasSeller:Boolean(s.credentials?.seller?.apiKey),revision:s.credentialRevision};}""",
                store_id,
            )
            require(transferred["hasSeller"], "TRANSFER_CREDENTIAL_NOT_IMPORTED")
            first_revision = transferred["revision"]
            wait_for(lambda: recipient_worker.evaluate("async()=> (await SellerAgentsControlClient.listCredentialTransferRecipients()).length") == 0, "TRANSFER_RESULT_NOT_CONSUMED")

            ack_after_first = counts["transfer_ack_post"]
            packet_after_first = counts["transfer_packet_get"]
            recipient_popup.click("#transfer-receive")
            wait_for(lambda: "Активной передачи" in recipient_popup.locator("#transfer-status").inner_text(), "TRANSFER_REPLAY_UI_NOT_IDLE")
            after_replay = recipient_worker.evaluate("async id=>(await SellerAgentsActiveStoreCatalog.get(id)).credentialRevision", store_id)
            require(after_replay == first_revision, "TRANSFER_REPLAY_REAPPLIED")
            require(counts["transfer_ack_post"] == ack_after_first and counts["transfer_packet_get"] == packet_after_first, "TRANSFER_REPLAY_NETWORK_REPEAT")

            recipient_popup.locator("#transfer-consent").check()
            recipient_popup.click("#transfer-create")
            wait_for(lambda: "Запрос создан" in recipient_popup.locator("#transfer-status").inner_text(), "TRANSFER_REPEAT_CREATE_FAILED")
            source_popup.click("#transfer-discover")
            wait_for(lambda: "Найдено запросов" in source_popup.locator("#transfer-status").inner_text(), "TRANSFER_REPEAT_DISCOVER_FAILED")
            recipient_popup.click("#transfer-receive")
            wait_for(lambda: "Передача принята" in recipient_popup.locator("#transfer-status").inner_text(), "TRANSFER_REPEAT_RECEIVE_FAILED")
            wait_for(lambda: recipient_worker.evaluate("async()=> (await SellerAgentsControlClient.listCredentialTransferRecipients()).length") == 0, "TRANSFER_REPEAT_RESULT_NOT_CONSUMED")
            after_repeat = recipient_worker.evaluate("async id=>(await SellerAgentsActiveStoreCatalog.get(id)).credentialRevision", store_id)
            require(after_repeat == first_revision, "TRANSFER_REPEAT_CHANGED_REVISION")

            delete_store(recipient_popup, store_id)
            cleanup["recipient"] = True
            temporary["recipient"] = False
            delete_store(source_popup, store_id)
            cleanup["source"] = True
            temporary["source"] = False
            source_snapshot = flush_store_metadata(source_worker, store_id)
            recipient_snapshot = flush_store_metadata(recipient_worker, store_id)
            tombstone = recipient_snapshot if recipient_snapshot.get("present") else source_snapshot
            require(tombstone.get("kind") == "STORE_TOMBSTONE" or tombstone.get("lifecycleState") == "TOMBSTONED", "TEMP_METADATA_TOMBSTONE_NOT_VERIFIED")
            cleanup["serverTombstone"] = True
            require(catalog_count(source_worker) == 0 and catalog_count(recipient_worker) == 0, "TEMP_STORE_LOCAL_CLEANUP_FAILED")

            source_identity_before_reset = worker_status(source_worker)
            recipient_identity_before_reset = worker_status(recipient_worker)
            recipient_popup.click("#auth-reset")
            wait_for(lambda: recipient_popup.locator("#confirmation").is_visible(), "AUTH_RESET_CONFIRMATION_NOT_VISIBLE")
            recipient_popup.click("#confirm")
            wait_for(lambda: not worker_status(recipient_worker)["authenticated"], "AUTH_RESET_DID_NOT_SIGN_OUT")
            source_during_reset = worker_status(source_worker)
            require(source_during_reset["authenticated"] and source_during_reset["workAllowed"], "AUTH_RESET_AFFECTED_OTHER_INSTALLATION")
            require(source_during_reset["deviceId"] == source_identity_before_reset["deviceId"], "OTHER_DEVICE_ID_CHANGED")

            recipient_reauth = reauthorize(helper, recipient_worker, args.technical_session_file)
            require(recipient_reauth["authenticated"] and recipient_reauth["workAllowed"], "RESET_REAUTH_ADMISSION_FAILED")
            source_after_reauth = worker_status(source_worker)
            require(source_after_reauth["authenticated"] and source_after_reauth["workAllowed"], "REAUTH_AFFECTED_OTHER_INSTALLATION")
            require(recipient_reauth["accountId"] == source_after_reauth["accountId"], "REAUTH_ACCOUNT_CHANGED")
            require(recipient_reauth["deviceId"] != recipient_identity_before_reset["deviceId"], "REAUTH_DEVICE_DID_NOT_ROTATE")
            require(recipient_reauth["deviceId"] != source_after_reauth["deviceId"], "REAUTH_COLLIDED_WITH_OTHER_DEVICE")

            require(counts["provider"] == 0, "LIFECYCLE_EXECUTED_PROVIDER_REQUEST")
            require(counts["ai_post"] == 0, "LIFECYCLE_EXECUTED_AI_SEND")
            require(not page_errors, "POPUP_PAGE_ERROR")

            evidence = {
                "status": "PASS",
                "evidenceLevel": "EXACT_VERSIONED_PACKAGE_DEVELOPMENT_FLAG_TECHNICAL_LIFECYCLE",
                "packageSha256": package_sha256,
                "browserProduct": helper.browser_product(args.browser_executable),
                "manifestVersion": manifest_version,
                "runtimeFileCount": len(expected_inventory),
                "twoFreshDeviceFlows": True,
                "sameAccount": True,
                "distinctDevicesBeforeReset": True,
                "signedProfileAdmission": {
                    "source": source_bootstrap["workAllowed"],
                    "recipient": recipient_bootstrap["workAllowed"],
                    "profilePresentBoth": source_bootstrap["profilePresent"] and recipient_bootstrap["profilePresent"],
                },
                "transfer": {
                    "consentRefusalNoRequest": True,
                    "credentiallessMetadataMarkerBeforeReceive": True,
                    "uiCreateDiscoverReceive": True,
                    "credentialImportedOnlyAfterReceive": True,
                    "sameRequestReplayNoReapply": True,
                    "repeatNewRequestRevisionUnchanged": True,
                    "ackPosts": counts["transfer_ack_post"],
                    "packetReads": counts["transfer_packet_get"],
                },
                "cleanup": cleanup,
                "authResetReauth": {
                    "recipientSignedOutLocally": True,
                    "otherInstallationStayedAuthenticated": True,
                    "recipientReauthorizedNormally": True,
                    "recipientDeviceRotated": True,
                    "otherInstallationStayedWorkAllowed": True,
                },
                "network": {
                    "providerRequests": counts["provider"],
                    "aiPostRequests": counts["ai_post"],
                    "transferRequestsObserved": counts["transfer_total"],
                },
                "pageErrors": sum(page_errors.values()),
                "notClaimed": [
                    "STORE_CATALOG_INSTALLATION",
                    "LIVE_OWNER",
                    "HUMAN_EMAIL_LOGIN",
                    "HUMAN_PORTAL_LOGIN",
                    "LIVE_AI_WORK",
                    "PROVIDER_ACCEPTANCE",
                    "DEVICE_REVOCATION_DB_MUTATION",
                ],
            }
        finally:
            if store_id:
                for popup, key in ((recipient_popup, "recipient"), (source_popup, "source")):
                    if popup is None or not temporary.get(key):
                        continue
                    try:
                        delete_store(popup, store_id)
                        cleanup[key] = True
                        temporary[key] = False
                    except Exception:
                        pass
            if source_worker and store_id:
                try:
                    flush_store_metadata(source_worker, store_id)
                except Exception:
                    pass
            if recipient_worker and store_id:
                try:
                    flush_store_metadata(recipient_worker, store_id)
                except Exception:
                    pass
            if source:
                source.close()
            if recipient:
                recipient.close()
    return evidence


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--carrier", type=Path, required=True)
    parser.add_argument("--source-runtime", type=Path, required=True)
    parser.add_argument("--recipient-runtime", type=Path, required=True)
    parser.add_argument("--source-profile", type=Path, required=True)
    parser.add_argument("--recipient-profile", type=Path, required=True)
    parser.add_argument("--browser-executable", type=Path, required=True)
    parser.add_argument("--technical-session-file", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--expected-package-sha256", default=DEFAULT_PACKAGE_SHA256)
    parser.add_argument("--expected-manifest-version", default=DEFAULT_MANIFEST_VERSION)
    args = parser.parse_args()
    for name in ("carrier", "source_runtime", "recipient_runtime", "source_profile", "recipient_profile", "browser_executable", "technical_session_file", "output"):
        setattr(args, name, getattr(args, name).resolve())
    try:
        result = run(args)
        code = 0
    except LifecycleFailure as failure:
        result = {"status": "FAILED", "evidenceLevel": "NOT_ACCEPTED", "failureCode": str(failure)}
        code = 1
    except Exception:
        result = {"status": "FAILED", "evidenceLevel": "NOT_ACCEPTED", "failureCode": "UNEXPECTED_LIFECYCLE_FAILURE"}
        code = 1
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
