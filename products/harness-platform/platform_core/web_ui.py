"""Entry pages for the authenticated browser and its installed UI modules."""

import os
import re
from pathlib import Path

from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException
from starlette.responses import FileResponse, HTMLResponse, RedirectResponse, Response
from starlette.routing import Route

from .browser_session import browser_token, guest_cookie
from .identity import AuthenticationError, ChatUnavailable
from .native_web import shell, module_file, HEADERS, UI
from .browser_session import _secure
from .guest_registration import GUEST_LIFETIME
from .native_ui_entry import browser_entry


_PRODUCT = Path(__file__).resolve().parents[1]
_PROJECT_UI = _PRODUCT / "native" / "web"


async def page(request, *, panel="", error="", status=200):
    identity = request.app.state.identity
    chat = request.path_params.get("chat_id", "")
    try:
        token = browser_token(request) if request.method in {"GET", "HEAD"} else None
        await run_in_threadpool(identity.validate_session, token)
        if chat:
            await run_in_threadpool(identity.resolve_chat, token, chat)
        return shell(chat=chat, status=status)
    except AuthenticationError:
        pass
    except ChatUnavailable:
        return shell(panel="notice", error="Чат недоступен", status=404)
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

async def admin(request):
    token = browser_token(request)
    if not await run_in_threadpool(request.app.state.identity.is_admin, token):
        raise HTTPException(403, "Administrator required")
    return FileResponse(UI / "admin.html", media_type="text/html", headers=HEADERS)

async def project_asset(request):
    name = request.path_params["name"]
    if name not in {"bootstrap.js", "start.js", "account.js", "account.css", "transport.js", "admin.css", "admin.js"}:
        raise HTTPException(404)
    path = _PROJECT_UI / name
    if not path.is_file():
        raise HTTPException(404)
    return FileResponse(path, headers={"X-Content-Type-Options": "nosniff"})


_CLIENT_MODULES = {
    "dsh-client-modules", "dsh-client-ui-conversation",
    "dsh-client-ui-chat", "dsh-client-ui-trajectory",
}
_FRONTEND_ASSETS = {
    "dist/assets/index-BgUyXZcc.js", "dist/assets/vendor-BUMdD3V7.js",
    "dist/assets/index-lh_YM6sT.css", "dist/assets/vendor-DV2921Zo.css",
}
_FRONTEND_CHUNK = re.compile(r"dist/assets/(?:fonts/[\w.-]+\.woff2|langs/[\w.-]+\.js)")


async def whale(_request):
    from .native_web import modules
    return FileResponse(modules() / "dsh-client-ui-chat/lib/assets/running-whale@2x-06738fa29b2f.png", media_type="image/png")


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
    modules = os.environ.get("HARNESS_NODE_MODULES")
    if not modules or not Path(modules).is_absolute():
        raise HTTPException(503, "Pinned Harness UI installation unavailable")
    file = Path(modules) / "@deepseek-ai" / package / asset
    if not file.is_file():
        raise HTTPException(503, "Pinned Harness UI asset unavailable")
    headers = {"X-Content-Type-Options": "nosniff"}
    if package == "dsh-web-frontend" and asset == "dist/assets/index-BgUyXZcc.js":
        try:
            entry = await run_in_threadpool(browser_entry, file)
        except ValueError:
            raise HTTPException(503, "Unsupported native UI entry build") from None
        return Response(entry, media_type="text/javascript", headers=headers)
    return FileResponse(file, headers=headers)


def web_routes():
    return [
        Route("/plugins/@deepseek-ai/dsh-client-ui-chat/assets/running-whale@2x-06738fa29b2f.png", whale),
        Route("/", page), Route("/admin", admin), Route("/ui-assets/modules/{name}.js", module_file), Route("/app/", page), Route("/app/chats/{chat_id}", page),
        Route("/ui-assets/project/{name}", project_asset),
        Route("/ui-assets/harness/{package}/{asset:path}", harness_asset),
    ]
