"""Exercise the real file chooser, upload, draft, send and download in two layouts."""
import re

from playwright.async_api import expect

from test_account_browser import ProductBrowser


class AttachmentsBrowser(ProductBrowser):
    offline_adapter = "chat_attachments"
    composition = None

    async def test_plus_attaches_files_to_each_dialog(self):
        page = await self.open_chat("first-browser")
        first_chat = page.url
        for width, name, token in ((1100, "first.csv", "783921"), (390, "second.csv", "920184")):
            await page.set_viewport_size({"width": width, "height": 780})
            button = page.get_by_role("button", name="Прикрепить файлы", exact=True)
            await expect(button).to_be_enabled(timeout=30_000)
            async with page.expect_file_chooser() as chosen:
                await button.click()
            await (await chosen.value).set_files({"name": name, "mimeType": "text/csv", "buffer": ("total\n" + token).encode()})
            await expect(page.get_by_text(name, exact=True)).to_be_visible()
            await self.send_turn(page, "Прочитай итог из вложения")
            await expect(page.get_by_text(re.compile(token)).last).to_be_visible(timeout=20_000)
            attached = page.get_by_role("link", name=re.compile(name))
            await expect(attached).to_be_visible()
            async with page.expect_download() as saved:
                await attached.click()
            download = await saved.value
            self.assertEqual(download.suggested_filename, name)
            self.assertEqual((await download.path()).read_bytes(), ("total\n" + token).encode())
            if width == 1100:
                await page.get_by_role("button", name="Новая сессия", exact=True).filter(has_text="Новая сессия").click()
                await expect(page).not_to_have_url(first_chat)
                await expect(page.get_by_text("first.csv", exact=True)).to_have_count(0)
        await page.goto(first_chat)
        await expect(page.get_by_role("link", name=re.compile("first.csv"))).to_be_visible(timeout=30_000)
        await expect(page.get_by_text("second.csv", exact=True)).to_have_count(0)
