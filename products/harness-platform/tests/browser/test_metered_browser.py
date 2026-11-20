"""Send a turn from the signed-in web UI and match its receipt to the gateway journal."""

import asyncio
from decimal import Decimal
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
        self.enterContext(patch.dict(os.environ, {"HARNESS_RUB_PER_USD":"80"}))
        root = Path(self.enterContext(TemporaryDirectory()))
        vault=root/"vault"
        vault.write_bytes(os.urandom(32))
        self.enterContext(patch.dict(os.environ,{"HARNESS_INTEGRATIONS_KEY_FILE":str(vault)}))
        database = root / "platform.sqlite"
        journal = root / "meter.jsonl"
        password = "Ephemeral browser test password"
        with IdentityStore(database) as store:
            store.create_account("browser-fixture", password)
            store.create_account("regular-fixture", password)
            store.grant_coins("browser-fixture", "10", "test-credit-browser-fixture", "Acceptance fixture")
            store.grant_coins("regular-fixture", "10", "test-credit-regular-fixture", "Acceptance fixture")
            store.set_admin("browser-fixture", True)
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
        self.enterContext(patch.dict(os.environ, {"HARNESS_MODEL_GATEWAY_URL": address, "HARNESS_OFFLINE_MODEL": "0",
                                                  "HARNESS_USAGE_JOURNAL": str(journal)}))
        origin = await self.enterAsyncContext(running_product(database, root / "chats"))
        driver = await self.enterAsyncContext(async_playwright())
        browser = await driver.chromium.launch(executable_path=os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"))
        self.addAsyncCleanup(browser.close)
        async def send(login, text):
            page = await browser.new_page(base_url=origin)
            await page.goto("/login")
            await page.get_by_label("Логин", exact=True).fill(login)
            await page.get_by_label("Пароль", exact=True).fill(password)
            await page.get_by_role("dialog").get_by_role("button", name="Войти", exact=True).click()
            await page.locator('[data-composer-input][contenteditable=true]').fill(text)
            async with page.expect_response(lambda r: r.url.endswith("/turns") and r.request.method == "POST") as sent:
                await page.get_by_role("button", name="Отправить сообщение", exact=True).click()
                if text=="browser fixture":
                    await expect(page.locator("[data-live-turn=thinking]")).to_be_visible(timeout=20_000)
                    await expect(page.locator("[data-live-turn=thinking]")).not_to_contain_text("private fixture trace")
                    await expect(page.locator("[data-live-turn=writing]")).to_contain_text("answer to", timeout=20_000)
                    await expect(page.locator("[data-live-turn=writing]")).not_to_contain_text("browser fixture")
                    await expect(page.get_by_role("button",name="Подключения",exact=True)).to_be_visible()
            response = await sent.value
            self.assertEqual(response.status, 200)
            await expect(page.locator('[data-slot="conversation.view"]')).to_contain_text("answer to " + text, timeout=30_000)
            return page, await response.json()

        (page, receipt), (regular, ordinary) = await asyncio.gather(
            send("browser-fixture", "browser fixture"), send("regular-fixture", "regular fixture"))
        self.assertNotIn("modelCost", ordinary)
        self.assertNotIn("operationId", ordinary)
        await expect(regular.locator(".model-cost")).to_have_count(0)
        label = page.locator('.model-cost')
        await expect(label).to_have_text("DeepSeek · Вход 10 · Кэш 0 · Выход 5 · Всего 15 токенов · 0,00072 ₽ · Списано 0,00072 монет")
        await page.reload()
        await expect(label).to_have_text("DeepSeek · Вход 10 · Кэш 0 · Выход 5 · Всего 15 токенов · 0,00072 ₽ · Списано 0,00072 монет", timeout=30_000)
        chat = page.url.rsplit("/", 1)[-1]
        events = await (await page.request.get(f"/api/chats/{chat}/events")).json()
        self.assertEqual(events["messages"][-1]["operationId"], receipt["operationId"])
        cli = await asyncio.create_subprocess_exec(
            sys.executable, "reconcile.py", str(journal), "--tariffs", "tariffs.json", "--by-operation",
            cwd=PRODUCT / "usage-reconciliation", stdout=asyncio.subprocess.PIPE,
        )
        output, _ = await cli.communicate()
        self.assertEqual(cli.returncode, 0)
        operations = json.loads(output)["attribution"]["operations"]
        self.assertEqual(len(operations), 2)
        row, = [entry for entry in operations if entry["operation_id"] == receipt["operationId"]]
        self.assertEqual((row["operation_id"], row["unique_attempts"], row["total_rub"]),
                         (receipt["operationId"], 1, "0.00072"))

        grants=page.get_by_role("dialog",name="Подключения этого чата")
        await page.get_by_role("button",name="Подключения",exact=True).click()
        await grants.get_by_role("button",name="Добавить подключение").click()
        form=page.get_by_role("dialog",name="Подключение сервиса",exact=True)
        await form.get_by_label("Сервис",exact=True).select_option("ozon")
        await form.get_by_label("Название подключения").fill("Тест Seller")
        await form.get_by_label("Client-Id продавца").fill("qa-id")
        await form.get_by_label("Api-Key продавца").fill("qa-private-key")
        await form.get_by_role("button",name="Сохранить подключение").click()
        await expect(form).to_contain_text("Подключение добавлено в этот чат")
        await form.get_by_role("button",name="Закрыть").click()
        await page.reload()
        await page.get_by_role("button",name="Подключения · Тест Seller").click()
        switch=grants.get_by_role("switch",name="Тест Seller · Ozon")
        await expect(switch).to_be_checked()
        thumb=switch.locator("span")
        on=await thumb.bounding_box()
        await switch.focus()
        await switch.press("Space")
        await expect(switch).not_to_be_checked()
        await expect(switch).to_be_enabled()
        await page.wait_for_function("(x) => document.querySelector('.chat-grants [role=switch] span').getBoundingClientRect().x < x-2",arg=on["x"])
        await expect(grants.get_by_role("checkbox")).to_have_count(0)
        await grants.get_by_role("button",name="Закрыть").click()
        await page.get_by_role("link",name="Администрирование").click()
        self.assertEqual((await regular.request.get("/admin")).status,403)
        await expect(regular.locator("#grant")).to_have_count(0)
        regular_wallet = await (await regular.request.get("/api/wallet")).json()
        await page.get_by_label("Наценка при покупке, %").fill("35")
        await page.get_by_role("button",name="Сохранить цену").click()
        await expect(page.locator("#pricing output")).to_have_text("Цена сохранена")
        await page.get_by_label("Логин получателя").fill("regular-fixture")
        await page.get_by_label("Монеты", exact=True).fill("3")
        await page.get_by_label("Основание").fill("Browser acceptance")
        await page.get_by_role("button", name="Начислить монеты").click()
        await expect(page.locator("#grant output")).to_have_text("Монеты начислены")
        await regular.reload()
        await page.get_by_label("Логин для просмотра расходов").fill("regular-fixture")
        await page.get_by_role("button", name="Показать расходы").click()
        await expect(page.locator("#account")).to_contain_text("regular-fixture")
        audit = page.locator("#charges details")
        await audit.locator("summary").click()
        await expect(audit).to_contain_text("Себестоимость · $")
        await expect(audit).to_contain_text("Вход 10")
        expected = Decimal(regular_wallet["available"]) + 3
        await regular.get_by_role("button",name="Баланс",exact=True).click()
        await expect(regular.get_by_role("dialog")).to_contain_text(f"Доступно · {expected:f}")
        await expect(regular.get_by_role("dialog")).to_contain_text("1,35 ₽")
        await expect(regular.get_by_role("dialog")).not_to_contain_text("Предел на запрос")
        await expect(regular.locator("#grant")).to_have_count(0)

        with IdentityStore(database) as store:
            store.set_admin("browser-fixture", False)
        self.assertEqual((await page.reload()).status,403)
        await page.goto("/app/chats/"+chat)
        await expect(page.locator('[data-slot="conversation.view"]')).to_contain_text("answer to browser fixture", timeout=30_000)
        await expect(label).to_have_count(0)
        await expect(page.locator("#grant")).to_have_count(0)
        history = await (await page.request.get(f"/api/chats/{chat}/messages")).json()
        self.assertNotIn("modelCost", history[-1])
        self.assertNotIn("operationId", history[-1])
