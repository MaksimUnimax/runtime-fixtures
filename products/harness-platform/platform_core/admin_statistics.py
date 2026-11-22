"""Account statistics and the registration credit setting."""

from decimal import Decimal
from hmac import compare_digest
from html import escape
from string import Template
from time import time
from urllib.parse import urlencode

from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException
from starlette.responses import HTMLResponse, JSONResponse, Response
from starlette.routing import Route

from . import coins
from .browser_session import _form_fields, _redirect, browser_token
from .identity import AuthenticationError, _principal, _secret_digest
from .native_web import HEADERS, UI

PAGE_SIZE = 50
MAX_SAMPLE_SECONDS = 20


def record_presence(store, token, seconds):
    with store._write() as db:
        actor, _ = _principal(db, token)
        db.execute("""INSERT INTO identity_presence(actor_id, seconds, last_at) VALUES(?, ?, ?)
            ON CONFLICT(actor_id) DO UPDATE SET
              seconds=identity_presence.seconds +
                  min(excluded.seconds,max(0,excluded.last_at-identity_presence.last_at)),
              last_at=max(identity_presence.last_at,excluded.last_at)""",
                   (actor, seconds, int(time())))


def require_admin(db, token):
    actor, _ = _principal(db, token)
    if not db.execute("SELECT 1 FROM identity_admins WHERE actor_id=?", (actor,)).fetchone():
        raise PermissionError("Administrator required")


