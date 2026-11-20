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


def build(esbuild, node, output):
    if subprocess.check_output([esbuild, "--version"], text=True).strip() != "0.25.12":
        raise ValueError("Expected esbuild 0.25.12")
    manifest, files = roster(modules(), core="@@core@@")
    for batch in manifest["batches"]:
        if batch["url"] == "/ui-assets/modules/" + application_name() + ".js":
            batch["url"] = "/ui-assets/modules/@@application@@.js"
    config = json.dumps(manifest, ensure_ascii=True, separators=(",", ":"))
    boot = b"\n;\n".join((_NAVIGATION_JS.encode(), (UI / "bootstrap.js").read_bytes(),
                          client_source(files["dsh-client-modules"]), ("window.__DSH_BOOT__=" + config).encode()))
    bootstrap = subprocess.run([esbuild, "--minify", "--charset=utf8", "--target=es2022"],
                               input=boot, stdout=subprocess.PIPE, check=True).stdout
    output.with_name("chat-bootstrap.js").write_bytes(bootstrap)
    source = b"\n;\n".join(client_source(path) for name, path in files.items() if name != "dsh-client-modules")
    # Octoport selects Russian. English remains available as the upstream fallback.
    source = re.sub(rb"(\.locale\.register\([^,\n]+,\s*\{)\s*zh,\s*en,\s*ja,\s*es,\s*fr,\s*de,\s*ru,\s*pt\s*(\})",
                    rb"\1en,ru\2", source)
    js = subprocess.run([esbuild, "--minify", "--tree-shaking=true", "--charset=utf8",
                         "--legal-comments=inline", "--target=es2022"], input=source, stdout=subprocess.PIPE, check=True).stdout
    compressor = ("const z=require('node:zlib'),f=require('node:fs');"
                  "process.stdout.write(z.brotliCompressSync(f.readFileSync(0),{params:{[z.constants.BROTLI_PARAM_QUALITY]:10}}))")
    br = subprocess.run([node, "-e", compressor], input=js, stdout=subprocess.PIPE, check=True).stdout
    with zipfile.ZipFile(output, "w") as archive:
        for name, data in (("sha256", hashlib.sha256(js).hexdigest().encode()), ("core.js.gz", gzip.compress(js, mtime=0)), ("core.js.br", br)):
            archive.writestr(zipfile.ZipInfo(name), data)
    print(f"{len(files)-1} modules, {len(js)} raw bytes, {len(br)} Brotli bytes")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--esbuild", required=True)
    parser.add_argument("--node", default="node")
    parser.add_argument("--output", type=Path, default=UI / "chat-core.pack")
    args = parser.parse_args()
    build(args.esbuild, args.node, args.output)
