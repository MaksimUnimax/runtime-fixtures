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
import resource
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
MAX_DIRS = 80_000
MAX_DEPTH = 64
MAX_FILE_BYTES = 256 * 1024**2
MAX_GIT_OUTPUT_BYTES = 16 * 1024**2
MAX_MANIFEST_BYTES = 512 * 1024
MAX_PROBE_OUTPUT_BYTES = 256 * 1024
MAX_LINK_TARGET_BYTES = 4096
MAX_PROBE_CGROUP_MEMORY_BYTES = 3072 * 1024**2
MAX_PROBE_CGROUP_PIDS = 128
FLOOR_BYTES = 512 * 1024**2
NODE_VERSION = "v24.20.0"


class PackageError(RuntimeError):
    pass


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()

def bounded_child(argv: list[str], *, timeout: int, max_output: int,
                  overflow_code: str, **kwargs) -> tuple[int, bytes, bytes]:
    """Capture only strictly bounded output; the child's file limit stops floods.

    Anonymous files avoid an unlimited pipe buffer in the parent and leave no
    persistent stdout/stderr artifact. The child owns only its new process group.
    """
    if max_output <= 0 or max_output > MAX_GIT_OUTPUT_BYTES:
        raise PackageError("PACKAGE_PROCESS_OUTPUT_BUDGET_INVALID")

    def limit_output_file_size() -> None:
        resource.setrlimit(resource.RLIMIT_FSIZE, (max_output + 1, max_output + 1))

    with tempfile.TemporaryFile() as stdout_file, tempfile.TemporaryFile() as stderr_file:
        process = subprocess.Popen(
            argv, stdout=stdout_file, stderr=stderr_file, start_new_session=True,
            preexec_fn=limit_output_file_size, **kwargs,
        )
        try:
            process.wait(timeout=timeout)
            stdout_file.seek(0)
            stderr_file.seek(0)
            stdout = stdout_file.read(max_output + 1)
            stderr = stderr_file.read(max_output + 1)
            if len(stdout) > max_output or len(stderr) > max_output:
                raise PackageError(overflow_code)
            return process.returncode, stdout, stderr
        finally:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait(timeout=5)


def verify_output_parent(parent: Path) -> None:
    """Trust only root-owned protected ancestors.

    Root-owned sticky temporary ancestors are safe against nonroot removal of
    newly-created root-owned entries. A runner-writable non-sticky parent is not.
    Call this on the fully resolved output parent before root staging begins.
    """
    current = parent
    while True:
        info = current.lstat()
        if (not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or
                ((info.st_mode & 0o022) and not (info.st_mode & stat.S_ISVTX))):
            raise PackageError("PACKAGE_OUTPUT_PARENT_UNTRUSTED")
        if current == current.parent:
            break
        current = current.parent


