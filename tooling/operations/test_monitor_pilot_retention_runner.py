#!/usr/bin/env python3
from __future__ import annotations

import contextlib
import fcntl
import io
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

# This test is intentionally safe to run from an immutable deployed release.
# The local runner import must never create __pycache__ inside that release.
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import monitor_pilot_retention_runner as runner  # noqa: E402 - import after bytecode guard


def maintenance_result(kind: str, cursor: dict[str, str] | None = None) -> dict:
    return {
        "schemaVersion": "monitor_pilot_retention_maintenance_v1",
        "kind": kind,
        "startedAt": "2026-09-29T00:00:00.000Z",
        "finishedAt": "2026-09-29T00:00:01.000Z",
        "pendingBefore": {
            "projection": 1,
            "incident": 0,
            "prunedReceipts": 1,
            "terminal": 0,
        },
        "pendingAfter": {
            "projection": 0,
            "incident": 0,
            "prunedReceipts": 2,
            "terminal": 0,
        },
        "actions": {
            "projected": 1,
            "reconciled": 0,
            "pruned": 1,
            "receiptRetired": 0,
            "terminalRetired": 0,
        },
        "inventory": {
            "scanned": 2,
            "reasons": {"ELIGIBLE": 1},
            "nextCursor": cursor,
        },
        "blocked": {},
        "deadlineReached": False,
    }


