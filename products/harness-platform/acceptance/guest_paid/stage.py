"""Serve the guest-to-paid acceptance build on loopback with persistent local state."""

import argparse
import asyncio
import os
from pathlib import Path
from urllib.parse import urlsplit

import uvicorn

from platform_core.chat_api import create_app
from platform_core.guest_registration import RegistrationStore
from platform_core.operation_grants import initialize_grants


PRODUCT = Path(__file__).resolve().parents[2]


async def serve(state, port):
    state = state.resolve()
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    database, journal = state / "identity.sqlite3", state / "usage.jsonl"
    with RegistrationStore(database):
        initialize_grants(database)
    gateway = await asyncio.create_subprocess_exec(
        "node", str(PRODUCT / "acceptance/archive_chat/live/gateway.mjs"), str(database), str(journal),
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
    )
    try:
        url = (await asyncio.wait_for(gateway.stdout.readline(), 10)).decode().strip()
        parsed = urlsplit(url)
        if parsed.hostname != "127.0.0.1" or parsed.scheme != "http" or not parsed.port:
            raise RuntimeError("Local operation gateway failed to start")
        os.environ.update(HARNESS_MODEL_GATEWAY_URL=url, HARNESS_USAGE_JOURNAL=str(journal),
                          HARNESS_CHAT_MODEL="deepseek-flash", HARNESS_OFFLINE_MODEL="0")
        app = create_app(database, state / "chats")
        server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, access_log=False))
        await server.serve()
    finally:
        if gateway.returncode is None:
            gateway.stdin.close()
            try:
                await asyncio.wait_for(gateway.wait(), 8)
            except TimeoutError:
                gateway.kill()
                await gateway.wait()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", required=True, type=Path)
    parser.add_argument("--port", type=int, default=18761)
    args = parser.parse_args()
    os.umask(0o077)
    asyncio.run(serve(args.state, args.port))
