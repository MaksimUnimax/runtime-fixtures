"""Finite manual Harness QA, with a single campaign-wide call allowance.

The stock Harness owns the model/tool/error/final-answer cycle. This controller
does not rewrite programs, interpret business data or cap each request at two
generations. Private expected values never enter the worker filesystem.
"""
from datetime import datetime, timezone
from pathlib import Path
from threading import Thread
import argparse
import fcntl
import hashlib
import json
import os
import pwd
import secrets
import shutil
import subprocess
import sys
import time

from qa_gateway import Gateway
from run_smoke import ROOT, BASE, EVIDENCE, FIREWALL, prepare_rootfs, start_firewall, unit_command, write_job

def shape(value):
    if isinstance(value, dict):
        return {key: shape(child) for key, child in value.items()}
    if isinstance(value, list):
        return [shape(value[0])] if value else []
    return "value"

def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--max-calls", type=int, required=True)
    args = parser.parse_args()
    if args.max_calls < 1:
        raise ValueError("A positive finite model-call allowance is required")
    manifest_bytes = args.manifest.read_bytes()
    manifest = json.loads(manifest_bytes)
    campaign = manifest["campaign"]
    if not campaign.isidentifier():
        raise ValueError("Campaign name must be a simple identifier")
    output = EVIDENCE / (campaign + "_PRIVATE.json")
    marker = BASE / (campaign + ".started")
    lock = open("/run/lock/alisa-dsh-lab.lock", "a")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    if output.exists() or marker.exists():
        raise RuntimeError("Inspect existing evidence; do not replay paid requests")
    proof = json.loads((EVIDENCE / "smoke-095109-result.json").read_text())
    if not proof.get("passed"):
        raise RuntimeError("Offline execution/isolation proof missing")
    core = subprocess.run(["systemctl", "show", "alice-market", "-p", "WorkingDirectory", "--value"],
                          capture_output=True, text=True, check=True).stdout.strip()
    sys.path.insert(0, core)
    from http_transport import HTTPTransport
    transport = HTTPTransport("/run/credentials/alice-market.service", {}, {}, enabled=True)
    settings_bytes = Path("/var/lib/alice-market/answer-settings.json").read_bytes()
    settings = json.loads(settings_bytes)
    instruction = (ROOT / "answer_instruction.txt").read_text().strip()
    system_prompt = "\n".join(x for x in [
        settings["answer_prompt"], settings.get("answer_extra_instruction", ""), instruction] if x)
    user = pwd.getpwnam("alisa-dsh-lab")
    token = secrets.token_hex(32)
    gateway = Gateway(token, EVIDENCE / (campaign + "_GATEWAY_PRIVATE.json"),
                      lambda: transport._credential("deepseek"), maximum=args.max_calls)
    report = {"state": "PREPARED", "campaign": campaign, "synthetic_data": True,
              "max_total_dispatches": args.max_calls, "per_case_call_cap": None,
              "station_calls": 0, "marketplace_calls": 0, "selector_calls": 0, "production_db_writes": 0,
              "manifest_sha256": hashlib.sha256(manifest_bytes).hexdigest(),
              "production_answer_settings_sha256": hashlib.sha256(settings_bytes).hexdigest(),
              "answer_instruction": instruction, "cases": [],
              "started_utc": datetime.now(timezone.utc).isoformat()}
    def save():
        report["attempts"] = gateway.attempts
        temp = output.with_suffix(".tmp")
        temp.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        temp.replace(output)
    marker.write_text(report["started_utc"] + "\n")
    save()
    Thread(target=gateway.serve_forever, daemon=True).start()
    firewall = False
    try:
        start_firewall(user.pw_uid)
        firewall = True
        for index, case in enumerate(manifest["cases"]):
            if len(gateway.attempts) >= args.max_calls:
                raise RuntimeError("Campaign allowance exhausted before the next case")
            if shutil.disk_usage("/").free < 3 * 1024 ** 3 + 128 * 1024 ** 2:
                raise RuntimeError("Insufficient disk reserve for the next native job")
            first = len(gateway.attempts)
            name = campaign + "_" + str(index)
            job = BASE / "jobs" / name
            job.mkdir(exist_ok=False)
            os.chown(job, user.pw_uid, user.pw_gid)
            unit = "alisa-dsh-" + name
            entry = {"name": case["name"], "question": case["question"],
                     "expected": case["expected"], "state": "PREPARED"}
            report["cases"].append(entry)
            try:
                raw = json.dumps(case["data"], ensure_ascii=False, separators=(",", ":"))
                entry["input_sha256"] = hashlib.sha256(raw.encode()).hexdigest()
                entry["input_characters"] = len(raw)
                write_job(job / "input.json", raw, user)
                write_job(job / "local-transport-token", token, user)
                prompt = (case["question"] + "\nЗапрошенный период: " + manifest["period"] +
                          ". Полные данные находятся в /workspace/input.json. Используй run_code для работы " +
                          "с полным файлом и необходимых вычислений. Формат результата программы выбери " +
                          "по задаче: сохрани сведения, нужные для ответа на исходный вопрос.\n" +
                          "Примечания выбранного шаблона:\n" + case["notes"] +
                          "\nСтруктура документа (value обозначает значение):\n" +
                          json.dumps(shape(case["data"]), ensure_ascii=False, separators=(",", ":")))
                write_job(job / "request.json", json.dumps({"session_id": name,
                          "system_prompt": system_prompt, "prompt": prompt}, ensure_ascii=False), user)
                entry["state"] = "RUNNING"
                save()
                started = time.monotonic()
                result = subprocess.run(unit_command(job, prepare_rootfs(), unit),
                                        capture_output=True, text=True, timeout=200)
                entry.update(exit_code=result.returncode, elapsed_seconds=round(time.monotonic()-started, 3))
                (EVIDENCE / (name + "-worker.log")).write_text(result.stdout + result.stderr)
                if (job / "result.private.json").exists():
                    entry["result"] = json.loads((job / "result.private.json").read_text())
                entry["attempt_numbers"] = [x["number"] for x in gateway.attempts[first:]]
                entry["state"] = "COMPLETED_AWAITING_QUALITY_REVIEW" if result.returncode == 0 else "FAILED"
                save()
                print(json.dumps({"case": case["name"], "state": entry["state"],
                                  "calls": len(gateway.attempts)-first}), flush=True)
                if result.returncode:
                    raise RuntimeError("Harness turn incomplete; inspect before another case")
            finally:
                state = subprocess.run(["systemctl", "show", unit, "-p", "ActiveState", "--value"],
                                       capture_output=True, text=True).stdout.strip()
                if state in {"active", "activating", "deactivating", "reloading"}:
                    raise RuntimeError("Worker still active; preserve its job")
                shutil.rmtree(job)
        report["state"] = "COMPLETED_AWAITING_QUALITY_REVIEW"
    except Exception as exc:
        report.update(state="STOPPED_INSPECT_BEFORE_RETRY", error_type=type(exc).__name__)
        raise
    finally:
        report["finished_utc"] = datetime.now(timezone.utc).isoformat()
        save()
        gateway.shutdown()
        gateway.server_close()
        if firewall:
            subprocess.run(["nft", "delete", "table", "inet", FIREWALL], check=True)

if __name__ == "__main__":
    main()
