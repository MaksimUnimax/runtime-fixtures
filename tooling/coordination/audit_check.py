#!/usr/bin/env python3
"""Bounded current audit view and complete per-record owner report."""
import argparse
import json
from pathlib import Path

CONTROL = Path("/root/octoport-control")
LABELS = {
    "REPEATED_AFTER_FIX": "Повтор после прежней меры",
    "REPEATED_BEFORE_APPLICATION": "Новый случай до применения исправления",
    "CONTINUES": "Прежняя проблема продолжается",
    "NO_NEW_OCCURRENCE": "Нового случая в проверенном объёме не найдено",
    "INSUFFICIENT_EVIDENCE": "Недостаточно данных",
}


def snapshot(root):
    registry = json.loads((root / "controllers/organization/errors.json").read_text())
    states = {}
    for role, rel in [("A", "A.json"), ("B", "B.json"), ("C", "C.json"),
                      ("L1", "controllers/L1/state.json"), ("L2", "controllers/L2/state.json")]:
        value = json.loads((root / rel).read_text())
        states[role] = {key: value.get(key) for key in (
            "updated_at", "status", "head", "task", "current_task", "last_audit")}
    return {
        "registry_revision": registry["revision"], "states": states,
        "records": [{key: item.get(key) for key in (
            "id", "title", "status", "recurrences_after_prior_fix", "last_observed_at")}
            for item in registry["records"]],
    }


def validate(registry, comparison):
    if comparison.get("registry_revision") != registry["revision"]:
        raise ValueError("STALE_REGISTRY: refresh comparison before reporting")
    records = {r["id"]: r for r in registry["records"]}
    rows = comparison.get("records", [])
    ids = [r.get("id") for r in rows]
    if len(ids) != len(set(ids)) or set(ids) != set(records):
        raise ValueError("INCOMPLETE_COMPARISON: exactly one row per registry record required")
    for row in rows:
        record = records[row["id"]]
        if row.get("verdict") not in LABELS:
            raise ValueError("EXPLICIT_RECURRENCE_VERDICT_REQUIRED")
        if row.get("historical_after_fix") != record.get("recurrences_after_prior_fix", 0):
            raise ValueError("RECURRENCE_COUNT_MISMATCH: preserve historical repeats")
        for key in ("previous_measure", "why", "action", "remaining", "evidence"):
            if not isinstance(row.get(key), str) or not row[key].strip():
                raise ValueError("MISSING_EXPLANATION: " + key)
        if not isinstance(row.get("applied_now"), bool):
            raise ValueError("APPLIED_RESULT_REQUIRED")
        if row.get("all_fixed") and record["status"] not in ("EFFECT_VERIFIED", "CLOSED_VERIFIED"):
            raise ValueError("UNPROVEN_CLOSURE")
    return rows


def render(registry, comparison):
    rows = validate(registry, comparison)
    titles = {r["id"]: r["title"] for r in registry["records"]}
    output = [
        "# Организационный аудит — сравнение каждой ошибки",
        "Дата: " + comparison["at"],
        "Сравнение с: " + comparison["since"],
        "Версия общей базы: " + str(registry["revision"]),
        "",
    ]
    for row in rows:
        output += [
            "## " + row["id"] + " — " + titles[row["id"]],
            "**" + LABELS[row["verdict"]] + ".**",
            "Всего известных повторов после прежней меры: " + str(row["historical_after_fix"]) + ".",
            "Прежняя мера: " + row["previous_measure"],
            "Причина текущего результата: " + row["why"],
            "Сделано сейчас: " + row["action"],
            "Применение заявленного действия подтверждено: " + ("да" if row["applied_now"] else "нет"),
            "Осталось: " + row["remaining"],
            "Доказательства: " + row["evidence"],
            "",
        ]
    return "\n".join(output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("snapshot", "report"))
    parser.add_argument("--root", type=Path, default=CONTROL)
    parser.add_argument("--comparison", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.mode == "snapshot":
        print(json.dumps(snapshot(args.root), ensure_ascii=False, indent=2))
        return
    if args.comparison is None or args.output is None:
        parser.error("report requires --comparison and --output")
    registry = json.loads((args.root / "controllers/organization/errors.json").read_text())
    comparison = json.loads(args.comparison.read_text())
    text = render(registry, comparison)
    args.output.write_text(text)
    print(json.dumps({"result": "REPORT_COMPLETE", "record_count": len(registry["records"]),
                      "registry_revision": registry["revision"], "output": str(args.output)}))


if __name__ == "__main__":
    main()

