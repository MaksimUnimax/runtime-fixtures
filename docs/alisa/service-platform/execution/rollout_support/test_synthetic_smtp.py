import importlib.util
from email.message import EmailMessage
import os
from pathlib import Path
import smtplib
import tempfile
import threading
import unittest

spec = importlib.util.spec_from_file_location('synthetic_smtp', Path(__file__).with_name('synthetic_smtp.py'))
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)

class SandboxTests(unittest.TestCase):
    def test_private_delivery_and_real_recipient_denial(self):
        with tempfile.TemporaryDirectory() as temp:
            with module.Server(('127.0.0.1', 0), temp) as server:
                thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
                try:
                    msg = EmailMessage(); msg['From'] = 'alisa-test@example.invalid'; msg['To'] = 'receiver@example.invalid'; msg.set_content('synthetic fixture')
                    with smtplib.SMTP(*server.server_address, timeout=3) as smtp:
                        smtp.send_message(msg)
                        with self.assertRaises(smtplib.SMTPRecipientsRefused):
                            smtp.sendmail('alisa-test@example.invalid', ['real@example.com'], msg.as_bytes())
                    files = list(Path(temp).glob('*.eml'))
                    self.assertEqual(len(files), 1)
                    self.assertEqual(files[0].stat().st_mode & 0o777, 0o600)
                    self.assertEqual(Path(temp).stat().st_mode & 0o777, 0o700)
                    self.assertIn(b'synthetic fixture', files[0].read_bytes())
                finally: server.shutdown()

    def test_header_mismatch_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            with module.Server(('127.0.0.1', 0), temp) as server:
                msg = EmailMessage(); msg['To'] = 'real@example.com'; msg.set_content('fixture')
                with self.assertRaises(ValueError): server.store(msg.as_bytes())
                self.assertEqual(list(Path(temp).glob('*.eml')), [])

if __name__ == '__main__': unittest.main()
