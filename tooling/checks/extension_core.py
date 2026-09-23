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
        original.negative_control(output)
        source, extracted, receipt = composed.build(output / "package")
        result["composition"] = receipt
        work = output / "work"
        work.mkdir()
        for runtime, label, source_route in [(source, "core-source", True), (extracted, "core-package", False)]:
            original.ozon_route(runner, work, runtime, label, source_route, expected_version="0.2.4")
            runner.run(label + "-contracts", ["node", ROOT / "tests/regression/extension-core/core-contracts.mjs", runtime])
            runner.run(label + "-worker", ["node", ROOT / "tests/regression/extension-core/worker-lifecycle.mjs", runtime])
            runner.run(label + "-context", ["node", ROOT / "tests/regression/extension-core/batch-context.mjs", runtime])
            runner.run(label + "-wb-adapter", ["node", ROOT / "tests/regression/extension-core/wb-adapter.mjs", runtime])
            runner.run(label + "-application", ["node", ROOT / "tests/regression/extension-core/application.mjs", runtime])
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
