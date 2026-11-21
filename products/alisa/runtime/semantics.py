"""Pure Russian query planning. Never executes HTTP or reads credentials."""
from __future__ import annotations
import calendar
import hashlib
import json
import re
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta
from typing import Any
from request_basis import basis_text, sales_ambiguous, CLARIFICATION

from registry import REGISTRY, REGISTRY_HASH, DEFINITIONS, base_metrics
VERSION = REGISTRY['version']
METRICS = tuple(sorted(DEFINITIONS))
CONTROL = {'готово', 'результат', 'результат отчета', 'прочитай отчет', 'повтори отчет',
           'статус отчета', 'план запроса', 'отмени отчет', 'дальше', 'помощь аналитики',
           'диагностика аналитики', 'помощь', 'что ты умеешь'}
MONTHS = {s: i + 1 for i, names in enumerate([
    ('январь','января'),('февраль','февраля'),('март','марта'),('апрель','апреля'),
    ('май','мая'),('июнь','июня'),('июль','июля'),('август','августа'),
    ('сентябрь','сентября'),('октябрь','октября'),('ноябрь','ноября'),('декабрь','декабря')])
    for s in names}
MONTHS.update({n:i+1 for i,n in enumerate(['январем','февралем','мартом','апрелем','маем','июнем','июлем','августом','сентябрем','октябрем','ноябрем','декабрем'])})
MONTHS.update({n:i+1 for i,n in enumerate(['январе','феврале','марте','апреле','мае','июне','июле','августе','сентябре','октябре','ноябре','декабре'])})
MONTH_PATTERN = '|'.join(sorted(MONTHS,key=len,reverse=True))

class Rejected(ValueError):
    def __init__(self, code: str, message: str = '', *, context: dict | None = None):
        self.code = code
        self.message = message or code
        # Internal catalogue reference, not a user-supplied message/template.
        self.context = dict(context) if type(context) is dict else None
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

