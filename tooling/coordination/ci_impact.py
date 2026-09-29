#!/usr/bin/env python3
"""Conservative, advisory-only CI scope analysis. Does not authorize skipping CI."""
import argparse
import json
import re
import subprocess
from pathlib import Path, PurePosixPath

SHA = re.compile(r"[0-9a-f]{40}\Z")
SAFE_PATH = re.compile(r"[A-Za-z0-9_./-]+\Z")
PROSE_FILES = {"README.md", "docs/README.md"}
PROSE_RECEIPTS = "docs/development/coordination/receipts/"
MAX_DIFF_BYTES = 2 * 1024 * 1024


def prose_path(path):
    if not isinstance(path, str) or not SAFE_PATH.fullmatch(path):
        return False
    parts = PurePosixPath(path).parts
    if path.startswith("/") or ".." in parts or "/./" in path or "//" in path:
        return False
    if path in PROSE_FILES:
        return True
    tail = path.removeprefix(PROSE_RECEIPTS).split("/")
    return (path.startswith(PROSE_RECEIPTS) and len(tail) == 2
            and tail[0] in {"A", "B", "C"} and tail[1].endswith(".md")
            and not tail[1].startswith("."))


def result(scope, reasons, changes):
    return {"schemaVersion": 1, "advisoryOnly": True, "canAuthorizeSkip": False,
            "impactClass": scope, "requiresFullProductTests": scope != "PROSE_ONLY",
            "alwaysRequired": ["Documentation CI", "Coordination and release safety"],
            "reasons": reasons, "changes": changes}


def classify(changes):
    if not changes:
        return result("FULL", ["EMPTY_DIFF_IS_NOT_PRIOR_ACCEPTANCE"], [])
    blockers = []
    permitted_modes = {"A": ("000000", "100644"),
                       "D": ("100644", "000000"), "M": ("100644", "100644")}
    for change in changes:
        if not isinstance(change, dict):
            return result("FULL", ["INVALID_CHANGE_RECORD"], [])
        path = change.get("path")
        modes = (change.get("oldMode"), change.get("newMode"))
        if permitted_modes.get(change.get("status")) != modes:
            blockers.append("NONREGULAR_OR_UNKNOWN_CHANGE")
        if not prose_path(path):
            blockers.append("RUNTIME_CONTROL_OR_UNCLASSIFIED_PATH")
    return result("FULL" if blockers else "PROSE_ONLY",
                  sorted(set(blockers)) or ["ALL_CHANGES_ALLOWLISTED_PROSE"], changes)


def parse_raw_diff(raw):
    if len(raw) > MAX_DIFF_BYTES:
        raise ValueError("DIFF_TOO_LARGE")
    if not raw:
        return []
    tokens = raw.split(b"\0")
    if tokens[-1] or (len(tokens) - 1) % 2:
        raise ValueError("INCOMPLETE_DIFF")
    changes = []
    for index in range(0, len(tokens) - 1, 2):
        header = tokens[index].decode("ascii").split()
        if len(header) != 5 or not header[0].startswith(":"):
            raise ValueError("INVALID_DIFF_HEADER")
        old_mode, new_mode, old_sha, new_sha, status = header
        if not SHA.fullmatch(old_sha) or not SHA.fullmatch(new_sha):
            raise ValueError("INVALID_DIFF_OBJECT")
        changes.append({"path": tokens[index + 1].decode("utf-8"),
                        "status": status, "oldMode": old_mode[1:],
                        "newMode": new_mode})
    return changes


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          timeout=15).stdout


def analyze(repo, base, head):
    if not all(isinstance(sha, str) and SHA.fullmatch(sha)
               and sha != "0" * 40 for sha in (base, head)):
        return result("FULL", ["EXACT_NONZERO_COMMIT_INPUTS_REQUIRED"], [])
    try:
        for sha in (base, head):
            if git(repo, "rev-parse", "--verify", sha + "^{commit}").decode().strip() != sha:
                raise ValueError("COMMIT_IDENTITY_MISMATCH")
        git(repo, "merge-base", "--is-ancestor", base, head)
        raw = git(repo, "diff", "--raw", "-z", "--no-abbrev", "--no-renames",
                  "--no-ext-diff", "--no-textconv", base, head, "--")
        report = classify(parse_raw_diff(raw))
    except (OSError, ValueError, UnicodeError, subprocess.SubprocessError):
        report = result("FULL", ["BASE_OR_DIFF_UNVERIFIED"], [])
    return {**report, "base": base, "head": head}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--base", required=True)
    parser.add_argument("--head", required=True)
    args = parser.parse_args()
    print(json.dumps(analyze(args.repo, args.base, args.head), ensure_ascii=True))


if __name__ == "__main__":
    main()