def verify_probe_cgroup() -> None:
    """Require the pinned CI systemd sandbox, not an unbounded root subprocess.

    The enclosing service owns descendant pids and enforces memory/process limits,
    a read-only host filesystem, and quota-bounded /tmp and /dev/shm. This probe
    gate is required before any runtime import execution by the package CLI.
    """
    try:
        cgroup_lines = Path("/proc/self/cgroup").read_text(encoding="ascii").splitlines()
        groups = [row[3:] for row in cgroup_lines if row.startswith("0::")]
        if len(groups) != 1 or not re.fullmatch(
                r"/system\.slice/octoport-ci-package-[0-9]+-[0-9]+\.service", groups[0]):
            raise ValueError("not the dedicated hosted CI unit")
        path = Path("/sys/fs/cgroup") / groups[0].lstrip("/")
        memory = int((path / "memory.max").read_text(encoding="ascii").strip())
        processes = int((path / "pids.max").read_text(encoding="ascii").strip())
        if (memory < 1 or memory > MAX_PROBE_CGROUP_MEMORY_BYTES or
                processes < 1 or processes > MAX_PROBE_CGROUP_PIDS):
            raise ValueError("missing or oversized quotas")
        # A matching unit name and cgroup caps alone do not establish an
        # isolated scratch filesystem or a read-only host. Fail closed unless
        # systemd actually applied ProtectSystem=strict and 64MiB scratch mounts.
        mounts = {}
        for line in Path("/proc/self/mountinfo").read_text(encoding="utf8").splitlines():
            if " - " not in line:
                continue
            left, right = line.split(" - ", 1)
            parts = left.split()
            values = right.split()
            if len(parts) >= 6 and values and parts[4] in ("/", "/tmp", "/dev/shm"):
                mounts[parts[4]] = (set(parts[5].split(",")), values[0])
        root = mounts.get("/")
        if root is None or "ro" not in root[0]:
            raise ValueError("host filesystem is not read-only")
        for name in ("/tmp", "/dev/shm"):
            value = mounts.get(name)
            if value is None or value[1] != "tmpfs" or "rw" not in value[0]:
                raise ValueError("scratch filesystem is not isolated")
            volume = os.statvfs(name)
            total = volume.f_blocks * volume.f_frsize
            if total <= 0 or total > 64 * 1024**2:
                raise ValueError("scratch filesystem quota missing")
        # A private cgroup is not a network namespace. Imports require no
        # TCP/UDP access, including to disposable CI PostgreSQL or internet.
        local_net = os.stat("/proc/self/ns/net")
        init_net = os.stat("/proc/1/ns/net")
        if (local_net.st_dev, local_net.st_ino) == (init_net.st_dev, init_net.st_ino):
            raise ValueError("probe network namespace is not isolated")
    except (OSError, ValueError) as error:
        raise PackageError("PACKAGE_PROBE_SANDBOX_REQUIRED") from error


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
    limit = min(MAX_GIT_OUTPUT_BYTES, MAX_MANIFEST_BYTES) if args[0] == "cat-file" else MAX_GIT_OUTPUT_BYTES
    returncode, stdout, _ = bounded_child(
        ["/usr/bin/git", "-C", str(source), *args],
        timeout=30, max_output=limit,
        overflow_code="PACKAGE_GIT_OUTPUT_BUDGET_EXCEEDED",
        env=environment, **options,
    )
    if returncode:
        raise PackageError("PACKAGE_GIT_INPUT_INVALID_" + args[0].upper().replace("-", "_"))
    return stdout


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
        self.directories: set[str] = set()
        self.bytes = 0
        self.symlink_bytes = 0
        self.git_blobs: dict[str, tuple[str, str]] = {}  # (Git blob OID, Git tree mode)
        self.checked_packages: set[Path] = set()
        self.omitted_optional: list[str] = []

    def record_directories(self, name: str, *, include_self: bool = False) -> None:
        parts = PurePosixPath(safe_name(name)).parts
        if len(parts) > MAX_DEPTH:
            raise PackageError("PACKAGE_DIRECTORY_DEPTH_EXCEEDED")
        depth = len(parts) if include_self else len(parts) - 1
        for length in range(1, depth + 1):
            self.directories.add("/".join(parts[:length]))
            if len(self.directories) > MAX_DIRS:
                raise PackageError("PACKAGE_DIRECTORY_BUDGET_EXCEEDED")

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
        self.record_directories(name)
        self.files[name] = (path, info)

    def link(self, path: Path) -> None:
        name = safe_name(path.relative_to(self.source).as_posix())
        if name in self.links:
            return
        if name in self.files:
            raise PackageError("PACKAGE_INPUT_COLLISION")
        target = os.readlink(path)
        target_bytes = len(os.fsencode(target))
        if target_bytes > MAX_LINK_TARGET_BYTES:
            raise PackageError("PACKAGE_LINK_TARGET_TOO_LONG")
        if os.path.isabs(target) or any(ord(c) < 32 or ord(c) == 127 for c in target):
            raise PackageError("PACKAGE_EXTERNAL_LINK")
        try:
            resolved = path.resolve(strict=True)
            relative = resolved.relative_to(self.source).as_posix()
        except (OSError, RuntimeError, ValueError) as error:
            raise PackageError("PACKAGE_EXTERNAL_OR_BROKEN_LINK") from error
        if len(self.files) + len(self.links) >= MAX_FILES:
            raise PackageError("PACKAGE_INPUT_BUDGET_EXCEEDED")
        self.record_directories(name)
        self.links[name] = target
        self.symlink_bytes += target_bytes
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
        self.record_directories(name, include_self=True)
        self.visited.add(name)
        # Do not materialize a potentially enormous scandir listing before
        # checking resource limits; deterministic staging sorts bounded maps.
        with os.scandir(path) as entries:
            for entry in entries:
                if skip_cache and entry.name == "cache":
                    continue
                child = Path(entry.path)
                if entry.is_symlink():
                    self.link(child)
                elif entry.is_dir(follow_symlinks=False):
                    self.directory(child)
                else:
                    self.add_file(child.relative_to(self.source).as_posix(), child)

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
                # core.filemode=false can mask executable-bit drift from git status.
                # Treat the tracked Git tree mode as part of source identity.
                tracked = self.git_blobs.get(name)
                if tracked is not None:
                    expected_oid, expected_mode = tracked
                    if (expected_mode not in ("100644", "100755") or
                            bool(before.st_mode & 0o111) != (expected_mode == "100755") or
                            bool(opened.st_mode & 0o111) != (expected_mode == "100755")):
                        raise PackageError("PACKAGE_TRACKED_MODE_MISMATCH")
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
                if tracked is not None and blob.hexdigest() != expected_oid:
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
        try:
            returncode, stdout, stderr = bounded_child(
                args, timeout=20, max_output=MAX_PROBE_OUTPUT_BYTES,
                overflow_code="PACKAGE_RUNTIME_PROBE_OUTPUT_BUDGET_EXCEEDED",
                cwd=stage, env=environment, user=65534, group=65534, extra_groups=[],
            )
        except subprocess.TimeoutExpired as error:
            raise PackageError("PACKAGE_RUNTIME_PROBE_TIMEOUT") from error
        if service in ("api", "worker"):
            # loadConfig runs before database initialization. The exact
            # missing databaseUrl Zod error is expected, not success.
            if (returncode == 0 or b"ZodError" not in stderr or
                    re.search(rb'"path"\s*:\s*\[\s*"databaseUrl"\s*\]', stderr) is None or
                    b"ERR_MODULE_NOT_FOUND" in stderr or b"Cannot find module" in stderr):
                raise PackageError("PACKAGE_RUNTIME_IMPORT_GATE_FAILED_" + service.upper())
            result[service] = "IMPORT_GRAPH_LOADED_REQUIRED_CONFIG_REJECTED_NO_DB"
        else:
            if returncode != 0 or b"15.5.21" not in stdout:
                raise PackageError("PACKAGE_NEXT_CLI_GATE_FAILED_" + service.upper())
            result[service] = "PINNED_NEXT_CLI_LOADED_ONLY"
    return result


