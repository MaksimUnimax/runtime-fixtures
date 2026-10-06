"""Prepared exact STORE 0.2.6 post-login owner-control acceptance helper.

This helper never fabricates or injects extension authentication. Manual wait-auth still
requires ordinary portal login in the same dedicated persistent browser profile; the explicit
technical-auth mode instead uses only the owner-authorized real portal session to approve the
normal server device flow. Output is privacy-safe: no credential field
values, OTPs, account/store IDs, store names, file paths from file inputs, dialogue text,
request URLs, headers or bodies are serialized.

Modes:
- describe: print the deterministic control plan only.
- prepare: verify the exact carrier/browser and create/verify stable runtime + profile dirs.
- wait-auth: launch the dedicated profile and wait for ordinary owner login; read-only.
- technical-auth: use one explicitly authorized protected portal-session receipt to approve
  the extension's normal device flow, then wait for the extension's own token/bootstrap.
- local-matrix: on an already ordinarily authenticated **owner-test** profile, exercise the
  explicitly authorized temporary-store UI boundary. It requires --allow-local-test-stores.
  Normal product metadata/tombstone sync may occur on that owner-test control plane.
Provider checks, live AI Work, transfer and auth reset remain gated and are never executed
by these modes.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import shutil
import subprocess
import tempfile
import time
import uuid
import zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

from playwright.sync_api import sync_playwright


SENSITIVE_INPUT_IDS = {
    "seller-id", "seller-key", "performance-id", "performance-key", "token",
    "backup-password", "backup-password-confirm", "backup-file",
    "backup-import-password",
}
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
PROVIDER_HOST_SUFFIXES = (
    "ozon.ru", "wildberries.ru", "advert-api.ozon.ru", "performance.ozon.ru",
)
PLAN = [
    {"phase": 0, "group": "identity", "controls": [],
     "outcome": "exact ZIP SHA + actual browser product + stable runtime/profile boundary"},
    {"phase": 1, "group": "ordinary_auth",
     "controls": ["auth-start", "auth-open", "auth-cancel"],
     "outcome": "MANUAL_WAIT_AUTH_OR_EXPLICIT_AUTOMATED_TECHNICAL_AUTH; technical mode uses normal server device approval and never injects extension auth state"},
    {"phase": 2, "group": "safe_state",
     "controls": ["ozon", "wildberries", "stores", "add", "edit", "remove", "save", "cancel", "confirm", "reject"],
     "outcome": "OWNER_TEST_TEMP_STORES; pre-existing stores protected by before/after fingerprint; provider requests forbidden"},
    {"phase": 3, "group": "local_options",
     "controls": ["personal", "clear-performance"],
     "outcome": "TEMP_STORE_ONLY; exercise local metadata/credential-presence behavior without reading secrets"},
    {"phase": 4, "group": "diagnostics",
     "controls": ["support-generate", "support-snapshot"],
     "outcome": "PRIVACY_SAFE; no credentials/dialogue/store/account identifiers serialized"},
    {"phase": 5, "group": "backup",
     "controls": ["backup-export", "backup-preview", "backup-import"],
     "outcome": "RUN_ONLY_IF_PREEXISTING_STORE_COUNT_ZERO; encrypted temp file is deleted"},
    {"phase": 6, "group": "provider_checks",
     "controls": ["check-seller", "check-performance", "check-token"],
     "outcome": "GATED_NOT_RUN; requires real read-only provider boundary"},
    {"phase": 7, "group": "work",
     "controls": ["start", "work-resume", "visibility", "finish", "resume"],
     "outcome": "GATED_NOT_RUN; requires real supported AI context and explicit owner-test boundary"},
    {"phase": 8, "group": "transfer",
     "controls": ["transfer-consent", "transfer-create", "transfer-discover", "transfer-receive"],
     "outcome": "GATED_NOT_RUN; requires second ordinarily authenticated installation"},
    {"phase": 9, "group": "auth_reset",
     "controls": ["auth-reset"],
     "outcome": "GATED_NOT_RUN; destructive logout/re-auth boundary"},
]


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def browser_product(executable: Path) -> str:
    return subprocess.check_output([str(executable), "--version"], text=True).strip()


def require_exact_browser_product(product: str, expected_product: str) -> None:
    accepted_shape = re.fullmatch(
        r"(?:Google Chrome )?[0-9]+(?:\.[0-9]+){3}", expected_product
    )
    if not accepted_shape or product != expected_product:
        raise AssertionError("BROWSER_PRODUCT_VERSION_MISMATCH")


def validate_control_directory_path(
    path: Path, symlink_code: str, permissions_code: str
) -> None:
    """Reject path traversal through symlinks or an externally writable owner boundary.

    This helper runs inside a single-owner test workspace. The deepest existing path
    component must be a directory owned by this uid and not writable by group/other.
    That prevents an untrusted peer from replacing a checked missing descendant before
    mkdir/extraction. A concurrently malicious process running as the same uid/root is
    outside this helper's isolation boundary and must be excluded operationally.
    """
    absolute = Path(os.path.abspath(path))
    current = Path(absolute.anchor)
    deepest = current.lstat()
    if not stat.S_ISDIR(deepest.st_mode):
        raise AssertionError(permissions_code)
    for part in absolute.parts[1:]:
        current = current / part
        try:
            info = current.lstat()
        except FileNotFoundError:
            break
        except OSError:
            raise AssertionError(symlink_code) from None
        if stat.S_ISLNK(info.st_mode):
            raise AssertionError(symlink_code)
        if not stat.S_ISDIR(info.st_mode):
            raise AssertionError(permissions_code)
        deepest = info
    if deepest.st_uid != os.geteuid() or deepest.st_mode & 0o022:
        raise AssertionError(permissions_code)


def profile_in_use(path: Path, proc_root: Path = Path("/proc")) -> bool:
    """Inspect exact argv entries; an inspection failure never means unused.

    This is an advisory preflight. Chromium's own profile lock still arbitrates
    another launch between inspection and launch_persistent_context.
    """
    expected = path.resolve()
    try:
        processes = list(proc_root.iterdir())
        for process in processes:
            if not process.name.isdecimal():
                continue
            try:
                argv = process.joinpath("cmdline").read_bytes().split(b"\0")
                for index, argument in enumerate(argv):
                    if argument.startswith(b"--user-data-dir="):
                        value = argument.split(b"=", 1)[1]
                    elif argument == b"--user-data-dir" and index + 1 < len(argv):
                        value = argv[index + 1]
                    else:
                        continue
                    if not value:
                        continue
                    candidate = Path(value.decode("utf-8", errors="surrogateescape"))
                    if not candidate.is_absolute():
                        candidate = process.joinpath("cwd").resolve(strict=True) / candidate
                    if candidate.resolve() == expected:
                        return True
            except (FileNotFoundError, ProcessLookupError):
                # Normal /proc race: the inspected process has already exited.
                continue
    except OSError:
        raise AssertionError("PROFILE_USAGE_INSPECTION_FAILED") from None
    return False


def safe_failure_code(failure: Exception) -> str:
    known = {
        "STORE_ZIP_SHA256_MISMATCH", "BROWSER_PRODUCT_VERSION_MISMATCH",
        "PACKAGE_MANIFEST_INVALID", "EXTENSION_VERSION_MISMATCH",
        "RUNTIME_ROOT_SYMLINK_REJECTED", "PROFILE_ROOT_SYMLINK_REJECTED",
        "RUNTIME_ROOT_PERMISSIONS_UNSAFE", "PROFILE_ROOT_PERMISSIONS_UNSAFE",
        "DEDICATED_PROFILE_ALREADY_IN_USE", "DEDICATED_PROFILE_PERMISSIONS_UNSAFE", "PROFILE_USAGE_INSPECTION_FAILED",
        "UNSAFE_ZIP_MEMBER", "ZIP_SYMLINK_REJECTED", "RUNTIME_SYMLINK_REJECTED",
        "STABLE_RUNTIME_BYTES_MISMATCH", "RUNTIME_EXTRACTION_MISMATCH",
        "ORDINARY_AUTH_REQUIRED",
        "LOCAL_TEST_STORES_EXPLICIT_FLAG_REQUIRED", "POPUP_PAGE_ERROR",
        "PREEXISTING_STORE_STATE_NOT_RESTORED", "LOCAL_PHASE_EXECUTED_PROVIDER_REQUEST",
        "TECHNICAL_SESSION_PERMISSIONS_UNSAFE", "TECHNICAL_SESSION_RECEIPT_INVALID",
        "TECHNICAL_AUTH_API_REJECTED", "TECHNICAL_AUTH_API_UNAVAILABLE",
        "TECHNICAL_AUTH_API_INVALID_RESPONSE", "TECHNICAL_AUTH_ACCOUNT_MEMBERSHIP_MISMATCH",
        "TECHNICAL_AUTH_PENDING_INVALID", "TECHNICAL_AUTH_APPROVAL_INVALID",
        "TECHNICAL_AUTH_PROFILE_NOT_FRESH", "TECHNICAL_AUTH_TIMEOUT",
        "TECHNICAL_AUTH_REDIRECT_REJECTED", "TECHNICAL_AUTH_ORIGIN_REJECTED",
    }
    if isinstance(failure, AssertionError) and str(failure) in known:
        return str(failure)
    return "OWNER_CONTROL_HELPER_FAILED"


def safe_member(name: str) -> bool:
    p = Path(name)
    return not p.is_absolute() and ".." not in p.parts and name not in {"", "."}


def carrier_inventory(carrier: Path) -> dict[str, str]:
    with zipfile.ZipFile(carrier) as archive:
        rows = {}
        for info in archive.infolist():
            if info.is_dir():
                continue
            if not safe_member(info.filename):
                raise AssertionError("UNSAFE_ZIP_MEMBER")
            mode = (info.external_attr >> 16) & 0o170000
            if mode == 0o120000:
                raise AssertionError("ZIP_SYMLINK_REJECTED")
            rows[info.filename] = sha256_bytes(archive.read(info.filename))
        return rows


def runtime_inventory(runtime: Path) -> dict[str, str]:
    rows = {}
    for item in sorted(runtime.rglob("*")):
        if item.is_symlink():
            raise AssertionError("RUNTIME_SYMLINK_REJECTED")
        if item.is_file():
            rows[item.relative_to(runtime).as_posix()] = sha256(item)
    return rows


def carrier_manifest_version(carrier: Path) -> str:
    """Read only the inert manifest version; never execute package code."""
    try:
        with zipfile.ZipFile(carrier) as archive:
            manifests = [
                info for info in archive.infolist()
                if info.filename == "manifest.json" and not info.is_dir()
            ]
            if len(manifests) != 1 or manifests[0].file_size > 256 * 1024:
                raise AssertionError("PACKAGE_MANIFEST_INVALID")
            if stat.S_ISLNK(manifests[0].external_attr >> 16):
                raise AssertionError("PACKAGE_MANIFEST_INVALID")
            value = json.loads(archive.read(manifests[0]).decode("utf-8"))
    except AssertionError:
        raise
    except (OSError, UnicodeError, json.JSONDecodeError, zipfile.BadZipFile):
        raise AssertionError("PACKAGE_MANIFEST_INVALID") from None
    version = value.get("version") if isinstance(value, dict) else None
    if not isinstance(version, str) or not version.strip():
        raise AssertionError("PACKAGE_MANIFEST_INVALID")
    return version


def ensure_exact_runtime(carrier: Path, runtime: Path) -> dict:
    expected = carrier_inventory(carrier)
    if runtime.exists():
        actual = runtime_inventory(runtime)
        if actual != expected:
            raise AssertionError("STABLE_RUNTIME_BYTES_MISMATCH")
        created = False
    else:
        runtime.mkdir(parents=True)
        with zipfile.ZipFile(carrier) as archive:
            archive.extractall(runtime)
        actual = runtime_inventory(runtime)
        if actual != expected:
            raise AssertionError("RUNTIME_EXTRACTION_MISMATCH")
        created = True
    return {"created": created, "fileCount": len(expected)}


def safe_element_states(page) -> dict:
    return page.evaluate(
        """({ids,sensitive}) => Object.fromEntries(ids.map(id => {
          const element = document.getElementById(id);
          if (!element) return [id, {missing:true}];
          const rect = element.getBoundingClientRect();
          const row = {
            tag: element.tagName.toLowerCase(),
            hidden: Boolean(element.hidden),
            disabled: Boolean(element.disabled),
            visible: Boolean(rect.width || rect.height),
          };
          if (!sensitive.includes(id) && !['input','textarea','select'].includes(row.tag))
            row.label = String(element.textContent || '').trim().slice(0,120);
          if (row.tag === 'input') row.inputType = element.type || 'text';
          return [id,row];
        }))""",
        {"ids": CONTROL_IDS, "sensitive": sorted(SENSITIVE_INPUT_IDS)},
    )


def safe_popup_state(page) -> dict:
    return page.evaluate(
        """async () => {
          const tabs = await chrome.tabs.query({active:true,currentWindow:true});
          const state = await chrome.runtime.sendMessage({type:'SA_POPUP_STATE',tab_id:tabs[0]?.id});
          if (!state?.ok) return {ok:false};
          const stores = Array.isArray(state.stores) ? state.stores : [];
          const byMarketplace = stores.reduce((a,s)=>{a[s.marketplace]=(a[s.marketplace]||0)+1;return a;},{});
          return {
            ok:true,
            auth:{authenticated:state.auth?.authenticated===true,workAllowed:state.auth?.workAllowed===true},
            storeCount:stores.length,
            byMarketplace,
            credentialPresence:{
              seller:stores.filter(s=>s.sellerPresent===true).length,
              performance:stores.filter(s=>s.performancePresent===true).length,
              token:stores.filter(s=>s.tokenPresent===true).length,
            },
            aiFamily:state.identity?.ai_id||null,
            workState:state.work?.state||null,
            workActive:state.context?.work_active===true,
            buttonVisible:state.context?.button_visible===true,
            quotaWait:state.operation?.quota_wait===true,
            pending:Boolean(state.pending),
          };
        }"""
    )


def store_fingerprint(page) -> str:
    return page.evaluate(
        """async () => {
          const tabs = await chrome.tabs.query({active:true,currentWindow:true});
          const state = await chrome.runtime.sendMessage({type:'SA_POPUP_STATE',tab_id:tabs[0]?.id});
          const rows=(state?.stores||[]).map(s=>({
            id:s.id,marketplace:s.marketplace,credentialRevision:s.credentialRevision||null,
            metadataRevision:s.metadataRevision||null,lifecycleState:s.lifecycleState||null,
            sellerPresent:s.sellerPresent===true,performancePresent:s.performancePresent===true,
            tokenPresent:s.tokenPresent===true,personalDataEnabled:s.personalDataEnabled===true
          })).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
          const bytes=new TextEncoder().encode(JSON.stringify(rows));
          const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
          return [...digest].map(x=>x.toString(16).padStart(2,'0')).join('');
        }"""
    )


def wait_for(fn, description: str, timeout: float = 10):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = fn()
        if value:
            return value
        time.sleep(0.1)
    raise AssertionError(f"TIMEOUT:{description}")


def auth_status(worker) -> dict:
    value = worker.evaluate(
        """async()=>{const s=await SellerAgentsControlClient.status();
        const code=typeof s?.lastError?.code==='string'&&/^[A-Z0-9_]{1,64}$/.test(s.lastError.code)
          ? s.lastError.code : null;
        return {
          authenticated:s?.authenticated===true,
          workAllowed:s?.workAllowed===true,
          pending:Boolean(s?.pending),
          authorityPresent:Boolean(s?.authority),
          lastErrorCode:code,
        };}"""
    )
    return {
        "authenticated": bool(value.get("authenticated")),
        "workAllowed": bool(value.get("workAllowed")),
        "pending": bool(value.get("pending")),
        "authorityPresent": bool(value.get("authorityPresent")),
        "lastErrorCode": value.get("lastErrorCode"),
    }


def visible_option(page, text: str) -> bool:
    return page.locator("#stores option").filter(has_text=text).count() > 0


def select_store_label(page, label: str):
    page.locator("#stores").select_option(label=label)
    page.wait_for_timeout(100)


def provider_host(host: str) -> bool:
    host = host.lower()
    return any(host == suffix or host.endswith("." + suffix) for suffix in PROVIDER_HOST_SUFFIXES)


TECHNICAL_API_ORIGIN = "https://api.octoport.ru"
TECHNICAL_SESSION_MAX_BYTES = 65536
TECHNICAL_RESPONSE_MAX_BYTES = 1048576


def load_technical_session(path: Path) -> dict:
    # Open the protected directory, then the file relative to that descriptor.
    # Do not resolve symlinks before these nofollow checks.
    try:
        parent_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    except OSError:
        raise AssertionError("TECHNICAL_SESSION_PERMISSIONS_UNSAFE") from None
    try:
        parent = os.fstat(parent_fd)
        if parent.st_uid != os.geteuid() or parent.st_mode & 0o077:
            raise AssertionError("TECHNICAL_SESSION_PERMISSIONS_UNSAFE")
        descriptor = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent_fd)
        with os.fdopen(descriptor, "rb") as source:
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o600:
                raise AssertionError("TECHNICAL_SESSION_PERMISSIONS_UNSAFE")
            raw = source.read(TECHNICAL_SESSION_MAX_BYTES + 1)
    except OSError:
        raise AssertionError("TECHNICAL_SESSION_PERMISSIONS_UNSAFE") from None
    finally:
        os.close(parent_fd)
    if len(raw) > TECHNICAL_SESSION_MAX_BYTES:
        raise AssertionError("TECHNICAL_SESSION_RECEIPT_INVALID")
    try:
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise ValueError("object required")
        expires = datetime.fromisoformat(str(value.get("expiresAt")).replace("Z", "+00:00"))
    except (ValueError, UnicodeError):
        raise AssertionError("TECHNICAL_SESSION_RECEIPT_INVALID") from None
    cookies = value.get("cookies")
    if (
        value.get("authority") != "OWNER-AUTONOMOUS-OCTOPORT-TEST-AUTH-20260928-1244"
        or value.get("adminSessionIssued") is not False
        or not isinstance(value.get("accountId"), str)
        or not value["accountId"]
        or value.get("apiOrigin") != TECHNICAL_API_ORIGIN
        or not isinstance(cookies, dict)
        or set(cookies) != {"pcp_portal_session", "pcp_csrf"}
        or not all(isinstance(v, str) and re.fullmatch(r"[A-Za-z0-9._:-]{1,512}", v) for v in cookies.values())
        or expires.tzinfo is None
        or expires <= datetime.now(timezone.utc)
    ):
        raise AssertionError("TECHNICAL_SESSION_RECEIPT_INVALID")
    return value


class RejectTechnicalRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise AssertionError("TECHNICAL_AUTH_REDIRECT_REJECTED")


def technical_api(session: dict, method: str, path: str, body: dict | None = None) -> dict:
    if session.get("apiOrigin") != TECHNICAL_API_ORIGIN:
        raise AssertionError("TECHNICAL_AUTH_ORIGIN_REJECTED")
    allowed = (method == "GET" and path == "/v1/accounts") or (
        method == "POST" and re.fullmatch(r"/v1/device-authorizations/[0-9a-fA-F-]{36}/approve", path)
    )
    if not allowed:
        raise AssertionError("TECHNICAL_AUTH_API_REJECTED")
    payload = None if body is None else json.dumps(body, separators=(",", ":")).encode()
    headers = {
        "Accept": "application/json",
        "Origin": TECHNICAL_API_ORIGIN,
        "Cookie": (
            f"pcp_portal_session={session['cookies']['pcp_portal_session']}; "
            f"pcp_csrf={session['cookies']['pcp_csrf']}"
        ),
    }
    if payload is not None:
        headers["Content-Type"] = "application/json"
        headers["x-csrf-token"] = session["cookies"]["pcp_csrf"]
    request = Request(TECHNICAL_API_ORIGIN + path, method=method, data=payload, headers=headers)
    try:
        with build_opener(RejectTechnicalRedirects()).open(request, timeout=15) as response:
            if response.status < 200 or response.status >= 300:
                raise AssertionError("TECHNICAL_AUTH_API_REJECTED")
            raw = response.read(TECHNICAL_RESPONSE_MAX_BYTES + 1)
            if len(raw) > TECHNICAL_RESPONSE_MAX_BYTES:
                raise AssertionError("TECHNICAL_AUTH_API_INVALID_RESPONSE")
            value = json.loads(raw)
            if not isinstance(value, dict):
                raise AssertionError("TECHNICAL_AUTH_API_INVALID_RESPONSE")
            return value
    except HTTPError:
        raise AssertionError("TECHNICAL_AUTH_API_REJECTED") from None
    except (URLError, TimeoutError):
        raise AssertionError("TECHNICAL_AUTH_API_UNAVAILABLE") from None
    except (ValueError, UnicodeError):
        raise AssertionError("TECHNICAL_AUTH_API_INVALID_RESPONSE") from None


def approve_technical_activation(session: dict, pending: dict) -> dict:
    if (
        not isinstance(pending, dict)
        or not isinstance(pending.get("authorizationId"), str)
        or not pending["authorizationId"]
        or not isinstance(pending.get("userCode"), str)
        or not pending["userCode"]
    ):
        raise AssertionError("TECHNICAL_AUTH_PENDING_INVALID")
    accounts = technical_api(session, "GET", "/v1/accounts").get("accounts")
    matches = [
        account for account in accounts or []
        if isinstance(account, dict)
        and account.get("id") == session["accountId"]
        and account.get("status") == "ACTIVE"
    ]
    if len(matches) != 1:
        raise AssertionError("TECHNICAL_AUTH_ACCOUNT_MEMBERSHIP_MISMATCH")
    authorization_id = quote(pending["authorizationId"], safe="")
    approved = technical_api(
        session,
        "POST",
        f"/v1/device-authorizations/{authorization_id}/approve",
        {"accountId": session["accountId"], "userCode": pending["userCode"]},
    )
    if approved.get("status") != "approved" or approved.get("authorizationId") != pending["authorizationId"]:
        raise AssertionError("TECHNICAL_AUTH_APPROVAL_INVALID")
    return {
        "technicalSessionAuthorityVerified": True,
        "accountMembershipVerified": True,
        "deviceApprovalSubmitted": True,
        "authStateInjected": False,
        "manualEmailLoginTested": False,
        "humanPortalLoginTested": False,
    }


def run_local_reversible(page, output_dir: Path, network_hosts: Counter) -> tuple[list[dict], dict]:
    rows: list[dict] = []
    initial = safe_popup_state(page)
    if not initial["auth"]["authenticated"]:
        raise AssertionError("ORDINARY_AUTH_REQUIRED")
    initial_fingerprint = store_fingerprint(page)
    initial_count = initial["storeCount"]
    tag = uuid.uuid4().hex[:10]
    ozon_name = f"Octoport R1 temp Ozon {tag}"
    wb_name = f"Octoport R1 temp WB {tag}"
    ozon_edited = f"Octoport R1 temp Ozon edited {tag}"
    synthetic_seller_id = f"octoport-r1-{tag}"
    synthetic_seller_key = f"SYNTHETIC_SELLER_NEVER_VALID_{tag}"
    synthetic_perf_id = f"octoport-r1-perf-{tag}"
    synthetic_perf_key = f"SYNTHETIC_PERF_NEVER_VALID_{tag}"
    synthetic_wb_token = f"SYNTHETIC_WB_NEVER_VALID_{tag}"
    temp_names = [ozon_name, wb_name, ozon_edited]

    def add_row(control: str, status: str, outcome: str):
        rows.append({"control": control, "status": status, "outcome": outcome})

    def wait_store_count(count: int, label: str):
        return wait_for(lambda: safe_popup_state(page)["storeCount"] == count, label, 10)

    try:
        page.click("#ozon")
        page.click("#add")
        page.locator("#name").fill(ozon_name)
        page.locator("#seller-id").fill(synthetic_seller_id)
        page.locator("#seller-key").fill(synthetic_seller_key)
        page.locator("#performance-id").fill(synthetic_perf_id)
        page.locator("#performance-key").fill(synthetic_perf_key)
        page.locator("#personal").check()
        page.click("#save")
        wait_for(lambda: visible_option(page, ozon_name), "temporary Ozon save")
        assert safe_popup_state(page)["storeCount"] == initial_count + 1
        add_row("ozon/add/save", "PASS", "temporary Ozon store created locally")

        page.click("#wildberries")
        page.click("#add")
        page.locator("#name").fill(wb_name)
        page.locator("#token").fill(synthetic_wb_token)
        page.click("#save")
        wait_for(lambda: visible_option(page, wb_name), "temporary WB save")
        assert safe_popup_state(page)["storeCount"] == initial_count + 2
        add_row("wildberries/add/save", "PASS", "temporary WB store created locally")

        page.click("#ozon")
        select_store_label(page, ozon_name)
        page.click("#edit")
        page.locator("#name").fill("SHOULD-NOT-SAVE-" + tag)
        page.click("#cancel")
        assert visible_option(page, ozon_name)
        assert not visible_option(page, "SHOULD-NOT-SAVE-" + tag)
        add_row("edit/cancel", "PASS", "cancel preserved current temporary store")

        select_store_label(page, ozon_name)
        page.click("#edit")
        page.locator("#name").fill(ozon_edited)
        assert page.evaluate("()=>document.getElementById('seller-key').value === ''")
        assert page.evaluate("()=>document.getElementById('performance-key').value === ''")
        page.click("#save")
        wait_for(lambda: visible_option(page, ozon_edited), "secret-preserving edit")
        select_store_label(page, ozon_edited)
        assert not page.locator("#check-seller").is_disabled()
        assert not page.locator("#check-performance").is_disabled()
        add_row("edit/save", "PASS", "blank secret fields preserved credential presence without reading secrets")

        page.click("#edit")
        page.locator("#clear-performance").check()
        page.locator("#personal").uncheck()
        page.click("#save")
        wait_for(lambda: page.locator("#check-performance").is_disabled(), "clear performance")
        add_row("clear-performance/personal", "PASS", "temporary store local options applied")

        page.click("#wildberries")
        select_store_label(page, wb_name)
        page.click("#remove")
        wait_for(lambda: page.locator("#confirmation").is_visible(), "remove confirmation")
        page.click("#reject")
        assert visible_option(page, wb_name)
        add_row("remove/reject", "PASS", "reject preserved temporary WB store")

        select_store_label(page, wb_name)
        page.click("#remove")
        wait_for(lambda: page.locator("#confirmation").is_visible(), "remove confirm")
        page.click("#confirm")
        wait_for(lambda: not visible_option(page, wb_name), "temporary WB delete")
        assert safe_popup_state(page)["storeCount"] == initial_count + 1
        add_row("remove/confirm", "PASS", "confirmed delete removed only temporary WB store")

        page.click("#support-generate")
        wait_for(lambda: not page.locator("#support-snapshot").is_hidden(), "support snapshot")
        snapshot = json.loads(page.locator("#support-snapshot").input_value())
        assert snapshot["privacy"]["credentialsIncluded"] is False
        assert snapshot["privacy"]["conversationIdentifiersIncluded"] is False
        assert snapshot["privacy"]["marketplacePayloadIncluded"] is False
        add_row("support-generate", "PASS", "privacy-safe snapshot generated")

        if initial_count == 0:
            password = "R1-ephemeral-" + tag
            temp_backup_dir = Path(tempfile.mkdtemp(prefix="octoport-r1-backup-"))
            try:
                page.locator("#backup-password").fill(password)
                page.locator("#backup-password-confirm").fill(password)
                with page.expect_download() as pending:
                    page.click("#backup-export")
                backup_path = temp_backup_dir / "backup.json"
                pending.value.save_as(backup_path)
                raw = backup_path.read_bytes()
                assert synthetic_seller_key.encode() not in raw
                assert synthetic_perf_key.encode() not in raw
                assert synthetic_wb_token.encode() not in raw
                page.locator("#backup-file").set_input_files(str(backup_path))
                page.locator("#backup-import-password").fill(password)
                page.click("#backup-preview")
                wait_for(lambda: page.locator("#backup-preview-result").is_visible(), "backup preview")
                page.click("#backup-import")
                wait_for(lambda: page.locator("#backup-preview-result").is_hidden(), "backup import same-current")
                assert safe_popup_state(page)["storeCount"] == initial_count + 1
                add_row("backup-export/preview/import", "PASS", "ephemeral temp-only encrypted backup exercised; no plaintext synthetic secrets")
            finally:
                shutil.rmtree(temp_backup_dir, ignore_errors=True)
        else:
            add_row("backup-export/preview/import", "SKIPPED_PROTECT_EXISTING_STORES",
                    "pre-existing stores present; all-store backup intentionally not executed")

        page.click("#ozon")
        select_store_label(page, ozon_edited)
        page.click("#remove")
        wait_for(lambda: page.locator("#confirmation").is_visible(), "cleanup confirmation")
        page.click("#confirm")
        wait_store_count(initial_count, "temporary Ozon cleanup")
        add_row("cleanup", "PASS", "temporary stores removed")
    finally:
        # Best-effort UI cleanup if an assertion interrupted the sequence.
        for name in temp_names:
            try:
                page.click("#ozon" if "Ozon" in name else "#wildberries")
                if visible_option(page, name):
                    select_store_label(page, name)
                    page.click("#remove")
                    if page.locator("#confirmation").is_visible():
                        page.click("#confirm")
                    wait_for(lambda: not visible_option(page, name), "best-effort cleanup", 3)
            except Exception:
                pass

    final = safe_popup_state(page)
    final_fingerprint = store_fingerprint(page)
    if final["storeCount"] != initial_count or final_fingerprint != initial_fingerprint:
        raise AssertionError("PREEXISTING_STORE_STATE_NOT_RESTORED")
    provider_counts = {host: count for host, count in network_hosts.items() if provider_host(host)}
    if provider_counts:
        raise AssertionError("LOCAL_PHASE_EXECUTED_PROVIDER_REQUEST")
    protection = {
        "initialStoreCount": initial_count,
        "finalStoreCount": final["storeCount"],
        "preExistingStoreFingerprintRestored": final_fingerprint == initial_fingerprint,
        "providerHostRequestCount": sum(provider_counts.values()),
    }
    return rows, protection


def prepare(args) -> dict:
    actual_sha = sha256(args.carrier)
    if actual_sha != args.expected_sha256:
        raise AssertionError("STORE_ZIP_SHA256_MISMATCH")
    manifest_version = carrier_manifest_version(args.carrier)
    if manifest_version != args.expected_version:
        raise AssertionError("EXTENSION_VERSION_MISMATCH")
    product = browser_product(args.browser_executable)
    require_exact_browser_product(product, args.expected_browser_product)
    validate_control_directory_path(
        args.runtime_dir,
        "RUNTIME_ROOT_SYMLINK_REJECTED",
        "RUNTIME_ROOT_PERMISSIONS_UNSAFE",
    )
    validate_control_directory_path(
        args.profile_dir,
        "PROFILE_ROOT_SYMLINK_REJECTED",
        "PROFILE_ROOT_PERMISSIONS_UNSAFE",
    )
    if profile_in_use(args.profile_dir):
        raise AssertionError("DEDICATED_PROFILE_ALREADY_IN_USE")
    runtime = ensure_exact_runtime(args.carrier, args.runtime_dir)
    args.profile_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    if args.profile_dir.stat().st_mode & 0o077:
        raise AssertionError("DEDICATED_PROFILE_PERMISSIONS_UNSAFE")
    return {
        "status": "PREPARED",
        "carrier": args.carrier.name,
        "packageSha256": actual_sha,
        "manifestVersion": manifest_version,
        "browserProduct": product,
        "runtimeFileCount": runtime["fileCount"],
        "runtimeCreated": runtime["created"],
        "profileInUse": False,
        "manifestKeyPresent": False,
        "stablePathRequired": True,
    }


def launch_browser_phase(args) -> dict:
    preflight = prepare(args)
    host_counts: Counter = Counter()
    page_errors: Counter = Counter()
    with sync_playwright() as playwright:
        context = playwright.chromium.launch_persistent_context(
            str(args.profile_dir),
            executable_path=str(args.browser_executable),
            headless=False,
            args=[
                "--no-sandbox",
                f"--disable-extensions-except={args.runtime_dir}",
                f"--load-extension={args.runtime_dir}",
            ],
        )
        try:
            context.on(
                "request",
                lambda request: host_counts.update([urlparse(request.url).hostname or ""])
                if request.url.startswith(("http://", "https://"))
                else None,
            )
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker", timeout=30000)
            manifest = worker.evaluate("()=>chrome.runtime.getManifest()")
            if manifest.get("version") != args.expected_version:
                raise AssertionError("EXTENSION_VERSION_MISMATCH")
            popup = context.new_page()
            popup.on("pageerror", lambda _error: page_errors.update(["POPUP_PAGE_ERROR"]))
            popup.goto(worker.url.rsplit("/", 1)[0] + "/popup.html", wait_until="load")
            popup.bring_to_front()
            started = time.monotonic()
            observed = auth_status(worker)
            technical_evidence = {}
            if args.mode == "technical-auth":
                if observed["authenticated"]:
                    raise AssertionError("TECHNICAL_AUTH_PROFILE_NOT_FRESH")
                session = load_technical_session(args.technical_session_file)
                activation = worker.evaluate(
                    """async()=>{const s=await SellerAgentsControlClient.startActivation();
                    return {pending:s?.pending||null,authenticated:s?.authenticated===true};}"""
                )
                if activation.get("authenticated"):
                    raise AssertionError("TECHNICAL_AUTH_PROFILE_NOT_FRESH")
                technical_evidence = approve_technical_activation(session, activation.get("pending"))
                while not auth_status(worker)["authenticated"]:
                    if time.monotonic() - started >= args.auth_timeout_seconds:
                        raise AssertionError("TECHNICAL_AUTH_TIMEOUT")
                    time.sleep(0.25)
                observed = auth_status(worker)
            elif args.mode == "wait-auth" and not observed["authenticated"]:
                print(json.dumps({
                    "status": "WAITING_OWNER_LOGIN",
                    "action": "Complete ordinary portal login manually in this same browser/profile; do not send OTP or credentials to the helper.",
                    "packageSha256": args.expected_sha256,
                }, ensure_ascii=False), flush=True)
                while not auth_status(worker)["authenticated"]:
                    if time.monotonic() - started >= args.auth_timeout_seconds:
                        result = {
                            "status": "WAITING_OWNER_LOGIN",
                            "evidenceLevel": "PREPARED_NOT_AUTHENTICATED",
                            "packageSha256": args.expected_sha256,
                            "browserProduct": preflight["browserProduct"],
                            "authActionExecutedByHelper": False,
                            "authDiagnostic": auth_status(worker),
                            "pageErrors": dict(page_errors),
                            "plan": PLAN,
                        }
                        args.output.parent.mkdir(parents=True, exist_ok=True)
                        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
                        return result
                    time.sleep(0.25)
                observed = auth_status(worker)

            if not observed["authenticated"]:
                result = {
                    "status": "WAITING_OWNER_LOGIN",
                    "evidenceLevel": "PREPARED_NOT_AUTHENTICATED",
                    "packageSha256": args.expected_sha256,
                    "browserProduct": preflight["browserProduct"],
                    "authActionExecutedByHelper": False,
                    "authDiagnostic": auth_status(worker),
                    "pageErrors": dict(page_errors),
                    "plan": PLAN,
                }
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
                return result

            popup.bring_to_front()
            popup.reload(wait_until="load")
            wait_for(lambda: safe_popup_state(popup)["auth"]["authenticated"], "authenticated popup", 15)
            before = safe_popup_state(popup)
            safe_states = safe_element_states(popup)
            base = {
                "packageSha256": args.expected_sha256,
                "browserProduct": preflight["browserProduct"],
                "manifest": {
                    "version": manifest.get("version"),
                    "manifestVersion": manifest.get("manifest_version"),
                    "name": manifest.get("name"),
                },
                "authActionExecutedByHelper": args.mode == "technical-auth",
                "authMode": ("AUTOMATED_TECHNICAL_AUTH" if args.mode == "technical-auth" else
                             "ORDINARY_HUMAN_AUTH" if args.mode == "wait-auth" else "PREEXISTING_AUTHENTICATED_PROFILE"),
                **technical_evidence,
                "authenticatedObserved": True,
                "workAllowedObserved": before["auth"]["workAllowed"],
                "safeInitialState": before,
                "controlStates": safe_states,
                "externalHostCounts": dict(sorted(host_counts.items())),
                "pageErrors": dict(page_errors),
            }
            if args.mode == "wait-auth":
                result = {
                    **base,
                    "status": "READY_AFTER_ORDINARY_AUTH",
                    "evidenceLevel": "EXACT_STORE_ORDINARY_AUTH_READ_ONLY_READY",
                    "next": "Run local-matrix with --allow-local-test-stores on this same closed/reopened dedicated profile.",
                }
            elif args.mode == "technical-auth":
                result = {
                    **base,
                    "status": "READY_AFTER_TECHNICAL_AUTH",
                    "evidenceLevel": "EXACT_STORE_AUTOMATED_TECHNICAL_AUTH_READ_ONLY_READY",
                    "next": "Close cleanly; reopen this same technical extension profile/runtime for local-matrix or separately gated read-only checks.",
                    "untested": {
                        "manualEmailLogin": True,
                        "humanPortalLoginUx": True,
                        "providerChecks": True,
                        "liveAiWork": True,
                    },
                }
            else:
                if not args.allow_local_test_stores:
                    raise AssertionError("LOCAL_TEST_STORES_EXPLICIT_FLAG_REQUIRED")
                rows, protection = run_local_reversible(popup, args.output.parent, host_counts)
                after = safe_popup_state(popup)
                result = {
                    **base,
                    "status": "PASS_TEMP_STORE_MATRIX",
                    "evidenceLevel": "EXACT_STORE_ORDINARY_AUTH_OWNER_TEST_TEMP_STORE_UI",
                    "safeFinalState": after,
                    "rows": rows,
                    "protection": protection,
                    "externalHostCounts": dict(sorted(host_counts.items())),
                    "gated": {
                        "providerChecks": "NOT_RUN_REQUIRES_REAL_READ_ONLY_PROVIDER_BOUNDARY",
                        "work": "NOT_RUN_REQUIRES_SUPPORTED_LIVE_AI_AND_OWNER_TEST_BOUNDARY",
                        "transfer": "NOT_RUN_REQUIRES_SECOND_ORDINARILY_AUTHENTICATED_INSTALLATION",
                        "authReset": "NOT_RUN_DESTRUCTIVE_REAUTH_BOUNDARY",
                        "authOpenCancel": "NOT_RUN_REQUIRES_NEW_PENDING_AUTH_LIFECYCLE",
                    },
                }
            if page_errors:
                raise AssertionError("POPUP_PAGE_ERROR")
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
            return result
        finally:
            context.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=["describe", "prepare", "wait-auth", "technical-auth", "local-matrix"], required=True)
    parser.add_argument("--carrier", type=Path)
    parser.add_argument("--runtime-dir", type=Path)
    parser.add_argument("--profile-dir", type=Path)
    parser.add_argument("--browser-executable", type=Path)
    parser.add_argument("--expected-browser-product", default="136.0.6008.22")
    parser.add_argument("--expected-version", default="0.2.6")
    parser.add_argument("--expected-sha256", default="579dc15aaf692fc9e96ad650e660ac0190bb7e136c949b7ad401e5bc82a909b5")
    parser.add_argument("--auth-timeout-seconds", type=int, default=900)
    parser.add_argument("--technical-session-file", type=Path)
    parser.add_argument("--allow-local-test-stores", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    if args.mode == "describe":
        print(json.dumps({"status": "PLAN", "plan": PLAN}, ensure_ascii=False, indent=2))
        return 0
    for name in ("carrier", "runtime_dir", "profile_dir", "browser_executable", "output"):
        if getattr(args, name) is None:
            parser.error(f"--{name.replace('_','-')} is required for {args.mode}")
    if args.mode == "technical-auth" and args.technical_session_file is None:
        parser.error("--technical-session-file is required for technical-auth")
    args.carrier = args.carrier.resolve()
    args.runtime_dir = Path(os.path.abspath(args.runtime_dir))
    args.profile_dir = Path(os.path.abspath(args.profile_dir))
    args.browser_executable = args.browser_executable.resolve()
    args.output = args.output.resolve()
    if args.technical_session_file is not None:
        args.technical_session_file = Path(os.path.abspath(args.technical_session_file))

    try:
        result = prepare(args) if args.mode == "prepare" else launch_browser_phase(args)
    except Exception as failure:
        # Browser/transport exceptions can contain URLs, tokens or field values.
        # Emit only a fixed code, never the exception text or traceback.
        result = {"status": "FAILED", "phase": args.mode,
                  "evidenceLevel": "NOT_ACCEPTED", "failureCode": safe_failure_code(failure)}
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 1
    if args.mode == "prepare":
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["status"] != "WAITING_OWNER_LOGIN" else 3


if __name__ == "__main__":
    raise SystemExit(main())
