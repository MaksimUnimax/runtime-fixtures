"""Actual umask/Unix-socket regressions and bounded fixture diagnostics only."""
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import json
import os
import socket
import stat
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import native_credential_gate as gate


class CredentialGateSetup(unittest.TestCase):
    def test_actual_unix_peer_accepts_path_and_string_with_matching_credentials(self):
        with tempfile.TemporaryDirectory(prefix='r15-gate-peer-') as directory:
            path = Path(directory)/'peer.sock'
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as listener:
                listener.settimeout(1)
                listener.bind(str(path))
                listener.listen(2)
                for address in (path, str(path)):
                    with self.subTest(input_type=type(address).__name__):
                        self.assertEqual(gate.peer(address), (os.getpid(), os.getuid()))
                        connection, _ = listener.accept()
                        connection.close()

    def test_real_umask_0077_requires_explicit_mode_on_both_cwds(self):
        with tempfile.TemporaryDirectory(prefix='r15-gate-umask-') as directory:
            root = Path(directory)
            before = os.umask(0o077)
            try:
                legacy = root/'legacy'
                legacy.mkdir(mode=0o555)
                self.assertEqual(stat.S_IMODE(legacy.stat().st_mode), 0o500)
                for name in ('release', 'wrong-release'):
                    path = root/name
                    gate.make_immutable_cwd(path)
                    info = path.lstat()
                    self.assertTrue(stat.S_ISDIR(info.st_mode))
                    self.assertEqual(info.st_uid, os.getuid())
                    self.assertEqual(stat.S_IMODE(info.st_mode), 0o555)
                    self.assertTrue(info.st_mode & stat.S_IXOTH)
            finally:
                os.umask(before)

    def test_existing_directory_is_not_adopted_or_chmodded(self):
        with tempfile.TemporaryDirectory(prefix='r15-gate-existing-') as directory:
            path = Path(directory)/'existing'
            path.mkdir(mode=0o700)
            with self.assertRaises(FileExistsError): gate.make_immutable_cwd(path)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o700)

    def test_command_error_returns_fixed_classification_and_numeric_status_only(self):
        result = SimpleNamespace(returncode=1, stdout=b'PRIVATE_STDOUT',
                                 stderr=b'Failed at step CHDIR spawning /private/SECRET_VALUE')
        with patch.object(gate.subprocess, 'run', return_value=result):
            with self.assertRaises(gate.FixtureCommandFailure) as caught:
                gate.command('/usr/bin/systemd-run', 'PRIVATE_ARG')
        self.assertEqual(caught.exception.public, {'operation': 'PRODUCER_START', 'exit_status': 1,
                                                  'error_code': 'EXEC_CHDIR', 'timed_out': False})
        text = json.dumps(caught.exception.public)
        self.assertNotIn('PRIVATE', text)
        self.assertNotIn('SECRET', text)
        self.assertNotIn('/private', text)

    def test_timeout_never_reflects_exception_command_or_output(self):
        error = subprocess.TimeoutExpired(['PRIVATE_ARG'], 2, output=b'PRIVATE_STDOUT', stderr=b'PRIVATE_STDERR')
        with patch.object(gate.subprocess, 'run', side_effect=error):
            with self.assertRaises(gate.FixtureCommandFailure) as caught:
                gate.command('/usr/bin/systemctl', 'restart', 'PRIVATE_ARG')
        self.assertEqual(caught.exception.public, {'operation': 'PRODUCER_RESTART', 'exit_status': None,
                                                  'error_code': 'TIMEOUT', 'timed_out': True})
        self.assertNotIn('PRIVATE', json.dumps(caught.exception.public))

    def test_unit_diagnostics_have_fixed_scope_and_whitelisted_values(self):
        unit = 'alisa-r15-native-credential-ci-12-1-native.service'
        raw = (b'LoadState=loaded\nActiveState=failed\nSubState=PRIVATE_PAYLOAD\nResult=exit-code\n'
               b'ExecMainStatus=200\nMainPID=0\nTransient=yes\nDescription=PRIVATE_DESCRIPTION\n'
               b'InvocationID='+b'a'*32+b'\n')
        with patch.object(gate, 'command', return_value=raw) as command:
            value = gate.failed_unit_metadata(unit)
            self.assertEqual(command.call_args.kwargs['timeout'], 5)
            self.assertEqual(value['ExecMainStatus'], 200)
            self.assertEqual(value['SubState'], 'UNRECOGNIZED')
            self.assertNotIn('Description', value)
            self.assertNotIn('PRIVATE', json.dumps(value))
            command.reset_mock()
            with self.assertRaisesRegex(RuntimeError, 'FIXTURE_DIAGNOSTIC_SCOPE'):
                gate.failed_unit_metadata('alice-market.service')
            command.assert_not_called()

    def test_oversized_command_output_is_not_retained(self):
        result = SimpleNamespace(returncode=0, stdout=b'x'*16385, stderr=b'PRIVATE_STDERR')
        with patch.object(gate.subprocess, 'run', return_value=result):
            with self.assertRaises(gate.FixtureCommandFailure) as caught:
                gate.command('/usr/bin/systemd', '--version')
        self.assertEqual(caught.exception.public['error_code'], 'OUTPUT_BOUND')
        self.assertLess(len(json.dumps(caught.exception.public)), 200)


if __name__ == '__main__':
    unittest.main()
