"""Private, multiplexed connection to the native chat host on stdio."""

import asyncio
import json
import os
import sys
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit

from .operation_grants import FreeModelUnavailable, PaidAccessRequired, initialize_grants, issue_grant, revoke_grant
from .storage import Scope


class WorkerError(Exception):
    def __init__(self, code, *, operation_id=None):
        super().__init__(code)
        self.code = code
        self.operation_id = operation_id


class ChatWorker:
    def __init__(self, database_path, chat_directory, composition_module=None):
        product = Path(__file__).resolve().parent.parent
        self.script = product / "native" / "chat-worker.mjs"
        self.env = {
            # The host and installed modules are operator configuration.
            "PATH": os.environ["PATH"],
            "HARNESS_NODE_MODULES": os.environ.get("HARNESS_NODE_MODULES", ""),
            "HARNESS_CHAT_DIRECTORY": str(Path(chat_directory).resolve()),
            "HARNESS_PLATFORM_DATABASE": str(Path(database_path).resolve()),
            "HARNESS_TEST_PYTHON": sys.executable,
        }
        if key_file := os.getenv("HARNESS_INTEGRATIONS_KEY_FILE"):
            self.env["HARNESS_INTEGRATIONS_KEY_FILE"] = key_file
        self.router = None
        self.database_path = database_path
        self.gateway = os.environ.get("HARNESS_MODEL_GATEWAY_URL")
        if self.gateway is not None:
            endpoint = urlsplit(self.gateway)
            if (endpoint.scheme not in {"http", "https"} or not endpoint.hostname
                    or endpoint.username is not None or endpoint.password is not None
                    or endpoint.query or endpoint.fragment
                    or (endpoint.scheme == "http" and endpoint.hostname not in {"127.0.0.1", "::1", "localhost"})):
                raise ValueError("Expected a trusted HTTPS or loopback gateway URL")
            if os.environ.get("HARNESS_OFFLINE_MODEL") == "1":
                raise ValueError("Select one chat model transport")
            self.env["HARNESS_MODEL_GATEWAY_URL"] = self.gateway
            self.env["HARNESS_CHAT_MODEL"] = os.environ.get("HARNESS_CHAT_MODEL", "deepseek-flash")
            initialize_grants(database_path)
        if os.environ.get("HARNESS_OFFLINE_MODEL") == "1":
            self.env["HARNESS_OFFLINE_MODEL"] = "1"
            if adapter := os.environ.get("HARNESS_OFFLINE_ADAPTER"):
                self.env["HARNESS_OFFLINE_ADAPTER"] = adapter
        if composition_module:
            self.env["HARNESS_PLATFORM_COMPOSITION"] = composition_module
        self.lock = asyncio.Lock()
        self.process = None
        self.reader = None
        self.progress_callbacks = {}
        self.pending = {}

    async def _receive(self, process, pending):
        try:
            while line := await process.stdout.readline():
                packet = json.loads(line)
                future = pending.get(packet["id"])
                if future is None or future.done():
                    continue
                if "progress" in packet:
                    callback=self.progress_callbacks.get(packet["id"])
                    if callback: callback(packet["progress"])
                    continue
                if packet["ok"] is True:
                    future.set_result(packet["result"])
                else:
                    future.set_exception(WorkerError(packet["error"]))
        except (ValueError, KeyError, TypeError):
            pass  # Treat a broken private protocol as a worker failure.
        finally:
            for future in pending.values():
                if not future.done():
                    future.set_exception(WorkerError("offline"))
            if process.returncode is None:
                try:
                    process.terminate()
                except ProcessLookupError:
                    pass
            await process.wait()

    async def request(self, scope: Scope, action, **fields):
        if action == "turn" and self.gateway:
            if self.router and self.router.available() and self.router.uses_router(scope.workspace_id):
                await self.router.models()
            issue = asyncio.create_task(asyncio.to_thread(
                issue_grant, self.database_path, scope, source="chat.turn",
                bind_model=self.router.bind if self.router else None,
                direct_fallback=self.env["HARNESS_CHAT_MODEL"],
                run_key=fields["requestId"], ttl_seconds=150, coin_limit=fields.pop("maxCoins", None),
            ))
            try:
                grant = await asyncio.shield(issue)
            except asyncio.CancelledError:
                # Issuance runs in a thread and can commit after the HTTP caller leaves.
                grant = await issue
                await asyncio.to_thread(revoke_grant, self.database_path, grant.token)
                raise
            except (FreeModelUnavailable, PaidAccessRequired) as denied:
                try:
                    return await self._request(scope, action, {**fields, "replayOnly": True}, timeout=45)
                except WorkerError as error:
                    if isinstance(denied,FreeModelUnavailable) and error.code=="payment_required":
                        raise denied
                    raise
            except PermissionError:
                raise WorkerError("unavailable") from None
            try:
                return await self._request(scope, action, {
                    **fields, "grant": {"token": grant.token, "operationId": grant.operation_id, "model": grant.model,
                                        "directModel": grant.direct_model, "effort": grant.effort},
                    "deadline": int(time.time() * 1000) + 120_000,
                }, timeout=135)
            except WorkerError as error:
                if error.code == "turn_unconfirmed":
                    raise WorkerError(error.code, operation_id=grant.operation_id) from error
                raise
            finally:
                await asyncio.to_thread(revoke_grant, self.database_path, grant.token)
        return await self._request(scope, action, fields, timeout=45)

    async def _request(self, scope, action, fields, *, timeout):
        packet_id = uuid.uuid4().hex
        callback=fields.pop("on_progress",None)
        packet = {"id": packet_id, "action": action, "scope": {
            "actorId": scope.actor_id, "workspaceId": scope.workspace_id, "chatId": scope.chat_id,
        }, **fields}
        data = (json.dumps(packet, ensure_ascii=False, allow_nan=False) + "\n").encode()
        async with self.lock:
            if self.process is None or self.process.returncode is not None:
                try:
                    self.process = await asyncio.create_subprocess_exec(
                        "node", str(self.script), cwd=self.script.parent.parent, env=self.env,
                        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                        limit=8 * 1024 * 1024,
                    )
                except OSError as exc:
                    raise WorkerError("offline") from exc
                self.pending = {}
                self.reader = asyncio.create_task(self._receive(self.process, self.pending))
            pending = self.pending
            if len(pending) >= 64:
                raise WorkerError("busy")
            future = asyncio.get_running_loop().create_future()
            pending[packet_id] = future
            if callback: self.progress_callbacks[packet_id]=callback
            process = self.process
        try:
            process.stdin.write(data)
            async with asyncio.timeout(timeout):
                await process.stdin.drain()
                return await future
        except (BrokenPipeError, ConnectionResetError, TimeoutError) as exc:
            raise WorkerError("offline") from exc
        finally:
            pending.pop(packet_id, None)
            self.progress_callbacks.pop(packet_id,None)
            if not future.done():
                future.cancel()
            elif not future.cancelled():
                future.exception()

    async def close(self):
        if self.process is None:
            return
        if self.process.stdin:
            self.process.stdin.close()
        try:
            await asyncio.wait_for(asyncio.shield(self.reader), timeout=5)
        except TimeoutError:
            if self.process.returncode is None:
                self.process.kill()
            await self.reader
