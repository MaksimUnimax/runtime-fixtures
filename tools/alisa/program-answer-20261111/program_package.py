"""Admit the exact installed base plus a published patch; keep startup guards."""
from pathlib import Path
import hashlib,json,re,shutil

def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def admit(root,base,source_commit):
    assert re.fullmatch('[0-9a-f]{40}',source_commit)
    for p in root.rglob('__pycache__'):
        if p.is_dir():shutil.rmtree(p)
    parent=json.loads((base/'manifest.json').read_text())
    current=root/'CURRENT_CORE_MANIFEST.json'
    value=json.loads(current.read_text())
    value.update(observed_parent_release=base.name,observed_parent_manifest_sha256=digest(base/'manifest.json'),
                 program_patch_commit=source_commit)
    value['files']={str(p.relative_to(root)):digest(p)for p in sorted(root.rglob('*'))
                    if p.is_file()and p.name not in {'manifest.json','CURRENT_CORE_MANIFEST.json'}}
    current.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');current.chmod(0o644)
    manifest={'schema':'alice-read-surface-release/v1','artifact_id':root.name,'source_commit':source_commit,
              'source_kind':'exact_installed_base_plus_published_program_patch','base_release':base.name,
              'base_source_commit':parent['source_commit'],'base_manifest_sha256':digest(base/'manifest.json'),
              'files':{str(p.relative_to(root)):digest(p)for p in sorted(root.rglob('*'))if p.is_file()and p.name!='manifest.json'}}
    (root/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');(root/'manifest.json').chmod(0o644)
    return manifest
