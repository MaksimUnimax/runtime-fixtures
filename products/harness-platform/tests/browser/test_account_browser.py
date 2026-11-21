"""Two signed-in Chromium profiles exercise the product through its ordinary UI."""

import asyncio
import os
import re
import socket
import json
import sqlite3
import unittest
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from contextlib import asynccontextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from urllib.parse import urlsplit

import httpx
import uvicorn
from playwright.async_api import async_playwright, expect

from platform_core.chat_api import create_app
from platform_core.identity import IdentityStore


def browser_error(text):
    # Report module failures without query strings, credentials or session identifiers.
    text = re.sub(r"https?://[^\s)]+", lambda match: urlsplit(match.group()).path, str(text))
    text = re.sub(r"(?i)bearer\s+\S+|[A-Za-z0-9_-]{32,}", "[redacted]", text)
    return text[:350]


async def boot_status(page):
    # The hidden upstream bootstrap element may contain arbitrary text. Extract
    # recognized technical indicators, never a page dump or message transcript.
    root = page.locator("#root")
    if not await root.count():
        return "missing"
    text = await root.text_content() or ""
    indicators = re.findall(
        r"@deepseek-ai/dsh-[a-z0-9-]+|EvalError|SyntaxError|TypeError|ReferenceError|"
        r"unsafe-eval|Content Security Policy|new Function|timed out|loading|boot(?:strap)? failed",
        text, re.IGNORECASE,
    )
    return {"length": len(text), "indicators": sorted(set(indicators))[:10]}


@asynccontextmanager
async def running_product(database, journals, *, composition_module="examples.reference_plugin"):
    app = create_app(database, journals, composition_module=composition_module)
    server = uvicorn.Server(uvicorn.Config(app, log_level="warning", access_log=False))
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
        task = asyncio.create_task(server.serve(sockets=[listener]))
        try:
            async with asyncio.timeout(15):
                while not server.started:
                    if task.done():
                        await task
                        raise RuntimeError("Product server stopped during initialization")
                    await asyncio.sleep(0.05)
            yield f"http://127.0.0.1:{port}"
        finally:
            server.should_exit = True
            await task


async def account_action(page, label):
    await page.get_by_role("button", name="Меню аккаунта", exact=True).click()
    await page.get_by_role("menuitem", name=label, exact=True).click()


async def open_integrations(page):
    await account_action(page, "Настройки")
    await page.get_by_role("dialog").get_by_role("button", name="Интеграции", exact=True).click()


class ProductBrowser(unittest.IsolatedAsyncioTestCase):
    composition = "examples.reference_plugin"
    offline_adapter = None

    async def asyncSetUp(self):
        if not os.environ.get("HARNESS_NODE_MODULES"):
            self.fail("Set HARNESS_NODE_MODULES to the pinned native installation")
        self.enterContext(patch.dict(os.environ, {"HARNESS_OFFLINE_MODEL": "1"}))
        if self.offline_adapter:
            self.enterContext(patch.dict(os.environ, {"HARNESS_OFFLINE_ADAPTER": self.offline_adapter}))
        scratch = Path(self.enterContext(TemporaryDirectory()))
        self.database = scratch / "identity.sqlite3"
        self.password = "Ephemeral browser test password"
        with IdentityStore(self.database) as store:
            for handle in ("first-browser", "second-browser"):
                store.create_account(handle, self.password)
        self.base_url = await self.enterAsyncContext(running_product(self.database, scratch / "journals", composition_module=self.composition))
        playwright = await self.enterAsyncContext(async_playwright())
        self.browser = await playwright.chromium.launch(
            executable_path=os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"),
            ignore_default_args=["--disable-back-forward-cache"],
        )
        self.addAsyncCleanup(self.browser.close)

    async def open_chat(self, handle):
        context = await self.browser.new_context(base_url=self.base_url)
        self.addAsyncCleanup(context.close)
        page = await context.new_page()
        page.on("pageerror", lambda err: print(f"{handle} page error: {browser_error(err)}", flush=True))
        page.on("console", lambda msg: print(f"{handle} console: {browser_error(msg.text)}", flush=True)
                if msg.type == "error" else None)
        page.on("requestfailed", lambda req: print(
            f"{handle} request failed: {browser_error(urlsplit(req.url).path)}", flush=True))
        page.on("response", lambda resp: print(
            f"{handle} HTTP {resp.status}: {browser_error(urlsplit(resp.url).path)}", flush=True)
            if resp.status >= 400 else None)
        await page.goto("/login")
        login = page.get_by_role("dialog")
        await expect(login.get_by_role("button", name="Продолжить как гость")).to_have_count(0)
        await expect(login.get_by_role("link", name="Создать аккаунт", exact=True)).to_be_visible()
        await page.get_by_label("Логин", exact=True).fill(handle)
        await page.get_by_label("Пароль", exact=True).fill(self.password)
        async with page.expect_response(lambda res: res.request.is_navigation_request() and
                                        urlsplit(res.url).path == "/app/") as landing:
            await page.get_by_role("dialog").get_by_role("button", name="Войти", exact=True).click()
        response = await landing.value
        self.assertEqual(response.status, 200)
        policy = await response.header_value("content-security-policy") or ""
        scripts = [d.strip().split() for d in policy.split(";") if d.strip().startswith("script-src ")]
        self.assertEqual(len(scripts), 1, "Protected application must set its script-src policy")
        self.assertIn("'self'", scripts[0])
        self.assertNotIn("'unsafe-eval'", scripts[0])
        await expect(page).to_have_url(re.compile(r"/app/chats/[a-zA-Z0-9_-]+$"))
        return page

    async def send_turn(self, page, text):
        await page.locator('[data-composer-input][contenteditable=true]').fill(text)
        button = page.get_by_role("button", name="Отправить сообщение", exact=True)
        try:
            await expect(button).to_be_enabled(timeout=30_000)
        except AssertionError as error:
            alert = await page.get_by_role("alert").all_text_contents()
            self.fail(f"{error}\nVisible product errors: {[browser_error(s) for s in alert]}"
                      f"\nNative bootstrap: {await boot_status(page)}")
        await button.click()



