"""One bounded, manual, model-only A/B on a previously recovered private case.

The full input is supplied by the operator outside this repository. This script
never queries a marketplace, a Station, or a production database.
"""
from datetime import datetime, timezone
from pathlib import Path
from threading import Thread
from urllib.request import Request, build_opener, ProxyHandler
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

CASE = EVIDENCE / "live-case-r1"
OUT = EVIDENCE / "LIVE_COMPARISON_PRIVATE.json"

def shape(value):
    """Actual field structure, no selected values or business-specific parsing."""
    if isinstance(value, dict):
        return {key: shape(child) for key, child in value.items()}
    if isinstance(value, list):
        return [shape(value[0])] if value else []
    return "value"

def main():
    os.umask(0o077)
    repair = sys.argv[1:] == ["--repair-full-read"]
    if sys.argv[1:] and not repair:
        raise RuntimeError("Unsupported manual QA mode")
    output = EVIDENCE / "LIVE_REPAIR_COMPARISON_PRIVATE.json" if repair else OUT
    lock = open("/run/lock/alisa-dsh-lab.lock", "a")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    if output.exists():
        raise RuntimeError("Inspect existing live evidence; do not replay paid requests")
    prior = EVIDENCE / "smoke-090616-result.json"
    if not json.loads(prior.read_text()).get("passed"):
        raise RuntimeError("Offline isolation/execution proof missing")
    user = pwd.getpwnam("alisa-dsh-lab")
    core = subprocess.run(["systemctl", "show", "alice-market.service", "-p", "WorkingDirectory", "--value"],
                          capture_output=True, text=True, check=True).stdout.strip()
    sys.path.insert(0, core)
    from http_transport import HTTPTransport
    from model_answer import messages, Settings
    data = json.loads((CASE / "input.private.json").read_text())
    source = json.loads((CASE / "source.private.json").read_text())
    digest = hashlib.sha256(json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    if digest != source["source_sha256"]:
        raise RuntimeError("Frozen input hash changed")
    settings = Settings("/var/lib/alice-market/answer-settings.json").read()
    catalog = json.loads((Path(core) / "template_catalog.json").read_text())["templates"]
    template = catalog["B14.card_views"]
    previous = json.loads((Path("/root/alice-lab-evidence/answer-model-20261109") /
                           "CALCULATION_GUIDE_TRIAL_2026-11-10.json").read_text())
    notes = [*template.get("notes", []), previous["guides"]["card_views"]]
    context = [{"template_id": "B14.card_views", "version": template["version"],
                "purpose": template["purpose"], "notes": notes}]
    api = [{"receipt": "frozen-report", "operation": source["operation"], "store": "frozen-store",
            "params": source["params"], "received_at": "2026-11-10T07:00:00+00:00", "data": data}]
    baseline = {"model": "deepseek-flash", "messages": messages(source["question"],
        {"responses": api, "template_context": context}, settings["answer_extra_instruction"], (),
        settings["answer_prompt"], input_encoding=1), "stream": False,
        "thinking": {"type": "enabled"}, "reasoning_effort": "high", "max_tokens": 16384}
    previous_run = json.loads(OUT.read_text()) if repair else None
    if repair:
        expected = previous_run["attempts"][0]["request_sha256"]
        if hashlib.sha256(json.dumps(baseline, ensure_ascii=False).encode()).hexdigest() != expected:
            raise RuntimeError("Previously paid baseline payload no longer matches")
        if previous_run["state"] != "HARNESS_FAILED" or len(previous_run["attempts"]) != 4:
            raise RuntimeError("Inspect previous run before authorizing a repair")
    job = BASE / "jobs" / ("live-" + datetime.now(timezone.utc).strftime("%H%M%S"))
    job.mkdir(parents=True, exist_ok=False)
    os.chown(job, user.pw_uid, user.pw_gid)
    token = secrets.token_hex(32)
    write_job(job / "local-transport-token", token, user)
    write_job(job / "input.json", json.dumps(data, ensure_ascii=False, separators=(",", ":")), user)
    prompt = (
        source["question"] + "\n\nПолный неизменённый ответ API находится в /workspace/input.json. "
        "Он доступен через run_code; используй программу для расчёта над полным файлом. "
        "В одном выполнении программы прочитай файл целиком через node:fs/promises "
        "(readFile с utf8), разбери JSON.parse и вычисли итог. "
        "Не печатай полный документ в результат инструмента. Верни вычисленный итог и сведения, "
        "достаточные для проверки расчёта; после результата инструмента сформируй обычный ответ пользователю.\n"
        "Примечания выбранного шаблона:\n" + "\n".join(notes) +
        "\nСтруктура документа (value обозначает значение в файле):\n" +
        json.dumps(shape(data), ensure_ascii=False, separators=(",", ":"))
    )
    system_prompt = settings["answer_prompt"]
    if settings["answer_extra_instruction"]:
        system_prompt += "\n" + settings["answer_extra_instruction"]
    write_job(job / "request.json", json.dumps({"session_id": job.name,
              "system_prompt": system_prompt, "prompt": prompt}, ensure_ascii=False), user)
    transport = HTTPTransport("/run/credentials/alice-market.service", {}, {}, enabled=True)
    def key_loader():
        return transport._credential("deepseek")
    limit = 6 if repair else 4
    gateway = Gateway(token, EVIDENCE / ("LIVE_REPAIR_GATEWAY_PRIVATE.json" if repair else "LIVE_GATEWAY_PRIVATE.json"),
                      key_loader, maximum=limit, initial_attempts=previous_run["attempts"] if repair else ())
    Thread(target=gateway.serve_forever, daemon=True).start()
    report = {"state": "PREPARED", "source_core": core, "source_sha256": digest,
              "question": source["question"], "max_model_dispatches": limit, "selector_calls": 0,
              "station_calls": 0, "marketplace_calls": 0, "production_db_writes": 0,
              "job": str(job), "baseline": {}, "harness": {}, "notes": notes,
              "effort": "high", "per_call_output_cap": 16384}
    if repair:
        report["baseline"] = previous_run["baseline"]
        report["baseline_reused_without_dispatch"] = True
        report["previous_paid_dispatches"] = 4
    def save():
        temp = output.with_suffix(".tmp")
        temp.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        temp.replace(output)
    firewall = False
    save()
    try:
        start_firewall(user.pw_uid)
        firewall = True
        if not repair:
            report["state"] = "BASELINE_DISPATCHING"
            save()
            started = time.monotonic()
            request = Request("http://127.0.0.1:33191/v1/chat/completions",
                data=json.dumps(baseline, ensure_ascii=False).encode(),
                headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"}, method="POST")
            with build_opener(ProxyHandler({})).open(request, timeout=200) as response:
                original = json.load(response)
            report["baseline"] = {"elapsed_seconds": round(time.monotonic() - started, 3),
                "finish_reason": original["choices"][0]["finish_reason"],
                "answer": original["choices"][0]["message"]["content"],
                "usage": original["usage"], "complete": original["choices"][0]["finish_reason"] == "stop"}
        report["state"] = "HARNESS_RUNNING"
        save()
        if not report["baseline"]["complete"]:
            raise RuntimeError("Baseline incomplete; do not continue")
        started = time.monotonic()
        unit = "alisa-dsh-" + job.name
        command = unit_command(job, prepare_rootfs(), unit)
        result = subprocess.run(command, capture_output=True, text=True, timeout=200)
        (EVIDENCE / ("LIVE_REPAIR_WORKER_PRIVATE.log" if repair else "LIVE_WORKER_PRIVATE.log")).write_text(result.stdout + result.stderr)
        report["harness"] = {"elapsed_seconds": round(time.monotonic() - started, 3),
                             "exit_code": result.returncode, "unit": unit}
        if (job / "result.private.json").exists():
            report["harness"]["result"] = json.loads((job / "result.private.json").read_text())
        report["state"] = "COMPLETED_AWAITING_QUALITY_REVIEW" if result.returncode == 0 else "HARNESS_FAILED"
        save()
        print(json.dumps({"state": report["state"], "model_dispatches": sum(bool(x.get("dispatched_utc")) for x in gateway.attempts),
                          "evidence": str(output)}))
        return 0 if result.returncode == 0 else 1
    except Exception as exc:
        report.update(state="STOPPED_INSPECT_BEFORE_RETRY", error_type=type(exc).__name__)
        save()
        print(json.dumps({"state": report["state"], "error_type": type(exc).__name__}))
        return 1
    finally:
        report["attempts"] = gateway.attempts
        save()
        gateway.shutdown()
        gateway.server_close()
        if firewall:
            subprocess.run(["nft", "delete", "table", "inet", FIREWALL], check=True)

if __name__ == "__main__":
    sys.exit(main())
