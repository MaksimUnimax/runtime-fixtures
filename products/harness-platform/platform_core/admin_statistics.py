"""Account statistics and the registration credit setting."""

from datetime import datetime
from decimal import Decimal
from functools import partial
from hmac import compare_digest
from html import escape
from sqlite3 import IntegrityError
from string import Template
from time import time
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException
from starlette.responses import HTMLResponse, JSONResponse, Response
from starlette.routing import Route

from . import coins
from .browser_session import _form_fields, _form_pairs, _redirect, browser_token
from .identity import AuthenticationError, _principal, _secret_digest
from .native_web import HEADERS, UI

PAGE_SIZES = (10, 20, 50, 100)
DEFAULT_SIZE = PAGE_SIZES[0]
TZ = ZoneInfo("Asia/Qyzylorda")
GRANTS = "SELECT COALESCE(SUM(amount),0) FROM coin_grants WHERE workspace_id=a.workspace_id"
ATTEMPTS = """FROM coin_attempts c JOIN coin_orders o USING(operation_id)
              WHERE o.workspace_id=a.workspace_id"""
COLUMNS = {
    "login": ("Логин", "a.login"),
    "registered": ("Регистрация", "registered"),
    "last_seen": ("Последняя активность", "p.last_at"),
    "time": ("Активное время", "p.seconds"),
    "tokens": ("Токены", f"""(SELECT COALESCE(SUM(
        COALESCE(json_extract(c.usage_json,'$.input_tokens'),0) +
        COALESCE(json_extract(c.usage_json,'$.cache_creation_input_tokens'),0) +
        COALESCE(json_extract(c.usage_json,'$.cache_read_input_tokens'),0) +
        COALESCE(json_extract(c.usage_json,'$.output_tokens'),0)),0) {ATTEMPTS})"""),
    "spent": ("Списано, монет", f"(SELECT COALESCE(SUM(c.charge),0) {ATTEMPTS})"),
    "topups": ("Пополнения, монет", f"({GRANTS} AND issuer!='signup')"),
    "purchased": ("Куплено, монет", f"({GRANTS} AND issuer='yookassa')"),
    "bonus": ("Стартовые, монет", f"({GRANTS} AND issuer='signup')"),
    "balance": ("Баланс, монет", """COALESCE((SELECT available FROM coin_wallet_balances
                                                WHERE workspace_id=a.workspace_id),0)"""),
}
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
        raise PermissionError("Требуются права администратора")
    return actor


