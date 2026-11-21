"""Serve the pinned native browser client and its product plug-in."""
import base64
import gzip
import hashlib
import json
import os
import re
import zipfile
from functools import lru_cache
from html import escape
from pathlib import Path

from starlette.exceptions import HTTPException
from starlette.responses import HTMLResponse, FileResponse, Response

from starlette.concurrency import run_in_threadpool

from .browser_session import _PRIVATE_HEADERS
from .retained_assets import application_bytes, retained_source

UI = Path(__file__).resolve().parents[1] / "native" / "web"
VERSION = "0.2.2-rc.1"
GROUP = "@deepseek-ai/"
ROOTS = ("dsh-client-modules", "dsh-client-ui-chat",
         "dsh-client-ui-tool", "dsh-client-ui-approval", "dsh-client-ui-attachment",
         "dsh-client-ui-user-questions", "dsh-client-ui-settings-general")
HEADERS = {**_PRIVATE_HEADERS, "Content-Security-Policy":
           "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
           "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; "
           "frame-ancestors 'none'; base-uri 'self'; form-action 'self'"}

@lru_cache(maxsize=1)
def application_name():
    return "application-" + application_bundle()[2][:20]


@lru_cache(maxsize=2)
def core_assets(group="core"):
    with zipfile.ZipFile(UI / f"chat-{group}.pack") as archive:
        return (archive.read("sha256").decode("ascii"), archive.read("core.js.gz"), archive.read("core.js.br"))


def core_name(group="core"):
    return group + "-" + core_assets(group)[0][:20]


@lru_cache(maxsize=32)
def static_bytes(path, transform=None):
    data = transform(path) if transform else path.read_bytes()
    return encoded(data)


def replace_ui(source, old, new):
    if source.count(old) != 1:
        raise ValueError("Unsupported Harness UI revision: " + old[:64].decode())
    return source.replace(old, new, 1)


def workspace_sidebar(source):
    """Expose the sidebar extension directly after the native chat list."""
    patches = (
        (b'name: "sidebar.workspaces",\n\t\t\t\tchildren: {',
         b'name: "sidebar.workspaces",\n\t\t\t\tchildren: {\n'
         b'\t\t\t\t\t"sidebar.workspaces.afterList": { kind: "single", scope: "root" },'),
        (b'className: WorkspaceBrowser_module_css_default.listArea,\n\t\t\t\t\t\tchildren: wide &&',
         b'className: clsx(WorkspaceBrowser_module_css_default.listArea, "octo-workspace-list"),\n'
         b'\t\t\t\t\t\tchildren: [wide &&'),
        (b'}))\n\t\t\t\t\t}),\n\t\t\t\t\tworkspaceActionRequest !== null',
         b'})), renderSlot("sidebar.workspaces.afterList", { wide })]\n'
         b'\t\t\t\t\t}),\n\t\t\t\t\tworkspaceActionRequest !== null'),
        # The product exposes one personal workspace. Use the native flat list, including
        # its search, ordering and session actions, when no grouping choice exists.
        (b"const groupBy = useStore((s) => s.groupBy);",
         b"const groupBy = useStore((s) => workspaces.length > 1 ? s.groupBy : 'flat');"),
        (b"onGroupPick: actions.setGroupBy,",
         b"onGroupPick: workspaces.length > 1 ? actions.setGroupBy : undefined,"),
        (b'items: [\n\t\t\t\t\t{\n\t\t\t\t\t\ttype: "label",\n\t\t\t\t\t\tid: "group-by",',
         b'items: [...(onGroupPick ? [{type:"label", id:"group-by",'),
        (b'id: "order-by-separator"\n\t\t\t\t\t},',
         b'id: "order-by-separator"}] : []),'),
        # Starting a new conversation must allocate its own ID and plugin scope, even if
        # the current conversation has no messages. Restoring a blank keeps its saved ID.
        (b'const blank = sessions.ids.find((id) => {',
         b'const blank = options.fresh ? void 0 : sessions.ids.find((id) => {'),
        (b'} : void 0, agentPreset === void 0 ? {} : { agentPreset }).catch((reason) => {',
         b'} : void 0, { fresh: true, agentPreset }).catch((reason) => {'),
        # Owned chats persist even when the user connects a plugin before the first message.
        (b'if (session.blank && session.id !== current) return false;',
         b'if (session.blank && session.id !== current && !window.harnessAccount?.hasChat(session.id)) return false;'),
        # An authenticated empty chat is already stored and can receive plugin attachments.
        (b'const showStatus = primaryStatus.state !== "idle";\n\t\t\tconst renamable',
         b'const showStatus = primaryStatus.state !== "idle";'
         b"\n\t\t\tconst canOpenActions = !row.blank || (window.harnessAccount?.hasChat(node.id)"
         b" && !window.harnessAccount.guest);\n\t\t\tconst renamable"),
        (b"...getTriggerProps(row.blank ? void 0 : {",
         b"...getTriggerProps(!canOpenActions ? void 0 : {"),
        (b'!row.blank && (0, react_jsx_runtime.jsxs)("span", {\n'
         b'\t\t\t\t\t\t\tclassName: Rows_module_css_default.rowActions,',
         b'canOpenActions && (0, react_jsx_runtime.jsxs)("span", {\n'
         b'\t\t\t\t\t\t\tclassName: Rows_module_css_default.rowActions,'),
        # The native preview supports disabling independently of the row and its actions.
        (b'disabled: menuOpen || drag?.active === true,\n\t\t\t\tcopyText: row.blank',
         b'disabled: true,\n\t\t\t\tcopyText: row.blank'),
    )
    for old, new in patches:
        source = replace_ui(source, old, new)
    return source


