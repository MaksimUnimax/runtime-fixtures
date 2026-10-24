#!/usr/bin/env python3
"""Provision the API-only owner-test monitor EnvironmentFile safely.

This helper has no implicit deployment authority. Production CLI mutations are
fixed to /etc/seller-agents-owner-test and require the same exact source-bound
B05 current-deploy authority used by deploy_owner_test.py. Secret input is read
from stdin only; output contains structural metadata, never values.
"""
from __future__ import annotations

import argparse
import base64
import fcntl
import hashlib
import json
import os
import re
import stat
import sys
import tempfile
from pathlib import Path
from urllib.parse import unquote, urlsplit

MONITOR_KEYS = (
    "MONITOR_HEALTH_READ_DATABASE_URL",
    "MONITOR_HEALTH_READ_EXPECTED_ROLE",
)
MONITOR_DATABASE = "octoport_monitor_pilot"
DEFAULT_ROOT = Path("/etc/seller-agents-owner-test")
CURRENT_AUTHORITY_FILE = Path(
    "/root/octoport-control/authorizations/B05-current-four-service-deploy.json"
)
MAX_INPUT_BYTES = 65536
MAX_STATE_BYTES = 131072
ROLE = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,62}\Z")
HEX40 = re.compile(r"[0-9a-f]{40}\Z")
HEX64 = re.compile(r"[0-9a-f]{64}\Z")


class MonitorEnvError(RuntimeError):
    pass


class ProvisionPaths:
    def __init__(self, root: Path):
        self.root = root.absolute()
        self.target = self.root / "api-monitor.env"
        self.shared = self.root / "api.env"
        self.state = self.root / ".api-monitor.env.rollback-state.json"
        self.lock = self.root / ".api-monitor.env.lock"


def _assert_no_symlink_ancestors(path: Path) -> None:
    absolute = path.absolute()
    current = Path(absolute.anchor or "/")
    for part in absolute.parts[1:]:
        current = current / part
        try:
            info = os.lstat(current)
        except FileNotFoundError:
            raise MonitorEnvError("MONITOR_ENV_PARENT_INVALID") from None
        if stat.S_ISLNK(info.st_mode):
            raise MonitorEnvError("MONITOR_ENV_PATH_SYMLINK_FORBIDDEN")
        if current != absolute and not stat.S_ISDIR(info.st_mode):
            raise MonitorEnvError("MONITOR_ENV_PARENT_INVALID")


def _validate_parent(root: Path, owner_uid: int, owner_gid: int) -> None:
    _assert_no_symlink_ancestors(root)
    try:
        info = os.lstat(root)
    except FileNotFoundError:
        raise MonitorEnvError("MONITOR_ENV_PARENT_INVALID") from None
    if (
        not stat.S_ISDIR(info.st_mode)
        or info.st_uid != owner_uid
        or info.st_gid != owner_gid
    ):
        raise MonitorEnvError("MONITOR_ENV_PARENT_INVALID")
    if stat.S_IMODE(info.st_mode) & 0o022:
        raise MonitorEnvError("MONITOR_ENV_PARENT_NOT_PRIVATE")


def _read_bounded_private(
    path: Path,
    owner_uid: int,
    owner_gid: int,
    *,
    required: bool,
    maximum: int,
) -> bytes | None:
    try:
        fd = os.open(
            path,
            os.O_RDONLY | os.O_CLOEXEC | getattr(os, "O_NOFOLLOW", 0),
        )
    except FileNotFoundError:
        if required:
            raise MonitorEnvError("MONITOR_ENV_REQUIRED_FILE_MISSING") from None
        return None
    except OSError:
        raise MonitorEnvError("MONITOR_ENV_FILE_INVALID") from None
    try:
        info = os.fstat(fd)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != owner_uid
            or info.st_gid != owner_gid
            or stat.S_IMODE(info.st_mode) != 0o600
        ):
            raise MonitorEnvError("MONITOR_ENV_FILE_INVALID")
        data = b""
        while len(data) <= maximum:
            chunk = os.read(fd, min(16384, maximum + 1 - len(data)))
            if not chunk:
                break
            data += chunk
        if len(data) > maximum:
            raise MonitorEnvError("MONITOR_ENV_FILE_TOO_LARGE")
        return data
    finally:
        os.close(fd)


