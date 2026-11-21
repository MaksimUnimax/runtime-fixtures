"""Pure Russian query planning. Never executes HTTP or reads credentials."""
from __future__ import annotations
import calendar
import hashlib
import json
import re
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta
from typing import Any

from registry import REGISTRY, REGISTRY_HASH
VERSION = REGISTRY['version']
METRICS = ('ordered_revenue', 'ordered_units')
CONTROL = {'готово', 'результат', 'результат отчета', 'прочитай отчет', 'повтори отчет',
           'статус отчета', 'план запроса', 'отмени отчет', 'дальше', 'помощь аналитики',
           'диагностика аналитики', 'помощь', 'что ты умеешь'}
MONTHS = {s: i + 1 for i, names in enumerate([
    ('январь','января'),('февраль','февраля'),('март','марта'),('апрель','апреля'),
    ('май','мая'),('июнь','июня'),('июль','июля'),('август','августа'),
    ('сентябрь','сентября'),('октябрь','октября'),('ноябрь','ноября'),('декабрь','декабря')])
    for s in names}
MONTH_PATTERN = '|'.join(MONTHS)

class Rejected(ValueError):
    def __init__(self, code: str, message: str = ''):
        self.code = code
        self.message = message or code
        super().__init__(code)

def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)

def fingerprint(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode()).hexdigest()

def strict_json(raw: str | bytes, *, parse_float=None) -> Any:
    def pairs(items):
        out = {}
        for k, v in items:
            if k in out:
                raise Rejected('DUPLICATE_JSON_KEY')
            out[k] = v
        return out
    def bad(value):
        raise Rejected('NONFINITE_JSON')
    try:
        options = {'parse_float':parse_float} if parse_float is not None else {}
        return json.loads(raw, object_pairs_hook=pairs, parse_constant=bad, **options)
    except (ValueError, UnicodeError) as exc:
        if isinstance(exc, Rejected):
            raise
        raise Rejected('INVALID_JSON') from None

def normalize(text: str) -> str:
    if not isinstance(text, str) or len(text) > 1200:
        raise Rejected('INPUT_SIZE', 'Сократите запрос до одного отчета.')
    return re.sub(r'\s+', ' ', text.casefold().replace('ё', 'е')).strip(' \n\t?!.,')

def period_from_text(text: str, today: date) -> tuple[dict, str]:
    rules = [
        (r'с\s+(\d{4}-\d{2}-\d{2})\s+по\s+(\d{4}-\d{2}-\d{2})', 'iso'),
        (r'с\s+(\d{2}\.\d{2}\.\d{4})\s+по\s+(\d{2}\.\d{2}\.\d{4})', 'ru'),
        (rf'с\s+(\d{{1,2}})\s+по\s+(\d{{1,2}})\s+({MONTH_PATTERN})(?:\s+(20\d{{2}})(?:\s+года)?)?', 'days'),
        (r'(?:за\s+)?(?:прошлый|предыдущий)\s+месяц', 'last_month'),
        (r'(?:за\s+)?(?:текущий|этот)\s+месяц', 'this_month'),
        (r'(?:за\s+)?прошлую\s+неделю', 'last_week'),
        (r'(?:за\s+)?последние\s+(\d{1,3})\s+(?:дней|дня)', 'rolling'),
        (r'(?:за\s+)?позавчера', 'before_yesterday'),
        (r'(?:за\s+)?вчера', 'yesterday'),
        (r'(?:за\s+)?сегодня', 'today'),
        (rf'(?:за\s+)?({MONTH_PATTERN})(?:\s+(20\d{{2}})(?:\s+года)?)?', 'month'),
    ]
    masked, found = text, []
    try:
        for pattern, kind in rules:
            for match in list(re.finditer(r'(?<!\w)' + pattern + r'(?!\w)', masked)):
                if kind == 'iso':
                    start, end = map(date.fromisoformat, match.groups())
                elif kind == 'ru':
                    start, end = (datetime.strptime(x, '%d.%m.%Y').date() for x in match.groups())
                elif kind in ('days', 'month'):
                    if kind == 'days':
                        a, b, month, year = match.groups()
                    else:
                        month, year = match.groups()
                    month_number = MONTHS[month]
                    year_number = int(year) if year else today.year - (month_number > today.month)
                    if kind == 'days':
                        start, end = date(year_number, month_number, int(a)), date(year_number, month_number, int(b))
                    else:
                        start = date(year_number, month_number, 1)
                        end = date(year_number, month_number, calendar.monthrange(year_number, month_number)[1])
                        if (year_number, month_number) == (today.year, today.month):
                            end = today
                elif kind == 'last_month':
                    end = today.replace(day=1) - timedelta(days=1)
                    start = end.replace(day=1)
                elif kind == 'this_month':
                    start, end = today.replace(day=1), today
                elif kind == 'last_week':
                    end = today - timedelta(days=today.weekday() + 1)
                    start = end - timedelta(days=6)
                elif kind == 'rolling':
                    n = int(match.group(1))
                    if not 1 <= n <= 365:
                        raise ValueError('range')
                    end = today - timedelta(days=1)
                    start = end - timedelta(days=n - 1)
                else:
                    start = end = today - timedelta(days={'today':0, 'yesterday':1, 'before_yesterday':2}[kind])
                found.append((start, end))
                masked = masked[:match.start()] + ' ' * (match.end()-match.start()) + masked[match.end():]
    except (ValueError, OverflowError):
        raise Rejected('INVALID_DATE', 'Укажите существующие даты начала и конца.') from None
    if len(found) != 1:
        raise Rejected('PERIOD_REQUIRED', 'Укажите один период: например, за октябрь 2026 или за вчера.')
    start, end = found[0]
    if start > end or end > today or (end - start).days >= 365:
        raise Rejected('PERIOD_RANGE', 'Нужен период до 365 дней, без будущих дат.')
    return {'from': start.isoformat(), 'to': end.isoformat()}, ' '.join(masked.split())

