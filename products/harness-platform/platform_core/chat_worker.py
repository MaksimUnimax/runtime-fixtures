"""Private, multiplexed connection to the native chat host on stdio."""

import asyncio
import json
import os
import sys
import uuid
from pathlib import Path

from .storage import Scope


class WorkerError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


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
        if os.environ.get("HARNESS_OFFLINE_MODEL") == "1":
            self.env["HARNESS_OFFLINE_MODEL"] = "1"
            if adapter := os.environ.get("HARNESS_OFFLINE_ADAPTER"):
                self.env["HARNESS_OFFLINE_ADAPTER"] = adapter
        if composition_module:
            self.env["HARNESS_PLATFORM_COMPOSITION"] = composition_module
        self.lock = asyncio.Lock()
        self.process = None
        self.reader = None
        self.pending = {}

    async def _receive(self, process, pending):
        try:
            while line := await process.stdout.readline():
                packet = json.loads(line)
                future = pending.get(packet["id"])
                if future is None or future.done():
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
        packet_id = uuid.uuid4().hex
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
            process = self.process
        try:
            process.stdin.write(data)
            async with asyncio.timeout(45):
                await process.stdin.drain()
                return await future
        except (BrokenPipeError, ConnectionResetError, TimeoutError) as exc:
            raise WorkerError("offline") from exc
        finally:
            pending.pop(packet_id, None)
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
