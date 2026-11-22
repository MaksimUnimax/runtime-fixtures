"""Browser challenges use an HttpOnly cookie, API clients use an opaque challenge ID."""
from html import escape
from functools import partial

from starlette.concurrency import run_in_threadpool
from starlette.responses import HTMLResponse, JSONResponse
from starlette.routing import Route

from .account_access import AccessError, WINDOW
from .browser_session import (_cookie_name, _form_fields, _PRIVATE_HEADERS, _redirect, _secure,
                              _set_cookie, browser_token, clear_guest_cookie, guest_cookie, require_browser_origin)
from .identity import AuthenticationError


def pending_cookie(req):
    return "__Host-octo_verification" if _secure(req) else "octo_local_verification"


def inline(req):
    return "application/json" in req.headers.get("accept", "")


async def browser_result(req, result):
    secure = _secure(req)
    opts = dict(path="/", httponly=True, secure=secure, samesite="strict")
    if "challenge" in result:
        response = (JSONResponse({"next": "/auth/verify"}, status_code=202, headers=_PRIVATE_HEADERS)
                    if inline(req) else _redirect("/auth/verify"))
        response.set_cookie(pending_cookie(req), result["challenge"], max_age=WINDOW, **opts)
        return response
    previous = req.cookies.get(_cookie_name(secure))
    if previous and previous != result["token"]:
        try:
            await run_in_threadpool(req.app.state.identity.logout, previous)
        except AuthenticationError:
            pass
    target = "/app/chats/" + result["chat"] if result.get("chat") else "/app/"
    response = (JSONResponse({"authenticated": True, "next":target}, headers=_PRIVATE_HEADERS)
                if inline(req) else _redirect(target))
    _set_cookie(response, secure, result["token"], result["max_age"])
    response.delete_cookie(pending_cookie(req), **opts)
    clear_guest_cookie(req, response)
    return response


STEPS = {
    "registered": ("Завершите вход", "Аккаунт создан. Введите код из того же письма, чтобы открыть ваш чат.", "Код из письма"),
    "bind": ("Привяжите почту", "Укажите адрес, на который прислать код. Ваши магазины и чаты останутся в этом аккаунте.", "Электронная почта"),
    "email": ("Проверьте почту", "Мы отправили шестизначный код. Введите его в течение 10 минут.", "Код из письма"),
    "setup": ("Подключите приложение", "Откройте приложение-аутентификатор, добавьте ключ вручную и выберите код по времени. Введите полученный код ниже.", "Код из приложения"),
    "totp": ("Подтвердите вход", "Откройте запись Октопорта в приложении-аутентификаторе и введите текущий код.", "Код из приложения"),
}


def step_page(req, result=None, error="", status=200):
    stage = (result or {}).get("stage")
    title, body, label = STEPS.get(stage, ("Начните вход заново", "", ""))
    message = f'<p role="alert">{escape(error)}</p>' if error else ""
    key = (f'<p>Ключ Октопорта</p><code>{escape(result["setup_key"])}</code>' if stage == "setup" else "")
    field = ('type="email" maxlength="254" autocomplete="email"' if stage == "bind" else
             'type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code"')
    form = (f'<form method="post" action="/auth/verify"><label>{label}<input name="value" {field} required autofocus></label>'
            '<button type="submit">Продолжить</button></form>') if stage else ""
    resend = ('<form method="post" action="/auth/resend"><button>Отправить код ещё раз</button></form>' if stage == "email" else "")
    theme = req.cookies.get("octoport_theme")
    theme = theme if theme in ("light","dark") else "system"
    policy = "default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
    tracker = pixel = ""
    # The authenticator setup page displays a private enrollment key.
    if stage != "setup":
        tracker = '<script defer src="/about/assets/yandex-metrika.js?v=114504756"></script>'
        pixel = '<noscript><img hidden src="https://mc.yandex.ru/watch/114504756" width="1" height="1" alt=""></noscript>'
        policy += ("; script-src 'self' https://mc.yandex.ru https://yastatic.net; "
                   "img-src https://mc.yandex.ru; connect-src https://mc.yandex.ru")
    html = f'''<!doctype html><html lang="ru" data-appearance="{theme}"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>{title} · Октопорт</title>
<link rel="stylesheet" href="/about/styles.css">{tracker}
<body class="ym-hide-content">{pixel}
<main class="octo-verification"><section id="public-auth" aria-labelledby="step-title">
<header><h2 id="step-title">{title}</h2></header><p>{body}</p>{key}{message}{form}{resend}
<a href="/login">Вернуться ко входу</a></section></main></body></html>'''
    return HTMLResponse(html, status_code=status,
        headers={**_PRIVATE_HEADERS, "Referrer-Policy":"same-origin", "Content-Security-Policy":policy})


async def verify(req):
    service = req.app.state.account_access
    handle = req.cookies.get(pending_cookie(req))
    try:
        detail = await run_in_threadpool(service.describe, handle)
    except AccessError as error:
        return step_page(req, error=str(error), status=error.status)
    if req.method in ("GET", "HEAD"):
        return step_page(req, detail)
    require_browser_origin(req)
    try:
        if req.url.path == "/auth/resend":
            result = await run_in_threadpool(service.resend, handle)
        else:
            form = await _form_fields(req, {"value"})
            result = await run_in_threadpool(service.advance, handle, form["value"], req.cookies.get(guest_cookie(req)))
    except (AccessError, AuthenticationError) as error:
        return step_page(req, detail, str(error) if isinstance(error,AccessError) else "Начните вход заново.",
                         getattr(error, "status", 401))
    return await browser_result(req, result)


async def api(req, action):
    from .chat_api import _body
    service = req.app.state.account_access
    try:
        if action == "login":
            data = await _body(req, "login", "password", optional={"remember"})
            result = await run_in_threadpool(service.login, **data)
        else:
            data = await _body(req, "challenge", "value")
            result = await run_in_threadpool(service.advance, data["challenge"], data["value"])
    except (AuthenticationError, AccessError) as error:
        return JSONResponse({"detail": str(error) if isinstance(error,AccessError) else "Проверьте логин и пароль."},
                            status_code=getattr(error, "status", 401), headers=_PRIVATE_HEADERS)
    if "challenge" in result:
        return JSONResponse(result, status_code=202, headers=_PRIVATE_HEADERS)
    return JSONResponse({"token":result["token"]}, headers=_PRIVATE_HEADERS)


async def preference(req):
    token = browser_token(req)
    service = req.app.state.account_access
    if req.method == "POST":
        fields = await _form_fields(req, {"current","enabled"})
        if fields["enabled"] not in ("true","false"):
            return JSONResponse({"error":"Проверьте настройку."}, status_code=400)
        try:
            await run_in_threadpool(service.configure, token, fields["current"], fields["enabled"] == "true")
        except (AuthenticationError, AccessError) as error:
            return JSONResponse({"error":str(error) if isinstance(error,AccessError) else "Проверьте текущий пароль."},
                                status_code=getattr(error, "status", 400))
    return JSONResponse(await run_in_threadpool(service.preferences, token), headers=_PRIVATE_HEADERS)


def routes():
    return [
        Route("/auth/verify", verify, methods=["GET", "POST"]),
        Route("/auth/resend", verify, methods=["POST"]),
        Route("/api/login", partial(api, action="login"), methods=["POST"]),
        Route("/api/login/verify", partial(api, action="verify"), methods=["POST"]),
        Route("/api/profile/security", preference, methods=["GET", "POST"]),
    ]
