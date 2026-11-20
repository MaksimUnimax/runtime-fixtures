"""Cold-start the same entry point an operator uses, with no installed model runtime."""

import asyncio
from pathlib import Path
import re
import sqlite3
import sys
from tempfile import TemporaryDirectory
from unittest import IsolatedAsyncioTestCase

import httpx


PRODUCT = Path(__file__).resolve().parents[1]


class GuestStageTests(IsolatedAsyncioTestCase):
    async def test_public_service_starts_without_a_gateway_or_node(self):
        with TemporaryDirectory() as directory:
            state = Path(directory)
            # An empty executable search path and a clean environment model a public-only installation.
            env = {"PATH": directory, "PYTHONUTF8": "1"}
            process = await asyncio.create_subprocess_exec(
                sys.executable, "-m", "acceptance.guest_paid.stage", "--state", directory, "--port", "0",
                cwd=PRODUCT, env=env, stderr=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.DEVNULL,
            )
            try:
                async with asyncio.timeout(20):
                    while True:
                        line = await process.stderr.readline()
                        if not line:
                            self.fail(f"Stage exited before listening (status {await process.wait()})")
                        match = re.search(rb"Uvicorn running on (http://127\.0\.0\.1:\d+)", line)
                        if match:
                            origin = match[1].decode("ascii")
                            break
                async with httpx.AsyncClient(base_url=origin, trust_env=False) as client:
                    start = await client.post("/guest/start", headers={"Origin": origin})
                    self.assertEqual(start.status_code, 303)
                    chat = start.headers["location"]
                    path = "/guest/chats/" + chat.rsplit("/", 1)[1] + "/turns"
                    for i in range(13):
                        result = await client.post(path, headers={"Origin": origin},
                                                   data={"text": "Что ты умеешь?", "request_id": str(i)})
                        self.assertEqual(result.status_code, 303)
                    page = await client.get(chat)
                    self.assertEqual(page.status_code, 200)
                    self.assertIn('id="root"', page.text)
                    events = await client.get(path.removesuffix("/turns") + "/events")
                    self.assertEqual(sum("Сервис создан для продавцов" in r["answer"]
                                         for r in events.json()["turns"]), 13)
                    self.assertEqual((await client.get("/api/chats")).status_code, 401)
                self.assertFalse((state / "usage.jsonl").exists())
                self.assertFalse((state / "chats" / "native-chats.sqlite3").exists())
                with sqlite3.connect(state / "identity.sqlite3") as db:
                    self.assertEqual(db.execute("SELECT count(*) FROM identity_accounts").fetchone()[0], 0)
                    self.assertIsNone(db.execute(
                        "SELECT name FROM sqlite_master WHERE name='usage_operations'").fetchone())
            finally:
                if process.returncode is None:
                    process.terminate()
                    try:
                        await asyncio.wait_for(process.wait(), 8)
                    except TimeoutError:
                        process.kill()
                        await process.wait()
