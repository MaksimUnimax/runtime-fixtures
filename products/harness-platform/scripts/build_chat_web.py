"""Precompile pinned upstream client modules. Run when their versions or product transforms change."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import zipfile

PRODUCT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PRODUCT))
from platform_core.native_web import UI, application_name, client_source, modules, roster
from platform_core.browser_session import _NAVIGATION_JS
from platform_core.native_ui_entry import browser_entry


def build(esbuild, node, output):
    if subprocess.check_output([esbuild, "--version"], text=True).strip() != "0.25.12":
        raise ValueError("Expected esbuild 0.25.12")
    manifest, files = roster(modules(), core="@@core@@", workspace="@@workspace@@")
    for batch in manifest["batches"]:
        if batch["url"] == "/ui-assets/modules/" + application_name() + ".js":
            batch["url"] = "/ui-assets/modules/@@application@@.js"
    config = json.dumps(manifest, ensure_ascii=True, separators=(",", ":"))
    boot = b"\n;\n".join((_NAVIGATION_JS.encode(), (UI / "bootstrap.js").read_bytes(),
                          client_source(files["dsh-client-modules"]), ("window.__DSH_BOOT__=" + config).encode()))
    bootstrap = subprocess.run([esbuild, "--minify", "--charset=utf8", "--target=es2022"],
                               input=boot, stdout=subprocess.PIPE, check=True).stdout
    output.with_name("chat-bootstrap.js").write_bytes(bootstrap)
    components = {name: client_source(path) for name, path in files.items() if name != "dsh-client-modules"}
    workspace = components.pop("dsh-client-ui-workspace")
    write_pack(esbuild, node, output.with_name("chat-workspace.pack"), workspace)
    write_pack(esbuild, node, output, b"\n;\n".join(components.values()))

    frontend = modules() / "dsh-web-frontend" / "dist" / "assets"
    with zipfile.ZipFile(output.with_name("chat-frontend.br.pack"), "w") as archive:
        for name, transform in (("index-BgUyXZcc.js", browser_entry), ("vendor-BUMdD3V7.js", Path.read_bytes)):
            data = transform(frontend / name)
            archive.writestr(zipfile.ZipInfo(hashlib.sha256(data).hexdigest()), brotli(node, data))


def write_pack(esbuild, node, output, source):
    # Octoport selects Russian. English remains available as the upstream fallback.
    source = re.sub(rb"(\.locale\.register\([^,\n]+,\s*\{)\s*zh,\s*en,\s*ja,\s*es,\s*fr,\s*de,\s*ru,\s*pt\s*(\})",
                    rb"\1en,ru\2", source)
    js = subprocess.run([esbuild, "--minify", "--tree-shaking=true", "--charset=utf8",
                         "--legal-comments=inline", "--target=es2022"], input=source, stdout=subprocess.PIPE, check=True).stdout
    br = brotli(node, js)
    with zipfile.ZipFile(output, "w") as archive:
        for name, data in (("sha256", hashlib.sha256(js).hexdigest().encode()), ("core.js.gz", gzip.compress(js, mtime=0)), ("core.js.br", br)):
            archive.writestr(zipfile.ZipInfo(name), data)
    print(f"{output.name}: {len(js)} raw bytes, {len(br)} Brotli bytes")


def brotli(node, data):
    compressor = ("const z=require('node:zlib'),f=require('node:fs');"
                  "process.stdout.write(z.brotliCompressSync(f.readFileSync(0),{params:{[z.constants.BROTLI_PARAM_QUALITY]:10}}))")
    return subprocess.run([node, "-e", compressor], input=data, stdout=subprocess.PIPE, check=True).stdout


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--esbuild", required=True)
    parser.add_argument("--node", default="node")
    parser.add_argument("--output", type=Path, default=UI / "chat-core.pack")
    args = parser.parse_args()
    build(args.esbuild, args.node, args.output)