def client_source(path):
    source = path.read_bytes()
    package = path.parent.parent.name
    if package.startswith("dsh-client-ui-"):
        source = source.replace(b"DeepSeek Harness", b"octoport")
    if package == "dsh-client-ui-workspace":
        source = workspace_sidebar(source)
        # Resolve the authenticated deep link before native recent-session restoration.
        signature = b"async restoreSelection(workspaces, sessions) {"
        source = source.replace(signature, signature +
            b" const targetId=window.harnessAccount?.selected;"
            b" if (targetId && sessions.byId[targetId]) {"
            b" this.replaceMain(targetId, this.lifetime.signal, 'preserve'); return; }", 1)
        # Empty conversations have no last-message time.
        for name in (b"timeLabel", b"hoverTimeLabel"):
            signature = b"function " + name + b"(updatedAt, now, t) {"
            source = source.replace(signature, signature + b' if (!updatedAt) return "";', 1)
    if package == "dsh-client-ui-shortcuts":
        source = re.sub(rb"\bHarness\b", b"octoport", source)
    if package == "dsh-client-ui-conversation":
        # Keep the picker for installations with multiple workspaces and for initial selection.
        source = replace_ui(source, b'(0, react_jsx_runtime.jsx)(WorkspaceChip, {',
                            b'workspaces.items.length !== 1 && (0, react_jsx_runtime.jsx)(WorkspaceChip, {')
        # The pinned HeroShell has a mark slot but no headline or badge slot.
        title_group = (
            rb'children: \[\(0, react_jsx_runtime.jsx\)\("span", \{ children: t\("hero.headline"\) \}\), '
            rb'\(0, react_jsx_runtime.jsx\)\("span", \{\s*className: HeroShell_module_css_default.previewBadge,'
            rb'\s*children: t\("hero.preview"\)\s*\}\)\]'
        )
        return re.sub(title_group, 'children: "С чего начнем?"'.encode(), source, count=1)
    if package == "dsh-client-ui-chat":
        return source.replace(b"DeepSeek", b"octoport")
    return source