def package_release(source: Path, output: Path, node: Path, sha: str, tree: str,
                    *, max_bytes: int = MAX_BYTES, probe_runtime: bool = False) -> dict:
    if os.geteuid() != 0:
        raise PackageError("PACKAGE_ROOT_OWNERSHIP_REQUIRED")
    if max_bytes <= 0 or max_bytes > MAX_BYTES:
        raise PackageError("PACKAGE_BUDGET_INVALID")
    if probe_runtime:
        verify_probe_cgroup()
    source = source.resolve(strict=True)
    node = node.resolve(strict=True)
    if output.exists() or output.is_symlink():
        raise PackageError("PACKAGE_OUTPUT_ALREADY_EXISTS")
    parent = output.parent.resolve(strict=True)
    verify_output_parent(parent)
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
            inputs.git_blobs[name] = (oid, mode)
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
    required_free = (inputs.bytes * 2 + inputs.symlink_bytes * 2
                     + (len(inputs.files) + len(inputs.links)) * 2048
                     + len(inputs.directories) * 4096 + FLOOR_BYTES)
    if shutil.disk_usage(parent).free < required_free:
        raise PackageError("PACKAGE_OUTPUT_DISK_RESERVE")
    required_inodes = len(inputs.files) + len(inputs.links) + len(inputs.directories) + 64
    if os.statvfs(parent).f_favail < required_inodes + 200_000:
        raise PackageError("PACKAGE_OUTPUT_INODE_RESERVE")
    output_identity = None
    try:
        output.mkdir(mode=0o755)
        output_identity = output.lstat()
        stage = output / sha
        stage.mkdir(mode=0o755)
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
            "files": len(inputs.files), "symlinks": len(inputs.links),
            "symlinkTargetBytes": inputs.symlink_bytes, "inputBytes": inputs.bytes,
            "originRequirement": "Independently verify the exact CI/build source, workflow and artifact digest. This builder cannot authorize its own output.",
            "archiveContentVerified": True, "runtimeImportProbes": probes,
            "acceptance": "BUILT_PACKAGE_ONLY_NOT_INSTALLED_NOT_RECOVERY_NOT_PRODUCTION"}
        (output / "PACKAGE_RECEIPT.json").write_text(json.dumps(receipt, sort_keys=True, indent=2) + "\n")
        (output / "PACKAGE_RECEIPT.json").chmod(0o444)
        return receipt
    except BaseException:
        # A pre-existing output was rejected before mkdir. Remove only the
        # directory created by this invocation with the same captured inode.
        if output_identity is not None:
            try:
                now = output.lstat()
            except FileNotFoundError:
                pass
            else:
                if (not stat.S_ISLNK(now.st_mode) and
                        (now.st_dev, now.st_ino) == (output_identity.st_dev, output_identity.st_ino)):
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
        # Expose a stable error class/errno without leaking paths, environment,
        # checkout contents, tokens or captured runtime text into CI logs.
        if isinstance(error, PackageError):
            code = str(error)
        elif isinstance(error, OSError):
            code = "PACKAGE_OS_ERROR_" + str(error.errno if error.errno is not None else "UNKNOWN")
        elif isinstance(error, subprocess.SubprocessError):
            code = "PACKAGE_SUBPROCESS_ERROR"
        elif isinstance(error, ValueError):
            code = "PACKAGE_VALUE_ERROR"
        else:
            code = "PACKAGE_RUNTIME_ERROR"
        print(json.dumps({"status": "FAIL", "code": code}), file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
