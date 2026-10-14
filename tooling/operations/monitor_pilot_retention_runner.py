#!/usr/bin/env python3
from __future__ import annotations

import argparse
import fcntl
import json
import os
import re
import signal
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

APPLY_CONFIRM = "ISOLATED_MONITOR_PILOT_RETENTION"
RESULT_PREFIX = "MONITOR_PILOT_RETENTION_RESULT="
DEFAULT_STATE_DIR = Path("/var/lib/octoport-monitor/retention-maintenance")
DEFAULT_HARD_TIMEOUT_SECONDS = 60
# Only the exact error codes emitted by the current TS maintenance path may
# cross the child-to-supervisor logging boundary. An uppercase "error code"
# can otherwise encode arbitrary secrets while matching the previous regex.
SAFE_CHILD_ERROR_CODES = frozenset(
    {
        "MONITOR_PILOT_DATABASE_URL_REQUIRED",
        "MONITOR_PILOT_EXPECTED_DATABASE_ROLE_REQUIRED",
        "MONITOR_PILOT_RETENTION_APPLY_CONFIRM_REQUIRED",
        "MONITOR_PILOT_RETENTION_COMMAND_REQUIRED",
        "MONITOR_PILOT_RETENTION_CURSOR_INVALID",
        "MONITOR_PILOT_RETENTION_DEADLINE_INVALID",
        "MONITOR_PILOT_RETENTION_FLAG_DUPLICATE",
        "MONITOR_PILOT_RETENTION_FLAG_INVALID",
        "MONITOR_PILOT_RETENTION_INSPECTION_FAILED",
        "MONITOR_PILOT_RETENTION_LIMIT_INVALID",
        "MONITOR_PILOT_RETENTION_OPERATION_FAILED",
        "MONITOR_PILOT_RETENTION_SCHEMA_REQUIRED",
        "MONITOR_PILOT_ADMIN_AUTHORITY_CONFLICT",
        "MONITOR_PILOT_CATALOG_CONFLICT",
        "MONITOR_PILOT_CATALOG_READ_FAILED",
        "MONITOR_PILOT_COMMAND_REQUIRED",
        "MONITOR_PILOT_DATABASE_IDENTITY_MISMATCH",
        "MONITOR_PILOT_DATABASE_ROLE_MISMATCH",
        "MONITOR_PILOT_OPERATION_FAILED",
        "MONITOR_PILOT_POSTWRITE_PREFLIGHT_FAILED",
        "MONITOR_PILOT_PROFILE_AUTHORITY_AMBIGUOUS",
        "MONITOR_PILOT_PROFILE_REVISION_CONTENT_MISMATCH",
        "MONITOR_PILOT_PROFILE_VARIANT_CONFLICT",
        "MONITOR_PILOT_PROVIDER_AUTHORITY_AMBIGUOUS",
        "MONITOR_PILOT_SOURCE_MANIFEST_DRIFT",
        "MONITOR_PILOT_SURFACE_AUTHORITY_AMBIGUOUS",
        "MONITOR_PILOT_TECHNICAL_AUTHORITY_CLEANUP_FAILED",
        "HEALTH_RETENTION_CLASSIFICATION_MISMATCH",
        "HEALTH_RETENTION_CURSOR_INVALID",
        "HEALTH_RETENTION_LIMIT_INVALID",
        "HEALTH_RETENTION_OBSERVATION_DELETE_FAILED",
        "HEALTH_RETENTION_OBSERVED_AT_INVALID",
        "HEALTH_RETENTION_RAW_PAYLOAD_CUTOFF_TOO_RECENT",
        "HEALTH_RETENTION_RECEIPT_IDENTITY_CHANGED",
        "HEALTH_RETENTION_RECEIPT_NOT_FOUND",
        "HEALTH_RETENTION_RECEIPT_NOT_FOUND_FOR_INCIDENT_MARK",
        "HEALTH_RETENTION_RECEIPT_PROJECTION_CONFLICT",
        "HEALTH_RETENTION_RECEIPT_RETIRE_FAILED",
        "HEALTH_RETENTION_REPLAY_RECEIPT_CUTOFF_TOO_RECENT",
        "HEALTH_RETENTION_RUN_DELETE_FAILED",
        "HEALTH_RETENTION_SCHEDULED_RUN_RETIRE_FAILED",
        "HEALTH_RETENTION_SCHEDULER_DETACH_FAILED",
        "HEALTH_RETENTION_SCHEDULE_NOT_FOUND",
        "HEALTH_RETENTION_SCOPE_IDENTITY_CONFLICT",
        "HEALTH_RETENTION_SCOPE_STATE_MISSING",
        "HEALTH_RETENTION_TERMINAL_RETIRE_FAILED",
        "HEALTH_RETENTION_WATERMARK_ADVANCE_FAILED",
    }
)
SAFE_TIMESTAMP = re.compile(
    r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$"
)
SAFE_RUN_ID = re.compile(r"^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$")
# These codes are finite unions in health-retention-repository.ts. Shape-only
# uppercase checks allow attacker-supplied text that resembles an enum name.
INVENTORY_REASONS = frozenset(
    {
        "ELIGIBLE",
        "ALREADY_PRUNED",
        "PROJECTION_MISSING",
        "INCIDENT_PROCESSING_PENDING",
        "PAYLOAD_MISSING",
        "SCHEDULER_MISSING",
        "SCHEDULER_NOT_SUCCEEDED",
        "SCHEDULER_LINK_MISMATCH",
        "INCIDENT_PINNED",
        "NOTIFICATION_PINNED",
        "REPAIR_APPROVAL_PINNED",
        "ACCEPTED_BASELINE_PINNED",
        "RECENT_STATE_PINNED",
    }
)
RECEIPT_BLOCKED_REASONS = frozenset(
    {
        "ALREADY_RETIRED",
        "TOO_NEW",
        "PAYLOAD_NOT_PRUNED",
        "INCIDENT_PROCESSING_PENDING",
        "SCHEDULER_NOT_SUCCEEDED",
        "SCHEDULER_LINK_PRESENT",
    }
)
TERMINAL_BLOCKED_REASONS = frozenset(
    {
        "ALREADY_RETIRED",
        "TOO_NEW",
        "NOT_TERMINAL",
        "PERSISTED_RESULT_PRESENT",
        "RETRY_PENDING",
    }
)
BLOCKED_REASON_CODES = frozenset(
    {f"prune:{reason}" for reason in INVENTORY_REASONS if reason != "ELIGIBLE"}
    | {f"receipt:{reason}" for reason in RECEIPT_BLOCKED_REASONS}
    | {f"terminal:{reason}" for reason in TERMINAL_BLOCKED_REASONS}
)
MAX_SAFE_COUNT = (1 << 53) - 1


