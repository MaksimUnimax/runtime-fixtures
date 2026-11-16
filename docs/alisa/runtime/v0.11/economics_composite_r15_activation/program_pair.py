"""Pinned broker/client pairing and finite rollout ordering; no import effects.

The observer passed to inspect_pair is read-only. The rollover port is an
explicit product-installation adapter, not a scheduler. Neither function reads
owner result payloads, sends a request, nor creates an access grant.
"""
import hashlib
import re

ROOT = '/opt/alisa-program/releases/20261116-recovery-ca15c4d2'
CLIENT_SHA256 = '27c609e73a1aa9faef7f064520b4833845500b3078c8092d9bde1bd58ad01c19'
FILES = {
    'manifest.json': 'bd982ddb2a3a84697177433877dbf475cee5cc462a02e6b9739b5f663c9524e0',
    'INSTALLED_MANIFEST.json': '52ad8cf2aac266f7b483afd8291b4fd6b652e93861c79109bdd6c666f2f150d8',
    'harness.patch.yml': 'c401e45cc54cccdba29d33a5cf1bc65f35090f9b874a06c32711a1ae0c8b5d5f',
    'program_broker.py': '70f50e3345c2408e039dd7811ecf1282f8b606990d2ec96e931291708ac41423',
    'program_results.py': '1bf19d8d15587efecc88a4b1cf5c2609c5731a7fc7dcf2e4f7152a9b565ae952',
    'program_worker.py': 'e9e0ca2d233f41c7bcc1e554406a6265d85c7abe2bca42b8ab80ffebdbc096fd',
    'test_result_retention.py': '4cfeb490ab90394f899e50e69a3b490df151a4c52b6f9e97d2b80b16b1a08c4c',
}
UNIT_FILES = {
    'alisa-program@.service': 'f9a36d89f6199efb8f02fd01a24a3adbc49bf794021f792659e8bbc60f9f3191',
    'alisa-program-cleanup.service': '2c7eeac499366649ca233d641f45512d5b0cec1ece4ccf1640c888aeda66905f',
    'alisa-program.socket': '1a9b69a53293b008697642b2f5d0c45ea28d1eda73a4af0777b7828ddcd6b397',
}
PROBE_UNIT = 'alisa-program@r15-pair-check.service'
UNIT_QUERIES = {
    PROBE_UNIT: 'alisa-program@.service',
    'alisa-program-cleanup.service': 'alisa-program-cleanup.service',
    'alisa-program.socket': 'alisa-program.socket',
}


