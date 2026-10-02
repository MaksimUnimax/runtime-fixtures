import datetime as dt
import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import work_board_v2 as v2
import work_board_v2_migrate as migrate
import work_queue


class MigrationCliTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "controllers").mkdir()
        board = {"version": 1, "revision": 0, "updated_at": "2026-10-02T00:00:00Z", "tasks": []}
        (self.root / "controllers/work-board.json").write_text(json.dumps(board))

    def tearDown(self):
        self.tmp.cleanup()

    def test_default_cli_is_inspect_only_and_does_not_create_authority_or_storage(self):
        before = (self.root / "controllers/work-board.json").read_bytes()
        with patch("builtins.print") as output:
            status = migrate.main(["--root", str(self.root)])
        self.assertEqual(status, 0)
        self.assertEqual(json.loads(output.call_args.args[0])["mode"], "INSPECT_ONLY")
        self.assertEqual((self.root / "controllers/work-board.json").read_bytes(), before)
        self.assertFalse((self.root / "controllers/work-board-done").exists())
        self.assertFalse((self.root / "controllers/work-board-v2-transactions").exists())

    def test_apply_requires_explicit_authority_and_reader_set(self):
        before = (self.root / "controllers/work-board.json").read_bytes()
        with patch("builtins.print") as output:
            status = migrate.main(["--root", str(self.root), "--apply"])
        self.assertEqual(status, 1)
        self.assertIn("AUTHORITY_REQUIRED", output.call_args.args[0])
        self.assertEqual((self.root / "controllers/work-board.json").read_bytes(), before)
        self.assertFalse((self.root / "controllers/work-board-done").exists())

    def _grant(self, *, expired=False, scope=None):
        now = dt.datetime.now(dt.timezone.utc)
        queue_path = Path(work_queue.__file__).resolve()
        repo = queue_path.parents[2]
        head = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
        raw = (self.root / "controllers/work-board.json").read_bytes()
        readers = {r: hashlib.sha256(queue_path.read_bytes()).hexdigest() for r in ("A", "B", "C", "ORG")}
        value = {
            "id": "gate-1", "status": "GRANTED", "authority": migrate.AUTHORITY_KIND,
            "issued_at": (now - dt.timedelta(hours=2)).isoformat(),
            "expires_at": (now - dt.timedelta(hours=1) if expired else now + dt.timedelta(hours=1)).isoformat(),
            "corrected_scope_sha256": scope or migrate.SCOPE_SHA256, "source_candidate_sha": head,
            "work_queue_sha256": hashlib.sha256(queue_path.read_bytes()).hexdigest(),
            "work_board_v2_sha256": hashlib.sha256(Path(v2.__file__).read_bytes()).hexdigest(),
            "migrate_sha256": hashlib.sha256(Path(migrate.__file__).read_bytes()).hexdigest(),
            "expected_v1_revision": 0, "expected_v1_sha256": hashlib.sha256(raw).hexdigest(),
            "reader_sha256": readers, "single_use": True,
        }
        path = self.root / "authorizations/CONTROLLER-WORK-BOARD-V2-MIGRATION-gate-1.json"
        path.parent.mkdir(exist_ok=True)
        path.write_text(json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n")
        path.chmod(0o600)
        return path, {r: queue_path for r in readers}

    def test_expired_and_wrong_scope_authority_fail_closed(self):
        for options, expected in [({"expired": True}, "EXPIRED"), ({"scope": "f"*64}, "SCOPE_MISMATCH")]:
            with self.subTest(expected=expected):
                path, readers = self._grant(**options)
                with self.assertRaisesRegex(RuntimeError, expected):
                    migrate._authority(self.root, path, readers, 0, hashlib.sha256((self.root / "controllers/work-board.json").read_bytes()).hexdigest())
                self.assertFalse((self.root / "controllers/work-board-done").exists())


if __name__ == "__main__":
    unittest.main()