def _read_private(
    path: Path, owner_uid: int, owner_gid: int, *, required: bool
) -> bytes | None:
    return _read_bounded_private(
        path,
        owner_uid,
        owner_gid,
        required=required,
        maximum=MAX_INPUT_BYTES,
    )


def _env_key_names(data: bytes) -> list[str]:
    try:
        text = data.decode("utf-8")
    except UnicodeError:
        raise MonitorEnvError("MONITOR_ENV_FORMAT_INVALID") from None
    names: list[str] = []
    seen: set[str] = set()
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise MonitorEnvError("MONITOR_ENV_FORMAT_INVALID")
        name = line.split("=", 1)[0].strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name) or name in seen:
            raise MonitorEnvError("MONITOR_ENV_FORMAT_INVALID")
        seen.add(name)
        names.append(name)
    return names


def _validate_payload(value: object) -> dict[str, str]:
    if not isinstance(value, dict) or set(value) != set(MONITOR_KEYS):
        raise MonitorEnvError("MONITOR_ENV_INPUT_INVALID")
    result: dict[str, str] = {}
    for key in MONITOR_KEYS:
        item = value.get(key)
        if (
            not isinstance(item, str)
            or not item
            or len(item.encode("utf-8")) > 16384
            or any(ord(char) < 0x20 or ord(char) == 0x7F for char in item)
        ):
            raise MonitorEnvError("MONITOR_ENV_INPUT_INVALID")
        result[key] = item
    role = result["MONITOR_HEALTH_READ_EXPECTED_ROLE"]
    if not ROLE.fullmatch(role):
        raise MonitorEnvError("MONITOR_ENV_INPUT_INVALID")
    try:
        parsed = urlsplit(result["MONITOR_HEALTH_READ_DATABASE_URL"])
        username = unquote(parsed.username or "")
        database = unquote(parsed.path[1:]) if parsed.path.startswith("/") else ""
    except (TypeError, ValueError, UnicodeError):
        raise MonitorEnvError("MONITOR_ENV_INPUT_INVALID") from None
    if (
        parsed.scheme not in ("postgres", "postgresql")
        or not parsed.hostname
        or parsed.fragment
        or username != role
        or database != MONITOR_DATABASE
    ):
        raise MonitorEnvError("MONITOR_ENV_INPUT_INVALID")
    return result


def _quote_env(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def render_monitor_env(value: object) -> bytes:
    payload = _validate_payload(value)
    return "".join(
        f"{key}={_quote_env(payload[key])}\n" for key in MONITOR_KEYS
    ).encode("utf-8")


def _atomic_private_write(
    path: Path, data: bytes, owner_uid: int, owner_gid: int
) -> None:
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    tmp = Path(temporary)
    try:
        os.fchmod(fd, 0o600)
        info = os.fstat(fd)
        if info.st_uid != owner_uid or info.st_gid != owner_gid:
            raise MonitorEnvError("MONITOR_ENV_TEMP_OWNER_INVALID")
        with os.fdopen(fd, "wb") as stream:
            fd = -1
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, path)
        directory = os.open(
            path.parent,
            os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0),
        )
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if fd >= 0:
            os.close(fd)
        try:
            tmp.unlink()
        except FileNotFoundError:
            pass


def _unlink_durable(path: Path) -> None:
    path.unlink(missing_ok=True)
    directory = os.open(
        path.parent,
        os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0),
    )
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def _authority_binding(value: dict) -> dict[str, str]:
    return {
        "authorizationId": value["authorizationId"],
        "sourceSha": value["sourceSha"],
        "sourceTree": value["sourceTree"],
        "trustedInventorySha256": value["trustedInventorySha256"],
    }


