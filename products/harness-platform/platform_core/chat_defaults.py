"""Service-wide defaults for direct chat turns and their live provider catalogue."""
import asyncio
import os
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse
from starlette.routing import Route

from . import provider_keys, model_choices
from .identity import _principal
from .operation_grants import direct_default


def catalogue_source():
    key = provider_keys.read("deepseek")
    if key:
        return "https://api.deepseek.com/models", {"Authorization": "Bearer " + key}
    relay = os.getenv("HARNESS_PROVIDER_RELAY_URL") or os.getenv("HARNESS_ACCEPTANCE_GATEWAY", "")
    file = os.getenv("HARNESS_PROVIDER_RELAY_KEY_FILE") or os.getenv("HARNESS_ACCEPTANCE_KEY_FILE")
    parsed = urlsplit(relay)
    if (file and parsed.scheme == "http" and parsed.hostname == "127.0.0.1"
            and parsed.path in ("", "/") and not (parsed.username or parsed.password or parsed.query or parsed.fragment)):
        try:
            key = Path(file).read_text().strip()
        except OSError:
            key = ""
        if key:
            return relay.rstrip("/") + "/models", {"Authorization": "Bearer " + key}
    raise HTTPException(503, "Для получения списка нужен настроенный ключ DeepSeek.")


async def available_models(http, gateway):
    if not gateway:
        raise HTTPException(503, "Шлюз моделей сейчас недоступен.")
    url, headers = catalogue_source()
    try:
        provider, gateway_info = await asyncio.gather(
            http.get(url, headers=headers, timeout=8),
            http.get(gateway.rstrip("/") + "/health", timeout=8),
        )
        if provider.status_code in (401, 403):
            raise HTTPException(502, "DeepSeek отклонил доступ к списку моделей. Проверьте ключ.")
        provider.raise_for_status()
        gateway_info.raise_for_status()
        rows, supported = provider.json()["data"], gateway_info.json()["models"]
        if not isinstance(rows, list) or not isinstance(supported, list):
            raise ValueError("Invalid catalogue")
        result = {}
        for row in rows:
            mid = row["id"]
            if mid not in supported:
                continue
            meta = row.get("effort") or {}
            levels = meta.get("supported_levels", ["high"])
            choices = ["off", *(level for level in ("low", "high", "max") if level in levels)]
            default = meta.get("default_level", "high")
            result[mid] = {"id": mid, "name": row.get("name") or mid, "efforts": choices,
                           "defaultEffort": default if default in choices else choices[-1]}
        return result
    except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
        raise HTTPException(502, "Не удалось получить доступные модели. Повторите запрос.") from exc


async def choice_catalog(state, *, refresh=False, direct=True, remote=True):
    models = {}
    notice = ""
    if direct:
        try:
            models = await available_models(state.http,state.worker.gateway)
            for row in models.values():
                row.update(family="DeepSeek",chat=True,free=False,image=False)
        except HTTPException as error:
            notice = str(error.detail)
    router = getattr(state,"model_router",None)
    if remote and router is not None:
        for key,row in (await router.models(refresh=refresh)).items():
            models[key] = {k:v for k,v in row.items() if k not in ("rates","imagePrice")}
        notice = " ".join(filter(None,[notice,router.catalog_message]))
    return models,notice


def routes(get_token, body):
    async def settings(request):
        state = request.app.state
        identity, worker = state.identity, state.worker
        token = get_token(request, allow_cookie=True)
        if not identity.is_admin(token):
            raise HTTPException(403, "Требуются права администратора.")
        if request.url.path.endswith("/chat-models"):
            catalog,notice = await choice_catalog(state,refresh=True)
            if not identity.is_admin(token):
                raise HTTPException(403, "Требуются права администратора.")
            return JSONResponse({"models": list(catalog.values()),"catalogMessage":notice,"catalogAt":getattr(state.model_router,"loaded_at",None)})
        if request.method == "POST":
            fields = await body(request, "model", "effort")
            model, effort = fields["model"], fields["effort"]
            remote = isinstance(model,str) and "/" in model
            catalog,_ = await choice_catalog(state,direct=not remote,remote=remote)
            if not isinstance(model, str) or not catalog.get(model,{}).get("chat") or effort not in catalog[model]["efforts"]:
                raise HTTPException(400, "Эта модель или уровень рассуждения недоступны. Обновите список.")
            with identity._write() as db:
                actor, _ = _principal(db, token)
                if not db.execute("SELECT 1 FROM identity_admins WHERE actor_id=?", (actor,)).fetchone():
                    raise HTTPException(403, "Требуются права администратора.")
                if state.model_router is not None:
                    model_choices.publish(db,model if remote else "direct",effort,catalog[model].get("free",False))
                if not remote:
                    db.execute("""INSERT INTO direct_chat_default VALUES(1,?,?) ON CONFLICT(singleton) DO UPDATE SET
                               model=excluded.model,effort=excluded.effort""",(model,effort))
        else:
            with identity._lock:
                model, effort = direct_default(identity._db, worker.env.get("HARNESS_CHAT_MODEL", "deepseek-flash"))
                if state.model_router is not None:
                    route,chosen,_,_ = model_choices.policy(identity._db)
                    if route != "direct":
                        model,effort=route,chosen
        return JSONResponse({"model": model, "effort": effort})
    return [Route("/api/admin/chat-models", settings), Route("/api/admin/chat-default", settings, methods=["GET", "POST"])]
