"""Execute the preserved D1.E1 source/package routes with fail-fast exit codes."""
from pathlib import Path
import argparse
import importlib.util
import importlib.metadata
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("extension_baseline", ROOT / "tooling/build/extension_baseline.py")
baseline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(baseline)


class GateFailure(RuntimeError):
    pass


class Runner:
    def __init__(self, output):
        self.output = Path(output)
        self.rows = []
        self.env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", WB_TEST_PYTHON=sys.executable)
        for name in ("CASE", "WB_TEST_CASE"):
            self.env.pop(name, None)  # The full preserved suite must not be filtered.

    def run(self, name, command, cwd=ROOT, timeout=600):
        log = self.output / "logs" / (name + ".txt")
        log.parent.mkdir(parents=True, exist_ok=True)
        started = time.monotonic()
        print("RUN " + name, flush=True)
        with log.open("w", encoding="utf-8") as stream:
            try:
                process = subprocess.run([str(x) for x in command], cwd=cwd, env=self.env,
                                         stdout=stream, stderr=subprocess.STDOUT, timeout=timeout)
                code = process.returncode
            except subprocess.TimeoutExpired:
                code = 124
                stream.write("\nGATE_TIMEOUT\n")
        row = {"id": name, "command": [str(x) for x in command], "exit_code": code,
               "seconds": round(time.monotonic() - started, 3), "log": str(log.relative_to(self.output)),
               "status": "PASS" if code == 0 else "FAIL"}
        self.rows.append(row)
        baseline.write_json(self.output / "gates.json", self.rows)
        print(row["status"] + " " + name, flush=True)
        if code:
            print(log.read_text(encoding="utf-8")[-8000:], flush=True)
            raise GateFailure(f"{name}: exit {code}")


def negative_control(output):
    control = Runner(output / "runner-control")
    marker = output / "must-not-execute"
    try:
        control.run("before", [sys.executable, "-c", "print('before')"])
        control.run("middle-failure", [sys.executable, "-c", "raise SystemExit(7)"])
        control.run("after", [sys.executable, "-c", "from pathlib import Path; Path('must-not-execute').touch()"], cwd=output)
    except GateFailure:
        assert [r["exit_code"] for r in control.rows] == [0, 7]
        assert not marker.exists()
    else:
        raise AssertionError("Runner masked an intermediate failure")
    baseline.write_json(output / "runner-negative-control.json",
                        {"status": "PASS", "observed_exit": 7, "later_command_executed": False})


