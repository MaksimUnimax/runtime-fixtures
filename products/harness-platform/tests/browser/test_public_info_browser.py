"""Public pages use the same browser login as the chat and keep the rail aligned."""
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit

from playwright.async_api import expect
from test_account_browser import ProductBrowser, account_action

from deploy.publish_info import PAGES, publish


class PublicInfoBrowser(ProductBrowser):
    async def test_guest_composer_keeps_its_layout_and_input_at_the_bottom(self):
        context = await self.browser.new_context(base_url=self.base_url)
        self.addAsyncCleanup(context.close)
        page = await context.new_page()
        await page.goto("/about/ask")
        editor = page.get_by_label("Ваш вопрос Октопусу")
        send = page.get_by_role("button", name="Отправить вопрос")
        heading = page.get_by_role("heading", name="С чего начнём?")
        for width, height in ((1200, 864), (390, 700), (320, 540)):
            await page.set_viewport_size({"width": width, "height": height})
            await expect(heading).to_be_visible()
            await expect(send).to_be_disabled()
            await expect(page.locator(".toolbar-chat")).to_be_hidden()
            self.assertTrue(await page.evaluate(
                "document.documentElement.scrollWidth <= innerWidth + 1"))
            self.assertIsNotNone(await send.locator("svg").bounding_box())
            self.assertGreaterEqual((await send.bounding_box())["width"], 27)
            self.assertLess((await send.bounding_box())["y"] + (await send.bounding_box())["height"], height)
        await editor.fill("Как зарегистрироваться?")
        await expect(send).to_be_enabled()
        await editor.press("Shift+Enter")
        await expect(editor).to_have_value("Как зарегистрироваться?\n")
        await editor.press("Enter")
        await expect(page.locator(".guest-answer")).to_contain_text("10 монет")
        await expect(heading).to_be_hidden()
        await expect(editor).to_be_focused()
        await expect(send).to_be_disabled()
        await page.reload()
        await expect(page.locator(".guest-answer")).to_contain_text("10 монет")
        await expect(send).to_be_in_viewport()
        await expect(page.locator("nav:visible").get_by_role("link", name="Задать вопрос")).to_be_visible()

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

        context = await self.browser.new_context(base_url=self.base_url)
        self.addAsyncCleanup(context.close)
        page = await context.new_page()
        await page.route("**/about/**", public_file)
        await page.goto("/about/")
        await expect(page.locator(".sidebar").get_by_role("link", name="Войти", exact=True)).to_be_visible()
        await expect(page.locator(".guest-actions:visible").get_by_role("link", name="Создать аккаунт")).to_be_visible()
        await page.locator(".sidebar").get_by_role("link", name="Войти", exact=True).click()
        await page.get_by_label("Логин", exact=True).fill("first-browser")
        await page.get_by_label("Пароль", exact=True).fill(self.password)
        await page.get_by_role("dialog").get_by_role("button", name="Войти", exact=True).click()
        await expect(page.locator("html")).to_have_attribute("data-session","member")
        await expect(page).to_have_url(self.base_url + "/about/")
        for name in PAGES:
            path = "/about/" + ("" if name == "index" else name)
            await page.goto(path)
            await expect(page.locator("html")).to_have_attribute("data-session", "member")
            await expect(page.locator('[href="/login"]:visible,[href="/register"]:visible')).to_have_count(0)
            chat = page.locator(".sidebar").get_by_role("link", name="Задать вопрос", exact=True)
            await expect(chat).to_be_visible()
            await expect(chat).to_have_attribute("href", "/about/ask")
            await expect(page.locator("#beta")).to_be_hidden()
            await expect(page.locator("footer #seller")).to_have_count(int(name == "index"))
        await chat.click()
        await expect(page.get_by_label("Ваш вопрос Октопусу")).to_be_visible()
        await expect(page.locator(".sidebar .public-balance")).to_be_visible()
        native = await page.context.new_page()
        await native.goto(self.base_url + "/?account=settings")
        await expect(native.get_by_role("dialog")).to_be_visible()
        await page.locator("[data-theme-select]").select_option("light")
        await native.wait_for_function("document.documentElement.dataset.appearance==='light'")
        await native.get_by_role("dialog").get_by_role("button",name="Тёмная",exact=True).click()
        await expect(page.locator("html")).to_have_attribute("data-appearance","dark")
        await native.close()
        await page.goto("/about/#seller")
        for width in (1280, 820, 390, 320):
            await page.set_viewport_size({"width": width, "height": 800})
            await page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
            metrics = await page.evaluate("""() => {
              const rect = selector => document.querySelector(selector).getBoundingClientRect();
              const middle = r => (r.left + r.right) / 2;
              const text = selector => {
                const range = document.createRange();
                range.selectNodeContents(document.querySelector(selector));
                return range.getBoundingClientRect();
              };
              const centered = ['.seller h2', '.seller p', '.seller dl', '.seller > a', '.footer-links > span'];
              const workspace = middle(rect('.workspace'));
              const links = [...document.querySelectorAll('.footer-links a')].map(a => a.getBoundingClientRect());
              const linkRows = Map.groupBy(links, link => link.top);
              const offsets = centered.map(s => middle(text(s)) - workspace);
              for (const row of linkRows.values()) {
                offsets.push((row[0].left + row.at(-1).right) / 2 - workspace);
              }
              const sidebarText = middle(text('.account [data-account]')) - middle(rect('.account [data-account]'));
              return {center:Math.max(...offsets.map(Math.abs)), sidebarText, rail:rect('.sidebar').bottom, height:innerHeight,
                left:rect('footer').left - rect('main').left,
                overflow:document.documentElement.scrollWidth - document.documentElement.clientWidth};
            }""")
            self.assertLessEqual(metrics["center"], 1)
            self.assertLessEqual(abs(metrics["left"]), 1)
            self.assertLessEqual(metrics["overflow"], 1)
            if width > 760:
                self.assertLessEqual(abs(metrics["rail"] - metrics["height"]), 1)
                await expect(page.locator(".sidebar .public-balance")).to_be_visible()
        await page.request.post("/logout", headers={"Origin": self.base_url})
        await page.reload()
        await expect(page.locator("html")).to_have_attribute("data-session", "guest")
        await expect(page.locator(".guest-actions:visible").get_by_role("link", name="Создать аккаунт")).to_be_visible()

        await page.set_viewport_size({"width": 1280, "height": 800})
        await page.route("**/api/session/status**", lambda route: route.fulfill(status=503, body="{}"))
        await page.goto("/about/")
        await page.locator(".sidebar").get_by_role("link", name="Задать вопрос", exact=True).click()
        await page.locator(".sidebar .guest-actions").get_by_role("link", name="Войти", exact=True).click()
        await expect(page.get_by_role("dialog").get_by_label("Логин", exact=True)).to_be_visible()
        await expect(page.get_by_role("dialog").get_by_role("button", name="Создать аккаунт")).to_be_visible()
