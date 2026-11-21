"""Product HTTP entry point. Every native request uses server-resolved scope."""

import json
import os
from importlib.util import find_spec
import httpx
import re
from contextlib import AsyncExitStack, ExitStack, asynccontextmanager
from functools import partial
from pathlib import Path
from tempfile import TemporaryDirectory

from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import MutableHeaders
from starlette.exceptions import HTTPException
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from .admin_costs import AdminCosts, present_chat
from .user_plugins import service as user_plugins, illustrations, telegram_routes
from .browser_session import browser_routes, browser_token
from .chat_worker import ChatWorker, WorkerError
from . import integrations, provider_keys, chat_connections, chat_defaults, turn_progress
from .identity import AuthenticationError, ChatUnavailable, _secret_digest
from .operation_grants import DIRECT_DEFAULT_SCHEMA
from .guest_registration import RegistrationStore
from .guest_web import guest_routes
from .web_ui import web_routes


class PrivateResponses:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        async def send_private(message):
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                if scope.get("path", "").startswith("/ui-assets/"):
                    headers.setdefault("Cache-Control", "no-store")
                else:
                    headers["Cache-Control"] = "no-store"
            await send(message)

        await self.app(scope, receive, send_private)


def _token(request, *, allow_cookie=False):
    if allow_cookie and "authorization" not in request.headers and request.cookies:
        return browser_token(request)
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token or len(token) > 256:
        raise AuthenticationError("Authentication required")
    return token


async def _body(request, *keys, optional=()):
    if request.headers.get("content-type", "").split(";", 1)[0].lower() != "application/json":
        raise HTTPException(415, "Expected application/json")
    buf = bytearray()
    async for part in request.stream():
        if len(buf) + len(part) > 64 * 1024:
            raise HTTPException(413, "Request too large")
        buf.extend(part)

    def reject_constant(_value):
        raise ValueError("Non-finite number")

    try:
        data = json.loads(buf, parse_constant=reject_constant)
        # Reject unpaired surrogates (escaped JSON strings can contain them).
        json.dumps(data, ensure_ascii=False, allow_nan=False).encode("utf-8")
    except (ValueError, UnicodeError, RecursionError):
        raise HTTPException(400, "Invalid JSON") from None
    if not isinstance(data, dict) or not set(keys) <= data.keys() <= set(keys) | set(optional):
        raise HTTPException(400, "Unexpected or missing fields")
    return data


