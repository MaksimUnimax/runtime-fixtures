"""Bind publication evidence to a clean final commit and the full declared delta."""
import argparse
import datetime
import json
import pathlib
import subprocess


def git(repo, *args):
    result = subprocess.run(
        ["git", "-C", str(repo), *args], text=True, capture_output=True, check=False
    )
    if result.returncode:
        raise ValueError(f"git {' '.join(args)}: {result.stderr.strip() or result.stdout.strip()}")
    return result.stdout.strip()


def verify(repo, base, expected_head):
    repo = pathlib.Path(repo)
    head = git(repo, "rev-parse", "--verify", f"{expected_head}^{{commit}}")
    actual = git(repo, "rev-parse", "HEAD")
    if actual != head:
        raise ValueError("HEAD differs from the declared final candidate")
    full_base = git(repo, "rev-parse", "--verify", f"{base}^{{commit}}")
    git(repo, "merge-base", "--is-ancestor", full_base, head)
    if git(repo, "status", "--porcelain", "--untracked-files=all"):
        raise ValueError("Candidate worktree is dirty")
    git(repo, "diff", "--check", f"{full_base}..{head}")
    git(repo, "diff", "--check", f"{head}^..{head}")
    return {
        "status": "PASS_EXACT_FINAL_DELTA",
        "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "base": full_base,
        "head": head,
        "tree": git(repo, "rev-parse", f"{head}^{{tree}}"),
        "full_delta_check": True,
        "final_commit_check": True,
        "clean_worktree": True,
        "scope": "Git content/whitespace identity only; not functional or live acceptance",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--base", required=True)
    parser.add_argument("--expected-head", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        result = verify(args.repo, args.base, args.expected_head)
    except (ValueError, OSError) as error:
        result = {"status": "REJECT", "reason": str(error)}
    pathlib.Path(args.output).write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))
    return 0 if result["status"] == "PASS_EXACT_FINAL_DELTA" else 1


if __name__ == "__main__":
    raise SystemExit(main())
