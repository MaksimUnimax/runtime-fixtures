"""Build a source-pinned runtime package without configuration, keys or databases."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile

ROOT=Path(__file__).resolve().parent
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--source',required=True);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    repo=next(p for p in ROOT.parents if (p/'.git').exists())
    actual=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()
    if actual!=args.source:raise ValueError('Exact source required')
    relative=ROOT.relative_to(repo)
    if subprocess.check_output(['git','status','--porcelain','--',str(relative)],cwd=repo):raise ValueError('Committed runtime required')
    paths=subprocess.check_output(['git','ls-files','-z','--',str(relative)],cwd=repo).decode().split('\0')
    payload={str(Path(p).relative_to(relative)):(repo/p).read_bytes() for p in paths if p}
    manifest={'schema_version':'alisa_runtime_package_v1','source_sha':actual,
        'files':{name:hashlib.sha256(data).hexdigest() for name,data in payload.items()},
        'base_installed_manifest_sha256':hashlib.sha256(payload['BASE_INSTALLED_MANIFEST.json']).hexdigest(),
        'contains_private_config_or_keys':False,'installed':False,'live_provider_qualified_by_this_package':False}
    payload['manifest.json']=(json.dumps(manifest,indent=2)+'\n').encode()
    args.output.mkdir(parents=True,exist_ok=True);prefix='alisa-runtime-'+actual[:16];target=args.output/(prefix+'.tar.gz')
    with tarfile.open(target,'w:gz') as archive:
        for name,data in sorted(payload.items()):
            item=tarfile.TarInfo(prefix+'/'+name);item.size=len(data);item.mode=0o644;item.mtime=0
            archive.addfile(item,io.BytesIO(data))
    target.with_suffix(target.suffix+'.sha256').write_text(hashlib.sha256(target.read_bytes()).hexdigest()+'  '+target.name+'\n')
if __name__=='__main__':main()
