from playwright.async_api import expect

from test_account_browser import ProductBrowser, plugin_action


class TimerCatalogBrowser(ProductBrowser):
    async def test_install_enable_reload_and_disable_in_chat(self):
        page = await self.open_chat("first-browser")
        await page.get_by_role("button", name="Плагины", exact=True).click()
        catalog = page.get_by_role("dialog", name="Плагины")
        await catalog.get_by_role("button", name="Установить Таймер", exact=True).click()
        await expect(catalog.get_by_text("Установлен", exact=True)).to_be_visible()
        await catalog.get_by_role("button", name="Закрыть").click()
        await plugin_action(page, "Таймер", "Подключить")
        nav = page.get_by_role("navigation", name="Установленные плагины")
        row = nav.get_by_role("listitem").filter(has_text="Таймер")
        await expect(row).to_have_attribute("data-active", "true")
        await page.reload()
        await expect(row).to_have_attribute("data-active", "true")
        await plugin_action(page, "Таймер", "Отключить")
        await expect(row).to_have_attribute("data-active", "false")

    async def test_manual_test_closes_panel_and_approval_appears_in_chat(self):
        from contextlib import asynccontextmanager
        from unittest.mock import patch
        from platform_core.user_plugins.timer.runtime import Runtime

        @asynccontextmanager
        async def fixture_operation(*args):
            yield None

        choice={"kind":"report","schedule":{"kind":"interval","every_us":3_600_000_000,"zone":"Asia/Qyzylorda"},
                "plan":{"steps":[{"tool":"clock","args":{}}],"telegram":False,"notify":"all","format":"Дата"}}
        self.enterContext(patch.object(Runtime,"operation",fixture_operation))
        self.enterContext(patch.object(Runtime,"prepare",return_value=choice))
        self.enterContext(patch.object(Runtime,"render",return_value="Проверена местная дата."))
        page=await self.open_chat("first-browser")
        await page.get_by_role("button",name="Плагины",exact=True).click()
        catalog=page.get_by_role("dialog",name="Плагины")
        await catalog.get_by_role("button",name="Установить Таймер",exact=True).click()
        await expect(catalog.get_by_text("Установлен",exact=True)).to_be_visible()
        await catalog.get_by_role("button",name="Закрыть").click()
        await plugin_action(page,"Таймер","Подключить")
        timer=page.get_by_role("navigation",name="Установленные плагины").get_by_role("button",name="Таймер",exact=True)
        await timer.click()
        panel=page.get_by_role("dialog",name="Таймер")
        await panel.get_by_role("button",name="Создать отчёт").click()
        await panel.get_by_role("textbox").fill("Каждый час покажи местную дату")
        await panel.get_by_role("button",name="Протестировать").click()
        await expect(panel).to_have_count(0)
        await expect(page.get_by_text("Вас устраивает такой ответ?",exact=False).first).to_be_visible(timeout=20000)
        await self.send_turn(page,"Да")
        await expect(page.get_by_text("Таймер сохранён.",exact=False).first).to_be_visible(timeout=15000)
        await timer.click()
        await expect(panel.get_by_text("Каждый час покажи местную дату",exact=True)).to_be_visible()
        await panel.get_by_role("button",name="Редактировать").click()
        await panel.get_by_role("textbox").fill("Добавь день недели")
        await panel.get_by_role("button",name="Протестировать").click()
        await expect(panel).to_have_count(0)
        await expect(page.get_by_text("Добавь день недели",exact=True).first).to_be_visible(timeout=15000)
