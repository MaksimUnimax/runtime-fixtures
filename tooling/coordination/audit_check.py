#!/usr/bin/env python3
"""Bounded current audit view and complete per-record owner report."""
import argparse
from datetime import datetime
import math
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


def review_clock_issues(root):
    """Read-only check: a recorded review must update the operative timer too."""
    issues = {}
    for role in ("A", "B", "C"):
        try:
            state = json.loads((root / (role + ".json")).read_text())
            closed = state.get("last_closed_controller_review") or {}
            if not isinstance(closed, dict):
                raise ValueError("INVALID_REVIEW_MARKER")
            values = [state.get("controller_reviewed_at"), closed.get("at")]
            timestamps = []
            for value in values:
                if value is None:
                    continue
                parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    raise ValueError("REVIEW_TIME_WITHOUT_TIMEZONE")
                timestamps.append(parsed.timestamp())
            if not timestamps:
                continue
            clock = state.get("review_clock")
            if isinstance(clock, bool) or not isinstance(clock, (int, float)) or not math.isfinite(clock):
                raise ValueError("INVALID_REVIEW_CLOCK")
            # Timestamp serializations made in the same completion may differ slightly.
            if clock < max(timestamps) - 1:
                issues[role] = "COMPLETED_REVIEW_DID_NOT_RESET_CLOCK"
        except (OSError, ValueError, TypeError, AttributeError):
            issues[role] = "REVIEW_STATE_UNVERIFIED"
    return issues


def check_review_clock_holds(root, comparison):
    """An unresolved issue must be explicit, never silently called complete."""
    issues = review_clock_issues(root)
    holds = comparison.get("review_clock_holds", {})
    if not isinstance(holds, dict) or set(holds) != set(issues):
        raise ValueError("REVIEW_CLOCK_NOT_RECONCILED: " + ",".join(sorted(issues)))
    for role, why in holds.items():
        if not isinstance(why, str) or not why.strip():
            raise ValueError("REVIEW_CLOCK_HOLD_REASON_REQUIRED: " + role)
    return issues


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
    issues = check_review_clock_holds(args.root, comparison)
    text = render(registry, comparison)
    if issues:
        text += "\n\n## Незавершённая сверка контроля\n" + "\n".join(
            role + ": " + comparison["review_clock_holds"][role] for role in sorted(issues)
        )
    args.output.write_text(text)
    print(json.dumps({"result": "REPORT_COMPLETE_WITH_REVIEW_HOLDS" if issues else "REPORT_COMPLETE",
                      "review_clock_issues": issues, "record_count": len(registry["records"]),
                      "registry_revision": registry["revision"], "output": str(args.output)}))


if __name__ == "__main__":
    main()
