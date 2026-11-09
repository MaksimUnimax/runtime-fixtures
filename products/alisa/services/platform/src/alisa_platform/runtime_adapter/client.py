"""Operator-pinned versions, loaded afresh; no capability trust on first contact."""
import os
from pathlib import Path
import stat
from django.conf import settings
from .job_client import RuntimeClient, RuntimeFailure, decode, need


def configured_client(authorizer):
    path = Path(settings.RUNTIME_VERSIONS_PATH)
    try:
        need(path.is_absolute() and '..' not in path.parts)
        for parent in path.parents:
            info = parent.lstat()
            need(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022)
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            info = os.fstat(fd)
            need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o027
                 and 0 < info.st_size <= 8192)
            raw = os.read(fd, 8193)
            after = os.fstat(fd)
            need(len(raw) == info.st_size and (info.st_size, info.st_mtime_ns) ==
                 (after.st_size, after.st_mtime_ns))
        finally:
            os.close(fd)
        return RuntimeClient(settings.RUNTIME_JOB_SOCKET, settings.RUNTIME_JOB_UID,
                             decode(raw), authorizer)
    except (OSError, ValueError, TypeError, RuntimeFailure):
        raise RuntimeFailure('DEPENDENCY_UNAVAILABLE') from None