def require_apply_authority(
    *,
    expected_source_sha: str,
    expected_source_tree: str,
    expected_inventory_sha256: str,
    path: Path = CURRENT_AUTHORITY_FILE,
    owner_uid: int = 0,
) -> dict[str, str]:
    if (
        not HEX40.fullmatch(expected_source_sha)
        or not HEX40.fullmatch(expected_source_tree)
        or not HEX64.fullmatch(expected_inventory_sha256)
    ):
        raise MonitorEnvError("MONITOR_ENV_AUTHORIZATION_INVALID")
    _assert_no_symlink_ancestors(path)
    try:
        fd = os.open(
            path,
            os.O_RDONLY | os.O_CLOEXEC | getattr(os, "O_NOFOLLOW", 0),
        )
    except FileNotFoundError:
        raise MonitorEnvError("MONITOR_ENV_AUTHORIZATION_REQUIRED") from None
    except OSError:
        raise MonitorEnvError("MONITOR_ENV_AUTHORIZATION_INVALID") from None
    try:
        info = os.fstat(fd)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != owner_uid
            or stat.S_IMODE(info.st_mode) != 0o600
            or info.st_size > MAX_INPUT_BYTES
        ):
            raise MonitorEnvError("MONITOR_ENV_AUTHORIZATION_INVALID")
        raw = os.read(fd, MAX_INPUT_BYTES + 1)
        if len(raw) > MAX_INPUT_BYTES:
            raise MonitorEnvError("MONITOR_ENV_AUTHORIZATION_INVALID")
    finally:
        os.close(fd)
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeError, ValueError):
        raise MonitorEnvError("MONITOR_ENV_AUTHORIZATION_INVALID") from None
    required = {
        "status",
        "scope",
        "authorizationId",
        "allowedModes",
        "sourceSha",
        "sourceTree",
        "trustedInventorySha256",
    }
    if (
        not isinstance(value, dict)
        or set(value) != required
        or value.get("status") != "AUTHORIZED"
        or value.get("scope") != "B05_CURRENT_FOUR_SERVICE_DEPLOY"
        or not isinstance(value.get("authorizationId"), str)
        or not value["authorizationId"].strip()
        or not isinstance(value.get("allowedModes"), list)
        or set(value["allowedModes"]) - {"apply", "recover"}
        or "apply" not in value["allowedModes"]
        or value.get("sourceSha") != expected_source_sha
        or value.get("sourceTree") != expected_source_tree
        or value.get("trustedInventorySha256") != expected_inventory_sha256
    ):
        raise MonitorEnvError("MONITOR_ENV_AUTHORIZATION_INVALID")
    return _authority_binding(value)


def _validate_binding(binding: object) -> dict[str, str]:
    keys = {
        "authorizationId",
        "sourceSha",
        "sourceTree",
        "trustedInventorySha256",
    }
    if not isinstance(binding, dict) or set(binding) != keys:
        raise MonitorEnvError("MONITOR_ENV_TRANSACTION_IDENTITY_INVALID")
    if (
        not isinstance(binding["authorizationId"], str)
        or not binding["authorizationId"].strip()
        or not HEX40.fullmatch(binding["sourceSha"])
        or not HEX40.fullmatch(binding["sourceTree"])
        or not HEX64.fullmatch(binding["trustedInventorySha256"])
    ):
        raise MonitorEnvError("MONITOR_ENV_TRANSACTION_IDENTITY_INVALID")
    return dict(binding)


def _state_payload(
    binding: dict[str, str], previous: bytes | None, installed: bytes
) -> bytes:
    state: dict[str, object] = {
        "schema": "octoport-monitor-env-rollback-v1",
        **binding,
        "previous": {"kind": "ABSENT"},
        "installedSha256": hashlib.sha256(installed).hexdigest(),
    }
    if previous is not None:
        state["previous"] = {
            "kind": "PRESENT",
            "bytesBase64": base64.b64encode(previous).decode("ascii"),
            "sha256": hashlib.sha256(previous).hexdigest(),
        }
    return (json.dumps(state, sort_keys=True, separators=(",", ":")) + "\n").encode()


