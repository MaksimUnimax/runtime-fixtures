"""Offer the connected chat agent the applicable catalogue and run its selections."""
from functools import lru_cache
from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from threading import Lock
import time

from ..catalog import Capability

ROOT = Path(__file__).resolve().parents[2]
REPORT_LOCK = Lock()
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
        groups.setdefault(tuple(sorted(row["available_stores"])), []).append((row["id"], card))
    names = {cid: ("Ozon" if provider == "ozon" else "Wildberries") + " " + cid
             for cid, provider, _ in profiles}
    menu = "\n".join("Для " + ", ".join(names[cid] for cid in ids) + ":\n" +
                     "\n".join(card for _, card in cards) for ids, cards in groups.items())
    period = {"type": ["object", "null"], "properties": {key: {"type": "string", "format": "date"}
                                                        for key in ("from", "to")},
              "required": ["from", "to"], "additionalProperties": False}
    inputs = {"type": "object", "properties": {"period": period, "comparison": period,
              "filters": {"type": "object"}, "group_by": {"enum": ["marketplace", "total"]},
              "parameter_periods": {"type": "object", "properties": {
                  "loss_rate": {**period, "type": "object"},
                  "delivery_mean": {**period, "type": "object"},
              }, "additionalProperties": False}, "parameter_mode": {"const": "preview"},
              "owner_inputs": {"type": "object", "properties": {
                  **{key: {"type": ["string", "number"]} for key in ("unit_cost", "tax_amount", "own_cost_amount")},
                  "unit_cost_by_sku": {"type": "object", "propertyNames": {"pattern": "^[1-9][0-9]{0,19}$"},
                                       "additionalProperties": {"type": ["string", "number"]}},
              }, "additionalProperties": False}},
              "additionalProperties": False}
    item = {"type": "object", "properties": {
        "templateId": {"type": "string", "enum": [row["id"] for row in rows]},
        "connectionId": {"type": "string", "enum": [p[0] for p in profiles]}, "input": inputs},
        "required": ["templateId", "connectionId", "input"], "additionalProperties": False}
    if len(groups) > 1:
        item["anyOf"] = [{"properties": {"templateId": {"enum": [tid for tid, _ in cards]},
                                        "connectionId": {"enum": list(ids)}}}
                         for ids, cards in groups.items()]
    schema = {"type": "object", "properties": {
        "selections": {"type": "array", "minItems": 1, "uniqueItems": True, "items": item}},
        "required": ["selections"], "additionalProperties": False}
    return Capability("marketplace_report",
        "Сам выбери шаблоны по смыслу всей беседы. Ответ на уточнение дополняет предыдущий вопрос. "
        "Используй только пары шаблона и магазина из одной группы каталога. Если части отчёта нет, получи остальные для запрошенной площадки. Даты from/to включительно, "
        "для текущего состояния period=null. Обычная группировка marketplace. "
        "Для составляющих формул используй исходные суммы из sourceValues. Округлённый процент не позволяет восстановить точный оборот. "
        "При ограничении частоты матрица ждёт разрешённого времени и автоматически продолжает тот же запрос. "
        "Дождись результата и продолжи выполнение остальных частей без повторной команды продавца. "
        "Для прогноза Ozon используй owner_inputs.unit_cost только при явно одинаковой себестоимости всех товаров. "
        "Если продавец задаёт себестоимость по SKU, передай значения в owner_inputs.unit_cost_by_sku. "
        "Для самостоятельного расчёта коэффициента передай его явно запрошенный интервал в period. "
        "Для прогноза передай период заказов в period, а отдельно указанные интервалы коэффициентов в parameter_periods.loss_rate "
        "и parameter_periods.delivery_mean. Без отдельного интервала матрица возьмёт последние 12 месяцев. "
        "Выводи рассчитанные матрицей значения и следуй guidance выбранного шаблона. "
        "В рекламном отчёте WB сохрани охват кампаний. Итоги по полученным строкам нельзя выдавать за итог всех кампаний. "
        "Если площадка вернула другую ошибку, передай причину из инструмента понятным языком.\n" + menu, schema, run)


def run(scope, arguments):
    # The native MCP process belongs to one turn. Parallel model calls share its
    # grant and working budget, so only one report can change its wait window.
    with REPORT_LOCK:
        return run_report(scope, arguments)


def run_report(scope, arguments):
    raw = os.environ.get("HARNESS_MATRIX_TURN")
    if not raw:
        return {"ok": False, "reason": "Для отчёта нужен авторизованный чат."}
    turn = json.loads(raw)
    deadline = turn["deadline"]
    if turn.get("resumeRateLimits") is True:
        from ..operation_grants import marketplace_deadline
        deadline = marketplace_deadline(Path(turn["databasePath"]).as_uri() + "?mode=ro",
                                       sha256(turn["token"].encode()).hexdigest(), deadline)
    remaining = deadline / 1000 - time.time()
    if remaining <= 0:
        return {"ok": False, "reason": "Время выполнения запроса истекло."}
    items = arguments["selections"]
    packet = {"actor": scope.actor_id, "workspace": scope.workspace_id, "chat": scope.chat_id,
              "connections": sorted({item["connectionId"] for item in items}), "selections": items, "turn": turn}
    try:
        return invoke(packet, None if turn.get("resumeRateLimits") is True else remaining)
    except subprocess.TimeoutExpired:
        return {"ok": False, "reason": "Время выполнения отчёта истекло. Данные не подтверждены."}