def create_app(database_path, chat_directory, *, composition_module=None):
    router_plugin = None
    if os.getenv("HARNESS_OPENROUTER_ENABLED") == "1" and find_spec("platform_core.model_router"):
        from . import model_router as router_plugin

    async def disabled_models(req):
        req.app.state.identity.validate_session(_token(req, allow_cookie=True))
        return JSONResponse({"enabled":False,"model":"direct","models":[]})

    @asynccontextmanager
    async def lifespan(app):
        with ExitStack() as lifecycle:
            # An ephemeral service and its separate native process need the same database.
            shared_path = database_path
            if str(shared_path) == ":memory:":
                directory = lifecycle.enter_context(TemporaryDirectory())
                shared_path = Path(directory) / "platform.sqlite3"
            app.state.identity = lifecycle.enter_context(RegistrationStore(shared_path))
            app.state.progress = turn_progress.Progress()
            app.state.admin_costs = AdminCosts()
            app.state.worker = ChatWorker(shared_path, chat_directory, composition_module)
            if not app.state.worker.gateway:
                with app.state.identity._write() as db:
                    db.execute(DIRECT_DEFAULT_SCHEMA)
            app.state.integrations = integrations.IntegrationStore(app.state.identity)
            app.state.plugins = user_plugins.Service(app.state)
            async with httpx.AsyncClient(timeout=10, trust_env=False, follow_redirects=False,
                    limits=httpx.Limits(max_connections=64,max_keepalive_connections=16)) as http:
                app.state.http = http
                async with AsyncExitStack() as extensions:
                    await extensions.enter_async_context(telegram_routes.activate(app.state))
                    app.state.model_router = await extensions.enter_async_context(
                        router_plugin.activate(app.state.identity,http,app.state.worker)) if router_plugin else None
                    if app.state.model_router:
                        app.state.model_router.progress=app.state.progress
                    try:
                        yield
                    finally:
                        await app.state.plugins.close()
                        await app.state.progress.close()
                        await app.state.worker.close()

    async def login(req):
        data = await _body(req, "login", "password")
        token = await run_in_threadpool(req.app.state.identity.login, data["login"], data["password"])
        return JSONResponse({"token": token})

    async def logout(req):
        await run_in_threadpool(req.app.state.identity.logout, _token(req))
        return Response(status_code=204)

    async def recover(req):
        data = await _body(req, "login", "recovery", "password")
        recovery = await run_in_threadpool(req.app.state.identity.reset_password, **data)
        return JSONResponse({"recovery": recovery})

    async def wallet(req):
        token = _token(req, allow_cookie=True)
        balance_only = req.url.path == "/api/wallet/balance"
        try:
            result = await run_in_threadpool(req.app.state.identity.wallet, token,
                                             account_login=req.path_params.get("login"), balance_only=balance_only)
        except AuthenticationError:
            raise
        except PermissionError:
            raise HTTPException(403, "Administrator required") from None
        except LookupError:
            raise HTTPException(404, "Account unavailable") from None
        if not balance_only:
            result["modelChoice"] = req.app.state.model_router is not None
        return JSONResponse(result)

    async def pricing(req):
        token = _token(req, allow_cookie=True)
        update = req.method == "POST"
        data = await _body(req, "markupPercent") if update else {}
        try:
            result = await run_in_threadpool(req.app.state.identity.pricing, token, data.get("markupPercent"), update=update)
        except AuthenticationError:
            raise
        except PermissionError:
            raise HTTPException(403, "Administrator required") from None
        return JSONResponse(result)

    async def credit(req):
        token = _token(req, allow_cookie=True)
        data = await _body(req, "login", "amount", "requestId", "reason")
        try:
            await run_in_threadpool(req.app.state.identity.grant_coins, data["login"], data["amount"],
                                    data["requestId"], data["reason"], token=token)
        except AuthenticationError:
            raise
        except PermissionError:
            raise HTTPException(403, "Administrator required") from None
        return JSONResponse({"granted": True})

    async def chats(req):
        identity, token = req.app.state.identity, _token(req, allow_cookie=True)
        if req.method == "POST":
            scope = await run_in_threadpool(identity.create_user_chat, token)
            return JSONResponse({"chatId": scope.chat_id}, status_code=201)
        if req.query_params.get("view") == "activity":
            return JSONResponse(await run_in_threadpool(identity.chat_activity, token, req.app.state.worker.journal))
        return JSONResponse(await run_in_threadpool(identity.list_chats, token))

    async def scoped(req: Request, action):
        token = _token(req, allow_cookie=True)
        data = {}
        if action == "call":
            data = await _body(req, "arguments")
            if not isinstance(data["arguments"], dict):
                raise HTTPException(400, "Expected an arguments object")
            data["name"] = req.path_params["name"]
        elif action in {"append", "turn"}:
            data = await _body(req, "requestId", "text", optional=("maxCoins",) if action == "turn" else ())
            if "maxCoins" in data:
                from .coins import parse_amount
                parse_amount(data["maxCoins"])
            if not isinstance(data["requestId"], str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", data["requestId"]):
                raise HTTPException(400, "Invalid requestId")
            if not isinstance(data["text"], str) or not data["text"].strip() or len(data["text"].encode("utf-8")) > 8192:
                raise HTTPException(400, "Invalid message text")
            if integrations.SECRET_TEXT.search(data["text"]):
                raise HTTPException(400, "Введите ключ через Интеграции")
        elif action in {"history", "events"}:
            # Public event pages use immutable revisions so newer turns cannot shift older pages.
            events = action == "events"
            cursor = "before" if events else "offset"
            max_limit = 20 if events else 50
            try:
                limit = int(req.query_params.get("limit", min(max_limit, 30)))
                value = int(req.query_params[cursor]) if cursor in req.query_params else None
            except ValueError:
                raise HTTPException(400, "Invalid history window") from None
            if not 1 <= limit <= max_limit or value is not None and not 0 <= value <= 2**53 - 1:
                raise HTTPException(400, "Invalid history window")
            data = {"limit": limit}
            if value is not None:
                data[cursor] = value
        # Recheck ownership and token lifetime after consuming the request body.
        scope = await run_in_threadpool(
            req.app.state.identity.resolve_chat, token, req.path_params["chat_id"],
        )
        if action == "deleteChat":
            return JSONResponse(await req.app.state.worker.request(scope, action))
        if action in ("turn","tools","call"):
            identity=req.app.state.identity
            with identity._lock:
                data["illustrations"]=bool(req.app.state.model_router and user_plugins.attached(identity._db,scope,illustrations.PLUGIN))
                rows=chat_connections.snapshot(identity._db,scope,describe_saved=(action == "turn"))
            data["connections"]=[r for r in rows if r["attached"]]
            data["availableServices"]=[{"provider":r["provider"], "access":r["access"]}
                                       for r in rows if not r["attached"]]
            if action == "turn":
                data["session_digest"] = _secret_digest(token)
                saved_access = {kind for row in rows for kind in row["access"]}
                data["connectionGuides"] = {
                    kind: steps for kind, steps in integrations.KEY_GUIDES.items()
                    if kind not in saved_access
                }
        if await run_in_threadpool(req.app.state.identity.has_claimed_guest_turns, scope):
            data["claimedGuest"] = True
        turn,owner=(None,False)
        if action=="turn":
            turn,owner=req.app.state.progress.begin(scope,data["requestId"])
            if owner: data["on_progress"]=turn.set
        async def work():
            try:
                result = await req.app.state.worker.request(scope, action, **data)
            except WorkerError as exc:
                if exc.code != "turn_unconfirmed" or exc.operation_id is None:
                    raise
                error = {"error": exc.code, "operationId": exc.operation_id}
                result = await run_in_threadpool(present_chat, req.app.state.identity, req.app.state.admin_costs,
                                                 token, scope, "turn", error)
                return JSONResponse(result, status_code=409)
            finally:
                if owner: req.app.state.progress.finish(scope,data["requestId"],turn)
            if action in {"turn", "history", "events"}:
                result = await run_in_threadpool(present_chat, req.app.state.identity, req.app.state.admin_costs,
                                                 token, scope, action, result)
            return JSONResponse(result)

        if action == "turn" and data.get("session_digest") and req.headers.get("accept") == "application/x-ndjson":
            async def stream_work():
                try:
                    return await work()
                except (AuthenticationError, ChatUnavailable, WorkerError, HTTPException, ValueError) as error:
                    return error_response(req, error)
            return turn_progress.stream_response(req.app.state.progress.run(stream_work()))
        return await work()

    def error_response(_req, exc):
        if isinstance(exc, AuthenticationError):
            return JSONResponse({"error": "Authentication required"}, status_code=401,
                                headers={"WWW-Authenticate": "Bearer"})
        if isinstance(exc, ChatUnavailable):
            return JSONResponse({"error": "Chat unavailable"}, status_code=404)
        if isinstance(exc, WorkerError):
            statuses = {"invalid_request": 400, "chat_busy": 409, "conflict": 409, "unavailable": 404, "busy": 503,
                        "result_too_large": 502, "turn_unconfirmed": 409, "model_wait_cancelled": 409, "payment_required": 402,
                        "provider_key":503,"provider_access":503,"provider_balance":503,
                        "provider_model":503,"provider_connection":503}
            status = statuses.get(exc.code, 503)
            body = {"error": exc.code if exc.code in statuses else "worker_unavailable"}
            return JSONResponse(body, status_code=status)
        if isinstance(exc, HTTPException):
            return JSONResponse({"error": exc.detail}, status_code=exc.status_code, headers=exc.headers)
        return JSONResponse({"error": "Invalid input"}, status_code=400)

    return Starlette(lifespan=lifespan, middleware=[Middleware(PrivateResponses)], routes=[
        *browser_routes(),
        *guest_routes(),
        *web_routes(),
        *turn_progress.routes(_token),
        *chat_connections.routes(_token,_body),
        *telegram_routes.routes(_body),
        *user_plugins.routes(_token,_body),
        *illustrations.routes(_token),
        *integrations.routes(_token, _body),
        *provider_keys.routes(_token, _body),
        *chat_defaults.routes(_token, _body),
        *(router_plugin.routes(_token, _body) if router_plugin else [Route("/api/model-settings",disabled_models,methods=["GET","POST"])]),
        Route("/api/wallet", wallet),
        Route("/api/wallet/balance", wallet),
        Route("/api/admin/accounts/{login}/wallet", wallet),
        Route("/api/admin/coin-pricing", pricing, methods=["GET", "POST"]),
        Route("/api/admin/coin-grants", credit, methods=["POST"]),
        Route("/api/login", login, methods=["POST"]),
        Route("/api/logout", logout, methods=["POST"]),
        Route("/api/recover", recover, methods=["POST"]),
        Route("/api/chats", chats, methods=["GET", "POST"]),
        Route("/api/chats/{chat_id}", partial(scoped, action="deleteChat"), methods=["DELETE"]),
        Route("/api/chats/{chat_id}/events", partial(scoped, action="events")),
        Route("/api/chats/{chat_id}/messages", partial(scoped, action="history")),
        Route("/api/chats/{chat_id}/messages", partial(scoped, action="append"), methods=["POST"]),
        Route("/api/chats/{chat_id}/turns", partial(scoped, action="turn"), methods=["POST"]),
        Route("/api/chats/{chat_id}/tools", partial(scoped, action="tools")),
        Route("/api/chats/{chat_id}/tools/{name}", partial(scoped, action="call"), methods=["POST"]),
    ], exception_handlers={cls: error_response for cls in (
        AuthenticationError, ChatUnavailable, WorkerError, HTTPException, ValueError,
    )})
