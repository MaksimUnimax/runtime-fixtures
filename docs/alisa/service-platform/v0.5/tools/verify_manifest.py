#!/usr/bin/env python3
"""Verify complete package bytes. No network and no changes to source files."""
from __future__ import annotations
import argparse, hashlib, json, sys
from pathlib import Path, PurePosixPath

def verify(root: Path) -> list[str]:
    root=root.resolve(); problems=[]
    try: data=json.loads((root/'MANIFEST.json').read_text(encoding='utf-8'))
    except (OSError,ValueError) as exc:return [f'Manifest unreadable: {type(exc).__name__}']
    entries=data.get('files',[])
    if not isinstance(entries,list) or not entries:return ['Manifest has no file list']
    names=set()
    for item in entries:
        if not isinstance(item,dict):problems.append('Invalid manifest entry');continue
        name=item.get('path',''); rel=PurePosixPath(name)
        if not name or rel.is_absolute() or '..' in rel.parts or '\\' in name or name=='MANIFEST.json':
            problems.append(f'Unsafe manifest path: {name}');continue
        if name in names:problems.append(f'Duplicate entry: {name}')
        names.add(name); p=root/name
        if p.is_symlink() or not p.is_file() or not p.resolve().is_relative_to(root):
            problems.append(f'Missing/unsafe file: {name}');continue
        b=p.read_bytes()
        if len(b)!=item.get('size_bytes') or hashlib.sha256(b).hexdigest()!=item.get('sha256'):
            problems.append(f'Content mismatch: {name}')
    actual=set()
    for p in root.rglob('*'):
        rel=p.relative_to(root).as_posix()
        if p.is_symlink():problems.append(f'Symlink forbidden: {rel}')
        elif p.is_file() and rel!='MANIFEST.json':actual.add(rel)
    for name in sorted(actual-names):problems.append(f'Unexpected file: {name}')
    for name in sorted(names-actual):problems.append(f'Missing file: {name}')
    return problems

def main()->int:
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1]);args=ap.parse_args()
    errors=verify(args.root)
    print(json.dumps({'scope':'PACKAGE_BYTES_ONLY','verdict':'FAIL' if errors else 'PASS','errors':errors},ensure_ascii=False,indent=2))
    return 1 if errors else 0
if __name__=='__main__':sys.exit(main())
