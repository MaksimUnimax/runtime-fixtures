"""Private, non-relaying SMTP sandbox. Deliberately admits example.invalid only."""
import argparse
from email import policy
from email.parser import BytesParser
from email.utils import getaddresses
import os
from pathlib import Path
import re
import socketserver
import threading
import uuid

class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True
    def __init__(self, address, inbox):
        self.inbox = Path(inbox)
        self.inbox.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.inbox.chmod(0o700)
        self.store_lock = threading.Lock()
        super().__init__(address, SMTP)

    def store(self, data):
        message = BytesParser(policy=policy.default).parsebytes(data)
        addresses = getaddresses(message.get_all('to', []) + message.get_all('cc', []))
        if not addresses or any(not address.lower().endswith('@example.invalid') for _, address in addresses):
            raise ValueError('Synthetic headers required')
        with self.store_lock:
            if len(list(self.inbox.glob('*.eml'))) >= 200:
                raise OSError('Sandbox is full')
            target = self.inbox / (uuid.uuid4().hex + '.eml')
            fd = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, 'wb') as stream:
                stream.write(data)

class SMTP(socketserver.StreamRequestHandler):
    def handle(self):
        self.connection.settimeout(15)
        self.wfile.write(b'220 private synthetic sink\r\n')
        recipient = False
        try:
            while line := self.rfile.readline(8193):
                if len(line) > 8192:
                    self.wfile.write(b'500 line too long\r\n'); break
                command = line.split(b' ', 1)[0].strip().upper()
                if command in {b'EHLO', b'HELO'}:
                    self.wfile.write(b'250-localhost\r\n250 SIZE 65536\r\n')
                elif command == b'MAIL':
                    recipient = False
                    self.wfile.write(b'250 OK\r\n')
                elif command == b'RCPT':
                    match = re.fullmatch(rb'RCPT\s+TO:\s*<([^<>\r\n]+@example\.invalid)>\s*', line.strip(), re.I)
                    recipient = bool(match)
                    self.wfile.write(b'250 OK\r\n' if recipient else b'550 synthetic recipients only\r\n')
                elif command == b'RSET':
                    recipient = False
                    self.wfile.write(b'250 OK\r\n')
                elif command == b'NOOP':
                    self.wfile.write(b'250 OK\r\n')
                elif command == b'DATA' and recipient:
                    self.wfile.write(b'354 send data\r\n')
                    data = bytearray(); too_large = False
                    while (part := self.rfile.readline(65538)) not in {b'.\r\n', b''}:
                        if len(data) + len(part) > 65536:
                            too_large = True
                        elif not too_large:
                            data.extend(part[1:] if part.startswith(b'..') else part)
                    if not part: break
                    try:
                        if too_large: raise ValueError('Message too large')
                        self.server.store(bytes(data))
                        self.wfile.write(b'250 accepted\r\n')
                    except ValueError:
                        self.wfile.write(b'550 invalid synthetic message\r\n')
                    except OSError:
                        self.wfile.write(b'452 sandbox unavailable\r\n')
                    recipient = False
                elif command == b'QUIT':
                    self.wfile.write(b'221 bye\r\n'); break
                else:
                    self.wfile.write(b'503 invalid command sequence\r\n')
        except (OSError, TimeoutError):
            pass  # Never log message contents, contacts or confirmation tokens.

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--inbox', required=True, type=Path)
    args = parser.parse_args()
    if not args.inbox.is_absolute(): raise SystemExit('Absolute inbox required')
    with Server(('127.0.0.1', 18225), args.inbox) as server:
        server.serve_forever()
