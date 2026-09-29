#!/usr/bin/env python3
from __future__ import annotations

import argparse
import fcntl
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable

APPLY_CONFIRM = "ISOLATED_MONITOR_PILOT_RETENTION"
RESULT_PREFIX = "MONITOR_PILOT_RETENTION_RESULT="
DEFAULT_STATE_DIR = Path("/var/lib/octoport-monitor/retention-maintenance")
DEFAULT_HARD_TIMEOUT_SECONDS = 60


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


def _safe_snapshot(result: dict[str, Any]) -> dict[str, Any]:
    inventory = result.get("inventory") if isinstance(result.get("inventory"), dict) else {}
    return {
        "version": 1,
        "kind": result.get("kind"),
        "startedAt": result.get("startedAt"),
        "finishedAt": result.get("finishedAt"),
        "pendingBefore": result.get("pendingBefore"),
        "pendingAfter": result.get("pendingAfter"),
        "actions": result.get("actions"),
        "inventory": {
            "scanned": inventory.get("scanned"),
            "reasons": inventory.get("reasons"),
            "nextCursor": inventory.get("nextCursor"),
        },
        "blocked": result.get("blocked"),
        "deadlineReached": result.get("deadlineReached"),
    }


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
    try:
        completed = subprocess.run(
            build_cli_command(release_root, mode, cursor),
            cwd=release_root,
            env=env,
            text=True,
            capture_output=True,
            timeout=timeout_seconds,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise RetentionRunnerError("RETENTION_CLI_HARD_TIMEOUT") from exc
    result = parse_cli_result(completed.stdout)
    return completed.returncode, result


def run_once(
    mode: str,
    state_dir: Path,
    release_root: Path,
    timeout_seconds: int,
    invoker: Callable[[Path, str, dict[str, str] | None, int], tuple[int, dict[str, Any]]] = invoke_cli,
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
        kind = result["kind"]
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
        if mode == "apply":
            next_cursor = result.get("inventory", {}).get("nextCursor")
            if kind == "PARTIAL" and isinstance(next_cursor, dict):
                _write_json_atomic(cursor_path, {"version": 1, "cursor": next_cursor})
            elif cursor_path.exists():
                cursor_path.unlink()
            _write_json_atomic(state_dir / "last-result.json", _safe_snapshot(result))
        print(
            "MONITOR_PILOT_RETENTION_RUNNER="
            + json.dumps(_safe_snapshot(result), sort_keys=True, separators=(",", ":"))
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
