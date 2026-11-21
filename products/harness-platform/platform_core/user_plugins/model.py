"""Select report templates through the metered gateway used by Octoport."""
from contextlib import asynccontextmanager
import asyncio
import json
import logging
import time
from hashlib import sha256

from ..operation_grants import PaidAccessRequired, issue_grant, revoke_grant, renew_marketplace_grant
from ..marketplace_matrix.wb_coefficients import DataError
from .store import adapter


@asynccontextmanager
async def choose_templates(state, scope, token_digest, run, metric, preference, guard, plugin):
    worker = state.worker
    if not worker.gateway:
        raise DataError("Шлюз внутренней модели недоступен.")
    guard()
    router = getattr(state, "model_router", None)
    override = tuple(preference) if preference else None
    routed = bool(override and "/" in override[0])
    if routed and not router:
        raise DataError("OpenRouter недоступен для выбранной модели.")
    bind = None
    if router and (not override or routed):
        if routed or router.uses_router(scope.workspace_id):
            await router.models()
            guard()
        if routed:
            def bind(db, selected_scope, operation):
                row = db.execute("SELECT model,effort,free FROM plugin_action_models WHERE workspace=? AND plugin=? AND action='calculate'",
                                 (selected_scope.workspace_id, plugin.id)).fetchone()
                if not row or tuple(row[:2]) != override:
                    raise DataError("Настройки модели изменились. Запустите расчёт снова.")
                return router.bind(db, selected_scope, operation, override=tuple(row))
        else:
            bind = router.bind
    try:
        grant = issue_grant(worker.database_path, scope, source="chat.turn", run_key="plugin."+run,
            direct_fallback=worker.env["HARNESS_CHAT_MODEL"], session_digest=token_digest,
            direct_override=override if not routed else None, bind_model=bind)
    except PaidAccessRequired:
        raise DataError("Для расчёта внутренней моделью нужен оплаченный доступ и доступный баланс.") from None
    try:
        metric_spec=adapter(plugin).METRICS[metric]
        template_id = metric_spec[2][0] if plugin.provider=="ozon" else "wb.coefficient."+metric
        schema = {"type":"object","properties":{"templateId":{"type":"string","enum":[template_id]}},
                  "required":["templateId"],"additionalProperties":False}
        text = ("Владелец магазина нажал «Рассчитать» для показателя «"+metric_spec[0]+
                "». Вызови run_matrix_template с доступным идентификатором "+template_id+
                ". Шаблон сам запрашивает все обязательные отчёты "+plugin.title+" по выбранному периоду и артикулу.")
        payload = {"model":grant.direct_model,"max_tokens":2048,"messages":[{"role":"user","content":text}],
                   "tools":[{"name":"run_matrix_template","description":"Исполнить выбранный продавцом шаблон общей матрицы.",
                             "input_schema":schema}]}
        url = worker.gateway.rstrip("/") + "/v1/messages"
        headers = {"x-api-key": grant.token}
        if grant.model:
            url = worker.env["HARNESS_ROUTER_LOCAL"] + "/complete"
            headers = {"x-operation": grant.token}
            tool = {"name": "run_matrix_template", "description": payload["tools"][0]["description"], "parameters": schema}
            payload = {"messages": payload["messages"], "tools": [{"type": "function", "function": tool}]}
        elif grant.effort == "off":
            payload["thinking"] = {"type":"disabled"}
        else:
            payload.update(thinking={"type":"enabled"},output_config={"effort":grant.effort})
        while True:
            guard()
            response = await state.http.post(url, headers=headers, json=payload, timeout=None if grant.model else 90)
            if response.status_code != 429:
                break
            if not renew_marketplace_grant(worker.database_path,sha256(grant.token.encode()).hexdigest(),int(time.time())):
                raise DataError("Сеанс расчёта завершён. Откройте плагин снова.")
            await asyncio.sleep(5)
        if response.status_code == 402:
            raise DataError("Недостаточно монет для работы внутренней модели.")
        if not response.is_success:
            logging.getLogger(__name__).warning("Plugin model selection failed plugin=%s status=%d",plugin.id,response.status_code)
            if response.status_code in (502,503,504):
                raise DataError("Сервис модели временно недоступен. Повторите расчёт позже.")
            raise DataError("Внутренняя модель не завершила выбор источников. Сохранённые значения доступны.")
        result = response.json()
        if grant.model:
            calls = (result.get("message") or {}).get("tool_calls") or []
            choices = [json.loads(call["function"]["arguments"]) for call in calls
                       if call.get("type") == "function" and call["function"].get("name") == "run_matrix_template"]
        else:
            choices = [b.get("input") for b in result["content"]
                       if b.get("type") == "tool_use" and b.get("name") == "run_matrix_template"]
        if choices != [{"templateId": template_id}]:
            raise DataError("Модель не подтвердила вызов выбранного шаблона.")
        yield grant, metric_spec[2]
    finally:
        revoke_grant(worker.database_path, grant.token)
