"""Telegram delivery and settings for administrator balance alerts."""

import asyncio
import logging
import re
import sqlite3
from decimal import Decimal
from time import time

from starlette.exceptions import HTTPException

from .admin_statistics import require_admin
from .identity import _principal
from .telegram_api import DeliveryError

LABELS = {"deepseek": "DeepSeek", "openrouter": "OpenRouter"}
DEFAULT_THRESHOLD = "1.00"
RECONNECT = "Telegram не подключён или доступ бота отозван. Нажмите «Переподключить Telegram»."


def setting_amount(value, *, rate=False):
    pattern = r"[0-9]{1,12}(?:\.[0-9]{1,8})?" if rate else r"[0-9]{1,12}(?:\.[0-9]{1,2})?"
    if not isinstance(value, str) or not re.fullmatch(pattern, value) or Decimal(value) <= 0:
        message = ("Введите положительный курс в CNY за 1 USD." if rate else
                   "Введите положительный порог в USD с точностью до цента.")
        raise HTTPException(400, message)
    return format(Decimal(value), "f" if rate else ".2f")


def usd_equivalents(rows, rate):
    values = {}
    for provider, row in rows.items():
        if row["error"] or not row["amounts"]:
            continue
        total = sum((Decimal(a["amount"]) for a in row["amounts"] if a["currency"] == "USD"), Decimal(0))
        cny = sum((Decimal(a["amount"]) for a in row["amounts"] if a["currency"] == "CNY"), Decimal(0))
        if cny and not rate:
            continue
        values[provider] = total + cny / Decimal(rate) if cny else total
    return values


