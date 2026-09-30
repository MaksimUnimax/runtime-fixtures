"""Exact 0.2.9 signed-out UI acceptance; run via frozen_python_check + A heavy.

Fresh disposable profile only. No session injection or human email acceptance.
Chrome tab API is the observable boundary, not Playwright page discovery.
"""
import argparse
from collections import Counter
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import tempfile
import zipfile
from urllib.parse import urlsplit

PACKAGE_SHA = "f409e35fb714139cc5eefd6c3b390d5d2ca89fb9567a58cb3b68157e1f62eeae"
VERSION = "0.2.9"
NAME = "Octoport — Ozon + Wildberries"
BROWSER_VERSION = "136.0.6008.22"
AUTH = """async()=>{const s=await SellerAgentsControlClient.status();return {
 authenticated:s?.authenticated===true,workAllowed:s?.workAllowed===true,
 pending:Boolean(s?.pending),authorityPresent:Boolean(s?.authority),
 hasError:Boolean(s?.lastError)}}"""
PORTAL_TABS = """async()=> (await chrome.tabs.query({})).filter(t=>{
 try {const u=new URL(t.pendingUrl||t.url||'about:blank');
 return u.protocol==='https:'&&u.hostname==='app.octoport.ru'&&u.pathname==='/activate';}
 catch {return false;}}).map(t=>t.id)"""
SIGNED_OUT = dict(authenticated=False, workAllowed=False, pending=False,
                  authorityPresent=False, hasError=False)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, code):
    if not condition:
        raise AssertionError(code)


def archive_files(path, expected_sha=PACKAGE_SHA):
    raw = path.read_bytes()
    require(sha(raw) == expected_sha, "PACKAGE_HASH_MISMATCH")
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        names, result = set(), {}
        for item in archive.infolist():
            parts = PurePosixPath(item.filename)
            require(not parts.is_absolute() and ".." not in parts.parts
                    and "\\" not in item.filename, "UNSAFE_ARCHIVE_PATH")
            require(item.filename not in names, "DUPLICATE_ARCHIVE_ENTRY")
            names.add(item.filename)
            require(not stat.S_ISLNK(item.external_attr >> 16), "ARCHIVE_SYMLINK")
            if not item.is_dir():
                result[item.filename] = archive.read(item)
        return result


def exact_browser_product(value):
    return re.fullmatch(r"(?:Opera\s+)?" + re.escape(BROWSER_VERSION), value.strip()) is not None


def safe_error(error):
    value = str(error)
    return value if isinstance(error, AssertionError) and re.fullmatch(r"[A-Z0-9_]+", value) else type(error).__name__


def wait(popup, predicate, code, timeout_ms=20000):
    import time
    end = time.monotonic() + timeout_ms / 1000
    while time.monotonic() < end:
        value = predicate()
        if value:
            return value
        popup.wait_for_timeout(100)
    raise AssertionError(code)


def new_portal_ids(worker, previous):
    return sorted(set(worker.evaluate(PORTAL_TABS)) - set(previous))


