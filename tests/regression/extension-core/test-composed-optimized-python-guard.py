"""Fail closed when Python optimized mode would remove composer security asserts."""
from pathlib import Path
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
BUILDER = ROOT / "tooling/build/extension_composed.py"
REQUIRED = "EXTENSION_COMPOSITION_ASSERTIONS_DISABLED"


def run(flags=(), env_overrides=None):
    environment = os.environ.copy()
    environment.pop("PYTHONOPTIMIZE", None)
    environment.update(env_overrides or {})
    return subprocess.run(
        [sys.executable, *flags, "-B", str(BUILDER), "--help"],
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )


def main():
    normal = run()
    assert normal.returncode == 0, ("normal_help", normal.returncode, normal.stderr[:300])
    assert "--output" in normal.stdout, "normal_help_missing_cli_contract"

    cases = [
        ("python-O", ("-O",), {}),
        ("python-OO", ("-OO",), {}),
        ("env-PYTHONOPTIMIZE", (), {"PYTHONOPTIMIZE": "1"}),
    ]
    for label, flags, options in cases:
        result = run(flags, options)
        assert result.returncode != 0, (label, "optimized builder unexpectedly accepted", result.returncode)
        assert REQUIRED in result.stderr, (label, "missing explicit fail-closed diagnostic", result.stderr[:400])
        assert "Traceback" in result.stderr, (label, "unexpected silent acceptance")
    print("COMPOSED_OPTIMIZED_PYTHON_GATE_PASS normal=1 rejected=3")


if __name__ == "__main__":
    main()
