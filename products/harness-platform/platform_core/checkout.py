"""Hosted YooKassa payment for a server-priced, account-bound coin purchase."""
import json
import os
import re
from decimal import Decimal, ROUND_HALF_UP
from uuid import uuid4
from urllib.parse import urlsplit

import httpx
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import coins
from .browser_session import _form_fields, _PRIVATE_HEADERS, browser_token
from .identity import _principal
from .operation_grants import ensure_operation_schema

_ID = re.compile(r"[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}")
_LIMIT = coins.MAX_BALANCE // coins.UNIT


def merchant():
    shop, key = os.getenv("YOOKASSA_SHOP_ID"), os.getenv("YOOKASSA_SECRET_KEY")
    return (shop, key) if shop and key else None


def quantity(raw):
    if not re.fullmatch(r"[1-9][0-9]{0,6}", raw) or int(raw) > _LIMIT:
        raise HTTPException(400, "Введите целое количество монет от 1 до 8 000 000.")
    return int(raw)


def price(rate, count):
    return str((Decimal(rate) * count).quantize(Decimal(".01"), rounding=ROUND_HALF_UP))


def response(data, status=200):
    return JSONResponse(data, status_code=status, headers=_PRIVATE_HEADERS)


async def quote(request):
    count = quantity(request.query_params.get("coins", "100"))
    rate = await run_in_threadpool(request.app.state.identity.public_coin_price)
    return response({"total": price(rate, count), "enabled": bool(merchant())})


def order_for(store, token, key, count, total):
    with store._write() as db:
        _, workspace = _principal(db, token)
        ensure_operation_schema(db)
        row = db.execute("""SELECT id,quantity,total,status,url,created FROM coin_checkouts
                            WHERE workspace_id=? AND request_key=?""", (workspace, key)).fetchone()
        if row:
            order, saved_count, saved_total, status, url, created = row
            if (count, total) != (saved_count, saved_total):
                raise HTTPException(409, "Сумма заказа изменилась. Проверьте итог.")
            if status != "pending":
                return order, None, status
            # YooKassa guarantees idempotency for 24 hours. Never recreate an uncertain charge.
            if not url and db.execute("SELECT unixepoch()-?", (created,)).fetchone()[0] >= 23*3600:
                raise HTTPException(409, "Срок заказа истёк. Обратитесь в поддержку для сверки.")
            return order, url, status
        if total != price(coins.sale_pricing(db)["rubPerCoin"], count):
            raise HTTPException(409, "Стоимость изменилась. Проверьте новую сумму.")
        if coins.unallocated(db, workspace) < count * coins.UNIT:
            raise HTTPException(409, "Сумма превышает доступный лимит пополнения.")
        order = str(uuid4())
        db.execute("""INSERT INTO coin_checkouts(id,workspace_id,request_key,quantity,total)
                      VALUES(?,?,?,?,?)""", (order, workspace, key, count, total))
        return order, None, "pending"


class RejectedPayment(Exception):
    """The provider definitively rejected the creation request."""


async def provider(method, path, merchant_auth, **kwargs):
    try:
        async with httpx.AsyncClient(timeout=12, follow_redirects=False) as client:
            answer = await client.request(method, "https://api.yookassa.ru/v3/payments"+path,
                                          auth=merchant_auth, **kwargs)
        if method == "POST" and answer.status_code in (400, 401, 403):
            raise RejectedPayment()
        answer.raise_for_status()
        return answer.json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(503, "ЮKassa временно недоступна. Повторите попытку.") from None


