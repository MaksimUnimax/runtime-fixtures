"""Entry pages for the authenticated browser and its installed UI modules."""

import os
import re
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from string import Template

from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException
from starlette.responses import FileResponse, HTMLResponse, Response
from starlette.routing import Route

from . import coins
from .browser_session import _secure, browser_token, guest_cookie
from .identity import AuthenticationError, ChatUnavailable
from .native_web import shell, module_file, HEADERS, UI, static_bytes, asset_response, client_source
from .guest_registration import GUEST_LIFETIME
from .native_ui_entry import browser_entry


_PRODUCT = Path(__file__).resolve().parents[1]
_PROJECT_UI = _PRODUCT / "native" / "web"


async def page(request, *, panel="", error="", status=200):
    identity = request.app.state.identity
    chat = request.path_params.get("chat_id", "")
    try:
        token = browser_token(request) if request.method in {"GET", "HEAD"} else None
        activity = await run_in_threadpool(identity.chat_activity, token, request.app.state.worker.journal)
        router = request.app.state.model_router
        account = {"chats": list(activity), "activity": activity, "canGrant": await run_in_threadpool(identity.is_admin, token),
                   "modelChoice": router is not None and router.available()}
        if chat:
            await run_in_threadpool(identity.resolve_chat, token, chat)
        return shell(chat=chat, account=account, status=status)
    except ChatUnavailable:
        return shell(panel="notice", error="Чат недоступен", account=account, status=404)
    except AuthenticationError:
        pass
    cookie = guest_cookie(request)
    guest = request.cookies.get(cookie)
    try:
        own_chat = await run_in_threadpool(identity.guest_chat, guest)
    except AuthenticationError:
        if chat:
            return shell(guest=True, panel="login", error="Чат недоступен", status=404)
        guest, own_chat = await run_in_threadpool(identity.start_guest)
    if chat and chat != own_chat:
        return shell(guest=True, panel="notice", chat=own_chat, error="Чат недоступен", status=404)
    recovery = await run_in_threadpool(identity.guest_recovery, guest) if panel == "register" else ""
    response = shell(guest=True, chat=own_chat, panel=panel, recovery=recovery, error=error, status=status)
    response.set_cookie(cookie, guest, path="/", max_age=GUEST_LIFETIME, secure=_secure(request),
                        httponly=True, samesite="strict")
    return response

async def payment(request):
    rate = Decimal(await run_in_threadpool(request.app.state.identity.public_coin_price))
    quantity = request.query_params.get("coins", "100")
    limit = coins.MAX_BALANCE // coins.UNIT
    valid = bool(re.fullmatch(r"[1-9][0-9]{0,6}", quantity)) and int(quantity) <= limit
    if valid:
        total = (rate * int(quantity)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        result = f"{total:,.2f} ₽".replace(",", " ").replace(".", ",")
        error = ""
    else:
        quantity, result = "", "—"
        error = f'<p role="alert">Введите целое число монет от 1 до {limit:,}.</p>'.replace(",", " ")
    template = Template((UI / "payment.html").read_text())
    return HTMLResponse(template.substitute(price=format(rate, "f").replace(".", ","), coins=quantity,
                                           maximum=limit, total=result, error=error),
                        status_code=200 if valid else 400, headers=HEADERS)


async def admin(request):
    token = browser_token(request)
    if not await run_in_threadpool(request.app.state.identity.is_admin, token):
        raise HTTPException(403, "Administrator required")
    return FileResponse(UI / "admin.html", media_type="text/html", headers=HEADERS)

async def icon(_request):
    return FileResponse(UI / "octoport-icon.png", media_type="image/png")


async def project_asset(request):
    name = request.path_params["name"]
    if name == "octoport-wordmark.svg":
        return asset_response(request, static_bytes(UI / name), "image/svg+xml")
    if name in {"octoport-mark.png", "octoport-icon.png"}:
        return FileResponse(UI / name, media_type="image/png")
    if name not in {"bootstrap.js", "start.js", "connections.js","private-input.js", "account.js", "account.css", "appearance.css", "transport.js","live-turn.js", "admin.css", "admin.js"}:
        raise HTTPException(404)
    path = _PROJECT_UI / name
    if not path.is_file():
        raise HTTPException(404)
    return asset_response(request, static_bytes(path), "text/css" if name.endswith(".css") else "text/javascript")


_CLIENT_MODULES = {
    "dsh-client-modules", "dsh-client-ui-conversation",
    "dsh-client-ui-chat",
}
_FRONTEND_ASSETS = {
    "dist/assets/index-BgUyXZcc.js", "dist/assets/vendor-BUMdD3V7.js",
    "dist/assets/index-lh_YM6sT.css", "dist/assets/vendor-DV2921Zo.css",
}
_FRONTEND_CHUNK = re.compile(r"dist/assets/(?:fonts/[\w.-]+\.woff2|langs/[\w.-]+\.js)")


async def harness_asset(request):
    package = request.path_params["package"]
    asset = request.path_params["asset"]
    allowed = (
        (package in _CLIENT_MODULES and asset == "lib/client.js")
        or (package == "dsh-client-ui-chat" and asset == "lib/assets/running-whale@2x-06738fa29b2f.png")
        or (package == "dsh-web-frontend" and (asset in _FRONTEND_ASSETS or _FRONTEND_CHUNK.fullmatch(asset)))
    )
    if not allowed:
        raise HTTPException(404)
    if asset.endswith("running-whale@2x-06738fa29b2f.png"):
        return FileResponse(UI / "octoport-mark.png", media_type="image/png")
    modules = os.environ.get("HARNESS_NODE_MODULES")
    if not modules or not Path(modules).is_absolute():
        raise HTTPException(503, "Pinned Harness UI installation unavailable")
    file = Path(modules) / "@deepseek-ai" / package / asset
    if not file.is_file():
        raise HTTPException(503, "Pinned Harness UI asset unavailable")
    if asset == "lib/client.js":
        return asset_response(request, static_bytes(file, client_source), "text/javascript")
    if package == "dsh-web-frontend" and asset.endswith((".js", ".css")):
        transform = browser_entry if asset == "dist/assets/index-BgUyXZcc.js" else None
        try:
            parts = await run_in_threadpool(static_bytes, file, transform)
        except ValueError:
            raise HTTPException(503, "Unsupported native UI entry build") from None
        return asset_response(request, parts, "text/css" if asset.endswith(".css") else "text/javascript",
                              immutable="/langs/" not in asset)
    return FileResponse(file, headers={"X-Content-Type-Options":"nosniff"})


def web_routes():
    return [
        Route("/favicon.ico", icon),
        Route("/plugins/@deepseek-ai/dsh-client-ui-chat/assets/running-whale@2x-06738fa29b2f.png", icon),
        Route("/", page), Route("/payment", payment), Route("/admin", admin), Route("/ui-assets/modules/{name}.js", module_file), Route("/app/", page), Route("/app/chats/{chat_id}", page),
        Route("/ui-assets/project/{name}", project_asset),
        Route("/ui-assets/harness/{package}/{asset:path}", harness_asset),
    ]
