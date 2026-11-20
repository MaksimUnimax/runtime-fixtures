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
QUESTION = "Как звучал мой первый вопрос в гостевом чате? Процитируй только вопрос."


async def send(page, message):
    await page.locator('[data-composer-input][contenteditable=true]').fill(message)
    async with page.expect_response(
        lambda response: response.request.method == "POST" and response.url.endswith("/turns"),
        timeout=140_000,
    ) as sent:
        await page.get_by_role("button", name="Отправить сообщение", exact=True).click()
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
        await page.goto("/")
        await expect(page.locator('[data-composer-input][contenteditable=true]')).to_be_visible()
        await expect(page).to_have_url(re.compile(r"/app/chats/[a-zA-Z0-9_-]+$"))
        original_url = page.url
        cases = [
            ("Что ты умеешь?", "Сервис создан для продавцов"),
            ("Как зарегистрироваться?", "подтвердите регистрацию"),
            ("Сколько стоит ваш сервис?", "Публичный тариф"),
        ]
        # Use a different first question across runs so the model must receive the real history.
        shift = secrets.randbelow(len(cases))
        cases = cases[shift:] + cases[:shift]
        first_question = cases[0][0]
        cases.append(("Напиши стих про Ozon", "Я отвечаю на вопросы о нашем сервисе"))
        history = page.locator('[data-slot="conversation.view"]')
        guest_answers = []
        for question, expected in cases:
            self.assertEqual((await send(page, question)).status, 200)
            await expect(history.locator('[data-chat-flow-kind="assistant-step"]').last).to_contain_text(expected)
            guest_answers.append(await history.locator('[data-chat-flow-kind="assistant-step"] p').last.inner_text())
        evidence = os.environ.get("HARNESS_FAQ_EVIDENCE")
        if evidence and not live:
            Path(evidence).mkdir(parents=True, exist_ok=True)
            await page.screenshot(path=Path(evidence) / "01-public-faq.png", full_page=True)
        # Check the actual usage journal before either registration or a paid request.
        self.assertFalse(journal.exists() and journal.stat().st_size)
        with sqlite3.connect(database) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM usage_operations").fetchone()[0], 0)

        password = secrets.token_urlsafe(32)
        await page.get_by_role("link", name="Создать аккаунт и сохранить чат").click()
        await page.get_by_label("Логин", exact=True).fill("buyer")
        await page.get_by_label("Пароль", exact=True).fill(password)
        await page.get_by_role("button", name="Зарегистрироваться и открыть чат").click()
        await expect(page).to_have_url(original_url)
        conversation = page.locator('[data-slot="conversation.view"]')
        for answer in guest_answers:
            await expect(conversation).to_contain_text(answer, timeout=30_000)
        await page.get_by_role("button",name="Функции",exact=True).click()
        await expect(page.get_by_test_id("tools")).to_contain_text("Нет доступных инструментов")
        await page.get_by_role("dialog").get_by_role("button",name="Закрыть").click()
        self.assertEqual((await send(page, QUESTION)).status, 402)
        await expect(page.get_by_text("Недостаточно монет",exact=False).first).to_be_visible()
        self.assertFalse(journal.exists() and journal.stat().st_size)
        with sqlite3.connect(database) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM usage_operations").fetchone()[0], 0)

        await operator(database, "grant-coins", "10", "--key", "guest-test", "--reason", "Acceptance")
        response = await send(page, QUESTION)
        self.assertEqual(response.status, 200)
        receipt = await response.json()
        self.assertNotIn("modelCost", receipt)
        self.assertNotIn("operationId", receipt)
        await page.get_by_role("button",name="Баланс",exact=True).click()
        await expect(page.get_by_role("dialog")).to_contain_text("Доступно")
        await page.get_by_role("button",name="Закрыть",exact=True).click()
        snapshot = await (await page.request.get("/api/wallet")).json()
        self.assertEqual(len(snapshot["charges"]), 1)
        self.assertFalse(snapshot["charges"][0]["pending"])
        self.assertNotEqual(snapshot["charges"][0]["coins"], "0")
        self.assertNotIn("meter", snapshot["charges"][0])
        self.assertEqual(await page.get_by_role("button", name="Начислить монеты").count(), 0)
        await expect(conversation.locator('[data-chat-flow-kind="assistant-step"]').last).to_contain_text(first_question)
        await expect(page.locator(".model-cost")).to_have_count(0)
        await page.reload()
        await expect(conversation.locator('[data-chat-flow-kind="user"]')).to_have_count(len(cases) + 1, timeout=30_000)
        await expect(conversation.locator('[data-chat-flow-kind="assistant-step"]')).to_have_count(len(cases) + 1)
        await expect(conversation).to_contain_text(guest_answers[-1])
        await expect(conversation.locator('[data-chat-flow-kind="assistant-step"]').last).to_contain_text(first_question)

        if evidence and not live:
            await page.screenshot(path=Path(evidence) / "02-account-chat.png", full_page=True)

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
        await second.get_by_role("dialog").get_by_role("button", name="Войти", exact=True).click()
        await second.goto(original_url)
        saved = second.locator('[data-slot="conversation.view"]')
        await expect(saved.locator('[data-chat-flow-kind="user"]')).to_have_count(len(cases) + 1, timeout=30_000)
        await expect(saved.locator('[data-chat-flow-kind="assistant-step"]').last).to_contain_text(first_question)
        await expect(second.locator(".model-cost")).to_have_count(0)
        events = [json.loads(line) for line in journal.read_text().splitlines()]
        self.assertEqual([event["event"] for event in events], ["admitted", "finished"])
        last = events[-1]
        self.assertEqual((last["status"], last["outcome"], last["response_model"]), (200, "completed", "deepseek-flash"))
        self.assertTrue(last["provider_response_id"])
        self.assertEqual(last["attribution"]["source"], "chat.turn")
        print(f"Chromium {browser.version}: guest and unpaid 0 model calls, paid 1, "
              "same chat and recalled first FAQ question, role revocation and second device passed", flush=True)
