"""Public help chat and same-origin self-registration forms."""

from starlette.responses import JSONResponse
from html import escape

from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException
from starlette.responses import HTMLResponse
from starlette.routing import Route

from .browser_session import (
    BROWSER_BACK_SCRIPT, _PRIVATE_HEADERS, _cookie_name, _form_fields, _redirect,
    _secure, browser_token, clear_guest_cookie, guest_cookie, require_browser_origin,
)
from .guest_registration import GUEST_LIFETIME, RegistrationConflict
from .identity import AuthenticationError, ChatUnavailable


async def _account_target(request):
    try:
        token = browser_token(request)
        identity = request.app.state.identity
        await run_in_threadpool(identity.validate_session, token)
        chat = await run_in_threadpool(identity.registered_chat, token)
        return f"/app/chats/{chat}" if chat else "/app/"
    except AuthenticationError:
        return None


async def start(request):
    require_browser_origin(request)
    if target := await _account_target(request):
        return _redirect(target)
    cookie = guest_cookie(request)
    token = request.cookies.get(cookie)
    identity = request.app.state.identity
    try:
        chat = await run_in_threadpool(identity.guest_chat, token)
    except AuthenticationError:
        token, chat = await run_in_threadpool(identity.start_guest)
    response = _redirect("/register" if request.url.path == "/register/start" else f"/app/chats/{chat}")
    response.set_cookie(cookie, token, max_age=GUEST_LIFETIME, path="/", secure=_secure(request),
                        httponly=True, samesite="strict")
    return response


async def guest_events(request):
    try:
        before = int(request.query_params.get("before", 2**63-1))
        if not 0 < before < 2**63:
            raise ValueError
    except ValueError:
        raise HTTPException(400, "Invalid history cursor") from None
    rows, cursor, offset = await run_in_threadpool(request.app.state.identity.guest_window,
        request.cookies.get(guest_cookie(request)), request.path_params["chat"], before)
    return JSONResponse({"turns":rows, "nextBefore":cursor, "offset":offset})

async def send_turn(request):
    require_browser_origin(request)
    token = request.cookies.get(guest_cookie(request))
    chat = request.path_params["chat"]
    fields = await _form_fields(request, {"text", "request_id"}, max_bytes=32 * 1024)
    try:
        await run_in_threadpool(request.app.state.identity.guest_turn, token, chat, **fields)
    except RegistrationConflict:
        raise HTTPException(409, "Message already submitted with different text") from None
    if request.headers.get("accept") == "application/json":
        return JSONResponse({"accepted":True})
    return _redirect(f"/app/chats/{chat}")


async def register(request):
    from .web_ui import page
    cookie = guest_cookie(request)
    token = request.cookies.get(cookie)
    identity = request.app.state.identity
    if request.method == "POST":
        require_browser_origin(request)
    if target := await _account_target(request):
        return _redirect(target)
    if request.method in {"GET", "HEAD"}:
        return await page(request, panel="register")
    fields = await _form_fields(request, {"login", "password", "recovery"})
    try:
        session, chat = await run_in_threadpool(identity.register, token, **fields)
    except RegistrationConflict:
        return await page(request, panel="register", error= "Этот логин уже занят или регистрация завершена. Выберите другой логин или войдите.", status=409)
    except AuthenticationError:
        return await page(request, panel="register", error="Сессия регистрации истекла", status=401)
    except ValueError:
        return await page(request, panel="register", error= "Проверьте логин и длину пароля.", status=400)
    secure = _secure(request)
    response = _redirect(f"/app/chats/{chat}")
    response.set_cookie(_cookie_name(secure), session, path="/", secure=secure, httponly=True, samesite="strict")
    clear_guest_cookie(request, response)
    return response


def guest_routes():
    return [
        Route("/guest/start", start, methods=["POST"]),
        Route("/register/start", start, methods=["POST"]),
        Route("/register", register, methods=["GET", "POST"]),
        Route("/guest/chats/{chat}/events", guest_events),
        Route("/guest/chats/{chat}/turns", send_turn, methods=["POST"]),
    ]
