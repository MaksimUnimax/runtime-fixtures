import re
import base64
import hashlib
import hmac
import json
import time
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlencode, urlsplit

from playwright.async_api import expect

from platform_core.user_plugins import telegram_api as tg
from test_account_browser import ProductBrowser, plugin_action


class TelegramBrowser(ProductBrowser):
    async def asyncSetUp(self):
        self.enterContext(patch.object(tg.Config, "load", return_value=tg.Config("123",None,"test")))
        await super().asyncSetUp()

    async def test_consent_return_then_pause(self):
        page = await self.open_chat("first-browser")
        original = page.url
        async def mock_provider(route):
            params = parse_qs(urlsplit(route.request.url).query)
            self.assertEqual(params["request_access"], ["write"])
            self.assertEqual(params["origin"], ["https://octoport.ru"])
            state = parse_qs(urlsplit(params["return_to"][0]).query)["state"][0]
            stamp = int(time.time())
            check = f"auth_date={stamp}\nfirst_name=Ирина\nid=884".encode()
            user = {"id":884, "first_name":"Ирина", "auth_date":stamp,
                    "hash":hmac.digest(hashlib.sha256(b"test").digest(), check, "sha256").hex()}
            encoded = base64.urlsafe_b64encode(json.dumps(user, ensure_ascii=False).encode()).decode().rstrip("=")
            target = self.base_url+"/telegram/return?"+urlencode({"state":state})+"#tgAuthResult="+encoded
            await route.fulfill(status=200,content_type="text/html; charset=utf-8",
                                body='<a href="'+target.replace("&","&amp;")+'">Подтвердить</a>')
        await page.route(re.compile(r"^https://oauth\.telegram\.org/"),mock_provider)
        await page.get_by_role("button",name="Плагины",exact=True).click()
        catalog = page.get_by_role("dialog",name="Плагины")
        await catalog.get_by_role("button",name="Установить Отчёты в Telegram").click()
        await expect(catalog.get_by_text("Установлен",exact=True)).to_be_visible()
        await catalog.get_by_role("button",name="Закрыть").click()
        await plugin_action(page,"Отчёты в Telegram","Подключить")
        selector = page.get_by_role("navigation",name="Установленные плагины").get_by_role("button",name="Отчёты в Telegram",exact=True)
        await selector.click()
        panel = page.get_by_role("dialog",name="Отчёты в Telegram")
        with patch.object(tg,"send",AsyncMock(return_value=1)) as sender:
            await panel.get_by_role("button",name="Подключить Telegram для отчётов этого чата").click()
            await page.get_by_role("link",name="Подтвердить").click()
            await expect(page.get_by_role("status")).to_contain_text("Telegram подключён",timeout=15000)
            self.assertEqual(urlsplit(page.url).query, "")
            self.assertEqual(urlsplit(page.url).fragment, "")
            self.assertEqual(sender.await_count,1)
        await page.get_by_role("link",name="Вернуться в чат").click()
        await expect(page).to_have_url(original)
        await selector.click()
        await panel.get_by_role("button",name="Остановить доставку из этого чата").click()
        await expect(panel.get_by_role("button",name="Получать новые отчёты этого чата")).to_be_visible()
