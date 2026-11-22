"""Administrator-only Yandex Metrika configuration and traffic reports."""

import os
from argparse import Namespace
from datetime import datetime, timedelta
from functools import partial
from html import escape
from string import Template
from tempfile import NamedTemporaryFile
from urllib.request import build_opener

from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException
from starlette.responses import HTMLResponse
from starlette.routing import Route

from . import metrika_report as metrika
from .admin_statistics import TZ, require_admin
from .browser_session import _form_fields, _redirect, browser_token
from .native_web import HEADERS, UI

PATH = "/admin/visits"
PERIODS = {"1": "Сегодня", "7": "Последние 7 дней", "30": "Последние 30 дней", "90": "Последние 90 дней"}


def check_admin(identity, session, *, update=None):
    try:
        with identity._lock:
            require_admin(identity._db, session)
            if update is not None:
                save_token(*update)
    except PermissionError:
        raise HTTPException(403, "Требуются права администратора") from None


def save_token(path, token):
    # Create with mode 0600, then replace the previous token atomically.
    with NamedTemporaryFile(dir=path.parent, prefix=".metrika-", delete_on_close=False, mode="w",
                            encoding="ascii") as staged:
        staged.write(token + "\n")
        staged.flush()
        os.fsync(staged.fileno())
        os.replace(staged.name, path)


def load_token(path):
    try:
        return path.read_text(encoding="ascii").strip()
    except FileNotFoundError:
        return ""


def get_report(token, period, *, summary=False):
    today = datetime.now(TZ).date()
    start = today - timedelta(days=int(period) - 1)
    args = Namespace(date_from=start.isoformat(), date_to=today.isoformat(),
                     counter=metrika.COUNTER, report="summary" if summary else "all", top=10)
    return metrika.report(build_opener(metrika.NoRedirects()), args, metrika.validate_token(token),
                         fetch=partial(metrika.get_report, attempts=1, timeout=5))


def render_report(report):
    metrics = metrika.METRICS
    totals = "".join(f"<div><dt>{label}</dt><dd>{metrika.format_value(report['totals'][key])}</dd></div>"
                     for key, _, label in metrics)
    sections = []
    columns = "".join(f"<th scope='col'>{label}</th>" for _, _, label in metrics)
    for name, section in report["sections"].items():
        rows = []
        for row in section["rows"]:
            cells = "".join(f"<td>{metrika.format_value(row[key])}</td>" for key, _, _ in metrics)
            rows.append(f"<tr><th scope='row'>{escape(row['name'])}</th>{cells}</tr>")
        first_column = {"daily": "Дата", "sources": "Источник", "landing_sections": "Раздел"}[name]
        value = ("<div class='stats-table' tabindex='0' aria-labelledby='visits-" + name + "'><table>"
                 f"<thead><tr><th scope='col'>{first_column}</th>{columns}</tr></thead>"
                 "<tbody>" + "".join(rows) + "</tbody></table></div>") if rows else "<p>Нет данных за этот период.</p>"
        sections.append(f'<section aria-labelledby="visits-{name}"><h2 id="visits-{name}">'
                        f'{escape(section["title"])}</h2>{value}</section>')
    notes = "".join(f'<p class="stats-hint">{escape(note)}</p>' for note in report["notes"])
    return (
        f'<section aria-label="Итоги посещаемости">'
        f'<p class="stats-hint">{escape(report["date_from"])} — {escape(report["date_to"])}</p>'
        f'<dl class="visits-metrics">{totals}</dl>{notes}</section>' + "".join(sections)
    )


def render(period, *, configured, report=None, message="", status=200):
    options = "".join(f'<option value="{value}"{" selected" if value == period else ""}>{label}</option>'
                      for value, label in PERIODS.items())
    connection = "Токен сохранён." if configured else "Вставьте OAuth-токен, чтобы загрузить статистику."
    html = Template((UI / "admin-visits.html").read_text()).substitute(
        counter=metrika.COUNTER, connection=connection, period_options=options,
        results=render_report(report) if report is not None else "",
        message=escape(message), role="alert" if status >= 400 else "status",
    )
    return HTMLResponse(html, status_code=status, headers=HEADERS)


async def visits(request):
    session = browser_token(request)
    identity = request.app.state.identity
    await run_in_threadpool(check_admin, identity, session)
    path = request.app.state.metrika_token_path
    period = request.query_params.get("period", "7")
    if period not in PERIODS:
        period = "7"
    configured = path.is_file()
    try:
        if request.method == "POST":
            fields = await _form_fields(request, {"token"}, max_bytes=8192)
            token = fields["token"].strip()
            await run_in_threadpool(get_report, token, "1", summary=True)
            # Check the session again after the network request before changing the saved token.
            await run_in_threadpool(check_admin, identity, session, update=(path, token))
            return _redirect(PATH + "?saved=1")
        token = await run_in_threadpool(load_token, path)
        report = await run_in_threadpool(get_report, token, period) if token else None
        message = "Доступ к Метрике проверен." if request.query_params.get("saved") == "1" and report else ""
        return render(period, configured=bool(token), report=report, message=message)
    except metrika.ReportError as error:
        return render(period, configured=configured, message=str(error), status=400 if request.method == "POST" else 502)
    except (OSError, UnicodeError):
        return render(period, configured=configured, message="Не удалось прочитать или сохранить токен на сервере.", status=503)


def routes():
    return [Route(PATH, visits, methods=["GET", "POST"])]
