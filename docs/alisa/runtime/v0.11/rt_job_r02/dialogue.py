"""Durable, tenant AND conversation-scoped clarification; never performs network I/O.
An accepted clarification is an unfinished request, not a failed financial job.
Receipts, context changes and enqueue commit together in the repository transaction.
"""
from __future__ import annotations
from dataclasses import asdict
from datetime import date
import re
import retention
from semantics import (Rejected, normalize, parse, period_from_text, fingerprint,
                       canonical_json, strict_json)
from request_basis import sales_ambiguous
from registry import REGISTRY_HASH
from query_program import LANGUAGE, PROJECTION

TTL = 900
SCHEMA = 'alice-dialogue/v1'
CHOICES = {
    'заказанные': 'orders', 'заказанные товары': 'orders', 'заказы': 'orders',
    'по заказам': 'orders', 'количество и сумма заказанных товаров': 'orders',
    'сумма и количество заказанных товаров': 'orders', 'товары': 'orders',
    'выкупы': 'buyouts', 'выкупленные': 'buyouts', 'выкупленные товары': 'buyouts',
    'финансовые продажи': 'finance', 'финансовая реализация': 'finance',
    'по финансовым отчетам': 'finance', 'реализация по финансовому отчету': 'finance',
}
CANCEL = {'отмена', 'отмени', 'отмени уточнение', 'забудь запрос', 'не надо', 'отмени отчет'}
PASS_CONTROLS = {'диагностика аналитики', 'помощь', 'помощь аналитики', 'что ты умеешь'}
PENDING_CONTROLS = {'результат', 'результат отчета', 'статус отчета', 'план запроса', 'дальше'}
BASIS_PATTERN = re.compile(r'\b(?:(?:сколько|количество)\s+)?(?:продаж\w*|продал(?:и|а)?|продан\w*|выручк\w*|товарооборот\w*|заказов)\b')


def ensure_schema(repo):
    with repo.connection(True) as c:
        c.execute('''CREATE TABLE IF NOT EXISTS dialogue_context(
            tenant TEXT NOT NULL, conversation TEXT NOT NULL, last_seq INTEGER NOT NULL,
            pending TEXT, updated REAL NOT NULL, PRIMARY KEY(tenant,conversation))''')
        c.execute('''CREATE TABLE IF NOT EXISTS dialogue_receipts(
            tenant TEXT NOT NULL, conversation TEXT NOT NULL, rid TEXT NOT NULL,
            message_seq INTEGER NOT NULL, body_hash TEXT NOT NULL, reply TEXT NOT NULL,
            scope_hash TEXT NOT NULL, jid TEXT, plan TEXT, expires REAL, created REAL NOT NULL,
            PRIMARY KEY(tenant,conversation,rid), UNIQUE(tenant,conversation,message_seq))''')


def _reply(text, error=None, pending=False):
    r = {'text': text, 'tts': text}
    if error: r['error'] = error
    if pending: r['clarification_required'] = True
    return r


def _unquoted(text, transform):
    return ''.join(part if i % 2 else transform(part)
                   for i, part in enumerate(re.split(r'("[^"\n]*"|«[^»\n]*»)', text)))


def _normalize_request(text):
    """Only the observed unambiguous date typo. Never fuzzy-correct names or numbers."""
    changes = []
    def fix(s):
        s = re.sub(r'(?<!\w)(дай(?:те)?|покажи(?:те)?|скажи(?:те)?)(?=продаж|выручк)', r'\1 ', s)
        def replace(m):
            changes.append({'from': m.group(0), 'to': 'за вчера'})
            return 'за вчера'
        return re.sub(r'(?<!\w)(?:ща|за)\s+вчеар(?!\w)', replace, s)
    return _unquoted(normalize(text), fix), changes


def _choice(text):
    text = re.sub(r'^(?:именно|я имею в виду)\s+', '', text)
    text = re.sub(r'\s+пожалуйста$', '', text)
    return CHOICES.get(text)


def _replace_basis(query, choice):
    phrase = {'orders': 'сводка заказов', 'finance': 'продажи по финансовым отчетам',
              'buyouts': 'сводка выкупов по заказам','event':'фактические выкупы'}[choice]
    count = [0]
    def replace(s):
        def sub(_): count[0] += 1; return phrase
        return BASIS_PATTERN.sub(sub, s)
    result = _unquoted(query, replace)
    if count[0] != 1:
        raise Rejected('CLARIFICATION_COMPLEX', 'В запросе несколько неоднозначных показателей. Уточните каждый в исходной фразе; расчёт не запускаю.')
    return result


