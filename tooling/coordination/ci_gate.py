#!/usr/bin/env python3
"""Require the latest complete CI set for one exact candidate SHA and branch."""
import argparse
import json
import time
import urllib.parse
import urllib.request

REQUIRED = ("Server CI", "Extension CI", "Extension I1-C1 client", "Documentation CI", "Coordination and release safety")

def evaluate(runs, head, branch):
    latest = {}
    for run in runs:
        if run.get("head_sha") != head or run.get("head_branch") != branch or run.get("event") != "push":
            continue
        name = run.get("name")
        if name not in REQUIRED:
            continue
        if name not in latest or (run["id"], run.get("run_attempt", 1)) > (latest[name]["id"], latest[name].get("run_attempt", 1)):
            latest[name] = run
    results = [{"name": name, "id": latest.get(name, {}).get("id"), "status": latest.get(name, {}).get("status", "missing"), "conclusion": latest.get(name, {}).get("conclusion")} for name in REQUIRED]
    passed = all(row["status"] == "completed" and row["conclusion"] == "success" for row in results)
    return {"status": "PASS" if passed else "BLOCKED", "head": head, "branch": branch, "checked_at": time.time(), "runs": results}

def fetch_runs(head):
    all_runs = []
    for page in range(1, 11):
        query = urllib.parse.urlencode({"head_sha": head, "per_page": 100, "page": page})
        request = urllib.request.Request("https://api.github.com/repos/MaksimUnimax/runtime-fixtures/actions/runs?" + query, headers={"Accept":"application/vnd.github+json", "User-Agent":"octoport-coordination"})
        with urllib.request.urlopen(request, timeout=20) as response:
            data = json.load(response)
        rows = data["workflow_runs"]
        all_runs.extend(rows)
        if len(rows) < 100:
            return all_runs
    raise RuntimeError("CI pagination limit reached; no PASS may be inferred")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sha", required=True)
    parser.add_argument("--branch", required=True)
    args = parser.parse_args()
    if len(args.sha) != 40 or any(c not in "0123456789abcdef" for c in args.sha):
        raise RuntimeError("Exact SHA required")
    result = evaluate(fetch_runs(args.sha), args.sha, args.branch)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["status"] == "PASS" else 1

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, OSError, ValueError, KeyError) as error:
        print(json.dumps({"status":"BLOCKED", "error":str(error)}))
        raise SystemExit(1)
