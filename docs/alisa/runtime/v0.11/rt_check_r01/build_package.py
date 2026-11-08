"""Package only the new runtime-side modules and pinned integration patch."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parent
FILES = ['shared_http.py', 'store_checker.py', 'store_check_ipc.py', 'store_check_worker.py',
    'runtime_http_primitive.patch', 'baseline-binding.json', 'README.md']


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--source', required=True); parser.add_argument('--output', type=Path, required=True); args = parser.parse_args()
    repo = next(p for p in ROOT.parents if (p/'.git').exists())
    actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip()
    if args.source != actual:raise ValueError('Exact source SHA required')
    payload = {name: (ROOT/name).read_bytes() for name in FILES}
    manifest = {'schema_version': 'rt_check_package_v1', 'source_sha': args.source,
        'files': {name: hashlib.sha256(data).hexdigest() for name, data in payload.items()},
        'baseline': json.loads(payload['baseline-binding.json']), 'installed': False,
        'live_provider_qualified': False, 'seller_binding_default': 'UNQUALIFIED',
        'performance_binding': 'AUTHENTICATED_UNLINKED_NOT_CONNECTED', 'contains_private_config_or_keys': False}
    payload['manifest.json'] = (json.dumps(manifest, indent=2)+'\n').encode()
    args.output.mkdir(parents=True, exist_ok=True)
    target = args.output/('rt-check-'+args.source[:16]+'.tar.gz')
    with tarfile.open(target, 'w:gz') as archive:
        for name, data in payload.items():
            item = tarfile.TarInfo('rt-check-'+args.source[:16]+'/'+name)
            item.size = len(data); item.mode = 0o644; item.mtime = 0
            archive.addfile(item, io.BytesIO(data))
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    target.with_suffix(target.suffix+'.sha256').write_text(digest+'  '+target.name+'\n')


if __name__ == '__main__':main()
