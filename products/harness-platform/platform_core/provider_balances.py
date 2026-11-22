"""Server-side refresh of the provider account balances."""

import asyncio
from contextlib import suppress
from decimal import Decimal, InvalidOperation
from time import monotonic, time

import httpx
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse
from starlette.routing import Route

from . import provider_keys
from .admin_statistics import require_admin

DEFAULT_MINUTES = 60
MAX_MINUTES = 2 ** 31 - 1
URLS = {
    "deepseek": "https://api.deepseek.com/user/balance",
    "openrouter": "https://openrouter.ai/api/v1/credits",
}


def decimal_amount(value):
    amount = Decimal(str(value))
    if not amount.is_finite() or not -32 <= amount.as_tuple().exponent <= 32 or abs(amount) >= 10 ** 20:
        raise ValueError("Unexpected amount")
    return amount


def amounts(provider, payload):
    if provider == "deepseek":
        entries = payload["balance_infos"]
        result = [
            {"currency": item["currency"], "amount": format(decimal_amount(item["total_balance"]), "f")}
            for item in entries
        ]
        if not result or any(item["currency"] not in ("USD", "CNY") for item in result):
            raise ValueError("Unexpected currency")
        return result
    data = payload["data"]
    available = decimal_amount(data["total_credits"]) - decimal_amount(data["total_usage"])
    return [{"currency": "USD", "amount": format(available, "f")}]


class BalanceMonitor:
    def __init__(self, identity, http, router):
        self.identity, self.http, self.router = identity, http, router
        with identity._write() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS provider_balance_schedule (
                id INTEGER PRIMARY KEY CHECK(id=1), minutes INTEGER NOT NULL CHECK(minutes>0))""")
            setting = db.execute("SELECT minutes FROM provider_balance_schedule WHERE id=1").fetchone()
        self.minutes = setting[0] if setting else DEFAULT_MINUTES
        self.rows = {name: {"amounts": [], "updatedAt": None, "error": None} for name in URLS}
        self.last_check = None
        self.refresh_lock = asyncio.Lock()
        self.settings_lock = asyncio.Lock()
        self.wake = asyncio.Event()
        self.task = asyncio.create_task(self.run())

    def snapshot(self):
        return {"intervalMinutes": self.minutes, "providers": self.rows.copy()}

    def persist_interval(self, token, minutes):
        try:
            with self.identity._write() as db:
                require_admin(db, token)
                db.execute("""INSERT INTO provider_balance_schedule(id,minutes) VALUES(1,?)
                    ON CONFLICT(id) DO UPDATE SET minutes=excluded.minutes""", (minutes,))
        except PermissionError:
            raise HTTPException(403, "Требуются права администратора") from None

    async def set_interval(self, token, minutes):
        async with self.settings_lock:
            await run_in_threadpool(self.persist_interval, token, minutes)
            self.minutes = minutes
            self.wake.set()

    async def fetch(self, provider):
        try:
            if provider == "deepseek":
                client, credential = self.http, provider_keys.read(provider)
            elif self.router is not None:
                client, credential = self.router.http, self.router.credential()
            else:
                return [], "Подключение OpenRouter не настроено."
            if not credential:
                return [], "API-ключ не настроен."
            if client is None:
                return [], "Маршрут OpenRouter не настроен."
            async with asyncio.timeout(10):
                response = await client.get(URLS[provider], headers={"Authorization": "Bearer " + credential},
                                            follow_redirects=False, timeout=8)
            if response.status_code in (401, 403):
                message = ("Ключу OpenRouter недоступен баланс аккаунта. Проверьте право чтения кредитов."
                           if provider == "openrouter" else "DeepSeek отклонил API-ключ.")
                return [], message
            if not response.is_success:
                return [], f"Ошибка при запросе баланса (HTTP {response.status_code})."
            return amounts(provider, response.json(parse_float=Decimal)), None
        except (httpx.HTTPError, TimeoutError, OSError):
            return [], "Не удалось связаться с API провайдера."
        except (KeyError, ValueError, TypeError, InvalidOperation):
            return [], "API провайдера вернул неожиданный ответ."

    async def refresh(self):
        previous = self.last_check
        async with self.refresh_lock:
            if previous != self.last_check:
                return
            results = await asyncio.gather(*(self.fetch(provider) for provider in URLS))
            for provider, (values, error) in zip(URLS, results):
                self.rows[provider] = ({**self.rows[provider], "error": error} if error else
                                       {"amounts": values, "updatedAt": int(time()), "error": None})
            self.last_check = monotonic()
            self.wake.set()

    async def run(self):
        while True:
            self.wake.clear()
            delay = 0 if self.last_check is None else self.last_check + self.minutes * 60 - monotonic()
            if delay <= 0:
                await self.refresh()
            else:
                with suppress(TimeoutError):
                    await asyncio.wait_for(self.wake.wait(), delay)

    async def close(self):
        self.task.cancel()
        with suppress(asyncio.CancelledError):
            await self.task


def routes(get_token, body):
    async def handle(request):
        token = get_token(request, allow_cookie=True)
        identity = request.app.state.identity
        if not await run_in_threadpool(identity.is_admin, token):
            raise HTTPException(403, "Требуются права администратора")
        monitor = request.app.state.provider_balances
        action = request.path_params.get("action")
        if action == "refresh":
            await monitor.refresh()
            if not await run_in_threadpool(identity.is_admin, token):
                raise HTTPException(403, "Требуются права администратора")
        elif action == "settings":
            data = await body(request, "intervalMinutes")
            minutes = data["intervalMinutes"]
            if type(minutes) is not int or not 1 <= minutes <= MAX_MINUTES:
                raise HTTPException(400, "Введите положительное целое число минут.")
            await monitor.set_interval(token, minutes)
        elif action:
            raise HTTPException(404, "Unknown action")
        return JSONResponse(monitor.snapshot())

    return [Route("/api/admin/provider-balances", handle),
            Route("/api/admin/provider-balances/{action}", handle, methods=["POST"])]
