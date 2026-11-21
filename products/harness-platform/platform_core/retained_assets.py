"""Resolve only public, content-addressed JavaScript from retained Octoport releases."""
import gzip
import hashlib
import re
from functools import lru_cache
from pathlib import Path
from zipfile import BadZipFile, ZipFile


def application_bytes(ui):
    return b"\n;\n".join((ui / name).read_bytes() for name in ("plugins.js", "account.js", "connections.js"))


@lru_cache(maxsize=1)
def retained_index(release):
    index = {}
    if release.parent.name != "releases" or not re.fullmatch(r"[0-9a-f]{40}", release.name):
        return index
    for sibling in release.parent.iterdir():
        if sibling == release or not re.fullmatch(r"[0-9a-f]{40}", sibling.name):
            continue
        ui = sibling / "products/harness-platform/native/web"
        for group in ("core", "workspace"):
            try:
                with ZipFile(ui / f"chat-{group}.pack") as archive:
                    digest = archive.read("sha256").decode("ascii")
                index.setdefault(group + "-" + digest[:20], ui)
            except (FileNotFoundError, BadZipFile, KeyError, UnicodeError):
                continue
        try:
            digest = hashlib.sha256(application_bytes(ui)).hexdigest()
        except FileNotFoundError:
            continue
        index.setdefault("application-" + digest[:20], ui)
    return index


@lru_cache(maxsize=4)
def retained_source(release, name):
    ui = retained_index(release).get(name)
    if ui is None:
        return None
    group, short_digest = name.split("-")
    try:
        if group == "application":
            data = application_bytes(ui)
        else:
            with ZipFile(ui / f"chat-{group}.pack") as archive:
                data = gzip.decompress(archive.read("core.js.gz"))
    except (FileNotFoundError, BadZipFile, KeyError, EOFError, gzip.BadGzipFile):
        return None
    return data if hashlib.sha256(data).hexdigest().startswith(short_digest) else None
