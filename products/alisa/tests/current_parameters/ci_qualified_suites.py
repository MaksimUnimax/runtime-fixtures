"""Finite tests with pinned native code and an owned network-isolated database."""
from pathlib import Path
from datetime import datetime, timezone
from hashlib import sha256
from unittest.mock import patch
import argparse, sys, os, json, socket, time, unittest

ROOT = Path(__file__).resolve().parents[2]
REPO = ROOT.parents[1]
sys.path[:0] = [str(ROOT / 'tests'), str(ROOT / 'services/platform/src')]
from suite_routing import inventory, labels


def _shard_bounds(count, index):
    if type(count) is not int or type(index) is not int or count < 1 or not 0 <= index < count:
        raise RuntimeError('TEST_SHARD_RANGE')


def _ids_hash(ids):
    return sha256(json.dumps(ids, ensure_ascii=True, separators=(',', ':')).encode()).hexdigest()


def select_shard(suite, count=1, index=0):
    """Partition one discovered inventory; every test belongs to one index."""
    _shard_bounds(count, index)

    def flatten(current):
        if not isinstance(current, unittest.TestSuite):
            raise RuntimeError('TEST_SUITE_SCHEMA')
        for item in current:
            if isinstance(item, unittest.TestSuite):
                yield from flatten(item)
            elif isinstance(item, unittest.TestCase):
                yield item
            else:
                raise RuntimeError('TEST_SUITE_SCHEMA')

    discovered = [(test.id(), test) for test in flatten(suite)]
    if not discovered:
        raise RuntimeError('EMPTY_SPECIALIZED_SUITE')
    if any(type(ident) is not str or not ident for ident, _ in discovered):
        raise RuntimeError('TEST_ID_SCHEMA')
    ids = [ident for ident, _ in discovered]
    if len(ids) != len(set(ids)):
        raise RuntimeError('DUPLICATE_TEST_ID')
    ordered = sorted(discovered, key=lambda item: item[0])
    chosen = ordered[index::count]
    if count > len(ordered) or not chosen:
        raise RuntimeError('EMPTY_TEST_SHARD')
    all_ids = [ident for ident, _ in ordered]
    selected_ids = [ident for ident, _ in chosen]
    coverage = {'shard_index': index, 'shard_count': count,
                'inventory_count': len(all_ids), 'inventory_sha256': _ids_hash(all_ids),
                'selected_ids_count': len(selected_ids), 'selected_ids_sha256': _ids_hash(selected_ids)}
    return unittest.TestSuite(test for _, test in chosen), coverage


class RecordingResult(unittest.TextTestResult):
    """Record actual starts, so an unexecuted selected test cannot count as PASS."""
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.executed_ids = []

    def startTest(self, test):
        self.executed_ids.append(test.id())
        super().startTest(test)


def execution_coverage(result, planned):
    ids = sorted(result.executed_ids)
    digest = _ids_hash(ids)
    complete = (len(ids) == len(set(ids)) == result.testsRun == planned['selected_ids_count']
                and digest == planned['selected_ids_sha256'])
    return {'executed_ids_count': len(ids), 'executed_ids_sha256': digest,
            'execution_complete': complete}


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--suite', choices=['base', 'collection', 'compound', 'ledger'], required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--shard-count', type=int, default=1)
    parser.add_argument('--shard-index', type=int, default=0)
    args = parser.parse_args(argv)
    _shard_bounds(args.shard_count, args.shard_index)
    inventory(ROOT / 'tests')
    if not labels(args.suite):
        raise RuntimeError('EMPTY_SPECIALIZED_SUITE')
    native = Path(os.environ['PARAMETER_TEST_RUNTIME_ROOT']).resolve()
    sock = os.environ.get('PARAMETER_TEST_SOCKET', '')
    if not str(native).startswith('/dev/shm/alisa-parameter-ci-') or not (native / 'parameter_report_runtime.py').is_file():
        raise RuntimeError('PINNED_TEST_NATIVE_REQUIRED')
    if not sock.startswith('/dev/shm/alisa-current-parameters-pg-ci-') or not Path(sock).is_dir():
        raise RuntimeError('OWN_TEST_POSTGRES_REQUIRED')
    sys.path[:0] = [str(native), str(native / 'tests'), str(REPO / 'docs/alisa/runtime/v0.11/current_parameters_r4/tests')]
    attempts = []
    original = socket.socket.connect

    def connect(self, address):
        if self.family != socket.AF_UNIX:
            attempts.append('non-unix')
            raise AssertionError('EXTERNAL_NETWORK_PROHIBITED')
        return original(self, address)

    start = time.monotonic()
    with patch.object(socket.socket, 'connect', connect), patch('socket.getaddrinfo', side_effect=AssertionError('DNS_PROHIBITED')):
        if args.suite == 'ledger':
            loaded = unittest.TestLoader().loadTestsFromNames(labels(args.suite))
            selected, coverage = select_shard(loaded, args.shard_count, args.shard_index)
            result = unittest.TextTestRunner(verbosity=2, resultclass=RecordingResult).run(selected)
        else:
            os.environ['DJANGO_SETTINGS_MODULE'] = {'base': 'economics_cohort.settings', 'collection': 'current_parameters.collection_settings', 'compound': 'parameter_compound.settings'}[args.suite]
            import django
            django.setup()
            from django.test.runner import DiscoverRunner
            from django.core.management import call_command

            class Capture(DiscoverRunner):
                def build_suite(self, *build_args, **kwargs):
                    loaded = super().build_suite(*build_args, **kwargs)
                    selected, self.coverage = select_shard(loaded, args.shard_count, args.shard_index)
                    return selected

                def get_resultclass(self):
                    return RecordingResult

                def run_suite(self, suite, **kwargs):
                    self.result = super().run_suite(suite, **kwargs)
                    return self.result

            call_command('makemigrations', 'owner_data', check=True, dry_run=True, verbosity=1)
            runner = Capture(verbosity=2, interactive=False)
            runner.run_tests(labels(args.suite))
            result, coverage = runner.result, runner.coverage
    executed = execution_coverage(result, coverage)
    status = 'PASS' if (result.wasSuccessful() and result.testsRun > 0 and not result.skipped
                        and not attempts and executed['execution_complete']) else 'FAIL'
    receipt = {'utc': datetime.now(timezone.utc).isoformat(), 'suite': args.suite, 'status': status,
               'tests': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors),
               'skipped': len(result.skipped), 'external_connections': len(attempts),
               'elapsed_seconds': round(time.monotonic() - start, 3), 'live_configuration_loaded': False,
               **coverage, **executed}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt))
    return 0 if status == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
