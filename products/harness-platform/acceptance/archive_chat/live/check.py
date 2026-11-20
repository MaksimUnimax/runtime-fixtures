"""Verify an independently supplied report against a real model's visible browser response."""

import argparse
import asyncio
import json
import os
import re
import secrets
import shutil
import socket
import sqlite3
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from zipfile import ZipFile

import uvicorn
from playwright.async_api import async_playwright, expect

from platform_core.chat_api import create_app
from platform_core.operation_grants import initialize_grants
from platform_core.identity import IdentityStore
from report_archive.plugin import PLUGIN_ID, archive_path


def check_displayed_totals(rendered, expected):
    # Russian output can use ordinary, thin or non-breaking spaces within ruble amounts.
    tokens = re.findall(r"(?<![\d])[-−]?\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d+)?(?!\d)|[-−]?\d+(?:[.,]\d+)?", rendered)
    numbers = {Decimal("".join(token.split()).replace(",", ".").replace("−", "-")) for token in tokens}
    combined = expected["combined"]
    for field in ("ordered_units", "original_turnover_rub", "advertising_rub", "drr_percent"):
        if combined[field] is not None and Decimal(str(combined[field])) not in numbers:
            raise AssertionError(f"Combined report field missing from the visible answer: {field}")


async def verify(page, base, store, db, journals, password, inputs, observations):
    await page.goto(base + "/login")
    await page.get_by_label("Логин").fill("archive-owner")
    await page.get_by_label("Пароль").fill(password)
    await page.get_by_role("button", name="Войти", exact=True).click()
    token = store.login("archive-owner", password)
    try:
        for archive, golden_file in inputs:
            expected = json.loads(Path(golden_file).read_text())
            day = expected["date"]
            await page.get_by_role("button", name="Новый чат", exact=True).click()
            await page.wait_for_url("**/app/chats/*")
            scope = store.resolve_chat(token, page.url.rsplit("/", 1)[-1])
            dest = archive_path(Path(str(db) + ".reports"), scope.workspace_id, day)
            dest.parent.mkdir(parents=True, exist_ok=True)
            with ZipFile(archive) as source:
                if source.testzip() is not None:
                    raise ValueError("Unreadable input archive")
            shutil.copyfile(archive, dest)
            store.set_entitlement(scope.workspace_id, PLUGIN_ID, True)
            store.set_enabled(scope, PLUGIN_ID, True)
            await page.reload()
            await expect(page.get_by_test_id("tools")).to_contain_text("marketplace_daily_archive")
            question = f"Покажи архивный отчёт Ozon и WB за {day}"
            await page.get_by_role("textbox", name="Сообщение", exact=True).fill(question)
            if archive == inputs[0][0]:
                async with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/turns")) as denied:
                    await page.get_by_role("button", name="Отправить", exact=True).click()
                if (await denied.value).status != 402:
                    raise AssertionError("Unpaid account must be denied before paid inference")
                await expect(page.get_by_role("alert")).to_contain_text("Недостаточно доступных монет")
                store.grant_coins("archive-owner", "10", "test-credit-archive-owner", "Acceptance fixture")
                await page.reload()
                await page.get_by_role("textbox", name="Сообщение", exact=True).fill(question)
            async with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/turns"),
                                            timeout=140_000) as http:
                await page.get_by_role("button", name="Отправить", exact=True).click()
            response = await http.value
            if response.status != 200:
                raise RuntimeError(f"{day}: chat HTTP {response.status}")
            normal_receipt = await response.json()
            if "modelCost" in normal_receipt or "operationId" in normal_receipt:
                raise AssertionError("Private costs included in ordinary account receipt")
            await expect(page.locator(".model-cost")).to_have_count(0)
            answer = page.get_by_test_id("history").locator('[data-role="assistant"]').last
            await expect(answer).to_be_visible()
            rendered = (await answer.inner_text()).strip()
            check_displayed_totals(rendered, expected)
            await page.reload()
            await expect(answer).to_be_visible()
            if (await answer.inner_text()).strip() != rendered:
                raise AssertionError(f"{day}: visible response changed after reload")
            with sqlite3.connect(journals / "native-chats.sqlite3") as log:
                batches = log.execute("SELECT events FROM native_batches WHERE input=?", (question,)).fetchall()
            if len(batches) != 1:
                raise AssertionError("Expected one saved turn")
            events = json.loads(batches[0][0])
            replies = [e["data"]["message"] for e in events if e["type"] == "assistant/message"]
            calls = [b for reply in replies for b in reply["content"] if b["type"] == "tool-call"]
            if len(calls) != 1 or calls[0]["name"] != "mcp__platform__marketplace_daily_archive" or json.loads(calls[0]["arguments"]) != {"date": day}:
                raise AssertionError("Model did not select the expected report tool and date")
            if len(replies) != 2:
                raise AssertionError("Expected one model tool selection and one final response")
            result = next(e["data"]["message"] for e in events if e["type"] == "tool/result")
            if result.get("isError") or result["toolCallId"] != calls[0]["id"]:
                raise AssertionError("Model did not receive a matching successful tool result")
            payload = "".join(block["text"] for block in result["content"] if block["type"] == "text")
            if json.loads(payload)["result"] != expected:
                raise AssertionError(f"{day}: MCP result differs from independent ledger")
            # The report is free-form prose. Store the exact final assistant text for a separate
            # numeric check against the ledger; there is no system prompt containing the answers.
            text = "".join(b["text"] for b in replies[-1]["content"] if b["type"] == "text")
            if not text or not rendered:
                raise AssertionError("Empty final answer")
            target = observations / (day + ".txt")
            with open(target, "x", encoding="utf-8", opener=lambda path, flags: os.open(path, flags, 0o600)) as out:
                out.write(text)
            print(f"{day}: model selected requested tool and date, MCP equals ledger, visible totals and reload passed", flush=True)
            store.set_admin("archive-owner", True)
            await page.reload()
            await expect(page.locator('[data-role="assistant"] .model-cost').last).to_be_visible(timeout=15_000)
            store.set_admin("archive-owner", False)
            await page.reload()
            await expect(answer).to_be_visible()
            await expect(page.locator(".model-cost")).to_have_count(0)
            await page.goto(base + "/app/")
    finally:
        store.logout(token)


