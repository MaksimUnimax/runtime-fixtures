"""Self-contained disposable environment for the real-Firefox functional harness.

Starts the existing disposable API/portal fixtures, builds the current common and
Firefox carriers against their temporary public trust bundle, then runs
firefox-functional-harness.py. No live provider or AI endpoint is contacted.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import time
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
NODE = os.environ.get("SA_NODE_BIN", "/root/.nvm/versions/node/v24.20.0/bin/node")
PNPM = os.environ.get("SA_PNPM_BIN", "pnpm")
PY311 = os.environ.get("SA_PYTHON311", "/usr/bin/python3.11")


def wait_http(url: str, timeout: float = 90) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status < 500:
                    return
        except Exception:
            pass
        time.sleep(0.25)
    raise RuntimeError("HTTP_READY_TIMEOUT")


def run_checked(command, *, env):
    return subprocess.run(
        command,
        cwd=ROOT,
        env=env,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )


def main(output: Path, api_port: int, portal_port: int, allow_technical: bool) -> int:
    if os.environ.get("PRODUCT_CONTROL_PLANE_E2E") != "1":
        raise RuntimeError("PRODUCT_CONTROL_PLANE_E2E=1_REQUIRED")
    if not os.environ.get("DATABASE_URL"):
        raise RuntimeError("DISPOSABLE_DATABASE_URL_REQUIRED")
    output.mkdir(parents=True, exist_ok=False)

    namespace = uuid.uuid4().hex
    extension_version = json.loads(
        (ROOT / "apps/extension/composition.json").read_text()
    )["version"]
    trust = output / "public-trust-bundle.json"
    fixture_evidence = output / "fixture-evidence.json"
    network_evidence = output / "safe-network-evidence.json"
    private_placeholder = output / "unused-private-key.der"
    common = output / "common"
    firefox_runtime = output / "firefox-runtime"
    functional = output / "functional"
    env = {
        **os.environ,
        "PRODUCT_CONTROL_PLANE_E2E": "1",
        "SA_I1_API_PORT": str(api_port),
        "SA_I1_PORTAL_PORT": str(portal_port),
        "SA_I1_FIXTURE_NAMESPACE": namespace,
        "SA_I1_PUBLIC_TRUST_BUNDLE_PATH": str(trust),
        "SA_I1_FIXTURE_EVIDENCE_PATH": str(fixture_evidence),
        "SA_I1_NETWORK_EVIDENCE_PATH": str(network_evidence),
        "SA_I1_PROFILE_CONTRACT_VERSION": "control_plane_v2",
        "SA_I1_PROFILE_BROWSER_FAMILIES": "firefox",
        "SA_I1_EXTENSION_VERSION": extension_version,
        "SA_I1_FORCE_BETA_BOOTSTRAP": "1",
        "SA_I1_ENABLE_LOCAL_CLIENT_AUTHORITY": "1",
        "SA_I1_REDACT_FIXTURE_IDENTITIES": "1",
    }
    processes = []
    logs = []
    result = {
        "status": "FAIL",
        "acceptanceClass": "REAL_FIREFOX_INSTALLED_SYNTHETIC_FUNCTIONAL",
        "liveProviderCalls": 0,
        "productHead": subprocess.check_output(
            ["git", "-C", str(ROOT), "rev-parse", "HEAD"], text=True
        ).strip(),
    }
    try:
        run_checked([PNPM, "db:migrate"], env=env)

        api_log = (output / "api.log").open("w", encoding="utf-8")
        logs.append(api_log)
        api = subprocess.Popen(
            [
                PNPM,
                "--filter",
                "@product/api",
                "exec",
                "tsx",
                "../../tests/regression/extension-core/client-i1/api-harness.ts",
            ],
            cwd=ROOT,
            env=env,
            stdout=api_log,
            stderr=subprocess.STDOUT,
            text=True,
        )
        processes.append(api)
        wait_http(f"http://127.0.0.1:{api_port}/health/ready")
        if not trust.is_file() or not fixture_evidence.is_file():
            raise RuntimeError("DISPOSABLE_API_FIXTURE_EVIDENCE_MISSING")
        fixture = json.loads(fixture_evidence.read_text())
        if fixture.get("profile_contract_version") != "control_plane_v2":
            raise RuntimeError("FIXTURE_PROFILE_CONTRACT_MISMATCH")
        if fixture.get("profile_browser_families") != ["firefox"]:
            raise RuntimeError("FIXTURE_PROFILE_BROWSER_MISMATCH")

        config = subprocess.check_output(
            [
                NODE,
                str(
                    ROOT
                    / "tests/regression/extension-core/client-i1/make-browser-config.mjs"
                ),
                str(private_placeholder),
                str(trust),
            ],
            cwd=ROOT,
            env=env,
            text=True,
        )
        build_env = {**env, "SA_PACKAGED_CONFIG_JSON": config}
        build = run_checked(
            [
                "python3",
                "tooling/build/extension_composed.py",
                "--output",
                str(common),
                "--mode",
                "development",
            ],
            env=build_env,
        )
        (output / "build-common.log").write_text(build.stdout)
        firefox_build = run_checked(
            [
                "python3",
                "tooling/build/extension_firefox.py",
                "--input-runtime",
                str(common / "runtime"),
                "--output",
                str(firefox_runtime),
            ],
            env=env,
        )
        (output / "build-firefox.log").write_text(firefox_build.stdout)
        carriers = sorted(output.glob("*FIREFOX_LOCAL_DEVELOPMENT.zip"))
        if len(carriers) != 1:
            raise RuntimeError("FIREFOX_CARRIER_MISSING_OR_AMBIGUOUS")
        carrier = carriers[0]

        portal_log = (output / "portal.log").open("w", encoding="utf-8")
        logs.append(portal_log)
        portal_env = {
            **env,
            "CONTROL_PLANE_API_ORIGIN": f"http://127.0.0.1:{api_port}",
        }
        portal = subprocess.Popen(
            [
                PNPM,
                "--filter",
                "@product/portal",
                "exec",
                "next",
                "dev",
                "--hostname",
                "127.0.0.1",
                "--port",
                str(portal_port),
            ],
            cwd=ROOT,
            env=portal_env,
            stdout=portal_log,
            stderr=subprocess.STDOUT,
            text=True,
        )
        processes.append(portal)
        wait_http(f"http://127.0.0.1:{portal_port}/login")

        safe_namespace = re.sub(r"[^a-z0-9]", "", namespace.lower())[:24] or "fixture"
        fixture_email = f"q1a-{safe_namespace}-one@example.test"
        command = [
            PY311,
            str(
                ROOT
                / "tests/regression/extension-core/client-i1/firefox-functional-harness.py"
            ),
            "--carrier",
            str(carrier),
            "--output",
            str(functional),
            "--api-origin",
            f"http://127.0.0.1:{api_port}",
            "--portal-origin",
            f"http://127.0.0.1:{portal_port}",
            "--namespace",
            namespace,
            "--email",
            fixture_email,
            "--certutil",
            "/usr/bin/certutil",
        ]
        if allow_technical:
            command.append("--allow-technical")
        harness = subprocess.run(
            command,
            cwd=ROOT,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        (output / "functional.log").write_text(harness.stdout)
        functional_result = (
            json.loads((functional / "result.json").read_text())
            if (functional / "result.json").is_file()
            else {"status": "FAIL", "errorCode": "FUNCTIONAL_RESULT_MISSING"}
        )
        result.update(
            status="PASS"
            if harness.returncode == 0 and functional_result.get("status") == "PASS"
            else "FAIL",
            harnessExit=harness.returncode,
            package={
                "name": carrier.name,
                "sha256": hashlib.sha256(carrier.read_bytes()).hexdigest(),
            },
            fixture={
                "extensionVersion": extension_version,
                "profileContractVersion": fixture.get("profile_contract_version"),
                "profileBrowserFamilies": fixture.get("profile_browser_families"),
                "accountsPrepared": fixture.get("existing_fixture_accounts"),
                "betaUnchanged": fixture.get("beta_unchanged"),
            },
            functional=functional_result,
        )
    finally:
        for process in reversed(processes):
            if process.poll() is None:
                process.terminate()
        for process in reversed(processes):
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        for handle in logs:
            try:
                handle.close()
            except Exception:
                pass
        (output / "summary.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2) + "\n"
        )
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("status") == "PASS" else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--api-port", type=int, default=18201)
    parser.add_argument("--portal-port", type=int, default=18211)
    parser.add_argument("--allow-technical", action="store_true")
    args = parser.parse_args()
    raise SystemExit(
        main(args.output.resolve(), args.api_port, args.portal_port, args.allow_technical)
    )
