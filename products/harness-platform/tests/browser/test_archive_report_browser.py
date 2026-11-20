"""Compare what the stock Chat view actually rendered with a separate golden report."""

import asyncio
import json
import os
from pathlib import Path
from urllib.parse import urlsplit
from zipfile import ZipFile

from playwright.async_api import expect

from platform_core.identity import IdentityStore
from report_archive.plugin import PLUGIN_ID, archive_path
from test_account_browser import ProductBrowser


class ArchiveReportBrowser(ProductBrowser):
    composition = "report_archive.plugin"
    offline_adapter = "archive_chat"

    async def test_scoped_report_is_visible_and_restores_after_reload(self):
        profiles = ("first-browser", "second-browser")
        first, second = await asyncio.gather(*(self.open_chat(profile) for profile in profiles))
        first_url, second_url = first.url, second.url
        fixture = Path(__file__).resolve().parents[2] / "acceptance/archive_chat/fixtures"
        golden = json.loads((fixture / "expected.json").read_text(encoding="utf-8"))
        day = golden["date"]
        question = f"Покажи архивный отчёт Ozon и WB за {day}"
        with IdentityStore(self.database) as store:
            token = store.login(profiles[0], self.password)
            scope = store.resolve_chat(token, urlsplit(first_url).path.rsplit("/", 1)[1])
            store.logout(token)
            path = archive_path(Path(str(self.database) + ".reports"), scope.workspace_id, day)
            path.parent.mkdir(parents=True)
            source = fixture / "input"
            with ZipFile(path, "w") as archive:
                for member in source.rglob("*.json"):
                    archive.write(member, member.relative_to(source))
            store.set_entitlement(scope.workspace_id, PLUGIN_ID, True)
            store.set_enabled(scope, PLUGIN_ID, True)

        await asyncio.gather(first.reload(), second.reload())
        await expect(first.get_by_test_id("tools")).to_contain_text("marketplace_daily_archive")
        await expect(second.get_by_test_id("tools")).to_contain_text("Нет доступных инструментов")
        await self.send_turn(first, question)
        history = first.get_by_test_id("history")
        assistant = history.locator('[data-role="assistant"]')

        async def check_report():
            await expect(assistant).to_have_count(1, timeout=45_000)
            await expect(assistant).to_contain_text('"missing_campaign_count"')
            rendered = await assistant.inner_text()
            start = rendered.index("{")
            report, _ = json.JSONDecoder().raw_decode(rendered[start:])
            self.assertEqual(report, golden)
            await expect(history.locator('[data-role="user"]')).to_have_count(1)
            await expect(history.locator('[data-role="user"]')).to_contain_text(question)

        await check_report()
        await first.reload()
        await check_report()
        await first.get_by_role("tab", name="Траектория").click()
        await expect(first.get_by_role("region", name="Траектория")).to_contain_text(question)
        await first.get_by_role("tab", name="Чат", exact=True).click()
        await check_report()

        await self.send_turn(second, question)
        await expect(second.get_by_role("alert")).to_contain_text("Действие недоступно", timeout=45_000)
        await expect(second.get_by_test_id("history").locator('[data-role="assistant"]')).to_have_count(0)
        response = await second.goto(first_url)
        self.assertEqual(response.status, 404)
        await expect(second.get_by_role("heading", name="Чат недоступен")).to_be_visible()
        destination = os.environ.get("HARNESS_BROWSER_EVIDENCE")
        if destination:
            folder = Path(destination)
            folder.mkdir(parents=True, exist_ok=True)
            await first.screenshot(path=folder / "archive-report.png", full_page=True)
            await second.screenshot(path=folder / "foreign-chat.png", full_page=True)
        await second.goto(second_url)
        await expect(second.get_by_test_id("history").locator('[data-role="assistant"]')).to_have_count(0)
