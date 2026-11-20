"""Offer the connected chat agent the applicable catalogue and run its selections."""
from functools import lru_cache
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

from ..catalog import Capability

ROOT = Path(__file__).resolve().parents[2]
PROFILE_FIELDS = {"Ozon Seller": ("seller_api_key", "seller_client_id"),
                  "Ozon Performance": ("performance_client_id", "performance_client_secret"),
                  "Wildberries API": ("seller_token",)}


def invoke(packet, timeout):
    env = {k: os.environ[k] for k in ("PATH", "HARNESS_INTEGRATIONS_KEY_FILE") if k in os.environ}
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    with tempfile.TemporaryDirectory(prefix="octoport-report-") as temp:
        packet["workingDirectory"] = temp
        result = subprocess.run([sys.executable, "-m", "platform_core.marketplace_matrix.worker"],
                                cwd=ROOT, env=env, input=json.dumps(packet), text=True,
                                capture_output=True, timeout=timeout, check=True)
    return json.loads(result.stdout)


@lru_cache(maxsize=16)
def catalogue(profiles):
    return invoke({"profiles": profiles}, 15)


def capability(stores):
    profiles = []
    for store in stores:
        if store["provider"] in ("wb", "ozon"):
            fields = tuple(sorted(f for access in store["access"] for f in PROFILE_FIELDS.get(access, ())))
            profiles.append((store["id"], store["provider"], fields))
    if not profiles:
        return None
    rows = catalogue(tuple(profiles))
    if not rows:
        return None
    groups = {}
    for row in rows:
        policy = row["input_policy"]
        card = row["id"] + " — " + row["purpose"]
        card += " [" + policy["time_axis"] + "]"
        if row.get("dataset_output"):
            card += " Поля: " + ", ".join(c["field"] for c in row["dataset_output"]["columns"])
        groups.setdefault(tuple(row["available_stores"]), []).append(card)
    menu = "\n".join("Для подключений " + ", ".join(ids) + ":\n" + "\n".join(cards)
                     for ids, cards in groups.items())
    period = {"type": ["object", "null"], "properties": {key: {"type": "string", "format": "date"}
                                                        for key in ("from", "to")},
              "required": ["from", "to"], "additionalProperties": False}
    inputs = {"type": "object", "properties": {"period": period, "comparison": period,
              "filters": {"type": "object"}, "group_by": {"enum": ["marketplace", "total"]},
              "parameter_periods": {"type": "object"}, "parameter_mode": {"const": "preview"}},
              "additionalProperties": False}
    item = {"type": "object", "properties": {
        "templateId": {"type": "string", "enum": [row["id"] for row in rows]},
        "connectionId": {"type": "string", "enum": [p[0] for p in profiles]}, "input": inputs},
        "required": ["templateId", "connectionId", "input"], "additionalProperties": False}
    schema = {"type": "object", "properties": {
        "selections": {"type": "array", "minItems": 1, "uniqueItems": True, "items": item}},
        "required": ["selections"], "additionalProperties": False}
    return Capability("marketplace_report",
        "Сам выбери шаблоны по смыслу всей беседы. Ответ на уточнение дополняет предыдущий вопрос. "
        "Передай все запрошенные показатели и магазины одним вызовом. Даты from/to включительно, "
        "для текущего состояния period=null. Обычная группировка marketplace. "
        "HTTP 429 — временный лимит. Матрица ждёт и повторяет тот же запрос с учётом Retry-After. "
        "Дождись результата и продолжи выполнение остальных выбранных шаблонов без вопроса пользователю. "
        "Если время текущего запроса исчерпано, укажи полученный retryAt; не запускай вызов раньше этого срока.\n" + menu, schema, run)


def run(scope, arguments):
    raw = os.environ.get("HARNESS_MATRIX_TURN")
    if not raw:
        return {"ok": False, "reason": "Для отчёта нужен авторизованный чат."}
    turn = json.loads(raw)
    remaining = turn["deadline"] / 1000 - time.time()
    if remaining <= 0:
        return {"ok": False, "reason": "Время выполнения запроса истекло."}
    items = arguments["selections"]
    packet = {"actor": scope.actor_id, "workspace": scope.workspace_id, "chat": scope.chat_id,
              "connections": sorted({item["connectionId"] for item in items}), "selections": items, "turn": turn}
    try:
        return invoke(packet, remaining)
    except subprocess.TimeoutExpired:
        return {"ok": False, "reason": "Время выполнения отчёта истекло. Данные не подтверждены."}
