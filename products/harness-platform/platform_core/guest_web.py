"""Public help chat and same-origin self-registration forms."""

import secrets
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


def _html(title, body, status=200):
    return HTMLResponse(f"""<!doctype html><html lang="ru"><head><meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1"><title>{title} · Harness</title>
        <link rel="stylesheet" href="/ui-assets/project/guest.css">{BROWSER_BACK_SCRIPT}</head>
        <body><main><h1>{title}</h1>{body}</main></body></html>""", status_code=status, headers={
            **_PRIVATE_HEADERS, "Content-Security-Policy": "default-src 'self'; script-src 'self'; "
            "object-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
        })


def _registration_form(code, error=None, status=200):
    alert = f'<p role="alert">{escape(error)}</p>' if error else ""
    return _html("Создать аккаунт", f"""{alert}<form method="post" action="/register">
        <label>Логин<input name="login" required maxlength="254" autocomplete="username"></label>
        <label>Пароль<input type="password" name="password" required minlength="15" maxlength="256"
            autocomplete="new-password" aria-describedby="length"></label>
        <small id="length">От 15 до 256 символов.</small>
        <label>Код восстановления<input name="recovery" readonly value="{escape(code, quote=True)}"></label>
        <small>Сохраните этот код сейчас. Он понадобится, если вы забудете пароль.</small>
        <button>Зарегистрироваться и открыть чат</button></form><p><a href="/login">Войти в существующий аккаунт</a></p>""", status)


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


async def guest_page(request, chat):
    token = request.cookies.get(guest_cookie(request))
    try:
        try:
            before = int(request.query_params.get("before", 2**63 - 1))
            if not 0 < before <= 2**63 - 1:
                raise ValueError
        except ValueError:
            raise HTTPException(400, "Invalid history cursor") from None
        history, cursor = await run_in_threadpool(request.app.state.identity.guest_page, token, chat, before)
    except AuthenticationError:
        return _redirect("/login")
    except ChatUnavailable:
        return _html("Чат недоступен", '<a href="/login">Войти</a>', 404)
    turns = "".join(f'<li><strong>Вы</strong><p>{escape(t["text"])}</p>'
                    f'<strong>Справка Harness</strong><p>{escape(t["answer"])}</p></li>' for t in history)
    older = f'<a href="?before={cursor}">Предыдущие сообщения</a>' if cursor else ""
    return _html("Гостевой чат", f"""<p>Что умеет сервис, как зарегистрироваться и сколько стоит доступ? Спросите здесь.</p>
        <nav><a href="/register">Создать аккаунт и сохранить чат</a></nav>
        {older}<ol aria-label="История сообщений">{turns}</ol>
        <form method="post" action="/guest/chats/{chat}/turns">
          <input type="hidden" name="request_id" value="{secrets.token_hex(16)}">
          <label>Сообщение<textarea name="text" required rows="3" maxlength="8192"></textarea></label>
          <button>Отправить</button>
        </form>""")


async def send_turn(request):
    require_browser_origin(request)
    token = request.cookies.get(guest_cookie(request))
    chat = request.path_params["chat"]
    fields = await _form_fields(request, {"text", "request_id"}, max_bytes=32 * 1024)
    try:
        await run_in_threadpool(request.app.state.identity.guest_turn, token, chat, **fields)
    except RegistrationConflict:
        raise HTTPException(409, "Message already submitted with different text") from None
    return _redirect(f"/app/chats/{chat}")


async def register(request):
    cookie = guest_cookie(request)
    token = request.cookies.get(cookie)
    identity = request.app.state.identity
    if request.method == "POST":
        require_browser_origin(request)
    if target := await _account_target(request):
        return _redirect(target)
    if request.method in {"GET", "HEAD"}:
        try:
            code = await run_in_threadpool(identity.guest_recovery, token)
        except AuthenticationError:
            return _html("Создать аккаунт", '<form method="post" action="/register/start"><button>Начать регистрацию</button></form>')
        return _registration_form(code)
    fields = await _form_fields(request, {"login", "password", "recovery"})
    try:
        session, chat = await run_in_threadpool(identity.register, token, **fields)
    except RegistrationConflict:
        return _registration_form(fields["recovery"], "Этот логин уже занят или регистрация завершена. Выберите другой логин или войдите.", 409)
    except AuthenticationError:
        return _html("Войдите или начните заново", '<a href="/login">Ко входу</a>', 401)
    except ValueError:
        return _registration_form(fields["recovery"], "Проверьте логин и длину пароля.", 400)
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
        Route("/guest/chats/{chat}/turns", send_turn, methods=["POST"]),
    ]
