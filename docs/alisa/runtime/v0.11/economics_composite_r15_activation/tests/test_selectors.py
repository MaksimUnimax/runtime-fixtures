"""Observed selector structure and its effective-unit consumers; no host writes."""
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch
import sys
import unittest

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
import activate as a
c = a.c

OLD = '/opt/synthetic/releases/old-authority-release'
NEW = '/opt/synthetic/releases/new-authority-release'
OLD_NAME, NEW_NAME = Path(OLD).name, Path(NEW).name


def command(base=OLD):
    return (base+'/.venv/bin/python -B -m gunicorn synthetic_wsgi:application '
            '--pythonpath '+base+'/services/platform --env KEEP=unchanged '
            '--env ALISA_RELEASE='+Path(base).name+
            ' --bind unix:/run/synthetic.sock --workers 1 --timeout 10')


def selector(role='authority'):
    if role == 'platform':
        return ('[Service]\nWorkingDirectory='+OLD+'\nExecStart=\nExecStart='+OLD+
                '/.venv/bin/python -B '+OLD+'/platform.py --workers 1\n').encode()
    return ('# Synthetic authority source only\n[Service]\nWorkingDirectory='+OLD+
            '/services/platform\nEnvironment=ALISA_RELEASE='+OLD_NAME+
            '\nExecStart=\nExecStart='+command()+'\n\nEnvironmentFile='+
            c.SELECTOR_ENV_FILES['authority'][0]+'\n\nEnvironmentFile='+
            c.SELECTOR_ENV_FILES['authority'][1]+'\n').encode()


def host_and_plan(role='authority'):
    host = object.__new__(a.LiveHost)
    host.baseline = {'bases': {role: {'root': OLD}}}
    host.targets = {role: Path(NEW)}
    host.desired = {role+'_selector': c.selector_bytes(selector(role), OLD, NEW, role=role)}
    files = c.SELECTOR_ENV_FILES[role]
    before = {'WorkingDirectory': OLD+'/services/platform', 'command': {'path': 'old', 'argv': 'old'},
              'DropInPaths': '/synthetic/original.conf', 'source_hashes': {'/synthetic/original.conf': 'old'},
              'EnvironmentFiles': '\n'.join(path+' (ignore_errors=no)' for path in files),
              'environment_stats': {path: {'unchanged': path} for path in files}, 'User': 'synthetic'}
    planned = {'before': {'units': {role: before}},
               'target_commands': {role: {'path': 'new-path', 'argv': 'new-argv'}}}
    return host, planned