def run(args):
    # Parse/verify exact carrier before importing Playwright or starting a browser.
    files = archive_files(args.carrier)
    manifest = json.loads(files["manifest.json"])
    require(manifest.get("version") == VERSION and manifest.get("name") == NAME,
            "PACKAGE_IDENTITY_MISMATCH")
    require(manifest.get("manifest_version") == 3, "MANIFEST_VERSION_MISMATCH")
    product = subprocess.check_output([str(args.browser), "--version"], text=True).strip()
    require(exact_browser_product(product), "BROWSER_VERSION_MISMATCH")
    evidence = Path(os.environ["OCTOPORT_EVIDENCE_DIR"])
    require(evidence.is_dir() and not (evidence / "result.json").exists(), "FRESH_EVIDENCE_REQUIRED")
    from playwright.sync_api import sync_playwright
    result = {"status": "FAIL", "version": VERSION, "packageSha256": PACKAGE_SHA,
              "testSourceSha256": sha(Path(__file__).read_bytes()),
              "evidenceLevel": "INSTALLED_TECHNICAL_SIGNED_OUT_UI",
              "authStateInjected": False, "humanEmailLoginTested": False,
              "networkEvidenceScope": "observed context requests, not global traffic audit"}
    methods, page_errors = Counter(), []
    temporary = None
    try:
        with tempfile.TemporaryDirectory(prefix="octoport-auth-cancel-") as temp:
            temporary = Path(temp)
            runtime, profile = temporary / "runtime", temporary / "profile"
            runtime.mkdir()
            for name, data in files.items():
                dst = runtime / name
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_bytes(data)
            with sync_playwright() as pw:
                context = pw.chromium.launch_persistent_context(
                    str(profile), executable_path=str(args.browser), headless=False,
                    args=["--no-sandbox", f"--disable-extensions-except={runtime}",
                          f"--load-extension={runtime}"])
                try:
                    def observe(request):
                        url = urlsplit(request.url)
                        if url.scheme in ("http", "https"):
                            methods[(request.method, url.hostname or "")] += 1
                    context.on("request", observe)
                    popup = context.new_page()
                    popup.on("pageerror", lambda _error: page_errors.append("POPUP_ERROR"))
                    def exact_worker():
                        for worker in context.service_workers:
                            if not worker.url.startswith("chrome-extension://"):
                                continue
                            try:
                                m = worker.evaluate("()=>chrome.runtime.getManifest()")
                            except Exception:
                                continue
                            if m.get("name") == NAME and m.get("version") == VERSION:
                                return worker
                        return None
                    worker = wait(popup, exact_worker, "EXACT_WORKER_MISSING", 30000)
                    popup.goto(worker.url.rsplit("/", 1)[0] + "/popup.html", wait_until="load")
                    wait(popup, lambda: popup.locator("#auth-start").is_visible(), "START_CONTROL_MISSING")
                    require(worker.evaluate(AUTH) == SIGNED_OUT, "INITIAL_AUTH_NOT_EMPTY")
                    result["lastStage"] = "start_ui"
                    popup.locator("#auth-start").click()
                    wait(popup, lambda: worker.evaluate(AUTH)["pending"], "PENDING_NOT_OBSERVED")
                    pending = worker.evaluate(AUTH)
                    require(not any(pending[k] for k in ("authenticated", "workAllowed", "authorityPresent", "hasError")), "UNEXPECTED_PENDING_AUTH")
                    # Close only activation tabs created inside this disposable profile.
                    prior = worker.evaluate(PORTAL_TABS)
                    if prior:
                        worker.evaluate("async ids=>{for(const id of ids)await chrome.tabs.remove(id)}", prior)
                    popup.reload(wait_until="load")
                    wait(popup, lambda: popup.locator("#auth-open").is_visible(), "OPEN_CONTROL_MISSING")
                    previous = worker.evaluate(PORTAL_TABS)
                    popup.locator("#auth-open").click()
                    wait(popup, lambda: new_portal_ids(worker, previous), "EXPECTED_PORTAL_NOT_OPENED")
                    result["lastStage"] = "cancel_ui"
                    popup.locator("#auth-cancel").click()
                    wait(popup, lambda: worker.evaluate(AUTH) == SIGNED_OUT, "CANCEL_NOT_SIGNED_OUT")
                    popup.wait_for_timeout(2000)
                    require(worker.evaluate(AUTH) == SIGNED_OUT, "CANCEL_NOT_STABLE")
                    require(popup.locator("#auth-start").is_visible()
                            and popup.locator("#auth-start").is_enabled()
                            and popup.locator("#auth-open").is_hidden()
                            and popup.locator("#auth-cancel").is_hidden(), "FINAL_CONTROLS_INCORRECT")
                    require(not page_errors, "POPUP_PAGE_ERROR")
                    require(all(host in {"api.octoport.ru", "app.octoport.ru"}
                                for _method, host in methods), "UNEXPECTED_OBSERVED_HOST")
                    popup.screenshot(path=str(evidence / "signed-out-after-cancel.png"))
                    result.update(status="PASS", startClicked=True, openClicked=True,
                                  expectedActivationTabObserved=True, cancelClicked=True,
                                  finalSignedOutStable=True, observedRequests=[
                                      {"method": m, "host": h, "count": n}
                                      for (m, h), n in sorted(methods.items())])
                finally:
                    context.close()
            actual = {str(p.relative_to(runtime)): p.read_bytes()
                      for p in runtime.rglob("*") if p.is_file()}
            require(actual == files, "INSTALLED_RUNTIME_CHANGED")
    except Exception as error:
        result.update(status="FAIL", error=safe_error(error))
    result["disposableProfileAndRuntimeRemoved"] = temporary is not None and not temporary.exists()
    result["frozenPackageUnchanged"] = sha(args.carrier.read_bytes()) == PACKAGE_SHA
    if not result["disposableProfileAndRuntimeRemoved"] or not result["frozenPackageUnchanged"]:
        result["status"] = "FAIL"
    with (evidence / "result.json").open("x") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(json.dumps({"status": result["status"], "lastStage": result.get("lastStage"),
                      "error": result.get("error"), "output": str(evidence / "result.json")}))
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--carrier", type=Path, default=Path("/root/octoport-control/logs/C/store-release-029-74882ec3/candidate/OCTOPORT_v0.2.9_CHROMIUM_STORE.zip"))
    parser.add_argument("--browser", type=Path, default=Path("/usr/bin/opera"))
    raise SystemExit(run(parser.parse_args()))
