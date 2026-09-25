#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import sys
from pathlib import Path


class ReleaseVerificationError(RuntimeError):
    pass


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_relative(value: str) -> str:
    normalized = value[2:] if value.startswith("./") else value
    path = Path(normalized)
    if not normalized or path.is_absolute() or ".." in path.parts:
        raise ReleaseVerificationError("RELEASE_PATH_INVALID")
    return path.as_posix()


def _checksums(root: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    for line in (root / "RELEASE_SHA256SUMS").read_text().splitlines():
        if not line:
            continue
        match = re.fullmatch(r"([0-9a-f]{64})\s+(.+)", line)
        if not match:
            raise ReleaseVerificationError("RELEASE_CHECKSUM_LIST_INVALID")
        name = _safe_relative(match.group(2).lstrip(" *"))
        if name in result:
            raise ReleaseVerificationError("RELEASE_CHECKSUM_DUPLICATE")
        result[name] = match.group(1)
    if not result:
        raise ReleaseVerificationError("RELEASE_CHECKSUM_LIST_EMPTY")
    return result


def _symlink_inventory(root: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    for line in (root / "RELEASE_SYMLINKS").read_text().splitlines():
        if not line:
            continue
        try:
            name_raw, target = line.split("\t", 1)
        except ValueError as error:
            raise ReleaseVerificationError("RELEASE_SYMLINK_LIST_INVALID") from error
        name = _safe_relative(name_raw)
        if name in result:
            raise ReleaseVerificationError("RELEASE_SYMLINK_DUPLICATE")
        result[name] = target
    return result


def verify_release(root_value: str | Path) -> dict[str, object]:
    raw_root = Path(root_value)
    if not raw_root.is_absolute() or raw_root.is_symlink():
        raise ReleaseVerificationError("RELEASE_ROOT_INVALID")
    root = raw_root.resolve(strict=True)
    if not root.is_dir():
        raise ReleaseVerificationError("RELEASE_ROOT_INVALID")

    required = {
        "RELEASE_MANIFEST.json",
        "RELEASE_SHA256SUMS",
        "RELEASE_SYMLINKS",
    }
    if any(not (root / name).is_file() for name in required):
        raise ReleaseVerificationError("RELEASE_METADATA_MISSING")

    manifest = json.loads((root / "RELEASE_MANIFEST.json").read_text())
    if manifest.get("format") != "octoport-ops-release-v1":
        raise ReleaseVerificationError("RELEASE_MANIFEST_INVALID")
    source_sha = str(manifest.get("sourceSha", ""))
    source_tree = str(manifest.get("sourceTree", ""))
    if not re.fullmatch(r"[0-9a-f]{40}", source_sha):
        raise ReleaseVerificationError("RELEASE_SOURCE_SHA_INVALID")
    if not re.fullmatch(r"[0-9a-f]{40}", source_tree):
        raise ReleaseVerificationError("RELEASE_SOURCE_TREE_INVALID")
    if root.name != source_sha:
        raise ReleaseVerificationError("RELEASE_DIRECTORY_SHA_MISMATCH")

    expected_files = _checksums(root)
    actual_files: dict[str, Path] = {}
    actual_links: dict[str, str] = {}
    root_resolved = root.resolve()

    entries = [root, *root.rglob("*")]
    for path in entries:
        metadata = path.lstat()
        if metadata.st_uid != 0 or metadata.st_gid != 0:
            raise ReleaseVerificationError("RELEASE_OWNERSHIP_INVALID")
        if path.is_symlink():
            name = path.relative_to(root).as_posix()
            target = os.readlink(path)
            actual_links[name] = target
            try:
                resolved = (path.parent / target).resolve(strict=True)
                resolved.relative_to(root_resolved)
            except (FileNotFoundError, RuntimeError, ValueError) as error:
                raise ReleaseVerificationError("RELEASE_SYMLINK_INVALID") from error
            continue
        if path.is_dir():
            if stat.S_IMODE(metadata.st_mode) & 0o022:
                raise ReleaseVerificationError("RELEASE_PERMISSIONS_INVALID")
            continue
        if path.is_file():
            if stat.S_IMODE(metadata.st_mode) & 0o022:
                raise ReleaseVerificationError("RELEASE_PERMISSIONS_INVALID")
            name = path.relative_to(root).as_posix()
            if name != "RELEASE_SHA256SUMS":
                actual_files[name] = path
            continue
        raise ReleaseVerificationError("RELEASE_ENTRY_TYPE_INVALID")

    if set(expected_files) != set(actual_files):
        raise ReleaseVerificationError("RELEASE_FILE_SET_MISMATCH")
    for name, expected in expected_files.items():
        if _sha256(actual_files[name]) != expected:
            raise ReleaseVerificationError("RELEASE_CHECKSUM_MISMATCH")

    if _symlink_inventory(root) != actual_links:
        raise ReleaseVerificationError("RELEASE_SYMLINK_SET_MISMATCH")

    return {
        "status": "PASS",
        "sourceSha": source_sha,
        "sourceTree": source_tree,
        "files": len(actual_files),
        "symlinks": len(actual_links),
    }


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: verify_ops_release.py <release-dir>", file=sys.stderr)
        return 2
    try:
        result = verify_release(sys.argv[1])
    except (OSError, ValueError, json.JSONDecodeError, ReleaseVerificationError) as error:
        code = (
            str(error)
            if isinstance(error, ReleaseVerificationError)
            else "RELEASE_VERIFICATION_FAILED"
        )
        print(json.dumps({"status": "FAIL", "code": code}, sort_keys=True), file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
