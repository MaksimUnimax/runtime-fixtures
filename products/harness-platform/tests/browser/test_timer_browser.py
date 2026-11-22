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