def read_statistics(store, token, query, page):
    with store._lock:
        db = store._db
        require_admin(db, token)
        total = db.execute("SELECT COUNT(*) FROM identity_accounts").fetchone()[0]
        count = (db.execute("SELECT COUNT(*) FROM identity_accounts WHERE instr(login,?)>0",
                            (query,)).fetchone()[0] if query else total)
        pages = max(1, (count + PAGE_SIZE - 1) // PAGE_SIZE)
        page = min(page, pages)
        accounts = db.execute("""SELECT a.login, a.workspace_id, p.seconds,
                    EXISTS(SELECT 1 FROM identity_admins r WHERE r.actor_id=a.actor_id)
                FROM identity_accounts a LEFT JOIN identity_presence p USING(actor_id)
                WHERE (?='' OR instr(a.login,?)>0) ORDER BY a.login LIMIT ? OFFSET ?""",
                              (query, query, PAGE_SIZE, (page-1)*PAGE_SIZE)).fetchall()
        users = []
        for login, workspace, seconds, admin in accounts:
            grants = dict((issuer, (amount, number)) for issuer, amount, number in db.execute(
                """SELECT issuer,SUM(amount),COUNT(*) FROM coin_grants
                    WHERE workspace_id=? GROUP BY issuer""", (workspace,)))
            paid, purchases = grants.get("yookassa", (0, 0))
            bonus = grants.get("signup", (0, 0))[0]
            manual = sum(amount for issuer, (amount, _) in grants.items() if issuer not in {"signup", "yookassa"})
            rubles = sum((Decimal(total) for total, in db.execute(
                """SELECT total FROM coin_checkouts WHERE workspace_id=? AND status='succeeded'""",
                (workspace,))), Decimal(0))
            available, reserved = coins.balances(db, workspace)
            users.append(dict(login=login, admin=admin, seconds=seconds,
                              paid=paid, purchases=purchases, manual=manual, bonus=bonus,
                              rubles=rubles, available=available, reserved=reserved,
                              meters=coins.provider_meters(db, workspace)))
        return users, total, count, page, pages, coins.signup_bonus(db)


def save_bonus(store, token, value):
    with store._write() as db:
        require_admin(db, token)
        coins.set_signup_bonus(db, value)


def display_coins(amount):
    return ("−" if amount < 0 else "") + coins.display(abs(amount))


def duration(value):
    if value is None:
        return "—"
    minutes, seconds = divmod(value, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours:,} ч {minutes} мин".replace(",", "\u202f")
    return f"{minutes} мин {seconds} с" if minutes else f"{seconds} с"


def render_user(user):
    def meters_html():
        total = sum(m["input"] + m["cache"] + m["output"] for m in user["meters"].values())
        text = f'<strong>{total:,}</strong>'.replace(",", "\u202f")
        for provider, m in user["meters"].items():
            detail = f'{provider} · {m["input"]} вход · {m["cache"]} кэш · {m["output"]} выход'
            text += f'<small>{escape(detail)}</small>'
        return text

    login = escape(user["login"])
    role = "<small>Администратор</small>" if user["admin"] else ""
    spent = sum((Decimal(row["coins"]) for row in user["meters"].values()), Decimal(0))
    paid_rubles = format(user["rubles"], ".2f").replace(".", ",")
    return (f'<tr><th scope="row">{login}{role}</th>'
            f'<td>{duration(user["seconds"])}</td>'
            f'<td>{meters_html()}</td><td>{spent:f}</td>'
            f'<td><strong>{display_coins(user["paid"] + user["manual"])}</strong>'
            f'<small>Покупки ({user["purchases"]}): {display_coins(user["paid"])} монет / {paid_rubles} ₽</small>'
            f'<small>Ручные: {display_coins(user["manual"])}</small></td>'
            f'<td>{display_coins(user["bonus"])}</td>'
            f'<td>{display_coins(user["available"])}'
            f'<small>Резерв: {display_coins(user["reserved"])}</small></td></tr>')


def render_page(data, query, *, status=200, message=""):
    users, total, count, page, pages, bonus = data
    items = "".join(render_user(user) for user in users) or (
        '<tr><td colspan="7">Пользователи не найдены.</td></tr>')

    def page_link(number, label):
        url = "/admin/statistics?" + urlencode({"q": query, "page": number})
        return f'<a href="{escape(url, quote=True)}">{label}</a>'

    nav = ""
    if pages > 1:
        links = (page_link(page - 1, "Назад") if page > 1 else "",
                 f"<span>Страница {page} из {pages}</span>",
                 page_link(page + 1, "Далее") if page < pages else "")
        nav = '<nav class="stats-pagination" aria-label="Страницы">' + "".join(links) + "</nav>"
    count_text = f"Всего аккаунтов: {total}" + (f" · Найдено: {count}" if query else "")
    template = Template((UI / "admin-statistics.html").read_text())
    return HTMLResponse(template.substitute(
        rows=items, pagination=nav, count=count_text, query=escape(query, quote=True),
        bonus=coins.display(bonus), max_bonus=coins.display(coins.MAX_BALANCE),
        message=escape(message), message_role="alert" if status >= 400 else "status"),
        status_code=status, headers=HEADERS)


async def dashboard(request):
    token = browser_token(request)
    store = request.app.state.identity
    search = request.query_params.get("q", "").strip()
    raw_page = request.query_params.get("page", "1")
    if len(search) > 254 or not raw_page.isascii() or not raw_page.isdecimal() or len(raw_page) > 9:
        raise HTTPException(400, "Некорректный поиск")
    page = max(1, int(raw_page))
    status, message = 200, ""
    try:
        if request.method == "POST":
            fields = await _form_fields(request, {"amount"})
            try:
                await run_in_threadpool(save_bonus, store, token, fields["amount"])
            except ValueError:
                status, message = 400, "Введите количество монет от 0 до 8 000 000."
            else:
                return _redirect("/admin/statistics?saved=1")
        elif request.query_params.get("saved") == "1":
            message = "Стартовые монеты сохранены."
        data = await run_in_threadpool(read_statistics, store, token, search.casefold(), page)
    except AuthenticationError:
        raise
    except PermissionError:
        raise HTTPException(403, "Требуются права администратора") from None
    return render_page(data, search, status=status, message=message)


async def public_bonus(request):
    store = request.app.state.identity
    return JSONResponse({"coins": await run_in_threadpool(store.public_signup_coins)})


async def activity(request):
    token = browser_token(request)
    store = request.app.state.identity
    session = _secret_digest(token).hex()[:32]
    if request.method != "POST":
        await run_in_threadpool(store.validate_session, token)
        return JSONResponse({"session": session})
    fields = await _form_fields(request, {"seconds", "session"}, max_bytes=80)
    if len(fields["session"]) != 32 or not fields["session"].isascii() or not compare_digest(session, fields["session"]):
        raise AuthenticationError("Invalid activity session")
    seconds = fields["seconds"]
    if len(seconds) > 2 or not seconds.isascii() or not seconds.isdecimal() or not 1 <= int(seconds) <= MAX_SAMPLE_SECONDS:
        raise HTTPException(400, "Некорректное время")
    await run_in_threadpool(record_presence, store, token, int(seconds))
    return Response(status_code=204)


def routes():
    return [
        Route("/admin/statistics", dashboard, methods=["GET", "POST"]),
        Route("/api/signup-bonus", public_bonus),
        Route("/api/account/activity", activity, methods=["GET", "POST"]),
    ]
