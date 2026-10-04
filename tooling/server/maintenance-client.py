"""Scoped maintenance client. Never obtains or copies a human/browser session."""
from __future__ import annotations
import argparse
import base64
import hashlib
import hmac
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import re
import secrets
import stat
import tempfile
import time
import urllib.error
import urllib.request

ORIGIN = "https://api.octoport.ru"
ROTATION_SECONDS = 24 * 60 * 60
MAINTENANCE_SCOPES = frozenset({"compatibility.read", "compatibility.manage", "health.read", "ai.registry.read", "ai.registry.manage", "ai.profile.read", "ai.profile.manage", "ai.assignment.read", "ai.assignment.manage"})
TOKEN = re.compile(r"octm_[0-9a-f-]{36}_[A-Za-z0-9_-]{43}\Z")

class MaintenanceError(RuntimeError):
    pass

def timestamp(value):
    try:
        return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except (AttributeError, ValueError, TypeError):
        raise MaintenanceError("CREDENTIAL_FORMAT_INVALID") from None

def iso(value):
    return dt.datetime.fromtimestamp(value, dt.timezone.utc).isoformat()

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise MaintenanceError("REDIRECT_REJECTED")

def transport(method, path, token, body):
    raw = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(ORIGIN + path, data=raw, method=method,
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    opener = urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(request, timeout=20) as response:
            data = response.read(1_048_577)
            if len(data) > 1_048_576:
                raise MaintenanceError("RESPONSE_TOO_LARGE")
            return json.loads(data) if data else None
    except urllib.error.HTTPError as error:
        # Do not echo response bodies or headers, which might contain credentials.
        raise MaintenanceError("HTTP_" + str(error.code)) from None
    except MaintenanceError:
        raise
    except (OSError, ValueError, urllib.error.URLError):
        raise MaintenanceError("REQUEST_OUTCOME_UNKNOWN") from None

def read_private(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise MaintenanceError("CREDENTIAL_FILE_NOT_PRIVATE")
        with os.fdopen(fd, "r", closefd=False) as stream:
            data = stream.read(8193)
        if len(data) > 8192:
            raise MaintenanceError("CREDENTIAL_FORMAT_INVALID")
        return json.loads(data)
    except (ValueError, UnicodeError):
        raise MaintenanceError("CREDENTIAL_FORMAT_INVALID") from None
    finally:
        os.close(fd)

def save_private(path, data):
    # The destination is replaced atomically only after file contents are durable.
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(data, stream)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

class MaintenanceClient:
    def __init__(self, credential_file, send=transport, clock=time.time):
        self.path = Path(credential_file).absolute()
        self.send = send
        self.clock = clock

    def request(self, method, path, body=None):
        if method not in {"GET", "POST", "PUT", "PATCH", "DELETE"} or not isinstance(path, str):
            raise MaintenanceError("REQUEST_SCOPE_INVALID")
        if (not any(path == root or path.startswith(root + "/") or path.startswith(root + "?")
                    for root in ("/v1/admin/compatibility", "/v1/admin/ai", "/v1/admin/health"))
                or any(char in path for char in ("\\", "%", "#", "\n", "\r"))
                or "//" in path or any(part in {".", ".."} for part in path.split("?")[0].split("/"))):
            raise MaintenanceError("REQUEST_SCOPE_INVALID")
        parent = self.path.parent.stat()
        if parent.st_uid != os.getuid() or parent.st_mode & 0o022:
            raise MaintenanceError("CREDENTIAL_DIRECTORY_NOT_PRIVATE")
        lock = os.open(str(self.path) + ".lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            lock_info = os.fstat(lock)
            if not stat.S_ISREG(lock_info.st_mode) or lock_info.st_uid != os.getuid() or lock_info.st_mode & 0o077:
                raise MaintenanceError("CREDENTIAL_LOCK_NOT_PRIVATE")
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise MaintenanceError("CREDENTIAL_BUSY") from None
            data = read_private(self.path)
            if (not isinstance(data, dict) or data.get("version") != 1 or data.get("origin") != ORIGIN
                    or not isinstance(data.get("token"), str) or not TOKEN.fullmatch(data["token"])):
                raise MaintenanceError("CREDENTIAL_FORMAT_INVALID")
            now = self.clock()
            rotated = timestamp(data.get("rotatedAt"))
            if rotated > now + 300:
                raise MaintenanceError("CREDENTIAL_CLOCK_INVALID")
            if data.get("pendingNonce"):
                nonce = data["pendingNonce"]
                if not isinstance(nonce, str) or not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", nonce):
                    raise MaintenanceError("CREDENTIAL_FORMAT_INVALID")
                # The candidate is computable from our own durable pre-rotation state.
                # It has no authority unless the server actually committed that rotation.
                digest = hmac.new(data["token"].encode(),
                    b"octoport/maintenance/rotate/v1\0" + nonce.encode(), hashlib.sha256).digest()
                candidate = data["token"][:42] + base64.urlsafe_b64encode(digest).decode().rstrip("=")
                try:
                    status = self.send("GET", "/v1/admin/me", candidate, None)
                except MaintenanceError as error:
                    if str(error) != "HTTP_401":
                        raise
                else:
                    scopes = status.get("permissions") if isinstance(status, dict) else None
                    if (not isinstance(status, dict) or status.get("status") != "authenticated"
                            or status.get("roles") != [] or not isinstance(scopes, list) or not scopes
                            or any(scope not in MAINTENANCE_SCOPES for scope in scopes)
                            or timestamp(status.get("expiresAt")) <= now):
                        raise MaintenanceError("ROTATION_READBACK_INVALID")
                    data.update(token=candidate, expiresAt=status["expiresAt"], rotatedAt=iso(now))
                    data.pop("pendingNonce", None)
                    save_private(self.path, data)
                    rotated = now
            if timestamp(data.get("expiresAt")) <= now:
                raise MaintenanceError("CREDENTIAL_EXPIRED")
            if data.get("pendingNonce") or now - rotated >= ROTATION_SECONDS:
                if not data.get("pendingNonce"):
                    data["pendingNonce"] = secrets.token_urlsafe(32)
                    save_private(self.path, data)
                nonce = data["pendingNonce"]
                if not isinstance(nonce, str) or not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", nonce):
                    raise MaintenanceError("CREDENTIAL_FORMAT_INVALID")
                result = self.send("POST", "/v1/admin/maintenance-credential/rotate",
                                   data["token"], {"nonce": nonce})
                if (not isinstance(result, dict) or not isinstance(result.get("token"), str)
                        or not TOKEN.fullmatch(result["token"])
                        or timestamp(result.get("expiresAt")) <= now):
                    raise MaintenanceError("ROTATION_RESPONSE_INVALID")
                data.update(token=result["token"], expiresAt=result["expiresAt"], rotatedAt=iso(now))
                data.pop("pendingNonce", None)
                save_private(self.path, data)
            # Administrative mutations are sent once. An unknown outcome requires readback.
            return self.send(method, path, data["token"], body)
        finally:
            os.close(lock)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--credential-file", required=True)
    parser.add_argument("--method", choices=["GET", "POST", "PUT", "PATCH", "DELETE"], default="GET")
    parser.add_argument("--path", required=True)
    parser.add_argument("--body-file")
    args = parser.parse_args()
    try:
        body = json.loads(Path(args.body_file).read_text()) if args.body_file else None
        result = MaintenanceClient(args.credential_file).request(args.method, args.path, body)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (MaintenanceError, OSError, ValueError) as error:
        print(str(error) if isinstance(error, MaintenanceError) else "LOCAL_INPUT_INVALID")
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
