"""Entry pages for the authenticated browser and its installed UI modules."""

import os
import re
from pathlib import Path

from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException
from starlette.responses import FileResponse, HTMLResponse, RedirectResponse, Response
from starlette.routing import Route

from .browser_session import browser_token
from .identity import AuthenticationError, ChatUnavailable
from .native_ui_entry import browser_entry


_PRODUCT = Path(__file__).resolve().parents[1]
_PROJECT_UI = _PRODUCT / "native" / "web"


async def start(request):
    return RedirectResponse("/app/", status_code=303)


async def page(request):
    identity = request.app.state.identity
    try:
        token = browser_token(request)
        if chat := request.path_params.get("chat_id"):
            await run_in_threadpool(identity.resolve_chat, token, chat)
        else:
            await run_in_threadpool(identity.validate_session, token)
    except AuthenticationError:
        return RedirectResponse("/login", status_code=303)
    except ChatUnavailable:
        return HTMLResponse('<!doctype html><html lang="ru"><title>Чат недоступен</title>'
                            '<main><h1>Чат недоступен</h1><a href="/app/">Мои чаты</a></main></html>',
                            status_code=404)
    return FileResponse(_PROJECT_UI / "index.html", media_type="text/html", headers={
        "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
                                   "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; "
                                   "object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        "Referrer-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
    })


async def project_asset(request):
    name = request.path_params["name"]
    if name not in {"app.js", "style.css", "widgets.js", "trajectory.js", "widget-host.js"}:
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
        Route("/", start), Route("/app/", page), Route("/app/chats/{chat_id}", page),
        Route("/ui-assets/project/{name}", project_asset),
        Route("/ui-assets/harness/{package}/{asset:path}", harness_asset),
    ]
