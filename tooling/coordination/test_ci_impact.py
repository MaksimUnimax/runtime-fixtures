import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from ci_impact import analyze, classify, git, parse_raw_diff, prose_path


class ImpactTests(unittest.TestCase):
    def test_explicit_prose_allowlist(self):
        for path in ['README.md', 'docs/README.md',
                     'docs/development/coordination/receipts/A/A_RESULT.md']:
            with self.subTest(path=path):
                self.assertTrue(prose_path(path))

    def test_authority_unknown_and_confusing_paths_require_full(self):
        for path in ['AGENTS.md', 'docs/product/SPEC.md',
                     'docs/development/coordination/receipts/A/input.json',
                     'docs/development/coordination/receipts/A/nested/code.md',
                     'docs/development/coordination/receipts/A/.hidden.md',
                     'apps/api/README.md', '.github/workflows/server-ci.yml',
                     'pnpm-lock.yaml', 'tooling/coordination/ci_gate.py',
                     'README.md\napps/api/index.ts', '../README.md',
                     './README.md', '/README.md', 'docs//README.md', None]:
            with self.subTest(path=path):
                self.assertFalse(prose_path(path))

    def test_nonregular_modes_and_unknown_status_fail_closed(self):
        for status, old, new in [('M', '100644', '100755'),
                                 ('A', '000000', '120000'),
                                 ('M', '160000', '160000'), ('R100', '100644', '100644')]:
            report = classify([{'path': 'README.md', 'status': status,
                                'oldMode': old, 'newMode': new}])
            self.assertEqual(report['impactClass'], 'FULL')
            self.assertFalse(report['canAuthorizeSkip'])

    def test_no_prior_pass_can_be_inferred_from_empty_diff(self):
        self.assertEqual(classify([])['impactClass'], 'FULL')

    def test_parser_rejects_partial_and_bad_object_ids(self):
        with self.assertRaises(ValueError):
            parse_raw_diff(b':100644 100644 x y M\0README.md\0')
        with self.assertRaises(ValueError):
            parse_raw_diff(b':100644 100644 ' + b'a' * 40 + b' ' + b'b' * 40
                           + b' M\0README.md')

    def test_errors_never_report_prose(self):
        self.assertEqual(analyze('/missing', 'a' * 40, 'b' * 40)['impactClass'], 'FULL')
        self.assertEqual(analyze('.', '0' * 40, 'b' * 40)['impactClass'], 'FULL')
        self.assertEqual(analyze('.', '--help', 'b' * 40)['impactClass'], 'FULL')
        with patch('ci_impact.git', side_effect=OSError('unavailable')):
            self.assertEqual(analyze('.', 'a' * 40, 'b' * 40)['impactClass'], 'FULL')


class RealGitTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='octoport-ci-impact-')
        self.addCleanup(self.temporary.cleanup)
        self.repo = Path(self.temporary.name)
        git(self.repo, 'init', '-q')
        git(self.repo, 'config', 'user.name', 'CI impact test')
        git(self.repo, 'config', 'user.email', 'fixture@example.invalid')
        self.write('README.md', 'initial\n')
        self.base = self.commit()

    def write(self, path, content):
        target = self.repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)

    def commit(self):
        git(self.repo, 'add', '--all')
        git(self.repo, 'commit', '-q', '-m', 'fixture')
        return git(self.repo, 'rev-parse', 'HEAD').decode().strip()

    def check(self, base, head, expected):
        value = analyze(self.repo, base, head)
        self.assertEqual(value['impactClass'], expected, value)
        self.assertTrue(value['advisoryOnly'])
        self.assertFalse(value['canAuthorizeSkip'])
        return value

    def test_report_only_commit(self):
        self.write('docs/development/coordination/receipts/C/RESULT.md', '# Report\n')
        self.check(self.base, self.commit(), 'PROSE_ONLY')

    def test_mixed_runtime_commit(self):
        self.write('README.md', 'updated\n')
        self.write('apps/api/src/main.ts', 'export const version = 1;\n')
        self.check(self.base, self.commit(), 'FULL')

    def test_json_receipt_is_not_prose(self):
        self.write('docs/development/coordination/receipts/C/input.json', '{}')
        self.check(self.base, self.commit(), 'FULL')

    def test_runtime_moved_to_readme_is_still_full(self):
        self.write('apps/api/src/main.ts', 'runtime')
        previous = self.commit()
        (self.repo / 'apps/api/src/main.ts').replace(self.repo / 'README.md')
        self.check(previous, self.commit(), 'FULL')

    def test_readme_moved_to_runtime_is_full(self):
        (self.repo / 'apps').mkdir()
        (self.repo / 'README.md').replace(self.repo / 'apps/readme.ts')
        self.check(self.base, self.commit(), 'FULL')

    def test_executable_prose_is_full(self):
        (self.repo / 'README.md').chmod(0o755)
        self.check(self.base, self.commit(), 'FULL')

    def test_symlink_prose_is_full(self):
        (self.repo / 'README.md').unlink()
        os.symlink('apps/api/src/main.ts', self.repo / 'README.md')
        self.check(self.base, self.commit(), 'FULL')

    def test_reverse_or_empty_range_is_not_acceptance(self):
        self.write('README.md', 'updated\n')
        head = self.commit()
        self.check(head, self.base, 'FULL')
        self.check(head, head, 'FULL')

    def test_caller_supplied_branch_is_rejected(self):
        self.check(self.base, 'HEAD', 'FULL')

    def test_prose_delete_retains_conservative_contract(self):
        (self.repo / 'README.md').unlink()
        self.check(self.base, self.commit(), 'PROSE_ONLY')


if __name__ == '__main__':
    unittest.main()
