"""Browser sign-in and a cookie-authenticated transport for the local Harness service."""

from ipaddress import ip_address
from urllib.parse import parse_qsl

from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse, RedirectResponse, Response
from starlette.routing import Route

from .identity import AuthenticationError


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


def _redirect(path):
    return RedirectResponse(path, status_code=303, headers=_PRIVATE_HEADERS)


def _clear_cookie(response, secure):
    response.delete_cookie(_cookie_name(secure), path="/", httponly=True, secure=secure, samesite="strict")


def _set_cookie(response, secure, token):
    response.set_cookie(_cookie_name(secure), token, path="/", secure=secure, httponly=True, samesite="strict")


async def _login(request):
    from .web_ui import page
    secure = _secure(request)
    name = _cookie_name(secure)
    existing = request.cookies.get(name)
    identity = request.app.state.identity
    if request.method in {"GET", "HEAD"}:
        if existing:
            try:
                await run_in_threadpool(identity.validate_session, existing)
            except AuthenticationError:
                response = await page(request, panel="login")
                _clear_cookie(response, secure)
                return response
            return _redirect("/app/")
        return await page(request, panel="login")

    require_browser_origin(request)
    fields = await _form_fields(request, {"login", "password"})
    try:
        token = await run_in_threadpool(identity.login, **fields)
    except AuthenticationError:
        return await page(request, panel="login", error="Не удалось войти. Проверьте логин и пароль.", status=401)
    if existing:
        try:
            await run_in_threadpool(identity.logout, existing)
        except AuthenticationError:
            pass  # A malformed cookie does not prevent a fresh sign-in.
    response = _redirect("/app/")
    clear_guest_cookie(request, response)
    _set_cookie(response, secure, token)
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


async def _change_password(request):
    token = browser_token(request)
    fields = await _form_fields(request, {"current", "password", "confirmation"}, max_bytes=12_288)
    if fields["password"] != fields["confirmation"]:
        return JSONResponse({"error": "Новые пароли не совпадают."}, status_code=400, headers=_PRIVATE_HEADERS)
    try:
        renewed = await run_in_threadpool(request.app.state.identity.change_password, token,
                                           fields["current"], fields["password"])
    except ValueError:
        return JSONResponse({"error": "Пароль должен содержать от 1 до 256 символов."},
                            status_code=400, headers=_PRIVATE_HEADERS)
    if renewed is None:
        return JSONResponse({"error": "Проверьте текущий пароль. Если было несколько попыток, повторите через 5 минут."},
                            status_code=400, headers=_PRIVATE_HEADERS)
    response = JSONResponse({"changed": True}, headers=_PRIVATE_HEADERS)
    _set_cookie(response, _secure(request), renewed)
    return response


async def _session_status(request):
    try:
        await run_in_threadpool(request.app.state.identity.validate_session, browser_token(request))
    except AuthenticationError:
        authenticated = False
    else:
        authenticated = True
    return JSONResponse({"authenticated": authenticated}, headers=_PRIVATE_HEADERS)


async def _navigation_script(_request):
    return Response(_NAVIGATION_JS, media_type="text/javascript", headers=_PRIVATE_HEADERS)


def browser_routes():
    return [
        Route("/login", _login, methods=["GET", "POST"]),
        Route("/logout", _logout, methods=["POST"]),
        Route("/api/session/status", _session_status),
        Route("/api/profile/password", _change_password, methods=["POST"]),
        Route("/session-nav.js", _navigation_script),
    ]