def parse(text: str, today: date) -> dict:
    question = normalize(text)
    if not question or question in CONTROL:
        return {'route': 'P0', 'command': question or 'помощь'}
    if re.search(r'(sk-[\w-]{12,}|eyJ[\w-]{25,}\.|\b[0-9a-f]{32,}\b|api.?key|authorization|bearer|парол|токен|секрет)', question, re.I):
        raise Rejected('SENSITIVE_INPUT', 'Не передавайте в навык ключи и пароли.')
    refresh = question.startswith('обнови ')
    cleaned = re.sub(r'^обнови\s+', '', question)
    cleaned = re.sub(r'(?:[.;,]\s*)?выкупы\s+не\s+учитывай\b', ' ', cleaned)
    if re.search(r'\b(?:измени|поменяй|удали|включи|отключи|создай|запусти|повысь|понизь)\b', cleaned):
        raise Rejected('READ_ONLY', 'Изменение магазина или рекламы не разрешено этим маршрутом.')
    if re.search(r'\b(?:чуж\w*|другого\s+владельца)\b', cleaned):
        raise Rejected('ACCESS', 'Доступны только ваши подключенные магазины.')
    if re.search(r'\b(?:дрр|друр|реклам\w*|прибыл\w*|расход\w*|выкуп\w*|возврат\w*|остат\w*|комисси\w*|логистик\w*)\b', cleaned):
        raise Rejected('METRIC_NOT_ENABLED', 'Этот показатель пока не подключен; заказами его не подменяю.')
    if re.search(r'\b(?:кроме|без|не|исключ\w*|сравни\w*|артикул\w*|sku|бренд\w*|склад\w*|категори\w*|топ|fbo|fbs|фбо|фбс|доллар\w*|евро|юан\w*|рубл\w*)\b|по\s+(?:дням|неделям|месяцам|товарам)', cleaned):
        raise Rejected('OPERATION_NOT_ENABLED', 'Этот фильтр, разрез или пересчет валют пока не подключен. Ограничение не игнорирую.')
    if re.search(r'\b(?:количество заказов|сколько заказов|продаж\w*|выручк\w*)\b', cleaned):
        raise Rejected('METRIC_AMBIGUOUS', 'Уточните: количество заказанных товаров или сумма заказов?')
    period, remainder = period_from_text(cleaned, today)
    aliases = {'ozon': r'\b(?:озон(?:е|а|у)?|ozon)\b', 'wb': r'\b(?:вайлдберриз|вайлдберис|вб|wb|wildberries)\b'}
    platforms = sorted(p for p, pattern in aliases.items() if re.search(pattern, remainder)) or ['ozon', 'wb']
    group = 'total' if re.search(r'\b(?:всего|суммарно|вместе|общая|общую)\b', remainder) else 'marketplace'
    if group == 'total' and re.search(r'\bотдельно\b', remainder):
        raise Rejected('GROUP_AMBIGUOUS')
    for pattern in aliases.values():
        remainder = re.sub(pattern, ' ', remainder)
    remainder = re.sub(r'\b(?:на обеих площадках|по всем магазинам|на всех площадках|во всех магазинах)\b', ' ', remainder)
    if re.search(r'\bмагазин\w*\b', remainder):
        raise Rejected('STORE_ALIAS', 'Название магазина пока не разрешено однозначно. Укажите площадку.')
    remainder = re.sub(r'\b(?:алиса|дай|покажи|скажи|пожалуйста|посчитай|за|на|по|и|отдельно|суммарно|вместе|общая|общую|всего)\b', ' ', remainder)
    remainder = ' '.join(re.sub(r'[.,;:!?]', ' ', remainder).split())
    units = {'количество заказанных товаров','сколько товаров заказали','сколько штук заказали','сколько заказали товаров','заказано товаров','количество заказанных единиц'}
    revenue = {'сумма заказов','сумму заказов','на какую сумму заказали','какую сумму заказали','заказано сумму'}
    both = {'сводка заказов','сводку заказов','количество сумма заказов','сколько товаров заказали какую сумму','сколько штук заказали какую сумму','количество заказанных товаров сумма заказов','количество заказанных товаров сумму заказов'}
    metrics = ['ordered_units'] if remainder in units else ['ordered_revenue'] if remainder in revenue else list(METRICS) if remainder in both else None
    return {'route':'P1' if metrics else 'P2', 'question':question, 'metrics':metrics,
            'period':period, 'platforms':platforms, 'group_by':group, 'refresh':refresh,
            'calendar_date':today.isoformat(), 'timezone':'Europe/Moscow'}

