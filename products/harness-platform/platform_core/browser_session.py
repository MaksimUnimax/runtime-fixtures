"""Browser sign-in and a cookie-authenticated transport for the local Harness service."""

from ipaddress import ip_address
from urllib.parse import parse_qsl

from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException
from starlette.responses import HTMLResponse, RedirectResponse, Response
from starlette.routing import Route

from .identity import AuthenticationError


BROWSER_BACK_SCRIPT = '<script src="/session-nav.js"></script>'
_NAVIGATION_JS = """
window.addEventListener("pagehide", () => {
  document.documentElement.hidden = true;
});
window.addEventListener("pageshow", event => {
  if (event.persisted) window.location.reload();
});
"""
_PRIVATE_HEADERS = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
}
_LOGIN_HTML = """<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Вход · Harness</title>
<style>
:root { color-scheme: light dark; font: 16px/1.5 "Inter", system-ui, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100dvh; display: grid; place-items: center; background: Canvas; color: CanvasText; }
main { width: min(100%, 24rem); padding: 2rem; }
h1 { font-size: 2rem; line-height: 1.16; margin: 0 0 2rem; }
form { display: grid; gap: 1.2rem; }
label { display: grid; gap: .4rem; }
input,button { font: inherit; width: 100%; border-radius: .45rem; padding: .65rem .8rem; }
input { color: CanvasText; background: Canvas; border: 1px solid GrayText; }
button { margin-top: .3rem; border: 1px solid ButtonText; color: ButtonFace; background: ButtonText;
         cursor: pointer; font-weight: 600; }
:focus-visible { outline: 3px solid Highlight; outline-offset: 2px; }
</style></head><body><main><h1>Вход в Harness</h1>
__ERROR__
<form method="post" action="/login">
<label>Логин<input name="login" autocomplete="username" required maxlength="254" autofocus></label>
<label>Пароль<input name="password" type="password" autocomplete="current-password" required maxlength="256"></label>
<button type="submit">Войти</button></form>
<form method="post" action="/guest/start"><button>Попробовать без регистрации</button></form>
<form method="post" action="/register/start"><button>Создать аккаунт</button></form></main></body></html>"""


def _secure(connection):
    scheme = connection.url.scheme
    if scheme in {"https", "wss"}:
        return True
    host = connection.url.hostname or ""
    if scheme in {"http", "ws"}:
        if host == "localhost":
            return False
        try:
            if ip_address(host).is_loopback:
                return False
        except ValueError:
            pass
    raise HTTPException(403, "HTTPS required for browser sessions")


def _cookie_name(secure):
    return "__Host-harness_session" if secure else "harness_local_session"


def guest_cookie(connection):
    return "__Host-harness_guest" if _secure(connection) else "harness_local_guest"


def clear_guest_cookie(request, response):
    name = guest_cookie(request)
    if name in request.cookies:
        response.delete_cookie(name, path="/", secure=_secure(request), httponly=True, samesite="strict")


def require_browser_origin(connection):
    """Same-origin form, fetch or socket. Browser credentials are ambient."""
    secure = _secure(connection)
    url = connection.url
    port = url.port
    host = url.hostname
    if not host:
        raise HTTPException(403, "Origin required")
    authority = f"[{host}]" if ":" in host else host
    if port is not None and port != (443 if secure else 80):
        authority = f"{authority}:{port}"
    expected = ("https://" if secure else "http://") + authority
    if connection.headers.getlist("origin") != [expected]:
        raise HTTPException(403, "Same-origin request required")


def browser_token(connection) -> str:
    secure = _secure(connection)
    if connection.scope["type"] == "websocket" or connection.method not in {"GET", "HEAD", "OPTIONS"}:
        require_browser_origin(connection)
    token = connection.cookies.get(_cookie_name(secure))
    if not token:
        raise AuthenticationError("Authentication required")
    return token


async def _form_fields(request, keys, max_bytes=8192):
    if request.headers.get("content-type", "").partition(";")[0].strip().lower() != "application/x-www-form-urlencoded":
        raise HTTPException(415, "Expected a URL-encoded form")
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > max_bytes:
            raise HTTPException(413, "Form too large")
        data.extend(chunk)
    try:
        fields = dict(parse_qsl(data.decode("ascii"), keep_blank_values=True, strict_parsing=True,
                                errors="strict", max_num_fields=len(keys)))
    except (UnicodeError, ValueError):
        raise HTTPException(400, "Invalid form") from None
    if fields.keys() != keys:
        raise HTTPException(400, "Invalid form")
    return fields


def _page(*, failed=False):
    warning = '<p role="alert">Не удалось войти. Проверьте логин и пароль.</p>' if failed else ""
    return HTMLResponse(_LOGIN_HTML.replace("__ERROR__", warning), status_code=401 if failed else 200, headers={
        **_PRIVATE_HEADERS,
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    })


def _redirect(path):
    return RedirectResponse(path, status_code=303, headers=_PRIVATE_HEADERS)


def _clear_cookie(response, secure):
    response.delete_cookie(_cookie_name(secure), path="/", httponly=True, secure=secure, samesite="strict")


async def _login(request):
    secure = _secure(request)
    name = _cookie_name(secure)
    existing = request.cookies.get(name)
    identity = request.app.state.identity
    if request.method in {"GET", "HEAD"}:
        if existing:
            try:
                await run_in_threadpool(identity.validate_session, existing)
            except AuthenticationError:
                response = _page()
                _clear_cookie(response, secure)
                return response
            return _redirect("/app/")
        return _page()

    require_browser_origin(request)
    fields = await _form_fields(request, {"login", "password"})
    try:
        token = await run_in_threadpool(identity.login, **fields)
    except AuthenticationError:
        return _page(failed=True)
    if existing:
        try:
            await run_in_threadpool(identity.logout, existing)
        except AuthenticationError:
            pass  # A malformed cookie does not prevent a fresh sign-in.
    response = _redirect("/app/")
    clear_guest_cookie(request, response)
    response.set_cookie(name, token, path="/", secure=secure, httponly=True, samesite="strict")
    return response


async def _logout(request):
    require_browser_origin(request)
    secure = _secure(request)
    try:
        await run_in_threadpool(request.app.state.identity.logout, browser_token(request))
    except AuthenticationError:
        pass
    response = _redirect("/login")
    _clear_cookie(response, secure)
    clear_guest_cookie(request, response)
    return response


async def _navigation_script(_request):
    return Response(_NAVIGATION_JS, media_type="text/javascript", headers=_PRIVATE_HEADERS)


def browser_routes():
    return [
        Route("/login", _login, methods=["GET", "POST"]),
        Route("/logout", _logout, methods=["POST"]),
        Route("/session-nav.js", _navigation_script),
    ]
