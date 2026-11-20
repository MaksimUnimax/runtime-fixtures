"""One conversation from public help through registration and a metered model answer."""

import asyncio
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from playwright.async_api import async_playwright, expect

from platform_core.guest_registration import RegistrationStore
from platform_core.operation_grants import initialize_grants
from test_account_browser import running_product


PRODUCT = Path(__file__).resolve().parents[2]
QUESTION = "Какой артикул я указал в гостевом сообщении? Ответь только артикулом."


async def send(page, message):
    await page.get_by_role("textbox", name="Сообщение", exact=True).fill(message)
    async with page.expect_response(
        lambda response: response.request.method == "POST" and response.url.endswith("/turns"),
        timeout=140_000,
    ) as sent:
        await page.get_by_role("button", name="Отправить", exact=True).click()
    return await sent.value


async def operator(database, command, value, *extra):
    process = await asyncio.create_subprocess_exec(
        sys.executable, "-m", "platform_core.chat_service", "--db", str(database), command, "buyer", value, *extra,
        cwd=PRODUCT,
    )
    if await process.wait():
        raise RuntimeError(f"Operator command {command} failed")


class GuestPaidJourney(unittest.IsolatedAsyncioTestCase):
    async def test_guest_message_reaches_paid_model_in_original_chat(self):
        root = Path(self.enterContext(TemporaryDirectory()))
        database, journal = root / "identity.sqlite3", root / "usage.jsonl"
        with RegistrationStore(database):
            initialize_grants(database)
        live = os.environ.get("HARNESS_LIVE_GUEST_ACCEPTANCE") == "1"
        script = PRODUCT / ("acceptance/archive_chat/live/gateway.mjs" if live else "tests/metered-chat-gateway.mjs")
        gateway = await asyncio.create_subprocess_exec(
            "node", str(script), str(database), str(journal),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        )

        async def stop_gateway():
            gateway.stdin.close()
            try:
                await asyncio.wait_for(gateway.wait(), 8)
            except TimeoutError:
                gateway.kill()
                await gateway.wait()

        self.addAsyncCleanup(stop_gateway)
        address = (await asyncio.wait_for(gateway.stdout.readline(), 10)).decode().strip()
        self.assertRegex(address, r"^http://127\.0\.0\.1:\d+$")
        self.enterContext(patch.dict(os.environ, {
            "HARNESS_OFFLINE_MODEL": "0", "HARNESS_MODEL_GATEWAY_URL": address,
            "HARNESS_CHAT_MODEL": "deepseek-flash", "HARNESS_USAGE_JOURNAL": str(journal),
        }))
        base = await self.enterAsyncContext(running_product(database, root / "chats", composition_module=None))
        driver = await self.enterAsyncContext(async_playwright())
        browser = await driver.chromium.launch(executable_path=os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"))
        self.addAsyncCleanup(browser.close)
        page = await browser.new_page(base_url=base)
        await page.goto("/login")
        await page.get_by_role("button", name="Попробовать без регистрации").click()
        await expect(page.get_by_role("heading", name="Гостевой чат")).to_be_visible()
        original_url = page.url
        sku = f"SKU-{secrets.randbelow(1_000_000):06d}"
        marker = f"Как сохранить историю работы с Ozon? Мой артикул {sku}."
        self.assertEqual((await send(page, marker)).status, 303)
        history = page.get_by_role("list", name="История сообщений")
        await expect(history).to_contain_text(marker)
        guest_answer = await history.locator("li p").nth(1).inner_text()
        self.assertTrue(guest_answer.strip())

        password = secrets.token_urlsafe(32)
        await page.get_by_role("link", name="Создать аккаунт и сохранить чат").click()
        await page.get_by_label("Логин", exact=True).fill("buyer")
        await page.get_by_label("Пароль", exact=True).fill(password)
        await page.get_by_role("button", name="Зарегистрироваться и открыть чат").click()
        await expect(page).to_have_url(original_url)
        conversation = page.get_by_test_id("history")
        await expect(conversation).to_contain_text(guest_answer, timeout=30_000)
        await expect(page.get_by_test_id("tools")).to_contain_text("Нет доступных инструментов")
        self.assertEqual((await send(page, QUESTION)).status, 402)
        await expect(page.get_by_role("alert")).to_contain_text("Недостаточно доступных монет")
        self.assertFalse(journal.exists() and journal.stat().st_size)
        with sqlite3.connect(database) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM usage_operations").fetchone()[0], 0)

        await operator(database, "grant-coins", "10", "--key", "guest-test", "--reason", "Acceptance")
        response = await send(page, QUESTION)
        self.assertEqual(response.status, 200)
        receipt = await response.json()
        self.assertNotIn("modelCost", receipt)
        self.assertNotIn("operationId", receipt)
        await expect(page.locator("#balance")).not_to_have_text("Монеты · 0")
        snapshot = await (await page.request.get("/api/wallet")).json()
        self.assertEqual(len(snapshot["charges"]), 1)
        self.assertFalse(snapshot["charges"][0]["pending"])
        self.assertNotEqual(snapshot["charges"][0]["coins"], "0")
        self.assertNotIn("meter", snapshot["charges"][0])
        self.assertEqual(await page.get_by_role("button", name="Начислить монеты").count(), 0)
        await expect(conversation.locator('[data-role="assistant"]').last).to_contain_text(sku)
        await expect(page.locator(".model-cost")).to_have_count(0)
        await page.reload()
        await expect(conversation.locator('[data-role="user"]')).to_have_count(2, timeout=30_000)
        await expect(conversation.locator('[data-role="assistant"]')).to_have_count(2)
        await expect(conversation).to_contain_text(guest_answer)
        await expect(conversation.locator('[data-role="assistant"]').last).to_contain_text(sku)

        await operator(database, "set-role", "admin")
        await page.reload()
        await expect(page.locator(".model-cost").last).to_contain_text(re.compile(r"\d"), timeout=15_000)
        await operator(database, "set-access", "unpaid")
        self.assertEqual((await send(page, "Продолжим работу с магазином?")).status, 402)
        await operator(database, "set-role", "user")

        second = await browser.new_page(base_url=base)
        await second.goto("/login")
        await second.get_by_label("Логин", exact=True).fill("buyer")
        await second.get_by_label("Пароль", exact=True).fill(password)
        await second.get_by_role("button", name="Войти", exact=True).click()
        await second.goto(original_url)
        saved = second.get_by_test_id("history")
        await expect(saved.locator('[data-role="user"]')).to_have_count(2, timeout=30_000)
        await expect(saved.locator('[data-role="assistant"]').last).to_contain_text(sku)
        await expect(second.locator(".model-cost")).to_have_count(0)
        events = [json.loads(line) for line in journal.read_text().splitlines()]
        self.assertEqual([event["event"] for event in events], ["admitted", "finished"])
        last = events[-1]
        self.assertEqual((last["status"], last["outcome"], last["response_model"]), (200, "completed", "deepseek-flash"))
        self.assertTrue(last["provider_response_id"])
        self.assertEqual(last["attribution"]["source"], "chat.turn")
        print(f"Chromium {browser.version}: guest and unpaid 0 model calls, paid 1, "
              "same chat and recalled article, role revocation and second device passed", flush=True)