def validate_model(raw: str, finish_reason: str) -> list[str]:
    if finish_reason != 'stop' or not isinstance(raw, str) or not raw.strip() or len(raw) > 4096:
        raise Rejected('LLM_INCOMPLETE')
    obj = strict_json(raw)
    if not isinstance(obj, dict) or set(obj) != {'metrics','fully_understood','unsupported'}:
        raise Rejected('LLM_SCHEMA')
    if obj['fully_understood'] is not True or obj['unsupported'] is not False:
        raise Rejected('LLM_CLARIFY')
    values = obj['metrics']
    if not isinstance(values, list) or not values or not all(isinstance(x,str) for x in values) or len(values) != len(set(values)) or not set(values) <= set(METRICS):
        raise Rejected('LLM_METRICS')
    return sorted(values)

@dataclass(frozen=True)
class Store:
    id: str
    platform: str
    identity: str
    access_revision: str
    source_revision: str
    currency: str | None = None

@dataclass(frozen=True)
class Scope:
    tenant: str
    revision: str
    stores: tuple[Store, ...]

    def select(self, platforms: list[str]) -> tuple[Store, ...]:
        out, seen = [], set()
        for store in sorted(self.stores, key=lambda s: s.id):
            if store.platform not in platforms:
                continue
            marker = (store.platform, store.identity)
            if marker in seen:
                continue
            if not all((store.id, store.identity, store.access_revision, store.source_revision)) or store.platform not in ('ozon','wb'):
                raise Rejected('STORE_SCHEMA')
            seen.add(marker)
            out.append(store)
        if {x.platform for x in out} != set(platforms) or len({s.id for s in out}) != len(out):
            raise Rejected('STORE_ACCESS')
        return tuple(out)

def make_plan(scope: Scope, draft: dict, metrics: list[str]) -> dict:
    if not metrics or len(metrics) != len(set(metrics)) or not set(metrics) <= set(METRICS):
        raise Rejected('PLAN_METRICS')
    selected = scope.select(draft['platforms'])
    today = date.fromisoformat(draft['calendar_date'])
    start, end = (date.fromisoformat(draft['period'][x]) for x in ('from','to'))
    if start > end or end > today or (end - start).days >= 365:
        raise Rejected('PERIOD_RANGE')
    if any(s.platform == 'wb' for s in selected) and start < today - timedelta(days=364):
        raise Rejected('WB_HISTORY_LIMIT')
    if draft['timezone'] != 'Europe/Moscow' or draft['group_by'] not in ('marketplace','total'):
        raise Rejected('PLAN_SCHEMA')
    currencies = {s.currency for s in selected}
    if draft['group_by'] == 'total' and 'ordered_revenue' in metrics and (None in currencies or len(currencies) != 1):
        raise Rejected('CURRENCY_UNCONFIRMED', 'Общий денежный итог требует подтвержденной одинаковой валюты всех магазинов.')
    return {'version':VERSION, 'registry_hash':REGISTRY_HASH, 'tenant':scope.tenant, 'access_revision':scope.revision,
            'metrics':sorted(metrics), 'period':dict(draft['period']), 'timezone':draft['timezone'],
            'group_by':draft['group_by'], 'filters':{}, 'stores':[asdict(s) for s in selected],
            'definition':'ordered-not-buyouts-v1'}

def plan_authorized(plan: dict, scope: Scope) -> bool:
    try:
        platforms = sorted({s['platform'] for s in plan['stores']})
        current = {s.id:asdict(s) for s in scope.stores}
        return (plan['tenant'] == scope.tenant and plan['access_revision'] == scope.revision
                and plan['version'] == VERSION and plan['registry_hash'] == REGISTRY_HASH
                and all(current.get(s['id']) == s for s in plan['stores']))
    except (Rejected, KeyError, TypeError):
        return False