def ozon_route(runner, work, runtime, label, source_route, expected_version="0.1.22"):
    repo = work / label
    ozon = baseline.prepare_ozon_layout(repo, runtime)
    prod = ozon / "dist-step7-candidate"
    manifest = baseline.read_json(prod / "manifest.json")
    permission = baseline.read_json(ROOT / "tests/fixtures/imported/ozon-permissions-0aa8f535/manifest.json")
    assert expected_version in ("0.1.22", "0.2.0", "0.2.1", "0.2.2", "0.2.3", "0.2.4", "0.2.5", "0.2.6")
    assert manifest["manifest_version"] == 3 and manifest["version"] == expected_version
    for key in ("permissions", "host_permissions"):
        expected_permissions = permission[key]
        if expected_version in ("0.2.3", "0.2.4", "0.2.5", "0.2.6") and key == "host_permissions":
            expected_permissions += baseline.read_json(ROOT / "apps/extension/composition.json")["marketplace_hosts"]
        if expected_version in ("0.2.4", "0.2.5", "0.2.6") and key == "host_permissions":
            expected_permissions += ["http://127.0.0.1:43100/*", "http://127.0.0.1:43101/*"]
        assert manifest[key] == expected_permissions, key
    texts = {p.relative_to(prod).as_posix(): p.read_text(encoding="utf-8")
             for p in prod.rglob("*") if p.is_file()}
    old_lines = [(p, line) for p, text in texts.items() for line in text.splitlines() if "0.1.21" in line]
    assert len(old_lines) == 1 and old_lines[0][0] == "service_worker_entry.js"
    assert "Repair live v0.1.21 defects before downstream output/delivery wrappers capture contract/provider globals." in old_lines[0][1]
    expected_version_files = 8 if expected_version in ("0.2.4", "0.2.5", "0.2.6") else (9 if expected_version == "0.2.3" else 10)
    assert sum(expected_version in text for text in texts.values()) == expected_version_files
    if expected_version != "0.1.22":
        assert not any("0.1.22" in text for text in texts.values())
    assert not any(re.search(r"0\.1\.(19|20)", text) for text in texts.values())
    for p in sorted(prod.rglob("*.js")):
        runner.run(label + "-syntax-" + p.stem, ["node", "--check", p])
    v = ozon / "validation"
    live = v / "v0122-live-defects-2026-09-14"
    swagger = v / "swagger-read-surface-patch-2026-09-13"
    repaired = v / "swagger-read-surface-live-repair-2026-09-13"
    effect = v / "read-effect-repair-v1"
    if expected_version in ("0.2.1", "0.2.2", "0.2.3", "0.2.4", "0.2.5", "0.2.6"):
        corrective = effect / "run_live_gate_corrective_regression.mjs"
        original_corrective = corrective.read_text()
        old_guard = r"if \(!commandRequiresPersonalDataPolicy\(entry\.command\) \|\| personalDataEnabled\) return entry;"
        formatted_guard = r"if\s*\(\s*!commandRequiresPersonalDataPolicy\(entry\.command\)\s*\|\|\s*personalDataEnabled\s*\)\s*return\s+entry;"
        assert original_corrective.count(old_guard) == 1
        adapted_corrective = original_corrective.replace(old_guard, formatted_guard)
        corrective.write_text(adapted_corrective)
        baseline.write_json(runner.output / (label + "-policy-whitespace-adaptation.json"), {
            "source_sha256": baseline.sha256(original_corrective.encode()),
            "adapted_sha256": baseline.sha256(adapted_corrective.encode()),
            "change": "one structural policy assertion accepts formatter whitespace",
            "behavior_assertions_changed": False,
        })
    matrix = ROOT / "tests/fixtures/imported/ozon-control-17aa0833/FINAL_CONTROL_SAFETY_MATRIX.jsonl"
    steps = [
        ("v0122-red", [live / "run_v0122_live_defects_gate.mjs", "--baseline-red", ozon]),
        ("v0122-green", [live / "run_v0122_live_defects_gate.mjs", "--candidate-green", ozon]),
        ("v0122-closure", [live / "run_v0122_dependency_closure_gate.mjs", ozon]),
    ]
    if source_route:
        steps.append(("swagger-red", [swagger / "run_patch_gate.mjs", "--baseline-red", ozon]))
    steps += [
        ("swagger-green", [swagger / "run_patch_gate.mjs", ozon]),
        ("514", [swagger / "run_final_514_registry_gate.mjs", repo, matrix]),
        ("date", [effect / "run_defect_015_date_repair_gate.mjs", repo]),
        ("effect", [effect / "run_effect_read_repair_gate.mjs", repo]),
        ("shared-consumers", [repaired / "run_shared_consumer_parity_gate.mjs", ozon]),
        ("swagger-closure", [repaired / "run_dependency_closure_gate.mjs", ozon]),
    ]
    red_root = work / "red-ozon"
    if source_route:
        red_root.mkdir()
        shutil.copytree(ROOT / "tests/fixtures/imported/ozon-red-309da471/runtime", red_root / "dist-step7-candidate")
    for kind, filename in [("predispatch", "run_runtime_predispatch_gate.mjs"), ("full-worker", "run_full_worker_batch_gate.mjs")]:
        if source_route:
            steps.append((kind + "-red", [repaired / filename, "--expect-red", red_root]))
        green_script = repaired / filename
        marker_mapping = {
            "readAnalyticsResultCacheForCurrentSettings(requestedPhysicalCommand)": "readCache(requestedPhysicalCommand)",
            "OzonContract.reviewedAnalyticsAcquisitionProfile(requestedPhysicalCommand)": "reviewedAcquisitionProfile(requestedPhysicalCommand,)",
            "prepareProviderQuotaForCommand(physicalCommandForQuota)": "prepareQuota(physicalCommandForQuota)",
            "executeOzonCore(liveEntry.command_text": "execute(liveEntry.command_text",
        }
        if expected_version in ("0.2.1", "0.2.2", "0.2.3", "0.2.4", "0.2.5", "0.2.6") and kind == "predispatch":
            # Only the four renamed ports in the structural order assertion change.
            # The original test and RED route remain untouched; all behavior assertions stay intact.
            original_source = green_script.read_text()
            adapted_source = original_source
            for old, new in marker_mapping.items():
                old_literal, new_literal = json.dumps(old), json.dumps(new)
                assert adapted_source.count(old_literal) == 1, old
                adapted_source = adapted_source.replace(old_literal, new_literal)
            position_probe = "workerSource.indexOf(marker)"
            assert adapted_source.count(position_probe) == 1
            adapted_source = adapted_source.replace(position_probe, r"workerSource.replace(/\s+/g, '').indexOf(marker.replace(/\s+/g, ''))")
            green_script = repaired / "run_composed_predispatch_gate.mjs"
            green_script.write_text(adapted_source)
            baseline.write_json(runner.output / (label + "-predispatch-port-map.json"), {
                "source_sha256": baseline.sha256(original_source.encode()),
                "adapted_sha256": baseline.sha256(adapted_source.encode()),
                "marker_mapping": marker_mapping, "behavior_assertions_changed": False,
            })
        green_args = [green_script, ozon]
        if expected_version == "0.2.3" and kind == "full-worker":
            original_source = green_script.read_text()
            old_sender = 'listener(message, sender, (response) => {'
            new_sender = 'listener(message, /^OZ_(?:SAVE_|BIND_CONVERSATION|WORK_RESUME|SET_MANUAL_MODE|GET_DIAGNOSTICS)/.test(message.type) ? { url: chrome.runtime.getURL("popup.html") } : sender, (response) => {'
            assert original_source.count(old_sender) == 1
            adapted_source = original_source.replace(old_sender, new_sender)
            green_script = repaired / "run_composed_full_worker_gate.mjs"
            green_script.write_text(adapted_source)
            baseline.write_json(runner.output / (label + "-popup-sender-adaptation.json"), {
                "source_sha256": baseline.sha256(original_source.encode()),
                "adapted_sha256": baseline.sha256(adapted_source.encode()),
                "change": "settings/bind/resume/manual-mode fixture messages originate from the real privileged popup",
                "behavior_assertions_changed": False,
            })
            green_args = [green_script, ozon]
        if expected_version in ("0.2.4", "0.2.5", "0.2.6") and kind == "full-worker":
            # v0.2.4+ uses the composed application runtime and its real SA_
            # fixture handshake. The frozen donor remains the RED/old-version
            # route and is never rewritten or accepted through legacy setup.
            green_script = ROOT / "tests/regression/extension-core/full-worker-composed.mjs"
            green_args = [green_script, prod]
            baseline.write_json(runner.output / (label + "-full-worker-adaptation.json"), {
                "donor": str(repaired / filename),
                "candidate": str(green_script),
                "setup": ["makeWorker", "SA_STORE_SAVE", "SA_WORK_START", "start_ack_identity"],
                "legacy_setup_used": False,
                "assertion_inventory": {"report_aliases": 9, "seller_operation": 1, "performance_auth_per_fresh_worker": 1,
                                         "planning": 1, "provider_request": 1, "result": 1, "failure_events_zero": 2,
                                         "provider_split": {"performance": {"performance_business": 1, "seller_business": 0, "performance_auth": 1}, "seller": {"performance_business": 0, "seller_business": 1, "performance_auth": 0}}, "semantic_fingerprint": "cd4bce38",
                                         "attachment_port_loaded": True, "storage_wake_loaded": True},
                "behavior_assertions_changed": False,
            })
        steps.append((kind + "-green", green_args))
    for name, args in steps:
        runner.run(label + "-" + name, ["node", *args], cwd=repo)
    baseline.write_json(runner.output / (label + "-authority.json"),
                        {"version_and_permission_checks": "PASS", "route_invocations": len(steps),
                         "source_route": source_route, "runtime_file_count": len(texts)})


