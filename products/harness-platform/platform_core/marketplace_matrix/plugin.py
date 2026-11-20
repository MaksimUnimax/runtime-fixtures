"""Marketplace reads are available wherever the account grants a store to a chat."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import tempfile

from ..catalog import Capability

ROOT = Path(__file__).resolve().parents[2]


def capability(stores):
    ids = [store["id"] for store in stores if store["provider"] in {"ozon", "wb"}]
    if not ids:
        return None
    schema = {
        "type": "object",
        "properties": {"connectionIds": {"type": "array", "minItems": 1, "uniqueItems": True,
                                         "items": {"type": "string", "enum": ids}}},
        "required": ["connectionIds"], "additionalProperties": False,
    }
    return Capability("marketplace_report",
                      "Получить данные подключённых магазинов по исходному вопросу пользователя. "
                      "Селектор подберёт шаблоны из каталога. Укажи магазины, к которым относится вопрос.",
                      schema, run)


def run(scope, arguments):
    raw = os.environ.get("HARNESS_MATRIX_TURN")
    if not raw:
        return {"ok": False, "reason": "Для отчёта нужен вопрос в авторизованном чате."}
    turn = json.loads(raw)
    remaining = turn["deadline"] / 1000 - time.time()
    if remaining <= 0:
        return {"ok": False, "reason": "Время выполнения запроса истекло."}
    packet = {"actor": scope.actor_id, "workspace": scope.workspace_id, "chat": scope.chat_id,
              "connections": arguments["connectionIds"], "turn": turn}
    env = {k: os.environ[k] for k in ("PATH", "HARNESS_INTEGRATIONS_KEY_FILE") if k in os.environ}
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    try:
        with tempfile.TemporaryDirectory(prefix="octoport-report-") as temp:
            packet["workingDirectory"] = temp
            result = subprocess.run([sys.executable, "-m", "platform_core.marketplace_matrix.worker"],
                                cwd=ROOT, env=env, input=json.dumps(packet), text=True,
                                capture_output=True, timeout=remaining, check=True)
        return json.loads(result.stdout)
    except subprocess.TimeoutExpired:
        return {"ok": False, "reason": "Время выполнения отчёта истекло. Данные не подтверждены."}
