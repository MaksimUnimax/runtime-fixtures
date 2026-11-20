"""Serve the pinned native browser client and its product plug-in."""
import gzip
import hashlib
import json
import os
import re
from functools import lru_cache
from html import escape
from pathlib import Path

from starlette.exceptions import HTTPException
from starlette.responses import HTMLResponse, FileResponse, Response

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

@lru_cache(maxsize=1)
def application_name():
    digest = hashlib.sha256(VERSION.encode() + (UI / "account.js").read_bytes()).hexdigest()[:16]
    return "application-" + digest


@lru_cache(maxsize=32)
def static_bytes(path, transform=None):
    data = transform(path) if transform else path.read_bytes()
    return encoded(data)


def encoded(data):
    return data, gzip.compress(data, compresslevel=6, mtime=0), hashlib.sha256(data).hexdigest()


def asset_response(request, parts, media, immutable=False):
    raw, compressed, digest = parts
    headers = {"Cache-Control": "public, max-age=31536000, immutable" if immutable else "public, no-cache",
               "ETag": 'W/"' + digest + '"', "Vary": "Accept-Encoding", "X-Content-Type-Options": "nosniff"}
    if headers["ETag"] in request.headers.get("if-none-match", "").split(", "):
        return Response(status_code=304, headers=headers)
    codings = request.headers.get("accept-encoding", "").lower().split(",")
    use_gzip = any(re.fullmatch(r"\s*gzip(?:\s*;\s*q=(?:1(?:\.0*)?|0?\.\d*[1-9]\d*))?\s*", item) for item in codings)
    if use_gzip:
        headers["Content-Encoding"] = "gzip"
    return Response(compressed if use_gzip else raw, media_type=media, headers=headers)


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
    bootstrap = entries["dsh-client-modules"]
    batches = [{"phase":"bootstrap", "url":bootstrap["url"], "rev":VERSION, "entries":[bootstrap["id"]]},
               {"phase":"application", "url":"/ui-assets/modules/" + application_name() + ".js", "rev":VERSION,
                "entries":[row["id"] for row in rows if row is not bootstrap]}]
    return {"rev":VERSION, "release":{"version":VERSION}, "entries":rows, "batches":batches}, files

@lru_cache(maxsize=2)
def application_bundle(base):
    _, files = roster(base)
    paths = [path for name, path in files.items() if name != "dsh-client-modules"]
    return encoded(b"\n;\n".join(path.read_bytes() for path in [*paths, UI / "account.js"]))


async def module_file(request):
    try:
        manifest, files = roster(modules())
    except (ValueError, OSError, KeyError):
        raise HTTPException(503, "Pinned Harness client unavailable") from None
    name = request.path_params["name"]
    if name == application_name():
        return asset_response(request, application_bundle(modules()), 'text/javascript', immutable=True)
    if name == 'manifest':
        return Response('window.__DSH_BOOT__ = ' + json.dumps(manifest) + ';', media_type='text/javascript')
    if name not in files:
        raise HTTPException(404)
    return asset_response(request, static_bytes(files[name]), 'text/javascript')

def shell(*, panel="", error="", recovery="", chat="", guest=False, status=200):
    page = (UI / "index.html").read_text()
    page = page.replace("@@application@@", application_name())
    for name, value in {"panel":panel, "error":error, "recovery":recovery, "chat":chat,
                        "mode":"guest" if guest else "member"}.items():
        page = page.replace("@@" + name + "@@", escape(value, quote=True))
    return HTMLResponse(page, status_code=status, headers=HEADERS)