async def run(inputs, observations):
    if not observations.is_dir():
        raise ValueError("The private output directory must exist")
    with TemporaryDirectory() as root:
        db, journals = Path(root) / "identity.sqlite3", Path(root) / "journals"
        password = secrets.token_urlsafe(32)
        with IdentityStore(db) as store, socket.socket() as listener:
            store.create_account("archive-owner", password)
            initialize_grants(db)
            journal = Path(root) / "usage.jsonl"
            gateway = await asyncio.create_subprocess_exec(
                "node", str(Path(__file__).with_name("gateway.mjs")), str(db), str(journal),
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            )
            try:
                url = (await asyncio.wait_for(gateway.stdout.readline(), timeout=10)).decode().strip()
                if not url.startswith("http://127.0.0.1:"):
                    raise RuntimeError("Acceptance gateway failed to start")
                with patch.dict(os.environ, {"HARNESS_OFFLINE_MODEL": "0", "HARNESS_MODEL_GATEWAY_URL": url,
                                             "HARNESS_CHAT_MODEL": "deepseek-flash", "HARNESS_USAGE_JOURNAL": str(journal)}):
                    await run_browser(listener, db, journals, store, password, inputs, observations)
                attempts = [json.loads(s) for s in journal.read_text().splitlines() if s]
                completed = [a for a in attempts if a["event"] == "finished"]
                for event in completed:
                    print("Gateway", event.get("outcome"), event.get("status"), event.get("response_model"), flush=True)
                if (len(completed) != 2 * len(inputs) or any(
                    a.get("outcome") != "completed" or a.get("status") != 200 or
                    a.get("response_model") != "deepseek-flash" or not a.get("provider_response_id") for a in completed
                )):
                    raise AssertionError("Missing completed provider calls")
                print(f"Gateway confirmed {len(completed)} DeepSeek Flash calls (HTTP 200)", flush=True)
            finally:
                gateway.stdin.close()
                try:
                    await asyncio.wait_for(gateway.wait(), timeout=8)
                except TimeoutError:
                    gateway.kill()
                    await gateway.wait()


async def run_browser(listener, db, journals, store, password, inputs, observations):
    app = create_app(db, journals, composition_module="report_archive.plugin")
    server = uvicorn.Server(uvicorn.Config(app, log_level="warning", access_log=False))
    listener.bind(("127.0.0.1", 0))
    task = asyncio.create_task(server.serve(sockets=[listener]))
    try:
        async with asyncio.timeout(15):
            while not server.started:
                if task.done():
                    await task
                    raise RuntimeError("Test server failed to start")
                await asyncio.sleep(0.05)
        base = f"http://127.0.0.1:{listener.getsockname()[1]}"
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(executable_path=os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"))
            try:
                print("Chromium", browser.version, flush=True)
                await verify(await browser.new_page(), base, store, db, journals, password, inputs, observations)
            finally:
                await browser.close()
    finally:
        server.should_exit = True
        await task


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", nargs=2, metavar=("ARCHIVE.zip", "EXPECTED.json"), action="append", required=True)
    parser.add_argument("--observations", required=True, type=Path, help="Existing private directory for the model output")
    args = parser.parse_args()
    asyncio.run(run(args.report, args.observations))