def _period(query, anchor):
    compare = bool(re.search(r'\bсравни\w*\b|относительно|по сравнению', query))
    try: return period_from_text(query, anchor, allow_compare=compare)[0]
    except Rejected: return None


def _event_axis(text):
    # Whole semantic indication, not an exact command spelling. Quoted product
    # names and explicit order-date cohorts are not event-time requests.
    t = re.sub(r'"[^"\n]*"|«[^»\n]*»', ' ', normalize(text))
    if re.search(r'по\s+(?:дате\s+)?заказ\w*', t):return False
    return bool(re.search(r'по\s+дате\s+(?:выкупа|события)|\b(?:выкупили|выкуплен\w*|получили\s+покупатели|покупатели\s+получили)\b', t))


def _event_unavailable(p):
    period = _period(p['query'], date.fromisoformat(p['anchor_date']))
    when = (' за ' + period['from'] + (' — ' + period['to'] if period['from'] != period['to'] else '')) if period else ''
    return _reply('Понял: товары, фактически выкупленные покупателями' + when +
                  ', независимо от даты заказа. Ваше уточнение принято. '
                  'Источник для такого отчёта ещё не подключён к навыку. '
                  'Это недостающая функция сервиса, а не неясный вопрос. '
                  'Заказами или финансовыми начислениями выкупы не заменяю.',
                  'EVENT_BUYOUTS_NOT_ENABLED')


def _prompt(p):
    if p['need']=='event_platform':
        period=_period(p['query'],date.fromisoformat(p['anchor_date']))
        when=(' за '+period['from']+(' — '+period['to'] if period['from']!=period['to'] else '')) if period else ''
        return _reply('Период'+when+' сохранён. Дневной источник фактических выкупов Ozon недоступен этому кабинету. Получить отдельный отчёт по WB? Ответьте: «только WB». Другую площадку молча не исключаю.','OZON_EVENT_SOURCE_UNAVAILABLE',True)
    if p['need']=='event_unavailable':return _event_unavailable(p)
    period = _period(p['query'], date.fromisoformat(p['anchor_date']))
    prefix = ''
    if period:
        prefix = ('Период ' + period['from'] + (' — ' + period['to'] if period['to'] != period['from'] else '') + ' сохранён. ')
    if p['need'] == 'basis':
        return _reply(prefix + 'Что считать продажами: заказанные товары и их сумму или выкупы? Можно ответить одним словом: «заказанные».', 'METRIC_AMBIGUOUS', True)
    if p['need'] == 'buyout_axis':
        return _reply(prefix + 'Для выкупов нужна дата события или дата заказа? Доступная воронка WB считает выкупы по дате заказа. Можно ответить: «по дате заказа».', 'COHORT_REQUIRED', True)
    selected = 'Заказанные товары и их сумма выбраны. ' if p.get('choice') == 'orders' else ''
    return _reply(selected + 'За какой период? Остальные условия запроса сохранены; можно ответить: «вчера» или назвать даты.', 'PERIOD_REQUIRED', True)


def _pin(engine):
    table_pin=None
    if engine.table_capabilities is not None:
        from table_analytics import HASH
        table_pin={'catalog':HASH,'capabilities':fingerprint(engine.table_capabilities())}
    return fingerprint({'table':table_pin,'schema': SCHEMA, 'catalog': engine.catalog, 'language': LANGUAGE,
                        'projection': PROJECTION, 'registry': REGISTRY_HASH})


def _context(engine, scope_hash, original, query, changes, anchor, now, error):
    need = 'basis' if error.code == 'METRIC_AMBIGUOUS' else 'period'
    return {'schema': SCHEMA, 'original_question': original, 'query': query,
            'anchor_date': anchor.isoformat(), 'scope_hash': scope_hash,
            'compiler_pin': _pin(engine), 'need': need, 'choice': None,
            'normalizations': changes, 'expires_at': now + TTL, 'turns': 0}


def _clarifiable(query, error):
    if error.code == 'METRIC_AMBIGUOUS':
        # Only the basis question we actually know how to resolve.
        return sales_ambiguous(query) or bool(re.search(r'\b(?:количество|сколько)\s+заказов\b', query))
    return error.code == 'PERIOD_REQUIRED'


