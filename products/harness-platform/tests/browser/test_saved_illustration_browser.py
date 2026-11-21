"""Verify a recovered image link stays with its chat when navigating."""
from urllib.parse import urlsplit

from playwright.async_api import expect

from test_account_browser import ProductBrowser


class SavedIllustrationBrowser(ProductBrowser):
    async def test_recovered_link_is_visible_only_in_its_chat(self):
        page = await self.open_chat("first-browser")
        chat = urlsplit(page.url).path.rsplit("/", 1)[-1]
        url = f"/api/chats/{chat}/illustrations/fixture"

        async def recover(route):
            response = await route.fetch()
            payload = await response.json()
            await route.fulfill(response=response, json={**payload, "savedIllustrations": [url]})

        await page.route(f"**/api/chats/{chat}/events", recover)
        await page.reload()
        link = page.get_by_role("link", name="Открыть иллюстрацию 1")
        await expect(link).to_be_visible()
        await expect(link).to_have_attribute("href", url)
        other = await page.request.post("/api/chats", headers={"Origin": self.base_url})
        self.assertEqual(other.status, 201)
        await page.goto("/app/chats/" + (await other.json())["chatId"])
        await expect(page.get_by_role("button", name="Подключения", exact=True)).to_be_visible()
        await expect(link).to_have_count(0)
