"""No real credentials: validate safety boundaries of terminal intake."""
import importlib.util
import os
from pathlib import Path
import pty
import select
import signal
import subprocess
import sys
import tempfile
import termios
import time
import unittest

SCRIPT = Path(__file__).with_name('fill_marketplace_json.py')
spec = importlib.util.spec_from_file_location('intake', SCRIPT)
intake = importlib.util.module_from_spec(spec)
spec.loader.exec_module(intake)


class IntakeTests(unittest.TestCase):
    def test_invalid_inputs_never_include_contents(self):
        for raw in [b'{"SECRET_SENTINEL":', b'null', b'{}', b'[]', b'{"a":NaN}',
                    b'{"a":1,"a":2}', b'\xff']:
            with self.assertRaises(intake.IntakeError) as error:
                intake.validate(raw)
            self.assertNotIn('SECRET_SENTINEL', str(error.exception))

    def test_atomic_private_save_and_symlink_refusal(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'private'
            raw = b'{"fixture": "synthetic"}\n'
            intake.validate(raw)
            intake.save(raw, root, 'ozon.json')
            self.assertEqual((root / 'ozon.json').read_bytes(), raw)
            self.assertEqual(root.stat().st_mode & 0o777, 0o700)
            self.assertEqual((root / 'ozon.json').stat().st_mode & 0o777, 0o600)
            (root / 'wb.json').symlink_to(root / 'ozon.json')
            with self.assertRaises(intake.IntakeError):
                intake.save(b'changed', root, 'wb.json')
            self.assertEqual((root / 'ozon.json').read_bytes(), raw)
            link = Path(tmp) / 'alias'
            link.symlink_to(root)
            with self.assertRaises(intake.IntakeError):
                intake.save(raw, link, 'alias.json')

    def run_tty(self, payload, cancel=False):
        master, slave = pty.openpty()
        before = termios.tcgetattr(slave)
        code = ('import importlib.util,sys; '
                's=importlib.util.spec_from_file_location("i",sys.argv[1]); '
                'm=importlib.util.module_from_spec(s);s.loader.exec_module(m); '
                'r=m.hidden_json(0);m.validate(r);print("BYTES",len(r))')
        proc = subprocess.Popen([sys.executable, '-c', code, str(SCRIPT)],
                                stdin=slave, stdout=slave, stderr=slave)
        output = bytearray()
        try:
            deadline = time.monotonic() + 8
            while 'Для отмены'.encode() not in output:
                self.assertLess(time.monotonic(), deadline)
                if select.select([master], [], [], .1)[0]:
                    output.extend(os.read(master, 4096))
            offset = 0
            while offset < len(payload):
                offset += os.write(master, payload[offset:offset + 1000])
            if cancel:
                proc.send_signal(signal.SIGINT)
            proc.wait(timeout=5)
            while select.select([master], [], [], .05)[0]:
                output.extend(os.read(master, 4096))
            self.assertEqual(termios.tcgetattr(slave), before)
            self.assertNotIn(b'SECRET_SENTINEL', output)
            return proc.returncode, bytes(output)
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.wait()
            os.close(master)
            os.close(slave)

    def test_hidden_multiline_and_long_line(self):
        raw = b'{\n"SECRET_SENTINEL": "' + b'x' * 16000 + b'"\n}\n'
        status, output = self.run_tty(raw + 'КОНЕЦ\n'.encode())
        self.assertEqual(status, 0)
        self.assertIn(('BYTES ' + str(len(raw))).encode(), output)

    def test_cancel_restores_terminal(self):
        status, _ = self.run_tty(b'{"SECRET_SENTINEL": "partial', cancel=True)
        self.assertNotEqual(status, 0)

    def test_non_terminal_rejected(self):
        result = subprocess.run([sys.executable, str(SCRIPT)], input=b'{}\n',
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertEqual(result.returncode, 2)


if __name__ == '__main__':
    unittest.main()
