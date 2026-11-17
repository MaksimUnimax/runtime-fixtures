"""Opt-in staff read on the existing RuntimePort socket and concurrency budget.

A package may explicitly select this Gateway at the existing bootstrap import.
No socket/thread/process/configuration is created at import. The old line-JSON
handler stays unchanged; the length-prefixed read protocol is distinguished
without consuming any bytes. One shared inherited semaphore governs both.
"""
import os
from pathlib import Path
import socket
import stat

from runtime_port_ipc import Gateway as RuntimeGateway
from runtime_port import RuntimePort
from .authority_verifier import PrivateStaffVerifier
from .read_channel import Budget, ChannelError, peer_identity, require, serve_connected

READ_TIMEOUT = 1.5


class Gateway(RuntimeGateway):
    """Same startup/close interface; verifier, DB and identity come from port."""
    def __init__(self, path, port, *, allowed_uid, service_id, max_inflight=8):
        # This extension cannot silently replace a synthetic/general authority
        # with an approved staff verifier, or take a database path from JSON.
        require(type(port) is RuntimePort, 'AUTH_REQUIRED')
        verifier = PrivateStaffVerifier(port.authority)
        require(port.authority.service_id == service_id == port.service_id, 'AUTH_REQUIRED')
        database = Path(port.repo.path)
        require(database.is_absolute() and '..' not in database.parts, 'CHANNEL_INVALID')
        p = Path(path)
        require(type(path) is str and p.is_absolute() and '..' not in p.parts
                and p.resolve(strict=False) == p, 'PEER_REJECTED')
        parent = p.parent.lstat()
        require(stat.S_ISDIR(parent.st_mode) and parent.st_uid in {0,os.getuid()}
                and not parent.st_mode & 0o022, 'PEER_REJECTED')
        self._staff_verifier = verifier
        self._staff_database = database
        self._staff_native_uid = os.getuid()
        super().__init__(path, port, allowed_uid=allowed_uid, service_id=service_id,
                         max_inflight=max_inflight)

    def finish_request(self, request, client_address):
        # Authentication precedes even the protocol peek. Native reads cannot
        # be tunneled through a line-JSON opcode or bypass the staff verifier.
        budget = Budget(READ_TIMEOUT)
        try:
            peer_identity(request,self.allowed_uid)
            request.settimeout(budget.remaining())
            first = request.recv(1,socket.MSG_PEEK)
            if not first:
                return
            if first == b'\x00':
                # All valid frames (<=8192 bytes) start with a zero high byte.
                # Invalid binary frames fail here; there is no legacy fallback.
                remaining = budget.remaining()
                require(remaining >= .05,'CHANNEL_TIMEOUT')
                serve_connected(request,allowed_uid=self.allowed_uid,
                    authority=self._staff_verifier,database=self._staff_database,
                    native_uid=self._staff_native_uid,timeout=remaining)
            else:
                # No byte consumed, same port/Peer/Handler, same legacy limits.
                super().finish_request(request,client_address)
        except (ChannelError,OSError,TimeoutError):
            return  # no ticket, payload, database path or traceback logging

    def handle_error(self, request, client_address):
        # socketserver's default traceback can contain dependency details.
        # The connection is closed by the inherited finally; no retry occurs.
        return


def service_source(source):
    """Exact in-memory bootstrap transform; does not install or build anything.

    A future qualified package must include the entire reconciliation package
    and native PlatformAuthorityClient; this source choice is explicitly opt-in.
    Frozen core bytes and the actual operator configuration remain unchanged.
    """
    anchor = 'from runtime_port_ipc import Gateway\n'
    require(type(source) is str and source.count(anchor)==1, 'CHANNEL_INVALID')
    result = source.replace(anchor,'from reconciliation.gateway import Gateway\n')
    compile(result,'runtime_port_service.py','exec')
    return result
