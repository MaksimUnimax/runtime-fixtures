"""Two signed-in Chromium profiles exercise the product through its ordinary UI."""

import asyncio
import os
import re
import socket
import unittest
from contextlib import asynccontextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from urllib.parse import urlsplit

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
async def running_product(database, journals):
    app = create_app(database, journals, composition_module="examples.reference_plugin")
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


class BrowserIsolation(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        if not os.environ.get("HARNESS_NODE_MODULES"):
            self.fail("Set HARNESS_NODE_MODULES to the pinned native installation")
        self.enterContext(patch.dict(os.environ, {"HARNESS_OFFLINE_MODEL": "1"}))
        scratch = Path(self.enterContext(TemporaryDirectory()))
        self.database = scratch / "identity.sqlite3"
        self.password = "Ephemeral browser test password"
        with IdentityStore(self.database) as store:
            for handle in ("first-browser", "second-browser"):
                store.create_account(handle, self.password)
        self.base_url = await self.enterAsyncContext(running_product(self.database, scratch / "journals"))
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
        await page.get_by_label("Логин", exact=True).fill(handle)
        await page.get_by_label("Пароль", exact=True).fill(self.password)
        async with page.expect_response(lambda res: res.request.is_navigation_request() and
                                        urlsplit(res.url).path == "/app/") as landing:
            await page.get_by_role("button", name="Войти", exact=True).click()
        response = await landing.value
        self.assertEqual(response.status, 200)
        policy = await response.header_value("content-security-policy") or ""
        scripts = [d.strip().split() for d in policy.split(";") if d.strip().startswith("script-src ")]
        self.assertEqual(len(scripts), 1, "Protected application must set its script-src policy")
        self.assertIn("'self'", scripts[0])
        self.assertNotIn("'unsafe-eval'", scripts[0])
        await page.get_by_role("button", name="Новый чат", exact=True).click()
        await expect(page).to_have_url(re.compile(r"/app/chats/[a-zA-Z0-9_-]+$"))
        return page

    async def send_turn(self, page, text):
        await page.get_by_role("textbox", name="Сообщение", exact=True).fill(text)
        button = page.get_by_role("button", name="Отправить", exact=True)
        try:
            await expect(button).to_be_enabled(timeout=30_000)
        except AssertionError as error:
            alert = await page.get_by_role("alert").all_text_contents()
            self.fail(f"{error}\nVisible product errors: {[browser_error(s) for s in alert]}"
                      f"\nNative bootstrap: {await boot_status(page)}")
        await button.click()

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
            links = page.get_by_role("navigation", name="Чаты").get_by_role("link")
            await expect(links).to_have_count(1)
            await expect(links).to_have_attribute("href", urlsplit(own_url).path)
        await expect(first.get_by_test_id("tools")).to_contain_text("summarize_text", timeout=30_000)
        await expect(second.get_by_test_id("tools")).to_contain_text(
            "Нет доступных инструментов", timeout=30_000,
        )
        await expect(second.get_by_test_id("tools")).not_to_contain_text("summarize_text")

        pages = (first, second)
        markers = ("Приватная метка север-947", "Приватная метка юг-682")
        followups = ("Продолжение север-381", "Продолжение юг-751")
        await asyncio.gather(*(self.send_turn(page, marker) for page, marker in zip(pages, markers)))
        for page, marker in zip(pages, markers):
            await expect(page.get_by_test_id("history")).to_contain_text(
                f"Тестовая модель (ход 1): {marker}", timeout=45_000,
            )
        await asyncio.gather(*(page.reload() for page in pages))
        for i, page in enumerate(pages):
            history = page.get_by_test_id("history")
            await expect(history).to_contain_text(markers[i], timeout=30_000)
            await expect(history).not_to_contain_text(markers[1 - i])
        await asyncio.gather(*(self.send_turn(page, msg) for page, msg in zip(pages, followups)))
        for i, page in enumerate(pages):
            history = page.get_by_test_id("history")
            await expect(history).to_contain_text(f"Тестовая модель (ход 2): {followups[i]}", timeout=45_000)
            await expect(history).to_contain_text(f"Предыдущее сообщение: {markers[i]}")
            await expect(history).not_to_contain_text(markers[1 - i])
            await page.get_by_role("tab", name="Траектория", exact=True).click()
            trajectory = page.get_by_role("region", name="Траектория", exact=True)
            table = trajectory.get_by_role("table")
            await expect(table).to_be_visible(timeout=20_000)
            await expect(table.get_by_role("row").filter(has_text=markers[i]).first).to_be_visible()
            await expect(table).not_to_contain_text(markers[1 - i])
            await page.get_by_role("tab", name="Чат", exact=True).click()
            await expect(page.get_by_role("region", name="История сообщений", exact=True)).to_contain_text(followups[i])

        denied = await second.goto(first_url)
        self.assertEqual(denied.status, 404)
        await expect(second.get_by_text("Чат недоступен", exact=True)).to_be_visible()
        await expect(second.locator("body")).not_to_contain_text(markers[0])
        await second.goto(second_url)
        await expect(second.get_by_test_id("history")).to_contain_text(markers[1], timeout=30_000)

        await first.get_by_role("button", name="Выйти", exact=True).click()
        await expect(first.get_by_role("button", name="Войти", exact=True)).to_be_visible()
        await first.go_back()
        await expect(first.get_by_role("button", name="Войти", exact=True)).to_be_visible()
        await expect(first.locator("body")).not_to_contain_text(markers[0])
        await first.goto(first_url)
        await first.reload()
        await expect(first.get_by_role("button", name="Войти", exact=True)).to_be_visible()
        await expect(first.locator("body")).not_to_contain_text(markers[0])
        await second.reload()
        await expect(second.get_by_test_id("history")).to_contain_text(followups[1], timeout=30_000)
