"""Serve the pinned native browser client and its product plug-in."""
import json
import os
import re
from functools import lru_cache
from html import escape
from pathlib import Path

from starlette.exceptions import HTTPException
from starlette.responses import HTMLResponse, FileResponse, Response

from .native_ui_entry import browser_entry
from .browser_session import _PRIVATE_HEADERS

UI = Path(__file__).resolve().parents[1] / "native" / "web"
VERSION = "0.2.2-rc.1"
GROUP = "@deepseek-ai/"
ROOTS = ("dsh-client-modules", "dsh-client-ui-chat", "dsh-client-ui-trajectory",
         "dsh-client-ui-brand-official", "dsh-client-ui-tool", "dsh-client-ui-approval",
         "dsh-client-ui-user-questions")
HEADERS = {**_PRIVATE_HEADERS, "Content-Security-Policy":
           "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
           "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; "
           "frame-ancestors 'none'; base-uri 'self'; form-action 'self'"}

def modules():
    path = Path(os.environ.get("HARNESS_NODE_MODULES", ""))
    if not path.is_absolute():
        raise HTTPException(503, "Pinned Harness runtime unavailable")
    return path / GROUP.rstrip("/")

@lru_cache(maxsize=4)
def roster(base):
    entries, files = {}, {}
    def visit(name):
        if name in entries:
            return
        if not re.fullmatch(r'dsh-[a-z0-9-]+', name):
            raise ValueError("Unexpected plugin dependency")
        directory = base / name
        metadata = json.loads((directory / "package.json").read_text())
        if metadata["version"] != VERSION:
            raise ValueError("Unsupported Harness client revision")
        config = metadata.get("dsh", {}).get("client")
        if not isinstance(config, dict):
            return  # Static export supplied by the native frontend kernel.
        path = directory / "lib" / "client.browser.js"
        if not path.is_file():
            path = directory / "lib" / "client.js"
        if not path.is_file():
            raise ValueError("Missing native browser module")
        deps = [dep for dep in config.get("inject", []) if isinstance(dep, str)]
        entry = {"id": GROUP + name, "rev": VERSION, "url": "/ui-assets/modules/" + name + ".js",
                 "inject": deps, "immediately": bool(config.get("immediately"))}
        entries[name], files[name] = entry, path
        for dep in deps:
            if dep.startswith(GROUP):
                visit(dep.removeprefix(GROUP))
    for name in ROOTS:
        visit(name)
    plugin = {"id":"harness-account", "rev":VERSION, "url":"/ui-assets/project/account.js",
              "inject":[GROUP + "dsh-client-ui-workspace", GROUP + "dsh-client-ui-sidebar", GROUP + "dsh-client-ui-trajectory"]}
    rows = [*entries.values(), plugin]
    batches = [{"phase": "bootstrap" if row["id"] == GROUP+"dsh-client-modules" else "application",
                "url":row["url"], "rev":VERSION, "entries":[row["id"]]} for row in rows]
    return {"rev":VERSION, "release":{"version":VERSION}, "entries":rows, "batches":batches}, files

async def module_file(request):
    try:
        manifest, files = roster(modules())
    except (ValueError, OSError, KeyError):
        raise HTTPException(503, "Pinned Harness client unavailable") from None
    name = request.path_params["name"]
    if name == 'manifest':
        return Response('window.__DSH_BOOT__ = ' + json.dumps(manifest) + ';', media_type='text/javascript')
    if name not in files:
        raise HTTPException(404)
    return FileResponse(files[name], media_type='text/javascript')

def shell(*, panel="", error="", recovery="", chat="", guest=False, status=200):
    page = (UI / "index.html").read_text()
    for name, value in {"panel":panel, "error":error, "recovery":recovery, "chat":chat,
                        "mode":"guest" if guest else "member"}.items():
        page = page.replace("@@" + name + "@@", escape(value, quote=True))
    return HTMLResponse(page, status_code=status, headers=HEADERS)
