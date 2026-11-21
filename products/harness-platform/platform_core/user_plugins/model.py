"""Select report templates through the metered gateway used by Octoport."""
import asyncio
import time
from hashlib import sha256

from ..operation_grants import PaidAccessRequired, issue_grant, revoke_grant, renew_marketplace_grant
from ..marketplace_matrix.wb_coefficients import METRICS, DataError


async def choose_templates(state, scope, token_digest, run, metric, preference, guard):
    worker = state.worker
    if not worker.gateway:
        raise DataError("Шлюз внутренней модели недоступен.")
    guard()
    try:
        grant = issue_grant(worker.database_path, scope, source="chat.turn", run_key="plugin."+run,
            direct_fallback=worker.env["HARNESS_CHAT_MODEL"], session_digest=token_digest,
            direct_override=preference)
    except PaidAccessRequired:
        raise DataError("Для расчёта внутренней моделью нужен оплаченный доступ и доступный баланс.") from None
    try:
        template_id = "wb.coefficient."+metric
        schema = {"type":"object","properties":{"templateId":{"type":"string","enum":[template_id]}},
                  "required":["templateId"],"additionalProperties":False}
        text = ("Владелец магазина нажал «Рассчитать» для показателя «"+METRICS[metric][0]+
                "». Вызови run_matrix_template с доступным идентификатором "+template_id+
                ". Шаблон сам запрашивает все обязательные отчёты WB по выбранному периоду и артикулу.")
        payload = {"model":grant.direct_model,"max_tokens":2048,"messages":[{"role":"user","content":text}],
                   "tools":[{"name":"run_matrix_template","description":"Исполнить выбранный продавцом шаблон общей матрицы.",
                             "input_schema":schema}]}
        if grant.effort == "off":
            payload["thinking"] = {"type":"disabled"}
        else:
            payload.update(thinking={"type":"enabled"},output_config={"effort":grant.effort})
        while True:
            guard()
            response = await state.http.post(worker.gateway.rstrip("/")+"/v1/messages",
                headers={"x-api-key":grant.token}, json=payload, timeout=90)
            if response.status_code != 429:
                break
            if not renew_marketplace_grant(worker.database_path,sha256(grant.token.encode()).hexdigest(),int(time.time())):
                raise DataError("Сеанс расчёта завершён. Откройте плагин снова.")
            await asyncio.sleep(5)
        if response.status_code == 402:
            raise DataError("Недостаточно монет для работы внутренней модели.")
        if not response.is_success:
            raise DataError("Внутренняя модель не завершила выбор источников. Сохранённые значения доступны.")
        blocks = [b for b in response.json()["content"] if b.get("type") == "tool_use" and b.get("name") == "run_matrix_template"]
        if len(blocks) != 1 or blocks[0].get("input") != {"templateId":template_id}:
            raise DataError("Модель не подтвердила вызов выбранного шаблона.")
        return grant.direct_model, METRICS[metric][2]
    finally:
        revoke_grant(worker.database_path, grant.token)