def product_bundle_source(path):
    source = client_source(path)
    package = path.parent.parent.name
    if package == "dsh-client-ui-conversation":
        # The stock composer registers a file-picker action. Use it for the toolbar button.
        source = replace_ui(source,
            b'label: t("input.commands"),\n\t\t\t\t\t\t\t\t\t\t\tside: "top",',
            'label: uploadDenied ? "Войдите, чтобы прикрепить файлы" : "Прикрепить файлы",\n\t\t\t\t\t\t\t\t\t\t\tside: "top",'.encode())
        source = replace_ui(source,
            b'"aria-label": t("input.commands"),\n\t\t\t\t\t\t\t\t\t\t\t\t"aria-haspopup": "listbox",\n\t\t\t\t\t\t\t\t\t\t\t\t"aria-expanded": commandMenuOpen,\n\t\t\t\t\t\t\t\t\t\t\t\tdisabled: locked || toggleCommandMenu === void 0,',
            '"aria-label": "Прикрепить файлы",\n disabled: !canAcceptDrop || subagent !== null,'.encode())
        source = replace_ui(source, b'onClick: onToggleCommandMenu,', b'onClick: () => fileInputRef.current?.click(),')
        # The platform stores arbitrary uploads as downloadable files. Its document reader
        # is available independently of a provider's image capabilities.
        source = replace_ui(source, b'if (isImageMediaType(file.type)) {\n\t\t\t\t\t\tconst attachment = browserDraftAttachment(file);',
                            b'if (isImageMediaType(file.type) && !window.__DSH_FILE_UPLOAD__) {\n\t\t\t\t\t\tconst attachment = browserDraftAttachment(file);')
        source = replace_ui(source, b'const rejected = (() => {\n\t\t\t\t\tif (continuable && files.some',
                            'const rejected = (() => {\n if (attachments.length + files.length > 10) return "Можно прикрепить до 10 файлов.";\n if (continuable && files.some'.encode())
        source = replace_ui(source, b'failedUpload.reason === void 0 ? t("file.uploadFailed")',
                            b'failedUpload.reason === void 0 ? failedUpload.message || t("file.uploadFailed")')
    if package == "dsh-client-ui-chat":
        source = replace_ui(source,
            b'`image:${index}`) : (0, react_jsx_runtime.jsxs)("span", {\n\t\t\t\t\t\t\tclassName: MessageItem_module_css_default.fileCard,',
            b'`image:${index}`) : (0, react_jsx_runtime.jsxs)(attachment.file.download ? "a" : "span", {\n'
            b'...attachment.file.download ? {href:attachment.file.download, download:attachment.file.name} : {},\n'
            b'className: MessageItem_module_css_default.fileCard,')
    return source


def encoded(data):
    return data, gzip.compress(data, compresslevel=6, mtime=0), hashlib.sha256(data).hexdigest()


@lru_cache(maxsize=2)
def frontend_brotli(digest):
    # The lookup key is the hash of the exact bytes served for this pinned client.
    with zipfile.ZipFile(UI / "chat-frontend.br.pack") as archive:
        try:
            return archive.read(digest)
        except KeyError:
            return None


def asset_response(request, parts, media, immutable=False, frontend=False):
    raw, compressed, digest = parts
    headers = {"Cache-Control": "public, max-age=31536000, immutable" if immutable else "public, no-cache",
               "ETag": 'W/"' + digest + '"', "Vary": "Accept-Encoding", "X-Content-Type-Options": "nosniff"}
    if headers["ETag"] in request.headers.get("if-none-match", "").split(", "):
        return Response(status_code=304, headers=headers)
    codings = request.headers.get("accept-encoding", "").lower().split(",")
    def accepts(coding):
        return any(re.fullmatch(r"\s*" + coding + r"(?:\s*;\s*q=(?:1(?:\.0*)?|0?\.\d*[1-9]\d*))?\s*", item)
                   for item in codings)

    if frontend and accepts("br"):
        packed = frontend_brotli(digest)
        if packed is not None:
            headers["Content-Encoding"] = "br"
            return Response(packed, media_type=media, headers=headers)
    use_gzip = accepts("gzip")
    if use_gzip:
        headers["Content-Encoding"] = "gzip"
    return Response(compressed if use_gzip else raw, media_type=media, headers=headers)


def modules():
    path = Path(os.environ.get("HARNESS_NODE_MODULES", ""))
    if not path.is_absolute():
        raise HTTPException(503, "Pinned Harness runtime unavailable")
    return path / GROUP.rstrip("/")

@lru_cache(maxsize=4)
def roster(base, core=None, workspace=None):
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
        if name == "dsh-client-ui-attachment":
            # The attachment plugin also offers an image slot for the optional trajectory view.
            # Octoport uses the composer and message slots without enabling that view.
            deps = [dep for dep in deps if dep != GROUP + "dsh-client-ui-trajectory"]
        entry = {"id": GROUP + name, "rev": VERSION, "url": "/ui-assets/modules/" + name + ".js",
                 "inject": deps, "immediately": bool(config.get("immediately"))}
        entries[name], files[name] = entry, path
        for dep in deps:
            if dep.startswith(GROUP):
                visit(dep.removeprefix(GROUP))
    for name in ROOTS:
        visit(name)
    plugin = {"id":"harness-account", "rev":VERSION, "url":"/ui-assets/project/account.js",
              "inject":[GROUP + name for name in ("dsh-client-ui-workspace", "dsh-client-ui-sidebar",
                                          "dsh-client-ui-settings-general")]}
    rows = [*entries.values(), plugin, {"id":"harness-integrations","rev":VERSION,
            "url":"/ui-assets/project/connections.js","inject":[GROUP+"dsh-client-ui-settings-general"]}]
    bootstrap = entries["dsh-client-modules"]
    batches = [{"phase":"bootstrap", "url":bootstrap["url"], "rev":VERSION, "entries":[bootstrap["id"]]},
               {"phase":"application", "url":"/ui-assets/modules/" + (core or core_name()) + ".js", "rev":VERSION,
                "entries":[row["id"] for row in entries.values() if row is not bootstrap and row["id"]!=GROUP+"dsh-client-ui-workspace"]},
               {"phase":"application", "url":"/ui-assets/modules/" + (workspace or core_name("workspace")) + ".js",
                "rev":VERSION, "entries":[GROUP+"dsh-client-ui-workspace"]},
               {"phase":"application", "url":"/ui-assets/modules/" + application_name() + ".js", "rev":VERSION,
                "entries":[row["id"] for row in rows[len(entries):]]}]
    return {"rev":VERSION, "release":{"version":VERSION}, "entries":rows, "batches":batches}, files

