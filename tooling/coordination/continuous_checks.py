#!/usr/bin/env python3
"""Bounded source/package-VM checks. Never installed, live, or STORE acceptance."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess

TARGETS = {
    "extension-support": "client-support-snapshot.mjs",
    "extension-lifecycle": "client-c3d-autonomous-lifecycle.mjs",
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def source_identity(repo):
    """HEAD plus all tracked edits and untracked input bytes, not timestamps."""
    head = subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], cwd=repo).strip()
    tracked = subprocess.check_output(["git", "ls-files", "-z"], cwd=repo)
    for raw in (x for x in tracked.split(b"\0") if x):
        path = repo / os.fsdecode(raw)
        if path.is_symlink() or not path.resolve().is_relative_to(repo):
            raise RuntimeError("CHECK_INPUT_SYMLINK_REJECTED")
    diff = subprocess.check_output(["git", "diff", "HEAD", "--binary", "--no-ext-diff", "--"], cwd=repo)
    untracked = subprocess.check_output(["git", "ls-files", "--others", "--exclude-standard", "-z"], cwd=repo)
    rows = []
    for raw in sorted(x for x in untracked.split(b"\0") if x):
        path = repo / os.fsdecode(raw)
        if path.is_symlink() or not path.resolve().is_relative_to(repo):
            raise RuntimeError("CHECK_INPUT_SYMLINK_REJECTED")
        rows.append([os.fsdecode(raw), sha(path.read_bytes())])
    return sha(head + b"\0" + diff + b"\0" + json.dumps(rows, sort_keys=True).encode())


def package_identity(directory, composition):
    """Check every actual file; added or replaced bytes also invalidate cache."""
    if directory.is_symlink():
        raise RuntimeError("CHECK_PACKAGE_SYMLINK_REJECTED")
    actual = {}
    for path in sorted(directory.rglob("*")):
        if path.is_symlink():
            raise RuntimeError("CHECK_PACKAGE_SYMLINK_REJECTED")
        if path.is_file():
            actual[path.relative_to(directory).as_posix()] = sha(path.read_bytes())
    expected = {item["path"]: item["sha256"] for item in composition["files"]}
    if len(expected) != len(composition["files"]) or actual != expected:
        raise RuntimeError("CHECK_PACKAGE_BYTES_CHANGED")
    package = composition["package"]
    name = package["name"]
    if not isinstance(name, str) or Path(name).name != name:
        raise RuntimeError("CHECK_ARCHIVE_PATH_INVALID")
    archive = directory.parent / name
    if archive.is_symlink() or not archive.is_file():
        raise RuntimeError("CHECK_ARCHIVE_INVALID")
    data = archive.read_bytes()
    if len(data) != package["bytes"] or sha(data) != package["sha256"]:
        raise RuntimeError("CHECK_ARCHIVE_BYTES_CHANGED")
    return sha(json.dumps({"files": actual, "archive": sha(data)}, sort_keys=True).encode())


def build_package(repo, output):
    path = repo / "tooling/build/extension_composed.py"
    spec = importlib.util.spec_from_file_location("continuous_check_composer", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.build(output, mode="development")


def prepare_package(repo, output_root, builder=build_package):
    identity = source_identity(repo)
    location = output_root / ("extension-" + identity)
    marker = location / "verified-composition.json"
    if location.is_symlink():
        raise RuntimeError("CHECK_CACHE_SYMLINK_REJECTED")
    if marker.exists():
        if marker.is_symlink():
            raise RuntimeError("CHECK_CACHE_SYMLINK_REJECTED")
        receipt = json.loads(marker.read_text())
        if receipt["source_identity"] != identity or receipt["mode"] != "development":
            raise RuntimeError("CHECK_CACHE_BINDING_CHANGED")
        composition = receipt["composition"]
        extracted = location / "package/extracted"
    else:
        location.mkdir(mode=0o700, parents=True, exist_ok=False)
        _, extracted, composition = builder(repo, location / "package")
        if extracted.resolve() != (location / "package/extracted").resolve():
            raise RuntimeError("CHECK_BUILDER_OUTPUT_OUTSIDE_JOB")
        receipt = {"source_identity": identity, "mode": "development", "composition": composition}
        package_identity(extracted, composition)
        if source_identity(repo) != identity:
            raise RuntimeError("CHECK_BUILDER_MUTATED_INPUTS")
        marker.write_text(json.dumps(receipt, sort_keys=True) + "\n")
        marker.chmod(0o600)
    package_identity(extracted, composition)
    return extracted, receipt


def run_check(repo, output_root, target, node):
    runtime, receipt = prepare_package(repo, output_root)
    before = package_identity(runtime, receipt["composition"])
    test = repo / "tests/regression/extension-core/client-i1" / TARGETS[target]
    result = subprocess.run([node, str(test), str(runtime)], cwd=repo, check=False)
    after = package_identity(runtime, receipt["composition"])
    if source_identity(repo) != receipt["source_identity"] or after != before:
        raise RuntimeError("CHECK_MUTATED_INPUTS")
    print(json.dumps({"check": target, "boundary": "SOURCE_PACKAGE_VM", "installed": False,
                      "live": False, "store": False, "source_identity": receipt["source_identity"],
                      "package_sha256": receipt["composition"]["package"]["sha256"],
                      "files_sha256": after, "exit_code": result.returncode}), flush=True)
    return result.returncode


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("check", choices=sorted(TARGETS))
    args = parser.parse_args()
    repo = Path.cwd().resolve()
    if Path(subprocess.check_output(["git", "rev-parse", "--show-toplevel"], cwd=repo, text=True).strip()).resolve() != repo:
        raise RuntimeError("CHECK_REPOSITORY_ROOT_REQUIRED")
    raw = os.environ.get("OCTOPORT_RUNTIME_CHECK_ROOT")
    if not raw:
        raise RuntimeError("CHECK_MANAGED_OUTPUT_REQUIRED")
    output = Path(raw)
    if not output.is_absolute() or output.is_symlink() or not output.resolve().is_relative_to("/root/octoport-control"):
        raise RuntimeError("CHECK_OUTPUT_OUTSIDE_CONTROL")
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    return run_check(repo, output.resolve(), args.check, os.environ.get("SA_NODE_BIN", "node"))


if __name__ == "__main__":
    raise SystemExit(main())
