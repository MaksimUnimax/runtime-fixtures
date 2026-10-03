#!/usr/bin/env python3
"""Bounded exact-SHA GitHub Actions gate for task-publication branches."""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

EXPECTED_REPOSITORY = "MaksimUnimax/runtime-fixtures"
TASK_BRANCH_PREFIX = "controller/task-publication/"
REQUIRED_EXTERNAL = {
    "Server CI": ".github/workflows/server-ci.yml",
    "Extension CI": ".github/workflows/extension-ci.yml",
    "Extension I1-C1 client": ".github/workflows/extension-i1-ci.yml",
    "Documentation CI": ".github/workflows/documentation.yml",
}
API_VERSION = "2022-11-28"
PER_PAGE = 100
MAX_PAGES = 10
HTTP_TIMEOUT_SECONDS = 20
POLL_INTERVAL_SECONDS = 20
INTERNAL_DEADLINE_SECONDS = 50 * 60
MAX_TRANSIENT_DELAY_SECONDS = 120
MAX_RESPONSE_BYTES = 8 * 1024 * 1024


class GateError(RuntimeError):
    """Immediate fail-closed error with a sanitized stable code."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


class RetryableGateError(RuntimeError):
    """Transient acquisition failure eligible for bounded retry."""

    def __init__(self, code: str, delay_seconds: float | None = None):
        self.code = code
        self.delay_seconds = delay_seconds
        super().__init__(code)


def validate_identity(repository: str, head: str, branch: str, token: str) -> None:
    if repository != EXPECTED_REPOSITORY:
        raise GateError("REPOSITORY_IDENTITY_MISMATCH")
    if len(head) != 40 or any(ch not in "0123456789abcdef" for ch in head):
        raise GateError("EXACT_SHA_REQUIRED")
    if not branch.startswith(TASK_BRANCH_PREFIX) or branch == TASK_BRANCH_PREFIX:
        raise GateError("TASK_PUBLICATION_BRANCH_REQUIRED")
    if not token:
        raise GateError("GITHUB_TOKEN_REQUIRED")


def _workflow_code(name: str) -> str:
    return name.upper().replace(" ", "_").replace("-", "_")


def evaluate_runs(runs: list[dict], head: str, branch: str) -> dict:
    """Evaluate only exact SHA + branch + push workflow identities."""

    grouped: dict[str, dict[int, dict]] = {name: {} for name in REQUIRED_EXTERNAL}

    for run in runs:
        if (
            run.get("head_sha") != head
            or run.get("head_branch") != branch
            or run.get("event") != "push"
        ):
            continue
        name = run.get("name")
        if name not in grouped:
            continue

        workflow_code = _workflow_code(name)
        if run.get("path") != REQUIRED_EXTERNAL[name]:
            raise GateError("WRONG_WORKFLOW_PATH_" + workflow_code)

        repository = run.get("repository")
        if (
            not isinstance(repository, dict)
            or repository.get("full_name") != EXPECTED_REPOSITORY
        ):
            raise GateError("RUN_REPOSITORY_IDENTITY_MISMATCH_" + workflow_code)

        head_repository = run.get("head_repository")
        if (
            not isinstance(head_repository, dict)
            or head_repository.get("full_name") != EXPECTED_REPOSITORY
        ):
            raise GateError("HEAD_REPOSITORY_IDENTITY_MISMATCH_" + workflow_code)

        run_id = run.get("id")
        attempt = run.get("run_attempt", 1)
        if type(run_id) is not int or run_id <= 0:
            raise GateError("RUN_ID_INVALID_" + _workflow_code(name))
        if type(attempt) is not int or attempt <= 0:
            raise GateError("RUN_ATTEMPT_INVALID_" + _workflow_code(name))

        prior = grouped[name].get(run_id)
        if prior is None or attempt > prior.get("run_attempt", 1):
            grouped[name][run_id] = run

    results = []
    for name in REQUIRED_EXTERNAL:
        by_id = grouped[name]
        if len(by_id) > 1:
            raise GateError("AMBIGUOUS_RUNS_" + _workflow_code(name))

        if not by_id:
            results.append(
                {
                    "name": name,
                    "path": REQUIRED_EXTERNAL[name],
                    "id": None,
                    "run_attempt": None,
                    "status": "missing",
                    "conclusion": None,
                }
            )
            continue

        run = next(iter(by_id.values()))
        results.append(
            {
                "name": name,
                "path": run["path"],
                "id": run["id"],
                "run_attempt": run.get("run_attempt", 1),
                "status": run.get("status", "missing"),
                "conclusion": run.get("conclusion"),
            }
        )

    passed = all(
        row["status"] == "completed" and row["conclusion"] == "success"
        for row in results
    )
    return {
        "status": "PASS" if passed else "WAITING",
        "head": head,
        "branch": branch,
        "runs": results,
    }


def _rate_limit_delay(headers, wall_now: float) -> float | None:
    retry_after = headers.get("Retry-After") if headers else None
    if retry_after:
        try:
            return max(0.0, float(retry_after))
        except (TypeError, ValueError):
            raise GateError("RATE_LIMIT_HEADER_INVALID")

    reset = headers.get("X-RateLimit-Reset") if headers else None
    if reset:
        try:
            return max(0.0, float(reset) - wall_now)
        except (TypeError, ValueError):
            raise GateError("RATE_LIMIT_HEADER_INVALID")

    return None


def _request_json(
    url: str,
    token: str,
    timeout_seconds: float,
    *,
    opener=urllib.request.urlopen,
    wall_clock=time.time,
) -> dict:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": "Bearer " + token,
            "User-Agent": "octoport-publication-gate",
            "X-GitHub-Api-Version": API_VERSION,
        },
    )
    try:
        with opener(request, timeout=timeout_seconds) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as error:
        if error.code == 429:
            raise RetryableGateError(
                "RATE_LIMIT",
                _rate_limit_delay(error.headers, wall_clock()),
            ) from None
        if 500 <= error.code <= 599:
            raise RetryableGateError("HTTP_5XX") from None
        if error.code in (401, 403):
            raise GateError("AUTH_OR_PERMISSION") from None
        raise GateError("HTTP_" + str(error.code)) from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise RetryableGateError("NETWORK") from None

    if len(raw) > MAX_RESPONSE_BYTES:
        raise GateError("RESPONSE_TOO_LARGE")

    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError, TypeError):
        raise GateError("MALFORMED_RESPONSE") from None

    if not isinstance(data, dict) or not isinstance(data.get("workflow_runs"), list):
        raise GateError("MALFORMED_RESPONSE")
    return data


def fetch_runs_once(
    head: str,
    token: str,
    timeout_seconds: float,
    *,
    opener=urllib.request.urlopen,
    wall_clock=time.time,
    deadline: float | None = None,
    clock=time.monotonic,
) -> list[dict]:
    all_runs: list[dict] = []
    for page in range(1, MAX_PAGES + 1):
        request_timeout = timeout_seconds
        if deadline is not None:
            remaining = deadline - clock()
            if remaining <= 0:
                raise GateError("DEADLINE_INCOMPLETE")
            request_timeout = min(request_timeout, remaining)

        query = urllib.parse.urlencode(
            {"head_sha": head, "per_page": PER_PAGE, "page": page}
        )
        url = (
            "https://api.github.com/repos/"
            + EXPECTED_REPOSITORY
            + "/actions/runs?"
            + query
        )
        data = _request_json(
            url,
            token,
            request_timeout,
            opener=opener,
            wall_clock=wall_clock,
        )
        rows = data["workflow_runs"]
        if not all(isinstance(row, dict) for row in rows):
            raise GateError("MALFORMED_RESPONSE")
        all_runs.extend(rows)
        if len(rows) < PER_PAGE:
            return all_runs

    raise GateError("PAGINATION_LIMIT")


def _blocked(reason: str, head: str, branch: str, *, runs=None, checked_at=None) -> dict:
    result = {
        "status": "BLOCKED",
        "reason": reason,
        "head": head,
        "branch": branch,
        "checked_at": time.time() if checked_at is None else checked_at,
    }
    if runs is not None:
        result["runs"] = runs
    return result


def run_gate(
    repository: str,
    head: str,
    branch: str,
    token: str,
    *,
    deadline_seconds: float = INTERNAL_DEADLINE_SECONDS,
    poll_interval_seconds: float = POLL_INTERVAL_SECONDS,
    clock=time.monotonic,
    wall_clock=time.time,
    sleep_fn=time.sleep,
    fetcher=fetch_runs_once,
    opener=urllib.request.urlopen,
) -> dict:
    try:
        validate_identity(repository, head, branch, token)
    except GateError as error:
        return _blocked(error.code, head, branch, checked_at=wall_clock())

    started = clock()
    deadline = started + deadline_seconds
    retry_count = 0
    last_runs = None

    while True:
        remaining = deadline - clock()
        if remaining <= 0:
            return _blocked(
                "DEADLINE_INCOMPLETE",
                head,
                branch,
                runs=last_runs,
                checked_at=wall_clock(),
            )

        try:
            runs = fetcher(
                head,
                token,
                min(HTTP_TIMEOUT_SECONDS, remaining),
                opener=opener,
                wall_clock=wall_clock,
                deadline=deadline,
                clock=clock,
            )
            evaluated = evaluate_runs(runs, head, branch)
            retry_count = 0
        except GateError as error:
            return _blocked(error.code, head, branch, checked_at=wall_clock())
        except RetryableGateError as error:
            if error.delay_seconds is not None:
                delay = max(1.0, error.delay_seconds)
                deadline_reason = (
                    "RATE_LIMIT_DEADLINE"
                    if error.code == "RATE_LIMIT"
                    else "TRANSIENT_DEADLINE"
                )
            else:
                delay = min(
                    POLL_INTERVAL_SECONDS * (2 ** min(retry_count, 2)),
                    MAX_TRANSIENT_DELAY_SECONDS,
                )
                deadline_reason = "TRANSIENT_DEADLINE"
            if clock() + delay >= deadline:
                return _blocked(
                    deadline_reason,
                    head,
                    branch,
                    runs=last_runs,
                    checked_at=wall_clock(),
                )
            retry_count += 1
            sleep_fn(delay)
            continue

        last_runs = evaluated["runs"]
        if clock() >= deadline:
            return _blocked(
                "DEADLINE_INCOMPLETE",
                head,
                branch,
                runs=last_runs,
                checked_at=wall_clock(),
            )
        if evaluated["status"] == "PASS":
            evaluated["checked_at"] = wall_clock()
            return evaluated

        if clock() + poll_interval_seconds >= deadline:
            return _blocked(
                "DEADLINE_INCOMPLETE",
                head,
                branch,
                runs=last_runs,
                checked_at=wall_clock(),
            )
        sleep_fn(poll_interval_seconds)


def main() -> int:
    result = run_gate(
        os.environ.get("GITHUB_REPOSITORY", ""),
        os.environ.get("GITHUB_SHA", ""),
        os.environ.get("GITHUB_REF_NAME", ""),
        os.environ.get("GITHUB_TOKEN", ""),
    )
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
