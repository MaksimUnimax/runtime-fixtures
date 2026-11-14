"""Production-shaped UID/GID startup proof in a disposable mount/net namespace."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time


def main():
    if (os.geteuid() != 0 or os.environ.get('ALISA_ISOLATED_SOCKET_TEST') != '1'
            or os.readlink('/proc/self/ns/net') == os.readlink('/proc/1/ns/net')
            or not any(line.split()[4] == '/run/alisa-station'
                       for line in Path('/proc/self/mountinfo').read_text().splitlines())):
        raise RuntimeError('DISPOSABLE_NAMESPACE_REQUIRED')
    source, output = map(Path, sys.argv[1:])
    os.setgid(40002)
    run = Path('/run/alisa-station'); os.chown(run, 0, 40002)
    client = '''import json,socket,sys
try:
 with socket.socket(socket.AF_UNIX)as s:
  s.connect(sys.argv[1]);s.sendall(b'{"op":"admit","tenant":"synthetic","conversation":"session-test","rid":"request-test"}\\n')
  print(s.recv(4000).decode().strip())
except PermissionError:print('ACL_DENIED')
'''
    checks = []
    with tempfile.TemporaryDirectory(prefix='station-startup-') as temp:
        root = Path(temp); key = root/'key'
        from cryptography.fernet import Fernet
        key.write_bytes(Fernet.generate_key()); key.chmod(0o600)
        for attempt in range(2):
            state = root/str(attempt); state.mkdir()
            code = ("import sys,pwd;from types import SimpleNamespace;"
                    "original=pwd.getpwnam;pwd.getpwnam=lambda n:SimpleNamespace(pw_uid=40001) if n=='alice-market' else original(n);"
                    "sys.path.insert(0,sys.argv[1]);import service;"
                    "sys.argv=['service.py','--state',sys.argv[2],'--key',sys.argv[3]];service.main()")
            process = subprocess.Popen([sys.executable, '-B', '-c', code, str(source), str(state), str(key)],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
            try:
                for _ in range(80):
                    if process.poll() is not None:
                        raise RuntimeError('STARTUP_FAILED:' + process.stderr.read()[-1000:])
                    if (run/'authorization.sock').exists() and (run/'ingress.sock').exists():
                        break
                    time.sleep(.05)
                else:
                    raise RuntimeError('STARTUP_TIMEOUT')
                assert run.stat().st_mode & 0o777 == 0o710
                assert (run/'authorization.sock').stat().st_mode & 0o777 == 0o660
                assert (run/'ingress.sock').stat().st_mode & 0o777 == 0o700
                base = ['/usr/bin/setpriv', '--reuid=40001', '--regid=40002', '--clear-groups', '/usr/bin/python3', '-c', client]
                accepted = subprocess.check_output(base + [str(run/'authorization.sock')], text=True).strip()
                denied = subprocess.check_output(base + [str(run/'ingress.sock')], text=True).strip()
                assert json.loads(accepted) == {'guard': None} and denied == 'ACL_DENIED'
                with socket.socket(socket.AF_UNIX) as stream:
                    stream.connect(str(run/'authorization.sock'))
                    stream.sendall(b'{"op":"admit","tenant":"synthetic","conversation":"session-test","rid":"request-test"}\n')
                    assert json.loads(stream.recv(4000)) == {'error': 'authority_unavailable'}
                checks.append({'startup': attempt + 1, 'core_uid_allowed': True, 'wrong_uid_denied': True,
                               'original_ingress_acl_unchanged': True, 'empty_binding_granted_nothing': True})
            finally:
                process.terminate()
                try:
                    process.wait(5)
                except subprocess.TimeoutExpired:
                    process.kill(); process.wait(2)
                process.stderr.close()
            # The real service has RuntimeDirectoryPreserve=no. Recreate that
            # exact clean-directory precondition only inside the private mount.
            for name in ('authorization.sock', 'ingress.sock'):
                (run/name).unlink()
    value = {'status': 'PASS', 'checks': checks, 'external_calls': 0, 'live_state_read': False}
    output.write_text(json.dumps(value, indent=2)+'\n')
    print(json.dumps(value))


if __name__ == '__main__':
    main()
