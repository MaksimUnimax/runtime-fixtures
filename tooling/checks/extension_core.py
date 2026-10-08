"""Run tests against the actual common-core composition and its extracted ZIP."""
from pathlib import Path
import argparse
import importlib.util
import json
import platform
import subprocess
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


composed = load("extension_composed", "tooling/build/extension_composed.py")
original = load("extension_import", "tooling/checks/extension_import.py")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    runner = original.Runner(output)
    result = {"stage": "D2.4", "status": "RUNNING", "os": platform.system(),
              "python": platform.python_version(), "node": subprocess.check_output(["node", "--version"], text=True).strip(),
              "live_provider_calls": 0, "installed_acceptance": False}
    try:
        runner.run("core-composed-version-policy", [sys.executable, "-B", ROOT / "tests/regression/extension-core/test-composed-version-policy.py"])
        original.negative_control(output)
        runner.run("core-provider-response-policy-differential", ["node", ROOT / "tests/regression/extension-core/provider-response-policy.mjs", ROOT])
        runner.run("core-provider-response-verifier-differential", ["node", ROOT / "tests/regression/extension-core/provider-response-verifier.mjs", ROOT])
        runner.run("core-provider-response-disposition-differential", ["node", ROOT / "tests/regression/extension-core/provider-response-disposition.mjs", ROOT])
        runner.run("core-provider-response-retention-differential", ["node", ROOT / "tests/regression/extension-core/provider-response-retention.mjs", ROOT])
        runner.run("core-provider-response-composition", ["node", ROOT / "tests/regression/extension-core/provider-response-composition.mjs", ROOT])
        runner.run("core-store-package-contract", [sys.executable, ROOT / "tests/regression/extension-core/store-package-contract.py"])
        runner.run("core-build-create-pending-extraction", ["node", ROOT / "tests/regression/extension-core/client-i1/create-pending-work-start-extraction.mjs"])
        source, extracted, receipt = composed.build(output / "package")
        result["composition"] = receipt
        runner.run("core-store-metadata-and-import-fences", ["node", ROOT / "tests/regression/extension-core/client-i1/client-d3s2-store-metadata-state.mjs", ROOT])
        work = output / "work"
        work.mkdir()
        for runtime, label, source_route in [(source, "core-source", True), (extracted, "core-package", False)]:
            original.ozon_route(runner, work, runtime, label, source_route, expected_version=original.current_composed_version())
            runner.run(label + "-contracts", ["node", ROOT / "tests/regression/extension-core/core-contracts.mjs", runtime])
            runner.run(label + "-ozon-guidance-entitlement", ["node", ROOT / "tests/regression/extension-core/ozon-guidance-entitlement.mjs", runtime])
            runner.run(label + "-ozon-advertising-guidance-readiness", ["node", ROOT / "tests/regression/extension-core/ozon-advertising-guidance-readiness.mjs", runtime])
            runner.run(label + "-ozon-search-guidance-readiness", ["node", ROOT / "tests/regression/extension-core/ozon-search-guidance-readiness.mjs", runtime])
            runner.run(label + "-conversation-binding-lifecycle", ["node", ROOT / "tests/regression/extension-core/conversation-binding-lifecycle.mjs", runtime])
            runner.run(label + "-worker", ["node", ROOT / "tests/regression/extension-core/worker-lifecycle.mjs", runtime])
            runner.run(label + "-context", ["node", ROOT / "tests/regression/extension-core/batch-context.mjs", runtime])
            runner.run(label + "-attachment-port-idle", ["node", ROOT / "tests/regression/extension-core/attachment-port-idle.mjs", runtime])
            runner.run(label + "-wb-adapter", ["node", ROOT / "tests/regression/extension-core/wb-adapter.mjs", runtime])
            runner.run(label + "-application", ["node", ROOT / "tests/regression/extension-core/application.mjs", runtime])
            runner.run(label + "-owner-opera-start-keys", ["node", ROOT / "tests/regression/extension-core/owner-opera-start-keys.mjs", runtime])
            runner.run(label + "-transfer-recipient-recovery", ["node", ROOT / "tests/regression/extension-core/client-i1/client-transfer-recipient-recovery.mjs", runtime])
            runner.run(label + "-transfer-popup", ["node", ROOT / "tests/regression/extension-core/client-i1/client-transfer-popup-receive.mjs", runtime])
            runner.run(label + "-support-snapshot", ["node", ROOT / "tests/regression/extension-core/client-i1/client-support-snapshot.mjs", runtime])
            runner.run(label + "-start-diagnostics", ["node", ROOT / "tests/regression/extension-core/client-i1/client-start-diagnostics.mjs", runtime])
            runner.run(label + "-firefox-technical-data-consent", ["node", ROOT / "tests/regression/extension-core/client-i1/firefox-technical-data-consent.mjs", runtime])
            runner.run(label + "-firefox-local-authority", ["node", ROOT / "tests/regression/extension-core/client-i1/firefox-local-authority.mjs"])
            runner.run(label + "-firefox-privacy-neutral-client", ["node", ROOT / "tests/regression/extension-core/client-i1/firefox-privacy-neutral-client.mjs", runtime])
            runner.run(label + "-client-profile-contract-and-forget", ["node", ROOT / "tests/regression/extension-core/client-i1/client-profile-contract-and-forget.mjs", runtime])
            runner.run(label + "-signed-profile-consumer", ["node", ROOT / "tests/regression/extension-core/client-i1/signed-profile-consumer.mjs", runtime])
            runner.run(label + "-signed-profile-runtime", ["node", ROOT / "tests/regression/extension-core/client-i1/signed-profile-runtime.mjs", runtime])
            runner.run(label + "-firefox-popup-consent-source", ["node", ROOT / "tests/regression/extension-core/client-i1/firefox-popup-consent-source.mjs", runtime])
            runner.run(label + "-onboarding", ["node", ROOT / "tests/regression/extension-core/client-i1/client-onboarding.mjs", runtime])
            repo = work / label
            validation = repo / composed.baseline.OZON_REL / "validation"
            runner.run(label + "-transaction-abort", ["node", validation / "indexeddb-transaction-durability-v1/run_prefix_transaction_abort_gate.mjs", repo])
            runner.run(label + "-attachment", ["node", validation / "regression/run_direct_binary_provider_attachment_gate.mjs"])
        result["status"] = "PASS"
    except Exception as error:
        result["status"] = "FAIL"
        result["error"] = type(error).__name__ + ": " + str(error)
    finally:
        result["gate_processes"] = len(runner.rows)
        composed.baseline.write_json(output / "summary.json", result)
    print(json.dumps({k: v for k, v in result.items() if k != "composition"}, ensure_ascii=False, indent=2))
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
