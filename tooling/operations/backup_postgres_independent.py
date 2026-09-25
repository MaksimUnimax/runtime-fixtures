#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Mapping
from urllib.parse import parse_qs, unquote, urlparse


class BackupError(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class DatabaseConnection:
    host: str
    port: int
    database: str
    user: str
    password: str | None
    pg_environment: Mapping[str, str]


@dataclass(frozen=True)
class MountIdentity:
    target: Path
    source: str
    filesystem_type: str


@dataclass(frozen=True)
class BackupConfig:
    database_url: str
    destination: Path
    destination_mount: Path
    database_data_path: Path
    database_data_mount: Path
    min_free_bytes: int
    keep_successful: int = 7


ALLOWED_QUERY_ENV = {
    "sslmode": "PGSSLMODE",
    "sslrootcert": "PGSSLROOTCERT",
    "sslcert": "PGSSLCERT",
    "sslkey": "PGSSLKEY",
    "connect_timeout": "PGCONNECT_TIMEOUT",
    "application_name": "PGAPPNAME",
}


def require_environment(environment: Mapping[str, str]) -> BackupConfig:
    required = {
        "DATABASE_URL",
        "OCTOPORT_BACKUP_DESTINATION",
        "OCTOPORT_BACKUP_DESTINATION_MOUNT",
        "OCTOPORT_DB_DATA_PATH",
        "OCTOPORT_DB_DATA_MOUNT",
        "OCTOPORT_BACKUP_MIN_FREE_BYTES",
    }
    if any(not environment.get(key) for key in required):
        raise BackupError("BACKUP_CONFIGURATION_MISSING")
    try:
        min_free_bytes = int(environment["OCTOPORT_BACKUP_MIN_FREE_BYTES"])
    except ValueError as error:
        raise BackupError("BACKUP_MIN_FREE_BYTES_INVALID") from error
    if min_free_bytes <= 0:
        raise BackupError("BACKUP_MIN_FREE_BYTES_INVALID")
    return BackupConfig(
        database_url=environment["DATABASE_URL"],
        destination=Path(environment["OCTOPORT_BACKUP_DESTINATION"]),
        destination_mount=Path(environment["OCTOPORT_BACKUP_DESTINATION_MOUNT"]),
        database_data_path=Path(environment["OCTOPORT_DB_DATA_PATH"]),
        database_data_mount=Path(environment["OCTOPORT_DB_DATA_MOUNT"]),
        min_free_bytes=min_free_bytes,
    )


def parse_database_url(value: str) -> DatabaseConnection:
    parsed = urlparse(value)
    if parsed.scheme not in {"postgresql", "postgres"}:
        raise BackupError("DATABASE_URL_SCHEME_INVALID")
    if not parsed.hostname or parsed.username is None:
        raise BackupError("DATABASE_URL_AUTHORITY_INVALID")
    database = unquote(parsed.path.lstrip("/"))
    if not database:
        raise BackupError("DATABASE_URL_DATABASE_MISSING")
    try:
        port = parsed.port or 5432
    except ValueError as error:
        raise BackupError("DATABASE_URL_PORT_INVALID") from error

    query = parse_qs(parsed.query, keep_blank_values=True)
    unknown = sorted(set(query) - set(ALLOWED_QUERY_ENV))
    if unknown:
        raise BackupError("DATABASE_URL_QUERY_UNSUPPORTED")
    pg_environment: dict[str, str] = {}
    for key, values in query.items():
        if len(values) != 1:
            raise BackupError("DATABASE_URL_QUERY_INVALID")
        pg_environment[ALLOWED_QUERY_ENV[key]] = values[0]

    return DatabaseConnection(
        host=parsed.hostname,
        port=port,
        database=database,
        user=unquote(parsed.username),
        password=unquote(parsed.password) if parsed.password is not None else None,
        pg_environment=pg_environment,
    )


def _inside(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def lookup_mount(
    path: Path,
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> MountIdentity:
    completed = runner(
        [
            "findmnt",
            "--json",
            "--output",
            "TARGET,SOURCE,FSTYPE",
            "--target",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    try:
        payload = json.loads(completed.stdout)
        item = payload["filesystems"][0]
        return MountIdentity(
            target=Path(item["target"]).resolve(),
            source=str(item["source"]),
            filesystem_type=str(item["fstype"]),
        )
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as error:
        raise BackupError("BACKUP_MOUNT_LOOKUP_INVALID") from error


def verify_independent_mounts(
    config: BackupConfig,
    *,
    mount_lookup: Callable[[Path], MountIdentity] = lookup_mount,
    device_id: Callable[[Path], int] = lambda path: os.stat(path).st_dev,
    disk_free: Callable[[Path], int] = lambda path: shutil.disk_usage(path).free,
) -> tuple[MountIdentity, MountIdentity]:
    for path in (
        config.destination,
        config.destination_mount,
        config.database_data_path,
        config.database_data_mount,
    ):
        if not path.is_absolute():
            raise BackupError("BACKUP_PATH_NOT_ABSOLUTE")
        if not path.exists():
            raise BackupError("BACKUP_PATH_MISSING")

    if not config.destination.is_dir() or not config.destination_mount.is_dir():
        raise BackupError("BACKUP_DESTINATION_NOT_DIRECTORY")
    if not _inside(config.destination, config.destination_mount):
        raise BackupError("BACKUP_DESTINATION_OUTSIDE_MOUNT")
    if not _inside(config.database_data_path, config.database_data_mount):
        raise BackupError("DATABASE_DATA_OUTSIDE_MOUNT")

    destination_identity = mount_lookup(config.destination_mount)
    database_identity = mount_lookup(config.database_data_mount)
    if destination_identity.target != config.destination_mount.resolve():
        raise BackupError("BACKUP_DESTINATION_NOT_MOUNTPOINT")
    if database_identity.target != config.database_data_mount.resolve():
        raise BackupError("DATABASE_DATA_NOT_MOUNTPOINT")
    if destination_identity.source == database_identity.source:
        raise BackupError("BACKUP_DESTINATION_NOT_INDEPENDENT")
    if device_id(config.destination_mount) == device_id(config.database_data_mount):
        raise BackupError("BACKUP_DESTINATION_NOT_INDEPENDENT")
    if disk_free(config.destination) < config.min_free_bytes:
        raise BackupError("BACKUP_DESTINATION_SPACE_LOW")
    if not os.access(config.destination, os.W_OK | os.X_OK):
        raise BackupError("BACKUP_DESTINATION_NOT_WRITABLE")
    return destination_identity, database_identity


def _escape_pgpass(value: str) -> str:
    return value.replace("\\", "\\\\").replace(":", "\\:")


def _create_pgpass(connection: DatabaseConnection) -> Path | None:
    if connection.password is None:
        return None
    fd, name = tempfile.mkstemp(prefix="octoport-pgpass-")
    path = Path(name)
    try:
        os.fchmod(fd, 0o600)
        line = ":".join(
            _escape_pgpass(value)
            for value in (
                connection.host,
                str(connection.port),
                connection.database,
                connection.user,
                connection.password,
            )
        )
        os.write(fd, (line + "\n").encode())
    except BaseException:
        os.close(fd)
        path.unlink(missing_ok=True)
        raise
    else:
        os.close(fd)
    return path


def _command_environment(
    connection: DatabaseConnection, passfile: Path | None
) -> dict[str, str]:
    environment = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith("PG") and key != "DATABASE_URL"
    }
    environment.update(
        {
            "PGHOST": connection.host,
            "PGPORT": str(connection.port),
            "PGDATABASE": connection.database,
            "PGUSER": connection.user,
        }
    )
    environment.update(connection.pg_environment)
    if passfile is not None:
        environment["PGPASSFILE"] = str(passfile)
    return environment


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _fsync_file(path: Path) -> None:
    with path.open("rb") as stream:
        os.fsync(stream.fileno())


def _fsync_directory(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _archive_listing_is_valid(
    archive: Path,
    *,
    pg_restore: str,
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> bool:
    try:
        listing = runner(
            [pg_restore, "--list", str(archive)],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
    except (OSError, subprocess.CalledProcessError):
        return False
    return any(
        line.strip() and not line.lstrip().startswith(";")
        for line in listing.splitlines()
    )


def _verified_backup_directories(
    destination: Path,
    *,
    pg_restore: str,
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> list[tuple[str, Path]]:
    valid: list[tuple[str, Path]] = []
    for candidate in destination.glob("backup-*"):
        if not candidate.is_dir():
            continue
        manifest_path = candidate / "manifest.json"
        archive_path = candidate / "database.dump"
        try:
            manifest = json.loads(manifest_path.read_text())
            if manifest.get("format") != "octoport-postgres-backup-v1":
                continue
            if manifest.get("pgRestoreListVerified") is not True:
                continue
            expected_hash = manifest["sha256"]
            expected_bytes = int(manifest["bytes"])
            created_at = str(manifest["createdAt"])
            if archive_path.stat().st_size != expected_bytes:
                continue
            if _sha256(archive_path) != expected_hash:
                continue
            if not _archive_listing_is_valid(
                archive_path, pg_restore=pg_restore, runner=runner
            ):
                continue
        except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError):
            continue
        valid.append((created_at, candidate))
    return sorted(valid, key=lambda item: item[0], reverse=True)


def _apply_retention(
    destination: Path,
    keep_successful: int,
    *,
    pg_restore: str,
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> list[str]:
    valid = _verified_backup_directories(
        destination, pg_restore=pg_restore, runner=runner
    )
    removed: list[str] = []
    for _, candidate in valid[keep_successful:]:
        shutil.rmtree(candidate)
        removed.append(candidate.name)
    if removed:
        _fsync_directory(destination)
    return removed

def run_backup(
    config: BackupConfig,
    *,
    mount_lookup: Callable[[Path], MountIdentity] = lookup_mount,
    device_id: Callable[[Path], int] = lambda path: os.stat(path).st_dev,
    disk_free: Callable[[Path], int] = lambda path: shutil.disk_usage(path).free,
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
    which: Callable[[str], str | None] = shutil.which,
    now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
) -> dict[str, object]:
    verify_independent_mounts(
        config,
        mount_lookup=mount_lookup,
        device_id=device_id,
        disk_free=disk_free,
    )
    connection = parse_database_url(config.database_url)
    pg_dump = which("pg_dump")
    pg_restore = which("pg_restore")
    if not pg_dump or not pg_restore:
        raise BackupError("POSTGRES_BACKUP_TOOLS_MISSING")

    temporary = config.destination / f".incomplete-{uuid.uuid4().hex}"
    temporary.mkdir(mode=0o700)
    archive = temporary / "database.dump"
    manifest_path = temporary / "manifest.json"
    passfile: Path | None = None
    try:
        passfile = _create_pgpass(connection)
        environment = _command_environment(connection, passfile)
        runner(
            [pg_dump, "--format=custom", "--file", str(archive)],
            check=True,
            env=environment,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
        )
        os.chmod(archive, 0o600)
        size = archive.stat().st_size
        if size <= 0:
            raise BackupError("POSTGRES_BACKUP_ARCHIVE_EMPTY")

        listing = runner(
            [pg_restore, "--list", str(archive)],
            check=True,
            env=environment,
            capture_output=True,
            text=True,
        ).stdout
        if not any(
            line.strip() and not line.lstrip().startswith(";")
            for line in listing.splitlines()
        ):
            raise BackupError("POSTGRES_BACKUP_ARCHIVE_LIST_EMPTY")

        digest = _sha256(archive)
        created_at = now().astimezone(timezone.utc).replace(microsecond=0)
        manifest = {
            "format": "octoport-postgres-backup-v1",
            "createdAt": created_at.isoformat().replace("+00:00", "Z"),
            "archive": "database.dump",
            "sha256": digest,
            "bytes": size,
            "pgDumpFormat": "custom",
            "pgRestoreListVerified": True,
        }
        manifest_path.write_text(json.dumps(manifest, sort_keys=True) + "\n")
        os.chmod(manifest_path, 0o600)
        _fsync_file(archive)
        _fsync_file(manifest_path)
        _fsync_directory(temporary)

        stamp = created_at.strftime("%Y%m%dT%H%M%SZ")
        final = config.destination / f"backup-{stamp}-{digest[:12]}"
        if final.exists():
            raise BackupError("BACKUP_DESTINATION_COLLISION")
        temporary.rename(final)
        _fsync_directory(config.destination)
        removed = _apply_retention(
            config.destination,
            config.keep_successful,
            pg_restore=pg_restore,
            runner=runner,
        )
        retained = _verified_backup_directories(
            config.destination, pg_restore=pg_restore, runner=runner
        )
        return {
            "status": "PASS",
            "backup": final.name,
            "sha256": digest,
            "bytes": size,
            "retainedSuccessful": len(retained),
            "removedSuccessful": removed,
        }
    except subprocess.CalledProcessError as error:
        raise BackupError("POSTGRES_BACKUP_COMMAND_FAILED") from error
    finally:
        if passfile is not None:
            passfile.unlink(missing_ok=True)
        if temporary.exists():
            shutil.rmtree(temporary)


def main() -> int:
    try:
        result = run_backup(require_environment(os.environ))
    except BackupError as error:
        print(
            json.dumps({"status": "FAIL", "code": error.code}, sort_keys=True),
            file=sys.stderr,
        )
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
