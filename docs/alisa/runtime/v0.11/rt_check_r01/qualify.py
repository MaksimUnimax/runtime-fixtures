"""Finite source qualification, with safe receipts and no live credentials."""
import argparse
import json
from pathlib import Path
import sys
import unittest


class Evidence(unittest.TextTestResult):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.cases = []

    def addSuccess(self, test):
        super().addSuccess(test); self.cases.append({'case': test.id(), 'passed': True})

    def addFailure(self, test, error):
        super().addFailure(test, error); self.cases.append({'case': test.id(), 'passed': False, 'kind': 'FAILURE'})

    def addError(self, test, error):
        super().addError(test, error); self.cases.append({'case': test.id(), 'passed': False, 'kind': 'ERROR'})


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--output', type=Path, required=True); args = parser.parse_args()
    suite = unittest.defaultTestLoader.discover(str(Path(__file__).with_name('tests')))
    result = unittest.TextTestRunner(verbosity=2, resultclass=Evidence).run(suite)
    record = {'scope': 'RT_CHECK_SOURCE_REAL_LOOPBACK_TLS_UNIX_NOT_LIVE_PROVIDER_NOT_INSTALLED',
        'status': 'PASS' if result.wasSuccessful() and not result.skipped else 'FAILED',
        'cases': result.cases, 'tests_run': result.testsRun, 'skipped': len(result.skipped),
        'external_provider_calls': 0,
        'limits': ['Seller promotion requires separately qualified header-pair binding.',
            'Performance token issuance never establishes Seller cabinet identity.',
            'No working server, real key, matrix job or report was used.']}
    args.output.parent.mkdir(parents=True, exist_ok=True); args.output.write_text(json.dumps(record, indent=2)+'\n')
    return 0 if record['status'] == 'PASS' else 1


if __name__ == '__main__':sys.exit(main())