class Selectors(unittest.TestCase):
    def test_platform_preserves_its_exact_existing_arguments(self):
        raw = selector('platform')
        self.assertEqual(c.selector_bytes(raw, OLD, NEW, role='platform'),
            raw.replace(OLD.encode(), NEW.encode())+('EnvironmentFile='+str(c.FLAG_FILE)+'\n').encode())

    def test_authority_preserves_comments_blanks_envfiles_and_rewrites_both_release_forms(self):
        raw = selector()
        result = c.selector_bytes(raw, OLD, NEW, role='authority')
        expected = raw.replace(OLD.encode(), NEW.encode()).replace(
            ('ALISA_RELEASE='+OLD_NAME).encode(), ('ALISA_RELEASE='+NEW_NAME).encode())
        self.assertEqual(result, expected+('EnvironmentFile='+str(c.FLAG_FILE)+'\n').encode())
        self.assertEqual(result.count(('ALISA_RELEASE='+NEW_NAME).encode()), 2)
        self.assertNotIn(OLD_NAME.encode(), result)
        self.assertIn(b'--env KEEP=unchanged', result)

    def test_unknown_directives_values_order_resets_and_control_characters_fail_closed(self):
        raw = selector()
        first, second = (('EnvironmentFile='+x).encode() for x in c.SELECTOR_ENV_FILES['authority'])
        variants = [raw+b'User=root\n', raw+b'Environment=OTHER=value\n', raw+b'EnvironmentFile=\n',
            raw.replace(first, first+b'\n'+first),
            raw.replace(first, b'__FIRST__').replace(second, first).replace(b'__FIRST__', second),
            raw.replace(first, b'EnvironmentFile=-'+c.SELECTOR_ENV_FILES['authority'][0].encode()),
            raw.replace(first, b'EnvironmentFile=/unlisted.env'), raw.replace(b'ExecStart=\n', b''),
            raw.replace(b'[Service]', b'[Unit]'), raw+b'[Service]\n', raw[:-1],
            raw.replace(b'\n', b'\r\n'), raw+b'\x00\n', raw+b'\\\n', raw+b' \n',
            raw.replace(('Environment=ALISA_RELEASE='+OLD_NAME).encode(), b'Environment=ALISA_RELEASE=foreign')]
        for value in variants:
            with self.subTest(value=value), self.assertRaises(c.Blocked):
                c.selector_bytes(value, OLD, NEW, role='authority')
        with self.assertRaises(c.Blocked):
            c.selector_bytes(raw, OLD, NEW, role='platform')

    def test_exact_existing_env_argument_is_required_without_substring_relabel(self):
        raw = selector()
        assignment = ('--env ALISA_RELEASE='+OLD_NAME).encode()
        variants = [b'--other ALISA_RELEASE='+OLD_NAME.encode(), assignment+b'-suffix',
                    b'--env ALISA_RELEASE=foreign', assignment+b' '+assignment,
                    b'--env "ALISA_RELEASE='+OLD_NAME.encode()+b'"',
                    assignment+b' --unrelated '+OLD_NAME.encode()]
        for value in variants:
            with self.subTest(value=value), self.assertRaises(c.Blocked):
                c.selector_bytes(raw.replace(assignment, value), OLD, NEW, role='authority')

    def test_release_command_preserves_spacing_and_all_other_arguments(self):
        raw = command().replace('--env ALISA_RELEASE=', '--env\tALISA_RELEASE=')
        expected = raw.replace(OLD, NEW).replace('ALISA_RELEASE='+OLD_NAME, 'ALISA_RELEASE='+NEW_NAME)
        self.assertEqual(c.rewrite_release_command(raw, OLD, NEW, release_env=True), expected)
        with self.assertRaises(c.Blocked):
            c.rewrite_release_command(raw, OLD, NEW)

    def test_unit_static_target_hash_uses_the_same_release_path_and_env_rewrite(self):
        properties = {'WorkingDirectory': OLD+'/services/platform', 'FragmentPath': '/synthetic/unit.service',
            'DropInPaths': '/synthetic/original.conf', 'EnvironmentFiles': '', 'User': 'synthetic',
            'Group': 'synthetic', 'DynamicUser': 'no', 'UnsetEnvironment': '',
            'ExecStart': '{ path='+OLD+'/.venv/bin/python ; argv[]='+command()+' ; ignore_errors=no ; }'}
        with patch.object(a, 'prop', side_effect=lambda unit, key: properties[key]), \
             patch.object(a, 'regular', return_value=b'synthetic pinned source'):
            actual = a.unit_static(c.UNITS['authority'], rewrite=(OLD, NEW))
        self.assertEqual(actual['command'], {'path': c.digest((NEW+'/.venv/bin/python').encode()),
            'argv': c.digest(command(NEW).encode())})

    def test_expected_authority_unit_appends_inherited_envfiles_in_order_with_duplicates(self):
        host, planned = host_and_plan()
        before = deepcopy(planned)
        with patch.object(a, 'metadata', return_value={'flags': 'new'}):
            expected = host.expected_unit('authority', planned)
        files = a._environment_paths(expected['EnvironmentFiles'])
        self.assertEqual(files, [*c.SELECTOR_ENV_FILES['authority'],
            *c.SELECTOR_ENV_FILES['authority'], str(c.FLAG_FILE)])
        self.assertEqual(expected['command'], planned['target_commands']['authority'])
        for path in c.SELECTOR_ENV_FILES['authority']:
            self.assertEqual(expected['environment_stats'][path], {'unchanged': path})
        self.assertEqual(planned, before)

    def test_expected_platform_unit_appends_only_new_flags(self):
        host, planned = host_and_plan('platform')
        with patch.object(a, 'metadata', return_value={'flags': 'new'}):
            expected = host.expected_unit('platform', planned)
        self.assertEqual(a._environment_paths(expected['EnvironmentFiles']), [str(c.FLAG_FILE)])

    def test_missing_old_environment_metadata_blocks_before_new_unit_acceptance(self):
        host, planned = host_and_plan()
        planned['before']['units']['authority']['environment_stats'].clear()
        with self.assertRaises(c.Blocked) as caught:
            host.expected_unit('authority', planned)
        self.assertEqual(caught.exception.code, 'SELECTOR_ENVIRONMENT_CHANGED')

    def test_recovery_expected_unit_remains_exact_old_descriptor(self):
        host, planned = host_and_plan()
        with patch.object(a, 'metadata', side_effect=AssertionError('old source has no new flag lookup')):
            self.assertEqual(host.expected_unit('authority', planned, old=True),
                             planned['before']['units']['authority'])

    def test_validate_start_rejects_missing_duplicate_and_old_release_command_hash(self):
        host, planned = host_and_plan()
        host.unit_files_unchanged = lambda before: None
        with patch.object(a, 'metadata', return_value={'flags': 'new'}):
            good = host.expected_unit('authority', planned)
            missing = deepcopy(good)
            missing['EnvironmentFiles'] = '\n'.join(path+' (ignore_errors=no)' for path in
                (*c.SELECTOR_ENV_FILES['authority'], str(c.FLAG_FILE)))
            old_release = deepcopy(good)
            old_release['command']['argv'] = c.digest(command().replace(OLD, NEW).encode())
            for actual in (missing, old_release):
                with self.subTest(actual=actual), patch.object(a, 'unit_static', return_value=actual), \
                     self.assertRaises(c.Blocked) as caught:
                    host.validate_start('authority', planned)
                self.assertEqual(caught.exception.code, 'START_UNIT_CHANGED')


if __name__ == '__main__':
    unittest.main()