class RetentionRunnerError(RuntimeError):
    pass


def resolve_release_root(script_path: Path | None = None) -> Path:
    candidate = (script_path or Path(__file__)).resolve()
    return candidate.parents[2]


def _cursor_args(cursor: dict[str, str] | None) -> list[str]:
    if cursor is None:
        return []
    completed_at = cursor.get("completedAt")
    run_id = cursor.get("runId")
    if not isinstance(completed_at, str) or not isinstance(run_id, str):
        raise RetentionRunnerError("RETENTION_CURSOR_INVALID")
    return [
        f"--cursor-completed-at={completed_at}",
        f"--cursor-run-id={run_id}",
    ]


def build_cli_command(
    release_root: Path,
    mode: str,
    cursor: dict[str, str] | None = None,
) -> list[str]:
    if mode not in {"inspect", "apply"}:
        raise RetentionRunnerError("RETENTION_MODE_INVALID")
    command = [
        str(release_root / ".runtime/node"),
        str(release_root / "apps/telegram-operator/node_modules/tsx/dist/cli.mjs"),
        str(release_root / "tooling/server/monitor-pilot-retention.ts"),
        mode,
    ]
    if mode == "apply":
        command.append(f"--confirm={APPLY_CONFIRM}")
        command.extend(_cursor_args(cursor))
    return command


def parse_cli_result(stdout: str) -> dict[str, Any]:
    payload: str | None = None
    for line in stdout.splitlines():
        if line.startswith(RESULT_PREFIX):
            payload = line[len(RESULT_PREFIX) :]
    if payload is None:
        raise RetentionRunnerError("RETENTION_RESULT_MISSING")
    try:
        result = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise RetentionRunnerError("RETENTION_RESULT_INVALID") from exc
    if not isinstance(result, dict):
        raise RetentionRunnerError("RETENTION_RESULT_INVALID")
    if result.get("schemaVersion") != "monitor_pilot_retention_maintenance_v1":
        raise RetentionRunnerError("RETENTION_RESULT_SCHEMA_INVALID")
    if result.get("kind") not in {
        "INSPECTED",
        "APPLIED",
        "PARTIAL",
        "MISSING_AUTHORITY",
    }:
        raise RetentionRunnerError("RETENTION_RESULT_KIND_INVALID")
    inventory = result.get("inventory")
    if not isinstance(inventory, dict):
        raise RetentionRunnerError("RETENTION_RESULT_INVENTORY_INVALID")
    next_cursor = inventory.get("nextCursor")
    if next_cursor is not None and not isinstance(next_cursor, dict):
        raise RetentionRunnerError("RETENTION_RESULT_CURSOR_INVALID")
    if isinstance(next_cursor, dict):
        _cursor_args(next_cursor)
    return result


