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
import zipfile
from pathlib import Path


IMPORT_SCRIPTS = re.compile(r"importScripts\((.*?)\);", re.DOTALL)
FIREFOX_REQUIRED_DATA_COLLECTION = ["authenticationInfo", "personallyIdentifyingInfo"]
FIREFOX_LOOPBACK_WITH_PORT = re.compile(r"^http://127\.0\.0\.1:\d+/\*$")
FIREFOX_LOOPBACK_PORTLESS = "http://127.0.0.1/*"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def flatten(path: Path, root: Path, stack: tuple[Path, ...] = ()) -> bytes:
    path = path.resolve()
    if path in stack:
        raise ValueError("cyclic importScripts graph: " + " -> ".join(str(p) for p in stack + (path,)))
    if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
        raise ValueError(f"invalid Firefox background input: {path}")
    source = path.read_text(encoding="utf-8")

    def replace(match: re.Match[str]) -> str:
        raw = "[" + match.group(1) + "]"
        try:
            imports = json.loads(raw)
        except json.JSONDecodeError as error:
            raise ValueError(f"non-static importScripts in {path}") from error
        if not isinstance(imports, list) or not all(isinstance(item, str) for item in imports):
            raise ValueError(f"invalid importScripts list in {path}")
        return "\n;\n".join(
            flatten(root / item, root, stack + (path,)).decode("utf-8") for item in imports
        )

    return IMPORT_SCRIPTS.sub(replace, source).encode("utf-8")


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
    manifest["browser_specific_settings"] = {
        "gecko": {
            "id": "seller-agents@example.test",
            "strict_min_version": "140.0",
            "data_collection_permissions": {
                "required": FIREFOX_REQUIRED_DATA_COLLECTION,
            },
        }
    }
    write_json(output / "manifest.json", manifest)

    files = []
    for path in sorted(p for p in output.rglob("*") if p.is_file()):
        relative = path.relative_to(output).as_posix()
        data = path.read_bytes()
        files.append({"path": relative, "sha256": sha256(data), "bytes": len(data)})

    archive = output.parent / "SELLER_AGENTS_I1_C1_v0.2.4_FIREFOX_LOCAL_DEVELOPMENT.zip"
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
