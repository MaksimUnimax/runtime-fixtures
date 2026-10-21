from __future__ import annotations

import errno
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from dataclasses import replace
from unittest.mock import patch
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import backup_postgres_independent as backup_module
from backup_postgres_independent import (
    BackupConfig,
    BackupError,
    MountIdentity,
    parse_database_url,
    run_backup,
    verify_independent_mounts,
    _verified_backup_directories,
    _apply_retention,
)


class BackupPostgresIndependentTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.dest_mount = root / "dest-mount"
        self.dest = self.dest_mount / "octoport"
        self.db_mount = root / "db-mount"
        self.db_data = self.db_mount / "postgres"
        self.dest.mkdir(parents=True)
        self.db_data.mkdir(parents=True)
        self.config = BackupConfig(
            database_url="postgresql://fixture:fixture_pw@127.0.0.1:5432/octoport",
            destination=self.dest,
            destination_mount=self.dest_mount,
            database_data_path=self.db_data,
            database_data_mount=self.db_mount,
            min_free_bytes=1,
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def mount_lookup(self, path: Path) -> MountIdentity:
        if path.resolve() == self.dest_mount.resolve():
            return MountIdentity(path.resolve(), "/dev/dest", "ext4")
        if path.resolve() == self.db_mount.resolve():
            return MountIdentity(path.resolve(), "/dev/db", "ext4")
        raise AssertionError(path)

    def device_id(self, path: Path) -> int:
        return 2 if path.resolve() == self.dest_mount.resolve() else 1

    def test_database_url_parsing_is_bounded(self) -> None:
        parsed = parse_database_url(self.config.database_url)
        self.assertEqual(parsed.host, "127.0.0.1")
        self.assertEqual(parsed.port, 5432)
        self.assertEqual(parsed.database, "octoport")
        self.assertEqual(parsed.user, "fixture")
        with self.assertRaisesRegex(
            BackupError, "DATABASE_URL_QUERY_UNSUPPORTED"
        ):
            parse_database_url(
                self.config.database_url + "?options=unsupported"
            )

    def test_malformed_bracketed_ipv6_authority_is_normalized(self) -> None:
        # urllib.parse raises ValueError before the backup CLI can report
        # a bounded BackupError for a malformed URL authority.
        for scheme in ("postgresql", "postgres"):
            with self.subTest(scheme=scheme):
                with self.assertRaisesRegex(
                    BackupError, "DATABASE_URL_AUTHORITY_INVALID"
                ):
                    parse_database_url(
                        f"{scheme}://fixture:synthetic@[::1/synthetic"
                    )

    def test_valid_bracketed_ipv6_authority_remains_supported(self) -> None:
        parsed = parse_database_url(
            "postgresql://fixture:synthetic@[::1]:5433/synthetic"
        )
        self.assertEqual(parsed.host, "::1")
        self.assertEqual(parsed.port, 5433)
        self.assertEqual(parsed.database, "synthetic")

    def test_explicit_zero_port_is_rejected_instead_of_defaulted(self) -> None:
        # A configured port zero must not silently redirect pg_dump to 5432.
        for scheme in ("postgresql", "postgres"):
            with self.subTest(scheme=scheme):
                with self.assertRaisesRegex(BackupError, "DATABASE_URL_PORT_INVALID"):
                    parse_database_url(
                        f"{scheme}://fixture:fixture_pw@127.0.0.1:0/octoport"
                    )

    def test_absent_and_valid_explicit_ports_keep_existing_meanings(self) -> None:
        implicit = "postgresql://fixture:fixture_pw@127.0.0.1/octoport"
        explicit = "postgresql://fixture:fixture_pw@127.0.0.1:5433/octoport"
        self.assertEqual(parse_database_url(implicit).port, 5432)
        self.assertEqual(parse_database_url(explicit).port, 5433)

    def test_database_url_rejects_unsafe_multiline_and_nul_fields(self) -> None:
        # A .pgpass entry is line-oriented; percent-encoded line terminators
        # must not create a second authentication record.
        invalid = {
            "password_lf": "postgresql://fixture:pw%0Arogue@localhost/db",
            "password_cr": "postgresql://fixture:pw%0Drogue@localhost/db",
            "password_nul": "postgresql://fixture:pw%00rogue@localhost/db",
            "user_lf": "postgresql://fixture%0Arogue:pw@localhost/db",
            "db_lf": "postgresql://fixture:pw@localhost/db%0Arogue",
            "query_lf": "postgresql://fixture:pw@localhost/db?sslmode=require%0Arogue",
            "raw_password_lf": "postgresql://fixture:pw\nrogue@localhost/db",
            "raw_query_cr": "postgresql://fixture:pw@localhost/db?sslmode=require\rrogue",
        }
        for label, url in invalid.items():
            with self.subTest(label=label):
                with self.assertRaisesRegex(
                    BackupError, "DATABASE_URL_CONTROL_CHARACTER"
                ):
                    parse_database_url(url)

    def test_database_url_preserves_safe_pgpass_escapes(self) -> None:
        parsed = parse_database_url(
            "postgresql://fixture:pw%3Awith%5Cslash@localhost/db?sslmode=require"
        )
        self.assertEqual(parsed.password, "pw:with\\slash")
        self.assertEqual(
            backup_module._escape_pgpass(parsed.password), r"pw\:with\\slash"
        )
        self.assertEqual(parsed.pg_environment["PGSSLMODE"], "require")

    def test_findmnt_nonzero_exit_is_bounded(self) -> None:
        def failing_findmnt(argv, **kwargs):
            raise subprocess.CalledProcessError(
                32, argv, stderr="synthetic findmnt mount lookup failure"
            )

        with self.assertRaisesRegex(
            BackupError, "BACKUP_MOUNT_LOOKUP_INVALID"
        ):
            backup_module.lookup_mount(
                self.dest_mount, runner=failing_findmnt
            )

    def test_findmnt_executable_missing_is_bounded(self) -> None:
        def missing_findmnt(argv, **kwargs):
            raise FileNotFoundError("synthetic findmnt missing")

        with self.assertRaisesRegex(
            BackupError, "BACKUP_MOUNT_LOOKUP_INVALID"
        ):
            backup_module.lookup_mount(
                self.dest_mount, runner=missing_findmnt
            )

    def test_findmnt_successful_response_keeps_mount_identity(self) -> None:
        def successful_findmnt(argv, **kwargs):
            return subprocess.CompletedProcess(
                argv,
                0,
                json.dumps(
                    {
                        "filesystems": [
                            {
                                "target": str(self.dest_mount),
                                "source": "/dev/fixture-independent-disk",
                                "fstype": "ext4",
                            }
                        ]
                    }
                ),
                "",
            )

        result = backup_module.lookup_mount(
            self.dest_mount, runner=successful_findmnt
        )
        self.assertEqual(result.target, self.dest_mount.resolve())
        self.assertEqual(result.source, "/dev/fixture-independent-disk")
        self.assertEqual(result.filesystem_type, "ext4")

    def test_pgdata_regular_file_is_not_a_valid_data_directory(self) -> None:
        self.db_data.rmdir()
        self.db_data.write_bytes(b"not-a-PostgreSQL-data-directory")
        with self.assertRaisesRegex(
            BackupError, "DATABASE_DATA_NOT_DIRECTORY"
        ):
            verify_independent_mounts(
                self.config,
                mount_lookup=self.mount_lookup,
                device_id=self.device_id,
                disk_free=lambda _path: 1024,
            )

    def test_pgdata_mount_regular_file_is_not_a_valid_mount_root(self) -> None:
        # Keep the actual PGDATA path a valid directory to isolate the
        # second condition: the configured mount root must be a directory.
        invalid_mount = self.db_mount.parent / "pgdata-mount-file"
        invalid_mount.write_bytes(b"not-a-mounted-PostgreSQL-data-directory")
        self.assertTrue(self.db_data.is_dir())
        self.assertFalse(invalid_mount.is_dir())
        config = replace(self.config, database_data_mount=invalid_mount)
        with self.assertRaisesRegex(
            BackupError, "DATABASE_DATA_NOT_DIRECTORY"
        ):
            verify_independent_mounts(
                config,
                mount_lookup=self.mount_lookup,
                device_id=self.device_id,
                disk_free=lambda _path: 1024,
            )

    def test_independent_mount_guard_rejects_same_storage(self) -> None:
        with self.assertRaisesRegex(
            BackupError, "BACKUP_DESTINATION_NOT_INDEPENDENT"
        ):
            verify_independent_mounts(
                self.config,
                mount_lookup=lambda path: MountIdentity(
                    path.resolve(), "/dev/same", "ext4"
                ),
                device_id=lambda _path: 1,
                disk_free=lambda _path: 1024,
            )

    def _existing_backup(
        self,
        index: int,
        created_at: str,
        body: bytes,
        *,
        restore_verified: bool = True,
    ) -> Path:
        digest = hashlib.sha256(body).hexdigest()
        path = self.dest / f"backup-existing-{index:02d}"
        path.mkdir()
        archive = path / "database.dump"
        archive.write_bytes(body)
        manifest = {
            "format": "octoport-postgres-backup-v1",
            "createdAt": created_at,
            "archive": "database.dump",
            "sha256": digest,
            "bytes": len(body),
            "pgDumpFormat": "custom",
            "pgRestoreListVerified": restore_verified,
        }
        (path / "manifest.json").write_text(
            json.dumps(manifest, sort_keys=True) + "\n"
        )
        return path

    def test_success_is_atomic_and_retains_seven(self) -> None:
        existing = [
            self._existing_backup(
                index,
                f"2026-09-{index + 10:02d}T00:00:00Z",
                f"existing-{index}".encode(),
            )
            for index in range(7)
        ]
        calls: list[tuple[list[str], dict[str, str]]] = []

        def runner(argv, **kwargs):
            args = [str(value) for value in argv]
            environment = dict(kwargs.get("env") or {})
            calls.append((args, environment))
            if args[0] == "/fixture/pg_dump":
                Path(args[args.index("--file") + 1]).write_bytes(
                    b"fixture-custom-backup"
                )
                return subprocess.CompletedProcess(args, 0, "", "")
            if args[0] == "/fixture/pg_restore":
                return subprocess.CompletedProcess(
                    args,
                    0,
                    "; archive\n1; 0 0 TABLE public users fixture\n",
                    "",
                )
            raise AssertionError(args)

        result = run_backup(
            self.config,
            mount_lookup=self.mount_lookup,
            device_id=self.device_id,
            disk_free=lambda _path: 10**9,
            runner=runner,
            which=lambda name: f"/fixture/{name}",
            now=lambda: datetime(
                2026, 9, 25, 12, 0, 0, tzinfo=timezone.utc
            ),
        )

        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["retainedSuccessful"], 7)
        self.assertFalse(existing[0].exists())
        self.assertTrue(all(path.exists() for path in existing[1:]))
        self.assertFalse(list(self.dest.glob(".incomplete-*")))

        argv_text = "\n".join(" ".join(args) for args, _ in calls)
        self.assertNotIn(self.config.database_url, argv_text)
        self.assertNotIn("fixture_pw", argv_text)
        for _args, environment in calls:
            self.assertNotIn("DATABASE_URL", environment)
            if environment:
                self.assertEqual(environment["PGHOST"], "127.0.0.1")
                self.assertIn("PGPASSFILE", environment)

        published = list(self.dest.glob("backup-20260925T120000Z-*"))
        self.assertEqual(len(published), 1)
        manifest = json.loads((published[0] / "manifest.json").read_text())
        self.assertTrue(manifest["pgRestoreListVerified"])
        self.assertEqual(
            manifest["sha256"],
            hashlib.sha256(b"fixture-custom-backup").hexdigest(),
        )


    def test_nonobject_json_manifests_do_not_count_as_verified(self) -> None:
        verified = self._existing_backup(
            77, "2026-09-16T00:00:00Z", b"one-verified-archive"
        )
        damaged = []
        for index, value in enumerate((None, [], "partial-record", 0)):
            path = self.dest / f"backup-corrupt-type-{index}"
            path.mkdir()
            (path / "manifest.json").write_text(json.dumps(value) + "\n")
            (path / "database.dump").write_bytes(b"synthetic-unverified")
            damaged.append(path)

        def runner(argv, **_kwargs):
            args = [str(value) for value in argv]
            self.assertEqual(args[0], "/fixture/pg_restore")
            return subprocess.CompletedProcess(
                args, 0, "; archive\n1; 0 0 TABLE public users fixture\n", ""
            )

        listed = _verified_backup_directories(
            self.dest, pg_restore="/fixture/pg_restore", runner=runner
        )
        self.assertEqual([path for _, path in listed], [verified])
        self.assertEqual(
            _apply_retention(
                self.dest, 1, pg_restore="/fixture/pg_restore", runner=runner
            ),
            [],
        )
        self.assertTrue(verified.exists())
        self.assertTrue(all(path.exists() for path in damaged))

    def test_backup_success_preserves_corrupt_manifest_shape_and_valid_retention(
        self,
    ) -> None:
        verified = [
            self._existing_backup(
                index, f"2026-09-{index + 10:02d}T00:00:00Z",
                f"previous-good-{index}".encode(),
            )
            for index in range(7)
        ]
        malformed = self.dest / "backup-json-null-shape"
        malformed.mkdir()
        (malformed / "manifest.json").write_text("null\n")
        (malformed / "database.dump").write_bytes(b"keep-unknown-evidence")

        def runner(argv, **_kwargs):
            args = [str(value) for value in argv]
            if args[0] == "/fixture/pg_dump":
                Path(args[args.index("--file") + 1]).write_bytes(b"new-good")
                return subprocess.CompletedProcess(args, 0, "", "")
            if args[0] == "/fixture/pg_restore":
                return subprocess.CompletedProcess(
                    args, 0, "; archive\n1; 0 0 TABLE public users fixture\n", ""
                )
            raise AssertionError(args)

        result = run_backup(
            self.config,
            mount_lookup=self.mount_lookup,
            device_id=self.device_id,
            disk_free=lambda _path: 10**9,
            runner=runner,
            which=lambda name: f"/fixture/{name}",
            now=lambda: datetime(2026, 10, 1, 12, 0, 0, tzinfo=timezone.utc),
        )
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["retainedSuccessful"], 7)
        self.assertFalse(verified[0].exists())
        self.assertTrue(all(path.exists() for path in verified[1:]))
        self.assertTrue(malformed.exists())
        self.assertEqual(
            (malformed / "manifest.json").read_text(), "null\n"
        )
        self.assertFalse(list(self.dest.glob(".incomplete-*")))

    def test_unverified_manifest_does_not_displace_verified_backups(self) -> None:
        verified = [
            self._existing_backup(
                index,
                f"2026-09-{index + 10:02d}T00:00:00Z",
                f"verified-{index}".encode(),
            )
            for index in range(6)
        ]
        unverified = self._existing_backup(
            99,
            "2026-09-30T00:00:00Z",
            b"unverified-newest",
            restore_verified=False,
        )

        def runner(argv, **_kwargs):
            args = [str(value) for value in argv]
            if args[0] == "/fixture/pg_dump":
                Path(args[args.index("--file") + 1]).write_bytes(b"new-good")
                return subprocess.CompletedProcess(args, 0, "", "")
            if args[0] == "/fixture/pg_restore":
                return subprocess.CompletedProcess(
                    args, 0, "; archive\n1; 0 0 TABLE public users fixture\n", ""
                )
            raise AssertionError(args)

        result = run_backup(
            self.config,
            mount_lookup=self.mount_lookup,
            device_id=self.device_id,
            disk_free=lambda _path: 10**9,
            runner=runner,
            which=lambda name: f"/fixture/{name}",
            now=lambda: datetime(
                2026, 9, 25, 13, 0, 0, tzinfo=timezone.utc
            ),
        )

        self.assertEqual(result["retainedSuccessful"], 7)
        self.assertTrue(all(path.exists() for path in verified))
        self.assertTrue(unverified.exists())
        self.assertFalse(list(self.dest.glob(".incomplete-*")))

    def test_invalid_created_at_is_not_verified_as_successful_backup(self) -> None:
        """Archive bytes alone cannot authenticate its ordering metadata."""
        good = self._existing_backup(
            40, "2026-09-15T00:00:00Z", b"valid-canonical-date",
        )
        invalid_dates = (
            "zz-invalid-timestamp",
            "2026-09-16T00:00:00+00:00",  # backup writer emits canonical Z
            "2026-02-30T00:00:00Z",
            "2026-9-1T00:00:00Z",
        )
        bad = [
            self._existing_backup(i + 41, stamp, f"bad-{i}".encode())
            for i, stamp in enumerate(invalid_dates)
        ]

        def runner(argv, **_kwargs):
            args = [str(value) for value in argv]
            self.assertEqual(args[0], "/fixture/pg_restore")
            return subprocess.CompletedProcess(
                args, 0, "; archive\n1; 0 0 TABLE public users fixture\n", ""
            )

        verified = _verified_backup_directories(
            self.dest, pg_restore="/fixture/pg_restore", runner=runner
        )
        self.assertEqual(
            [directory for _, directory in verified], [good]
        )
        self.assertTrue(all(directory.exists() for directory in bad))

    def test_invalid_created_at_does_not_displace_verified_retention(self) -> None:
        """Invalid date must not evict a good historical backup at keep=7."""
        verified = [
            self._existing_backup(
                i, f"2026-09-{i + 10:02d}T00:00:00Z",
                f"valid-{i}".encode(),
            )
            for i in range(7)
        ]
        invalid = self._existing_backup(
            99, "zz-corrupt-date", b"archive-valid-but-metadata-invalid"
        )

        def runner(argv, **_kwargs):
            args = [str(value) for value in argv]
            if args[0] == "/fixture/pg_dump":
                Path(args[args.index("--file") + 1]).write_bytes(b"new-good")
                return subprocess.CompletedProcess(args, 0, "", "")
            if args[0] == "/fixture/pg_restore":
                return subprocess.CompletedProcess(
                    args, 0, "; archive\n1; 0 0 TABLE public users fixture\n", ""
                )
            raise AssertionError(args)

        result = run_backup(
            self.config,
            mount_lookup=self.mount_lookup,
            device_id=self.device_id,
            disk_free=lambda _path: 10**9,
            runner=runner,
            which=lambda name: f"/fixture/{name}",
            now=lambda: datetime(2026, 9, 25, 12, 0, 0, tzinfo=timezone.utc),
        )
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["retainedSuccessful"], 7)
        self.assertFalse(verified[0].exists())  # the real oldest valid one
        self.assertTrue(all(path.exists() for path in verified[1:]))
        self.assertTrue(invalid.exists())  # never delete unverified evidence
        self.assertFalse(list(self.dest.glob(".incomplete-*")))

    def test_hash_corrupted_backup_does_not_displace_verified_backups(self) -> None:
        verified = [
            self._existing_backup(
                index,
                f"2026-09-{index + 10:02d}T00:00:00Z",
                f"verified-{index}".encode(),
            )
            for index in range(6)
        ]
        corrupted = self._existing_backup(
            98, "2026-09-29T00:00:00Z", b"original"
        )
        (corrupted / "database.dump").write_bytes(b"corrupted")

        def runner(argv, **_kwargs):
            args = [str(value) for value in argv]
            if args[0] == "/fixture/pg_dump":
                Path(args[args.index("--file") + 1]).write_bytes(b"new-good")
                return subprocess.CompletedProcess(args, 0, "", "")
            if args[0] == "/fixture/pg_restore":
                return subprocess.CompletedProcess(
                    args, 0, "; archive\n1; 0 0 TABLE public users fixture\n", ""
                )
            raise AssertionError(args)

        result = run_backup(
            self.config,
            mount_lookup=self.mount_lookup,
            device_id=self.device_id,
            disk_free=lambda _path: 10**9,
            runner=runner,
            which=lambda name: f"/fixture/{name}",
            now=lambda: datetime(
                2026, 9, 25, 14, 0, 0, tzinfo=timezone.utc
            ),
        )

        self.assertEqual(result["retainedSuccessful"], 7)
        self.assertTrue(all(path.exists() for path in verified))
        self.assertTrue(corrupted.exists())

    def test_final_name_collision_fails_without_overwrite(self) -> None:
        body = b"collision-body"
        digest = hashlib.sha256(body).hexdigest()
        final = self.dest / f"backup-20260925T150000Z-{digest[:12]}"
        final.mkdir()
        sentinel = final / "sentinel.txt"
        sentinel.write_text("preserve")

        def runner(argv, **_kwargs):
            args = [str(value) for value in argv]
            if args[0] == "/fixture/pg_dump":
                Path(args[args.index("--file") + 1]).write_bytes(body)
                return subprocess.CompletedProcess(args, 0, "", "")
            if args[0] == "/fixture/pg_restore":
                return subprocess.CompletedProcess(
                    args, 0, "; archive\n1; 0 0 TABLE public users fixture\n", ""
                )
            raise AssertionError(args)

        with self.assertRaisesRegex(BackupError, "BACKUP_DESTINATION_COLLISION"):
            run_backup(
                self.config,
                mount_lookup=self.mount_lookup,
                device_id=self.device_id,
                disk_free=lambda _path: 10**9,
                runner=runner,
                which=lambda name: f"/fixture/{name}",
                now=lambda: datetime(
                    2026, 9, 25, 15, 0, 0, tzinfo=timezone.utc
                ),
            )
        self.assertEqual(sentinel.read_text(), "preserve")
        self.assertFalse(list(self.dest.glob(".incomplete-*")))

    def test_dangling_symlink_final_name_collision_fails_closed(self) -> None:
        # Path.exists() is false for a dangling symlink, but its directory
        # entry still occupies the chosen immutable backup name.
        body = b"collision-dangling-link"
        digest = hashlib.sha256(body).hexdigest()
        final = self.dest / f"backup-20260925T153000Z-{digest[:12]}"
        unknown_target = self.dest / "preserve-unknown-target"
        final.symlink_to(unknown_target)
        self.assertTrue(final.is_symlink())
        self.assertFalse(final.exists())

        def runner(argv, **_kwargs):
            args = [str(value) for value in argv]
            if args[0] == "/fixture/pg_dump":
                Path(args[args.index("--file") + 1]).write_bytes(body)
                return subprocess.CompletedProcess(args, 0, "", "")
            if args[0] == "/fixture/pg_restore":
                return subprocess.CompletedProcess(
                    args, 0, "; archive\n1; 0 0 TABLE public users fixture\n", ""
                )
            raise AssertionError(args)

        with self.assertRaisesRegex(BackupError, "BACKUP_DESTINATION_COLLISION"):
            run_backup(
                self.config,
                mount_lookup=self.mount_lookup,
                device_id=self.device_id,
                disk_free=lambda _path: 10**9,
                runner=runner,
                which=lambda name: f"/fixture/{name}",
                now=lambda: datetime(
                    2026, 9, 25, 15, 30, 0, tzinfo=timezone.utc
                ),
            )
        self.assertTrue(final.is_symlink())
        self.assertEqual(final.readlink(), unknown_target)
        self.assertFalse(unknown_target.exists())
        self.assertFalse(list(self.dest.glob(".incomplete-*")))

    def test_racing_final_name_creation_is_not_replaced(self) -> None:
        body = b"collision-concurrent-empty-directory"
        digest = hashlib.sha256(body).hexdigest()
        final = self.dest / f"backup-20260925T154500Z-{digest[:12]}"
        sentinel = final / "preserve.txt"
        publisher = backup_module._publish_directory_noreplace

        def runner(argv, **_kwargs):
            args = [str(value) for value in argv]
            if args[0] == "/fixture/pg_dump":
                Path(args[args.index("--file") + 1]).write_bytes(body)
                return subprocess.CompletedProcess(args, 0, "", "")
            if args[0] == "/fixture/pg_restore":
                return subprocess.CompletedProcess(
                    args, 0, "; archive\n1; 0 0 TABLE public users fixture\n", ""
                )
            raise AssertionError(args)

        def inject_race_before_atomic_publish(temporary, destination):
            self.assertEqual(destination, final)
            destination.mkdir()
            sentinel.write_text("preserve-existing-entry")
            return publisher(temporary, destination)

        with patch(
            "backup_postgres_independent._publish_directory_noreplace",
            side_effect=inject_race_before_atomic_publish,
        ):
            with self.assertRaisesRegex(
                BackupError, "BACKUP_DESTINATION_COLLISION"
            ):
                run_backup(
                    self.config,
                    mount_lookup=self.mount_lookup,
                    device_id=self.device_id,
                    disk_free=lambda _path: 10**9,
                    runner=runner,
                    which=lambda name: f"/fixture/{name}",
                    now=lambda: datetime(
                        2026, 9, 25, 15, 45, 0, tzinfo=timezone.utc
                    ),
                )
        self.assertEqual(sentinel.read_text(), "preserve-existing-entry")
        self.assertFalse(list(self.dest.glob(".incomplete-*")))

    def test_atomic_publication_unavailable_fails_closed(self) -> None:
        body = b"synthetic-atomic-publish-unsupported"

        def runner(argv, **_kwargs):
            args = [str(value) for value in argv]
            if args[0] == "/fixture/pg_dump":
                Path(args[args.index("--file") + 1]).write_bytes(body)
                return subprocess.CompletedProcess(args, 0, "", "")
            if args[0] == "/fixture/pg_restore":
                return subprocess.CompletedProcess(
                    args, 0, "; archive\n1; 0 0 TABLE public users fixture\n", ""
                )
            raise AssertionError(args)

        with patch(
            "backup_postgres_independent.ctypes.CDLL",
            side_effect=OSError("renameat2 unavailable"),
        ):
            with self.assertRaisesRegex(
                BackupError, "BACKUP_ATOMIC_PUBLISH_UNAVAILABLE"
            ):
                run_backup(
                    self.config,
                    mount_lookup=self.mount_lookup,
                    device_id=self.device_id,
                    disk_free=lambda _path: 10**9,
                    runner=runner,
                    which=lambda name: f"/fixture/{name}",
                    now=lambda: datetime(
                        2026, 9, 25, 16, 0, 0, tzinfo=timezone.utc
                    ),
                )
        self.assertFalse(list(self.dest.glob("backup-*")))
        self.assertFalse(list(self.dest.glob(".incomplete-*")))

    def test_atomic_publish_unexpected_errno_is_bounded(self) -> None:
        with patch("backup_postgres_independent.ctypes.CDLL") as loader:
            loader.return_value.renameat2.return_value = -1
            with patch(
                "backup_postgres_independent.ctypes.get_errno",
                return_value=errno.EACCES,
            ):
                with self.assertRaisesRegex(
                    BackupError, "BACKUP_DESTINATION_PUBLISH_FAILED"
                ):
                    backup_module._publish_directory_noreplace(
                        self.dest / "synthetic-staged",
                        self.dest / "synthetic-final",
                    )
        loader.assert_called_once_with(None, use_errno=True)

    def test_empty_restore_listing_is_rejected_and_cleaned(self) -> None:
        def runner(argv, **_kwargs):
            args = [str(value) for value in argv]
            if args[0] == "/fixture/pg_dump":
                Path(args[args.index("--file") + 1]).write_bytes(b"bad-list")
                return subprocess.CompletedProcess(args, 0, "", "")
            if args[0] == "/fixture/pg_restore":
                return subprocess.CompletedProcess(args, 0, "; comments only\n", "")
            raise AssertionError(args)

        with self.assertRaisesRegex(
            BackupError, "POSTGRES_BACKUP_ARCHIVE_LIST_EMPTY"
        ):
            run_backup(
                self.config,
                mount_lookup=self.mount_lookup,
                device_id=self.device_id,
                disk_free=lambda _path: 10**9,
                runner=runner,
                which=lambda name: f"/fixture/{name}",
            )
        self.assertFalse(list(self.dest.glob(".incomplete-*")))

    def test_symlinked_backups_and_members_do_not_count_as_verified(self) -> None:
        # These fixtures are all valid if symlinks are followed, but none is
        # a backup produced wholly inside the independently mounted target.
        outside = Path(self.temp.name)
        linked_directory = self._existing_backup(
            91, "2026-09-11T00:00:00Z", b"directory-symlink",
        )
        actual_directory = outside / "external-backup-directory"
        linked_directory.rename(actual_directory)
        linked_directory.symlink_to(actual_directory, target_is_directory=True)

        linked_manifest = self._existing_backup(
            92, "2026-09-12T00:00:00Z", b"manifest-symlink",
        )
        actual_manifest = outside / "external-manifest.json"
        (linked_manifest / "manifest.json").rename(actual_manifest)
        (linked_manifest / "manifest.json").symlink_to(actual_manifest)

        linked_archive = self._existing_backup(
            93, "2026-09-13T00:00:00Z", b"archive-symlink",
        )
        actual_archive = outside / "external-database.dump"
        (linked_archive / "database.dump").rename(actual_archive)
        (linked_archive / "database.dump").symlink_to(actual_archive)

        good = self._existing_backup(
            94, "2026-09-14T00:00:00Z", b"real-owned-backup",
        )

        def runner(argv, **_kwargs):
            self.assertEqual(str(argv[0]), "/fixture/pg_restore")
            return subprocess.CompletedProcess(
                argv, 0, "; archive\n1; 0 0 TABLE public users fixture\n", "",
            )

        verified = _verified_backup_directories(
            self.dest, pg_restore="/fixture/pg_restore", runner=runner,
        )
        self.assertEqual([path for _stamp, path in verified], [good])
        # Retention must ignore the symlinked candidates rather than trying
        # to delete a linked directory or displacing the genuine backup.
        removed = _apply_retention(
            self.dest, 1, pg_restore="/fixture/pg_restore", runner=runner,
        )
        self.assertEqual(removed, [])
        self.assertTrue(good.is_dir())
        self.assertTrue(linked_directory.is_symlink())
        self.assertTrue(actual_directory.is_dir())
        self.assertTrue(actual_manifest.is_file())
        self.assertTrue(actual_archive.is_file())

    def test_missing_backup_tools_fail_closed(self) -> None:
        with self.assertRaisesRegex(BackupError, "POSTGRES_BACKUP_TOOLS_MISSING"):
            run_backup(
                self.config,
                mount_lookup=self.mount_lookup,
                device_id=self.device_id,
                disk_free=lambda _path: 10**9,
                which=lambda _name: None,
            )

    def test_pgpass_setup_failure_cleans_incomplete_directory(self) -> None:
        with patch(
            "backup_postgres_independent._create_pgpass",
            side_effect=OSError("fixture pgpass failure"),
        ):
            with self.assertRaisesRegex(OSError, "fixture pgpass failure"):
                run_backup(
                    self.config,
                    mount_lookup=self.mount_lookup,
                    device_id=self.device_id,
                    disk_free=lambda _path: 10**9,
                    which=lambda name: f"/fixture/{name}",
                )
        self.assertFalse(list(self.dest.glob(".incomplete-*")))

    def test_failed_dump_preserves_prior_success(self) -> None:
        prior = self._existing_backup(
            1, "2026-09-24T00:00:00Z", b"known-good"
        )

        def runner(argv, **_kwargs):
            args = [str(value) for value in argv]
            if args[0] == "/fixture/pg_dump":
                raise subprocess.CalledProcessError(1, args)
            raise AssertionError(args)

        with self.assertRaisesRegex(
            BackupError, "POSTGRES_BACKUP_COMMAND_FAILED"
        ):
            run_backup(
                self.config,
                mount_lookup=self.mount_lookup,
                device_id=self.device_id,
                disk_free=lambda _path: 10**9,
                runner=runner,
                which=lambda name: f"/fixture/{name}",
            )

        self.assertTrue(prior.exists())
        self.assertFalse(list(self.dest.glob(".incomplete-*")))

    def test_wrong_mountpoint_fails_closed(self) -> None:
        with self.assertRaisesRegex(
            BackupError, "BACKUP_DESTINATION_NOT_MOUNTPOINT"
        ):
            verify_independent_mounts(
                self.config,
                mount_lookup=lambda path: MountIdentity(
                    path.resolve().parent, "/dev/other", "ext4"
                ),
                device_id=self.device_id,
                disk_free=lambda _path: 10**9,
            )


if __name__ == "__main__":
    unittest.main()
