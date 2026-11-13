"""Finite offline regression of an explicit, fully hashed native candidate."""
import argparse
import hashlib
import ipaddress
import json
from pathlib import Path
import socket
import sys
import unittest
from unittest.mock import patch


def validate(source):
    raw = (source / 'CURRENT_CORE_MANIFEST.json').read_bytes()
    manifest = json.loads(raw)
    names = {p.name for p in source.glob('*.py')}
    names.update(str(p.relative_to(source)) for p in (source / 'read_surface_data').rglob('*')
                 if p.is_file() and '__pycache__' not in p.parts)
    if not names <= set(manifest['files']):
        raise RuntimeError('Native source coverage incomplete')
    for name, digest in manifest['files'].items():
        path = source / name
        if (Path(name).is_absolute() or '..' in Path(name).parts or path.is_symlink()
                or not path.resolve().is_relative_to(source)
                or hashlib.sha256(path.read_bytes()).hexdigest() != digest):
            raise RuntimeError('Native source mismatch')
    return hashlib.sha256(raw).hexdigest(), manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(); source = args.source.resolve()
    digest, manifest = validate(source)
    sys.path[:0] = [str(source), str(source / 'tests')]
    forbidden = []; connect = socket.socket.connect; connect_ex = socket.socket.connect_ex
    resolve = socket.getaddrinfo
    def allowed(host):
        if host == 'localhost': return True
        try: return ipaddress.ip_address(host).is_loopback
        except ValueError: return False
    def dns(host, *values, **options):
        if not allowed(host):
            forbidden.append('DNS'); raise AssertionError('External DNS forbidden')
        return resolve(host, *values, **options)
    def guard(peer, address):
        if peer.family != socket.AF_UNIX and not allowed(address[0]):
            forbidden.append('TCP'); raise AssertionError('External network forbidden')
    def confined(peer, address):
        guard(peer, address); return connect(peer, address)
    def confined_ex(peer, address):
        guard(peer, address); return connect_ex(peer, address)
    with patch('socket.getaddrinfo', dns), patch.object(socket.socket, 'connect', confined), \
            patch.object(socket.socket, 'connect_ex', confined_ex):
        loader = unittest.TestLoader()
        suite = unittest.TestSuite([loader.discover(str(source / 'tests')),
            loader.loadTestsFromName('test_dataset_json_only'), loader.loadTestsFromName('test_dataset_pipeline')])
        result = unittest.TextTestRunner(verbosity=1).run(suite)
    after, _ = validate(source)
    from runtime_port import current_versions
    report = {'scope': 'CURRENT_INSTALLED_SOURCE_EXTENSION_OFFLINE_NOT_DEPLOYED',
        'status': 'PASS' if result.wasSuccessful() and not result.skipped and not forbidden and after == digest else 'FAILED',
        'tests_run': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors),
        'skipped': len(result.skipped), 'forbidden_network_attempts': len(forbidden),
        'source_manifest_sha256': digest, 'source_files': len(manifest['files']),
        'versions': current_versions(), 'installed': False, 'live_provider_calls': 0}
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report)); return 0 if report['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