def apply_payment(store, order, data, shop):
    payment_id = data.get("id", "")
    if not isinstance(payment_id, str) or not _ID.fullmatch(payment_id):
        raise HTTPException(502, "Некорректный ответ платёжной системы.")
    with store._write() as db:
        row = db.execute("""SELECT workspace_id,quantity,total,provider_id,status FROM coin_checkouts
                            WHERE id=?""", (order,)).fetchone()
        if not row:
            raise HTTPException(404, "Заказ не найден.")
        workspace, count, total, known_id, previous = row
        amount = data.get("amount") or {}
        if (data.get("metadata", {}).get("order") != order or known_id not in (None, payment_id)
                or amount.get("currency") != "RUB" or amount.get("value") != total
                or data.get("recipient", {}).get("account_id") != shop or data.get("test") is not False):
            raise HTTPException(502, "Платёж требует сверки.")
        status = data.get("status")
        if previous != "pending":
            return previous, None
        url = None
        if status == "succeeded" and data.get("paid") is True:
            db.execute("UPDATE coin_checkouts SET status='succeeded' WHERE id=?", (order,))
            coins.grant(db, "yookassa", payment_id, workspace, str(count), "Покупка монет")
        elif status == "canceled":
            db.execute("UPDATE coin_checkouts SET status='canceled' WHERE id=?", (order,))
        elif status == "pending":
            url = data.get("confirmation", {}).get("confirmation_url") or ""
            parsed = urlsplit(url)
            if parsed.scheme != "https" or parsed.hostname not in {"yoomoney.ru", "yookassa.ru"} or parsed.username or parsed.password:
                raise HTTPException(502, "Платёжная ссылка недоступна.")
        else:
            raise HTTPException(502, "Неизвестный статус платежа.")
        db.execute("UPDATE coin_checkouts SET provider_id=?,url=? WHERE id=?", (payment_id, url, order))
        return status, url


async def checkout(request):
    token = browser_token(request)
    store = request.app.state.identity
    await run_in_threadpool(store.validate_session, token)
    auth = merchant()
    if not auth:
        return response({"detail": "Приём платежей пока недоступен."}, 503)
    fields = await _form_fields(request, {"coins", "total", "key"})
    count = quantity(fields["coins"])
    if not _ID.fullmatch(fields["key"]):
        raise HTTPException(400, "Некорректный идентификатор заказа.")
    order, url, status = await run_in_threadpool(order_for, store, token, fields["key"], count, fields["total"])
    if url or status != "pending":
        return response({"url": url, "status":status})
    payload = {"amount": {"value": fields["total"], "currency": "RUB"}, "capture": True,
               "confirmation": {"type":"redirect", "return_url":"https://octoport.ru/?account=wallet"},
               "metadata": {"order":order}, "description":f"Октопорт · {count} монет"}
    try:
        data = await provider("POST", "", auth, json=payload, headers={"Idempotence-Key":order})
    except RejectedPayment:
        def cancel_rejected():
            with store._write() as db:
                db.execute("""UPDATE coin_checkouts SET status='canceled' WHERE id=?
                              AND provider_id IS NULL AND status='pending'""", (order,))
        await run_in_threadpool(cancel_rejected)
        return response({"status":"canceled", "url":None})
    status, url = await run_in_threadpool(apply_payment, store, order, data, auth[0])
    return response({"url":url, "status":status})


async def notification(request):
    auth = merchant()
    if not auth:
        return Response(status_code=503)
    raw = bytearray()
    async for chunk in request.stream():
        if len(raw) + len(chunk) > 32768:
            return Response(status_code=413)
        raw.extend(chunk)
    try:
        snapshot = json.loads(raw)["object"]
        payment, order = snapshot["id"], snapshot["metadata"]["order"]
        if not _ID.fullmatch(payment) or not _ID.fullmatch(order):
            return Response(status_code=400)
    except (ValueError, TypeError, KeyError, UnicodeError):
        return Response(status_code=400)
    store = request.app.state.identity
    def known_order():
        with store._lock:
            return store._db.execute("""SELECT 1 FROM coin_checkouts WHERE id=?
                AND (provider_id IS NULL OR provider_id=?)""", (order, payment)).fetchone()
    if not await run_in_threadpool(known_order):
        return Response(status_code=200)
    # The notification itself is only a hint. Credit exclusively from the merchant-authenticated lookup.
    data = await provider("GET", "/"+payment, auth)
    if data.get("id") != payment:
        return Response(status_code=502)
    await run_in_threadpool(apply_payment, store, order, data, auth[0])
    return Response(status_code=200)


def checkout_routes():
    return [Route("/api/coins/quote", quote), Route("/api/coins/checkout", checkout, methods=["POST"]),
            Route("/api/coins/yookassa", notification, methods=["POST"])]
