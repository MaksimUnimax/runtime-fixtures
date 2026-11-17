"""Compose a pinned historical R15 test context, never an installed release."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess

ROOT=Path(__file__).resolve().parents[2]
R15='cafb743c94672104d4afa2c471398e5c81d904f5'


def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


def build(context,destination):
    context,destination=Path(context).resolve(),Path(destination).resolve()
    relative=destination.relative_to(ROOT)
    if (os.environ.get('GITHUB_ACTIONS')!='true' or destination.exists() or
        not relative.parts[0].startswith('s07-qual-') or
        subprocess.check_output(['git','rev-parse','HEAD'],cwd=context,text=True).strip()!=R15):
        raise RuntimeError('OWNED_PINNED_R15_CONTEXT_REQUIRED')
    source=Path('/dev/shm')/('alisa-parameter-ci-s13-'+secrets.token_hex(8))
    if source.exists():raise RuntimeError('NEW_OWNED_CONTEXT_REQUIRED')
    builder=load('s13_r15_fixture',context/'products/alisa/tests/current_parameters/build_native_fixture.py')
    try:
        receipt=builder.build(source)
        if receipt['production_deployed']is not False:raise RuntimeError('TEST_CONTEXT_REQUIRED')
        shutil.copytree(source,destination)
    finally:
        if source.is_dir():shutil.rmtree(source)
    # Reconcile current question and consent overlays with the historical R15
    # financial sources. No R15 financial file is replaced by frozen R4/R5.
    for name,path in [('question',ROOT/'runtime/question_catalog/build_overlay.py'),
                      ('voice',ROOT/'runtime/coefficient_voice_station/build_overlay.py')]:
        extension=load('s13_context_'+name,path)
        transform=getattr(extension,'native_sources',None)
        if transform is None:transform=extension.sources
        for relative,body in transform(destination).items():
            target=destination/relative;target.parent.mkdir(parents=True,exist_ok=True)
            target.write_text(body)
    manifest_path=destination/'CURRENT_CORE_MANIFEST.json'
    manifest=json.loads(manifest_path.read_text())
    manifest['files']={str(path.relative_to(destination)):hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(destination.rglob('*'))if path.is_file()and
        path.name!='CURRENT_CORE_MANIFEST.json'and '__pycache__'not in path.parts}
    manifest['s13_r15_test_context']={'source':R15,'archive_sha256':receipt['archive_sha256'],
        'production_deployed':False}
    manifest_path.write_text(json.dumps(manifest,sort_keys=True,indent=2)+'\n')
    return destination