@lru_cache(maxsize=1)
def application_bundle():
    return encoded(application_bytes(UI))


def core_response(request, group="core"):
    digest, gz, br = core_assets(group)
    codings = {}
    for item in request.headers.get("accept-encoding", "").lower().split(","):
        coding, _, quality = item.strip().partition(";")
        try:
            codings[coding] = float(quality.strip().removeprefix("q=")) if quality else 1
        except ValueError:
            continue
    headers = {"Cache-Control":"public, max-age=31536000, immutable", "Vary":"Accept-Encoding",
               "ETag":'W/"' + digest + '"', "X-Content-Type-Options":"nosniff"}
    if headers["ETag"] in request.headers.get("if-none-match", "").split(", "):
        return Response(status_code=304, headers=headers)
    if codings.get("br", 0) > 0:
        body, headers["Content-Encoding"] = br, "br"
    elif codings.get("gzip", 0) > 0:
        body, headers["Content-Encoding"] = gz, "gzip"
    else:
        body = gzip.decompress(gz)
    return Response(body, media_type="text/javascript", headers=headers)


@lru_cache(maxsize=4)
def retained_parts(name):
    source = retained_source(UI.parents[3], name)
    return encoded(source) if source is not None else None


async def module_file(request):
    try:
        manifest, files = roster(modules())
    except (ValueError, OSError, KeyError):
        raise HTTPException(503, "Pinned Harness client unavailable") from None
    name = request.path_params["name"]
    for group in ("core","workspace"):
        if name == core_name(group):
            return core_response(request,group)
    if name == application_name():
        return asset_response(request, application_bundle(), 'text/javascript', immutable=True)
    if name == 'manifest':
        return Response('window.__DSH_BOOT__ = ' + json.dumps(manifest) + ';', media_type='text/javascript')
    if name not in files:
        if re.fullmatch(r"(?:application|workspace|core)-[a-f0-9]{20}", name):
            parts = await run_in_threadpool(retained_parts, name)
            if parts is not None:
                return asset_response(request, parts, "text/javascript", immutable=True)
        raise HTTPException(404)
    return asset_response(request, static_bytes(files[name], product_bundle_source), 'text/javascript')

@lru_cache(maxsize=1)
def initial_script():
    # Only trusted, release-owned JavaScript enters this block. Account data stays in HTML attributes.
    template = (UI / "chat-bootstrap.js").read_text()
    script = template.replace("@@application@@", application_name()).replace("@@core@@", core_name()).replace("@@workspace@@", core_name("workspace"))
    if "</script" in script.lower():
        raise ValueError("Unexpected inline script terminator")
    digest = base64.b64encode(hashlib.sha256(script.encode()).digest()).decode()
    return script, "'sha256-" + digest + "'"


def shell(*, theme="system", panel="", error="", recovery="", chat="", guest=False, status=200, account=None):
    page = (UI / "index.html").read_text()
    page = page.replace("@@application@@", application_name()).replace("@@core@@", core_name()).replace("@@workspace@@", core_name("workspace"))
    for name, value in {"theme":theme if theme in ("light","dark") else "system", "panel":panel, "error":error, "recovery":recovery, "chat":chat,
                        "account":json.dumps(account, separators=(",", ":")) if account is not None else "",
                        "mode":"guest" if guest else "member"}.items():
        page = page.replace("@@" + name + "@@", escape(value, quote=True))
    script, digest = initial_script()
    headers = {**HEADERS, "Content-Security-Policy": HEADERS["Content-Security-Policy"].replace(
        "script-src 'self';", "script-src 'self' " + digest + ";")}
    return HTMLResponse(page.replace("@@bootstrap@@", script), status_code=status, headers=headers)
