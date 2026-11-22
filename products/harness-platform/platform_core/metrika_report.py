#!/usr/bin/env python3
"""Посещаемость octoport.ru через API отчётов Яндекс Метрики."""

import argparse
from datetime import date
from http.client import HTTPException
import json
import os
from pathlib import Path
import re
import sys
from time import sleep
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener


COUNTER = 114504756
DOMAIN = "octoport.ru"
TOKEN_FILE = Path("/etc/octoport-metrika.oauth")
ADMIN_TOKEN_FILE = Path("/var/lib/harness-prod/metrika.oauth")
METRICS = (
    ("visits", "ym:s:visits", "Визиты"),
    ("visitors", "ym:s:users", "Посетители"),
    ("pageviews", "ym:s:pageviews", "Просмотры"),
    ("bounce_percent", "ym:s:bounceRate", "Отказы, %"),
    ("average_seconds", "ym:s:avgVisitDurationSeconds", "Среднее время, с"),
)
PAGE_METRICS = (
    ("pageviews", "ym:pv:pageviews", "Просмотры"),
    ("visitors", "ym:pv:users", "Посетители"),
)
PAGE_DIMENSION = "ym:pv:URLPath"
PAGE_FILTER = "ym:pv:URLDomain=.('octoport.ru','www.octoport.ru') AND ym:pv:URLPath!~'^/admin(/|$)'"


class ReportError(Exception):
    pass


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def validate_token(token):
    if len(token) > 2048 or not re.fullmatch(r"[A-Za-z0-9._~+/=-]+", token):
        raise ReportError("Вставьте OAuth-токен целиком, одной строкой без пробелов.")
    return token


def load_token(path):
    token = os.environ.get("METRIKA_OAUTH_TOKEN", "").strip()
    for candidate in (ADMIN_TOKEN_FILE, path) if path == TOKEN_FILE else (path,):
        if token:
            break
        try:
            token = candidate.read_text(encoding="utf-8").strip()
        except FileNotFoundError:
            continue
        except (OSError, UnicodeError) as exc:
            raise ReportError(f"Не удалось прочитать файл токена {candidate}.") from exc
    if not token:
        raise ReportError(f"Нужен OAuth-токен с доступом metrika:read к счётчику {COUNTER}. "
                          f"Задайте METRIKA_OAUTH_TOKEN или сохраните токен в {path}.")
    return validate_token(token)


def get_report(opener, token, counter, start, end, dimensions=None, limit=None, *, attempts=3, timeout=20):
    is_page_report = dimensions == PAGE_DIMENSION
    metrics = PAGE_METRICS if is_page_report else METRICS
    params = {
        "ids": counter,
        "date1": start,
        "date2": end,
        "metrics": ",".join(metric for _, metric, _ in metrics),
        "filters": PAGE_FILTER if is_page_report else "ym:s:startURLDomain=.('octoport.ru','www.octoport.ru')",
        "lang": "ru",
        "accuracy": "full",
    }
    if dimensions:
        params.update(dimensions=dimensions, limit=limit)
        params["sort"] = {
            "ym:s:date": "ym:s:date",
            PAGE_DIMENSION: "-ym:pv:pageviews",
        }.get(dimensions, "-ym:s:visits")
    url = "https://api-metrika.yandex.net/stat/v1/data?" + urlencode(params)
    for attempt in range(attempts):
        try:
            request = Request(url, headers={"Authorization": f"OAuth {token}", "Accept": "application/json"})
            with opener.open(request, timeout=timeout) as response:
                result = json.load(response)
            if not isinstance(result, dict) or not isinstance(result.get("data"), list) or (
                    "query" in result and not isinstance(result["query"], dict)):
                raise ReportError("Метрика вернула ответ в неожиданном формате.")
            return result
        except HTTPError as exc:
            code = exc.code
            exc.close()
            if code in (401, 403):
                raise ReportError(
                    f"Метрика вернула HTTP {code}. Проверьте OAuth-токен, право metrika:read "
                    f"и доступ этого аккаунта к счётчику {counter}."
                ) from exc
            if code not in (429, 500, 502, 503, 504) or attempt == attempts - 1:
                raise ReportError(f"Метрика вернула HTTP {code} при получении отчёта.") from exc
        except (URLError, TimeoutError, HTTPException) as exc:
            if attempt == attempts - 1:
                raise ReportError("Связь с API Метрики не установилась.") from exc
        except (ValueError, UnicodeError) as exc:
            raise ReportError("Метрика вернула некорректный JSON.") from exc
        sleep(2 ** attempt)


def values(items, metrics=METRICS):
    if not isinstance(items, list) or len(items) != len(metrics):
        raise ReportError("В ответе Метрики отсутствует часть показателей.")
    if any(value is not None and type(value) not in (int, float) for value in items):
        raise ReportError("Метрика вернула некорректное значение показателя.")
    return {key: value for (key, _, _), value in zip(metrics, items)}


def section_metrics(section):
    return PAGE_METRICS if section == "pageviews" else METRICS