def wb_route(runner, runtime, label, mode):
    tests = ROOT / "tests/regression/imported/wildberries-v0.3.0/progress/full_migration_2026-09-13/tests"
    donor = ROOT / "tests/fixtures/imported/wb-donor-e01b051c/runtime"
    declared = set(baseline.read_json(baseline.EVIDENCE / "TEST_AND_AUTHORITY_INPUTS.json")["wb_suites"])
    actual = {p.stem for p in tests.iterdir() if p.suffix in (".py", ".mjs")
              and not p.stem.startswith("run_") and p.stem not in ("worker_rpc", "worker_harness")}
    assert actual == declared and len(actual) == 52
    if mode == "browsers":
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            chromium = os.environ.get("WB_TEST_CHROMIUM") or pw.chromium.executable_path
        assert Path(chromium).is_file(), f"Chromium missing: {chromium}"
        runner.env["WB_TEST_CHROMIUM"] = chromium
        baseline.write_json(runner.output / "browser-environment.json", {
            "playwright_python": importlib.metadata.version("playwright"),
            "chromium_version": subprocess.check_output([chromium, "--version"], text=True).strip(),
            "executable": chromium, "installed_extension_acceptance": False,
        })
    result = runner.output / (label + "-" + mode)
    runner.run(label + "-" + mode, [sys.executable, tests / "run_family_gate.py", runtime, result, mode, donor], timeout=1800)
    summary = baseline.read_json(result / "summary.json")
    expected = 35 if mode == "nodes" else 17
    assert summary["status"] == "PASS" and summary["suites"] == expected and summary["failed"] == 0
    rows = [json.loads(s) for s in (result / "suites.jsonl").read_text(encoding="utf-8").splitlines() if s]
    wanted = {p.stem for p in tests.glob("*.mjs" if mode == "nodes" else "*.py")
              if p.stem in declared}
    assert len(rows) == expected and {r["suite"] for r in rows} == wanted
    assert all(r["exit_code"] == 0 and r["status"] == "PASS" for r in rows)
    print(label + " " + mode + ": " + json.dumps(summary), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suite", choices=("verify", "ozon", "wb-nodes", "wb-browsers", "all"), default="all")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    runner = Runner(output)
    summary = {"status": "RUNNING", "suite": args.suite, "python": platform.python_version(),
               "node": subprocess.check_output(["node", "--version"], text=True).strip(),
               "os": platform.system(), "source_runtime_changes": 0, "installed_acceptance": False}
    try:
        summary["identity"] = baseline.verify_import()
        negative_control(output)
        work = output / "work"
        work.mkdir()
        for component in ("ozon", "wildberries"):
            if args.suite != "all" and args.suite != "verify" and not args.suite.startswith("wb" if component == "wildberries" else "ozon"):
                continue
            extracted, receipt = baseline.build_baseline(component, output / "packages" / component)
            summary[component + "_package"] = receipt
            if component == "ozon" and args.suite in ("ozon", "all"):
                ozon_route(runner, work, ROOT / baseline.PREFIXES[component], "ozon-source", True)
                ozon_route(runner, work, extracted, "ozon-package", False)
            if component == "wildberries":
                for mode in ("nodes", "browsers"):
                    if args.suite in ("all", "wb-" + mode):
                        wb_route(runner, ROOT / baseline.PREFIXES[component], "wb-source", mode)
                        wb_route(runner, extracted, "wb-package", mode)
        summary["status"] = "PASS"
    except Exception as error:
        summary["status"] = "FAIL"
        summary["error"] = type(error).__name__ + ": " + str(error)
    finally:
        summary["gate_processes"] = len(runner.rows)
        baseline.write_json(output / "summary.json", summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    return 0 if summary["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
