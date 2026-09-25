from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from backup_postgres_independent import (
    BackupConfig,
    BackupError,
    MountIdentity,
    parse_database_url,
    run_backup,
    verify_independent_mounts,
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