def _read_state(
    paths: ProvisionPaths,
    owner_uid: int,
    owner_gid: int,
    binding: dict[str, str],
) -> dict:
    raw = _read_bounded_private(
        paths.state,
        owner_uid,
        owner_gid,
        required=True,
        maximum=MAX_STATE_BYTES,
    )
    assert raw is not None
    try:
        state = json.loads(raw.decode("utf-8"))
    except (UnicodeError, ValueError):
        raise MonitorEnvError("MONITOR_ENV_ROLLBACK_STATE_INVALID") from None
    expected = {
        "schema",
        "authorizationId",
        "sourceSha",
        "sourceTree",
        "trustedInventorySha256",
        "previous",
        "installedSha256",
    }
    if (
        not isinstance(state, dict)
        or set(state) != expected
        or state.get("schema") != "octoport-monitor-env-rollback-v1"
        or any(state.get(key) != value for key, value in binding.items())
        or not isinstance(state.get("previous"), dict)
        or not isinstance(state.get("installedSha256"), str)
        or not HEX64.fullmatch(state["installedSha256"])
    ):
        raise MonitorEnvError("MONITOR_ENV_ROLLBACK_STATE_INVALID")
    previous = state["previous"]
    if previous == {"kind": "ABSENT"}:
        return state
    if set(previous) != {"kind", "bytesBase64", "sha256"} or previous.get("kind") != "PRESENT":
        raise MonitorEnvError("MONITOR_ENV_ROLLBACK_STATE_INVALID")
    try:
        data = base64.b64decode(previous["bytesBase64"], validate=True)
    except (TypeError, ValueError):
        raise MonitorEnvError("MONITOR_ENV_ROLLBACK_STATE_INVALID") from None
    if len(data) > MAX_INPUT_BYTES or hashlib.sha256(data).hexdigest() != previous["sha256"]:
        raise MonitorEnvError("MONITOR_ENV_ROLLBACK_STATE_INVALID")
    state["previousBytes"] = data
    return state


def _verify_target(
    paths: ProvisionPaths, expected: bytes, owner_uid: int, owner_gid: int
) -> None:
    observed = _read_private(paths.target, owner_uid, owner_gid, required=True)
    if observed != expected or _env_key_names(observed) != list(MONITOR_KEYS):
        raise MonitorEnvError("MONITOR_ENV_READBACK_INVALID")


def _shared_env_has_monitor_keys(
    paths: ProvisionPaths, owner_uid: int, owner_gid: int
) -> bool:
    shared = _read_private(paths.shared, owner_uid, owner_gid, required=True)
    assert shared is not None
    return any(key in MONITOR_KEYS for key in _env_key_names(shared))