class PairBlocked(RuntimeError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def need(condition, code):
    if not condition:
        raise PairBlocked(code)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def command(value):
    """Use the same bounded systemctl command grammar as the R15 installer."""
    need(type(value) is str, 'PROGRAM_PAIR_COMMAND')
    path = re.search(r'(?:^|\{ )path=([^;]+) ;', value)
    argv = re.search(r'argv\[\]=(.*?) ; ignore_errors=', value)
    need(path is not None and argv is not None, 'PROGRAM_PAIR_COMMAND')
    return path.group(1), argv.group(1)


def inspect_pair(observer, consumer_sha256):
    """Verify immutable paired bytes AND loaded systemd commands, twice.

    observer.file(path) returns securely read bytes; observer.identity(path,
    immutable=...) returns stable no-follow metadata. observer.names(root)
    returns immediate entries without following symlinks. observer.unit(name)
    uses systemctl show only: it does not start the named template instance.
    All three unit definitions, retained worker/Results/Harness and canonical
    consumer are required; a manifest alone is insufficient evidence.
    """
    need(consumer_sha256 == CLIENT_SHA256, 'PROGRAM_PAIR_CONSUMER')

    def snapshot():
        root_id = observer.identity(ROOT, immutable=True, directory=True)
        need(set(observer.names(ROOT)) == set(FILES), 'PROGRAM_PAIR_INVENTORY')
        files = {}
        for name, expected in FILES.items():
            path = ROOT + '/' + name
            before = observer.identity(path, immutable=True, directory=False)
            need(digest(observer.file(path)) == expected, 'PROGRAM_PAIR_FILE')
            need(observer.identity(path, immutable=True, directory=False) == before,
                 'PROGRAM_PAIR_FILE_RACE')
            files[name] = {'identity': before, 'sha256': expected}
        need(observer.identity(ROOT, immutable=True, directory=True) == root_id,
             'PROGRAM_PAIR_DIRECTORY_RACE')
        unit_files = {}
        for name, expected in UNIT_FILES.items():
            path = '/etc/systemd/system/' + name
            before = observer.identity(path, immutable=False, directory=False)
            need(digest(observer.file(path)) == expected, 'PROGRAM_PAIR_UNIT_FILE')
            need(observer.identity(path, immutable=False, directory=False) == before,
                 'PROGRAM_PAIR_UNIT_RACE')
            unit_files[name] = {'identity': before, 'sha256': expected}
        loaded = {}
        for query, fragment in UNIT_QUERIES.items():
            item = observer.unit(query)
            need(type(item) is dict and item.get('LoadState') == 'loaded'
                 and item.get('FragmentPath') == '/etc/systemd/system/' + fragment
                 and item.get('DropInPaths') == ''
                 and item.get('NeedDaemonReload') == 'no', 'PROGRAM_PAIR_LOADED_UNIT')
            expected = {'LoadState': 'loaded', 'FragmentPath': item['FragmentPath'],
                        'DropInPaths': '', 'NeedDaemonReload': 'no'}
            if query == 'alisa-program.socket':
                need(item.get('ActiveState') == 'active' and item.get('SubState') == 'listening'
                     and item.get('Accept') == 'yes'
                     and item.get('Listen') == '/run/alisa-program/runner.sock (Stream)'
                     and item.get('SocketUser') == 'alice-market'
                     and item.get('SocketGroup') == 'alice-lab'
                     and item.get('SocketMode') == '0600', 'PROGRAM_PAIR_SOCKET')
                expected.update({k: item[k] for k in ('ActiveState', 'SubState', 'Accept',
                    'Listen', 'SocketUser', 'SocketGroup', 'SocketMode')})
            else:
                path, argv = command(item.get('ExecStart'))
                suffix = ' --sweep' if query == 'alisa-program-cleanup.service' else ''
                need(path == '/usr/bin/python3'
                     and argv == '/usr/bin/python3 -B ' + ROOT + '/program_broker.py' + suffix,
                     'PROGRAM_PAIR_COMMAND')
                expected['command_sha256'] = digest(argv.encode())
            loaded[query] = expected
        return {'root_identity': root_id, 'files': files,
                'unit_files': unit_files, 'loaded': loaded, 'consumer_sha256': consumer_sha256}

    try:
        first = snapshot()
        need(snapshot() == first, 'PROGRAM_PAIR_CHANGED')
        return first
    except PairBlocked:
        raise
    except (OSError, ValueError, TypeError, KeyError):
        raise PairBlocked('PROGRAM_PAIR_UNAVAILABLE') from None


def rollout_pair(host):
    """Finite broker-first phase core. No live adapter is supplied here.

    The adapter must enforce exact source/plan/maintenance-window binding,
    held rollout + program locks, a genuine socket admission fence and idle
    broker/cleanup instances. restore_before_admission must be CAS guarded
    and must not overwrite a later writer or touch retained result storage.
    The existing R15 CLI does NOT call this function until that adapter has
    its own actual-systemd qualification and independent review.
    """
    host.check_plan_and_window()
    host.backup()
    fenced = False
    admission_possible = False
    try:
        host.fence_socket_and_cleanup()
        host.require_admission_fence()
        fenced = True
        host.require_idle_and_locks()
        host.verify_old_and_candidate()
        host.publish_immutable_pair()
        host.switch_owned_units()
        host.reload_and_verify_new()
        host.check_window_and_fences()
        # A failed marker write/fsync has an uncertain durable outcome.
        admission_possible = True
        host.mark_admission_possible()
        host.release_and_start_socket()
        host.verify_installed_pair()
        host.record('PROGRAM_PAIR_TECHNICAL_PASS')
        return 'PROGRAM_PAIR_TECHNICAL_PASS'
    except BaseException:
        if admission_possible:
            host.record('PROGRAM_PAIR_RECOVERY_REQUIRES_REVIEW')
            return 'PROGRAM_PAIR_RECOVERY_REQUIRES_REVIEW'
        if fenced:
            if host.restore_before_admission():
                host.record('PROGRAM_PAIR_PRE_ADMISSION_RESTORED')
                return 'PROGRAM_PAIR_PRE_ADMISSION_RESTORED'
            host.record('PROGRAM_PAIR_RECOVERY_REQUIRES_REVIEW')
            return 'PROGRAM_PAIR_RECOVERY_REQUIRES_REVIEW'
        # The fence failed or is only partial: do not restore any unit while
        # admission might still be open. Preserve the attempt for reviewed repair.
        host.record('PROGRAM_PAIR_RECOVERY_REQUIRES_REVIEW')
        return 'PROGRAM_PAIR_RECOVERY_REQUIRES_REVIEW'