def _short_date(text, anchor):
    try: period, rest = period_from_text(text, anchor)
    except Rejected: return None
    if rest.strip(' .?!,'): return None
    return period


def _submit_scoped(engine, tenant, command, rid, body_hash, today, conversation, message_seq):
    repo = engine.repo
    repo.validate_ingress(tenant, rid, body_hash)
    if (not isinstance(conversation, str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,128}', conversation)
            or type(message_seq) is not int or not 0 <= message_seq <= 99999999):
        raise Rejected('DIALOGUE_SCHEMA')
    inner_rid = 'dialogue1:' + fingerprint([conversation,rid])
    text = normalize(command)
    from information import is_help
    if is_help(text):text='помощь'
    scope = engine.scope_for(tenant)
    if scope.tenant != tenant: raise Rejected('TENANT_DENIED')
    scope_hash = fingerprint(asdict(scope))
    now = repo.clock()
    with repo.connection(True) as c:
        previous = c.execute('SELECT * FROM dialogue_receipts WHERE tenant=? AND conversation=? AND (rid=? OR message_seq=?)',
                             (tenant, conversation, rid, message_seq)).fetchone()
        if previous:
            if previous['rid'] != rid or previous['message_seq'] != message_seq or previous['body_hash'] != body_hash:
                raise Rejected('CHANGED_REPLAY')
            if previous['scope_hash'] != scope_hash: raise Rejected('SOURCE_ACCESS')
            if previous['plan'] and not engine.authorized(strict_json(previous['plan'])):
                raise Rejected('SOURCE_ACCESS')
            if previous['jid']:
                job = repo.get(tenant, previous['jid'])
                if job and job['plan'] and not engine.authorized(strict_json(job['plan'])):
                    raise Rejected('SOURCE_ACCESS')
            if previous['created']+retention.PAYLOAD_TTL<=now or (previous['expires'] is not None and previous['expires'] <= now):
                raise Rejected('RESULT_EXPIRED', 'Сохранённый ответ устарел. Повторите вопрос новым сообщением.')
            return strict_json(previous['reply'])
        retention.admission(c,tenant,'dialogue')
        current = c.execute('SELECT * FROM dialogue_context WHERE tenant=? AND conversation=?', (tenant, conversation)).fetchone()
        if current and current['last_seq'] >= message_seq:
            raise Rejected('STALE_DIALOGUE_TURN', 'Пришло запоздавшее сообщение. Текущее уточнение не изменено.')
        p = strict_json(current['pending']) if current and current['pending'] else None
        expired = bool(p and p['expires_at'] <= now)
        if expired: p = None
        short = _choice(text)
        protected_plan = None
        expires = None
        reply = None
        metadata = None
        query, changes = _normalize_request(text)
        anchor = today
        if p and (p['scope_hash'] != scope_hash or p['compiler_pin'] != _pin(engine)):
            p = None
            reply = _reply('Права, магазины или версия обработки изменились после уточнения. Повторите исходный вопрос; старый контекст не использую.', 'CLARIFICATION_SCOPE_CHANGED')
        elif p and text in CANCEL:
            p = None
            reply = _reply('Незавершённый запрос отменён. Другие отчёты не отменяю.')
        elif p and text in PASS_CONTROLS:
            reply = engine._submit(tenant, text, inner_rid, body_hash, today)
        elif p and text in PENDING_CONTROLS:
            reply = _prompt(p)
        elif p:
            anchor = date.fromisoformat(p['anchor_date'])
            followup = False
            if p['need']=='event_platform' and text in ('только wb','только вб','на wb','на вб','только вайлдберриз','wb','вб','вайлдберриз'):
                followup=True
                query=re.sub(r'\b(?:озон(?:е|а|у)?|ozon|вайлдберриз|вайлдберис|вб|wb|wildberries)\b',' ',p['query'])
                query=re.sub(r'\b(?:на|и|вместе|всего|суммарно|на обеих площадках|по всем магазинам)\b',' ',query)
                query=' '.join(query.split())+' на wb'
                p['choice']='event'
            elif p['need'] in ('basis','buyout_axis','event_unavailable') and _event_axis(query):
                followup = True
                p['need']='event_unavailable';p['choice']='event'
                if engine.table_capabilities is not None:
                    query=_replace_basis(p['query'],'event')
                else:reply=_event_unavailable(p)
            elif p['need'] in ('basis','event_unavailable') and short:
                followup = True
                if short == 'buyouts':
                    p['need'] = 'buyout_axis'; reply = _prompt(p)
                else:
                    query = _replace_basis(p['query'], short)
                    p['choice'] = short
            elif p['need'] == 'buyout_axis' and text in ('по дате заказа', 'по заказам'):
                followup = True; query = _replace_basis(p['query'], 'buyouts'); p['choice'] = 'buyouts'

            elif p['need'] == 'period':
                period = _short_date(query, anchor)
                if period:
                    followup = True
                    query = p['query'] + ' с ' + period['from'] + ' по ' + period['to']
                    p['normalizations'].extend(changes)
            if not followup:
                # A full new request replaces pending; never concatenate unrelated topics.
                p = None; anchor = today
            else:
                p['turns'] += 1
                if p['turns'] > 8:
                    p = None; reply = _reply('Слишком много неоднозначных уточнений. Сформулируйте запрос целиком.', 'CLARIFICATION_LIMIT')
                elif reply is None:
                    p['query'] = query
                    metadata = {'original_question': p['original_question'], 'basis': p['choice'],
                                'answer': text, 'anchor_date': p['anchor_date'],
                                'normalizations': p['normalizations'], 'resolved_question': query}
        elif short or text in ('по дате заказа', 'по дате выкупа') or _short_date(query,today):
            reply = _reply(('Срок уточнения истёк. ' if expired else 'В этой беседе нет сохранённого уточнения. ')
                           + 'Повторите исходный вопрос; другой отчёт не подставляю.', 'CLARIFICATION_MISSING')
        if reply is None:
            try:
                # Rejected() must not leave a partially enqueued request behind.
                c.execute('SAVEPOINT dialogue_action')
                reply = engine._submit(tenant, query, inner_rid, body_hash, anchor, clarification=metadata)
                c.execute('RELEASE dialogue_action')
                p = None
            except Rejected as exc:
                c.execute('ROLLBACK TO dialogue_action'); c.execute('RELEASE dialogue_action')
                if exc.code=='OZON_EVENT_SOURCE_UNAVAILABLE' and engine.table_capabilities is not None:
                    if p is None:p=_context(engine,scope_hash,text,query,changes,anchor,now,exc)
                    p['query']=query;p['need']='event_platform';p['choice']='event'
                    reply=_prompt(p)
                elif exc.code=='COHORT_REQUIRED' and _event_axis(query):
                    p=_context(engine,scope_hash,text,query,changes,anchor,now,exc)
                    p['need']='event_unavailable';p['choice']='event'
                    reply=_event_unavailable(p)
                elif _clarifiable(query, exc):
                    if p is None:
                        p = _context(engine, scope_hash, text, query, changes, anchor, now, exc)
                    else:
                        p['need'] = 'basis' if exc.code == 'METRIC_AMBIGUOUS' else 'period'
                    reply = _prompt(p)
                else:
                    # Unsupported scope must not be silently weakened by a follow-up.
                    p = None
                    from failure_explanations import rejection_reply
                    reply = rejection_reply(exc.code, exc.message, exc.context)
        jid = reply.get('job_id')
        row = repo.get(tenant, jid) if jid else None
        if not row and not p and text in PENDING_CONTROLS:
            row = repo.get(tenant)
        if row and row['plan']:
            protected_plan = row['plan']
            if row['state'] == 'READY': expires = row['expires']
        expires=min(expires if expires is not None else now+TTL,now+TTL,p['expires_at'] if p else now+TTL)
        c.execute('INSERT OR REPLACE INTO dialogue_context VALUES(?,?,?,?,?)',
                  (tenant, conversation, message_seq, canonical_json(p) if p else None, now))
        c.execute('INSERT INTO dialogue_receipts VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                  (tenant, conversation, rid, message_seq, body_hash, canonical_json(reply),
                   scope_hash, jid, protected_plan, expires, now))
        if reply.get('error'):
            from failure_explanations import public_code
            print(canonical_json({'event':'dialogue_outcome','error':public_code(reply['error']),'clarification':bool(reply.get('clarification_required'))}),flush=True)
        # Active expiration is performed by the independent retention timer.
        return reply


def submit(engine, tenant, command, rid, body_hash, today, conversation, message_seq):
    # Scope restored even when authorization/parser/SQLite raises. Worker threads
    # and legacy ingress never inherit another request's selected job or page.
    with engine.repo.reader_scope(tenant,conversation):
        return _submit_scoped(engine,tenant,command,rid,body_hash,today,conversation,message_seq)
