"""Replay the unchanged pinned R01 suite after the narrow HTTP extraction."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--output', type=Path, required=True); args = parser.parse_args()
    binding = json.loads((ROOT/'baseline-binding.json').read_text())
    archive = ROOT/'fixtures/rt-job-r01-baseline.zip'
    record = {'scope': 'PINNED_R01_CORE_HTTP_EXTRACTION_OFFLINE_NOT_CURRENT_INSTALLED_CORE', 'status': 'FAILED',
        'baseline_archive_sha256': binding['archive_sha256'], 'live_changes': False}
    try:
        assert hashlib.sha256(archive.read_bytes()).hexdigest() == binding['archive_sha256']
        with tempfile.TemporaryDirectory(prefix='rt-check-baseline-') as directory:
            work = Path(directory)
            with zipfile.ZipFile(archive) as source:
                names = source.namelist(); assert len(names) == len(set(names))
                for item in source.infolist():
                    path = Path(item.filename)
                    assert not path.is_absolute() and '..' not in path.parts and not stat.S_ISLNK(item.external_attr >> 16)
                source.extractall(work)
            original = json.loads((work/'MANIFEST.json').read_text())
            assert all(hashlib.sha256((work/name).read_bytes()).hexdigest() == digest for name, digest in original.items())
            assert hashlib.sha256((work/'http_transport.py').read_bytes()).hexdigest() == binding['http_transport_before_sha256']
            subprocess.run(['patch', '--batch', '--fuzz=0', '-p1', '-i', str(ROOT/'runtime_http_primitive.patch')],
                cwd=work, check=True, capture_output=True, timeout=5)
            shutil.copyfile(ROOT/'shared_http.py', work/'shared_http.py')
            assert hashlib.sha256((work/'http_transport.py').read_bytes()).hexdigest() == binding['http_transport_after_sha256']
            assert all(hashlib.sha256((work/name).read_bytes()).hexdigest() == digest
                for name, digest in original.items() if name != 'http_transport.py')
            clean = {k: v for k, v in os.environ.items() if k in {'PATH', 'LANG', 'LC_ALL'}}
            clean['PYTHONDONTWRITEBYTECODE'] = '1'
            with (work/'private-test.log').open('w+') as log:
                result = subprocess.run([sys.executable, 'run_checks.py'], cwd=work, env=clean,
                    stdout=log, stderr=log, timeout=60)
                log.seek(0)
                summaries = []
                for line in log:
                    try:
                        value = json.loads(line)
                        if value.get('mode') == 'OFFLINE_TCP_DNS_BLOCKED_UNIX_IPC_ALLOWED':summaries.append(value)
                    except (ValueError, AttributeError):pass
            assert len(summaries) == 1
            record['baseline_result'] = summaries[0]
            assert result.returncode == 0 and summaries[0]['tests_run'] == 800 and summaries[0]['forbidden_network_attempts'] == 0
            assert summaries[0]['failures'] == summaries[0]['errors'] == summaries[0]['skipped'] == 0
            record['unchanged_baseline_files'] = len(original)-1
            record['status'] = 'PASS'
    except Exception as error:
        record['error_type'] = type(error).__name__
    args.output.parent.mkdir(parents=True, exist_ok=True); args.output.write_text(json.dumps(record, indent=2)+'\n')
    return 0 if record['status'] == 'PASS' else 1


if __name__ == '__main__':sys.exit(main())
