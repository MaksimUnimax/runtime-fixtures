#!/usr/bin/env python3
from __future__ import annotations

import contextlib
import fcntl
import io
import json
import tempfile
import unittest
from pathlib import Path

import monitor_pilot_retention_runner as runner


def maintenance_result(kind: str, cursor: dict[str, str] | None = None) -> dict:
    return {
        "schemaVersion": "monitor_pilot_retention_maintenance_v1",
        "kind": kind,
        "startedAt": "2026-09-29T00:00:00.000Z",
        "finishedAt": "2026-09-29T00:00:01.000Z",
        "pendingBefore": {"projection": 1, "incident": 0, "prunedReceipts": 1, "terminal": 0},
        "pendingAfter": {"projection": 0, "incident": 0, "prunedReceipts": 2, "terminal": 0},
        "actions": {"projected": 1, "reconciled": 0, "pruned": 1, "receiptRetired": 0, "terminalRetired": 0},
        "inventory": {"scanned": 2, "reasons": {"ELIGIBLE": 1}, "nextCursor": cursor},
        "blocked": {},
        "deadlineReached": False,
    }


class RetentionRunnerTests(unittest.TestCase):
    def test_build_apply_command_pins_confirmation_and_cursor(self) -> None:
        root = Path("/opt/octoport/ops-releases/test")
        cursor = {
            "completedAt": "2026-09-29T00:00:00.000Z",
            "runId": "00000000-0000-4000-8000-000000000001",
        }
        command = runner.build_cli_command(root, "apply", cursor)
        self.assertIn(
            "--confirm=ISOLATED_MONITOR_PILOT_RETENTION",
            command,
        )
        self.assertIn(
            "--cursor-completed-at=2026-09-29T00:00:00.000Z",
            command,
        )
        self.assertIn(
            "--cursor-run-id=00000000-0000-4000-8000-000000000001",
            command,
        )
        self.assertNotIn("--confirm=ISOLATED_MONITOR_PILOT_RETENTION", runner.build_cli_command(root, "inspect"))

    def test_parse_result_fails_closed_without_contract_line(self) -> None:
        with self.assertRaisesRegex(runner.RetentionRunnerError, "RETENTION_RESULT_MISSING"):
            runner.parse_cli_result("unrelated output")


    def test_partial_checkpoints_cursor_and_next_run_consumes_it(self) -> None:
        cursor = {
            "completedAt": "2026-09-29T00:00:00.000Z",
            "runId": "00000000-0000-4000-8000-000000000001",
        }
        observed: list[dict[str, str] | None] = []

        def first(_root: Path, _mode: str, seen, _timeout: int):
            observed.append(seen)
            return 3, maintenance_result("PARTIAL", cursor)

        def second(_root: Path, _mode: str, seen, _timeout: int):
            observed.append(seen)
            return 0, maintenance_result("APPLIED", None)

        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            self.assertEqual(runner.run_once("apply", state, Path("/release"), 60, first), 0)
            self.assertEqual(json.loads((state / "cursor.json").read_text())["cursor"], cursor)
            self.assertEqual(runner.run_once("apply", state, Path("/release"), 60, second), 0)
            self.assertEqual(observed, [None, cursor])
            self.assertFalse((state / "cursor.json").exists())
            saved = json.loads((state / "last-result.json").read_text())
            self.assertEqual(saved["kind"], "APPLIED")
            self.assertNotIn("authorityIssues", saved)


    def test_overlap_is_skipped_without_invocation(self) -> None:
        called = False

        def should_not_run(_root: Path, _mode: str, _cursor, _timeout: int):
            nonlocal called
            called = True
            raise AssertionError("invoker must not run")

        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            lock_path = state / "maintenance.lock"
            with lock_path.open("a+") as lock_stream:
                fcntl.flock(lock_stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    self.assertEqual(
                        runner.run_once("apply", state, Path("/release"), 60, should_not_run),
                        0,
                    )
            self.assertFalse(called)
            self.assertIn("SKIPPED_OVERLAP", output.getvalue())

    def test_missing_authority_is_failure(self) -> None:
        def invoke(_root: Path, _mode: str, _cursor, _timeout: int):
            return 2, maintenance_result("MISSING_AUTHORITY")

        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(runner.RetentionRunnerError, "RETENTION_AUTHORITY_MISSING"):
                runner.run_once("apply", Path(temporary), Path("/release"), 60, invoke)


    def test_partial_without_inventory_cursor_restarts_from_beginning(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            (state / "cursor.json").write_text(
                json.dumps(
                    {
                        "version": 1,
                        "cursor": {
                            "completedAt": "2026-09-29T00:00:00.000Z",
                            "runId": "00000000-0000-4000-8000-000000000001",
                        },
                    }
                )
            )

            def invoke(_root: Path, _mode: str, _cursor, _timeout: int):
                return 3, maintenance_result("PARTIAL", None)

            self.assertEqual(runner.run_once("apply", state, Path("/release"), 60, invoke), 0)
            self.assertFalse((state / "cursor.json").exists())


if __name__ == "__main__":
    unittest.main()
