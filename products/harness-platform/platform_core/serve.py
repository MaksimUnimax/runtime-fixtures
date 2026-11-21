"""Run the public service on loopback behind a trusted HTTPS reverse proxy."""

import argparse
import asyncio
import os
import socket
from pathlib import Path
from urllib.parse import urlsplit

import uvicorn

from platform_core.chat_api import create_app


PRODUCT = Path(__file__).resolve().parents[1]


async def run_app(database, state, port):
    app = create_app(database, state / "chats")
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, access_log=False))
    # PID 1 keeps the listening socket across service restarts. Queued requests
    # can be accepted after the local gateway and the application are ready.
    if os.environ.get("LISTEN_PID") == str(os.getpid()) and os.environ.get("LISTEN_FDS") == "1":
        with socket.socket(fileno=3) as listener:
            if listener.getsockname() != ("127.0.0.1", port):
                raise RuntimeError("Unexpected HTTP listener")
            await server.serve(sockets=[listener])
    else:
        await server.serve()


async def serve(state, port, model=None):
    state = state.resolve()
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    database, journal = state / "identity.sqlite3", state / "usage.jsonl"
    # Keep previously configured live invocations working. A new stage can
    # serve the public FAQ without starting Node or configuring a model.
    if model is None:
        model = "live" if any(os.environ.get(k) for k in (
            "HARNESS_PROVIDER_KEYS_DIR", "HARNESS_PROVIDER_RELAY_URL", "HARNESS_PROVIDER_RELAY_KEY_FILE",
            "HARNESS_ACCEPTANCE_GATEWAY", "HARNESS_ACCEPTANCE_KEY_FILE")) else "off"
    if model == "off":
        os.environ.pop("HARNESS_MODEL_GATEWAY_URL", None)
        os.environ.pop("HARNESS_USAGE_JOURNAL", None)
        os.environ["HARNESS_OFFLINE_MODEL"] = "0"
        await run_app(database, state, port)
        return

    from platform_core.guest_registration import RegistrationStore
    from platform_core.operation_grants import initialize_grants

    with RegistrationStore(database):
        initialize_grants(database)
    gateway = await asyncio.create_subprocess_exec(
        "node", str(PRODUCT / "native/scoped-gateway.mjs"), str(database), str(journal),
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
    )
    try:
        url = (await asyncio.wait_for(gateway.stdout.readline(), 10)).decode().strip()
        parsed = urlsplit(url)
        if parsed.hostname != "127.0.0.1" or parsed.scheme != "http" or not parsed.port:
            raise RuntimeError("Local operation gateway failed to start")
        os.environ.update(HARNESS_MODEL_GATEWAY_URL=url, HARNESS_USAGE_JOURNAL=str(journal),
                          HARNESS_CHAT_MODEL="deepseek-flash", HARNESS_OFFLINE_MODEL="0")
        await run_app(database, state, port)
    finally:
        if gateway.returncode is None:
            gateway.stdin.close()
            try:
                await asyncio.wait_for(gateway.wait(), 8)
            except TimeoutError:
                gateway.kill()
                await gateway.wait()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", required=True, type=Path)
    parser.add_argument("--port", type=int, default=18761)
    parser.add_argument("--model", choices=("off", "live"),
                        help="Default: live for a configured acceptance gateway, otherwise off")
    args = parser.parse_args()
    os.umask(0o077)
    asyncio.run(serve(args.state, args.port, args.model))


if __name__ == "__main__":
    main()
