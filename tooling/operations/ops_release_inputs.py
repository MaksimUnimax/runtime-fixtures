"""Bounded inputs and immutable Node reuse for the Telegram ops preparer.

This helper never deletes releases. Active, rollback and unresolved consumers
must be reconciled before releasing a retained deployment.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess


def runtime_inputs(source: Path) -> list[str]:
    tracked = subprocess.check_output(
        ["git", "-C", str(source), "ls-files", "-z"], text=True
    ).split("\0")
    tracked_set = set(tracked)
    catalog = {}
    for name in tracked:
        path = Path(name)
        if path.name != "package.json" or not name.startswith(("apps/", "packages/", "tooling/")):
            continue
        value = json.loads((source / path).read_text())
        package = value.get("name")
        if package and package.startswith("@product/"):
            if package in catalog:
                raise ValueError("DUPLICATE_WORKSPACE_PACKAGE")
            catalog[package] = (path.parent.as_posix(), value)
    pending = ["@product/telegram-operator"]
    visited = set()
    paths = set()
    while pending:
        package = pending.pop()
        if package in visited:
            continue
        visited.add(package)
        if package not in catalog:
            raise ValueError("MISSING_WORKSPACE_PACKAGE:" + package)
        directory, manifest = catalog[package]
        paths.add(directory)
        for kind in ("dependencies", "optionalDependencies", "devDependencies", "peerDependencies"):
            for name, version in manifest.get(kind, {}).items():
                if str(version).startswith("workspace:"):
                    pending.append(name)
    for name in ("package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json", ".npmrc"):
        if name in tracked_set:
            paths.add(name)
    paths.add("tooling/operations")
    return sorted(paths)


def allocated_bytes(root: Path) -> int:
    seen = set()
    total = 0
    for base, dirs, files in os.walk(root, followlinks=False):
        for name in [".", *dirs, *files]:
            item = Path(base) if name == "." else Path(base) / name
            info = item.lstat()
            key = (info.st_dev, info.st_ino)
            if key not in seen:
                seen.add(key)
                total += info.st_blocks * 512
    return total


def check_budget(root: Path, max_count: int, max_bytes: int, reserve_bytes: int) -> dict:
    if min(max_count, max_bytes, reserve_bytes) <= 0:
        raise ValueError("INVALID_RELEASE_BUDGET")
    releases = [p for p in root.iterdir() if re.fullmatch(r"[0-9a-f]{40}", p.name) and p.is_dir()]
    used = allocated_bytes(root)
    filesystem = os.statvfs(root)
    free = filesystem.f_bavail * filesystem.f_frsize
    if len(releases) >= max_count:
        raise ValueError("OPS_RELEASE_COUNT_LIMIT: reconcile retained deployments before preparing another")
    if used >= max_bytes:
        raise ValueError("OPS_RELEASE_BYTES_LIMIT: reconcile retained deployments before preparing another")
    # Allow bounded staging growth while preserving the required free reserve.
    if free < reserve_bytes + 1024 * 1024 * 1024:
        raise ValueError("OPS_RELEASE_FREE_SPACE_RESERVE")
    return {"release_count": len(releases), "allocated_bytes": used, "free_bytes": free}


def sha256_file(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def stage_node(source: Path, stage: Path, root: Path) -> str:
    digest = sha256_file(source)
    destination = stage / ".runtime" / "node"
    destination.parent.mkdir(parents=True, exist_ok=True)
    for release in sorted(root.iterdir()):
        if not re.fullmatch(r"[0-9a-f]{40}", release.name) or release.is_symlink():
            continue
        donor = release / ".runtime" / "node"
        manifest = release / "RELEASE_MANIFEST.json"
        try:
            info = donor.lstat()
            if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o555 or info.st_uid != os.geteuid():
                continue
            data = json.loads(manifest.read_text())
            if data.get("sourceSha") != release.name or data.get("runtime", {}).get("nodeSha256") != digest:
                continue
            if sha256_file(donor) != digest:
                continue
            os.link(donor, destination)
            return "verified_immutable_hardlink"
        except FileNotFoundError:
            continue
        except OSError as error:
            if error.errno != 18:  # A different filesystem cannot share a hardlink.
                raise
    with source.open("rb") as origin, destination.open("xb") as target:
        shutil.copyfileobj(origin, target)
    destination.chmod(0o555)
    return "private_copy"


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="action", required=True)
    inputs = sub.add_parser("inputs")
    inputs.add_argument("source", type=Path)
    budget = sub.add_parser("budget")
    budget.add_argument("root", type=Path)
    budget.add_argument("--max-count", type=int, default=16)
    budget.add_argument("--max-bytes", type=int, default=8 * 1024**3)
    budget.add_argument("--reserve-bytes", type=int, default=3 * 1024**3)
    node = sub.add_parser("stage-node")
    node.add_argument("source", type=Path)
    node.add_argument("stage", type=Path)
    node.add_argument("root", type=Path)
    args = parser.parse_args()
    if args.action == "inputs":
        print("\n".join(runtime_inputs(args.source)))
    elif args.action == "budget":
        print(json.dumps(check_budget(args.root, args.max_count, args.max_bytes, args.reserve_bytes)))
    else:
        print(stage_node(args.source, args.stage, args.root))


if __name__ == "__main__":
    main()
