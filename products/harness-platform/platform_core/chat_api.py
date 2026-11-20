"""Product HTTP entry point. Every native request uses server-resolved scope."""

import json
import re
from contextlib import asynccontextmanager
from functools import partial

from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import MutableHeaders
from starlette.exceptions import HTTPException
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from .browser_session import browser_routes, browser_token
from .chat_worker import ChatWorker, WorkerError
from .identity import AuthenticationError, ChatUnavailable, IdentityStore
from .web_ui import web_routes


class PrivateResponses:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        async def send_private(message):
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message)["Cache-Control"] = "no-store"
            await send(message)

        await self.app(scope, receive, send_private)


def _token(request, *, allow_cookie=False):
    if allow_cookie and "authorization" not in request.headers and request.cookies:
        return browser_token(request)
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token or len(token) > 256:
        raise AuthenticationError("Authentication required")
    return token


async def _body(request, *keys):
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
    if not isinstance(data, dict) or data.keys() != set(keys):
        raise HTTPException(400, "Unexpected or missing fields")
    return data


def create_app(database_path, chat_directory, *, composition_module=None):
    @asynccontextmanager
    async def lifespan(app):
        with IdentityStore(database_path) as identity:
            app.state.identity = identity
            app.state.worker = ChatWorker(database_path, chat_directory, composition_module)
            try:
                yield
            finally:
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

    async def chats(req):
        identity, token = req.app.state.identity, _token(req, allow_cookie=True)
        if req.method == "POST":
            scope = await run_in_threadpool(identity.create_user_chat, token)
            return JSONResponse({"chatId": scope.chat_id}, status_code=201)
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
            data = await _body(req, "requestId", "text")
            if not isinstance(data["requestId"], str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", data["requestId"]):
                raise HTTPException(400, "Invalid requestId")
            if not isinstance(data["text"], str) or not data["text"].strip() or len(data["text"].encode("utf-8")) > 8192:
                raise HTTPException(400, "Invalid message text")
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
        result = await req.app.state.worker.request(scope, action, **data)
        return JSONResponse(result)

    def error_response(_req, exc):
        if isinstance(exc, AuthenticationError):
            return JSONResponse({"error": "Authentication required"}, status_code=401,
                                headers={"WWW-Authenticate": "Bearer"})
        if isinstance(exc, ChatUnavailable):
            return JSONResponse({"error": "Chat unavailable"}, status_code=404)
        if isinstance(exc, WorkerError):
            statuses = {"invalid_request": 400, "conflict": 409, "unavailable": 404, "busy": 503,
                        "result_too_large": 502, "turn_unconfirmed": 409}
            status = statuses.get(exc.code, 503)
            body = {"error": exc.code if exc.code in statuses else "worker_unavailable"}
            if exc.operation_id is not None:
                body["operationId"] = exc.operation_id
            return JSONResponse(body, status_code=status)
        if isinstance(exc, HTTPException):
            return JSONResponse({"error": exc.detail}, status_code=exc.status_code, headers=exc.headers)
        return JSONResponse({"error": "Invalid input"}, status_code=400)

    return Starlette(lifespan=lifespan, middleware=[Middleware(PrivateResponses)], routes=[
        *browser_routes(),
        *web_routes(),
        Route("/api/login", login, methods=["POST"]),
        Route("/api/logout", logout, methods=["POST"]),
        Route("/api/recover", recover, methods=["POST"]),
        Route("/api/chats", chats, methods=["GET", "POST"]),
        Route("/api/chats/{chat_id}/events", partial(scoped, action="events")),
        Route("/api/chats/{chat_id}/messages", partial(scoped, action="history")),
        Route("/api/chats/{chat_id}/messages", partial(scoped, action="append"), methods=["POST"]),
        Route("/api/chats/{chat_id}/turns", partial(scoped, action="turn"), methods=["POST"]),
        Route("/api/chats/{chat_id}/tools", partial(scoped, action="tools")),
        Route("/api/chats/{chat_id}/tools/{name}", partial(scoped, action="call"), methods=["POST"]),
    ], exception_handlers={cls: error_response for cls in (
        AuthenticationError, ChatUnavailable, WorkerError, HTTPException, ValueError,
    )})
