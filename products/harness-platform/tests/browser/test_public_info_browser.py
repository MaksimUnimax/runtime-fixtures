"""Public pages use the same browser login as the chat and keep the rail aligned."""
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit

from playwright.async_api import expect
from test_account_browser import ProductBrowser

from deploy.publish_info import PAGES, publish


class PublicInfoBrowser(ProductBrowser):
    async def test_public_navigation_uses_live_session_and_fits_viewport(self):
        directory = Path(self.enterContext(TemporaryDirectory()))
        source = directory / "source"
        (source / "assets").mkdir(parents=True)
        for asset in ("favicon.ico", "favicon.png", "assets/octoport-brand.png", "assets/favicon-contour-v1.png"):
            (source / asset).touch()
        publish(source, directory / "site")
        published = directory / "site/current/about"

        async def public_file(route):
            path = urlsplit(route.request.url).path.removeprefix("/about/") or "index"
            if path == "assets/yandex-metrika.js":
                await route.fulfill(content_type="text/javascript", body="")
                return
            file = published / path
            await route.fulfill(path=file if file.suffix else file.with_suffix(".html"))

        page = await self.browser.new_page(base_url=self.base_url)
        await page.route("**/about/**", public_file)
        await page.goto("/about/")
        await expect(page.get_by_role("link", name="Войти в кабинет")).to_be_visible()
        await expect(page.get_by_role("link", name="Создать аккаунт")).to_be_visible()
        await page.get_by_role("link", name="Войти в кабинет").click()
        await page.get_by_label("Логин", exact=True).fill("first-browser")
        await page.get_by_label("Пароль", exact=True).fill(self.password)
        await page.get_by_role("dialog").get_by_role("button", name="Войти", exact=True).click()
        for name in PAGES:
            path = "/about/" + ("" if name == "index" else name)
            await page.goto(path)
            await expect(page.locator("html")).to_have_attribute("data-session", "member")
            await expect(page.locator('[href="/login"]:visible,[href="/register"]:visible')).to_have_count(0)
            await expect(page.get_by_role("link", name="Личный кабинет", exact=True)).to_be_visible()
            await expect(page.locator("footer #seller")).to_have_count(int(name == "index"))
        await page.goto("/about/#seller")
        for width in (1280, 820, 390, 320):
            await page.set_viewport_size({"width": width, "height": 800})
            await page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
            metrics = await page.evaluate("""() => {
              const rect = selector => document.querySelector(selector).getBoundingClientRect();
              return {rail:rect('.sidebar').bottom, height:innerHeight,
                left:rect('footer').left - rect('main section:last-child').left,
                overflow:document.documentElement.scrollWidth - document.documentElement.clientWidth};
            }""")
            self.assertLessEqual(abs(metrics["left"]), 1)
            self.assertLessEqual(metrics["overflow"], 1)
            if width > 760:
                self.assertLessEqual(abs(metrics["rail"] - metrics["height"]), 1)
        await page.request.post("/logout", headers={"Origin": self.base_url})
        await page.reload()
        await expect(page.locator("html")).to_have_attribute("data-session", "guest")
        await expect(page.get_by_role("link", name="Создать аккаунт")).to_be_visible()

        await page.set_viewport_size({"width": 1280, "height": 800})
        await page.route("**/api/session/status", lambda route: route.fulfill(status=503, body="{}"))
        await page.goto("/about/")
        await page.get_by_role("link", name="Личный кабинет", exact=True).click()
        await expect(page.get_by_role("dialog").get_by_label("Логин", exact=True)).to_be_visible()
        await expect(page.get_by_role("dialog").get_by_role("link", name="Создать аккаунт")).to_be_visible()