def period_from_text(text: str, today: date, allow_compare: bool=False) -> tuple[dict, str]:
    if not isinstance(text,str) or len(text)>1200:raise Rejected('INPUT_SIZE')
    rules = [
        (rf'с\s+(\d{{1,2}})\s+({MONTH_PATTERN})(?:\s+(20\d{{2}})(?:\s+года)?)?\s+по\s+(\d{{1,2}})\s+({MONTH_PATTERN})(?:\s+(20\d{{2}})(?:\s+года)?)?', 'named_range'),
        (r'с\s+(\d{4}\s*-\s*\d{2}\s*-\s*\d{2})\s+по\s+(\d{4}\s*-\s*\d{2}\s*-\s*\d{2})', 'iso'),
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
            searchable=re.sub(r'"[^"\n]*"|«[^»\n]*»',lambda m:' '*len(m.group(0)),masked)
            for match in list(re.finditer(r'(?<!\w)' + pattern + r'(?!\w)', searchable)):
                if kind == 'named_range':
                    a,m1,y1,b,m2,y2=match.groups();m1,m2=MONTHS[m1],MONTHS[m2]
                    if y1 and y2:y1,y2=int(y1),int(y2)
                    elif y2:y2=int(y2);y1=y2-int(m1>m2)
                    elif y1:y1=int(y1);y2=y1+int(m2<m1)
                    else:y2=today.year-int(m2>today.month);y1=y2-int(m1>m2)
                    start,end=date(y1,m1,int(a)),date(y2,m2,int(b))
                elif kind == 'iso':
                    # Only the two explicitly matched date tokens are joined.
                    # Never remove spaces from unrelated identifiers/product names.
                    start, end = (date.fromisoformat(re.sub(r'\s+', '', token)) for token in match.groups())
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
                found.append((start, end, match.start()))
                masked = masked[:match.start()] + ' ' * (match.end()-match.start()) + masked[match.end():]
    except (ValueError, OverflowError):
        raise Rejected('INVALID_DATE', 'Укажите существующие даты начала и конца.') from None
    if len(found) != (2 if allow_compare else 1):
        raise Rejected('PERIOD_REQUIRED', 'Для сравнения укажите два периода; для обычного отчета — один.')
    found.sort(key=lambda x:x[2])
    for start,end,_ in found:
        if start > end or end > today or (end-start).days >= 365:
            raise Rejected('PERIOD_RANGE', 'Нужен период до 365 дней, без будущих дат.')
    start,end,_=found[0]
    result={'from':start.isoformat(),'to':end.isoformat()}
    if allow_compare:result['comparison']={'from':found[1][0].isoformat(),'to':found[1][1].isoformat()}
    return result, ' '.join(masked.split())

# Optional language accelerators. Source recipes and execution stay independent.
from semantic_catalog import EXPRESSION_CATALOG, SPEECH_CATALOG, formula_platforms
PHRASES={k:tuple(v) for k,v in SPEECH_CATALOG['phrases'].items()}
BUNDLES=SPEECH_CATALOG['bundles']
SNAPSHOT_PHRASES=tuple(p for m,ps in PHRASES.items() if m in DEFINITIONS and DEFINITIONS[m].get('temporal')=='snapshot' for p in ps)
SNAPSHOT_PHRASES+=tuple(p for p,ms in BUNDLES.items() if all(DEFINITIONS[m].get('temporal')=='snapshot' for m in base_metrics(ms)))
def extract_filters(text):
    filters={};masked=text
    # An explicit WB nmID, not an ambiguous seller article/SKU.
    pattern=r'(?<!\w)(?P<exclude>кроме\s+)?(?:по\s+)?артикул(?:у|а)?\s+(?:wb|вб|вайлдберриз)\s+(?P<id>[1-9]\d{0,14})(?!\w)'
    for m in list(re.finditer(pattern,masked)):
        key='exclude_nm_ids' if m.group('exclude') else 'nm_ids'
        filters.setdefault(key,[]).append(int(m.group('id')))
        masked=masked[:m.start()]+' '*(m.end()-m.start())+masked[m.end():]
    pattern=r'(?<!\w)(?:по\s+)?бренд(?:у|а)?\s+["«]([^"»]{1,100})["»]'
    for m in list(re.finditer(pattern,masked)):
        filters.setdefault('brands',[]).append(m.group(1).strip())
        masked=masked[:m.start()]+' '*(m.end()-m.start())+masked[m.end():]
    return {k:sorted(set(v)) for k,v in filters.items()}, ' '.join(masked.split())

def parse(text: str, today: date) -> dict:
    question=normalize(text)
    from information import is_help
    if is_help(question):return {'route':'P0','command':question if question in CONTROL else 'помощь'}
    if not question or question in CONTROL:
        return {'route':'P0','command':question or 'помощь'}
    if re.search(r'(sk-[\w-]{12,}|eyJ[\w-]{25,}\.|\b[0-9a-f]{32,}\b|api.?key|authorization|bearer|парол|токен|секрет)',question,re.I):
        raise Rejected('SENSITIVE_INPUT','Не передавайте в навык ключи и пароли.')
    refresh=question.startswith('обнови ')
    cleaned=re.sub(r'^обнови\s+','',question)
    cleaned=re.sub(r'(?:[.;,]\s*)?выкупы\s+не\s+учитывай\b',' ',cleaned)
    if re.search(r'\b(?:измени|поменяй|удали|включи|отключи|создай|запусти|повысь|понизь)\b',cleaned):
        raise Rejected('READ_ONLY','Изменение магазина или рекламы не разрешено этим маршрутом.')
    if re.search(r'\b(?:чуж\w*|другого\s+владельца)\b',cleaned):
        raise Rejected('ACCESS','Доступны только ваши подключенные магазины.')
    if re.search(r'\bюнит[ -]?экономик\w*\b',re.sub(r'"[^"\n]*"|«[^»\n]*»',' ',cleaned)):
        raise Rejected('MISSING_COST_BASIS','Юнит-экономика запланирована как составной отчёт. Для неё ещё нужны себестоимость, выбранная база выручки и полный непересекающийся набор расходов; текущие начисления прибылью не называю.')
    if re.search(r'\bприбыл\w*\b',cleaned):
        raise Rejected('MISSING_COST_BASIS','Себестоимость в настройках проекта не заполнена. Финансовые начисления и расходы доступны, но прибылью без себестоимости их не называю.')
    if re.search(r'\b(?:fbo|fbs|фбо|фбс)\b',cleaned) and 'остатки' not in cleaned:
        raise Rejected('OPERATION_NOT_ENABLED','Разрез заказов FBO/FBS пока не подключён.')
    if re.search(r'\bостат\w*\b',cleaned) and not any(p in cleaned for p in SNAPSHOT_PHRASES):
        raise Rejected('STOCK_SCOPE_REQUIRED','Уточните: текущие остатки на складах площадки или на складах продавца. Исторические остатки этим источником не подменяю.')
    if re.search(r'\bвозврат\w*\b',cleaned) and 'по финансовому балансу' not in cleaned and 'в пути' not in cleaned:
        raise Rejected('EVENT_RETURNS_NOT_ENABLED','Возвраты по дате события требуют отдельного источника. Доступны возвраты по финансовому балансу Ozon и возвраты в пути WB.')
    filters,cleaned=extract_filters(cleaned)
    explicit_compare=bool(re.match(r'^сравни(?:те)?\s+',cleaned))
    compare=explicit_compare or bool(re.search(r'\b(?:относительно|изменил\w*|изменен\w*|разниц\w*)\b|по сравнению',cleaned))
    cleaned=re.sub(r'^сравни(?:те)?\s+','',cleaned)
    guard_text=cleaned
    for phrase in SNAPSHOT_PHRASES:
        guard_text=re.sub(r'(?<!\w)'+re.escape(phrase)+r'(?!\w)',' ',guard_text)
    if re.search(r'\b(?:кроме|без|не|исключ\w*|сравни\w*|артикул\w*|sku|бренд\w*|склад\w*|категори\w*|топ|доллар\w*|евро|юан\w*|рубл\w*|регионам|городам)\b|по\s+(?:дням|неделям|месяцам|товарам)',guard_text):
        raise Rejected('OPERATION_NOT_ENABLED','Этот фильтр или разрез пока не поддерживается выбранным источником. Условие не отбрасываю и другую площадку не подставляю.')
    if sales_ambiguous(cleaned):
        raise Rejected('METRIC_AMBIGUOUS', CLARIFICATION)
    if re.search(r'\b(?:количество заказов|сколько заказов|средн\w* чек|средняя сумма заказа)\b', basis_text(cleaned)):
        raise Rejected('METRIC_AMBIGUOUS','Уточните: количество заказанных товаров, сумма заказов или средняя стоимость заказанного товара. Отдельные заказы и выкупы — другие показатели.')
    if re.search(r'\bвыкуп\w*\b',cleaned) and not re.search(r'по заказам|выкупа заказанных|выкупленных товаров в заказанных',cleaned):
        raise Rejected('COHORT_REQUIRED','Воронка WB считает выкупы по дате заказа. Напишите: сводка выкупов по заказам за октябрь на WB. Выкупы по фактической дате этим источником не подменяю.')
    snapshot=any(re.search(r'(?<!\w)'+re.escape(p)+r'(?!\w)',cleaned) for p in SNAPSHOT_PHRASES)
    if snapshot:
        if compare or re.search(r'\b(?:вчера|позавчера|недел\w*|месяц\w*|20\d{2})\b|'+MONTH_PATTERN,cleaned):
            raise Rejected('HISTORICAL_SNAPSHOT','Выбранный источник показывает текущий снимок. Для текущего состояния укажите «сейчас»; исторический период им не подменяю.')
        period={'from':today.isoformat(),'to':today.isoformat()};comparison=None
        remainder=re.sub(r'\b(?:сейчас|сегодня)\b',' ',cleaned)
    else:
        try:
            period,remainder=period_from_text(cleaned,today,allow_compare=compare)
        except Rejected as exc:
            if not compare or explicit_compare or exc.code!='PERIOD_REQUIRED':raise
            period,remainder=period_from_text(cleaned,today,allow_compare=False)
        comparison=period.pop('comparison',None)
    aliases={'ozon':r'\b(?:озон(?:е|а|у)?|ozon)\b','wb':r'\b(?:вайлдберриз|вайлдберис|вб|wb|wildberries)\b'}
    platforms=sorted(p for p,pattern in aliases.items() if re.search(pattern,remainder)) or ['ozon','wb']
    if filters and platforms!=['wb']:
        raise Rejected('FILTER_PLATFORM','Этот фильтр пока доступен только при явно выбранном WB.')
    group='total' if re.search(r'\b(?:всего|суммарно|вместе|общая|общую)\b',remainder) else 'marketplace'
    if group=='total' and re.search(r'\bотдельно\b',remainder):raise Rejected('GROUP_AMBIGUOUS')
    for pattern in aliases.values():remainder=re.sub(pattern,' ',remainder)
    remainder=re.sub(r'\b(?:на обеих площадках|по всем магазинам|на всех площадках|во всех магазинах)\b',' ',remainder)
    if re.search(r'\bмагазин\w*\b',remainder):raise Rejected('STORE_ALIAS','Название магазина пока не разрешено однозначно. Укажите площадку.')
    remainder=re.sub(r'\b(?:алиса|дай|покажи|скажи|пожалуйста|посчитай|отдельно|суммарно|вместе|общая|общую|всего)\b',' ',remainder)
    remainder=' '.join(re.sub(r'[.,;:!?]',' ',remainder).split())
    phrases={phrase:[metric] for metric,options in PHRASES.items() for phrase in options}
    phrases.update(BUNDLES)
    # Consume only complete semantic phrases; any meaningful residue is sent once
    # to P2 and is never silently discarded by P1.
    found=set();residual=remainder
    for phrase,ms in sorted(phrases.items(),key=lambda x:len(x[0]),reverse=True):
        pattern=r'(?<!\w)'+re.escape(phrase)+r'(?!\w)'
        if re.search(pattern,residual):
            found.update(ms);residual=re.sub(pattern,' ',residual)
    residual=' '.join(re.sub(r'\b(?:и|на|по|с|за|также|а)\b',' ',residual).split())
    if not found and remainder in ('полная сводка','полную сводку'):
        found={m for m,d in DEFINITIONS.items() if set(platforms)<=set(d['platforms'])};residual=''
    if not found and ' '.join(re.sub(r'\b(?:на|по|и|с)\b',' ',remainder).split()) in ('финансовая сводка','финансовую сводку'):
        found={m for m,d in DEFINITIONS.items() if d.get('source')=='finance' and set(platforms)<=set(d['platforms'])};residual=''
    metrics=sorted(found) if found and not residual else None
    if metrics and any(not set(platforms)<=set(formula_platforms(m,EXPRESSION_CATALOG)) for m in metrics):
        raise Rejected('PLATFORM_METRIC_NOT_ENABLED','Запрошенный показатель ещё не подключён на одной из выбранных площадок; другую площадку не подставляю.')
    if snapshot and metrics is None:raise Rejected('SNAPSHOT_PHRASE_REQUIRED','Укажите текущие остатки на складах площадки, на складах продавца или текущий баланс.')
    return {'route':'P1' if metrics else 'P2','question':question,'model_question':remainder,
            'metrics':metrics,'period':period,'comparison':comparison,'filters':filters,'snapshot':snapshot,
            'platforms':platforms,'group_by':group,'refresh':refresh,'calendar_date':today.isoformat(),'timezone':'Europe/Moscow'}

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
    if not metrics or len(metrics)!=len(set(metrics)) or not set(metrics)<=set(METRICS):raise Rejected('PLAN_METRICS')
    selected=scope.select(draft['platforms'])
    today=date.fromisoformat(draft['calendar_date'])
    periods=[draft['period']]+([draft['comparison']] if draft.get('comparison') else [])
    for period in periods:
        start,end=(date.fromisoformat(period[x]) for x in ('from','to'))
        if start>end or end>today or (end-start).days>=365:raise Rejected('PERIOD_RANGE')
        if any(s.platform=='wb' for s in selected) and start<today-timedelta(days=364):raise Rejected('WB_HISTORY_LIMIT')
    if draft['timezone']!='Europe/Moscow' or draft['group_by'] not in ('marketplace','total'):raise Rejected('PLAN_SCHEMA')
    for m in metrics:
        for store in selected:
            if store.platform not in DEFINITIONS[m]['platforms']:
                raise Rejected('PLATFORM_METRIC_NOT_ENABLED','Показатель '+DEFINITIONS[m]['label']+' пока не подключен на '+store.platform+'. Запрос без этой части не отправляю.')
    operands=base_metrics(metrics)
    instantaneous=[DEFINITIONS[m].get('temporal')=='snapshot' for m in operands]
    if any(instantaneous)!=bool(draft.get('snapshot')) or (any(instantaneous) and not all(instantaneous)):
        raise Rejected('MIXED_TIME_AXES','Текущий снимок и показатели за период запрашивайте отдельно.')
    if draft.get('snapshot') and (draft.get('comparison') or 'snapshot_slot' not in draft):raise Rejected('SNAPSHOT_SCHEMA')
    if draft['group_by']=='total' and len({s.platform for s in selected})>1 and any(DEFINITIONS[m].get('source')=='finance' for m in operands):
        raise Rejected('FINANCIAL_SOURCE_BASIS','Финансовые источники площадок имеют разные определения. Запросите отдельно по площадкам.')
    filters=draft.get('filters',{})
    if not isinstance(filters,dict) or not set(filters)<={'nm_ids','exclude_nm_ids','brands'}:raise Rejected('FILTER_SCHEMA')
    for k,v in filters.items():
        if not isinstance(v,list) or not v or len(v)>1000:raise Rejected('FILTER_SCHEMA')
        if k in ('nm_ids','exclude_nm_ids') and not all(type(x)is int and 0<x<10**15 for x in v):raise Rejected('FILTER_SCHEMA')
        if k=='brands' and not all(isinstance(x,str) and 0<len(x)<=100 for x in v):raise Rejected('FILTER_SCHEMA')
    if filters and any(s.platform!='wb' for s in selected):raise Rejected('FILTER_PLATFORM')
    if filters and any(DEFINITIONS[m]['source'] in ('finance','stocks','balance') for m in operands):
        raise Rejected('FILTER_SOURCE_NOT_SUPPORTED','Этот источник пока не поддерживает товарный фильтр. Не игнорирую его.')
    if filters and any(DEFINITIONS[m]['source']=='ads' for m in operands):
        raise Rejected('ADS_FILTER_NOT_SUPPORTED','Расходы по всему кабинету нельзя смешивать с заказами выбранного товара. Рекламная статистика по товару еще не подключена.')
    currencies={s.currency for s in selected}
    money=any(DEFINITIONS[m]['unit'].startswith('currency') for m in operands)
    if draft['group_by']=='total' and money and (None in currencies or len(currencies)!=1):
        raise Rejected('CURRENCY_UNCONFIRMED','Общий денежный итог требует подтвержденной одинаковой валюты всех магазинов.')
    if 'drr_ordered' in metrics and None in currencies:
        raise Rejected('CURRENCY_UNCONFIRMED','Для ДРР нужно подтвердить одинаковую валюту расходов и базы заказов.')
    return {'version':VERSION,'registry_hash':REGISTRY_HASH,'tenant':scope.tenant,'access_revision':scope.revision,
            'metrics':sorted(metrics),'period':dict(draft['period']),'comparison':draft.get('comparison'),
            'timezone':draft['timezone'],'group_by':draft['group_by'],'filters':filters,'snapshot':bool(draft.get('snapshot')),'snapshot_slot':draft.get('snapshot_slot'),'freshness_seconds':300 if draft.get('snapshot') else 900,
            'stores':[asdict(s) for s in selected],'definition':'source-explicit-operands-v07'}

def plan_authorized(plan: dict, scope: Scope) -> bool:
    try:
        platforms = sorted({s['platform'] for s in plan['stores']})
        current = {s.id:asdict(s) for s in scope.stores}
        return (plan['tenant'] == scope.tenant and plan['access_revision'] == scope.revision
                and plan['version'] == VERSION and plan['registry_hash'] == REGISTRY_HASH
                and all(current.get(s['id']) == s for s in plan['stores']))
    except (Rejected, KeyError, TypeError):
        return False