def read_statistics(store, token, query, page, *, limit=DEFAULT_SIZE, sort="login", direction="asc"):
    if limit not in PAGE_SIZES or direction not in {"asc", "desc"}:
        raise ValueError("Invalid statistics order")
    _, ordering = COLUMNS[sort]
    with store._lock:
        db = store._db
        administrator = require_admin(db, token)
        total = db.execute("SELECT COUNT(*) FROM identity_accounts").fetchone()[0]
        count = (db.execute("SELECT COUNT(*) FROM identity_accounts WHERE instr(login,?)>0",
                            (query,)).fetchone()[0] if query else total)
        pages = max(1, (count + limit - 1) // limit)
        page = min(page, pages)
        accounts = db.execute(f"""SELECT a.actor_id, a.login, a.workspace_id, p.seconds, p.last_at,
                    COALESCE(d.created, (SELECT MIN(g.created) FROM coin_grants g
                        WHERE g.issuer='signup' AND g.key=a.actor_id AND g.workspace_id=a.workspace_id)) AS registered,
                    EXISTS(SELECT 1 FROM identity_admins r WHERE r.actor_id=a.actor_id)
                FROM identity_accounts a LEFT JOIN identity_presence p USING(actor_id)
                LEFT JOIN identity_registration_dates d USING(actor_id)
                WHERE (?='' OR instr(a.login,?)>0)
                ORDER BY {ordering} {direction} NULLS LAST, a.login ASC LIMIT ? OFFSET ?""",
                              (query, query, limit, (page-1)*limit)).fetchall()
        users = []
        for actor, login, workspace, seconds, last_at, registered, admin in accounts:
            grants = {issuer: (amount, number) for issuer, amount, number in db.execute(
                """SELECT issuer,SUM(amount),COUNT(*) FROM coin_grants
                    WHERE workspace_id=? GROUP BY issuer""", (workspace,))}
            paid, purchases = grants.get("yookassa", (0, 0))
            bonus = grants.get("signup", (0, 0))[0]
            manual = sum(amount for issuer, (amount, _) in grants.items() if issuer not in {"signup", "yookassa"})
            rubles = sum((Decimal(total) for total, in db.execute(
                """SELECT total FROM coin_checkouts WHERE workspace_id=? AND status='succeeded'""",
                (workspace,))), Decimal(0))
            available, reserved = coins.balances(db, workspace)
            users.append(dict(actor=actor, login=login, admin=admin, can_remove=actor!=administrator,
                              registered=registered, last_at=last_at, seconds=seconds,
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


def date_label(value):
    return datetime.fromtimestamp(value, TZ).strftime("%d.%m.%Y %H:%M") if value is not None else "—"


def render_user(user, filters):
    total = sum(m["input"] + m["cache"] + m["output"] for m in user["meters"].values())
    meters = f'<strong>{total:,}</strong>'.replace(",", "\u202f")
    for provider, m in user["meters"].items():
        detail = f'{provider} · {m["input"]} вход · {m["cache"]} кэш · {m["output"]} выход'
        meters += f'<small>{escape(detail)}</small>'
    login = escape(user["login"])
    role = "<small>Администратор</small>" if user["admin"] else ""
    spent = sum((Decimal(row["coins"]) for row in user["meters"].values()), Decimal(0))
    paid_rubles = format(user["rubles"], ".2f").replace(".", ",")
    target = statistics_url("/admin/statistics/remove", filters, account=user["actor"])
    remove = f'<a class="stats-remove" href="{escape(target, quote=True)}">Удалить</a>' if user["can_remove"] else "—"
    selected = (f'<input type="checkbox" name="account" value="{escape(user["actor"], quote=True)}" '
                f'aria-label="Выбрать {escape(user["login"], quote=True)}">') if user["can_remove"] else "—"
    return (f'<tr><td class="stats-check">{selected}</td><th scope="row">{login}{role}</th>'
            f'<td>{date_label(user["registered"])}</td><td>{date_label(user["last_at"])}</td>'
            f'<td>{duration(user["seconds"])}</td>'
            f'<td>{meters}</td><td>{spent:f}</td>'
            f'<td><strong>{display_coins(user["paid"] + user["manual"])}</strong>'
            f'<small>Ручные: {display_coins(user["manual"])}</small></td>'
            f'<td>{display_coins(user["paid"])}'
            f'<small>{user["purchases"]} платежей · {paid_rubles} ₽</small></td>'
            f'<td>{display_coins(user["bonus"])}</td>'
            f'<td>{display_coins(user["available"])}'
            f'<small>Резерв: {display_coins(user["reserved"])}</small></td><td>{remove}</td></tr>')


def statistics_url(path, filters, **changes):
    return path + "?" + urlencode({**filters, **changes})


def filters_from(request):
    values = request.query_params
    query = values.get("q", "").strip()
    page = values.get("page", "1")
    limit = values.get("limit", str(DEFAULT_SIZE))
    sort = values.get("sort", "login")
    direction = values.get("dir", "asc")
    if (len(query)>254 or not page.isascii() or not page.isdecimal() or len(page)>9
            or limit not in {str(n) for n in PAGE_SIZES}
            or sort not in COLUMNS or direction not in {"asc","desc"}):
        raise HTTPException(400, "Некорректные параметры статистики")
    return {"q":query, "page":max(1,int(page)), "limit":int(limit), "sort":sort, "dir":direction}


def headers(filters):
    cells = ['<th scope="col" class="stats-check"><input type="checkbox" data-stats-select-all '
             'aria-label="Выбрать все аккаунты на странице"></th>']
    for name, (label, _) in COLUMNS.items():
        active = name == filters["sort"]
        ascending = filters["dir"] == "asc"
        direction = ("desc" if ascending else "asc") if active else ("asc" if name=="login" else "desc")
        url = statistics_url("/admin/statistics",filters,sort=name,dir=direction,page=1)
        attr = (' aria-sort="ascending"' if ascending else ' aria-sort="descending"') if active else ""
        mark = (' <span aria-hidden="true">↑</span>' if ascending else ' <span aria-hidden="true">↓</span>') if active else ""
        cells.append(f'<th scope="col"{attr}><a href="{escape(url, quote=True)}">{label}{mark}</a></th>')
    return "".join(cells) + '<th scope="col">Действия</th>'


def render_page(data, filters, *, status=200, message=""):
    users, total, count, page, pages, bonus = data
    filters = {**filters, "page":page}
    query = filters["q"]
    path = "/admin/statistics"
    items = "".join(render_user(user, filters) for user in users) or (
        f'<tr><td colspan="{len(COLUMNS)+2}">Пользователи не найдены.</td></tr>')

    def page_link(number, label):
        url = statistics_url(path, filters, page=number)
        return f'<a href="{escape(url, quote=True)}">{label}</a>'

    nav = ""
    if pages > 1:
        links = (page_link(page - 1, "Назад") if page > 1 else "",
                 f"<span>Страница {page} из {pages}</span>",
                 page_link(page + 1, "Далее") if page < pages else "")
        nav = '<nav class="stats-pagination" aria-label="Страницы">' + "".join(links) + "</nav>"
    options = "".join(f'<option value="{n}"' + (" selected" if n == filters["limit"] else "") +
                      f'>{n}</option>' for n in PAGE_SIZES)
    count_text = f"Всего аккаунтов: {total}" + (f" · Найдено: {count}" if query else "")
    template = Template((UI / "admin-statistics.html").read_text())
    return HTMLResponse(template.substitute(
        rows=items, headers=headers(filters), pagination=nav, count=count_text,
        query=escape(query, quote=True), page_options=options, sort=filters["sort"],
        direction=filters["dir"], dashboard=escape(statistics_url(path, filters), quote=True),
        batch=escape(statistics_url("/admin/statistics/remove-batch", filters), quote=True),
        bonus=coins.display(bonus), max_bonus=coins.display(coins.MAX_BALANCE),
        message=escape(message), message_role="alert" if status >= 400 else "status"),
        status_code=status, headers=HEADERS)


async def dashboard(request):
    token = browser_token(request)
    store = request.app.state.identity
    filters = filters_from(request)
    status, message = 200, ""
    try:
        if request.method == "POST":
            fields = await _form_fields(request, {"amount"})
            try:
                await run_in_threadpool(save_bonus, store, token, fields["amount"])
            except ValueError:
                status, message = 400, "Введите количество монет от 0 до 8 000 000."
            else:
                return _redirect(statistics_url("/admin/statistics",filters,saved=1))
        elif request.query_params.get("saved") == "1":
            message = "Стартовые монеты сохранены."
        elif request.query_params.get("batch_removed", "") in {str(n) for n in range(1,PAGE_SIZES[-1]+1)}:
            message = "Удалено аккаунтов: " + request.query_params["batch_removed"] + "."
        elif request.query_params.get("removed") == "1":
            message = "Запись пользователя удалена."
        data = await run_in_threadpool(partial(read_statistics, store, token, filters["q"].casefold(),
            filters["page"], limit=filters["limit"], sort=filters["sort"], direction=filters["dir"]))
    except AuthenticationError:
        raise
    except PermissionError:
        raise HTTPException(403, "Требуются права администратора") from None
    return render_page(data, filters, status=status, message=message)


def target_account(db, administrator, actor):
    row = db.execute("""SELECT a.login,a.workspace_id FROM identity_accounts a
        JOIN workspaces w ON w.workspace_id=a.workspace_id AND w.owner_id=a.actor_id
        WHERE a.actor_id=?""",(actor,)).fetchone()
    if row is None:
        raise LookupError("Аккаунт не найден.")
    if actor == administrator:
        raise PermissionError("Нельзя удалить аккаунт, из которого выполнен вход.")
    return row


def load_removal(store, token, actor):
    with store._lock:
        administrator = require_admin(store._db, token)
        login, _ = target_account(store._db, administrator, actor)
        return login


def purge_account(store, token, actor, confirmation):
    with store._write() as db:
        administrator = require_admin(db, token)
        login, workspace = target_account(db, administrator, actor)
        if confirmation.strip() != login:
            raise ValueError("Введённый логин не совпадает.")
        purge_workspace(db, actor, workspace)


def purge_workspace(db, actor, workspace):
    tables = {name for name, in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if db.execute("""SELECT 1 FROM usage_grants g JOIN usage_operations o USING(operation_id)
            WHERE o.workspace_id=? AND g.expires_at>unixepoch() LIMIT 1""", (workspace,)).fetchone():
        raise RuntimeError("У аккаунта выполняется запрос. Повторите после завершения.")
    if "user_plugin_jobs" in tables and db.execute("""SELECT 1 FROM user_plugin_jobs j JOIN chats c
            ON c.chat_id=j.chat WHERE c.workspace_id=? AND j.state='running' LIMIT 1""",
            (workspace,)).fetchone():
        raise RuntimeError("У аккаунта выполняется задача магазина.")
    if db.execute("""SELECT 1 FROM coin_checkouts WHERE workspace_id=? AND status='pending' LIMIT 1""",
                  (workspace,)).fetchone():
        raise RuntimeError("У аккаунта есть незавершённое пополнение. Сначала завершите его сверку.")
    if db.execute("""SELECT 1 FROM coin_attempts a JOIN coin_orders o USING(operation_id)
            WHERE o.workspace_id=? AND a.charge IS NULL LIMIT 1""", (workspace,)).fetchone():
        raise RuntimeError("Списание по одному из запросов ожидает сверки.")
    # Removing chats also removes illustrations that reference model attempts.
    # Delete the remaining non-cascading references in dependency order.
    db.execute("DELETE FROM chats WHERE workspace_id=?", (workspace,))
    db.execute("""DELETE FROM coin_attempts WHERE operation_id IN (
                        SELECT operation_id FROM coin_orders WHERE workspace_id=?)""", (workspace,))
    for table in ("operation_model_efforts", "operation_routes"):
        if table in tables:
            db.execute(f"""DELETE FROM {table} WHERE operation_id IN (
                        SELECT operation_id FROM usage_operations WHERE workspace_id=?)""", (workspace,))
    for table in ("coin_orders", "coin_checkouts", "coin_grants"):
        db.execute(f"DELETE FROM {table} WHERE workspace_id=?", (workspace,))
    for table in ("account_integrations", "model_choice_terms", "model_preferences"):
        if table in tables:
            db.execute(f"DELETE FROM {table} WHERE workspace=?", (workspace,))
    db.execute("DELETE FROM workspaces WHERE workspace_id=? AND owner_id=?", (workspace, actor))


async def remove_account(request):
    token = browser_token(request)
    store = request.app.state.identity
    actor = request.query_params.get("account", "")
    filters = filters_from(request)
    back = statistics_url("/admin/statistics", filters)
    message, status = "", 200
    try:
        login = await run_in_threadpool(load_removal, store, token, actor)
        if request.method == "POST":
            fields = await _form_fields(request, {"confirmation"}, max_bytes=4096)
            try:
                await run_in_threadpool(purge_account, store, token, actor, fields["confirmation"])
            except ValueError as error:
                message, status = str(error), 400
            except RuntimeError as error:
                message, status = str(error), 409
            except IntegrityError:
                message, status = "Связанные записи не удалось удалить. Данные сохранены.", 409
            else:
                return _redirect(statistics_url("/admin/statistics", filters, removed=1))
    except AuthenticationError:
        raise
    except LookupError as error:
        raise HTTPException(404, str(error)) from None
    except PermissionError as error:
        raise HTTPException(403, str(error)) from None
    action = statistics_url("/admin/statistics/remove", filters, account=actor)
    template = Template((UI / "admin-statistics-remove.html").read_text())
    return HTMLResponse(template.substitute(login=escape(login), back=escape(back, quote=True),
        action=escape(action, quote=True), message=escape(message)), status_code=status, headers=HEADERS)


def batch_selection(pairs):
    actors = []
    fields = {}
    for name, value in pairs:
        if name == "account":
            actors.append(value)
        elif name in {"action", "confirmation"} and name not in fields:
            fields[name] = value
        else:
            raise HTTPException(400,"Некорректная форма удаления.")
    action = fields.get("action")
    if action not in {"review","delete"} or (action == "delete") != ("confirmation" in fields):
        raise HTTPException(400,"Некорректное действие.")
    if not actors:
        raise HTTPException(400,"Выберите аккаунты для удаления.")
    if (len(actors) > PAGE_SIZES[-1] or len(set(actors)) != len(actors)
            or any(not actor or len(actor) > 128 for actor in actors)):
        raise HTTPException(400,"Некорректный список аккаунтов.")
    return actors, fields


def load_batch(store, token, actors):
    with store._lock:
        db = store._db
        administrator = require_admin(db, token)
        return [target_account(db, administrator, actor)[0] for actor in actors]


def purge_batch(store, token, actors):
    with store._write() as db:
        administrator = require_admin(db, token)
        targets = [target_account(db, administrator, actor) for actor in actors]
        for actor, (login, workspace) in zip(actors, targets):
            try:
                purge_workspace(db, actor, workspace)
            except RuntimeError as error:
                raise RuntimeError(f"{login} — {error}") from error


async def remove_batch(request):
    token = browser_token(request)
    store = request.app.state.identity
    filters = filters_from(request)
    actors, fields = batch_selection(await _form_pairs(
        request, max_bytes=8192, max_fields=PAGE_SIZES[-1]+2))
    message, status = "", 200
    try:
        logins = await run_in_threadpool(load_batch, store, token, actors)
        if fields["action"] == "delete":
            if fields["confirmation"].strip().casefold() != "удалить":
                message, status = "Введите слово УДАЛИТЬ для подтверждения.", 400
            else:
                try:
                    await run_in_threadpool(purge_batch, store, token, actors)
                except RuntimeError as error:
                    message, status = f"Удаление отменено. {error}", 409
                except IntegrityError:
                    message, status = "Удаление отменено. Связанные записи сохранены.", 409
                else:
                    return _redirect(statistics_url("/admin/statistics", filters, batch_removed=len(logins)))
    except AuthenticationError:
        raise
    except LookupError as error:
        raise HTTPException(404, str(error)) from None
    except PermissionError as error:
        raise HTTPException(403, str(error)) from None

    path = "/admin/statistics/remove-batch"
    template = Template((UI / "admin-statistics-remove-batch.html").read_text())
    inputs = "".join(f'<input type="hidden" name="account" value="{escape(actor, quote=True)}">' for actor in actors)
    items = "".join(f"<li>{escape(login)}</li>" for login in logins)
    return HTMLResponse(template.substitute(count=len(logins), accounts=items, inputs=inputs,
        back=escape(statistics_url("/admin/statistics", filters), quote=True),
        action=escape(statistics_url(path, filters), quote=True),
        message=escape(message)), status_code=status, headers=HEADERS)


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
        Route("/admin/statistics/remove", remove_account, methods=["GET", "POST"]),
        Route("/admin/statistics/remove-batch", remove_batch, methods=["POST"]),
        Route("/api/signup-bonus", public_bonus),
        Route("/api/account/activity", activity, methods=["GET", "POST"]),
    ]