def report(opener, args, token, *, fetch=get_report):
    start, end = (args.date_from, args.date_to) if args.date_from else (f"{args.days or 7}daysAgo", "yesterday")
    overview = fetch(opener, token, args.counter, start, end)
    actual_start = overview.get("query", {}).get("date1", start)
    actual_end = overview.get("query", {}).get("date2", end)
    if not isinstance(actual_start, str) or not isinstance(actual_end, str):
        raise ReportError("Метрика вернула даты в неожиданном формате.")
    result = {
        "site": DOMAIN, "counter": args.counter, "date_from": actual_start, "date_to": actual_end,
        "totals": values(overview.get("totals")), "sections": {},
    }
    notes = result["notes"] = []
    if overview.get("sampled"):
        notes.append("Итоги рассчитаны по выборке Метрики.")
    for name, title, dimension, limit in (
        ("pageviews", "Просмотры по страницам", PAGE_DIMENSION, 100000),
        ("daily", "По дням", "ym:s:date", 10000),
        ("sources", "Источники трафика", "ym:s:lastTrafficSource", args.top),
        ("landing_sections", "Разделы входа", "ym:s:startURLPathLevel1Hash", args.top),
    ):
        if args.report == "summary":
            break
        segment = fetch(opener, token, args.counter, actual_start, actual_end, dimension, limit)
        metrics = section_metrics(name)
        rows = []
        for row in segment["data"]:
            dimensions = row.get("dimensions") if isinstance(row, dict) else None
            if not isinstance(dimensions, list) or (dimensions and not isinstance(dimensions[0], dict)):
                raise ReportError("В отчёте Метрики отсутствуют категории.")
            label = dimensions[0].get("name") if dimensions else None
            if label is not None and not isinstance(label, str):
                raise ReportError("В отчёте Метрики обнаружена некорректная категория.")
            if name == "pageviews" and (not label or label == "/admin" or label.startswith("/admin/")):
                continue
            rows.append({"name": label or "Не определено", **values(row.get("metrics"), metrics)})
        result["sections"][name] = {"title": title, "rows": rows}
        if segment.get("sampled"):
            notes.append(f"{title} — данные рассчитаны по выборке Метрики.")
        if segment.get("contains_sensitive_data"):
            notes.append(f"{title} — Метрика может скрывать строки при малой выборке.")
        total_rows = segment.get("total_rows")
        if isinstance(total_rows, int) and total_rows > len(segment["data"]):
            notes.append(f"{title} — получено {len(segment['data'])} из {total_rows} строк.")
    return result


def format_value(value):
    if value is None:
        return "—"
    if isinstance(value, float):
        return f"{value:.2f}".rstrip("0").rstrip(".").replace(".", ",")
    return str(value)


def print_report(result):
    print(f"{result['site']} | {result['date_from']} — {result['date_to']} | счётчик {result['counter']}")
    print()
    for key, _, label in METRICS:
        print(f"{label} — {format_value(result['totals'][key])}")
    for name, section in result["sections"].items():
        print(f"\n{section['title']}")
        if not section["rows"]:
            print("Нет доступных строк за период.")
            continue
        metrics = section_metrics(name)
        label = "Страница" if name == "pageviews" else "Раздел"
        print(label + "\t" + "\t".join(label for _, _, label in metrics))
        for row in section["rows"]:
            label = " ".join(row["name"].split())
            print(label + "\t" + "\t".join(format_value(row[key]) for key, _, _ in metrics))
    for note in result["notes"]:
        print(f"\n{note}")


def main():
    parser = argparse.ArgumentParser(
        description="Статистика octoport.ru. По умолчанию — последние 7 полных дней.",
        epilog="Доступ — METRIKA_OAUTH_TOKEN или --token-file. Для отчёта за сегодня задайте обе даты явно.",
    )
    parser.add_argument("--days", type=int, help="число полных дней до вчера включительно")
    parser.add_argument("--from", dest="date_from", help="первая дата, ГГГГ-ММ-ДД")
    parser.add_argument("--to", dest="date_to", help="последняя дата, ГГГГ-ММ-ДД")
    parser.add_argument("--counter", type=int, default=COUNTER, help=f"номер счётчика, по умолчанию {COUNTER}")
    parser.add_argument("--top", type=int, default=10, help="сколько источников и разделов входа показать")
    parser.add_argument("--report", choices=("summary", "all"), default="all", help="итоги или полный отчёт")
    parser.add_argument("--format", choices=("text", "json"), default="text", help="формат вывода")
    parser.add_argument("--token-file", type=Path, default=TOKEN_FILE, help="файл с OAuth-токеном в одной строке")
    args = parser.parse_args()
    if args.counter < 1 or not 1 <= args.top <= 100000 or args.days is not None and args.days < 1:
        parser.error("Укажите положительные значения, для --top допустимо от 1 до 100000.")
    if args.date_from is not None or args.date_to is not None:
        if args.days is not None or not args.date_from or not args.date_to:
            parser.error("Используйте --days либо обе даты --from и --to.")
        try:
            start, end = date.fromisoformat(args.date_from), date.fromisoformat(args.date_to)
        except ValueError:
            parser.error("Введите обе даты в формате ГГГГ-ММ-ДД.")
        if args.date_from != start.isoformat() or args.date_to != end.isoformat():
            parser.error("Введите обе даты в формате ГГГГ-ММ-ДД.")
        if start > end:
            parser.error("Дата начала должна предшествовать дате окончания или совпадать с ней.")
    try:
        data = report(build_opener(NoRedirects()), args, load_token(args.token_file))
    except ReportError as exc:
        print(exc, file=sys.stderr)
        return 1
    if args.format == "json":
        print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        print_report(data)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
