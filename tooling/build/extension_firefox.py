"""Build the Firefox WebExtension carrier from the common runtime.

Firefox Manifest V3 does not run ``background.service_worker``.  Its
event-page implementation consumes ``background.scripts`` instead, so this
builder flattens the common classic ``importScripts`` graph into one Firefox
background script and changes only browser packaging metadata.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import zipfile
from pathlib import Path


FIREFOX_REQUIRED_DATA_COLLECTION = [
    "authenticationInfo",
    "personallyIdentifyingInfo",
    "browsingActivity",
    "websiteContent",
    "searchTerms",
    "financialAndPaymentInfo",
    "personalCommunications",
]
FIREFOX_OPTIONAL_DATA_COLLECTION = ["technicalAndInteraction"]
FIREFOX_LOOPBACK_WITH_PORT = re.compile(r"^http://127\.0\.0\.1:\d+/\*$")
FIREFOX_LOOPBACK_PORTLESS = "http://127.0.0.1/*"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _locate_static_imports(source: str) -> list[dict]:
    # Unicode escapes can spell executable JavaScript identifiers such as importScripts.
    # Always parse syntax; an ASCII substring shortcut can silently skip a real call.
    parser = Path(__file__).with_name("extension_importscripts_ast.cjs")
    if not parser.is_file() or parser.is_symlink():
        raise ValueError("Firefox static import AST parser unavailable")
    try:
        result = subprocess.run(
            ["node", str(parser)],
            input=source, capture_output=True, text=True, timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ValueError("Firefox static import AST parser not executable") from error
    if result.returncode != 0:
        raise ValueError(
            "Firefox static import AST rejected source: " + result.stderr.strip()[:320],
        )
    try:
        imports = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise ValueError("Firefox static import AST returned invalid JSON") from error
    if not isinstance(imports, list):
        raise ValueError("Firefox static import AST returned invalid list")
    last_end = 0
    for item in imports:
        if not isinstance(item, dict):
            raise ValueError("Firefox static import AST returned invalid item")
        start, end, paths = item.get("start"), item.get("end"), item.get("paths")
        if not (
            type(start) is int and type(end) is int and
            last_end <= start < end <= len(source) and
            isinstance(paths, list) and paths and
            all(isinstance(p, str) and p for p in paths)
        ):
            raise ValueError("Firefox static import AST returned invalid spans")
        last_end = end
    return imports


def flatten(path: Path, root: Path, stack: tuple[Path, ...] = ()) -> bytes:
    path = path.resolve()
    if path in stack:
        raise ValueError("cyclic importScripts graph: " + " -> ".join(str(p) for p in stack + (path,)))
    if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
        raise ValueError(f"invalid Firefox background input: {path}")
    source = path.read_text(encoding="utf-8")
    locations = _locate_static_imports(source)
    pieces: list[bytes] = []
    cursor = 0
    for item in locations:
        pieces.append(source[cursor:item["start"]].encode("utf-8"))
        pieces.append(b"\n;\n".join(
            flatten(root / name, root, stack + (path,)) for name in item["paths"]
        ))
        cursor = item["end"]
    pieces.append(source[cursor:].encode("utf-8"))
    return b"".join(pieces)


def build(input_runtime: Path, output: Path) -> dict:
    input_runtime = input_runtime.resolve()
    output = output.resolve()
    if not input_runtime.is_dir() or output.exists():
        raise ValueError("input runtime must exist and output must not exist")
    if any(path.is_symlink() for path in input_runtime.rglob("*")):
        raise ValueError("symlink in common runtime")

    manifest = read_json(input_runtime / "manifest.json")
    if manifest.get("manifest_version") != 3 or manifest.get("background", {}).get("service_worker") != "service_worker_entry.js":
        raise ValueError("unexpected common MV3 manifest")

    output.mkdir(parents=True)
    for source in sorted(path for path in input_runtime.rglob("*") if path.is_file()):
        relative = source.relative_to(input_runtime)
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)

    background = flatten(input_runtime / "service_worker_entry.js", input_runtime)
    (output / "firefox_background.js").write_bytes(background)
    # Firefox match patterns do not accept explicit ports. Only normalize the
    # local development loopback permissions; production origins stay exact.
    manifest["host_permissions"] = list(dict.fromkeys(
        FIREFOX_LOOPBACK_PORTLESS if FIREFOX_LOOPBACK_WITH_PORT.fullmatch(pattern) else pattern
        for pattern in manifest.get("host_permissions", [])
    ))
    manifest["background"] = {"scripts": ["firefox_background.js"]}
    # Map the common import document to Firefox's native sidebar.
    import_panel = manifest.pop("side_panel", None)
    manifest["permissions"] = [p for p in manifest.get("permissions", []) if p != "sidePanel"]
    if import_panel:
        manifest["sidebar_action"] = {
            "default_panel": import_panel["default_path"],
            "default_title": manifest["action"]["default_title"],
            "open_at_install": False,
        }
    store_package = manifest.get("name") == "Октопорт — Ozon + Wildberries"
    manifest["browser_specific_settings"] = {
        "gecko": {
            "id": "octoport@octoport.ru" if store_package else "seller-agents@example.test",
            "strict_min_version": "140.0",
            "data_collection_permissions": {
                "required": FIREFOX_REQUIRED_DATA_COLLECTION,
                "optional": FIREFOX_OPTIONAL_DATA_COLLECTION,
            },
        }
    }
    write_json(output / "manifest.json", manifest)

    files = []
    for path in sorted(p for p in output.rglob("*") if p.is_file()):
        relative = path.relative_to(output).as_posix()
        data = path.read_bytes()
        files.append({"path": relative, "sha256": sha256(data), "bytes": len(data)})

    archive = output.parent / (
        f"OCTOPORT_v{manifest['version']}_FIREFOX_STORE.zip"
        if store_package
        else f"SELLER_AGENTS_I1_C1_v{manifest['version']}_FIREFOX_LOCAL_DEVELOPMENT.zip"
    )
    repeat = output.parent / (archive.name + ".repeat")
    for target in (archive, repeat):
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_STORED) as zipped:
            for row in files:
                entry = zipfile.ZipInfo(row["path"], date_time=(1980, 1, 1, 0, 0, 0))
                entry.create_system = 3
                entry.external_attr = 0o100644 << 16
                zipped.writestr(entry, (output / row["path"]).read_bytes())
    if archive.read_bytes() != repeat.read_bytes():
        raise ValueError("non-deterministic Firefox archive")
    repeat.unlink()
    receipt = {
        "browser": "firefox",
        "build_mode": "store" if store_package else "development",
        "version": manifest["version"],
        "source_runtime": str(input_runtime),
        "files": files,
        "package": {
            "name": archive.name,
            "bytes": archive.stat().st_size,
            "sha256": sha256(archive.read_bytes()),
            "repeat_archive_match": True,
        },
        "differences": [
            "manifest.host_permissions: loopback development ports normalized for Firefox",
            "manifest.background.service_worker -> background.scripts",
            "manifest.browser_specific_settings.gecko",
            "manifest.browser_specific_settings.gecko.data_collection_permissions",
            "generated firefox_background.js with common importScripts graph flattened",
        ],
        "semantic_source": "common runtime copied without product-source fork",
        "data_collection_permissions": manifest["browser_specific_settings"]["gecko"]["data_collection_permissions"],
        "installed_acceptance": False,
    }
    write_json(output.parent / "firefox-composition-receipt.json", receipt)
    return receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-runtime", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.input_runtime, args.output), ensure_ascii=False))