class MonitorEnvProvisioner:
    def __init__(
        self,
        binding: dict[str, str],
        root: Path = DEFAULT_ROOT,
        *,
        owner_uid: int = 0,
        owner_gid: int = 0,
    ):
        self.binding = _validate_binding(binding)
        self.paths = ProvisionPaths(root)
        self.owner_uid = owner_uid
        self.owner_gid = owner_gid

    def _guard(self) -> int:
        _validate_parent(self.paths.root, self.owner_uid, self.owner_gid)
        try:
            fd = os.open(
                self.paths.lock,
                os.O_RDWR
                | os.O_CREAT
                | os.O_CLOEXEC
                | getattr(os, "O_NOFOLLOW", 0),
                0o600,
            )
        except OSError:
            raise MonitorEnvError("MONITOR_ENV_LOCK_INVALID") from None
        info = os.fstat(fd)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != self.owner_uid
            or info.st_gid != self.owner_gid
            or stat.S_IMODE(info.st_mode) != 0o600
        ):
            os.close(fd)
            raise MonitorEnvError("MONITOR_ENV_LOCK_INVALID")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            os.close(fd)
            raise MonitorEnvError("MONITOR_ENV_BUSY") from None
        return fd

    def _rollback_locked(self) -> dict[str, object]:
        state = _read_state(
            self.paths,
            self.owner_uid,
            self.owner_gid,
            self.binding,
        )
        current = _read_private(
            self.paths.target,
            self.owner_uid,
            self.owner_gid,
            required=True,
        )
        assert current is not None
        if hashlib.sha256(current).hexdigest() != state["installedSha256"]:
            raise MonitorEnvError("MONITOR_ENV_ROLLBACK_TARGET_MISMATCH")
        previous = state["previous"]
        if previous["kind"] == "PRESENT":
            restored = state["previousBytes"]
            _atomic_private_write(
                self.paths.target, restored, self.owner_uid, self.owner_gid
            )
            if (
                _read_private(
                    self.paths.target,
                    self.owner_uid,
                    self.owner_gid,
                    required=True,
                )
                != restored
            ):
                raise MonitorEnvError("MONITOR_ENV_ROLLBACK_READBACK_INVALID")
            restored_kind = "PRESENT"
        else:
            if os.path.lexists(self.paths.target):
                _read_private(
                    self.paths.target,
                    self.owner_uid,
                    self.owner_gid,
                    required=True,
                )
                _unlink_durable(self.paths.target)
            if os.path.lexists(self.paths.target):
                raise MonitorEnvError("MONITOR_ENV_ROLLBACK_READBACK_INVALID")
            restored_kind = "ABSENT"
        _unlink_durable(self.paths.state)
        return {
            "status": "MONITOR_ENV_ROLLBACK_PASS",
            "restored": restored_kind,
            "sourceSha": self.binding["sourceSha"],
        }

    def install(self, value: object) -> dict[str, object]:
        expected = render_monitor_env(value)
        lock = self._guard()
        try:
            if _shared_env_has_monitor_keys(
                self.paths, self.owner_uid, self.owner_gid
            ):
                raise MonitorEnvError("MONITOR_ENV_KEY_LEAK_IN_SHARED_API_ENV")
            if os.path.lexists(self.paths.state):
                raise MonitorEnvError("MONITOR_ENV_TRANSACTION_PENDING")
            previous = _read_private(
                self.paths.target,
                self.owner_uid,
                self.owner_gid,
                required=False,
            )
            _atomic_private_write(
                self.paths.state,
                _state_payload(self.binding, previous, expected),
                self.owner_uid,
                self.owner_gid,
            )
            try:
                _atomic_private_write(
                    self.paths.target, expected, self.owner_uid, self.owner_gid
                )
                _verify_target(
                    self.paths, expected, self.owner_uid, self.owner_gid
                )
            except Exception:
                try:
                    self._rollback_locked()
                except Exception:
                    raise MonitorEnvError("MONITOR_ENV_ROLLBACK_REQUIRED") from None
                raise
            return {
                "status": "MONITOR_ENV_INSTALL_PASS",
                "destination": str(self.paths.target),
                "keys": list(MONITOR_KEYS),
                "previous": "ABSENT" if previous is None else "PRESENT",
                "sourceSha": self.binding["sourceSha"],
            }
        finally:
            os.close(lock)

    def rollback(self) -> dict[str, object]:
        lock = self._guard()
        try:
            return self._rollback_locked()
        finally:
            os.close(lock)

    def commit(self) -> dict[str, object]:
        lock = self._guard()
        try:
            if _shared_env_has_monitor_keys(
                self.paths, self.owner_uid, self.owner_gid
            ):
                raise MonitorEnvError("MONITOR_ENV_KEY_LEAK_IN_SHARED_API_ENV")
            current = _read_private(
                self.paths.target,
                self.owner_uid,
                self.owner_gid,
                required=True,
            )
            assert current is not None
            if _env_key_names(current) != list(MONITOR_KEYS):
                raise MonitorEnvError("MONITOR_ENV_READBACK_INVALID")
            state = _read_state(
                self.paths,
                self.owner_uid,
                self.owner_gid,
                self.binding,
            )
            if hashlib.sha256(current).hexdigest() != state["installedSha256"]:
                raise MonitorEnvError("MONITOR_ENV_READBACK_INVALID")
            _unlink_durable(self.paths.state)
            return {
                "status": "MONITOR_ENV_COMMIT_PASS",
                "destination": str(self.paths.target),
                "keys": list(MONITOR_KEYS),
                "sourceSha": self.binding["sourceSha"],
            }
        finally:
            os.close(lock)


def _read_stdin_json() -> object:
    raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    if len(raw) > MAX_INPUT_BYTES:
        raise MonitorEnvError("MONITOR_ENV_INPUT_INVALID")
    try:
        return json.loads(raw)
    except (UnicodeError, ValueError):
        raise MonitorEnvError("MONITOR_ENV_INPUT_INVALID") from None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("install", "rollback", "commit"))
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--source-tree", required=True)
    parser.add_argument("--inventory-sha256", required=True)
    args = parser.parse_args(argv)
    try:
        if os.geteuid() != 0:
            raise MonitorEnvError("MONITOR_ENV_ROOT_REQUIRED")
        binding = require_apply_authority(
            expected_source_sha=args.source_sha,
            expected_source_tree=args.source_tree,
            expected_inventory_sha256=args.inventory_sha256,
        )
        provisioner = MonitorEnvProvisioner(binding)
        if args.mode == "install":
            result = provisioner.install(_read_stdin_json())
        elif args.mode == "rollback":
            result = provisioner.rollback()
        else:
            result = provisioner.commit()
        print(json.dumps(result, sort_keys=True))
        return 0
    except MonitorEnvError as error:
        print(
            json.dumps({"status": "FAILED", "error": str(error)}, sort_keys=True),
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
