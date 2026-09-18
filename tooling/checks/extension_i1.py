"""Run the I1-C1 client composition and its source/package regressions."""
from pathlib import Path
import argparse
import importlib.util
import json
import os
import platform
import subprocess

ROOT = Path(__file__).resolve().parents[2]
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

composed = load("extension_i1_composed", "tooling/build/extension_composed.py")
original = load("extension_i1_runner", "tooling/checks/extension_import.py")

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    node = os.environ.get("SA_NODE_BIN", "node")
    result = {"stage": "I1-C1", "status": "RUNNING", "os": platform.system(),
              "python": platform.python_version(), "node": subprocess.check_output([node, "--version"], text=True).strip(),
              "installed_acceptance": False}
    runner = original.Runner(output)
    try:
        original.negative_control(output)
        source, extracted, receipt = composed.build(output / "package")
        assert receipt["stage"] == "I1-C1" and receipt["version"] == "0.2.4"
        result["composition"] = receipt
        for runtime, label in ((source, "i1-source"), (extracted, "i1-package")):
            manifest = composed.baseline.read_json(runtime / "manifest.json")
            assert manifest["version"] == "0.2.4"
            assert "http://127.0.0.1:43100/*" in manifest["host_permissions"]
            assert "http://127.0.0.1:43101/*" in manifest["host_permissions"]
            for file in sorted(runtime.rglob("*.js")):
                runner.run(label + "-syntax-" + file.stem, [node, "--check", file])
            tests = [
                ("contracts", ROOT / "tests/regression/extension-core/core-contracts.mjs"),
                ("worker", ROOT / "tests/regression/extension-core/worker-lifecycle.mjs"),
                ("context", ROOT / "tests/regression/extension-core/batch-context.mjs"),
                ("wb", ROOT / "tests/regression/extension-core/wb-adapter.mjs"),
                ("application", ROOT / "tests/regression/extension-core/application.mjs"),
                ("i1-lifecycle", ROOT / "tests/regression/extension-core/client-i1/client-lifecycle.mjs"),
                ("i1-races", ROOT / "tests/regression/extension-core/client-i1/client-races.mjs"),
                ("i1-r2", ROOT / "tests/regression/extension-core/client-i1/client-r2.mjs"),
                ("i1-r3", ROOT / "tests/regression/extension-core/client-i1/client-r3.mjs"),
                ("i1-r4", ROOT / "tests/regression/extension-core/client-i1/client-r4.mjs"),
                ("i1-r5", ROOT / "tests/regression/extension-core/client-i1/client-r5.mjs"),
                ("i1-cache-time", ROOT / "tests/regression/extension-core/client-i1/client-cache-time.mjs"),
                ("i1-offline-policy", ROOT / "tests/regression/extension-core/client-i1/client-offline-policy.mjs"),
                ("i1-signed-metadata", ROOT / "tests/regression/extension-core/client-i1/client-signed-metadata.mjs"),
                ("i1-packaged-capabilities", ROOT / "tests/regression/extension-core/client-i1/client-packaged-capabilities.mjs"),
                ("i1-capability-intersection", ROOT / "tests/regression/extension-core/client-i1/client-capability-intersection.mjs"),
                ("i1-c2-3a-online-work-authority", ROOT / "tests/regression/extension-core/client-i1/client-c2-3a-online-work-authority.mjs"),
                ("i1-c3c-autonomous-authority", ROOT / "tests/regression/extension-core/client-i1/client-c3c-autonomous-authority.mjs"),
                ("i1-c2-3c2-offline-lifecycle", ROOT / "tests/regression/extension-core/client-i1/client-c2-3c2-offline-lifecycle.mjs"),
                ("i1-c2-3c2-offline-continuation", ROOT / "tests/regression/extension-core/client-i1/client-c2-3c2-offline-continuation.mjs"),
                ("i1-c2-3b1-health-transport", ROOT / "tests/regression/extension-core/client-i1/client-c2-3b1-health-transport.mjs"),
                ("i1-c2-3b1-canwork", ROOT / "tests/regression/extension-core/client-i1/client-c2-3b1-canwork.mjs"),
                ("i1-c2-3b2-verified-health-authority", ROOT / "tests/regression/extension-core/client-i1/client-c2-3b2-verified-health-authority.mjs"),
                ("i1-c2-3c1-online-work-admission", ROOT / "tests/regression/extension-core/client-i1/client-c2-3c1-online-work-admission.mjs"),
                ("i1-c3d-autonomous-lifecycle", ROOT / "tests/regression/extension-core/client-i1/client-c3d-autonomous-lifecycle.mjs"),
            ]
            for test_name, test in tests:
                runner.run(label + "-" + test_name, [node, test, runtime])
            runner.run(label + "-i1-d3c-signed-readback", [os.environ.get("SA_PNPM_BIN", "pnpm"), "exec", "tsx", "../../tests/regression/extension-core/client-i1/client-d3c-signed-readback.ts", runtime], cwd=ROOT / "apps/api")
            runner.run(label + "-i1-verifier", [node, ROOT / "tests/regression/extension-core/client-i1/verifier.mjs", runtime / "shared/bootstrap_verifier.js"])
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
