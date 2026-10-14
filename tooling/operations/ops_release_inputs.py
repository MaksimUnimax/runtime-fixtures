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
    for name in ("package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json", ".npmrc", "tooling/server/monitor-pilot-authority.ts"):
        if name in tracked_set:
            paths.add(name)
    paths.add("tooling/operations")
    return sorted(paths)


def allocated_bytes(root: Path) -> int:
    seen = set()
    total = 0
    device = root.stat().st_dev
    for base, dirs, files in os.walk(root, followlinks=False):
        dirs[:] = [name for name in dirs if (Path(base) / name).lstat().st_dev == device]
        for name in [".", *dirs, *files]:
            item = Path(base) if name == "." else Path(base) / name
            info = item.lstat()
            if info.st_dev != device:
                continue
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
    growth = staging_growth_bytes(filesystem.f_frsize)
    if used + growth > max_bytes:
        raise ValueError("OPS_RELEASE_BYTES_LIMIT: reconcile retained deployments before preparing another")
    # The temporary filesystem bounds the build. Admit its entire export up front.
    if free < reserve_bytes + growth:
        raise ValueError("OPS_RELEASE_FREE_SPACE_RESERVE")
    return {"release_count": len(releases), "allocated_bytes": used, "free_bytes": free,
            "stage_bytes": STAGE_BYTES, "stage_inodes": STAGE_INODES, "export_bound_bytes": growth}


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


# The build filesystem has a kernel-enforced aggregate size/inode limit.
# Reserve room for its complete export, including conservative filesystem metadata.
STAGE_BYTES = 1024**3
STAGE_INODES = 65536


def staging_growth_bytes(block_size: int) -> int:
    return STAGE_BYTES + STAGE_INODES * 2 * block_size


def export_projection(stage: Path, block_size: int) -> int:
    seen = set()
    paths = set()
    entries = 0
    data_bytes = 0
    for base, dirs, files in os.walk(stage, followlinks=False):
        for name in [".", *dirs, *files]:
            item = Path(base) if name == "." else Path(base) / name
            info = item.lstat()
            if item in paths:
                continue
            paths.add(item)
            key = (info.st_dev, info.st_ino)
            entries += 1
            if stat.S_ISREG(info.st_mode) and key not in seen:
                seen.add(key)
                data_bytes += ((info.st_size + block_size - 1) // block_size) * block_size
            elif stat.S_ISLNK(info.st_mode):
                target = os.readlink(item)
                if os.path.isabs(target) or not (item.parent / target).resolve().is_relative_to(stage.resolve()):
                    raise ValueError("OPS_STAGE_EXTERNAL_SYMLINK")
            elif not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
                raise ValueError("OPS_STAGE_UNSUPPORTED_FILE")
    if data_bytes > STAGE_BYTES or entries > STAGE_INODES:
        raise ValueError("OPS_STAGE_BYTES_OR_INODES_LIMIT")
    return data_bytes + entries * 2 * block_size


def export_stage(stage: Path, destination: Path, root: Path, node: Path,
                 max_bytes: int = 8 * 1024**3, reserve_bytes: int = 3 * 1024**3) -> dict:
    if destination.is_symlink() or not destination.is_dir() or any(destination.iterdir()):
        raise ValueError("OPS_EXPORT_REQUIRES_OWN_EMPTY_DIRECTORY")
    if destination.parent.resolve() != root.resolve():
        raise ValueError("OPS_EXPORT_OUTSIDE_RELEASE_ROOT")
    filesystem = os.statvfs(root)
    projected = export_projection(stage, filesystem.f_frsize)
    used = allocated_bytes(root)
    free = filesystem.f_bavail * filesystem.f_frsize
    bound = staging_growth_bytes(filesystem.f_frsize)
    if used + bound > max_bytes:
        raise ValueError("OPS_RELEASE_BYTES_LIMIT")
    if free < reserve_bytes + bound:
        raise ValueError("OPS_RELEASE_FREE_SPACE_RESERVE")
    copied = {}
    staged_node = stage / ".runtime/node"

    def copy_file(source, target):
        source = Path(source)
        if source == staged_node:
            return str(target)  # Materialize verified Node separately on the target filesystem.
        info = source.stat()
        key = (info.st_dev, info.st_ino)
        if key in copied:
            os.link(copied[key], target)
        else:
            shutil.copy2(source, target)
            copied[key] = target
        return str(target)

    try:
        shutil.copytree(stage, destination, dirs_exist_ok=True, symlinks=True, copy_function=copy_file)
        node_mode = stage_node(node, destination, root)
        used_after = allocated_bytes(root)
        filesystem = os.statvfs(root)
        free_after = filesystem.f_bavail * filesystem.f_frsize
        if used_after > max_bytes or free_after < reserve_bytes:
            raise ValueError("OPS_RELEASE_EXPORT_BUDGET_CHANGED")
        return {"projected_export_bytes": projected, "admitted_export_bound_bytes": bound,
                "allocated_bytes": used_after, "node": node_mode}
    except Exception as error:
        try:
            for item in destination.iterdir():
                if item.is_dir() and not item.is_symlink():
                    shutil.rmtree(item)
                else:
                    item.unlink()
        except Exception as cleanup:
            raise ExceptionGroup("OPS_EXPORT_AND_CLEANUP_FAILED", [error, cleanup]) from error
        raise


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
    export = sub.add_parser("export-stage")
    export.add_argument("stage", type=Path)
    export.add_argument("destination", type=Path)
    export.add_argument("root", type=Path)
    export.add_argument("node", type=Path)
    args = parser.parse_args()
    if args.action == "inputs":
        print("\n".join(runtime_inputs(args.source)))
    elif args.action == "budget":
        print(json.dumps(check_budget(args.root, args.max_count, args.max_bytes, args.reserve_bytes)))
    elif args.action == "stage-node":
        print(stage_node(args.source, args.stage, args.root))
    else:
        print(json.dumps(export_stage(args.stage, args.destination, args.root, args.node)))


if __name__ == "__main__":
    main()