class RetentionRunnerTests(unittest.TestCase):
    def test_deployed_test_disables_bytecode_before_local_runner_import(self) -> None:
        self.assertTrue(
            sys.dont_write_bytecode,
            "deployed immutable-release tests must not create local __pycache__",
        )
        source = Path(__file__).read_text()
        self.assertLess(
            source.index("sys.dont_write_bytecode = True"),
            source.index("import monitor_pilot_retention_runner as runner"),
        )

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
        self.assertNotIn(
            "--confirm=ISOLATED_MONITOR_PILOT_RETENTION",
            runner.build_cli_command(root, "inspect"),
        )

    def test_parse_result_fails_closed_without_contract_line(self) -> None:
        with self.assertRaisesRegex(
            runner.RetentionRunnerError,
            "RETENTION_RESULT_MISSING",
        ):
            runner.parse_cli_result("unrelated output")

    def test_parse_result_rejects_non_object_json(self) -> None:
        for payload in ("[]", "null"):
            with self.subTest(payload=payload):
                with self.assertRaisesRegex(
                    runner.RetentionRunnerError,
                    "RETENTION_RESULT_INVALID",
                ):
                    runner.parse_cli_result(runner.RESULT_PREFIX + payload)

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
            self.assertEqual(
                runner.run_once("apply", state, Path("/release"), 60, first),
                0,
            )
            self.assertEqual(
                json.loads((state / "cursor.json").read_text())["cursor"],
                cursor,
            )
            self.assertEqual(
                runner.run_once("apply", state, Path("/release"), 60, second),
                0,
            )
            self.assertEqual(observed, [None, cursor])
            self.assertFalse((state / "cursor.json").exists())
            saved = json.loads((state / "last-result.json").read_text())
            self.assertEqual(saved["kind"], "APPLIED")
            self.assertNotIn("authorityIssues", saved)

    def test_apply_rejects_inspected_result_without_mutating_state(self) -> None:
        cursor = {
            "completedAt": "2026-09-29T00:00:00.000Z",
            "runId": "00000000-0000-4000-8000-000000000001",
        }

        def invoke(_root: Path, _mode: str, _cursor, _timeout: int):
            return 0, maintenance_result("INSPECTED")

        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            cursor_path = state / "cursor.json"
            result_path = state / "last-result.json"
            cursor_bytes = (
                json.dumps({"version": 1, "cursor": cursor}, sort_keys=True) + "\n"
            )
            prior_result = '{"version":1,"kind":"PARTIAL"}\n'
            cursor_path.write_text(cursor_bytes)
            result_path.write_text(prior_result)
            with self.assertRaisesRegex(
                runner.RetentionRunnerError,
                "RETENTION_RESULT_MODE_MISMATCH",
            ):
                runner.run_once(
                    "apply",
                    state,
                    Path("/release"),
                    60,
                    invoke,
                )
            self.assertEqual(cursor_path.read_text(), cursor_bytes)
            self.assertEqual(result_path.read_text(), prior_result)

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
                fcntl.flock(
                    lock_stream.fileno(),
                    fcntl.LOCK_EX | fcntl.LOCK_NB,
                )
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    self.assertEqual(
                        runner.run_once(
                            "apply",
                            state,
                            Path("/release"),
                            60,
                            should_not_run,
                        ),
                        0,
                    )
            self.assertFalse(called)
            self.assertIn("SKIPPED_OVERLAP", output.getvalue())

    def test_missing_authority_is_failure(self) -> None:
        def invoke(_root: Path, _mode: str, _cursor, _timeout: int):
            return 2, maintenance_result("MISSING_AUTHORITY")

        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(
                runner.RetentionRunnerError,
                "RETENTION_AUTHORITY_MISSING",
            ):
                runner.run_once(
                    "apply",
                    Path(temporary),
                    Path("/release"),
                    60,
                    invoke,
                )

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

            self.assertEqual(
                runner.run_once(
                    "apply",
                    state,
                    Path("/release"),
                    60,
                    invoke,
                ),
                0,
            )
            self.assertFalse((state / "cursor.json").exists())

    def test_safe_child_error_is_whitelisted(self) -> None:
        self.assertEqual(
            runner._safe_child_error(
                "detail\nMONITOR_PILOT_EXPECTED_DATABASE_ROLE_REQUIRED\n"
            ),
            "MONITOR_PILOT_EXPECTED_DATABASE_ROLE_REQUIRED",
        )
        self.assertEqual(
            runner._safe_child_error("HEALTH_RETENTION_LIMIT_INVALID\n"),
            "HEALTH_RETENTION_LIMIT_INVALID",
        )
        self.assertIsNone(
            runner._safe_child_error("MONITOR_PILOT_EMAIL_JANE_DOE_GMAIL_COM\n")
        )
        self.assertIsNone(
            runner._safe_child_error("HEALTH_RETENTION_SECRET_SYNTHETIC_MARKER\n")
        )
        self.assertIsNone(
            runner._safe_child_error(
                "password=must-not-surface\nMONITOR PILOT malformed detail\n"
            )
        )

    def test_invoke_cli_surfaces_only_safe_child_error_code(self) -> None:
        original = runner._run_command_group

        def fake_run(_command, _cwd, _env, _timeout):
            return (
                1,
                "",
                "private detail must stay hidden\n"
                "MONITOR_PILOT_EXPECTED_DATABASE_ROLE_REQUIRED\n",
            )

        runner._run_command_group = fake_run
        try:
            with self.assertRaisesRegex(
                runner.RetentionRunnerError,
                "^RETENTION_CLI_MONITOR_PILOT_EXPECTED_DATABASE_ROLE_REQUIRED$",
            ):
                runner.invoke_cli(
                    Path("/release"),
                    "inspect",
                    None,
                    60,
                )
        finally:
            runner._run_command_group = original

    def test_child_count_fields_are_checked_before_logging(self) -> None:
        marker = "SYNTHETIC_NOT_A_REAL_SECRET_MARKER_9821"
        malformed = [
            (
                "inventory",
                lambda value: value["inventory"]["reasons"].update(
                    {"ELIGIBLE": marker}
                ),
            ),
            (
                "blocked",
                lambda value: value["blocked"].update(
                    {"prune:PAYLOAD_MISSING": marker}
                ),
            ),
            (
                "pending",
                lambda value: value["pendingBefore"].update({"projection": marker}),
            ),
            ("actions", lambda value: value["actions"].update({"pruned": marker})),
            ("timestamp", lambda value: value.update({"startedAt": marker})),
            (
                "impossible_calendar_timestamp",
                lambda value: value.update({"finishedAt": "2026-99-99T99:99:99.000Z"}),
            ),
            (
                "unknown_uppercase_reason",
                lambda value: value["inventory"]["reasons"].update(
                    {"EMAIL_JANE_DOE_GMAIL_COM": 1}
                ),
            ),
            (
                "unknown_uppercase_prune_block",
                lambda value: value["blocked"].update(
                    {"prune:EMAIL_JANE_DOE_GMAIL_COM": 1}
                ),
            ),
            (
                "wrong_method_reason",
                lambda value: value["blocked"].update({"receipt:INCIDENT_PINNED": 1}),
            ),
            (
                "reason_key",
                lambda value: value["inventory"]["reasons"].update(
                    {
                        "ELIGIBLE\\n" + marker: 1,
                    }
                ),
            ),
            (
                "blocked_key",
                lambda value: value["blocked"].update(
                    {
                        "prune:PAYLOAD_MISSING\\n" + marker: 1,
                    }
                ),
            ),
            (
                "boolean_count",
                lambda value: value["inventory"]["reasons"].update(
                    {
                        "ELIGIBLE": True,
                    }
                ),
            ),
            (
                "negative_count",
                lambda value: value["inventory"]["reasons"].update(
                    {
                        "ELIGIBLE": -1,
                    }
                ),
            ),
        ]
        for label, mutate in malformed:
            with self.subTest(label=label), tempfile.TemporaryDirectory() as temporary:
                result = maintenance_result("INSPECTED")
                mutate(result)
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    with self.assertRaisesRegex(
                        runner.RetentionRunnerError, "RETENTION_RESULT_UNSAFE_FIELDS"
                    ):
                        runner.run_once(
                            "inspect",
                            Path(temporary),
                            Path("/synthetic-release"),
                            60,
                            lambda *_args: (0, result),
                        )
                self.assertNotIn(marker, output.getvalue())
                self.assertFalse((Path(temporary) / "last-result.json").exists())

    def test_malformed_partial_result_never_persists_cursor(self) -> None:
        marker = "SYNTHETIC_NOT_A_REAL_SECRET_MARKER_9821"
        result = maintenance_result(
            "PARTIAL",
            {
                "completedAt": "2026-09-29T00:00:00.000Z",
                "runId": "00000000-0000-4000-8000-000000000001",
            },
        )
        result["blocked"] = {"receipt:ALREADY_RETIRED": marker}
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                with self.assertRaisesRegex(
                    runner.RetentionRunnerError, "RETENTION_RESULT_UNSAFE_FIELDS"
                ):
                    runner.run_once(
                        "apply",
                        state,
                        Path("/synthetic-release"),
                        60,
                        lambda *_args: (3, result),
                    )
            self.assertNotIn(marker, output.getvalue())
            self.assertFalse((state / "cursor.json").exists())
            self.assertFalse((state / "last-result.json").exists())

    def test_invalid_partial_result_preserves_existing_checkpoint(self) -> None:
        cursor = {
            "completedAt": "2026-09-29T00:00:00.000Z",
            "runId": "00000000-0000-4000-8000-000000000001",
        }
        result = maintenance_result("PARTIAL", cursor)
        result["blocked"] = {"terminal:TOO_NEW": "SYNTHETIC_NOT_REAL"}
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            cursor_path = state / "cursor.json"
            result_path = state / "last-result.json"
            original_cursor = json.dumps({"version": 1, "cursor": cursor}) + "\n"
            original_result = '{"version":1,"kind":"PARTIAL"}\n'
            cursor_path.write_text(original_cursor)
            result_path.write_text(original_result)
            with self.assertRaisesRegex(
                runner.RetentionRunnerError, "RETENTION_RESULT_UNSAFE_FIELDS"
            ):
                runner.run_once(
                    "apply",
                    state,
                    Path("/synthetic-release"),
                    60,
                    lambda *_args: (3, result),
                )
            self.assertEqual(cursor_path.read_text(), original_cursor)
            self.assertEqual(result_path.read_text(), original_result)

    def test_legitimate_reason_and_blocked_counts_remain_visible(self) -> None:
        result = maintenance_result("PARTIAL")
        result["blocked"] = {
            "prune:PAYLOAD_MISSING": 2,
            "receipt:ALREADY_RETIRED": 1,
            "terminal:TOO_NEW": 3,
        }
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                self.assertEqual(
                    runner.run_once(
                        "apply",
                        state,
                        Path("/synthetic-release"),
                        60,
                        lambda *_args: (3, result),
                    ),
                    0,
                )
            record = json.loads((state / "last-result.json").read_text())
            self.assertEqual(record["blocked"], result["blocked"])
            self.assertEqual(record["inventory"]["reasons"], {"ELIGIBLE": 1})
            self.assertIn("prune:PAYLOAD_MISSING", output.getvalue())

    def test_service_templates_pin_expected_pilot_role(self) -> None:
        unit_dir = Path(__file__).resolve().parent / "systemd"
        for name in (
            "octoport-monitor-retention.service.in",
            "octoport-monitor-retention-inspect.service.in",
        ):
            text = (unit_dir / name).read_text()
            self.assertIn(
                "Environment=MONITOR_PILOT_EXPECTED_ROLE=octoport_monitor_pilot",
                text,
            )

    def test_hard_timeout_kills_entire_child_process_group(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            child_pid_path = root / "child.pid"
            script = root / "hang.py"
            script.write_text(
                "import pathlib,subprocess,sys,time\n"
                "child=subprocess.Popen([sys.executable,'-c',"
                "'import time; time.sleep(60)'])\n"
                "pathlib.Path(sys.argv[1]).write_text(str(child.pid))\n"
                "time.sleep(60)\n"
            )
            with self.assertRaisesRegex(
                runner.RetentionRunnerError,
                "RETENTION_CLI_HARD_TIMEOUT",
            ):
                runner._run_command_group(
                    [sys.executable, str(script), str(child_pid_path)],
                    root,
                    dict(os.environ),
                    0.5,
                )
            self.assertTrue(child_pid_path.exists())
            child_pid = int(child_pid_path.read_text())
            child_proc = Path(f"/proc/{child_pid}")
            deadline = time.monotonic() + 2.0
            while child_proc.exists() and time.monotonic() < deadline:
                time.sleep(0.05)
            self.assertFalse(
                child_proc.exists(),
                "timed-out child process survived its process-group kill",
            )


if __name__ == "__main__":
    unittest.main()
