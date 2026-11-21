import base64
import json
import re
import hashlib
import hmac
import time
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlsplit

from playwright.async_api import expect

from platform_core import telegram_api as tg
from test_account_browser import ProductBrowser, plugin_action


class TelegramBrowser(ProductBrowser):
    async def asyncSetUp(self):
        self.enterContext(patch.object(tg.Config, "load", return_value=tg.Config("123",None,"test",username="ExampleBot")))
        await super().asyncSetUp()

    async def test_consent_return_then_pause(self):
        page = await self.open_chat("first-browser")
        original = page.url
        # Exercise the documented data-auth-url handoff without a live Telegram identity.
        script = """
            const widget = document.currentScript;
            const next = new URL(widget.dataset.authUrl, location.href);
            const url = new URL('https://oauth.telegram.org/test-consent');
            url.searchParams.set('return_to', next.href);
            const frame = document.createElement('iframe');
            frame.src = url.href;
            widget.after(frame);
            window.addEventListener('message', e => {
                if (e.source !== frame.contentWindow || e.origin !== 'https://oauth.telegram.org') return;
                for (const [key,value] of Object.entries(e.data)) next.searchParams.set(key,value);
                location.href = next.href;
            });
        """
        integrity = 'sha384-'+base64.b64encode(hashlib.sha384(script.encode()).digest()).decode()
        self.enterContext(patch("platform_core.telegram_integration.WIDGET_INTEGRITY",integrity))
        blocked=True
        async def widget_script(route):
            if blocked:
                await route.abort()
            else:
                await route.fulfill(content_type="application/javascript", body=script,
                                    headers={"Access-Control-Allow-Origin":"*"})

        async def mock_provider(route):
            params = parse_qs(urlsplit(route.request.url).query)
            stamp = int(time.time())
            check = f"auth_date={stamp}\nfirst_name=Ирина\nid=884".encode()
            user = {"id":884, "first_name":"Ирина", "auth_date":stamp,
                    "hash":hmac.digest(hashlib.sha256(b"test").digest(), check, "sha256").hex()}
            origin = urlsplit(params["return_to"][0])
            target = f"{origin.scheme}://{origin.netloc}"
            body = ("<button>Подтвердить</button><script>document.querySelector('button').onclick = () => "
                    f"parent.postMessage({json.dumps(user)}, {json.dumps(target)});</script>")
            await route.fulfill(content_type="text/html; charset=utf-8",body=body)

        await page.route("https://telegram.org/js/telegram-widget.js?22", widget_script)
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
            await expect(panel.get_by_text("Добавьте интеграцию Telegram",exact=False)).to_be_visible()
            await panel.get_by_role("button",name="Открыть интеграции").click()
            await page.get_by_role("combobox",name="Сервис").select_option("telegram")
            await page.get_by_role("button",name="Подключить Telegram",exact=True).click()
            modal = page.get_by_role("dialog",name="Подключить Telegram",exact=True)
            await expect(modal.get_by_role("alert")).to_contain_text("Не удалось загрузить")
            await page.keyboard.press("Escape")
            await expect(modal).to_have_count(0)
            await expect(page).to_have_url(original)
            blocked=False
            await page.evaluate("window.octoTelegramChatMarker = true")
            await page.get_by_role("button",name="Подключить Telegram",exact=True).click()
            wrapper = page.frame_locator('iframe[title="Вход через Telegram"]')
            await expect(wrapper.locator('script[data-telegram-login="ExampleBot"]')).to_have_attribute("data-request-access", "write")
            await wrapper.frame_locator("iframe").get_by_role("button",name="Подтвердить").click()
            await expect(modal).to_have_count(0,timeout=15000)
            await expect(page.get_by_role("button",name="Отключить Telegram для всех плагинов")).to_be_visible()
            self.assertTrue(await page.evaluate("window.octoTelegramChatMarker === true"))
            await expect(page).to_have_url(original)
            self.assertEqual(sender.await_count,1)
        await page.keyboard.press("Escape")
        await selector.click()
        await expect(panel.get_by_text("Telegram подключён к аккаунту.")).to_be_visible()
        await panel.get_by_role("button",name="Получать новые отчёты этого чата").click()
        await panel.get_by_role("button",name="Остановить доставку из этого чата").click()
        await expect(panel.get_by_role("button",name="Получать новые отчёты этого чата")).to_be_visible()


class TelegramOidcBrowser(ProductBrowser):
    async def asyncSetUp(self):
        self.enterContext(patch.object(tg.Config,"load",return_value=tg.Config("123","test-secret","123:test")))
        await super().asyncSetUp()

    async def test_provider_confirmation_keeps_original_settings(self):
        from test_account_browser import open_integrations
        page = await self.open_chat("first-browser")
        original = page.url
        await open_integrations(page)
        await page.get_by_role("combobox",name="Сервис").select_option("telegram")
        await page.get_by_role("button",name="Подключить Telegram",exact=True).click()
        dialog = page.get_by_role("dialog",name="Подключить Telegram",exact=True)

        async def provider(route):
            state = parse_qs(urlsplit(route.request.url).query)["state"][0]
            await route.fulfill(content_type="text/html; charset=utf-8",
                body=f'<a href="{self.base_url}/telegram/return?state={state}&amp;code=fixture">Разрешить</a>')

        await page.context.route("https://oauth.telegram.org/auth?**",provider)
        with patch.object(tg,"verified_user",AsyncMock(return_value=884)),patch.object(tg,"send",AsyncMock(return_value=1)):
            async with page.context.expect_page() as opened:
                await dialog.get_by_role("link",name="Войти через Telegram").click()
            popup = await opened.value
            await popup.get_by_role("link",name="Разрешить").click()
            await expect(dialog).to_have_count(0)
        await expect(page.get_by_role("button",name="Отключить Telegram для всех плагинов")).to_be_visible()
        await expect(page).to_have_url(original)
