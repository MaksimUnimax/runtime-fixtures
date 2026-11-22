"""Public pages use the same browser login as the chat and keep the rail aligned."""
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit

from playwright.async_api import expect
from test_account_browser import ProductBrowser

from deploy.publish_info import PAGES, publish


class PublicInfoBrowser(ProductBrowser):
    async def test_guest_uses_the_public_links_and_auth_buttons_in_the_left_rail(self):
        context = await self.browser.new_context(base_url=self.base_url)
        self.addAsyncCleanup(context.close)
        page = await context.new_page()
        await page.goto("/about/")
        public = page.locator(".sidebar nav a")
        links = await public.evaluate_all("(links) => links.map(link => [link.textContent, link.getAttribute('href')])")
        for width in (1280, 940, 390):
            await page.set_viewport_size({"width": width, "height": 857})
            await page.goto("/about/ask")
            if width < 768:
                await page.locator("[data-sidebar-opener]:visible").click()
            navigation = page.get_by_role("navigation", name="Разделы Октопорта")
            await expect(navigation).to_be_visible()
            self.assertEqual(
                await navigation.locator("a").evaluate_all(
                    "(links) => links.map(link => [link.textContent, link.getAttribute('href')])"),
                links,
            )
            await expect(navigation.get_by_role("link", name="Задать вопрос")).to_have_attribute("aria-current", "page")
            await expect(page.locator('[data-row-key^="session:"]:visible')).to_have_count(0)
            await expect(page.get_by_role("button", name="Меню", exact=True)).to_have_count(0)
            auth = page.locator(".octo-guest-actions")
            await expect(auth.get_by_role("button", name="Войти")).to_be_visible()
            await expect(auth.get_by_role("button", name="Создать аккаунт")).to_be_visible()
            auth_box = await auth.bounding_box()
            self.assertGreater(auth_box["y"], 750)
            self.assertGreater(auth_box["width"], (await navigation.bounding_box())["width"] * .8)
        await auth.get_by_role("button", name="Создать аккаунт").click()
        await expect(page.get_by_role("dialog", name="Создать аккаунт")).to_be_visible()
        await expect(page).to_have_url(self.base_url + "/about/ask")

    async def test_ask_opens_the_same_native_workspace_as_the_reference(self):
        page = await self.open_chat("first-browser")
        await expect(page.get_by_role("button", name="Баланс", exact=True)).to_have_text("10,00 монет")
        await page.set_viewport_size({"width": 1280, "height": 857})
        editor = page.locator('[data-composer-input][contenteditable=true]')
        await expect(editor).to_be_visible()
        reference = await editor.bounding_box()
        original = page.url
        async with page.expect_response(lambda response: urlsplit(response.url).path == "/about/ask") as handoff:
            await page.goto("/about/ask")
        self.assertEqual((await handoff.value).status, 303)
        await expect(page.locator("body")).to_have_attribute("data-mode", "member")
        await expect(editor).to_be_visible()
        await expect(page).to_have_url(original)
        await expect(page.get_by_role("button", name="Меню аккаунта")).to_have_text("first-browser")
        await expect(page.get_by_role("button", name="Баланс", exact=True)).to_have_text("10,00 монет")
        self.assertEqual(await editor.bounding_box(), reference)
        await expect(page.get_by_role("button", name="Прикрепить файлы")).to_be_visible()
        await expect(page.locator('[data-row-key^="session:"]')).to_have_count(1)
        await page.get_by_role("button", name="Баланс", exact=True).click()
        await expect(page.get_by_role("dialog")).to_contain_text("Доступно")
        await page.get_by_role("dialog").get_by_role("button", name="Закрыть").click()
        await page.get_by_role("button", name="Меню аккаунта").click()
        await expect(page.get_by_role("menuitem", name="Настройки")).to_be_visible()
        await expect(page.get_by_role("menuitem", name="О сервисе")).to_have_count(0)
        await page.keyboard.press("Escape")
        await page.get_by_role("navigation", name="Разделы Октопорта").get_by_role("link", name="О сервисе").click()
        await expect(page.locator("h1")).to_contain_text("Управление маркетплейсами")
        await expect(page.locator(".account [data-member-name]")).to_have_text("first-browser")
        await expect(page.locator(".account [data-balance]")).to_have_text("10,00 монет")

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
            if path == "ask":
                await route.continue_()
                return
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
        await expect(page.locator('[data-composer-input][contenteditable=true]')).to_be_visible()
        await expect(page.get_by_role("button", name="Баланс", exact=True)).to_be_visible()
        await page.goto("/about/")
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
        await page.get_by_role("button", name="Войти", exact=True).click()
        await expect(page.get_by_role("dialog").get_by_label("Логин", exact=True)).to_be_visible()
        await expect(page.get_by_role("dialog").get_by_role("button", name="Создать аккаунт")).to_be_visible()