class BalanceAlerts:
    def __init__(self, identity, telegram):
        self.identity, self.telegram = identity, telegram
        self.lock = asyncio.Lock()
        with identity._write() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS provider_balance_alert_settings (
                id INTEGER PRIMARY KEY CHECK(id=1),
                workspace TEXT REFERENCES workspaces(workspace_id) ON DELETE SET NULL,
                threshold TEXT NOT NULL, cny_per_usd TEXT)""")
            db.execute("""CREATE TABLE IF NOT EXISTS provider_balance_alert_events (
                provider TEXT PRIMARY KEY, state TEXT NOT NULL, retry_at INTEGER NOT NULL DEFAULT 0)""")
            if not db.execute("SELECT 1 FROM provider_balance_alert_settings WHERE id=1").fetchone():
                candidates = []
                if telegram.configured:
                    candidates = db.execute("""SELECT a.workspace_id FROM identity_admins
                        JOIN identity_accounts a USING(actor_id) JOIN telegram_recipients t ON t.workspace=a.workspace_id
                        WHERE t.bot=? LIMIT 2""", (telegram.config.bot,)).fetchall()
                destination = candidates[0][0] if len(candidates) == 1 else None
                db.execute("INSERT INTO provider_balance_alert_settings VALUES(1,?,?,NULL)",
                           (destination, DEFAULT_THRESHOLD))
            # Telegram might have accepted an interrupted HTTP request.
            db.execute("UPDATE provider_balance_alert_events SET state='unknown' WHERE state='sending'")

    def read(self, db):
        return db.execute("""SELECT workspace,threshold,cny_per_usd
            FROM provider_balance_alert_settings WHERE id=1""").fetchone()

    def owner(self, db, token):
        try:
            require_admin(db, token)
        except PermissionError:
            raise HTTPException(403, "Требуются права администратора") from None
        return _principal(db, token)[1]

    def linked_owner(self, token):
        with self.identity._lock:
            db = self.identity._db
            workspace = self.owner(db, token)
            if not self.telegram.status(db, workspace)["linked"]:
                raise HTTPException(409, RECONNECT)
            return workspace

    def snapshot(self, token, rows):
        with self.identity._lock:
            db = self.identity._db
            workspace = self.owner(db, token)
            target, threshold, rate = self.read(db)
            linked = self.telegram.status(db, workspace)["linked"]
        return {"linked": linked, "enabled": linked and workspace == target,
                "thresholdUsd": threshold, "cnyPerUsd": rate,
                "usdEquivalents": {provider: format(value, "f") for provider, value in
                                   usd_equivalents(rows, rate).items()}}

    async def save(self, token, threshold, rate):
        threshold = setting_amount(threshold)
        rate = None if rate in ("", None) else setting_amount(rate, rate=True)
        async with self.lock:
            with self.identity._write() as db:
                workspace = self.owner(db, token)
                target, _, _ = self.read(db)
                if target != workspace:
                    db.execute("DELETE FROM provider_balance_alert_events")
                db.execute("""UPDATE provider_balance_alert_settings
                    SET workspace=?,threshold=?,cny_per_usd=? WHERE id=1""", (workspace, threshold, rate))

    async def check(self, rows):
        try:
            async with self.lock:
                await self.deliver_low_balances(rows)
        except sqlite3.Error:
            logging.getLogger(__name__).warning("Provider balance alert check will retry")

    async def deliver_low_balances(self, rows):
        low = {}
        with self.identity._write() as db:
            workspace, threshold, rate = self.read(db)
            if not workspace or not db.execute("""SELECT 1 FROM identity_admins JOIN identity_accounts USING(actor_id)
                WHERE workspace_id=?""", (workspace,)).fetchone() or not self.telegram.status(db, workspace)["linked"]:
                return
            for provider, amount in usd_equivalents(rows, rate).items():
                if amount >= Decimal(threshold):
                    db.execute("DELETE FROM provider_balance_alert_events WHERE provider=?", (provider,))
                    continue
                if db.execute("""INSERT INTO provider_balance_alert_events(provider,state) VALUES(?,'sending')
                    ON CONFLICT(provider) DO UPDATE SET state='sending',retry_at=0
                    WHERE state='retry' AND retry_at<=unixepoch()""", (provider,)).rowcount:
                    low[provider] = amount
        if not low:
            return
        text = ["Октопорт · низкий баланс", f"Порог: {threshold} USD"]
        text.extend(f"{LABELS[provider]}: {amount:.4f} USD" for provider, amount in low.items())
        status, retry = "sent", 0
        try:
            await self.telegram.send(workspace, "\n".join(text))
        except DeliveryError as exc:
            status = "unknown" if exc.status == "unknown" else "retry"
            retry = int(time()) + exc.delay if status == "retry" else 0
        with self.identity._write() as db:
            db.executemany("UPDATE provider_balance_alert_events SET state=?,retry_at=? WHERE provider=? AND state='sending'",
                           [(status, retry, provider) for provider in low])

    async def test(self, token, rows):
        workspace = self.linked_owner(token)
        with self.identity._lock:
            _, _, rate = self.read(self.identity._db)
        values = usd_equivalents(rows, rate)
        text = ["Октопорт · проверка связи с Telegram"]
        for provider, label in LABELS.items():
            row = rows[provider]
            if row["error"] or not row["amounts"]:
                text.append(f"{label}: актуальный баланс недоступен.")
                continue
            actual = " + ".join(f'{item["amount"]} {item["currency"]}' for item in row["amounts"])
            if provider == "deepseek" and any(a["currency"] == "CNY" and Decimal(a["amount"]) for a in row["amounts"]):
                actual += (f" (≈ {values[provider]:.4f} USD)" if provider in values else
                           " (сохраните курс CNY за 1 USD в админке)")
            text.append(f"{label}: {actual}")
        try:
            await self.telegram.send(workspace, "\n".join(text))
        except DeliveryError as exc:
            if exc.status in ("disconnected", "blocked"):
                raise HTTPException(409, RECONNECT) from None
            if exc.status == "limited":
                raise HTTPException(429, "Telegram ограничил отправку. Повторите проверку позже.") from None
            raise HTTPException(502, "Telegram не подтвердил доставку. Проверьте личный чат с ботом.") from None
