"""Publish a navigable copy of the Octoport information site under /about/."""
import argparse
import os
from pathlib import Path
import re
import shutil
import tempfile

def relocate(text):
    # Keep links to other origins, query strings, anchors and canonical metadata intact.
    text = re.sub(r"""(["'(])/(?!/)""", r"\1/about/", text)
    text = re.sub(r"https://octoport\.ru(?=/|[\"'<\s])", "https://octoport.ru/about", text)
    return text.replace("https://app.octoport.ru/login", "https://octoport.ru/login")

def publish(source, destination):
    source=source.resolve(strict=True)
    if not (source/"index.html").is_file():
        raise ValueError("Missing existing Octoport homepage")
    destination.mkdir(mode=0o755,parents=True,exist_ok=True)
    stage=Path(tempfile.mkdtemp(prefix="info-",dir=destination))
    stage.chmod(0o755)
    info=stage/"about"
    shutil.copytree(source,info)
    for p in info.rglob("*"):
        if p.is_file() and p.suffix in (".html",".css",".xml",".txt",".js"):
            p.write_text(relocate(p.read_text()))
    pointer=stage/"next"
    pointer.symlink_to(stage)
    os.replace(pointer,destination/"current")

if __name__=="__main__":
    cli=argparse.ArgumentParser()
    cli.add_argument("source",type=Path)
    cli.add_argument("destination",type=Path)
    args=cli.parse_args()
    publish(args.source,args.destination)
