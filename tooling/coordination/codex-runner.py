#!/usr/bin/env python3
"""One Luna-only child per stream; parent remains responsible for review."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import control

MODEL = "gpt-6-luna"
LAUNCHERS = {"A": "/root/.nvm/versions/node/v22.22.2/bin/codex",
             "B": "/usr/local/bin/codex2", "C": "/usr/local/bin/codex3"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("role", choices=["A", "B", "C"])
    parser.add_argument("task")
    parser.add_argument("--read-only", action="store_true")
    args = parser.parse_args()
    control.require_location(args.role)
    control.require_running(args.role)
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}", args.task):
        raise RuntimeError("INVALID_CHILD_TASK_ID")
    directory = control.CONTROL / "worktrees" / args.role / args.task
    logs = control.CONTROL / "logs" / args.role
    prompt_file = logs / (args.task + ".md")
    if not directory.is_dir() or directory.resolve() != directory or not prompt_file.is_file():
        raise RuntimeError("PREPARE_OWN_CHILD_WORKTREE_AND_TASK_PROMPT_FIRST")
    if prompt_file.resolve() != prompt_file:
        raise RuntimeError("CHILD_PROMPT_SYMLINK_REJECTED")
    with (control.CONTROL / ("codex-" + args.role + ".lock")).open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("OWN_CODEX_BUSY: continue another independent task")
            return 75
        environment = os.environ.copy()
        for key in ("OPENAI_API_KEY", "OPENAI_BASE_URL"):
            environment.pop(key, None)
        login = subprocess.run([LAUNCHERS[args.role], "login", "status"],
                               env=environment, text=True, capture_output=True, timeout=15)
        if login.returncode or "Logged in using ChatGPT" not in login.stdout + login.stderr:
            raise RuntimeError("CHATGPT_SUBSCRIPTION_LOGIN_REQUIRED: no API or model fallback")
        command = [LAUNCHERS[args.role], "exec", "-m", MODEL,
                   "-s", "read-only" if args.read_only else "workspace-write",
                   "-C", str(directory), "-o", str(logs / (args.task + "-result.md")), "-"]
        effective_file = logs / (args.task + "-effective.md")
        contract = "PARENT EXECUTION CONTRACT: You are a bounded child in a separate worktree, not the A/B/C parent. Do not call control.py status/start/submit from the child; those commands belong to the parent worktree. Do not commit, stage, push, or change shared Git metadata. The parent reads your diff and runs Git after review. A task request for a commit is fulfilled by a reviewed parent commit; never bypass the sandbox or request access to the entire shared .git. Leave source changes in your assigned child copy, report changed files and test evidence, and finish. Model is gpt-6-luna only. Resource contract: do not launch detached browsers, servers or worker pools. Ask the parent to run resource-consuming checks through control.py heavy and RESOURCE_POLICY.md; bounded small unit checks without servers are allowed. Never clean historical files/processes. Report resource capacity blockers rather than bypassing supervision.\n\n"
        control.write_json(logs / (args.task + "-boundary.json"), {"git_owner":"parent", "model":MODEL, "worktree":str(directory)})
        effective_file.write_text(contract + prompt_file.read_text() + "\n\n" + contract)
        os.chmod(effective_file, 0o600)
        with effective_file.open() as prompt, (logs / (args.task + "-exec.log")).open("a") as output:
            child = subprocess.Popen(command, cwd=directory, env=environment, stdin=prompt,
                                     stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
            receipt = {"role": args.role, "task": args.task, "model": MODEL,
                       "pid": child.pid, "worktree": str(directory), "started_at": control.now_text()}
            control.write_json(logs / (args.task + "-process.json"), receipt)
            print(json.dumps(receipt), flush=True)
            def stop(signum, _frame):
                os.killpg(child.pid, signal.SIGTERM)
                child.wait()
                raise SystemExit(128 + signum)
            signal.signal(signal.SIGTERM, stop)
            signal.signal(signal.SIGINT, stop)
            code = child.wait()
            receipt.update(exit_code=code, finished_at=control.now_text())
            control.write_json(logs / (args.task + "-process.json"), receipt)
            print("CODEX_FINISHED exit=" + str(code), flush=True)
            return code


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
