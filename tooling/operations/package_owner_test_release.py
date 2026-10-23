#!/usr/bin/env python3
"""Package an exact CI build; never install, provision, or access a live service.

Use only a fresh, trusted build checkout. Git identity and clean tracked inputs
are checked, but freshness/provenance of ignored compiler outputs must ALSO be
established by the independent CI/build receipt. An archive is not a deployment.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import tempfile

from verify_owner_test_release import (
    ADMIN_HEALTH_ARTIFACTS, NEXT_BUILD_IDS, SERVICE_ENTRIES,
    verify_owner_test_release, _compiled_admin_base_path,
)

ROOTS = ("@product/api", "@product/worker", "@product/portal", "@product/admin")
MAX_BYTES = 2 * 1024**3
MAX_FILES = 100_000
MAX_FILE_BYTES = 256 * 1024**2
FLOOR_BYTES = 512 * 1024**2
NODE_VERSION = "v24.20.0"


class PackageError(RuntimeError):
    pass


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def git(source: Path, *args: str) -> bytes:
    # The trusted fresh CI checkout belongs to the runner, not to the root
    # package writer. Drop identity for these read-only Git operations instead
    # of disabling Git's repository-ownership protection with safe.directory.
    if not args or args[0] not in ("rev-parse", "status", "ls-tree", "cat-file"):
        raise PackageError("PACKAGE_GIT_OPERATION_NOT_READ_ONLY")
    owner = source.stat()
    git_directory = source / ".git"
    if (git_directory.is_symlink() or not git_directory.is_dir() or
            git_directory.stat().st_uid != owner.st_uid):
        raise PackageError("PACKAGE_GIT_OWNER_MISMATCH")
    options = {}
    if os.geteuid() == 0:
        options = {"user": owner.st_uid, "group": owner.st_gid, "extra_groups": []}
    elif os.geteuid() != owner.st_uid:
        raise PackageError("PACKAGE_GIT_OWNER_MISMATCH")
    environment = {"HOME": "/nonexistent", "PATH": "/usr/bin:/bin",
                   "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_NOSYSTEM": "1",
                   "GIT_TERMINAL_PROMPT": "0", "GIT_OPTIONAL_LOCKS": "0"}
    result = subprocess.run(
        ["/usr/bin/git", "-C", str(source), *args], capture_output=True, timeout=30,
        env=environment, **options,
    )
    if result.returncode:
        raise PackageError("PACKAGE_GIT_INPUT_INVALID_" + args[0].upper().replace("-", "_"))
    return result.stdout


def identity(source: Path, sha: str, tree: str) -> None:
    if any(re.fullmatch(r"[0-9a-f]{40}", value) is None for value in (sha, tree)):
        raise PackageError("PACKAGE_SOURCE_ID_INVALID")
    if (git(source, "rev-parse", "HEAD").decode().strip() != sha or
            git(source, "rev-parse", "HEAD^{tree}").decode().strip() != tree):
        raise PackageError("PACKAGE_SOURCE_ID_MISMATCH")
    if git(source, "status", "--porcelain=v1", "--untracked-files=no").strip():
        raise PackageError("PACKAGE_TRACKED_SOURCE_DIRTY")


def safe_name(name: str) -> str:
    path = PurePosixPath(name)
    if (not name or path.is_absolute() or path.as_posix() != name or
            any(part in (".", "..", "") for part in path.parts) or
            any(ord(char) < 32 or ord(char) == 127 for char in name)):
        raise PackageError("PACKAGE_PATH_INVALID")
    return name


def source_catalog(source: Path, sha: str) -> tuple[dict, dict]:
    files = {}
    catalog = {}
    for item in git(source, "ls-tree", "-r", "-z", sha).split(b"\0"):
        if not item:
            continue
        meta, raw = item.split(b"\t", 1)
        mode, kind, oid = meta.decode("ascii").split()
        name = safe_name(raw.decode("utf8"))
        files[name] = (mode, kind, oid)
        if (name.endswith("/package.json") and
                name.startswith(("apps/", "packages/", "tooling/"))):
            if kind != "blob" or mode not in ("100644", "100755"):
                raise PackageError("PACKAGE_MANIFEST_NOT_REGULAR")
            value = json.loads(git(source, "cat-file", "blob", oid))
            if not isinstance(value, dict):
                raise PackageError("PACKAGE_MANIFEST_INVALID")
            package = value.get("name")
            if isinstance(package, str) and package.startswith("@product/"):
                if package in catalog:
                    raise PackageError("PACKAGE_WORKSPACE_DUPLICATE")
                catalog[package] = (str(PurePosixPath(name).parent), value)
    return files, catalog


def dependency_specs(manifest: dict) -> dict[str, tuple[str, bool]]:
    result = {}
    peer_meta = manifest.get("peerDependenciesMeta", {})
    for group in ("dependencies", "peerDependencies", "optionalDependencies"):
        values = manifest.get(group, {})
        if not isinstance(values, dict):
            raise PackageError("PACKAGE_DEPENDENCIES_INVALID")
        for name, version in values.items():
            if (not isinstance(name, str) or not isinstance(version, str) or
                    re.fullmatch(r"(?:@[a-zA-Z0-9_.-]+/)?[a-zA-Z0-9_.-]+", name) is None):
                raise PackageError("PACKAGE_DEPENDENCIES_INVALID")
            optional = group == "optionalDependencies" or (
                group == "peerDependencies" and
                isinstance(peer_meta, dict) and
                isinstance(peer_meta.get(name), dict) and
                peer_meta[name].get("optional") is True
            )
            if name in result and not result[name][1] and group != "optionalDependencies":
                optional = False
            result[name] = (version, optional)
    return result


def runtime_workspaces(catalog: dict) -> dict:
    selected = {}
    pending = list(ROOTS)
    while pending:
        name = pending.pop()
        if name in selected:
            continue
        if name not in catalog:
            raise PackageError("PACKAGE_WORKSPACE_MISSING")
        selected[name] = catalog[name]
        for dependency, (version, _) in dependency_specs(catalog[name][1]).items():
            if version.startswith("workspace:"):
                pending.append(dependency)
    return selected


class Inventory:
    """Bounded read-only input discovery; never follow a link outside checkout."""
    def __init__(self, source: Path, workspace_dirs: set[str], max_bytes: int):
        self.source = source
        self.workspace_dirs = workspace_dirs
        self.max_bytes = max_bytes
        self.files: dict[str, tuple[Path, os.stat_result]] = {}
        self.links: dict[str, str] = {}
        self.visited: set[str] = set()
        self.bytes = 0
        self.git_blobs: dict[str, str] = {}
        self.checked_packages: set[Path] = set()
        self.omitted_optional: list[str] = []

    def add_file(self, name: str, path: Path) -> None:
        safe_name(name)
        if name in self.files:
            return
        if name in self.links:
            raise PackageError("PACKAGE_INPUT_COLLISION")
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_FILE_BYTES:
            raise PackageError("PACKAGE_INPUT_NOT_BOUNDED_REGULAR")
        self.bytes += info.st_size
        if self.bytes > self.max_bytes or len(self.files) + len(self.links) >= MAX_FILES:
            raise PackageError("PACKAGE_INPUT_BUDGET_EXCEEDED")
        self.files[name] = (path, info)

    def link(self, path: Path) -> None:
        name = safe_name(path.relative_to(self.source).as_posix())
        if name in self.links:
            return
        if name in self.files:
            raise PackageError("PACKAGE_INPUT_COLLISION")
        target = os.readlink(path)
        if os.path.isabs(target) or any(ord(c) < 32 or ord(c) == 127 for c in target):
            raise PackageError("PACKAGE_EXTERNAL_LINK")
        try:
            resolved = path.resolve(strict=True)
            relative = resolved.relative_to(self.source).as_posix()
        except (OSError, RuntimeError, ValueError) as error:
            raise PackageError("PACKAGE_EXTERNAL_OR_BROKEN_LINK") from error
        if len(self.files) + len(self.links) >= MAX_FILES:
            raise PackageError("PACKAGE_INPUT_BUDGET_EXCEEDED")
        self.links[name] = target
        if relative in self.workspace_dirs:
            return  # Its original tracked sources and dependencies are selected separately.
        parts = PurePosixPath(relative).parts
        if (len(parts) >= 5 and parts[:2] == ("node_modules", ".pnpm") and
                parts[2] != "node_modules" and parts[3] == "node_modules"):
            self.directory(self.source.joinpath(*parts[:3]))
            package_parts = parts[:6] if parts[4].startswith("@") else parts[:5]
            self.external_package(self.source.joinpath(*package_parts))
        else:
            # Runtime links not rooted in the selected pnpm/workspace graph are
            # deliberately unsupported, rather than silently copying other data.
            raise PackageError("PACKAGE_UNAPPROVED_LINK_TARGET")

    def external_package(self, package: Path) -> None:
        if package in self.checked_packages:
            return
        self.checked_packages.add(package)
        fd = open_regular_without_links(package / "package.json")
        with os.fdopen(fd, "rb") as stream:
            raw = stream.read(512 * 1024 + 1)
        if len(raw) > 512 * 1024:
            raise PackageError("PACKAGE_DEPENDENCY_MANIFEST_TOO_LARGE")
        manifest = json.loads(raw)
        if not isinstance(manifest, dict):
            raise PackageError("PACKAGE_DEPENDENCY_MANIFEST_INVALID")
        for name, (_, optional) in dependency_specs(manifest).items():
            found = None
            for parent in (package, *package.parents):
                if parent != self.source and not parent.is_relative_to(self.source):
                    break
                candidate = parent / "node_modules" / name
                if candidate.exists() or candidate.is_symlink():
                    found = candidate
                    break
            if found is None:
                if optional:
                    self.omitted_optional.append(package.relative_to(self.source).as_posix() + ":" + name)
                    continue
                raise PackageError("PACKAGE_TRANSITIVE_DEPENDENCY_MISSING")
            if found.is_symlink():
                self.link(found)
            elif found.is_dir():
                self.directory(found)
                self.external_package(found)
            else:
                raise PackageError("PACKAGE_TRANSITIVE_DEPENDENCY_INVALID")

    def directory(self, path: Path, *, skip_cache: bool = False) -> None:
        name = safe_name(path.relative_to(self.source).as_posix())
        if name in self.visited:
            return
        if path.is_symlink() or not path.is_dir():
            raise PackageError("PACKAGE_INPUT_DIRECTORY_INVALID")
        self.visited.add(name)
        for entry in sorted(path.iterdir()):
            if skip_cache and entry.name == "cache":
                continue
            if entry.is_symlink():
                self.link(entry)
            elif entry.is_dir():
                self.directory(entry)
            else:
                self.add_file(entry.relative_to(self.source).as_posix(), entry)

    def copy(self, stage: Path) -> None:
        for name, (source, before) in sorted(self.files.items()):
            target = stage / name
            target.parent.mkdir(parents=True, exist_ok=True)
            fd = open_regular_without_links(source)
            with os.fdopen(fd, "rb") as incoming:
                opened = os.fstat(incoming.fileno())
                if (not stat.S_ISREG(opened.st_mode) or
                        (opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns) !=
                        (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)):
                    raise PackageError("PACKAGE_INPUT_CHANGED")
                with target.open("xb") as outgoing:
                    blob = hashlib.sha1(b"blob " + str(before.st_size).encode() + b"\0")
                    remaining = before.st_size
                    while remaining:
                        chunk = incoming.read(min(1024 * 1024, remaining))
                        if not chunk:
                            raise PackageError("PACKAGE_INPUT_CHANGED")
                        outgoing.write(chunk)
                        blob.update(chunk)
                        remaining -= len(chunk)
                    after = os.fstat(incoming.fileno())
                    if incoming.read(1) or (after.st_size, after.st_mtime_ns, after.st_ctime_ns) != (before.st_size, before.st_mtime_ns, before.st_ctime_ns):
                        raise PackageError("PACKAGE_INPUT_CHANGED")
                if name in self.git_blobs and blob.hexdigest() != self.git_blobs[name]:
                    raise PackageError("PACKAGE_TRACKED_BLOB_MISMATCH")
            target.chmod(0o555 if before.st_mode & 0o111 else 0o444)
        for name, expected in sorted(self.links.items()):
            if os.readlink(self.source / name) != expected:
                raise PackageError("PACKAGE_INPUT_CHANGED")
            target = stage / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.symlink_to(expected)



def open_regular_without_links(path: Path) -> int:
    if not path.is_absolute():
        raise PackageError("PACKAGE_INPUT_PATH_NOT_ABSOLUTE")
    directory = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in path.parts[1:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = child
        return os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
    finally:
        os.close(directory)


def verify_archive(archive: Path, stage: Path) -> None:
    expected = {}
    for path in [stage, *stage.rglob("*")]:
        name = path.relative_to(stage.parent).as_posix()
        if path.is_symlink():
            expected[name] = ("link", os.readlink(path), None, None)
        elif path.is_dir():
            expected[name] = ("directory", None, stat.S_IMODE(path.stat().st_mode), None)
        else:
            expected[name] = ("file", digest(path), stat.S_IMODE(path.stat().st_mode), path.stat().st_size)
    seen = set()
    with tarfile.open(archive, "r|gz") as tar:
        for member in tar:
            name = safe_name(member.name)
            if (name in seen or name not in expected or member.uid != 0 or member.gid != 0
                    or member.mode & 0o7000 or (not member.issym() and member.mode & 0o022)):
                raise PackageError("PACKAGE_ARCHIVE_ENTRY_INVALID")
            seen.add(name)
            kind, value, mode, size = expected[name]
            if ((mode is not None and member.mode != mode) or
                    (kind == "file" and member.size != size) or
                    (kind != "file" and member.size != 0)):
                raise PackageError("PACKAGE_ARCHIVE_METADATA_MISMATCH")
            if kind == "directory" and member.isdir():
                continue
            if kind == "link" and member.issym() and member.linkname == value:
                continue
            if kind == "file" and member.isfile():
                with tar.extractfile(member) as content:
                    actual = hashlib.file_digest(content, "sha256").hexdigest()
                if actual == value:
                    continue
            raise PackageError("PACKAGE_ARCHIVE_CONTENT_MISMATCH")
    if seen != set(expected):
        raise PackageError("PACKAGE_ARCHIVE_FILE_SET_MISMATCH")


def manifest(stage: Path, sha: str, tree: str) -> dict:
    services = {}
    for name, (entry, cwd) in SERVICE_ENTRIES.items():
        value = {"entry": entry, "entrySha256": digest(stage / entry), "workingDirectory": cwd}
        if name in NEXT_BUILD_IDS:
            value["buildIdSha256"] = digest(stage / NEXT_BUILD_IDS[name])
        if name == "admin":
            value["buildBasePath"] = _compiled_admin_base_path(stage)
            value["healthArtifactsSha256"] = {p: digest(stage / p) for p in ADMIN_HEALTH_ARTIFACTS}
        services[name] = value
    return {"format": "octoport-ops-release-v1", "sourceSha": sha, "sourceTree": tree,
            "runtime": {"nodeSha256": digest(stage / ".runtime/node"), "services": services}}


def inventory_metadata(stage: Path, value: dict) -> str:
    (stage / "RELEASE_MANIFEST.json").write_text(json.dumps(value, sort_keys=True) + "\n")
    links = []
    for path in sorted(stage.rglob("*")):
        if path.is_symlink():
            links.append(path.relative_to(stage).as_posix() + "\t" + os.readlink(path))
    (stage / "RELEASE_SYMLINKS").write_text("\n".join(links) + ("\n" if links else ""))
    lines = []
    for path in sorted(stage.rglob("*")):
        if path.is_file() and not path.is_symlink():
            lines.append(digest(path) + "  " + path.relative_to(stage).as_posix())
    (stage / "RELEASE_SHA256SUMS").write_text("\n".join(lines) + "\n")
    for path in [stage, *stage.rglob("*")]:
        if not path.is_symlink():
            path.chmod(0o555 if path.is_dir() or path.stat().st_mode & 0o111 else 0o444)
    return digest(stage / "RELEASE_SHA256SUMS")



def runtime_import_smoke(stage: Path) -> dict:
    """Finite non-root import probes with NO inherited DB/auth environment."""
    environment = {"HOME": "/tmp", "PATH": "/usr/bin:/bin", "NODE_ENV": "production",
                   "LOG_LEVEL": "fatal", "NEXT_TELEMETRY_DISABLED": "1",
                   "TSX_DISABLE_CACHE": "1", "NO_COLOR": "1"}
    result = {}
    node = str(stage / ".runtime/node")
    for service in ("api", "worker", "portal", "admin"):
        if service in ("api", "worker"):
            args = [node, str(stage / "apps" / service / "node_modules/tsx/dist/cli.mjs"),
                    str(stage / "apps" / service / "dist/main.js")]
        else:
            args = [node, str(stage / SERVICE_ENTRIES[service][0]), "--version"]
        process = subprocess.Popen(args, cwd=stage, env=environment, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, start_new_session=True,
                                   user=65534, group=65534, extra_groups=[])
        try:
            try:
                stdout, stderr = process.communicate(timeout=20)
            except subprocess.TimeoutExpired as error:
                raise PackageError("PACKAGE_RUNTIME_PROBE_TIMEOUT") from error
            if service in ("api", "worker"):
                # loadConfig runs before database initialization. The exact
                # missing databaseUrl Zod error is expected, not success.
                if (process.returncode == 0 or b"ZodError" not in stderr or
                        re.search(rb'"path"\s*:\s*\[\s*"databaseUrl"\s*\]', stderr) is None or
                        b"ERR_MODULE_NOT_FOUND" in stderr or b"Cannot find module" in stderr):
                    raise PackageError("PACKAGE_RUNTIME_IMPORT_GATE_FAILED_" + service.upper())
                result[service] = "IMPORT_GRAPH_LOADED_REQUIRED_CONFIG_REJECTED_NO_DB"
            else:
                if process.returncode != 0 or b"15.5.21" not in stdout:
                    raise PackageError("PACKAGE_NEXT_CLI_GATE_FAILED_" + service.upper())
                result[service] = "PINNED_NEXT_CLI_LOADED_ONLY"
        finally:
            # Only this invocation's finite child process group. Never touch a
            # pre-existing service or silently leave a tsx descendant alive.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait(timeout=5)
    return result


def package_release(source: Path, output: Path, node: Path, sha: str, tree: str,
                    *, max_bytes: int = MAX_BYTES, probe_runtime: bool = False) -> dict:
    if os.geteuid() != 0:
        raise PackageError("PACKAGE_ROOT_OWNERSHIP_REQUIRED")
    if max_bytes <= 0 or max_bytes > MAX_BYTES:
        raise PackageError("PACKAGE_BUDGET_INVALID")
    source = source.resolve(strict=True)
    node = node.resolve(strict=True)
    if output.exists() or output.is_symlink():
        raise PackageError("PACKAGE_OUTPUT_ALREADY_EXISTS")
    parent = output.parent.resolve(strict=True)
    output = parent / output.name
    if output == source or output.is_relative_to(source) or source.is_relative_to(output):
        raise PackageError("PACKAGE_OUTPUT_OVERLAPS_SOURCE")
    identity(source, sha, tree)
    version = subprocess.run([str(node), "--version"], capture_output=True, text=True, timeout=10)
    if version.returncode or version.stdout.strip() != NODE_VERSION:
        raise PackageError("PACKAGE_NODE_VERSION_MISMATCH")
    files, catalog = source_catalog(source, sha)
    selected = runtime_workspaces(catalog)
    dirs = {item[0] for item in selected.values()}
    inputs = Inventory(source, dirs, max_bytes)
    omitted_optional = []
    for name, (mode, kind, oid) in files.items():
        if name in ("package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json") or any(name.startswith(p + "/") for p in dirs):
            if kind != "blob" or mode not in ("100644", "100755"):
                raise PackageError("PACKAGE_TRACKED_INPUT_UNSUPPORTED")
            if any(p == ".git" or p == ".npmrc" or p.startswith(".env") for p in PurePosixPath(name).parts):
                continue
            inputs.add_file(name, source / name)
            inputs.git_blobs[name] = oid
    for directory, value in selected.values():
        for name, (_, optional) in dependency_specs(value).items():
            path = source / directory / "node_modules" / name
            if not path.exists() and not path.is_symlink() and optional:
                omitted_optional.append(directory + ":" + name)
                continue
            if not path.is_symlink():
                raise PackageError("PACKAGE_PNPM_DEPENDENCY_LINK_MISSING")
            inputs.link(path)
    for name in ("api", "worker"):
        inputs.directory(source / "apps" / name / "dist")
    for name in ("portal", "admin"):
        inputs.directory(source / "apps" / name / ".next", skip_cache=True)
    inputs.add_file(".runtime/node", node)
    # Reserve stage plus worst-case uncompressed archive and bounded metadata.
    required_free = inputs.bytes * 2 + (len(inputs.files) + len(inputs.links)) * 2048 + FLOOR_BYTES
    if shutil.disk_usage(parent).free < required_free:
        raise PackageError("PACKAGE_OUTPUT_DISK_RESERVE")
    output.mkdir(mode=0o755)
    output_identity = output.stat()
    stage = output / sha
    stage.mkdir(mode=0o755)
    try:
        inputs.copy(stage)
        identity(source, sha, tree)
        trusted_inventory = inventory_metadata(stage, manifest(stage, sha, tree))
        verification = verify_owner_test_release(stage, expected_source_sha=sha,
            expected_source_tree=tree, expected_inventory_sha256=trusted_inventory)
        probes = runtime_import_smoke(stage) if probe_runtime else {"status": "NOT_RUN"}
        # Confirm probes did not mutate the exact stage hashed above.
        verify_owner_test_release(stage, expected_source_sha=sha, expected_source_tree=tree,
                                  expected_inventory_sha256=trusted_inventory)
        archive = output / ("octoport-owner-test-" + sha + ".tar.gz")
        with tarfile.open(archive, "w:gz", dereference=False, compresslevel=6) as tar:
            for path in [stage, *sorted(stage.rglob("*"))]:
                tar.add(path, arcname=path.relative_to(output).as_posix(), recursive=False)
        archive.chmod(0o444)
        verify_archive(archive, stage)
        receipt = {"format": "octoport-owner-test-build-package-v1", "sourceSha": sha,
            "sourceTree": tree, "runtimeNodeVersion": NODE_VERSION,
            "archive": archive.name, "archiveSha256": digest(archive), "archiveBytes": archive.stat().st_size,
            "trustedInventorySha256": trusted_inventory, "verification": verification,
            "workspaceNames": sorted(selected), "omittedOptionalDependencies": sorted(omitted_optional + inputs.omitted_optional),
            "files": len(inputs.files), "symlinks": len(inputs.links), "inputBytes": inputs.bytes,
            "originRequirement": "Independently verify the exact CI/build source, workflow and artifact digest. This builder cannot authorize its own output.",
            "archiveContentVerified": True, "runtimeImportProbes": probes,
            "acceptance": "BUILT_PACKAGE_ONLY_NOT_INSTALLED_NOT_RECOVERY_NOT_PRODUCTION"}
        (output / "PACKAGE_RECEIPT.json").write_text(json.dumps(receipt, sort_keys=True, indent=2) + "\n")
        (output / "PACKAGE_RECEIPT.json").chmod(0o444)
        return receipt
    except BaseException:
        now = output.lstat()
        if not output.is_symlink() and (now.st_dev, now.st_ino) == (output_identity.st_dev, output_identity.st_ino):
            shutil.rmtree(output)
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--node", required=True, type=Path)
    parser.add_argument("--expected-source-sha", required=True)
    parser.add_argument("--expected-source-tree", required=True)
    args = parser.parse_args()
    try:
        result = package_release(args.source, args.output, args.node,
                                 args.expected_source_sha, args.expected_source_tree, probe_runtime=True)
    except (PackageError, OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        code = str(error) if isinstance(error, PackageError) else "PACKAGE_CREATION_FAILED"
        print(json.dumps({"status": "FAIL", "code": code}), file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
