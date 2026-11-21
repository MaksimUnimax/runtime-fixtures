import re
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlencode, urlsplit

from playwright.async_api import expect

from platform_core.user_plugins import telegram_api as tg
from test_account_browser import ProductBrowser


class TelegramBrowser(ProductBrowser):
    async def asyncSetUp(self):
        self.enterContext(patch.object(tg.Config, "load", return_value=tg.Config("123","test","test")))
        await super().asyncSetUp()

    async def test_consent_return_then_pause(self):
        page = await self.open_chat("first-browser")
        original = page.url
        async def mock_provider(route):
            state = parse_qs(urlsplit(route.request.url).query)["state"][0]
            # Real cross-site navigation followed by a same-origin callback request.
            target = self.base_url+"/telegram/return?"+urlencode({"state":state,"code":"fixture"})
            await route.fulfill(status=200,content_type="text/html; charset=utf-8",
                                body='<a href="'+target.replace("&","&amp;")+'">Подтвердить</a>')
        await page.route(re.compile(r"^https://oauth\.telegram\.org/"),mock_provider)
        await page.get_by_role("button",name="Плагины",exact=True).click()
        catalog = page.get_by_role("dialog",name="Плагины")
        toggle = catalog.get_by_role("switch",name="Подключить Отчёты в Telegram")
        await toggle.click()
        await expect(toggle).to_be_checked()
        await catalog.get_by_role("button",name="Закрыть").click()
        selector = page.get_by_role("navigation",name="Подключённые плагины").get_by_role("button",name="Отчёты в Telegram",exact=True)
        await selector.click()
        panel = page.get_by_role("dialog",name="Отчёты в Telegram")
        with patch.object(tg,"verified_user",AsyncMock(return_value=884)), patch.object(tg,"send",AsyncMock(return_value=1)) as sender:
            await panel.get_by_role("button",name="Подключить Telegram для отчётов этого чата").click()
            await page.get_by_role("link",name="Подтвердить").click()
            await expect(page.get_by_role("status")).to_contain_text("Telegram подключён",timeout=15000)
            self.assertNotIn("code=",page.url)
            self.assertEqual(sender.await_count,1)
        await page.get_by_role("link",name="Вернуться в чат").click()
        await expect(page).to_have_url(original)
        await selector.click()
        await panel.get_by_role("button",name="Остановить доставку из этого чата").click()
        await expect(panel.get_by_role("button",name="Получать новые отчёты этого чата")).to_be_visible()