def _read_cursor(path: Path) -> dict[str, str] | None:
    if not path.exists():
        return None
    try:
        raw = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise RetentionRunnerError("RETENTION_CURSOR_STATE_INVALID") from exc
    if not isinstance(raw, dict) or raw.get("version") != 1:
        raise RetentionRunnerError("RETENTION_CURSOR_STATE_INVALID")
    cursor = raw.get("cursor")
    if not isinstance(cursor, dict):
        raise RetentionRunnerError("RETENTION_CURSOR_STATE_INVALID")
    _cursor_args(cursor)
    return {"completedAt": cursor["completedAt"], "runId": cursor["runId"]}


def _write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(payload, stream, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()


def _safe_count(value: Any) -> int:
    if type(value) is not int or not 0 <= value <= MAX_SAFE_COUNT:
        raise RetentionRunnerError("RETENTION_RESULT_UNSAFE_FIELDS")
    return value


def _safe_counts(
    value: Any,
    *,
    required_keys: set[str] | None = None,
    allowed_keys: frozenset[str] | None = None,
) -> dict[str, int]:
    if not isinstance(value, dict) or len(value) > 128:
        raise RetentionRunnerError("RETENTION_RESULT_UNSAFE_FIELDS")
    if required_keys is not None and set(value) != required_keys:
        raise RetentionRunnerError("RETENTION_RESULT_UNSAFE_FIELDS")
    result: dict[str, int] = {}
    for key, number in value.items():
        if not isinstance(key, str) or (
            allowed_keys is not None and key not in allowed_keys
        ):
            raise RetentionRunnerError("RETENTION_RESULT_UNSAFE_FIELDS")
        result[key] = _safe_count(number)
    return result


def _safe_timestamp(value: Any) -> str:
    if not isinstance(value, str) or not SAFE_TIMESTAMP.fullmatch(value):
        raise RetentionRunnerError("RETENTION_RESULT_UNSAFE_FIELDS")
    try:
        datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ")
    except ValueError as error:
        raise RetentionRunnerError("RETENTION_RESULT_UNSAFE_FIELDS") from error
    return value


def _safe_pending_counts(value: Any) -> dict[str, int] | None:
    if value is None:
        return None
    return _safe_counts(
        value,
        required_keys={"projection", "incident", "prunedReceipts", "terminal"},
    )


def _safe_snapshot(result: dict[str, Any]) -> dict[str, Any]:
    if result.get("schemaVersion") != "monitor_pilot_retention_maintenance_v1":
        raise RetentionRunnerError("RETENTION_RESULT_UNSAFE_FIELDS")
    kind = result.get("kind")
    if kind not in {"INSPECTED", "APPLIED", "PARTIAL", "MISSING_AUTHORITY"}:
        raise RetentionRunnerError("RETENTION_RESULT_UNSAFE_FIELDS")
    inventory = result.get("inventory")
    if not isinstance(inventory, dict) or set(inventory) != {
        "scanned",
        "reasons",
        "nextCursor",
    }:
        raise RetentionRunnerError("RETENTION_RESULT_UNSAFE_FIELDS")
    cursor = inventory["nextCursor"]
    if cursor is not None:
        if not isinstance(cursor, dict) or set(cursor) != {"completedAt", "runId"}:
            raise RetentionRunnerError("RETENTION_RESULT_UNSAFE_FIELDS")
        run_id = cursor["runId"]
        if not isinstance(run_id, str) or not SAFE_RUN_ID.fullmatch(run_id):
            raise RetentionRunnerError("RETENTION_RESULT_UNSAFE_FIELDS")
        cursor = {
            "completedAt": _safe_timestamp(cursor["completedAt"]),
            "runId": run_id,
        }
    reached = result.get("deadlineReached")
    if type(reached) is not bool:
        raise RetentionRunnerError("RETENTION_RESULT_UNSAFE_FIELDS")
    return {
        "version": 1,
        "kind": kind,
        "startedAt": _safe_timestamp(result.get("startedAt")),
        "finishedAt": _safe_timestamp(result.get("finishedAt")),
        "pendingBefore": _safe_pending_counts(result.get("pendingBefore")),
        "pendingAfter": _safe_pending_counts(result.get("pendingAfter")),
        "actions": _safe_counts(
            result.get("actions"),
            required_keys={
                "projected",
                "reconciled",
                "pruned",
                "receiptRetired",
                "terminalRetired",
            },
        ),
        "inventory": {
            "scanned": _safe_count(inventory["scanned"]),
            "reasons": _safe_counts(
                inventory["reasons"], allowed_keys=INVENTORY_REASONS
            ),
            "nextCursor": cursor,
        },
        "blocked": _safe_counts(
            result.get("blocked"), allowed_keys=BLOCKED_REASON_CODES
        ),
        "deadlineReached": reached,
    }


def _run_command_group(
    command: list[str],
    cwd: Path,
    env: dict[str, str],
    timeout_seconds: float,
) -> tuple[int, str, str]:
    process = subprocess.Popen(
        command,
        cwd=cwd,
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )
    try:
        stdout, stderr = process.communicate(timeout=timeout_seconds)
    except subprocess.TimeoutExpired as exc:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.communicate()
        raise RetentionRunnerError("RETENTION_CLI_HARD_TIMEOUT") from exc
    return process.returncode, stdout, stderr


def _safe_child_error(stderr: str) -> str | None:
    for line in reversed(stderr.splitlines()):
        candidate = line.strip()
        if candidate in SAFE_CHILD_ERROR_CODES:
            return candidate
    return None


def invoke_cli(
    release_root: Path,
    mode: str,
    cursor: dict[str, str] | None,
    timeout_seconds: int,
) -> tuple[int, dict[str, Any]]:
    env = os.environ.copy()
    env.setdefault(
        "NODE_PATH",
        str(release_root / "apps/telegram-operator/node_modules"),
    )
    return_code, stdout, stderr = _run_command_group(
        build_cli_command(release_root, mode, cursor),
        release_root,
        env,
        timeout_seconds,
    )
    try:
        result = parse_cli_result(stdout)
    except RetentionRunnerError as exc:
        if str(exc) == "RETENTION_RESULT_MISSING":
            safe_error = _safe_child_error(stderr)
            if safe_error is not None:
                raise RetentionRunnerError(f"RETENTION_CLI_{safe_error}") from exc
        raise
    return return_code, result


def run_once(
    mode: str,
    state_dir: Path,
    release_root: Path,
    timeout_seconds: int,
    invoker: Callable[
        [Path, str, dict[str, str] | None, int], tuple[int, dict[str, Any]]
    ] = invoke_cli,
) -> int:
    state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    lock_path = state_dir / "maintenance.lock"
    with lock_path.open("a+") as lock_stream:
        try:
            fcntl.flock(lock_stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("MONITOR_PILOT_RETENTION_RUNNER=SKIPPED_OVERLAP")
            return 0
        cursor_path = state_dir / "cursor.json"
        cursor = _read_cursor(cursor_path) if mode == "apply" else None
        exit_code, result = invoker(release_root, mode, cursor, timeout_seconds)
        kind = result.get("kind") if isinstance(result, dict) else None
        allowed_kinds = {
            "inspect": {"INSPECTED", "MISSING_AUTHORITY"},
            "apply": {"APPLIED", "PARTIAL", "MISSING_AUTHORITY"},
        }
        if kind not in allowed_kinds[mode]:
            raise RetentionRunnerError("RETENTION_RESULT_MODE_MISMATCH")
        expected = {
            "INSPECTED": 0,
            "APPLIED": 0,
            "PARTIAL": 3,
            "MISSING_AUTHORITY": 2,
        }[kind]
        if exit_code != expected:
            raise RetentionRunnerError("RETENTION_CLI_EXIT_MISMATCH")
        if kind == "MISSING_AUTHORITY":
            raise RetentionRunnerError("RETENTION_AUTHORITY_MISSING")
        # Validate every printable/persisted child field before updating the
        # cursor or last-result. An invalid counter must not leak to logs or disk.
        snapshot = _safe_snapshot(result)
        if mode == "apply":
            next_cursor = snapshot["inventory"]["nextCursor"]
            if kind == "PARTIAL" and isinstance(next_cursor, dict):
                _write_json_atomic(cursor_path, {"version": 1, "cursor": next_cursor})
            elif cursor_path.exists():
                cursor_path.unlink()
            _write_json_atomic(state_dir / "last-result.json", snapshot)
        print(
            "MONITOR_PILOT_RETENTION_RUNNER="
            + json.dumps(snapshot, sort_keys=True, separators=(",", ":"))
        )
        return 0


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("inspect", "apply"))
    parser.add_argument("--state-dir", type=Path, default=DEFAULT_STATE_DIR)
    parser.add_argument(
        "--hard-timeout-seconds",
        type=int,
        default=DEFAULT_HARD_TIMEOUT_SECONDS,
    )
    args = parser.parse_args(argv)
    if args.hard_timeout_seconds < 10 or args.hard_timeout_seconds > 120:
        parser.error("hard timeout must be between 10 and 120 seconds")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    try:
        return run_once(
            args.mode,
            args.state_dir,
            resolve_release_root(),
            args.hard_timeout_seconds,
        )
    except RetentionRunnerError as exc:
        print(f"MONITOR_PILOT_RETENTION_RUNNER_ERROR={exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