class BrowserIsolation(ProductBrowser):
    async def test_wildberries_catalogue_and_sidebar(self):
        await self.check_catalogue_and_sidebar("wb", "Вайлдберис")

    async def test_ozon_catalogue_and_sidebar(self):
        await self.check_catalogue_and_sidebar("ozon", "Озон")

    async def check_catalogue_and_sidebar(self, provider, title):
        page=await self.open_chat("first-browser")
        await page.get_by_role("button",name="Плагины",exact=True).click()
        dialog=page.get_by_role("dialog",name="Плагины")
        catalog=page.get_by_role("button",name="Плагины",exact=True)
        connected=page.get_by_role("navigation",name="Подключённые плагины")
        shortcut=connected.get_by_role("button",name=title,exact=True)
        for category in ("Аналитика","Реклама","Графика","Документы"):
            await expect(dialog.get_by_role("button",name=category,exact=True)).to_be_visible()
        analytics=dialog.get_by_role("button",name="Аналитика",exact=True)
        switch=dialog.get_by_role("switch",name="Подключить "+title)
        await analytics.click()
        await expect(switch).to_be_hidden()
        await analytics.click()
        await expect(dialog.get_by_text(re.compile("Отчёты "+("WB" if provider=="wb" else "Ozon")))).to_be_visible()
        await switch.click()
        await expect(switch).to_be_checked()
        await expect(switch).to_be_enabled()
        self.assertEqual(await switch.evaluate("el=>el.tagName"),"BUTTON")
        close=dialog.get_by_role("button",name="Закрыть",exact=True)
        close_box=await close.bounding_box()
        panel_box=await dialog.bounding_box()
        self.assertLess(close_box["width"],48)
        self.assertGreater(close_box["x"],panel_box["x"]+panel_box["width"]*.75)
        await close.click()
        await expect(connected.get_by_text("Подключённые плагины",exact=True)).to_be_visible()
        await expect(shortcut).to_be_in_viewport()
        self.assertTrue(await shortcut.evaluate("""plugin => {
            const list = plugin.closest('.octo-workspace-list');
            const lastChat = [...list.querySelectorAll('[data-row-key^="session:"]')].at(-1);
            if (!lastChat) return false;
            const gap = plugin.closest('.octo-plugin-navigation').getBoundingClientRect().top
                - lastChat.getBoundingClientRect().bottom;
            return gap >= -1 && gap < 24;
        }"""))
        await shortcut.click()
        settings=page.get_by_role("dialog",name=title)
        await expect(settings.get_by_text("Магазины",exact=True)).to_be_visible()
        await settings.get_by_role("button", name="Добавить магазин", exact=True).click()
        await expect(settings).to_have_count(0)
        await expect(page.get_by_role("heading", name="Интеграции", exact=True)).to_be_visible()
        await page.get_by_role("dialog").get_by_role("button", name="Закрыть", exact=True).click()
        self.enterContext(patch.dict(os.environ,{"HARNESS_INTEGRATIONS_KEY_FILE":str(self.database.parent/"plugin-test-key")}))
        (self.database.parent/"plugin-test-key").write_bytes(os.urandom(32))
        connection=await page.request.post("/api/integrations",headers={"Origin":self.base_url},data={
            "name":"Проверочный магазин","provider":provider,"fields":({"token":"fixture-token"} if provider=="wb" else {"client_id":"12345","api_key":"fixture-key"})})
        self.assertTrue(connection.ok)
        await page.get_by_role("button",name=title,exact=True).click()
        page_data={"cards":[{"nmID":82,"vendorCode":"FIXTURE","title":"Тестовый товар"}],"cursor":{"total":1}}
        async def catalogue(url, **kwargs):
            if provider=="wb":
                return httpx.Response(200,json=page_data)
            if url.endswith("/product/list"):
                return httpx.Response(200,json={"result":{"items":[{"product_id":17}],"total":1,"last_id":""}})
            self.assertTrue(url.endswith("/product/info/list"))
            return httpx.Response(200,json={"items":[{"id":17,"offer_id":"FIXTURE","name":"Тестовый товар","sku":82}]})
        with patch.object(httpx.AsyncClient,"post",side_effect=catalogue):
            await settings.get_by_role("button",name="Подключить в этом чате · Проверочный магазин").click()
            await expect(settings.get_by_role("option",name=re.compile("Тестовый товар"))).to_have_count(1)
        await expect(settings.locator(".plugin-metric")).to_have_count(4 if provider=="wb" else 2)
        await expect(settings.get_by_role("button",name="Рассчитать",exact=True)).to_have_count(4 if provider=="wb" else 2)
        dates=settings.locator('input[type="date"]')
        await dates.first.fill("2024-02-01")
        await settings.get_by_role("button",name="За год").click()
        self.assertEqual((date.fromisoformat(await dates.last.input_value())-
                          date.fromisoformat(await dates.first.input_value())).days,364)
        if provider=="wb":
            await settings.get_by_role("button",name="Схемы складов").click()
            await settings.get_by_label("Название склада WB").fill("Тестовый склад")
            await settings.get_by_label("Схема",exact=True).select_option("FBW")
            await settings.get_by_role("button",name="Сохранить схему").click()
            await expect(settings.get_by_text("Тестовый склад · FBW",exact=True)).to_be_visible()
            await settings.get_by_role("button",name="Схемы складов").click()
        else:
            await expect(settings.get_by_role("button",name="Схемы складов")).to_have_count(0)
            await settings.get_by_label("Найти товар").fill("FIXTURE")
            await expect(settings.get_by_role("option",name=re.compile("SKU 82"))).to_have_count(1)
        choose_model=settings.get_by_role("button",name="Модель для расчётов")
        await choose_model.click()
        options={"demo-model":{"id":"demo-model","name":"Проверочная модель","efforts":["off","high"],"defaultEffort":"high"}}
        with patch("platform_core.user_plugins.service.chat_defaults.available_models",return_value=options):
            await settings.get_by_role("button",name="Запросить модели").click()
            await settings.get_by_label("Модель",exact=True).select_option("demo-model")
            await settings.get_by_label("Рассуждение").select_option("off")
            await settings.get_by_role("button",name="Сохранить модель").click()
            await expect(settings.get_by_text("demo-model · off",exact=True)).to_be_visible()
            await settings.get_by_label("Модель",exact=True).select_option("")
            await settings.get_by_role("button",name="Сохранить модель").click()
            await expect(settings.get_by_text("Используется общая модель Octoport.")).to_be_visible()
        await choose_model.click()
        metric=settings.locator(".plugin-metric").filter(has_text="Доля отмен и возвратов")
        await metric.get_by_role("textbox").fill("12")
        await metric.get_by_role("button",name="Сохранить").click()
        await expect(metric.get_by_text(re.compile("Вручную"))).to_be_visible()
        await settings.get_by_label("Область расчёта").select_option("82")
        await expect(metric.get_by_role("textbox")).to_have_value("")
        await metric.get_by_role("textbox").fill("0")
        await metric.get_by_role("button",name="Сохранить").click()
        await expect(metric.get_by_text(re.compile("Вручную"))).to_be_visible()
        if provider=="ozon":
            from contextlib import asynccontextmanager
            from types import SimpleNamespace

            @asynccontextmanager
            async def selected(*args, **kwargs):
                yield SimpleNamespace(model=None,direct_model="fixture",token="fixture"), ("parameter.delivery_mean.v1",)

            async def calculated(scope, cid, metric_id, period, sku, grant, job, database):
                self.assertEqual((metric_id,sku),("forward","82"))
                self.assertEqual((period[1]-period[0]).days,364)
                return "25.5", {"inputs":{"ordered_units":"2","forward_delivery":"50","last_delivery":"1"}}

            delivery=settings.locator(".plugin-metric").filter(has_text="Прямая и последняя доставка")
            with patch("platform_core.user_plugins.model.choose_templates",selected), \
                 patch("platform_core.marketplace_matrix.ozon_coefficients.calculate",calculated):
                async with page.expect_response(lambda r: urlsplit(r.url).path.endswith("/ozon/calculate")) as job:
                    await delivery.get_by_role("button",name="Рассчитать").click()
                self.assertEqual((await job.value).status,202)
                await expect(delivery.get_by_role("textbox")).to_have_value("25.5")
                await expect(delivery.get_by_text(re.compile("По отчётам Озон"))).to_be_visible()
        await settings.get_by_label("Область расчёта").select_option("")
        await expect(metric.get_by_role("textbox")).to_have_value("12")
        await settings.get_by_role("button",name="Закрыть").click()
        original=page.url
        await page.reload()
        await expect(shortcut).to_be_visible()
        await shortcut.click()
        await expect(metric.get_by_role("textbox")).to_have_value("12")
        await settings.get_by_role("button",name="Закрыть").click()
        other=await page.request.post("/api/chats",headers={"Origin":self.base_url})
        self.assertEqual(other.status,201)
        await page.goto("/app/chats/"+(await other.json())["chatId"])
        await catalog.click()
        await expect(switch).not_to_be_checked()
        await page.keyboard.press("Escape")
        await expect(connected).to_have_count(0)
        await page.goto(original)
        await expect(shortcut).to_be_visible()
        await shortcut.hover()
        await connected.get_by_role("button",name="Действия плагина «"+title+"»").click()
        await page.get_by_role("menuitem",name="Отключить плагин",exact=True).click()
        await expect(shortcut).to_have_count(0)
        await page.reload()
        await catalog.click()
        await expect(switch).not_to_be_checked()
        await expect(switch).to_be_enabled()
        await page.keyboard.press("Escape")
        await expect(connected).to_have_count(0)

    async def test_plugin_navigation_on_collapsed_sidebar_and_mobile(self):
        page=await self.open_chat("first-browser")
        catalog=page.get_by_role("button",name="Плагины",exact=True)
        dialog=page.get_by_role("dialog",name="Плагины")
        await catalog.click()
        await dialog.get_by_role("switch",name="Подключить Озон").click()
        await expect(dialog.get_by_role("switch",name="Подключить Озон")).to_be_checked()
        await dialog.get_by_role("switch",name="Подключить Вайлдберис").click()
        await expect(dialog.get_by_role("switch",name="Подключить Вайлдберис")).to_be_checked()
        await page.keyboard.press("Escape")
        await page.locator("[data-sidebar-toggle]:visible").click()
        await expect(page.locator('.octo-plugin-navigation[data-wide="false"]')).to_be_visible()
        shortcuts=page.get_by_role("navigation",name="Подключённые плагины")
        await shortcuts.get_by_role("button",name="Озон",exact=True).click()
        await page.get_by_role("menuitem",name="Открыть плагин",exact=True).click()
        await expect(page.get_by_role("dialog",name="Озон")).to_be_visible()
        await page.keyboard.press("Escape")
        await shortcuts.get_by_role("button",name="Вайлдберис",exact=True).click()
        await page.get_by_role("menuitem",name="Отключить плагин",exact=True).click()
        await expect(shortcuts.get_by_role("button",name="Вайлдберис",exact=True)).to_have_count(0)
        await page.locator("[data-sidebar-toggle]:visible").click()
        await account_action(page, "Настройки")
        await page.get_by_role("button",name="Тёмная",exact=True).click()
        await page.keyboard.press("Escape")
        await page.set_viewport_size({"width":390,"height":700})
        await page.locator("[data-sidebar-opener]:visible").click()
        await catalog.click()
        await expect(dialog.get_by_role("switch",name="Подключить Вайлдберис")).not_to_be_checked()
        await expect(dialog.get_by_role("switch",name="Подключить Озон")).to_be_checked()
        await expect(page.locator("body[data-ds-dark-theme]")).to_have_count(1)
        close=dialog.get_by_role("button",name="Закрыть")
        await expect(close).to_be_in_viewport()
        await close.click()
        await expect(dialog).to_have_count(0)

    async def test_store_connection_updates_plugin_shortcut_without_reloading(self):
        key=self.database.parent/"plugin-key"
        key.write_bytes(os.urandom(32))
        with patch.dict(os.environ,{"HARNESS_INTEGRATIONS_KEY_FILE":str(key)}):
            page=await self.open_chat("first-browser")
            connection=await page.request.post("/api/integrations",headers={"Origin":self.base_url},
                data={"name":"Магазин WB","provider":"wb","fields":{"token":"fixture-key"}})
            self.assertTrue(connection.ok)
            await page.reload()
            await page.get_by_role("button",name="Подключения",exact=True).click()
            dialog=page.get_by_role("dialog",name="Подключения этого чата")
            shortcut=page.get_by_role("navigation",name="Подключённые плагины").get_by_role("button",name="Вайлдберис",exact=True)
            await expect(shortcut).to_have_count(0)
            with patch.object(httpx.AsyncClient,"post",return_value=httpx.Response(200,json={"cards":[],"cursor":{"total":0}})):
                await dialog.get_by_role("switch",name="Магазин WB · Wildberries").click()
                await dialog.get_by_role("button",name="Закрыть").click()
                await expect(shortcut).to_be_visible()
                await shortcut.click()
                settings=page.get_by_role("dialog",name="Вайлдберис",exact=True)
                await expect(settings.get_by_role("button",name="Магазин WB",exact=True)).to_have_attribute("aria-pressed","true")
                await settings.get_by_role("button",name="Отключить магазин от чата").click()
                await expect(settings.get_by_role("button",name="Подключить в этом чате · Магазин WB")).to_be_visible()

    async def test_startup_transfers_the_viewport_to_the_composer(self):
        member = await self.open_chat("first-browser")
        guest_context = await self.browser.new_context(base_url=self.base_url)
        try:
            guest = await guest_context.new_page()
            await guest.goto("/")
            await member.reload()
            for page in (guest, member):
                await expect(page.locator("[data-composer-input]").last).to_be_in_viewport()
                await expect(page.locator("[data-dsh-boot]")).to_have_count(0)
                await expect(page.locator("#chat-opening")).to_have_count(0)
        finally:
            await guest_context.close()

    async def test_opening_draft_reaches_native_editor_without_sending(self):
        member = await self.open_chat("first-browser")
        guest = await self.browser.new_page(base_url=self.base_url)
        self.addAsyncCleanup(guest.close)
        for page in (member, guest):
            gate = asyncio.Event()
            async def delay(route):
                await gate.wait()
                await route.continue_()
            await page.route("**/ui-assets/modules/core-*.js", delay)
            posts = []
            page.on("request", lambda request: posts.append(request.url) if request.url.endswith("/turns") and request.method == "POST" else None)
            try:
                await page.goto(page.url if page == member else "/", wait_until="commit")
                await page.get_by_role("textbox", name="Черновик сообщения").fill("Мой черновик")
            finally:
                gate.set()
            editor = page.locator("[data-composer-input][contenteditable=true]")
            await expect(editor).to_have_text("Мой черновик")
            await expect(page.get_by_role("button", name="Отправить сообщение")).to_be_enabled()
            self.assertEqual(posts, [])

    async def test_saved_chat_reads_history_once_while_native_core_is_pending(self):
        page = await self.open_chat("first-browser")
        marker = "История до запуска интерфейса"
        await self.send_turn(page, marker)
        conversation = page.locator('[data-slot="conversation.view"]')
        await expect(conversation).to_contain_text("Тестовая модель", timeout=45_000)
        release, started = asyncio.Event(), asyncio.Event()
        requests = []

        async def hold_core(route):
            started.set()
            await release.wait()
            await route.continue_()

        await page.route("**/ui-assets/modules/core-*.js", hold_core)
        page.on("request", lambda request: requests.append(request.url)
                if urlsplit(request.url).path.endswith("/events") else None)
        try:
            await page.reload(wait_until="commit")
            await asyncio.wait_for(started.wait(), 15)
            preview = page.get_by_role("region", name="История чата")
            await expect(preview).to_contain_text(marker)
            await expect(preview).to_be_visible()
            self.assertEqual(len(requests), 1)
        finally:
            release.set()
        await expect(conversation).to_contain_text(marker)
        await expect(page.locator("#chat-opening")).to_have_count(0)
        self.assertEqual(len(requests), 1)

    async def test_stylesheet_load_event_does_not_gate_chat(self):
        page = await self.open_chat("first-browser")
        await page.add_init_script("""window.addEventListener('load', e => {
          if(e.target instanceof HTMLLinkElement && e.target.hasAttribute('data-chat-style'))
            e.stopImmediatePropagation();
        }, true)""")
        await page.reload()
        await expect(page.locator('[data-composer-input]').last).to_be_visible()

    async def test_failed_native_bundle_preserves_readable_history(self):
        page = await self.open_chat("first-browser")
        marker = "Сохранённое сообщение при ошибке интерфейса"
        await self.send_turn(page, marker)
        await expect(page.locator('[data-slot="conversation.view"]')).to_contain_text("Тестовая модель", timeout=45_000)
        # The pinned loader can recover from a failed batch via individual modules.
        # Exercise the terminal failure by also denying its fallback.
        await page.route("**/ui-assets/modules/*.js*", lambda route: route.abort())
        await page.reload()
        await expect(page.get_by_role("region", name="История чата")).to_contain_text(marker)
        await expect(page.locator('#chat-opening [role="status"]')).to_have_text("Не удалось загрузить интерфейс чата.")
        await expect(page.locator('#chat-opening')).to_be_visible()

    async def test_direct_link_displays_while_resources_and_history_are_pending(self):
        page = await self.open_chat("first-browser")
        marker = "Проверка открытия переписки"
        history = page.locator('[data-slot="conversation.view"]')
        await expect(page.get_by_role("button",name="Выберите рабочее пространство")).to_have_count(0)
        await expect(page.get_by_text("Мои чаты",exact=True)).to_have_count(0)
        await self.send_turn(page, marker)
        await expect(history).to_contain_text(f"Тестовая модель (ход 1): {marker}", timeout=45_000)
        scripts, events = asyncio.Event(), asyncio.Event()
        started, history_requested = asyncio.Event(), asyncio.Event()
        requests = []

        async def hold_script(route):
            started.set()
            await scripts.wait()
            await route.continue_()

        async def hold_history(route):
            history_requested.set()
            await events.wait()
            await route.continue_()

        await page.route("**/ui-assets/project/transport.js", hold_script)
        await page.route("**/events", hold_history)
        page.on("request", lambda request: requests.append(urlsplit(request.url).path))
        try:
            await page.reload(wait_until="commit")
            await asyncio.wait_for(started.wait(), 10)
            await expect(page.get_by_text("Открываем чат…", exact=True)).to_be_visible()
            scripts.set()
            await asyncio.wait_for(history_requested.wait(), 15)
            await expect(page.get_by_role("button", name="Баланс", exact=True)).to_be_visible()
            await expect(page.get_by_role("button", name="Обновить страницу")).to_have_count(0)
            self.assertNotIn("/api/wallet", requests)
            self.assertNotIn("/api/chats", requests)
        finally:
            scripts.set()
            events.set()
        await expect(history).to_contain_text(marker)
        await expect(page.locator("#chat-opening")).to_have_count(0)
        await page.get_by_role("button", name="Баланс", exact=True).click()
        await expect(page.locator(".wallet-amount")).to_be_visible()
        self.assertIn("/api/wallet", requests)
        wallet = await (await page.request.get("/api/wallet/balance")).json()
        rounded = Decimal(wallet["available"]).quantize(Decimal(".01"), rounding=ROUND_HALF_UP)
        await expect(page.locator(".sidebar-coins:visible").first).to_have_text(f"{rounded} монет".replace(".", ","))
        await page.get_by_role("link", name="Пополнить баланс").click()
        await expect(page.get_by_role("heading", name="Пополнение баланса")).to_be_visible()

    async def test_startup_survives_missing_external_boot_scripts(self):
        page = await self.open_chat("first-browser")
        legacy = ("/session-nav.js", "/ui-assets/project/bootstrap.js",
                  "/ui-assets/modules/dsh-client-modules.js", "/ui-assets/modules/manifest.js")
        requested = []
        for path in legacy:
            async def empty(route):
                requested.append(urlsplit(route.request.url).path)
                await route.fulfill(status=200, content_type="text/javascript", body="")
            await page.route("**" + path, empty)
        await page.reload()
        await expect(page.locator("[data-composer-input]").last).to_be_visible()
        self.assertEqual(requested, [])
        self.assertTrue(await page.evaluate("!!window.__DSH_BOOT__?.batches?.length"))

    async def test_account_menu_profile_and_payment_on_mobile(self):
        page = await self.open_chat("first-browser")
        other_session = await self.open_chat("first-browser")
        await page.set_viewport_size({"width": 390, "height": 740})
        await page.locator("[data-sidebar-opener]:visible").click()
        await expect(page.get_by_role("button", name="Меню аккаунта")).to_contain_text("first-browser")
        await expect(page.get_by_role("button", name="Интеграции", exact=True)).to_have_count(0)
        await expect(page.get_by_role("button", name="Настройки", exact=True)).to_have_count(0)
        trigger = page.get_by_role("button", name="Меню аккаунта", exact=True)
        await trigger.click()
        menu = page.get_by_role("menu")
        await expect(menu).to_be_in_viewport()
        menu_box, trigger_box = await menu.bounding_box(), await trigger.bounding_box()
        self.assertLess(abs(trigger_box["y"] - menu_box["y"] - menu_box["height"]), 16)
        await expect(menu.get_by_role("menuitem", name="Пополнить баланс")).to_have_count(0)
        await menu.get_by_role("menuitem", name="Баланс", exact=True).click()
        await expect(page.get_by_role("dialog", name="Баланс").get_by_role(
            "link", name="Пополнить баланс", exact=True)).to_have_attribute("href", "/payment")
        await page.keyboard.press("Escape")
        await account_action(page, "Профиль")
        profile = page.get_by_role("dialog", name="Профиль")
        for width,height in ((320,560),(740,320),(1280,800)):
            await page.set_viewport_size({"width":width,"height":height})
            await expect(profile.get_by_role("button",name="Закрыть")).to_be_in_viewport()
            geometry=await profile.evaluate("""el=>{
                const p=el.getBoundingClientRect(), x=el.querySelector('button[aria-label="Закрыть"]').getBoundingClientRect();
                const fields=[...el.querySelectorAll('input[type=password]')].map(input=>input.getBoundingClientRect());
                return {fits:p.left>=-1 && p.right<=innerWidth+1 && p.top>=-1 && p.bottom<=innerHeight+1,
                    closeOnRight:x.left>p.left+p.width*.7,
                    fieldsFit:fields.every(f=>f.left>=p.left && f.right<=p.right && Math.abs(f.width-fields[0].width)<1)};
            }""")
            self.assertTrue(all(geometry.values()),(width,height,geometry))
            save=profile.get_by_role("button",name="Изменить пароль")
            await save.scroll_into_view_if_needed()
            await expect(save).to_be_in_viewport()
            await profile.get_by_role("button",name="Закрыть").scroll_into_view_if_needed()
        await page.set_viewport_size({"width":390,"height":740})
        await profile.get_by_label("Текущий пароль", exact=True).fill("Wrong password for acceptance")
        new_password = "New browser password for acceptance"
        for label in ("Новый пароль", "Повторите новый пароль"):
            await profile.get_by_label(label, exact=True).fill(new_password)
        await profile.get_by_role("button", name="Изменить пароль").click()
        await expect(profile.get_by_role("alert")).to_contain_text("Проверьте текущий пароль")
        await profile.get_by_label("Текущий пароль", exact=True).fill(self.password)
        await profile.get_by_role("button", name="Изменить пароль").click()
        await expect(profile.get_by_role("status")).to_contain_text("Пароль изменён")
        self.assertTrue((await (await page.request.get("/api/session/status")).json())["authenticated"])
        self.assertFalse((await (await other_session.request.get("/api/session/status")).json())["authenticated"])
        await page.keyboard.press("Escape")
        if not await trigger.is_visible():
            await page.locator("[data-sidebar-opener]:visible").click()
        await account_action(page, "Баланс")
        await page.get_by_role("dialog",name="Баланс").get_by_role("link",name="Пополнить баланс").click()
        await expect(page).to_have_url(self.base_url + "/payment")
        await expect(page.get_by_role("heading", name="Пополнение баланса")).to_be_visible()

    async def test_wallet_rounds_and_scrolls_five_charges(self):
        with IdentityStore(self.database) as store:
            store.grant_coins("first-browser", "95.159360053992", "wallet-fraction", "Test")
        page = await self.open_chat("first-browser")
        await expect(page.locator(".sidebar-coins:visible").first).to_have_text("95,16 монет")
        async def history(route):
            response = await route.fetch()
            wallet = await response.json()
            wallet["charges"] = [{"requestId": str(i), "pending": False, "coins": "0.025"} for i in range(12)]
            await route.fulfill(response=response, json=wallet)
        await page.route("**/api/wallet", history)
        await page.get_by_role("button", name="Баланс", exact=True).click()
        dialog = page.get_by_role("dialog", name="Баланс")
        await expect(dialog.locator(".wallet-amount")).to_contain_text("95,16 монет")
        await expect(dialog).not_to_contain_text("Цена покупки")
        await expect(dialog).not_to_contain_text("покрывает")
        charges = dialog.locator(".wallet-history")
        await expect(charges).to_be_hidden()
        await dialog.get_by_role("button", name="Показать списания").click()
        await expect(charges.get_by_role("listitem")).to_have_count(12)
        await expect(charges.get_by_role("listitem").first).to_contain_text("0,03 монет")
        await expect(charges).to_be_visible()
        self.assertTrue(await charges.evaluate("""el => {
            const row = el.firstElementChild.offsetHeight;
            return Math.abs(el.clientHeight - 5 * row) <= 1 && el.scrollHeight > el.clientHeight;
        }"""))
        await charges.focus()
        await charges.press("End")
        await expect(charges.get_by_role("listitem").last).to_be_in_viewport()
        await dialog.get_by_role("button", name="Скрыть списания").click()
        await expect(charges).to_be_hidden()

    async def test_failed_chat_module_can_retry_the_same_direct_link(self):
        page = await self.open_chat("first-browser")
        direct_link = page.url
        pattern = "**/ui-assets/project/private-input.js"
        await page.route(pattern, lambda route: route.abort())
        await page.reload()
        await expect(page.get_by_role("status")).to_have_text("Не удалось открыть чат.")
        await page.unroute(pattern)
        await expect(page.get_by_role("button", name="Обновить страницу")).to_have_count(0)
        await page.reload()
        await expect(page.locator('[data-composer-input]')).to_be_visible()
        self.assertEqual(urlsplit(page.url).path, urlsplit(direct_link).path)

    async def test_failed_history_can_retry_without_creating_a_chat(self):
        page = await self.open_chat("first-browser")
        marker = "Переписка после временной ошибки"
        await self.send_turn(page, marker)
        history = page.locator('[data-slot="conversation.view"]')
        await expect(history).to_contain_text(f"Тестовая модель (ход 1): {marker}", timeout=45_000)
        direct_link = page.url
        await page.route("**/events", lambda route: route.fulfill(status=503, body="{}"))
        await page.reload()
        await expect(page.get_by_text("Не удалось загрузить историю чата.", exact=True)).to_be_visible()
        await page.unroute("**/events")
        await page.get_by_role("button", name="Повторить загрузку").click()
        await expect(history).to_contain_text(marker)
        self.assertEqual(urlsplit(page.url).path, urlsplit(direct_link).path)
        self.assertEqual(len(await (await page.request.get("/api/chats")).json()), 1)

    async def test_chat_controls_and_store_setup(self):
        page = await self.open_chat("first-browser")
        chat_path = urlsplit(page.url).path
        chat_id = chat_path.rsplit("/", 1)[1]
        await self.send_turn(page, "Проверка интерфейса")
        await expect(page.locator('[data-chat-flow-kind="assistant-step"]')).to_be_visible(timeout=45_000)
        await expect(page.get_by_role("tab", name="Траектория")).to_have_count(0)
        trigger = page.get_by_role("button", name="Подключения", exact=True)
        for width in (1200, 390):
            await page.set_viewport_size({"width": width, "height": 850})
            await expect(trigger).to_be_visible()
            # The sidebar switches layouts on resize. Compare both boxes in the same frame.
            await page.wait_for_function("""width => {
                const pill = document.querySelector('.chat-access-trigger');
                const card = document.querySelector('[data-composer-input]')?.closest('.uV2eYG_card');
                return innerWidth === width && pill && card &&
                    Math.abs(pill.getBoundingClientRect().left - card.getBoundingClientRect().left) <= 2;
            }""", arg=width, timeout=5000)
        await page.set_viewport_size({"width": 1200, "height": 850})
        await trigger.click()
        await page.get_by_role("button", name="Добавить подключение").click()
        dialog = page.get_by_role("dialog", name="Подключение сервиса")
        for provider, title, field in (("wb", "Как получить токен Wildberries", "Только чтение"),
                                       ("ozon", "Как получить ключи Ozon Seller", "Client-Id продавца"),
                                       ("ozon", "Как получить ключи Ozon Performance", "Client Secret Performance")):
            await dialog.get_by_label("Сервис", exact=True).select_option(provider)
            await dialog.get_by_text(title, exact=True).click()
            await expect(dialog.locator("details[open] ol").filter(has_text=field)).to_be_visible()
        await dialog.get_by_role("button", name="Закрыть", exact=True).click()
        row = page.locator(f'[data-row-key="session:{chat_id}"]')
        await row.hover()
        # Wait past the pinned client's 800 ms hover delay. The row actions still work.
        await page.wait_for_timeout(1000)
        await expect(page.locator('[class$="_hoverContent"]:visible')).to_have_count(0)
        await row.locator("[data-context-menu-trigger]").click()
        await page.get_by_text("Удалить чат", exact=True).click()
        confirm = page.get_by_role("dialog", name="Удалить чат?")
        await confirm.get_by_role("button", name="Отмена").click()
        await expect(row).to_be_visible()
        await row.hover()
        await row.locator("[data-context-menu-trigger]").click()
        await page.get_by_text("Удалить чат", exact=True).click()
        await confirm.get_by_role("button", name="Удалить чат", exact=True).click()
        await expect(page).not_to_have_url(re.compile(re.escape(chat_id) + "$"))
        await expect(page.locator("[data-composer-input]").last).to_be_visible()
        self.assertEqual((await page.request.get(chat_path)).status, 404)
        self.assertNotIn(chat_id, await (await page.request.get("/api/chats")).json())

    async def test_sidebar_preserves_individual_activity_on_reload(self):
        page = await self.open_chat("first-browser")
        first = urlsplit(page.url).path.rsplit("/", 1)[1]
        await self.send_turn(page, "Первый вопрос")
        await expect(page.locator('[data-chat-flow-kind="assistant-step"]')).to_be_visible(timeout=45000)
        # Make the first conversation old without waiting for the relative clock.
        with sqlite3.connect(self.database.parent / "journals/native-chats.sqlite3") as db:
            for key, rev, raw in db.execute("SELECT scope_key,revision,events FROM native_batches").fetchall():
                events = json.loads(raw)
                for event in events:
                    event["time"] -= 3600000
                db.execute("UPDATE native_batches SET events=? WHERE scope_key=? AND revision=?",
                           (json.dumps(events), key, rev))
        other = (await (await page.request.post("/api/chats", headers={"Origin": self.base_url})).json())["chatId"]
        await page.goto("/app/chats/" + other)
        before = await (await page.request.get("/api/chats?view=activity")).json()
        self.assertIsNone(before[other])
        self.assertGreater(before[first], 0)
        old_row = page.locator(f'[data-row-key="session:{first}"]')
        await expect(old_row).to_be_visible()
        await expect(old_row).not_to_contain_text("сейчас")
        await expect(page).to_have_url(self.base_url + "/app/chats/" + other)
        await self.send_turn(page, "Второй вопрос")
        await expect(page.locator('[data-chat-flow-kind="assistant-step"]')).to_be_visible(timeout=45000)
        await expect(page.locator('[data-slot="conversation.view"]')).to_contain_text("Тестовая модель (ход 1): Второй вопрос")
        await expect(page.locator(f'[data-row-key="session:{other}"]')).to_contain_text("сейчас")
        await page.reload()
        await expect(page.locator(f'[data-row-key="session:{other}"]')).to_contain_text("сейчас")
        await expect(old_row).not_to_contain_text("сейчас")
        after = await (await page.request.get("/api/chats?view=activity")).json()
        self.assertEqual(before[first], after[first])
        self.assertGreater(after[other], after[first])

    async def test_delete_active_chats_in_series_keeps_document(self):
        page = await self.open_chat("first-browser")
        first = urlsplit(page.url).path.rsplit("/", 1)[-1]
        await self.send_turn(page, "Первый чат")
        await expect(page.locator('[data-chat-flow-kind="assistant-step"]')).to_be_visible()
        other = []
        for _ in range(2):
            response = await page.request.post("/api/chats", headers={"Origin": self.base_url})
            other.append((await response.json())["chatId"])
        await page.reload()
        await expect(page.get_by_role("button", name="Баланс", exact=True)).to_be_visible()
        main_documents = []
        page.on("request", lambda req: main_documents.append(req.url) if req.is_navigation_request() else None)
        for chat in (first, *reversed(other)):
            await expect(page).to_have_url(self.base_url + "/app/chats/" + chat)
            row = page.locator(f'[data-row-key="session:{chat}"]')
            await row.hover()
            await row.locator("[data-context-menu-trigger]").click()
            await page.get_by_text("Удалить чат", exact=True).click()
            dialog = page.get_by_role("dialog", name="Удалить чат?")
            await dialog.get_by_role("button", name="Удалить чат").click()
            await expect(dialog).to_have_count(0)
            await expect(row).to_have_count(0)
        await expect(page.locator("[data-composer-input]").last).to_be_visible()
        await self.send_turn(page, "Сообщение после удаления последнего чата")
        await expect(page.locator('[data-chat-flow-kind="assistant-step"]')).to_be_visible()
        self.assertEqual(main_documents, [])
        self.assertNotIn(urlsplit(page.url).path.rsplit("/", 1)[-1], [first, *other])

    async def test_appearance_choice_survives_reload_and_overrides_system(self):
        page = await self.open_chat("first-browser")
        for label, value, os_scheme in (("Тёмная", "dark", "light"), ("Светлая", "light", "dark"),
                                        ("Система", "system", "dark")):
            await page.emulate_media(color_scheme=os_scheme)
            await account_action(page, "Настройки")
            await page.get_by_role("button", name=label, exact=True).click()
            await expect(page.locator("html")).to_have_attribute("data-theme", value)
            response = await page.reload()
            self.assertIn(f'data-theme="{value}"', await response.text())
            await expect(page.locator("[data-composer-input]").last).to_be_visible()
            await expect(page.locator("body[data-ds-dark-theme]")).to_have_count(int(value != "light"))

    async def test_chat_menu_attaches_catalog_plugin_to_target_chat(self):
        from platform_core.user_plugins.registry import Plugin

        future = Plugin("fixture-doc", "documents", "Документы для теста", "Проверочный плагин", "fixture")
        with patch.dict("platform_core.user_plugins.registry.CATALOG", {future.id: future}):
            page = await self.open_chat("first-browser")
            current = page.url
            active = urlsplit(current).path.rsplit("/", 1)[-1]
            response = await page.request.post("/api/chats", headers={"Origin": self.base_url})
            other = (await response.json())["chatId"]
            await page.reload()
            composer = page.locator("[data-composer-input]").last
            await composer.fill("Черновик открытого чата")
            dialog = page.get_by_role("dialog", name="Плагины", exact=True)

            async def open_from_row(chat):
                row = page.locator(f'[data-row-key="session:{chat}"]')
                await row.hover()
                await row.locator("[data-context-menu-trigger]").click()
                await page.get_by_role("menuitem", name="Подключить плагин", exact=True).click()
                await expect(dialog).to_be_visible()
                await expect(dialog.get_by_text(re.compile(r"^Чат «.+»$"))).to_be_visible()

            async def enabled(chat):
                response = await page.request.get(f"/api/chats/{chat}/plugins")
                return {p["id"] for p in (await response.json())["plugins"] if p["enabled"]}

            await open_from_row(other)
            target = dialog.get_by_role("switch", name="Подключить "+future.title, exact=True)
            await target.click()
            await expect(target).to_be_checked()
            await page.keyboard.press("Escape")
            await expect(dialog).to_have_count(0)
            await expect(page).to_have_url(current)
            await expect(composer).to_have_text("Черновик открытого чата")
            self.assertEqual(await enabled(other), {future.id})
            self.assertEqual(await enabled(active), set())

            # A new, empty chat exposes its own actions even on a short mobile viewport.
            await page.set_viewport_size({"width": 680, "height": 320})
            opener = page.locator("[data-sidebar-opener]:visible")
            await opener.click()
            await open_from_row(active)
            self.assertTrue(await dialog.evaluate('''el => {
                const {top, bottom} = el.getBoundingClientRect();
                return top >= 0 && bottom <= innerHeight && el.scrollHeight > el.clientHeight;
            }'''))
            await expect(target).not_to_be_checked()
            builtin = dialog.get_by_role("switch", name="Подключить Озон", exact=True)
            await builtin.scroll_into_view_if_needed()
            await builtin.click()
            await expect(builtin).to_be_checked()
            await dialog.get_by_role("button", name="Закрыть", exact=True).click()
            await page.set_viewport_size({"width": 1280, "height": 800})
            connected = page.get_by_role("navigation", name="Подключённые плагины")
            await expect(connected.get_by_role("button", name="Озон", exact=True)).to_be_visible()
            self.assertEqual(await enabled(active), {"ozon"})
            self.assertEqual(await enabled(other), {future.id})
            await page.locator(f'[data-row-key="session:{other}"]').click()
            await expect(connected.get_by_text(future.title, exact=True)).to_be_visible()
            await expect(connected.get_by_role("button", name=future.title, exact=True)).to_have_count(0)

    async def test_delete_background_chat_preserves_current_draft(self):
        page = await self.open_chat("first-browser")
        current = page.url
        other = (await (await page.request.post("/api/chats", headers={"Origin": self.base_url})).json())["chatId"]
        await page.reload()
        composer = page.locator("[data-composer-input]").last
        await composer.fill("Черновик в открытом чате")
        row = page.locator(f'[data-row-key="session:{other}"]')
        await row.hover()
        await row.locator("[data-context-menu-trigger]").click()
        await page.get_by_text("Удалить чат", exact=True).click()
        await page.get_by_role("dialog", name="Удалить чат?").get_by_role("button", name="Удалить чат").click()
        await expect(row).to_have_count(0)
        await expect(page.get_by_role("dialog", name="Удалить чат?")).to_have_count(0)
        await expect(page).to_have_url(current)
        await expect(composer).to_have_text("Черновик в открытом чате")

    async def test_two_browser_profiles_keep_their_own_chat(self):
        first, second = await asyncio.gather(self.open_chat("first-browser"), self.open_chat("second-browser"))
        first_url, second_url = first.url, second.url
        self.assertNotEqual(first_url, second_url)
        # Operator fixture enables the example only for the first chat. All user
        # actions, including sign-in and tool discovery, go through the browser.
        with IdentityStore(self.database) as store:
            operator_session = store.login("first-browser", self.password)
            chat_id = urlsplit(first_url).path.rsplit("/", 1)[1]
            scope = store.resolve_chat(operator_session, chat_id)
            store.set_entitlement(scope.workspace_id, "reference-text", True)
            store.set_enabled(scope, "reference-text", True)
            store.logout(operator_session)
        await asyncio.gather(first.reload(), second.reload())
        for page, own_url in ((first, first_url), (second, second_url)):
            links = page.locator('[data-row-key^="session:"]')
            await expect(links).to_have_count(1)
            await expect(links).to_have_attribute("data-row-key", "session:" + own_url.rsplit("/", 1)[1])
        for client, allowed in ((first,True),(second,False)):
            tools=await (await client.request.get("/api/chats/"+client.url.rsplit("/",1)[1]+"/tools")).json()
            self.assertEqual("summarize_text" in str(tools),allowed)
            await open_integrations(client)
            await expect(client.get_by_role("heading",name="Интеграции",exact=True)).to_be_visible()
            await client.get_by_role("dialog").get_by_role("button",name="Закрыть").click()
            await expect(client.locator("[data-sidebar-right-expand]")).to_be_hidden()
        pages = (first, second)
        markers = ("Приватная метка север-947", "Приватная метка юг-682")
        followups = ("Продолжение север-381", "Продолжение юг-751")
        await asyncio.gather(*(self.send_turn(page, marker) for page, marker in zip(pages, markers)))
        for page, marker in zip(pages, markers):
            await expect(page.locator('[data-slot="conversation.view"]')).to_contain_text(
                f"Тестовая модель (ход 1): {marker}", timeout=45_000,
            )
        await asyncio.gather(*(page.reload() for page in pages))
        for i, page in enumerate(pages):
            history = page.locator('[data-slot="conversation.view"]')
            await expect(history).to_contain_text(markers[i], timeout=30_000)
            await expect(history).not_to_contain_text(markers[1 - i])
        await asyncio.gather(*(self.send_turn(page, msg) for page, msg in zip(pages, followups)))
        for i, page in enumerate(pages):
            history = page.locator('[data-slot="conversation.view"]')
            await expect(history).to_contain_text(f"Тестовая модель (ход 2): {followups[i]}", timeout=45_000)
            await expect(history).to_contain_text(f"Предыдущее сообщение: {markers[i]}")
            await expect(history).not_to_contain_text(markers[1 - i])
            await expect(page.get_by_role("tab", name="Траектория", exact=True)).to_have_count(0)
            await expect(page.locator('[data-slot="conversation.view"]')).to_contain_text(followups[i])

        denied = await second.goto(first_url)
        self.assertEqual(denied.status, 404)
        await expect(second.get_by_text("Чат недоступен", exact=True)).to_be_visible()
        await expect(second.locator("body")).not_to_contain_text(markers[0])
        await second.goto(second_url)
        await expect(second.locator('[data-slot="conversation.view"]')).to_contain_text(markers[1], timeout=30_000)

        await account_action(first, "Выйти")
        await expect(first.get_by_role("button", name="Войти", exact=True).last).to_be_visible()
        await first.go_back()
        await expect(first.get_by_role("button", name="Войти", exact=True).last).to_be_visible()
        await expect(first.locator("body")).not_to_contain_text(markers[0])
        await first.goto(first_url)
        await first.reload()
        await expect(first.get_by_role("button", name="Войти", exact=True).last).to_be_visible()
        await expect(first.locator("body")).not_to_contain_text(markers[0])
        await second.reload()
        await expect(second.locator('[data-slot="conversation.view"]')).to_contain_text(followups[1], timeout=30_000)

    async def test_guest_registers_and_resumes_the_same_chat(self):
        guest = await self.browser.new_context(base_url=self.base_url)
        second_device = await self.browser.new_context(base_url=self.base_url)
        self.addAsyncCleanup(guest.close)
        self.addAsyncCleanup(second_device.close)
        page, other = await asyncio.gather(guest.new_page(), second_device.new_page())
        for client in (page, other):
            await client.goto("/")
            await expect(client.locator('[data-slot="root"] [data-composer-input]')).to_be_visible()
            await expect(client).to_have_url(re.compile(r"/app/chats/[a-zA-Z0-9_-]+$"))
        original_url = page.url
        self.assertNotEqual(original_url, other.url)
        marker = "Как сохранить мою историю?"
        await self.send_turn(page, marker)
        public_history = page.locator('[data-slot="conversation.view"]')
        await expect(public_history).to_contain_text(marker)
        answer = await public_history.locator('[data-chat-flow-kind="assistant-step"] p').last.inner_text()
        self.assertIn("регистрации", answer)
        denied = await other.goto(original_url)
        self.assertEqual(denied.status, 404)
        await expect(other.locator("body")).not_to_contain_text(marker)

        await page.get_by_role("link", name="Создать аккаунт").click()
        await page.get_by_label("Логин", exact=True).fill("guest-browser")
        await page.get_by_label("Пароль", exact=True).fill("test11chars")
        await page.get_by_text("Код восстановления",exact=True).click()
        self.assertTrue(await page.get_by_label("Ваш код").input_value())
        await page.get_by_role("button", name="Зарегистрироваться и открыть чат").click()
        await expect(page).to_have_url(original_url)
        history = page.locator('[data-slot="conversation.view"]')
        await expect(history).to_contain_text(marker, timeout=30_000)
        await expect(history).to_contain_text(answer, timeout=30_000)
        await expect(page.locator('[data-row-key^="session:"]')).to_have_count(1)
        followup = "Продолжим после регистрации"
        await self.send_turn(page, followup)
        await expect(history).to_contain_text(f"Предыдущее сообщение: {marker}", timeout=45_000)
        await page.reload()
        await expect(history).to_contain_text(f"Тестовая модель (ход 2): {followup}", timeout=30_000)

        denied = await other.goto(original_url)
        self.assertEqual(denied.status, 404)
        await other.goto("/login")
        await other.get_by_label("Логин", exact=True).fill("guest-browser")
        await other.get_by_label("Пароль", exact=True).fill("test11chars")
        await other.get_by_role("dialog").get_by_role("button", name="Войти", exact=True).click()
        link = other.locator('[data-row-key^="session:"]')
        await expect(link).to_have_count(1)
        await link.click()
        await expect(other).to_have_url(original_url)
        await expect(other.locator('[data-slot="conversation.view"]')).to_contain_text(answer, timeout=30_000)
        await expect(other.locator('[data-slot="conversation.view"]')).to_contain_text(followup)
        await account_action(page, "Выйти")
        await page.goto(original_url)
        await expect(page.get_by_role("button", name="Войти", exact=True).last).to_be_visible()
        await expect(page.locator("body")).not_to_contain_text(marker)
