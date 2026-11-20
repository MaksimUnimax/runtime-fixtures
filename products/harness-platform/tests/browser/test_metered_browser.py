"""Send a turn from the signed-in web UI and match its receipt to the gateway journal."""

import asyncio
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from playwright.async_api import async_playwright, expect
from test_account_browser import running_product
from platform_core.identity import IdentityStore
from platform_core.operation_grants import initialize_grants

PRODUCT = Path(__file__).resolve().parents[2]


class MeteredBrowser(unittest.IsolatedAsyncioTestCase):
    async def test_turn_from_chat_page_has_a_reconciled_operation(self):
        root = Path(self.enterContext(TemporaryDirectory()))
        database = root / "platform.sqlite"
        journal = root / "meter.jsonl"
        password = "Ephemeral browser test password"
        with IdentityStore(database) as store:
            store.create_account("browser-fixture", password)
        initialize_grants(database)
        gateway = await asyncio.create_subprocess_exec(
            "node", str(PRODUCT / "tests/metered-chat-gateway.mjs"), str(database), str(journal),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        )
        async def close_gateway():
            gateway.stdin.close()
            try:
                await asyncio.wait_for(gateway.wait(), 5)
            except TimeoutError:
                gateway.kill()
                await gateway.wait()
        self.addAsyncCleanup(close_gateway)
        address = (await asyncio.wait_for(gateway.stdout.readline(), 8)).decode().strip()
        self.assertTrue(address.startswith("http://127.0.0.1:"))
        self.enterContext(patch.dict(os.environ, {"HARNESS_MODEL_GATEWAY_URL": address, "HARNESS_OFFLINE_MODEL": "0"}))
        origin = await self.enterAsyncContext(running_product(database, root / "chats"))
        driver = await self.enterAsyncContext(async_playwright())
        browser = await driver.chromium.launch(executable_path=os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"))
        self.addAsyncCleanup(browser.close)
        page = await browser.new_page(base_url=origin)
        await page.goto("/login")
        await page.get_by_label("Логин", exact=True).fill("browser-fixture")
        await page.get_by_label("Пароль", exact=True).fill(password)
        await page.get_by_role("button", name="Войти", exact=True).click()
        await page.get_by_role("button", name="Новый чат", exact=True).click()
        await page.get_by_role("textbox", name="Сообщение", exact=True).fill("browser fixture")
        async with page.expect_response(lambda r: r.url.endswith("/turns") and r.request.method == "POST") as sent:
            await page.get_by_role("button", name="Отправить", exact=True).click()
        response = await sent.value
        self.assertEqual(response.status, 200)
        receipt = await response.json()
        await expect(page.get_by_test_id("history")).to_contain_text("answer to browser fixture", timeout=30_000)
        await page.reload()
        await expect(page.get_by_test_id("history")).to_contain_text("answer to browser fixture", timeout=30_000)
        chat = page.url.rsplit("/", 1)[-1]
        events = await (await page.request.get(f"/api/chats/{chat}/events")).json()
        self.assertEqual(events["messages"][-1]["operationId"], receipt["operationId"])
        cli = await asyncio.create_subprocess_exec(
            sys.executable, "reconcile.py", str(journal), "--tariffs", "tariffs.json", "--by-operation",
            cwd=PRODUCT / "usage-reconciliation", stdout=asyncio.subprocess.PIPE,
        )
        output, _ = await cli.communicate()
        self.assertEqual(cli.returncode, 0)
        row, = json.loads(output)["attribution"]["operations"]
        self.assertEqual((row["operation_id"], row["unique_attempts"], row["total_rub"]),
                         (receipt["operationId"], 1, "0.00072"))
